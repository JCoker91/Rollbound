"""
Re-cut a sprite sheet whose drawings overrun their own cells.

    python scripts/respace_sheet.py <sheet.png> [--frames N] [--write]

WHY THIS EXISTS

A sheet named `<actor>_<clip>_4x1.png` is sliced into four equal cells, and the
packer treats each slice as one frame. That only works if every drawing stays
inside its own quarter -- and a generated sheet very often does not. A raised
sword, a swing arc or a cape will reach past the cell edge into the neighbour,
and then the slice puts half of frame 3's flourish on the end of frame 2.

The drawings themselves are almost always fine. It is only the SPACING that is
wrong, and spacing can be repaired without regenerating anything: find the
drawings, give each one a cell wide enough to hold it, and lay them out again.

WHAT IT PRESERVES, AND WHY

Each figure keeps its offset from its own cell's centre. `normalise` in the
packer takes ONE foot point per clip rather than one per frame, on purpose --
"or a character shifting their weight would drag the whole clip sideways" -- so
per-frame horizontal drift is motion the animation is relying on, not error.
Re-centring every figure would quietly flatten a lunge into a stand.

Vertical position is untouched for the same reason: the rise and fall between
frames IS the animation.

WHAT IT DROPS

Stray specks -- a handful of stranded pixels the generator leaves behind. They
are invisible on screen but not to `content_box`, which is what decides the crop
for the whole clip, so one speck in a corner can pad every frame. Anything above
`--speck` is kept and assigned to a frame, because a detached sparkle or a
thrown weapon is a real part of a drawing.

Prints a report and changes nothing unless `--write` is given.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ALPHA_FLOOR = 8
#: Pixels below this are stranded noise. Comfortably below a drawn sparkle,
#: comfortably above the 2-7px specks these sheets actually carry.
SPECK = 64
#: Clear space left either side of the widest drawing, so nothing sits against
#: a cell edge where the next slice could shave it.
MARGIN = 16
#: How much of a figure's bottom counts as "the feet" when locating it.
FOOT_BAND = 30


def components(mask: bytearray, w: int, h: int) -> list[list[int]]:
    """Every connected run of opaque pixels, as flat pixel indices."""
    label = bytearray(w * h)
    out: list[list[int]] = []
    for seed in range(w * h):
        if not mask[seed] or label[seed]:
            continue
        stack = [seed]
        label[seed] = 1
        group = []
        while stack:
            p = stack.pop()
            group.append(p)
            x, y = p % w, p // w
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    q = ny * w + nx
                    if mask[q] and not label[q]:
                        label[q] = 1
                        stack.append(q)
        out.append(group)
    return out


def foot_x(points: list[int], w: int) -> float:
    """The centre of the drawing's lowest band -- where it is standing."""
    bottom = max(p // w for p in points)
    band = [p % w for p in points if p // w >= bottom - FOOT_BAND]
    return (min(band) + max(band)) / 2


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument('sheet', type=Path)
    ap.add_argument('--frames', type=int, default=0,
                    help='frames across; inferred from a _NxM name when omitted')
    ap.add_argument('--speck', type=int, default=SPECK)
    ap.add_argument('--write', action='store_true', help='overwrite the sheet')
    args = ap.parse_args()

    src = Image.open(args.sheet).convert('RGBA')
    w, h = src.size

    frames = args.frames
    if not frames:
        tail = args.sheet.stem.rsplit('_', 1)[-1].lower()
        if 'x' in tail and tail.replace('x', '').isdigit():
            cols, rows = (int(v) for v in tail.split('x'))
            if rows != 1:
                print(f'{args.sheet.name}: only single-row sheets are handled (found {rows} rows)')
                return 2
            frames = cols
    if not frames:
        print('cannot tell how many frames -- pass --frames')
        return 2

    mask = bytearray(1 if v >= ALPHA_FLOOR else 0 for v in src.getchannel('A').tobytes())
    groups = components(mask, w, h)
    specks = [g for g in groups if len(g) < args.speck]
    keep = [g for g in groups if len(g) >= args.speck]

    # Assign every surviving group to the cell its middle falls in. By GROUP
    # rather than by pixel, so a flourish that crosses a cell line travels whole
    # with the drawing it belongs to -- which is the entire point of this pass.
    cell = w / frames
    buckets: list[list[int]] = [[] for _ in range(frames)]
    for g in keep:
        xs = [p % w for p in g]
        mid = (min(xs) + max(xs)) / 2
        buckets[min(frames - 1, max(0, int(mid // cell)))].extend(g)

    empty = [i for i, b in enumerate(buckets) if not b]
    if empty:
        print(f'{args.sheet.name}: frames {empty} came out empty -- not touching this one.')
        return 2

    print(f'{args.sheet.name}  {w}x{h}, {frames} frames of {cell:g}px')
    print(f'  {len(keep)} drawing(s), {len(specks)} speck(s) under {args.speck}px')

    # How far each drawing reaches either side of its own feet, plus how far
    # those feet sit from where the cell centre says they should be. The new
    # cell has to hold the worst of both at once.
    plan = []
    reach = 0.0
    for i, pts in enumerate(buckets):
        xs = [p % w for p in pts]
        fx = foot_x(pts, w)
        drift = fx - cell * (i + 0.5)
        need = max(fx - min(xs), max(xs) - fx) + abs(drift)
        reach = max(reach, need)
        plan.append((pts, fx, drift, min(xs), max(xs)))
        print(f'  frame {i}: x {min(xs):5}-{max(xs):5}  foot {fx:7.1f}'
              f'  drift {drift:+6.1f}  reach {need:6.1f}')

    new_cell = int(2 * (reach + MARGIN))
    new_w = new_cell * frames
    print(f'  -> cells {cell:g} -> {new_cell}px, sheet {w} -> {new_w}px'
          + ('' if args.write else '   (dry run, pass --write to apply)'))
    if not args.write:
        return 0

    out = Image.new('RGBA', (new_w, h), (0, 0, 0, 0))
    px = src.load()
    for i, (pts, fx, drift, _, _) in enumerate(plan):
        # Only this drawing's own pixels, so an overlapping neighbour is not
        # dragged along with it. Built as its own layer and composited, which
        # also drops every speck without having to erase one.
        layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        lp = layer.load()
        for p in pts:
            x, y = p % w, p // w
            lp[x, y] = px[x, y]
        target = new_cell * (i + 0.5) + drift
        out.alpha_composite(layer, (round(target - fx), 0))

    args.sheet.write_bytes(b'')  # truncate first so a failed save cannot half-write
    out.save(args.sheet)
    print(f'  wrote {args.sheet}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
