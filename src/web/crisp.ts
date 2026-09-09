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

/** For lengths already in CSS pixels. */
export function crisp(px: number, pxH?: number, pixelated?: boolean): number {
  if (!pixelated || !pxH) return px;
  return Math.max(1, Math.round(px / pxH)) * pxH;
}

/**
 * For lengths expressed in container units, where the pixel size is not known
 * until layout. `round()` is doing exactly the same arithmetic as `crisp`, just
 * late enough to know what `cqh` resolves to.
 */
export function crispCss(value: string, pxH?: number, pixelated?: boolean): string {
  if (!pixelated || !pxH) return value;
  return `round(${value}, ${pxH}px)`;
}
