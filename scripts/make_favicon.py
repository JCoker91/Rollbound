"""
Generate the site icon: a gold d6 showing the five face.

Five pips is not decoration -- the game rolls 5d6 into a shared pool every turn,
so the icon states the core mechanic.

Two deliberate inversions from the in-game die:

1. The dice in the battle tray are DARK with light pips (`.die` in styles.css).
   A dark icon disappears against a dark browser tab, so the favicon is gold with
   dark pips instead. The gold matches the gold currency coin in hub.css.

2. Pip radius is 0.085 of the icon, not the 0.095 that looks best when large.
   Rendered at a real 16px tab size, 0.095 merged the corner pips into an X and
   the six face turned to mush; 0.085 keeps five countable pips. The icon is
   designed at the size it is actually seen.

Emits the standard robust set -- SVG for modern browsers, ICO as the universal
fallback, PNG for iOS home screens -- all from the constants below, so the vector
and the raster cannot drift apart.

Run:  python scripts/make_favicon.py
"""

from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path('public')

GOLD_HI, GOLD_LO = (255, 226, 138), (201, 150, 42)  # matches .coin.gold in hub.css
RIM = (138, 100, 32)
PIP = (18, 21, 28)  # --bg, so the pips read as holes punched through to the page
SPECULAR = (255, 245, 205)

PAD = 0.045       # margin outside the die body, as a fraction of the canvas
CORNER = 0.20     # corner radius, matching the 10px-on-58px in-game die
PIP_R = 0.085
FACE_5 = [(.28, .28), (.72, .28), (.5, .5), (.28, .72), (.72, .72)]

ICO_SIZES = [16, 32, 48]
APPLE_SIZE = 180
SS = 16  # supersample factor before the final downscale


def pip_centres() -> list[tuple[float, float]]:
    """Pip centres as fractions of the canvas, inset so none clips the rim."""
    inner = PAD + PIP_R * 0.9
    span = 1 - 2 * inner
    return [(inner + fx * span, inner + fy * span) for fx, fy in FACE_5]


def render(size: int) -> Image.Image:
    n = size * SS

    grad = Image.new('RGB', (n, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        t = y / max(1, n - 1)
        gd.line([(0, y), (n, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(GOLD_HI, GOLD_LO)))

    # Off-centre specular, same 35%/30% placement as the gold coin's radial.
    hl = Image.new('L', (n, n), 0)
    ImageDraw.Draw(hl).ellipse([-.15 * n, -.25 * n, .75 * n, .65 * n], fill=90)
    grad = Image.composite(Image.new('RGB', (n, n), SPECULAR), grad, hl)

    pad, radius = round(n * PAD), round(n * CORNER)
    box = [pad, pad, n - pad - 1, n - pad - 1]

    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(out)
    # The rim is what stops the icon dissolving into a light tab bar.
    d.rounded_rectangle(box, radius=radius, outline=RIM, width=max(1, round(n * 0.035)))

    r = PIP_R * n
    for fx, fy in pip_centres():
        cx, cy = fx * n, fy * n
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PIP)

    return out.resize((size, size), Image.LANCZOS)


def hexc(rgb: tuple[int, int, int]) -> str:
    return '#%02x%02x%02x' % rgb


def write_svg(path: Path) -> None:
    """Same geometry as the raster, on a 100-unit canvas."""
    pad, side, radius = PAD * 100, (1 - 2 * PAD) * 100, CORNER * 100
    stroke = 3.5
    body = (
        f'<rect x="{pad:.2f}" y="{pad:.2f}" width="{side:.2f}" height="{side:.2f}" '
        f'rx="{radius:.2f}"'
    )
    pips = '\n    '.join(
        f'<circle cx="{fx * 100:.2f}" cy="{fy * 100:.2f}" r="{PIP_R * 100:.2f}"/>'
        for fx, fy in pip_centres()
    )
    path.write_text(
        f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Stagebound</title>
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{hexc(GOLD_HI)}"/>
      <stop offset="1" stop-color="{hexc(GOLD_LO)}"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.3" cy="0.2" r="0.78">
      <stop offset="0" stop-color="{hexc(SPECULAR)}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="{hexc(SPECULAR)}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  {body} fill="url(#gold)" stroke="{hexc(RIM)}" stroke-width="{stroke}"/>
  {body} fill="url(#sheen)"/>
  <g fill="{hexc(PIP)}">
    {pips}
  </g>
</svg>
''',
        encoding='utf-8',
    )


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)

    ico = OUT / 'favicon.ico'
    frames = [render(s) for s in ICO_SIZES]
    frames[-1].save(ico, format='ICO', sizes=[(s, s) for s in ICO_SIZES])

    apple = OUT / 'apple-touch-icon.png'
    render(APPLE_SIZE).save(apple)

    svg = OUT / 'favicon.svg'
    write_svg(svg)

    for p in (svg, ico, apple):
        print(f'  {p.as_posix():34} {p.stat().st_size // 1024:>3} KB')
