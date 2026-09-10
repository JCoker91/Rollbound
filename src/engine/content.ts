import type {
  CharacterDef,
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
  // `pxH` travels on only for pixel art. Smoothed art is drawn SMALLER than its
  // file -- 0.28-0.34x -- so rounding it to a multiple of a 320px sheet would
  // snap every one of them to a single giant step.
  const { pxH, ...rest } = metrics;
  return { ...rest, scale, pixelated: pixelArt, ...(pixelArt ? { pxH } : null) };
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

export const ROSTER: CharacterDef[] = [
  {
    id: 'benjamin', name: 'Benjamin', rarity: 3, role: 'blade',
    // No elemental alignment either way. He is the baseline a player learns
    // damage and armour on before elements are introduced by anyone else, and
    // giving him a resistance profile he has no attacks to match would put half
    // an element back on him by the side door.
    resistances: {},
    maxHp: 780, attack: 96, physicalDefense: 46, magicalDefense: 34,
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
    abilities: [
      {
        name: 'Quick Cut', cost: 0, wildcard: true, kind: 'attack',
        damageType: 'physical', range: 1, power: 0.8,
        effects: [{ do: 'damage', power: 0.8 }],
      },
      {
        // Damage first, shred second: the shred is for whoever acts AFTER him.
        // Putting it first would let his own strike cash it in and quietly make
        // this a selfish ability, when the point of it is to set up the team.
        name: 'Sunder', cost: 6, kind: 'attack',
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
        name: 'Perfect Form', cost: 10, kind: 'attack',
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
    upgrades: [
      { name: 'Bloodletter', cost: 6, passive: { kind: 'lifesteal', percent: 12 } },
      { name: 'Rising Fury', cost: 8, passive: { kind: 'frenzy', percent: 30 } },
      { name: 'Tempered Steel', cost: 12, passive: { kind: 'resilient', percent: 18 } },
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
    id: 'kael', name: 'Kael', rarity: 3, role: 'blade',
    resistances: aligned('wind'),
    // Heavier and slower than the support he replaces: an axe bruiser who wants
    // to be in the middle of things, not circling the edges.
    maxHp: 860, attack: 102, physicalDefense: 60, magicalDefense: 44,
    sprite: sprite('kael'),
    abilities: [
      { name: 'Cleave', cost: 0, wildcard: true, kind: 'attack', damageType: 'physical', power: 0.85, element: 'wind', range: 1 },
      { name: 'Hookstrike', cost: 2, kind: 'attack', damageType: 'physical', power: 1.05, element: 'wind', range: 1 },
      // Legacy authoring: `kind: 'buff'` with a flat `power`, which the engine
      // still routes into the modifier list at the default duration. Benjamin's
      // Rally is the same idea rebuilt on `effects` -- this one is waiting its
      // turn in the roster redesign.
      { name: 'War Cry', cost: 4, kind: 'buff', power: 25, element: 'wind', range: 2, scope: 'all' },
      { name: 'Tempest Fall', cost: 7, kind: 'attack', damageType: 'physical', power: 1.75, element: 'wind', range: 1, scope: 'all' },
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
    id: 'rebar', name: 'Rebar', rarity: 3, role: 'shield',
    resistances: aligned('light'),
    // The roster's only tank, and its only light unit. Where the stone wall he
    // replaced held one tile, Rebar is a guardian who RELOCATES: Ironpaw Charge
    // stacks a 3-tile dash on his own move, so a move-3 body threatens six tiles
    // and can put itself between the enemy and whoever is about to die.
    // Attack is deliberately low -- his heals scale off ATK, so the ceiling on
    // Sanctuary is the same knob that keeps his damage honest.
    maxHp: 1040, attack: 70, physicalDefense: 82, magicalDefense: 54,
    // On all fours, so his sheet is as wide as it is tall and the anchor sits
    // dead centre between four paws -- unlike the humans, who stand off-centre
    // under an outstretched weapon.
    sprite: sprite('rebar'),
    abilities: [
      { name: 'Maul', cost: 0, wildcard: true, kind: 'attack', damageType: 'physical', power: 0.9, element: 'light', range: 1 },
      // TODO: this was a 3-tile gap-closer and it was Rebar's whole identity.
      // With no movement it is a plain cheap melee hit and he needs a new one.
      { name: 'Ironpaw Charge', cost: 2, kind: 'attack', damageType: 'physical', power: 1.1, element: 'light', range: 1 },
      // His signature, and parked on 6 on purpose: the most reliable cost in the
      // game (97.4%), because a guard buff is worthless if it arrives a turn late.
      { name: 'Aegis', cost: 6, kind: 'buff', power: 35, element: 'light', range: 3, scope: 'all', stat: 'defense' },
      // The roster's only AoE heal. 11 is uncontested by every other kit and
      // eats 2-3 dice, so a full-team heal benches one or two teammates to cast.
      //
      // Radius 1, not 2, after a sweep: at radius 2 it caught the whole party
      // regardless of formation and became the most-used ability in the GAME
      // (11.5% of all player actions, out-scoring every nuke) -- absurd for an
      // 11-cost. Radius 1 puts it at 7.3% and makes it a reward for clustering,
      // which the Seraph's radius-2 Judgment is there to punish.
      { name: 'Sanctuary', cost: 11, kind: 'heal', power: 1.5, element: 'light', range: 2, scope: 'all' },
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
      // ...and the payoff rung follows the same split: lean further into keeping
      // the team alive, or into being the thing that arrives and hits.
      [
        node('rebar-sanctuary', 'Greater Sanctuary', [{ kind: 'ability', ability: 'Sanctuary', power: 0.4 }]),
        node('rebar-charge', 'Thundering Charge', [
          { kind: 'ability', ability: 'Ironpaw Charge', power: 0.4 },
        ]),
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
    maxHp: 640, attack: 100, physicalDefense: 24, magicalDefense: 40,
    sprite: sprite('maxine'),
    abilities: [
      // The only ranged wildcard in the roster: low power, but it means she
      // contributes from safety on a die nobody else wanted.
      { name: 'Frostbolt', cost: 0, wildcard: true, kind: 'attack', damageType: 'magical', power: 0.7, element: 'water', range: 3 },
      { name: 'Rime Shard', cost: 3, kind: 'attack', damageType: 'magical', power: 1.15, element: 'water', range: 4 },
      // Her identity. Costs 7 and outranges the whole board.
      { name: 'Glacial Lance', cost: 7, kind: 'attack', damageType: 'magical', power: 2.0, element: 'water', range: 5 },
      // Inherits the 10 slot the healer vacated -- uncontested by every other kit.
      { name: 'Absolute Zero', cost: 10, kind: 'attack', damageType: 'magical', power: 1.5, element: 'water', range: 4, scope: 'all' },
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
    maxHp: 620, attack: 68, physicalDefense: 28, magicalDefense: 44,
    sprite: sprite('aethis'),
    abilities: [
      // Her wildcard is the ATTACK, not a heal -- deliberately the other way round
      // from how a healer reads. A wildcard heal is worth nothing on a turn the
      // party is at full HP, which would leave her with no way to spend a spare
      // die; chip damage means she always has something to do.
      { name: 'Thornlash', cost: 0, wildcard: true, kind: 'attack', damageType: 'magical', power: 0.65, element: 'earth', range: 2 },
      // Cost 1 is the least reliable in the game (59.8%), and that unreliability
      // is the price of a heal this cheap. You cannot build a turn around it.
      { name: 'Poultice', cost: 1, kind: 'heal', power: 1.1, element: 'earth', range: 2 },
      // The one she is meant to cast: parked at 5, inside the reliable band, so
      // the heal you actually plan around is the one that turns up when needed.
      { name: 'Verdant Grace', cost: 5, kind: 'heal', power: 1.7, element: 'earth', range: 3 },
      // Radius 1, not 2 -- the same lesson Sanctuary taught. A radius-2 team heal
      // catches the whole party regardless of formation and swamps every other
      // option in the AI's scoring. She gets reach instead: range 3 to Rebar's 2.
      { name: 'Hallowed Grove', cost: 8, kind: 'heal', power: 1.15, element: 'earth', range: 3, scope: 'all' },
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
        node('aethis-grace', 'Greater Grace', [{ kind: 'ability', ability: 'Verdant Grace', power: 0.4 }]),
        node('aethis-grove', 'Wider Grove', [
          { kind: 'ability', ability: 'Hallowed Grove', cost: -1, range: 1 },
        ]),
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
    maxHp: 520, attack: 72, physicalDefense: 34, magicalDefense: 26,
    abilities: [
      { name: 'Claw', cost: 0, kind: 'attack', damageType: 'physical', power: 0.85, element: 'fire', range: 1, priority: 1 },
    ],
  },
  {
    id: 'wisp', icon: 'wisp', name: 'Bog Wisp', rarity: 3, role: 'bow',
    resistances: aligned('water'),
    maxHp: 460, attack: 66, physicalDefense: 20, magicalDefense: 28,
    abilities: [
      { name: 'Spit', cost: 0, kind: 'attack', damageType: 'magical', power: 0.9, element: 'water', range: 3, priority: 1 },
    ],
  },
  {
    id: 'golem', icon: 'golem', name: 'Crag Golem', rarity: 4, role: 'shield',
    resistances: aligned('earth'),
    maxHp: 1100, attack: 76, physicalDefense: 92, magicalDefense: 48,
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
    maxHp: 430, attack: 76, physicalDefense: 16, magicalDefense: 24,
    abilities: [
      { name: 'Rend', cost: 0, kind: 'attack', damageType: 'physical', power: 0.95, element: 'dark', range: 1, priority: 1 },
    ],
    passives: [{ kind: 'frenzy', percent: 35 }],
  },
  {
    id: 'seraph', icon: 'seraph', name: 'Fallen Seraph', rarity: 5, role: 'staff',
    resistances: aligned('light'),
    maxHp: 950, attack: 84, physicalDefense: 44, magicalDefense: 52, boss: true,
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
    maxHp: 500,
    attack: 70,
    // Soft to magic, armoured against steel -- so the party's blades and its
    // staves get visibly different results against the same creature, which is
    // the whole point of having two tracks.
    physicalDefense: 44,
    magicalDefense: 18,
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
  maxHp: 4200,
  attack: 96,
  physicalDefense: 54,
  magicalDefense: 54,
  // Nothing innate: every resistance it has is the rotation's doing, so the
  // reveal is the complete truth about it on any given round.
  resistances: {},
  rotatesResistance: { immuneFor: 100, weakFor: -60 },
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
