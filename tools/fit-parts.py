"""Naladí díly z `art/parts/raw/` do `content/vanilla/parts/` (T116).

    python tools/fit-parts.py            # zpracuje všechno, co v raw/ leží
    python tools/fit-parts.py --check    # jen vypíše, co by udělal

Díly jsou tří druhů:

- **arch** (`cars_front`, `people_walk`, …): víc předmětů na jednom obrázku.
  Rozřeže se podle průhlednosti na souvislé oblasti, seřadí po řádcích
  zleva doprava a každý předmět je vlastní díl `<arch>_<pořadí>`.
- **rotor**: lopatky větrníku. Generátor je nakreslí skoro souměrně, ale
  „skoro“ by se při otáčení viditelně kývalo. Vezme se proto horní lopatka
  a dvakrát se otočí o 120°, takže rotor je souměrný přesně.
- **materiál** (`sidewalk`): čtvercová textura, jen se zmenší.

Velikost se neodhaduje z obrázku, ale **ze světa**: auto je dlouhé zhruba
třetinu dlaždice, člověk vysoký dvě třetiny patra. Obrázky se kreslí ve
čtyřnásobku (jako budovy) a zmenšují se jedním měřítkem na celý arch, takže
autobus zůstane delší než Trabant.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'parts' / 'raw'
OUT = ROOT / 'content' / 'vanilla' / 'parts'

# Stejné měřítko jako budovy (fit-sprites.py): obrázek je 4× větší než při zoomu 1.
SCALE = 4
TILE_W = 64
LEVEL_H = 16

# Cílová velikost jednoho „typického“ předmětu na archu při zoomu 1, v px.
# Měří se jen podle vybraných předmětů (`reference`), zbytek archu jde stejným
# měřítkem. U aut jsou to osobáky — autobus je pak přirozeně delší.
SHEETS = {
    # šířka osobního auta na obrazovce: ~0,3 dlaždice podél osy
    'cars_front': {'measure': 'width', 'size': 17, 'reference': [0, 1, 2, 3], 'anchor': 'car'},
    'cars_rear': {'measure': 'width', 'size': 17, 'reference': [0, 1, 2, 3], 'anchor': 'car'},
    'service_front': {'measure': 'width', 'size': 19, 'reference': [0], 'anchor': 'car'},
    'service_rear': {'measure': 'width', 'size': 19, 'reference': [0], 'anchor': 'car'},
    # člověk: 1,7 m, patro jsou 3 m a 16 px
    'people_walk': {'measure': 'height', 'size': 9, 'reference': None, 'anchor': 'feet'},
    'people_sit': {'measure': 'height', 'size': 7, 'reference': None, 'anchor': 'feet'},
    # plamen: zhruba patro a půl
    'flames': {'measure': 'height', 'size': 22, 'reference': None, 'anchor': 'feet'},
}
# Rotor: délka lopatky při zoomu 1. Skutečnou velikost na mapě určí matice
# změřená z obrázku budovy, tohle je jen rozlišení textury.
ROTOR_RADIUS = 34
LAMP_HEIGHT = 40
MATERIAL = 256


def alpha_of(image: Image.Image) -> np.ndarray:
    return np.asarray(image)[:, :, 3]


def pieces(image: Image.Image) -> list[tuple[int, int, int, int]]:
    """Obálky předmětů na archu, seřazené po řádcích zleva doprava."""
    mask = alpha_of(image) > 40
    # Zrcátka, anténa, ruka s taškou: drobnost oddělená pár pixely patří
    # k předmětu vedle, ne jako samostatný díl.
    joined = ndimage.binary_dilation(mask, iterations=6)
    labels, count = ndimage.label(joined)
    boxes = []
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    biggest = max(sizes) if count else 0
    for index, slices in enumerate(ndimage.find_objects(labels)):
        if slices is None or sizes[index] < biggest * 0.05:
            continue
        y, x = slices
        boxes.append((x.start, y.start, x.stop, y.stop))
    if not boxes:
        return []
    # Řádky: předměty, jejichž svislé středy jsou blíž než polovina výšky.
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows: list[list[tuple[int, int, int, int]]] = []
    for box in boxes:
        centre = (box[1] + box[3]) / 2
        if rows:
            last = rows[-1]
            last_centre = sum((b[1] + b[3]) / 2 for b in last) / len(last)
            height = max(b[3] - b[1] for b in last)
            if abs(centre - last_centre) < height * 0.5:
                last.append(box)
                continue
        rows.append([box])
    return [box for row in rows for box in sorted(row, key=lambda b: b[0])]


def tight(image: Image.Image) -> Image.Image:
    box = Image.fromarray((alpha_of(image) > 8).astype(np.uint8) * 255).getbbox()
    return image.crop(box) if box else image


def axis_angle(image: Image.Image) -> float | None:
    """Sklon podélné osy vozidla ve stupních (y dolů), nebo None.

    Nejníž na obrázku jsou kola na bližším boku; přímka přes jejich dotyky je
    podélná osa auta. Bere se spodní konvexní obálka siluety a z ní nejdelší
    hrana — to je úsečka mezi předním a zadním kolem.

    Generátor kreslí auta pod úhlem kolem 20°, kdežto izometrická osa ve hře
    má 26,6°. Rozdíl se ve hře dorovná zkosením (`skew` v indexu), jinak auto
    jede po silnici bokem. Autor to hlásil na pěti snímcích.
    """
    alpha = alpha_of(image) > 60
    cols = np.where(alpha.any(axis=0))[0]
    if cols.size < 8:
        return None
    points = [(float(x), float(np.where(alpha[:, x])[0][-1])) for x in cols]
    # Spodní obálka (y dolů → hledá se „horní“ obálka v y).
    hull: list[tuple[float, float]] = []
    for point in points:
        while len(hull) >= 2:
            (x1, y1), (x2, y2) = hull[-2], hull[-1]
            if (x2 - x1) * (point[1] - y1) - (y2 - y1) * (point[0] - x1) <= 0:
                hull.pop()
            else:
                break
        hull.append(point)
    edges = [(b[0] - a[0], b[1] - a[1]) for a, b in zip(hull, hull[1:])]
    if not edges:
        return None
    dx, dy = max(edges, key=lambda e: e[0])
    return float(np.degrees(np.arctan2(dy, dx)))


def edge_angle(crop: Image.Image, low: float, high: float) -> float | None:
    """Převládající směr rovných hran v rozsahu úhlů (stupně, y dolů).

    Houghova transformace nad hranami: bok auta nesou práh, lišta a okna,
    čelo nárazník, maska a spodní hrana skla. Váží se délkou úsečky.
    Ověřeno proti ručnímu odečtu přes body dotyku kol (Škoda 105: bok 29°
    proti 28,7°, čelo −14° proti −14,5°).
    """
    import cv2
    from scipy.ndimage import gaussian_filter1d

    rgba = np.asarray(crop)
    gray = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY)
    gray = (gray * (rgba[:, :, 3] / 255.0)).astype(np.uint8)
    edges = cv2.Canny(gray, 60, 160)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 360, threshold=40,
                            minLineLength=max(30, crop.width // 8), maxLineGap=4)
    if lines is None:
        return None
    hist = np.zeros(181)
    for x1, y1, x2, y2 in lines[:, 0]:
        if x2 == x1:
            continue
        a = (np.degrees(np.arctan2(y2 - y1, x2 - x1)) + 90) % 180 - 90
        if low < a < high:
            hist[int(round(a)) + 90] += np.hypot(x2 - x1, y2 - y1)
    if hist.sum() == 0:
        return None
    return float(np.argmax(gaussian_filter1d(hist, 1.2)) - 90)


ISO = float(np.degrees(np.arctan(0.5)))


def align_vehicle(crop: Image.Image, front: bool, label: str) -> Image.Image:
    """Srovná vozidlo do izometrie hry (T125).

    Generátor kreslí auta z pootočené kamery: bok leží zhruba správně
    (22–34°), ale čelo a záď jsou ploché (11–17° místo 26,6°). Zkosení
    z T124 srovnalo jen bok, čelo zůstalo — autor hlásil auta špatně
    o 20–30°. Tady se změří **oba** směry a obrázek se převede afinní
    maticí, která drží svislice svislé:

        x' = x,   y' = b·x + c·y

    `b` a `c` jsou jednoznačně dané tím, že se bok i čelo mají trefit na
    ±26,6°. Vzhled auta zůstane, jen se natočí jako zbytek města.
    """
    if front:
        side, face = edge_angle(crop, 8, 45), edge_angle(crop, -45, -3)
        target_side, target_face = ISO, -ISO
    else:
        side, face = edge_angle(crop, -45, -3), edge_angle(crop, 3, 60)
        target_side, target_face = -ISO, ISO
    if side is None or face is None:
        print(f'    {label}: úhly nejdou změřit, beru obrázek jak je')
        return crop
    t1, t2 = np.tan(np.radians(side)), np.tan(np.radians(face))
    g1, g2 = np.tan(np.radians(target_side)), np.tan(np.radians(target_face))
    c = (g1 - g2) / (t1 - t2)
    b = g1 - c * t1
    # Výřez se roztáhne tak, aby se výsledek vešel: y' = b·x + c·y.
    w, h = crop.size
    ys = [b * x + c * y for x in (0, w) for y in (0, h)]
    top = min(ys)
    height = int(np.ceil(max(ys) - top)) + 2
    # PIL chce inverzní zobrazení: z výstupu (x', y') do vstupu (x, y).
    inverse = (1, 0, 0, -b / c, 1 / c, top / c)
    out = crop.transform((w, height), Image.AFFINE, inverse, resample=Image.BICUBIC)
    print(f'    {label}: bok {side:+.0f}° čelo {face:+.0f}° → b {b:+.3f} c {c:.3f}')
    return tight(out)


def anchor_for(image: Image.Image, kind: str) -> tuple[int, int]:
    width, height = image.size
    if kind == 'car':
        # Střed podvozku: uprostřed šířky, kousek nad spodkem kol. Auto stojí na
        # dvou osách v izometrii, takže „dotek se zemí“ není spodní řádek, ale
        # zhruba čtvrtina výšky nad ním.
        return round(width / 2), round(height * 0.74)
    # Nohy, pata plamene, pata sloupu: dole, vodorovně tam, kde je spodní
    # desetina obrázku nejhustší.
    alpha = alpha_of(image)
    bottom = alpha[int(height * 0.9):, :] > 40
    cols = np.where(bottom.any(axis=0))[0]
    x = int(round(cols.mean())) if cols.size else width // 2
    return x, height


def fit_sheet(name: str, spec: dict, write: bool, index: dict) -> None:
    image = Image.open(RAW / f'{name}.png').convert('RGBA')
    boxes = pieces(image)
    crops = [tight(image.crop(box)) for box in boxes]
    if spec['anchor'] == 'car':
        crops = [align_vehicle(crop, name.endswith('_front'), f'{name}_{i}') for i, crop in enumerate(crops)]
    reference = spec['reference'] or list(range(len(crops)))
    measured = [
        (crop.size[0] if spec['measure'] == 'width' else crop.size[1])
        for i, crop in enumerate(crops) if i in reference
    ]
    factor = spec['size'] * SCALE / (sum(measured) / len(measured))
    print(f'  {name}: {len(crops)} kusů, měřítko {factor:.3f}')
    for order, crop in enumerate(crops):
        size = (max(1, round(crop.size[0] * factor)), max(1, round(crop.size[1] * factor)))
        small = crop.resize(size, Image.LANCZOS)
        anchor = anchor_for(small, spec['anchor'])
        part = f'{name}_{order}'
        index[part] = {'file': f'{part}.png', 'width': size[0], 'height': size[1], 'anchor': list(anchor)}
        print(f'    {part}: {size[0]}×{size[1]} kotva {anchor}')
        if write:
            small.save(OUT / f'{part}.png', optimize=True)


def fit_rotor(write: bool, index: dict) -> None:
    image = Image.open(RAW / 'rotor.png').convert('RGBA')
    rgba = np.asarray(image).astype(int)
    red = (rgba[..., 3] > 128) & (rgba[..., 0] > 150) & (rgba[..., 1] < 110) & (rgba[..., 0] - rgba[..., 1] > 80)
    labels, count = ndimage.label(red)
    sizes = ndimage.sum(red, labels, range(1, count + 1))
    order = np.argsort(sizes)[::-1][:3]
    tips = [ndimage.center_of_mass(red, labels, i + 1) for i in order]
    tips = [(float(x), float(y)) for y, x in tips]
    # Náboj je těžiště špiček: u souměrného rotoru se tři vektory sečtou na nulu.
    hub = (sum(t[0] for t in tips) / 3, sum(t[1] for t in tips) / 3)
    top = min(tips, key=lambda t: t[1])
    radius = float(np.hypot(top[0] - hub[0], top[1] - hub[1]))

    # Horní lopatka: výseč ±60° kolem svislice nad nábojem.
    height, width = rgba.shape[:2]
    yy, xx = np.mgrid[0:height, 0:width]
    angle = np.degrees(np.arctan2(xx - hub[0], hub[1] - yy))
    blade = np.asarray(image).copy()
    blade[np.abs(angle) > 60, 3] = 0
    blade_image = Image.fromarray(blade, 'RGBA')

    side = int(np.ceil(radius * 1.12)) * 2
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    centred = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    centred.alpha_composite(blade_image, (round(side / 2 - hub[0]), round(side / 2 - hub[1])))
    for turn in (0, 120, 240):
        canvas.alpha_composite(centred.rotate(-turn, resample=Image.BICUBIC, center=(side / 2, side / 2)))

    target = ROTOR_RADIUS * SCALE
    factor = target / radius
    size = max(2, round(side * factor))
    small = canvas.resize((size, size), Image.LANCZOS)
    index['rotor'] = {
        'file': 'rotor.png', 'width': size, 'height': size,
        'anchor': [size / 2, size / 2], 'radius': round(target, 2),
    }
    print(f'  rotor: náboj {hub[0]:.0f},{hub[1]:.0f}, lopatka {radius:.0f} px → {size}×{size}')
    if write:
        small.save(OUT / 'rotor.png', optimize=True)


def fit_lamp(write: bool, index: dict) -> None:
    image = tight(Image.open(RAW / 'street_lamp.png').convert('RGBA'))
    factor = LAMP_HEIGHT * SCALE / image.size[1]
    size = (max(1, round(image.size[0] * factor)), LAMP_HEIGHT * SCALE)
    small = image.resize(size, Image.LANCZOS)
    anchor = anchor_for(small, 'feet')
    index['street_lamp'] = {'file': 'street_lamp.png', 'width': size[0], 'height': size[1], 'anchor': list(anchor)}
    print(f'  street_lamp: {size[0]}×{size[1]} kotva {anchor}')
    if write:
        small.save(OUT / 'street_lamp.png', optimize=True)


def fit_material(name: str, write: bool, index: dict) -> None:
    image = Image.open(RAW / f'{name}.png').convert('RGBA').resize((MATERIAL, MATERIAL), Image.LANCZOS)
    index[name] = {'file': f'{name}.png', 'width': MATERIAL, 'height': MATERIAL, 'anchor': [0, 0]}
    print(f'  {name}: materiál {MATERIAL}×{MATERIAL}')
    if write:
        image.save(OUT / f'{name}.png', optimize=True)


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    write = '--check' not in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    index_path = OUT / 'index.json'
    index: dict = {}
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding='utf-8')).get('parts', {})

    have = {p.stem for p in RAW.glob('*.png')}
    for name, spec in SHEETS.items():
        if name in have:
            # Arch se přeřezává celý: počet kusů se mohl změnit.
            for key in [k for k in index if k.startswith(f'{name}_')]:
                del index[key]
            fit_sheet(name, spec, write, index)
    if 'rotor' in have:
        fit_rotor(write, index)
    if 'street_lamp' in have:
        fit_lamp(write, index)
    if 'sidewalk' in have:
        fit_material('sidewalk', write, index)

    if write:
        index_path.write_text(
            json.dumps({'formatVersion': 1, 'scale': SCALE, 'parts': dict(sorted(index.items()))}, indent=2) + '\n',
            encoding='utf-8',
        )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
