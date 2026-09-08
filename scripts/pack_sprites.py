"""
Prepare character art for the board.

Source images are large (Dart is 1312x1199) and drawn with a weapon extending to
one side. Two things need doing before they can be dropped on a 42px tile:

1. Trim to content and downscale, so we are not shipping a megabyte to draw a
   50px figure.

2. Find where the character actually STANDS. Centring the image would offset him,
   because an extended sword drags the content box sideways. The anchor is taken
   from the horizontal centre of the bottom band of pixels -- his feet -- which
   is the point that should sit on the middle of the tile.

Convention: source art faces RIGHT. The renderer mirrors it when moving or
attacking leftward.

Run:  python scripts/pack_sprites.py
"""

from PIL import Image, ImageDraw
from pathlib import Path

# Tall enough to stay sharp when a character is zoomed in on, small enough to ship.
BOARD_HEIGHT = 320
ICON_SIZE = 160
# Fraction of the figure's height treated as "feet" when locating the anchor.
FOOT_BAND = 0.12

CHARACTERS = {
    # Dart's raw art has been tidied away; his processed output is already in
    # public/sprites/dart. Kept here so re-running is one restored file away.
    'dart': {
        'src': 'public/spites/dart',
        'out': 'public/sprites/dart',
        'board': 'Dart.png',
        'icon': 'Dart_icon.png',
    },
    'kael': {
        'src': 'public/spites/kael',
        'out': 'public/sprites/kael',
        'board': 'kael.png',
        'icon': 'kael_icon.png',
    },
}


def key_out_background(img: Image.Image, tolerance: int = 40) -> Image.Image:
    """
    Make a flat background transparent, for art exported without alpha.

    Flood-filled from the four corners rather than keyed by colour: the character
    wears near-black armour, and a plain "delete every dark pixel" pass would
    punch holes straight through him. Filling inward from the edges only removes
    background that is actually connected to the edge.
    """
    if img.getchannel('A').getextrema()[0] < 255:
        return img  # already has real transparency

    rgb = img.convert('RGB')
    marker = (255, 0, 255)
    w, h = rgb.size
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(rgb, corner, marker, thresh=tolerance)

    mask = Image.frombytes(
        'L', rgb.size, bytes(0 if px == marker else 255 for px in rgb.get_flattened_data())
    )
    out = img.copy()
    out.putalpha(mask)
    return out


def foot_anchor(img: Image.Image) -> float:
    """Horizontal centre of the lowest band of opaque pixels, as a 0-1 fraction."""
    alpha = img.getchannel('A')
    box = alpha.getbbox()
    height = box[3] - box[1]
    band_top = box[3] - max(2, int(height * FOOT_BAND))
    band = alpha.crop((box[0], band_top, box[2], box[3])).getbbox()
    # band is relative to the crop, so shift back into image space.
    centre = box[0] + (band[0] + band[2]) / 2
    return centre / img.width


def prepare(name: str, cfg: dict) -> None:
    src, out = Path(cfg['src']), Path(cfg['out'])
    out.mkdir(parents=True, exist_ok=True)

    board = Image.open(src / cfg['board']).convert('RGBA')
    board = key_out_background(board)
    board = board.crop(board.getchannel('A').getbbox())
    ratio = BOARD_HEIGHT / board.height
    board = board.resize((round(board.width * ratio), BOARD_HEIGHT), Image.LANCZOS)
    anchor_x = foot_anchor(board)
    board_path = out / f'{name}.png'
    board.save(board_path)

    icon = key_out_background(Image.open(src / cfg['icon']).convert('RGBA'))
    icon = icon.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    icon_path = out / f'{name}_icon.png'
    icon.save(icon_path)

    print(f'{name}:')
    print(f'  board {board_path} {board.width}x{board.height}  ({board_path.stat().st_size // 1024} KB)')
    print(f'  icon  {icon_path} {ICON_SIZE}x{ICON_SIZE}  ({icon_path.stat().st_size // 1024} KB)')
    print()
    print('  paste into content.ts:')
    print('    sprite: {')
    print(f"      src: '/{board_path.as_posix().replace('public/', '')}',")
    print(f"      icon: '/{icon_path.as_posix().replace('public/', '')}',")
    print(f'      aspect: {board.width} / {board.height},')
    print(f'      anchorX: {anchor_x:.3f},')
    print('      scale: 1.35,')
    print('    },')


if __name__ == '__main__':
    for name, cfg in CHARACTERS.items():
        source = Path(cfg['src']) / cfg['board']
        if not source.exists():
            print(f'{name}: skipped, no source at {source}')
            continue
        prepare(name, cfg)
