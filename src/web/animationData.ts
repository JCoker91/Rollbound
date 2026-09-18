/**
 * Hand-authored animation settings, loaded from each actor's own JSON.
 *
 * Lives at `art/actors/<name>/<name>.anim.json`, beside the art it describes and
 * beside the generated `<name>.pack.json`. Two deliberate properties:
 *
 * AUTHORED, never generated. `pack_sprites.py` writes `<name>.pack.json` and
 * nothing else, so a re-pack can never erase a judgement call about how a clip
 * should feel. Keeping the two in separate files is what makes that guarantee
 * simple enough to trust.
 *
 * ONE FILE PER ACTOR, for the same reason the pack manifest is: an actor's
 * folder should be the complete, portable unit, and tuning Maxine should not
 * rewrite a file that also describes Benjamin.
 *
 * The lab writes these through a dev-only endpoint (see `vite.config.ts`), so
 * the Save button in the animation lab and a hand edit produce the same file.
 *
 * ```json
 * {
 *   "celebration": {
 *     "placement": { "scale": 1.04, "dy": 2 },
 *     "frames": [{}, {}, { "hold": 2 }, { "dy": -4 }],
 *     "order": [0, 1, 3]
 *   }
 * }
 * ```
 */

/** Offsets are in percent of ONE FRAME, so they survive any render size. */
export interface FrameTune {
  /** How long this frame holds, relative to a plain frame. 1 is normal. */
  hold?: number;
  /** Nudge right, percent of a frame's width. */
  dx?: number;
  /** Nudge down, percent of a frame's height. */
  dy?: number;
  /*
   * Squash and stretch, applied to the drawing rather than to the strip.
   *
   * These are the classic animation cheat: a jump reads as weight if the figure
   * stretches on the way up and compresses on landing, and doing that with
   * transforms means one drawing can serve several beats. Anchored at the feet,
   * so a squash settles into the floor instead of sinking through it.
   *
   * They live on their own element for a mechanical reason -- see
   * `poseKeyframes`. Scaling the STRIP would scale the offset that selects
   * which frame is showing, and the clip would slide off its own frames.
   */
  /** Multiplies the drawing's size. 1 is untouched. */
  scale?: number;
  /** Horizontal lean, in degrees. Positive tips the top to the right. */
  skewX?: number;
  /** Vertical shear, in degrees. Positive drops the right edge. */
  skewY?: number;
}

export type ClipTuning = FrameTune[];

/**
 * Size and position for a whole clip, relative to the foot anchor.
 *
 * The pack step already puts every clip of a character at one scale on a shared
 * foot point, so most clips need nothing here. This is for what measurement
 * cannot settle: art whose proportions differ enough that matching figure
 * heights still reads wrong, or a pose that should sit forward of the mark.
 */
export interface ClipPlacement {
  /** Multiplies the rendered size. 1 is what the pack step decided. */
  scale?: number;
  /** Nudge right, percent of the clip's box width. */
  dx?: number;
  /** Nudge UP, percent of the clip's box height. */
  dy?: number;
}

export interface ClipSettings {
  placement?: ClipPlacement;
  /**
   * Milliseconds per plain frame, which sets the clip's overall pace.
   *
   * Per clip rather than global: a bounce idle and a celebration are not the
   * same tempo, and the sheets they come from are not drawn at a common frame
   * rate either. Omitted means `DEFAULT_STEP_MS`.
   *
   * `frames[].hold` multiplies this for one frame; this is the base it
   * multiplies. Both are needed -- one sets the clip's speed, the other its
   * rhythm.
   */
  stepMs?: number;
  /**
   * Per-frame tuning, indexed by the frame's position in the SOURCE strip --
   * not by its position in playback. Keeping it source-indexed is what lets a
   * hold or a nudge stay attached to the drawing it was authored for when the
   * order changes underneath it.
   */
  frames?: ClipTuning;
  /**
   * Playback sequence, as source frame indices. Omitted means "every frame, in
   * order", which is the overwhelmingly common case and not worth writing out.
   *
   * A frame missing from this list is DISABLED -- still in the image, never
   * shown. Dropping a bad frame is worth doing in data rather than by
   * re-exporting the sheet, because the sheet is expensive to regenerate and
   * the packed strip's frame count is baked into the metrics.
   */
  order?: number[];
  /**
   * Effects that land on the TARGET partway through this clip.
   *
   * Frame-indexed rather than time-indexed, because the moment a blow connects
   * is a property of the drawing, not of the clock: retime the clip and the
   * spark still has to land on the frame where the sword is in the creature.
   * Indices name SOURCE frames, so they survive a reordered `order` the same
   * way `frames` tuning does.
   *
   * A list, not one entry, because an ability can connect more than once -- a
   * two-hit swing splitting its power across two contacts needs a burst on
   * each, at the frame each lands.
   */
  impacts?: Impact[];
}

/**
 * Where an impact effect lands.
 *
 *   each    one burst per affected unit -- a sword landing on the creature it
 *           hit, and on all five when the ability hits five.
 *   centre  ONE burst at the middle of everyone affected, for an area effect
 *           that reads as a single event rather than five simultaneous ones.
 *
 * The SIDE is not a choice: an effect lands on whoever the ability actually
 * affected, so an attack bursts on enemies and a heal on allies without either
 * having to say so. Making it selectable would let a sheet declare a spark on
 * the wrong team, which is a bug nobody would think to look for.
 */
export type ImpactPlacement = 'each' | 'centre';

/** One effect landing at a given step of a clip. */
export interface Impact {
  /**
   * WHICH PLAYED STEP this fires on -- a position in the order, not a drawing.
   *
   * It used to name the source frame, and that made duplicated frames
   * impossible to tell apart: repeat drawing 1 three times and an impact on
   * "frame 1" fired on all three, identically, with no way to give the second
   * showing a different effect. Addressing the position instead makes each
   * occurrence its own thing, which is the entire reason to duplicate a frame.
   *
   * For a clip in natural order the two are the same number, which is why this
   * change moved no existing data.
   */
  frame: number;
  /** Key into the generated `EFFECTS` registry. */
  effect: string;
  /** Default `each`. See `ImpactPlacement`. */
  at?: ImpactPlacement;
  /** Size relative to the target's own height. 1 is the target's full height. */
  scale?: number;
  /** Nudge from the target's centre, in percent of the target's box. */
  dx?: number;
  dy?: number;
  /**
   * Milliseconds after the frame starts, for placing a spark WITHIN a drawing.
   *
   * Frames are the coarse grid and a three-frame swing only has three of them,
   * so a volley of sparks landing one after another had nowhere to go. This is
   * the fine adjustment: several impacts can share a frame and separate
   * themselves in time.
   */
  delay?: number;
  /**
   * How long the whole burst plays, in milliseconds. Default `BURST_MS`.
   *
   * The sheet is stepped across this span, so per-frame time is this divided by
   * the effect's frame count -- which is the number an animator actually thinks
   * in, and why the lab shows both.
   *
   * Per impact rather than per effect on purpose. The same three-frame spark
   * wants to snap on a quick jab and linger on a heavy landing, and making it a
   * property of the EFFECT would force a second near-identical sheet to say
   * that. It is the same argument as `scale`, which is already per impact.
   */
  ms?: number;
}

/** One actor's file: clip name → settings. */
export type ActorAnimData = Record<string, ClipSettings>;

// Eager so the maps are plain data at module load -- the battle screen reads
// them while building keyframes and cannot await. Vite inlines these at build
// time, and edits to a file trigger a reload in dev.
const files = import.meta.glob<ActorAnimData>('../../art/actors/*/*.anim.json', {
  eager: true,
  import: 'default',
});

const key = (who: string, clip: string): string => `${who}/${clip}`;

/** `who` is the folder name, which is also the character id. */
const ownerOf = (path: string): string => path.split('/').slice(-2)[0];

/**
 * Pace for a clip with nothing authored.
 *
 * Lives here, beside the type, rather than in the battle screen: the lab and the
 * battle have to agree on it or a clip plays at one speed while being tuned and
 * another in play, which is exactly what made the lab's speed slider look
 * broken.
 */
export const DEFAULT_STEP_MS = 105;

const tuning: Record<string, ClipTuning> = {};
const placement: Record<string, ClipPlacement> = {};
const order: Record<string, number[]> = {};
const stepMs: Record<string, number> = {};
const impacts: Record<string, Impact[]> = {};

for (const [path, data] of Object.entries(files)) {
  const who = ownerOf(path);
  for (const [clip, settings] of Object.entries(data ?? {})) {
    if (settings?.frames?.length) tuning[key(who, clip)] = settings.frames;
    if (settings?.placement && Object.keys(settings.placement).length) {
      placement[key(who, clip)] = settings.placement;
    }
    if (settings?.order?.length) order[key(who, clip)] = settings.order;
    if (settings?.stepMs) stepMs[key(who, clip)] = settings.stepMs;
    if (settings?.impacts?.length) impacts[key(who, clip)] = settings.impacts;
  }
}

export const ANIMATION_TUNING: Record<string, ClipTuning> = tuning;
export const CLIP_PLACEMENT: Record<string, ClipPlacement> = placement;
export const CLIP_ORDER: Record<string, number[]> = order;
export const CLIP_STEP_MS: Record<string, number> = stepMs;
export const CLIP_IMPACTS: Record<string, Impact[]> = impacts;

/**
 * When each impact of a clip lands, in milliseconds from the clip's start.
 *
 * Resolved against the PLAYED timeline rather than the source strip: per-frame
 * holds stretch some frames and `order` can drop others, so "frame 15" is not
 * 15 steps in. An impact whose frame is never played simply does not fire,
 * which is the right answer -- a blow that was edited out should not still
 * land.
 */
export function impactTimes(
  who: string,
  clip: string,
  steps: { source: number; hold: number }[],
  stepMs: number,
  /*
   * An override, for previewing impacts that are not on disk yet.
   *
   * The saved catalogue is the right source everywhere except the lab, where
   * the whole point is to see the edit before committing it -- without this the
   * practice dummy replayed whatever was last saved and ignored the row you
   * were dragging, which is worse than showing nothing because it looks like an
   * answer.
   */
  override?: Impact[],
): { at: number; impact: Impact }[] {
  const list = override ?? CLIP_IMPACTS[key(who, clip)];
  if (!list?.length) return [];
  const out: { at: number; impact: Impact }[] = [];
  for (const impact of list) {
    // Walk to the impact's STEP and take the time there. Indexing the played
    // order rather than searching for a source frame is what lets two copies of
    // one drawing carry different effects.
    let t = 0;
    for (let i = 0; i < steps.length; i++) {
      if (i === impact.frame) {
        out.push({ at: t + (impact.delay ?? 0), impact });
        break;
      }
      t += steps[i]!.hold * stepMs;
    }
  }
  return out;
}

/** Authored pace for one clip, or the default. */
export function stepMsFor(who: string, clip: string): number {
  return CLIP_STEP_MS[key(who, clip)] ?? DEFAULT_STEP_MS;
}

/** Everything authored for one actor, for the lab's save round-trip. */
export function actorAnimData(who: string): ActorAnimData {
  const entry = Object.entries(files).find(([path]) => ownerOf(path) === who);
  return entry?.[1] ?? {};
}
