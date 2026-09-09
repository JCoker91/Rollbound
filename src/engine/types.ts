/**
 * A formation coordinate: `x` is the depth column, `y` the vertical stagger.
 * Defined here rather than in formation.ts because formation.ts needs `Unit`
 * and `Ability` from this file, and the two cannot import each other.
 */
export interface Pos {
  x: number;
  y: number;
}

export type Element = 'fire' | 'wind' | 'earth' | 'water' | 'light' | 'dark';

/**
 * Combat role. Declared rather than inferred from the kit, because it drives the
 * unit's board icon -- at 42px over map art you need to read what a character
 * DOES at a glance, and that matters more than what it looks like.
 */
export type Role = 'blade' | 'shield' | 'staff' | 'dagger' | 'bow' | 'banner';

export const ROLE_LABEL: Record<Role, string> = {
  blade: 'Vanguard',
  shield: 'Bulwark',
  staff: 'Mystic',
  dagger: 'Assassin',
  bow: 'Ranger',
  banner: 'Herald',
};
export type Rarity = 1 | 2 | 3;
export type AbilityKind = 'attack' | 'heal' | 'buff';

/**
 * Cost is paid with a subset of the turn's dice summing to exactly `cost`.
 * A `wildcard` ability instead consumes any single die regardless of value --
 * the release valve for rolls that fit nobody. Keep these rare; simulation
 * showed two wildcards on one team pushes "all 5 act" to 70% and kills the
 * decision of who sits out.
 */
export interface Ability {
  name: string;
  cost: number;
  kind: AbilityKind;
  /**
   * For attacks and heals, a multiplier on the caster's ATK. For buffs, the flat
   * amount added to the target's stat.
   */
  power: number;
  element: Element;
  /**
   * How many enemy RANKS deep this reaches: 1 is the front line only, 2 the
   * front two, and so on. Counted over ranks that still hold someone, so
   * clearing the front line brings the next one into reach rather than locking
   * a melee character out. Ignored by heals and buffs, which always reach the
   * whole party.
   */
  range: number;
  /** Which stat a buff raises. Defaults to attack. */
  stat?: 'attack' | 'defense';
  /**
   * Enemy-only fields. Enemies do not roll dice -- they pick the highest-priority
   * ability that is off cooldown and has a target, which makes them predictable
   * enough to plan around. Ignored on player characters.
   */
  priority?: number;
  /** Turns before this can be used again. 0/undefined means every turn. */
  cooldown?: number;
  /**
   * Turns of wind-up before the ability lands. A telegraphed ability locks its
   * target area in now and resolves at the start of the caster's next phase, so
   * the player gets a full turn to walk out of the marked tiles.
   */
  telegraph?: number;
  /** 0 = single target. Otherwise a radius in formation slots around the target. */
  aoeRadius?: number;
  wildcard?: boolean;
}

/**
 * Always-on effects. Most low-level enemies have none; elites have one and
 * bosses several.
 */
export type Passive =
  | { kind: 'regen'; percent: number }
  | { kind: 'thorns'; percent: number }
  | { kind: 'resilient'; percent: number }
  | { kind: 'frenzy'; percent: number }
  | { kind: 'lifesteal'; percent: number };

/**
 * One pick on a character's star tree.
 *
 * Effects are data rather than prose so the description shown to the player is
 * generated from the same values the engine applies -- a node can never claim
 * something it does not do.
 */
export type StarEffect =
  | { kind: 'stat'; stat: 'maxHp' | 'attack' | 'defense'; percent: number }
  | { kind: 'passive'; passive: Passive }
  | { kind: 'ability'; ability: string; power?: number; range?: number; cost?: number };

export interface StarNode {
  id: string;
  name: string;
  effects: StarEffect[];
}

/**
 * One rung of the tree. Two nodes means a choice that is kept for the rest of
 * the run; one node means the branches converge and everyone takes the same rung.
 */
export interface StarTier {
  nodes: StarNode[];
}

/**
 * A mid-battle upgrade. Bought with dice from the shared pool, it lasts only for
 * the current battle -- this is a way to spend a turn investing in a character
 * rather than a permanent progression system.
 */
/**
 * Static board art for a character.
 *
 * Convention: source art faces RIGHT. The renderer mirrors it when the character
 * moves or attacks leftward, so one image covers both directions.
 *
 * `anchorX` is where the character actually STANDS, as a fraction of the image
 * width -- not simply its middle. An extended weapon drags the image's centre
 * sideways, and centring on that would leave the figure off its tile.
 */
export interface SpriteSheet {
  src: string;
  /** Headshot used in panels, where the full figure is too small to read. */
  icon?: string;
  /** width / height of the trimmed art. */
  aspect: number;
  anchorX: number;
  /**
   * True when the sheet is the style guide's 64px native grid, which the board
   * draws 2-3x larger and so must scale by nearest-neighbour. False for the
   * pre-guide high-resolution sheets, which are drawn SMALLER than their file
   * and need smoothing -- nearest-neighbour downscaling throws pixels away and
   * looks harsh. Set from whether the art has a native grid, never by hand.
   */
  pixelated?: boolean;
  /**
   * The shipped still's own height, in file pixels.
   *
   * Here so the renderer can round a figure to a WHOLE multiple of the art's
   * pixels. Nearest-neighbour only looks right at integer scales: measured side
   * by side, Benjamin at 1x and 2x is razor sharp, while the 1.208x the stage
   * happened to ask for drew some outline segments one pixel wide and others
   * two -- which reads as blur even though nothing was ever interpolated.
   *
   * A real file dimension, NOT the design-canvas measurement that sets stature:
   * rounding has to land on the pixels that actually exist in the PNG.
   */
  pxH?: number;
  /**
   * A packed idle strip: `frames` frames side by side, every one cropped to the
   * same box so only the intended parts move, and looped -- the pack step trims
   * a sheet to whole cycles so it never snaps from the last frame to the first.
   *
   * That box is shared with every OTHER clip the character owns, so it is as
   * tall as their highest jump and as wide as their widest swing. It is not the
   * character: `restFill` is the fraction of it the resting figure fills, and
   * `footPad` how far the feet sit above its bottom. Size by the figure, not
   * the box, or the same character comes out a different height in every clip.
   */
  idle?: {
    src: string;
    frames: number;
    aspect: number;
    /** The strip's own height in file pixels. See `pxH` above -- and note it is
     * not the still's: Maxine's strip is 105px against a 106px still. */
    pxH: number;
    anchorX: number;
    restFill: number;
    footPad: number;
  };
  /** Height on the board as a multiple of one tile. */
  scale: number;
}

export interface Upgrade {
  name: string;
  cost: number;
  passive: Passive;
}

/** Every upgrade adds this much to attack, defense and max HP, cumulatively. */
export const UPGRADE_STAT_BONUS = 0.1;

export interface CharacterDef {
  id: string;
  name: string;
  rarity: Rarity;
  element: Element;
  role: Role;
  maxHp: number;
  attack: number;
  defense: number;
  abilities: Ability[];
  passives?: Passive[];
  /** Player characters only: three tiers, bought in order during a battle. */
  upgrades?: Upgrade[];
  /** Animated board sprite. Falls back to the role badge when absent. */
  sprite?: SpriteSheet;
  /** Five rungs: choice, converge, choice, converge, choice. */
  starTree?: StarTier[];
  /**
   * Creature silhouette to draw instead of the role glyph. Enemies are monsters,
   * not classes -- a sword icon says nothing about a rock golem. Falls back to
   * the role glyph when unset, so a new enemy still renders without art.
   */
  icon?: string;
  /** Bosses get a wider health bar and their telegraphs called out by name. */
  boss?: boolean;
}

export interface Unit {
  def: CharacterDef;
  hp: number;
  /** Additive stat buffs, both decaying each turn. */
  atkBuff: number;
  defBuff: number;
  side: Side;
  /** Fixed for the whole battle -- the slot this character was deployed into. */
  pos: Pos;
  /** Spent by acting, reset at the start of the owner's phase. */
  hasActed: boolean;
  /** How many upgrade tiers this character has bought this battle (0-3). */
  upgrades: number;
  /** Remaining cooldown per ability name; absent means ready. */
  cooldowns: Record<string, number>;
  /** A telegraphed ability that has been announced but has not landed yet. */
  pending: PendingCast | null;
}

export interface PendingCast {
  ability: Ability;
  /** The slot it was aimed at when announced. */
  target: Pos;
  turnsLeft: number;
}

export type Side = 'player' | 'enemy';

export const alive = (u: Unit): boolean => u.hp > 0;
