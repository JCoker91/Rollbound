import React, { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import {
  createBattle,
  commitAction,
  commitMove,
  commitUpgrade,
  startEnemyPhase,
  finishEnemyPhase,
  nextAiStep,
  livingOf,
  unitAt,
  MAX_TURNS,
  type BattleState,
} from '../engine/battle.ts';
import { ENEMIES, MAPS } from '../engine/content.ts';
import { actionTiles, movementOptions, payingMasks } from '../engine/allocate.ts';
import {
  activePassives,
  canTarget,
  computeDamage,
  effectiveDefense,
  inRange,
  statScale,
  unitAttack,
  unitMaxHp,
  unitMove,
  unitsHit,
} from '../engine/combat.ts';
import {
  describeAbility,
  describeCost,
  describeElement,
  describeEnemyUsage,
  describePassive,
} from '../engine/describe.ts';
import {
  TERRAIN,
  findPath,
  inBounds,
  key,
  manhattan,
  samePos,
  terrainAt,
  type Pos,
} from '../engine/grid.ts';
import type { Ability, CharacterDef, Element, SpriteSheet, Unit } from '../engine/types.ts';
import { alive, ROLE_LABEL } from '../engine/types.ts';
import { Avatar } from './Avatar.tsx';
import { TerrainEditor } from './TerrainEditor.tsx';

const ELEMENT_COLOR: Record<Element, string> = {
  fire: '#ef6a4a',
  wind: '#5fd0a0',
  earth: '#c9a15f',
  water: '#4aa6ef',
  light: '#f0d878',
  dark: '#a77fd6',
};

const DIE_PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

interface Selection {
  unit: Unit | null;
  /** Where the unit will stand when it acts. Movement is free. */
  movePos: Pos | null;
  /**
   * Only ever set to an ability the current `dice` pay for exactly. Dice are
   * the gate: you choose what to spend, then choose what to spend it on.
   */
  ability: Ability | null;
  /** Indices into battle.dice. */
  dice: number[];
}

const NO_SELECTION: Selection = {
  unit: null,
  movePos: null,
  ability: null,
  dice: [],
};

interface Floater {
  id: number;
  amount: number;
  kind: 'damage' | 'heal';
  x: number;
  y: number;
}

/** Must match the floater CSS animation length. */
const FLOATER_MS = 1000;

/** How far past each board edge the camera may be pushed, as a share of the screen. */
const OVERSCROLL = 0.3;

/**
 * Clamp one camera axis, allowing a margin of overscroll past the board edge so
 * a character on the outermost row can be pulled clear of the HUD panels.
 *
 * The equal case matters: at the default zoom the board covers the window
 * EXACTLY on one axis, and an earlier `world <= win` branch centred that axis
 * outright, which silently disabled panning left and right.
 */
function clampAxis(raw: number, world: number, win: number): number {
  const slack = win * OVERSCROLL;
  if (world < win) {
    const centre = (win - world) / 2;
    return Math.min(centre + slack, Math.max(centre - slack, raw));
  }
  return Math.min(slack, Math.max(win - world - slack, raw));
}

export function BattleScreen({
  party,
  onExit,
}: {
  /** Characters with their star picks already applied. */
  party: CharacterDef[];
  onExit: () => void;
}) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [mapIndex, setMapIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [battle, setBattle] = useState<BattleState>(() =>
    createBattle(MAPS[0]!, party, ENEMIES, seed),
  );
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [hover, setHover] = useState<Pos | null>(null);
  const [preview, setPreview] = useState<Ability | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Inspect mode: clicking tiles collects coordinates instead of playing. */
  const [inspect, setInspect] = useState(false);
  const [marked, setMarked] = useState<string[]>([]);
  const [copiedTiles, setCopiedTiles] = useState(false);
  /** First click on a target aims; a second click on the same tile fires. */
  const [aim, setAim] = useState<Pos | null>(null);
  /** True while the enemy phase plays out one step at a time. */
  const [busy, setBusy] = useState(false);
  const [narration, setNarration] = useState<string | null>(null);
  /** Transient attack lunge: which unit, and which way it is striking. */
  const [pulse, setPulse] = useState<{ id: string; dx: number; dy: number } | null>(null);
  /** Horizontal mirror per unit: 1 as drawn (facing right), -1 flipped. */
  const [facing, setFacing] = useState<Record<string, number>>({});
  /**
   * Bumped each time a unit takes damage, keyed by id. The value is used as a
   * React key so the flinch animation restarts on every hit rather than only
   * playing the first time.
   */
  const [hits, setHits] = useState<Record<string, number>>({});
  /** Damage and healing numbers drifting up off the board. */
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const floaterId = useRef(0);
  /** Position a unit is currently drawn at while walking, keyed by id. */
  const [walk, setWalk] = useState<Record<string, Pos>>({});
  const [stepMs, setStepMs] = useState(110);
  const [rev, bump] = useReducer((n: number) => n + 1, 0);
  const enemyTimer = useRef<number | null>(null);
  const walkTimers = useRef<number[]>([]);

  /** Camera offset, in pixels, of the world inside the viewport. */
  /**
   * Camera and scale are DERIVED during render rather than set from an effect.
   * Measuring the window after mount was unreliable -- the stylesheet is injected
   * by script in dev, so the first measurement raced layout and the board ended
   * up framed at the wrong scale. Deriving removes the timing dependency; both
   * states hold null until the player pans or zooms, and "Recentre" clears them.
   */
  const [camOverride, setCamOverride] = useState<{ x: number; y: number } | null>(null);
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  /**
   * Camera easing is only wanted for jumps (focusing a unit, recentring). While
   * dragging or holding an arrow key it has to be off, or every frame of input
   * animates over the previous one and the map feels like it is lagging behind.
   */
  const [smoothCam, setSmoothCam] = useState(true);
  /** Per-die roll animation. Null once every die has settled. */
  const [roll, setRoll] = useState<{ phase: 'pending' | 'tumbling' | 'settled'; face: number }[] | null>(
    null,
  );
  const rollTimeouts = useRef<number[]>([]);
  const rollInterval = useRef<number | null>(null);
  const [showLog, setShowLog] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );
  /** Set when a drag ends, so the click it produces does not also select a tile. */
  const suppressClick = useRef(false);

  const map = battle.map;
  const over = battle.outcome !== 'ongoing';
  const tile = map.tileSize ?? 62;

  // Scale so the board covers the window, framed on the player's deployment.
  // Spawns rather than live positions, so the opening view does not drift as
  // characters move.
  const winW = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const winH = typeof window === 'undefined' ? 800 : window.innerHeight;
  const fitZoom = Math.min(
    2.6,
    Math.max(0.35, Math.max(winW / (map.width * tile), winH / (map.height * tile))),
  );
  const zoom = zoomOverride ?? fitZoom;
  const spawnCentre = {
    x: map.playerSpawns.reduce((n, p) => n + p.x, 0) / map.playerSpawns.length,
    y: map.playerSpawns.reduce((n, p) => n + p.y, 0) / map.playerSpawns.length,
  };
  const rawCam = camOverride ?? {
    x: winW / 2 - (spawnCentre.x * tile + tile / 2) * zoom,
    y: winH / 2 - (spawnCentre.y * tile + tile / 2) * zoom,
  };

  /**
   * Keep the board roughly covering the window, but allow a margin of overscroll
   * past every edge -- the HUD panels overlap the board, so a character standing
   * on the outermost row needs to be pullable out from under them.
   */
  const worldW = map.width * tile * zoom;
  const worldH = map.height * tile * zoom;
  const cam = {
    x: clampAxis(rawCam.x, worldW, winW),
    y: clampAxis(rawCam.y, worldH, winH),
  };
  const camRef = useRef(cam);
  camRef.current = cam;

  useEffect(
    () => () => {
      if (enemyTimer.current !== null) window.clearTimeout(enemyTimer.current);
      walkTimers.current.forEach(window.clearTimeout);
    },
    [],
  );

  /**
   * Walk a unit along its real route instead of sliding it there. The engine has
   * already put the unit on its destination, so this replays the trip: pin the
   * drawn position back to the origin, then advance it one tile at a time.
   * Without this a move around a corner cuts straight through the building.
   *
   * Returns how long the walk takes, so an attack can be delayed until arrival.
   */
  function glide(unitId: string, from: Pos, to: Pos): number {
    if (samePos(from, to)) return 0;

    const blockers = new Set(
      battle.units.filter((u) => alive(u) && u.def.id !== unitId).map((u) => key(u.pos)),
    );
    const path = findPath(map, from, to, blockers);
    if (path.length === 0) return 0;
    if (to.x !== from.x) setFacing((f) => ({ ...f, [unitId]: to.x < from.x ? -1 : 1 }));

    // Long detours would crawl at a fixed tempo, so quicken the pace.
    const ms = path.length > 8 ? 70 : 110;
    setStepMs(ms);
    setWalk((w) => ({ ...w, [unitId]: from }));

    path.forEach((p, i) => {
      walkTimers.current.push(
        window.setTimeout(() => setWalk((w) => ({ ...w, [unitId]: p })), (i + 1) * ms),
      );
    });

    const total = (path.length + 1) * ms;
    walkTimers.current.push(
      window.setTimeout(() => {
        setWalk((w) => {
          const next = { ...w };
          delete next[unitId];
          return next;
        });
      }, total),
    );
    return total;
  }

  function restart(nextSeed: number, nextMap = mapIndex) {
    if (enemyTimer.current !== null) window.clearTimeout(enemyTimer.current);
    walkTimers.current.forEach(window.clearTimeout);
    walkTimers.current = [];
    setWalk({});
    setFacing({});
    setHits({});
    setFloaters([]);
    stopDiceRoll();
    setRoll(null);
    setCamOverride(null);
    setZoomOverride(null);
    setBusy(false);
    setNarration(null);
    setAim(null);
    setPulse(null);
    setSeed(nextSeed);
    setMapIndex(nextMap);
    setBattle(createBattle(MAPS[nextMap]!, party, ENEMIES, nextSeed));
    setSel(NO_SELECTION);
    setError(null);
  }

  /** Dice subsets that pay for an ability without reusing an already-spent die. */
  function masksFor(ability: Ability): number[] {
    return payingMasks(battle.dice, ability).filter((m) => {
      for (let i = 0; i < battle.dice.length; i++) {
        if (m & (1 << i) && battle.diceSpent[i]) return false;
      }
      return true;
    });
  }

  const affordable = useMemo(() => {
    const out = new Map<string, boolean>();
    if (!sel.unit || sel.unit.side !== 'player') return out;
    for (const a of sel.unit.def.abilities) out.set(a.name, masksFor(a).length > 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, rev, battle.turn, battle.phase]);

  /**
   * Abilities the dice you are currently holding pay for EXACTLY.
   *
   * Dice are the only way to reach an ability: nothing is clickable until the
   * selection covers its cost. This answers a different question from
   * `affordable`, which asks whether SOME subset of the roll could pay. The two
   * together give three distinct states, and the panel shows all three --
   * impossible this roll, possible but not currently covered, and payable now.
   */
  const matched = useMemo(() => {
    const out = new Set<string>();
    if (!sel.unit || sel.unit.side !== 'player' || sel.dice.length === 0) return out;

    const sum = sel.dice.reduce((n, i) => n + (battle.dice[i] ?? 0), 0);
    for (const a of sel.unit.def.abilities) {
      // Guarded by `affordable` so nothing can be enabled that the engine would
      // reject -- selecting unspent dice already implies it, but the invariant
      // is worth holding explicitly.
      if (!(affordable.get(a.name) ?? false)) continue;
      // A wildcard eats any ONE die whatever its face; everything else needs the
      // subset to total its cost.
      if (a.wildcard ? sel.dice.length === 1 : sum === a.cost) out.add(a.name);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.dice, affordable, rev, battle.turn, battle.phase]);

  /** Does the current selection pay for `cost`? The rule the upgrade shares. */
  const diceCover = (cost: number): boolean =>
    sel.dice.length > 0 && sel.dice.reduce((n, i) => n + (battle.dice[i] ?? 0), 0) === cost;

  const actingFrom = sel.movePos ?? sel.unit?.pos ?? null;

  const reachable = useMemo(() => {
    if (!sel.unit || sel.unit.side !== 'player' || over) return new Set<string>();
    // A selected ability may carry a dash, which widens where it can act from --
    // and applies even to a character that has already spent its normal move.
    if (sel.ability) {
      return new Set(actionTiles(sel.unit, sel.ability, battle.units, map).map(key));
    }
    if (sel.unit.hasMoved) return new Set<string>();
    return new Set(movementOptions(sel.unit, battle.units, map).map(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.ability, rev, battle.turn, battle.phase, over]);

  const targets = useMemo(() => {
    if (!sel.unit || !sel.ability || !actingFrom) return new Set<string>();
    const side = sel.ability.kind === 'attack' ? 'enemy' : 'player';
    return new Set(
      livingOf(battle, side)
        .filter((u) => canTarget(sel.ability!, actingFrom, u.pos, map))
        .map((u) => key(u.pos)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.ability, actingFrom, rev, battle.turn, battle.phase]);

  const blocked = useMemo(() => {
    if (!sel.unit || !sel.ability || !actingFrom) return new Set<string>();
    const side = sel.ability.kind === 'attack' ? 'enemy' : 'player';
    return new Set(
      livingOf(battle, side)
        .filter((u) => inRange(sel.ability!, actingFrom, u.pos))
        .filter((u) => !canTarget(sel.ability!, actingFrom, u.pos, map))
        .map((u) => key(u.pos)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.unit, sel.ability, actingFrom, rev, battle.turn, battle.phase]);

  /**
   * Every tile the selected ability could legally be aimed at -- not just tiles
   * with a unit on them. Shown in amber so it never reads as movement.
   */
  const rangeTiles = useMemo(() => {
    if (!sel.ability || !actingFrom) return new Set<string>();
    const out = new Set<string>();
    const reach = sel.ability.range;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach + Math.abs(dy); dx <= reach - Math.abs(dy); dx++) {
        const p = { x: actingFrom.x + dx, y: actingFrom.y + dy };
        if (!inBounds(map, p)) continue;
        if (canTarget(sel.ability, actingFrom, p, map)) out.add(key(p));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.ability, actingFrom, rev, battle.turn, battle.phase]);

  /**
   * Tiles a telegraphed enemy ability will hit next turn. Shown during your
   * phase so walking out of it is a real decision.
   */
  const danger = useMemo(() => {
    const out = new Set<string>();
    for (const u of battle.units) {
      if (!alive(u) || !u.pending) continue;
      const r = u.pending.ability.aoeRadius ?? 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r + Math.abs(dy); dx <= r - Math.abs(dy); dx++) {
          out.add(key({ x: u.pending.target.x + dx, y: u.pending.target.y + dy }));
        }
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, battle.turn, battle.phase]);

  /**
   * Movement blue is hidden once an ability is chosen, so only the amber ability
   * range is on screen. Dash abilities are the exception: their movement IS part
   * of the ability, so you still need to see where you can land.
   */
  const showMoveRange = !sel.ability || !!sel.ability.dash;

  /** Tiles the AoE would cover, from the aimed tile if set, else the hovered one. */
  const focus = aim ?? hover;
  const splash = useMemo(() => {
    if (!sel.ability || !focus || !targets.has(key(focus))) return new Set<string>();
    const r = sel.ability.aoeRadius ?? 0;
    const out = new Set<string>();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r + Math.abs(dy); dx <= r - Math.abs(dy); dx++) {
        out.add(key({ x: focus.x + dx, y: focus.y + dy }));
      }
    }
    return out;
  }, [sel.ability, focus, targets]);

  function selectUnit(u: Unit) {
    setSel({ unit: u, movePos: null, ability: null, dice: [] });
    setAim(null);
    setError(null);
  }

  /** The viewport is pinned to the window, so the window is what we measure. */
  const viewSize = () => ({ w: window.innerWidth, h: window.innerHeight });

  /** Put a board position in the middle of the viewport, at a given scale. */
  function centreOn(x: number, y: number, z = zoom) {
    const { w, h } = viewSize();
    setCamOverride({ x: w / 2 - (x * tile + tile / 2) * z, y: h / 2 - (y * tile + tile / 2) * z });
  }

  /**
   * Zoom about the centre of the screen. Panning is tracked in screen pixels, so
   * `cam` needs no scaling -- only the point it is centred on does.
   */
  function onWheel(e: React.WheelEvent) {
    const { w, h } = viewSize();
    const next = Math.min(2.6, Math.max(0.35, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    const cx = (w / 2 - cam.x) / zoom;
    const cy = (h / 2 - cam.y) / zoom;
    setZoomOverride(next);
    setCamOverride({ x: w / 2 - cx * next, y: h / 2 - cy * next });
  }

  /**
   * Your party in lineup order. Roster order IS the lineup -- it decides nothing
   * mechanical, only who the camera snaps to when your phase begins and the
   * order the "next hero" button walks.
   */
  function lineup(): Unit[] {
    const byId = new Map(battle.units.filter((u) => u.side === 'player').map((u) => [u.def.id, u]));
    return party.map((d) => byId.get(d.id)).filter((u): u is Unit => !!u && alive(u));
  }

  /** Snap to the front of the lineup, so every turn starts somewhere known. */
  function focusLineupLeader() {
    const leader = lineup()[0];
    if (leader) centreOn(leader.pos.x, leader.pos.y);
  }

  /**
   * Walk to the next character who still has something to do, so you never have
   * to hunt the board for whoever you forgot. Falls back to plain cycling once
   * everyone has acted.
   */
  function nextHero() {
    const all = lineup();
    if (all.length === 0) return;

    const from = sel.unit ? all.findIndex((u) => u.def.id === sel.unit!.def.id) : -1;
    const ordered = all.slice(from + 1).concat(all.slice(0, from + 1));
    const target = ordered.find((u) => !u.hasActed || !u.hasMoved) ?? ordered[0]!;

    setSmoothCam(true);
    selectUnit(target);
    centreOn(target.pos.x, target.pos.y);
  }

  /** Drop back to the derived framing: cover the window, centred on the team. */
  function frameBoard() {
    setSmoothCam(true);
    setZoomOverride(null);
    setCamOverride(null);
  }

  /**
   * Pan to the acting character. Without this the enemy phase happens off-screen
   * on a 17x22 board and reads as nothing happening at all.
   */
  function focusCamera(unitId: string) {
    const u = battle.units.find((x) => x.def.id === unitId);
    if (!u) return;
    setSmoothCam(true);
    centreOn(u.pos.x, u.pos.y);
  }

  /**
   * Frame the board when a battle begins, and refit if the window changes size.
   * Deferred by a frame: on first paint the viewport has not been laid out yet,
   * so measuring it immediately produced a too-small zoom.
   */
  useEffect(() => {
    playDiceRoll(battle.dice);
    focusLineupLeader();

    // Everyone starts looking inward: whichever half of the map you deploy on,
    // you face the other one. Without this both sides begin staring right,
    // because that is simply how the art is drawn.
    setFacing(
      Object.fromEntries(
        battle.units.map((u) => [u.def.id, u.pos.x > (map.width - 1) / 2 ? -1 : 1]),
      ),
    );

    return stopDiceRoll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle]);

  // A resize only needs to force a re-render; the derived values recompute.
  useEffect(() => {
    window.addEventListener('resize', bump);
    return () => window.removeEventListener('resize', bump);
  }, []);

  function onPanStart(e: React.MouseEvent) {
    if (e.button !== 0) return;
    setSmoothCam(false);
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    // First drag pins the camera, so it stops tracking the derived default.
    if (!camOverride) setCamOverride(cam);
  }

  function onPanMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    // A few pixels of slop, so a slightly shaky click still counts as a click.
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setCamOverride({ x: d.cx + dx, y: d.cy + dy });
  }

  function onPanEnd() {
    suppressClick.current = dragRef.current?.moved ?? false;
    dragRef.current = null;
    setSmoothCam(true);
  }

  /**
   * Arrow keys pan continuously while held. Stepping the camera per keypress was
   * jerky and fought the easing; a velocity loop driven by requestAnimationFrame
   * moves it smoothly and stops the moment the last key is released.
   */
  const heldKeys = useRef<Set<string>>(new Set());
  const panRaf = useRef<number | null>(null);

  useEffect(() => {
    const SPEED = 950; // pixels per second
    const AXES: Record<string, [number, number]> = {
      ArrowLeft: [1, 0],
      ArrowRight: [-1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      a: [1, 0],
      d: [-1, 0],
      w: [0, 1],
      s: [0, -1],
    };
    // Letters are matched case-insensitively so caps lock does not break panning.
    const axisKey = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
    let last = 0;

    const step = (now: number) => {
      const dt = Math.min(50, now - (last || now)) / 1000;
      last = now;

      let dx = 0;
      let dy = 0;
      for (const k of heldKeys.current) {
        const a = AXES[k];
        if (a) {
          dx += a[0];
          dy += a[1];
        }
      }

      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        setCamOverride({
          x: camRef.current.x + (dx / len) * SPEED * dt,
          y: camRef.current.y + (dy / len) * SPEED * dt,
        });
      }

      panRaf.current = requestAnimationFrame(step);
    };

    const stop = () => {
      if (panRaf.current !== null) cancelAnimationFrame(panRaf.current);
      panRaf.current = null;
      last = 0;
      setSmoothCam(true);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const k = axisKey(e);
      if (!AXES[k]) return;
      // Leave these keys alone while a form control has focus.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      heldKeys.current.add(k);
      if (panRaf.current === null) {
        setSmoothCam(false);
        panRaf.current = requestAnimationFrame(step);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = axisKey(e);
      if (!AXES[k]) return;
      heldKeys.current.delete(k);
      if (heldKeys.current.size === 0) stop();
    };

    // Escape is the keyboard equivalent of clicking empty ground.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSel(NO_SELECTION);
      setAim(null);
      setPreview(null);
      setError(null);
    };

    // Losing focus mid-hold would otherwise leave the camera drifting forever.
    const onBlur = () => {
      heldKeys.current.clear();
      stop();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (panRaf.current !== null) cancelAnimationFrame(panRaf.current);
    };
  }, []);

  function stopDiceRoll() {
    rollTimeouts.current.forEach(window.clearTimeout);
    rollTimeouts.current = [];
    if (rollInterval.current !== null) window.clearInterval(rollInterval.current);
    rollInterval.current = null;
  }

  /**
   * Tumble the dice in one at a time at the start of your phase. The values are
   * already decided by the seeded RNG -- this only reveals them, so it can never
   * change the outcome and is safe to interrupt.
   */
  function playDiceRoll(values: number[]) {
    stopDiceRoll();
    const STAGGER = 170;
    const SPIN = 500;

    setRoll(values.map(() => ({ phase: 'pending' as const, face: 1 })));

    // A single interval drives every die still in the air.
    rollInterval.current = window.setInterval(() => {
      setRoll(
        (prev) =>
          prev &&
          prev.map((d) =>
            d.phase === 'tumbling' ? { ...d, face: 1 + Math.floor(Math.random() * 6) } : d,
          ),
      );
    }, 55);

    values.forEach((v, i) => {
      rollTimeouts.current.push(
        window.setTimeout(() => {
          setRoll((prev) => prev && prev.map((d, j) => (j === i ? { ...d, phase: 'tumbling' } : d)));
        }, i * STAGGER),
      );
      rollTimeouts.current.push(
        window.setTimeout(
          () => {
            setRoll(
              (prev) => prev && prev.map((d, j) => (j === i ? { phase: 'settled', face: v } : d)),
            );
          },
          i * STAGGER + SPIN,
        ),
      );
    });

    rollTimeouts.current.push(
      window.setTimeout(
        () => {
          stopDiceRoll();
          setRoll(null);
        },
        (values.length - 1) * STAGGER + SPIN + 260,
      ),
    );
  }

  /**
   * Run something that changes HP, then flinch whoever was hurt and float the
   * numbers. Diffing HP rather than reading the log catches every source at once
   * -- direct hits, AoE splash, thorns, lifesteal, regen -- without matching on
   * names, and gives the exact amount for free.
   */
  function withHitReactions(act: () => void) {
    const before = new Map(battle.units.map((u) => [u.def.id, u.hp]));
    act();

    const changed = battle.units
      .map((u) => ({ unit: u, delta: u.hp - (before.get(u.def.id) ?? u.hp) }))
      .filter((c) => c.delta !== 0);
    if (changed.length === 0) return;

    const hurt = changed.filter((c) => c.delta < 0);
    if (hurt.length > 0) {
      setHits((h) => {
        const next = { ...h };
        for (const c of hurt) next[c.unit.def.id] = (next[c.unit.def.id] ?? 0) + 1;
        return next;
      });
    }

    const spawned = changed.map((c) => ({
      id: floaterId.current++,
      amount: Math.abs(c.delta),
      kind: c.delta < 0 ? ('damage' as const) : ('heal' as const),
      x: c.unit.pos.x,
      y: c.unit.pos.y,
    }));
    setFloaters((f) => [...f, ...spawned]);
    const ids = new Set(spawned.map((f) => f.id));
    window.setTimeout(() => setFloaters((f) => f.filter((n) => !ids.has(n.id))), FLOATER_MS);
  }

  /**
   * Strike toward a target. A character with an attack animation plays it; one
   * with only a badge gets the lunge instead, since a static icon needs some
   * motion to register as an attack.
   */
  function lunge(id: string, from: Pos, to: Pos) {
    // Art is drawn facing right, so a target to the LEFT needs a mirror.
    if (to.x !== from.x) setFacing((f) => ({ ...f, [id]: to.x < from.x ? -1 : 1 }));

    const dist = Math.max(1, manhattan(from, to));
    setPulse({ id, dx: (to.x - from.x) / dist, dy: (to.y - from.y) / dist });
    window.setTimeout(() => setPulse(null), 340);
  }

  function chooseAbility(a: Ability) {
    // Clicking the selected ability again clears it.
    if (sel.ability?.name === a.name) {
      setSel((s) => ({ ...s, ability: null, dice: [] }));
      setAim(null);
      return;
    }
    // Dice are the gate. An ability the current selection does not cover is not
    // reachable -- the button is disabled, and this guard means no other caller
    // can slip past it either. Nothing here touches `dice`: what you picked is
    // what gets spent.
    if (!matched.has(a.name)) return;

    setSel((s) => ({ ...s, ability: a }));
    setAim(null);
    setError(null);
  }

  function toggleDie(i: number) {
    if (battle.diceSpent[i]) return;
    // Updater form, not a read of `sel`: several toggles can land in one React
    // batch, and reading the closed-over selection would make all but the first
    // compute from stale dice.
    setSel((s) => ({
      ...s,
      dice: s.dice.includes(i) ? s.dice.filter((d) => d !== i) : [...s.dice, i],
      // A chosen ability can never survive a die toggle, so this is unconditional
      // rather than a re-check: every die is 1-6, so adding or removing one always
      // shifts the total, and a wildcard needs exactly one die so it always moves
      // off that count too. Dropping it beats leaving a half-funded action staged.
      ability: null,
    }));
    setAim(null);
    setError(null);
  }

  function handleTile(p: Pos) {
    // The click that ends a drag must not also act on whatever is underneath.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (busy) return;
    const k = key(p);

    if (inspect) {
      setMarked((prev) => (prev.includes(k) ? prev.filter((m) => m !== k) : [...prev, k]));
      setCopiedTiles(false);
      return;
    }

    if (over) return;
    const occupant = unitAt(battle, p);

    // First click on a valid target aims and shows the blast; second fires.
    if (sel.unit && sel.ability && targets.has(k)) {
      if (!aim || !samePos(aim, p)) {
        setAim(p);
        setError(null);
        return;
      }
      const from = actingFrom ?? sel.unit.pos;
      const origin = { ...sel.unit.pos };
      const actor = sel.unit;
      const held: { err: string | null } = { err: null };
      withHitReactions(() => {
        held.err = commitAction(battle, actor, sel.ability!, sel.dice, from, p);
      });
      const err = held.err;
      if (err) setError(err);
      else {
        const travel = glide(actor.def.id, origin, actor.pos);
        window.setTimeout(() => lunge(actor.def.id, actor.pos, p), travel);
        setSel(NO_SELECTION);
        setPreview(null);
        setAim(null);
        bump();
      }
      return;
    }

    // Click the staged tile a second time to actually move there. This spends
    // only the character's movement -- its action stays available.
    if (sel.unit && !sel.ability && sel.movePos && samePos(sel.movePos, p)) {
      handleCommitMove();
      return;
    }

    // First click on a reachable tile just stages the destination. The chosen
    // ability is kept, so you can pick a dash attack and then aim the dash.
    if (sel.unit && sel.unit.side === 'player' && reachable.has(k)) {
      setSel((s) => ({ ...s, movePos: p }));
      setAim(null);
      setError(null);
      return;
    }

    if (occupant) {
      selectUnit(occupant);
      return;
    }

    // Clicking empty ground that is not a legal move or target cancels. An
    // aiming mis-click only drops the ability, so a fumbled shot does not also
    // cost you the character selection.
    if (sel.unit) {
      if (sel.ability && rangeTiles.has(k)) {
        setSel((cur) => ({ ...cur, ability: null, dice: [] }));
      } else {
        setSel(NO_SELECTION);
      }
      setAim(null);
      setPreview(null);
      setError(null);
    }
  }

  /**
   * Spend the character's movement. It keeps its action, so the unit stays
   * selected and its ability list stays live.
   */
  function handleCommitMove() {
    if (!sel.unit || !sel.movePos) return;
    const origin = { ...sel.unit.pos };
    const mover = sel.unit;
    const err = commitMove(battle, mover, sel.movePos);
    if (err) setError(err);
    else {
      glide(mover.def.id, origin, mover.pos);
      setSel((s) => ({ ...s, movePos: null, ability: null, dice: [] }));
      setError(null);
      bump();
    }
  }

  /**
   * Hand over to the enemy, then play their phase out one character at a time so
   * you can actually follow what each of them decided. Resolving the whole phase
   * at once made it impossible to tell what had happened.
   */
  function handleEndPhase() {
    if (busy) return;
    setSel(NO_SELECTION);
    setAim(null);
    setError(null);
    startEnemyPhase(battle);
    setBusy(true);
    bump();
    enemyTimer.current = window.setTimeout(stepEnemy, 420);
  }

  function stepEnemy() {
    const before = new Map(battle.units.map((u) => [u.def.id, { ...u.pos }]));
    const held: { step: ReturnType<typeof nextAiStep> } = { step: null };
    withHitReactions(() => {
      held.step = nextAiStep(battle);
    });
    const step = held.step;

    if (!step) {
      finishEnemyPhase(battle);
      setBusy(false);
      setNarration(null);
      bump();
      if (battle.outcome === 'ongoing' && battle.phase === 'player') {
        playDiceRoll(battle.dice);
        focusLineupLeader();
      }
      return;
    }

    const origin = before.get(step.unit.def.id) ?? step.unit.pos;
    focusCamera(step.unit.def.id);
    const travel = glide(step.unit.def.id, origin, step.unit.pos);

    if (step.kind === 'act' && step.target) {
      const target = step.target;
      const actor = step.unit;
      window.setTimeout(() => lunge(actor.def.id, actor.pos, target), travel);
      setNarration(`${step.unit.def.name} — ${step.ability?.name ?? 'acts'}`);
    } else {
      setNarration(`${step.unit.def.name} moves`);
    }
    bump();
    enemyTimer.current = window.setTimeout(
      stepEnemy,
      travel + (step.kind === 'act' ? 700 : 260),
    );
  }

  const diceSum = sel.dice.reduce((a, i) => a + battle.dice[i]!, 0);
  /**
   * The hero whose dice-first selection is in progress: one is selected, still
   * has its action, and the player has picked dice but not yet an ability.
   * Carried as the unit rather than a boolean so the hint can name it.
   */
  const diceOnly =
    !sel.ability && sel.dice.length > 0 && sel.unit?.side === 'player' && !sel.unit.hasActed
      ? sel.unit
      : null;
  /**
   * A hero is up but no dice are picked, so every ability is greyed out. Without
   * a prompt the panel just looks broken, so say what unlocks it.
   */
  const awaitingDice =
    !over && sel.dice.length === 0 && sel.unit?.side === 'player' && !sel.unit.hasActed;
  /** Rules text follows the hovered ability, falling back to the chosen one. */
  const shownAbility = preview ?? sel.ability;
  const staged = sel.unit != null && sel.movePos != null && !samePos(sel.movePos, sel.unit.pos);
  /** The next upgrade tier for the selected character, if any remain. */
  const nextTier =
    sel.unit && sel.unit.side === 'player'
      ? (sel.unit.def.upgrades ?? [])[sel.unit.upgrades]
      : undefined;
  const upgradeMasks = nextTier ? masksFor({ cost: nextTier.cost } as Ability) : [];
  /** The dice in hand cover the next upgrade tier -- same gate as an ability. */
  const upgradeReady = nextTier != null && upgradeMasks.length > 0 && diceCover(nextTier.cost);

  function handleUpgrade() {
    if (!sel.unit || !nextTier || upgradeMasks.length === 0) return;
    // An upgrade spends dice and the character's action exactly like casting
    // does, so it obeys the same gate: the dice you picked are the dice it
    // spends, and it is unreachable until they cover the tier.
    if (!diceCover(nextTier.cost)) return;

    const err = commitUpgrade(battle, sel.unit, sel.dice);
    if (err) setError(err);
    else {
      setSel(NO_SELECTION);
      setPreview(null);
      setAim(null);
      bump();
    }
  }

  const players = livingOf(battle, 'player');
  const enemies = livingOf(battle, 'enemy');

  return (
    <div className="game">
      {/* The board fills the screen; everything else floats over it. */}
      <div
        className="viewport"
        ref={viewportRef}
        onMouseDown={onPanStart}
        onMouseMove={onPanMove}
        onMouseUp={onPanEnd}
        onWheel={onWheel}
        onMouseLeave={() => {
          onPanEnd();
          setHover(null);
        }}
      >
        <div
          className={`world ${smoothCam ? 'smooth' : ''}`}
          style={{
            transform: `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <div
            className={`grid ${map.image ? 'imaged' : ''}`}
            style={
              {
                gridTemplateColumns: `repeat(${map.width}, var(--tile))`,
                '--tile': `${tile}px`,
                ...(map.image
                  ? { backgroundImage: `url("${map.image}")`, backgroundSize: '100% 100%' }
                  : {}),
              } as CSSProperties
            }
          >
            {map.tiles.flatMap((row, y) =>
              row.map((terrain, x) => {
                const p = { x, y };
                const k = key(p);
                const occupant = unitAt(battle, p);
                const isGhost = sel.movePos != null && sel.movePos.x === x && sel.movePos.y === y;

                const classes = ['tile', terrain];
                if (occupant) classes.push('occupied');
                if (!Number.isFinite(TERRAIN[terrain].moveCost)) classes.push('blocked');
                if (reachable.has(k) && !occupant && showMoveRange) classes.push('reach');
                if (rangeTiles.has(k)) classes.push('in-range');
                if (targets.has(k)) classes.push('target');
                if (aim && samePos(aim, p)) classes.push('aimed');
                if (blocked.has(k)) classes.push('noLos');
                if (splash.has(k)) {
                  classes.push('splash');
                  if (sel.ability) classes.push(`splash-${sel.ability.kind}`);
                }
                if (danger.has(k)) classes.push('danger');
                if (marked.includes(k)) classes.push('marked');
                if (sel.unit && occupant === sel.unit) classes.push('selected');

                return (
                  <div
                    key={k}
                    className={classes.join(' ')}
                    onClick={() => handleTile(p)}
                    onMouseEnter={() => setHover(p)}
                  >
                    {isGhost && !occupant && <div className="ghost" />}
                  </div>
                );
              }),
            )}

            <div className="edge-fade" />

            {/* Units live above the tiles so a position change can be animated. */}
            <div className="units" style={{ width: map.width * tile, height: map.height * tile }}>
              {battle.units.filter(alive).map((u) => {
                const at = walk[u.def.id] ?? u.pos;
                return (
                  <div
                    key={u.def.id}
                    data-unit={u.def.id}
                    className={`unit-slot ${pulse?.id === u.def.id ? 'striking' : ''} ${
                      walk[u.def.id] ? 'walking' : ''
                    }`}
                    style={
                      {
                        width: tile,
                        height: tile,
                        transform: `translate(${at.x * tile}px, ${at.y * tile}px)`,
                        // Painter's order: characters further down the board draw
                        // over those behind them, so a tall sprite is never
                        // clipped by whoever stands on the tile above it.
                        zIndex: (walk[u.def.id] ? 500 : 100) + at.y,
                        '--step': `${stepMs}ms`,
                        '--px': `${(pulse?.id === u.def.id ? pulse.dx : 0) * tile * 0.34}px`,
                        '--py': `${(pulse?.id === u.def.id ? pulse.dy : 0) * tile * 0.34}px`,
                      } as CSSProperties
                    }
                  >
                    <UnitChip
                      key={hits[u.def.id] ?? 0}
                      unit={u}
                      map={battle.map}
                      phase={battle.phase}
                      tile={tile}
                      facing={facing[u.def.id] ?? 1}
                      hit={hits[u.def.id] ?? 0}
                    />
                    {u.pending && <span className="casting">!</span>}
                  </div>
                );
              })}
              {floaters.map((f) => (
                <span
                  key={f.id}
                  className={`floater ${f.kind}`}
                  style={{
                    width: tile,
                    transform: `translate(${f.x * tile}px, ${f.y * tile}px)`,
                  }}
                >
                  {f.kind === 'damage' ? `-${f.amount}` : `+${f.amount}`}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- HUD, floating over the board ---------------- */}

      <div className="hud hud-top">
        <div className="panel bar">
          <strong className="title">Rollbound</strong>
          <span className="dim">{map.name}</span>
          <span className={battle.phase === 'player' ? 'phase you' : 'phase foe'}>
            {battle.phase === 'player' ? 'Your phase' : 'Enemy phase'}
          </span>
          <span className="dim">
            Turn {battle.turn}/{MAX_TURNS}
          </span>
          <TileReadout map={map} pos={hover} />
        </div>
        <div className="panel bar">
          <select value={mapIndex} onChange={(e) => restart(seed, Number(e.target.value))}>
            {MAPS.map((m, i) => (
              <option key={m.name} value={i}>
                {m.name}
              </option>
            ))}
          </select>
          <button onClick={onExit}>Home</button>
          <button onClick={frameBoard}>Recentre</button>
          <button onClick={() => setShowLog(true)}>Show log</button>
          <button className={inspect ? 'primary' : ''} onClick={() => setInspect((v) => !v)}>
            {inspect ? 'Inspecting' : 'Inspect'}
          </button>
          <button onClick={() => setEditing(true)}>Terrain</button>
        </div>
      </div>

      <div className="hud hud-left">
        <TeamPanel
          title={`Your team (${players.length}/5)`}
          units={battle.units.filter((u) => u.side === 'player')}
          selected={sel.unit}
          onSelect={selectUnit}
          map={battle.map}
        />
        <TeamPanel
          title={`Enemies (${enemies.length}/5)`}
          units={battle.units.filter((u) => u.side === 'enemy')}
          selected={sel.unit}
          onSelect={selectUnit}
          map={battle.map}
        />
        {(inspect || marked.length > 0) && (
          <MarkedTiles
            map={map}
            marked={marked}
            copied={copiedTiles}
            onCopy={setCopiedTiles}
            onClear={() => {
              setMarked([]);
              setCopiedTiles(false);
            }}
          />
        )}
      </div>

      {sel.unit && (
        <div className="hud hud-right">
          <div className="panel detail">
            <h3 className="portrait-head">
              {sel.unit.def.sprite ? (
                <SpritePortrait sheet={sel.unit.def.sprite} height={54} />
              ) : (
                <Avatar def={sel.unit.def} size={40} side={sel.unit.side} />
              )}
              <span className="who">{sel.unit.def.name}</span>
              <span className="stars">{'★'.repeat(sel.unit.def.rarity)}</span>
            </h3>
            <div className="stat-row">
              <span>
                HP {sel.unit.hp}/{unitMaxHp(sel.unit)}
              </span>
              <span>ATK {unitAttack(sel.unit)}</span>
              <span>DEF {effectiveDefense(sel.unit, battle.map)}</span>
              <span>MOV {unitMove(sel.unit)}</span>
              {sel.unit.upgrades > 0 && (
                <span className="boosted">
                  +{Math.round((statScale(sel.unit) - 1) * 100)}%
                </span>
              )}
            </div>
            <div className="terrain-note">
              {ROLE_LABEL[sel.unit.def.role]} · {sel.unit.def.element} · on{' '}
              {TERRAIN[terrainAt(battle.map, sel.unit.pos)].name}
            </div>

            {sel.unit.side === 'player' && !over && (
              <div className="turn-state">
                <span className={sel.unit.hasMoved ? 'used' : 'left'}>
                  {sel.unit.hasMoved ? 'move spent' : 'move available'}
                </span>
                <span className={sel.unit.hasActed ? 'used' : 'left'}>
                  {sel.unit.hasActed ? 'action spent' : 'action available'}
                </span>
              </div>
            )}

            {sel.unit.side === 'player' && staged && !sel.unit.hasMoved && !over && (
              <button className="wait" onClick={handleCommitMove}>
                Move here
              </button>
            )}

            {sel.unit.side === 'player' && !sel.unit.hasActed && !over && (
              <ul className="abilities">
                {sel.unit.def.abilities.map((a) => {
                  // Three states. `locked` is hopeless: no subset of this roll
                  // can pay for it at all. `ready` means the dice in hand cover
                  // it right now. Plain-but-disabled is the middle -- payable
                  // this roll, just not by what is currently selected.
                  const ok = affordable.get(a.name) ?? false;
                  const active = sel.ability?.name === a.name;
                  const ready = matched.has(a.name);
                  return (
                    // Hover lives on the <li>: disabled buttons swallow mouse events.
                    <li
                      key={a.name}
                      onMouseEnter={() => setPreview(a)}
                      onMouseLeave={() => setPreview(null)}
                    >
                      <button
                        className={`ability ${ok ? '' : 'locked'} ${active ? 'active' : ''} ${
                          ready ? 'ready' : ''
                        }`}
                        onClick={() => chooseAbility(a)}
                        disabled={!ready}
                        title={
                          !ok
                            ? `No dice in this roll can total ${a.cost}`
                            : !ready
                              ? a.wildcard
                                ? 'Select any single die'
                                : `Select dice totalling ${a.cost}`
                              : undefined
                        }
                      >
                        <span className="cost">{a.wildcard ? '✳' : a.cost}</span>
                        <span className="body">
                          <strong>{a.name}</strong>
                          <em>
                            {a.kind} · rng {a.range}
                            {a.aoeRadius ? ` · aoe ${a.aoeRadius}` : ''} ·{' '}
                            <span style={{ color: ELEMENT_COLOR[a.element] }}>{a.element}</span>
                          </em>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {sel.unit.side === 'player' && activePassives(sel.unit).length > 0 && (
              <div className="passive-list">
                {activePassives(sel.unit).map((pas, i) => (
                  <div key={`${pas.kind}-${i}`} className="kit-row passive">
                    <strong>{pas.kind}</strong>
                    <p>{describePassive(pas)}</p>
                  </div>
                ))}
              </div>
            )}

            {sel.unit.side === 'player' && !over && (
              <div className="upgrades">
                <div className="upgrade-track">
                  {(sel.unit.def.upgrades ?? []).map((t, i) => (
                    <span
                      key={t.name}
                      className={`pip-tier ${i < sel.unit!.upgrades ? 'on' : ''}`}
                      title={t.name}
                    />
                  ))}
                  <span className="dim">upgrades</span>
                </div>

                {nextTier ? (
                  <button
                    className={`upgrade-btn ${upgradeReady ? 'ready' : ''} ${
                      upgradeMasks.length === 0 ? 'locked' : ''
                    }`}
                    onClick={handleUpgrade}
                    disabled={sel.unit.hasActed || !upgradeReady}
                    title={
                      upgradeMasks.length === 0
                        ? `No dice combination totals ${nextTier.cost}`
                        : !upgradeReady
                          ? `Select dice totalling ${nextTier.cost}`
                          : undefined
                    }
                  >
                    <span className="cost">{nextTier.cost}</span>
                    <span className="body">
                      <strong>{nextTier.name}</strong>
                      <em>+10% stats · {describePassive(nextTier.passive)}</em>
                    </span>
                  </button>
                ) : (
                  <span className="dim">Fully upgraded</span>
                )}
              </div>
            )}

            {sel.unit.side === 'enemy' && (
              <div className="enemy-kit">
                {sel.unit.pending && (
                  <p className="incoming">
                    Casting <strong>{sel.unit.pending.ability.name}</strong> — lands next turn at{' '}
                    {sel.unit.pending.target.x},{sel.unit.pending.target.y}
                  </p>
                )}
                {sel.unit.def.abilities.map((a) => (
                  <div key={a.name} className="kit-row">
                    <strong>{a.name}</strong>
                    {(sel.unit!.cooldowns[a.name] ?? 0) > 0 && (
                      <em className="cd">{sel.unit!.cooldowns[a.name]}t</em>
                    )}
                    <p>{describeAbility(a)}</p>
                    {describeEnemyUsage(a) && <p className="sub">{describeEnemyUsage(a)}</p>}
                  </div>
                ))}
                {(sel.unit.def.passives ?? []).map((pas) => (
                  <div key={pas.kind} className="kit-row passive">
                    <strong>{pas.kind}</strong>
                    <p>{describePassive(pas)}</p>
                  </div>
                ))}
              </div>
            )}

            {shownAbility && (
              <div className="rules">
                <strong>{shownAbility.name}</strong>
                <p>{describeAbility(shownAbility)}</p>
                <p className="sub">{describeCost(shownAbility)}</p>
                {describeElement(shownAbility) && (
                  <p className="sub">{describeElement(shownAbility)}</p>
                )}
              </div>
            )}

            {sel.ability && focus && targets.has(key(focus)) && (
              <ForecastPanel battle={battle} source={sel.unit} ability={sel.ability} centre={focus} />
            )}
          </div>
        </div>
      )}

      <div className="hud hud-bottom">
        {narration && <div className="panel narration">{narration}</div>}

        <div className="panel tray">
          {battle.phase === 'player' && !busy ? (
            <DiceTray
              dice={battle.dice}
              spent={battle.diceSpent}
              selected={sel.dice}
              onToggle={toggleDie}
              disabled={over}
              roll={roll}
            />
          ) : (
            <div className="dice-placeholder">
              Enemies do not roll — they act on a fixed pattern.
            </div>
          )}

          <div className="controls">
            <button onClick={nextHero} disabled={over || busy}>
              Next hero
            </button>
            <button className="primary" onClick={handleEndPhase} disabled={over || busy}>
              {busy ? 'Enemy phase…' : 'End phase'}
            </button>
            <button onClick={() => restart(seed)}>Restart</button>
            <button onClick={() => restart(Math.floor(Math.random() * 100000))}>New seed</button>
          </div>

          {(sel.ability || staged || error || diceOnly || awaitingDice) && (
            <div className="hints">
              {/* Nothing picked yet: say what unlocks the panel. */}
              {awaitingDice && (
                <span className="hint">
                  Pick dice to choose an ability — an ability unlocks when your dice cover its cost
                </span>
              )}
              {/* Dice held, no ability chosen: the total, and whether anything takes it.
                  The upgrade counts -- it spends dice and the action just like a cast,
                  so reporting "nothing costs 6" while the 6-cost upgrade sits lit
                  would be plainly wrong. */}
              {diceOnly && (
                <span className={`hint ${matched.size > 0 || upgradeReady ? 'ok' : 'warn'}`}>
                  <strong>{diceSum}</strong>
                  {matched.size > 0
                    ? ` — ${matched.size} ${matched.size === 1 ? 'ability' : 'abilities'} ready${
                        upgradeReady && nextTier ? `, plus the ${nextTier.name} upgrade` : ''
                      }`
                    : upgradeReady && nextTier
                      ? ` — pays for the ${nextTier.name} upgrade`
                      : ` — ${diceOnly.def.name} has nothing costing ${diceSum}`}
                </span>
              )}
              {/* An ability can only be chosen once its dice cover it, so this is always paid. */}
              {sel.ability ? (
                <span className="hint ok">
                  <strong>
                    {sel.ability.wildcard ? '1 die' : `${diceSum} / ${sel.ability.cost}`}
                  </strong>
                  {aim ? ' — click that target again to fire' : ' — click a target to aim'}
                </span>
              ) : null}
              {sel.ability && blocked.size > 0 && (
                <span className="hint warn">
                  {blocked.size} target{blocked.size > 1 ? 's' : ''} behind cover — move for a clear
                  line
                </span>
              )}
              {!sel.ability && staged ? (
                <span className="hint">Click that tile again to move</span>
              ) : null}
              {error && <span className="error">{error}</span>}
            </div>
          )}
        </div>
      </div>

      {over && (
        <div className="hud hud-centre">
          <div className={`outcome ${battle.outcome}`}>
            {battle.outcome === 'victory'
              ? 'Victory'
              : battle.outcome === 'defeat'
                ? 'Defeat'
                : 'Draw — turn limit'}
          </div>
        </div>
      )}

      {showLog && (
        <div className="modal-backdrop" onClick={() => setShowLog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Battle log</strong>
              <button onClick={() => setShowLog(false)}>Close</button>
            </div>
            <LogPanel battle={battle} full />
          </div>
        </div>
      )}

      {editing && (
        <div className="editor-overlay">
          <TerrainEditor map={map} onClose={() => setEditing(false)} />
        </div>
      )}
    </div>
  );
}

/** Always-on coordinate + terrain readout for whatever tile is under the cursor. */
function TileReadout({ map, pos }: { map: BattleState['map']; pos: Pos | null }) {
  if (!pos) return <div className="readout dim">Hover a tile to see its coordinates</div>;
  const t = TERRAIN[terrainAt(map, pos)];
  return (
    <div className="readout">
      <strong>
        {pos.x},{pos.y}
      </strong>
      <span>{t.name}</span>
      <span>{Number.isFinite(t.moveCost) ? `move ${t.moveCost}` : 'impassable'}</span>
      {t.defBonus > 0 && <span>+{t.defBonus} def</span>}
      {t.blocksSight && <span className="warn">blocks sight</span>}
    </div>
  );
}

function MarkedTiles({
  map,
  marked,
  copied,
  onCopy,
  onClear,
}: {
  map: BattleState['map'];
  marked: string[];
  copied: boolean;
  onCopy: (v: boolean) => void;
  onClear: () => void;
}) {
  const lines = marked.map((k) => {
    const [x, y] = k.split(',').map(Number);
    return `${x},${y} — ${TERRAIN[terrainAt(map, { x: x!, y: y! })].name}`;
  });

  return (
    <div className="marked-panel">
      <div className="marked-head">
        <strong>{marked.length} tile{marked.length === 1 ? '' : 's'} marked</strong>
        <button
          onClick={() => {
            navigator.clipboard.writeText(lines.join('\n')).then(
              () => onCopy(true),
              () => onCopy(false),
            );
          }}
          disabled={marked.length === 0}
        >
          {copied ? 'Copied' : 'Copy list'}
        </button>
        <button onClick={onClear} disabled={marked.length === 0}>
          Clear
        </button>
      </div>
      {marked.length === 0 ? (
        <span className="dim">Click any tile to add its coordinates.</span>
      ) : (
        <pre>{lines.join('\n')}</pre>
      )}
    </div>
  );
}

/** Headshot for panels, where the full figure would be too small to read. */
function SpritePortrait({ sheet, height }: { sheet: SpriteSheet; height: number }) {
  return (
    <img
      className="portrait"
      src={sheet.icon ?? sheet.src}
      alt=""
      draggable={false}
      style={{ height, width: height, flex: 'none' }}
    />
  );
}

function bits(mask: number): number {
  let c = 0;
  while (mask) {
    mask &= mask - 1;
    c++;
  }
  return c;
}

function UnitChip({
  unit,
  map,
  phase,
  tile,
  facing,
  hit,
}: {
  unit: Unit;
  map: BattleState['map'];
  phase: Unit['side'];
  tile: number;
  facing: number;
  hit: number;
}) {
  const pct = (unit.hp / unitMaxHp(unit)) * 100;
  // Only grey out the side whose turn it is; the idle side's flags are stale.
  const spent =
    unit.side !== phase ? '' : unit.hasMoved && unit.hasActed ? 'acted' : unit.hasMoved || unit.hasActed ? 'partial' : '';
  const sheet = unit.def.sprite;
  const title = `${unit.def.name} · ${unit.hp}/${unitMaxHp(unit)} hp · def ${effectiveDefense(unit, map)}`;
  const hp = (
    <span className="hpbar">
      <span
        style={{
          width: `${pct}%`,
          background: pct > 50 ? '#4ec97a' : pct > 25 ? '#e0b64a' : '#e05a5a',
        }}
      />
    </span>
  );

  // A sprite carries no side colour of its own, so it stands on a tinted base
  // that keeps ally-vs-enemy readable at a glance.
  if (sheet) {
    const h = tile * sheet.scale;
    const w = h * sheet.aspect;
    // Plant the character's feet on the middle of the tile. Centring the image
    // would offset him, since his sword pushes its centre sideways.
    const left = tile / 2 - w * sheet.anchorX;

    return (
      <div className={`unit sprite-unit ${unit.side} ${spent} ${hit ? 'hurt' : ''}`} title={title}>
        <span className={`base ${unit.side}`} style={{ width: tile * 0.72, height: tile * 0.28 }} />
        <img
          className="sprite"
          src={sheet.src}
          alt=""
          draggable={false}
          style={{
            width: w,
            height: h,
            left,
            bottom: 0,
            // Mirror about his feet so flipping does not shift his footing.
            transform: `scaleX(${facing})`,
            transformOrigin: `${w * sheet.anchorX}px bottom`,
          }}
        />
        {hp}
      </div>
    );
  }

  return (
    <div
      className={`unit ${unit.side} ${spent} ${hit ? 'hurt' : ''}`}
      style={{ borderColor: ELEMENT_COLOR[unit.def.element] }}
      title={title}
    >
      <Avatar def={unit.def} size={40} side={unit.side} />
      {hp}
    </div>
  );
}

function DiceTray({
  dice,
  spent,
  selected,
  onToggle,
  disabled,
  roll,
}: {
  dice: number[];
  spent: boolean[];
  selected: number[];
  /** True while `selected` is an auto-filled suggestion rather than your choice. */
  onToggle: (i: number) => void;
  disabled: boolean;
  roll: { phase: 'pending' | 'tumbling' | 'settled'; face: number }[] | null;
}) {
  return (
    <div className="dice">
      {dice.map((v, i) => {
        const anim = roll?.[i];
        // While a die is in the air it shows a random face, not its real value.
        const face = anim && anim.phase !== 'settled' ? anim.face : v;
        const locked = anim !== undefined && anim.phase !== 'settled';
        return (
          <button
            key={i}
            className={`die ${spent[i] ? 'spent' : ''} ${
              selected.includes(i) ? 'picked' : ''
            } ${anim ? anim.phase : ''}`}
            onClick={() => onToggle(i)}
            disabled={disabled || spent[i] || locked}
          >
            <span className="pip">{DIE_PIPS[face]}</span>
            <span className="val">{anim && anim.phase !== 'settled' ? ' ' : v}</span>
          </button>
        );
      })}
    </div>
  );
}

function TeamPanel({
  title,
  units,
  selected,
  onSelect,
  map,
}: {
  title: string;
  units: Unit[];
  selected: Unit | null;
  onSelect: (u: Unit) => void;
  map: BattleState['map'];
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <ul className="roster">
        {units.map((u) => (
          <li key={u.def.id}>
            <button
              className={`row ${selected === u ? 'on' : ''} ${alive(u) ? '' : 'dead'}`}
              onClick={() => onSelect(u)}
            >
              {u.def.sprite?.icon ? (
                <img className="row-icon" src={u.def.sprite.icon} alt="" draggable={false} />
              ) : (
                <Avatar def={u.def} size={26} side={u.side} />
              )}
              <span className="nm">{u.def.name}</span>
              <span className="hp">
                {alive(u) ? `${u.hp}/${u.def.maxHp}` : 'down'}
                {u.atkBuff > 0 && <span className="buff"> +{u.atkBuff}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shows exactly what the hovered target would take, before committing. */
function ForecastPanel({
  battle,
  source,
  ability,
  centre,
}: {
  battle: BattleState;
  source: Unit;
  ability: Ability;
  centre: Pos;
}) {
  const pool = livingOf(battle, ability.kind === 'attack' ? 'enemy' : 'player');
  const hit = unitsHit(ability, centre, pool);
  if (hit.length === 0) return null;

  return (
    <div className="forecast">
      {hit.map((t) => {
        if (ability.kind === 'attack') {
          const dmg = computeDamage(source, ability, t, battle.map);
          const lethal = dmg >= t.hp;
          return (
            <div key={t.def.id} className={lethal ? 'line lethal' : 'line'}>
              {t.def.name} <strong>-{dmg}</strong>
              {lethal ? ' (lethal)' : ` → ${t.hp - dmg} hp`}
            </div>
          );
        }
        if (ability.kind === 'heal') {
          const amt = Math.min(ability.power, t.def.maxHp - t.hp);
          return (
            <div key={t.def.id} className="line heal">
              {t.def.name} <strong>+{amt}</strong>
            </div>
          );
        }
        return (
          <div key={t.def.id} className="line buff">
            {t.def.name} <strong>+{ability.power} atk</strong>
          </div>
        );
      })}
    </div>
  );
}

function LogPanel({ battle, full = false }: { battle: BattleState; full?: boolean }) {
  const lines = (full ? battle.log : battle.log.slice(-14)).map((e) => {
    switch (e.t) {
      case 'roll':
        return `— turn ${e.turn} ${e.side === 'player' ? 'you' : 'enemy'}: [${e.dice.join(' ')}]`;
      case 'move':
        return `  ${e.unit} → (${e.to.x},${e.to.y})`;
      case 'act':
        return `  ${e.actor}: ${e.ability} (${e.dice.join('+')})`;
      case 'damage':
        return `      -${e.amount} ${e.target}${e.matchup ? ` ${e.matchup}` : ''}`;
      case 'heal':
        return `      +${e.amount} ${e.target}`;
      case 'buff':
        return `      +${e.amount} atk ${e.target}`;
      case 'ko':
        return `      ✖ ${e.unit} down`;
      case 'end':
        return `  ${e.outcome.toUpperCase()} in ${e.turns} turns`;
    }
  });
  return (
    <div className="card log">
      <h3>Battle log</h3>
      <pre>{lines.join('\n')}</pre>
    </div>
  );
}
