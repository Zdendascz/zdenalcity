"""Šablony pro auta: šedé kvádry přesně v izometrii hry (T125).

    python tools/make-vehicle-templates.py

Autor hlásil auta „pod špatným úhlem o 20–30°". Generátor kreslí auta pod
vlastním úhlem a zkosením se to spravit nedá: zkosení položí bok do osy,
ale čelo a záď zůstanou natočené jinak a auto vypadá zkroucené.

Proto se auta **generují ze šablony**: kvádry s rozměry auta, náklaďáku
a autobusu, promítnuté přesně tak, jak hra promítá mřížku (osa 26,6°).
Čelo nese žlutá světla, záď červená, aby generátor věděl, kam auto jede.
`generate-parts.py` pak kvádry „obleče" (`images/edits`) a poloha i úhel
zůstanou šablony.

Výstup: `art/parts/templates/<arch>.png`, plátno 1536 × 1024.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'art' / 'parts' / 'templates'

# Izometrie hry: krok v ose x jde doprava dolů, v ose y doleva dolů, obojí
# pod atan(1/2) = 26,565°. Metr = SCALE px podél osy, svisle 1,1× víc
# (skutečná dimetrie 2:1 má svislici o desetinu delší než vodorovnou hranu).
ANGLE = math.atan(0.5)
SCALE = 40.0
AX = (math.cos(ANGLE) * SCALE, math.sin(ANGLE) * SCALE)
AY = (-math.cos(ANGLE) * SCALE, math.sin(ANGLE) * SCALE)
AZ = (0.0, -1.1 * SCALE)

# Délka, šířka, výška v metrech.
CAR = (4.3, 1.7, 1.4)
LORRY = (6.0, 2.2, 2.6)
BUS = (10.5, 2.5, 3.0)
SHEETS = {
    'cars': [CAR, CAR, CAR, CAR, LORRY, BUS],
    'service': [CAR, (6.8, 2.4, 2.9), (4.8, 1.9, 2.1), (7.0, 2.4, 2.9)],
}


def point(origin, x, y, z):
    return (
        origin[0] + AX[0] * x + AY[0] * y + AZ[0] * z,
        origin[1] + AX[1] * x + AY[1] * y + AZ[1] * z,
    )


def box(draw: ImageDraw.ImageDraw, origin, size, heading: str) -> None:
    """Kvádr s rohem v `origin`. `east`: délka podél x, jinak podél y (sever)."""
    length, width, height = size
    sx, sy = (length, width) if heading == 'east' else (width, length)
    p = lambda x, y, z: point(origin, x, y, z)
    top = [p(0, 0, height), p(sx, 0, height), p(sx, sy, height), p(0, sy, height)]
    face_x = [p(sx, 0, 0), p(sx, sy, 0), p(sx, sy, height), p(sx, 0, height)]
    face_y = [p(0, sy, 0), p(sx, sy, 0), p(sx, sy, height), p(0, sy, height)]
    draw.polygon(top, fill=(205, 205, 205, 255), outline=(90, 90, 90, 255))
    draw.polygon(face_x, fill=(150, 150, 150, 255), outline=(90, 90, 90, 255))
    draw.polygon(face_y, fill=(175, 175, 175, 255), outline=(90, 90, 90, 255))

    # Světla: na viditelném čele (`east`: stěna +x) žlutá, na zádi
    # (`north`: stěna +y) červená.
    lamp_h = height * 0.35
    if heading == 'east':
        for t in (0.2, 0.8):
            c = p(sx, sy * t, lamp_h)
            draw.ellipse((c[0] - 7, c[1] - 5, c[0] + 7, c[1] + 5), fill=(255, 220, 40, 255))
    else:
        for t in (0.2, 0.8):
            c = p(sx * t, sy, lamp_h)
            draw.ellipse((c[0] - 7, c[1] - 5, c[0] + 7, c[1] + 5), fill=(220, 30, 30, 255))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for sheet, sizes in SHEETS.items():
        for heading, suffix in (('east', 'front'), ('north', 'rear')):
            image = Image.new('RGBA', (1536, 1024), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            per_row = 3 if len(sizes) > 4 else 2
            for i, size in enumerate(sizes):
                row, col = divmod(i, per_row)
                cell_w = 1536 / per_row
                # Obálka kvádru s rohem v počátku, pak posun do středu buňky.
                length, width, height = size
                sx, sy = (length, width) if heading == 'east' else (width, length)
                corners = [point((0, 0), x, y, z) for x in (0, sx) for y in (0, sy) for z in (0, height)]
                xs = [c[0] for c in corners]
                ys = [c[1] for c in corners]
                ox = cell_w * col + cell_w / 2 - (min(xs) + max(xs)) / 2
                oy = 512 * row + 256 - (min(ys) + max(ys)) / 2
                box(draw, (ox, oy), size, heading)
            image.save(OUT / f'{sheet}_{suffix}.png')
            print(f'  {sheet}_{suffix}.png')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
