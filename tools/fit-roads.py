"""Doladi dlazdice vozovky a **zmeri, jestli na sebe navazuji**.

    python tools/fit-roads.py

Ctyri kroky:

1. **Orez na kosoctverec.** Rohy se hledaji z obalky kryti jako u povrchu.
2. **Maska presneho kosoctverce.** Tvar delame my, ne generator: co je mimo,
   zmizi. Diky tomu dlazdice sedne na sousedy bez mezery i bez presahu.
3. **Zmenseni na 512 x 256.** Sprite se kresli primo v izometrii, takze se
   kosoctverec nenarovnava na ctverec jako u povrchu -- zustava 2 : 1.
4. **Mereni spoje.** U kazde hrany se najde, kde ji protina vozovka: stred
   a sirka v podilu hrany. Co se lisi od mediánu rodiny, se ohlasi.

Vystup jde do `content/vanilla/roads/`.
"""

import os
import sys
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'art', 'roads', 'raw')
OUT = os.path.join(ROOT, 'content', 'vanilla', 'roads')

# Cilova velikost dlazdice. Ctyrnasobek herni (128 x 64), aby snesla priblizeni.
WIDTH = 512
HEIGHT = 256

# Pod timhle krytim se pixel bere jako pozadi.
ALPHA_FLOOR = 8

# Jak hluboko od hrany se meri. Uplne na hrane je antialiasing.
PROBE = 6

# Zelen, pod kterou je pixel jiste vozovka, a nad kterou jiste trava.
#
# **Zmereno, ne odhadnuto.** V krizovatce ma asfalt zelen od -20 do -5, trava
# od 15 vys; mezi tim lezi obrubnik kolem nuly. Prah 0 az 9 je proto rozdeli
# a obrubnik nechá cely. Prvni odhad 4 az 16 nechal polovinu travy
# polopruhlednou a vypadalo to jako plisen.
GRASS_LOW = 0
GRASS_HIGH = 9

# Jak daleko se kouka do okoli. Sest pixelu z 512 je asi metr skutecne zeme.
GRASS_BLUR = 6

# Vetsi odchylka od medianu rodiny uz je vada, kterou je videt jako schod.
TOLERANCE = 0.08

# Ktere hrany ma dlazdice mit obsazene. Poradi: N, E, S, W.
EDGES = ('n', 'e', 's', 'w')


def diamond_corners(image):
    """Vrcholy kosoctverce z obalky kryti: nahore, vpravo, dole, vlevo."""
    alpha = np.asarray(image)[:, :, 3]
    rows = np.where(alpha.max(axis=1) > ALPHA_FLOOR)[0]
    cols = np.where(alpha.max(axis=0) > ALPHA_FLOOR)[0]
    if rows.size == 0 or cols.size == 0:
        return None
    y0, y1 = float(rows[0]), float(rows[-1])
    x0, x1 = float(cols[0]), float(cols[-1])
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    return ((mx, y0), (x1, my), (mx, y1), (x0, my))


def to_tile(image, corners):
    """Kosoctverec na dlazdici 512 x 256 s presnou maskou.

    Nenarovnava se na ctverec: sprite se kresli rovnou v izometrii, takze
    kosoctverec musi zustat kosoctvercem.
    """
    top, right, bottom, left = corners
    box = (int(left[0]), int(top[1]), int(right[0]) + 1, int(bottom[1]) + 1)
    return image.crop(box).resize((WIDTH, HEIGHT), Image.LANCZOS).convert('RGBA')


def diamond_mask():
    """Maska presneho kosoctverce. Tvar delame my, ne generator."""
    # Maska se kresli ve ctyrnasobku a zmensi, jinak jsou hrany zubate.
    scale = 4
    mask = Image.new('L', (WIDTH * scale, HEIGHT * scale), 0)
    ImageDraw.Draw(mask).polygon(
        [
            (WIDTH * scale // 2, 0),
            (WIDTH * scale - 1, HEIGHT * scale // 2),
            (WIDTH * scale // 2, HEIGHT * scale - 1),
            (0, HEIGHT * scale // 2),
        ],
        fill=255,
    )
    return mask.resize((WIDTH, HEIGHT), Image.LANCZOS)


def cut_grass(tile):
    """Vyrizne travu: zustane jen vozovka, obrubnik a uzka krajnice.

    **Kazda dlazdice si nesla vlastni travnik** a travniky se mezi obrazky
    lisily odstinem i hustotou, takze byla na mape videt mrizka dlazdic. Autor
    to nahlasil slovy "silnice jsou moc dlazdicove".

    Trava je zelena, asfalt i beton ne. Prechod je mekky pres nekolik urovni
    zelene, aby okraj krajnice nebyl vystrizeny nuzkami.
    """
    array = np.asarray(tile).astype(int)
    r, g, b = array[:, :, 0], array[:, :, 1], array[:, :, 2]
    green = g - np.maximum(r, b)

    # **Rozhoduje okoli, ne jeden pixel.** V trave jsou zlute kvitky a suche
    # stebla, ktere same zelene nejsou; po prahovani po pixelech z nich zustaly
    # tecky rozsypane kolem silnice. Rozmazani je utopi v zeleni kolem, kdezto
    # asfalt zustane sedy -- je ho souvisla plocha.
    smooth = np.asarray(
        Image.fromarray(np.clip(green + 128, 0, 255).astype('uint8'), 'L').filter(
            ImageFilter.GaussianBlur(GRASS_BLUR)
        )
    ).astype(int) - 128

    # Pod GRASS_LOW je to jiste vozovka, nad GRASS_HIGH jiste trava.
    keep = np.clip((GRASS_HIGH - smooth) / (GRASS_HIGH - GRASS_LOW), 0.0, 1.0)
    alpha = (np.asarray(tile)[:, :, 3] * keep).astype('uint8')

    out = tile.copy()
    out.putalpha(Image.fromarray(alpha, 'L'))
    return out


def edge_band(tile, edge):
    """Kde hranu protina vozovka. Vraci (stred, sirka) v podilu hrany.

    Jde se **rovnobezne s hranou**, kousek dovnitr. Kosoctverec ma hrany sikmo,
    takze se vzorkuje po usecce mezi dvema vrcholy posunute ke stredu.
    """
    # **Meri se podle kryti, ne podle barvy.** Po vyrezu travy je vozovka
    # jedine, co na dlazdici zbylo, takze "je tu silnice?" je totez co "je tu
    # neco?". Barevne detektory pred tim selhavaly: sytost brala vysprávku
    # v asfaltu jako travu, zelen zase obrubnik jako silnici.
    array = np.asarray(tile)
    alpha = array[:, :, 3]
    solid = alpha > 160

    corners = {
        'n': ((WIDTH / 2, 0), (WIDTH - 1, HEIGHT / 2)),
        'e': ((WIDTH - 1, HEIGHT / 2), (WIDTH / 2, HEIGHT - 1)),
        's': ((WIDTH / 2, HEIGHT - 1), (0, HEIGHT / 2)),
        'w': ((0, HEIGHT / 2), (WIDTH / 2, 0)),
    }[edge]
    (ax, ay), (bx, by) = corners
    cx, cy = WIDTH / 2, HEIGHT / 2

    hits = []
    steps = 400
    for i in range(steps):
        t = i / (steps - 1)
        x = ax + (bx - ax) * t
        y = ay + (by - ay) * t
        # Posun ke stredu dlazdice, aby se netrefilo do antialiasingu hrany.
        length = max(1.0, ((cx - x) ** 2 + (cy - y) ** 2) ** 0.5)
        px = int(round(x + (cx - x) / length * PROBE))
        py = int(round(y + (cy - y) / length * PROBE))
        if not (0 <= px < WIDTH and 0 <= py < HEIGHT):
            continue
        hits.append((t, bool(solid[py, px])))

    # **Nejdelsi souvisly usek**, ne rozpeti od prvniho k poslednimu pixelu.
    # U krizovatky lezi u vrcholu kosoctverce obrubnik sousedniho ramene a do
    # rozpeti spadl taky: sirka pak vysla 0,74 misto tretiny hrany a vypadalo
    # to, jako by generator zadani ignoroval. Neignoroval, meril jsem spatne.
    best = None
    start = None
    for index, (t, is_road) in enumerate(hits):
        if is_road and start is None:
            start = t
        if (not is_road or index == len(hits) - 1) and start is not None:
            end = hits[index - 1][0] if not is_road else t
            if best is None or end - start > best[1] - best[0]:
                best = (start, end)
            start = None

    if best is None:
        return None
    return ((best[0] + best[1]) / 2, best[1] - best[0])


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    if not os.path.isdir(RAW):
        print(f'chybi {RAW}; nejdriv spust tools/generate-roads.py')
        return 1

    os.makedirs(OUT, exist_ok=True)
    mask = diamond_mask()
    measured = {}
    done = 0

    for name in sorted(os.listdir(RAW)):
        if not name.endswith('.png'):
            continue
        stem = name[:-4]
        image = Image.open(os.path.join(RAW, name)).convert('RGBA')
        corners = diamond_corners(image)
        if corners is None:
            print(f'  {stem}: nenasel jsem kosoctverec')
            continue

        # **Trava se rezе pred maskou.** Rozostreni saha do okoli, a kdyby uz
        # bylo za hranou kosoctverce pruhledno, vysla by tam zelen niz a po
        # obvodu dlazdice by zustal zeleny lem -- tedy presne ta mrizka, kvuli
        # ktere se trava reze.
        tile = cut_grass(to_tile(image, corners))
        tile.putalpha(
            Image.fromarray(
                (np.asarray(tile)[:, :, 3].astype(int) * np.asarray(mask).astype(int) // 255)
                .astype('uint8'),
                'L',
            )
        )
        tile.save(os.path.join(OUT, name))
        done += 1

        family, _, shape = stem.partition('__')
        wanted = set(shape) if shape not in ('0',) else set()
        measured[stem] = (family, wanted, {edge: edge_band(tile, edge) for edge in EDGES})

    print(f'{done} dlazdic zapsano do {os.path.relpath(OUT, ROOT)}\n')

    # Median rodiny: nezajima nas absolutni sirka, ale jestli je vsude stejna.
    widths = defaultdict(list)
    for stem, (family, wanted, bands) in measured.items():
        for edge in wanted:
            band = bands.get(edge)
            if band:
                widths[family].append(band[1])
    median = {f: float(np.median(v)) for f, v in widths.items() if v}
    print('sirka vozovky na hrane (median rodiny): ' +
          ', '.join(f'{f} {w:.2f}' for f, w in sorted(median.items())))

    faults = 0
    for stem, (family, wanted, bands) in sorted(measured.items()):
        problems = []
        for edge in EDGES:
            band = bands.get(edge)
            if edge in wanted:
                if band is None:
                    problems.append(f'{edge}: ma navazovat, ale hrana je prazdna')
                    continue
                centre, width = band
                if abs(centre - 0.5) > TOLERANCE:
                    problems.append(f'{edge}: stred {centre:.2f} misto 0.50')
                if family in median and abs(width - median[family]) > TOLERANCE:
                    problems.append(f'{edge}: sirka {width:.2f}, rodina ma {median[family]:.2f}')
            elif band is not None and band[1] > TOLERANCE:
                problems.append(f'{edge}: nema navazovat, a presto tam vozovka je')
        if problems:
            faults += 1
            print(f'  {stem}:')
            for problem in problems:
                print(f'      {problem}')

    print(f'\n{faults} z {len(measured)} dlazdic ma vadu.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
