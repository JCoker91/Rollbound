import {
  ANIMATION_TUNING,
  CLIP_ORDER,
  CLIP_PLACEMENT,
  type ClipPlacement,
  type ClipTuning,
  type FrameTune,
} from './animationData.ts';

/**
 * Turning a packed strip into a CSS animation, one frame at a time.
 *
 * The simple way to play a sprite strip is `steps(N)`: divide the strip into N
 * equal slices and cut between them on a fixed clock. That is what this used to
 * do, and it has three limits an animator runs straight into.
 *
 * Every frame lasts exactly as long as every other. Real motion does not work
 * that way -- an anticipation holds, the snap through the middle is fast, the
 * settle eases out. Uniform frames read as mechanical no matter how well the
 * frames are drawn.
 *
 * A frame can only ever sit where it was drawn. If a jump lands two pixels low,
 * the fix has to happen in the art.
 *
 * And every frame must play, in the order it was exported. One bad frame means
 * regenerating a whole sheet.
 *
 * So instead of `steps()` we emit explicit keyframes: one stop per PLAYED frame,
 * each marked `step-end` so it holds its value until the next stop rather than
 * sliding into it. That keeps the hard frame cut of `steps()` while making the
 * when, the where, and the whether of each frame addressable. An untuned clip
 * in its natural order reproduces `steps()` exactly.
 */

export type { ClipTuning, FrameTune, ClipPlacement };

export const clipKey = (who: string, clip: string): string => `${who}/${clip}`;

/** CSS identifier for a clip's keyframes. Slashes are not legal in one. */
export const clipAnimName = (who: string, clip: string): string => `clip-${who}-${clip}`;

export const tuningFor = (who: string, clip: string): ClipTuning | undefined =>
  ANIMATION_TUNING[clipKey(who, clip)];

export const placementFor = (who: string, clip: string): ClipPlacement | undefined =>
  CLIP_PLACEMENT[clipKey(who, clip)];

export const orderFor = (who: string, clip: string): number[] | undefined =>
  CLIP_ORDER[clipKey(who, clip)];

/** A frame's hold, floored so a zero in a saved file cannot divide by nothing. */
const holdOf = (t: FrameTune | undefined): number => Math.max(0.05, t?.hold ?? 1);

/** One played frame: which drawing to show, and for how long. */
export interface Step {
  /** Index into the SOURCE strip. */
  source: number;
  hold: number;
  tune?: FrameTune;
}

/**
 * The played sequence.
 *
 * `order` names source frames, so a tune stays with its drawing however the
 * sequence is rearranged. Entries pointing outside the strip are dropped rather
 * than trusted -- a saved order outlives the sheet it was authored against, and
 * a re-export with fewer frames must not leave the animation showing a blank.
 * An order that survives none of that check falls back to the natural sequence,
 * because a clip that plays wrongly is still better than one that vanishes.
 */
export function clipTimeline(frames: number, tune?: ClipTuning, order?: number[]): Step[] {
  const natural = (): number[] => Array.from({ length: frames }, (_, i) => i);
  const kept = order?.length
    ? order.filter((i) => Number.isInteger(i) && i >= 0 && i < frames)
    : natural();
  const played = kept.length ? kept : natural();
  return played.map((source) => ({ source, hold: holdOf(tune?.[source]), tune: tune?.[source] }));
}

/**
 * Total playing time. A plain clip is `frames * stepMs`; holds stretch it and
 * disabled frames shorten it, so the speed control keeps meaning "how long a
 * normal frame lasts" either way.
 */
export function clipDuration(steps: Step[], stepMs: number): number {
  return Math.round(steps.reduce((total, s) => total + s.hold, 0) * stepMs);
}

/**
 * Where the strip must sit for source frame `i` to fill the window.
 *
 * Percentages are of the STRIP, which is `frames` windows wide -- so one frame
 * is `100 / frames` of it, and a nudge measured in frame-widths divides by the
 * same factor. Vertically the strip is exactly one frame tall, so `dy` passes
 * through untouched.
 */
export function frameTransform(i: number, frames: number, t?: FrameTune): string {
  const x = (-i * 100 + (t?.dx ?? 0)) / frames;
  const y = t?.dy ?? 0;
  return `translate(${+x.toFixed(4)}%, ${+y.toFixed(4)}%)`;
}

/** The `@keyframes` rule for one clip. */
export function clipKeyframes(name: string, frames: number, steps: Step[]): string {
  if (!steps.length) return '';
  const total = steps.reduce((sum, s) => sum + s.hold, 0);

  const stops: string[] = [];
  let at = 0;
  for (const step of steps) {
    const pct = +((at / total) * 100).toFixed(4);
    // `step-end` is what preserves the hard cut: the frame holds until the next
    // stop instead of sliding halfway between two drawings.
    stops.push(
      `  ${pct}% { transform: ${frameTransform(step.source, frames, step.tune)}; animation-timing-function: step-end; }`,
    );
    at += step.hold;
  }
  const last = steps[steps.length - 1];
  stops.push(`  100% { transform: ${frameTransform(last.source, frames, last.tune)}; }`);
  return `@keyframes ${name} {\n${stops.join('\n')}\n}`;
}

/** Keyframes for a set of clips, ready to drop into one `<style>`. */
export function keyframesFor(clips: { who: string; clip: string; frames: number }[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { who, clip, frames } of clips) {
    const name = clipAnimName(who, clip);
    if (seen.has(name)) continue;
    seen.add(name);
    const steps = clipTimeline(frames, tuningFor(who, clip), orderFor(who, clip));
    out.push(clipKeyframes(name, frames, steps));
  }
  return out.join('\n\n');
}

/**
 * How big a clip's box must be, and where to put it, to draw a character at a
 * given FIGURE height with their feet on the mark.
 *
 * The box is not the character. It is the union of every clip they own, so it
 * is as tall as their highest jump and as wide as their widest swing; sizing it
 * to the intended height therefore drew the character short, by an amount that
 * changed whenever a clip was added. `restFill` is the fraction of the box the
 * resting figure occupies, so dividing by it recovers the box that puts the
 * FIGURE at the height asked for.
 *
 * Everything is anchored on the foot point rather than the image centre --
 * `anchorX` across, the ground line down -- so a wider clip grows away from the
 * feet instead of shoving the character sideways off their slot.
 */
export interface ClipBox {
  /** Box size, in the same units as the figure height passed in. */
  boxH: number;
  boxW: number;
  /** Percent of box height to push down, landing the feet on the mark. */
  dropPct: number;
  /** Percent of box width to shift, landing the footing on the mark. */
  shiftPct: number;
}

export function clipBox(
  clip: { aspect: number; anchorX: number; restFill: number; footPad: number },
  figureH: number,
  place?: ClipPlacement,
): ClipBox {
  const boxH = (figureH / clip.restFill) * (place?.scale ?? 1);
  return {
    boxH,
    boxW: boxH * clip.aspect,
    // `dy` is a nudge UP, which reads better when the thing being nudged is a
    // character standing on a floor.
    dropPct: clip.footPad * 100 - (place?.dy ?? 0),
    shiftPct: (0.5 - clip.anchorX) * 100 + (place?.dx ?? 0),
  };
}
