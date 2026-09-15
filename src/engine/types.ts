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
  /** Add frost stacks, freezing if they reach the threshold. */
  | { do: 'frost'; stacks: number; on?: EffectTarget }
  /** Put the target to sleep until something damages them. */
  | { do: 'sleep'; on?: EffectTarget }
  /**
   * Shift the target one or more ranks.
   *
   * Positive moves toward the enemy, negative away. Deliberately relative and
   * self-or-ally aimed rather than picking a destination slot: that needs no
   * empty-slot targeting in the UI, and it keeps movement a thing a kit does
   * rather than a thing everyone has. A rank already holding somebody is
   * SWAPPED with, so the move always resolves.
   */
  | { do: 'move'; ranks: number; on?: EffectTarget }
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
      /** See `Modifier.riposte`. Rides along onto the modifier this creates. */
      riposte?: { damageType: DamageType; frost: number };
    }
  | {
      /** Timed elemental resistance, in percentage points. Writes `resistMods`. */
      do: 'resist';
      element: Element;
      percent: number;
      turns: number;
      on?: EffectTarget;
    };

/**
 * A chain symbol.
 *
 * Deliberately ORTHOGONAL to element, weapon and role: not every blade shares
 * one, not every fire ability shares one. Scattered across the roster so that
 * finding which Performers combine is its own kind of discovery, and so that
 * the composition axis it creates pulls in a different direction from the cost
 * spread (BATTLE_DESIGN.md §4).
 *
 * Ten of them, two per character. Measured against a random five-Performer
 * team: one symbol each leaves 36% of teams unable to chain at all, three makes
 * chains automatic at ~5 live options, and two lands on 2-3 -- reliably
 * available, never free, and a real choice of which to run.
 *
 * The names mean nothing on purpose. A symbol called `flame` would be read as
 * the fire symbol and quietly re-couple the axis to elements.
 */
export type ChainSymbol =
  | 'crescent'
  | 'ember'
  | 'thorn'
  | 'tide'
  | 'anvil'
  | 'lantern'
  | 'veil'
  | 'spiral'
  | 'crown'
  | 'quill';

/**
 * What an ability does EXTRA when it chains.
 *
 * The trigger belongs to the ability doing the chaining, never to the symbol.
 * That is the mechanic's most important structural decision: the same symbol
 * does different things depending on who chains it, so the question stops being
 * "do I have the symbol" and becomes "whose trigger do I want to fire".
 * Symbol-owns-the-effect would collapse into a lookup table.
 *
 * Three shapes, because the design's own examples need all three and no more:
 *
 * - `effects` APPENDS -- "deal an additional 30% of ATK", "heal self 20%".
 * - `retarget` REDIRECTS -- "buff the whole team instead of one ally".
 * - `amplify` DEEPENS an existing modifier -- "shred by an additional amount".
 *
 * `amplify` cannot be expressed as an appended `modify`, which is why it is its
 * own field rather than sugar: modifiers are keyed by ability name, so a second
 * modify from the same ability REFRESHES the first instead of stacking with it
 * (see `applyModifier`). Appending would silently overwrite the shred with the
 * bonus rather than adding to it.
 */
export interface ChainTrigger {
  /** Player-facing text. Written as the clause it adds, not a sentence. */
  text: string;
  /** Extra effects, appended after the ability's own and resolved in order. */
  effects?: Effect[];
  /** Send every effect aimed at `target` somewhere else instead. */
  retarget?: EffectTarget;
  /**
   * Added to the `percent` of every `modify` effect, WITH ITS SIGN. A shred of
   * -25 amplified by -10 becomes -35; writing +10 there would weaken it.
   */
  amplify?: number;
}

export interface Ability {
  name: string;
  /**
   * Paid with a subset of the turn's dice summing to EXACTLY this. A
   * `wildcard` ability ignores it and consumes any single die instead.
   *
   * **Every Performer carries exactly one wildcard "basic".** That is the
   * design, not an exception to be kept rare: it means no roll is ever dead
   * and every character can always do something.
   *
   * The tension it leaves is not *whether* you act, it is **breadth against
   * power**. Five basics means all five act and none of them hit hard. One
   * expensive ability eats two or three dice and benches a teammate to pay for
   * it. The identity is exact:
   *
   *     characters acting = pool size − Σ (dice each ability uses − 1)
   *
   * so every die an ability consumes beyond its first is one teammate who does
   * not act. Choosing to spend that is the turn's real decision.
   */
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
   * The chain symbol this ability carries, if any. Resolving it ARMS the symbol
   * for the rest of the round; a later ability sharing it fires that ability's
   * own `trigger`.
   */
  symbol?: ChainSymbol;
  /**
   * What this ability does extra when it chains -- that is, when its symbol was
   * already armed by something resolved earlier this round.
   *
   * An ability can carry a symbol with no trigger (it only ever arms for
   * others) or a trigger with no symbol (dead weight, and a content bug).
   */
  trigger?: ChainTrigger;
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
/**
 * A kind of die: the faces it can show.
 *
 * A face of **0 is a blank** -- the die rolled nothing and cannot be spent at
 * all this turn. That is the only lever that genuinely weakens a die in this
 * game, and it is worth saying why: a wildcard costs "any single die, whatever
 * its value", so a `1` buys an action exactly as well as a `6`. Lowering a
 * die's faces therefore does NOT make it weaker -- measured over all 7776 rolls
 * of 5d6, adding a d3 beats adding a true d6 at every cost from 1 to 12,
 * because small dice are precision tools for hitting exact sums. Blanks are
 * what move the number of dice a turn actually has.
 */
export interface DieSpec {
  id: string;
  /** Every face, including blanks as `0`. Length is the die's side count. */
  faces: number[];
  /** Shown on the die's tooltip. */
  label: string;
}

/**
 * One die in this turn's pool.
 *
 * An object rather than a number, and identified by `id` rather than by its
 * position, because the pool is MUTABLE: abilities can add dice, remove them,
 * or change what one is showing, and anything holding an index into the pool
 * breaks the first time one of those happens. Queued actions and the tray's
 * selection both name dice by id for that reason.
 */
export interface Die {
  /** Unique within the pool for as long as the pool lives. */
  id: string;
  spec: DieSpec;
  /** The face showing right now. 0 is a blank and can never be spent. */
  value: number;
  /**
   * The face it landed on, before anything altered it.
   *
   * Kept so the tray can say a die has been CHANGED rather than silently
   * showing a different number -- an ability that doubles a die is only
   * legible if the original is still visible.
   */
  rolled: number;
  /** Promised to a queued action, or already spent by a resolved one. */
  spent: boolean;
  /** Character who contributed it; absent for the party's own standard dice. */
  source?: string;
}

export type Passive = {
  /**
   * What the player calls it. Innate passives always have one -- it is how a
   * Performer's intent is stated on their sheet, where `kind` would only say
   * "resilient" for every durable character in the game.
   *
   * Optional because a passive granted by an UPGRADE is already named by the
   * tier that granted it, and repeating that name beside it reads as two
   * different things (see README, the `Herbalist` / `regen` duplication).
   */
  name?: string;
} & (
  | { kind: 'regen'; percent: number }
  | { kind: 'thorns'; percent: number }
  | { kind: 'resilient'; percent: number }
  | { kind: 'frenzy'; percent: number }
  | { kind: 'lifesteal'; percent: number }
  /**
   * Puts an extra die in the shared pool while this character is alive.
   *
   * The first passive that is not a number applied to its owner, and the reason
   * the union needed widening: every other kind is a self-buff, which cannot
   * express a Performer whose whole intent is that the TROUPE does more. See
   * `ladder` for how it grows.
   */
  | { kind: 'extraDie'; die: DieSpec; ladder?: DieSpec[] }
);

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
   * What one pixel of the SHARED 128px canvas is worth in this art, in the
   * art's own pixels -- so the renderer can snap a figure to whole multiples of
   * it. `pxH` for art drawn on 128, `pxH / 2` for art drawn on 256.
   *
   * Separate from `pxH` because the two answer different questions: `pxH` is
   * how tall the file is, `snapPx` is how big a step in it counts as clean.
   */
  snapPx?: number;
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
  /**
   * Damage this creature deals grows every turn once the fight runs long.
   *
   * A soft enrage, and the structural answer to a stall. Mitigation is a
   * FRACTION of incoming damage, so it scales with the ramp and can never
   * cancel it; healing is a FLAT amount per cast, so a growing damage source
   * beats it outright. That is the exact hole a previous balance pass fell
   * into -- flat enemy damage is always healable, and one Sanctuary cancelled
   * five creatures for two dice -- pointing the other way.
   *
   * LINEAR, not compounding: `1 + percent/100 * (turn - after)`. Compounding
   * 5% is x2.65 by turn 20 and x7 by turn 40, which stops being an anti-stall
   * and becomes a difficulty setting. Linear 5% is the x2-at-twenty-turns the
   * mechanic was asked for.
   *
   * `after` is what keeps it honest. An intended boss fight runs ~14 turns, so
   * a ramp starting at turn 1 makes the NORMAL fight 65% harder -- a tuning
   * change dressed up as a mechanic. Starting it at 10 leaves the intended
   * fight at x1.2 and puts the staller at x2.0 by turn 30.
   */
  ramp?: { percent: number; after: number };
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
/**
 * What a modifier can move: a stat, or resistance to one element.
 *
 * The two share the list rather than living in parallel structures because
 * they want identical behaviour -- refresh within an ability, stack across
 * abilities, expire at End Turn. `ModStat` and `Element` are disjoint string
 * unions, so one keyed lookup serves both and none of the duration machinery
 * had to be written twice.
 */
export type ModKey = ModStat | Element;

export interface Modifier {
  /**
   * The ability that applied it. Identity for the stacking rule: the same
   * ability recast REFRESHES its own modifier, different abilities STACK as
   * separate entries with separate clocks.
   */
  ability: string;
  stat: ModKey;
  /**
   * Flat, already resolved. Negative for a shred.
   *
   * For an element key this is percentage POINTS of resistance rather than a
   * stat amount -- the one place the two uses differ, and `resolveModifier` is
   * not consulted for them because a resistance percentage is already absolute.
   */
  amount: number;
  /** Turns left, counted down at the End Turn of the side that applied it. */
  turns: number;
  /**
   * Frost the attacker when the holder takes damage of this type.
   *
   * Carried on the MODIFIER rather than checked by ability name, so it expires
   * with the buff that granted it and no code anywhere has to know the string
   * "Frost Armor". Deliberately narrow -- one reactive shape, not a general
   * effect list -- because a general one needs an ability context to resolve
   * against and there is exactly one user.
   */
  riposte?: { damageType: DamageType; frost: number };
  /** Whose End Turn ticks this. */
  by: Side;
}

/**
 * How many frost stacks the FIRST freeze costs, and how much dearer each one
 * after it gets.
 *
 * Uniform across every creature rather than a per-enemy resistance: a boss is
 * as easy to freeze as a mob the first time and progressively harder after,
 * which puts the escalation in the fight's shape instead of in a stat block.
 * Stacks are CONSUMED on freezing, and that is what makes the rising bar an
 * escalation at all -- leaving them on the target would mean every freeze
 * after the first cost the same three, and the curve would be decorative.
 */
export const FREEZE_STEP = 3;

/** What the next freeze costs this unit. */
export const freezeThreshold = (u: Unit): number => FREEZE_STEP * (u.statuses.freezes + 1);

/**
 * Statuses, as opposed to modifiers (§6). Sharp, short, and mostly about
 * denying actions rather than moving numbers.
 */
export interface Statuses {
  /**
   * Frost stacks. A shared RESOURCE rather than one character's private
   * counter: Rebar builds it and spends it on control, and other Performers
   * are meant to read the same number and do something else with it.
   *
   * Decays by one at the End Turn of the side that is not carrying it, so
   * holding a target near the threshold costs upkeep instead of being a
   * grenade banked on turn two and thrown on turn nine.
   */
  frost: number;
  /** How many times this unit has frozen. Sets the next threshold. */
  freezes: number;
  /**
   * Actions still owed to a freeze.
   *
   * Counted in actions LOST, not turns skipped, and that one word is what
   * makes reactive application work: frost applied while a creature is mid-
   * swing has already missed this turn, so it takes the next one instead of
   * being wasted. Frost applied on the player's turn cancels the enemy phase
   * that follows, including a declared intent.
   */
  frozen: number;
  /**
   * Asleep until damaged. Self-inflicted by Hibernate, and cheap precisely
   * when its owner is doing their job -- a tank in the front rank gets woken
   * almost immediately, and only stays down when nobody wanted to hit them.
   */
  asleep: boolean;
}

export const noStatuses = (): Statuses => ({ frost: 0, freezes: 0, frozen: 0, asleep: false });

/** Whether a status is stopping this unit from acting at all. */
export const canAct = (u: Unit): boolean => u.statuses.frozen === 0 && !u.statuses.asleep;

export interface Unit {
  def: CharacterDef;
  hp: number;
  /** Frost, freeze and sleep. See `Statuses`. */
  statuses: Statuses;
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
   * Fractional HP owed by percentage passives, banked until it is worth a point.
   *
   * Regen, thorns and lifesteal are all percentages of numbers that are now
   * SMALL: 4% of a 9 HP healer is 0.36, and both ways of turning that into an
   * integer are wrong -- rounding down means the passive never fires at all,
   * and the old `max(1, ...)` floor paid out a whole point every turn, which on
   * a 9 HP pool is 11% a turn instead of 4%.
   *
   * Banking the remainder makes the percentage exact over time and leaves the
   * tuning numbers meaning what they say at any scale. Keyed by passive kind.
   */
  carry: Record<string, number>;
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
