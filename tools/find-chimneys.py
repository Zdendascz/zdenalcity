"""Najde ústí komínů na obrázcích budov a zapíše kouř (T116).

    python tools/find-chimneys.py --sheet     # náhledy s vyznačenými kandidáty
    python tools/find-chimneys.py --apply     # zapíše schválené do sprites/effects.json

Komín je na siluetě **úzká špička**: sloupec, jehož horní hrana je výrazně
výš než okolí po obou stranách. Hledá se v horním obrysu alfy — šířka
špičky do pár procent obrázku, převýšení nad okolím aspoň pár pixelů.

Detektor najde i stožár, lampu nebo štít, takže se výsledek **kontroluje
očima** (`--sheet`) a do `effects.json` jde jen to, co je v `APPROVED`.
Kouř je ale obsah, ne kód: mod ho přepíše v `effects.json` stejně jako rotor.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / 'content' / 'vanilla' / 'sprites'
EFFECTS = SPRITES / 'effects.json'

CANDIDATES = [
    'coal_power_plant', 'gas_power_plant', 'nuclear_power_plant', 'incinerator',
    'industrial_chemical', 'industrial_complex', 'industrial_foundry', 'industrial_refinery',
    'industrial_smelter', 'industrial_works', 'industrial_large', 'industrial_medium',
    'industrial_hall', 'industrial_row', 'industrial_small', 'industrial_park',
]

# Schválené komíny: `soubor → [(index kandidáta), …]` nebo `[(x, y), …]` ručně.
# Plní se po prohlídce náhledů.
APPROVED: dict[str, list] = {
    # 2026-09-29, prohlédnuto na výřezech kolem každého kandidáta.
    'coal_power_plant__a': [0, 1],  # přegenerováno podruhé (T124)
    'coal_power_plant__b': [0],
    # c přegenerována kvůli strmému pohledu (T124); věže jsou pro detektor
    # moc široké, středy okrajů odečtené z obrysu.
    'coal_power_plant__c': [(330, 225, 'steam'), (795, 120, 'steam'), 0],
    'gas_power_plant__a': [1],
    'gas_power_plant__b': [1],  # přegenerováno (T124)
    'gas_power_plant__c': [1],
    'incinerator__a': [0],
    'incinerator__b': [0],  # přegenerováno kvůli natočení (T123)
    'incinerator__c': [1],
    'industrial_chemical__a': [3],
    'industrial_chemical__b': [1],
    'industrial_chemical__c': [0],
    'industrial_complex__a': [0],
    'industrial_complex__b': [0],  # přegenerováno (T124)
    'industrial_foundry__a': [1],
    'industrial_foundry__b': [0],  # přegenerováno (T124)
    'industrial_foundry__c': [0],
    'industrial_refinery__a': [7],
    'industrial_refinery__c': [5],  # přegenerováno (T124)
    'industrial_smelter__a': [1],
    'industrial_smelter__b': [3],
    'industrial_smelter__c': [1, 2, 4],
    'industrial_works__a': [0],  # přegenerováno (T124)
    'industrial_works__c': [0],  # přegenerováno podruhé (T124)
    'industrial_large__c': [0],
    'industrial_medium__a': [0],
    'industrial_hall__b': [0],
}
# Jaderná elektrárna chybí schválně: varianta b má páru nakreslenou v obrázku
# a a ani c chladicí věž nemají.

STEAM = {'nuclear_power_plant'}


def peaks(path: Path) -> list[tuple[int, int]]:
    """Úzké špičky horního obrysu, zleva doprava.

    Hledá se podle **převýšení** (prominence), ne v pevném okně: komín má
    plochý vršek široký klidně desetinu obrázku a okno menší než on ho
    neuvidí jako špičku.
    """
    from scipy.signal import find_peaks

    alpha = np.asarray(Image.open(path).convert('RGBA'))[:, :, 3] > 90
    height, width = alpha.shape
    top = np.full(width, float(height))
    for x in range(width):
        rows = np.where(alpha[:, x])[0]
        if rows.size:
            top[x] = rows[0]
    found, props = find_peaks(
        -top,
        prominence=height * 0.05,
        wlen=max(3, int(width * 0.3)) | 1,
        width=(None, width * 0.14),
        plateau_size=(0, width * 0.14),
    )
    return [(int(x), int(top[x])) for x in found]


def sheet() -> None:
    out_dir = ROOT / 'art' / 'parts' / 'chimneys'
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in CANDIDATES:
        tiles = []
        for variant in 'abc':
            path = SPRITES / f'{name}__{variant}.png'
            if not path.exists():
                continue
            image = Image.open(path).convert('RGBA')
            canvas = Image.new('RGBA', image.size, (70, 120, 190, 255))
            canvas.alpha_composite(image)
            draw = ImageDraw.Draw(canvas)
            for number, (x, y) in enumerate(peaks(path)):
                draw.ellipse((x - 9, y - 9, x + 9, y + 9), outline=(255, 0, 255, 255), width=4)
                draw.rectangle((x + 10, y - 22, x + 30, y - 2), fill=(0, 0, 0, 255))
                draw.text((x + 14, y - 20), str(number), fill=(255, 255, 0, 255))
            tiles.append(canvas)
        if not tiles:
            continue
        width = sum(t.size[0] for t in tiles) + 10 * len(tiles)
        height = max(t.size[1] for t in tiles)
        board = Image.new('RGBA', (width, height), (30, 30, 30, 255))
        x = 0
        for tile in tiles:
            board.alpha_composite(tile, (x, height - tile.size[1]))
            x += tile.size[0] + 10
        board.save(out_dir / f'{name}.png')
        print(f'  {name}: {[len(peaks(SPRITES / f"{name}__{v}.png")) for v in "abc" if (SPRITES / f"{name}__{v}.png").exists()]}')


def apply() -> None:
    effects = json.loads(EFFECTS.read_text(encoding='utf-8')) if EFFECTS.exists() else {'formatVersion': 1, 'effects': {}}
    for stem, chosen in APPROVED.items():
        name, variant = stem.split('__')
        found = peaks(SPRITES / f'{stem}.png')
        points = []
        for choice in chosen:
            kind = 'smoke'
            if isinstance(choice, tuple) and len(choice) == 3:
                x, y, kind = choice
                points.append((x, y, kind))
                continue
            if isinstance(choice, tuple) and isinstance(choice[1], str):
                choice, kind = choice
            x, y = found[choice] if isinstance(choice, int) else choice
            points.append((x, y, kind))
        key = f'vanilla:{name}|{variant}'
        others = [e for e in effects['effects'].get(key, []) if e.get('type') != 'vanilla:smoke']
        effects['effects'][key] = others + [
            {
                'type': 'vanilla:smoke',
                'at': [x, y + 2],
                # Elektrárna kouří pořád, továrna jen když má proud.
                **({} if name.endswith('power_plant') else {'when': 'powered'}),
                'rate': 1.8 if kind == 'steam' else 1,
                'color': '#eef0f2' if kind == 'steam' else '#7c7a78',
            }
            for x, y, kind in points
        ]
        print(f'  {key}: {len(points)} komínů')
    effects['effects'] = dict(sorted(effects['effects'].items()))
    EFFECTS.write_text(json.dumps(effects, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if '--apply' in sys.argv:
        apply()
    else:
        sheet()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
