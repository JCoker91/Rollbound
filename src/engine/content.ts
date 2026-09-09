import type {
  CharacterDef,
  SpriteSheet,
  StarEffect,
  StarNode,
  StarTier,
} from './types.ts';
import {
  STANDARD_ENEMY_SLOTS,
  STANDARD_PARTY_SLOTS,
  type EncounterDef,
} from './formation.ts';
import { SPRITE_METRICS, type SpriteId } from './sprites.generated.ts';

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
    id: 'benjamin', name: 'Benjamin', rarity: 3, element: 'fire', role: 'blade',
    maxHp: 780, attack: 96, defense: 40,
    sprite: sprite('benjamin'),
    abilities: [
      { name: 'Quick Cut', cost: 0, wildcard: true, kind: 'attack', power: 0.8, element: 'fire', range: 1 },
      { name: 'Riposte', cost: 3, kind: 'attack', power: 1.0, element: 'fire', range: 1 },
      { name: 'Crimson Arc', cost: 5, kind: 'attack', power: 1.5, element: 'fire', range: 2 },
      { name: 'Scarlet Tempest', cost: 9, kind: 'attack', power: 1.4, element: 'fire', range: 3, aoeRadius: 2 },
    ],
    upgrades: [
      { name: 'Bloodletter', cost: 6, passive: { kind: 'lifesteal', percent: 12 } },
      { name: 'Rising Fury', cost: 8, passive: { kind: 'frenzy', percent: 30 } },
      { name: 'Crimson Edge', cost: 12, passive: { kind: 'resilient', percent: 18 } },
    ],
    starTree: starTree(
      [
        node('benjamin-edge', 'Honed Edge', [{ kind: 'stat', stat: 'attack', percent: 9 }]),
        node('benjamin-guard', 'Duelist Guard', [{ kind: 'stat', stat: 'defense', percent: 14 }]),
      ],
      [
        node('benjamin-bleed', 'Bleeding Cuts', [{ kind: 'passive', passive: { kind: 'lifesteal', percent: 10 } }]),
        node('benjamin-reach', 'Extended Guard', [{ kind: 'ability', ability: 'Crimson Arc', range: 1 }]),
      ],
      [
        node('benjamin-tempest', 'Widening Tempest', [{ kind: 'ability', ability: 'Scarlet Tempest', power: 0.3 }]),
        node('benjamin-swift', 'Practised Riposte', [{ kind: 'ability', ability: 'Riposte', cost: -1 }]),
      ],
    ),
  },
  {
    id: 'kael', name: 'Kael', rarity: 2, element: 'wind', role: 'blade',
    // Heavier and slower than the support he replaces: an axe bruiser who wants
    // to be in the middle of things, not circling the edges.
    maxHp: 860, attack: 102, defense: 52,
    sprite: sprite('kael'),
    abilities: [
      { name: 'Cleave', cost: 0, wildcard: true, kind: 'attack', power: 0.85, element: 'wind', range: 1 },
      { name: 'Hookstrike', cost: 2, kind: 'attack', power: 1.05, element: 'wind', range: 1 },
      // The team's only attack buff. Kept when Gale was replaced, or the atkBuff
      // mechanic would have vanished from the roster entirely.
      { name: 'War Cry', cost: 4, kind: 'buff', power: 25, element: 'wind', range: 2, aoeRadius: 1 },
      { name: 'Tempest Fall', cost: 7, kind: 'attack', power: 1.75, element: 'wind', range: 1, aoeRadius: 1 },
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
    id: 'rebar', name: 'Rebar', rarity: 2, element: 'light', role: 'shield',
    // The roster's only tank, and its only light unit. Where the stone wall he
    // replaced held one tile, Rebar is a guardian who RELOCATES: Ironpaw Charge
    // stacks a 3-tile dash on his own move, so a move-3 body threatens six tiles
    // and can put itself between the enemy and whoever is about to die.
    // Attack is deliberately low -- his heals scale off ATK, so the ceiling on
    // Sanctuary is the same knob that keeps his damage honest.
    maxHp: 1040, attack: 70, defense: 68,
    // On all fours, so his sheet is as wide as it is tall and the anchor sits
    // dead centre between four paws -- unlike the humans, who stand off-centre
    // under an outstretched weapon.
    sprite: sprite('rebar'),
    abilities: [
      { name: 'Maul', cost: 0, wildcard: true, kind: 'attack', power: 0.9, element: 'light', range: 1 },
      // TODO: this was a 3-tile gap-closer and it was Rebar's whole identity.
      // With no movement it is a plain cheap melee hit and he needs a new one.
      { name: 'Ironpaw Charge', cost: 2, kind: 'attack', power: 1.1, element: 'light', range: 1 },
      // His signature, and parked on 6 on purpose: the most reliable cost in the
      // game (97.4%), because a guard buff is worthless if it arrives a turn late.
      { name: 'Aegis', cost: 6, kind: 'buff', power: 35, element: 'light', range: 3, aoeRadius: 2, stat: 'defense' },
      // The roster's only AoE heal. 11 is uncontested by every other kit and
      // eats 2-3 dice, so a full-team heal benches one or two teammates to cast.
      //
      // Radius 1, not 2, after a sweep: at radius 2 it caught the whole party
      // regardless of formation and became the most-used ability in the GAME
      // (11.5% of all player actions, out-scoring every nuke) -- absurd for an
      // 11-cost. Radius 1 puts it at 7.3% and makes it a reward for clustering,
      // which the Seraph's radius-2 Judgment is there to punish.
      { name: 'Sanctuary', cost: 11, kind: 'heal', power: 1.5, element: 'light', range: 2, aoeRadius: 1 },
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
    id: 'maxine', name: 'Maxine', rarity: 3, element: 'water', role: 'staff',
    // The roster's artillery, and a deliberate trade: she replaced its only
    // dedicated healer, so the team's sustain is now Rebar's Sanctuary alone and
    // fights are meant to be won by ending them faster.
    //
    // Glass in both directions -- the lowest HP and defence on the roster paired
    // with the highest attack. Her whole defence is range: Glacial Lance reaches
    // 5, which is one tile further than the Fallen Seraph's Judgment, so she can
    // shell the boss from outside the only attack that threatens her.
    maxHp: 640, attack: 100, defense: 32,
    sprite: sprite('maxine'),
    abilities: [
      // The only ranged wildcard in the roster: low power, but it means she
      // contributes from safety on a die nobody else wanted.
      { name: 'Frostbolt', cost: 0, wildcard: true, kind: 'attack', power: 0.7, element: 'water', range: 3 },
      { name: 'Rime Shard', cost: 3, kind: 'attack', power: 1.15, element: 'water', range: 4 },
      // Her identity. Costs 7 and outranges the whole board.
      { name: 'Glacial Lance', cost: 7, kind: 'attack', power: 2.0, element: 'water', range: 5 },
      // Inherits the 10 slot the healer vacated -- uncontested by every other kit.
      { name: 'Absolute Zero', cost: 10, kind: 'attack', power: 1.5, element: 'water', range: 4, aoeRadius: 2 },
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
    id: 'aethis', name: 'Aethis', rarity: 1, element: 'earth', role: 'staff',
    // The roster's dedicated healer, and its only earth unit -- the wheel has had
    // a hole in it since Cairn, so nothing countered water until she arrived.
    //
    // Healing scales off ATK, so her attack stat is really her heal stat; it is
    // set low because everything she does keys off it at once, and a healer who
    // out-damages the blades is a design mistake, not a nice surprise.
    maxHp: 620, attack: 68, defense: 36,
    sprite: sprite('aethis'),
    abilities: [
      // Her wildcard is the ATTACK, not a heal -- deliberately the other way round
      // from how a healer reads. A wildcard heal is worth nothing on a turn the
      // party is at full HP, which would leave her with no way to spend a spare
      // die; chip damage means she always has something to do.
      { name: 'Thornlash', cost: 0, wildcard: true, kind: 'attack', power: 0.65, element: 'earth', range: 2 },
      // Cost 1 is the least reliable in the game (59.8%), and that unreliability
      // is the price of a heal this cheap. You cannot build a turn around it.
      { name: 'Poultice', cost: 1, kind: 'heal', power: 1.1, element: 'earth', range: 2 },
      // The one she is meant to cast: parked at 5, inside the reliable band, so
      // the heal you actually plan around is the one that turns up when needed.
      { name: 'Verdant Grace', cost: 5, kind: 'heal', power: 1.7, element: 'earth', range: 3 },
      // Radius 1, not 2 -- the same lesson Sanctuary taught. A radius-2 team heal
      // catches the whole party regardless of formation and swamps every other
      // option in the AI's scoring. She gets reach instead: range 3 to Rebar's 2.
      { name: 'Hallowed Grove', cost: 8, kind: 'heal', power: 1.15, element: 'earth', range: 3, aoeRadius: 1 },
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
export const ENEMIES: CharacterDef[] = [
  {
    id: 'husk', icon: 'husk', name: 'Ash Husk', rarity: 1, element: 'fire', role: 'blade',
    maxHp: 520, attack: 72, defense: 30,
    abilities: [
      { name: 'Claw', cost: 0, kind: 'attack', power: 0.85, element: 'fire', range: 1, priority: 1 },
    ],
  },
  {
    id: 'wisp', icon: 'wisp', name: 'Bog Wisp', rarity: 1, element: 'water', role: 'bow',
    maxHp: 460, attack: 66, defense: 24,
    abilities: [
      { name: 'Spit', cost: 0, kind: 'attack', power: 0.9, element: 'water', range: 3, priority: 1 },
    ],
  },
  {
    id: 'golem', icon: 'golem', name: 'Crag Golem', rarity: 2, element: 'earth', role: 'shield',
    maxHp: 1100, attack: 76, defense: 70,
    abilities: [
      { name: 'Slam', cost: 0, kind: 'attack', power: 1.0, element: 'earth', range: 1, priority: 1 },
    ],
    passives: [
      { kind: 'resilient', percent: 15 },
      { kind: 'thorns', percent: 20 },
    ],
  },
  {
    id: 'shade', icon: 'shade', name: 'Pale Shade', rarity: 1, element: 'dark', role: 'dagger',
    maxHp: 430, attack: 76, defense: 20,
    abilities: [
      { name: 'Rend', cost: 0, kind: 'attack', power: 0.95, element: 'dark', range: 1, priority: 1 },
    ],
    passives: [{ kind: 'frenzy', percent: 35 }],
  },
  {
    id: 'seraph', icon: 'seraph', name: 'Fallen Seraph', rarity: 3, element: 'light', role: 'staff',
    maxHp: 950, attack: 84, defense: 48, boss: true,
    abilities: [
      // Priority order decides the turn: Judgment whenever it is off cooldown,
      // Rebuke to punish anyone adjacent, Radiance as the filler.
      {
        name: 'Judgment', cost: 0, kind: 'attack', power: 2.2, element: 'light',
        range: 4, aoeRadius: 2, priority: 3, cooldown: 3, telegraph: 1,
      },
      { name: 'Rebuke', cost: 0, kind: 'attack', power: 1.35, element: 'light', range: 1, priority: 2, cooldown: 2 },
      { name: 'Radiance', cost: 0, kind: 'attack', power: 1.0, element: 'light', range: 2, priority: 1 },
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
export const CURTAIN_CALL: EncounterDef = {
  name: 'Curtain Call',
  background: '/background/battle_screens/battle_screen_1.png',
  partySlots: STANDARD_PARTY_SLOTS,
  enemySlots: STANDARD_ENEMY_SLOTS,
};

export const ENCOUNTERS: EncounterDef[] = [CURTAIN_CALL];
