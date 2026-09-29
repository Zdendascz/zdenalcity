"""Vozidla jako 3D modely promítnuté přesně izometrií hry (T125).

    python tools/make-vehicles.py

Autor hlásil auta „pod špatným úhlem o 20–30°" a měl pravdu: generátor
obrázků drží izometrický úhel jen přibližně (změřeno 15–31° místo 26,6°),
a to ani se šablonou, ani s přísným zadáním. Zkosení to nespraví — bok jde
do osy, čelo ne, a auto vypadá zkroucené.

Tady se proto auto **postaví** z kvádrů a lichoběžníků (podvozek, kabina,
okna, kola, světla) a promítne se **stejnou maticí jako mřížka hry**. Úhel pak
sedí přesně, ve všech čtyřech směrech. Jde o pár pixelů na mapě; čistý tvar
ve správném úhlu čte oko líp než fotka natočená jinam.

Výstup: `content/vanilla/parts/{cars,service}_{front,rear}_<i>.png` a záznamy
v `parts/index.json` (bez `skew`). Pak `python tools/make-webp.py`.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content' / 'vanilla' / 'parts'

# Projekce hry: +x doprava dolů, +y doleva dolů, obojí pod atan(1/2).
A = math.atan(0.5)
# px na metr při zoomu 1. Dlaždice (35,8 px hrana) je tak ~11 m.
PX_PER_M = 3.2
# Díly jsou ve čtyřnásobku a kreslí se ještě 4× větší kvůli vyhlazení.
PART_SCALE = 4
SUPER = 4
S = PX_PER_M * PART_SCALE * SUPER
# Svislé měřítko: hra má výšky vůči půdorysu zvednuté (patro 16 px), auta
# o kus méně, ať nejsou krabice.
Z = 1.15 * S

# Směr ke kameře a ke světlu (světlo zleva, jako u budov).
VIEW = (1.0, 1.0, 1.1)
LIGHT = (-0.35, 0.75, 0.9)


def norm(v):
    length = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / length for c in v)


LIGHT_N = norm(LIGHT)


def project(p):
    x, y, z = p
    return ((x - y) * math.cos(A) * S, (x + y) * math.sin(A) * S - z * Z)


def shade(color, normal):
    d = max(0.0, sum(a * b for a, b in zip(normal, LIGHT_N)))
    k = 0.55 + 0.5 * d
    return tuple(min(255, int(c * k)) for c in color) + (255,)


class Model:
    """Seznam ploch ve světových souřadnicích modelu (f dopředu, s doleva, z nahoru)."""

    def __init__(self) -> None:
        self.faces: list[tuple[list[tuple[float, float, float]], tuple[int, int, int], tuple[float, float, float] | None]] = []

    def quad(self, points, color, normal=None):
        self.faces.append((points, color, normal))

    def box(self, f0, f1, s0, s1, z0, z1, color, top=None, sides=None, front=None, back=None):
        c = color
        self.quad([(f0, s0, z1), (f1, s0, z1), (f1, s1, z1), (f0, s1, z1)], top or c, (0, 0, 1))
        self.quad([(f1, s0, z0), (f1, s1, z0), (f1, s1, z1), (f1, s0, z1)], front or c, (1, 0, 0))
        self.quad([(f0, s0, z0), (f0, s1, z0), (f0, s1, z1), (f0, s0, z1)], back or c, (-1, 0, 0))
        self.quad([(f0, s1, z0), (f1, s1, z0), (f1, s1, z1), (f0, s1, z1)], sides or c, (0, 1, 0))
        self.quad([(f0, s0, z0), (f1, s0, z0), (f1, s0, z1), (f0, s0, z1)], sides or c, (0, -1, 0))

    def cabin(self, f0, f1, t0, t1, w_bottom, w_top, z0, z1, glass, roof):
        """Kabina jako komolý hranol: spodek f0–f1, střecha t0–t1, zúžená."""
        b, t = w_bottom / 2, w_top / 2
        base = [(f0, -b, z0), (f1, -b, z0), (f1, b, z0), (f0, b, z0)]
        top = [(t0, -t, z1), (t1, -t, z1), (t1, t, z1), (t0, t, z1)]
        self.quad(top, roof, (0, 0, 1))
        for i in range(4):
            j = (i + 1) % 4
            self.quad([base[i], base[j], top[j], top[i]], glass, None)

    def wheel(self, f, s, radius, width=0.22):
        """Kolo: osmiúhelník v rovině f–z na boku s."""
        pts = []
        for k in range(10):
            a = 2 * math.pi * k / 10
            pts.append((f + math.cos(a) * radius, s, radius + math.sin(a) * radius))
        side = 1 if s > 0 else -1
        self.quad(pts, (28, 28, 30), (0, side, 0))
        hub = [(f + math.cos(2 * math.pi * k / 8) * radius * 0.45, s + side * 0.01,
                radius + math.sin(2 * math.pi * k / 8) * radius * 0.45) for k in range(8)]
        self.quad(hub, (150, 150, 155), (0, side, 0))


def lamp(model, f, s, z, color, size=0.13):
    model.quad([(f, s - size, z - size * 0.6), (f, s + size, z - size * 0.6),
                (f, s + size, z + size * 0.6), (f, s - size, z + size * 0.6)], color, (1 if f > 0 else -1, 0, 0))


def saloon(color, length=4.2, width=1.6, trabant=False, stripe=None, beacon=None):
    m = Model()
    h0, h1 = 0.28, 0.78
    L, W = length, width
    m.box(0, L, -W / 2, W / 2, h0, h1, color)
    m.box(-0.05, 0.05, -W / 2, W / 2, h0, h0 + 0.2, (60, 60, 64))
    m.box(L - 0.05, L + 0.05, -W / 2, W / 2, h0, h0 + 0.2, (60, 60, 64))
    glass = (70, 90, 110)
    top = 1.28 if not trabant else 1.32
    m.cabin(L * 0.26, L * 0.72, L * 0.33, L * 0.62, W * 0.92, W * 0.78, h1, top, glass, color)
    for s in (-W / 2 - 0.01, W / 2 + 0.01):
        m.wheel(L * 0.2, s, 0.3)
        m.wheel(L * 0.8, s, 0.3)
    for s in (-W * 0.33, W * 0.33):
        lamp(m, L + 0.06, s, 0.6, (255, 240, 170))
        lamp(m, -0.06, s, 0.6, (200, 30, 30))
    if stripe:
        for s in (-W / 2 - 0.012, W / 2 + 0.012):
            m.quad([(0.05, s, 0.5), (L - 0.05, s, 0.5), (L - 0.05, s, 0.62), (0.05, s, 0.62)], stripe, (0, 1 if s > 0 else -1, 0))
    if beacon:
        m.box(L * 0.42, L * 0.54, -W * 0.3, W * 0.3, top, top + 0.14, beacon)
    return m, L


def van(color, length, width, height, stripe=None, beacon=None, cab_color=None):
    m = Model()
    L, W = length, width
    m.box(0, L, -W / 2, W / 2, 0.3, height, color, front=cab_color or color)
    glass = (70, 90, 110)
    # Okna po boku a čelní sklo.
    for s in (-W / 2 - 0.01, W / 2 + 0.01):
        m.quad([(L * 0.08, s, height * 0.62), (L * 0.92, s, height * 0.62),
                (L * 0.92, s, height * 0.88), (L * 0.08, s, height * 0.88)], glass, (0, 1 if s > 0 else -1, 0))
        if stripe:
            m.quad([(0.02, s, height * 0.42), (L - 0.02, s, height * 0.42),
                    (L - 0.02, s, height * 0.5), (0.02, s, height * 0.5)], stripe, (0, 1 if s > 0 else -1, 0))
        m.wheel(L * 0.18, s, 0.38)
        m.wheel(L * 0.82, s, 0.38)
    m.quad([(L + 0.01, -W * 0.44, height * 0.58), (L + 0.01, W * 0.44, height * 0.58),
            (L + 0.01, W * 0.44, height * 0.9), (L + 0.01, -W * 0.44, height * 0.9)], glass, (1, 0, 0))
    for s in (-W * 0.35, W * 0.35):
        lamp(m, L + 0.02, s, 0.62, (255, 240, 170))
        lamp(m, -0.02, s, 0.62, (200, 30, 30))
    if beacon:
        m.box(L * 0.55, L * 0.7, -W * 0.3, W * 0.3, height, height + 0.18, beacon)
    return m, L


def lorry(cab, body, length, width, height, cab_len=1.7, body_h=None, ladder=False):
    m = Model()
    L, W = length, width
    m.box(0, L - cab_len - 0.1, -W / 2, W / 2, 0.5, body_h or height, body)
    m.box(L - cab_len, L, -W / 2, W / 2, 0.4, height * 0.85, cab)
    glass = (70, 90, 110)
    m.quad([(L + 0.01, -W * 0.42, height * 0.55), (L + 0.01, W * 0.42, height * 0.55),
            (L + 0.01, W * 0.42, height * 0.8), (L + 0.01, -W * 0.42, height * 0.8)], glass, (1, 0, 0))
    for s in (-W / 2 - 0.01, W / 2 + 0.01):
        m.quad([(L - cab_len * 0.8, s, height * 0.55), (L - 0.15, s, height * 0.55),
                (L - 0.15, s, height * 0.8), (L - cab_len * 0.8, s, height * 0.8)], glass, (0, 1 if s > 0 else -1, 0))
        m.wheel(L * 0.15, s, 0.45)
        m.wheel(L * 0.42, s, 0.45)
        m.wheel(L - cab_len * 0.55, s, 0.45)
    if ladder:
        m.box(L * 0.1, L * 0.85, -0.25, 0.25, body_h or height, (body_h or height) + 0.15, (170, 170, 175))
    for s in (-W * 0.36, W * 0.36):
        lamp(m, L + 0.02, s, 0.7, (255, 240, 170))
        lamp(m, -0.02, s, 0.7, (200, 30, 30))
    return m, L


def render(model: Model, length: float, heading: str) -> tuple[Image.Image, tuple[int, int]]:
    """Promítne model. `east`: dopředu = +x; `north`: dopředu = −y."""
    def world(p):
        f, s, z = p
        f -= length / 2
        return (f, s, z) if heading == 'east' else (s, -f, z)

    def world_n(n):
        if n is None:
            return None
        f, s, z = n
        return (f, s, z) if heading == 'east' else (s, -f, z)

    faces = []
    for points, color, normal in model.faces:
        pts = [world(p) for p in points]
        n = world_n(normal)
        if n is None:
            # Normála z bodů, otočená ven od středu modelu (podélná osa).
            a, b, c = pts[0], pts[1], pts[2]
            u = [b[i] - a[i] for i in range(3)]
            v = [c[i] - a[i] for i in range(3)]
            n = norm((u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]))
            centre = [sum(p[i] for p in pts) / len(pts) for i in range(3)]
            outward = (centre[0], centre[1], centre[2] - 0.8)
            if sum(n[i] * outward[i] for i in range(3)) < 0:
                n = tuple(-c for c in n)
        if sum(n[i] * VIEW[i] for i in range(3)) <= 0:
            continue
        depth = sum(p[0] + p[1] for p in pts) / len(pts) + sum(p[2] for p in pts) / len(pts) * 0.3
        faces.append((depth, pts, shade(color, n)))
    faces.sort(key=lambda f: f[0])

    projected = [[project(p) for p in pts] for _, pts, _ in faces]
    xs = [x for poly in projected for x, _ in poly]
    ys = [y for poly in projected for _, y in poly]
    pad = 4 * SUPER
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = int(max(xs) - x0 + pad), int(max(ys) - y0 + pad)
    image = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for (_, _, color), poly in zip(faces, projected):
        draw.polygon([(x - x0, y - y0) for x, y in poly], fill=color)
    anchor = project((0, 0, 0))
    small = image.resize((max(1, w // SUPER), max(1, h // SUPER)), Image.LANCZOS)
    return small, (round((anchor[0] - x0) / SUPER), round((anchor[1] - y0) / SUPER))


def main() -> int:
    if hasattr(__import__('sys').stdout, 'reconfigure'):
        __import__('sys').stdout.reconfigure(encoding='utf-8', errors='replace')
    fleets = {
        'cars': [
            saloon((200, 40, 35)),                        # Škoda 105
            saloon((235, 235, 230)),                      # Škoda 120
            saloon((140, 190, 225), 3.55, 1.5, True),     # Trabant
            saloon((225, 205, 160), 4.1, 1.6),            # Lada 1200
            # Velká vozidla o čtvrtinu zkrácená: v plné délce byl autobus přes
            # celou dlaždici a zakrýval křižovatky.
            lorry((235, 110, 25), (150, 140, 95), 5.0, 2.0, 2.3, cab_len=1.5),  # Avia
            van((235, 225, 195), 8.0, 2.3, 2.6, stripe=(200, 40, 35)),         # Karosa
        ],
        'service': [
            saloon((240, 240, 235), stripe=(235, 200, 40), beacon=(40, 90, 230)),                 # policie
            lorry((205, 30, 30), (205, 30, 30), 5.8, 2.2, 2.5, cab_len=1.7, ladder=True),        # hasiči
            van((245, 245, 245), 4.6, 1.8, 2.0, stripe=(210, 30, 30), beacon=(40, 90, 230)),     # sanitka
            lorry((200, 200, 195), (90, 110, 70), 5.8, 2.2, 2.6, cab_len=1.6),                    # popeláři
        ],
    }
    index_path = OUT / 'index.json'
    index = json.loads(index_path.read_text(encoding='utf-8'))
    for sheet, models in fleets.items():
        for i, (model, length) in enumerate(models):
            for heading, suffix in (('east', 'front'), ('north', 'rear')):
                image, anchor = render(model, length, heading)
                name = f'{sheet}_{suffix}_{i}'
                image.save(OUT / f'{name}.png', optimize=True)
                index['parts'][name] = {
                    'file': f'{name}.png', 'width': image.width, 'height': image.height, 'anchor': list(anchor),
                }
                print(f'  {name}: {image.width}×{image.height} kotva {anchor}')
    index['parts'] = dict(sorted(index['parts'].items()))
    index_path.write_text(json.dumps(index, indent=2) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
