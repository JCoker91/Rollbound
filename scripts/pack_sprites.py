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

import hashlib
import io
import json
import os
import time

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

# Style guide v2.0 moved the native grid from 64px-delivered-at-4x to a 128px
# canvas that IS the shipped asset, with the feet baseline at y=112.
#
# Both standards are in the roster while the migration runs, so the canvas an
# actor was authored on is READ OFF THEIR FILES rather than assumed globally.
# That matters for more than the lint: stature is `figure height / native
# canvas`, so measuring a 128px sprite against the 64px constant would render it
# at double the size of everyone else.
SPECS = {
    # v3 is v2 doubled, and is the CURRENT standard (style guide v3.0). Every
    # threshold is exactly 2x so the two describe the SAME character standing
    # the same height -- the canvas is a detail budget, not a size multiplier,
    # and stature stays `body / canvas` either way. That is what lets the
    # roster migrate one actor at a time: a 128 sprite and a 256 sprite stand
    # correctly beside each other, so nothing has to be rebuilt in lockstep.
    3: {'native': 256, 'ground': 224, 'height': (164, 184), 'margin': 16},
    2: {'native': 128, 'ground': 112, 'height': (82, 92), 'margin': 8},
    1: {'native': NATIVE, 'ground': GROUND_LINE_NATIVE, 'height': HUMANOID_H_RANGE,
        'margin': SAFE_MARGIN_NATIVE},
}

# Canvas size -> spec. Read off the art rather than declared anywhere, so a new
# size is one entry here and nothing else.
BY_CANVAS = {s['native']: n for n, s in SPECS.items() if n != 1}

# The revision new art is expected to be drawn against -- style guide v3.0, 256px.
#
# Only reached when the canvas is NOT recognised, which means the art is wrong
# and is about to be told so. What it is told is the whole point: a 1254px
# upload measured against v2 reports "guide says 128x128" and sends the artist
# to redraw at the size the guide no longer asks for. Recognised art is still
# matched to its own spec, so 128 sheets keep auditing as 128 while they last.
CURRENT_SPEC = max(SPECS)

# Superseded sheets kept beside the live ones. `animations/` is scanned
# indiscriminately, so without this a deprecated sheet becomes a clip named
# `idle_old` and gets packed and shipped.
DEPRECATED_CLIPS = ('_old', '_previous', '_deprecated')

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
# Actor -> outline width, in native pixels. Absent means the art ships as drawn.
#
# The generators anti-alias, and the drawn outline arrives BROKEN rather than
# missing: 84% of Benjamin's silhouette boundary is very dark, and the other 16%
# is where the softening ate it. A boundary that is bold in most places and gone
# in the rest is what reads as blur, and no keying can put back a pixel the
# generator never committed to.
#
# Redrawing the ring is better than hand-editing every frame for a reason beyond
# effort: it is derived from the alpha mask, so it is identical on all 8 frames
# and cannot jitter between them, and it survives regenerating the art.
#
# Only the OUTER silhouette. An internal separation -- an arm against a torso --
# is not on the alpha boundary and still has to be drawn.
# Scale classes from the style guide (§4), as native-pixel body bands.
#
# A sprite is audited against the class it is DECLARED to be, not against one
# band for everybody. Without this the lint can only say "not Standard", which
# is noise for a character that was never meant to be -- and noise is how a lint
# teaches you to stop reading it. Declaring the class turns "this is wrong" into
# "this does not match what you said it was", which is the only version worth
# acting on.
#
# It records intent; it does not change rendering. Stature still comes from the
# measured art, so a sprite declared Small that is drawn Large is reported, not
# silently shrunk.
#
# Every band is a FRACTION OF THE SPRITE'S OWN CANVAS, which is the only form
# that compares across canvases: "82-92 native px" is a different character on
# 128 than on 256, while 0.64-0.72 of canvas is the same one on both. Bosses
# were already authored this way because they alone were drawn larger; style
# guide v3.0 moved the whole roster to 256, so the exception became the rule.
#
# The numbers are the guide's Section 4 bands divided by their canvas -- the
# same character, restated in the units that survive a canvas change.
SCALE_CLASSES = {
    'small': (58 / 128, 72 / 128),        # guide: 116-144 px on 256
    'standard': (82 / 128, 92 / 128),     # guide: 164-184 px on 256
    'large': (92 / 128, 104 / 128),       # guide: 184-208 px on 256
    'boss': (0.70, 0.98),
}
SCALE_CLASS: dict[str, str] = {
    # The Understudies were briefly declared `small` as a recommendation -- trash
    # mobs standing shorter than the Cast. That was overruled: the art is
    # approved at 91-93, so the declaration came out rather than being left to
    # report a deviation from a decision nobody is going to make. Undeclared
    # audits as Standard, which is the band they sit on.
}


# Native pixels of PROP standing above the crown of the head -- a hat's point, a
# raised staff finial, a wing tip.
#
# The guide's height bands are about the BODY, "excluding raised weapons,
# oversized hats, capes, hair extensions, and effects" (SPRITE_STYLE_GUIDE.md),
# and drawing a character smaller to fit its hat in is listed there as grounds
# for rejection. The content box is not that measurement: it is the body plus
# whatever the character is wearing or holding. Read off the box, Maxine's 85px
# body audits as 106 and Aethis's 86 as 95 -- two false alarms against art that
# obeys the rule, raised by the one check that exists to catch art that does
# not. A lint that cries wolf on the compliant case cannot report the real one.
#
# LINT ONLY, and deliberately so: it must not touch stature, because stature
# already excludes the prop without being told. content.ts scales the whole
# cropped image by `contentPx / canvas`, so the body lands on screen at
# `bodyPx / canvas` and the hat scales along with it rather than stealing from
# it. Measured across the roster -- Benjamin 0.664, Maxine 0.672, Aethis 0.680,
# Kael 0.711 -- the cast already stands correctly. Feeding these numbers into
# the render would shrink exactly the characters they are here to vindicate.
#
# Measured from the top of the outline ring down to the crown, matching the
# ring the height check discounts at both ends. Zero for anyone unlisted, which
# is most of the cast -- only a prop drawn ABOVE the head earns an entry. Kael's
# axe is raised but his head still tops his silhouette, so he has none.
# Each value is in the actor's OWN canvas pixels, so it is invalidated by a
# redraw onto a different canvas -- these two were measured on 128 and roughly
# double on 256. Left stale, the check under-counts the prop and reports a
# compliant body as oversized, which is the failure this dict exists to end;
# the note names the discount precisely so that shows up rather than hides.
PROP_HEADROOM: dict[str, int] = {
    'maxine': 21,   # 128-grid: witch's hat, point down to her hairline
    'aethis': 9,    # 128-grid: staff finial
}


def body_height(name: str, box, k: int) -> float:
    """
    The figure's height on its own native grid, as the guide defines the bands.

    Less the ring this script drew, top and bottom, for the reason the margin
    check discounts it too: the guide's band is about the ART, and reporting the
    pipeline's own deliberate pixels as drift teaches you to ignore the lint.
    Uniform across every sprite, so it shifts every reading by the same 2px and
    changes no relative stature.
    """
    return (box[3] - box[1] - 2 * outline_width(name)) / k - PROP_HEADROOM.get(name, 0)


def scale_band(name: str) -> tuple[float, float]:
    """
    The body-height range this sprite is audited against, in ITS canvas's pixels.

    Declared bands are fractions and are multiplied up by the canvas the art was
    actually drawn on, so one declaration reads correctly on 128 and 256 alike.
    Hard-coded pixels would have made every class declaration wrong the moment
    an actor was redrawn at 256 -- a `large` warrior measured against a 128 band
    reports as twice the size he is, and the lint blames the art for the table.

    An undeclared sprite falls back to its spec's own Standard band, which is
    already stated per canvas in SPECS.
    """
    declared = SCALE_CLASS.get(name) or ('boss' if is_boss(name) else None)
    if declared:
        lo, hi = SCALE_CLASSES[declared]
        canvas = file_canvas(name) if is_creature(name) else spec(name)['native']
        return (round(lo * canvas), round(hi * canvas))
    return SPECS[spec_of(name)]['height']


OUTLINE: dict[str, int] = {}
# Width for art with nothing set, per spec revision. On by default for v2, since
# the ring is what the current look depends on and a new upload should not have
# to be added to a dict to get it. Off for v1, whose smoothed sheets are drawn
# a third of their file size and have no pixel grid for a ring to sit on.
# 2px at 256, so the ring reads the same WEIGHT as 1px at 128 -- the canvas is
# doubled, so an outline that stayed 1px would look half as bold beside the rest
# of the cast once both are drawn at the same height on stage.
OUTLINE_DEFAULT = {3: 2, 2: 1, 1: 0}


def outline_width(name: str) -> int:
    # Paper art draws its own keyline. See PAPER_COLOURS.
    if is_paper(name):
        return 0
    return OUTLINE.get(name, OUTLINE_DEFAULT[spec_of(name)])

# Above this many distinct colours, art is treated as a painted render whose
# edges are genuinely anti-aliased rather than as pixel art whose edges are
# drawn. Deliberately far from both cases: the guide caps a sprite at 64 colours
# and the painted sheets run to six figures. See key_flat_background.
PIXEL_ART_COLOURS = 512

# Art style v4, "paper": sticker-style painted art with soft edges.
#
# Detected by the SAME measurement that already tells painted renders from pixel
# art -- colour count -- rather than by canvas size, because the paper generator
# has no fixed canvas and never will: a sticker is whatever shape it is drawn.
# Every pixel-art step is skipped for it, and each of those steps would damage
# it rather than merely being unnecessary:
#
#   outline     it already carries a drawn white die-cut keyline; a second
#               1-2px ring drawn around that reads as a double border
#   unmatte     written to strip a matte off hard-edged art, it eats the soft
#               antialiased edge this style is made of
#   binary alpha  the whole look depends on ~700k semi-transparent pixels
#   nearest-neighbour  it is drawn ABOVE display size and scales down, so it
#               wants smoothing; `pixelArt: false` is what the renderer reads
#
# What still applies: content-box cropping, foot anchoring, the animation
# packer's shared crop box, and the stature rule.
PAPER_COLOURS = 4096

# Paper art's stature, as a fraction of its own canvas.
#
# Pixel art carried this in the style guide's body band (164-184 of 256). The
# paper generator has no such convention yet -- it fills the frame -- so a
# straight `content / canvas` reading puts Benjamin at 0.92 against the pixel
# roster's 0.66, and he would render 39% larger than the character he replaces.
# Declaring it keeps the cast the same size on the boards while the paper style
# is being evaluated. It belongs in the style guide once that guide has a paper
# section; until then it lives here so the number is in one place.
PAPER_STATURE = 0.66
# Named single-frame poses an actor may ship beside their board sprite.
EXTRA_POSES = ('pain', 'death')
#: Most frames a square-cell guess may claim before it is treated as nonsense
#: rather than as a very long animation. Benjamin's longest authored clip is 16.
MAX_INFERRED_COLS = 16
# The grid statures are expressed against, shared with content.ts's BASE_CANVAS.
BASE_DENSITY = 128


def is_paper(name: str) -> bool:
    """Is this actor's source art the painted sticker style rather than pixel art?"""
    src = source_image(name)
    if src is None:
        return False
    with Image.open(src) as im:
        rgba = im.convert('RGBA')
        seen = {px[:3] for px in rgba.getdata() if px[3] > ALPHA_FLOOR}
        if len(seen) > PAPER_COLOURS:
            return True
    return False
# What counts as art when mirroring folders that are copied rather than packed.
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}

ART = Path('art')
ACTORS = ART / 'actors'
CREATURES = ART / 'enemies' / 'creatures'
BOSSES = ART / 'enemies' / 'bosses'
SCENERY = ART / 'background'
# Hit sparks, bursts and the like: strips that play ON a target rather than
# belonging to any one actor, so they live outside art/actors/ and are measured
# once into a shared registry. Grid comes from the `_<cols>x<rows>` suffix, the
# same convention animation clips already use.
EFFECTS = ART / 'effects'
OUT_ROOT = Path('public/sprites')
OUT_SCENERY = Path('public/background')
OUT_EFFECTS = Path('public/effects')
METRICS_TS = Path('src/engine/sprites.generated.ts')


# How many output files this run actually rewrote. The dev server reads the
# final line below to decide whether a reload is worth sending -- a pack that
# changed nothing should not throw an animator out of the lab, and a "reloading"
# that visibly changes nothing is worse than silence: it reads as the pipeline
# having run and the art having not taken.
WRITES = 0


def write_if_changed(path: Path, text: str, *, encoding: str = 'utf-8') -> bool:
    """
    Write only when the bytes would actually differ. Returns whether it wrote.

    METRICS_TS lives under src/, so it is a MODULE -- the battle screen, the
    animation lab and every hub screen import it. Rewriting it unconditionally
    meant any pack, including one that found nothing to do, fired an HMR wave
    across all of them: in the lab that remounts the editor and loses whatever
    frame, clip and unsaved tuning was on screen. The dev server re-packs on
    every save under art/, so "a pack that changed nothing" is the common case
    rather than the rare one.

    Compared as TEXT rather than by mtime or size, because the generator is
    deterministic and a byte-identical render is exactly the case worth
    skipping. Read with an explicit encoding for the same reason every other
    read in this file has one -- on Windows the default is cp1252, and getting
    that wrong here truncates the file mid-write.
    """
    if path.exists():
        try:
            if path.read_text(encoding=encoding) == text:
                return False
        except (UnicodeDecodeError, OSError):
            pass  # unreadable is not the same as unchanged -- rewrite it
    global WRITES
    WRITES += 1
    path.write_text(text, encoding=encoding)
    return True


def save_if_changed(image, path: Path, **kw) -> bool:
    """
    The same guard for a PNG. Returns whether it wrote.

    Every output here was rewritten on every run, byte for byte identical, and
    that had two costs. The dev server watches public/ and reloads the page when
    anything in it changes, so a pack with nothing to do still threw the
    animator out of whatever they were tuning. And `git status` after a build
    listed a dozen sprites whose pixels had not moved -- the re-encode churn the
    handbook tells you to check for and revert by hand.

    Encoded to memory first and compared as bytes. Pillow's PNG output is
    deterministic for the same image and options, so identical pixels really do
    produce an identical file; comparing the ENCODED form rather than the pixels
    also means a change of compression options still counts as a change.
    """
    buf = io.BytesIO()
    image.save(buf, format='PNG', **kw)
    data = buf.getvalue()
    if path.exists():
        try:
            if path.read_bytes() == data:
                return False
        except OSError:
            pass
    global WRITES
    WRITES += 1
    path.write_bytes(data)
    return True

# Characters whose art predates the style guide and has no _LQ/native pair yet.
# They keep whatever is already in public/sprites and an explicit scale in
# content.ts until they are regenerated. Empty now that the whole roster is on
# the guide -- kept because the next pre-guide import will want it.
LEGACY: set[str] = set()

ONLY: set[str] = set()
SKIP: set[str] = set()


def parse_args(argv: list[str]) -> None:
    """
    `--only <name>` limits the run to certain actors, repeatable.

    For the dev-server watcher, which knows exactly whose folder changed and has
    no reason to re-pack the rest of the roster on every save. A limited run
    already declines to prune, so it cannot delete an untouched actor's output.
    """
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument('--only', action='append', metavar='NAME', default=[],
                    help='pack just this actor; repeatable')
    ap.add_argument('--skip', action='append', metavar='NAME', default=[])
    args = ap.parse_args(argv)
    ONLY.update(args.only)
    SKIP.update(args.skip)
    unknown = (ONLY | SKIP) - set(characters())
    if unknown:
        ap.error(f'no such actor: {", ".join(sorted(unknown))}')


def spec_of(name: str) -> int:
    """
    Which revision of the style guide this actor's art was authored against.

    Decided by which files exist, not by a per-character list, so migrating an
    actor is only ever a matter of dropping the new files in.

    v2 and v3 ship `<name>.png` as the finished asset, on a 128 and 256 canvas
    respectively, and are told apart by measuring it. v1 shipped a 64px master
    upscaled to `<name>_LQ.png`, from which `<name>.png` was DERIVED into
    public/ -- so the presence of `<name>_LQ.png` is what distinguishes them,
    and it is checked first.
    """
    # MEASURED, not declared. An actor's canvas is a fact about their file, and
    # asking the file is what let Brax arrive at 256 without a content change --
    # before this, a 256 sprite was measured against the 128 grid and came out
    # at 1.63 of canvas against Benjamin's 0.66, which would have drawn him two
    # and a half times everyone's height.
    # Through `source_image`, which knows a creature is a FLAT file while an
    # actor is a folder. Building the path here assumed the folder shape for
    # both, so a creature's canvas was never actually read -- every one of them
    # fell through to the default below and only matched by luck while that
    # default was v2. The 128px mobs then audited against the 256px band.
    src = source_image(name)
    if src is not None and src.exists():
        with Image.open(src) as im:
            found = BY_CANVAS.get(im.width)
        if found:
            return found

    # No legacy enemy art exists, so an unrecognised creature canvas is simply
    # new art drawn wrong, and belongs against the current standard.
    if is_creature(name):
        return CURRENT_SPEC
    d = ACTORS / name
    # v2 wins whenever its finished asset is present, even if the v1 files are
    # still lying beside it. Migrating an actor means dropping in <name>.png, and
    # deleting the old set is a separate act of tidying -- if `_LQ` took priority
    # the pipeline would quietly keep shipping the OLD art from the OLD grid
    # while the new file sat there unused, which is the kind of thing you only
    # notice by wondering why your upload did nothing.
    if (d / f'{name}.png').exists():
        return CURRENT_SPEC
    if (d / f'{name}_LQ.png').exists():
        return 1
    return CURRENT_SPEC


# The v1 files, which are dead weight once <name>.png exists.
SUPERSEDED = ('_LQ', '_HQ', '_base_native_64')


def leftovers(name: str) -> list[str]:
    """v1 files still sitting beside migrated v2 art. Reported, never deleted --
    this script owns public/, not the folder art is uploaded to."""
    d = ACTORS / name
    if spec_of(name) == 1:
        return []
    return [f'{name}{suffix}.png' for suffix in SUPERSEDED if (d / f'{name}{suffix}.png').exists()]


def spec(name: str) -> dict:
    return SPECS[spec_of(name)]


def reference(name: str) -> Image.Image:
    """
    The image every measurement is taken from.

    v1 measures the 4x delivery and divides; v2's shipped file IS the native
    canvas, so `upscale` below is what reconciles the two.

    Keyed here rather than at the point of use, because EVERY measurement depends
    on it. A still delivered on a green screen is fully opaque, so its content box
    is the whole canvas -- which reads as a figure standing 128 native px tall
    with no margin and its feet 15px below the baseline, and would ship a sprite
    with the backdrop still in it. Sheets were already keyed on the way through
    `split_sheet`; the still had no equivalent step.

    `key_flat_background` returns art that already has real transparency
    untouched, so this costs the v1 sheets nothing.
    """
    src = source_image(name)
    if src is None:
        raise FileNotFoundError(f'no source art for {name}')
    keyed = key_flat_background(Image.open(src).convert('RGBA'))
    return add_outline(keyed, outline_width(name))


def upscale(name: str) -> int:
    return UPSCALE if spec_of(name) == 1 else 1


def creatures() -> list[str]:
    """
    Every enemy in art/enemies/creatures/.

    One flat PNG each rather than a folder, because a creature is the v2 spec
    minus everything a Performer needs on top -- no 64px master to reconcile, no
    portrait crop, no animation set. Giving each a folder would be four empty
    directories per enemy for a bestiary that wants dozens of them.
    """
    out = []
    for folder in (CREATURES, BOSSES):
        if folder.is_dir():
            out += [f.stem for f in folder.glob('*.png') if not f.stem.endswith(DEPRECATED_CLIPS)]
    return sorted(out)


def creature_file(name: str) -> Path | None:
    for folder in (CREATURES, BOSSES):
        f = folder / f'{name}.png'
        if f.exists():
            return f
    return None


def is_creature(name: str) -> bool:
    return creature_file(name) is not None and not (ACTORS / name).is_dir()


def is_boss(name: str) -> bool:
    return (BOSSES / f'{name}.png').exists()


def source_image(name: str) -> Path | None:
    """The file every measurement for `name` is taken from, actor or creature."""
    if is_creature(name):
        return creature_file(name)
    d = ACTORS / name
    for candidate in (d / f'{name}.png', d / f'{name}_LQ.png'):
        if candidate.exists():
            return candidate
    return None


def file_canvas(name: str) -> int:
    """
    The canvas this art was actually drawn on, from the file.

    Used for the GEOMETRY checks -- margins, the ground line -- which are facts
    about the image. A boss legitimately uses a bigger canvas (the guide's Giant
    class), and auditing its 256px file against 128 reported its canvas, its
    ground line and its height as wrong all at once for one deliberate choice.
    """
    src = source_image(name)
    if is_creature(name) and src is not None:
        return Image.open(src).size[1]
    return SPECS[spec_of(name)]['native']


def density_grid(name: str) -> int:
    """
    The grid this sprite's STATURE is measured against, which is not the same
    thing as the canvas it was drawn on.

    A larger canvas means a larger CREATURE at the same pixel density -- not the
    same creature at higher resolution. Dividing a 203px boss by its own 256px
    file normalises exactly the size that makes it a boss, and it came out
    1.19x a Performer: barely taller than the trash it commands. Against the
    shared 128 density grid it is 2.39x, which is what the art is saying.

    So the canvas division exists only to reconcile art authored at different
    DENSITIES -- the old 64px grid against the 128px one that replaced it -- and
    a v2 sprite is measured against 128 whatever size its file happens to be.
    """
    return SPECS[spec_of(name)]['native']


def characters() -> list[str]:
    """Every art/actors/<name>/ that has a delivery sprite."""
    if not ACTORS.is_dir():
        return []
    return sorted(
        d.name
        for d in ACTORS.iterdir()
        if d.is_dir() and ((d / f'{d.name}_LQ.png').exists() or (d / f'{d.name}.png').exists())
    )


def manifest_path(name: str) -> Path:
    # Beside the art either way, so a folder (or a file and its manifest) stays
    # the complete portable unit.
    if is_creature(name):
        return CREATURES / f'{name}.pack.json'
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


def publish_effects() -> list[dict]:
    """
    Copy every effect strip into public/ and measure it.

    Cropped to content on the way, because these arrive with generous empty
    margins -- the impact burst was 8% ink on a 2172x724 canvas -- and the crop
    is what makes the published frame size mean the effect's own size rather
    than the generator's framing.
    """
    out = []
    if not EFFECTS.is_dir():
        return out
    OUT_EFFECTS.mkdir(parents=True, exist_ok=True)
    for src in sorted(EFFECTS.glob('*.png')):
        name, grid = parse_grid(src.stem)
        cols, rows = grid or (1, 1)
        sheet = Image.open(src).convert('RGBA')
        frames = split_sheet(sheet, (cols, rows))
        boxes = [b for b in (content_box(f) for f in frames) if b]
        if not boxes:
            continue
        # ONE crop box across every frame, so the effect does not jitter: each
        # frame is a different shape and cropping them individually would
        # re-centre the burst on every step.
        box = (min(b[0] for b in boxes), min(b[1] for b in boxes),
               max(b[2] for b in boxes), max(b[3] for b in boxes))
        w, h = box[2] - box[0], box[3] - box[1]
        strip = Image.new('RGBA', (w * len(frames), h))
        for i, f in enumerate(frames):
            strip.alpha_composite(f.crop(box), (i * w, 0))
        save_if_changed(strip, OUT_EFFECTS / f'{name}.png', optimize=True)
        out.append({'id': name, 'src': f'/effects/{name}.png',
                    'frames': len(frames), 'aspect': round(w / h, 6)})
    return out


def expected_outputs() -> list[str]:
    """Every file public/ should contain, according to art/."""
    out = []
    for name in creatures():
        out.append((OUT_ROOT / name / f'{name}.png').as_posix())
        out.append((OUT_ROOT / name / f'{name}_icon.png').as_posix())
    for name in characters():
        folder = OUT_ROOT / name
        out.append((folder / f'{name}.png').as_posix())
        # Always expected now: an actor without a hand-cropped source icon gets
        # a derived one (see `prepare`), and listing it conditionally meant the
        # derived file was written and then immediately pruned as stale.
        out.append((folder / f'{name}_icon.png').as_posix())
        for pose in EXTRA_POSES:
            if ((ACTORS / name / 'animations' / f'{name}_{pose}.png').exists()
                    or (ACTORS / name / f'{name}_{pose}.png').exists()):
                out.append((folder / f'{name}_{pose}.png').as_posix())
        for clip in load_manifest(name).get('clips', {}):
            out.append((folder / f'{name}_{clip}.png').as_posix())
    for e in publish_effects():
        out.append((OUT_EFFECTS / f'{e["id"]}.png').as_posix())
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
        # A malformed read is indistinguishable from "no manifest yet" here, and
        # THAT is what made losing a stamp possible: a reader catching a
        # half-written file got {} and the merge below then wrote a manifest
        # with the other half missing. `save_manifest` publishes atomically now,
        # so a reader can only ever see a complete previous version.
        return {}


def save_manifest(name: str, **fields) -> None:
    """
    Merge fields into an actor's manifest.

    Read-modify-write, because the fingerprint and the clip catalogue are
    written at different points in a run.

    Published ATOMICALLY -- written to a temporary file and renamed over the
    real one. `os.replace` is atomic on both POSIX and Windows, so a concurrent
    reader sees either the whole old manifest or the whole new one, never a
    half-written file.

    That mattered in practice, not in theory. The dev server repacks whenever
    art changes, so a manual run and a watcher run can overlap; one of them read
    a torn file, got nothing, and wrote back a manifest containing only the
    clips. The stamp it dropped is the one field that authorises the NEXT pack,
    so the actor became permanently unpackable until their output folder was
    deleted by hand. It happened three times.
    """
    data = load_manifest(name)
    data.update(fields)
    path = manifest_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f'.json.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding='utf-8')
    try:
        # Windows refuses to replace a file another process currently has open,
        # which for a manifest read on every pack is a matter of timing rather
        # than of anything being wrong. Retrying briefly costs nothing and turns
        # a lost write into a slightly later one; POSIX never takes this path.
        for attempt in range(20):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.05)
    finally:
        # Never leave a temp file in art/. The dev server watches this tree, and
        # a stray .tmp is both clutter and something for the watcher to trip on.
        tmp.unlink(missing_ok=True)


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


def derive_icon(board: Image.Image) -> Image.Image:
    """
    A square portrait for the team list, from the full-body sprite.

    The whole figure, padded to a square -- NOT a head crop. Cropping to the
    face was tried and abandoned: it needs the pipeline to know where a face
    is, and it does not. The Understudies wear a plume occupying the top
    quarter of the sprite with the mask below it, so a crop anchored at the top
    of the figure returned feathers and a shoulder. Every fix for that is
    another guess about anatomy, which is the same losing game as deriving
    internal outlines.

    A shrunk full body is honest instead of nearly-right, and for the job in
    hand -- telling five colour variants apart in a 26px row -- silhouette and
    colour carry it. A hand-drawn `<name>_icon.png` beats this and takes
    precedence wherever one exists; this is the fallback that means nobody has
    to draw one.
    """
    box = content_box(board)
    if not box:
        return board
    figure = board.crop(box)
    side = max(figure.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(figure, ((side - figure.width) // 2, (side - figure.height) // 2))
    return square


def audit(name: str, ref: Image.Image, native: Image.Image | None) -> list[str]:
    """
    The guide's acceptance checklist, as a lint.

    Reported, never fatal: a sprite that is 2px off the ground line is still
    perfectly usable, and the roster should not be blocked on it. But drift is
    worth seeing, because the ground line is what keeps feet on one line.

    Every threshold is expressed in the actor's own native pixels and scaled by
    `k` on the way out, so the same checks read v1 and v2 art without either
    spec's numbers being hard-coded here.
    """
    # Paper art is measured, not linted: the guide's canvas, ground line, margin,
    # binary alpha and body band are all pixel-art rules, and reporting a sticker
    # against them would be five notes on one deliberate decision. It gets its
    # own section of the style guide when the style is settled.
    if is_paper(name):
        return []

    s, k = spec(name), upscale(name)
    # A boss is authored on its own larger canvas by design (the guide's Giant
    # class), so the grid every other check is measured against comes from the
    # FILE for creature art. Hard-coding 128 here reported a legitimate 256px
    # boss as wrong on its canvas, its ground line and its height at once --
    # three notes for one deliberate decision.
    canvas = file_canvas(name) * k if is_creature(name) else s['native'] * k
    notes = []
    if ref.size != (canvas, canvas):
        notes.append(f'delivery canvas is {ref.width}x{ref.height}, guide says {canvas}x{canvas}')

    alpha = ref.getchannel('A')
    semi = sum(1 for v in alpha.getdata() if 0 < v < 255)
    if semi:
        notes.append(f'{semi} semi-transparent pixels; guide requires binary alpha')

    box = content_box(ref)
    margin = min(box[0], box[1], ref.width - box[2], ref.height - box[3])
    # Less whatever the outline step spent. The guide's margin is a requirement
    # on the DELIVERED art, and reporting the pipeline's own deliberate pixel as
    # drift is how a lint teaches you to ignore it -- the same mistake the
    # binary-alpha note made while unmatte was feathering pixel art.
    need = (s['margin'] - outline_width(name)) * k
    if margin < need:
        notes.append(f'margin {margin}px < {need}px ({need // k} native)')

    feet = box[3] - 1
    # Expressed as a fraction of the canvas so it survives a different one: the
    # guide's y=112 on 128 is 0.875 down, which is y=224 on a 256px boss.
    want = round((s['ground'] / s['native']) * canvas)
    if feet != want:
        notes.append(f'feet at y={feet}, ground line is y={want} ({(feet - want) / k:+.2f} native px)')

    h_native = body_height(name, box, k)
    lo, hi = scale_band(name)
    if not lo <= h_native <= hi:
        klass = SCALE_CLASS.get(name) or ('boss' if is_boss(name) else 'standard')
        # Says what was discounted, so the number can be checked against the art
        # rather than taken on faith -- and so a stale PROP_HEADROOM entry shows
        # up as an implausible body height instead of hiding a real shortfall.
        prop = PROP_HEADROOM.get(name, 0)
        less = f' (less {prop}px of prop above the head)' if prop else ''
        notes.append(
            f'body {h_native:.0f} native px{less} is outside the {klass} band ({lo}-{hi})'
        )

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
# Override only. `default_idle` falls back to a clip actually named `idle`, so a
# new actor animates as soon as their sheet lands -- before this, an actor
# missing from here packed their strip and then shipped no `idle` field at all,
# and stood stock still in battle with nothing to say why.
DEFAULT_IDLE: dict[str, str] = {}


def default_idle(name: str, clips) -> str:
    """Which packed clip the battle idles with."""
    if name in DEFAULT_IDLE:
        return DEFAULT_IDLE[name]
    if 'idle' in clips:
        return 'idle'
    return next(iter(sorted(c for c in clips if loops(c))), '')

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
    # Reach far enough to cross a thin feature. A hair spike or a sword tip
    # narrower than 2*erode has no core at all, so a short spread never
    # reaches it, `figure` keeps the pixel's own contaminated colour, and the
    # projection below then reports full coverage of the backdrop -- which is
    # how green survived on Benjamin's spikes after the key had done its job.
    for _ in range(erode + 10):
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


def _dilate(mask, times: int = 1):
    """Grow a boolean mask by `times` pixels, 8-connected."""
    import numpy as np

    for _ in range(times):
        p = np.pad(mask, 1)
        grown = np.zeros_like(mask)
        for dy in range(3):
            for dx in range(3):
                grown |= p[dy:dy + mask.shape[0], dx:dx + mask.shape[1]]
        mask = grown
    return mask


def outline_ink(img: Image.Image) -> tuple[int, int, int]:
    """
    The colour to draw the outline in: the art's own most common near-black.

    Sampled rather than fixed, so the ring joins the existing palette instead of
    adding a 65th colour to a sheet the guide caps at 64. Benjamin's resolves to
    (3, 1, 1), already 367 pixels of his silhouette.
    """
    import numpy as np

    a = np.asarray(img).astype(int)
    solid = a[..., 3] > ALPHA_FLOOR
    dark = solid & (a[..., :3].sum(-1) < 120)
    if not dark.any():
        return (0, 0, 0)
    cols, counts = np.unique(a[..., :3][dark].reshape(-1, 3), axis=0, return_counts=True)
    return tuple(int(v) for v in cols[counts.argmax()])


def add_outline(img: Image.Image, width: int, ink: tuple[int, int, int] | None = None) -> Image.Image:
    """
    Draw a solid ring of `width` pixels around the silhouette.

    Drawn INSIDE the existing canvas, into the guide's safe margin, which is what
    that margin is for -- §2 requires 8 clear pixels and the ring needs one. The
    canvas is only enlarged when the art actually reaches its edge, because
    growing it otherwise would put every outlined sprite 2px over the 128x128 the
    guide specifies and the audit would rightly complain.

    Added OUTSIDE the existing pixels rather than recolouring the boundary.
    Recolouring keeps the figure the same size but spends a pixel of drawing to
    do it, and measured side by side it flattened the sword's bright edge and
    thinned the cloth. The figure grows by `width` on each side, and since this
    runs before anything is measured, the audit and the stature both describe the
    art as it actually ships.
    """
    import numpy as np

    if width < 1:
        return img
    ink = ink or outline_ink(img)

    box = content_box(img)
    room = min(box[0], box[1], img.width - box[2], img.height - box[3]) if box else width
    grow = max(0, width - room)
    if grow:
        bigger = Image.new('RGBA', (img.width + 2 * grow, img.height + 2 * grow), (0, 0, 0, 0))
        bigger.paste(img, (grow, grow))
        img = bigger

    a = np.asarray(img).astype(np.int16).copy()
    solid = a[..., 3] > ALPHA_FLOOR
    ring = _dilate(solid, width) & ~solid
    a[ring, :3] = ink
    a[ring, 3] = 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def key_dominance(rgb, channel: int):
    """
    How strongly a colour leans on ONE named channel, over the other two.

    The measure a chroma key turns on. Measured along the key's channel rather
    than each pixel's own brightest one, which would score a red pixel exactly as
    highly as a green one and key the figure out along with the backdrop.

    Against a green key: the backdrop scores 246, its anti-aliased mixtures 98 to
    194, Benjamin's greenest real pixel 22.5, and anything red goes negative. A
    grey backdrop scores 0 on every channel, which is what keeps this test from
    engaging on sheets that are merely flat.
    """
    import numpy as np

    a = np.asarray(rgb, np.int16)
    return a[..., channel] - (a.sum(-1) - a[..., channel]) / 2


def key_chroma(img: Image.Image, floor: float = 0.35) -> Image.Image:
    """
    Remove a chroma-key backdrop from art the corner flood cannot reach.

    `key_flat_background` fills inward from the corners, which needs a corner
    that IS background. An icon is a full-bleed crop, so its corners are usually
    the character -- Maxine's is (10,5,13), solid art -- while the key colour
    sits in the gaps the figure does not fill. Hers shipped with 97 pixels of
    pure (0,255,0) showing through the roster card.

    Keyed by hue alone, which is safe for the same reason it is safe on the
    sheets: a green screen means the subject contains no green. Gated on a
    near-pure key colour actually being present, so a hand-painted backdrop --
    the dark red behind Benjamin, the blue behind Kael -- is left alone.
    """
    import numpy as np

    a = np.asarray(img.convert('RGBA')).astype(np.int16)
    rgb = a[..., :3]

    # AREA is the test, not peak chroma. Peak alone fires on any saturated
    # highlight: Kael's icon reaches 209 on an orange trim pixel and Aethis 255
    # on a red one, and keying either punches a hole through the portrait -- the
    # very thing this function's predecessor refused to risk. A backdrop covers
    # ground. Maxine's key is 8.01% of her icon; those two highlights are 0.00%
    # and 0.02%, so a 1% floor sits 400x clear of the false positives.
    best = None
    for channel in range(3):
        d = key_dominance(rgb, channel)
        strong = d >= 200
        if not strong.any():
            continue
        cols, counts = np.unique(rgb[strong].reshape(-1, 3), axis=0, return_counts=True)
        j = int(counts.argmax())
        if best is None or counts[j] > best[0]:
            best = (int(counts[j]), channel, d, float(d.max()))
    if best is None:
        return img

    count, channel, d, peak = best
    if count / rgb[..., 0].size < 0.01:
        return img

    keyed = d >= peak * floor
    # A backdrop, not a costume: if "background" came out as most of the art,
    # the test has found a green character rather than a green screen.
    if keyed.mean() > 0.9:
        return img
    out = a.copy()
    out[keyed, 3] = 0
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


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
    dist = np.abs(np.asarray(img.convert('RGB'), np.int16) - bg).max(-1)
    flat = dist <= POCKET_TOLERANCE
    pockets = flat & keep

    # Whether a lone matching pixel is trustworthy depends on how isolated the
    # backdrop colour is, so measure that rather than assuming either way.
    #
    # `_open` exists to drop specks and hairlines, on the grounds that a figure
    # pixel could coincidentally match a plausible backdrop -- a real risk for
    # the grey backdrops the earlier sheets used. But it also discards the
    # SINGLE-PIXEL pockets a green screen produces: Benjamin's idle enclosed
    # about fifty per frame, in the hair, the scarf and the sword hilt, and every
    # one survived to the strip as an opaque green dot.
    #
    # A true key colour makes the opening unnecessary, and says so in the data:
    # this sheet had 105,716 pixels exactly on (3,250,5) and not one within 23 of
    # it. With a gap that wide, an exact match cannot be figure detail, so size
    # carries no information and filtering by it only loses pockets.
    gap = int(dist[~flat].min()) if (~flat).any() else 0
    isolated = gap >= POCKET_TOLERANCE * 4
    if not isolated:
        pockets = _open(pockets)

    # Anti-aliased contamination, which neither test above can reach.
    #
    # An exact-colour match only finds a pocket that HAS a pure centre. A single
    # enclosed pixel drawn with anti-aliasing has none -- it is all rim, a mix
    # like (29,223,29) rather than the key's (3,250,5) -- so it is not flat, not
    # reachable by the flood, and deep enough inside the silhouette that unmatte
    # counts it as core and forces it opaque. Those are the green dots that
    # survived in the hair, the scarf and the sword hilt.
    #
    # Keying by hue is what a chroma key is FOR, and it is safe precisely because
    # the backdrop is one: shooting against green means the subject contains no
    # green, so any pixel carrying the key's hue is contamination wherever it
    # sits. Benjamin's sheet bears that out -- his palette peaks at 22.5 green
    # dominance against the key's 246, and the mixed rim runs 98-194.
    #
    # Gated on the backdrop actually BEING a key colour. A grey backdrop scores 0
    # dominance and cannot pass, so the older sheets keep the flood-and-unmatte
    # path, where a soft edge is real and worth preserving.
    channel = int(np.argmax(bg))
    if isolated and (strength := key_dominance(bg, channel)) >= 120:
        keep &= ~(key_dominance(np.asarray(rgb, np.int16), channel) >= strength * 0.35)
    keep &= ~pockets

    out = img.copy()
    out.putalpha(Image.fromarray((keep * 255).astype(np.uint8), 'L'))

    # Un-mixing the edge is right for a PAINTED figure and wrong for a drawn one.
    #
    # `unmatte` assumes the ring around the silhouette is a blend of figure and
    # backdrop, and rebuilds it: it replaces each ring pixel's colour with one
    # spread outward from the interior and gives it partial alpha. On a render
    # that was genuinely anti-aliased that restores the soft edge the artist drew.
    #
    # On pixel art it destroys the thing the artist drew instead. A hard black
    # outline is not a mix of anything -- it IS the art, one pixel wide, and
    # rebuilding it substitutes the skin and cloth colours behind it and fades it
    # out. Benjamin's 60-colour idle came out of here with 1,209 colours and a
    # quarter of its visible pixels semi-transparent, which is exactly the
    # "outline gone, looks blurry" it looked like on screen.
    #
    # Decided by counting the palette, because that is what actually separates
    # the two cases and it is not a judgement call: the guide caps a sprite at 64
    # colours, the live sheets use 23 and 60, and the painted sheets this function
    # was written for use 144,000 and 182,000. Any threshold in between works.
    palette = len(np.unique(np.asarray(img.convert('RGB'))[keep].reshape(-1, 3), axis=0))
    if palette <= PIXEL_ART_COLOURS:
        return out
    return unmatte(out, tuple(int(v) for v in bg))


def parse_grid(clip: str) -> tuple[str, tuple[int, int] | None]:
    """
    Pull an optional `_<cols>x<rows>` off the end of a clip name.

    An escape hatch for sheets whose grid cannot be inferred, which style guide
    v2 introduced by giving each clip its own canvas: a 6-frame attack at 192x128
    per cell arrives as 1152x128, and 192 is not recoverable from those two
    numbers alone -- 128 divides both, so it would silently read as 9 frames of
    the wrong width. Naming the sheet `..._attack_6x1.png` settles it.
    """
    import re

    m = re.fullmatch(r'(.+)_(\d+)x(\d+)', clip)
    return (m.group(1), (int(m.group(2)), int(m.group(3)))) if m else (clip, None)


def gutter_cuts(
    sheet: Image.Image, cols: int, rows: int
) -> tuple[list[int], list[int]]:
    """
    Where to cut a sheet whose frames are NOT on an even grid.

    A uniform slice assumes the generator laid the cells out exactly. Benjamin's
    16-frame attack proves that assumption wrong: its rows measure 307, 304, 302
    and 271 px with 6, 14 and 13 px between them, so a 313.5 px slice takes the
    bottom of each row -- his FEET -- and drops it onto the top of the row
    below. The result reads as a character whose boots appear over his head.

    So find the actual empty bands and cut down the middle of them.

    Resolved PER AXIS, and that matters: this same sheet has three clean gaps
    between its rows and only two between its columns, because its last two
    columns touch. Insisting on both axes would fall back to the even slice
    and keep the bug, when the axis that actually needed fixing was readable
    all along. An axis that cannot be read falls back on its own.
    """
    alpha = sheet.getchannel('A').point(lambda v: 255 if v >= ALPHA_FLOOR else 0)
    px = alpha.load()
    W, H = sheet.size

    def bands(n: int, length: int, occupied) -> list[int] | None:
        """
        Boundaries for `n` frames along one axis, reading real gutters.

        Every gutter it can find is used. The ones it cannot are filled in at
        even spacing BETWEEN the gutters either side of them, which keeps a
        readable boundary readable even when its neighbour is not.

        That partial answer is the whole point of this rewrite. The first
        version demanded exactly `n - 1` gaps and returned None otherwise, so a
        single pair of touching drawings anywhere on the sheet threw away every
        correct boundary on it and fell back to an even slice -- and an even
        slice bleeds EVERY frame, not just the two that touched. Benjamin's
        Sunder tripped this on a three-pixel overlap between a swing arc and the
        next figure's silhouette: one bad seam, four spoiled frames.

        Gutters are matched to boundaries by proximity, because a gutter is
        evidence about the seam it is nearest and nothing else. A sheet whose
        drawings all touch still yields None, and an even slice is then the only
        answer available.
        """
        if n <= 1:
            return [0, length]
        gaps, run = [], None
        for i in range(length):
            if not occupied(i) and run is None:
                run = i
            elif occupied(i) and run is not None:
                gaps.append((run, i))
                run = None
        # Leading and trailing empty space is margin, not a gutter.
        inner = [(a + b) // 2 for a, b in gaps if a > 0 and b < length]
        if not inner:
            return None

        # Each seam takes the nearest unclaimed gutter, if one is close enough
        # to be about that seam rather than about a neighbour. Half a frame is
        # the widest a gutter can be misplaced and still be the better guess.
        step = length / n
        cuts: list[int | None] = []
        free = sorted(inner)
        for k in range(1, n):
            want = step * k
            near = min(free, key=lambda g: abs(g - want), default=None)
            if near is not None and abs(near - want) <= step / 2:
                cuts.append(near)
                free.remove(near)
            else:
                cuts.append(None)

        # Fill each unread seam evenly between the read boundaries around it, so
        # a missing gutter borrows the spacing its neighbours actually measured
        # rather than the spacing the header claimed.
        out = [0] + cuts + [length]
        for i, v in enumerate(out):
            if v is not None:
                continue
            lo = max(j for j in range(i) if out[j] is not None)
            hi = min(j for j in range(i + 1, len(out)) if out[j] is not None)
            span = (out[hi] - out[lo]) / (hi - lo)
            out[i] = round(out[lo] + span * (i - lo))
        return [int(v) for v in out]

    def even(n: int, length: int) -> list[int]:
        return [round(i * length / n) for i in range(n + 1)]

    xs = bands(cols, W, lambda x: any(px[x, y] for y in range(H))) or even(cols, W)
    ys = bands(rows, H, lambda y: any(px[x, y] for x in range(W))) or even(rows, H)
    return (xs, ys)


def split_sheet(sheet: Image.Image, grid: tuple[int, int] | None = None) -> list[Image.Image]:
    """
    Cut a sheet into frames, inferring the grid from the image's own dimensions.

    Square frames are the assumption, so the greatest common divisor of width and
    height IS the frame size -- 7680x640 resolves to 12x1 and 1448x1086 to 4x3.
    Read row-major. `grid` overrides the inference; see `parse_grid`.
    """
    from math import gcd

    if grid:
        cols, rows = grid
        fw, fh = sheet.width // cols, sheet.height // rows
    else:
        fw = fh = gcd(sheet.width, sheet.height)
        cols, rows = sheet.width // fw, sheet.height // fh

    xs, ys = gutter_cuts(sheet, cols, rows)
    return [
        key_flat_background(sheet.crop((xs[c], ys[r], xs[c + 1], ys[r + 1])))
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
            # Scaled by the FACTOR, against each frame's own size -- not resized
            # to `size`, which is the first frame's cell.
            #
            # Those are the same thing only while every cell is identical, and
            # `gutter_cuts` stopped guaranteeing that the day it started cutting
            # on real gaps instead of an even grid: Benjamin's ability_1 comes
            # out 468, 548, 518 and 514 wide. Resizing all four to 468 squeezed
            # three of them by up to 15% horizontally while leaving their height
            # alone, so the character got narrower on half the frames of every
            # clip whose factor was not 1 -- which is most of them.
            #
            # `size` is still what the canvas is measured against, and that is
            # fine: it only has to be big enough.
            scaled = (
                f
                if abs(k - 1) < 1e-6
                else f.resize(
                    (max(1, round(f.width * k)), max(1, round(f.height * k))), Image.LANCZOS
                )
            )
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
        # Clear the manifest's clip list as well as returning nothing.
        #
        # Returning early LEFT the previous clips recorded, so deleting an
        # actor's animations folder did not remove their animations: the
        # manifest still listed them, `expected_outputs` still whitelisted the
        # strips so the prune spared them, and `write_metrics` rebuilt `idle`
        # from the manifest. Four characters kept playing pixel-art idles for a
        # whole session after their source art had been replaced with stills.
        if load_manifest(name).get('clips'):
            save_manifest(name, clips={})
        return {}

    ink = outline_ink(reference(name)) if outline_width(name) else None

    raw = {}

    '''
    Per-frame folders, which take precedence over a sheet of the same name.

    A folder IS the clip: `animations/idle_2/` holding three PNGs is a
    three-frame idle, and the frame count is how many files are in it. That
    retires two whole classes of bug at once -- there is no grid to infer, so
    the `_NxM` trap cannot fire, and there is no cut to make, so a drawing that
    overruns a cell cannot bleed into its neighbour.

    It also makes a frame a thing you can own. Regenerate one bad drawing
    instead of a whole sheet; lift a frame out of one animation into another to
    build something the generator would not produce in a single pass.

    Files are read in sorted order, so index them zero-padded: `idle_2_01.png`
    before `idle_2_10.png`, which a bare `_1` / `_10` gets backwards.

    Frames of unequal size are padded to the largest, anchored bottom-centre --
    the case that arises the moment a frame is borrowed from another clip. It
    is a guess, so it is reported rather than done quietly, and the lab's
    per-frame `dx`/`dy` is where a borrowed frame gets nudged onto its mark.
    '''
    for sub in sorted(d for d in folder.iterdir() if d.is_dir()):
        clip = sub.name[len(name) + 1:] if sub.name.startswith(f'{name}_') else sub.name
        if clip in EXTRA_POSES or clip.endswith(DEPRECATED_CLIPS):
            continue
        files = sorted(sub.glob('*.png'))
        if not files:
            print(f'  ! {sub.name}/ is empty -- no clip built from it')
            continue
        frames = [key_flat_background(Image.open(f).convert('RGBA')) for f in files]
        widest = max(f.width for f in frames)
        tallest = max(f.height for f in frames)
        if any(f.size != (widest, tallest) for f in frames):
            odd = [f.name for f, im in zip(files, frames) if im.size != (widest, tallest)]
            print(f'  ! {sub.name}/: frames are not all one size -- padding to '
                  f'{widest}x{tallest}, bottom-centred ({", ".join(odd)}).'
                  f' Nudge them in the animation lab if they land off their mark.')
            padded = []
            for im in frames:
                canvas = Image.new('RGBA', (widest, tallest), (0, 0, 0, 0))
                canvas.alpha_composite(im, ((widest - im.width) // 2, tallest - im.height))
                padded.append(canvas)
            frames = padded
        if width := outline_width(name):
            frames = [add_outline(f, width, ink) for f in frames]
        if any(content_box(f) for f in frames):
            raw[clip] = frames

    for src in sorted(folder.glob('*.png')):
        clip = src.stem[len(name) + 1:] if src.stem.startswith(f'{name}_') else src.stem
        if clip.endswith(DEPRECATED_CLIPS):
            continue
        # A pose filed in here is still a POSE. It is published by the extra
        # stills pass and joined to the clip list afterwards, tight-cropped and
        # unnormalised -- letting it in here instead would put a figure drawn
        # lying down through `normalise`, which scales every clip to a common
        # figure HEIGHT and would stand the body back up at four times its size.
        if clip in EXTRA_POSES:
            continue
        clip, grid = parse_grid(clip)
        # A folder beats a sheet. Both can exist while a clip is being moved
        # over, and the folder is the one somebody has been editing frame by
        # frame -- silently preferring the sheet would hand back the drawings
        # they had just fixed.
        if clip in raw:
            continue
        sheet = Image.open(src).convert('RGBA')
        if grid is None:
            from math import gcd

            cell = gcd(sheet.width, sheet.height)
            cols, rows = sheet.width // cell, sheet.height // cell
            # An actor strip is one row. More than that means the square-cell
            # guess missed -- a 2048x768 four-frame sheet reads as 8x3, and the
            # 24 slivers it produces are not obviously wrong until you play the
            # clip. Naming the file `..._4x1.png` settles it, so say so rather
            # than packing the garbage.
            if rows > 1 or cols > MAX_INFERRED_COLS:
                # REFUSED, not warned.
                #
                # A warning is advice nobody reads at the bottom of a pack log.
                # This is not advice: `gcd` is a terrible guess for a sheet whose
                # cells are not square, and the failures are not small. A 2048x768
                # four-frame sheet reads as 8x3 and ships 24 slivers. A 2876x768
                # one has a gcd of 4 and reads as 719x192 -- 138,048 frames -- and
                # the pipeline will genuinely try to cut, outline and pack every
                # one of them before the browser tries to build a strip and a
                # keyframe track for it. That is a machine-eating amount of work
                # to do on behalf of a guess.
                #
                # Skipping leaves the clip simply absent, which `npm run art`
                # reports as missing and names the fix for.
                print(f'  ! {src.name}: SKIPPED -- no _NxM in the name, and {sheet.width}x{sheet.height}'
                      f' infers {cols}x{rows} = {cols * rows} frames, which is not a character strip.'
                      f'\n      Rename it with its real grid, e.g. {src.stem}_4x1.png')
                continue
        frames = split_sheet(sheet, grid)
        if width := outline_width(name):
            # Ink sampled from the STILL, not per frame: sampling each frame
            # could pick a different near-black on a frame that happens to hide
            # the darkest part, and the outline would shift colour mid-loop.
            frames = [add_outline(f, width, ink) for f in frames]
        if any(content_box(f) for f in frames):
            raw[clip] = frames
    if not raw:
        return {}

    rest_clip = default_idle(name, raw) or sorted(raw)[0]
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
        save_if_changed(strip, path)

        clips[clip] = {
            'src': '/sprites/%s/%s_%s.png' % (name, name, clip),
            'frames': len(cropped),
            'aspect': round(cw / ch, 6),
            # The strip's own height in file pixels. `aspect` cannot stand in for
            # it: the renderer needs the absolute number to round a figure to a
            # whole multiple of the art's pixels, and it is NOT the same as the
            # still's height -- Maxine's strip is 105px against a 106px still.
            'pxH': ch,
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

    '''
    The stills, offered to the lab as one-frame clips.

    Added HERE, after everything above has finished, and that placement is the
    whole design. A pose must not go through `normalise`, which scales each clip
    by the ratio of its figure HEIGHT to the reference clip's: a death pose is
    drawn lying down, so its figure height is small, and normalising would blow
    it up until the body stood as tall as the character does. It must not join
    the union box either -- that is what the upgrade sheet's starburst did, and
    it re-scaled all seven of Benjamin's clips.

    So they are measured from their own published PNG, which is already tightly
    cropped: `restFill` 1.0 and `footPad` 0.0 say "this image IS the figure",
    which is exactly true of a still and never quite true of a strip.

    They are entries in the same map purely so the animation lab can reach them.
    Nothing else looks a clip up by these names -- `abilityClipName` matches
    ability slugs -- and the battle still draws both poses through their own
    paths, now honouring whatever placement the lab saves for them.
    '''
    for pose in EXTRA_POSES:
        path = out_dir / f'{name}_{pose}.png'
        if not path.exists():
            continue
        img = Image.open(path).convert('RGBA')
        w, h = img.size
        clips[pose] = {
            'src': '/sprites/%s/%s_%s.png' % (name, name, pose),
            'frames': 1,
            'aspect': round(w / h, 6),
            'pxH': h,
            'anchorX': round(foot_anchor(img), 3),
            'loops': False,
            'normalised': 1.0,
            'trimmed': 0,
            'size': path.stat().st_size,
            'restFill': 1.0,
            'footPad': 0.0,
            'still': True,
        }

    if clips:
        save_manifest(name, clips=clips)
    return clips


def stamp_of(path: Path) -> dict:
    """
    Fingerprint an output file by its CONTENT.

    Deliberately not the modification time. Timestamps do not survive version
    control -- git records content, not mtime, and sets it to checkout time --
    so an mtime fingerprint reports every file as foreign after any clone,
    checkout or branch switch. That is exactly what happened: all five actors
    fingerprinted by mtime came back "not written by this script" with their
    sizes matching to the byte, and the guard below then skipped the entire
    roster on every run.

    A hash costs one read of a file already being written and is strictly
    stronger: it detects an edit that preserved the size, which mtime and size
    both miss.
    """
    data = path.read_bytes()
    return {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}


def is_ours(name: str, board_out: Path) -> bool:
    """
    Did THIS script write the file now in the output folder?

    public/ is supposed to be derived, but art has been dropped straight into
    public/sprites/<name>/ before, and a later run happily regenerated over it
    from stale sources -- destroying the upload. Comparing mtimes cannot catch
    that, because after any normal run the output is always newer than the
    input. The fingerprint recorded at write time can.
    """
    manifest = load_manifest(name)
    prev = manifest.get('stamp')
    if not prev:
        # No stamp at all is ambiguous, and which way it resolves matters.
        #
        # An EMPTY manifest means this actor has never been packed, so anything
        # sitting in the output folder got there some other way -- exactly the
        # dropped-in upload this guard exists to protect. Refuse.
        #
        # A manifest that exists but has no stamp is our own partial state: we
        # have packed this actor before and the fingerprint was lost. Refusing
        # there was a trap door, because the only code path that writes a stamp
        # is the one the refusal skips, so the actor could never be packed again
        # without deleting their output by hand. Proceed and re-stamp.
        return bool(manifest)
    if 'sha256' in prev:
        return prev['sha256'] == stamp_of(board_out)['sha256']
    # An mtime-era stamp, from before the format changed. Its timestamp is
    # meaningless after a checkout, so fall back to the one field that does
    # survive. Size alone is weak evidence, but it is only ever consulted once:
    # this run re-stamps with a hash.
    return prev.get('size') == board_out.stat().st_size


def prepare_creature(name: str) -> tuple[int, list[str]]:
    """
    Pack one enemy.

    Shares the actor path's measuring and trimming -- same green-screen key,
    same generated outline, same content-box crop -- but skips what a creature
    does not have. Output goes to public/sprites/<name>/ like everyone else so
    the metrics scan, the prune and the stamp guard all treat it identically;
    the alternative was a parallel enemies/ tree and three near-copies of code
    that already exists.
    """
    out = OUT_ROOT / name
    out.mkdir(parents=True, exist_ok=True)

    ref = reference(name)
    notes = audit(name, ref, None)
    box = content_box(ref)
    board = ref.crop(box)
    # The same ceiling the actor path applies. Without it a paper creature
    # shipped at its full 1147x1212 source -- 640 KB for something drawn on
    # screen at eighty pixels.
    if board.height > BOARD_HEIGHT:
        r = BOARD_HEIGHT / board.height
        board = board.resize((max(1, round(board.width * r)), BOARD_HEIGHT), Image.LANCZOS)

    board_path = out / f'{name}.png'
    save_if_changed(board, board_path, optimize=True)

    # Portrait for the team list. Grown by a whole factor so it stays crisp at
    # the 26-56px the panels draw it at, same rule as the hand-made ones.
    icon = derive_icon(ref)
    if icon.height > ICON_SIZE:
        icon = icon.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    elif icon.height and icon.height * 2 <= ICON_SIZE:
        factor = max(1, ICON_SIZE // icon.height)
        icon = icon.resize((icon.width * factor, icon.height * factor), Image.NEAREST)
    save_if_changed(icon, out / f'{name}_icon.png')

    save_manifest(name, stamp=stamp_of(board_path))
    return box[3] - box[1], notes


def prepare(name: str) -> tuple[int, list[str]]:
    """Process one character. Returns its native height and any audit notes."""
    src, out = ACTORS / name, OUT_ROOT / name
    out.mkdir(parents=True, exist_ok=True)

    ref = reference(name)
    native_path = src / f'{name}_base_native_64.png'
    native = Image.open(native_path).convert('RGBA') if native_path.exists() else None
    notes = audit(name, ref, native)

    box = content_box(ref)
    native_h = round((box[3] - box[1]) / upscale(name))

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
    #
    # v2 art does not have this split and does not want it. `<name>_preview.png`
    # looks like an _HQ but is not one: the guide requires it to be an integer
    # nearest-neighbour enlargement of the very same pixels, so shipping it would
    # ship a pre-scaled duplicate. The 128px canvas IS the finished asset, and
    # the browser enlarges it with the same nearest-neighbour step for free.
    hq_path = src / f'{name}_HQ.png'
    # Any v2-or-later spec ships its own canvas as the board; only v1 has the
    # _LQ/_HQ split below.
    if is_paper(name):
        # Ships as drawn, cropped to its own edge, smoothed on the way down.
        # `BOARD_HEIGHT` still caps it below, which is where the 1254px source
        # becomes a sensible delivery size.
        board = ref.crop(box)
        pixel_art = False
    elif spec_of(name) >= 2:
        board = ref.crop(box)
        pixel_art = True
    elif hq_path.exists():
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
    save_if_changed(board, board_path)
    save_manifest(name, stamp=stamp_of(board_path))

    # Icons are full-bleed portrait crops -- art runs to all four edges, so there
    # is nothing to key out and keying one punches a hole through it.
    icon_src = src / f'{name}_icon.png'
    if icon_src.exists():
        icon = key_chroma(Image.open(icon_src).convert('RGBA'))
        if icon.height > ICON_SIZE:
            icon = icon.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        elif icon.height * 2 <= ICON_SIZE:
            # Grown by a WHOLE factor, nearest-neighbour, before it ships.
            #
            # The v2 icons arrive tiny -- 32x32 and 31x31 -- and the panels draw
            # them at 40-56px, so the browser was smooth-UPSCALING pixel art by
            # 1.75x. Enlarging by an integer here keeps every art pixel a clean
            # block, and leaves the browser only ever scaling DOWN, which is the
            # direction that looks right without nearest-neighbour.
            factor = ICON_SIZE // icon.height
            icon = icon.resize((icon.width * factor, icon.height * factor), Image.NEAREST)
        save_if_changed(icon, out / f'{name}_icon.png')
    else:
        # `derive_icon` already documents itself as the fallback a hand-cropped
        # icon beats; until now only creatures reached it, so an actor without
        # one simply shipped no icon and fell back to their role glyph. Paper art
        # arrives as a single sticker with no separate headshot, so the fallback
        # is the normal case for it rather than the exception.
        save_if_changed(derive_icon(board), out / f'{name}_icon.png')

    # Extra stills: one-off poses a clip cannot express, published beside the
    # board sprite under the same name. `pain` is the first -- a hit reaction is
    # a single drawing held for a moment, not a sequence, and packing it as a
    # one-frame clip would put it through the whole strip machinery to say so.
    # `death` is the second, and the one that is genuinely never a sequence: a
    # downed Performer holds that drawing until the battle ends.
    #
    # Note the height clamp below does not fire for a pose drawn LYING DOWN --
    # it is shorter than the standing figure, not taller -- so a death pose
    # keeps its own proportions and the renderer sizes it by width instead.
    for pose in EXTRA_POSES:
        # `animations/` first, the actor root second.
        #
        # A pose belongs with the clips: it is one of the drawings a character
        # owns, it is listed beside them in the lab, and keeping it a directory
        # up made "where does art go" a question with two answers. The old
        # location still works so nothing has to be moved in a hurry.
        pose_src = src / 'animations' / f'{name}_{pose}.png'
        if not pose_src.exists():
            pose_src = src / f'{name}_{pose}.png'
        if not pose_src.exists():
            continue
        art = key_flat_background(Image.open(pose_src).convert('RGBA'))
        art = add_outline(art, outline_width(name))
        art = art.crop(content_box(art))
        if art.height > BOARD_HEIGHT:
            r = BOARD_HEIGHT / art.height
            art = art.resize((round(art.width * r), BOARD_HEIGHT), Image.LANCZOS)
        save_if_changed(art, out / f'{name}_{pose}.png')

    clips = build_animations(name)

    print(f'{name}:')
    print(f'  board {board_path.as_posix()} {board.width}x{board.height} '
          f'({board_path.stat().st_size // 1024} KB)  = {native_h} native px tall')
    for clip, info in clips.items():
        note = f'  (trimmed {info["trimmed"]} partial-cycle frames)' if info['trimmed'] else ''
        star = ' *default idle' if default_idle(name, clips) == clip else ''
        print(f'  anim  {clip:<14} {info["frames"]:>2} frames  '
              f'({info["size"] // 1024:>4} KB){note}{star}')
    for n in notes:
        print(f'  ! {n}')
    if stale := leftovers(name):
        print(f'  ~ superseded v1 files still present, safe to delete: {", ".join(stale)}')
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
        for pose in EXTRA_POSES:
            if (folder / f'{name}_{pose}.png').exists():
                fields.append(f"{pose}: '/sprites/{name}/{name}_{pose}.png'")
        fields.append(f'aspect: {img.width} / {img.height}')
        fields.append(f'pxH: {img.height}')
        fields.append(f'anchorX: {foot_anchor(img):.3f}')

        # How tall the figure stands on its own native grid, which is what makes
        # the roster's proportions comparable. `nativeCanvas` has to travel with
        # it: stature is the RATIO of the two, and reading a 128px actor's height
        # against the 64px grid would draw them at twice everyone else's size.
        # Null for pre-guide art with no native basis.
        if is_paper(name):
            # Declared rather than measured. The paper generator fills its frame,
            # so `content / canvas` reads 0.92 against the pixel roster's 0.66 and
            # would draw this character 39% larger than the one it replaces. See
            # PAPER_STATURE.
            fields.append(f'nativePx: {round(PAPER_STATURE * BASE_DENSITY)}')
            fields.append(f'nativeCanvas: {BASE_DENSITY}')
        elif source_image(name) is not None:
            b = content_box(reference(name))
            fields.append(f'nativePx: {round((b[3] - b[1]) / upscale(name))}')
            fields.append(f'nativeCanvas: {density_grid(name)}')
        else:
            fields.append('nativePx: null')
            fields.append(f'nativeCanvas: {NATIVE}')
        # Nearest-neighbour only suits art drawn LARGER than its file. _HQ is
        # drawn smaller, so it needs smoothing.
        smoothed = is_paper(name) or (ACTORS / name / f'{name}_HQ.png').exists()
        fields.append(f'pixelArt: {"false" if smoothed else "true"}')

        packed = catalogue.get(name, {})
        clip = packed.get(default_idle(name, packed))
        if clip:
            fields.append(
                f"idle: {{ src: '{clip['src']}', frames: {clip['frames']}, "
                f"aspect: {clip['aspect']}, pxH: {clip['pxH']}, anchorX: {clip['anchorX']}, "
                f"restFill: {clip['restFill']}, footPad: {clip['footPad']} }}"
            )
        entries.append((name, fields))

    ids = ' | '.join(f"'{n}'" for n, _ in entries)
    body = '\n'.join(f'  {n}: {{ {", ".join(f)} }},' for n, f in entries)
    # Only the fields the lab needs; `trimmed`/`size` are build diagnostics.
    lab = {
        name: {
            clip: {k: v for k, v in info.items() if k in ('src', 'frames', 'aspect', 'pxH', 'anchorX', 'loops', 'restFill', 'footPad', 'normalised', 'settlesInto')}
            for clip, info in clips.items()
        }
        for name, clips in sorted(catalogue.items())
    }
    clips_json = json.dumps(lab, indent=2, sort_keys=True)
    effects_json = json.dumps({e['id']: e for e in publish_effects()}, indent=2, sort_keys=True)
    # Every scenery image, so the stage lab can offer them without a second
    # list anyone has to remember to update.
    scenery = sorted(
        f'/background/{q.relative_to(SCENERY).as_posix()}'
        for q in (SCENERY.rglob('*.png') if SCENERY.is_dir() else [])
    )
    scenery_json = json.dumps(scenery, indent=2)
    METRICS_TS.parent.mkdir(parents=True, exist_ok=True)
    wrote = write_if_changed(
        METRICS_TS,
        f'''// GENERATED by scripts/pack_sprites.py -- do not edit by hand.
// Measured from the PNGs in public/sprites/; re-run the script after changing art.
import type {{ SpriteSheet }} from './types.ts';

export type SpriteId = {ids};

export interface SpriteMetrics extends Omit<SpriteSheet, 'scale' | 'nativePx'> {{
  /**
   * Figure height on the native grid it was drawn on, and the size of that grid.
   *
   * Their RATIO is the character's stature, and content.ts turns it into tiles
   * with one global factor rather than a hand-tuned table. The canvas travels
   * alongside because the guide changed it from 64 to 128: measured against a
   * fixed 64, the newer art would render at twice everyone else's height.
   *
   * Deliberately independent of which file supplies the PIXELS: size comes from
   * the native grid, quality from the best available render. `nativePx` is null
   * for pre-guide art with no native basis.
   */
  nativePx: number | null;
  nativeCanvas: number;
  /** A held single-frame hit reaction, when the actor ships one. */
  pain?: string;
  /**
   * Lying down, held for the rest of the battle once this unit is at 0 HP.
   *
   * Optional like `pain`: an actor without one simply leaves the stage when
   * they fall, which is what everyone did before any of these existed.
   */
  death?: string;
  /** True when the shipped sheet is native-grid art needing nearest-neighbour. */
  pixelArt: boolean;
  /**
   * Packed idle strip, when the character has one. Every frame shares one crop
   * box so only the intended parts move, and the renderer steps through it.
   */
  idle?: {{ src: string; frames: number; aspect: number; pxH: number; anchorX: number; restFill: number; footPad: number }};
}}

export const SPRITE_METRICS: Record<SpriteId, SpriteMetrics> = {{
{body}
}};

/** Every packed clip, for the dev animation lab. Battle uses `idle` above. */
export const ANIMATION_CLIPS: Record<string, Record<string, AnimationClip>> = {clips_json};

/**
 * Impact effects -- hit sparks and bursts that play ON a target rather than
 * belonging to any one actor. Authored in art/effects/, keyed by file name.
 */
export interface EffectStrip {{
  id: string;
  src: string;
  frames: number;
  /** width / height of ONE frame. */
  aspect: number;
}}

export const EFFECTS: Record<string, EffectStrip> = {effects_json};

/** Every published scenery image, for the stage lab's prop picker. */
export const SCENERY_IMAGES: string[] = {scenery_json};

export interface AnimationClip {{
  src: string;
  frames: number;
  aspect: number;
  /** The strip's own height in file pixels, for rounding to whole art pixels. */
  pxH: number;
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
    print(
        f'\nmetrics {METRICS_TS.as_posix()}  ({len(entries)} sprites)'
        + ('' if wrote else '  unchanged -- no reload')
    )


if __name__ == '__main__':
    import sys

    parse_args(sys.argv[1:])
    heights = {}
    complete = True
    for name in characters():
        if ONLY and name not in ONLY:
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
        # Charted as a SHARE of each actor's own canvas, because that is what
        # the renderer uses. Charting the raw native heights would put a 128px
        # actor at twice the bar of an equally tall 64px one.
        print('\nrelative statures, straight from the art:')
        share = {n: h / SPECS[spec_of(n)]['native'] for n, h in heights.items()}
        for n, s in sorted(share.items(), key=lambda kv: -kv[1]):
            print(f'  {n:10} {heights[n]:>3}/{SPECS[spec_of(n)]["native"]}  {"#" * round(s * 60)}')

    for name in creatures():
        if ONLY and name != ONLY:
            complete = False
            continue
        out = OUT_ROOT / name / f'{name}.png'
        if out.exists() and not is_ours(name, out):
            print(f'{name}: SKIPPED -- {out.as_posix()} was not written by this script.')
            complete = False
            continue
        h, notes = prepare_creature(name)
        print(f'{name}:')
        img = Image.open(out)
        print(f'  enemy {out.as_posix()} {img.width}x{img.height} '
              f'({out.stat().st_size // 1024} KB)  = {h} native px tall')
        for n in notes:
            print(f'  ! {n}')

    for path in publish_scenery():
        print(f'scenery {path}')

    # Only safe once every actor has been through this run -- otherwise the keep
    # set is missing whatever a skipped actor would have contributed.
    keep = {Path(p) for p in expected_outputs()}
    if complete:
        for gone in prune(OUT_ROOT, keep) + prune(OUT_SCENERY, keep):
            print(f'pruned  {gone}')
    elif ONLY:
        # A deliberately scoped run can still tidy up after ITSELF. These actors
        # just rewrote their manifests, so their share of the keep set is exact
        # -- which means renaming a clip does not leave the old strip behind in
        # public/ until the next whole-roster run.
        for name in sorted(ONLY):
            for gone in prune(OUT_ROOT / name, keep):
                print(f'pruned  {gone}')
    else:
        print('\nprune skipped -- not every actor was processed this run.')

    write_metrics()

    # The last line, and the one the dev server greps. Say it plainly either way
    # -- an animator who dropped a sheet in the wrong folder needs to be told
    # that nothing was picked up, not shown a reload that changes nothing.
    print(f'\n{WRITES} file(s) written' if WRITES else '\nno files changed')
