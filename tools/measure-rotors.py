"""Změří rotory větrníků z obrázků **s lopatkami** (T116).

    python tools/measure-rotors.py            # vypíše a uloží art/parts/rotors.json
    python tools/measure-rotors.py --apply    # zapíše rotory do sprites/effects.json

Lopatky mají červené špičky. Tři jejich těžiště dají všechno, co renderer
potřebuje, aby točící se rotor seděl přesně tam a v té rovině, kde ho
generátor nakreslil:

- **náboj** je těžiště tří špiček — u souměrného rotoru se tři vektory
  od náboje sečtou na nulu, i když je rotor vidět šikmo jako elipsa;
- **rovina** je lineární zobrazení, které vezme špičky rotoru z dílu
  `rotor.png` (nahoru a ±120°) na změřené špičky. Tři body určí matici 2×2
  s rezervou, takže se prokládá nejmenšími čtverci a zbytek se hlásí.

Měří se **před** výměnou obrázku za verzi bez lopatek a ukládá se relativně
ke kotvě. Kotva je spodní vrchol podstavy a ta se výměnou nemění, takže bod
změřený na starém obrázku sedí i na novém.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / 'content' / 'vanilla' / 'sprites'
OUT = ROOT / 'art' / 'parts' / 'rotors.json'

# Špičky dílu `rotor.png` v jeho souřadnicích (y dolů), délka lopatky 1:
# nahoru, pak po směru hodinových ručiček.
LOCAL = np.array([[0.0, -1.0], [0.8660254, 0.5], [-0.8660254, 0.5]])


def tips(path: Path) -> list[tuple[float, float]]:
    rgba = np.asarray(Image.open(path).convert('RGBA')).astype(int)
    red = (rgba[..., 3] > 128) & (rgba[..., 0] > 150) & (rgba[..., 1] < 110) & (rgba[..., 0] - rgba[..., 1] > 80)
    labels, count = ndimage.label(red)
    found = [ndimage.center_of_mass(red, labels, i) for i in range(1, count + 1)]
    sizes = ndimage.sum(red, labels, range(1, count + 1))
    points = [(float(c[1]), float(c[0]), float(s)) for c, s in zip(found, sizes) if s >= 12]
    # Lopatka může mít dva červené pruhy. Na jednu lopatku se bere ten
    # nejvzdálenější od středu všech — to je špička.
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    by_direction: list[tuple[float, float]] = []
    for x, y, _ in sorted(points, key=lambda p: -np.hypot(p[0] - cx, p[1] - cy)):
        direction = np.arctan2(y - cy, x - cx)
        if all(abs(np.angle(np.exp(1j * (direction - np.arctan2(py - cy, px - cx))))) > 0.6 for px, py in by_direction):
            by_direction.append((x, y))
    return by_direction[:3]


EFFECTS = SPRITES / 'effects.json'


def apply() -> int:
    """Zapíše rotory do `effects.json` podle **současné** kotvy obrázku.

    Ostatní záznamy v souboru nechá být — komíny a světla tam píše někdo jiný.
    """
    measured = json.loads(OUT.read_text(encoding='utf-8'))
    index = json.loads((SPRITES / 'index.json').read_text(encoding='utf-8'))
    anchors = {(e['building'], e['variant']): e['anchor'] for e in index['sprites']}
    effects = json.loads(EFFECTS.read_text(encoding='utf-8')) if EFFECTS.exists() else {'formatVersion': 1, 'effects': {}}
    for variant, rotor in measured.items():
        anchor = anchors[('vanilla:wind_turbine', variant)]
        key = f'vanilla:wind_turbine|{variant}'
        others = [e for e in effects['effects'].get(key, []) if e.get('type') != 'vanilla:spin']
        effects['effects'][key] = others + [{
            'type': 'vanilla:spin',
            'part': 'rotor',
            'at': [round(anchor[0] + rotor['hubFromAnchor'][0], 1), round(anchor[1] + rotor['hubFromAnchor'][1], 1)],
            'axes': rotor['axes'],
        }]
        print(f'  {key}: náboj {effects["effects"][key][-1]["at"]}')
    effects['effects'] = dict(sorted(effects['effects'].items()))
    EFFECTS.write_text(json.dumps(effects, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return 0


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if '--apply' in sys.argv:
        return apply()
    index = json.loads((SPRITES / 'index.json').read_text(encoding='utf-8'))
    anchors = {(e['building'], e['variant']): e['anchor'] for e in index['sprites']}
    out = {}
    for variant in 'abc':
        found = tips(SPRITES / f'wind_turbine__{variant}.png')
        if len(found) != 3:
            print(f'  {variant}: našel jsem {len(found)} špiček, přeskakuji')
            continue
        hub = np.mean(found, axis=0)
        vectors = np.array(found) - hub
        # Po směru hodinových ručiček od nejvyšší, stejně jako LOCAL.
        order = sorted(range(3), key=lambda i: np.arctan2(vectors[i][0], -vectors[i][1]) % (2 * np.pi))
        measured = vectors[order]
        matrix, residual, *_ = np.linalg.lstsq(LOCAL, measured, rcond=None)
        # `matrix` je 2×2: řádek 0 je obraz lokálního x, řádek 1 obraz lokálního y.
        fit_error = float(np.abs(LOCAL @ matrix - measured).max())
        anchor = anchors[('vanilla:wind_turbine', variant)]
        out[variant] = {
            'hubFromAnchor': [round(hub[0] - anchor[0], 2), round(hub[1] - anchor[1], 2)],
            'axes': [[round(matrix[0][0], 3), round(matrix[0][1], 3)], [round(matrix[1][0], 3), round(matrix[1][1], 3)]],
        }
        print(f'  {variant}: náboj {hub.round(1)} (kotva {anchor}), osy {out[variant]["axes"]}, odchylka {fit_error:.1f} px')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
