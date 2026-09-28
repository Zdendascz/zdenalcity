"""Najde obrázky budov nakreslené „šejdrem" — s parcelou pootočenou proti mřížce.

    python tools/audit-orientation.py                 # tabulka do konzole
    python tools/audit-orientation.py --sheets DIR    # + kontaktní archy a JSON do DIR

Nic nepřepisuje, jen měří hotové sprity v `content/vanilla/sprites/`.

Proč to vzniklo: generátor občas nakreslí budovu i s parcelou natočenou
o pár stupňů kolem svislé osy. `fit-sprites.py` to nepozná — podstavu jen
zmáčkne na 2 : 1 a sklon hran srovná **průměrně**, takže na mapě pak budova
stojí mimo mřížku a hrana parcely nenavazuje na silnici.

Co se měří, dvakrát nezávisle:

1. **Spodní silueta** (stejný přístup jako `base_diamond` ve `fit-sprites`):
   obě spodní hrany se proloží přímkou a z jejich sklonů se spočítá natočení.
2. **Čáry uvnitř obrázku**: hrany střech, zdí, parkovacích čar a chodníků.
   Houghova transformace najde převládající směr s kladným a se záporným
   sklonem; u srovnané budovy leží oba na ±26,57° (po odečtení souměrného
   zploštění perspektivou). Tohle chytá i případ, kdy parcela sedí, ale
   budova na ní je natočená — a to je u generátoru častější.

Výsledek je **třídění, ne rozsudek**. Před přegenerováním (za peníze) projít
arch `worst.png` a `borderline.png` očima.

Klíčová geometrie: parcela natočená o úhel φ kolem svislé osy má ve 2 : 1
sklony hran `k · ½ · tan(45° ± φ)`, kde `k` je chyba svislého měřítka. Poměr
obou sklonů `k` vykrátí, takže **φ se dá spočítat bez ohledu na to, jak dobře
fit-sprites trefil zmáčknutí**:

    tan(45°+φ) / tan(45°−φ) = r   →   tan φ = (√r − 1) / (√r + 1)
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / 'content' / 'vanilla' / 'sprites'
DEFS = ROOT / 'content' / 'vanilla' / 'buildings'

# Tytéž konstanty jako v src/render/projection.ts a ve fit-sprites.py.
TILE_H = 32
SCALE = 4
IDEAL_DEG = math.degrees(math.atan(0.5))  # 26,565°

# Prahy natočení ve stupních. Laděné očima nad kontaktními archy (`--sheets`)
# se vzorem ideálních čar přes obrázek, ne od stolu.
#
# - **Silueta** je přesná (dlouhá rovná hrana, chyba kolem půl stupně). Od
#   3,5° je nesouměrnost parcely vidět na první pohled, pod 2,8° už ne.
# - **Čáry** jsou hlučnější. Generátor kreslí s mírnou perspektivou, takže
#   hrany střech bývají o pár stupňů plošší než hrana parcely — to je ale
#   zploštění **souměrné** a poměr sklonů ho vykrátí. Horší jsou čáry, které
#   s mřížkou nemají nic společného: dopravníky, jeřáby, potrubní mosty.
#   Proto se čárám věří podle **zisku** (kolikrát víc čar leží na nalezeném
#   směru než na ideálním): se ziskem nad 1,7 je vrchol skutečná stěna
#   budovy, pod 1,25 šum. Mezi tím je potřeba větší úhel.
SIL_SURE, SIL_MAYBE = 3.5, 2.8
LINES_STRONG_GAIN, LINES_WEAK_GAIN = 1.7, 1.25
LINES_SURE, LINES_MAYBE = 4.8, 4.0            # zisk ≥ 1,7
LINES_WEAK_SURE, LINES_WEAK_MAYBE = 7.0, 5.0  # zisk 1,25–1,7

# Pozemky bez stavby: v parku a na skládce nejsou dlouhé rovné čáry, jen
# cesty do oblouku a hromady. Vrchol v histogramu čar je tam šum, takže se
# posuzují jen podle siluety. Parky se poznají podle třídy služby, skládka
# ji nemá, tak je jmenovitě.
NO_BUILDING_CLASSES = {'parks'}
NO_BUILDING_IDS = {'vanilla:landfill'}


# --------------------------------------------------------------------------
# Spodní silueta
# --------------------------------------------------------------------------

def robust_line(px: np.ndarray, py: np.ndarray) -> tuple[float, float, float] | None:
    """Přímka body, která se nedá strhnout stromem na rohu.

    Nejdřív se ořízne krajní desetina (tam trčí stromy a lampy, stejně jako
    ve fit-sprites), pak se třikrát zahodí body dál než trojnásobek mediánové
    odchylky a proloží se znovu. Vrací sklon, průsečík a podíl bodů, které
    zbyly — málo bodů znamená, že hrana přímá není.
    """
    n = px.size
    if n < 24:
        return None
    trim = max(2, n // 10)
    x, y = px[trim:n - trim].astype(float), py[trim:n - trim].astype(float)
    keep = np.ones(x.size, bool)
    slope = intercept = 0.0
    for _ in range(4):
        if keep.sum() < 16:
            return None
        slope, intercept = np.polyfit(x[keep], y[keep], 1)
        res = np.abs(y - (slope * x + intercept))
        mad = max(1.0, float(np.median(res[keep])))
        keep = res <= 3 * mad + 1.0
    return float(slope), float(intercept), float(keep.mean())


def silhouette(alpha: np.ndarray) -> dict | None:
    """Sklony obou spodních hran a z nich rozměry podstavy v dlaždicích."""
    cols = np.where(alpha.any(axis=0))[0]
    if cols.size < 64:
        return None
    x0, x1 = int(cols[0]), int(cols[-1])
    xs = np.arange(x0, x1 + 1)
    has = alpha[:, xs].any(axis=0)
    bottom = np.array(
        [np.where(alpha[:, x])[0][-1] if h else -1 for x, h in zip(xs, has)], dtype=float
    )
    ok = bottom >= 0
    # Vrchol se hledá vyhlazeně, ať ho neurčí jeden pixel stínu.
    smooth = np.convolve(np.where(ok, bottom, 0), np.ones(9) / 9, mode='same')
    apex = int(np.argmax(smooth))
    if apex < 16 or apex > len(xs) - 17:
        return None

    left_ok = ok[:apex]
    right_ok = ok[apex:]
    left = robust_line(xs[:apex][left_ok], bottom[:apex][left_ok])
    right = robust_line(xs[apex:][right_ok], bottom[apex:][right_ok])
    if left is None or right is None:
        return None
    sl, il, inl_l = left
    sr, ir, inl_r = right
    # Levá hrana jde doprava dolů (sklon > 0), pravá doprava nahoru (< 0).
    if sl <= 0.05 or sr >= -0.05:
        return None

    bottom_x = (ir - il) / (sl - sr)
    bottom_y = sl * bottom_x + il
    tile = (TILE_H // 2) * SCALE
    width_tiles = (bottom_y - (sl * x0 + il)) / tile
    depth_tiles = (bottom_y - (sr * x1 + ir)) / tile
    return {
        'slope_l': sl,
        'slope_r': sr,
        'inliers': min(inl_l, inl_r),
        'w': width_tiles,
        'd': depth_tiles,
        'apex': (float(bottom_x), float(bottom_y)),
        'lines': (sl, il, sr, ir),
        'span': (x0, x1),
    }


def rotation_from_slopes(pos: float, neg: float) -> float:
    """Natočení kolem svislé osy ze sklonů dvou kolmých hran (viz docstring modulu).

    Kladné φ = levá hrana strmější než pravá.
    """
    r = abs(pos) / abs(neg)
    t = (math.sqrt(r) - 1) / (math.sqrt(r) + 1)
    return math.degrees(math.atan(t))


# --------------------------------------------------------------------------
# Čáry uvnitř obrázku
# --------------------------------------------------------------------------

def line_peaks(rgba: np.ndarray) -> dict | None:
    """Převládající směry čar s kladným a záporným sklonem, ve stupních.

    Gradient jasu (Sobel) je kolmý na hranu, takže směr hrany je gradient
    otočený o 90°. Váží se velikostí gradientu. Svislé hrany (zdi) a skoro
    vodorovné se vynechají — o natočení neřeknou nic.
    """
    alpha = rgba[:, :, 3] > 200
    # Obrys siluety se nepočítá: ten má vlastní měření a tady by zdvojil váhu.
    inner = alpha.copy()
    for _ in range(3):
        inner[1:-1, 1:-1] &= alpha[:-2, 1:-1] & alpha[2:, 1:-1] & alpha[1:-1, :-2] & alpha[1:-1, 2:]
        alpha = inner.copy()
    lum = rgba[:, :, :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    # Rozmazat před Sobelem. Na tenké schodovité čáře (okap, parkovací čára)
    # skáče směr gradientu po pixelech o ±10° a histogram pak ukazoval
    # vrcholy na 17° u budov, které jsou srovnané přesně.
    k = np.exp(-0.5 * (np.arange(-4, 5) / 1.5) ** 2)
    k /= k.sum()
    lum = np.apply_along_axis(lambda r: np.convolve(r, k, mode='same'), 1, lum)
    lum = np.apply_along_axis(lambda c: np.convolve(c, k, mode='same'), 0, lum)
    gx = np.zeros_like(lum)
    gy = np.zeros_like(lum)
    gx[1:-1, 1:-1] = (
        (lum[:-2, 2:] + 2 * lum[1:-1, 2:] + lum[2:, 2:])
        - (lum[:-2, :-2] + 2 * lum[1:-1, :-2] + lum[2:, :-2])
    )
    gy[1:-1, 1:-1] = (
        (lum[2:, :-2] + 2 * lum[2:, 1:-1] + lum[2:, 2:])
        - (lum[:-2, :-2] + 2 * lum[:-2, 1:-1] + lum[:-2, 2:])
    )
    mag = np.hypot(gx, gy)
    sel = inner & (mag > 25)
    if sel.sum() < 500:
        return None
    ys, xs = np.nonzero(sel)
    # Směr hrany v obrazových souřadnicích (y dolů), složený do (−90°, 90°].
    ang = np.degrees(np.arctan2(gx[sel], -gy[sel]))
    ang = (ang + 90) % 180 - 90

    # Hough nad hranovými body: pro každý zkoušený směr se body promítnou na
    # kolmici a spočítá se, kolik jich padne na tutéž přímku. **Dlouhé rovné
    # čáry** (okap, sokl, parkovací čára) dají ostrý vrchol, textura trávy
    # nebo tašek ne. Obyčejný histogram směrů se nechal zmást sedlovými
    # střechami, jejichž hrany jdou pod jiným úhlem.
    def score(theta: float) -> float:
        near = np.abs(ang - theta) < 6.0
        if near.sum() < 50:
            return 0.0
        t = math.radians(theta)
        off = (-math.sin(t) * xs[near] + math.cos(t) * ys[near])
        counts = np.bincount((off - off.min()).astype(int))
        return float(np.sort(counts)[-12:].sum())

    def best(lo: float, hi: float, ideal: float) -> tuple[float, float, float]:
        grid = np.arange(lo, hi + 0.01, 0.25)
        sc = np.array([score(t) for t in grid])
        i = int(np.argmax(sc))
        # Vrchol na okraji rozsahu není směr, ale svah — typicky křivolaké
        # cesty v parku. Takový se nepočítá.
        if i in (0, len(sc) - 1):
            return float('nan'), 0.0, 1.0
        at_ideal = float(sc[int(np.argmin(np.abs(grid - ideal)))])
        # Kvalita: vrchol proti mediánu v rozsahu. Zisk: o kolik víc čar
        # leží na nalezeném směru než na ideálním. U srovnané budovy je
        # zisk kolem 1, protože nejlepší směr **je** ideální.
        return float(grid[i]), float(sc[i] / max(1.0, np.median(sc))), float(sc[i] / max(1.0, at_ideal))

    pos, pos_q, pos_g = best(9, 43, IDEAL_DEG)
    neg, neg_q, neg_g = best(-43, -9, -IDEAL_DEG)
    return {'pos': pos, 'neg': neg, 'quality': min(pos_q, neg_q), 'gain': max(pos_g, neg_g)}


# --------------------------------------------------------------------------
# Sestavení
# --------------------------------------------------------------------------

def load_footprints() -> dict[str, tuple[tuple[int, int], bool]]:
    """Půdorys a příznak „bez stavby" pro každou budovu, klíčem plné id."""
    out = {}
    for path in sorted(DEFS.glob('*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('type') != 'building':
            continue
        no_building = (
            data['id'] in NO_BUILDING_IDS
            or (data.get('service') or {}).get('class') in NO_BUILDING_CLASSES
        )
        out[data['id']] = (tuple(data['footprint']), no_building)
    return out


def measure(row: dict, footprint: tuple[int, int], no_building: bool) -> dict:
    rgba = np.asarray(Image.open(SPRITES / row['file']).convert('RGBA'))
    out = {
        'file': row['file'],
        'building': row['building'].split(':', 1)[1],
        'variant': row['variant'],
        'footprint': list(footprint),
        'no_building': no_building,
        'measurable': False,
    }
    sil = silhouette(rgba[:, :, 3] > 40)
    if sil is not None and sil['inliers'] >= 0.55:
        dev_l = math.degrees(math.atan(sil['slope_l'])) - IDEAL_DEG
        dev_r = math.degrees(math.atan(-sil['slope_r'])) - IDEAL_DEG
        fw, fd = footprint
        out.update(
            measurable=True,
            slope_l=round(sil['slope_l'], 3),
            slope_r=round(sil['slope_r'], 3),
            dev_l=round(dev_l, 2),
            dev_r=round(dev_r, 2),
            asym=round(abs(sil['slope_l'] + sil['slope_r']) / ((sil['slope_l'] - sil['slope_r']) / 2), 3),
            rot_sil=round(rotation_from_slopes(sil['slope_l'], sil['slope_r']), 2),
            wd_measured=round(sil['w'] / sil['d'], 2),
            wd_ratio=round((sil['w'] / sil['d']) / (fw / fd), 2),
            inliers=round(sil['inliers'], 2),
            apex=[round(v, 1) for v in sil['apex']],
            fit=[round(v, 4) for v in sil['lines']],
            span=list(sil['span']),
        )
    lines = line_peaks(rgba)
    if lines is not None and not (math.isnan(lines['pos']) or math.isnan(lines['neg'])):
        out.update(
            line_pos=round(lines['pos'], 2),
            line_neg=round(lines['neg'], 2),
            line_q=round(lines['quality'], 1),
            line_gain=round(lines['gain'], 2),
            rot_lines=round(
                rotation_from_slopes(math.tan(math.radians(lines['pos'])), math.tan(math.radians(lines['neg']))), 2
            ),
        )
    return out


def classify(m: dict) -> None:
    """Skóre závažnosti a verdikt.

    Skóre je natočení vydělené prahem „jistě", větší z obou měření — silueta
    a čáry mají různou přesnost, tak se srovnávají v násobcích svého prahu.
    Skóre ≥ 1 je šejdrem, prahy „možná" dávají hraniční.
    """
    parts: list[tuple[float, float]] = []  # (skóre, skóre proti prahu „možná")
    if m['measurable']:
        r = abs(m['rot_sil'])
        parts.append((r / SIL_SURE, r / SIL_MAYBE))
    if 'rot_lines' in m and not m['no_building'] and m['line_gain'] >= LINES_WEAK_GAIN:
        r = abs(m['rot_lines'])
        if m['line_gain'] >= LINES_STRONG_GAIN:
            parts.append((r / LINES_SURE, r / LINES_MAYBE))
        else:
            parts.append((r / LINES_WEAK_SURE, r / LINES_WEAK_MAYBE))

    if not parts:
        m['score'] = None
        m['verdict'] = 'neměřitelné'
        return
    m['score'] = round(max(p[0] for p in parts), 2)
    if m['score'] >= 1.0:
        m['verdict'] = 'šejdrem'
    elif max(p[1] for p in parts) >= 1.0:
        m['verdict'] = 'hraniční'
    else:
        m['verdict'] = 'v pořádku'


# --------------------------------------------------------------------------
# Kontaktní archy
# --------------------------------------------------------------------------

def contact_sheet(items: list[dict], path: Path, cols: int = 3, cell: int = 520) -> None:
    """Arch náhledů na modrém pozadí se jménem pod každým obrázkem.

    Přes celý náhled je **mřížka ideálních směrů** (žlutá ½, tyrkysová −½).
    Srovnaná budova má stěny s mřížkou rovnoběžné, natočená ji křižuje — to
    se očima pozná spolehlivěji než čísla. Červeně jsou proložené spodní
    hrany siluety.
    """
    font = ImageFont.load_default(size=15)
    rows = max(1, math.ceil(len(items) / cols))
    label_h = 40
    sheet = Image.new('RGB', (cols * cell, rows * (cell + label_h)), (40, 90, 170))
    grid = Image.new('RGBA', (cell, cell), (0, 0, 0, 0))
    g = ImageDraw.Draw(grid)
    for c in range(-cell, 2 * cell, 48):
        g.line([(0, c), (cell, c + cell / 2)], fill=(255, 230, 0, 110))
        g.line([(0, c), (cell, c - cell / 2)], fill=(0, 230, 255, 110))
    draw = ImageDraw.Draw(sheet)
    for i, m in enumerate(items):
        img = Image.open(SPRITES / m['file']).convert('RGBA')
        k = min((cell - 10) / img.width, (cell - 10) / img.height)
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        cx, cy = (i % cols) * cell, (i // cols) * (cell + label_h)
        ox = cx + (cell - img.width) // 2
        oy = cy + (cell - img.height) // 2
        sheet.paste(img, (ox, oy), img)
        sheet.paste(grid, (cx, cy), grid)
        if 'apex' in m:
            ax, ay = m['apex']
            sl, il, sr, ir = m['fit']
            x0, x1 = m['span']
            px = lambda x, y: (ox + x * k, oy + y * k)
            draw.line([px(x0, sl * x0 + il), px(ax, ay), px(x1, sr * x1 + ir)], fill=(255, 40, 40), width=2)
        a = f"{m['building']}__{m['variant']}  [{m['footprint'][0]}x{m['footprint'][1]}]  {m['verdict']}"
        b = (f"silueta {m.get('rot_sil', '-')}  cary {m.get('rot_lines', '-')} "
             f"(zisk {m.get('line_gain', '-')})  w:d {m.get('wd_ratio', '-')}")
        draw.text((cx + 6, cy + cell + 2), a, fill=(255, 255, 255), font=font)
        draw.text((cx + 6, cy + cell + 20), b, fill=(220, 230, 255), font=font)
    sheet.save(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--sheets', type=Path, help='složka pro archy a JSON')
    parser.add_argument('--seed', type=int, default=1)
    args = parser.parse_args()

    footprints = load_footprints()
    index = json.loads((SPRITES / 'index.json').read_text(encoding='utf-8'))
    results = []
    for row in index['sprites']:
        # Stromy, suť a scény katastrof nejsou budovy na parcele.
        if not row['building'].startswith('vanilla:') or row['building'] not in footprints:
            continue
        m = measure(row, *footprints[row['building']])
        classify(m)
        results.append(m)

    order = {'šejdrem': 0, 'hraniční': 1, 'neměřitelné': 2, 'v pořádku': 3}
    results.sort(key=lambda m: (order[m['verdict']], -(m['score'] or 0)))
    print(f"{'soubor':34} {'fp':5} {'dev_l':>6} {'dev_r':>6} {'asym':>5} {'rotSil':>6} "
          f"{'rotČar':>6} {'q':>5} {'gain':>5} {'wd/fp':>5}  verdikt")
    for m in results:
        fp = 'x'.join(map(str, m['footprint']))
        print(f"{m['file']:34} {fp:5} {m.get('dev_l', '-'):>6} {m.get('dev_r', '-'):>6} "
              f"{m.get('asym', '-'):>5} {m.get('rot_sil', '-'):>6} {m.get('rot_lines', '-'):>6} "
              f"{m.get('line_q', '-'):>5} {m.get('line_gain', '-'):>5} {m.get('wd_ratio', '-'):>5}  {m['verdict']}")
    counts = {v: sum(m['verdict'] == v for m in results) for v in order}
    print(f"\nz {len(results)}: " + ', '.join(f'{k} {v}' for k, v in counts.items()))

    if args.sheets:
        args.sheets.mkdir(parents=True, exist_ok=True)
        (args.sheets / 'orientation.json').write_text(
            json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8'
        )
        scored = sorted((m for m in results if m['score'] is not None), key=lambda m: -m['score'])
        contact_sheet(scored[:24], args.sheets / 'worst.png')
        # Hraniční plus nejvyšší z „v pořádku": práh se tak ověřuje z obou stran.
        maybe = [m for m in scored if m['verdict'] == 'hraniční']
        below = [m for m in scored if m['verdict'] == 'v pořádku']
        near = (maybe + below[:max(6, 24 - len(maybe))])[:24]
        contact_sheet(near, args.sheets / 'borderline.png')
        ok = [m for m in scored if m['verdict'] == 'v pořádku']
        random.Random(args.seed).shuffle(ok)
        contact_sheet(ok[:12], args.sheets / 'random_ok.png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
