"""Naladí vygenerované obrázky budov na rozměry, které renderer čeká.

    python tools/fit-sprites.py            # zpracuje a uloží
    python tools/fit-sprites.py --check    # jen vypíše, co by udělal

Vstup:  art/sprites/raw/<id>__<varianta>.png
Výstup: content/vanilla/sprites/<id>__<varianta>.png + index.json

Rozměry si bere **z definic budov**, ne z tabulky v sobě: kdyby se půdorys
změnil, přepočítají se sprity samy a nikdo si nemusí pamatovat, že je někde
druhá kopie čísel (P5).

Postup na jeden obrázek:

1. odklíčuje pozadí (průhlednost, když ji obrázek má, jinak barva rohů),
2. otře fialový lem, který po klíčování zůstane na hranách,
3. ořízne na to, co zbylo,
4. zmenší na šířku podle půdorysu — **podle šířky, ne podle výšky**, protože
   šířku diktuje mřížka a výšku architektura,
5. nahlásí, o kolik se výška liší od očekávané.

Zmenšuje se **jen šířkou a se zachovaným poměrem**. Natáhnout obrázek na
očekávanou výšku by znamenalo, že se vyšší kostel udělá zavalitým — a to je
zpráva o stavbě, ne chyba k opravě.
"""

from __future__ import annotations

import io
import json
import sys
import gc
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'sprites' / 'raw'
OUT = ROOT / 'content' / 'vanilla' / 'sprites'
DEFS = ROOT / 'content' / 'vanilla' / 'buildings'

# Projekce z src/render/projection.ts. Kdyby se tam změnily, změní se i tady —
# jsou to tytéž konstanty, ne náhodou stejná čísla.
TILE_W = 64
TILE_H = 32
LEVEL_H = 16

# Hra přiblíží až 4×, takže se kreslí ve čtyřnásobku a zmenšuje se.
SCALE = 4

# Jak daleko od barvy pozadí ještě klíčovat. Měkký přechod mezi `HARD` a `SOFT`
# dělá hranu, která po zmenšení nezubatí.
KEY_HARD = 40.0
KEY_SOFT = 110.0

# O kolik smí výška utéct očekávané, než se to ohlásí. Není to chyba —
# jen upozornění, že stavba vyšla jinak vysoká, než kolik má `heightLevels`.
HEIGHT_TOLERANCE = 0.18


def spec_for(w: int, d: int, levels: int) -> dict:
    """Rozměry spritu pro daný půdorys a výšku."""
    return {
        'footprint': [w, d],
        'levels': levels,
        'width': (w + d) * (TILE_W // 2) * SCALE,
        'height': ((w + d) * (TILE_H // 2) + levels * LEVEL_H) * SCALE,
    }


# Ruiny nemají definici budovy, takže si půdorys nemají kde vzít a dostávají
# vlastní tabulku. **Jedno patro u všech**: suť má být plochá, aby přes ni
# hráč viděl, co je za ní.
RUINS = {f'ruin_{n}x{n}': (n, n, 1) for n in (1, 2, 3, 4)}

# Objekty na terénu — strom a balvan. Definici budovy taky nemají, protože to
# nejsou entity: kreslí je renderer podle druhu terénu a v simulaci po nich
# nezůstane nic. Zadání je v `docs/08-DLAZDICE.md`.
# Půdorys tu určuje jen **velikost obrázku**, ne místo v simulaci.
#
# Strom byl chvíli 2 × 2 a vyšel vyšší než čtyřpatrový dům — skutečná lípa má
# přes dvacet metrů, jenže vedle herních domů to vypadá jako pralesní velikán.
# Autorovo „stromy jsou proti domům moc obrovské". Zpátky na 1 × 1; přesnost
# proti skutečnosti tu prohrává s tím, aby město šlo přečíst.
DECOR = {
    'forest_clump': (1, 1, 3),
    'boulders': (1, 1, 1),
    # Katastrofy na ulici. **Sirka ulice, ne dvou dlazdic.** Prvni pokus mel
    # 2x2 a autor to zavrhl: dav pres tri baraky vypadal jako obri. Ulice je
    # jedna dlazdice, takze scena musi byt zhruba tak siroka.
    'riot_crowd': (1, 1, 1),
    'pileup_wreck': (1, 1, 1),
    # Ohen: jedna dlazdice, ale dve patra vysoky. Plamen je vzhuru, ne do siry,
    # a nizky by nad horici strechou nebyl videt.
    'fire_blaze': (1, 1, 2),
    # Zpustla zastavba. **Jedna velikost na kategorii**, ne jedna na kazdy
    # pudorys: renderer ji posadi doprostred parcely a zmensi, kdyz je parcela
    # mensi. U ruiny nikdo nepozna, jak velky dum tam stal.
    'derelict_residential': (2, 2, 3),
    'derelict_commercial': (2, 2, 3),
    'derelict_industrial': (2, 2, 3),
    # Sut: jedna hromada na dlazdici.
    'rubble_pile': (1, 1, 1),
    # Tataz hromada nakreslena do svahu, ctyri smery klesani.
    'rubble_slope_ur': (1, 1, 1),
    'rubble_slope_lr': (1, 1, 1),
    'rubble_slope_ll': (1, 1, 1),
    'rubble_slope_ul': (1, 1, 1),
}

# Kolik z té dlaždice předmět skutečně zabere.
#
# Generátor kreslí předmět **přes celý obrázek**, ať je to lípa nebo kámen —
# jinak by ho `trim` stejně ořízl na jeho obrys. Rozdíl mezi stromem a balvanem
# se proto dělá až tady. Balvan přes celou dlaždici je osm metrů vysoký kámen
# a vedle domu vypadá jako skála.
DECOR_SHARE = {
    'boulders': 0.45,
    # Dav se vejde do sirky ulice a kousek pretece na chodnik.
    'riot_crowd': 0.85,
    # Naklacak je delsi nez auto, takze skoro cela dlazdice.
    'pileup_wreck': 0.95,
    # Hromada suti neni pres celou dlazdici: kolem ni ma byt videt rozryta zem.
    'rubble_pile': 0.8,
    # Ve svahu se hromada rozlije po spadnici, takze je o kus sirsi.
    'rubble_slope_ur': 0.9,
    'rubble_slope_lr': 0.9,
    'rubble_slope_ll': 0.9,
    'rubble_slope_ul': 0.9,
    # Ohen ma prekryvat, co hori, ne prescuhovat na sousedni parcelu.
    'fire_blaze': 0.9,
}


def load_definitions() -> dict[str, dict]:
    """Půdorysy a patra všech budov a ruin, klíčem holé id bez namespace."""
    out: dict[str, dict] = {
        name: spec_for(*size) for name, size in {**RUINS, **DECOR}.items()
    }
    for path in sorted(DEFS.glob('*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        # Všechny budovy, ne jen služby: zástavba v zónách má sprity taky
        # a její půdorysy **nejsou čtvercové** (2×1, 3×2). Kotva se měří, ne
        # dopočítává ze středu, takže to projde stejnou cestou.
        if data.get('type') != 'building':
            continue
        w, d = data['footprint']
        out[data['id'].split(':', 1)[1]] = spec_for(w, d, data['graphics']['heightLevels'])
    return out


def corners(layer: np.ndarray) -> np.ndarray:
    """Čtyři rohové výřezy slepené do jednoho pole. Odsud se pozná pozadí."""
    h, w = layer.shape[:2]
    p = 8
    parts = [layer[:p, :p], layer[:p, w - p:], layer[h - p:, :p], layer[h - p:, w - p:]]
    return np.concatenate([part.reshape(-1, *layer.shape[2:]) for part in parts])


def background_colour(rgb: np.ndarray) -> np.ndarray:
    """Barva pozadí z rohů obrázku.

    Bere se **medián čtyř rohů**, ne jeden: generátor občas nechá v rohu
    artefakt a jediný vzorek by pak klíčoval podle něj.
    """
    return np.median(corners(rgb), axis=0)


def key_out(image: Image.Image) -> Image.Image:
    """Odstraní pozadí. Průhlednost respektuje, jinak klíčuje podle barvy."""
    rgba = np.asarray(image.convert('RGBA')).astype(np.float32)
    rgb, alpha = rgba[:, :, :3], rgba[:, :, 3]

    # Obrázek, který průhlednost už má, se nechá být — generátor ji dodal a
    # klíčovat přes ni by sežralo skla a stíny.
    #
    # Ptáme se **rohů**, ne podílu průhledných pixelů v celém obrázku. Podíl
    # je vratký: budova s prosklenou halou má poloprůhledných pixelů dost na
    # to, aby vypadala jako odklíčovaná, i když kolem sebe má plnou magentu.
    if np.median(corners(alpha)) < 32:
        return image.convert('RGBA')

    back = background_colour(rgb)
    distance = np.sqrt(((rgb - back) ** 2).sum(axis=2))
    keep = np.clip((distance - KEY_HARD) / (KEY_SOFT - KEY_HARD), 0.0, 1.0)

    # Otření lemu: na poloprůhledné hraně zůstává barva pozadí přimíchaná.
    # Odečte se její podíl, jinak má budova kolem sebe fialovou svatozář.
    soft = (keep > 0.0) & (keep < 1.0)
    if soft.any():
        share = keep[soft][:, None]
        mixed = rgb[soft]
        rgb[soft] = np.clip((mixed - back * (1.0 - share)) / np.maximum(share, 0.05), 0, 255)

    out = np.dstack([rgb, keep * 255.0]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def base_diamond(image: Image.Image) -> tuple[float, int] | None:
    """Poměr stran podstavy a x spodního vrcholu. `None`, když to nejde změřit.

    Podstava je nejspodnější útvar v obrázku, takže její obrys je **spodní
    silueta**: dvě přímé hrany, které se sbíhají do vrcholu. Obě se proloží
    přímkou a vrcholy se dopočítají z nich.

    **Neměří se z krajních pixelů**, ačkoli by to bylo jednodušší. Na kraji
    stojí strom, lampa nebo plot, který přečnívá přes roh podstavy — a jediný
    takový pixel posune měření natolik, že se poměr splete o desetiny. Dlouhá
    rovná hrana proti tomu odolá.

    Když silueta zdola dvě přímé hrany nemá, vrátí se `None` a projekce se
    neopravuje. To je ten skutečný důvod, proč měření zamítnout — ne to, že by
    úhel vyšel neobvyklý. Generátor kreslí od 1,19 : 1 po 1,60 : 1 a všechno
    z toho jsou poctivé projekce.
    """
    alpha = np.asarray(image)[:, :, 3] > 40
    cols = np.where(alpha.any(axis=0))[0]
    if cols.size < 64:
        return None

    x0, x1 = int(cols[0]), int(cols[-1])
    xs = np.arange(x0, x1 + 1)
    bottom = np.array([np.where(alpha[:, x])[0][-1] for x in xs], dtype=float)

    apex = int(np.argmax(bottom))
    # Vrchol musí být uvnitř, ne na kraji — jinak to není „V" a podstavu
    # nejspíš něco ořízlo.
    if apex < 8 or apex > len(xs) - 9:
        return None

    def fit(a: int, b: int) -> tuple[float, float] | None:
        """Přímka spodní hranou v rozsahu sloupců. `None`, když se nedrží."""
        if b - a < 16:
            return None
        # Krajní desetina se vynechá: přesně tam trčí stromy a lampy.
        trim_px = max(2, (b - a) // 10)
        piece = slice(a + trim_px, b - trim_px)
        px, py = xs[piece], bottom[piece]
        slope, intercept = np.polyfit(px, py, 1)
        # Hrana musí být opravdu přímá. Odchylka se poměřuje k výšce hrany,
        # ne k pevnému počtu pixelů — jinak by prošla i klikatina na velkém
        # obrázku a rovná hrana na malém by neprošla.
        span = max(1.0, abs(slope) * (px[-1] - px[0]))
        if np.median(np.abs(py - (slope * px + intercept))) > span * 0.02:
            return None
        return float(slope), float(intercept)

    left = fit(0, apex)
    right = fit(apex, len(xs) - 1)
    if left is None or right is None:
        return None

    # Vrcholy z proložených přímek, ne z pixelů.
    y_left = left[0] * x0 + left[1]
    y_right = right[0] * x1 + right[1]
    if abs(left[0] - -right[0]) > max(abs(left[0]), abs(right[0])) * 0.35:
        return None  # hrany nejsou souměrné, podstava to nebude

    bottom_x = (right[1] - left[1]) / (left[0] - right[0])
    bottom_y = left[0] * bottom_x + left[1]

    half = bottom_y - (y_left + y_right) / 2
    if half <= 1:
        return None
    return (x1 - x0) / (2 * half), int(round(bottom_x))


# Poslední pojistka. Že je úhel neobvyklý, **není** důvod k zamítnutí —
# generátor kreslí od 1,19 : 1 po 1,60 : 1 a všechno z toho jsou poctivé
# projekce. Tvar podstavy hlídá `base_diamond`; tohle chytá jen nesmysl.
# Jak daleko smí změřená kotva utéct od geometrie, než se měření zahodí.
# Podíl šířky spritu. Šest procent je zhruba desetina dlaždice — na to, aby to
# pobralo převis stromů a balkonů, ale ne špatně poznanou podstavu.
ANCHOR_TOLERANCE = 0.06

RATIO_MIN, RATIO_MAX = 0.7, 3.0
# Pod tímhle rozdílem se neopravuje. Zmenšit o procento nemá cenu a jen by to
# rozmazalo hrany.
RATIO_TOLERANCE = 0.04


def to_two_to_one(image: Image.Image, ratio: float) -> tuple[Image.Image, str]:
    """Převede obrázek do projekce 2:1 svislým zmáčknutím.

    Není to deformace, ale **změna projekce**. Obě izometrie jsou paralelní
    promítání se stejným otočením kolem svislé osy; liší se jen sklonem
    pohledu, a ten se na obrazovce projeví právě měřítkem v ose Y. Budova se
    tím sníží přesně tak, jak by ji hra nakreslila sama.
    """
    if not (RATIO_MIN <= ratio <= RATIO_MAX):
        return image, f'  ← poměr podstavy {ratio:.2f} je mimo meze, neopravuji'
    if abs(ratio - 2.0) <= RATIO_TOLERANCE:
        return image, ''

    factor = ratio / 2.0
    height = max(1, round(image.height * factor))
    return image.resize((image.width, height), Image.LANCZOS), f'  ← projekce {ratio:.2f}:1 → 2:1'


def trim(image: Image.Image) -> Image.Image | None:
    """Ořízne na neprůhledné pixely. `None`, když nezbylo nic."""
    alpha = np.asarray(image)[:, :, 3]
    # Práh, ne nula: po klíčování zůstává slabý šum, který by ořez natáhl
    # na celé plátno.
    rows = np.where(alpha.max(axis=1) > 8)[0]
    cols = np.where(alpha.max(axis=0) > 8)[0]
    if rows.size == 0 or cols.size == 0:
        return None
    return image.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))


def spriteKey(name: str) -> str:
    """Klíč do manifestu.

    Ruiny ani předměty na terénu nejsou budovy, takže nedostávají jejich jmenný
    prostor: nemají definici, o kterou by se opíral, a renderer si je hledá pod
    holým jménem stejně jako suť.
    """
    return name if name in RUINS or name in DECOR else f'vanilla:{name}'


# Naměřené kotvy, aby je šlo zapsat do manifestu. Sbírá je `process`.
ANCHORS: dict[str, dict] = {}

# Co už v manifestu je. Slouží jako záchrana pro obrázek, který se v tomhle
# běhu nepovedl zpracovat: jeho záznam se přenese, ať z manifestu nevypadne.
def _previous() -> dict[str, dict]:
    path = OUT / 'index.json'
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return {
        f"{row['file'].rsplit('.', 1)[0]}": {
            'width': row['width'],
            'height': row['height'],
            'anchor': row['anchor'],
        }
        for row in data.get('sprites', [])
    }


PREVIOUS: dict[str, dict] = _previous()


def fit_decor(
    building: str, variant: str, cropped: Image.Image, spec: dict, write: bool
) -> tuple[str, bool]:
    """Naladí předmět na terénu: strom, balvan.

    Šířka se srovná na dlaždici a **kotva sedí na spodním středu obrázku** —
    tam, kde má předmět stín a kde se dotýká země. Neměří se, protože měřit
    není co: v obrázku je jen předmět.
    """
    target_w = max(1, round(spec['width'] * DECOR_SHARE.get(building, 1.0)))
    scale = target_w / cropped.width
    target_h = max(1, round(cropped.height * scale))
    resized = cropped.resize((target_w, target_h), Image.LANCZOS)

    if write:
        OUT.mkdir(parents=True, exist_ok=True)
        resized.save(OUT / f'{building}__{variant}.png')
        ANCHORS[f'{building}__{variant}'] = {
            'width': target_w,
            'height': target_h,
            'anchor': [target_w // 2, target_h],
        }
    return f'  {building}__{variant}  →  {target_w}×{target_h}  (předmět, kotva ze středu)', True


def process(path: Path, definitions: dict[str, dict], write: bool) -> tuple[str, bool]:
    name = path.stem
    if '__' not in name:
        return f'{path.name}: jméno musí být <id>__<varianta>.png', False

    building, variant = name.rsplit('__', 1)
    spec = definitions.get(building)
    if spec is None:
        return f'{path.name}: budovu „{building}" obsah nezná', False
    if variant not in ('a', 'b', 'c'):
        return f'{path.name}: varianta „{variant}" není a/b/c', False

    with Image.open(path) as opened:
        keyed = key_out(opened)
    cropped = trim(keyed)
    if cropped is None:
        return f'{path.name}: po odklíčování nezbylo nic — jiné pozadí?', False

    notes: list[str] = []

    # **Objekt na terénu podstavu nemá**, a tak se mu neopravuje projekce ani
    # neměří kotva. Strom se kreslí bez země pod sebou; `base_diamond` by
    # v něm našel obrys koruny a `to_two_to_one` by ho podle něj zmáčkl na
    # polovinu — přesně to se stalo napoprvé.
    if building in DECOR:
        return fit_decor(building, variant, cropped, spec, write)

    measured = base_diamond(cropped)
    if measured is None:
        notes.append('  ← podstavu nejde změřit, projekci neopravuji')
    else:
        cropped, note = to_two_to_one(cropped, measured[0])
        if note:
            notes.append(note)
        # Po zmáčknutí se ořez posune, protože se hýbalo celým obrázkem.
        cropped = trim(cropped) or cropped

    target_w = spec['width']
    scale = target_w / cropped.width
    target_h = max(1, round(cropped.height * scale))
    resized = cropped.resize((target_w, target_h), Image.LANCZOS)

    # Kotva se **měří, ne předpokládá** — generátor kreslí podstavu často mírně
    # zkosenou a budova by pak na dlaždici seděla vedle. Měření se ale porovnává
    # s geometrií, protože samo občas selže.
    #
    # **Střed obrázku platí jen pro čtvercový půdorys.** Spodní vrchol podstavy
    # leží v `w / (w + d)` šířky: diamant sahá `32·d` doleva a `32·w` doprava od
    # zadního rohu. U 2 × 1 jsou to dvě třetiny, ne polovina. Záloha tu do T72
    # brala střed, takže tři sprity 2 × 1 a 3 × 2 skončily posunuté skoro o půl
    # dlaždice a lezly do sousedů — autor to nahlásil jako „špatné překrytí".
    footprint_w, footprint_d = spec['footprint']
    expected_x = round(target_w * footprint_w / (footprint_w + footprint_d))

    final = base_diamond(resized)
    measured_x = final[1] if final else None
    tolerance = target_w * ANCHOR_TOLERANCE

    # Otočená budova. Vrchol podstavy sedí na místě, kam patří **prohozený**
    # půdorys — generátor nakreslil 1 × 2 místo 2 × 1. Zrcadlení podle svislé
    # osy je v izometrii přesně to prohození: mřížkové `(x, y) → (y, x)` dá
    # obrazové `x → −x`, protože `sx = (x − y)·32`.
    #
    # Opravuje se to **jen v tomhle úzkém případě**: změřený vrchol musí sedět
    # u prohozené polohy a být daleko od té správné. Nepřesně změřená podstava
    # se tím nesmí zrcadlit, ta se jen dorovná na geometrii o kus níž.
    #
    # Cena: světlo se překlopí, takže stín padá na opačnou stranu než u ostatních
    # budov. Je to menší zlo než barák položený napříč parcelou, a autor tuhle
    # chybu našel očima na mapě (`commercial_row__b`). Prompt směr osy říká,
    # ale generátor ho neposlechl ani na druhý pokus.
    if measured_x is not None and footprint_w != footprint_d:
        swapped_x = round(target_w * footprint_d / (footprint_w + footprint_d))
        middle = target_w / 2
        # Blíž k prohozené poloze **a** na opačné straně od středu. Samotné okno
        # kolem prohozené polohy nestačilo — `commercial_row__b` se změřil o kus
        # vedle a proklouzl. A samotná strana taky ne: podstava změřená přesně
        # na středu je selhané měření, ne otočená budova, a leží od obou poloh
        # stejně daleko.
        blizsi = abs(measured_x - swapped_x) < abs(measured_x - expected_x)
        opacna_strana = (measured_x - middle) * (expected_x - middle) < 0
        if blizsi and opacna_strana:
            resized = resized.transpose(Image.FLIP_LEFT_RIGHT)
            measured_x = target_w - measured_x
            notes.append('  ← nakreslený napříč parcelou, zrcadlím (světlo se překlopí)')

    if measured_x is None:
        anchor_x = expected_x
        notes.append('  ← podstavu nejde změřit, kotva dopočítaná z půdorysu')
    elif abs(measured_x - expected_x) > tolerance:
        anchor_x = expected_x
        notes.append(
            f'  ← změřená kotva je {measured_x - expected_x:+d} px od geometrie, '
            f'to je moc — beru geometrii'
        )
    else:
        anchor_x = measured_x

    expected_h = spec['height']
    drift = (target_h - expected_h) / expected_h
    if abs(drift) > HEIGHT_TOLERANCE:
        smer = 'vyšší' if drift > 0 else 'nižší'
        notes.append(f'  ← o {abs(drift) * 100:.0f} % {smer}, než čeká {spec["levels"]} pater')

    if write:
        OUT.mkdir(parents=True, exist_ok=True)
        resized.save(OUT / f'{building}__{variant}.png')
        ANCHORS[f'{building}__{variant}'] = {
            'width': target_w,
            'height': target_h,
            'anchor': [anchor_x, target_h],
        }

    return (
        f'{building}__{variant}  →  {target_w}×{target_h}' + ''.join(notes),
        True,
    )



def main() -> int:
    # Konzole na Windows jede v cp1250 a spadla by na první šipce v hlášení.
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    write = '--check' not in sys.argv
    definitions = load_definitions()

    if not RAW.exists():
        print(f'Složka {RAW.relative_to(ROOT)} neexistuje. Vytvoř ji a nahraj do ní obrázky.')
        return 1

    files = sorted(RAW.glob('*.png'))
    if not files:
        print(f'V {RAW.relative_to(ROOT)} nic není.')
        return 0

    ok = 0
    failed: list[str] = []
    for order, path in enumerate(files, 1):
        # Jeden vadný obrázek nesmí shodit celý běh. Dvě stě padesát obrázků
        # trvá minuty a spadnout na tom posledním znamená udělat všechno znovu —
        # a hlavně bez zápisu `index.json`, protože ten se píše až nakonec.
        try:
            message, success = process(path, definitions, write)
        except (MemoryError, OSError, ValueError) as chyba:
            message, success = f'{path.name}: {type(chyba).__name__}: {chyba}', False
        print(('  ' if success else '! ') + message)
        ok += success
        if not success:
            failed.append(path.stem)
        # Pillow drží dekódovaná data, dokud je sběrač neuklidí. Při dvou stech
        # padesáti obrázcích po několika megabajtech to stačilo na `MemoryError`
        # uprostřed běhu.
        if order % 25 == 0:
            gc.collect()

    print(f'\n{ok} z {len(files)} zpracováno{"" if write else " (jen kontrola)"}.')

    # Chybějící varianty: obsah je zná, obrázek k nim není. Není to chyba,
    # jen se vypíše, co ještě zbývá nakreslit.
    have = {p.stem for p in files}
    missing = [
        f'{b}__{v}' for b in sorted(definitions) for v in 'abc' if f'{b}__{v}' not in have
    ]
    if missing:
        print(f'\nZbývá {len(missing)} z {len(definitions) * 3}:')
        for i in range(0, len(missing), 4):
            print('  ' + '  '.join(missing[i:i + 4]))

    # Co se nepovedlo, si ponechá svůj dosavadní záznam — jinak by sprite
    # z manifestu vypadl a hra by místo domu nakreslila kvádr.
    if write and failed:
        for stem in failed:
            keep = PREVIOUS.get(stem)
            if keep is not None:
                ANCHORS[stem] = keep
        print()
        print(f'Nepovedlo se {len(failed)}; jejich záznamy zůstávají z minula.')

    if write and ok:
        index = {
            'formatVersion': 1,
            'scale': SCALE,
            'sprites': [
                {
                    'building': spriteKey(p.stem.rsplit('__', 1)[0]),
                    'variant': p.stem.rsplit('__', 1)[1],
                    'file': f'{p.stem}.png',
                    # Rozměry jsou v manifestu schválně, i když je nese i PNG:
                    # renderer díky tomu umí kotvu spočítat dřív, než se
                    # textura stáhne, a sprite mu při načtení nepodskočí.
                    'width': ANCHORS[p.stem]['width'],
                    'height': ANCHORS[p.stem]['height'],
                    # Bod spritu, který sedne na přední vrchol půdorysu, tedy
                    # na `gridToScreen(x+n, y+n)`. **Naměřený**, ne dopočítaný
                    # ze středu: podstava bývá mírně zkosená.
                    'anchor': ANCHORS[p.stem]['anchor'],
                }
                for p in sorted(OUT.glob('*.png'))
                if p.stem in ANCHORS
            ],
        }
        (OUT / 'index.json').write_text(
            json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
        print(f'Zapsán {(OUT / "index.json").relative_to(ROOT)}.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
