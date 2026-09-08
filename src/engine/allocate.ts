import type { Ability, Unit, Upgrade } from './types.ts';
import { alive } from './types.ts';
import { scoreAction, canTarget, scoreUpgrade, unitMove } from './combat.ts';
import { key, parseKey, reachable, type MapDef, type Pos } from './grid.ts';

export interface Action {
  unit: Unit;
  /** Null when this action is buying an upgrade rather than using an ability. */
  ability: Ability | null;
  upgrade?: Upgrade;
  /** Tile the unit moves to before acting. Movement is free; dice pay abilities. */
  movePos: Pos;
  /** Centre of the ability's effect. */
  target: Pos;
  dice: number[];
  diceMask: number;
  score: number;
}

export interface Plan {
  actions: Action[];
  diceUsed: number;
  totalScore: number;
}

/** Every dice subset that exactly pays `cost`, as bitmasks. */
export function payingMasks(dice: number[], ability: Ability): number[] {
  const out: number[] = [];
  for (let mask = 1; mask < 1 << dice.length; mask++) {
    let sum = 0, count = 0;
    for (let i = 0; i < dice.length; i++) {
      if (mask & (1 << i)) { sum += dice[i]!; count++; }
    }
    // Wildcards ignore the value entirely and eat exactly one die.
    if (ability.wildcard ? count === 1 : sum === ability.cost) out.push(mask);
  }
  return out;
}

export function maskToDice(mask: number, dice: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < dice.length; i++) if (mask & (1 << i)) out.push(dice[i]!);
  return out;
}

export function countBits(mask: number): number {
  let c = 0;
  while (mask) { mask &= mask - 1; c++; }
  return c;
}

/** Where a unit could stand this turn, given who is blocking. */
export function movementOptions(unit: Unit, units: Unit[], map: MapDef, budget?: number): Pos[] {
  const others = units.filter((u) => alive(u) && u !== unit);
  const blocked = new Set(others.map((u) => key(u.pos)));
  const allowance = budget ?? unitMove(unit);
  if (allowance <= 0) return [unit.pos];
  return [...reachable(map, unit.pos, allowance, blocked).keys()].map(parseKey);
}

/**
 * Tiles a unit may act from with a specific ability. Normal movement is only
 * available if it has not moved yet, but an ability's `dash` always applies --
 * that is the whole point of a gap-closer.
 */
export function actionTiles(unit: Unit, ability: Ability, units: Unit[], map: MapDef): Pos[] {
  const budget = (unit.hasMoved ? 0 : unitMove(unit)) + (ability.dash ?? 0);
  return movementOptions(unit, units, map, budget);
}

/**
 * Best (tile, target) pairing for one ability. Candidate target centres are
 * restricted to tiles occupied by the relevant side rather than every tile in
 * range -- for a 5v5 that is 5 candidates instead of ~13, which is what keeps
 * headless idle simulation fast enough to run thousands of battles.
 */
function bestPlacement(
  unit: Unit, ability: Ability, tiles: Pos[], allies: Unit[], enemies: Unit[], map: MapDef,
): { movePos: Pos; target: Pos; score: number } | null {
  const centres = (ability.kind === 'attack' ? enemies : allies).filter(alive).map((u) => u.pos);
  if (centres.length === 0) return null;

  let best: { movePos: Pos; target: Pos; score: number } | null = null;
  for (const tile of tiles) {
    for (const centre of centres) {
      if (!canTarget(ability, tile, centre, map)) continue;
      const score = scoreAction(unit, ability, centre, allies, enemies, map);
      if (score > 0 && (!best || score > best.score)) best = { movePos: tile, target: centre, score };
    }
  }
  return best;
}

interface Option { mask: number; action: Omit<Action, 'dice' | 'diceMask'> }

function optionsFor(unit: Unit, dice: number[], allies: Unit[], enemies: Unit[], map: MapDef): Option[] {
  const units = [...allies, ...enemies];
  const byMask = new Map<number, Option>();

  // Buying the next upgrade tier competes for the same dice as an ability.
  const nextTier = (unit.def.upgrades ?? [])[unit.upgrades];
  if (nextTier) {
    const score = scoreUpgrade(unit, enemies, map);
    for (const mask of payingMasks(dice, { cost: nextTier.cost } as Ability)) {
      const existing = byMask.get(mask);
      if (existing && existing.action.score >= score) continue;
      byMask.set(mask, {
        mask,
        action: { unit, ability: null, upgrade: nextTier, movePos: unit.pos, target: unit.pos, score },
      });
    }
  }

  for (const ability of unit.def.abilities) {
    // Recomputed per ability, since a dash widens where this one can be used from.
    const tiles = actionTiles(unit, ability, units, map);
    const placement = bestPlacement(unit, ability, tiles, allies, enemies, map);
    if (!placement) continue;
    for (const mask of payingMasks(dice, ability)) {
      const existing = byMask.get(mask);
      if (existing && existing.action.score >= placement.score) continue;
      byMask.set(mask, {
        mask,
        action: { unit, ability, movePos: placement.movePos, target: placement.target, score: placement.score },
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
 * `movementOptions` and `payingMasks` directly to show legal choices instead.
 */
export function bestPlan(team: Unit[], dice: number[], foes: Unit[], map: MapDef): Plan {
  const actors = team.filter(alive);
  const optionSets = actors.map((u) => optionsFor(u, dice, team, foes, map));

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
      current.push({ ...opt.action, dice: maskToDice(opt.mask, dice), diceMask: opt.mask });
      recurse(i + 1, usedMask | opt.mask, score + opt.action.score, diceUsed + countBits(opt.mask));
      current.pop();
    }
  };

  recurse(0, 0, 0, 0);
  return best;
}
