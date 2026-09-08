import { useEffect, useMemo, useRef, useState } from 'react';
import { ROSTER } from '../../engine/content.ts';
import { ANIMATION_CLIPS, type AnimationClip } from '../../engine/sprites.generated.ts';
import type { ClipPlacement, FrameTune } from '../animationData.ts';
import {
  type Step,
  clipAnimName,
  clipBox,
  clipDuration,
  clipKeyframes,
  clipTimeline,
  frameTransform,
  orderFor,
  placementFor,
  tuningFor,
} from '../clipAnimation.ts';

/**
 * Dev-only animation viewer and editor.
 *
 * Exists because the only way to judge a clip is to watch it at the size it will
 * actually play, next to the still it replaces. Reads the generated catalogue,
 * so every clip packed into `public/sprites/` shows up here without wiring --
 * drop a new sheet into `art/actors/<name>/animations/`, re-run the pack script,
 * and it appears.
 *
 * The editing half is here rather than in the pack script on purpose. How long a
 * frame should hold, whether it sits two percent low, and whether it belongs in
 * the clip at all are judgement calls that need an eye on the result, and
 * iterating on them through a Python run would be unbearable. Edits save
 * straight to `art/actors/<name>/<name>.anim.json` -- authored data the pack
 * script never rewrites.
 *
 * Reachable at `#anim` with `?dev=1`.
 */

const PLAYBACK = {
  loop: 'Loop (what an idle uses)',
  once: 'Play once, then settle',
  pingpong: 'Ping-pong (forward, then back)',
  step: 'Paused — step by hand',
} as const;
type Mode = keyof typeof PLAYBACK;

/**
 * The clip a one-shot hands back to.
 *
 * Prefers what the clip itself declares -- a celebration settles into
 * `celebration_ending`, so a Performer keeps holding the pose they took a bow
 * in rather than snapping back to a combat stance. Falls back to the resting
 * idle for clips with no ending drawn.
 */
function restingClip(clips: Record<string, AnimationClip>, from?: string): string | undefined {
  const declared = from ? clips[from]?.settlesInto : undefined;
  if (declared && clips[declared]) return declared;
  const names = Object.keys(clips).sort();
  return names.find((n) => n === 'idle') ?? names.find((n) => clips[n].loops) ?? names[0];
}

/**
 * The frame that plays immediately before this clip, if it is something's
 * ending pose.
 *
 * An `_ending` never starts from nothing -- it picks up the instant a one-shot
 * hands over. Judging its first frame or its placement against the neutral
 * still is judging it against a pose it never follows. So find the clip that
 * settles into this one and take its last PLAYED frame, which respects that
 * clip's own order and disabled frames rather than assuming the sheet's end.
 */
function incomingFor(
  who: string,
  clips: Record<string, AnimationClip>,
  target: string,
): { name: string; clip: AnimationClip; step: Step } | undefined {
  const from = Object.keys(clips)
    .sort()
    .find((n) => n !== target && clips[n].settlesInto === target);
  if (!from) return undefined;
  const steps = clipTimeline(clips[from].frames, tuningFor(who, from), orderFor(who, from));
  const step = steps[steps.length - 1];
  return step ? { name: from, clip: clips[from], step } : undefined;
}

const blank = (n: number): FrameTune[] => Array.from({ length: n }, () => ({}));
const natural = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Drop defaults, so a saved file records decisions rather than noise. */
function trimTune(tune: FrameTune[]): FrameTune[] {
  const rows = tune.map((t) => {
    const out: FrameTune = {};
    if (t.hold != null && t.hold !== 1) out.hold = t.hold;
    if (t.dx) out.dx = t.dx;
    if (t.dy) out.dy = t.dy;
    return out;
  });
  // Frames past the end play plain, so a tail of empties carries no information.
  while (rows.length && !Object.keys(rows[rows.length - 1]).length) rows.pop();
  return rows;
}

function trimPlacement(p: ClipPlacement): ClipPlacement {
  const out: ClipPlacement = {};
  if (p.scale != null && p.scale !== 1) out.scale = +p.scale.toFixed(3);
  if (p.dx) out.dx = p.dx;
  if (p.dy) out.dy = p.dy;
  return out;
}

export function AnimationLab() {
  const owners = Object.keys(ANIMATION_CLIPS).sort();
  const [who, setWho] = useState(owners[0] ?? '');
  const clips = ANIMATION_CLIPS[who] ?? {};
  const names = Object.keys(clips).sort();
  const [clipName, setClipName] = useState(names[0] ?? '');
  const clip: AnimationClip | undefined = clips[clipName] ?? clips[names[0] ?? ''];

  const [stepMs, setStepMs] = useState(105);
  const [height, setHeight] = useState(220);
  const [mode, setMode] = useState<Mode>('loop');
  /** Position within the played sequence, not a source frame index. */
  const [at, setAt] = useState(0);
  const [onBackdrop, setOnBackdrop] = useState(true);
  const [ghost, setGhost] = useState<'none' | 'still' | 'incoming'>('incoming');
  const [tune, setTune] = useState<FrameTune[]>(() => blank(clip?.frames ?? 0));
  const [place, setPlace] = useState<ClipPlacement>({});
  /** Source frame indices, in play order. Frames absent from it are disabled. */
  const [order, setOrder] = useState<number[]>(() => natural(clip?.frames ?? 0));
  /** Bumped to remount the strip, which is the only way to restart a CSS run. */
  const [run, setRun] = useState(0);
  /** In `once` mode: has the one-shot finished and handed back? */
  const [settled, setSettled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const stripRef = useRef<HTMLImageElement>(null);

  const def = ROSTER.find((d) => d.id === who);
  const still = def?.sprite;
  const restName = restingClip(clips, clipName);
  const rest = restName ? clips[restName] : undefined;

  // A new clip means a new frame count, so the working copy starts over --
  // seeded from whatever is already saved for it.
  useEffect(() => {
    if (!clip) return;
    const committed = tuningFor(who, clipName) ?? [];
    setTune(blank(clip.frames).map((_, i) => ({ ...committed[i] })));
    setPlace({ ...placementFor(who, clipName) });
    setOrder(orderFor(who, clipName)?.filter((i) => i < clip.frames) ?? natural(clip.frames));
    setAt(0);
    setSettled(false);
    setDirty(false);
    setStatus(null);
    setRun((r) => r + 1);
  }, [who, clipName, clip?.frames]);

  const showing = mode === 'once' && settled && rest ? rest : clip;
  const showingName = mode === 'once' && settled && restName ? restName : clipName;
  const editing = showingName === clipName;

  // Only the shown clip carries live edits; whatever it settles into plays as
  // saved, which is exactly the comparison the hand-off is meant to test.
  const steps = useMemo(() => {
    if (!showing) return [];
    return editing
      ? clipTimeline(showing.frames, tune, order)
      : clipTimeline(showing.frames, tuningFor(who, showingName), orderFor(who, showingName));
  }, [showing?.frames, editing, tune, order, who, showingName]);

  const livePlace = editing ? place : placementFor(who, showingName);

  const css = useMemo(
    () => (showing ? clipKeyframes(clipAnimName(who, showingName), showing.frames, steps) : ''),
    [who, showingName, showing?.frames, steps],
  );

  /**
   * Which source frame is on screen right now.
   *
   * When paused that is just the picked step. When playing, it is read back off
   * the running animation rather than tracked in state -- the animation is
   * driven by CSS, so its transform is the only thing that actually knows.
   * Per-frame `dx` shifts this slightly off a whole multiple; rounding absorbs it.
   */
  function currentSource(frames: number): number {
    if (mode === 'step') return steps[at]?.source ?? 0;
    const img = stripRef.current;
    if (!img) return 0;
    const window = img.parentElement?.getBoundingClientRect().width ?? 0;
    if (!window) return 0;
    const shift = new DOMMatrixReadOnly(getComputedStyle(img).transform).m41;
    return ((Math.round(-shift / window) % frames) + frames) % frames;
  }

  /** Cut one frame out of the strip and hand it over as a PNG. */
  async function downloadFrame(c: AnimationClip, label: string) {
    const i = currentSource(c.frames);
    const sheet = new Image();
    sheet.crossOrigin = 'anonymous';
    sheet.src = c.src;
    await sheet.decode();

    const fw = sheet.naturalWidth / c.frames;
    const canvas = document.createElement('canvas');
    canvas.width = fw;
    canvas.height = sheet.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(sheet, i * fw, 0, fw, sheet.naturalHeight, 0, 0, fw, sheet.naturalHeight);

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return;
    const name = `${who}_${label}_${String(i).padStart(2, '0')}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`downloaded ${name}`);
  }

  /**
   * Write the working copy to the actor's JSON, through the dev server.
   *
   * `order` is only sent when it differs from the natural sequence. The common
   * case is every frame in order, and writing that out would bury the real
   * decisions in files full of `[0,1,2,3...]`.
   */
  async function save() {
    if (!clip) return;
    const isNatural = order.length === clip.frames && order.every((v, i) => v === i);
    try {
      const res = await fetch('/__anim/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          who,
          clip: clipName,
          placement: trimPlacement(place),
          frames: trimTune(tune),
          order: isNatural ? undefined : order,
        }),
      });
      const body = (await res.json()) as { file?: string; error?: string };
      if (!res.ok || body.error) {
        setStatus(`save failed: ${body.error ?? res.statusText}`);
        return;
      }
      setStatus(`saved ${body.file}`);
      setDirty(false);
    } catch (e) {
      setStatus(`save failed: ${e instanceof Error ? e.message : 'dev server unreachable'}`);
    }
  }

  function editTune(source: number, patch: FrameTune) {
    setTune((prev) => prev.map((t, j) => (source === j ? { ...t, ...patch } : t)));
    setDirty(true);
  }

  function editPlace(patch: ClipPlacement) {
    setPlace((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }

  /** Drop an enabled frame, or add a disabled one back at the end. */
  function toggleFrame(source: number) {
    setOrder((prev) =>
      prev.includes(source) ? prev.filter((i) => i !== source) : [...prev, source],
    );
    setDirty(true);
  }

  function moveFrame(pos: number, delta: number) {
    const to = pos + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[pos], next[to]] = [next[to], next[pos]];
    setOrder(next);
    setDirty(true);
    if (mode === 'step') setAt(to);
  }

  if (!clip || !showing) {
    return (
      <div className="lab">
        <p className="dim">
          No packed animations. Put a sheet in <code>art/actors/&lt;name&gt;/animations/</code> and
          run <code>python scripts/pack_sprites.py</code>.
        </p>
      </div>
    );
  }

  // `height` is the FIGURE height, matching what the battle screen asks for --
  // so the still beside it, which is cropped tight, is a fair comparison.
  const box = clipBox(showing, height, livePlace);

  // The pose this clip takes over from, drawn with ITS clip's placement so it
  // sits exactly where it will sit at the hand-off.
  const incoming = incomingFor(who, clips, showingName);
  const incomingBox = incoming
    ? clipBox(incoming.clip, height, placementFor(who, incoming.name))
    : null;
  const ghosting = ghost === 'incoming' && !incoming ? 'still' : ghost;
  const playing = mode !== 'step';
  const duration = clipDuration(steps, stepMs);
  const oneShot = mode === 'once' && !settled;
  const disabled = natural(clip.frames).filter((i) => !order.includes(i));
  const shownStep = steps[Math.min(at, steps.length - 1)];

  const stripStyle = playing
    ? {
        width: `${showing.frames * 100}%`,
        animationName: clipAnimName(who, showingName),
        animationDuration: `${duration}ms`,
        animationTimingFunction: 'linear' as const,
        animationDirection: mode === 'pingpong' ? ('alternate' as const) : ('normal' as const),
        animationIterationCount: oneShot ? 1 : ('infinite' as const),
        animationFillMode: oneShot ? ('forwards' as const) : ('none' as const),
      }
    : {
        width: `${showing.frames * 100}%`,
        transform: frameTransform(shownStep?.source ?? 0, showing.frames, shownStep?.tune),
      };

  return (
    <div className="lab">
      <style>{css}</style>

      <div className="lab-controls panel">
        <label>
          Character
          <select
            value={who}
            onChange={(e) => {
              setWho(e.target.value);
              setClipName(Object.keys(ANIMATION_CLIPS[e.target.value] ?? {}).sort()[0] ?? '');
            }}
          >
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label>
          Clip
          <select value={clipName} onChange={(e) => setClipName(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n} {clips[n].loops ? '(loops)' : '(one-shot)'}
              </option>
            ))}
          </select>
        </label>

        <label>
          Playback
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as Mode);
              setSettled(false);
              setRun((r) => r + 1);
            }}
          >
            {Object.entries(PLAYBACK).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label>
          Speed{' '}
          <span className="dim">
            {stepMs}ms/frame · {duration}ms total
          </span>
          <input
            type="range"
            min={30}
            max={260}
            value={stepMs}
            autoComplete="off"
            onChange={(e) => setStepMs(+e.target.value)}
          />
        </label>

        <label>
          Size <span className="dim">{Math.round(height)}px</span>
          <input
            type="range"
            min={80}
            max={460}
            value={height}
            autoComplete="off"
            onChange={(e) => setHeight(+e.target.value)}
          />
        </label>

        <label className="lab-check">
          <input
            type="checkbox"
            checked={onBackdrop}
            onChange={(e) => setOnBackdrop(e.target.checked)}
          />
          Stage backdrop
        </label>

        <label>
          Ghost
          {/* Shows what is actually ghosted, not what was picked: a clip with no
              predecessor falls back to the still, and the control should say so
              rather than naming an option it is not honouring. The preference
              itself is kept, so it returns on a clip that does have one. */}
          <select value={ghosting} onChange={(e) => setGhost(e.target.value as typeof ghost)}>
            <option value="none">Nothing</option>
            <option value="still">The still sprite</option>
            <option value="incoming" disabled={!incoming}>
              {incoming ? `Incoming — ${incoming.name} f${incoming.step.source}` : 'Incoming (none)'}
            </option>
          </select>
        </label>

        <span className="lab-now dim">
          {showingName} · {steps.length}
          {steps.length !== showing.frames && ` of ${showing.frames}`} frames · {duration}ms
          {mode === 'once' && (settled ? ' · settled' : ' · playing once')}
        </span>

        <button
          onClick={() => {
            setSettled(false);
            setRun((r) => r + 1);
          }}
        >
          Replay
        </button>
        <button className={dirty ? 'primary' : ''} onClick={() => void save()}>
          {dirty ? 'Save •' : 'Save'}
        </button>
        <button onClick={() => void downloadFrame(showing, showingName)}>Download frame</button>
        {status && <span className="dim lab-saved">{status}</span>}
      </div>

      <div className={`lab-stage ${onBackdrop ? 'backdrop' : ''}`}>
        {/* The still it replaces, at the same figure height. */}
        {still && (
          <figure>
            <img src={still.src} alt="" style={{ height }} draggable={false} />
            <figcaption className="dim">still</figcaption>
          </figure>
        )}

        {/* The frame that hands over, side by side -- for reading the pose. The
            ghost option overlays the same frame instead, for aligning to it. */}
        {incoming && incomingBox && (
          <figure>
            <span className="lab-anchor" style={{ width: height * (still?.aspect ?? 1), height }}>
              <span
                className="anim-clip lab-window"
                style={{
                  width: incomingBox.boxW,
                  height: incomingBox.boxH,
                  transform: `translate(${incomingBox.shiftPct}%, ${incomingBox.dropPct}%)`,
                }}
              >
                <img
                  className="anim-strip"
                  src={incoming.clip.src}
                  alt=""
                  draggable={false}
                  style={{
                    width: `${incoming.clip.frames * 100}%`,
                    transform: frameTransform(
                      incoming.step.source,
                      incoming.clip.frames,
                      incoming.step.tune,
                    ),
                  }}
                />
              </span>
            </span>
            <figcaption className="dim">
              incoming · {incoming.name} f{incoming.step.source}
            </figcaption>
          </figure>
        )}

        <figure>
          {/* The clip's box is bigger than the figure and hangs off the anchor
              rather than sitting in flow, so the wrapper is figure-sized and the
              box is placed around it. That wrapper also carries the ghost,
              giving a straight overlay to line the clip up against. */}
          <span className="lab-anchor" style={{ width: height * (still?.aspect ?? 1), height }}>
            {ghosting === 'still' && still && (
              <img
                className="lab-ghost"
                src={still.src}
                alt=""
                style={{ height }}
                draggable={false}
              />
            )}
            {ghosting === 'incoming' && incoming && incomingBox && (
              <span
                className="anim-clip lab-ghost-clip"
                style={{
                  width: incomingBox.boxW,
                  height: incomingBox.boxH,
                  transform: `translate(${incomingBox.shiftPct}%, ${incomingBox.dropPct}%)`,
                }}
              >
                <img
                  className="anim-strip"
                  src={incoming.clip.src}
                  alt=""
                  draggable={false}
                  style={{
                    width: `${incoming.clip.frames * 100}%`,
                    transform: frameTransform(
                      incoming.step.source,
                      incoming.clip.frames,
                      incoming.step.tune,
                    ),
                  }}
                />
              </span>
            )}
            <span
              className="anim-clip lab-window"
              style={{
                width: box.boxW,
                height: box.boxH,
                transform: `translate(${box.shiftPct}%, ${box.dropPct}%)`,
              }}
            >
              <img
                key={`${who}/${showingName}/${run}`}
                ref={stripRef}
                className="anim-strip"
                src={showing.src}
                alt=""
                draggable={false}
                style={stripStyle}
                onAnimationEnd={() => {
                  if (mode === 'once') setSettled(true);
                }}
              />
            </span>
          </span>
          {/* No caption here on purpose. It sat under the sprite, and its TEXT
              width set the figure's width -- so the moment a clip handed off to
              its ending the longer name widened the figure, the flex row
              re-centred, and the sprite visibly jumped sideways. The reading it
              gave now lives in the controls above, where nothing it does can
              move the art. */}
        </figure>
      </div>

      <div className="lab-tune panel">
        <div className="lab-tune-head">
          <strong>Placement — {clipName}</strong>
          {!editing && <span className="dim">showing {showingName} — hit Replay to see edits</span>}
          <button
            onClick={() => {
              setPlace({});
              setDirty(true);
            }}
          >
            Reset
          </button>
        </div>
        <div className="lab-place">
          <label>
            scale <span className="dim">{(place.scale ?? 1).toFixed(3)}</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.005}
              value={place.scale ?? 1}
              autoComplete="off"
              onChange={(e) => editPlace({ scale: +e.target.value })}
            />
          </label>
          <label>
            dx <span className="dim">{(place.dx ?? 0).toFixed(1)}% of box width</span>
            <input
              type="range"
              min={-40}
              max={40}
              step={0.5}
              value={place.dx ?? 0}
              autoComplete="off"
              onChange={(e) => editPlace({ dx: +e.target.value })}
            />
          </label>
          <label>
            dy <span className="dim">{(place.dy ?? 0).toFixed(1)}% up</span>
            <input
              type="range"
              min={-40}
              max={40}
              step={0.5}
              value={place.dy ?? 0}
              autoComplete="off"
              onChange={(e) => editPlace({ dy: +e.target.value })}
            />
          </label>
        </div>
        <p className="dim">
          Packed at <code>x{showing.normalised}</code> against the reference clip.
        </p>
      </div>

      <div className="lab-tune panel">
        <div className="lab-tune-head">
          <strong>Frames — {clipName}</strong>
          <span className="dim">
            in play order · the number is the source frame
            {disabled.length > 0 && ` · ${disabled.length} disabled`}
          </span>
          <button
            onClick={() => {
              setTune(blank(clip.frames));
              setOrder(natural(clip.frames));
              setAt(0);
              setDirty(true);
            }}
          >
            Reset
          </button>
        </div>

        <div className="lab-tune-grid">
          {order.map((source, pos) => (
            <div
              key={source}
              className={`lab-tune-cell ${mode === 'step' && pos === at ? 'on' : ''}`}
            >
              <div className="lab-tune-top">
                <button
                  className="lab-tune-move"
                  disabled={pos === 0}
                  title="Move earlier"
                  onClick={() => moveFrame(pos, -1)}
                >
                  ◀
                </button>
                <button
                  className="lab-tune-idx"
                  title="Show this frame"
                  onClick={() => {
                    setMode('step');
                    setAt(pos);
                  }}
                >
                  {source}
                </button>
                <button
                  className="lab-tune-move"
                  disabled={pos === order.length - 1}
                  title="Move later"
                  onClick={() => moveFrame(pos, 1)}
                >
                  ▶
                </button>
              </div>
              <label>
                hold
                <input
                  type="number"
                  step={0.25}
                  min={0.25}
                  max={8}
                  value={tune[source]?.hold ?? 1}
                  autoComplete="off"
                  onChange={(e) => editTune(source, { hold: +e.target.value })}
                />
              </label>
              <label>
                dx%
                <input
                  type="number"
                  step={0.5}
                  value={tune[source]?.dx ?? 0}
                  autoComplete="off"
                  onChange={(e) => editTune(source, { dx: +e.target.value })}
                />
              </label>
              <label>
                dy%
                <input
                  type="number"
                  step={0.5}
                  value={tune[source]?.dy ?? 0}
                  autoComplete="off"
                  onChange={(e) => editTune(source, { dy: +e.target.value })}
                />
              </label>
              <button
                className="lab-tune-off"
                title="Leave this frame out of playback"
                onClick={() => toggleFrame(source)}
              >
                disable
              </button>
            </div>
          ))}
        </div>

        {disabled.length > 0 && (
          <>
            <p className="dim">
              Disabled — still in the image, never played. Re-enabling appends to the end, so
              reorder afterwards.
            </p>
            <div className="lab-tune-grid">
              {disabled.map((source) => (
                <div key={source} className="lab-tune-cell off">
                  <div className="lab-tune-top">
                    <span className="lab-tune-idx">{source}</span>
                  </div>
                  <button className="lab-tune-off" onClick={() => toggleFrame(source)}>
                    enable
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <p className="lab-note dim">
        Saves to{' '}
        <code>
          art/actors/{who}/{who}.anim.json
        </code>
        , beside the art — authored data the pack script never rewrites. Per-frame tuning is keyed
        to the SOURCE frame, so a hold or a nudge stays with its drawing when the order changes.{' '}
        <code>hold</code> is a weight, not a duration, so the speed slider still means "how long a
        plain frame lasts"; offsets are percentages, so they hold at any render size.
      </p>
    </div>
  );
}
