import { useEffect, useMemo, useRef, useState } from 'react';
import { SCENERY_IMAGES } from '../../engine/sprites.generated.ts';
import type { StageLayer } from '../../engine/formation.ts';
import { DOWNSTAGE, PARTY_SLOTS_ALL, STANDARD_ENEMY_SLOTS } from '../../engine/formation.ts';
import type { Slot } from '../../engine/formation.ts';
import { SCENE_IDS, SCENES, sceneActs } from '../sceneData.ts';
import { FRAME_ASPECT, REST_EYE, REST_ZOOM, visibleBand } from '../camera.ts';
import { LayerImg } from '../stageLayer.tsx';

/**
 * Compose a battle scene by dragging its pieces around.
 *
 * Every position in a stage is a percentage of a box you cannot see while you
 * are typing it, and the pieces arrive unregistered -- each drawn on its own
 * canvas with its own margins -- so there is no arithmetic that gets a set
 * right. Laying one out by editing numbers in a source file and reloading was
 * costing a screenshot per nudge. This is the same edit with the picture in
 * front of you.
 *
 * Deliberately shows the CAST as boxes. The point of a stage is where people
 * stand on it, so a layout judged without them is judged against the wrong
 * thing -- a tree that looks well placed on an empty stage is the tree the
 * front rank is standing inside.
 */

const PROPS = SCENERY_IMAGES.filter((s) => s.includes('/paper_stage/'));
const nameOf = (src: string) => src.split('/').pop()!.replace(/\.png$/, '');

/** Pin a layer by whichever edge it already uses, so dragging keeps its intent. */
/*
 * Which layer did that click actually land on?
 *
 * Box hit-testing is wrong here and was making half the set unselectable. Every
 * layer is a rectangular <img>, but the art inside is mostly transparent -- the
 * boards are a 955x499 image of which the top two thirds is empty sky, and it
 * sits above the clouds and the birds. Clicking a cloud handed you the boards,
 * every time, and the only way to reach the cloud was to hunt for it in the
 * layer list.
 *
 * So the pick is made on the ALPHA CHANNEL: walk the layers front to back and
 * take the first one that has a visible pixel under the cursor. That is what
 * "click the thing you can see" means, and it is the only rule that behaves
 * sensibly once props start overlapping.
 *
 * The per-image sample is cached. Decoding is the expensive part and the art
 * does not change while the lab is open, so each image pays once.
 */
const alphaCache = new Map<string, { w: number; h: number; a: Uint8ClampedArray } | null>();

function alphaAt(img: HTMLImageElement, u: number, v: number): number | null {
  const key = img.currentSrc || img.src;
  let entry = alphaCache.get(key);
  if (entry === undefined) {
    entry = null;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w && h) {
      try {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          entry = { w, h, a: ctx.getImageData(0, 0, w, h).data };
        }
      } catch {
        // A tainted canvas would throw. Scenery is same-origin so this should
        // not happen, but a null entry falls back to box hit-testing rather
        // than making the layer unclickable.
        entry = null;
      }
    }
    alphaCache.set(key, entry);
  }
  if (!entry) return null;
  const px = Math.min(entry.w - 1, Math.max(0, Math.floor(u * entry.w)));
  const py = Math.min(entry.h - 1, Math.max(0, Math.floor(v * entry.h)));
  return entry.a[(py * entry.w + px) * 4 + 3] ?? 0;
}

/** Ignore near-invisible pixels: soft edges should not be grab handles. */
const ALPHA_FLOOR = 24;

function moveLayer(l: StageLayer, dxPct: number, dyPct: number): StageLayer {
  const next = { ...l };
  if (l.right != null) next.right = +(l.right - dxPct).toFixed(2);
  else next.x = +((l.x ?? 0) + dxPct).toFixed(2);
  if (l.bottom != null) next.bottom = +(l.bottom - dyPct).toFixed(2);
  else next.y = +((l.y ?? 0) + dyPct).toFixed(2);
  return next;
}

/*
 * The band of the frame the battle actually shows at rest.
 *
 * Module scope because it never varies: the zoom and the eye are constants, so
 * this is one calculation for the life of the app rather than one per render.
 */
const restBand = visibleBand(REST_ZOOM, REST_EYE.y);

/*
 * Turning that band into a preview of the battle screen.
 *
 * The lab composes against the whole 16:9 frame; the game rests at `REST_ZOOM`
 * and keeps only `restBand` of its height, full width. So a faithful preview is
 * that band, blown up until it fills the viewport -- which makes the preview
 * itself wider than 16:9 by exactly the fraction being cropped away, and lands
 * it on the ~3:1 shape the battle's stage cell actually is.
 *
 * Derived from the shared camera constants, so changing the resting zoom
 * changes the preview with it rather than leaving a second thing to remember.
 */
const bandHeight = restBand.to - restBand.from;
const PREVIEW = {
  aspect: FRAME_ASPECT / bandHeight,
  /** The frame's height, as a percentage of the preview viewport's. */
  scale: (1 / bandHeight) * 100,
  /** How far to lift it so the band's top edge meets the viewport's. */
  offset: -(restBand.from / bandHeight) * 100,
};

export function StageLab() {
  const [sceneId, setSceneId] = useState(SCENE_IDS[0] ?? 'curtain_call');
  const [layers, setLayers] = useState<StageLayer[]>(
    () => (SCENES[SCENE_IDS[0] ?? '']?.layers ?? []).map((l) => ({ ...l })),
  );
  const [sel, setSel] = useState<number | null>(null);
  /*
   * The selected MARK, kept apart from the selected layer.
   *
   * Two separate selections rather than one tagged union because `sel` is read
   * in a dozen places that all mean "the layer being edited", and widening it
   * would touch every one of them to say the same thing. Only one of the pair
   * is ever set; picking either clears the other.
   */
  const [markSel, setMarkSel] = useState<{ side: 'player' | 'enemy'; i: number } | null>(null);
  /**
   * The marks, editable alongside the scenery.
   *
   * A stage and the places people stand on it are one decision: a set with a
   * raised platform wants its front rank on the platform, and nudging the
   * scenery without being able to nudge the cast just moves the problem. Seeded
   * from the defaults so a scene that has never touched them still opens on
   * something sensible.
   */
  const [board, setBoard] = useState<Slot[]>(() =>
    (SCENES[SCENE_IDS[0] ?? '']?.board ?? PARTY_SLOTS_ALL).map((x) => ({ ...x })),
  );
  const [foes, setFoes] = useState<Slot[]>(() =>
    (SCENES[SCENE_IDS[0] ?? '']?.enemy ?? STANDARD_ENEMY_SLOTS).map((x) => ({ ...x })),
  );
  /*
   * The scene's own identity, editable rather than fixed to the dropdown.
   *
   * The lab could only ever open an EXISTING file and write back over it, so
   * building a second set meant destroying the first. `sceneId` is now just a
   * filename you can type, and saving under one that does not exist yet creates
   * it -- which is the whole of "new scene".
   */
  const [sceneName, setSceneName] = useState(SCENES[SCENE_IDS[0] ?? '']?.name ?? 'Curtain Call');
  const [stageFrom, setStageFrom] = useState<number | ''>(
    SCENES[SCENE_IDS[0] ?? '']?.stages?.[0] ?? '',
  );
  const [stageTo, setStageTo] = useState<number | ''>(
    SCENES[SCENE_IDS[0] ?? '']?.stages?.[1] ?? '',
  );
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showCast, setShowCast] = useState(true);
  /*
   * The acting marks, now part of the scene rather than a pair of constants.
   *
   * Seeded from the scene if it has them and from `DOWNSTAGE` if not, so a
   * scene that has never touched them opens on the same positions the game
   * would use anyway -- and dragging one is what turns the default into an
   * override.
   */
  const [acts, setActs] = useState<{ player: { x: number; y: number }; enemy: { x: number; y: number } }>(
    () => structuredClone(sceneActs(SCENE_IDS[0] ?? '') ?? DOWNSTAGE),
  );
  const [safeArea, setSafeArea] = useState(true);
  /*
   * Guides: the middle of the stage, and the two marks a Performer walks out to.
   *
   * Both are things the scene is composed AGAINST but has no way of showing.
   * Centre is where the two formations meet and where a prop will sit between
   * them; the acting marks are where a character actually stands while their
   * ability plays, which is the one position guaranteed to be looked at closely
   * and the one most likely to have a bush growing through it.
   */
  const [guides, setGuides] = useState(true);
  /*
   * Preview: the set as the battle frames it, rather than as it is authored.
   *
   * A mode rather than a separate screen, because the point is to flip back and
   * forth against the same composition -- the question it answers is "is that
   * bush inside the shot", and you want the answer without losing your place.
   */
  const [preview, setPreview] = useState(false);
  const [zoom, setZoom] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<
    { kind: 'layer' | 'player' | 'enemy' | 'act'; i: number; x: number; y: number; side?: 'player' | 'enemy' } | null
  >(null);

  /*
   * Undo, as a stack of whole-document snapshots.
   *
   * A scene is a few dozen small numbers, so copying all of them is cheaper
   * than describing what changed -- and a snapshot cannot disagree with the
   * document the way a hand-written inverse of each edit eventually does.
   *
   * Recorded by WATCHING the document rather than by calling a mark() at every
   * mutation. There are a dozen ways to change a scene here and the next one
   * added would silently not be undoable, which is the worst kind of bug in an
   * undo system: it looks like it works.
   *
   * The delay is what makes a drag one step instead of two hundred. Pointer
   * moves land continuously, each one restarting the timer, so the snapshot
   * that finally gets taken is the state from BEFORE the gesture began -- which
   * is exactly what one ctrl+Z should return you to.
   */
  /*
   * Undo, as a stack of whole-document snapshots.
   *
   * A scene is a few dozen small numbers, so copying all of them is cheaper
   * than describing what changed -- and a snapshot cannot disagree with the
   * document the way a hand-written inverse of each edit eventually does.
   *
   * Recorded by WATCHING the document rather than by calling a mark() at every
   * mutation. There are a dozen ways to change a scene here and the next one
   * added would silently not be undoable, which is the worst kind of bug in an
   * undo system: it looks like it works.
   *
   * Snapshots are JSON, and the comparison is by VALUE. This is not a detail --
   * the first version held objects and compared identity, which quietly broke
   * it: React does not promise a `useMemo` keeps the same reference between
   * renders, and in development it deliberately recomputes them. Every
   * recompute looked like an edit, so the stack filled with copies of the state
   * already on screen and the first ctrl+Z restored the scene to where it
   * already was. Strings cannot lie about whether anything changed.
   *
   * The delay is what makes a drag one step instead of two hundred. Pointer
   * moves land continuously, each one restarting the timer, so the snapshot
   * that finally gets taken is the state from BEFORE the gesture began -- which
   * is exactly what one ctrl+Z should return you to.
   */
  const docJson = useMemo(
    () => JSON.stringify({ layers, board, foes, acts }),
    [layers, board, foes, acts],
  );
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const settled = useRef(docJson);
  // Set while undo/redo is applying, so restoring a snapshot is not itself
  // recorded as an edit -- without it, one undo would push the state it just
  // left onto the stack and the next undo would bring it straight back.
  const replaying = useRef(false);

  useEffect(() => {
    if (replaying.current) {
      replaying.current = false;
      settled.current = docJson;
      return;
    }
    if (docJson === settled.current) return;
    const t = window.setTimeout(() => {
      const was = settled.current;
      settled.current = docJson;
      setPast((p) => [...p, was].slice(-100));
      setFuture([]);
    }, 350);
    return () => window.clearTimeout(t);
  }, [docJson]);

  function apply(json: string) {
    const next = JSON.parse(json) as {
      layers: StageLayer[];
      board: Slot[];
      foes: Slot[];
      acts: typeof acts;
    };
    replaying.current = true;
    settled.current = json;
    setLayers(next.layers);
    setBoard(next.board);
    setFoes(next.foes);
    setActs(next.acts);
    setSel(null);
    setDirty(true);
  }

  /*
   * Read the stacks straight out of the render closure rather than through the
   * updater form.
   *
   * These looked like the textbook case for `setPast(p => ...)`, but the other
   * half of the move -- pushing onto the redo stack and applying the snapshot --
   * is a side effect, and React calls an updater more than once in development
   * to catch exactly that. It duly ran everything twice: one ctrl+Z put two
   * entries on the redo stack and left the scene where it was.
   *
   * Both handlers only ever run from a real user gesture, so the values closed
   * over are the ones on screen, and the keydown listener is re-registered each
   * render so it never holds a stale pair.
   */
  function undo() {
    if (!past.length) return;
    setPast(past.slice(0, -1));
    setFuture([...future, settled.current]);
    apply(past[past.length - 1]!);
  }

  function redo() {
    if (!future.length) return;
    setFuture(future.slice(0, -1));
    setPast([...past, settled.current]);
    apply(future[future.length - 1]!);
  }

  /*
   * Arrow keys nudge whatever is selected.
   *
   * Dragging is for getting a prop roughly where it belongs; this is for the
   * last two percent, where the mouse is the wrong instrument -- a one-pixel
   * drag is a gesture nobody can make reliably, and the marks are 14px targets
   * that have to land on a floorboard.
   *
   * It is also the only way to recover a layer that has been stretched to zero
   * width: there is nothing left to grab, but it can still be picked from the
   * layer list and walked back into view.
   *
   * Shift is the coarse step. Both are percentages of the frame, which is the
   * same unit the scene file stores, so what you nudge is what gets written.
   */
  useEffect(() => {
    function onArrows(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const step =
        { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!step) return;
      if (sel == null && !markSel) return;
      e.preventDefault();
      const d = e.shiftKey ? 2 : 0.25;
      const dx = step[0]! * d;
      const dy = step[1]! * d;
      if (sel != null) {
        setLayers((l) => l.map((x, n) => (n === sel ? moveLayer(x, dx, dy) : x)));
      } else if (markSel) {
        const nudge = (list: Slot[]) =>
          list.map((sl, n) =>
            n === markSel.i
              ? {
                  ...sl,
                  xPct: +(sl.xPct + dx / 100).toFixed(4),
                  yPct: +(sl.yPct + dy / 100).toFixed(4),
                }
              : sl,
          );
        if (markSel.side === 'player') setBoard(nudge);
        else setFoes(nudge);
      }
      setDirty(true);
    }
    window.addEventListener('keydown', onArrows);
    return () => window.removeEventListener('keydown', onArrows);
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      // A field has its own undo stack and the browser's is better than ours
      // for text; stealing ctrl+Z inside an input would make typing a number
      // feel broken.
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const layers = (SCENES[sceneId]?.layers ?? []).map((l) => ({ ...l }));
    const board = (SCENES[sceneId]?.board ?? PARTY_SLOTS_ALL).map((x) => ({ ...x }));
    const foes = (SCENES[sceneId]?.enemy ?? STANDARD_ENEMY_SLOTS).map((x) => ({ ...x }));
    const acts = structuredClone(sceneActs(sceneId) ?? DOWNSTAGE);
    setLayers(layers);
    setBoard(board);
    setFoes(foes);
    setSel(null);
    setDirty(false);
    setStatus(null);
    setActs(structuredClone(sceneActs(sceneId) ?? DOWNSTAGE));
    setSceneName(SCENES[sceneId]?.name ?? sceneId);
    setStageFrom(SCENES[sceneId]?.stages?.[0] ?? '');
    setStageTo(SCENES[sceneId]?.stages?.[1] ?? '');
    /*
     * Loading a different scene is not an edit to this one -- undoing across
     * that boundary would quietly paste one set's furniture into another.
     *
     * Re-baselining `settled` is the whole fix, and it must NOT also raise the
     * `replaying` flag. That flag is consumed by the watcher, and the watcher
     * only runs when the snapshot actually changes -- so on the common path
     * where the loaded scene matches what is already on screen, the flag was
     * never consumed and sat there waiting to swallow the animator's first real
     * edit. Setting the baseline is enough: the watcher's own equality check
     * then finds nothing to record.
     */
    settled.current = JSON.stringify({ layers, board, foes, acts });
    setPast([]);
    setFuture([]);
  }, [sceneId]);

  const selected = sel != null ? layers[sel] : undefined;

  function patch(i: number, p: Partial<StageLayer>) {
    setLayers((l) => l.map((x, n) => (n === i ? { ...x, ...p } : x)));
    setDirty(true);
  }

  // Dragging reads percentages off the frame, which is the same space the
  // saved numbers are in -- so what you drag is literally what gets written.
  function onDown(
    e: React.PointerEvent,
    kind: 'layer' | 'player' | 'enemy' | 'act',
    i: number,
    side?: 'player' | 'enemy',
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (kind === 'layer') {
      setSel(i);
      setMarkSel(null);
    } else if (kind !== 'act') {
      setMarkSel({ side: kind, i });
      setSel(null);
    } else {
      setSel(null);
      setMarkSel(null);
    }
    drag.current = { kind, i, x: e.clientX, y: e.clientY, side };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  /*
   * Picking a layer by what is VISIBLE under the cursor.
   *
   * Lives on the frame rather than on each layer so the whole stack can be
   * considered at once: per-layer handlers only ever fire for whichever
   * rectangle happens to be on top, which is exactly the behaviour that made
   * anything underneath the boards unreachable.
   *
   * Marks stop propagation in their own handler, so they are picked before this
   * ever runs -- they are the small deliberate targets and should win.
   */
  function onFrameDown(e: React.PointerEvent) {
    const els = frame.current?.querySelectorAll<HTMLImageElement>('.stage-lab-layer');
    if (!els?.length) return;
    // Front to back. DOM order matches the layers array, and later layers are
    // painted over earlier ones, so the last match going forwards is the
    // topmost -- walk it backwards and take the first.
    for (let i = els.length - 1; i >= 0; i--) {
      const img = els[i]!;
      const r = img.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const a = alphaAt(img, u, v);
      // A null reading means the pixels could not be sampled; treat the box as
      // solid rather than skipping the layer, so a failure to read makes the
      // lab behave as it did before instead of making a layer unpickable.
      if (a === null || a >= ALPHA_FLOOR) {
        onDown(e, 'layer', i);
        return;
      }
    }
    // Clicked through everything: clear the selection, which is what clicking
    // empty space should do.
    setSel(null);
    setMarkSel(null);
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = ((e.clientX - d.x) / box.width) * 100;
    const dy = ((e.clientY - d.y) / box.height) * 100;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    // Marks are stored as 0-1 fractions while layers are percentages, so the
    // same gesture divides by a hundred on one path and not the other.
    const nudge = (list: Slot[]) =>
      list.map((sl, n) =>
        n === d.i
          ? { ...sl, xPct: +(sl.xPct + dx / 100).toFixed(4), yPct: +(sl.yPct + dy / 100).toFixed(4) }
          : sl,
      );
    if (d.kind === 'layer') setLayers((l) => l.map((x, n) => (n === d.i ? moveLayer(x, dx, dy) : x)));
    else if (d.kind === 'act')
      setActs((a) => ({
        ...a,
        [d.side!]: {
          x: +(a[d.side!].x + dx / 100).toFixed(4),
          y: +(a[d.side!].y + dy / 100).toFixed(4),
        },
      }));
    else if (d.kind === 'player') setBoard(nudge);
    else setFoes(nudge);
    setDirty(true);
    drag.current = { ...d, x: e.clientX, y: e.clientY };
  }
  const onUp = () => (drag.current = null);

  function addProp(src: string) {
    setLayers((l) => [...l, { src, depth: 0.4, x: 45, bottom: 35, h: 20, shadow: true }]);
    setSel(layers.length);
    setDirty(true);
  }

  function reorder(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= layers.length) return;
    setLayers((l) => {
      const n = [...l];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
    setSel(j);
    setDirty(true);
  }

  async function save() {
    try {
      const res = await fetch('/__scene/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: sceneId,
          name: sceneName || sceneId,
          layers,
          board,
          enemy: foes,
          // Only a COMPLETE range is sent. A half-filled pair would otherwise
          // be written as a range starting at nothing, and a scene that claims
          // stage NaN quietly claims none of them.
          stages:
            stageFrom !== '' && stageTo !== '' ? [Number(stageFrom), Number(stageTo)] : undefined,
          // Sent only when they differ from the global default, so a scene that
          // never touched them stays silent and keeps following `DOWNSTAGE`
          // rather than freezing a copy of today's value into its file.
          acts: JSON.stringify(acts) === JSON.stringify(DOWNSTAGE) ? undefined : acts,
        }),
      });
      const body = (await res.json()) as { file?: string; error?: string };
      if (!res.ok || body.error) return setStatus(`save failed: ${body.error ?? res.statusText}`);
      setStatus(`saved ${body.file}`);
      setDirty(false);
    } catch (e) {
      setStatus(`save failed: ${e instanceof Error ? e.message : 'dev server unreachable'}`);
    }
  }

  const cast = useMemo(
    () => [
      ...board.map((s, i) => ({ ...s, side: 'player' as const, i })),
      ...foes.map((s, i) => ({ ...s, side: 'enemy' as const, i })),
    ],
    [board, foes],
  );

  return (
    <div className="stage-lab">
      <div className="stage-lab-view">
        {/* In preview this is the battle's window onto the set: shaped like the
            game's stage cell, clipping to the band the camera keeps. Outside
            preview it constrains nothing and the frame lays out as before. */}
        <div
          className={`stage-lab-viewport ${preview ? 'previewing' : ''}`}
          style={preview ? { aspectRatio: `${PREVIEW.aspect}` } : undefined}
        >
        <div
          className="stage-lab-frame"
          ref={frame}
          // Scaled about the centre so zooming in keeps whatever you were
          // looking at roughly in view instead of walking off the top-left.
          // Preview replaces that with the battle's own framing, and ignores
          // the lab zoom: a preview you can zoom is not a preview.
          style={
            preview
              ? { height: `${PREVIEW.scale}%`, top: `${PREVIEW.offset}%` }
              : { transform: `scale(${zoom})`, transformOrigin: 'center center' }
          }
          onPointerDown={preview ? undefined : onFrameDown}
          onPointerMove={preview ? undefined : onMove}
          onPointerUp={preview ? undefined : onUp}
          onPointerLeave={preview ? undefined : onUp}
        >
          {layers.map((l, i) => (
            <LayerImg
              key={`${l.src}-${i}`}
              layer={l}
              zIndex={l.front ? 200 + i : i}
              className={`stage-lab-layer ${sel === i ? 'picked' : ''}`}
            />
          ))}

          {/*
            What the battle camera actually keeps.

            The lab frames the whole 16:9 set; the battle sits at a resting zoom
            of 1.44 and throws away everything outside a window 1/1.44 of that,
            centred on the camera's eye. Measured against the running game, that
            is the band from 18.9% to 88.4% -- so a valance pinned to the top of
            the frame and the footlights along the bottom are both composed in
            the lab and never once seen in play. Which is exactly the "the stage
            isn't loading right" you get when the two disagree.

            Drawn as an overlay rather than by cropping the lab, because pieces
            that run off the frame still have to be grabbable: the curtain legs
            are supposed to overshoot. So you see the whole set, and you see
            where the camera stops.
          */}
          {safeArea && !preview && (
            <div
              className="stage-lab-safe"
              aria-hidden="true"
              // Computed from the battle's own constants rather than typed in.
              // These were hardcoded percentages once and went stale the moment
              // the resting zoom changed, which put the lab back to quietly
              // disagreeing with the game -- the exact failure the overlay was
              // added to prevent.
              style={{
                top: `${(restBand.from * 100).toFixed(2)}%`,
                bottom: `${((1 - restBand.to) * 100).toFixed(2)}%`,
              }}
            >
              <span className="stage-lab-safe-label">battle camera</span>
            </div>
          )}

          {guides && !preview && (
            <>
              {/* The middle of the stage. Drawn as crossed hairlines rather
                  than a dot so it reads against any backdrop and so the
                  vertical -- the one that matters, since the two sides meet
                  across it -- is visible the whole height of the frame. */}
              <div className="stage-lab-centre" aria-hidden="true">
                <span className="v" />
                <span className="h" />
              </div>

              {/* Where a Performer stands to act. Not editable here: these are
                  one pair of constants for the whole game, not per scene, so a
                  scene that needs them moved is asking for a change in
                  formation.ts rather than in this file. */}
              {(['player', 'enemy'] as const).map((side) => (
                <span
                  key={side}
                  className={`stage-lab-act ${side}`}
                  style={{ left: `${acts[side].x * 100}%`, top: `${acts[side].y * 100}%` }}
                  title={`Where a ${side === 'player' ? 'Performer' : 'enemy'} steps out to act — drag to move`}
                  onPointerDown={(e) => onDown(e, 'act', 0, side)}
                >
                  <b>acts</b>
                </span>
              ))}
            </>
          )}

          {showCast &&
            !preview &&
            cast.map((sl) => (
              <span
                key={`${sl.side}-${sl.col}-${sl.row}`}
                className={`stage-lab-mark ${sl.side} ${
                  markSel?.side === sl.side && markSel.i === sl.i ? 'picked' : ''
                }`}
                // Above EVERYTHING, front curtains included. At z 150 the marks
                // sat under the proscenium legs at 200+, so the downstage-left
                // mark could be seen through the curtain but never grabbed.
                style={{ left: `${sl.xPct * 100}%`, top: `${sl.yPct * 100}%`, zIndex: 400 }}
                title={`${sl.side} rank ${sl.col}, row ${sl.row} — drag to move`}
                onPointerDown={(e) => onDown(e, sl.side, sl.i)}
              >
                <b>{sl.col},{sl.row}</b>
              </span>
            ))}
        </div>
        </div>
      </div>

      <aside className="stage-lab-side">
        <div className="stage-lab-row">
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            {SCENE_IDS.map((id) => (
              <option key={id} value={id}>
                {SCENES[id]?.name ?? id}
              </option>
            ))}
          </select>
          {/* Typing a filename that does not exist yet is how a new scene is
              made -- the save endpoint writes `art/scenes/<id>.json` either
              way, so "new" needs no separate mode. */}
          <input
            className="stage-lab-id"
            value={sceneId}
            title="File name: art/scenes/<id>.json. Type a new one to start a new scene."
            onChange={(e) => setSceneId(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase())}
          />
          <input
            className="stage-lab-name"
            value={sceneName}
            placeholder="Display name"
            onChange={(e) => {
              setSceneName(e.target.value);
              setDirty(true);
            }}
          />
          <button type="button" onClick={save} disabled={!dirty && SCENE_IDS.includes(sceneId)}>
            {SCENE_IDS.includes(sceneId) ? (dirty ? 'Save' : 'Saved') : 'Create'}
          </button>
          {/* Buttons as well as the shortcut. A shortcut nobody is told about
              is a feature only its author has; the count on the label also says
              how far back you can still go. */}
          <button
            type="button"
            className={preview ? 'primary' : ''}
            onClick={() => setPreview((v) => !v)}
            title="Show the set the way the battle frames it"
          >
            {preview ? 'editing' : 'preview'}
          </button>
          <button type="button" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
             undo{past.length ? ` (${past.length})` : ''}
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!future.length}
            title="Redo (Ctrl+Shift+Z)"
          >
            redo{future.length ? ` (${future.length})` : ''}
          </button>
        </div>
        {status && <p className="dim">{status}</p>}

        {/* Which stretch of the ladder this set dresses. Blank means "not in
            rotation", which is what lets a scene be built before it is used. */}
        <label className="stage-lab-stages">
          Dresses stages
          <input
            type="number"
            min={1}
            value={stageFrom}
            placeholder="from"
            onChange={(e) => {
              setStageFrom(e.target.value === '' ? '' : Math.max(1, +e.target.value));
              setDirty(true);
            }}
          />
          to
          <input
            type="number"
            min={1}
            value={stageTo}
            placeholder="to"
            onChange={(e) => {
              setStageTo(e.target.value === '' ? '' : Math.max(1, +e.target.value));
              setDirty(true);
            }}
          />
        </label>
        {stageFrom !== '' && stageTo !== '' && Number(stageTo) < Number(stageFrom) && (
          <p className="dim">Range is backwards — nothing will match it.</p>
        )}

        <label className="stage-lab-check">
          <input type="checkbox" checked={showCast} onChange={(e) => setShowCast(e.target.checked)} />
          Show and move the marks
        </label>
        <label className="stage-lab-check">
          <input type="checkbox" checked={safeArea} onChange={(e) => setSafeArea(e.target.checked)} />
          Show what the battle camera keeps
        </label>
        <label className="stage-lab-check">
          <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
          Show centre and the acting marks
        </label>
        <p className="dim">
          Green is the party's 2-1-2, red the enemy block. Drag a mark to move where that
          slot stands; the label is its rank and row. Arrow keys nudge whatever is
          selected — hold shift for a coarse step.
        </p>
        <div className="stage-lab-row">
          <button
            type="button"
            onClick={() => {
              setBoard(PARTY_SLOTS_ALL.map((x) => ({ ...x })));
              setFoes(STANDARD_ENEMY_SLOTS.map((x) => ({ ...x })));
              setDirty(true);
            }}
          >
            Reset marks
          </button>
        </div>
        <label>
          Zoom <span className="dim">{zoom.toFixed(2)}× · preview only</span>
          <input
            type="range"
            min={0.35}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <div className="stage-lab-row">
          {[0.5, 0.75, 1, 1.5, 2, 3].map((z) => (
            <button
              type="button"
              key={z}
              className={Math.abs(zoom - z) < 0.03 ? 'on' : ''}
              onClick={() => setZoom(z)}
            >
              {z}×
            </button>
          ))}
        </div>
        <p className="dim">
          The battle applies its own camera on top of this — roughly 1.4× at rest, so the
          outer ~15% of the frame is never on screen. Anything meant to be seen belongs
          inside that.
        </p>

        <h3>Add a prop</h3>
        <div className="stage-lab-props">
          {PROPS.map((src) => (
            <button type="button" key={src} onClick={() => addProp(src)} title={src}>
              <img src={src} alt="" draggable={false} />
              <span>{nameOf(src)}</span>
            </button>
          ))}
        </div>

        <h3>Layers <span className="dim">back to front</span></h3>
        <ol className="stage-lab-list">
          {layers.map((l, i) => (
            <li key={`${l.src}-${i}`} className={sel === i ? 'picked' : ''}>
              <button type="button" className="pick" onClick={() => setSel(i)}>
                {nameOf(l.src)}
                {l.front && <em> front</em>}
              </button>
              <button type="button" onClick={() => reorder(i, -1)} title="Back">↑</button>
              <button type="button" onClick={() => reorder(i, 1)} title="Forward">↓</button>
              <button
                type="button"
                onClick={() => {
                  setLayers((x) => x.filter((_, n) => n !== i));
                  setSel(null);
                  setDirty(true);
                }}
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ol>

        {selected && sel != null && (
          <div className="stage-lab-props-edit">
            <h3>{nameOf(selected.src)}</h3>
            <label>
              Height <span className="dim">{selected.h ?? 100}% of the frame</span>
              <input
                type="range"
                min={2}
                max={130}
                step={0.5}
                value={selected.h ?? 100}
                onChange={(e) => patch(sel, { h: +e.target.value })}
              />
            </label>
            <label>
              Width{' '}
              <span className="dim">
                {selected.w != null ? `${selected.w}% — stretched` : 'keeps its shape'}
              </span>
              <input
                type="range"
                min={2}
                max={140}
                step={0.5}
                value={selected.w ?? 40}
                onChange={(e) => patch(sel, { w: +e.target.value })}
              />
            </label>
            <div className="stage-lab-row">
              <button type="button" onClick={() => patch(sel, { w: undefined })}>
                Un-stretch
              </button>
              <button
                type="button"
                onClick={() => {
                  // Offset the copy so it is not hidden exactly behind the
                  // original, and stagger any motion so two birds do not fly
                  // in lockstep.
                  const copy: StageLayer = {
                    ...selected,
                    ...(selected.right != null
                      ? { right: (selected.right ?? 0) - 8 }
                      : { x: (selected.x ?? 0) + 8 }),
                    ...(selected.motion
                      ? { motion: { ...selected.motion, delay: (selected.motion.delay ?? 0) + 2.5 } }
                      : null),
                  };
                  setLayers((l) => [...l.slice(0, sel + 1), copy, ...l.slice(sel + 1)]);
                  setSel(sel + 1);
                  setDirty(true);
                }}
              >
                Duplicate
              </button>
            </div>
            <label>
              Depth <span className="dim">{selected.depth.toFixed(2)} · drift and shadow</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={selected.depth}
                onChange={(e) => patch(sel, { depth: +e.target.value })}
              />
            </label>
            <div className="stage-lab-row">
              <label className="stage-lab-check">
                <input
                  type="checkbox"
                  checked={!!selected.flip}
                  onChange={(e) => patch(sel, { flip: e.target.checked })}
                />
                Flip
              </label>
              <label className="stage-lab-check">
                <input
                  type="checkbox"
                  checked={!!selected.shadow}
                  onChange={(e) => patch(sel, { shadow: e.target.checked })}
                />
                Shadow
              </label>
              <label className="stage-lab-check">
                <input
                  type="checkbox"
                  checked={!!selected.front}
                  onChange={(e) => patch(sel, { front: e.target.checked })}
                />
                In front of cast
              </label>
            </div>
            <h3>Motion</h3>
            {!selected.motion ? (
              <button
                type="button"
                onClick={() =>
                  patch(sel, { motion: { seconds: 9, travel: 120, bob: 6, bobSeconds: 2.2, sway: 3 } })
                }
              >
                Make it move
              </button>
            ) : (
              <>
                <label>
                  Crossing <span className="dim">{selected.motion.seconds}s end to end</span>
                  <input
                    type="range"
                    min={1}
                    max={40}
                    step={0.5}
                    value={selected.motion.seconds}
                    onChange={(e) =>
                      patch(sel, { motion: { ...selected.motion!, seconds: +e.target.value } })
                    }
                  />
                </label>
                <label>
                  Travel{' '}
                  <span className="dim">
                    {Math.abs(selected.motion.travel ?? 0)}% of the stage,{' '}
                    {/* Direction is the SIGN of the travel, not a separate
                        setting: a crossing is one journey and which way it runs
                        is which end it starts at. Naming it in words because a
                        minus sign on a slider is not an answer to "which way
                        does this bird fly". */}
                    {(selected.motion.travel ?? 0) < 0 ? '← right to left' : '→ left to right'}
                  </span>
                  <input
                    type="range"
                    min={-200}
                    max={200}
                    step={1}
                    value={selected.motion.travel ?? 0}
                    onChange={(e) =>
                      patch(sel, { motion: { ...selected.motion!, travel: +e.target.value } })
                    }
                  />
                </label>
                {/*
                  Where the crossing actually begins and ends.
                
                  The sliders describe the motion but never said where it puts
                  the piece, so the only way to find out was to watch the loop
                  and hope it came past. `stage-cross` is centred on the layer's
                  authored x -- it runs half the travel each side of it -- and
                  that is not something anyone should have to infer from a
                  keyframe. The band note is the other half of the answer: a
                  piece can cross the middle of the frame perfectly and still
                  never be seen, because the battle camera only keeps part of
                  the height.
                */}
                {(() => {
                  const travel = selected.motion!.travel ?? 0;
                  const half = travel / 2;
                  const base = selected.x ?? (selected.right != null ? 100 - selected.right : 0);
                  const top = selected.y;
                  const outside =
                    top != null && (top / 100 < restBand.from || top / 100 > restBand.to);
                  return (
                    <p className="dim stage-lab-travel">
                      {/* The arrow means "to", always. Pointing it in the
                          direction of travel put a left arrow between two
                          numbers whose order already said the same thing, and
                          read as if it were indicating the wrong one. Which way
                          it goes is on the Travel label, in words. */}
                      crosses <b>{(base - half).toFixed(0)}%</b> → <b>{(base + half).toFixed(0)}%</b>
                      {top != null && (
                        <>
                          {' '}at y <b>{top.toFixed(0)}%</b>
                          {outside && (
                            <em className="warn">
                              {' '}— outside the battle camera ({(restBand.from * 100).toFixed(0)}–
                              {(restBand.to * 100).toFixed(0)}%), so it never shows in play
                            </em>
                          )}
                        </>
                      )}
                    </p>
                  );
                })()}
                <label>
                  Bob <span className="dim">{selected.motion.bob ?? 0}% up and down</span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={0.5}
                    value={selected.motion.bob ?? 0}
                    onChange={(e) =>
                      patch(sel, { motion: { ...selected.motion!, bob: +e.target.value } })
                    }
                  />
                </label>
                <label>
                  Bob speed{' '}
                  <span className="dim">
                    {selected.motion.bobSeconds ?? 3}s · own clock, so passes differ
                  </span>
                  <input
                    type="range"
                    min={0.3}
                    max={8}
                    step={0.1}
                    value={selected.motion.bobSeconds ?? 3}
                    onChange={(e) =>
                      patch(sel, { motion: { ...selected.motion!, bobSeconds: +e.target.value } })
                    }
                  />
                </label>
                <label>
                  Sway <span className="dim">{selected.motion.sway ?? 0}° tilt</span>
                  {/* Signed too. The tilt is banking, so a piece crossing the
                      other way wants to bank the other way -- and `flip`
                      mirrors the artwork but not the rotation, because the
                      rotation is on the wrapper and the mirror is on the
                      image. */}
                  <input
                    type="range"
                    min={-20}
                    max={20}
                    step={0.5}
                    value={selected.motion.sway ?? 0}
                    onChange={(e) =>
                      patch(sel, { motion: { ...selected.motion!, sway: +e.target.value } })
                    }
                  />
                </label>
                <label>
                  Delay <span className="dim">{selected.motion.delay ?? 0}s before it starts</span>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={selected.motion.delay ?? 0}
                    onChange={(e) =>
                      patch(sel, { motion: { ...selected.motion!, delay: +e.target.value } })
                    }
                  />
                </label>
                <button type="button" onClick={() => patch(sel, { motion: undefined })}>
                  Hold still
                </button>
              </>
            )}

            <p className="dim">
              Pinned {selected.right != null ? 'right' : 'left'} ·{' '}
              {selected.bottom != null ? 'bottom' : 'top'}. Drag it on the stage to move it.
            </p>
            <div className="stage-lab-row">
              <button
                type="button"
                onClick={() =>
                  patch(sel, {
                    bottom: selected.bottom != null ? undefined : 35,
                    y: selected.bottom != null ? 20 : undefined,
                  })
                }
              >
                Pin to {selected.bottom != null ? 'top' : 'floor'}
              </button>
              <button
                type="button"
                onClick={() =>
                  patch(sel, {
                    right: selected.right != null ? undefined : 10,
                    x: selected.right != null ? 10 : undefined,
                  })
                }
              >
                Pin to {selected.right != null ? 'left' : 'right'}
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
