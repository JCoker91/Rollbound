export interface Pos {
  x: number;
  y: number;
}

export type Terrain = 'plain' | 'forest' | 'hill' | 'water' | 'building' | 'rubble';

export interface TerrainInfo {
  moveCost: number;
  /** Added to the occupant's defense stat. */
  defBonus: number;
  /**
   * Whether this tile stops ranged abilities being fired through it. Kept
   * separate from movement: water blocks walking but not shooting, a building
   * blocks both, and a smoke tile could block sight while staying walkable.
   */
  blocksSight: boolean;
  label: string;
  name: string;
}

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  plain: { moveCost: 1, defBonus: 0, blocksSight: false, label: '.', name: 'Open ground' },
  forest: { moveCost: 2, defBonus: 15, blocksSight: false, label: 'f', name: 'Foliage' },
  hill: { moveCost: 2, defBonus: 25, blocksSight: false, label: 'h', name: 'Raised stone' },
  water: { moveCost: Infinity, defBonus: 0, blocksSight: false, label: '~', name: 'Water' },
  building: { moveCost: Infinity, defBonus: 0, blocksSight: true, label: '#', name: 'Building' },
  rubble: { moveCost: 2, defBonus: 10, blocksSight: false, label: ':', name: 'Clutter' },
};

/** Single characters used by the map-authoring shorthand and the terrain editor. */
export const TERRAIN_CHAR: Record<string, Terrain> = {
  P: 'plain',
  F: 'forest',
  H: 'hill',
  W: 'water',
  B: 'building',
  R: 'rubble',
};

export const CHAR_FOR: Record<Terrain, string> = {
  plain: 'P',
  forest: 'F',
  hill: 'H',
  water: 'W',
  building: 'B',
  rubble: 'R',
};

/**
 * Turn rows of shorthand characters into a tile grid. Authoring a 17x22 map as
 * nested arrays is unreadable; as 22 strings you can see the town in the source.
 */
export function parseTiles(rows: string[]): Terrain[][] {
  return rows.map((row, y) =>
    [...row].map((ch, x) => {
      const t = TERRAIN_CHAR[ch];
      if (!t) throw new Error(`Unknown terrain '${ch}' at ${x},${y}`);
      return t;
    }),
  );
}

export interface MapDef {
  name: string;
  width: number;
  height: number;
  /** Optional background art, served from public/. Must be flush to the grid. */
  image?: string;
  /** Pixel size to render each tile at; falls back to the CSS default. */
  tileSize?: number;
  /** Row-major, tiles[y][x]. */
  tiles: Terrain[][];
  playerSpawns: Pos[];
  enemySpawns: Pos[];
}

export const key = (p: Pos): string => `${p.x},${p.y}`;
export const parseKey = (k: string): Pos => {
  const [x, y] = k.split(',').map(Number);
  return { x: x!, y: y! };
};
export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;
export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function terrainAt(map: MapDef, p: Pos): Terrain {
  return map.tiles[p.y]?.[p.x] ?? 'water';
}

export function inBounds(map: MapDef, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
}

const NEIGHBORS: Pos[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/**
 * Tiles this unit can finish its move on. Dijkstra rather than BFS because
 * terrain has variable move cost. Blockers (any living unit) stop movement onto
 * a tile but do not block moving *through* an allied tile -- standard SRPG rule.
 */
export function reachable(
  map: MapDef,
  from: Pos,
  moveBudget: number,
  blocked: Set<string>,
  passThrough: Set<string> = new Set(),
): Map<string, number> {
  const dist = new Map<string, number>([[key(from), 0]]);
  const queue: Array<{ p: Pos; cost: number }> = [{ p: from, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { p, cost } = queue.shift()!;
    if (cost > (dist.get(key(p)) ?? Infinity)) continue;

    for (const d of NEIGHBORS) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      const nk = key(n);
      if (!inBounds(map, n)) continue;
      if (blocked.has(nk) && !passThrough.has(nk)) continue;

      const step = TERRAIN[terrainAt(map, n)].moveCost;
      if (!Number.isFinite(step)) continue;

      const next = cost + step;
      if (next <= moveBudget && next < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, next);
        queue.push({ p: n, cost: next });
      }
    }
  }

  // Tiles occupied by someone else are passable but not landable.
  for (const k of passThrough) if (k !== key(from)) dist.delete(k);
  for (const k of blocked) if (k !== key(from)) dist.delete(k);
  return dist;
}

/** Tiles within `radius` of centre, as a manhattan diamond. */
export function tilesInRange(map: MapDef, centre: Pos, radius: number): Pos[] {
  const out: Pos[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius + Math.abs(dy); dx <= radius - Math.abs(dy); dx++) {
      const p = { x: centre.x + dx, y: centre.y + dy };
      if (inBounds(map, p)) out.push(p);
    }
  }
  return out;
}

export const isPassable = (map: MapDef, p: Pos): boolean =>
  Number.isFinite(TERRAIN[terrainAt(map, p)].moveCost);

export const blocksSight = (map: MapDef, p: Pos): boolean =>
  TERRAIN[terrainAt(map, p)].blocksSight;

/**
 * Tiles a straight shot from `a` to `b` passes through, endpoints excluded.
 * Plain Bresenham rather than a supercover walk: it picks exactly one tile per
 * step, which makes "can I shoot this?" predictable for the player instead of
 * depending on which corner the line grazes.
 */
export function lineTiles(a: Pos, b: Pos): Pos[] {
  const out: Pos[] = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;

  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === b.x && y === b.y) break;
    out.push({ x, y });
  }
  return out;
}

/**
 * Can a ranged ability fired from `from` reach `to`? The caster's own tile and
 * the target's tile never block -- only what stands between them. Units do not
 * block sight; only terrain does, so allies are never in the way.
 */
export function hasLineOfSight(map: MapDef, from: Pos, to: Pos): boolean {
  return !lineTiles(from, to).some((p) => blocksSight(map, p));
}

/**
 * Walking distance from every reachable tile to the nearest of `sources`, over
 * passable terrain. Straight-line distance is unusable for movement decisions on
 * a map with buildings: a unit hill-climbing toward the closest enemy walks into
 * the nearest wall and stops there, which stranded whole teams in map corners.
 *
 * Units deliberately do not block here -- we want the route that exists, even if
 * an ally is standing in it this turn.
 */
export function distanceField(map: MapDef, sources: Pos[]): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: Array<{ p: Pos; d: number }> = [];

  for (const src of sources) {
    dist.set(key(src), 0);
    queue.push({ p: src, d: 0 });
  }

  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const { p, d } = queue.shift()!;
    if (d > (dist.get(key(p)) ?? Infinity)) continue;

    for (const step of NEIGHBORS) {
      const n = { x: p.x + step.x, y: p.y + step.y };
      if (!inBounds(map, n)) continue;
      const cost = TERRAIN[terrainAt(map, n)].moveCost;
      if (!Number.isFinite(cost)) continue;

      const nd = d + cost;
      const nk = key(n);
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        queue.push({ p: n, d: nd });
      }
    }
  }
  return dist;
}

/**
 * The actual walking route from `from` to `to`, excluding the start tile.
 * Returns [] if no route exists.
 *
 * Needed for animation, not for rules: interpolating a unit's position straight
 * from A to B slides it through buildings, so the view has to follow the same
 * tiles the character would really walk.
 */
export function findPath(map: MapDef, from: Pos, to: Pos, blocked: Set<string>): Pos[] {
  const startKey = key(from);
  const goalKey = key(to);
  if (startKey === goalKey) return [];

  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, string>();
  const queue: Array<{ p: Pos; c: number }> = [{ p: from, c: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.c - b.c);
    const { p, c } = queue.shift()!;
    if (c > (dist.get(key(p)) ?? Infinity)) continue;
    if (key(p) === goalKey) break;

    for (const step of NEIGHBORS) {
      const n = { x: p.x + step.x, y: p.y + step.y };
      const nk = key(n);
      if (!inBounds(map, n)) continue;
      // Other units block the way, but never the destination itself.
      if (blocked.has(nk) && nk !== goalKey) continue;

      const cost = TERRAIN[terrainAt(map, n)].moveCost;
      if (!Number.isFinite(cost)) continue;

      const nc = c + cost;
      if (nc < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nc);
        prev.set(nk, key(p));
        queue.push({ p: n, c: nc });
      }
    }
  }

  if (!dist.has(goalKey)) return [];

  const path: Pos[] = [];
  let cursor = goalKey;
  while (cursor !== startKey) {
    path.unshift(parseKey(cursor));
    const back = prev.get(cursor);
    if (!back) return [];
    cursor = back;
  }
  return path;
}
