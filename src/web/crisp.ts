/**
 * Rounding a drawn figure to a whole multiple of the art's own pixels.
 *
 * Nearest-neighbour scaling is only faithful at integer factors. Asked for
 * 1.208x -- which is simply what the stage's proportions worked out to -- the
 * browser draws some source pixels one screen pixel wide and their neighbours
 * two, so a one-pixel outline comes out thick in places and thin in others. That
 * reads as blur even though nothing is ever interpolated. Rendered at 1x or 2x
 * the same sprite is razor sharp.
 *
 * Rounded to the NEAREST multiple, never below 1x, so a character stays as close
 * to the size the stage asked for as whole pixels allow.
 *
 * Two functions because the two screens size in different units, and that
 * distinction has already caused one bug: applying the pixel version to the
 * battle's stage fractions rounded 0.13 up to 83 and drew the cast 638x too
 * large. `crisp` is for CSS pixels; `crispCss` defers to the browser, which is
 * the only party that knows what a stage fraction resolves to.
 */

/**
 * The nearest clean scale for art `pxH` tall drawn at `px` tall.
 *
 * The step is `snapPx` -- what ONE pixel of the shared 128px canvas is worth in
 * this art (see content.ts). For art drawn on 128 that is one of its own
 * pixels, so it snaps to whole multiples of itself. For Brax on 256 each of his
 * pixels is worth half a baseline one, so his step is half his art height and
 * he can land at 1/2 scale -- which is what his stature asks for.
 *
 * Stepping by the art's own HEIGHT instead breaks both ways: it rounded Brax's
 * 211px art to nothing when asked for 105px (under half a step), and a quarter
 * step tried as a fix let the 128 cast drift onto 3/4 scales.
 */
/** For lengths already in CSS pixels. Snaps to whole multiples of `step`. */
export function crisp(px: number, step?: number, pixelated?: boolean): number {
  if (!pixelated || !step) return px;
  return Math.max(1, Math.round(px / step)) * step;
}

/**
 * For lengths expressed in container units, where the pixel size is not known
 * until layout. `round()` is doing exactly the same arithmetic as `crisp`, just
 * late enough to know what `cqh` resolves to.
 */
export function crispCss(value: string, step?: number, pixelated?: boolean): string {
  if (!pixelated || !step) return value;
  return `round(${value}, ${step}px)`;
}
