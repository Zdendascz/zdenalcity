"""Naladí vygenerované dlaždice do podoby, kterou umí použít renderer.

    python tools/fit-tiles.py --check    # jen ukáže, co by udělal
    python tools/fit-tiles.py            # zapíše do content/vanilla/tiles

Bere `art/tiles/raw/*.png` (čtverec 1024 × 1024 s kosočtvercem uprostřed)
a dělá z každého **narovnaný čtverec** do `content/vanilla/tiles/`.

## Proč čtverec, a ne kosočtverec

Terén se kreslí jako **zdeformovaný čtyřúhelník** podle výšek čtyř rohů, takže
obrázek na něj musí jít jako textura na mesh. Kdyby se ukládal kosočtverec,
musel by renderer mapovat UV na jeho čtyři vrcholy a půlka textury by byla
průhledná plocha, do které se nikdy netrefí. Narovnaný čtverec má UV rohů
`(0,0)`, `(1,0)`, `(0,1)`, `(1,1)` a využije se celý.

Navíc se tím **hrany čtverce rovnají světovým stranám**: horní je sever, pravá
východ, spodní jih, levá západ — přesně masky ze `src/sim/roads.ts`. Měření
navazování se tím scvrkne na „co leží u horní hrany".

Narovnání je afinní zobrazení. Vrcholy kosočtverce v izometrii odpovídají rohům
dlaždice takhle: horní je severozápadní roh, pravý severovýchodní, levý
jihozápadní, spodní jihovýchodní — plyne to z `gridToScreen`, kde `+x` míří
doprava dolů a `+y` doleva dolů.

## Navazování

U vozovky a potrubí se měří, jestli povrch protíná hranu tam, kde má: uprostřed
a v polovině její délky. Sousední dlaždice na sebe jinak nesednou a na každém
spoji bude schod. Skript to **jen změří a ohlásí** — opravovat obrázek by
znamenalo domalovat, co v něm není.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'tiles' / 'raw'
OUT = ROOT / 'content' / 'vanilla' / 'tiles'
INDEX = OUT / 'index.json'

# Hrana narovnaného čtverce. Kosočtverec je na obrazovce 256 px široký
# (64 px dlaždice × 4), a jeho úhlopříčka je stranou čtverce, takže 256 je
# spíš víc než dost. Kulaté číslo se líp mipmapuje.
SIZE = 256

# Pořadí hran čtverce a masky, které jim odpovídají.
EDGES = (('n', 1), ('e', 2), ('s', 4), ('w', 8))

# Vozovka má hranu protínat uprostřed.
SEAM_CENTRE = 0.5
# Kolik smí utéct, než to skript ohlásí. Desetina hrany je při 64 px dlaždici
# šest pixelů — pod tím spoj oko nepozná.
SEAM_TOLERANCE = 0.10

# Šířka se **neporovnává s pevným číslem**, ale s tím, co dělají ostatní
# dlaždice téže rodiny. Pro spoj není podstatné, jak je vozovka široká, ale
# jestli je na obou stranách stejná. Zadání chtělo polovinu hrany a generátor
# dělá zhruba třetinu — kdyby se trvalo na polovině, zahodily by se obrázky,
# které na sebe sedí.
WIDTH_TOLERANCE = 0.08

# Asfalt a beton jsou **šedé**, tráva a listí zelené. Jas je nerozliší: naměřeno
# 89 na trávě a 108 na asfaltu, tedy překryv. Sytost je odděluje na první
# pohled — 70 % proti 10 %.
SATURATION_ROAD = 0.30

# Povrchy téhož druhu se srovnají na **společný průměrný tón**.
#
# Varianty mají dělat rozdíl uvnitř kresby, ne mezi dlaždicemi. Naměřeno na
# trávě: tři varianty měly průměrný jas 84, 94 a 101, tedy rozpětí přes 20 %,
# a mapa z toho vyšla jako kostkovaný ubrus — autor to nahlásil. Srovnává se
# **kanál po kanálu**, aby se s jasem nerozešel i odstín.
SURFACE_FAMILIES = ('grass', 'water', 'sand', 'rock', 'forest', 'marsh')


def shared():
    """`key_out` a spol. z `fit-sprites.py`. Jedna kopie klíčování, ne dvě."""
    path = ROOT / 'tools' / 'fit-sprites.py'
    spec = importlib.util.spec_from_file_location('fit_sprites', path)
    if spec is None or spec.loader is None:
        raise SystemExit(f'nepodařilo se načíst {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def diamond_corners(image: Image.Image) -> tuple[tuple[float, float], ...] | None:
    """Vrcholy kosočtverce: horní, pravý, spodní, levý.

    Bere obálku neprůhledných pixelů a za vrcholy považuje středy jejích stran.
    Zadání říká, že se rohy kosočtverce dotýkají středů stran obrázku, takže
    obálka je celý kosočtverec a nic víc.
    """
    alpha = np.asarray(image)[:, :, 3]
    rows = np.where(alpha.max(axis=1) > 8)[0]
    cols = np.where(alpha.max(axis=0) > 8)[0]
    if rows.size == 0 or cols.size == 0:
        return None

    y0, y1 = float(rows[0]), float(rows[-1])
    x0, x1 = float(cols[0]), float(cols[-1])
    if x1 - x0 < 16 or y1 - y0 < 16:
        return None

    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    return ((mx, y0), (x1, my), (mx, y1), (x0, my))


def deskew(image: Image.Image, corners: tuple[tuple[float, float], ...]) -> Image.Image:
    """Kosočtverec na čtverec `SIZE × SIZE`.

    `Image.transform` s AFFINE počítá **zpětně**: pro výstupní pixel `(u, v)`
    si řekne o zdrojový `(a·u + b·v + c, d·u + e·v + f)`. Dosazuje se tedy
    rovnou zobrazení ze čtverce do kosočtverce, ne obráceně.
    """
    top, right, _bottom, left = corners
    # (0,0) = severozápad = horní vrchol; +u míří k severovýchodu (pravý
    # vrchol), +v k jihozápadu (levý vrchol).
    a = (right[0] - top[0]) / SIZE
    b = (left[0] - top[0]) / SIZE
    c = top[0]
    d = (right[1] - top[1]) / SIZE
    e = (left[1] - top[1]) / SIZE
    f = top[1]
    return image.transform((SIZE, SIZE), Image.AFFINE, (a, b, c, d, e, f), Image.BICUBIC)


def edge_band(square: Image.Image, edge: str) -> tuple[float, float] | None:
    """Kde hranu protíná zpevněný povrch. Vrací střed a šířku v podílu hrany.

    Pozná se podle **sytosti**, ne podle jasu: asfalt i betonová trubka jsou
    šedé, tráva a listí zelené. Jas se překrývá — na trávě 89, na asfaltu 108 —
    takže práh na jasu měřil kdeco, jen ne vozovku.

    Čte se pás **kousek pod hranou**, ne první řádek pixelů: na samé hraně bývá
    lem po klíčování a ten by měření posunul.
    """
    rgb = np.asarray(square.convert('RGB')).astype(np.float32)
    top = rgb.max(axis=2)
    saturation = np.where(top > 0, (top - rgb.min(axis=2)) / np.maximum(top, 1.0), 0.0)
    inset = 6

    if edge == 'n':
        line = saturation[inset, :]
    elif edge == 's':
        line = saturation[-1 - inset, :]
    elif edge == 'w':
        line = saturation[:, inset]
    else:
        line = saturation[:, -1 - inset]

    hit = line < SATURATION_ROAD

    # Nejdelší souvislý úsek. Vozovka je jeden pruh; drobné skvrny se zahodí.
    best_start, best_len, start = -1, 0, -1
    for i, value in enumerate(hit):
        if value and start < 0:
            start = i
        elif not value and start >= 0:
            if i - start > best_len:
                best_start, best_len = start, i - start
            start = -1
    if start >= 0 and len(hit) - start > best_len:
        best_start, best_len = start, len(hit) - start

    # Kratší než osmina hrany je skvrna, delší než devět desetin je celá hrana.
    # Ani jedno není pruh vozovky.
    if best_len < len(hit) // 8 or best_len > len(hit) * 0.9:
        return None
    return ((best_start + best_len / 2) / len(hit), best_len / len(hit))


def mean_colour(square: Image.Image) -> tuple[float, float, float]:
    """Průměrná barva kryté části. Průhledné pixely by průměr stáhly k nule."""
    rgba = np.asarray(square.convert('RGBA')).astype(np.float32)
    mask = rgba[:, :, 3] > 8
    if not mask.any():
        return (0.0, 0.0, 0.0)
    pixels = rgba[:, :, :3][mask]
    return (float(pixels[:, 0].mean()), float(pixels[:, 1].mean()), float(pixels[:, 2].mean()))


def match_tone(square: Image.Image, source: tuple[float, float, float], target: tuple[float, float, float]) -> Image.Image:
    """Přebarví dlaždici tak, aby měla průměrný tón `target`.

    Násobí se, ne přičítá: násobení drží nulu na nule, takže se ze stínů nestane
    šeď. Ořezává se na 255, což u světlé trávy ubere kousek kontrastu — pořád
    lepší než kostkovaná mapa.
    """
    rgba = np.asarray(square.convert('RGBA')).astype(np.float32)
    for channel in range(3):
        if source[channel] <= 1.0:
            continue
        rgba[:, :, channel] = np.clip(rgba[:, :, channel] * (target[channel] / source[channel]), 0, 255)
    return Image.fromarray(rgba.astype(np.uint8), 'RGBA')


def measure(name: str, square: Image.Image) -> dict | None:
    """Změří všechny čtyři hrany. `None` u povrchů, ty navazovat nemusí."""
    family, _, shape = name.partition('__')
    if family not in ('street', 'avenue', 'highway', 'pipe'):
        return None

    mask = 0
    for letter, bit in EDGES:
        if letter in shape:
            mask |= bit
    # `shape` je `0` u osamocené dlaždice a jinak písmena; `n` v `nesw` sedí.
    if shape == '0':
        mask = 0

    return {
        'family': family,
        'mask': mask,
        'bands': {letter: edge_band(square, letter) for letter, _ in EDGES},
    }


def seam_report(name: str, sample: dict, median_width: float | None) -> list[str]:
    """Co na navazování nesedí. Prázdný seznam znamená v pořádku."""
    problems: list[str] = []
    for letter, bit in EDGES:
        band = sample['bands'][letter]
        connected = (sample['mask'] & bit) != 0
        if connected and band is None:
            problems.append(f'{letter}: má navazovat, ale hrana je prázdná')
            continue
        if not connected and band is not None:
            problems.append(f'{letter}: nemá navazovat, a přesto tam vozovka je')
            continue
        if band is None:
            continue
        centre, width = band
        if abs(centre - SEAM_CENTRE) > SEAM_TOLERANCE:
            problems.append(f'{letter}: střed {centre:.2f} místo {SEAM_CENTRE:.2f}')
        if median_width is not None and abs(width - median_width) > WIDTH_TOLERANCE:
            problems.append(f'{letter}: šířka {width:.2f}, ostatní mají {median_width:.2f}')
    return problems


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    check = '--check' in sys.argv
    if not RAW.exists():
        print(f'Složka {RAW.relative_to(ROOT)} neexistuje.')
        return 1

    sprites = shared()
    files = sorted(RAW.glob('*.png'))
    if not files:
        print('V raw/ nic není.')
        return 1

    # **Dva průchody.** Šířka vozovky se porovnává s tím, co dělá zbytek rodiny,
    # takže se nejdřív musí změřit všechno a teprve pak soudit.
    squares: dict[str, Image.Image] = {}
    samples: dict[str, dict] = {}
    failed = 0
    for path in files:
        keyed = sprites.key_out(Image.open(path))
        corners = diamond_corners(keyed)
        if corners is None:
            print(f'  {path.stem}: kosočtverec nenalezen — jiné pozadí?')
            failed += 1
            continue
        square = deskew(keyed, corners)
        squares[path.stem] = square
        sample = measure(path.stem, square)
        if sample is not None:
            samples[path.stem] = sample

    # Srovnání tónu uvnitř rodiny povrchů. Cíl je **medián** průměrů, ne průměr
    # průměrů: jedna ujetá varianta by průměr stáhla a posunula i ty dvě dobré.
    tones: dict[str, list[tuple[float, float, float]]] = {}
    for name, square in squares.items():
        family = name.partition('__')[0]
        if family in SURFACE_FAMILIES:
            tones.setdefault(family, []).append(mean_colour(square))
    for family, values in tones.items():
        target = (
            float(np.median([v[0] for v in values])),
            float(np.median([v[1] for v in values])),
            float(np.median([v[2] for v in values])),
        )
        for name in list(squares):
            if name.partition('__')[0] != family:
                continue
            squares[name] = match_tone(squares[name], mean_colour(squares[name]), target)

    medians: dict[str, float] = {}
    for family in {s['family'] for s in samples.values()}:
        widths = [
            band[1]
            for name, s in samples.items()
            if s['family'] == family
            for letter, bit in EDGES
            if (s['mask'] & bit) != 0 and (band := s['bands'][letter]) is not None
        ]
        if widths:
            medians[family] = float(np.median(widths))

    seams = 0
    for name in sorted(samples):
        problems = seam_report(name, samples[name], medians.get(samples[name]['family']))
        if problems:
            seams += 1
            print(f'  {name}:')
            for problem in problems:
                print(f'      {problem}')

    index: list[dict] = []
    for name in sorted(squares):
        family, _, shape = name.partition('__')
        index.append({'tile': family, 'shape': shape, 'file': f'{name}.png', 'size': SIZE})
        if not check:
            OUT.mkdir(parents=True, exist_ok=True)
            squares[name].save(OUT / f'{name}.png')

    if not check:
        INDEX.write_text(
            json.dumps(
                {'formatVersion': 1, 'size': SIZE, 'tiles': index}, ensure_ascii=False, indent=2
            )
            + chr(10),
            encoding='utf-8',
        )

    print()
    print(f'{len(index)} z {len(files)} {"by prošlo" if check else "zpracováno"}.')
    if failed:
        print(f'{failed} bez rozpoznaného kosočtverce.')
    if medians:
        sirky = ', '.join(f'{f} {w:.2f}' for f, w in sorted(medians.items()))
        print(f'Šířka vozovky na hraně (medián rodiny): {sirky}')
    print(f'{seams} z {len(samples)} navazujících dlaždic má vadu.')
    if not check:
        print(f'Zapsáno do {OUT.relative_to(ROOT)}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
