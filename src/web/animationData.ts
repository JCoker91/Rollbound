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

const tuning: Record<string, ClipTuning> = {};
const placement: Record<string, ClipPlacement> = {};
const order: Record<string, number[]> = {};

for (const [path, data] of Object.entries(files)) {
  const who = ownerOf(path);
  for (const [clip, settings] of Object.entries(data ?? {})) {
    if (settings?.frames?.length) tuning[key(who, clip)] = settings.frames;
    if (settings?.placement && Object.keys(settings.placement).length) {
      placement[key(who, clip)] = settings.placement;
    }
    if (settings?.order?.length) order[key(who, clip)] = settings.order;
  }
}

export const ANIMATION_TUNING: Record<string, ClipTuning> = tuning;
export const CLIP_PLACEMENT: Record<string, ClipPlacement> = placement;
export const CLIP_ORDER: Record<string, number[]> = order;

/** Everything authored for one actor, for the lab's save round-trip. */
export function actorAnimData(who: string): ActorAnimData {
  const entry = Object.entries(files).find(([path]) => ownerOf(path) === who);
  return entry?.[1] ?? {};
}
