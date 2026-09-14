import type { Ability, Die, Pos, Unit, Upgrade } from './types.ts';
import { alive } from './types.ts';
import { scoreAction, canTarget, scoreUpgrade } from './combat.ts';
// The pool's own concerns -- what a subset costs, which dice a mask names --
// live in `dice.ts`. Re-exported here because this module was where callers
// found them before the pool grew an identity.
import { countBits, maskToDice, maskToIds, payingMasks } from './dice.ts';

export { countBits, maskToDice, maskToIds, payingMasks };

export interface Action {
  unit: Unit;
  /** Null when this action is buying an upgrade rather than using an ability. */
  ability: Ability | null;
  upgrade?: Upgrade;
  /** Slot the ability is aimed at. */
  target: Pos;
  /** Which dice pay for it, by id. Never by index -- the pool is mutable. */
  dice: string[];
  diceMask: number;
  score: number;
}

export interface Plan {
  actions: Action[];
  diceUsed: number;
  totalScore: number;
}

/**
 * Best target for one ability. Candidate centres are the slots the relevant side
 * actually occupies rather than every slot on the field, which is what keeps
 * headless idle simulation fast enough to run thousands of battles.
 *
 * There used to be a second dimension here -- which tile to act FROM -- because
 * movement widened where an ability was legal. Nobody moves now, so the search
 * is just "which target scores best".
 */
function bestTarget(
  unit: Unit, ability: Ability, allies: Unit[], enemies: Unit[],
): { target: Pos; score: number } | null {
  const units = [...allies, ...enemies];
  const centres = (ability.kind === 'attack' ? enemies : allies).filter(alive).map((u) => u.pos);

  let best: { target: Pos; score: number } | null = null;
  for (const centre of centres) {
    if (!canTarget(ability, unit, centre, units)) continue;
    const score = scoreAction(unit, ability, centre, allies, enemies);
    if (score > 0 && (!best || score > best.score)) best = { target: centre, score };
  }
  return best;
}

interface Option { mask: number; action: Omit<Action, 'dice' | 'diceMask'> }

function optionsFor(unit: Unit, dice: Die[], allies: Unit[], enemies: Unit[]): Option[] {
  const byMask = new Map<number, Option>();

  // Buying the next upgrade tier competes for the same dice as an ability.
  const nextTier = (unit.def.upgrades ?? [])[unit.upgrades];
  if (nextTier) {
    const score = scoreUpgrade(unit, enemies);
    for (const mask of payingMasks(dice, { cost: nextTier.cost } as Ability)) {
      const existing = byMask.get(mask);
      if (existing && existing.action.score >= score) continue;
      byMask.set(mask, {
        mask,
        action: { unit, ability: null, upgrade: nextTier, target: unit.pos, score },
      });
    }
  }

  for (const ability of unit.def.abilities) {
    // The auto-battler has to respect cooldowns for the same reason the player
    // does, or idle play quietly gets a better kit than manual play.
    if ((unit.cooldowns[ability.name] ?? 0) > 0) continue;
    const placement = bestTarget(unit, ability, allies, enemies);
    if (!placement) continue;
    for (const mask of payingMasks(dice, ability)) {
      const existing = byMask.get(mask);
      if (existing && existing.action.score >= placement.score) continue;
      byMask.set(mask, {
        mask,
        action: { unit, ability, target: placement.target, score: placement.score },
      });
    }
  }

  return [...byMask.values()];
}

/**
 * Choose which characters act and with which dice -- the heart of the game.
 * Five dice across five characters means someone usually sits out, and picking
 * who is the turn's real decision. Exhaustive over disjoint dice assignments;
 * deduping options by dice-mask caps each unit at 31 branches regardless of kit
 * size, which keeps this fast enough to run every turn for both sides.
 *
 * Used for enemy AI and for auto-battling idle stages. The player-facing UI uses
 * `payingMasks` directly to show legal choices instead.
 */
export function bestPlan(team: Unit[], dice: Die[], foes: Unit[]): Plan {
  const actors = team.filter(alive);
  const optionSets = actors.map((u) => optionsFor(u, dice, team, foes));

  let best: Plan = { actions: [], diceUsed: 0, totalScore: 0 };
  const current: Action[] = [];

  const recurse = (i: number, usedMask: number, score: number, diceUsed: number) => {
    if (i === actors.length) {
      // Tie-break toward spending more dice, so turns do not idle for no reason.
      if (score > best.totalScore || (score === best.totalScore && diceUsed > best.diceUsed)) {
        best = { actions: [...current], diceUsed, totalScore: score };
      }
      return;
    }

    // Branch where this character sits the turn out.
    recurse(i + 1, usedMask, score, diceUsed);

    for (const opt of optionSets[i]!) {
      if (opt.mask & usedMask) continue;
      current.push({ ...opt.action, dice: maskToIds(opt.mask, dice), diceMask: opt.mask });
      recurse(i + 1, usedMask | opt.mask, score + opt.action.score, diceUsed + countBits(opt.mask));
      current.pop();
    }
  };

  recurse(0, 0, 0, 0);
  return best;
}
