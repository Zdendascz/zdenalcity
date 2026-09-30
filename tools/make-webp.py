"""Převede obrázky obsahu na WebP (T121, T134).

    python tools/make-webp.py            # převede, co je novější než jeho WebP
    python tools/make-webp.py --all      # převede všechno znovu

Autor: „kurevsky dlouho se to načítá". Změřeno: sprity budov mají v PNG
**84 MB** a hra si je stahuje za běhu. WebP s kvalitou 88 dá na vzorku 29
obrázků 10,4 MB → 2,1 MB, tedy pětinu, a na mapě rozdíl nepoznáš — obrázky
se stejně zmenšují na čtvrtinu.

PNG **zůstávají** v repozitáři jako zdroj: z nich pracují `fit-*.py`, audit
i testy. Hra ale načítá jen WebP (`src/content/loader.ts`), takže se PNG do
buildu vůbec nedostanou. Test `roadDetails.test.ts` hlídá, že ke každému PNG
WebP existuje — jinak by nový obrázek ve hře chyběl.

Tři věci navíc od T134:

- **Poloviční sprity budov** (`<jméno>@0.5x.webp`). Obrázek je kreslený ve
  čtyřnásobku (`scale: 4`) a při výchozím zoomu se zmenšuje na čtvrtinu;
  polovina stačí až do zoomu 2 a v paměti karty zabere čtvrtinu. Plnou
  velikost si hra dotáhne, až hráč přiblíží (`src/render/spriteResolution.ts`).
  **Kvalita zůstává 88** — snížit ji autor odmítl.
- **Ikony** 128 px → 64 px, kvalita 90. Na obrazovce mají 18 až 35 px, takže
  64 pokryje i dvojnásobnou hustotu displeje. WebP bez PNG zdroje se smaže:
  ikony přejmenovává a maže `slice-icons.py` a staré WebP by jinak šly do
  buildu dál.
- Nic jiného se nemění: sprity, povrchy, díly a podezdívky jdou dál v plné
  velikosti a kvalitě 88.

Pouští se po každém `fit-*.py` a `slice-icons.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'content' / 'vanilla'
FOLDERS = ['sprites', 'tiles', 'parts', 'skirts']
QUALITY = 88

#: Přípona polovičního spritu. Loader ji pozná a spáruje s plným obrázkem.
HALF_SUFFIX = '@0.5x'

#: Ikony: strana ve výsledku a kvalita.
ICON_SIZE = 64
ICON_QUALITY = 90


def stale(source: Path, target: Path, everything: bool) -> bool:
    return everything or not target.exists() or target.stat().st_mtime < source.stat().st_mtime


def rgba(path: Path) -> Image.Image:
    image = Image.open(path)
    return image.convert('RGBA') if image.mode != 'RGBA' else image


def save(image: Image.Image, target: Path, quality: int) -> None:
    # `exact` drží barvu i pod plnou průhledností — bez něj WebP průhledné
    # pixely zčerná a na zmenšeném okraji vznikne tmavý lem.
    image.save(target, 'WEBP', quality=quality, method=6, exact=True)


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    everything = '--all' in sys.argv
    before = after = done = 0
    for folder in FOLDERS:
        for png in sorted((CONTENT / folder).glob('*.png')):
            webp = png.with_suffix('.webp')
            if stale(png, webp, everything):
                save(rgba(png), webp, QUALITY)
                before += png.stat().st_size
                after += webp.stat().st_size
                done += 1

    # Poloviční sprity. Pillow zmenšuje RGBA s předem vynásobenou alfou,
    # takže okraj budovy neztmavne.
    halves = half_bytes = 0
    for png in sorted((CONTENT / 'sprites').glob('*.png')):
        half = png.with_name(f'{png.stem}{HALF_SUFFIX}.webp')
        if not stale(png, half, everything):
            continue
        image = rgba(png)
        size = (max(1, round(image.width / 2)), max(1, round(image.height / 2)))
        save(image.resize(size, Image.Resampling.LANCZOS), half, QUALITY)
        halves += 1
        half_bytes += half.stat().st_size

    icons = icon_bytes = 0
    icon_dir = CONTENT / 'icons'
    for png in sorted(icon_dir.glob('*.png')):
        webp = png.with_suffix('.webp')
        if not stale(png, webp, everything):
            continue
        image = rgba(png)
        if max(image.size) > ICON_SIZE:
            image.thumbnail((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS)
        save(image, webp, ICON_QUALITY)
        icons += 1
        icon_bytes += webp.stat().st_size
    orphans = [webp for webp in icon_dir.glob('*.webp') if not webp.with_suffix('.png').exists()]
    for webp in orphans:
        webp.unlink()

    if done:
        print(f'{done} obrázků: {before / 1e6:.1f} MB PNG → {after / 1e6:.1f} MB WebP')
    if halves:
        print(f'{halves} polovičních spritů: {half_bytes / 1e6:.1f} MB')
    if icons:
        print(f'{icons} ikon po {ICON_SIZE} px: {icon_bytes / 1e6:.2f} MB')
    if orphans:
        print(f'smazáno {len(orphans)} WebP ikon bez PNG: {", ".join(w.name for w in orphans)}')
    if not (done or halves or icons or orphans):
        print('Nic k převodu.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
