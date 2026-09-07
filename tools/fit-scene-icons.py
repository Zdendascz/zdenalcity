"""Doladi izometricke ikony domovske stranky do `content/vanilla/icons/`.

    python tools/fit-scene-icons.py

Dva kroky, oba jine nez u plochych ikon:

1. **Orez na obsah.** Model necha kolem objektu ruzne siroky pruhledny lem;
   bez orezu by kazda ikona sedela v ramecku jinak velka.
2. **Zmenseni na 192 px do ctverce.** Ctverec proto, aby se ikony na strance
   zarovnaly na mrizku; objekt se do nej vlozi na stred a **nedeformuje se**.

Badge se nelepi a pruhlednost zustava. To je cely rozdil proti `fit-icons.py`:
tyhle ctyri lezi na fotce v hlavicce a maji vypadat jako kus hry, ne jako
stitek do HUD.

Neni soucasti buildu ani `npm run check` - poustelo se to, kdyz ikony vznikly.
"""

import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'art', 'icons', 'scene')
OUT = os.path.join(ROOT, 'content', 'vanilla', 'icons')

SIZE = 192
# Pod timhle krytim se pixel bere jako pozadi, ne jako objekt. Mekky render ma
# po okrajich poloprusvitne pixely a prah na nule by orez neudelal vubec.
ALPHA = 12


def trim(image):
    """Orez na neprusvitny obsah. Vraci obrazek beze zmeny, kdyz je prazdny."""
    alpha = image.getchannel('A').point(lambda value: 255 if value > ALPHA else 0)
    box = alpha.getbbox()
    return image if box is None else image.crop(box)


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    if not os.path.isdir(RAW):
        print('Chybi %s' % RAW)
        return 1

    done = 0
    for name in sorted(os.listdir(RAW)):
        if not name.endswith('.png'):
            continue

        image = trim(Image.open(os.path.join(RAW, name)).convert('RGBA'))

        # Delsi strana urcuje meritko, aby se objekt vesel cely.
        scale = float(SIZE) / max(image.width, image.height)
        width = max(1, int(round(image.width * scale)))
        height = max(1, int(round(image.height * scale)))
        image = image.resize((width, height), Image.LANCZOS)

        canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        canvas.paste(image, ((SIZE - width) // 2, (SIZE - height) // 2), image)
        canvas.save(os.path.join(OUT, name))
        done += 1

    print('%d ikon zapsano do %s' % (done, os.path.relpath(OUT, ROOT)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
