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
export type AbilityKind = 'attack' | 'heal' | 'buff' | 'move';

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
 * Who an ability reaches.
 *
 *   one     a single unit. `range` gates how deep into the enemy line it may be
 *           aimed; support always reaches any ally.
 *   self    the caster, and nothing else. No target to choose.
 *   all     every living unit on the affected side -- the whole enemy line for
 *           an attack, the whole party for a heal or buff. `range` ignored.
 *   column  everyone sharing the aimed slot's COLUMN -- one rank, front to back
 *           being a different rank each time.
 *   row     everyone sharing the aimed slot's ROW -- one file, cutting across
 *           all three ranks.
 *   slot    a SLOT rather than a unit, occupied or not, on the caster's own
 *           side. Only repositioning uses it; see `REPOSITION`.
 *
 * `row` and `column` are what make a 2-1-2 formation a decision instead of
 * staging. They cut the grid along either axis, so the same five Performers
 * catch one attack or three depending on how they are spread -- and the two
 * axes pull against each other, because the columns that keep you out of an
 * enemy's reach are also the columns a column-attack cuts through.
 *
 * All of this replaced a radius measured in formation slots, where an ability
 * splashed onto its target's NEIGHBOURS. That asked the player to hold the grid
 * in their head to work out what a blast would catch, and the geometry was
 * fiddly to author against for what it gave back -- the formation is three
 * columns wide, so a radius of 2 already caught nearly everything. A named line
 * reads at a glance and needs no diagram.
 */
export type TargetScope = 'one' | 'self' | 'all' | 'column' | 'row' | 'slot';

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
/**
 * A REPLACEMENT power, used when the target is in a given state.
 *
 * "Deals 150% of ATK; if the target is frozen, 200% instead" -- the sheet says
 * *instead*, so this replaces `power` rather than multiplying it. A multiplier
 * would compound with the element wheel and with crit, and the ability would
 * quietly pay out more than its own text promises; a replacement pays exactly
 * the number written.
 *
 * Resolved inside the damage formula rather than at resolution time, which is
 * what makes it legible: `computeDamage` is what the forecast panel calls, so
 * aiming at a frozen creature SHOWS the larger number before any dice are
 * spent. Under commit-and-lock that is not a nicety -- a payoff the player
 * cannot see until after committing is a payoff they cannot plan around.
 *
 * Keyed by status so a second condition is one field rather than a new system.
 * Only `frozen` exists because only `frozen` has a character built on it.
 */
export interface VersusPower {
  frozen?: number;
}

/**
 * Extra power per frost stack ON THE TARGET, added to whatever base applies.
 *
 * The counter is read, never spent -- an ability that consumed stacks would be
 * competing with the control half of the frost engine for the same resource,
 * and two Performers quietly undoing each other is the worst kind of
 * interaction because nothing in either sheet says it is happening.
 *
 * Its ceiling is the escalating freeze bar rather than a cap written here. A
 * creature cannot hold more than `3 x (freezes + 1) - 1` stacks without
 * freezing and spending them, so the reachable bonus rises only as that
 * creature is frozen more often: 2 stacks before its first freeze, 5 before its
 * second, 8 before its third. That is the scaling stating itself through a rule
 * that already exists.
 *
 * And it carries its own drawback, which is the point. A FROZEN creature has
 * just spent every stack it had, so this pays its minimum against exactly the
 * targets a `versus.frozen` ability pays its maximum against. The two shapes
 * answer opposite board states, so the frost counter tells the player which
 * ability to reach for without a word of explanation.
 */
export type PerFrostPower = number;

export type Effect =
  | {
      do: 'damage';
      power: number;
      /**
       * Split this into several blows, by RATIO.
       *
       * `[1, 1, 1]` is three equal thirds; `[1, 1, 2]` is a quarter, a quarter
       * and a half. Shares are normalised against their own total, so an author
       * can write whichever of the two reads better for the ability and never
       * has to make the numbers add to anything in particular.
       *
       * Each blow is a real strike: mitigated on its own, rolled for critical
       * on its own, and logged on its own. That is what makes a multi-hit worth
       * having rather than one number shown in pieces -- it interacts with
       * per-hit mechanics the way a volley should.
       *
       * It also means rounding happens once per blow, so six hits of a third
       * each will out-damage one whole hit against a target that mitigates down
       * to fractions. That is a real consequence and it is accepted: the floor
       * only bites at the very bottom of the damage range, which is where this
       * game is not aiming to live.
       *
       * The animation decides WHEN each one lands -- see `impacts` in the clip
       * tuning. This decides only how the damage divides.
       */
      hits?: number[];
      /** See `VersusPower`. Overrides the ability's own, same as `power`. */
      versus?: VersusPower;
      /** See `PerFrostPower`. Overrides the ability's own, same as `power`. */
      perFrost?: PerFrostPower;
      damageType?: DamageType;
      element?: Element;
      on?: EffectTarget;
    }
  /**
   * Restore HP, as a fraction of `of`.
   *
   *   attack  the caster's ATK -- the default, and what SUPPORT heals use. The
   *           rule it enforces is that a healer's output is gated by the same
   *           stat as their damage, so they cannot out-damage the blades.
   *   maxHp   the RECIPIENT's own maximum -- for sustain rather than support.
   *
   * A tank's self-heal wants `maxHp` and the rule above does not apply to it:
   * Rebar has the lowest ATK on the roster precisely BECAUSE he is a tank, so
   * scaling his survival off it gates him on the stat he is deliberately worst
   * at. `maxHp` also scales for free -- a percentage of a bar needs no damage
   * constant and cannot go stale in a rescale.
   */
  | { do: 'heal'; power: number; of?: 'attack' | 'maxHp'; on?: EffectTarget }
  /** Add frost stacks, freezing if they reach the threshold. */
  | { do: 'frost'; stacks: number; on?: EffectTarget }
  /** Put the target to sleep until something damages them. */
  | { do: 'sleep'; on?: EffectTarget }
  /**
   * Force the targeted ENEMY to aim its declared intent at the caster.
   *
   * Taunt and cover are the two halves of protecting somebody, and they point
   * opposite ways: a taunt is cast at an ENEMY and pulls everything that
   * creature does onto the caster, while cover is cast at an ALLY and takes
   * what is aimed at them. Kael taunts. Nothing covers yet.
   *
   * Works on the intent that is already declared and shown, so the redirect is
   * visible before the player commits -- the reveal stays honest and the turn
   * stays plannable. It CANNOT move a whole-side ability, which is what stops
   * one tank being the answer to everything and is the reason enemy kits want
   * a mix of single-target and AoE.
   */
  | { do: 'taunt'; on?: EffectTarget }
  /**
   * Grant `turns` regen CHARGES -- one heal each, spent at Start Turn.
   *
   * Named `turns` because that is what it reads as on a sheet, and charges are
   * what make the reading true. See `Statuses.regen`.
   */
  | { do: 'regen'; turns: number; on?: EffectTarget }
  /**
   * Walk the CASTER to the slot the ability was aimed at, swapping with
   * whoever is standing there.
   *
   * Absolute where `move` is relative, and the two coexist on purpose. A kit
   * ability that shoves a line back a rank does not want the player picking
   * destinations; a Performer choosing where to stand does, and a shaped board
   * with four empty slots is exactly the case relative ranks cannot express.
   * Pairs with `scope: 'slot'`, which is what makes an empty slot aimable.
   *
   * `on` defaults to `self` -- the caster walks. It is honoured rather than
   * ignored so an ability could later pull an ALLY into the aimed slot, which
   * is a real thing a guardian might do and costs nothing to leave open.
   */
  | { do: 'reposition'; on?: EffectTarget }
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
      riposte?: {
    damageType: DamageType;
    /** A SECOND type it also answers. Set by a chain; see `guardAlso`. */
    also?: DamageType;
    frost: number;
  };
    }
  /**
   * Flat damage reduction for a number of turns, in percentage points.
   *
   * The counterpart to `resist`, which is typed by element; this answers
   * everything. A percentage rather than a defence buff on purpose: mitigation
   * is `ATK / (ATK + DEF)`, so a +40% P.DEF buff removes about 17% of a hit and
   * nobody can work that out at the table, while "20% less damage" removes 20%.
   * Both are viable -- the difference is whether the number on the card is the
   * number that happens.
   */
  /**
   * Spend every regen charge on the target AT ONCE, healing what they would
   * each have healed.
   *
   * A faithful conversion and deliberately not a premium one: the same HP,
   * delivered now instead of over the next few Start Turns. The tempo IS the
   * product -- an ally who dies this turn never collects the rest -- and paying
   * a bonus on top would quietly make build-then-cash the optimal line every
   * round rather than the urgent one.
   *
   * Reads `regenTick` rather than recomputing the per-charge amount, so cashing
   * a charge and letting it tick can never be worth different numbers.
   */
  | { do: 'spendRegen'; on?: EffectTarget }
  | { do: 'ward'; percent: number; turns: number; on?: EffectTarget }
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
  /** Added to the `power` of every `damage` effect. */
  empower?: number;
  /** Added to the `stacks` of every `frost` effect. */
  deepen?: number;
  /**
   * Added to the `perFrost` of every damage effect that already has one.
   *
   * Steepens existing scaling rather than creating it, which is what makes it
   * safe to write on any ability: one that reads no counter is left alone
   * instead of silently growing a new mechanic from a chain.
   *
   * The reason to reach for this over `empower` on an area ability: `empower`
   * pays out per target whether or not anyone set the caster up, so on a
   * five-target spell it is several times the band for no condition. `sharpen`
   * pays nothing at all against a clean board and everything against a cold
   * one, so the chain rewards the same preparation the ability already wants.
   */
  sharpen?: number;
  /**
   * Added to the `turns` of every effect that runs on a clock -- wards,
   * modifiers, resistances, and regen's charge count.
   *
   * Duration is the one magnitude a support ability can be given more of
   * without making any single number bigger, which is what a chain on a
   * long-running effect wants: the same board state held longer, so the cost is
   * amortised over more rounds rather than the effect being stronger while it
   * lasts. On `regen` it adds CHARGES, which is the same promise -- see
   * `Statuses.regen` for why that field is called `turns`.
   */
  prolong?: number;
  /**
   * Widen a riposte to answer this damage type as well as its own.
   *
   * A guard that only answers steel is a deliberate hole -- see Rebar, whose
   * M.DEF is half his P.DEF on purpose -- so a chain that closes it for one
   * round is exactly the shape a trigger should have: a conditional answer the
   * team sets up, never a permanent one.
   */
  guardAlso?: DamageType;
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
   * Conditional power against a target in a given state. See `VersusPower`.
   */
  versus?: VersusPower;
  /** Added power per frost stack on the target. See `PerFrostPower`. */
  perFrost?: PerFrostPower;
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
  /**
   * The kit's ultimate — its biggest, slowest, most-committed ability.
   *
   * A declared flag rather than "whichever costs most", because cost is not the
   * question being asked. A kit may one day carry two expensive abilities, or a
   * cheap one that is still the centrepiece, and the presentation the roadmap
   * wants for ultimates (a spotlight, a different camera beat) has to find them
   * by intent rather than by arithmetic.
   *
   * Its only mechanical consequence today is the default cooldown below.
   */
  ultimate?: boolean;
  /**
   * Turns this cannot be used after a cast.
   *
   * Omitted on an ultimate means `ULTIMATE_COOLDOWN`; omitted on anything else
   * means none. Written explicitly it wins either way, which is the point --
   * the default is a starting position for the whole roster, not a rule, and
   * individual ultimates are expected to move off it.
   */
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
  /**
   * While this character stands, FROSTED ENEMIES HIT SOFTER: `percent` less
   * damage per stack, capped at `max` stacks.
   *
   * The second passive that is not a number applied to its owner, and the first
   * that reads the OTHER side. It is an aura on the party rather than a buff on
   * the carrier, which is why `computeDamage` has to be told who is defending.
   *
   * It also answers something frost never had an answer for: below the freeze
   * threshold, stacks did literally nothing. Two frost on a creature was worth
   * exactly zero until it became three. This gives every stack a job on the way
   * up, which is what makes applying frost worth a die even on a turn it cannot
   * reach the bar.
   */
  | { kind: 'chill'; percent: number; max: number }
  /**
   * This character HITS COLD TARGETS HARDER: `frosted` percent more damage
   * against anything carrying frost, `frozen` percent more against anything
   * actually frozen.
   *
   * `frenzy` read the same way round for its own side -- more damage under a
   * condition -- but the condition was the ATTACKER's health. This is its twin
   * pointed at the victim, and the reason the numeric-passive helper could not
   * serve it: one percentage is not enough to describe two board states.
   *
   * The two are exclusive rather than cumulative. Freezing SPENDS the stacks,
   * so a frozen creature is carrying none and the `frosted` case cannot apply
   * to it -- the states are already disjoint in the engine, and writing them as
   * a branch says so rather than relying on it.
   *
   * Deliberately flat, not per-stack. A per-stack version would be `chill`
   * inverted, and it would double up with an ability that already scales on the
   * counter (`perFrost`) so the same stack paid twice on the same cast. Flat
   * means the passive answers "is it cold at all" and the ability answers "how
   * cold", which keeps the two readable side by side.
   */
  /**
   * At the start of each of this character's turns, heal the MOST WOUNDED ally
   * for `percent` of this character's ATK.
   *
   * Regen's opposite number in three ways, and deliberately so: it scales off
   * the HEALER's attack rather than the recipient's max HP, it picks its own
   * target rather than being granted to one, and it never expires. That makes
   * it the floor under a heal-over-time kit -- something always ticking, worth
   * more the more you invest in her, and never a turn she has to spend.
   *
   * "Most wounded" is the lowest fraction of max HP, not the lowest number.
   * With bars running 785 to 321 the two are different almost every round: by
   * raw HP a healthy mage reads as worse off than a tank at half, so absolute
   * targeting would spend every tick on whoever has the smallest bar rather
   * than on whoever is actually in trouble.
   */
  | {
      kind: 'mend';
      percent: number;
      /**
       * How many wounded allies one tick reaches. Defaults to 1.
       *
       * Across several `mend` sources the percentages SUM and the counts take
       * the MAX, because they answer different questions -- "how much does a
       * tick heal" and "how far does it reach". Summing counts would let two
       * sources heal the same ally twice over while a second wounded Performer
       * went untouched, which is the opposite of what widening it means.
       */
      targets?: number;
    }
  /**
   * While this character stands, allies CARRYING REGEN take `percent` less
   * damage.
   *
   * An aura like `chill`, and read from the defending side for the same reason
   * -- it is owned by a third unit, not by either party to the hit.
   *
   * Regen stops being only healing and becomes a MARKER for who the healer has
   * invested in, so keeping charges up does two jobs at once. Conditional on
   * her own setup rather than a flat party aura: worth nothing the turn she has
   * not spent anything, and meaningful once she has.
   */
  | { kind: 'regenGuard'; percent: number }
  /**
   * While this character stands, every regen charge restores `percent` MORE of
   * its holder's max HP -- added to the baseline `REGEN_PER_CHARGE`.
   *
   * An aura rather than a property of the charges she granted, because
   * `Statuses.regen` is a plain count with no record of who put it there, and
   * giving it one would mean tracking provenance per charge for a single
   * upgrade tier.
   *
   * It is the deepest tier she has because it reaches everything at once: the
   * Start Turn ticks, the burst that cashes them early, the single-target
   * investment and the party-wide ultimate all read the same number.
   */
  | { kind: 'deeproot'; percent: number }
  | { kind: 'exploitCold'; frosted: number; frozen: number }
  /**
   * WHENEVER FROST LANDS ON THE OTHER SIDE, this character's attack rises by
   * `percent` PER STACK for the rest of the turn.
   *
   * Counted per stack and not per cast, which is what makes it a team payoff
   * rather than a personal one: a basic applying one is worth +5%, while an
   * area applier covering five creatures with three stacks each is worth +75%.
   * The ceiling is set by what the rest of the party does, and it is spent the
   * same turn it is earned.
   *
   * Order is the whole cost. The buff only reaches abilities resolved AFTER the
   * frost, so under commit-and-lock it is paid for by queueing the appliers
   * first -- and a Performer acts once a round, so nothing the holder applies
   * can ever pay for their own cast.
   */
  | { kind: 'frostFervor'; percent: number }
  /**
   * When anything on the other side FREEZES, the named ability may next be cast
   * for any single die, as a wildcard.
   *
   * Stored as a charge on the unit (`Unit.freeCast`) rather than as a discount
   * written onto the ability, because ability definitions are shared content:
   * writing to one would make every later copy of it free for everybody.
   *
   * Names one ability rather than applying to all of them. "Your whole kit is
   * free after a freeze" is a different and much larger upgrade; the point of
   * this one is to make a specific expensive nuke reachable on the exact turn
   * the board is set up for it.
   */
  /**
   * Gains `percent` attack for the holder's NEXT turn per hit taken.
   *
   * Counts hits, not damage, so a volley of small attacks pays as well as one
   * large one -- which is the point, because the ability it is built to reward
   * pulls a whole creature's attacks onto him at once. It also means an attack
   * debuff and this passive do not fight: weakening an attacker reduces what
   * the hit costs him without reducing what it earns.
   *
   * Accumulates across the enemy phase and is spent on the turn after, which is
   * the decision the kit is built on -- taunt and be hit, or cash in what the
   * last taunt bought. A Performer acts once a round, so he cannot do both.
   */
  | { kind: 'grudge'; percent: number }
  /**
   * Takes `percent` less damage per grudge stack, up to `max` stacks, for the
   * rest of the turn.
   *
   * The answer to the thing taunting invites: a creature's whole volley coming
   * at one body. Each hit makes the next one cheaper, so focusing him has
   * DIMINISHING returns rather than linear ones -- and the more successfully he
   * does his job, the less the job costs.
   *
   * Capped in stacks like `chill` is, rather than left to the 95% mitigation
   * floor to catch. A cap the author chose is a number that can be read off the
   * sheet; a cap that emerges from a clamp somewhere else is a surprise.
   */
  | { kind: 'grudgeArmor'; percent: number; max: number }
  /**
   * This unit's taunts keep working for `turns` extra declarations.
   *
   * A base taunt is spent the moment it lands: it rewrites the intent already
   * on the board and nothing more, so holding a creature costs an action every
   * round. Extending it means the creature declares against the taunter again
   * next round with nobody spending anything -- which is the difference between
   * a tank who only ever taunts and one who gets to use what the taunt bought.
   */
  | { kind: 'lastingTaunt'; turns: number }
  | { kind: 'freeCastOnFreeze'; ability: string }
  /**
   * Takes `percent` less damage WHILE ASLEEP.
   *
   * Worth knowing what this is actually worth: any damage wakes a sleeper, and
   * the blow is measured before the waking, so it halves exactly one hit. The
   * value is in choosing WHICH hit -- Hibernate before a telegraphed swing and
   * the reduction lands on it.
   *
   * Written as a condition on sleep rather than baked into Hibernate because
   * sleep is a status like any other: the day something else puts him under,
   * this pays there too.
   */
  | { kind: 'dormant'; percent: number }
  /**
   * Deepens whatever reactive guard this character is carrying.
   *
   * Keyed off `Modifier.riposte` rather than off an ability name -- the riposte
   * exists precisely so that no code anywhere has to know the string "Frost
   * Armor", and "while he is carrying a reactive guard" means the same thing
   * while staying true of the next one he is given.
   *
   *   turns    a modifier that carries a riposte lasts this much longer
   *   onHit    while carrying one, his own attacks apply this much frost
   *   riposte  his riposte effects apply this much extra frost
   *
   * The `onHit` half is deliberately CONDITIONAL. Frost that flowed from every
   * swing would make him a frost engine that never has to think; gating it on
   * the guard being up means he has to spend the action to switch it on.
   */
  | { kind: 'rimeguard'; turns: number; onHit: number; riposte: number }
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
  /**
   * A held hit reaction, shown for a moment when this character takes damage.
   *
   * A single drawing rather than a clip, because that is what a flinch is: one
   * pose held, then dropped. Packing it as a one-frame strip would put it
   * through the whole timeline machinery to say nothing.
   */
  pain?: string;
  /**
   * Lying down, held for the rest of the battle once this unit is at 0 HP.
   *
   * Optional like `pain`, and for the same reason it must stay optional: an
   * actor without one simply leaves the stage when they fall, which is what the
   * whole roster did before any death pose existed.
   *
   * Drawn wider than it is tall, unlike every other sprite here -- so the
   * renderer sizes it by WIDTH, spending the figure height a standing Performer
   * would have had on their length instead. Sizing it by height would make a
   * body twice the size of anyone standing over it.
   */
  death?: string;
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
/**
 * What a `Modifier` keys on: a stat, an element's resistance, or a WARD.
 *
 * `ward` is a pseudo-key -- no stat of that name exists. It holds percentage
 * points of flat damage reduction, and lives here rather than as its own field
 * on `Modifier` so that duration, stacking, refresh-by-ability and expiry all
 * come from machinery that already exists. `modifierTotal` filters by key, so
 * nothing asking for a stat ever sees one.
 *
 * Like an element key and unlike a stat key, its `amount` is ABSOLUTE and never
 * routed through `resolveModifierAmount`: "20% less damage" is already the
 * number, not a percentage of something else.
 */
export type ModKey = ModStat | Element | 'ward';

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
  riposte?: {
    damageType: DamageType;
    /** A SECOND type it also answers. Set by a chain; see `guardAlso`. */
    also?: DamageType;
    frost: number;
  };
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

/**
 * Damage one frost stack deals when it lands on an ALREADY FROZEN target.
 *
 * Frost does not stack on the frozen: a creature that is already out of an
 * action cannot be made more out of it, and letting stacks bank while it is
 * helpless would mean freezing something is also the cheapest way to set up
 * freezing it again. So the stacks SHATTER instead -- the cold has nowhere to
 * go and comes out as damage.
 *
 * Four points per stack, flat and unmitigated -- a damage figure, so it moves
 * with the damage scale rather than with a stat. It is not an attack: no ATK, no
 * damage type, no element, so nothing about the attacker or the armour changes
 * it. That also keeps it off the resistance wheel, which matters because the
 * one creature whose whole identity is rotating immunity is also freezable.
 */
export const SHATTER_PER_STACK = 4;

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
   * Decays by one at the End Turn of the side that CARRIES it, so a stack
   * always survives exactly one of the frosted unit's own turns and holding a
   * target near the threshold costs upkeep instead of being a grenade banked on
   * turn two and thrown on turn nine. One a round nets zero and cannot reach
   * the bar alone -- it HOLDS a target one step in, which is a job a wildcard
   * can usefully spend an otherwise dead die on. See `endTurn` in battle.ts.
   */
  frost: number;
  /**
   * Heals still owed, one spent per Start Turn. A COUNT, not a duration.
   *
   * "Regen for 2 turns" has to mean two heals, and a duration cannot promise
   * that: a status applied mid-turn has already missed this turn's Start, so a
   * 2-turn clock counted down at End Turn leaves exactly one tick. Counting
   * CHARGES and spending one where it fires makes the number honest whenever it
   * was applied -- the same shape `frozen` already uses for actions owed.
   *
   * `Statuses` are counters; `Modifier` is the thing with a duration. Keeping
   * tick effects on this side of that line is what stops the two clocks (§6)
   * from being conflated.
   */
  regen: number;
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

export const noStatuses = (): Statuses => ({
  frost: 0,
  regen: 0,
  freezes: 0,
  frozen: 0,
  asleep: false,
});

/** Fraction of max HP one regen charge restores. */
export const REGEN_PER_CHARGE = 0.1;

/** Whether a status is stopping this unit from acting at all. */
export const canAct = (u: Unit): boolean => u.statuses.frozen === 0 && !u.statuses.asleep;

export interface Unit {
  def: CharacterDef;
  hp: number;
  /** Frost, freeze and sleep. See `Statuses`. */
  statuses: Statuses;
  /**
   * Hits taken since the owner's last End Turn.
   *
   * Counted for EVERY unit, not just the ones with a passive that reads it, so
   * it is a shared number the roster can build on -- the same shape frost has.
   * `grudge` pays it out as attack next turn and `grudgeArmor` as damage
   * reduction within this one.
   *
   * Hits, not damage: a volley of five small attacks and one large one are
   * different problems, and this is the stat that can tell them apart.
   */
  grudge: number;
  /**
   * Who has provoked this unit, and for how much longer.
   *
   * Held on the TAUNTED creature rather than on the taunter, because it is a
   * thing being done to it -- and because the creature is the one whose target
   * selection has to consult it when intents are declared.
   *
   * `by` is a character id rather than a position: positions move, and a taunt
   * should follow the Performer who shouted rather than the square they were
   * standing on.
   */
  taunt: { by: string; turns: number } | null;
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
  /**
   * An ability name this unit may next cast as a wildcard, or null.
   *
   * A CHARGE, spent on use, granted by `freeCastOnFreeze`. Lives on the unit so
   * the shared ability definition is never written to.
   */
  freeCast: string | null;
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
  /**
   * Redirected by a taunt, and therefore exempt from the reach check when the
   * intent is re-validated at execution.
   *
   * `range` is what a creature CHOOSES to reach. A taunt is it being forced,
   * and the exception is exactly what the ability buys -- without it, taunt
   * only works on creatures that could already hit the taunter, which makes it
   * little more than a way to pick which front-row body eats the attack.
   * Pulling an attack off somebody the formation cannot protect is the point.
   */
  forced?: boolean;
}

export interface PendingCast {
  ability: Ability;
  /** The slot it was aimed at when announced. */
  target: Pos;
  turnsLeft: number;
}

export type Side = 'player' | 'enemy';

/**
 * Every ultimate is slow by default, and each one may disagree.
 *
 * Three turns is the roster-wide starting position: an ultimate is the thing a
 * turn is built around, and one that comes back every other turn stops being a
 * decision and becomes a rotation.
 */
export const ULTIMATE_COOLDOWN = 3;

/**
 * The cooldown an ability actually imposes.
 *
 * Read through this, never off `ability.cooldown` directly -- the field is what
 * an author WROTE, and an ultimate that wrote nothing still has one. Three call
 * sites set cooldowns and a fourth prints them; all four go through here, so
 * the default can move without anybody hunting for the places that forgot.
 */
export const cooldownOf = (a: Ability): number =>
  a.cooldown ?? (a.ultimate ? ULTIMATE_COOLDOWN : 0);

export const alive = (u: Unit): boolean => u.hp > 0;
