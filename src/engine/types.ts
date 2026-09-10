/**
 * A formation coordinate: `x` is the depth column, `y` the vertical stagger.
 * Defined here rather than in formation.ts because formation.ts needs `Unit`
 * and `Ability` from this file, and the two cannot import each other.
 */
export interface Pos {
  x: number;
  y: number;
}

export type Element =
  | 'fire'
  | 'wind'
  | 'earth'
  | 'lightning'
  | 'water'
  | 'light'
  | 'dark';

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
/**
 * How rare a Performer is. **3 is the floor, 5 is the ceiling** -- the scale
 * runs 3-5, not 1-3, so a "3-star" in this game is a common starter.
 *
 * It was 1|2|3 with 3 as the RAREST, and the renumbering is a genuine hazard
 * rather than a rename: `rarity: 3` stayed valid while coming to mean the exact
 * opposite, so the compiler could flag every 1 and 2 and silently accept every
 * 3. Each character was re-assigned deliberately, not mapped.
 */
export type Rarity = 3 | 4 | 5;
export type AbilityKind = 'attack' | 'heal' | 'buff';

/**
 * What a hit is mitigated by.
 *
 * `physical` and `magical` read the target's matching defense, so an enemy can
 * be armoured against one and soft to the other. Choosing the type a target is
 * soft to is the first composition axis -- the one that works before you know
 * anything about elements.
 *
 * `true` is mitigated by NOTHING, which is why it has to be priced low rather
 * than balanced. As a full-strength type it would never be wrong, and the
 * never-wrong option is what erases composition decisions. At roughly 55% of a
 * typed ability's power its crossover sits near DEF 80: worse than typed
 * against a mob, even against a bruiser, better only against something armoured
 * on both tracks. That makes it an answer to a specific problem instead of a
 * build.
 */
export type DamageType = 'physical' | 'magical' | 'true';

/**
 * Who an ability reaches. Three shapes, and deliberately only three.
 *
 *   one    a single unit. `range` gates how deep into the enemy line it may be
 *          aimed; support always reaches any ally.
 *   self   the caster, and nothing else. No target to choose.
 *   all    every living unit on the affected side -- the whole enemy line for an
 *          attack, the whole party for a heal or buff. `range` does not apply.
 *
 * This replaced a radius measured in formation slots, where an ability splashed
 * onto its target's NEIGHBOURS. That model asked the player to hold the enemy's
 * grid layout in their head to work out what a blast would catch, and the
 * geometry was fiddly to author against for what it gave back -- the formation
 * is three columns wide, so a radius of 2 already caught nearly everything and
 * the interesting middle ground barely existed. Single, self, or everyone reads
 * at a glance and needs no diagram.
 */
export type TargetScope = 'one' | 'self' | 'all';

/**
 * Cost is paid with a subset of the turn's dice summing to exactly `cost`.
 * A `wildcard` ability instead consumes any single die regardless of value --
 * the release valve for rolls that fit nobody. Keep these rare; simulation
 * showed two wildcards on one team pushes "all 5 act" to 70% and kills the
 * decision of who sits out.
 */
/** Who one effect inside an ability lands on. */
export type EffectTarget =
  /** Whoever the ability was aimed at, honouring its `scope`. */
  | 'target'
  /** The caster, whatever the ability was aimed at. */
  | 'self'
  /** Every living ally of the caster. */
  | 'allies';

/**
 * One thing an ability does.
 *
 * An ability is an ordered LIST of these and resolves them top to bottom,
 * which is the whole answer to "does the self-buff apply before or after the
 * damage": it applies wherever it is written. Abilities are therefore worded
 * in execution order too -- "Gain 20% ATK for 3 turns, then deal damage", not
 * "deal damage and gain 20% ATK". The phrasing and the code agree by
 * construction, and a kit that wants the other behaviour writes the effects
 * the other way round.
 */
export type Effect =
  | { do: 'damage'; power: number; damageType?: DamageType; element?: Element; on?: EffectTarget }
  | { do: 'heal'; power: number; on?: EffectTarget }
  | {
      do: 'modify';
      /** Every stat this moves, by the same percentage. */
      stats: ModStat[];
      /** Positive buffs, negative shreds. */
      percent: number;
      /** What the percentage is of. See `ModSource`. */
      of: ModSource;
      turns: number;
      on?: EffectTarget;
    };

export interface Ability {
  name: string;
  cost: number;
  /**
   * What the ability is FOR, which is how targeting is picked: attacks aim at
   * enemies, heals and buffs at allies. What it actually does is `effects`.
   */
  kind: AbilityKind;
  /**
   * What this does, in order. When present it wholly replaces `power` /
   * `stat`; kits still authored the old way fall back to those.
   */
  effects?: Effect[];
  /**
   * For attacks and heals, a multiplier on the caster's ATK. For buffs, the flat
   * amount added to the target's stat.
   */
  power: number;
  /**
   * What the hit is made of, or absent for no element at all.
   *
   * Absent is NOT a neutral element with a blank matchup table -- it means the
   * elemental system does not apply: no resistance is read, no weakness fires,
   * no matchup label is shown. That is a real design position rather than a
   * gap, and it is what lets a plain physical attacker exist as the baseline
   * a player learns damage and armour on before elements are introduced.
   */
  element?: Element;
  /**
   * Attacks only. Defaults to `physical` rather than being required, because
   * heals and buffs have no damage to type -- but every attack in content sets
   * it explicitly, so nothing relies on the default.
   */
  damageType?: DamageType;
  /**
   * How many enemy RANKS deep this reaches: 1 is the front line only, 2 the
   * front two, and so on. Counted over ranks that still hold someone, so
   * clearing the front line brings the next one into reach rather than locking
   * a melee character out. Ignored by heals and buffs, which always reach the
   * whole party.
   */
  range: number;
  /** Which stat a buff raises. Defaults to attack. */
  /** Which stat a buff raises. `defense` raises BOTH tracks. */
  stat?: 'attack' | 'defense';
  /**
   * Enemy-only. The band of the creature's d20 that selects this ability,
   * inclusive: `[1, 12]` fires on a roll of 1 through 12.
   *
   * A roll rather than a hidden weight, because the roll can be SHOWN. An
   * ability name over a creature's head covered the face of whoever stood
   * behind it; a two-digit number is small enough to sit at its feet. The cost
   * is that a number means nothing until you know the creature's table, which
   * is what the detail panel is for -- click a creature and its whole spread is
   * there with the current roll marked.
   *
   * d20 and not d6: with four abilities a d6 gives 16.7% steps and no way to
   * author "this ultimate fires one time in ten". d20's 5% steps leave room to
   * shape a boss. It is also visibly not the player's die, so there is never a
   * question of whose dice are on screen.
   *
   * Bands are authored, never derived. Gaps are legal and simply cannot come
   * up; overlaps resolve to the FIRST match, so order is meaningful.
   */
  roll?: [number, number];
  /**
   * Enemy-only, legacy. The older selector took the highest-priority usable
   * ability; weighted intent has replaced it. Kept because the current kits are
   * still authored with it and are about to be rebuilt anyway.
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
  /** Who this reaches. Defaults to `one`. */
  scope?: TargetScope;
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

/** Every upgrade adds this much to attack, both defenses and max HP, cumulatively. */
export const UPGRADE_STAT_BONUS = 0.1;

export interface CharacterDef {
  id: string;
  name: string;
  rarity: Rarity;
  role: Role;
  /**
   * How far along this sheet's numbers are: 1.0 at level 1, growing with the
   * level applied to it.
   *
   * Deliberately a SCALE and not a level. The damage formula needs to know the
   * magnitude an attacker's numbers are calibrated to, and phrasing that as a
   * level would put progression back inside combat maths that is meant not to
   * know progression exists (see README §4). A scale is just "how big are these
   * numbers", which is a fact about the sheet.
   */
  powerScale?: number;
  maxHp: number;
  attack: number;
  /**
   * Two mitigation tracks, so a stat block can say "armoured, but soft to
   * magic". A single `defense` could not express that, and it is the difference
   * between an enemy you answer with the right Performer and one you answer
   * with the biggest number.
   */
  physicalDefense: number;
  magicalDefense: number;
  /**
   * Per-element resistance, in percent. Positive takes LESS, negative takes
   * MORE: +20 is a fifth off, -20 is a fifth extra. Unlisted is neutral.
   *
   * This is the ONLY place a unit relates to an element. Nothing "is" a fire
   * creature -- elements belong to damage, not to beings, which is what lets a
   * Performer carry both a fire and a water ability without the sheet having to
   * pick one. `aligned('fire')` in elements.ts produces the familiar wheel
   * spread for the common case.
   */
  resistances?: Partial<Record<Element, number>>;
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
  /**
   * Re-rolls this creature's resistances every round: immune to one element,
   * newly vulnerable to another, revealed before the player plans.
   *
   * The point is to make a single-element team run out of answers. With
   * commit-and-lock a hidden rotation would be a coin flip on the whole turn,
   * so this is chosen and shown at the same moment enemy intent is -- being
   * caught by it is then a planning mistake rather than bad luck.
   */
  rotatesResistance?: { immuneFor: number; weakFor: number };
}

/** A stat a modifier can move. Not max HP -- see `Modifier`. */
export type ModStat = 'attack' | 'physicalDefense' | 'magicalDefense';

/**
 * What a percentage is a percentage OF.
 *
 * Every percentage modifier names its source, because without that rule
 * "+20% then +20%" silently means +44% and the second buff is worth more than
 * the first for no reason a player could predict.
 *
 *   targetBase    the recipient's own unmodified stat -- two 20% buffs give
 *                 40% of base, additive, no compounding
 *   casterCurrent the CASTER's stat including their own live modifiers, so the
 *                 gift is worth whatever the caster is worth
 *
 * `casterCurrent` is a design tool rather than a default: it makes building
 * the caster up the way they help the team, it lets a Performer be buffed and
 * then pass that strength along a turn later, and it ages out on its own once
 * the recipients outscale the caster.
 */
export type ModSource = 'targetBase' | 'casterCurrent';

/**
 * A timed change to one stat.
 *
 * The amount is FLAT and resolved once, when the modifier lands. Storing the
 * number rather than the percentage is what keeps stacking honest, and it
 * makes expiry trivial: remove the number you added.
 *
 * Max HP is deliberately not a `ModStat`. A modifier that moves the HP ceiling
 * has to decide what happens to current HP when it expires, and every answer
 * is a heal, a surprise death, or a special case.
 */
export interface Modifier {
  /**
   * The ability that applied it. Identity for the stacking rule: the same
   * ability recast REFRESHES its own modifier, different abilities STACK as
   * separate entries with separate clocks.
   */
  ability: string;
  stat: ModStat;
  /** Flat, already resolved. Negative for a shred. */
  amount: number;
  /** Turns left, counted down at the End Turn of the side that applied it. */
  turns: number;
  /** Whose End Turn ticks this. */
  by: Side;
}

export interface Unit {
  def: CharacterDef;
  hp: number;
  /**
   * Live stat modifiers, buffs and shreds alike.
   *
   * Replaced a pair of flat `atkBuff` / `defBuff` numbers that decayed 10 a
   * turn. That model could not express a duration, could not tell two sources
   * apart, and applied to both defense tracks at once, so "shred physical
   * defense for 3 turns" was three separate things it could not say.
   */
  modifiers: Modifier[];
  side: Side;
  /** Fixed for the whole battle -- the slot this character was deployed into. */
  pos: Pos;
  /** Spent by acting, reset at the start of the owner's phase. */
  hasActed: boolean;
  /** How many upgrade tiers this character has bought this battle (0-3). */
  upgrades: number;
  /** Remaining cooldown per ability name; absent means ready. */
  cooldowns: Record<string, number>;
  /**
   * Resistance changes applied during the battle, added on top of the sheet's
   * own. Percentages, same sign convention: positive resists.
   *
   * The layer statuses will write into -- "+40% fire resistance for three
   * turns" lands here. Its first user is the False Lead, whose rotating
   * immunity is exactly this with a one-round life.
   */
  resistMods: Partial<Record<Element, number>>;
  /** A telegraphed ability that has been announced but has not landed yet. */
  pending: PendingCast | null;
  /**
   * What this unit will do when its phase comes, decided and shown in advance.
   *
   * Enemies commit to an ability and a target at the start of the round, before
   * the player plans, and the player can see both. That is what turns a turn
   * into a puzzle with a knowable answer instead of a gamble: you can shield the
   * named target, pre-heal them, or race to kill the caster before it lands.
   *
   * Null for player units, who are planned by the player, and for anything with
   * nothing legal to do.
   */
  intent: Intent | null;
}

/** An enemy's declared action for the coming round. */
export interface Intent {
  ability: Ability;
  /** The slot it is aimed at. Shown to the player, not just the ability name. */
  target: Pos;
  /** The d20 that chose it. Displayed; the table it indexes is on the sheet. */
  roll: number;
}

export interface PendingCast {
  ability: Ability;
  /** The slot it was aimed at when announced. */
  target: Pos;
  turnsLeft: number;
}

export type Side = 'player' | 'enemy';

export const alive = (u: Unit): boolean => u.hp > 0;
