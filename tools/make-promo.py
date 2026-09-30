"""Reklamní obrázky Zdenalcity pro sociální sítě.

    python tools/make-promo.py

Vznikne `art/promo/` se třemi soubory: širokoúhlý 1200 × 630 na sdílení
odkazu, čtverec 1080 × 1080 na příspěvek a stojatá story 1080 × 1920.

Skládá se **z toho, co hra opravdu má** — snímky z hraní (`shots/…`, zdroj
`art/screenshots/`) a kreslené detaily (`scenes/…`, zdroj `art/scenes/`).
Od T134 jsou v `public/` jen zmenšené WebP, takže se bere rovnou podklad. Nic se negeneruje: reklama, na které je
jiná grafika než ve hře, je lež, kterou první hráč odhalí.

Pruhy jsou šikmé a oddělené tenkou jantarovou linkou, aby ze dvou různých
zdrojů byla jedna kompozice a ne koláž. Text sedí na tmavém závoji, jinak by
se na světlém snímku ztratil.
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

os.chdir('D:/Projekty/citybuilder')

OUT = 'art/promo'
FONT_BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
FONT = 'C:/Windows/Fonts/segoeui.ttf'

AMBER = (240, 160, 32)
DARK = (11, 22, 28)
TEXT = (235, 242, 245)
DIM = (168, 190, 199)
URL = 'games.zdendas.cz/zdenalcity/'


def source(path: str) -> str:
    """Podklad v `art/` k obrázku, jak ho zná rozcestník (`shots/ctvrt.jpg`)."""
    folder, name = path.split('/')
    stem = os.path.splitext(name)[0]
    if folder == 'shots':
        return os.path.join('art', 'screenshots', f'{stem}.jpg')
    return os.path.join('art', folder, f'{stem}.png')


def cover(path: str, size: tuple[int, int]) -> Image.Image:
    """Obrázek roztažený na plochu tak, aby ji vyplnil a nezdeformoval se."""
    im = Image.open(source(path)).convert('RGB')
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


def veil(size: tuple[int, int], hold: float, fade: float, strength: int = 246) -> Image.Image:
    """
    Tmavý závoj zleva. Text na něm drží i nad světlým snímkem.

    Má **plošinu, ne jen doběh**: první verze začínala slábnout hned od kraje
    a bílý text nad prosluněným snímkem města se nedal přečíst. Do `hold`
    podílu šířky je závoj plný, teprve pak se do `fade` rozpustí.
    """
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


def line(canvas: Image.Image, top: tuple[float, float], bottom: tuple[float, float], width: int) -> None:
    """Tenká jantarová linka na švu mezi pruhy."""
    ImageDraw.Draw(canvas).line([top, bottom], fill=AMBER, width=width)


def logo(height: int) -> Image.Image:
    """Značka hry oříznutá na svůj obsah a zmenšená na danou výšku."""
    im = Image.open('art/brand/logo.png').convert('RGB')
    # Logo má vlastní černé pozadí kvůli záři; na tmavém plakátu se hodí,
    # ale okraje se musí uříznout, aby kolem nebyl obdélník.
    box = im.convert('L').point(lambda v: 255 if v > 18 else 0).getbbox()
    if box:
        im = im.crop(box)
    scale = height / im.height
    return im.resize((max(1, round(im.width * scale)), height), Image.LANCZOS)


def paste_screen(canvas: Image.Image, im: Image.Image) -> None:
    """Vloží obrázek se sčítacím režimem, aby černé pozadí loga zmizelo."""
    base = canvas.crop((0, 0, im.width, im.height))
    canvas.paste(Image.blend(base, Image.new('RGB', im.size, (0, 0, 0)), 0), (0, 0))


def write(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
) -> None:
    """
    Text se stínem.

    Bez stínu musí být závoj pod textem skoro černý, a pak není vidět město —
    a ukázat město je celý smysl reklamy. Se stínem stačí závoj poloviční
    a snímek pod ním zůstane čitelný jako pozadí.
    """
    x, y = xy
    draw.text((x + 2, y + 2), text, font=font, fill=(6, 12, 16))
    draw.text((x, y), text, font=font, fill=fill)


def beta_pill(draw: ImageDraw.ImageDraw, x: float, y: float, size: int) -> tuple[float, float]:
    """Štítek BETA. Vrací pravý okraj a spodek."""
    font = ImageFont.truetype(FONT_BOLD, size)
    text = 'BETA'
    tw = draw.textlength(text, font=font)
    pad_x, pad_y = size * 0.62, size * 0.42
    box = (x, y, x + tw + pad_x * 2, y + size + pad_y * 2)
    draw.rounded_rectangle(box, radius=(box[3] - box[1]) / 2, fill=AMBER)
    draw.text((x + pad_x, y + pad_y - size * 0.12), text, font=font, fill=DARK)
    return box[2], box[3]


def compose(size: tuple[int, int], shots: list[str], cuts: list[tuple[float, float]]) -> Image.Image:
    """Podklad: první obrázek přes celou plochu, další v šikmých pruzích."""
    canvas = cover(shots[0], size)
    for path, (top_x, bottom_x) in zip(shots[1:], cuts):
        band = cover(path, size)
        mask = slant(size, top_x * size[0], bottom_x * size[0])
        canvas.paste(band, (0, 0), mask)
        line(canvas, (top_x * size[0], 0), (bottom_x * size[0], size[1]), max(2, size[0] // 400))
    return canvas


def darken(canvas: Image.Image, hold: float, fade: float, strength: int = 246) -> None:
    canvas.paste(Image.new('RGB', canvas.size, DARK), (0, 0), veil(canvas.size, hold, fade, strength))


def frame(canvas: Image.Image) -> None:
    """Jantarový rám. Drží kompozici pohromadě na bílém i tmavém feedu."""
    w, h = canvas.size
    thickness = max(3, w // 300)
    ImageDraw.Draw(canvas).rectangle(
        [thickness // 2, thickness // 2, w - thickness // 2 - 1, h - thickness // 2 - 1],
        outline=AMBER,
        width=thickness,
    )


def wide() -> Image.Image:
    """1200 × 630 — odkaz na Facebooku, LinkedInu, Discordu."""
    size = (1200, 630)
    canvas = compose(
        size,
        ['shots/prehled.jpg', 'scenes/ulice.jpg', 'scenes/prucelu.jpg'],
        [(0.52, 0.66), (0.78, 0.90)],
    )
    canvas = canvas.convert('RGB')
    darken(canvas, 0.30, 0.66, 198)

    mark = logo(190)
    canvas.paste(mark, (64, 96), mask_from(mark))

    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT_BOLD, 96)
    write(draw, (250, 118), 'Zdenalcity', title, TEXT)
    right = 250 + draw.textlength('Zdenalcity', font=title)
    beta_pill(draw, right + 18, 132, 28)

    write(draw, (252, 232), 'Izometrický budovatel měst.', ImageFont.truetype(FONT, 34), TEXT)

    small = ImageFont.truetype(FONT, 26)
    for i, item in enumerate([
        'Postav město od první ulice po sídliště.',
        'Voda, proud, doprava, služby i katastrofy.',
        'Běží v prohlížeči, nic se neinstaluje.',
    ]):
        write(draw, (252, 300 + i * 40), '•', small, AMBER)
        write(draw, (276, 300 + i * 40), item, small, TEXT)

    url(draw, 64, 540, 34)
    frame(canvas)
    return canvas


def square() -> Image.Image:
    """1080 × 1080 — Instagram, Facebook post."""
    size = (1080, 1080)
    # U čtverce se pruh vede **vodorovně**: horní dvě třetiny hra, spodní
    # detail z úrovně očí. Šikmý pruh jako u širokoúhlého tu nefunguje —
    # ve čtverci nemá kam vést a rozseká obě poloviny.
    canvas = cover('shots/ctvrt.jpg', size).convert('RGB')
    band = cover('scenes/namesti.jpg', (1080, 380))
    canvas.paste(band, (0, 700))
    line(canvas, (0, 700), (1080, 700), 4)
    top = Image.new('RGB', size, DARK)
    ramp = Image.new('L', (1, size[1]), 0)
    px = ramp.load()
    for y in range(size[1]):
        t = min(1.0, y / 520)
        px[0, y] = int(210 * (1 - min(1.0, max(0.0, (y - 300) / 320))) ** 1.4)
    canvas.paste(top, (0, 0), ramp.resize(size, Image.BILINEAR))

    mark = logo(200)
    canvas.paste(mark, (72, 84), mask_from(mark))

    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT_BOLD, 104)
    write(draw, (72, 300), 'Zdenalcity', title, TEXT)
    right = 72 + draw.textlength('Zdenalcity', font=title)
    beta_pill(draw, right + 20, 316, 30)
    write(draw, (74, 424), 'Izometrický budovatel měst.', ImageFont.truetype(FONT, 38), TEXT)
    write(draw, (74, 478), 'Beta verze, hraje se v prohlížeči.', ImageFont.truetype(FONT, 30), DIM)

    url(draw, 72, 964, 36)
    frame(canvas)
    return canvas


def story() -> Image.Image:
    """1080 × 1920 — stories a Reels."""
    size = (1080, 1920)
    canvas = cover('shots/nabrezi.jpg', size)
    band = cover('scenes/sidliste.jpg', (1080, 640))
    canvas.paste(band, (0, 1120))
    line(canvas, (0, 1120), (1080, 1120), 5)
    band2 = cover('shots/detail.jpg', (1080, 160))
    canvas.paste(band2, (0, 1760))
    line(canvas, (0, 1760), (1080, 1760), 5)

    canvas = canvas.convert('RGB')
    top = Image.new('RGB', size, DARK)
    ramp = Image.new('L', (1, size[1]), 0)
    px = ramp.load()
    for y in range(size[1]):
        t = min(1.0, y / 900)
        px[0, y] = int(210 * (1 - min(1.0, max(0.0, (y - 620) / 420))) ** 1.3)
    canvas.paste(top, (0, 0), ramp.resize(size, Image.BILINEAR))

    mark = logo(300)
    canvas.paste(mark, (72, 180), mask_from(mark))

    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT_BOLD, 116)
    write(draw, (72, 540), 'Zdenalcity', title, TEXT)
    right = 72 + draw.textlength('Zdenalcity', font=title)
    beta_pill(draw, right + 22, 560, 32)
    write(draw, (74, 680), 'Izometrický budovatel měst.', ImageFont.truetype(FONT, 44), TEXT)

    small = ImageFont.truetype(FONT, 34)
    for i, item in enumerate([
        'Od první ulice po sídliště.',
        'Voda, proud, doprava, služby.',
        'Požáry, povodně, nepokoje.',
        'V prohlížeči, zadarmo, česky.',
    ]):
        write(draw, (74, 780 + i * 56), '•', small, AMBER)
        write(draw, (106, 780 + i * 56), item, small, TEXT)

    url(draw, 72, 1830, 40)
    frame(canvas)
    return canvas


def mask_from(im: Image.Image) -> Image.Image:
    """Maska loga ze světlosti: černé pozadí zmizí, záře zůstane."""
    return im.convert('L').point(lambda v: min(255, int(v * 2.2)))


def url(draw: ImageDraw.ImageDraw, x: float, y: float, size: int) -> None:
    """Adresa. Jantarová a tučná — je to jediné, co má čtenář udělat."""
    font = ImageFont.truetype(FONT_BOLD, size)
    write(draw, (x, y), URL, font, AMBER)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for name, image in (('zdenalcity-wide.jpg', wide()),
                        ('zdenalcity-square.jpg', square()),
                        ('zdenalcity-story.jpg', story())):
        path = os.path.join(OUT, name)
        image.save(path, quality=92)
        print(path, image.size)


main()
