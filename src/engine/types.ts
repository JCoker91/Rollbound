import type { Pos } from './grid.ts';

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
  /** Max manhattan distance from the caster to the target tile. */
  range: number;
  /**
   * Min distance, for weapons that cannot be used point-blank. An archer with
   * minRange 2 has to keep its distance, which is what makes closing on one a
   * real play rather than a formality.
   */
  minRange?: number;
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
  /**
   * Extra movement this ability carries, spent immediately before it resolves.
   * Stacks on top of the character's normal move and works even after it has
   * already moved this turn -- a gap-closer should still close a gap late in a
   * turn. Like any move, it cannot pass through impassable terrain.
   */
  dash?: number;
  /** 0 = single target. Otherwise a manhattan diamond around the target tile. */
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
  | { kind: 'lifesteal'; percent: number }
  | { kind: 'swift'; percent: number };

/**
 * One pick on a character's star tree.
 *
 * Effects are data rather than prose so the description shown to the player is
 * generated from the same values the engine applies -- a node can never claim
 * something it does not do.
 */
export type StarEffect =
  | { kind: 'stat'; stat: 'maxHp' | 'attack' | 'defense'; percent: number }
  | { kind: 'move'; tiles: number }
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
  /** Movement budget in terrain cost, spent freely each turn -- never costs dice. */
  move: number;
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
  pos: Pos;
  /**
   * A character may reposition once per turn WITHOUT ending its turn, and can
   * still use an ability afterwards -- a bad roll should never also cost you the
   * ability to walk. Using an ability, by contrast, ends the character's turn
   * outright: it spends the action and forfeits any unused movement.
   * Both reset at the start of the owner's phase.
   */
  hasMoved: boolean;
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
  /** Locked in when announced, so walking out of it actually works. */
  target: Pos;
  turnsLeft: number;
}

export type Side = 'player' | 'enemy';

export const alive = (u: Unit): boolean => u.hp > 0;
