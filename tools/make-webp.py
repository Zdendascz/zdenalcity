"""Převede obrázky obsahu na WebP (T121).

    python tools/make-webp.py            # převede, co je novější než jeho WebP
    python tools/make-webp.py --all      # převede všechno znovu

Autor: „kurevsky dlouho se to načítá". Změřeno: sprity budov mají v PNG
**84 MB** a hra si je stahuje za běhu. WebP s kvalitou 88 dá na vzorku 29
obrázků 10,4 MB → 2,1 MB, tedy pětinu, a na mapě rozdíl nepoznáš — obrázky
se stejně zmenšují na čtvrtinu.

PNG **zůstávají** v repozitáři jako zdroj: z nich pracují `fit-*.py`, audit
i testy. Hra ale načítá jen WebP (`src/content/loader.ts`), takže se PNG do
buildu vůbec nedostanou. Test `content.test.ts` hlídá, že ke každému PNG
WebP existuje — jinak by nový obrázek ve hře chyběl.

Pouští se po každém `fit-*.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FOLDERS = ['sprites', 'tiles', 'parts', 'skirts']
QUALITY = 88


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    everything = '--all' in sys.argv
    before = after = done = 0
    for folder in FOLDERS:
        for png in sorted((ROOT / 'content' / 'vanilla' / folder).glob('*.png')):
            webp = png.with_suffix('.webp')
            if not everything and webp.exists() and webp.stat().st_mtime >= png.stat().st_mtime:
                continue
            image = Image.open(png)
            image = image.convert('RGBA') if image.mode != 'RGBA' else image
            # `exact` drží barvu i pod plnou průhledností — bez něj WebP
            # průhledné pixely zčerná a na zmenšeném okraji vznikne tmavý lem.
            image.save(webp, 'WEBP', quality=QUALITY, method=6, exact=True)
            before += png.stat().st_size
            after += webp.stat().st_size
            done += 1
    if done:
        print(f'{done} obrázků: {before / 1e6:.1f} MB PNG → {after / 1e6:.1f} MB WebP')
    else:
        print('Nic k převodu.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
