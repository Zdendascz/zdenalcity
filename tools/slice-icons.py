"""Rozreze archy ikon na jednotlive soubory do content/vanilla/icons.

Pouziti:  python tools/slice-icons.py <slozka-s-archy>

Potrebuje Pillow, numpy a scipy. Neni soucasti buildu ani `npm run check` -
poustelo se to jednou, kdyz ikony vznikly, a je tu proto, aby se to dalo
zopakovat, az prijdou nove archy.

Uvnitr karty je nahore ikona a dole popisek. Popisek se odrizne podle mezery
mezi nimi - pevna vyska by nesedela, protoze nektere popisky jsou na dva radky.

Pruhlednost: karta ma plochou vypln, takze alfa vychazi z toho, jak moc se
pixel od te vyplne lisi. Mekke stiny tim zustanou pologpruhledne misto aby se
urizly natvrdo.
"""
import os
import sys
from PIL import Image
import numpy as np
from scipy import ndimage

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'content', 'vanilla', 'icons')
SIZE = 128          # cilova hrana; ikony jsou v archu ruzne velke
GAMMA = 0.75        # prosvetleni strednich tonu
FLOOR = 45          # cerny bod: nic v ikone nesmi byt tmavsi nez HUD
SATURATION = 1.25   # nahrada sytosti, kterou podlozeni cerneho bodu ubere
TARGET = 152        # na tenhle prumerny jas se dotahnou i nejtmavsi ikony
MIN_GAMMA = 0.45    # dal uz se nedotahuje; z blackoutu nema byt poledne
INSET = 8           # karta ma slaby ramecek; ten do ikony nepatri
GAP = 8             # tolik prazdnych radku oddeluje ikonu od popisku
TOL = 14            # odchylka od vyplne karty, ktera se jeste bere jako obsah
LINE_GAP = 14       # vetsi mezera nez mezi radky popisku uz znamena ikonu
FALLBACK = 0.85     # kdyz hledani selze, rez podle typicke karty

# Ctyri karty, kde barva nerozhodne: dve maji na strese tenke sede detaily,
# ktere vypadaji jako pismo, dve maji dvouradkovy popisek prilepeny ke stinu.
OVERRIDES = {
    'police_large': 0.85,
    'transit_stop': 0.85,
    'coverage-parks': 0.76,
    'water_treatment': 0.78,
}

THRESH = 25       # pozadí stránky ~17, výplň karty ~32
MIN_W = 90
MIN_H = 90


def cards(path):
    grey = np.asarray(Image.open(path).convert('L')).astype(int)
    mask = grey >= THRESH
    mask[:88, :] = False          # nadpis archu a linka pod ním

    # Zavře drobné díry (tmavé části ikony uvnitř karty), aby karta byla celistvá.
    filled = ndimage.binary_closing(mask, structure=np.ones((9, 9)))
    filled = ndimage.binary_fill_holes(filled)

    labels, count = ndimage.label(filled)
    boxes = []
    for y, x in ndimage.find_objects(labels):
        if x.stop - x.start >= MIN_W and y.stop - y.start >= MIN_H:
            boxes.append((x.start, y.start, x.stop, y.stop))

    # Sousední karty se občas slijí, když ikona přeteče přes okraj. Pozná se to
    # podle šířky: karta je na archu jedna a tatáž, tak co je znatelně širší,
    # je slepenec a rozdělí se na stejné díly.
    widths = sorted(x1 - x0 for x0, _, x1, _ in boxes)
    unit = widths[len(widths) // 2]
    split = []
    for x0, y0, x1, y1 in boxes:
        parts = max(1, round((x1 - x0) / unit))
        step = (x1 - x0) / parts
        for i in range(parts):
            split.append((round(x0 + i * step), y0, round(x0 + (i + 1) * step), y1))

    # Řádky shora dolů, uvnitř řádku zleva doprava.
    split.sort(key=lambda b: (b[1] // 60, b[0]))
    return split

SHEETS = [
    ('ChatGPT Image 26. 8. 2026 13_31_19 (1).png', [
        'terrain-raise', 'terrain-lower', 'terrain-level', 'terrain-fill',
        'road-street', 'road-avenue', 'road-highway',
        'zone-residential', 'zone-commercial', 'zone-industrial',
        'bulldoze', 'pipe',
        'pump_station', 'water_works', 'water_treatment', 'coal_power_plant',
        'clinic', 'hospital', 'fire_station', 'fire_station_large',
    ]),
    ('ChatGPT Image 26. 8. 2026 13_31_20 (2).png', [
        'police_small', 'police_large', 'prison',
        'school', 'high_school', 'university',
        'museum', 'theatre', 'cinema', 'gallery',
        'park_small', 'park_large', 'landfill', 'incinerator',
        'transit_stop', 'transit_depot', 'tram_stop', 'metro_station',
        'community_centre', 'retirement_home',
    ]),
    ('ChatGPT Image 26. 8. 2026 13_31_20 (3).png', [
        # Jmeno je nasobek rychlosti, ne poradi karty v archu: HUD sklada
        # `speed-${nasobek}` a rychlosti jsou 1/2/4/8 (simHost.ts). Karta se
        # tremi sipkami je proto 4x, se ctyrmi 8x.
        'speed-pause', 'speed-1', 'speed-2', 'speed-4', 'speed-8',
        'view-surface', 'view-underground', 'view-ghost',
        'layers', 'disasters', 'taxes', 'funding', 'budget', 'save', 'language',
    ]),
    ('ChatGPT Image 26. 8. 2026 13_31_20 (4).png', [
        'layer-none', 'layer-power', 'layer-pollution', 'layer-landvalue',
        'layer-crime', 'layer-happiness', 'layer-traffic',
        'coverage-health', 'coverage-fire', 'coverage-police',
        'coverage-education', 'coverage-culture', 'coverage-parks',
        'coverage-waste',
    ]),
    ('ChatGPT Image 26. 8. 2026 13_31_20 (5).png', [
        'fire', 'wildfire', 'flood', 'tornado', 'earthquake',
        'explosion', 'industrialAccident', 'pileup', 'strike', 'riot',
        'gangWar', 'blackout', 'epidemic', 'chemicalSpill', 'landslide',
    ]),
    ('ChatGPT Image 26. 8. 2026 13_31_20 (6).png', [
        'tax-decrease', 'tax-increase', 'quicksave', 'quickload',
        'download', 'open-file', 'close',
        'map-size', 'reroll', 'start-city', 'resume',
        # Druha karta je splatka uveru. Ta ve hre neni, tak se ikona zahazuje
        # (None) misto aby lezela v obsahu nepouzita.
        'loan-take', None, 'bond-issue',
        'line-create', 'line-delete', 'stop-add', 'stop-remove',
        'vehicles', 'fare', 'disasters-toggle',
    ]),
]


def card_fill(arr):
    """Barva vyplne karty, z lemu u okraje.

    Pocita se pro kazdou kartu zvlast. Jedna spolecna hodnota pro cely arch
    nechavala na nekterych ikonach viditelny obdelnik - karty se o par jednotek
    lisi a pri klicovani se to pozna.
    """
    ring = np.concatenate([
        arr[0:3].reshape(-1, 3), arr[-3:].reshape(-1, 3),
        arr[:, 0:3].reshape(-1, 3), arr[:, -3:].reshape(-1, 3),
    ])
    return np.median(ring, axis=0)


def label_cut(arr):
    """Kde konci ikona a zacina popisek.

    Mezera mezi nimi neexistuje - mekky stin ji premosti - a podle velikosti
    utvaru se to taky nepozna, protoze stin s textem splyne v jeden. Popisek se
    ale pozna podle barvy: je to **jasna seda**, kdezto ikony jsou barevne a
    jejich stin je tmavy. Sedych budov je ve hre dost, proto se hleda zdola:
    posledni pruh sedeho textu je popisek, cokoli vys uz je ikona.
    """
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    greyish = (mx > 90) & ((mx - mn) < mx * 0.12)

    # Sedych budov je ve hre dost, takze sama barva nestaci. Text ma navic
    # **tenke tahy**: po erozi z nej nezbyde nic, kdezto ze sede zdi ano.
    solid = ndimage.binary_erosion(greyish, np.ones((5, 5)))
    rows = (greyish.sum(axis=1) > 3) & (solid.sum(axis=1) < 2)

    y = len(rows) - 1
    while y >= 0 and not rows[y]:
        y -= 1
    if y < 0:
        return len(rows)

    top = y
    blank = 0
    while y >= 0:
        if rows[y]:
            top = y
            blank = 0
        else:
            blank += 1
            # Dvouradkovy popisek ma mezi radky uzkou mezeru; ta ho nesmi
            # rozdelit, jinak zustane horni radek v ikone.
            if blank >= LINE_GAP:
                break
        y -= 1
    return max(0, top - 4)


def icon_box(arr, fill):
    """Rozsah samotne ikony uvnitr karty. Popisek uz je odriznuty."""
    ink = np.abs(arr - fill).max(axis=2) > TOL
    ys = np.nonzero(ink.sum(axis=1) > 2)[0]
    xs = np.nonzero(ink.sum(axis=0) > 1)[0]
    if len(ys) == 0 or len(xs) == 0:
        return None
    return int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1


def lift(rgb):
    """Prosvetli ikonu, aby nesplynula s tmavym panelem.

    Archy jsou kreslene na tmave pozadi a nejtmavsi mista ikon maji temer
    stejny jas jako HUD, takze podstavce a stiny na tlacitku zmizi. Nestaci
    zesvetlit vsechno stejne - to jen vybeli to, co uz videt bylo. Zvedne se
    tedy gamma (stredni tony vic nez svetla), pod cerny bod se podlozi FLOOR,
    aby uplna cern neexistovala, a sytost se dozene zpatky, protoze podlozeni
    barvy vzdycky trochu vysedi.
    """
    v = np.power(rgb / 255.0, GAMMA)
    v = FLOOR / 255.0 + v * (1 - FLOOR / 255.0)
    grey = v.mean(axis=2, keepdims=True)
    return np.clip(grey + (v - grey) * SATURATION, 0, 1) * 255.0


def even_out(rgba):
    """Dotahne tmave ikony na jas ostatnich.

    Spolecna gamma nestaci: archy maji ikony ruzne exponovane a rozdil je velky
    - blackout mel prumerny jas 67, kdezto stahnout do souboru 172. Na tlacitku
    vedle sebe pak jedna svitila a druha byla skvrna. Pocita se proto gamma pro
    kazdou ikonu zvlast, aby vsechny skoncily kolem TARGET.

    Jen se **prosvetluje**, nikdy netmavi: uz svetla ikona je v poradku a
    stahovat ji dolu by jen ubralo kontrast proti panelu.
    """
    opaque = rgba[:, :, 3] > 128
    if not opaque.any():
        return rgba
    mean = rgba[:, :, :3][opaque].mean()
    if mean >= TARGET:
        return rgba

    gamma = max(MIN_GAMMA, np.log(TARGET / 255.0) / np.log(max(mean, 1.0) / 255.0))
    out = rgba.copy()
    out[:, :, :3] = np.power(rgba[:, :, :3] / 255.0, gamma) * 255.0
    return out


def cut(cell, override=None):
    arr = np.asarray(cell.convert('RGB')).astype(int)
    fill = card_fill(arr)

    if override is not None:
        at = int(arr.shape[0] * override)
    else:
        at = label_cut(arr)
        # Karta nemuze byt z devadesati procent popisek; kdyz to tak vyjde,
        # hledani se splasilo a lepsi je typicky rez nez zahozena ikona.
        if at < arr.shape[0] * 0.5:
            at = int(arr.shape[0] * FALLBACK)
    arr = arr[:at]
    if arr.shape[0] < 20:
        return None
    found = icon_box(arr, fill)
    if found is None:
        return None
    x0, y0, x1, y1 = found

    # Ctverec kolem ikony, at maji vsechny stejne meritko i teziste.
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    half = side // 2 + 6

    square = np.empty((half * 2, half * 2, 3), dtype=int)
    square[:] = fill.astype(int)
    sy0, sx0 = max(0, cy - half), max(0, cx - half)
    sy1, sx1 = min(arr.shape[0], cy + half), min(arr.shape[1], cx + half)
    square[sy0 - (cy - half):sy1 - (cy - half),
           sx0 - (cx - half):sx1 - (cx - half)] = arr[sy0:sy1, sx0:sx1]

    diff = np.abs(square - fill).max(axis=2)
    alpha = np.clip((diff - 6) * 255 / 18, 0, 255).astype(np.uint8)
    rgba = even_out(np.dstack([lift(square), alpha.astype(np.float64)]))
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA').resize(
        (SIZE, SIZE), Image.LANCZOS
    )


def main(src):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for filename, names in SHEETS:
        path = os.path.join(src, filename)
        sheet = Image.open(path)
        boxes = cards(path)
        if len(boxes) != len(names):
            print('!! %s: %d karet, %d jmen' % (filename, len(boxes), len(names)))
            continue
        # Rez mezi ikonou a popiskem je v jedne rade karet stejny, tak se bere
        # median pres celou radu - jedna karta, kde stin premosti mezeru, tim
        # zbytek rady nerozhodi.
        for box, name in zip(boxes, names):
            if name is None:
                continue
            inner = (box[0] + INSET, box[1] + INSET, box[2] - INSET, box[3] - INSET)
            out = cut(sheet.crop(inner), OVERRIDES.get(name))
            if out is None:
                print('!! prazdna karta', name)
                continue
            out.save(os.path.join(OUT, name + '.png'))
            total += 1
    print('ulozeno', total)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
