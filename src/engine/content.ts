import type {
  CharacterDef,
  DieSpec,
  // Imported explicitly: unqualified `Element` resolves to the DOM global, and
  // the resulting errors point at the assignment rather than the shadowing.
  Element,
  SpriteSheet,
  StarEffect,
  StarNode,
  StarTier,
} from './types.ts';
import {
  BOSS_ENEMY_SLOTS,
  STANDARD_ENEMY_SLOTS,
  STANDARD_PARTY_SLOTS,
  type EncounterDef,
} from './formation.ts';
import { SPRITE_METRICS, type SpriteId } from './sprites.generated.ts';
import { aligned } from './elements.ts';

/**
 * How many tiles the style guide's 64px native canvas spans. The single knob for
 * the whole roster's size.
 *
 * There is no per-character height table any more, and that is the point. Every
 * sheet is built on the same 64px grid (documents/SPRITE_STYLE_GUIDE.md), so the
 * art ALREADY encodes relative stature -- and it encodes the guide's rule that a
 * large warrior gets "broader, not dramatically taller". Kael is exactly
 * Benjamin's height and half again as wide; Rebar is a low quadruped at 37px to
 * their 42. Scaling everyone by one factor keeps those proportions intact, where
 * a hand-tuned table would quietly overwrite the artist's decisions.
 *
 * Sized so the tallest sits under 1.0 tiles: at the old 1.05 Dart overhung his
 * cell into the row above, leaving no headroom for anyone drawn larger.
 */
const CANVAS_TILES = 1.35;

/**
 * The canvas the roster's scale is expressed against. Art drawn on a larger one
 * is denser, not bigger: stature stays `body / canvas`, so a 256px actor with a
 * 211px body stands 0.82 of a canvas exactly as a 128px actor with a 105px body
 * would. See `snapPx` below for what the larger canvas does change.
 */
const BASE_CANVAS = 128;

/**
 * Fallback for pre-guide art with no native grid to measure. Empty now that the
 * whole roster is on the guide -- an entry here means a sheet still needs
 * regenerating, and should be deleted rather than updated when it is.
 */
const LEGACY_SCALE: Partial<Record<SpriteId, number>> = {};

/**
 * Measured facts from the generated module, plus a height derived from the art.
 * Nothing here is hand-authored per character.
 */
const sprite = (id: SpriteId): SpriteSheet => {
  const { nativePx, nativeCanvas, pixelArt, ...metrics } = SPRITE_METRICS[id];
  // Stature is the figure's share of its OWN canvas, so art authored on the
  // 64px grid and on the 128px one that replaced it stand the same height
  // beside each other. Dividing by a fixed 64 would draw the newer art double.
  const scale =
    nativePx != null ? (nativePx / nativeCanvas) * CANVAS_TILES : (LEGACY_SCALE[id] ?? 0.9);
  // The renderer snaps a figure to whole multiples of ONE BASELINE PIXEL --
  // that is, one pixel of the 128px canvas the roster shares.
  //
  // For art drawn on 128 that is one of its own pixels, so it snaps to whole
  // multiples of itself, which is what keeps the cast at a clean 1x or 2x. For
  // Brax on 256 each of his pixels is worth half a baseline one, so his step is
  // pxH/2 and he can land on half his art height. Stepping by his FULL height
  // instead rounded him to nothing: 211px art asked for at 105px is under half
  // a step, so `round()` returned 0 and he rendered at zero size.
  //
  // Travels on only for pixel art. Smoothed art is drawn 0.28-0.34x of a 320px
  // sheet, so any such step would snap every one of them to one giant jump.
  const { pxH, ...rest } = metrics;
  const snapPx = pxH === undefined ? undefined : pxH * (BASE_CANVAS / nativeCanvas);
  return { ...rest, scale, pixelated: pixelArt, ...(pixelArt ? { pxH, snapPx } : null) };
};

/**
 * Roster note: the ability COSTS are the real balance lever, not the stats.
 * Simulation over all 7776 rolls of 5d6 showed teams whose costs collide starve
 * each other for dice (3.2 of 5 acting) while spread costs reach ~4.3 of 5.
 * That is what earns a character a seat as surely as raw stats do -- Rebar's
 * 2/6/11 barely overlaps anyone, so it acts on turns nobody else can.
 *
 * Costs 4-6 are the reliable band (87-97% payable with 5d6). Costs 1-2 are
 * deliberately unreliable (60-70%) and used as a drawback on otherwise strong kits.
 *
 * Current spread, one entry per paid ability. Nothing has three claimants:
 *   1: Aethis        2: Kael, Rebar    3: Benj, Maxine  4: Kael
 *   5: Benj, Aethis  6: Rebar          7: Kael, Maxine   8: Aethis
 *   9: Benjamin     10: Maxine        11: Rebar
 *
 * Aethis took 1/5/8 to fill the two holes Vesper left and to claim cost 1, which
 * had sat empty since Cairn -- the least reliable cost in the game (59.8%), and
 * exactly the right drawback to hang on a heal that would otherwise be too cheap.
 */

/**
 * Star trees.
 *
 * Shape is fixed for every character: choice, converge, choice, converge,
 * choice. The converging rungs are pure stat gains on purpose -- they are the
 * moments the two branches rejoin, so they cannot carry an identity-defining
 * effect that only half the players would own.
 *
 * The three choice rungs are where a character is actually specialised, and are
 * authored per character below.
 */
function starTree(
  first: [StarNode, StarNode],
  third: [StarNode, StarNode],
  fifth: [StarNode, StarNode],
): StarTier[] {
  return [
    { nodes: first },
    { nodes: [{ id: 'vigour', name: 'Vigour', effects: [{ kind: 'stat', stat: 'maxHp', percent: 12 }] }] },
    { nodes: third },
    { nodes: [{ id: 'mastery', name: 'Mastery', effects: [{ kind: 'stat', stat: 'attack', percent: 10 }] }] },
    { nodes: fifth },
  ];
}

const node = (id: string, name: string, effects: StarEffect[]): StarNode => ({ id, name, effects });

/**
 * Benjamin's contributed die, by star level. See his `passives` for why.
 *
 * Indexed by star level 0-5, so the ladder is read directly rather than mapped
 * through a table of thresholds. Levels that do not improve simply repeat the
 * entry before them, which keeps the progression readable as a column.
 */
const drill = (faces: number[], label: string): DieSpec => ({ id: 'drill', faces, label });
/**
 * The die his third upgrade tier adds, on top of the innate one.
 *
 * Its own spec rather than a reference to `DRILL_DIE[0]` so the tray can name
 * which die is which, and deliberately NOT laddered: stars improve the die he
 * always brings, the upgrade buys a second at base quality. A five-starred
 * Benjamin who buys the tier is therefore fielding a true d6 and a blanked one,
 * which reads as two different things because it is.
 */
const COMPANY_DIE: DieSpec = { id: 'company', faces: [0, 0, 0, 1, 2, 3], label: 'Company die' };

const DRILL_DIE: DieSpec[] = [
  drill([0, 0, 0, 1, 2, 3], 'Drill die'),
  drill([0, 0, 0, 1, 2, 3], 'Drill die'),
  drill([0, 0, 1, 2, 3, 4], 'Drill die ★★'),
  drill([0, 0, 1, 2, 3, 4], 'Drill die ★★'),
  drill([0, 1, 2, 3, 4, 5], 'Drill die ★★★★'),
  drill([1, 2, 3, 4, 5, 6], 'Drill die ★★★★★'),
];

/*
 * CHAIN SYMBOLS, provisional for everyone but Benjamin.
 *
 * Two per Performer, which is the density BATTLE_DESIGN.md §4 measured: one
 * each leaves 36% of random teams unable to chain at all, three makes chains
 * automatic, two gives 2-3 live options.
 *
 *   Benjamin  anvil, lantern     <- authored; the only kit with triggers
 *   Kael      anvil, crescent
 *   Rebar     lantern, thorn
 *   Maxine    crescent, tide
 *   Aethis    thorn, tide
 *
 * The other four carry symbols but NO triggers, deliberately. Their kits are
 * disposable (§7) and inventing trigger effects for abilities about to be
 * rewritten would be work thrown away -- but without a second carrier for
 * `anvil` and `lantern` nothing can ever arm Benjamin's, and the mechanic would
 * be unreachable in play. So they enable chains without benefiting from them,
 * which is exactly the "completes other people's chains" role Rebar was always
 * meant to have. Give them triggers when their kits are authored.
 */
/*
 * THE STAT SCALE.
 *
 * A level-1 Performer has about 12 HP, ATK a little over 2, and DEF in single
 * digits. Small on purpose: an HP bar the player can count is worth more than
 * one that reads 780, and a hit for 3 out of 11 lands as a real event in a way
 * that -53 out of 780 never did.
 *
 * Three things hold the old balance in place across the change:
 *
 *  - DEF and `MITIGATION_ANCHOR` were divided by the SAME number, so every
 *    mitigation percentage in the game is exactly what it was.
 *  - ATK and HP were divided by different numbers (the fight is deliberately
 *    ~6 hits rather than ~9), and everything that scales off ATK -- damage,
 *    heals, lifesteal, thorns -- moved together, so their ratios held.
 *  - Heal powers were then trimmed ~35%. Damage is rounded AFTER mitigation
 *    shrinks it and heals are not mitigated at all, so at this scale rounding
 *    is all downside for one and all upside for the other; left alone, a heal
 *    was worth 1.4x what it used to be against the same hit.
 *
 * ATK and DEF are in TENTHS of a damage point -- see `ATK_PER_DAMAGE`. That is
 * what lets a sheet read "ATK 26" while the hit it pays for lands as 2 on an 11
 * HP bar: a stat that moved in whole damage points would have no resolution
 * left, since ATK 2 to ATK 3 is a 50% step where the roster was authored at
 * 37%, and +10% of it would round to nothing. HP is in plain HP and is the
 * number the player counts.
 *
 * Percentage passives still do not round per tick: see `Unit.carry`. Those bank
 * fractions of HP and of DAMAGE, which really are small integers.
 */
/*
 * ORDER IS THE FORMATION. Units take party slots in the order they are
 * supplied (`STANDARD_PARTY_SLOTS` lists them front, front, middle, middle,
 * back, back), so roster order decides who stands where and therefore who a
 * range-1 enemy ability can reach.
 *
 * Rebar sits second so a tank is in the front rank by default. That is a
 * stopgap: choosing the arrangement is the "party / lineup management" roadmap
 * item, and until that screen exists this list is the only way to say it.
 */
export const ROSTER: CharacterDef[] = [
  {
    id: 'benjamin', name: 'Benjamin', rarity: 3, role: 'blade',
    // No elemental alignment either way. He is the baseline a player learns
    // damage and armour on before elements are introduced by anyone else, and
    // giving him a resistance profile he has no attacks to match would put half
    // an element back on him by the side door.
    resistances: {},
    maxHp: 11, attack: 26, physicalDefense: 50, magicalDefense: 30,
    sprite: sprite('benjamin'),
    /*
     * The Utility Vanguard. See BATTLE_DESIGN.md §8.
     *
     * Three of the four cost about one die, so he acts nearly every turn
     * without eating the shared pool; the ultimate is his only real commitment
     * at ~2.6 dice, where somebody else sits out. Cost 6 is the most payable
     * number on 5d6 (97.4%) and his signature ability owns it.
     *
     * Effects are authored in the order they happen, and the abilities are
     * WORDED that way too -- see the ultimate, which buffs before it strikes.
     */
    /*
     * DRILLMASTER -- the troupe rolls a sixth die while he is standing.
     *
     * The passive his kit was always asking for. Everything else he does is
     * enabling: Rally reads HIS stats and hands them to somebody else, Sunder's
     * shred is for whoever acts after him, Quick Cut arms a chain he may not be
     * the one to cash. A percentage self-buff -- which is all the other five
     * passive kinds can say -- states the opposite of that. "The party does
     * more because he is on stage" says it exactly.
     *
     * THE FACES ARE THE BALANCE, AND BLANKS ARE THE ONLY LEVER. A wildcard
     * costs any single die whatever its value, so lowering a die's numbers does
     * not weaken it -- over all 7776 rolls of 5d6, adding a d3 is BETTER than
     * adding a true d6 at every cost from 1 to 12, because small dice are
     * precision tools for exact sums. Only a blank face removes the extra
     * action. Three blanks is +0.50 dice a turn against a true die's +1.00.
     *
     * The ladder is read at his STAR LEVEL, so it improves for everyone who
     * gets there rather than costing one of the three choices his tree offers:
     *
     *   0-1  three blanks, 1-3   +0.50 dice/turn
     *   2-3  two blanks,   1-4   +0.67
     *   4    one blank,    1-5   +0.83
     *   5    a true d6           +1.00
     *
     * And it is gone the turn after he falls. `poolFor` rebuilds from who is
     * still alive, which is what stops a party-wide buff from being free.
     */
    passives: [
      {
        name: 'Drillmaster',
        kind: 'extraDie',
        die: DRILL_DIE[0]!,
        ladder: DRILL_DIE,
      },
    ],
    abilities: [
      {
        // Arms `anvil` and has no trigger of its own. A free wildcard that
        // arms for the team is the cheapest possible chain opener -- it costs
        // one die he was going to spend anyway.
        name: 'Quick Cut', cost: 0, wildcard: true, kind: 'attack',
        symbol: 'anvil',
        damageType: 'physical', range: 1, power: 0.8,
        effects: [{ do: 'damage', power: 0.8 }],
      },
      {
        // Damage first, shred second: the shred is for whoever acts AFTER him.
        // Putting it first would let his own strike cash it in and quietly make
        // this a selfish ability, when the point of it is to set up the team.
        name: 'Sunder', cost: 6, kind: 'attack',
        symbol: 'anvil',
        // Amplify rather than an appended `modify`: modifiers are keyed by
        // ability name, so a second modify from Sunder would REFRESH the shred
        // instead of deepening it. -25 becomes -40.
        trigger: { text: 'shreds 15% deeper', amplify: -15 },
        damageType: 'physical', range: 2, power: 1.1,
        effects: [
          { do: 'damage', power: 1.1 },
          { do: 'modify', stats: ['physicalDefense'], percent: -25, of: 'targetBase', turns: 3 },
        ],
      },
      {
        // Reads BENJAMIN'S current stats, not the recipient's. That is what
        // makes flat stat investment in him pay out across the whole team, what
        // lets his ultimate feed this a turn later -- and what quietly retires
        // him once the roster outscales him.
        name: 'Rally', cost: 4, kind: 'buff', range: 3, power: 20,
        symbol: 'lantern',
        // The "convert to whole-team" trigger BATTLE_DESIGN.md §4 warns is an
        // order of magnitude above the others -- which is exactly why it sits
        // on a cost-4 ability with no damage on it, per that section's advice.
        trigger: { text: 'buffs the whole team instead of one ally', retarget: 'allies' },
        effects: [
          {
            do: 'modify',
            stats: ['attack', 'physicalDefense', 'magicalDefense'],
            percent: 20, of: 'casterCurrent', turns: 3,
          },
        ],
      },
      {
        // "Gain 20% to his own stats for 3 turns, THEN strike" -- the self-buff
        // is up before the damage lands, because it is written first.
        //
        // Off his own BASE rather than his current stats, deliberately. Reading
        // current would let a recast compound on itself; base keeps the number
        // honest while still handing Rally a bigger figure to copy.
        // Carries `lantern` but has NO trigger. Triggers never sit on the ult:
        // it is already his big turn, and making it bigger when it chains would
        // collapse the decision into "save the ult for a chain".
        name: 'Perfect Form', cost: 10, kind: 'attack',
        symbol: 'lantern',
        damageType: 'physical', range: 2, power: 2.0, cooldown: 2,
        effects: [
          {
            do: 'modify', on: 'self',
            stats: ['attack', 'physicalDefense', 'magicalDefense'],
            percent: 20, of: 'targetBase', turns: 3,
          },
          { do: 'damage', power: 2.0 },
        ],
      },
    ],
    /*
     * IN-BATTLE UPGRADES -- survive, sustain, then multiply.
     *
     * The tiers replaced lifesteal / frenzy / resilient, which were three ways
     * of saying "Benjamin personally fights better" on a Performer whose entire
     * kit is about somebody else fighting better. They were the same mismatch
     * his innate passive had.
     *
     * What makes them his is a synergy that already existed and was never
     * written down: THE +10% STAT BONUS EVERY TIER GRANTS IS ALREADY
     * TEAM-SCALED FOR HIM ALONE, because Rally copies his CURRENT stats onto an
     * ally -- the whole team when it chains. Nobody else converts personal
     * stats into team stats, so "spend a turn investing in yourself" is the
     * enabling play for him and the tiers should lean into it rather than
     * fight it. Three tiers is +30% on every Rally for the rest of the fight.
     *
     * That leaves the passive slot to answer one question: what keeps him able
     * to keep doing it? Two things now ride on him being upright -- Rally is
     * worth whatever HE is worth, and Drillmaster's die is rebuilt each turn
     * from who is still alive -- so durability on Benjamin is a team stat, not
     * a selfish one.
     *
     * Tier 1 is priced at 6 on purpose: that is Sunder's cost, so the decision
     * is exactly "Sunder this turn, or make every future Rally bigger".
     */
    upgrades: [
      // ~17% after the damage floor; see `peekResilience` on why stated
      // resilience under-delivers by a predictable third.
      { name: 'Hold the Line', cost: 6, passive: { kind: 'resilient', percent: 25 } },
      // A trouper goes on. ~1 HP a turn on an 11 HP bar, banked so it is
      // exactly 9% rather than nothing.
      { name: 'Trouper', cost: 8, passive: { kind: 'regen', percent: 9 } },
      /*
       * The capstone, and unique to him: a SECOND die in the shared pool.
       *
       * Priced as a real decision rather than a strict gain. Cost 12 spends
       * ~2.6 dice and his action, and returns +0.50 dice a turn, so it pays
       * back in about five turns -- inside a long fight, not a short one. And
       * it is gone at the final curtain: upgrades last one battle.
       *
       * Reaching it means buying the two below it first, so the full line is
       * 26 dice and three of his actions. At six dice a turn that is four
       * turns of the WHOLE party's pool, which is why it is only ever right in
       * the fights that run long -- exactly the ones a sixth die matters in.
       */
      { name: 'Full Company', cost: 12, passive: { kind: 'extraDie', die: COMPANY_DIE } },
    ],
    starTree: starTree(
      [
        node('benjamin-edge', 'Honed Edge', [{ kind: 'stat', stat: 'attack', percent: 9 }]),
        node('benjamin-guard', 'Duelist Guard', [{ kind: 'stat', stat: 'defense', percent: 14 }]),
      ],
      [
        node('benjamin-bleed', 'Bleeding Cuts', [{ kind: 'passive', passive: { kind: 'lifesteal', percent: 10 } }]),
        node('benjamin-reach', 'Extended Guard', [{ kind: 'ability', ability: 'Sunder', range: 1 }]),
      ],
      [
        node('benjamin-form', 'Flawless Form', [{ kind: 'ability', ability: 'Perfect Form', power: 0.3 }]),
        node('benjamin-swift', 'Practised Rally', [{ kind: 'ability', ability: 'Rally', cost: -1 }]),
      ],
    ),
  },
  {
    id: 'rebar', name: 'Rebar', rarity: 3, role: 'shield',
    // Ice, so fire is what he is built to stand in front of -- and that lands on
    // the existing wheel rather than fighting it, since water already beats
    // fire. No light anywhere on him any more.
    resistances: aligned('water'),
    /*
     * The Ice Wall. The roster's tank, and its introduction to statuses.
     *
     * A tank in a game with no movement and no taunt does its job by STANDING
     * somewhere: enemy `range: 1` reaches the party's frontmost occupied rank,
     * so putting Rebar there is what makes front-row attacks hit him instead of
     * the artillery. Everything in the kit assumes he is there.
     *
     * High HP and physical defence, low attack, and magical defence left
     * deliberately soft -- he is the answer to a physical front-row attacker,
     * not to everything, which is the whole point of wanting a second tank.
     */
    maxHp: 22, attack: 15, physicalDefense: 95, magicalDefense: 35,
    // On all fours, so his sheet is as wide as it is tall and the anchor sits
    // dead centre between four paws -- unlike the humans, who stand off-centre
    // under an outstretched weapon.
    sprite: sprite('rebar'),
    // Tanking that helps on turns he is not the one being hit: a weaker
    // attacker is weaker against the whole party, not just against him.
    passives: [{ name: 'Bristling Hide', kind: 'thorns', percent: 15 }],
    abilities: [
      {
        symbol: 'lantern', name: 'Maul', cost: 0, wildcard: true, kind: 'attack',
        damageType: 'physical', element: 'water', range: 1, power: 0.9,
        effects: [
          { do: 'damage', power: 0.9 },
          { do: 'modify', stats: ['attack'], percent: -10, of: 'targetBase', turns: 3 },
        ],
      },
      {
        // The drawback is nearly free exactly when he is doing his job. He is in
        // the front rank, front-row attacks are common, so something wakes him
        // almost immediately -- and it only bites when nobody wanted to hit him,
        // which is when a tank had nothing to do anyway.
        //
        // Cost 2 is a fragile 70.4% payable against 97.4% at six. That is on
        // purpose: a heal you reach for when you are hurt should not be a thing
        // you can plan around every turn.
        symbol: 'thorn', name: 'Hibernate', cost: 2, kind: 'heal', range: 1, power: 0.9,
        effects: [
          { do: 'heal', power: 0.9, on: 'self' },
          { do: 'sleep', on: 'self' },
        ],
      },
      {
        // The tank you bring against a fire damage dealer. Parked on 6, the most
        // payable cost in the game, because a guard that arrives a turn late is
        // worth nothing.
        symbol: 'thorn', name: 'Frost Armor', cost: 8, kind: 'buff', range: 1, power: 25,
        effects: [
          {
            do: 'modify', stats: ['physicalDefense', 'magicalDefense'],
            percent: 25, of: 'targetBase', turns: 3, on: 'self',
            // While it is up, anyone who hits him with steel walks away frosted.
            riposte: { damageType: 'physical', frost: 1 },
          },
          { do: 'resist', element: 'fire', percent: 50, turns: 3, on: 'self' },
        ],
      },
      {
        // Its value is the frost, not the damage -- he has the lowest attack on
        // the roster, so a 3-dice nuke off it would be poor. What it buys is
        // one stack on every enemy at once, advancing five freeze counters in a
        // single action, which nothing else in the game can do.
        symbol: 'lantern', name: 'Avalanche', cost: 12, kind: 'attack',
        damageType: 'magical', element: 'water', range: 3, scope: 'all', power: 0.6,
        effects: [
          { do: 'damage', power: 0.6 },
          { do: 'frost', stacks: 1 },
        ],
      },
    ],
    upgrades: [
      { name: 'Warded Plate', cost: 6, passive: { kind: 'resilient', percent: 16 } },
      { name: 'Bristling Barding', cost: 8, passive: { kind: 'thorns', percent: 30 } },
      { name: 'Ursine Endurance', cost: 12, passive: { kind: 'regen', percent: 8 } },
    ],
    starTree: starTree(
      [
        node('rebar-pelt', 'Thick Pelt', [{ kind: 'stat', stat: 'maxHp', percent: 12 }]),
        node('rebar-plate', 'Gilded Plate', [{ kind: 'stat', stat: 'defense', percent: 14 }]),
      ],
      // The identity rung: soak the hit, or make taking it hurt.
      [
        node('rebar-ward', 'Sanctified Ward', [{ kind: 'passive', passive: { kind: 'resilient', percent: 12 } }]),
        node('rebar-barbs', 'Spiked Barding', [{ kind: 'passive', passive: { kind: 'thorns', percent: 24 } }]),
      ],
      [
        node('rebar-avalanche', 'Deeper Winter', [{ kind: 'ability', ability: 'Avalanche', power: 0.2 }]),
        node('rebar-armor', 'Lasting Rime', [{ kind: 'ability', ability: 'Frost Armor', cost: -1 }]),
      ],
    ),
  },
  {
    id: 'kael', name: 'Kael', rarity: 3, role: 'blade',
    resistances: aligned('wind'),
    // Heavier and slower than the support he replaces: an axe bruiser who wants
    // to be in the middle of things, not circling the edges.
    maxHp: 12, attack: 27, physicalDefense: 60, magicalDefense: 40,
    sprite: sprite('kael'),
    // A bruiser who wants to be in the middle of it -- the reward for being
    // hurt is what makes walking in a plan rather than a mistake.
    passives: [{ name: 'Second Wind', kind: 'frenzy', percent: 20 }],
    abilities: [
      { symbol: 'anvil', name: 'Cleave', cost: 0, wildcard: true, kind: 'attack', damageType: 'physical', power: 0.85, element: 'wind', range: 1 },
      { symbol: 'anvil', name: 'Hookstrike', cost: 2, kind: 'attack', damageType: 'physical', power: 1.05, element: 'wind', range: 1 },
      // Legacy authoring: `kind: 'buff'` with a flat `power`, which the engine
      // still routes into the modifier list at the default duration. Benjamin's
      // Rally is the same idea rebuilt on `effects` -- this one is waiting its
      // turn in the roster redesign.
      { symbol: 'crescent', name: 'War Cry', cost: 4, kind: 'buff', power: 7, element: 'wind', range: 2, scope: 'all' },
      { symbol: 'crescent', name: 'Tempest Fall', cost: 7, kind: 'attack', damageType: 'physical', power: 1.75, element: 'wind', range: 1, scope: 'all' },
    ],
    upgrades: [
      { name: 'Ironhide', cost: 6, passive: { kind: 'resilient', percent: 14 } },
      { name: 'Bloodrage', cost: 8, passive: { kind: 'frenzy', percent: 30 } },
      { name: 'Stormbreaker', cost: 12, passive: { kind: 'lifesteal', percent: 20 } },
    ],
    starTree: starTree(
      [
        node('kael-hide', 'Thick Hide', [{ kind: 'stat', stat: 'defense', percent: 12 }]),
        node('kael-heft', 'Axe Heft', [{ kind: 'stat', stat: 'attack', percent: 9 }]),
      ],
      [
        node('kael-thorns', 'Braced Plate', [{ kind: 'passive', passive: { kind: 'thorns', percent: 22 } }]),
        node('kael-rage', 'Battle Rage', [{ kind: 'passive', passive: { kind: 'frenzy', percent: 25 } }]),
      ],
      [
        node('kael-storm', 'Wider Tempest', [{ kind: 'ability', ability: 'Tempest Fall', power: 0.35 }]),
        node('kael-rally', 'Longer Rally', [{ kind: 'ability', ability: 'War Cry', range: 2 }]),
      ],
    ),
  },
  {
    id: 'maxine', name: 'Maxine', rarity: 3, role: 'staff',
    resistances: aligned('water'),
    // The roster's artillery, and a deliberate trade: she replaced its only
    // dedicated healer, so the team's sustain is now Rebar's Sanctuary alone and
    // fights are meant to be won by ending them faster.
    //
    // Glass in both directions -- the lowest HP and defence on the roster paired
    // with the highest attack. Her whole defence is range: Glacial Lance reaches
    // 5, which is one tile further than the Fallen Seraph's Judgment, so she can
    // shell the boss from outside the only attack that threatens her.
    maxHp: 9, attack: 27, physicalDefense: 20, magicalDefense: 40,
    sprite: sprite('maxine'),
    // Nine HP behind the line, so the sustain has to come from the damage she
    // deals rather than from anyone spending a turn on her.
    passives: [{ name: 'Rime Siphon', kind: 'lifesteal', percent: 10 }],
    abilities: [
      // The only ranged wildcard in the roster: low power, but it means she
      // contributes from safety on a die nobody else wanted.
      { symbol: 'crescent', name: 'Frostbolt', cost: 0, wildcard: true, kind: 'attack', damageType: 'magical', power: 0.7, element: 'water', range: 3 },
      { symbol: 'crescent', name: 'Rime Shard', cost: 3, kind: 'attack', damageType: 'magical', power: 1.15, element: 'water', range: 4 },
      // Her identity. Costs 7 and outranges the whole board.
      { symbol: 'tide', name: 'Glacial Lance', cost: 7, kind: 'attack', damageType: 'magical', power: 2.0, element: 'water', range: 5 },
      // Inherits the 10 slot the healer vacated -- uncontested by every other kit.
      { symbol: 'tide', name: 'Absolute Zero', cost: 10, kind: 'attack', damageType: 'magical', power: 1.5, element: 'water', range: 4, scope: 'all' },
    ],
    upgrades: [
      // Ordered against her weakness: survive first, then push damage. A caster
      // this brittle dies to one bad approach without the opening tier.
      { name: 'Frost Ward', cost: 6, passive: { kind: 'resilient', percent: 14 } },
      { name: 'Overchannel', cost: 8, passive: { kind: 'frenzy', percent: 35 } },
      { name: 'Mana Siphon', cost: 12, passive: { kind: 'lifesteal', percent: 18 } },
    ],
    starTree: starTree(
      [
        node('maxine-focus', 'Arcane Focus', [{ kind: 'stat', stat: 'attack', percent: 10 }]),
        node('maxine-silks', 'Warded Silks', [{ kind: 'stat', stat: 'maxHp', percent: 12 }]),
      ],
      // The identity rung: buy back some survivability, or lean all the way into
      // being a glass cannon that hits hardest when it is nearly dead.
      [
        node('maxine-siphon', 'Mana Siphon', [{ kind: 'passive', passive: { kind: 'lifesteal', percent: 12 } }]),
        node('maxine-over', 'Overchannel', [{ kind: 'passive', passive: { kind: 'frenzy', percent: 28 } }]),
      ],
      // ...and the payoff rung follows it: wider blast, or a cheaper sniper that
      // reaches 6 and can open on anything on the board.
      [
        node('maxine-zero', 'Deeper Winter', [{ kind: 'ability', ability: 'Absolute Zero', power: 0.35 }]),
        node('maxine-lance', 'Piercing Lance', [
          { kind: 'ability', ability: 'Glacial Lance', cost: -1, range: 1 },
        ]),
      ],
    ),
  },
  {
    id: 'aethis', name: 'Aethis', rarity: 3, role: 'staff',
    resistances: aligned('earth'),
    // The roster's dedicated healer, and its only earth unit -- the wheel has had
    // a hole in it since Cairn, so nothing countered water until she arrived.
    //
    // Healing scales off ATK, so her attack stat is really her heal stat; it is
    // set low because everything she does keys off it at once, and a healer who
    // out-damages the blades is a design mistake, not a nice surprise.
    maxHp: 9, attack: 18, physicalDefense: 30, magicalDefense: 40,
    sprite: sprite('aethis'),
    // The healer mends without being asked, which is what lets her spend a
    // turn on somebody else.
    passives: [{ name: 'Quiet Bloom', kind: 'regen', percent: 4 }],
    abilities: [
      // Her wildcard is the ATTACK, not a heal -- deliberately the other way round
      // from how a healer reads. A wildcard heal is worth nothing on a turn the
      // party is at full HP, which would leave her with no way to spend a spare
      // die; chip damage means she always has something to do.
      { symbol: 'thorn', name: 'Thornlash', cost: 0, wildcard: true, kind: 'attack', damageType: 'magical', power: 0.65, element: 'earth', range: 2 },
      // Cost 1 is the least reliable in the game (59.8%), and that unreliability
      // is the price of a heal this cheap. You cannot build a turn around it.
      { symbol: 'thorn', name: 'Poultice', cost: 1, kind: 'heal', power: 0.63, element: 'earth', range: 2 },
      // The one she is meant to cast: parked at 5, inside the reliable band, so
      // the heal you actually plan around is the one that turns up when needed.
      { symbol: 'tide', name: 'Verdant Grace', cost: 5, kind: 'heal', power: 0.98, element: 'earth', range: 3 },
      // Radius 1, not 2 -- the same lesson Sanctuary taught. A radius-2 team heal
      // catches the whole party regardless of formation and swamps every other
      // option in the AI's scoring. She gets reach instead: range 3 to Rebar's 2.
      { symbol: 'tide', name: 'Hallowed Grove', cost: 8, kind: 'heal', power: 0.66, element: 'earth', range: 3, scope: 'all' },
    ],
    upgrades: [
      { name: 'Herbalist', cost: 6, passive: { kind: 'regen', percent: 6 } },
      { name: 'Bramble Guard', cost: 8, passive: { kind: 'thorns', percent: 22 } },
      { name: 'Evergreen', cost: 12, passive: { kind: 'resilient', percent: 18 } },
    ],
    starTree: starTree(
      [
        // Attack raises her healing too, so this rung is genuinely "heal harder"
        // versus "survive longer" rather than the usual damage-or-bulk choice.
        node('aethis-bloom', 'Blossoming', [{ kind: 'stat', stat: 'attack', percent: 10 }]),
        node('aethis-roots', 'Deep Roots', [{ kind: 'stat', stat: 'maxHp', percent: 12 }]),
      ],
      [
        node('aethis-verdure', 'Verdure', [{ kind: 'passive', passive: { kind: 'regen', percent: 5 } }]),
        node('aethis-ward', 'Bramble Ward', [{ kind: 'passive', passive: { kind: 'thorns', percent: 20 } }]),
      ],
      [
        node('aethis-grace', 'Greater Grace', [{ kind: 'ability', ability: 'Verdant Grace', power: 0.23 }]),
        node('aethis-grove', 'Wider Grove', [
          { kind: 'ability', ability: 'Hallowed Grove', cost: -1, range: 1 },
        ]),
      ],
    ),
  },
  {
    /*
     * PLACEHOLDER KIT -- to be redesigned. The numbers and abilities here exist
     * so he can be fielded and tested, not because they are balanced.
     *
     * The roster's first 5-star and its first earth/fire unit. Authored on a
     * 256px canvas (style guide v3) because his silhouette would not carry at
     * 128 -- which makes him the first actor on a canvas other than the shared
     * one, and the reason the pipeline now reads canvas size off the file.
     * Stature is `body / canvas` either way, so at 211/256 he stands 1.24x
     * Benjamin rather than the 2.5x a fixed 128 divisor produced.
     */
    id: 'brax', name: 'Brax', rarity: 5, role: 'shield',
    // Two elements, so he is resistant on both fronts rather than aligned to
    // one wheel position. `aligned()` gives the familiar one-weak/one-strong
    // spread; spelling it out is what lets a dual-element unit exist at all.
    resistances: { ...aligned('earth'), ...aligned('fire') },
    maxHp: 20, attack: 21, physicalDefense: 100, magicalDefense: 70,
    sprite: sprite('brax'),
    // The wall. Flat reduction rather than thorns, so he holds a line he is
    // not the one attacking.
    passives: [{ name: 'Slagskin', kind: 'resilient', percent: 10 }],
    abilities: [
      {
        name: 'Cinder Fist', cost: 0, wildcard: true, kind: 'attack',
        symbol: 'ember',
        damageType: 'physical', element: 'fire', range: 1, power: 0.75,
        effects: [{ do: 'damage', power: 0.75 }],
      },
      {
        // Cost 5 (92.2% payable) for the ability he should almost always have.
        name: 'Bulwark', cost: 5, kind: 'buff', range: 3, power: 20,
        symbol: 'anvil',
        trigger: { text: 'guards the whole team instead of himself', retarget: 'allies' },
        effects: [
          {
            do: 'modify', on: 'self',
            stats: ['physicalDefense', 'magicalDefense'],
            percent: 30, of: 'targetBase', turns: 3,
          },
        ],
      },
      {
        // Cost 8 (91.8%). Damage then a shred, same shape as Sunder -- the
        // shred is for whoever acts after him.
        name: 'Molten Slag', cost: 8, kind: 'attack',
        symbol: 'ember',
        trigger: { text: 'shreds 10% deeper', amplify: -10 },
        damageType: 'magical', element: 'fire', range: 2, power: 1.15,
        effects: [
          { do: 'damage', power: 1.15 },
          { do: 'modify', stats: ['magicalDefense'], percent: -20, of: 'targetBase', turns: 3 },
        ],
      },
      {
        // His only real commitment at ~2.6 dice, on a cooldown so it anchors a
        // rhythm rather than being spammed.
        name: 'Tectonic Guard', cost: 10, kind: 'attack',
        symbol: 'anvil',
        damageType: 'physical', element: 'earth', range: 1, power: 1.6, cooldown: 2,
        effects: [
          {
            do: 'modify', on: 'allies',
            stats: ['physicalDefense'], percent: 15, of: 'casterCurrent', turns: 3,
          },
          { do: 'damage', power: 1.6 },
        ],
      },
    ],
    upgrades: [
      { name: 'Slagplate', cost: 6, passive: { kind: 'resilient', percent: 16 } },
      { name: 'Backdraft', cost: 8, passive: { kind: 'thorns', percent: 28 } },
      { name: 'Emberheart', cost: 12, passive: { kind: 'regen', percent: 7 } },
    ],
    starTree: starTree(
      [
        node('brax-plate', 'Thicker Plate', [{ kind: 'stat', stat: 'defense', percent: 12 }]),
        node('brax-forge', 'Forge Heat', [{ kind: 'stat', stat: 'attack', percent: 10 }]),
      ],
      [
        node('brax-thorns', 'Cinder Spurs', [{ kind: 'passive', passive: { kind: 'thorns', percent: 22 } }]),
        node('brax-ward', 'Ashen Ward', [{ kind: 'passive', passive: { kind: 'resilient', percent: 14 } }]),
      ],
      [
        node('brax-bulwark', 'Greater Bulwark', [{ kind: 'ability', ability: 'Bulwark', power: 0.3 }]),
        node('brax-tectonic', 'Deeper Tremor', [{ kind: 'ability', ability: 'Tectonic Guard', cost: -1 }]),
      ],
    ),
  },
];

/**
 * Enemies are NOT built like player characters. They roll no dice, so every one
 * of them acts every turn; their power budget is spent on a single ability
 * rather than a kit. Trash mobs have one ability and usually no passive, elites
 * get a passive, and bosses get several abilities on cooldowns plus a
 * telegraphed attack the player is meant to walk out of.
 *
 * Because they act every phase instead of ~2 of 5, their per-hit numbers are
 * roughly half a player character's.
 */
/**
 * The enemies the older battle system was authored against.
 *
 * Kept as reference while the rebuild runs -- their kits are the shape a real
 * bestiary needs (trash with one ability, an elite with a passive, a boss with
 * cooldowns and a telegraph) and are worth re-reading when authoring against
 * BATTLE_DESIGN.md. Not deployed: `ENEMIES` below is what a Performance uses.
 */
export const BESTIARY: CharacterDef[] = [
  {
    id: 'husk', icon: 'husk', name: 'Ash Husk', rarity: 3, role: 'blade',
    resistances: aligned('fire'),
    maxHp: 7, attack: 19, physicalDefense: 30, magicalDefense: 30,
    abilities: [
      { name: 'Claw', cost: 0, kind: 'attack', damageType: 'physical', power: 0.85, element: 'fire', range: 1, priority: 1 },
    ],
  },
  {
    id: 'wisp', icon: 'wisp', name: 'Bog Wisp', rarity: 3, role: 'bow',
    resistances: aligned('water'),
    maxHp: 7, attack: 18, physicalDefense: 20, magicalDefense: 30,
    abilities: [
      { name: 'Spit', cost: 0, kind: 'attack', damageType: 'magical', power: 0.9, element: 'water', range: 3, priority: 1 },
    ],
  },
  {
    id: 'golem', icon: 'golem', name: 'Crag Golem', rarity: 4, role: 'shield',
    resistances: aligned('earth'),
    maxHp: 16, attack: 20, physicalDefense: 90, magicalDefense: 50,
    abilities: [
      { name: 'Slam', cost: 0, kind: 'attack', damageType: 'physical', power: 1.0, element: 'earth', range: 1, priority: 1 },
    ],
    passives: [
      { kind: 'resilient', percent: 15 },
      { kind: 'thorns', percent: 20 },
    ],
  },
  {
    id: 'shade', icon: 'shade', name: 'Pale Shade', rarity: 3, role: 'dagger',
    resistances: aligned('dark'),
    maxHp: 6, attack: 20, physicalDefense: 20, magicalDefense: 20,
    abilities: [
      { name: 'Rend', cost: 0, kind: 'attack', damageType: 'physical', power: 0.95, element: 'dark', range: 1, priority: 1 },
    ],
    passives: [{ kind: 'frenzy', percent: 35 }],
  },
  {
    id: 'seraph', icon: 'seraph', name: 'Fallen Seraph', rarity: 5, role: 'staff',
    resistances: aligned('light'),
    maxHp: 14, attack: 22, physicalDefense: 40, magicalDefense: 50, boss: true,
    abilities: [
      // Priority order decides the turn: Judgment whenever it is off cooldown,
      // Rebuke to punish anyone adjacent, Radiance as the filler.
      {
        name: 'Judgment', cost: 0, kind: 'attack', power: 2.2, element: 'light',
        range: 4, scope: 'all', priority: 3, cooldown: 3, telegraph: 1,
      },
      { name: 'Rebuke', cost: 0, kind: 'attack', damageType: 'physical', power: 1.35, element: 'light', range: 1, priority: 2, cooldown: 2 },
      { name: 'Radiance', cost: 0, kind: 'attack', damageType: 'magical', power: 1.0, element: 'light', range: 2, priority: 1 },
    ],
    passives: [
      { kind: 'regen', percent: 2 },
      { kind: 'resilient', percent: 12 },
    ],
  },
];

/**
 * Encounters.
 *
 * An encounter is a backdrop plus the two slot clusters everyone deploys into.
 * There is no terrain and no map geometry any more -- where a character stands
 * is chosen by the encounter, not walked to, so the only spatial decision left
 * is how deep into the enemy line an ability reaches.
 *
 * Enemies fill `enemySlots` in the order they are supplied, and the standard
 * cluster is ordered front rank first. So a three-enemy encounter forms a line
 * facing the party, while a seven-enemy one fills all three ranks -- and putting
 * a boss last places it at the back, behind its own adds.
 */
/**
 * The creature the battle rebuild is tested against.
 *
 * Deliberately one creature repeated five times. The thing being exercised is
 * the machinery -- weighted ability selection, revealed intent, and resolution
 * -- and five different kits would make it impossible to tell a bug in the
 * selector from a quirk of one enemy's abilities. With five identical creatures
 * any spread in what they choose is the weighting, and nothing else.
 *
 * The two abilities differ on more than power so the reveal has something worth
 * reading: `range` 1 reaches only the party's front column, `range` 2 reaches
 * everyone, so the intent tells you both what is coming and who can be hit.
 *
 * NOT a balance pass. Numbers here are placeholders chosen to make the systems
 * observable, and the whole bestiary is authored properly once the mechanics
 * are in.
 */
/**
 * The creature the battle rebuild is tested against, in five elemental colours.
 *
 * One creature repeated is what makes the machinery observable -- weighted
 * selection, revealed intent, ordered resolution. Five DIFFERENT elements on
 * that one creature is what makes the matchup wheel observable too, without
 * adding a second variable: the kits are identical, so any difference in what a
 * Performer does to one versus another is the element and nothing else.
 *
 * They cover the whole five-element cycle (`elements.ts`), so every one of them
 * is strong against exactly one sibling and weak to exactly one other. A party
 * has a right answer against each, and no answer that is right against all.
 *
 * NOT a balance pass. The numbers are placeholders chosen to make the systems
 * legible; the real bestiary is authored once the mechanics are in.
 */
interface UnderstudyVariant {
  colour: string;
  element: Element;
}

const UNDERSTUDIES: UnderstudyVariant[] = [
  { colour: 'red', element: 'fire' },
  { colour: 'yellow', element: 'lightning' },
  { colour: 'blue', element: 'water' },
  { colour: 'orange', element: 'earth' },
  { colour: 'green', element: 'wind' },
];

/**
 * Art is optional per variant.
 *
 * Only the colours that have been drawn carry a sprite; the rest fall back to
 * the role badge, exactly as every enemy did before any of this existed. That
 * keeps the encounter complete and testable while the art arrives one file at a
 * time, and dropping in `understudy_blue.png` is the whole of what it takes to
 * light that one up.
 */
/**
 * A sprite if one has been packed, nothing if not.
 *
 * Art arrives one file at a time, and a creature without it falls back to the
 * role badge exactly as every enemy did before any of them had art. That keeps
 * an encounter complete and testable while the set is still being drawn, and
 * dropping the PNG in is the whole of what it takes to light one up.
 */
const art = (id: string): { sprite?: SpriteSheet } =>
  id in SPRITE_METRICS ? { sprite: sprite(id as SpriteId) } : {};

const understudy = ({ colour, element }: UnderstudyVariant): CharacterDef => {
  return {
    id: `understudy_${colour}`,
    icon: 'shade',
    name: `${colour[0]!.toUpperCase()}${colour.slice(1)} Understudy`,
    rarity: 3,
    role: 'blade',
    // Aligned to its colour: weak to what beats that element, resistant to what
    // it beats. The creature is not "a fire creature" -- it just resists like
    // one, and its abilities happen to deal that element too.
    resistances: aligned(element),
    maxHp: 7,
    attack: 19,
    // Soft to magic, armoured against steel -- so the party's blades and its
    // staves get visibly different results against the same creature, which is
    // the whole point of having two tracks.
    physicalDefense: 40,
    magicalDefense: 20,
    ...art(`understudy_${colour}`),
    abilities: [
      // d20 bands, inclusive. 1-15 is 75% and 16-20 is 25%, which is the split
      // these two were authored at when they were weights.
      { name: 'Fluffed Line', cost: 0, kind: 'attack', damageType: 'physical', power: 0.8, element, range: 1, roll: [1, 15] },
      { name: 'Scene Stealer', cost: 0, kind: 'attack', damageType: 'physical', power: 1.6, element, range: 2, roll: [16, 20] },
    ],
  };
};

/** The lineup a Performance deploys: one Understudy of each element. */
export const ENEMIES: CharacterDef[] = UNDERSTUDIES.map(understudy);

/**
 * The first boss: a False Lead.
 *
 * Wears every Understudy's colours and answers to none of them. Each round it
 * is IMMUNE to one element and freshly vulnerable to another, so a party that
 * leans on one damage type runs out of answers on the turns that element is
 * locked out. That is the whole fight -- not a stat check, a coverage check.
 *
 * Both facts are revealed before planning (see `rotateResistance` in
 * battle.ts), so being caught by the rotation is a planning mistake and never a
 * coin flip on a committed turn.
 *
 * It fields no elemental attacks of its own: it is testing the PLAYER's
 * coverage, and giving it an element to be countered in turn would muddy what
 * the fight is asking.
 */
export const FALSE_LEAD: CharacterDef = {
  id: 'false_lead',
  name: 'The False Lead',
  rarity: 5,
  role: 'staff',
  icon: 'seraph',
  boss: true,
  maxHp: 60,
  attack: 26,
  physicalDefense: 50,
  magicalDefense: 50,
  // Nothing innate: every resistance it has is the rotation's doing, so the
  // reveal is the complete truth about it on any given round.
  resistances: {},
  rotatesResistance: { immuneFor: 100, weakFor: -60 },
  /*
   * It overacts. Every turn past the tenth the False Lead commits harder to the
   * bit, and by turn thirty it hits twice as hard as it opened.
   *
   * This is the answer to the turtle. Simulated at stage 10, a level-13 party
   * -- the level the gate is tuned for -- wins in ~14 turns, but a level-10
   * party grinds for ~20 and 7.3% of those fights reach the turn cap and end in
   * a DRAW: two sides neither able to kill the other, which is the attrition
   * stalemate a full-defensive composition is built to reach. A ramp makes that
   * position untenable without touching the intended fight, which only ever
   * sees x1.2.
   *
   * Only bosses ramp. A corridor fight is over in about six turns and would
   * never reach `after`, so putting it on trash would be a rule nobody meets.
   */
  ramp: { percent: 5, after: 10 },
  ...art('false_lead'),
  abilities: [
    { name: 'Cue the Chaos', cost: 0, kind: 'attack', damageType: 'physical', power: 0.9, range: 3, element: 'dark', roll: [1, 11] },
    { name: 'Botched Entrance', cost: 0, kind: 'attack', damageType: 'magical', power: 1.3, range: 3, element: 'dark', scope: 'all', roll: [12, 17] },
    { name: 'Understudy!', cost: 0, kind: 'attack', damageType: 'true', power: 0.5, range: 3, element: 'dark', roll: [18, 20] },
  ],
};

/** A boss stands every this-many stages. */
export const BOSS_EVERY = 10;

/** How many Understudies stand with the boss. */
const BOSS_GUARD = 2;

/**
 * The two Understudies fielded alongside the boss on a given stage.
 *
 * Stepped through the roster by Act rather than fixed, so Act 2's gate is a
 * different pair from Act 1's without a second boss existing yet.
 */
function bossGuard(stage: number): CharacterDef[] {
  const act = Math.ceil(stage / BOSS_EVERY) - 1;
  return Array.from(
    { length: BOSS_GUARD },
    (_, i) => ENEMIES[(act * BOSS_GUARD + i) % ENEMIES.length]!,
  );
}

/**
 * What stage `n` fields, and at what level.
 *
 * One encounter re-used at a rising level, with a boss on every tenth. That is
 * a deliberate testing ladder rather than a content plan: it exercises
 * levelling, idle accrual and the whole battle loop against a PREDICTABLE
 * rotation, so a change in outcome is a change in the systems and not in the
 * encounter. Real stages replace it once the mechanics are settled.
 */
export function sceneFor(stage: number): { encounter: EncounterDef; enemies: CharacterDef[] } {
  const boss = stage > 0 && stage % BOSS_EVERY === 0;
  return {
    encounter: {
      ...CURTAIN_CALL,
      name: boss ? `Act ${Math.ceil(stage / BOSS_EVERY)} — The False Lead` : `Scene ${stage}`,
      enemySlots: boss ? BOSS_ENEMY_SLOTS : STANDARD_ENEMY_SLOTS,
      // Bosses run three levels hot: they are the gate between power spikes,
      // and a gate you clear at the same level as the corridor is not a gate.
      //
      // Three is now the WHOLE of the gate. With a guard of two rather than
      // five, the level bump and the boss's own bulk are the only things
      // standing between the corridor and the Act break, and they land stage
      // 10 at an even fight for a level 13 party -- about three stages of
      // grind over the corridor, which is a wall you climb rather than one you
      // camp in front of.
      enemyLevel: boss ? stage + 3 : stage,
    },
    // A guard of TWO, with the boss last so it lands in the back rank -- behind
    // two live ranks, and so out of melee reach until they are dealt with.
    //
    // Which two rotates with the Act, so a second lap of the ladder is not a
    // replay: the pair is the coverage the boss's rotation is tested against,
    // and drawing it forward through the five-element cycle means each Act asks
    // the party to answer a different corner of the wheel alongside the boss.
    enemies: boss ? [...bossGuard(stage), FALSE_LEAD] : ENEMIES,
  };
}

export const CURTAIN_CALL: EncounterDef = {
  name: 'Curtain Call',
  background: '/background/battle_screens/battle_screen_1.png',
  partySlots: STANDARD_PARTY_SLOTS,
  enemySlots: STANDARD_ENEMY_SLOTS,
};

export const ENCOUNTERS: EncounterDef[] = [CURTAIN_CALL];
