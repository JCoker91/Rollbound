import type {
  CharacterDef,
  StarEffect,
  StarNode,
  StarTier,
} from './types.ts';
import { parseTiles, type MapDef, type Terrain } from './grid.ts';

/**
 * Roster note: the ability COSTS are the real balance lever, not the stats.
 * Simulation over all 7776 rolls of 5d6 showed teams whose costs collide starve
 * each other for dice (3.2 of 5 acting) while spread costs reach ~4.3 of 5.
 * That is what lets a 1-star earn a seat next to two 3-stars -- Cairn's 1/3/6
 * spread means it acts on turns nobody else can.
 *
 * Costs 4-6 are the reliable band (87-97% payable with 5d6). Costs 1-2 are
 * deliberately unreliable (60-70%) and used as a drawback on otherwise strong kits.
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
    id: 'dart', name: 'Dart', rarity: 3, element: 'fire', role: 'blade',
    maxHp: 780, attack: 96, defense: 40, move: 4,
    sprite: {
      src: '/sprites/dart/dart.png',
      icon: '/sprites/dart/dart_icon.png',
      aspect: 396 / 320,
      // Left of centre: his sword extends right, so the image's middle is not
      // where he stands. Measured from the lowest band of pixels -- his feet.
      anchorX: 0.418,
      scale: 1.05,
    },
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
        node('dart-edge', 'Honed Edge', [{ kind: 'stat', stat: 'attack', percent: 9 }]),
        node('dart-guard', 'Duelist Guard', [{ kind: 'stat', stat: 'defense', percent: 14 }]),
      ],
      [
        node('dart-bleed', 'Bleeding Cuts', [{ kind: 'passive', passive: { kind: 'lifesteal', percent: 10 } }]),
        node('dart-reach', 'Extended Guard', [{ kind: 'ability', ability: 'Crimson Arc', range: 1 }]),
      ],
      [
        node('dart-tempest', 'Widening Tempest', [{ kind: 'ability', ability: 'Scarlet Tempest', power: 0.3 }]),
        node('dart-swift', 'Swift Advance', [{ kind: 'move', tiles: 1 }, { kind: 'ability', ability: 'Riposte', cost: -1 }]),
      ],
    ),
  },
  {
    id: 'kael', name: 'Kael', rarity: 2, element: 'wind', role: 'blade',
    // Heavier and slower than the support he replaces: an axe bruiser who wants
    // to be in the middle of things, not circling the edges.
    maxHp: 860, attack: 102, defense: 52, move: 4,
    sprite: {
      src: '/sprites/kael/kael.png',
      icon: '/sprites/kael/kael_icon.png',
      aspect: 390 / 320,
      anchorX: 0.491,
      scale: 1.05,
    },
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
    id: 'cairn', name: 'Cairn', rarity: 1, element: 'earth', role: 'shield',
    maxHp: 980, attack: 62, defense: 66, move: 3,
    abilities: [
      { name: 'Brace', cost: 0, wildcard: true, kind: 'buff', power: 20, element: 'earth', range: 1, stat: 'defense' },
      // A 1-cost is the least reliable in the game (59.8%) -- the tradeoff for being cheap.
      { name: 'Shield Bash', cost: 1, kind: 'attack', power: 0.7, element: 'earth', range: 1 },
      { name: 'Bulwark', cost: 3, kind: 'heal', power: 1.2, element: 'earth', range: 2 },
      { name: 'Stoneskin', cost: 6, kind: 'buff', power: 30, element: 'earth', range: 2, aoeRadius: 2, stat: 'defense' },
    ],
    upgrades: [
      { name: 'Set Stance', cost: 6, passive: { kind: 'resilient', percent: 14 } },
      { name: 'Jagged Guard', cost: 8, passive: { kind: 'thorns', percent: 28 } },
      { name: 'Mountainheart', cost: 12, passive: { kind: 'regen', percent: 7 } },
    ],
    starTree: starTree(
      [
        node('cairn-wall', 'Living Wall', [{ kind: 'stat', stat: 'maxHp', percent: 12 }]),
        node('cairn-plate', 'Deep Plate', [{ kind: 'stat', stat: 'defense', percent: 14 }]),
      ],
      [
        node('cairn-regen', 'Slow Erosion', [{ kind: 'passive', passive: { kind: 'regen', percent: 4 } }]),
        node('cairn-tough', 'Unyielding', [{ kind: 'passive', passive: { kind: 'resilient', percent: 12 } }]),
      ],
      [
        node('cairn-bulwark', 'Greater Bulwark', [{ kind: 'ability', ability: 'Bulwark', power: 0.4 }]),
        node('cairn-stone', 'Broader Stoneskin', [{ kind: 'ability', ability: 'Stoneskin', range: 1 }]),
      ],
    ),
  },
  {
    id: 'tide', name: 'Tide', rarity: 2, element: 'water', role: 'staff',
    maxHp: 700, attack: 74, defense: 44, move: 4,
    abilities: [
      { name: 'Mend', cost: 0, wildcard: true, kind: 'heal', power: 0.6, element: 'water', range: 3 },
      { name: 'Riptide', cost: 4, kind: 'attack', power: 1.1, element: 'water', range: 3 },
      { name: 'Wellspring', cost: 6, kind: 'heal', power: 1.6, element: 'water', range: 3 },
      { name: 'Maelstrom', cost: 10, kind: 'attack', power: 1.3, element: 'water', range: 3, aoeRadius: 2 },
    ],
    upgrades: [
      { name: 'Deep Current', cost: 6, passive: { kind: 'regen', percent: 5 } },
      { name: 'Undertow', cost: 8, passive: { kind: 'lifesteal', percent: 16 } },
      { name: 'Tidelord', cost: 12, passive: { kind: 'resilient', percent: 20 } },
    ],
    starTree: starTree(
      [
        node('tide-flow', 'Steady Flow', [{ kind: 'stat', stat: 'attack', percent: 9 }]),
        node('tide-depth', 'Deep Reserves', [{ kind: 'stat', stat: 'maxHp', percent: 12 }]),
      ],
      [
        node('tide-mend', 'Practised Mend', [{ kind: 'ability', ability: 'Mend', power: 0.25 }]),
        node('tide-tide', 'Rising Tide', [{ kind: 'passive', passive: { kind: 'regen', percent: 4 } }]),
      ],
      [
        node('tide-well', 'Cheaper Wellspring', [{ kind: 'ability', ability: 'Wellspring', cost: -1 }]),
        node('tide-storm', 'Greater Maelstrom', [{ kind: 'ability', ability: 'Maelstrom', power: 0.3 }]),
      ],
    ),
  },
  {
    id: 'vesper', name: 'Vesper', rarity: 1, element: 'dark', role: 'dagger',
    maxHp: 610, attack: 80, defense: 30, move: 5,
    abilities: [
      // Shadowstep carries its own movement, so Vesper threatens 8 tiles of board
      // on a single die -- the whole point of the assassin.
      { name: 'Shadowstep', cost: 0, wildcard: true, kind: 'attack', power: 0.85, element: 'dark', range: 1, dash: 3 },
      { name: 'Umbral Slash', cost: 4, kind: 'attack', power: 1.25, element: 'dark', range: 1 },
      { name: 'Assassinate', cost: 5, kind: 'attack', power: 1.75, element: 'dark', range: 1, dash: 2 },
      { name: 'Nightfall', cost: 8, kind: 'attack', power: 1.8, element: 'dark', range: 2 },
    ],
    upgrades: [
      { name: 'Bloodscent', cost: 6, passive: { kind: 'frenzy', percent: 30 } },
      { name: 'Nightstride', cost: 8, passive: { kind: 'swift', percent: 2 } },
      { name: 'Void Feast', cost: 12, passive: { kind: 'lifesteal', percent: 24 } },
    ],
    starTree: starTree(
      [
        node('vesper-edge', 'Whetted Fangs', [{ kind: 'stat', stat: 'attack', percent: 10 }]),
        node('vesper-shade', 'Shrouded', [{ kind: 'stat', stat: 'defense', percent: 16 }]),
      ],
      [
        node('vesper-drain', 'Sanguine', [{ kind: 'passive', passive: { kind: 'lifesteal', percent: 14 } }]),
        node('vesper-fury', 'Cornered', [{ kind: 'passive', passive: { kind: 'frenzy', percent: 28 } }]),
      ],
      [
        node('vesper-step', 'Longer Shadowstep', [{ kind: 'ability', ability: 'Shadowstep', power: 0.25 }]),
        node('vesper-night', 'Cheaper Nightfall', [{ kind: 'ability', ability: 'Nightfall', cost: -1 }]),
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
    maxHp: 520, attack: 72, defense: 30, move: 4,
    abilities: [
      { name: 'Claw', cost: 0, kind: 'attack', power: 0.85, element: 'fire', range: 1, priority: 1 },
    ],
  },
  {
    id: 'wisp', icon: 'wisp', name: 'Bog Wisp', rarity: 1, element: 'water', role: 'bow',
    maxHp: 460, attack: 66, defense: 24, move: 5,
    abilities: [
      // Cannot fire point-blank, so closing on it genuinely shuts it down.
      { name: 'Spit', cost: 0, kind: 'attack', power: 0.9, element: 'water', range: 3, minRange: 2, priority: 1 },
    ],
  },
  {
    id: 'golem', icon: 'golem', name: 'Crag Golem', rarity: 2, element: 'earth', role: 'shield',
    maxHp: 1100, attack: 76, defense: 70, move: 3,
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
    maxHp: 430, attack: 76, defense: 20, move: 5,
    abilities: [
      { name: 'Rend', cost: 0, kind: 'attack', power: 0.95, element: 'dark', range: 1, dash: 2, priority: 1 },
    ],
    passives: [{ kind: 'frenzy', percent: 35 }],
  },
  {
    id: 'seraph', icon: 'seraph', name: 'Fallen Seraph', rarity: 3, element: 'light', role: 'staff',
    maxHp: 950, attack: 84, defense: 48, move: 3, boss: true,
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

const P: Terrain = 'plain', F: Terrain = 'forest', H: Terrain = 'hill', W: Terrain = 'water';

/**
 * The lake splits the field into a north and south approach, so committing your
 * slow units to one side is a real decision. Hills flank each spawn as defensive
 * anchors; forests near the middle give squishy units somewhere to stand.
 */
export const RIVERSIDE: MapDef = {
  name: 'Riverside Crossing',
  width: 10,
  height: 8,
  tiles: [
    [P, P, F, P, P, P, P, F, P, P],
    [P, F, P, P, H, H, P, P, F, P],
    [P, P, P, W, W, W, P, P, P, P],
    [P, P, P, W, W, W, P, P, P, P],
    [P, P, P, P, P, P, P, P, P, P],
    [P, F, P, P, H, H, P, P, F, P],
    [P, P, F, P, P, P, P, F, P, P],
    [P, P, P, P, P, P, P, P, P, P],
  ],
  playerSpawns: [
    { x: 0, y: 1 }, { x: 0, y: 3 }, { x: 0, y: 5 }, { x: 1, y: 2 }, { x: 1, y: 4 },
  ],
  enemySpawns: [
    { x: 9, y: 1 }, { x: 9, y: 3 }, { x: 9, y: 5 }, { x: 8, y: 2 }, { x: 8, y: 4 },
  ],
};

/**
 * Urban Environment -- 17x22, drawn over public/maps/Urban_Environment.jpg.
 * The image is exactly 100px per cell and flush to the grid, so the background
 * stretches to the tile grid and lines up at any zoom.
 *
 * Terrain here is a FIRST PASS read off the artwork by eye. Rooftops are
 * impassable, market awnings and clutter are difficult ground, planters and
 * hedges give cover, and the raised stone walkways count as high ground.
 * Correct it in the in-app terrain editor rather than hand-editing this block.
 *
 *   P open ground   F foliage/cover   H raised stone
 *   B building      R clutter         W water
 */
export const URBAN_SQUARE: MapDef = {
  name: 'Market Quarter',
  width: 17,
  height: 22,
  image: '/maps/Urban_Environment.jpg',
  tileSize: 42,
  tiles: parseTiles([
    'BBBBRRRRPPRRBBBRP', // 0
    'BBBBPPPPPPPBBBBPP', // 1
    'BBBBPPPPPPPBBBBPP', // 2
    'BBBBBBBPPPPBBBBPP', // 3
    'BBBBBBBPPPPPPRPPP', // 4
    'BBBBBBBPPPPPPPPPP', // 5
    'BBBBRRPPPPPPPPPBB', // 6
    'RRRPPPPPPRRPPPRBB', // 7
    'RRRPPPPPPPPPPPBBB', // 8
    'PPPPPPPPPPPPPPBBB', // 9
    'PPBBBBBPPPPPPPBBB', // 10
    'PPBBBBBPPPPPPPPBB', // 11
    'PPBBBBBBBBHPPPBBB', // 12
    'PRBBBBBBBBHPPPBBB', // 13
    'PPBBBBBBBBHPPPBBB', // 14
    'BBBBBBBBBBHPPPBBB', // 15
    'BBBBBBBBBBHPPPPBB', // 16
    'BBBBBPPPPPHPPPPPP', // 17
    'PBBBPPPPPPHPPPPPP', // 18
    'PBBBPPPHHHHHHHHHH', // 19
    'PPPPRPPHPPPPPPPPP', // 20
    'PPPPPPPHPPPBBBBBB', // 21
  ]),
  playerSpawns: [
    { x: 15, y: 18 }, { x: 15, y: 17 }, { x: 10, y: 19 }, { x: 3, y: 21 }, { x: 2, y: 21 },
  ],
  enemySpawns: [
    { x: 15, y: 3 }, { x: 8, y: 0 }, { x: 1, y: 11 }, { x: 0, y: 10 }, { x: 6, y: 2 },
  ],
};

export const MAPS: MapDef[] = [URBAN_SQUARE, RIVERSIDE];
