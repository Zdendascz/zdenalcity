"""Odvodi ikony, ktere v arsich nejsou, slozenim z tech, ktere tam jsou.

Pouziti:  python tools/derive-icons.py

Je to **nahrazka, ne cil**. Kdyz pribude kreslena ikona stejneho jmena, staci
ji hodit do content/vanilla/icons a tenhle skript uz na ni nepoustet - hra bere
soubor, ktery tam lezi, at vznikl jakkoli.
"""
import os
from PIL import Image
import numpy as np

ICONS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     'content', 'vanilla', 'icons')


def load(name):
    return Image.open(os.path.join(ICONS, name + '.png')).convert('RGBA')


def desaturate(image, keep=0.25):
    """Odbarvi ikonu. Zonu to zbavi barvy typu, takze nectete se jako obytna."""
    a = np.asarray(image).astype(np.float64)
    grey = a[:, :, :3].mean(axis=2, keepdims=True)
    a[:, :, :3] = grey + (a[:, :, :3] - grey) * keep
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def badge(base, mark, scale=0.55):
    """Prilepi znacku do praveho dolniho rohu."""
    out = base.copy()
    side = int(base.width * scale)
    small = mark.resize((side, side), Image.LANCZOS)
    out.alpha_composite(small, (base.width - side, base.height - side))
    return out


def main():
    # Rusit zony je vlastni nastroj (T62) a arch pro nej ikonu nema. Slozi se
    # z odbarvene zony a cerveneho krizku: "pryc se zonovanim", ne "pryc
    # s obytnou zonou".
    zone = desaturate(load('zone-residential'))
    badge(zone, load('close')).save(os.path.join(ICONS, 'zone-clear.png'))
    print('zone-clear.png')


if __name__ == '__main__':
    main()
