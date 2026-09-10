import type { Ability, Pos, Side, Unit } from './types.ts';
import { alive } from './types.ts';

/**
 * Where everyone stands in a side-view battle.
 *
 * This replaces the tile grid. There is no movement, no terrain and no line of
 * sight -- a character occupies one fixed slot for the whole fight, and the only
 * spatial question left is how DEEP into the enemy formation an ability reaches.
 *
 * Every slot carries two coordinate systems, deliberately kept apart:
 *
 *   col/row    formation coordinates, integers, what the RULES use
 *   xPct/yPct  where to draw it on the backdrop, what the RENDERER uses
 *
 * Splitting them means the art can be arranged for perspective -- staggered,
 * foreshortened, nudged to sit on a painted floor -- without the rules caring,
 * and the rules can be reasoned about as a small grid without the art being
 * forced onto one.
 */

export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;

// `manhattan` lived here to measure an AoE radius across formation slots. Target
// scope is now one / self / all, so no ability measures a distance any more and
// the formation's only remaining spatial question is depth (`columnRank`).

export interface Slot {
  /** Depth column. Party occupies the low columns, enemies the high ones. */
  col: number;
  /** Vertical stagger within the formation. */
  row: number;
  /** Draw position on the backdrop, 0-1 of its width/height. */
  xPct: number;
  yPct: number;
}

export interface EncounterDef {
  name: string;
  /**
   * What level this encounter's enemies are fielded at. Defaults to 1.
   *
   * This is the difficulty dial for an idle game, and it is deliberately the
   * ONLY one for a re-used encounter: the same five creatures at level 30 are a
   * wall the same five at level 1 are not, and authoring thirty distinct
   * bestiaries to say the same thing would be work with no design in it.
   * Enemies with genuinely different BEHAVIOUR still earn their own defs.
   */
  enemyLevel?: number;
  /** Backdrop image, drawn behind both formations. */
  background: string;
  /** Five, in roster order. */
  partySlots: Slot[];
  /** Up to seven, filled in the order enemies are supplied. */
  enemySlots: Slot[];
}

export const slotPos = (s: Slot): Pos => ({ x: s.col, y: s.row });

/**
 * Columns on `side` that still hold someone alive, nearest-enemy-first.
 *
 * "Front" is a direction, not a number: the party sits at low columns and the
 * enemy at high ones, so each side's front line is the end of its range that
 * faces the other.
 */
export function occupiedColumns(units: Unit[], side: Side): number[] {
  const cols = [...new Set(units.filter((u) => alive(u) && u.side === side).map((u) => u.pos.x))];
  return cols.sort((a, b) => (side === 'enemy' ? a - b : b - a));
}

/**
 * How deep a column sits in its formation: 1 for the front line, 2 for the rank
 * behind it, and so on. Returns Infinity for a column with nobody left in it.
 *
 * Counting only OCCUPIED columns is what stops a melee character being locked
 * out of the fight. Clear the front rank and the rank behind becomes the front
 * -- so "range 1" always means "whatever I can currently see the face of",
 * never "a column index that may now be empty".
 */
export function columnRank(col: number, units: Unit[], side: Side): number {
  const i = occupiedColumns(units, side).indexOf(col);
  return i < 0 ? Infinity : i + 1;
}

/**
 * Can `from` aim this ability at `target`?
 *
 * `range` is depth: how many enemy ranks in it can reach. This is what makes a
 * formation worth arranging -- a boss behind two ranks of adds cannot be touched
 * by a melee basic until the adds are gone, which is the whole point of putting
 * it there.
 *
 * Support is exempt. The party is two columns deep and gating heals on depth
 * would add fiddle without adding a decision.
 */
export function withinReach(ability: Ability, from: Unit, target: Pos, units: Unit[]): boolean {
  if (ability.kind !== 'attack') return true;
  const foes: Side = from.side === 'player' ? 'enemy' : 'player';
  return columnRank(target.x, units, foes) <= ability.range;
}

/**
 * The standard 5-versus-7 layout.
 *
 * Formation coordinates are packed TIGHT -- neighbouring slots are one apart --
 * while the draw positions are spread out for perspective. That separation is
 * the point: a first pass staggered the rules grid to match the art, every slot
 * ended up 2 apart, and a radius-1 AoE could only ever hit its own target. War
 * Cry and Hallowed Grove fell to 0.1% usage in simulation.
 *
 *   rules                          art
 *   col 0  1     2  3  4           ·         ·      ·
 *      ·   ·     ·  ·  ·        ·     ·   ·     ·      ·
 *      ·   ·     ·  ·  ·           ·         ·      ·
 *          ·        ·
 *
 * Party is two ranks (3 front, 2 back), enemies three (2 / 3 / 2). Radius 1
 * catches a target and its immediate neighbours; radius 2 reaches most of a
 * formation, so it belongs only on the biggest abilities.
 */
const slot = (col: number, row: number, xPct: number, yPct: number): Slot => ({ col, row, xPct, yPct });

export const STANDARD_PARTY_SLOTS: Slot[] = [
  slot(1, 0, 0.36, 0.62),
  slot(0, 0, 0.20, 0.67),
  slot(1, 1, 0.34, 0.73),
  slot(0, 1, 0.18, 0.79),
  slot(1, 2, 0.32, 0.85),
];

/**
 * A boss and its retinue: a two-creature guard line, the boss alone behind it.
 *
 * Order matters -- enemies fill slots in the order they are supplied -- so the
 * boss must be supplied LAST to land in the back rank.
 *
 * Putting it there is not just staging. `range` counts occupied enemy columns,
 * so a boss behind two live ranks is out of reach of every melee ability until
 * the retinue is cleared. The guards therefore sit in DIFFERENT columns: two
 * abreast would collapse the formation to two ranks and put the boss inside
 * melee reach from the opening turn.
 *
 * Two guards and not five. The gate was the boss's own bulk PLUS a level bump
 * PLUS a full second encounter stapled to the front of it, and three stacked
 * multipliers is what made stage 10 a fifteen-level wall rather than a fight.
 * Cutting the retinue is the one of the three that costs the boss nothing --
 * it keeps every point of its HP and every degree of its rotation, and what it
 * loses is a crowd that was never the interesting part.
 */
export const BOSS_ENEMY_SLOTS: Slot[] = [
  slot(2, 0, 0.60, 0.66),
  slot(3, 2, 0.70, 0.90),
  // The back rank holds TWO slots (y 0.66 and 0.78), not three, so there is no
  // middle row for a boss to stand in. It goes between them instead: x centred
  // on the pair, y on the lower one's floor line, so it is planted on the same
  // ground its retinue stands on and towers up from there. Placing it at the
  // midpoint y left it floating -- a sprite hangs UPWARD from its feet, and at
  // 2.4x a Performer that half-slot of air is very visible.
  slot(4, 1, 0.90, 0.80),
];

export const STANDARD_ENEMY_SLOTS: Slot[] = [
  // Front rank first, so a small encounter forms a line facing the party and a
  // boss supplied last ends up at the back behind its own adds.
  //
  // Spread wider than the party's, because the enemy block holds up to seven
  // against five and the stage lost a third of its height to the dock -- the
  // sprites did not shrink with it, so the same percentages that read as a
  // formation on a full-height stage read as a pile on this one.
  //
  // The front rank sits at 0.58+ rather than hard against the party. Widening
  // the block earlier pushed it left until the two sides looked interlocked
  // instead of facing each other across a stage; the space between them is
  // what makes the formation read as two formations.
  slot(2, 0, 0.60, 0.64),
  slot(2, 1, 0.58, 0.82),
  slot(3, 0, 0.75, 0.60),
  slot(3, 1, 0.73, 0.74),
  slot(3, 2, 0.71, 0.90),
  slot(4, 0, 0.90, 0.64),
  slot(4, 1, 0.88, 0.80),
];
