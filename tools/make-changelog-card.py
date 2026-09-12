"""Karta se seznamem oprav pro Discord.

    python tools/make-changelog-card.py

Vznikne `art/promo/discord-opravy.jpg`, 1600 x 900 -- poměr, který Discord
ukáže v příspěvku celý, bez oříznutí.

Skládá se **z toho, co hra opravdu má**, stejně jako `make-promo.py`: snímek
z hraní a kreslený detail. Nic se nedokresluje; obrázek k příspěvku o opravách
musí ukazovat tutéž hru, které se ty opravy týkají.

Styl je převzatý z `make-promo.py` -- tytéž barvy, šikmý pruh, závoj s plošinou
a jantarový rám. Funkce se **nesdílejí importem**, protože `make-promo.py`
volá `main()` rovnou při načtení a přepíná pracovní adresář natvrdo, takže by
import přegeneroval reklamní obrázky. Kdyby těch skriptů bylo víc, patří
společné kousky do vlastního modulu.
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'art', 'promo')

FONT_BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
FONT = 'C:/Windows/Fonts/segoeui.ttf'

AMBER = (240, 160, 32)
DARK = (11, 22, 28)
TEXT = (235, 242, 245)
DIM = (168, 190, 199)
URL = 'games.zdendas.cz/zdenalcity/'

SIZE = (1600, 900)
HEADING = 'Opravy za poslední dva dny'

# Titulek a jednořádkové vysvětlení. Delší text patří do příspěvku, ne na
# obrázek -- na kartě má čtenář poznat, čeho se opravy týkají, ne je přečíst.
ITEMS = [
    ('Uložené město se zase načte',
     'Financování služeb nad 100 % už uložení nerozbije.'),
    ('Pojistka před každým uložením',
     'Save, který by se nenačetl, nepřepíše ten poslední funkční.'),
    ('Otevření souboru za běhu hry',
     'Kamera skočí na město, jiná velikost mapy se dořeší restartem.'),
    ('Velká města bez přetečení čísel',
     'Čísel budov jsou teď miliardy místo 65 535.'),
    ('Poradce už nemluví o věznici',
     'Věznice už nepřebíjí hodnocení služeb ani pochvalu.'),
]


def cover(path: str, size: tuple[int, int]) -> Image.Image:
    """Obrázek roztažený na plochu tak, aby ji vyplnil a nezdeformoval se."""
    im = Image.open(os.path.join(ROOT, 'public', path)).convert('RGB')
    tw, th = size
    scale = max(tw / im.width, th / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    left = (im.width - tw) // 2
    top = (im.height - th) // 2
    return im.crop((left, top, left + tw, top + th))


def slant(size: tuple[int, int], top_x: float, bottom_x: float, feather: int = 2) -> Image.Image:
    """Maska šikmého pruhu: vpravo od úsečky (top_x → bottom_x) je plno."""
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    w, h = size
    draw.polygon([(top_x, 0), (w, 0), (w, h), (bottom_x, h)], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(feather))


def veil(size: tuple[int, int], hold: float, fade: float, strength: int) -> Image.Image:
    """Tmavý závoj zleva s plošinou, aby text držel i nad světlým snímkem."""
    w, h = size
    ramp = Image.new('L', (w, 1), 0)
    px = ramp.load()
    start = hold * w
    edge = max(1.0, (fade - hold) * w)
    for x in range(w):
        if x <= start:
            px[x, 0] = strength
            continue
        t = min(1.0, (x - start) / edge)
        px[x, 0] = int(strength * (1 - t) ** 1.5)
    return ramp.resize((w, h), Image.BILINEAR)


def write(draw, xy, text, font, fill) -> None:
    """Text se stínem: závoj pak stačí poloviční a město pod ním je vidět."""
    x, y = xy
    draw.text((x + 2, y + 2), text, font=font, fill=(6, 12, 16))
    draw.text((x, y), text, font=font, fill=fill)


def logo(height: int) -> Image.Image:
    """Značka hry oříznutá na svůj obsah a zmenšená na danou výšku."""
    im = Image.open(os.path.join(ROOT, 'public', 'brand', 'logo.png')).convert('RGB')
    box = im.convert('L').point(lambda v: 255 if v > 18 else 0).getbbox()
    if box:
        im = im.crop(box)
    scale = height / im.height
    return im.resize((max(1, round(im.width * scale)), height), Image.LANCZOS)


def mask_from(im: Image.Image) -> Image.Image:
    """Maska loga ze světlosti: černé pozadí zmizí, záře zůstane."""
    return im.convert('L').point(lambda v: min(255, int(v * 2.2)))


def frame(canvas: Image.Image) -> None:
    """Jantarový rám. Drží kompozici pohromadě na tmavém i světlém feedu."""
    w, h = canvas.size
    thickness = max(3, w // 300)
    ImageDraw.Draw(canvas).rectangle(
        [thickness // 2, thickness // 2, w - thickness // 2 - 1, h - thickness // 2 - 1],
        outline=AMBER,
        width=thickness,
    )


def card() -> Image.Image:
    canvas = cover('shots/prehled.jpg', SIZE)
    band = cover('scenes/namesti.jpg', SIZE)
    canvas.paste(band, (0, 0), slant(SIZE, 0.66 * SIZE[0], 0.78 * SIZE[0]))
    ImageDraw.Draw(canvas).line(
        [(0.66 * SIZE[0], 0), (0.78 * SIZE[0], SIZE[1])], fill=AMBER, width=4,
    )
    canvas.paste(Image.new('RGB', SIZE, DARK), (0, 0), veil(SIZE, 0.46, 0.84, 214))

    mark = logo(120)
    canvas.paste(mark, (72, 60), mask_from(mark))

    draw = ImageDraw.Draw(canvas)
    brand = ImageFont.truetype(FONT_BOLD, 62)
    write(draw, (232, 88), 'Zdenalcity', brand, TEXT)

    write(draw, (76, 232), HEADING, ImageFont.truetype(FONT_BOLD, 48), TEXT)

    title = ImageFont.truetype(FONT_BOLD, 32)
    note = ImageFont.truetype(FONT, 25)
    limit = 0.80 * SIZE[0]
    for i, (head, tail) in enumerate(ITEMS):
        y = 322 + i * 104
        write(draw, (78, y), '•', title, AMBER)
        write(draw, (112, y), head, title, TEXT)
        write(draw, (112, y + 42), tail, note, DIM)
        for text, font in ((head, title), (tail, note)):
            end = 112 + draw.textlength(text, font=font)
            if end > limit:
                print(f'POZOR: radek presahuje do obrazku o {end - limit:.0f} px: {text}')

    write(draw, (76, 838), URL, ImageFont.truetype(FONT_BOLD, 32), AMBER)
    frame(canvas)
    return canvas


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'discord-opravy.jpg')
    image = card()
    image.save(path, quality=92)
    print(path, image.size)


if __name__ == '__main__':
    main()
