"""Udela ze znacky vsechno, co web potrebuje.

    python tools/make-brand.py

Vstup:  art/icons/raw/logo.png   (vygenerovana znacka)
        art/screenshots/*.jpg    (snimky ze hry)

Vystup: art/brand/logo.png               znacka s pruhlednym pozadim v plne velikosti
                                         (do hry ji zmensi make-public-webp.py na 256 px)
        public/brand/icon-192.png        ikona PWA
        public/brand/icon-512.png        ikona PWA
        public/brand/icon-maskable.png   ikona s rezervou na orez
        public/brand/favicon.png         zalozka prohlizece
        public/brand/favicon.ico         starsi prohlizece a Windows
        art/promo/*.jpg                  obrazky do prispevku

Neni soucasti buildu. Poustelo se to, kdyz znacka vznikla; az prijde nova,
staci to pustit znovu.
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO_RAW = os.path.join(ROOT, 'art', 'icons', 'raw', 'logo.png')
SHOTS = os.path.join(ROOT, 'art', 'screenshots')
BRAND = os.path.join(ROOT, 'public', 'brand')
PROMO = os.path.join(ROOT, 'art', 'promo')

# Barvy znacky. Tmave morska je pozadi, jantarova akcent -- stejna dvojice,
# jakou nese samotny logotyp.
DEEP = (14, 32, 40)
AMBER = (240, 160, 32)

FONT_BOLD = 'C:/Windows/Fonts/seguibl.ttf'
FONT_TEXT = 'C:/Windows/Fonts/segoeuib.ttf'

# Pod timhle jasem je pixel uplne pruhledny, nad druhym uplne kryci. Mezi tim
# alfa plynule stoupa.
DARK = 16
LIGHT = 95


def transparent_logo() -> Image.Image:
    """Udela ze znacky obrazek s pruhlednym pozadim a orizne ho natesno.

    **Zare kolem domu se nevyrezava, ale prevadi na pruhlednost.** Model ji
    nakresli, at se v promptu zakaze jakkoliv — zkouseno dvakrat. Vyriznout ji
    taky nejde: prahem na jas zustane jako zluta mlha nebo ukrojí tmavou stranu
    budovy, pres hrany zbyde roztrepany lem, a kdyz se pred hledanim hran
    rozostri, splyne tmava stena veze s pozadim a vez zmizi.

    Mekky prechod je odpoved, ne kompromis: cim svetlejsi pixel, tim kryci.
    Cerne pozadi zmizi uplne, zare zustane jako polopruhledny svit a na tmave
    strance vypada presne tak, jak ma.
    """
    image = Image.open(LOGO_RAW).convert('RGB')
    grey = image.convert('L')
    alpha = grey.point(
        lambda v: 0 if v <= DARK else 255 if v >= LIGHT else int((v - DARK) * 255 / (LIGHT - DARK))
    )
    out = image.convert('RGBA')
    out.putalpha(alpha)

    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    return out.crop(box) if box else out


def square(image: Image.Image, size: int, pad: float, background=None) -> Image.Image:
    """Znacka doprostred ctverce. `pad` je podil hrany, ktery zustane volny."""
    canvas = Image.new('RGBA', (size, size), (*background, 255) if background else (0, 0, 0, 0))
    inner = int(size * (1 - 2 * pad))
    scaled = image.copy()
    scaled.thumbnail((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return canvas


def wordmark(draw: ImageDraw.ImageDraw, at: tuple[int, int], size: int, beta: bool) -> int:
    """Vysazi „Zdenalcity" a vrati vysku, kterou to zabralo."""
    font = ImageFont.truetype(FONT_BOLD, size)
    x, y = at
    draw.text((x, y), 'Zdenalcity', font=font, fill=(255, 255, 255))
    width = int(draw.textlength('Zdenalcity', font=font))

    if beta:
        small = ImageFont.truetype(FONT_TEXT, int(size * 0.3))
        label = 'BETA'
        pad = int(size * 0.12)
        tw = int(draw.textlength(label, font=small))
        bx = x + width + pad * 2
        by = y + int(size * 0.18)
        draw.rounded_rectangle(
            (bx, by, bx + tw + pad * 2, by + int(size * 0.42)),
            radius=int(size * 0.08),
            fill=AMBER,
        )
        draw.text((bx + pad, by + int(size * 0.06)), label, font=small, fill=DEEP)

    return int(size * 1.2)


def promo(shot: str, name: str, size: tuple[int, int], claim: str) -> None:
    """Snimek ze hry + ztmaveny pas dole + znacka. Zadna vymyslena grafika."""
    image = Image.open(os.path.join(SHOTS, shot)).convert('RGB')

    # Orez na pomer cilove plochy, at se nic nedeformuje.
    want = size[0] / size[1]
    have = image.width / image.height
    if have > want:
        wide = int(image.height * want)
        image = image.crop(((image.width - wide) // 2, 0, (image.width + wide) // 2, image.height))
    else:
        tall = int(image.width / want)
        image = image.crop((0, (image.height - tall) // 2, image.width, (image.height + tall) // 2))
    image = image.resize(size, Image.LANCZOS)

    # Prechod dolu, aby bilý text drzel na jakemkoliv snimku.
    veil = Image.new('RGBA', size, (0, 0, 0, 0))
    band = ImageDraw.Draw(veil)
    for row in range(size[1] // 2, size[1]):
        share = (row - size[1] // 2) / (size[1] / 2)
        band.line([(0, row), (size[0], row)], fill=(*DEEP, int(235 * share**1.4)))
    out = image.convert('RGBA')
    out.alpha_composite(veil)

    draw = ImageDraw.Draw(out)
    title = int(size[1] * 0.115)
    used = wordmark(draw, (int(size[0] * 0.06), int(size[1] * 0.66)), title, beta=True)
    claim_font = ImageFont.truetype(FONT_TEXT, int(title * 0.42))
    draw.text(
        (int(size[0] * 0.06), int(size[1] * 0.66) + used),
        claim,
        font=claim_font,
        fill=(226, 232, 235),
    )

    os.makedirs(PROMO, exist_ok=True)
    out.convert('RGB').save(os.path.join(PROMO, f'{name}.jpg'), quality=90, optimize=True)
    print(f'  {name}.jpg {size[0]}x{size[1]}')


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    if not os.path.exists(LOGO_RAW):
        print(f'chybi {LOGO_RAW}; nejdriv spust generate-icons.py --only logo')
        return 1

    os.makedirs(BRAND, exist_ok=True)
    logo = transparent_logo()
    # Plna velikost jen jako podklad: hra ukazuje logo nejvys 112 px siroke
    # a 787 kB PNG stahoval kazdy hrac (T134). Do `public/` jde WebP.
    os.makedirs(os.path.join(ROOT, 'art', 'brand'), exist_ok=True)
    logo.save(os.path.join(ROOT, 'art', 'brand', 'logo.png'))
    print(f'znacka {logo.size}')

    # Ikony aplikace. Maskovatelna ma vetsi rezervu, protoze systemy si z ni
    # vyriznou kruh nebo kulaty ctverec a bez rezervy by uriznuly rohy domu.
    square(logo, 192, 0.12, DEEP).save(os.path.join(BRAND, 'icon-192.png'))
    square(logo, 512, 0.12, DEEP).save(os.path.join(BRAND, 'icon-512.png'))
    square(logo, 512, 0.22, DEEP).save(os.path.join(BRAND, 'icon-maskable.png'))
    favicon = square(logo, 256, 0.06, DEEP)
    favicon.save(os.path.join(BRAND, 'favicon.png'))
    favicon.save(
        os.path.join(BRAND, 'favicon.ico'),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print('ikony: 192, 512, maskable, favicon.png, favicon.ico')

    print('propagacni obrazky:')
    promo('ctvrt.jpg', 'og-1200x630', (1200, 630), 'Stav město, které má smysl.')
    promo('nabrezi.jpg', 'ctverec-1080', (1080, 1080), 'Stav město, které má smysl.')
    promo('prehled.jpg', 'sirokouhly-1600x900', (1600, 900), 'Izometrický budovatel měst.')
    promo('detail.jpg', 'pribeh-1080x1920', (1080, 1920), 'Izometrický budovatel měst.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
