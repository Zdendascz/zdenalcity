"""Obrázky rozcestníku ve WebP (T134).

    python tools/make-public-webp.py

Rozcestník dřív stahoval deset JPG snímků a scén naráz (5 MB) a logo v PNG
859 × 945 px (787 kB), které se na obrazovce ukazuje nejvýš 112 px široké.
Tenhle skript vyrobí z **původních podkladů v `art/`** to, co jde do
`public/`:

- `public/shots/*.webp`  ze `art/screenshots/*.jpg` (4K snímky ze hry), 1920 × 1080
- `public/scenes/*.webp` z `art/scenes/*.png` (kreslené scény), 1280 px na šířku
- ke každému snímku a scéně náhled `<jméno>-640.webp` pro karty galerie
  (karta má nejvýš 340 px, 640 pokryje dvojnásobnou hustotu displeje;
  plný obrázek se stáhne, až ho hráč otevře)
- `public/brand/logo.webp` z `art/brand/logo.png` (plné logo z `make-brand.py`), 256 px
- `public/brand/<partner>.webp` z `art/brand/partners/*`, 260 px na šířku

Kvalita 80 u fotek, 90 u log. Rozměry snímků a scén zůstaly, jaké byly v JPG.
Obrázky katastrof (`public/events/*.webp`) jsou převedené jednorázově z JPG
(kvalita 80); jejich podklady v `art/` nejsou.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art'
PUBLIC = ROOT / 'public'

PHOTO_QUALITY = 80
LOGO_QUALITY = 90

#: (zdroj, cíl, šířka výsledku)
JOBS: list[tuple[str, str, int]] = [
    ('screenshots/*.jpg', 'shots', 1920),
    ('scenes/*.png', 'scenes', 1280),
]

THUMB_WIDTH = 640
LOGO_WIDTH = 256
PARTNER_WIDTH = 260


def resized(image: Image.Image, width: int) -> Image.Image:
    if image.width <= width:
        return image
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def save(image: Image.Image, target: Path, quality: int) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    alpha = image.mode in ('RGBA', 'LA', 'P')
    image = image.convert('RGBA' if alpha else 'RGB')
    image.save(target, 'WEBP', quality=quality, method=6, **({'exact': True} if alpha else {}))
    return target.stat().st_size


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    total = 0
    for pattern, folder, width in JOBS:
        for source in sorted(ART.glob(pattern)):
            target = PUBLIC / folder / f'{source.stem}.webp'
            image = Image.open(source)
            size = save(resized(image, width), target, PHOTO_QUALITY)
            total += size
            print(f'{target.relative_to(ROOT)}  {size / 1000:.0f} kB')
            thumb = PUBLIC / folder / f'{source.stem}-{THUMB_WIDTH}.webp'
            size = save(resized(image, THUMB_WIDTH), thumb, PHOTO_QUALITY)
            total += size
            print(f'{thumb.relative_to(ROOT)}  {size / 1000:.0f} kB')

    logo = ART / 'brand' / 'logo.png'
    if logo.exists():
        target = PUBLIC / 'brand' / 'logo.webp'
        size = save(resized(Image.open(logo), LOGO_WIDTH), target, LOGO_QUALITY)
        total += size
        print(f'{target.relative_to(ROOT)}  {size / 1000:.0f} kB')
    else:
        print(f'chybí {logo.relative_to(ROOT)}; nejdřív pusť make-brand.py')

    for source in sorted((ART / 'brand' / 'partners').glob('*')):
        target = PUBLIC / 'brand' / f'{source.stem}.webp'
        size = save(resized(Image.open(source), PARTNER_WIDTH), target, LOGO_QUALITY)
        total += size
        print(f'{target.relative_to(ROOT)}  {size / 1000:.0f} kB')

    print(f'celkem {total / 1e6:.2f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
