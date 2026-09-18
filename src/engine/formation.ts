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

/** Continuous motion for a stage piece. See `StageLayer.motion`. */
export interface StageMotion {
  /** Seconds for one crossing. */
  seconds: number;
  /** How far it travels horizontally, in percent of the stage. 0 stays put. */
  travel?: number;
  /** Vertical bob, in percent of the stage. */
  bob?: number;
  /** Seconds for one bob. Independent of the crossing, on purpose. */
  bobSeconds?: number;
  /** Gentle tilt as it moves, in degrees. */
  sway?: number;
  /** Seconds to wait before starting, so two copies do not fly in lockstep. */
  delay?: number;
}

/** One piece of a layered stage. See `EncounterDef.layers`. */
export interface StageLayer {
  src: string;
  /** 0 = painted back wall, 1 = nearest the audience. Drives drift and order. */
  depth: number;
  /** Left edge, percent of the stage. Omit to fill the whole width. */
  x?: number;
  /** Top edge, percent. Omit with `bottom` to pin to the floor instead. */
  y?: number;
  bottom?: number;
  right?: number;
  /** Height as a percent of the stage. Omit to fill. */
  h?: number;
  /**
   * Width as a percent of the stage, INDEPENDENT of `h`.
   *
   * Omitted means the aspect ratio is kept, which is what a prop wants. Set it
   * and the piece stretches -- a hedge widened to run the length of the stage,
   * a backdrop squashed to fit a shallower set. Deliberately separate from `h`
   * rather than a single `scale`, because the two are different decisions: how
   * big a thing is, and whether it has been pulled out of shape.
   */
  w?: number;
  /** Mirrored horizontally, for a piece used on both sides. */
  flip?: boolean;
  /**
   * Drawn IN FRONT of the Performers rather than behind them.
   *
   * The actors are not the top of the stack -- a curtain leg hangs between the
   * audience and the boards, and anyone who walks behind it is hidden. Without
   * this every piece would have to be scenery, which is the same as saying the
   * stage has no front.
   */
  front?: boolean;
  /**
   * Cast a drop shadow, so the piece reads as a cutout standing in front of
   * what is behind it rather than as paint on the same surface.
   *
   * Scaled by `depth` at render time: a prop near the audience throws a longer,
   * softer shadow than one against the back cloth. That is the whole trick for
   * selling depth in a flat scene -- the parallax says the layers are apart,
   * and the shadows say which way round.
   */
  shadow?: boolean;
  /**
   * Continuous motion, for a piece that is never still -- a bird crossing the
   * stage, a cloud drifting, a banner swinging.
   *
   * Composed from two INDEPENDENT loops rather than one authored path: a
   * horizontal pass and a vertical bob, on their own clocks. That is what makes
   * a bird read as flying rather than as a sprite sliding along a line -- the
   * two cycles drift against each other, so no two passes look identical, and
   * it needs no keyframes generated per prop.
   */
  motion?: StageMotion;
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
  /**
   * A layered stage, drawn back to front INSTEAD of the flat `background`.
   *
   * The flat image stays the fallback and the default: one painting is the
   * right answer for a backdrop nothing moves in front of. Layers exist for a
   * stage whose props are meant to read as props -- cutouts on stands with a
   * gap between them and the painted cloth behind, which is what the theatre
   * this game is set in would actually build.
   *
   * `depth` drives the ambient drift: 0 is the painted back wall and does not
   * move, 1 is the closest thing to the audience. Positions are percentages of
   * the stage so a layer set survives any render size.
   */
  layers?: StageLayer[];
  /**
   * Id of a scene authored in the stage lab (`art/scenes/<id>.json`).
   *
   * Takes precedence over `layers`, which stays as the in-source fallback: a
   * scene the lab has never touched still renders, and one it has is not stuck
   * behind a code edit.
   */
  scene?: string;
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
 * Both sides are now THREE ranks. The party's used to be two, which made
 * "front rank" a near-formality: with five bodies over two columns, most of the
 * party was in front of something. Three ranks gives a real front, middle and
 * back, and it is what lets an enemy ability read "hit the front row" and mean
 * something a player can arrange against.
 *
 * `withinReach` was already symmetric -- it computes the defender's side and
 * counts *their* occupied ranks -- so an enemy's `range: 1` has always been
 * "the party's frontmost occupied rank". The mechanic existed and had nothing
 * to bite on.
 *
 * The party's front is its HIGHEST column (nearest the enemy line), and the
 * enemy's front is its lowest; `occupiedColumns` sorts each accordingly.
 *
 * **The two sides' columns must never overlap.** Party holds 0-2, enemies 3-5.
 * An earlier pass gave the party a third rank at column 2 -- the enemy's front
 * -- on the reasoning that reach is always asked about one side at a time. That
 * is true of reach and false of `unitAt`, which finds a unit by position alone:
 * an intent naming a front-rank Performer found the enemy standing at the same
 * coordinates, decided the target was still alive, and resolved the attack into
 * a slot holding no living player. Five enemies whiffed an entire round.
 * `targetStillLegal` now also checks the side, so the invariant is enforced
 * where it matters rather than only maintained by convention.
 */
const slot = (col: number, row: number, xPct: number, yPct: number): Slot => ({ col, row, xPct, yPct });

/*
 * Listed in FILL order, not in reading order, because units take slots in the
 * order they are supplied: front, front, middle, middle, back, back. A party of
 * five or six therefore spreads across all three ranks by default instead of
 * piling into the front two and leaving the back decorative.
 *
 * Which Performer lands where is the party's own order, so arranging the
 * formation is exactly the "choose which five perform, and in what order"
 * roadmap item -- the mechanic is here, the screen to drive it is not.
 */
/*
 * THE PARTY IS A 2-1-2 -- five slots for five Performers.
 *
 * Columns are rank, and always were: `withinReach` counts the defender's
 * occupied columns, so column 2 is whoever the enemy's `range: 1` can touch.
 * Rows are mechanical too -- `scope: 'row'` and `scope: 'column'` cut the
 * formation along either axis -- so how the party is spread decides how much of
 * it one attack catches. Columns ask "who can reach me", rows ask "how many of
 * us does this catch", and the tension between them is the formation puzzle.
 *
 * It was a 3x3 with four slots empty, and the argument for the empty slots was
 * that repositioning needs somewhere to go. That stopped being true when
 * repositioning became a SWAP with any slot on the board: a full formation is
 * navigable now because you trade places rather than step into a gap. What the
 * spare slots were actually buying was a front rank with three positions, and
 * nothing ever wants three Performers in front -- so they were four squares of
 * board that existed to make a rule work that no longer needs them.
 *
 * Two, one, two. It is the shape the party already plays as: a pair holding the
 * line, a pair behind them, and one in the middle who can be reached by things
 * that reach past the front without being exposed to everything.
 *
 * Rows 0 and 2 for the pairs, 1 for the centre, so the three horizontal lines
 * still mean something: `row` 0 and `row` 2 each catch a front and a back
 * Performer, and `row` 1 catches the one in the middle. A pair sharing rows 0
 * and 1 would have left row 2 empty and made one of the three cuts free.
 */
export const PARTY_GRID_COLS = 3;

/*
 * Five draw positions, unchanged from the nine they were chosen out of.
 *
 * Rows are held between 0.57 and 0.83 of the stage: the painted floor ends
 * around 0.88 where the footlights sit, and a slot on the lip puts a Performer
 * half into the curtain.
 *
 * `x` drifts left as `y` grows so each rank reads as a shallow arc rather than
 * a column, which is what keeps the formation looking staged instead of
 * tabulated.
 */
export const PARTY_SLOTS_ALL: Slot[] = [
  // front (col 2) -- nearest the enemy line
  slot(2, 0, 0.415, 0.665),
  slot(2, 2, 0.355, 0.825),
  // middle (col 1) -- one slot, the centre
  slot(1, 1, 0.305, 0.735),
  // back (col 0)
  slot(0, 0, 0.255, 0.645),
  slot(0, 2, 0.195, 0.805),
];

/** One slot by grid coordinate, for the renderer's empty-slot markers. */
export const partySlotAt = (col: number, row: number): Slot | undefined =>
  PARTY_SLOTS_ALL.find((s) => s.col === col && s.row === row);

/**
 * Every slot a side's board has, occupied or not.
 *
 * The party's is all five because a Performer can be repositioned into any of
 * them. The enemy block is whatever the encounter deployed into and is not a
 * grid -- enemies do not move, so nothing needs to name a slot they are not
 * standing in. It is derived from the encounter rather than listed here for
 * exactly that reason: a boss layout is a different shape from a corridor one.
 */
export const slotsOf = (side: Side): Slot[] => (side === 'player' ? PARTY_SLOTS_ALL : []);

/*
 * Listed in FILL order, not in reading order, because units take slots in the
 * order they are supplied. The default spread is the middle row of all three
 * ranks plus the two front corners -- a formation that is reasonable rather
 * than optimal, since improving it is the player's job and a starting position
 * with nothing wrong with it gives the mechanic nothing to do.
 *
 * Which Performer lands where is the party's own order, so arranging the
 * formation is exactly the "choose which five perform, and in what order"
 * roadmap item -- the mechanic is here, the screen to drive it is not. In
 * battle they can now be moved instead, which is the stopgap for that screen.
 */
export const STANDARD_PARTY_SLOTS: Slot[] = [
  partySlotAt(2, 0)!, // front, top
  partySlotAt(2, 2)!, // front, bottom
  partySlotAt(1, 1)!, // middle
  partySlotAt(0, 0)!, // back, top
  partySlotAt(0, 2)!, // back, bottom
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
  slot(3, 0, 0.60, 0.66),
  slot(4, 2, 0.70, 0.9),
  // The back rank holds TWO slots (y 0.66 and 0.78), not three, so there is no
  // middle row for a boss to stand in. It goes between them instead: x centred
  // on the pair, y on the lower one's floor line, so it is planted on the same
  // ground its retinue stands on and towers up from there. Placing it at the
  // midpoint y left it floating -- a sprite hangs UPWARD from its feet, and at
  // 2.4x a Performer that half-slot of air is very visible.
  slot(5, 1, 0.90, 0.8),
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
  slot(3, 0, 0.595, 0.745),
  slot(3, 1, 0.575, 0.825),
  slot(4, 0, 0.685, 0.705),
  slot(4, 1, 0.665, 0.785),
  slot(4, 2, 0.645, 0.845),
  slot(5, 0, 0.765, 0.665),
  slot(5, 1, 0.745, 0.755),
];

/**
 * Where a Performer steps to when they take their turn -- CENTRE STAGE, not the
 * front corner of their own block.
 *
 * It used to be derived from the party's own extents, which put it at the front
 * edge of the formation: technically forward, but reading as a character taking
 * half a step into the person in front of them rather than walking out to
 * perform. The two sides face each other across the middle of the boards, so
 * that middle is where the acting happens.
 *
 * Each side steps ACROSS the middle, toward the other.
 *
 * They used to stop just short of it -- the party's mark at 0.465 and the
 * enemy's at 0.535 -- which kept each one inside its own half. With the party
 * standing around x 0.26-0.42 and the enemy block at 0.59-0.70, that read as a
 * Performer shuffling a little way out of formation rather than crossing the
 * boards to reach somebody. Going past centre puts them next to what they are
 * acting on, which is the point of stepping out at all.
 *
 * Still offset from each other so the two sides never occupy the same mark, and
 * still held back from the footlights: a figure at the very front of a stage is
 * cropped by the apron and stands in front of its own shadow.
 */
export const DOWNSTAGE: Record<Side, { x: number; y: number }> = {
  player: { x: 0.545, y: 0.80 },
  enemy: { x: 0.455, y: 0.80 },
};
