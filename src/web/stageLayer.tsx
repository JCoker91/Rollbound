import type { CSSProperties } from 'react';
import type { StageLayer } from '../engine/formation.ts';

/**
 * One stage piece, drawn the same way everywhere.
 *
 * Shared between the battle and the lab deliberately: a lab that renders a
 * layer even slightly differently from the game is a lab that lies, and every
 * number authored in it would need checking against a screenshot anyway --
 * which is the loop it exists to remove.
 */

/** Where the piece sits and how big it is. */
export function layerBox(l: StageLayer): CSSProperties {
  return {
    left: l.x != null ? `${l.x}%` : l.right != null ? 'auto' : 0,
    right: l.right != null ? `${l.right}%` : undefined,
    top: l.y != null ? `${l.y}%` : l.bottom != null ? 'auto' : 0,
    bottom: l.bottom != null ? `${l.bottom}%` : undefined,
    height: l.h != null ? `${l.h}%` : '100%',
    // `w` stretches; without it the aspect ratio is kept, which is what a prop
    // wants. A piece given neither a size nor a side pin fills the frame.
    width: l.w != null ? `${l.w}%` : l.h != null && (l.x != null || l.right != null) ? 'auto' : '100%',
    /*
     * The box is the picture. Stated HERE, in the shared module, because it is
     * the difference between the two screens agreeing and only appearing to.
     *
     * The battle stylesheet used to set `object-fit: cover` and the lab set
     * nothing, so a layer whose box aspect differed from its art's -- the
     * boards by a factor of 1.67, the columns by 1.66 -- was CROPPED in the
     * game and STRETCHED in the lab. Both drew the same rectangle in the same
     * place, which is why comparing element boxes found nothing wrong, and both
     * filled it with a different part of the image.
     *
     * `fill` rather than `cover` because stretching is the authored intent:
     * `w` and `h` exist so a piece can be pulled out of its natural proportions,
     * and a fit mode that quietly restores them is a fit mode that throws the
     * author's numbers away.
     */
    objectFit: 'fill',
  };
}

/** Depth-scaled cast shadow, or nothing. */
export function layerShadow(l: StageLayer): string | undefined {
  if (!l.shadow) return undefined;
  const d = l.depth;
  return (
    `drop-shadow(${(2 + d * 10).toFixed(1)}px ${(3 + d * 14).toFixed(1)}px ` +
    `${(4 + d * 12).toFixed(1)}px rgba(12, 6, 20, ${(0.32 + d * 0.22).toFixed(2)}))`
  );
}

/**
 * Draw one layer, wrapping it in a motion element only when it moves.
 *
 * The wrapper is conditional because a static piece should not carry an
 * animated element it never uses -- and because the wrapper owns the crossing
 * while the image owns the bob, which is only meaningful when both exist.
 */
export function LayerImg({
  layer,
  zIndex,
  className = '',
  onPointerDown,
}: {
  layer: StageLayer;
  zIndex: number;
  className?: string;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const m = layer.motion;
  const art = (
    <img
      src={layer.src}
      alt=""
      draggable={false}
      className={className}
      onPointerDown={onPointerDown}
      style={
        {
          // Identical whether it moves or not: the image places and sizes
          // itself inside the frame, and a moving layer's wrapper is the frame.
          position: 'absolute',
          ...layerBox(layer),
          zIndex: m ? undefined : zIndex,
          transform: layer.flip ? 'scaleX(-1)' : undefined,
          filter: layerShadow(layer),
          ...(m
            ? {
                ['--bob' as string]: `${m.bob ?? 0}%`,
                ['--bob-dur' as string]: `${m.bobSeconds ?? 3}s`,
                ['--cross-delay' as string]: `${m.delay ?? 0}s`,
              }
            : null),
        } as CSSProperties
      }
    />
  );

  if (!m) return art;
  return (
    <span
      className="stage-motion"
      style={
        {
          zIndex,
          /*
           * The wrapper is the WHOLE FRAME, not the layer's own box.
           *
           * It used to be the layer's box, and that made every animated layer
           * invisible: `layerBox` leaves `width: auto` unless the scene sets
           * `w`, an absolutely positioned box with `width: auto` shrink-to-fits
           * its content, and the content was asking for 100% of the box. The
           * two asked each other and settled on zero, so the birds were being
           * flown across the stage at nought pixels wide.
           *
           * Spanning the frame also makes `travel` mean something an animator
           * can reason about. A percentage translate resolves against the
           * element it is on, so on the old box it was a multiple of the bird's
           * own width -- 150% moved it a bird and a half. Here it is a
           * percentage of the STAGE, so 100% is exactly one screen across.
           */
          position: 'absolute',
          inset: 0,
          ['--cross' as string]: `${m.seconds}s`,
          ['--travel' as string]: `${m.travel ?? 0}%`,
          ['--sway' as string]: `${m.sway ?? 0}deg`,
          ['--cross-delay' as string]: `${m.delay ?? 0}s`,
        } as CSSProperties
      }
    >
      {art}
    </span>
  );
}
