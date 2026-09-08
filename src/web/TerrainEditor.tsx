import { useMemo, useState } from 'react';
import {
  CHAR_FOR,
  TERRAIN,
  TERRAIN_CHAR,
  key,
  type MapDef,
  type Pos,
  type Terrain,
} from '../engine/grid.ts';

/**
 * Dev-only map authoring tool. The terrain in content.ts is read off the artwork
 * by eye and will be wrong in places; painting over the real background is far
 * faster than editing a 17x22 block of characters and re-checking it.
 *
 * Nothing here ships with the game -- it only emits source you paste back.
 */

const PAINT_COLOR: Record<Terrain, string> = {
  plain: 'rgba(150, 220, 255, 0.20)',
  forest: 'rgba(60, 220, 120, 0.45)',
  hill: 'rgba(255, 190, 60, 0.45)',
  water: 'rgba(40, 120, 255, 0.50)',
  building: 'rgba(255, 60, 90, 0.42)',
  rubble: 'rgba(200, 120, 255, 0.42)',
};

type Tool = Terrain | 'playerSpawn' | 'enemySpawn';

const TERRAIN_TOOLS = Object.keys(TERRAIN) as Terrain[];

export function TerrainEditor({ map, onClose }: { map: MapDef; onClose: () => void }) {
  const [tiles, setTiles] = useState<Terrain[][]>(() => map.tiles.map((r) => [...r]));
  const [playerSpawns, setPlayerSpawns] = useState<Pos[]>(() => [...map.playerSpawns]);
  const [enemySpawns, setEnemySpawns] = useState<Pos[]>(() => [...map.enemySpawns]);
  const [tool, setTool] = useState<Tool>('building');
  const [painting, setPainting] = useState(false);
  const [copied, setCopied] = useState(false);

  const tile = map.tileSize ?? 48;

  const spawnLookup = useMemo(() => {
    const m = new Map<string, 'player' | 'enemy'>();
    for (const p of playerSpawns) m.set(key(p), 'player');
    for (const p of enemySpawns) m.set(key(p), 'enemy');
    return m;
  }, [playerSpawns, enemySpawns]);

  function apply(p: Pos) {
    if (tool === 'playerSpawn' || tool === 'enemySpawn') return;
    setTiles((prev) => {
      if (prev[p.y]?.[p.x] === tool) return prev;
      const next = prev.map((r) => [...r]);
      next[p.y]![p.x] = tool;
      return next;
    });
    setCopied(false);
  }

  /** Spawns are a fixed set of five, so placing one drops the oldest. */
  function placeSpawn(p: Pos) {
    const set = tool === 'playerSpawn' ? setPlayerSpawns : setEnemySpawns;
    set((prev) => {
      const without = prev.filter((q) => !(q.x === p.x && q.y === p.y));
      if (without.length !== prev.length) return without;
      return [...without, p].slice(-5);
    });
    setCopied(false);
  }

  function handleDown(p: Pos) {
    if (tool === 'playerSpawn' || tool === 'enemySpawn') placeSpawn(p);
    else {
      setPainting(true);
      apply(p);
    }
  }

  const source = useMemo(() => {
    const rows = tiles
      .map((row, y) => `    '${row.map((t) => CHAR_FOR[t]).join('')}', // ${y}`)
      .join('\n');
    const fmt = (list: Pos[]) => list.map((p) => `{ x: ${p.x}, y: ${p.y} }`).join(', ');
    return `  tiles: parseTiles([\n${rows}\n  ]),\n  playerSpawns: [\n    ${fmt(playerSpawns)},\n  ],\n  enemySpawns: [\n    ${fmt(enemySpawns)},\n  ],`;
  }, [tiles, playerSpawns, enemySpawns]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const counts = useMemo(() => {
    const c = new Map<Terrain, number>();
    for (const row of tiles) for (const t of row) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [tiles]);

  return (
    <div className="editor">
      <div className="editor-bar">
        <strong>Terrain editor — {map.name}</strong>
        <span className="dim">
          {map.width}×{map.height} · click or drag to paint
        </span>
        <button onClick={onClose}>Back to battle</button>
      </div>

      <div className="palette">
        {TERRAIN_TOOLS.map((t) => (
          <button
            key={t}
            className={`swatch ${tool === t ? 'on' : ''}`}
            onClick={() => setTool(t)}
            title={`${TERRAIN[t].name} · move ${
              Number.isFinite(TERRAIN[t].moveCost) ? TERRAIN[t].moveCost : 'blocked'
            } · +${TERRAIN[t].defBonus} def · ${
              TERRAIN[t].blocksSight ? 'blocks line of sight' : 'can be shot through'
            }`}
          >
            <span className="chip" style={{ background: PAINT_COLOR[t] }} />
            {TERRAIN[t].name}
            {TERRAIN[t].blocksSight && <span className="los" title="Blocks line of sight">◼</span>}
            <em>{counts.get(t) ?? 0}</em>
          </button>
        ))}
        <button
          className={`swatch ${tool === 'playerSpawn' ? 'on' : ''}`}
          onClick={() => setTool('playerSpawn')}
        >
          <span className="chip spawn-p" />
          Your spawn <em>{playerSpawns.length}/5</em>
        </button>
        <button
          className={`swatch ${tool === 'enemySpawn' ? 'on' : ''}`}
          onClick={() => setTool('enemySpawn')}
        >
          <span className="chip spawn-e" />
          Enemy spawn <em>{enemySpawns.length}/5</em>
        </button>
      </div>

      <div
        className={`grid ${map.image ? 'imaged' : ''}`}
        style={{
          gridTemplateColumns: `repeat(${map.width}, ${tile}px)`,
          ...(map.image
            ? { backgroundImage: `url("${map.image}")`, backgroundSize: '100% 100%' }
            : {}),
        }}
        onMouseUp={() => setPainting(false)}
        onMouseLeave={() => setPainting(false)}
      >
        {tiles.flatMap((row, y) =>
          row.map((terrain, x) => {
            const p = { x, y };
            const spawn = spawnLookup.get(key(p));
            return (
              <div
                key={key(p)}
                className="tile edit"
                style={{ width: tile, height: tile, background: PAINT_COLOR[terrain] }}
                onMouseDown={() => handleDown(p)}
                onMouseEnter={() => painting && apply(p)}
                title={`${x},${y} · ${TERRAIN[terrain].name}`}
              >
                {spawn && <span className={`spawn ${spawn}`}>{spawn === 'player' ? 'A' : 'E'}</span>}
              </div>
            );
          }),
        )}
      </div>

      <div className="editor-out">
        <button className="primary" onClick={copy}>
          {copied ? 'Copied to clipboard' : 'Copy map data'}
        </button>
        <span className="dim">
          Paste over the <code>tiles</code> / <code>playerSpawns</code> / <code>enemySpawns</code>{' '}
          block in <code>src/engine/content.ts</code>
        </span>
        <pre>{source}</pre>
      </div>
    </div>
  );
}

/** Character legend, exported so the shorthand stays discoverable. */
export const TERRAIN_LEGEND = Object.entries(TERRAIN_CHAR)
  .map(([ch, t]) => `${ch}=${TERRAIN[t].name}`)
  .join('  ');
