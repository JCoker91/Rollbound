/**
 * The battle camera's zoom levels, in one place.
 *
 * These live outside the battle screen because the stage lab has to draw the
 * same numbers: the lab frames the whole 16:9 set while the battle only ever
 * shows a window of it, and an author composing against the wrong window puts
 * scenery where it will never be seen. That is not hypothetical -- a valance
 * and a row of footlights were both carefully placed and both invisible in play
 * before the lab started drawing the crop. Two copies of this constant would
 * put it straight back.
 */

/** What the camera rests at when nothing has its attention. */
export const REST_ZOOM = 1.7;
/**
 * How much of the screen's height a focused character should fill.
 *
 * Expressed as a FRACTION rather than as a zoom, because characters are not the
 * same size: at a fixed zoom Rebar fills the frame while Aethis sits in the
 * middle of it looking lost. Solving for the zoom per character instead means
 * every one of them is framed the same way, which is what a portrait shot is.
 */
export const FOCUS_FILL = 0.62;
/** Bounds on the solved zoom, so one unusual sprite cannot blow the shot out. */
export const FOCUS_MIN = 2.6;
export const FOCUS_MAX = 6.5;

/**
 * The zoom that makes a character of the given height fill `FOCUS_FILL`.
 *
 * `heightFraction` is the unit's drawn height as a fraction of the frame's, the
 * same unit `SLOT_H` is in. Scaling about a point shows `1/zoom` of the frame,
 * so a figure occupying `h` of the frame occupies `h * zoom` of what you can
 * see -- setting that equal to the target and solving is the whole calculation.
 */
export function focusZoomFor(heightFraction: number): number {
  if (!heightFraction) return FOCUS_MIN;
  return Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, FOCUS_FILL / heightFraction));
}
/** Somebody is performing. Matches `.closing-in`. */
export const PUSH_ZOOM = 2.6;

/**
 * What sits in the MIDDLE of the shot when nothing has the camera's attention.
 *
 * A point the camera centres on, not a scaling origin. The difference is the
 * whole reason focusing a back-rank character used to leave them stuck near the
 * edge: `transform-origin` names the one point a scale does NOT move, so aiming
 * it at somebody magnified the stage around them and left them exactly where
 * they already were. Centring is a translate, and it is the translate that was
 * missing.
 *
 * 0.5494 is the midpoint of the band the resting camera showed under the old
 * scheme, so the resting shot -- and the lab preview built from it -- comes out
 * unchanged to four decimal places.
 */
export const REST_EYE = { x: 0.5, y: 0.5494 };

/**
 * The translate that brings `p` to the centre of the frame, as a fraction.
 *
 * Independent of zoom, which is what makes it trustworthy: the same number
 * centres a subject at 1.7x and at 5.7x, so the shot cannot drift as the camera
 * pushes in.
 */
export const centreOn = (p: number): number => 0.5 - p;

/**
 * The shape of the frame the whole set is composed in, 1672/941.
 *
 * Shared rather than restated: the battle uses it to map a slot's position onto
 * the stage, and the lab uses it to work out what shape a preview of the battle
 * should be. Two copies would be two chances to disagree about the one number
 * every position in a scene is relative to.
 */
export const FRAME_ASPECT = 1672 / 941;

/**
 * The slice of the stage a given zoom actually shows, as fractions.
 *
 * With the subject translated into the middle of the frame, the window is
 * simply `1/zoom` of the stage centred on it -- which is what a camera pointed
 * at something has always meant, and what the earlier origin-based version only
 * managed when the subject happened to be dead centre already.
 */
export function visibleBand(zoom: number, centre: number): { from: number; to: number } {
  return { from: centre - 0.5 / zoom, to: centre + 0.5 / zoom };
}

/**
 * Keep the window inside the set.
 *
 * Centring is exact but not always possible: a subject close enough to an edge
 * would put half the shot past the end of the scenery. Clamping the centre --
 * rather than refusing to move -- gets as close as the set allows and stops
 * there, which looks like a camera reaching its limit instead of one ignoring
 * you.
 */
export function clampCentre(centre: number, zoom: number): number {
  const half = 0.5 / zoom;
  if (half >= 0.5) return 0.5;
  return Math.min(1 - half, Math.max(half, centre));
}
