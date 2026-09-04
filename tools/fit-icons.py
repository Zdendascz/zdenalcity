"""Doladi vygenerovane ikony do `content/vanilla/icons/`.

    python tools/fit-icons.py

Ctyri kroky:

1. **Orez na obsah.** Model obcas necha kolem stitku pruhledny lem, obcas ne.
   Bez orezu by mel kazdy stitek jinou velikost a paleta by poskakovala.
2. **Zmenseni na 128 px.** Stejna velikost jako zbytek sady.
3. **Zaobleny ctverec.** Tvar delame my, ne model: napoprsi vysly stitky
   ruzne kulate a vedle sebe to bylo videt. Maska je jedna pro vsechny.
4. **Podlozeni barvou stitku.** Roh, ktery maska odrizne, by jinak nechal
   prosvitat tmavy HUD skrz antialiasing.

Neni soucasti buildu ani `npm run check` - poustelo se to, kdyz ikony vznikly.
"""

import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'art', 'icons', 'raw')
OUT = os.path.join(ROOT, 'content', 'vanilla', 'icons')

SIZE = 128
# Podil hrany, o ktery je roh zaobleny. 22 % je „app icon", ne kruh a ne ctverec.
RADIUS = 0.22
# Pod timhle krytim se pixel bere jako pozadi, ne jako stitek.
ALPHA_FLOOR = 24

# Co ve slozce lezi, ale ikona rozhrani to neni. Logo hry ma vlastni hlavicku
# bez stitku a hru ho bere z `public/brand/`; zaoblit ho do stitku by z nej
# udelalo neco jineho, a v `content/vanilla/icons/` by se jen povalovalo.
SKIP = {'logo'}


def trim(image: Image.Image) -> Image.Image:
    """Orizne pruhledny lem. Kdyz je obrazek krycí cely, vrati ho beze zmeny."""
    alpha = image.split()[3]
    box = alpha.getbbox() if alpha.getextrema()[0] < ALPHA_FLOOR else None
    return image.crop(box) if box else image


def square(image: Image.Image) -> Image.Image:
    """Dorovna na ctverec dolepenim pruhledna, at se stitek nezdeformuje."""
    w, h = image.size
    if w == h:
        return image
    side = max(w, h)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(image, ((side - w) // 2, (side - h) // 2))
    return out


def rounded_mask(size: int) -> Image.Image:
    """Maska zaobleneho ctverce. Kresli se ve ctyrnasobku a zmensi kvuli hranam."""
    scale = 4
    mask = Image.new('L', (size * scale, size * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=int(size * scale * RADIUS),
        fill=255,
    )
    return mask.resize((size, size), Image.LANCZOS)


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    if not os.path.isdir(RAW):
        print(f'chybi {RAW}; nejdriv spust tools/generate-icons.py')
        return 1

    os.makedirs(OUT, exist_ok=True)
    mask = rounded_mask(SIZE)
    done = 0

    for name in sorted(os.listdir(RAW)):
        if not name.endswith('.png'):
            continue
        if name[:-4] in SKIP:
            continue
        image = Image.open(os.path.join(RAW, name)).convert('RGBA')
        image = square(trim(image)).resize((SIZE, SIZE), Image.LANCZOS)

        # Barva stitku se bere ze **stredu hrany**, ne z rohu: v rohu uz muze
        # byt pruhledno a podlozeni by pak bylo cerne.
        edge = image.getpixel((SIZE // 2, 2))
        base = Image.new('RGBA', (SIZE, SIZE), (edge[0], edge[1], edge[2], 255))
        base.alpha_composite(image)
        base.putalpha(mask)

        base.save(os.path.join(OUT, name))
        done += 1

    print(f'{done} ikon zapsano do {os.path.relpath(OUT, ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
