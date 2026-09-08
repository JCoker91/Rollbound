import type { Ability, CharacterDef, Side, Unit } from './types.ts';
import { alive } from './types.ts';
import { Rng } from './rng.ts';
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
  BUFF_DECAY_PER_TURN,
} from './combat.ts';
import { matchupLabel } from './elements.ts';
import { slotPos, type EncounterDef, type Slot } from './formation.ts';
import type { Pos } from './types.ts';

export const DICE_PER_TURN = 5;
// No approach phase any more -- everyone is in range from turn one -- but a cap
// still has to exist so a stalemate cannot run forever.
export const MAX_TURNS = 40;

export type Outcome = 'ongoing' | 'victory' | 'defeat' | 'draw';

export type Event =
  | { t: 'roll'; side: Side; turn: number; dice: number[] }
  | { t: 'act'; side: Side; actor: string; ability: string; dice: number[] }
  | { t: 'damage'; target: string; amount: number; matchup: string; hpAfter: number }
  | { t: 'heal'; target: string; amount: number; hpAfter: number }
  | { t: 'buff'; target: string; amount: number; stat: 'attack' | 'defense' }
  | { t: 'ko'; unit: string }
  | { t: 'telegraph'; unit: string; ability: string; at: Pos }
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
      atkBuff: 0,
      defBuff: 0,
      side,
      pos: slotPos(slots[i] ?? slots[slots.length - 1]!),
      hasActed: false,
      upgrades: 0,
      cooldowns: {},
      pending: null,
    }));

  const state: BattleState = {
    encounter,
    units: [
      ...mk(playerDefs, 'player', encounter.partySlots),
      ...mk(enemyDefs, 'enemy', encounter.enemySlots),
    ],
    turn: 1,
    phase: 'player',
    dice: [],
    diceSpent: [],
    log: [],
    outcome: 'ongoing',
    rng: new Rng(seed),
    ai: null,
  };
  beginPhase(state);
  return state;
}

function beginPhase(s: BattleState): void {
  for (const u of teamOf(s, s.phase)) {
    u.hasActed = false;
    if (u.atkBuff > 0) u.atkBuff = Math.max(0, u.atkBuff - BUFF_DECAY_PER_TURN);
    if (u.defBuff > 0) u.defBuff = Math.max(0, u.defBuff - BUFF_DECAY_PER_TURN);

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
  s.dice = s.rng.roll(DICE_PER_TURN);
  s.diceSpent = s.dice.map(() => false);
  s.log.push({ t: 'roll', side: s.phase, turn: s.turn, dice: [...s.dice] });
}

/** Indices of dice not yet spent this phase. */
export const availableDice = (s: BattleState): number[] =>
  s.dice.map((_, i) => i).filter((i) => !s.diceSpent[i]);

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

function applyAbility(s: BattleState, source: Unit, ability: Ability, centre: Pos): void {
  const allies = livingOf(s, source.side);
  const foes = livingOf(s, source.side === 'player' ? 'enemy' : 'player');

  switch (ability.kind) {
    case 'attack': {
      for (const target of unitsHit(ability, centre, foes)) {
        const dmg = computeDamage(source, ability, target);
        target.hp = Math.max(0, target.hp - dmg);
        s.log.push({
          t: 'damage',
          target: target.def.name,
          amount: dmg,
          matchup: matchupLabel(ability.element, target.def.element),
          hpAfter: target.hp,
        });
        if (target.hp === 0) s.log.push({ t: 'ko', unit: target.def.name });

        const drain = lifestealHeal(source, dmg);
        if (drain > 0 && alive(source)) {
          const room = unitMaxHp(source) - source.hp;
          const gained = Math.min(drain, room);
          if (gained > 0) {
            source.hp += gained;
            s.log.push({ t: 'heal', target: source.def.name, amount: gained, hpAfter: source.hp });
          }
        }

        const reflected = thornsDamage(target, ability, dmg);
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
      const stat = ability.stat ?? 'attack';
      for (const target of unitsHit(ability, centre, allies)) {
        if (stat === 'defense') target.defBuff += ability.power;
        else target.atkBuff += ability.power;
        s.log.push({ t: 'buff', target: target.def.name, amount: ability.power, stat });
      }
      break;
    }
  }
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
  s.phase = 'enemy';
  beginPhase(s);
}

/** Hand control back to the player once the enemy phase has played out. */
export function finishEnemyPhase(s: BattleState): void {
  if (s.outcome !== 'ongoing' || s.phase !== 'enemy') return;
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
    const choice = chooseEnemyAction(s, u, foes);
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
