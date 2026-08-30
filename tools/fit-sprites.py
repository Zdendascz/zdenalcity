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


def load_definitions() -> dict[str, dict]:
    """Půdorysy a patra budov mimo zóny, klíčem holé id bez namespace."""
    out: dict[str, dict] = {}
    for path in sorted(DEFS.glob('*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('category') not in ('service', 'utility'):
            continue
        w, d = data['footprint']
        out[data['id'].split(':', 1)[1]] = {
            'footprint': [w, d],
            'levels': data['graphics']['heightLevels'],
            'width': (w + d) * (TILE_W // 2) * SCALE,
            'height': ((w + d) * (TILE_H // 2) + data['graphics']['heightLevels'] * LEVEL_H) * SCALE,
        }
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

    Podstava je nejspodnější a nejširší útvar v obrázku, takže její vrcholy
    leží na krajích ořezu: **levý** vrchol je nejnižší pixel v prvním sloupci,
    **pravý** v posledním a **spodní** uprostřed posledního řádku.

    Poměr `šířka / plná výška` je u projekce 2:1 rovný dvěma. Cokoli jiného
    znamená, že obrázek je v jiné izometrii — a to se dá spravit, viz
    `to_two_to_one`.
    """
    alpha = np.asarray(image)[:, :, 3] > 40
    cols = np.where(alpha.any(axis=0))[0]
    rows = np.where(alpha.any(axis=1))[0]
    if cols.size < 8 or rows.size < 8:
        return None

    left_y = np.where(alpha[:, cols[0]])[0][-1]
    right_y = np.where(alpha[:, cols[-1]])[0][-1]
    bottom_y = rows[-1]
    bottom_x = int(np.where(alpha[bottom_y])[0].mean())

    half = bottom_y - (left_y + right_y) / 2
    if half <= 1:
        return None
    return (cols[-1] - cols[0]) / (2 * half), bottom_x


# Mimo tyhle meze se naměřenému poměru nevěří: to už není jiná izometrie, ale
# rozbitý obrázek — strom přes okraj, uříznutá podstava, stín mimo pozemek.
RATIO_MIN, RATIO_MAX = 1.2, 2.6
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


# Naměřené kotvy, aby je šlo zapsat do manifestu. Sbírá je `process`.
ANCHORS: dict[str, dict] = {}


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

    keyed = key_out(Image.open(path))
    cropped = trim(keyed)
    if cropped is None:
        return f'{path.name}: po odklíčování nezbylo nic — jiné pozadí?', False

    notes: list[str] = []
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

    # Kotva se **měří, ne předpokládá.** Spodní vrchol podstavy má u čtvercového
    # půdorysu ležet uprostřed, jenže generátor kreslí podstavu často mírně
    # zkosenou — a budova by pak na dlaždici seděla vedle.
    final = base_diamond(resized)
    anchor_x = final[1] if final else target_w // 2
    if abs(anchor_x - target_w / 2) > target_w * 0.03:
        notes.append(f'  ← podstava zkosená, kotva {anchor_x - target_w // 2:+d} px od středu')

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
    for path in files:
        message, success = process(path, definitions, write)
        print(('  ' if success else '! ') + message)
        ok += success

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

    if write and ok:
        index = {
            'formatVersion': 1,
            'scale': SCALE,
            'sprites': [
                {
                    'building': f'vanilla:{p.stem.rsplit("__", 1)[0]}',
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
