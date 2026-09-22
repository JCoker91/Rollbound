"""
Cut a sprite sheet into one file per frame, so frames become editable things.

    python scripts/split_sheet.py <sheet.png> [--write] [--remove]
    python scripts/split_sheet.py --all <actor> [--write] [--remove]

WHY

A sheet is a single artefact: one bad drawing means regenerating all four, and
one drawing that overruns its cell spoils its neighbour. A folder of frames is
the opposite -- each drawing is its own file, so it can be replaced, fixed, or
lifted into a different animation entirely. That last one is worth saying out
loud: frames from several clips can be combined into a new one that the
generator would never produce in a single pass.

It also retires the `_NxM` suffix for anything split, because a folder's frame
count is how many files are in it. No grid to infer means no grid to infer
WRONG, and inferring wrong is what produced a 138,048-frame clip.

THE CUT

Uses the packer's own `gutter_cuts`, imported rather than reimplemented. The
split is a decision made once and kept forever, so it has to be the same
decision the packer would have made -- a second copy of that logic would drift
and the drift would only show up as frames that used to be right.

Each frame is written as its FULL CELL, not trimmed to its own content.
Trimming would throw away where the drawing sits inside the cell, and that
offset is the animation: a lunge is a figure moving across its cell between
frames, and `normalise` deliberately keeps one foot point per clip rather than
per frame so the motion survives.

Prints what it would do and changes nothing unless `--write` is given.
"""

from __future__ import annotations

import argparse
import sys
from math import gcd
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image

from pack_sprites import (  # noqa: E402  -- after the path fix above
    ACTORS,
    ALPHA_FLOOR,
    EXTRA_POSES,
    MAX_INFERRED_COLS,
    gutter_cuts,
    key_flat_background,
    parse_grid,
    split_sheet,
)


def frames_of(sheet: Image.Image, cols: int, rows: int) -> list[Image.Image]:
    """
    The cells, padded to one size, anchored TOP-LEFT.

    Gutter cutting gives cells of different widths, because it cuts where the
    drawings actually stop rather than where a grid says they should. Writing
    those out at their own sizes would then leave the packer to reconcile them,
    and it reconciles by padding -- a guess that moves the drawing.

    Top-left rather than centred, because that is how the packer already
    aligns a sheet's cells: `normalise` pastes every frame of a clip at one
    offset taken from the clip's median foot point, so a cell's LEFT EDGE is
    its alignment point. Matching that is what makes splitting a sheet a
    lossless operation -- pack the folder and you get the same bytes the sheet
    produced, which is the only way to be sure a split has not quietly restaged
    an animation somebody already tuned.

    Verified rather than assumed, and it took two tries: bottom-centred padding
    produced a different strip, and so did padding raw crops, because the packer
    keys the flat background out DURING the cut -- keying a padded cell is not
    the same operation as padding a keyed one. Hence `split_sheet` below rather
    than cropping by hand: the frames written here are literally the ones the
    packer would have held.
    """
    cells = split_sheet(sheet, (cols, rows))
    w = max(f.width for f in cells)
    h = max(f.height for f in cells)
    out = []
    for f in cells:
        if f.size == (w, h):
            out.append(f)
            continue
        page = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        page.alpha_composite(f, (0, 0))
        out.append(page)
    return out


def bleeding_frames(sheet: Image.Image, cols: int, rows: int, bx: int, by: int):
    """
    Cells cut WIDE, so every frame holds its whole drawing and some of its
    neighbour's -- which you then erase by hand.

    For the sheets this generator produces, some seams have no gutter at all.
    idle_3 is the case that prompted this: the first figure's sword tip crosses
    the cut and the second figure's scarf reaches back past it, so the two
    silhouettes are one continuous run of ink across the entire sheet. There is
    no cut that keeps both figures whole, and no amount of cleverness finds one
    -- the information a clean cut would need is not in the image.

    Cutting wide makes it a problem a person can solve. Frame 1 gets its whole
    sword plus an unwanted slice of frame 2; frame 2 gets its whole scarf plus a
    slice of frame 1. Deleting the intruder from each is an easy edit; redrawing
    a sword tip that was never captured is not.

    Every window is the SAME size, and positioned so each cell's left edge sits
    a constant `bx` inside it. That keeps the frames uniform -- the packer wants
    them that way -- and shifts every frame's content by the same amount, which
    is not a change to the animation at all: the packer crops the clip to the
    union of its content and a constant offset vanishes there.

    Windows run off the edge of the sheet on the first and last frames; PIL fills
    that with transparency, which is what an outer margin should be anyway.
    """
    xs, ys = gutter_cuts(sheet, cols, rows)
    w = max(xs[c + 1] - xs[c] for c in range(cols)) + 2 * bx
    h = max(ys[r + 1] - ys[r] for r in range(rows)) + 2 * by
    out, notes = [], []
    for r in range(rows):
        for c in range(cols):
            left, top = xs[c] - bx, ys[r] - by
            frame = key_flat_background(sheet.crop((left, top, left + w, top + h)))
            cell = (bx, bx + (xs[c + 1] - xs[c]))
            frame, dropped = drop_neighbours(frame, cell)
            if dropped:
                notes.append(f'frame {r * cols + c + 1}: erased {dropped} neighbour fragment(s)')
            out.append(frame)
    return out, notes


def drop_neighbours(frame: Image.Image, cell: tuple[int, int], floor: int = 200):
    """
    Erase whatever in this wide frame belongs to the NEXT drawing along.

    Cutting wide is what rescues a drawing that crosses its seam; it also drags
    in a slice of the neighbour, and erasing that by hand for every frame of
    every clip is the tedium this is meant to avoid. So: anything that is its
    own separate drawing and sits centred OUTSIDE the cell this frame owns is
    the neighbour's, and goes.

    Separateness is the safeguard. A fragment only qualifies if it is not
    connected to the figure -- so when the two drawings genuinely touch, nothing
    is guessed at and the frame comes back needing hand work, which the caller
    reports. On Benjamin's idle_3 the sword tip and the next figure's scarf
    overlap in x but never touch, so both frames clean up with no edit at all.

    Centre rather than any overlap, because a figure's own reach routinely
    crosses its cell edge -- that IS why the frame was cut wide. Only something
    whose middle lies outside the cell is somebody else's.
    """
    w, h = frame.size
    mask = bytearray(1 if v >= ALPHA_FLOOR else 0 for v in frame.getchannel('A').tobytes())
    label = bytearray(w * h)
    doomed: list[list[int]] = []
    for seed in range(w * h):
        if not mask[seed] or label[seed]:
            continue
        stack = [seed]
        label[seed] = 1
        group = []
        x0 = x1 = seed % w
        while stack:
            pt = stack.pop()
            group.append(pt)
            x, y = pt % w, pt // w
            if x < x0:
                x0 = x
            if x > x1:
                x1 = x
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    q = ny * w + nx
                    if mask[q] and not label[q]:
                        label[q] = 1
                        stack.append(q)
        if len(group) >= floor and not (cell[0] <= (x0 + x1) / 2 <= cell[1]):
            doomed.append(group)

    if not doomed:
        return frame, 0
    out = frame.copy()
    px = out.load()
    for group in doomed:
        for pt in group:
            px[pt % w, pt // w] = (0, 0, 0, 0)
    return out, len(doomed)


def seam_report(sheet: Image.Image, cols: int, rows: int) -> list[str]:
    """How much ink each vertical seam cuts through -- i.e. which frames need cleaning."""
    xs, _ = gutter_cuts(sheet, cols, rows)
    alpha = sheet.getchannel('A').point(lambda v: 1 if v >= ALPHA_FLOOR else 0)
    px = alpha.load()
    notes = []
    for i, x in enumerate(xs[1:-1], 1):
        ink = sum(px[x, y] for y in range(sheet.height))
        if ink:
            notes.append(f'seam {i} (x={x}) cuts through {ink} px of drawing'
                         f' -- frames {i} and {i + 1} will each hold part of the other')
    return notes


def readable(p: Path) -> str:
    """
    A path short enough to read, without ever failing to produce one.

    This was `p.relative_to(ACTORS.parent.parent)`, which crashed the whole
    split -- from a line whose only job was to print a heading. `ACTORS` is
    relative, so the comparison only worked while the caller's paths were
    relative too; the upload endpoint passes an absolute `--out` and
    `relative_to` raises rather than giving up. A formatting convenience must
    not be able to take the operation down with it, so this falls back to the
    full path instead of throwing.
    """
    try:
        return str(p.relative_to(Path.cwd()))
    except ValueError:
        return str(p)


def analyse(path: Path, grid: str | None) -> dict:
    """
    What the cut WOULD be, as data, so a UI can draw it.

    The upload page needs to show where the frames land before anything is
    written, and the only honest way to show that is to ask the code that
    actually cuts. Anything else -- a canvas reimplementation of `gutter_cuts`
    in the browser -- would be a second opinion about the same question, and the
    two would drift the first time either changed.

    Returns the cut positions in the sheet's own pixels. Drawing lines on an
    image the browser already has is then a rendering job with no logic in it.
    """
    sheet = Image.open(path).convert('RGBA')
    if grid:
        cols, rows = (int(v) for v in grid.lower().split('x'))
    else:
        cell = gcd(sheet.width, sheet.height)
        cols, rows = sheet.width // cell, sheet.height // cell
    refused = not grid and (rows > 1 or cols > MAX_INFERRED_COLS)
    xs, ys = gutter_cuts(sheet, cols, rows)
    return {
        'width': sheet.width,
        'height': sheet.height,
        'cols': cols,
        'rows': rows,
        'frames': cols * rows,
        'xs': xs,
        'ys': ys,
        'inferred': not grid,
        'refused': refused,
        'seams': seam_report(sheet, cols, rows),
    }


def shadowed_sheets(folder: Path, clip: str, source: Path) -> list[Path]:
    """
    Loose sheets in `folder` that are another copy of `clip`.

    A clip folder BEATS a same-named sheet, so cutting one into frames leaves
    the sheet it came from -- or an older one for the same clip -- sitting there
    unread. Harmless right up until somebody deletes the folder, at which point
    a sheet nobody remembers uploading comes back to life as the clip.

    Only `--replace` acts on this. Appending is adding to what is there, and
    what is there includes the sheet; removing it would be a deletion nobody
    asked for.
    """
    actor = folder.parent.name
    out = []
    for f in sorted(folder.glob('*.png')):
        if f.resolve() == source.resolve():
            continue
        stem = f.stem
        name = stem[len(actor) + 1:] if stem.startswith(f'{actor}_') else stem
        if parse_grid(name)[0] == clip:
            out.append(f)
    return out


def split(
    path: Path,
    write: bool,
    remove: bool,
    bleed: str | None = None,
    clip_name: str | None = None,
    out_dir: Path | None = None,
    append: bool = False,
    replace: bool = False,
    grid_override: str | None = None,
) -> int:
    name = path.parent.parent.name  # animations/<sheet> -> the actor's folder
    stem = path.stem
    clip = stem[len(name) + 1:] if stem.startswith(f'{name}_') else stem
    clip, grid = parse_grid(clip)
    # An explicit target beats anything read off the filename, which is what
    # lets a sheet be split straight out of an upload staging folder -- the file
    # there is named after a token and says nothing about what it holds.
    if clip_name:
        clip = clip_name
    # Likewise an explicit grid. `--grid` used to reach `analyse` only, so the
    # upload page could PREVIEW a 4x1 cut and then write a 2x1 one -- the
    # filename was still the only thing `split` ever asked. It cost a source
    # sheet, because `--remove` then deleted the original.
    if grid_override:
        grid = tuple(int(v) for v in grid_override.lower().split('x'))

    if clip in EXTRA_POSES:
        """
        A pose is installed, not cut.

        `pain`, `death` and `thinking` are single drawings held for a state, so
        there is nothing to slice -- they go beside the clips as
        `<actor>_<pose>.png` and the packer's stills pass handles them from
        there.

        This used to print "a still, not a clip -- left alone" and return
        SUCCESS, which was fine while poses only ever arrived by hand. Through
        the upload page it was a silent dead end: the file was analysed, the
        commit reported no error, nothing was written, and the sheet sat in the
        staging folder forever. A refusal has to be a refusal or an action, not
        a shrug.

        Copied byte for byte rather than re-encoded. There is no cut to make,
        and the packer does its own keying, outlining and cropping afterwards --
        a needless round trip through Pillow here would only change the bytes.
        """
        folder = out_dir or path.parent
        dest = folder / f'{folder.parent.name}_{clip}.png'
        print(f'{path.name}: a still  ->  {readable(dest)}')
        if not write:
            return 0
        if dest.exists() and not replace:
            print(f'    refusing: {dest.name} is already there -- pass --replace to overwrite it')
            return 1
        overwriting = dest.exists()
        dest.write_bytes(path.read_bytes())
        print(f'    {"replaced" if overwriting else "wrote"} {dest.name}')
        if remove:
            path.unlink()
            print(f'    removed {path.name}')
        return 0

    sheet = Image.open(path).convert('RGBA')
    if grid:
        cols, rows = grid
    else:
        cell = gcd(sheet.width, sheet.height)
        cols, rows = sheet.width // cell, sheet.height // cell
        if rows > 1 or cols > MAX_INFERRED_COLS:
            print(f'{path.name}: SKIPPED -- no _NxM in the name, and {sheet.width}x{sheet.height}'
                  f' infers {cols}x{rows} = {cols * rows} frames, which is not a character strip.'
                  f'\n    Rename it with its real grid first, e.g. {stem}_4x1.png')
            return 1

    for note in seam_report(sheet, cols, rows):
        print(f'  ! {path.name}: {note}'
              + ('' if bleed else ' (pass --bleed to cut wide and clean them by hand)'))

    if bleed:
        cellw = sheet.width // cols
        bx = round(cellw * float(bleed[:-1]) / 100) if bleed.endswith('%') else int(bleed)
        frames, notes = bleeding_frames(sheet, cols, rows, bx, 0)
        print(f'    cut {bx}px wide either side')
        for n in notes:
            print(f'    {n}')
        if not notes:
            print('    no separable neighbour fragments -- the drawings touch, so clean by hand')
    else:
        frames = frames_of(sheet, cols, rows)
    out = (out_dir or path.parent) / clip
    sizes = ' '.join(f'{f.width}x{f.height}' for f in frames)
    print(f'{path.name}  {sheet.width}x{sheet.height}  {cols}x{rows}'
          f'  ->  {readable(out)}/  ({len(frames)} frames: {sizes})')

    if not write:
        return 0
    existing = sorted(out.glob('*.png')) if out.exists() else []
    stale = shadowed_sheets(out_dir or path.parent, clip, path) if replace else []
    if existing and not (append or replace):
        print(f'    refusing: {out.name}/ already has frames in it')
        return 1

    '''
    Replacing empties the folder first, rather than writing over it.

    Overwriting in place looks equivalent and is not: the new sheet may hold
    FEWER frames than the old one, and the leftovers keep their numbers and are
    read back as part of the clip -- so a four-frame swing replaced by a
    two-frame one plays the two new drawings and then the back half of the
    animation it was meant to retire. Clearing first means the numbering always
    restarts at 01 and what is in the folder is what was just cut.
    '''
    if replace:
        for f in existing + stale:
            f.unlink()
            print(f'    removed {f.name}')
        # Emptied, so the numbering below starts from nothing rather than
        # continuing past files that are no longer there.
        existing = []

    '''
    Appending continues the numbering rather than restarting it.

    A clip does not have to come from one sheet. A celebration might be a
    back-flip generated on its own plus a sword-raise generated separately, and
    the natural way to build that is to cut each and put the frames together --
    which only works if the second sheet's frames land AFTER the first's instead
    of overwriting them.

    New frames always go on the END, because "where in the order" is a question
    with a much better answer elsewhere: the animation lab can move, duplicate
    and disable frames while watching the clip play. Guessing at an insert
    position here would be inventing an answer that tool already gives properly.
    '''
    start = 0
    for f in existing:
        tail = f.stem.rsplit('_', 1)[-1]
        if tail.isdigit():
            start = max(start, int(tail))

    out.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(frames, start + 1):
        # Zero-padded, because these are read back in sorted order and `_10`
        # sorts before `_2` without it.
        f.save(out / f'{clip}_{i:02}.png')
    if start:
        print(f'    appended {len(frames)} frames after the {start} already there'
              f' -- reorder them in the animation lab')
    else:
        print(f'    wrote {len(frames)} frames')
    if remove:
        path.unlink()
        print(f'    removed {path.name}')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument('target', help='a sheet path, or an actor id with --all')
    ap.add_argument('--all', action='store_true', help='every sheet this actor has')
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--remove', action='store_true',
                    help='delete the sheet once its frames are written')
    ap.add_argument('--json', action='store_true',
                    help='print the cut as JSON and write nothing (for the upload page)')
    ap.add_argument('--grid', default=None, help='override the grid, e.g. 4x1')
    ap.add_argument('--clip', default=None, help='target clip name, instead of reading the filename')
    ap.add_argument('--out', default=None, help='folder to write the clip folder into')
    ap.add_argument('--replace', action='store_true',
                    help="empty the clip's folder first, and drop any same-named sheet shadowing it")
    ap.add_argument('--append', action='store_true',
                    help='add to a clip that already has frames, continuing the numbering')
    ap.add_argument('--bleed', nargs='?', const='10%', default=None,
                    help='cut cells wide so overlapping drawings survive: px or %% of a cell '
                         '(default 10%%). Each frame then holds part of its neighbour for you '
                         'to erase.')
    args = ap.parse_args()

    if args.json:
        import json

        print(json.dumps(analyse(Path(args.target), args.grid)))
        return 0

    if args.all:
        folder = ACTORS / args.target / 'animations'
        if not folder.is_dir():
            print(f'no {folder}')
            return 2
        sheets = sorted(folder.glob('*.png'))
        if not sheets:
            print(f'{folder}: no sheets left to split')
            return 0
        bad = sum(split(p, args.write, args.remove, args.bleed) for p in sheets)
    else:
        if args.append and args.replace:
            print('--append and --replace ask for opposite things; pick one')
            return 2
        bad = split(Path(args.target), args.write, args.remove, args.bleed,
                    args.clip, Path(args.out) if args.out else None, args.append,
                    args.replace, args.grid)

    if not args.write:
        print('\n(dry run -- pass --write to apply)')
    return 1 if bad else 0


if __name__ == '__main__':
    raise SystemExit(main())
