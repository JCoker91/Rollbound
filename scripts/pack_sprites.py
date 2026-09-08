"""
Publish art/ into public/.

`art/` is the only folder anything is uploaded to. `public/` is entirely
DERIVED: this script owns it, nothing is hand-placed there, and deleting it
should cost nothing but a re-run. That split is why the stamp guard below
exists -- an earlier version of this pipeline read and wrote the same folder,
and a run regenerated over freshly uploaded art that had gone straight into the
output.

    art/actors/<name>/          one Performer: sprite, icon, animations
    art/background/             scenery, mirrored verbatim into public/
    art/objects/                props (not yet consumed)
    art/enemies/                antagonists (not yet consumed)

An actor folder follows documents/SPRITE_STYLE_GUIDE.md:

    <name>_base_native_64.png   64x64 working grid -- the design source of truth
    <name>_LQ.png               256x256 delivery sprite, exactly 4x nearest-neighbour
    <name>_HQ.png               high-detail render; what the game actually ships
    <name>_icon.png             hand-cropped headshot, any square size
    animations/<name>_<clip>.png  sprite sheets, grid inferred from the file
    <name>.pack.json            GENERATED manifest: fingerprint + packed clips

THE GAME SHIPS THE NATIVE GRID. Not _HQ, and not even _LQ.

The board draws a figure at roughly 2-3x its native size, and the DIRECTION of
that resample decides how it looks. Upscaling the 42px native art with
nearest-neighbour keeps every art pixel intact -- each becomes a clean 2x2 or 3x3
block. Downscaling the 168px _LQ to the same target throws pixels away, which is
what made _LQ look muddy beside _HQ when first compared; that test was measuring
the downscale, not the art. Rendered at an equal integer scale the native grid is
sharper than _HQ, and it is 1-2KB against 400-660KB.

_HQ is also wrong on its own terms. It is a high-resolution painting -- the guide
lists "looks like a detailed digital painting reduced in size" as an immediate
rejection condition -- and it breaks the binary-alpha rule with 272k-481k
semi-transparent pixels each. That halo is a faint fringe reaching past the
figure, and it is the root of every sizing bug this project has had: the renderer
sizes a character from its file, so a sheet that is 40% invisible padding draws
its character 40% small at the same nominal scale as one that is not.

Requires nearest-neighbour scaling in CSS (`image-rendering: pixelated`), or the
browser will smooth-upscale a 42px sheet into mush.

Because every sheet is built on the same 64px grid, the art already encodes
relative stature -- Kael is the same height as Benjamin and half again as wide,
which is exactly the "broader, not taller" large warrior the guide describes.
So this script does NOT normalise each sprite to a common height. It records each
one's height in native pixels and lets content.ts scale the whole roster by a
single factor, which keeps the artist's proportions intact.

Run:  python scripts/pack_sprites.py
"""

import json

from math import ceil
from PIL import Image, ImageDraw
from pathlib import Path

# Style-guide constants (documents/SPRITE_STYLE_GUIDE.md section 2).
NATIVE = 64
DELIVERY = 256
UPSCALE = DELIVERY // NATIVE
GROUND_LINE_NATIVE = 56
SAFE_MARGIN_NATIVE = 4
# Widened from the guide's original 44-50 to match the approved roster. Relative
# stature is DELIBERATE -- the shared 64px grid is what makes it legible, so the
# real rule is "honestly measured on the grid" and height is an outcome. Kept as
# a lint so genuine drift still shows.
HUMANOID_H_RANGE = (37, 50)

ICON_SIZE = 160
# Ceiling for oversized source art; _LQ is already well under it.
BOARD_HEIGHT = 320
# Fraction of the figure's height treated as "feet" when locating the anchor.
FOOT_BAND = 0.12
# Alpha below this is invisible and must not count as content. Style-guide art is
# binary so this changes nothing there; it guards the pre-guide sheets that are
# still in the roster.
ALPHA_FLOOR = 12
# How close to the backdrop colour counts as background when clearing pockets
# the corner fill cannot reach. Tight on purpose -- see key_flat_background.
POCKET_TOLERANCE = 6
# What counts as art when mirroring folders that are copied rather than packed.
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}

ART = Path('art')
ACTORS = ART / 'actors'
SCENERY = ART / 'background'
OUT_ROOT = Path('public/sprites')
OUT_SCENERY = Path('public/background')
METRICS_TS = Path('src/engine/sprites.generated.ts')

# Characters whose art predates the style guide and has no _LQ/native pair yet.
# They keep whatever is already in public/sprites and an explicit scale in
# content.ts until they are regenerated. Empty now that the whole roster is on
# the guide -- kept because the next pre-guide import will want it.
LEGACY: set[str] = set()

ONLY = None
SKIP: set[str] = set()


def characters() -> list[str]:
    """Every art/actors/<name>/ that has a delivery sprite."""
    if not ACTORS.is_dir():
        return []
    return sorted(
        d.name for d in ACTORS.iterdir() if d.is_dir() and (d / f'{d.name}_LQ.png').exists()
    )


def manifest_path(name: str) -> Path:
    return ACTORS / name / f'{name}.pack.json'


def publish_scenery() -> list[str]:
    """
    Mirror art/background/ into public/background/.

    Backdrops need no processing -- they are painted at their final size and the
    stage scales them with CSS -- so this is a copy, not a pack. It exists so
    that EVERY path under public/ has a source in art/, which is what makes
    public/ safe to delete and rebuild.

    Skipped when the destination already matches, so a run does not rewrite
    megabytes of unchanged backdrops.
    """
    if not SCENERY.is_dir():
        return []
    written = []
    for src in sorted(SCENERY.rglob('*')):
        if not src.is_file() or src.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        dst = OUT_SCENERY / src.relative_to(SCENERY)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists() or dst.stat().st_size != src.stat().st_size:
            dst.write_bytes(src.read_bytes())
            written.append(dst.as_posix())
    return written


def expected_outputs() -> list[str]:
    """Every file public/ should contain, according to art/."""
    out = []
    for name in characters():
        folder = OUT_ROOT / name
        out.append((folder / f'{name}.png').as_posix())
        if (ACTORS / name / f'{name}_icon.png').exists():
            out.append((folder / f'{name}_icon.png').as_posix())
        for clip in load_manifest(name).get('clips', {}):
            out.append((folder / f'{name}_{clip}.png').as_posix())
    if SCENERY.is_dir():
        for src in SCENERY.rglob('*'):
            if src.is_file() and src.suffix.lower() in IMAGE_SUFFIXES:
                out.append((OUT_SCENERY / src.relative_to(SCENERY)).as_posix())
    return out


def prune(root: Path, keep: set[Path]) -> list[str]:
    """
    Delete files under `root` that this run did not produce.

    public/ is derived, so anything in it without a source in art/ is stale --
    a renamed clip, a character who left the roster, a leftover from a system
    that no longer exists. Left alone those ship to users and quietly grow the
    bundle.

    Deliberately scoped to the directories the script actually owns and only
    called with a complete `keep` set, so a partial run cannot delete the output
    of an actor it skipped.
    """
    if not root.is_dir():
        return []
    removed = []
    for path in sorted(root.rglob('*')):
        if path.is_file() and path not in keep:
            path.unlink()
            removed.append(path.as_posix())
    for path in sorted(root.rglob('*'), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    return removed


def load_manifest(name: str) -> dict:
    """
    Everything this script knows about one actor, stored beside their art.

    One file per actor rather than two shared registries at the top of art/.
    A shared file is a merge conflict waiting to happen and it couples actors
    that have nothing to do with each other -- regenerating Benjamin should not
    rewrite a file that also describes Maxine. Keeping the manifest in the
    actor's own folder means the folder is the complete, portable unit: art in,
    manifest out, nothing else to carry.
    """
    try:
        return json.loads(manifest_path(name).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def save_manifest(name: str, **fields) -> None:
    """Merge fields into an actor's manifest. Read-modify-write, because the
    fingerprint and the clip catalogue are written at different points in a run."""
    data = load_manifest(name)
    data.update(fields)
    path = manifest_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding='utf-8')


def content_box(img: Image.Image):
    """
    Bounding box of the pixels that are actually VISIBLE.

    Not `Image.getbbox()`, which keeps anything with alpha > 0 and so preserves
    the invisible halo on pre-guide art.
    """
    alpha = img.getchannel('A').point(lambda v: 255 if v >= ALPHA_FLOOR else 0)
    return alpha.getbbox()


def foot_anchor(img: Image.Image) -> float:
    """Horizontal centre of the lowest band of opaque pixels, as a 0-1 fraction."""
    alpha = img.getchannel('A').point(lambda v: 255 if v >= ALPHA_FLOOR else 0)
    box = alpha.getbbox()
    height = box[3] - box[1]
    band_top = box[3] - max(2, int(height * FOOT_BAND))
    band = alpha.crop((box[0], band_top, box[2], box[3])).getbbox()
    centre = box[0] + (band[0] + band[2]) / 2
    return centre / img.width


def audit(name: str, lq: Image.Image, native: Image.Image | None) -> list[str]:
    """
    The guide's acceptance checklist, as a lint.

    Reported, never fatal: a sprite that is 2px off the ground line is still
    perfectly usable, and the roster should not be blocked on it. But drift is
    worth seeing, because the ground line is what keeps feet on one line.
    """
    notes = []
    if lq.size != (DELIVERY, DELIVERY):
        notes.append(f'delivery canvas is {lq.width}x{lq.height}, guide says {DELIVERY}x{DELIVERY}')

    alpha = lq.getchannel('A')
    semi = sum(1 for v in alpha.getdata() if 0 < v < 255)
    if semi:
        notes.append(f'{semi} semi-transparent pixels; guide requires binary alpha')

    box = content_box(lq)
    margin = min(box[0], box[1], lq.width - box[2], lq.height - box[3])
    if margin < SAFE_MARGIN_NATIVE * UPSCALE:
        notes.append(
            f'margin {margin}px < {SAFE_MARGIN_NATIVE * UPSCALE}px '
            f'({SAFE_MARGIN_NATIVE} native)'
        )

    feet = box[3] - 1
    want = GROUND_LINE_NATIVE * UPSCALE
    if feet != want:
        notes.append(f'feet at y={feet}, guide ground line is y={want} ({(feet - want) / UPSCALE:+.2f} native px)')

    h_native = (box[3] - box[1]) / UPSCALE
    lo, hi = HUMANOID_H_RANGE
    if not lo <= h_native <= hi:
        notes.append(f'height {h_native:.0f} native px is outside the guide range {lo}-{hi}')

    if native is not None:
        if native.size != (NATIVE, NATIVE):
            notes.append(f'native grid is {native.width}x{native.height}, expected {NATIVE}x{NATIVE}')
        else:
            nb = content_box(native)
            want_box = tuple(v / UPSCALE for v in box)
            if tuple(nb) != tuple(round(v) for v in want_box):
                notes.append(f'_LQ content {box} is not a clean {UPSCALE}x of native {nb}')
    return notes

# Animation clips live in art/<name>/animations/ and are ALL packed, so the dev
# animation lab can compare them. Which one a character actually idles with in
# battle is chosen here.
DEFAULT_IDLE = {'benjamin': 'idle', 'maxine': 'idle'}

# Frame height for a packed strip.
#
# Lower than BOARD_HEIGHT on purpose. A strip carries every frame side by side,
# so each pixel of height costs N times what it does on a still. Characters draw
# at roughly 140px even on a large screen, so 224 leaves real headroom.
ANIM_HEIGHT = 224

# Catalogue of what was packed, so write_metrics knows each strip's frame count
# without re-deriving it. Lives beside the stamps, outside the served tree.


def _erode(mask):
    """Shrink a boolean mask by one pixel, 4-connected."""
    import numpy as np

    out = mask.copy()
    out[1:, :] &= mask[:-1, :]
    out[:-1, :] &= mask[1:, :]
    out[:, 1:] &= mask[:, :-1]
    out[:, :-1] &= mask[:, 1:]
    return out


def _dilate(mask):
    """Grow a boolean mask by one pixel, 4-connected."""
    out = mask.copy()
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def _open(mask):
    """Erode then dilate: keeps solid blobs, deletes specks and hairlines."""
    return _dilate(_erode(mask))


def _spread(values, known):
    """
    One round of pushing known colours outward into unknown neighbours.

    Each unknown pixel takes the mean of whichever of its four neighbours are
    known. Repeated a few times this reaches across a thin fringe, which is all
    it ever has to cover.
    """
    import numpy as np

    total = np.zeros_like(values)
    count = np.zeros(values.shape[:2], np.float32)
    for shift in range(4):
        v = np.zeros_like(values)
        k = np.zeros_like(count)
        if shift == 0:
            v[1:], k[1:] = values[:-1], known[:-1]
        elif shift == 1:
            v[:-1], k[:-1] = values[1:], known[1:]
        elif shift == 2:
            v[:, 1:], k[:, 1:] = values[:, :-1], known[:, :-1]
        else:
            v[:, :-1], k[:, :-1] = values[:, 1:], known[:, 1:]
        total += v * k[..., None]
        count += k
    fresh = (count > 0) & ~known
    out = values.copy()
    out[fresh] = total[fresh] / count[fresh][..., None]
    return out, known | fresh


def unmatte(img: Image.Image, bg, erode: int = 2) -> Image.Image:
    """
    Remove the colour a flat background bled into the edges of a figure.

    Keying a flat background answers "is this pixel background?" with yes or no,
    and for the anti-aliased ring around a figure the honest answer is "partly".
    Those pixels are a MIX of the figure and the backdrop, so a yes/no key keeps
    them at full opacity with the backdrop's colour still in them -- which is
    exactly the grey outline that appeared around Maxine's celebration ending.
    Her sheet carried 24k such pixels; 3.5k per frame survived the key.

    Widening the key's tolerance is not the fix. It eats real edge detail and
    leaves a hard, slightly-too-small silhouette. Eroding the mask is not either,
    for the same reason.

    Since the backdrop colour B is known exactly, the mix can be undone instead.
    A fringe pixel is `C = a*F + (1-a)*B` for some coverage `a` and true figure
    colour `F`. Estimate F by pushing interior colours outward across the fringe,
    then project C onto the line from B to F:

        a = ((C - B) . (F - B)) / |F - B|^2

    Output F at coverage a. That both removes the tint and restores the soft edge
    the render was drawn with, rather than replacing it with a hard one.
    """
    import numpy as np

    rgb = np.asarray(img)[..., :3].astype(np.float32)
    alpha = np.asarray(img.getchannel('A'))
    solid = alpha > 0
    if not solid.any():
        return img

    # Interior pixels, far enough in that no background reached them.
    core = solid
    for _ in range(erode):
        core = _erode(core)
    if not core.any():
        return img

    known = core.copy()
    figure = np.where(core[..., None], rgb, 0).astype(np.float32)
    for _ in range(erode + 2):
        figure, known = _spread(figure, known)
    figure = np.where(known[..., None], figure, rgb)

    B = np.asarray(bg, np.float32)
    d = figure - B
    den = (d * d).sum(-1)
    num = ((rgb - B) * d).sum(-1)
    # Where the figure colour matches the backdrop there is no line to project
    # onto and no way to tell mix from match -- keep those pixels as they are.
    a = np.divide(num, den, out=np.ones_like(num), where=den > 1e-3)
    a = np.clip(a, 0.0, 1.0)
    a = np.where(core, 1.0, a)
    a = np.where(solid, a, 0.0)

    out = np.dstack([np.clip(figure, 0, 255), a * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def key_flat_background(img: Image.Image, tolerance: int = 40) -> Image.Image:
    """
    Make a flat background transparent, for frames exported without alpha.

    Flood-filled inward from the four corners rather than keyed by colour: a
    colour key would punch holes through any part of the character that happens
    to match the backdrop. Filling from the edges only removes background that is
    actually connected to one.

    The fill alone is not enough -- it decides yes or no per pixel, and the
    anti-aliased ring around the figure is genuinely partly both. `unmatte`
    finishes the job; see there for why widening the tolerance is the wrong
    lever.
    """
    if img.getchannel('A').getextrema()[0] < 255:
        return img  # already has real transparency

    rgb = img.convert('RGB')
    marker = (255, 0, 255)
    w, h = rgb.size
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(rgb, corner, marker, thresh=tolerance)
    import numpy as np

    keep = np.asarray(
        Image.frombytes('L', rgb.size, bytes(0 if px == marker else 255 for px in rgb.getdata()))
    ) > 0

    # Background the fill could not reach.
    #
    # Flood filling from the corners only removes background CONNECTED to a
    # corner. Anything the figure encloses -- the gap between a raised arm and
    # the body, the hole through a staff's ornament -- is walled off and stays
    # opaque. Maxine's ending had three such pockets, 160, 148 and 23 pixels.
    #
    # These are safe to identify by colour where the fill was not, because the
    # backdrop is FLAT: her sheet had 286k pixels at exactly the backdrop colour
    # and not one within 10 of it, so a tight tolerance cannot catch shading.
    # The opening then drops specks and hairlines, so only real pockets go.
    bg = np.asarray(img.convert('RGB').getpixel((0, 0)), np.int16)
    flat = np.abs(np.asarray(rgb, np.int16) - bg).max(-1) <= POCKET_TOLERANCE
    keep &= ~_open(flat & keep)

    out = img.copy()
    out.putalpha(Image.fromarray((keep * 255).astype(np.uint8), 'L'))
    # The key leaves the anti-aliased ring opaque and still tinted. Undo the mix
    # now, while the backdrop colour is known.
    return unmatte(out, tuple(int(v) for v in bg))


def split_sheet(sheet: Image.Image) -> list[Image.Image]:
    """
    Cut a sheet into frames, inferring the grid from the image's own dimensions.

    Frames are square in every sheet delivered so far, so the greatest common
    divisor of width and height IS the frame size -- 7680x640 resolves to 12x1
    and 1448x1086 to 4x3. Read row-major.
    """
    from math import gcd

    f = gcd(sheet.width, sheet.height)
    cols, rows = sheet.width // f, sheet.height // f
    return [
        key_flat_background(sheet.crop((c * f, r * f, (c + 1) * f, (r + 1) * f)))
        for r in range(rows)
        for c in range(cols)
    ]


def loop_length(frames: list[Image.Image]) -> int:
    """
    How many of these frames make up ONE whole number of cycles.

    Two different things get delivered, and both need trimming:

    A sheet holding a fraction of a cycle. Both original 12-frame idles were
    really 2.4 repetitions of a 5-frame bounce; playing all twelve wrapped
    mid-bounce and visibly hitched. Found by self-similarity -- compare every
    frame with the one `p` later, and a true period stands out sharply (5 scored
    1.8 against a 9.2 baseline).

    A sheet whose LAST frame repeats its first, as a hand-off cue. Maxine's
    celebration ending arrived as 7 unique frames plus a copy of frame 0, which
    would hold that pose for two frames at the wrap.

    These need different evidence. A real period is checked over at least two
    frame pairs, because with one pair the "average" is a single comparison and
    a coincidence reads as a cycle. The trailing duplicate IS only one pair, so
    it gets its own much stricter threshold -- a duplicate frame is near
    identical, not merely similar.
    """
    import numpy as np

    def masked(f: Image.Image):
        arr = np.asarray(f.convert('RGB')).astype(int)
        alpha = np.asarray(f.getchannel('A'))
        return arr * (alpha > ALPHA_FLOOR)[..., None]

    fs = [masked(f) for f in frames]
    n = len(fs)
    if n < 4:
        return n
    baseline = float(np.mean([np.abs(fs[i] - fs[i + 1]).mean() for i in range(n - 1)]))
    if baseline == 0:
        return n

    def diff(p: int) -> float:
        return float(np.mean([np.abs(fs[i] - fs[i + p]).mean() for i in range(n - p)]))

    # A genuine repeating cycle, over at least two pairs of evidence.
    best_p, best_d = n, float('inf')
    for p in range(1, n - 1):
        d = diff(p)
        if d < best_d:
            best_p, best_d = p, d
    if best_d < baseline * 0.5 and best_p < n:
        return (n // best_p) * best_p

    # The last frame duplicating the first. Only one pair of evidence, so it is
    # measured against the CLOSEST two consecutive frames rather than the average
    # gap: a genuine repeat has to be more similar to frame 0 than any real step
    # of motion is to its neighbour.
    #
    # The average will not do here. Benjamin's attack ends nearer its first frame
    # (0.20 of the mean gap) than Maxine's duplicated ending does (0.25) -- because
    # a one-shot is MEANT to finish where it started. Against the minimum the two
    # separate cleanly, 0.27 against 1.26.
    closest = min(np.abs(fs[i] - fs[i + 1]).mean() for i in range(n - 1))
    if closest > 0 and diff(n - 1) < closest * 0.5:
        return n - 1
    return n


LOOPING = ('idle', 'walk', 'run', 'float')
# A one-shot's held pose. `celebration_ending` is where `celebration` comes to
# rest: it loops, and it is what the clip settles into instead of snapping back
# to the neutral idle. Suffix rather than a config table so adding one is just
# dropping a correctly named file next to its clip.
ENDING = '_ending'


def loops(clip: str) -> bool:
    return clip.startswith(LOOPING) or clip.endswith(ENDING)


def settles_into(clip: str, available) -> str | None:
    """
    Which clip takes over when this one finishes.

    A one-shot has to hand back to SOMETHING or the character freezes on its
    last frame. Prefer the clip's own ending pose -- a Performer who has just
    taken a bow should keep holding the bow, not snap back to a combat stance --
    and fall back to the resting idle when no ending was drawn.
    """
    if loops(clip):
        return None
    own = f'{clip}{ENDING}'
    if own in available:
        return own
    return next((c for c in ('idle',) if c in available), None)


def foot_point(img: Image.Image) -> tuple[float, float] | None:
    """
    Where this frame's character is standing, in the frame's own pixels.

    x is the centre of the lowest band of content, y is the ground it rests on.
    This is the point every clip is aligned to, in preference to the image
    centre: characters stand on a floor, so a clip that is taller or wider than
    another should grow away from the feet rather than drag them off the line.
    """
    box = content_box(img)
    if not box:
        return None
    height = box[3] - box[1]
    band_top = box[3] - max(2, int(height * FOOT_BAND))
    alpha = img.getchannel('A').point(lambda v: 255 if v >= ALPHA_FLOOR else 0)
    band = alpha.crop((box[0], band_top, box[2], box[3])).getbbox()
    return (box[0] + (band[0] + band[2]) / 2, float(box[3]))


def normalise(clips: dict, reference: str) -> tuple[dict, dict]:
    """
    Redraw every clip at one scale, on one canvas, anchored on the feet.

    Sheets for the same character are NOT delivered in a common space. Maxine's
    idle arrived as 640px cells holding a 584px figure; her celebration as 362px
    cells holding a 338px one -- the same character drawn 1.73x smaller. Both
    fill ~92% of their own cell, so neither looks wrong until the two are
    measured against each other.

    Left alone that poisons the shared crop box, which is computed across every
    clip at once: box coordinates from a 362px frame and a 640px frame are not
    comparable, and cropping the small frame with the big frame's box leaves the
    character stranded in a sea of padding. That is what put Maxine at a third
    of her proper height in the middle of an empty stage.

    So each clip is scaled by the ratio of its figure height to the reference
    clip's, and pasted onto a shared canvas with its foot point at a fixed spot.
    Figure height is the MEDIAN over frames, not the extent: the extent of a clip
    with a jump includes the travel, which would read as a taller character and
    scale the clip down to compensate.

    Returns the redrawn clips and the factor applied to each, which is worth
    printing -- a large one means the art itself disagrees, and re-exporting the
    sheet at a matching scale beats resampling it here.
    """
    from statistics import median

    metrics = {}
    for clip, frames in clips.items():
        boxes = [b for b in (content_box(f) for f in frames) if b]
        feet = [q for q in (foot_point(f) for f in frames) if q]
        if not boxes or not feet:
            continue
        metrics[clip] = {
            'figure': median(b[3] - b[1] for b in boxes),
            # One foot point per clip, not per frame, or a character shifting
            # their weight would drag the whole clip sideways.
            'fx': median(q[0] for q in feet),
            'gy': max(q[1] for q in feet),
            'cell': frames[0].size,
        }
    if not metrics:
        return {}, {}
    if reference not in metrics:
        reference = next(iter(metrics))

    ref = metrics[reference]['figure']
    factor = {c: ref / m['figure'] for c, m in metrics.items()}

    # A canvas big enough for every clip's reach in each direction from the feet.
    left = max(m['fx'] * factor[c] for c, m in metrics.items())
    right = max((m['cell'][0] - m['fx']) * factor[c] for c, m in metrics.items())
    up = max(m['gy'] * factor[c] for c, m in metrics.items())
    down = max((m['cell'][1] - m['gy']) * factor[c] for c, m in metrics.items())
    canvas = (ceil(left + right), ceil(up + down))

    out = {}
    for clip, frames in clips.items():
        if clip not in metrics:
            continue
        k = factor[clip]
        m = metrics[clip]
        size = (max(1, round(m['cell'][0] * k)), max(1, round(m['cell'][1] * k)))
        at = (round(left - m['fx'] * k), round(up - m['gy'] * k))
        placed = []
        for f in frames:
            scaled = f if abs(k - 1) < 1e-6 else f.resize(size, Image.LANCZOS)
            page = Image.new('RGBA', canvas, (0, 0, 0, 0))
            page.paste(scaled, at)
            placed.append(page)
        out[clip] = placed
    return out, factor


def build_animations(name: str) -> dict:
    """
    Pack every clip for a character into horizontal strips.

    Frames are cropped to ONE SHARED box. Cropping each to its own bounds would
    re-centre the character every frame and an idle would jitter, which is the
    opposite of what an idle is for. The box is shared across ALL of a
    character's clips, not just within one: a clip containing a jump needs a
    taller box to hold the airborne frames, and if that box were its own, the
    same character would be drawn smaller in that clip than in every other.

    Getting the clips into a common space first is what makes that box mean
    anything -- see `normalise`.

    Partial cycles are trimmed so a loop does not wrap mid-bounce, but only for
    clips that actually loop. A celebration is a one-shot with a beginning and
    an end; cycle-trimming one would cut its landing off.
    """
    folder = ACTORS / name / 'animations'
    if not folder.is_dir():
        return {}

    raw = {}
    for src in sorted(folder.glob('*.png')):
        clip = src.stem[len(name) + 1:] if src.stem.startswith(f'{name}_') else src.stem
        frames = split_sheet(Image.open(src).convert('RGBA'))
        if any(content_box(f) for f in frames):
            raw[clip] = frames
    if not raw:
        return {}

    rest_clip = DEFAULT_IDLE.get(name) or next(iter(sorted(c for c in raw if loops(c))), sorted(raw)[0])
    sheets, factor = normalise(raw, rest_clip)
    if not sheets:
        return {}
    if rest_clip not in sheets:
        rest_clip = sorted(sheets)[0]

    every = [b for fs in sheets.values() for b in (content_box(f) for f in fs) if b]
    union = (
        min(b[0] for b in every), min(b[1] for b in every),
        max(b[2] for b in every), max(b[3] for b in every),
    )

    # One anchor for the character, not one per clip. It answers "where within
    # the box is this character standing", and if it moved between clips the
    # sprite would slide sideways on every hand-off. Taken from the resting
    # pose, because that is the stance every other clip departs from.
    anchor_x = round(foot_anchor(sheets[rest_clip][0].crop(union)), 3)

    out_dir = OUT_ROOT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    clips = {}
    rest_fill, foot_pad = 1.0, 0.0

    for clip, frames in sheets.items():
        looping = loops(clip)
        cropped = [f.crop(union) for f in frames]
        total = len(cropped)
        if looping:
            cropped = cropped[:loop_length(cropped)]

        cw, ch = cropped[0].size
        if ch > ANIM_HEIGHT:
            k = ANIM_HEIGHT / ch
            cw, ch = round(cw * k), ANIM_HEIGHT
            cropped = [f.resize((cw, ch), Image.LANCZOS) for f in cropped]

        # The shared box is NOT the character. It is as tall as the highest jump
        # and as wide as the widest swing, so the figure fills only part of it --
        # and how much depends on which clips happen to exist. Measure the
        # resting pose against the box so the renderer can size the CHARACTER and
        # let the box fall where it may. Without this, a still rendered at 132px
        # stood taller than the same character animated at 132px, and adding an
        # attack sheet shrank the idle beside it.
        if clip == rest_clip:
            from statistics import median

            spans = [b for b in (content_box(f) for f in cropped) if b]
            # MEDIAN frame height, not the extent across frames. The extent
            # includes the top of the bounce, which is not how tall the
            # character is -- sizing by it drew every clip about 3% short of the
            # tight-cropped still it stands next to.
            rest_fill = round(median(b[3] - b[1] for b in spans) / ch, 6)
            foot_pad = round((ch - max(b[3] for b in spans)) / ch, 6)

        strip = Image.new('RGBA', (cw * len(cropped), ch), (0, 0, 0, 0))
        for i, f in enumerate(cropped):
            strip.paste(f, (i * cw, 0))
        path = out_dir / f'{name}_{clip}.png'
        strip.save(path)

        clips[clip] = {
            'src': '/sprites/%s/%s_%s.png' % (name, name, clip),
            'frames': len(cropped),
            'aspect': round(cw / ch, 6),
            'anchorX': anchor_x,
            'loops': looping,
            'normalised': round(factor.get(clip, 1.0), 4),
            'trimmed': total - len(cropped),
            'size': path.stat().st_size,
        }

    # Per character, not per clip: every clip shares the box these describe.
    for info in clips.values():
        info['restFill'] = rest_fill
        info['footPad'] = foot_pad
    # Resolved once every clip is known, so a one-shot can see its own ending.
    for clip, info in clips.items():
        target = settles_into(clip, clips)
        if target:
            info['settlesInto'] = target

    if clips:
        save_manifest(name, clips=clips)
    return clips


def stamp_of(path: Path) -> dict:
    st = path.stat()
    return {'mtime_ns': st.st_mtime_ns, 'size': st.st_size}


def is_ours(name: str, board_out: Path) -> bool:
    """
    Did THIS script write the file now in the output folder?

    public/ is supposed to be derived, but art has been dropped straight into
    public/sprites/<name>/ before, and a later run happily regenerated over it
    from stale sources. Comparing mtimes cannot catch that, because after any
    normal run the output is always newer than the input. The fingerprint
    recorded at write time can.
    """
    prev = load_manifest(name).get('stamp')
    return bool(prev) and stamp_of(board_out) == prev


def prepare(name: str) -> tuple[int, list[str]]:
    """Process one character. Returns its native height and any audit notes."""
    src, out = ACTORS / name, OUT_ROOT / name
    out.mkdir(parents=True, exist_ok=True)

    lq = Image.open(src / f'{name}_LQ.png').convert('RGBA')
    native_path = src / f'{name}_base_native_64.png'
    native = Image.open(native_path).convert('RGBA') if native_path.exists() else None
    notes = audit(name, lq, native)

    box = content_box(lq)
    native_h = round((box[3] - box[1]) / UPSCALE)

    # Ship _HQ, and take the SIZE from the native grid.
    #
    # These are two separate questions and they have different answers. How big a
    # character is comes from the 64px grid, because that is the one measurement
    # the whole roster shares and it carries the guide's stature rules. WHICH
    # PIXELS get drawn is a rendering question, and at the sizes the game draws
    # -- and much more so in a side-view battler, where figures are 2-3x larger
    # again -- the high-resolution render simply looks better. Measured side by
    # side: comparable at ~97px, clearly better at 180px, decisively at 260px.
    #
    # The halo that made _HQ unusable before is handled: content_box trims on
    # ALPHA_FLOOR, so the invisible fringe no longer inflates the content box and
    # shrinks the figure inside it.
    hq_path = src / f'{name}_HQ.png'
    if hq_path.exists():
        hq = Image.open(hq_path).convert('RGBA')  # already has real alpha
        board = hq.crop(content_box(hq))
        pixel_art = False
    else:
        board = native.crop(content_box(native)) if native is not None else lq.crop(box)
        pixel_art = True
    if board.height > BOARD_HEIGHT:
        ratio = BOARD_HEIGHT / board.height
        board = board.resize((round(board.width * ratio), BOARD_HEIGHT), Image.LANCZOS)

    board_path = out / f'{name}.png'
    board.save(board_path)
    save_manifest(name, stamp=stamp_of(board_path))

    # Icons are full-bleed portrait crops -- art runs to all four edges, so there
    # is nothing to key out and keying one punches a hole through it.
    icon_src = src / f'{name}_icon.png'
    if icon_src.exists():
        icon = Image.open(icon_src).convert('RGBA')
        if icon.height > ICON_SIZE:
            icon = icon.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        icon.save(out / f'{name}_icon.png')

    clips = build_animations(name)

    print(f'{name}:')
    print(f'  board {board_path.as_posix()} {board.width}x{board.height} '
          f'({board_path.stat().st_size // 1024} KB)  = {native_h} native px tall')
    for clip, info in clips.items():
        note = f'  (trimmed {info["trimmed"]} partial-cycle frames)' if info['trimmed'] else ''
        star = ' *default idle' if DEFAULT_IDLE.get(name) == clip else ''
        print(f'  anim  {clip:<14} {info["frames"]:>2} frames  '
              f'({info["size"] // 1024:>4} KB){note}{star}')
    for n in notes:
        print(f'  ! {n}')
    return native_h, notes


def write_metrics() -> None:
    """
    Emit the measured facts about every sprite as a TypeScript module.

    `aspect`, `anchorX` and `nativePx` are measurements, not decisions, and
    hand-copying them into content.ts is how they go stale -- a replaced Kael
    sheet once kept the old aspect and rendered 22% too wide.

    Measured from the files in public/sprites so the module always describes what
    is actually on disk, including characters skipped this run. A TS module rather
    than JSON under public/ because Vite copies public/ verbatim instead of
    bundling it: JSON there could only be read by a runtime fetch, which would
    make sprite data async and invisible to `npm run sim` and `npm run play`.
    """
    # Rebuilt from the per-actor manifests, so an actor skipped this run still
    # contributes whatever was packed for them last time.
    catalogue = {n: load_manifest(n).get('clips', {}) for n in characters()}
    catalogue = {n: c for n, c in catalogue.items() if c}

    entries = []
    for folder in sorted(p for p in OUT_ROOT.iterdir() if p.is_dir()):
        name = folder.name
        board = folder / f'{name}.png'
        if not board.exists():
            continue
        img = Image.open(board).convert('RGBA')
        fields = [f"src: '/sprites/{name}/{name}.png'"]
        if (folder / f'{name}_icon.png').exists():
            fields.append(f"icon: '/sprites/{name}/{name}_icon.png'")
        fields.append(f'aspect: {img.width} / {img.height}')
        fields.append(f'anchorX: {foot_anchor(img):.3f}')

        # Height on the shared 64px grid, which is what makes the roster's
        # proportions comparable. Null for pre-guide art with no native basis.
        lq = ACTORS / name / f'{name}_LQ.png'
        if lq.exists():
            b = content_box(Image.open(lq).convert('RGBA'))
            fields.append(f'nativePx: {round((b[3] - b[1]) / UPSCALE)}')
        else:
            fields.append('nativePx: null')
        # Nearest-neighbour only suits art drawn LARGER than its file. _HQ is
        # drawn smaller, so it needs smoothing.
        fields.append(f'pixelArt: {"false" if (ACTORS / name / f"{name}_HQ.png").exists() else "true"}')

        clip = catalogue.get(name, {}).get(DEFAULT_IDLE.get(name, ''))
        if clip:
            fields.append(
                f"idle: {{ src: '{clip['src']}', frames: {clip['frames']}, "
                f"aspect: {clip['aspect']}, anchorX: {clip['anchorX']}, "
                f"restFill: {clip['restFill']}, footPad: {clip['footPad']} }}"
            )
        entries.append((name, fields))

    ids = ' | '.join(f"'{n}'" for n, _ in entries)
    body = '\n'.join(f'  {n}: {{ {", ".join(f)} }},' for n, f in entries)
    # Only the fields the lab needs; `trimmed`/`size` are build diagnostics.
    lab = {
        name: {
            clip: {k: v for k, v in info.items() if k in ('src', 'frames', 'aspect', 'anchorX', 'loops', 'restFill', 'footPad', 'normalised', 'settlesInto')}
            for clip, info in clips.items()
        }
        for name, clips in sorted(catalogue.items())
    }
    clips_json = json.dumps(lab, indent=2, sort_keys=True)
    METRICS_TS.parent.mkdir(parents=True, exist_ok=True)
    METRICS_TS.write_text(
        f'''// GENERATED by scripts/pack_sprites.py -- do not edit by hand.
// Measured from the PNGs in public/sprites/; re-run the script after changing art.
import type {{ SpriteSheet }} from './types.ts';

export type SpriteId = {ids};

export interface SpriteMetrics extends Omit<SpriteSheet, 'scale'> {{
  /**
   * Figure height on the style guide's 64px native grid. Every sheet is built on
   * that grid, so these are directly comparable and ARE the roster's relative
   * statures -- content.ts turns them into tiles with one global factor rather
   * than a hand-tuned table. Null for pre-guide art with no native basis.
   *
   * Deliberately independent of which file supplies the PIXELS: size comes from
   * the shared grid, quality from the best available render.
   */
  nativePx: number | null;
  /** True when the shipped sheet is native-grid art needing nearest-neighbour. */
  pixelArt: boolean;
  /**
   * Packed idle strip, when the character has one. Every frame shares one crop
   * box so only the intended parts move, and the renderer steps through it.
   */
  idle?: {{ src: string; frames: number; aspect: number; anchorX: number; restFill: number; footPad: number }};
}}

export const SPRITE_METRICS: Record<SpriteId, SpriteMetrics> = {{
{body}
}};

/** Every packed clip, for the dev animation lab. Battle uses `idle` above. */
export const ANIMATION_CLIPS: Record<string, Record<string, AnimationClip>> = {clips_json};

export interface AnimationClip {{
  src: string;
  frames: number;
  aspect: number;
  anchorX: number;
  /**
   * How much of the box height the RESTING figure occupies (its MEDIAN frame,
   * so a bounce apex does not read as height), and how far its feet sit above
   * the box bottom. Both 0-1.
   *
   * The box is the union of every clip a character owns, so it is as tall as
   * the highest jump and as wide as the widest swing -- it is not the
   * character. Sizing a clip by its box height therefore drew the figure
   * smaller than the same character's tight-cropped still, and by an amount
   * that changed whenever a new clip was added. Divide the intended figure
   * height by `restFill` to get the box height, then push the box down by
   * `footPad` of that to land the feet on the ground line.
   */
  restFill: number;
  footPad: number;
  /**
   * Scale the pack step applied to bring this clip in line with the reference
   * idle. 1 means the sheet was already in step. A large number means the art
   * itself disagrees and was resampled to compensate -- re-exporting the sheet
   * at a matching scale beats resampling.
   */
  normalised: number;
  /**
   * Whether the clip returns to where it started. Idles do and are trimmed to
   * whole cycles; a one-shot like a celebration ends somewhere else and plays
   * once before handing back to the idle.
   */
  loops: boolean;
  /**
   * Which clip takes over when this one finishes, for clips that do not loop.
   * A one-shot prefers its OWN held pose (`celebration` -> `celebration_ending`)
   * so a Performer keeps the stance they ended on, and falls back to `idle`.
   */
  settlesInto?: string;
}}
''',
        encoding='utf-8',
    )
    print(f'\nmetrics {METRICS_TS.as_posix()}  ({len(entries)} sprites)')


if __name__ == '__main__':
    heights = {}
    complete = True
    for name in characters():
        if ONLY and name != ONLY:
            complete = False
            continue
        if name in SKIP or name in LEGACY:
            print(f'{name}: skipped')
            complete = False
            continue
        board_out = OUT_ROOT / name / f'{name}.png'
        if board_out.exists() and not is_ours(name, board_out):
            print(
                f'{name}: SKIPPED -- {board_out.as_posix()} was not written by this script.\n'
                f'         Art looks to have been dropped into the output folder.\n'
                f'         Move it to {(ACTORS / name).as_posix()}/ to process it, or delete\n'
                f'         the output first if you really mean to regenerate from source.'
            )
            complete = False
            continue
        heights[name] = prepare(name)[0]

    if heights:
        print('\nnative heights (the cast\'s relative statures, straight from the art):')
        for n, h in sorted(heights.items(), key=lambda kv: -kv[1]):
            print(f'  {n:10} {h:>3} native px  {"#" * h}')

    for path in publish_scenery():
        print(f'scenery {path}')

    # Only safe once every actor has been through this run -- otherwise the keep
    # set is missing whatever a skipped actor would have contributed.
    if complete:
        keep = {Path(p) for p in expected_outputs()}
        for gone in prune(OUT_ROOT, keep) + prune(OUT_SCENERY, keep):
            print(f'pruned  {gone}')
    else:
        print('\nprune skipped -- not every actor was processed this run.')

    write_metrics()
