import { useEffect, useMemo, useRef, useState } from 'react';
import { ROSTER } from '../../engine/content.ts';
import { HIT_SPLITS, hitSplitKey } from '../../engine/hitSplits.ts';
import { abilitySlug, slotAbilityName } from '../clipAnimation.ts';
import { ANIMATION_CLIPS, EFFECTS, type AnimationClip } from '../../engine/sprites.generated.ts';

import {
  CLIP_IMPACTS,
  DEFAULT_STEP_MS,
  impactTimes,
  type ClipPlacement,
  type FrameTune,
  type Impact,
} from '../animationData.ts';
import {
  type Step,
  clipAnimName,
  clipBox,
  clipDuration,
  clipKeyframes,
  poseAnimName,
  poseKeyframes,
  poseTransform,
  clipTimeline,
  frameTransform,
  orderFor,
  placementFor,
  stepMsFor,
  tuningFor,
} from '../clipAnimation.ts';

/** How long one burst stays up. Matches `burst-pop` in styles.css. */
const BURST_MS = 380;

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
    // Every authored field has to be listed here. A key this function does not
    // know about is not "left alone" -- it is rebuilt out of existence, and the
    // animator's work vanishes on the next save with no error anywhere.
    if (t.scale != null && t.scale !== 1) out.scale = +t.scale.toFixed(4);
    if (t.skewX) out.skewX = t.skewX;
    if (t.skewY) out.skewY = t.skewY;
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

/**
 * One burst, wherever it is playing.
 *
 * The lab draws impacts in two places now -- on the dummy and on the performer
 * -- and they are the same burst with the same geometry, so they are the same
 * component. The positioning context comes from whichever box contains it,
 * which is exactly how the battle does it: a burst is a percentage of its
 * parent and does not know whose body that is.
 */
function LabBurst({ impact }: { impact: Impact }) {
  const fx = EFFECTS[impact.effect];
  if (!fx) return null;
  return (
    <span
      className="impact-burst"
      style={
        {
          width: `calc(${(impact.scale ?? 1) * 100}% * ${fx.aspect})`,
          aspectRatio: `${fx.aspect}`,
          left: `${50 + (impact.dx ?? 0)}%`,
          top: `${50 + (impact.dy ?? 0)}%`,
          backgroundImage: `url(${fx.src})`,
          backgroundSize: `${fx.frames * 100}% 100%`,
          ['--fx-frames' as string]: fx.frames,
          ['--fx-end' as string]: `${fx.frames * 100}%`,
          ['--fx-ms' as string]: `${impact.ms ?? BURST_MS}ms`,
        } as React.CSSProperties
      }
    />
  );
}

export function AnimationLab() {
  const owners = Object.keys(ANIMATION_CLIPS).sort();
  const [who, setWho] = useState(owners[0] ?? '');
  const clips = ANIMATION_CLIPS[who] ?? {};
  const names = Object.keys(clips).sort();
  const [clipName, setClipName] = useState(names[0] ?? '');
  const clip: AnimationClip | undefined = clips[clipName] ?? clips[names[0] ?? ''];

  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  /**
   * The effects this clip throws, and when.
   *
   * Authored here rather than guessed at run time because only the animator
   * knows which drawing is the one where the blade actually lands -- and that
   * frame does not move when the clip is retimed, which is exactly why impacts
   * are frame-indexed rather than timed.
   */
  const [impacts, setImpacts] = useState<Impact[]>([]);
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
  /*
   * A practice dummy, so effects can be judged instead of imagined.
   *
   * Impacts were authorable here but not visible: you picked a frame, saved,
   * walked to a battle, found a target, and watched once. Everything else in
   * this screen answers its own question on the spot and this one did not.
   *
   * The dummy is a stand-in for a target, and the bursts are spawned on the
   * clip's real schedule -- the same `impactTimes` the battle calls -- so what
   * plays here is what will play there.
   */
  /*
   * The damage split for the ability this clip belongs to.
   *
   * Clips are named after abilities, so the lab can find the one it is looking
   * at and offer its shares here -- next to the impacts they land on, which is
   * the only place the two can be judged against each other.
   */
  const [shares, setShares] = useState<number[] | null>(null);
  const [sharesSaved, setSharesSaved] = useState<string | null>(null);
  const [dummy, setDummy] = useState(true);
  const [bursts, setBursts] = useState<{ id: number; impact: Impact }[]>([]);
  const burstId = useRef(0);
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
    // Seeded like every other authored setting. Left at its previous value the
    // slider would show one clip's pace while a different clip played.
    setStepMs(stepMsFor(who, clipName));
    setImpacts((CLIP_IMPACTS[`${who}/${clipName}`] ?? []).map((i) => ({ ...i })));
    setAt(0);
    setSettled(false);
    setDirty(false);
    setStatus(null);
    setRun((r) => r + 1);
  }, [who, clipName, clip?.frames]);

  const showing = mode === 'once' && settled && rest ? rest : clip;
  const showingName = mode === 'once' && settled && restName ? restName : clipName;
  const editing = showingName === clipName;

  /* Which ability, if any, this clip animates. Matched on the name slug, the
     same rule the battle uses to pick a clip for an ability. */
  const ability = useMemo(() => {
    const def = ROSTER.find((d) => d.id === who);
    return def?.abilities.find((a) => abilitySlug(a.name) === clipName);
  }, [who, clipName]);

  const hittable = !!ability?.effects?.some((fx) => fx.do === 'damage');
  const splitKey = ability ? hitSplitKey(who, ability.name) : '';
  const savedShares = splitKey ? HIT_SPLITS[splitKey] : undefined;
  const liveShares = shares ?? savedShares ?? null;

  useEffect(() => {
    // Reset to what is on disk whenever the clip changes, so an edit cannot
    // follow you onto a different ability.
    setShares(null);
    setSharesSaved(null);
  }, [who, clipName]);

  async function saveShares(next: number[] | null) {
    const all: Record<string, number[]> = { ...HIT_SPLITS };
    if (next && next.length > 1) all[splitKey] = next;
    else delete all[splitKey];
    try {
      const res = await fetch('/__hits/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ splits: all }),
      });
      const body = (await res.json()) as { error?: string };
      setSharesSaved(!res.ok || body.error ? `failed: ${body.error ?? res.statusText}` : 'saved');
    } catch (e) {
      setSharesSaved(`failed: ${e instanceof Error ? e.message : 'dev server unreachable'}`);
    }
  }

  // Only the shown clip carries live edits; whatever it settles into plays as
  // saved, which is exactly the comparison the hand-off is meant to test.
  const steps = useMemo(() => {
    if (!showing) return [];
    return editing
      ? clipTimeline(showing.frames, tune, order)
      : clipTimeline(showing.frames, tuningFor(who, showingName), orderFor(who, showingName));
  }, [showing?.frames, editing, tune, order, who, showingName]);

  const livePlace = editing ? place : placementFor(who, showingName);

  // The pose track, regenerated on every edit so a scale typed into the grid
  // shows up on the next frame rather than on the next save.
  const poseCss = useMemo(
    () => poseKeyframes(poseAnimName(who, showingName), steps),
    [who, showingName, steps],
  );

  const css = useMemo(
    () =>
      (showing ? clipKeyframes(clipAnimName(who, showingName), showing.frames, steps) : '') +
      (poseCss ? `
${poseCss}` : ''),
    [who, showingName, showing?.frames, steps, poseCss],
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
    /*
     * The damage split goes first, and goes with the same button.
     *
     * It had its own Save, and that was a trap: you would add a hit, press the
     * Save you were already using for everything else, and watch the page
     * reload with the split thrown away. Two buttons where one of them silently
     * does not save what you just edited is worse than either alone.
     *
     * The FILES stay separate -- balance in `hitSplits.ts`, timing in the
     * actor's anim file -- because that line is worth keeping. Only the gesture
     * merges.
     *
     * Ordered before the clip write because writing the anim file is what
     * triggers the dev server's reload; doing it second means both writes have
     * already landed by the time anything refreshes.
     */
    if (ability && liveShares) await saveShares(liveShares);
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
          stepMs,
          impacts,
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
  /**
   * Take ONE step out of the order, by position.
   *
   * It used to filter by source, which removed every copy of a duplicated
   * drawing at once -- so disabling the second of three identical frames threw
   * away all three.
   */
  function removeFrameAt(pos: number) {
    setOrder((prev) => prev.filter((_, i) => i !== pos));
    setImpacts((l) =>
      l
        // An effect hung on a step that no longer plays has nowhere to fire.
        .filter((im) => im.frame !== pos)
        .map((im) => (im.frame > pos ? { ...im, frame: im.frame - 1 } : im)),
    );
    setDirty(true);
  }

  /** Put a source frame back, at the end, where it can then be moved. */
  function addFrame(source: number) {
    setOrder((prev) => [...prev, source]);
    setDirty(true);
  }

  /*
   * Repeat a drawing in the played order.
   *
   * `order` was always able to express this -- it is just the same index twice
   * -- but nothing in the lab could produce it. Two reasons to want it: holding
   * a pose for a beat that a `hold` multiplier would stretch too smoothly, and
   * giving a drawing more than one moment to throw an effect from, since
   * impacts are keyed to frames and a three-frame swing otherwise offers
   * exactly three timings.
   *
   * Inserted immediately after the frame it copies, because that is where a
   * repeat belongs; moving it elsewhere is what the arrows are for.
   */
  function duplicateFrame(pos: number) {
    const next = [...order];
    next.splice(pos + 1, 0, order[pos]!);
    setOrder(next);
    /*
     * Impacts are positions, so inserting a step moves everything after it.
     *
     * Without this every duplicate would silently drag the later sparks one
     * frame earlier in the clip. Impacts AT `pos` stay put -- they belong to
     * the original -- so the copy arrives with none of its own, which is what
     * makes it worth having: a second showing of the same drawing that can
     * throw something different.
     */
    setImpacts((l) => l.map((im) => (im.frame > pos ? { ...im, frame: im.frame + 1 } : im)));
    setDirty(true);
  }

  function moveFrame(pos: number, delta: number) {
    const to = pos + delta;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[pos], next[to]] = [next[to], next[pos]];
    setOrder(next);
    // The effects travel with the step they were attached to. Swapping the
    // drawings and leaving the sparks behind would reorder two things the
    // animator thinks of as one.
    setImpacts((l) =>
      l.map((im) => (im.frame === pos ? { ...im, frame: to } : im.frame === to ? { ...im, frame: pos } : im)),
    );
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

  /*
   * Spawn the clip's impacts on the clip's own schedule.
   *
   * Driven by `impactTimes`, the same function the battle calls, so a spark
   * that lands here lands there -- including several sharing a frame and
   * separating themselves with `delay`, and a duplicated frame throwing one
   * each time it plays.
   *
   * Re-armed whenever the clip, its timing or its impacts change, which is what
   * makes dragging a slider show its result immediately. `run` is in the deps
   * so the replay button restarts the volley along with the animation.
   */
  useEffect(() => {
    // Not gated on the dummy any more. A `caster` burst plays on the performer,
    // so it is visible whether or not there is a stand-in target on screen --
    // and an animator turning the dummy off to see the figure clearly was the
    // most likely person to be tuning one.
    if (!playing || !showing) return;
    // The LIVE list, not the saved one: the dummy exists to show the edit you
    // are making. `editing` is false while previewing another actor's clip, and
    // then the saved catalogue is the right answer.
    const marks = impactTimes(who, showingName, steps, stepMs, editing ? impacts : undefined);
    if (!marks.length) return;
    const timers: number[] = [];
    const fire = () => {
      for (const { at, impact } of marks) {
        timers.push(
          window.setTimeout(() => {
            const id = burstId.current++;
            setBursts((b) => [...b, { id, impact }]);
            window.setTimeout(
              () => setBursts((b) => b.filter((x) => x.id !== id)),
              impact.ms ?? BURST_MS,
            );
          }, at),
        );
      }
    };
    fire();
    // A looping clip replays its impacts every lap; a one-shot fires once, the
    // same as it does in a battle.
    const loop = mode === 'loop' ? window.setInterval(fire, Math.max(1, duration)) : null;
    return () => {
      timers.forEach(window.clearTimeout);
      if (loop) window.clearInterval(loop);
      setBursts([]);
    };
  }, [dummy, playing, mode, who, showingName, steps, stepMs, duration, impacts, run, showing]);
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
            {/* A slot-named clip shows WHICH ability it is currently bound to.
                `ability_2` alone is a filing reference, not information -- and
                the binding is positional, so a kit reorder repoints the art
                with nothing to say it did. Printing it here is what makes that
                visible at the moment somebody is looking at the animation. */}
            {names.map((n) => {
              const bound = slotAbilityName(n, ROSTER.find((d) => d.id === who)?.abilities);
              return (
                <option key={n} value={n}>
                  {n}
                  {bound ? ` — ${bound}` : ''} {clips[n].loops ? '(loops)' : '(one-shot)'}
                </option>
              );
            })}
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

        {/* Preview only, and labelled as such. It zooms the lab so a clip can be
            judged at more than one size; it is not saved and does not reach the
            game. A character's size in battle comes from how tall they are drawn
            on their native canvas -- `nativePx / nativeCanvas` in
            sprites.generated.ts -- so making one bigger means redrawing them
            taller, not turning a knob here. */}
        <label>
          Preview size <span className="dim">{Math.round(height)}px · not saved</span>
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

        <label className="lab-check">
          <input type="checkbox" checked={dummy} onChange={(e) => setDummy(e.target.checked)} />
          Practice dummy
        </label>

        {/* Impacts: which effect, on which drawing, and where it lands.
            Frame-indexed, so retiming the clip moves the spark with it. */}
        {/*
          Damage split, beside the impacts it lands on.

          Shares are RATIOS -- `1 1 2` is a quarter, a quarter and a half -- so
          the resolved percentages are shown underneath, because the ratio is
          what you type and the percentage is what you are actually deciding.

          It saves separately from the clip. The split is balance and lives in
          `src/engine/hitSplits.ts`; the timing is presentation and lives in the
          actor's anim file. One button writing both would blur a line worth
          keeping, and the mismatch warning below is the only place they need to
          know about each other.
        */}
        {hittable && ability && (
          <div className="lab-impacts lab-split">
            <div className="lab-impacts-head">
              <span>Damage split — {ability.name}</span>
              <button
                type="button"
                onClick={() => {
                  setShares([...(liveShares ?? [1]), 1]);
                  setDirty(true);
                }}
                title="Add a blow"
              >
                Add hit
              </button>
            </div>

            {!liveShares || liveShares.length < 2 ? (
              <p className="dim">One hit. Add another to split the damage.</p>
            ) : (
              <>
                <div className="lab-split-rows">
                  {liveShares.map((v, i) => {
                    const total = liveShares.reduce((n, x) => n + Math.max(0, x), 0) || 1;
                    return (
                      <label key={i}>
                        <b>{i}</b>
                        <input
                          type="number"
                          step={0.5}
                          min={0.1}
                          value={v}
                          onChange={(e) => {
                            const n = Math.max(0.1, +e.target.value);
                            setShares(liveShares.map((x, j) => (j === i ? n : x)));
                            setDirty(true);
                          }}
                        />
                        <span className="dim">
                          {Math.round((v / total) * (ability.power ?? 1) * 1000) / 10}%
                        </span>
                        <button
                          type="button"
                          className="lab-impact-drop"
                          title="Remove this blow"
                          onClick={() => {
                            setShares(liveShares.filter((_, j) => j !== i));
                            setDirty(true);
                          }}
                        >
                          ×
                        </button>
                      </label>
                    );
                  })}
                </div>
                {liveShares.length !== impacts.length && (
                  <p className="dim lab-split-warn">
                    {liveShares.length} hits but {impacts.length} impact
                    {impacts.length === 1 ? '' : 's'} — leftovers all land on the last one.
                  </p>
                )}
              </>
            )}

            {sharesSaved && <p className="dim">split {sharesSaved}</p>}
          </div>
        )}

        <div className="lab-impacts">
          <div className="lab-impacts-head">
            <span>Impact effects</span>
            <button
              type="button"
              disabled={!clip || Object.keys(EFFECTS).length === 0}
              onClick={() => {
                const first = Object.keys(EFFECTS)[0];
                if (!first || !clip) return;
                setImpacts((list) => [
                  ...list,
                  // Defaults to the LAST frame, which is the safe guess for a
                  // swing: better to land late than to spark before contact.
                  { frame: Math.max(0, order.length - 1), effect: first, at: 'each' },
                ]);
                setDirty(true);
              }}
            >
              Add
            </button>
          </div>

          {impacts.length === 0 && <p className="dim">None. This clip throws no effects.</p>}

          {impacts.map((im, idx) => {
            const fx = EFFECTS[im.effect];
            const set = (patch: Partial<Impact>) => {
              setImpacts((l) => l.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
              setDirty(true);
            };
            const num = (
              key: 'scale' | 'dx' | 'dy' | 'delay' | 'ms',
              label: string,
              fallback: number,
              step: number,
              min?: number,
            ) => (
              <label>
                <span>{label}</span>
                <input
                  type="number"
                  step={step}
                  min={min}
                  value={im[key] ?? fallback}
                  onChange={(e) => {
                    const v = min != null ? Math.max(min, +e.target.value) : +e.target.value;
                    set({ [key]: v } as Partial<Impact>);
                  }}
                />
              </label>
            );
            return (
              <div className="lab-impact" key={idx}>
                {/* Head: what it is and where it lands. The two questions that
                    identify an impact, so they read on one line before any of
                    the numbers that tune it. */}
                <div className="lab-impact-head">
                  <select value={im.effect} onChange={(e) => set({ effect: e.target.value })}>
                    {Object.keys(EFFECTS).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                  <select
                    value={im.at ?? 'each'}
                    onChange={(e) => set({ at: e.target.value as Impact['at'] })}
                    title="Where it lands. Which SIDE is decided by who the ability affected -- except on the caster, who is never in question."
                  >
                    <option value="each">on each target</option>
                    <option value="centre">once, at their centre</option>
                    <option value="caster">once, on the caster</option>
                  </select>
                  <button
                    type="button"
                    className="lab-impact-drop"
                    onClick={() => {
                      setImpacts((l) => l.filter((_, i) => i !== idx));
                      setDirty(true);
                    }}
                    title="Remove this impact"
                  >
                    ×
                  </button>
                </div>

                {/* Timing, then placement, then life. Grouped because that is
                    the order they get decided in, and each group is short
                    enough to scan without reading the labels twice. */}
                <div className="lab-impact-grid">
                  <label>
                    <span>step</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, order.length - 1)}
                      value={im.frame}
                      onChange={(e) =>
                        set({ frame: Math.max(0, Math.min(order.length - 1, +e.target.value)) })
                      }
                    />
                  </label>
                  {num('delay', '+ms', 0, 20, 0)}
                  {num('ms', 'lasts', BURST_MS, 20, 40)}
                  {num('scale', 'scale', 1, 0.05, 0.1)}
                  {num('dx', 'x%', 0, 2)}
                  {num('dy', 'y%', 0, 2)}
                </div>

                {/* What the numbers above actually resolve to. Both are things
                    you would otherwise work out on paper: which drawing the
                    step lands on, and what the duration is per frame. */}
                <div className="lab-impact-foot">
                  <span>
                    {order[im.frame] != null ? `drawing ${order[im.frame]}` : 'no such step'}
                  </span>
                  {fx && <span>{Math.round((im.ms ?? BURST_MS) / fx.frames)}ms/frame × {fx.frames}</span>}
                </div>
              </div>
            );
          })}
        </div>

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
              {/* The same pose wrapper the battle renders, driven by the same
                  helper. The lab is only worth trusting if what it shows and
                  what the battle shows come out of one code path -- a preview
                  with its own idea of squash would let an animator tune against
                  a figure nobody else ever sees. */}
              <span
                className="anim-pose"
                key={`pose/${who}/${showingName}/${run}`}
                style={
                  playing
                    ? {
                        animationName: poseCss ? poseAnimName(who, showingName) : undefined,
                        animationDuration: poseCss ? `${duration}ms` : undefined,
                        animationTimingFunction: 'linear',
                        animationIterationCount: mode === 'once' ? 1 : 'infinite',
                        ...(mode === 'once' ? { animationFillMode: 'forwards' as const } : null),
                      }
                    : // Stepping frame by frame: hold the picked frame's pose
                      // rather than running a track, or the pose would animate
                      // while the drawing under it stood still.
                      { transform: poseTransform(shownStep?.tune) }
                }
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
            {/*
              Where a `caster` impact lands: a box the dummy's size and shape,
              laid over the performer.

              Sized to match the dummy rather than to the clip's box on purpose.
              `scale` is a fraction of the body the burst plays on, and the clip
              box is as tall as the highest jump and as wide as the widest swing
              -- judging a buff against that would make the number mean one
              thing in the lab and another in a battle, where the burst rides
              the unit's slot.
            */}
            <span className="lab-caster-fx" style={{ height, width: height * 0.42 }}>
              {bursts
                .filter(({ impact }) => impact.at === 'caster')
                .map(({ id, impact }) => (
                  <LabBurst key={id} impact={impact} />
                ))}
            </span>
          </span>
          {/* No caption here on purpose. It sat under the sprite, and its TEXT
              width set the figure's width -- so the moment a clip handed off to
              its ending the longer name widened the figure, the flex row
              re-centred, and the sprite visibly jumped sideways. The reading it
              gave now lives in the controls above, where nothing it does can
              move the art. */}
        </figure>

        {/*
          The practice dummy: something for the effects to land ON.

          A plain silhouette rather than a real character, because the question
          this answers is "does the spark read, and does it land where I meant"
          -- and borrowing a Performer would put their art in the way of the
          answer while implying the effect belongs to them.

          Sized to the figure height so `scale` means here what it means in a
          battle, where an impact is a fraction of the TARGET's height.
        */}
        {dummy && (
          <figure className="lab-dummy-fig">
            <span className="lab-dummy" style={{ height, width: height * 0.42 }}>
              {bursts
                .filter(({ impact }) => impact.at !== 'caster')
                .map(({ id, impact }) => (
                  <LabBurst key={id} impact={impact} />
                ))}
            </span>
            <figcaption className="dim">dummy</figcaption>
          </figure>
        )}
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
                  title={`Step ${pos} — drawing ${source}`}
                  onClick={() => {
                    setMode('step');
                    setAt(pos);
                  }}
                >
                  {/* Position first, because that is what an impact names now.
                      The drawing is the smaller number beside it -- with
                      duplicates the two differ, and which is which is the
                      difference between an effect landing where you meant and
                      landing on all three copies. */}
                  {pos}
                  <em>·{source}</em>
                </button>
                <button
                  className="lab-tune-move"
                  disabled={pos === order.length - 1}
                  title="Move later"
                  onClick={() => moveFrame(pos, 1)}
                >
                  ▶
                </button>
                <button
                  className="lab-tune-move"
                  title="Play this drawing again, straight after this one"
                  onClick={() => duplicateFrame(pos)}
                >
                  ⧉
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
              {/* Squash, stretch and lean. Anchored at the feet, so a scale
                  below 1 settles the figure onto the boards rather than
                  shrinking it towards its own middle. */}
              <label>
                scale
                <input
                  type="number"
                  step={0.05}
                  min={0.2}
                  max={3}
                  value={tune[source]?.scale ?? 1}
                  autoComplete="off"
                  onChange={(e) => editTune(source, { scale: +e.target.value })}
                />
              </label>
              <label>
                skewX°
                <input
                  type="number"
                  step={1}
                  min={-45}
                  max={45}
                  value={tune[source]?.skewX ?? 0}
                  autoComplete="off"
                  onChange={(e) => editTune(source, { skewX: +e.target.value })}
                />
              </label>
              <label>
                skewY°
                <input
                  type="number"
                  step={1}
                  min={-45}
                  max={45}
                  value={tune[source]?.skewY ?? 0}
                  autoComplete="off"
                  onChange={(e) => editTune(source, { skewY: +e.target.value })}
                />
              </label>
              <button
                className="lab-tune-off"
                title="Leave this step out of playback"
                onClick={() => removeFrameAt(pos)}
              >
                remove
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
                  <button className="lab-tune-off" onClick={() => addFrame(source)}>
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
