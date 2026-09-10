import type {
  Ability,
  CharacterDef,
  DamageType,
  EffectTarget,
  Element,
  Intent,
  Modifier,
  ModStat,
  Side,
  Unit,
} from './types.ts';
import { alive } from './types.ts';
import { Rng } from './rng.ts';
import { applyLevel } from './levels.ts';
import { bestPlan, type Action } from './allocate.ts';
import {
  canTarget,
  computeDamage,
  computeHeal,
  lifestealHeal,
  scoreAction,
  thornsDamage,
  unitMaxHp,
  unitsHit,
  elementResistance,
  unitAttack,
  resolveModifierAmount,
  DEFAULT_MODIFIER_TURNS,
  CRIT_PERCENT,
  CRIT_MULTIPLIER,
} from './combat.ts';
import { matchupLabel } from './elements.ts';
import { slotPos, type EncounterDef, type Slot } from './formation.ts';
import type { Pos } from './types.ts';

export const DICE_PER_TURN = 5;
/**
 * The die enemies choose their action with.
 *
 * Twenty-sided, against the player's six. Fine enough to author a one-in-ten
 * ultimate, and visibly not the player's die.
 */
export const ENEMY_DIE = 20;
// No approach phase any more -- everyone is in range from turn one -- but a cap
// still has to exist so a stalemate cannot run forever.
export const MAX_TURNS = 40;

export type Outcome = 'ongoing' | 'victory' | 'defeat' | 'draw';

export type Event =
  | { t: 'roll'; side: Side; turn: number; dice: number[] }
  | { t: 'act'; side: Side; actor: string; ability: string; dice: number[] }
  | {
      t: 'damage';
      target: string;
      amount: number;
      matchup: string;
      hpAfter: number;
      /** What the hit was made of, so the UI can colour the number. */
      element?: Element;
      /** Whether it rolled a critical. Absent means no. */
      crit?: boolean;
    }
  | { t: 'heal'; target: string; amount: number; hpAfter: number }
  | { t: 'buff'; target: string; amount: number; stat: 'attack' | 'defense' }
  | {
      t: 'modify';
      target: string;
      /** The ability that applied it -- also its identity for refreshing. */
      effect: string;
      stat: ModStat;
      amount: number;
      turns: number;
    }
  | { t: 'expire'; unit: string; effect: string }
  | { t: 'ko'; unit: string }
  | { t: 'telegraph'; unit: string; ability: string; at: Pos }
  | { t: 'intent'; unit: string; ability: string; target: string; roll: number }
  | { t: 'rotate'; unit: string; immune: string; weak: string }
  | { t: 'fizzle'; actor: string; ability: string; reason: string }
  | { t: 'upgrade'; unit: string; name: string; tier: number }
  | { t: 'end'; outcome: Outcome; turns: number };

export interface BattleState {
  encounter: EncounterDef;
  units: Unit[];
  turn: number;
  phase: Side;
  dice: number[];
  /** Parallel to `dice`; true once that die has been spent this phase. */
  diceSpent: boolean[];
  log: Event[];
  outcome: Outcome;
  rng: Rng;
  /** Per-phase AI plan, so the UI can play it out one step at a time. */
  ai: AiCache | null;
  /**
   * The player's queued actions for this round, in the order they will resolve.
   *
   * Planning and resolving are separate steps on purpose. If actions landed as
   * they were clicked, ordering would be a probe -- cast the cheap thing, look
   * at the result, then decide the rest -- and the order would stop being a
   * decision. Building the whole turn before any of it happens is what makes
   * "which of these goes first" a real question with a real cost for getting it
   * wrong.
   */
  plan: PlannedAction[];
  /** Undrawn elements for resistance rotation; refilled when empty. */
  rotationBag: Element[];
}

/** One queued action. `ability` is null for an upgrade purchase. */
export interface PlannedAction {
  unit: Unit;
  ability: Ability | null;
  /** Indices into `dice`, reserved while queued and spent on commit. */
  dice: number[];
  target: Pos;
}

interface AiCache {
  plan: Action[];
  index: number;
}

/** One discrete thing the AI did, so the UI can animate and narrate it. */
export interface AiStep {
  unit: Unit;
  kind: 'act';
  ability?: Ability;
  target?: Pos;
}

export const teamOf = (s: BattleState, side: Side): Unit[] => s.units.filter((u) => u.side === side);
export const livingOf = (s: BattleState, side: Side): Unit[] => teamOf(s, side).filter(alive);
export const unitAt = (s: BattleState, p: Pos): Unit | undefined =>
  s.units.find((u) => alive(u) && u.pos.x === p.x && u.pos.y === p.y);

export function createBattle(
  encounter: EncounterDef,
  playerDefs: CharacterDef[],
  enemyDefs: CharacterDef[],
  seed: number,
): BattleState {
  // Deployed in order into the encounter's slots. More defs than slots would
  // stack them, so encounters are authored with enough room for their roster.
  const mk = (defs: CharacterDef[], side: Side, slots: Slot[]): Unit[] =>
    defs.map((def, i) => ({
      def,
      hp: def.maxHp,
      modifiers: [],
      side,
      pos: slotPos(slots[i] ?? slots[slots.length - 1]!),
      hasActed: false,
      upgrades: 0,
      cooldowns: {},
      resistMods: {},
      pending: null,
      intent: null,
    }));

  // Enemies are levelled here rather than by the caller, so every entry point --
  // the battle screen, a headless resolve, a test -- fields the encounter at the
  // level it declares without having to remember to.
  const levelled =
    (encounter.enemyLevel ?? 1) > 1
      ? enemyDefs.map((d) => applyLevel(d, encounter.enemyLevel!))
      : enemyDefs;

  const state: BattleState = {
    encounter,
    units: [
      ...mk(playerDefs, 'player', encounter.partySlots),
      ...mk(levelled, 'enemy', encounter.enemySlots),
    ],
    turn: 1,
    phase: 'player',
    dice: [],
    diceSpent: [],
    log: [],
    outcome: 'ongoing',
    rng: new Rng(seed),
    ai: null,
    plan: [],
    rotationBag: [],
  };
  beginPhase(state);
  return state;
}

/**
 * Start Turn.
 *
 * Regeneration and cooldowns, then the dice. Everything here lands for the
 * whole side at once and belongs to nobody's slot in the resolution order --
 * see `endTurn` for the other bookend.
 *
 * Expiry deliberately does NOT happen here. A modifier applied on a turn has
 * to cover that turn, so it is counted down at the END of it; ticking at the
 * start would silently make every duration one turn longer than it reads.
 */
function beginPhase(s: BattleState): void {
  for (const u of teamOf(s, s.phase)) {
    u.hasActed = false;

    for (const name of Object.keys(u.cooldowns)) {
      u.cooldowns[name] = Math.max(0, (u.cooldowns[name] ?? 0) - 1);
    }

    for (const p of u.def.passives ?? []) {
      if (p.kind !== 'regen' || !alive(u)) continue;
      const cap = unitMaxHp(u);
      const healed = Math.min(Math.round((cap * p.percent) / 100), cap - u.hp);
      if (healed > 0) {
        u.hp += healed;
        s.log.push({ t: 'heal', target: u.def.name, amount: healed, hpAfter: u.hp });
      }
    }
  }
  s.ai = null;
  s.plan = [];
  s.dice = s.rng.roll(DICE_PER_TURN);
  s.diceSpent = s.dice.map(() => false);
  s.log.push({ t: 'roll', side: s.phase, turn: s.turn, dice: [...s.dice] });

  // Enemies declare at the top of the PLAYER's phase, so the plan can be made
  // against them. Doing it at the top of the enemy phase would be too late to
  // be worth showing.
  if (s.phase === 'player') {
    rotateResistances(s);
    chooseIntents(s);
  }
}

/**
 * Decide what every living enemy will do, and reveal it.
 *
 * Called once at the top of the round, BEFORE the player plans, because the
 * whole point is that the player plans against it. An enemy that picked its
 * action when its phase arrived would be unplannable no matter how simple its
 * rules were.
 *
 * Two separate choices, deliberately made differently:
 *
 * WHICH ability, by a d20 roll against the creature's own table. The roll is
 * shown; the table is on the creature, one click away. A boss whose ultimate
 * sits on 19-20 is a different threat from one where it sits on 11-20, and the
 * player can read exactly which as soon as they look.
 *
 * WHO it targets, uniformly at random among legal targets. Targeting is not
 * where the interest lives, and a deterministic "always hits the weakest" makes
 * the reveal redundant -- you would know it before reading it.
 */
function chooseIntents(s: BattleState): void {
  const foes = livingOf(s, 'player');
  for (const u of livingOf(s, 'enemy')) {
    u.intent = null;
    if (foes.length === 0) continue;
    // A telegraphed cast already committed last round; it is not re-chosen, and
    // showing it again as a fresh intent would double-count it.
    if (u.pending) continue;

    const allies = livingOf(s, 'enemy');
    const usable = u.def.abilities.filter((a) => {
      if ((u.cooldowns[a.name] ?? 0) > 0) return false;
      const pool = a.kind === 'attack' ? foes : allies;
      return pool.some((t) => canTarget(a, u, t.pos, s.units));
    });
    if (usable.length === 0) continue;

    const { ability, roll } = rollForAbility(s, usable);
    const pool = ability.kind === 'attack' ? foes : allies;
    const legal = pool.filter((t) => canTarget(ability, u, t.pos, s.units));
    const target = legal[s.rng.int(0, legal.length - 1)]!;

    u.intent = { ability, target: target.pos, roll };
    s.log.push({
      t: 'intent',
      unit: u.def.name,
      ability: ability.name,
      target: target.def.name,
      roll,
    });
  }
}

/**
 * Roll the creature's die and read the ability off its table.
 *
 * The roll happens ONCE and is kept, so the number shown is the number that
 * chose the action -- a second roll for display would be a different die and a
 * lie about what happened.
 *
 * A roll landing in a gap, or on an ability that is currently unusable (on
 * cooldown, no legal target), falls through to the nearest usable band rather
 * than wasting the creature's turn. Doing nothing would be a truthful reading
 * of the table and terrible to play against.
 */
function rollForAbility(
  s: BattleState,
  usable: Ability[],
): { ability: Ability; roll: number } {
  const roll = s.rng.int(1, ENEMY_DIE);
  const hit = usable.find((a) => a.roll && roll >= a.roll[0] && roll <= a.roll[1]);
  if (hit) return { ability: hit, roll };

  // Nearest band by distance, so an unusable or unclaimed roll degrades to the
  // most plausible neighbour instead of to the first entry in the list.
  const distance = (a: Ability): number => {
    if (!a.roll) return Number.MAX_SAFE_INTEGER;
    return roll < a.roll[0] ? a.roll[0] - roll : roll - a.roll[1];
  };
  const nearest = [...usable].sort((a, b) => distance(a) - distance(b))[0]!;
  return { ability: nearest, roll };
}

/**
 * Re-roll the resistances of anything that rotates them, and announce it.
 *
 * Runs beside `chooseIntents` -- at the top of the player's phase, before
 * planning -- for the same reason: a rotation revealed after the turn is locked
 * would invalidate the plan rather than inform it, which is precisely what
 * BATTLE_DESIGN forbids of randomness.
 *
 * The immunity and the weakness are drawn from a shuffled cycle so all five
 * elements come round before any repeats, and the two are never the same
 * element. A pure random draw would sometimes sit on one element for three
 * turns running, which reads as the mechanic being broken rather than unlucky.
 */
function rotateResistances(s: BattleState): void {
  for (const u of livingOf(s, 'enemy')) {
    const spec = u.def.rotatesResistance;
    if (!spec) continue;

    // Drawn from a bag rather than rolled fresh: a plain random draw put the
    // same element up twice in a row, which reads as the mechanic being broken
    // rather than as bad luck. Refilled once empty, so all five come round
    // before any repeats.
    if (s.rotationBag.length === 0) {
      s.rotationBag = shuffle([...ROTATING_ELEMENTS], s.rng);
      // A bag stops repeats WITHIN a cycle but not across the seam: the refill
      // can open on the element the last one closed with, which looks exactly
      // like the repeat the bag was for. Swapping the end away fixes the seam
      // and costs nothing.
      const last = u.resistMods;
      const tail = s.rotationBag[s.rotationBag.length - 1]!;
      if ((last[tail] ?? 0) >= spec.immuneFor && s.rotationBag.length > 1) {
        [s.rotationBag[0], s.rotationBag[s.rotationBag.length - 1]] = [tail, s.rotationBag[0]!];
      }
    }
    const immune = s.rotationBag.pop()!;
    const others = ROTATING_ELEMENTS.filter((e) => e !== immune);
    const weak = others[s.rng.int(0, others.length - 1)]!;

    // Replaced wholesale, not accumulated: last round's immunity must not
    // linger, and this is the only writer of these two elements.
    u.resistMods = { [immune]: spec.immuneFor, [weak]: spec.weakFor };
    s.log.push({ t: 'rotate', unit: u.def.name, immune, weak });
  }
}

/** The cycle rotation draws from; light and dark sit outside it. */
const ROTATING_ELEMENTS: Element[] = ['fire', 'wind', 'earth', 'lightning', 'water'];

/** Fisher-Yates against the battle's seeded RNG, so a fight stays reproducible. */
function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** Indices of dice not yet spent this phase. */
export const availableDice = (s: BattleState): number[] =>
  s.dice.map((_, i) => i).filter((i) => !s.diceSpent[i]);

/**
 * Shared validation for queueing an action. Returns an error string, or null.
 *
 * Split out so planning and the older immediate commit cannot drift apart on
 * what counts as legal -- two copies of "does this pay the cost" is exactly the
 * kind of duplication that ends with the UI offering a move the engine refuses.
 */
function checkAction(
  s: BattleState,
  unit: Unit,
  ability: Ability,
  diceIndices: number[],
  target: Pos,
): string | null {
  if (s.outcome !== 'ongoing') return 'The battle is over.';
  if (unit.side !== 'player') return 'Only the player plans.';
  if (!alive(unit)) return `${unit.def.name} is down.`;
  // Cooldowns were enemy-only: `Unit.cooldowns` and its per-turn countdown are
  // side-agnostic, but nothing on the player's path ever set or read them, so
  // an ultimate with a cooldown could be cast every turn.
  const cd = unit.cooldowns[ability.name] ?? 0;
  if (cd > 0) {
    return `${ability.name} is not ready for ${cd} more turn${cd === 1 ? '' : 's'}.`;
  }
  if (diceIndices.some((i) => s.diceSpent[i])) return 'Those dice are already committed.';

  const values = diceIndices.map((i) => s.dice[i]!);
  const sum = values.reduce((a, b) => a + b, 0);
  if (ability.wildcard ? diceIndices.length !== 1 : sum !== ability.cost) {
    return ability.wildcard
      ? `${ability.name} takes exactly one die.`
      : `${ability.name} costs ${ability.cost}; you selected ${sum}.`;
  }
  if (!canTarget(ability, unit, target, s.units)) {
    return `${unit.def.name} cannot reach that far into the enemy line.`;
  }
  return null;
}

/** Is this character already in the queue? One action each per round. */
export const isPlanned = (s: BattleState, unit: Unit): boolean =>
  s.plan.some((p) => p.unit === unit);

/**
 * Add an action to the end of the queue.
 *
 * Dice are reserved immediately rather than at commit, so the tray shows what
 * is left to spend while the rest of the turn is being built -- planning
 * against dice you have already promised elsewhere would make the queue a lie.
 */
export function planAction(
  s: BattleState,
  unit: Unit,
  ability: Ability,
  diceIndices: number[],
  target: Pos,
): string | null {
  if (isPlanned(s, unit)) return `${unit.def.name} is already acting this round.`;
  const err = checkAction(s, unit, ability, diceIndices, target);
  if (err) return err;

  for (const i of diceIndices) s.diceSpent[i] = true;
  s.plan.push({ unit, ability, dice: [...diceIndices], target });
  return null;
}

/** Queue an upgrade purchase, which costs the character's action like a cast. */
export function planUpgrade(s: BattleState, unit: Unit, diceIndices: number[]): string | null {
  if (s.outcome !== 'ongoing') return 'The battle is over.';
  if (isPlanned(s, unit)) return `${unit.def.name} is already acting this round.`;

  const next = (unit.def.upgrades ?? [])[unit.upgrades];
  if (!next) return `${unit.def.name} is fully upgraded.`;
  if (diceIndices.some((i) => s.diceSpent[i])) return 'Those dice are already committed.';

  const sum = diceIndices.reduce((a, i) => a + s.dice[i]!, 0);
  if (sum !== next.cost) return `${next.name} costs ${next.cost}; you selected ${sum}.`;

  for (const i of diceIndices) s.diceSpent[i] = true;
  s.plan.push({ unit, ability: null, dice: [...diceIndices], target: unit.pos });
  return null;
}

/** Take an action back out of the queue, returning its dice to the pool. */
export function unplan(s: BattleState, index: number): void {
  const entry = s.plan[index];
  if (!entry) return;
  for (const i of entry.dice) s.diceSpent[i] = false;
  s.plan.splice(index, 1);
}

export function clearPlan(s: BattleState): void {
  for (const entry of s.plan) for (const i of entry.dice) s.diceSpent[i] = false;
  s.plan = [];
}

/** Move a queued action to a new position. Reordering IS the strategy. */
export function movePlanned(s: BattleState, from: number, to: number): void {
  if (from === to) return;
  const entry = s.plan[from];
  if (!entry || to < 0 || to >= s.plan.length) return;
  s.plan.splice(from, 1);
  s.plan.splice(to, 0, entry);
}

/**
 * Resolve the whole queue, in order, then hand over to the enemies.
 *
 * Nothing is re-validated against the state it finds. An action whose target
 * died earlier in the same queue FIZZLES, and its dice are gone -- that is the
 * cost of ordering the turn badly, and removing it would remove the decision.
 * The one thing checked is that the target still exists, because silently
 * resolving damage onto a corpse would read as a bug rather than a mistake.
 */
export function commitPlan(s: BattleState): void {
  while (commitNext(s)) {
    /* each call resolves exactly one queued action */
  }
}

/**
 * Resolve the FRONT of the queue and return what happened, or null when the
 * queue is empty.
 *
 * Stepped rather than all-at-once so the UI can animate one action, let it
 * land, and then run the next -- the same shape the enemy phase already uses.
 * Resolving the whole turn in a single frame would collapse an ordered plan
 * into one indistinguishable flash, which throws away the readability that
 * ordering the turn was supposed to buy.
 */
export function commitNext(s: BattleState): PlannedAction | null {
  if (s.outcome !== 'ongoing' || s.phase !== 'player') return null;

  while (s.plan.length > 0) {
    const entry = s.plan.shift()!;
    const { unit, ability, dice, target } = entry;

    if (!alive(unit)) {
      s.log.push({
        t: 'fizzle',
        actor: unit.def.name,
        ability: ability?.name ?? 'upgrade',
        reason: 'was taken out before acting',
      });
      continue;
    }

    if (!ability) {
      const before = unitMaxHp(unit);
      const next = (unit.def.upgrades ?? [])[unit.upgrades];
      if (!next) continue;
      unit.upgrades++;
      unit.hp += Math.max(0, unitMaxHp(unit) - before);
      unit.hasActed = true;
      s.log.push({ t: 'upgrade', unit: unit.def.name, name: next.name, tier: unit.upgrades });
      return entry;
    }

    // A single-target ability whose victim is already down does nothing. Whole-
    // side abilities always have something to land on, so they never fizzle.
    if ((ability.scope ?? 'one') !== 'all') {
      const occupant = unitAt(s, target);
      if (!occupant) {
        s.log.push({
          t: 'fizzle',
          actor: unit.def.name,
          ability: ability.name,
          reason: 'its target was already down',
        });
        continue;
      }
    }

    unit.hasActed = true;
    // `+1` because Start Turn counts every cooldown down, including the turn
    // this was cast on. A 2-turn cooldown therefore locks out the next two
    // turns and is ready on the third -- turns you cannot use it, which is how
    // a player reads the number.
    if (ability.cooldown) unit.cooldowns[ability.name] = ability.cooldown + 1;
    s.log.push({
      t: 'act',
      side: 'player',
      actor: unit.def.name,
      ability: ability.name,
      dice: dice.map((i) => s.dice[i]!),
    });
    applyAbility(s, unit, ability, target);
    checkOutcome(s);
    return entry;
  }

  return null;
}

/**
 * Commit one character's action. `diceIndices` must exactly pay the cost (or be
 * a single die for a wildcard). Returns an error string instead of throwing so
 * the UI can surface it, since this is called straight from click handlers.
 */
export function commitAction(
  s: BattleState,
  unit: Unit,
  ability: Ability,
  diceIndices: number[],
  target: Pos,
): string | null {
  if (s.outcome !== 'ongoing') return 'The battle is over.';
  if (unit.side !== s.phase) return 'It is not that side’s phase.';
  if (unit.hasActed) return `${unit.def.name} has already acted.`;
  if ((unit.cooldowns[ability.name] ?? 0) > 0) return `${ability.name} is still on cooldown.`;
  if (diceIndices.some((i) => s.diceSpent[i])) return 'Those dice are already spent.';

  const values = diceIndices.map((i) => s.dice[i]!);
  const sum = values.reduce((a, b) => a + b, 0);
  if (ability.wildcard ? diceIndices.length !== 1 : sum !== ability.cost) {
    return ability.wildcard
      ? `${ability.name} takes exactly one die.`
      : `${ability.name} costs ${ability.cost}; you selected ${sum}.`;
  }

  // Checked before any mutation so a rejected action changes nothing.
  if (!canTarget(ability, unit, target, s.units)) {
    return `${unit.def.name} cannot reach that far into the enemy line.`;
  }

  for (const i of diceIndices) s.diceSpent[i] = true;
  unit.hasActed = true;
  if (ability.cooldown) unit.cooldowns[ability.name] = ability.cooldown + 1;
  s.log.push({ t: 'act', side: s.phase, actor: unit.def.name, ability: ability.name, dice: values });

  applyAbility(s, unit, ability, target);
  checkOutcome(s);
  return null;
}

/**
 * Buy the next upgrade tier. Costs dice from the shared pool and the character's
 * action, same as an ability -- investing in a character is a turn you spend
 * instead of fighting. The stat gain also raises max HP, and the new headroom is
 * granted as healing so upgrading never leaves you proportionally worse off.
 */
export function commitUpgrade(
  s: BattleState,
  unit: Unit,
  diceIndices: number[],
): string | null {
  if (s.outcome !== 'ongoing') return 'The battle is over.';
  if (unit.side !== s.phase) return 'It is not that side’s phase.';
  if (unit.hasActed) return `${unit.def.name} has already acted.`;

  const tiers = unit.def.upgrades ?? [];
  const next = tiers[unit.upgrades];
  if (!next) return `${unit.def.name} is fully upgraded.`;
  if (diceIndices.some((i) => s.diceSpent[i])) return 'Those dice are already spent.';

  const values = diceIndices.map((i) => s.dice[i]!);
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum !== next.cost) return `${next.name} costs ${next.cost}; you selected ${sum}.`;

  const before = unitMaxHp(unit);
  for (const i of diceIndices) s.diceSpent[i] = true;
  unit.upgrades++;
  unit.hp += Math.max(0, unitMaxHp(unit) - before);
  unit.hasActed = true;

  s.log.push({ t: 'upgrade', unit: unit.def.name, name: next.name, tier: unit.upgrades });
  return null;
}

/**
 * Who one effect inside an ability lands on.
 *
 * `target` honours the ability's own scope, so an `all` ability's damage still
 * hits everyone while a self-buff bundled into it hits only the caster.
 */
function effectTargets(
  s: BattleState,
  source: Unit,
  ability: Ability,
  centre: Pos,
  on: EffectTarget,
): Unit[] {
  if (on === 'self') return [source];
  if (on === 'allies') return livingOf(s, source.side);
  const pool =
    ability.kind === 'attack'
      ? livingOf(s, source.side === 'player' ? 'enemy' : 'player')
      : livingOf(s, source.side);
  return unitsHit(ability, centre, pool);
}

/**
 * Run an authored effect list, top to bottom.
 *
 * Order is the point: a self-buff written before the damage is up before the
 * strike lands, and one written after is not. Nothing here re-derives the
 * order from what the effects are.
 */
function applyEffects(s: BattleState, source: Unit, ability: Ability, centre: Pos): void {
  for (const fx of ability.effects!) {
    const targets = effectTargets(s, source, ability, centre, fx.on ?? 'target');

    switch (fx.do) {
      case 'damage':
        for (const target of targets) {
          strike(s, source, ability, target, {
            power: fx.power,
            damageType: fx.damageType ?? ability.damageType,
            element: fx.element ?? ability.element,
          });
        }
        break;

      case 'heal':
        for (const target of targets) {
          const amount = Math.min(
            Math.round(unitAttack(source) * fx.power),
            unitMaxHp(target) - target.hp,
          );
          if (amount <= 0) continue;
          target.hp += amount;
          s.log.push({ t: 'heal', target: target.def.name, amount, hpAfter: target.hp });
        }
        break;

      case 'modify':
        for (const target of targets) {
          for (const stat of fx.stats) {
            applyModifier(s, target, {
              ability: ability.name,
              stat,
              amount: resolveModifierAmount(source, target, stat, fx.percent, fx.of),
              turns: fx.turns,
              by: source.side,
            });
          }
        }
        break;
    }
  }
}

/**
 * One hit landing on one target: damage, the critical roll, lifesteal, thorns.
 *
 * Shared by both authoring paths so a `damage` effect and a legacy `attack`
 * ability cannot drift apart -- there is one place that knows what a hit does.
 * `over` lets an effect state its own power, damage type or element without
 * needing a whole synthetic ability to carry them.
 */
function strike(
  s: BattleState,
  source: Unit,
  ability: Ability,
  target: Unit,
  over?: { power?: number; damageType?: DamageType; element?: Element },
): void {
  const shot: Ability = over
    ? {
        ...ability,
        power: over.power ?? ability.power,
        damageType: over.damageType ?? ability.damageType,
        element: over.element ?? ability.element,
      }
    : ability;

  const base = computeDamage(source, shot, target);
  // Rolled per TARGET, not per ability, so an AoE can crit on one victim and
  // not the next -- five numbers that all crit together would read as one big
  // number rather than five hits.
  //
  // Suppressed at zero: a hit an element is immune to deals nothing, and
  // "CRIT 0" is a worse lie than a plain 0.
  const crit = base > 0 && s.rng.int(1, 100) <= CRIT_PERCENT;
  const dmg = crit ? Math.round(base * CRIT_MULTIPLIER) : base;
  target.hp = Math.max(0, target.hp - dmg);
  s.log.push({
    t: 'damage',
    target: target.def.name,
    amount: dmg,
    matchup: matchupLabel(elementResistance(target, shot.element)),
    hpAfter: target.hp,
    element: shot.element,
    crit,
  });
  if (target.hp === 0) s.log.push({ t: 'ko', unit: target.def.name });

  const drain = lifestealHeal(source, dmg);
  if (drain > 0 && alive(source)) {
    const gained = Math.min(drain, unitMaxHp(source) - source.hp);
    if (gained > 0) {
      source.hp += gained;
      s.log.push({ t: 'heal', target: source.def.name, amount: gained, hpAfter: source.hp });
    }
  }

  const reflected = thornsDamage(target, shot, dmg);
  if (reflected > 0 && alive(source)) {
    source.hp = Math.max(0, source.hp - reflected);
    s.log.push({
      t: 'damage',
      target: source.def.name,
      amount: reflected,
      matchup: 'thorns',
      hpAfter: source.hp,
    });
    if (source.hp === 0) s.log.push({ t: 'ko', unit: source.def.name });
  }
}

function applyAbility(s: BattleState, source: Unit, ability: Ability, centre: Pos): void {
  if (ability.effects) {
    applyEffects(s, source, ability, centre);
    return;
  }

  const allies = livingOf(s, source.side);
  const foes = livingOf(s, source.side === 'player' ? 'enemy' : 'player');

  switch (ability.kind) {
    case 'attack': {
      for (const target of unitsHit(ability, centre, foes)) strike(s, source, ability, target);
      break;
    }
    case 'heal': {
      const healed = computeHeal(source, ability);
      for (const target of unitsHit(ability, centre, allies)) {
        const amount = Math.min(healed, unitMaxHp(target) - target.hp);
        if (amount <= 0) continue;
        target.hp += amount;
        s.log.push({ t: 'heal', target: target.def.name, amount, hpAfter: target.hp });
      }
      break;
    }
    case 'buff': {
      // Legacy authoring: a flat amount on one or both tracks. Routed through
      // the modifier list like everything else so there is a single place
      // stats can be changed from, and given the default duration since the
      // old model had none -- it decayed instead.
      const stats: ModStat[] =
        (ability.stat ?? 'attack') === 'defense'
          ? ['physicalDefense', 'magicalDefense']
          : ['attack'];
      for (const target of unitsHit(ability, centre, allies)) {
        for (const stat of stats) {
          applyModifier(s, target, {
            ability: ability.name,
            stat,
            amount: ability.power,
            turns: DEFAULT_MODIFIER_TURNS,
            by: source.side,
          });
        }
      }
      break;
    }
  }
}

/**
 * End Turn, for the side that just acted.
 *
 * Durations count down and anything reaching zero expires -- all at once, so
 * no effect's lifetime depends on who happened to be listed first in the
 * order. Only modifiers applied BY this side tick here, which is what makes a
 * 3-turn buff mean three of the buffer's own turns.
 *
 * Expiry never runs mid-resolution, so a buff cannot lapse between the second
 * and third ability of the same plan.
 */
function endTurn(s: BattleState, side: Side): void {
  for (const u of s.units) {
    if (u.modifiers.length === 0) continue;
    const kept: Modifier[] = [];
    for (const m of u.modifiers) {
      if (m.by !== side) {
        kept.push(m);
        continue;
      }
      m.turns -= 1;
      if (m.turns > 0) kept.push(m);
      else s.log.push({ t: 'expire', unit: u.def.name, effect: m.ability });
    }
    u.modifiers = kept;
  }
}

/**
 * Apply a modifier, or refresh it if this same ability already put one there.
 *
 * Refresh rather than stack is per ability, not per stat: Rally cast twice on
 * one ally is one modifier with its clock reset, while a different ability
 * adding to the same stat lands as its own entry with its own clock. Two
 * sources of +20% give +40%; one source cast twice gives +20% for longer.
 */
function applyModifier(s: BattleState, target: Unit, mod: Modifier): void {
  const existing = target.modifiers.find((m) => m.ability === mod.ability && m.stat === mod.stat);
  if (existing) {
    existing.amount = mod.amount;
    existing.turns = mod.turns;
    existing.by = mod.by;
  } else {
    target.modifiers.push(mod);
  }
  s.log.push({
    t: 'modify',
    target: target.def.name,
    effect: mod.ability,
    stat: mod.stat,
    amount: mod.amount,
    turns: mod.turns,
  });
}

function checkOutcome(s: BattleState): void {
  if (livingOf(s, 'enemy').length === 0) s.outcome = 'victory';
  else if (livingOf(s, 'player').length === 0) s.outcome = 'defeat';
  else if (s.turn > MAX_TURNS) s.outcome = 'draw';
  if (s.outcome !== 'ongoing') s.log.push({ t: 'end', outcome: s.outcome, turns: s.turn });
}

/** Switch to the enemy and roll their dice, without resolving anything yet. */
export function startEnemyPhase(s: BattleState): void {
  if (s.outcome !== 'ongoing' || s.phase !== 'player') return;
  // The player's End Turn, before the enemies get their Start Turn.
  endTurn(s, 'player');
  s.phase = 'enemy';
  beginPhase(s);
}

/** Hand control back to the player once the enemy phase has played out. */
export function finishEnemyPhase(s: BattleState): void {
  if (s.outcome !== 'ongoing' || s.phase !== 'enemy') return;
  endTurn(s, 'enemy');
  s.phase = 'player';
  s.turn++;
  if (s.turn > MAX_TURNS) {
    checkOutcome(s);
    return;
  }
  beginPhase(s);
}

/** Whole-phase handover, used headlessly. The UI steps it instead. */
export function endPhase(s: BattleState): void {
  if (s.outcome !== 'ongoing') return;
  if (s.phase === 'player') {
    startEnemyPhase(s);
    runAiPhase(s);
    finishEnemyPhase(s);
  } else {
    finishEnemyPhase(s);
  }
}

/**
 * Perform exactly ONE thing for the acting side, or return null when the phase
 * has nothing left, so the UI can show each character's decision separately.
 *
 * The two sides think differently. The player's team allocates a shared pool of
 * dice, which is the game's core puzzle. Enemies roll nothing: each picks the
 * highest-priority ability that is off cooldown and has a target. That makes
 * them readable -- you can look at the board and know what is coming.
 */
export function nextAiStep(s: BattleState): AiStep | null {
  if (s.outcome !== 'ongoing') return null;

  const team = livingOf(s, s.phase);
  const foes = livingOf(s, s.phase === 'player' ? 'enemy' : 'player');
  if (team.length === 0 || foes.length === 0) return null;

  return s.phase === 'enemy' ? nextEnemyStep(s, team, foes) : nextDiceStep(s, team, foes);
}

/** Player-side auto-battle: allocate the dice pool and play it out. */
function nextDiceStep(s: BattleState, team: Unit[], foes: Unit[]): AiStep | null {
  if (!s.ai) s.ai = { plan: bestPlan(team, s.dice, foes).actions, index: 0 };

  while (s.ai.index < s.ai.plan.length) {
    const action = s.ai.plan[s.ai.index++]!;
    if (!alive(action.unit) || action.unit.hasActed) continue;
    const indices = diceIndicesFor(s, action);
    if (indices === null) continue;

    if (action.upgrade) {
      if (commitUpgrade(s, action.unit, indices)) continue;
      return { unit: action.unit, kind: 'act', target: action.unit.pos };
    }

    if (!action.ability) continue;
    if (commitAction(s, action.unit, action.ability, indices, action.target)) continue;
    return { unit: action.unit, kind: 'act', ability: action.ability, target: action.target };
  }
  // Plan exhausted. Returning null is what ENDS the phase -- `nextAiStep`
  // returning falsy is the terminator for both AI loops, so nothing here may
  // fall through to a state where it could be called again unchanged.
  return null;
}

/**
 * Enemy side, one character at a time: land anything telegraphed last turn,
 * then take the best available action.
 */
function nextEnemyStep(s: BattleState, team: Unit[], foes: Unit[]): AiStep | null {
  for (const u of team) {
    if (!alive(u) || u.hasActed || !u.pending) continue;
    const cast = u.pending;
    u.pending = null;
    u.hasActed = true;
    // Lands on the slot named last turn. Nobody can move out of the way any
    // more, so the warning buys preparation -- heal, guard, or kill the caster
    // -- rather than a dodge.
    applyAbility(s, u, cast.ability, cast.target);
    checkOutcome(s);
    return { unit: u, kind: 'act', ability: cast.ability, target: cast.target };
  }

  for (const u of team) {
    if (!alive(u) || u.hasActed) continue;
    // Do what was announced. Falling back to a fresh choice would break the
    // promise the reveal makes -- the player planned against the intent, and an
    // enemy that quietly picked something else makes planning pointless. The
    // fallback exists only for an intent whose target has since died.
    const declared = u.intent && targetStillLegal(s, u, u.intent) ? u.intent : null;
    const choice = declared ?? chooseEnemyAction(s, u, foes);
    u.intent = null;
    if (!choice) continue;

    const { ability, target } = choice;
    u.hasActed = true;
    if (ability.cooldown) u.cooldowns[ability.name] = ability.cooldown + 1;

    if (ability.telegraph) {
      u.pending = { ability, target, turnsLeft: ability.telegraph };
      s.log.push({ t: 'telegraph', unit: u.def.name, ability: ability.name, at: target });
      return { unit: u, kind: 'act', ability, target };
    }

    s.log.push({ t: 'act', side: 'enemy', actor: u.def.name, ability: ability.name, dice: [] });
    applyAbility(s, u, ability, target);
    checkOutcome(s);
    return { unit: u, kind: 'act', ability, target };
  }

  // Nobody left who can act: end the phase. Every branch above sets `hasActed`
  // before returning, so each call makes progress and this cannot spin.
  return null;
}

interface EnemyChoice {
  ability: Ability;
  target: Pos;
}

/**
 * Can a declared intent still be carried out?
 *
 * The target may have died between the reveal and the enemy phase -- which is a
 * legitimate player answer to a revealed intent, and racing to kill the target's
 * threat is exactly the kind of play the reveal is meant to enable.
 */
function targetStillLegal(s: BattleState, unit: Unit, intent: Intent): boolean {
  const occupant = unitAt(s, intent.target);
  if (occupant && !alive(occupant)) return false;
  // A whole-side ability does not care that one named slot emptied.
  if (intent.ability.scope === 'all') return true;
  return !!occupant && canTarget(intent.ability, unit, intent.target, s.units);
}

/**
 * Highest-priority usable ability wins; ties break on how much it accomplishes.
 * No dice, no allocation -- deliberately simple so the player can predict it.
 */
function chooseEnemyAction(s: BattleState, unit: Unit, foes: Unit[]): EnemyChoice | null {
  const allies = livingOf(s, unit.side);
  const ordered = [...unit.def.abilities].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  let best: (EnemyChoice & { priority: number; score: number }) | null = null;

  for (const ability of ordered) {
    if ((unit.cooldowns[ability.name] ?? 0) > 0) continue;
    const priority = ability.priority ?? 0;
    if (best && priority < best.priority) break;

    for (const centre of (ability.kind === 'attack' ? foes : allies).map((u) => u.pos)) {
      if (!canTarget(ability, unit, centre, s.units)) continue;
      const score = scoreAction(unit, ability, centre, allies, foes);
      if (score <= 0) continue;
      if (!best || priority > best.priority || score > best.score) {
        best = { ability, target: centre, priority, score };
      }
    }
  }

  return best ? { ability: best.ability, target: best.target } : null;
}

/** Resolve the acting side's whole phase at once. Used for idle auto-battle. */
export function runAiPhase(s: BattleState): void {
  let guard = 0;
  while (nextAiStep(s) && guard++ < 64) {
    /* each call performs exactly one action */
  }
}

function diceIndicesFor(s: BattleState, action: Action): number[] | null {
  const indices: number[] = [];
  for (let i = 0; i < s.dice.length; i++) if (action.diceMask & (1 << i)) indices.push(i);
  return indices.some((i) => s.diceSpent[i]) ? null : indices;
}

export interface BattleResult {
  outcome: Outcome;
  turns: number;
  log: Event[];
  playerSurvivors: number;
  enemySurvivors: number;
}

/**
 * Run a whole battle headlessly with both sides on AI. This is what resolves
 * idle stage clears on the server -- same code, same seed, same result as the
 * client would produce.
 */
export function simulateBattle(
  encounter: EncounterDef,
  playerDefs: CharacterDef[],
  enemyDefs: CharacterDef[],
  seed: number,
): BattleResult {
  const s = createBattle(encounter, playerDefs, enemyDefs, seed);
  let guard = 0;
  while (s.outcome === 'ongoing' && guard++ < MAX_TURNS * 4) {
    runAiPhase(s);
    if (s.outcome === 'ongoing') endPhase(s);
  }
  return {
    outcome: s.outcome,
    turns: s.turn,
    log: s.log,
    playerSurvivors: livingOf(s, 'player').length,
    enemySurvivors: livingOf(s, 'enemy').length,
  };
}
