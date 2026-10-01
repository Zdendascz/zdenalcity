"""Vygeneruje ikony rozhraní v jednotném stylu T138 a zmenší je do hry.

    python tools/generate-icons.py --dry-run               # co by se generovalo
    python tools/generate-icons.py --only help,budget      # jen tyhle
    python tools/generate-icons.py --all                   # všechno, co chybí
    python tools/generate-icons.py --fit                   # jen zmenšit raw → hra
    python tools/generate-icons.py --brand                 # logo hry (oddíl Značka)

Styl drží i **reference**: `road-street.png` a `terrain-raise.png` vedle sebe
na černé jdou přes `images/edits`. Vypne se `--no-reference`.

Prompty čte ze zadání `docs/09-IKONY.md`, oddíl „Jednotný styl (T138)":
společná hlavička + věta kategorie + řádek tabulky. Ne z tabulky v sobě —
stejné pravidlo jako u budov a dlaždic, aby se kód a dokument nerozešly.

Dva kroky:

1. **Generování** do `art/icons/t138/` (1024², černé neprůhledné pozadí).
   Co tam už leží, přeskočí; `--force` přegeneruje.
2. **Zmenšení** do `content/vanilla/icons/<id>.png`, 128², černé pozadí
   zůstává. Ořízne se na obsah a vystředí, aby všechny ikony měly předmět
   stejně velký — model okraje nedrží.

`--raw-dir` a `--out-dir` přesměrují oba kroky jinam (pilot do dočasné
složky, aby se nepřepsala sada ve hře).

Sdílené kusy (`request`, TLS, `log_spend`, `MODEL`) si bere
z `generate-sprites.py` přes `importlib`, protože v názvu je pomlčka.
Klíč z `OPENAI_API_KEY`; skript ho nikam nevypisuje.

## Peníze

Každý obrázek stojí. Bez `--all` nebo `--only` se udělají jen tři.
Kvalita je výchozí `medium` (`--quality=`), útrata se píše do
`art/parts/spend.jsonl` jako všechno ostatní.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import os
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'docs' / '09-IKONY.md'
RAW = ROOT / 'art' / 'icons' / 't138'
OUT = ROOT / 'content' / 'vanilla' / 'icons'
BRAND_RAW = ROOT / 'art' / 'icons' / 'raw'

SECTION = 'Jednotný styl (T138)'
HEADER = 'Společná hlavička'
# Pořadí je i pořadí na kontaktním listu.
CATEGORIES = ('Stavba', 'Budovy', 'Vrstvy a pohledy', 'Akce a rozhraní', 'Katastrofy')

FENCE = re.compile(r'```(.*?)```', re.S)
# `| \`id\` | význam | prompt |`. Velká písmena kvůli `industrialAccident`.
ROW = re.compile(r'^\| `([A-Za-z0-9_-]+)` \| (.+?) \| (.+?) \|\s*$', re.M)
# Značka má jen dva sloupce.
BRAND_ROW = re.compile(r'^\| `([a-z0-9_-]+)` \| (.+?) \|\s*$', re.M)

PARAGRAPH = '\n\n'

# Reference stylu: stávající ikony, které autor označil za vzor.
REFERENCE_ICONS = ('road-street', 'terrain-raise')
REFERENCE_NOTE = (
    'The attached image shows two existing icons from the same set. Match their '
    'rendering style, materials, lighting, camera angle and scale exactly, but '
    'draw ONLY the new subject described here, never the subjects of the '
    'reference. Pure black background.'
)

SIZE = 128
# Delší strana obsahu ve výsledné ikoně. 108/128 ≈ 0,84 — vzor (road-street,
# terrain-raise) zabírá 0,8 až 0,9 čtverce.
CONTENT = 108
# Pixel tmavší než tohle ve všech kanálech je pozadí. Model kreslí „černou"
# jako 0–6, stín pod předmětem začíná kolem 20.
DARK = 18


def shared():
    """Kus `generate-sprites.py`, který mluví s API. Jedna kopie, ne dvě."""
    path = ROOT / 'tools' / 'generate-sprites.py'
    spec = importlib.util.spec_from_file_location('generate_sprites', path)
    if spec is None or spec.loader is None:
        raise SystemExit(f'nepodařilo se načíst {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def block(text: str, level: int, title: str) -> str:
    """Tělo nadpisu dané úrovně až po další nadpis stejné nebo vyšší úrovně."""
    hashes = '#' * level
    stop = '|'.join('#' * n + ' ' for n in range(1, level + 1))
    found = re.search(
        rf'^{hashes} {re.escape(title)}\s*$(.*?)(?=^(?:{stop})|\Z)', text, re.M | re.S
    )
    if found is None:
        raise SystemExit(f'{SPEC.name}: chybí oddíl „{title}"')
    return found.group(1)


def fence(body: str, title: str) -> str:
    found = FENCE.search(body)
    if found is None:
        raise SystemExit(f'{SPEC.name}: oddíl „{title}" nemá oplocený blok')
    return found.group(1).strip()


def read_spec() -> dict[str, tuple[str, str, str]]:
    """id → (kategorie, význam, celý prompt)."""
    text = SPEC.read_text(encoding='utf-8')
    section = block(text, 2, SECTION)
    header = fence(block(section, 3, HEADER), HEADER)
    out: dict[str, tuple[str, str, str]] = {}
    for category in CATEGORIES:
        body = block(section, 3, category)
        clause = fence(body, category)
        rows = ROW.findall(body)
        if not rows:
            raise SystemExit(f'{SPEC.name}: v oddílu „{category}" nejsou řádky')
        for name, meaning, prompt in rows:
            if name in out:
                raise SystemExit(f'{SPEC.name}: „{name}" je v zadání dvakrát')
            out[name] = (category, meaning, PARAGRAPH.join([header, clause, prompt]))
    return out


def read_brand() -> dict[str, str]:
    """Logo hry. Má vlastní hlavičku bez štítku, viz oddíl Značka."""
    body = block(SPEC.read_text(encoding='utf-8'), 2, 'Značka')
    header = fence(body, 'Značka')
    return {name: PARAGRAPH.join([header, prompt]) for name, prompt in BRAND_ROW.findall(body)}


def reference_png() -> bytes:
    """Vzorové ikony vedle sebe na černé, 1024 × 512."""
    sheet = Image.new('RGB', (1024, 512), (0, 0, 0))
    for index, name in enumerate(REFERENCE_ICONS):
        icon = Image.open(OUT / f'{name}.png').convert('RGBA').resize((448, 448), Image.LANCZOS)
        sheet.paste(icon, (index * 512 + 32, 32), icon)
    buffer = io.BytesIO()
    sheet.save(buffer, 'PNG')
    return buffer.getvalue()


def fit(source: Path, target: Path) -> None:
    """Ořízne na obsah, vystředí na černé a zmenší na 128²."""
    image = Image.open(source).convert('RGB')
    mask = image.convert('L').point(lambda v: 255 if v > DARK else 0)
    box = mask.getbbox()
    if box is None:
        raise SystemExit(f'{source.name}: celé černé')
    left, top, right, bottom = box
    side = max(right - left, bottom - top)
    # Čtverec kolem středu obsahu, s okrajem, aby obsah po zmenšení měl CONTENT px.
    frame = round(side * SIZE / CONTENT)
    cx, cy = (left + right) / 2, (top + bottom) / 2
    canvas = Image.new('RGB', (frame, frame), (0, 0, 0))
    canvas.paste(image, (round(frame / 2 - cx), round(frame / 2 - cy)))
    small = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    # Téměř černé dorovnat na čistou černou, ať všechny ikony mají stejný čtverec.
    small = small.point(lambda v: 0 if v < 6 else v)
    target.parent.mkdir(parents=True, exist_ok=True)
    small.convert('RGBA').save(target)


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--fit', action='store_true', help='jen zmenšit, nic negenerovat')
    parser.add_argument('--brand', action='store_true')
    # Reference je u ikon **zapnutá**: v pilotu T138 držela matný styl vzoru,
    # bez ní vyšla silnice jako lesklá hračka s válcem navíc. Stojí ~0,006 USD.
    parser.add_argument('--no-reference', action='store_true')
    parser.add_argument('--only', default=None)
    parser.add_argument('--model', default=None)
    parser.add_argument('--quality', default='medium')
    parser.add_argument('--raw-dir', type=Path, default=None)
    parser.add_argument('--out-dir', type=Path, default=OUT)
    args, _ = parser.parse_known_args()

    if args.brand:
        jobs = [(name, prompt) for name, prompt in read_brand().items()]
        raw = args.raw_dir or BRAND_RAW
        background = 'transparent'
    else:
        spec = read_spec()
        jobs = [(name, prompt) for name, (_, _, prompt) in spec.items()]
        raw = args.raw_dir or RAW
        background = 'opaque'

    if args.only:
        wanted = args.only.split(',')
        unknown = [name for name in wanted if name not in dict(jobs)]
        if unknown:
            print('Zadání nezná: ' + ', '.join(unknown))
            return 1
        jobs = [(name, dict(jobs)[name]) for name in wanted]

    if args.fit:
        done = 0
        for name, _ in jobs:
            source = raw / f'{name}.png'
            if source.exists():
                fit(source, args.out_dir / f'{name}.png')
                done += 1
        print(f'{done} ikon zmenšeno do {args.out_dir}')
        return 0

    missing = [job for job in jobs if args.force or not (raw / f'{job[0]}.png').exists()]
    print(f'Chybí {len(missing)} z {len(jobs)}.')
    if not missing:
        return 0
    batch = missing if (args.all or args.only) else missing[:3]

    if args.dry_run:
        print(f'\nGenerovalo by se {len(batch)}:')
        for name, _ in batch:
            print(f'   {name}')
        print('\n--dry-run: neutraceno nic.')
        return 0

    sprites = shared()
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key:
        print('\nChybí OPENAI_API_KEY. Nastav si ho v prostředí:')
        print('   setx OPENAI_API_KEY "..."      (Windows, pak nové okno)')
        print('   export OPENAI_API_KEY="..."    (bash)')
        return 1
    model = args.model or sprites.MODEL
    reference = None if (args.no_reference or args.brand) else reference_png()

    raw.mkdir(parents=True, exist_ok=True)
    done = 0
    spent = 0.0
    for name, prompt in batch:
        print(f'   {name} … ', end='', flush=True)
        if reference is not None:
            prompt = PARAGRAPH.join([prompt, REFERENCE_NOTE])
        try:
            blob = sprites.request(
                key, prompt, model, reference, sprites.SIZE_SQUARE,
                background=background, quality=args.quality,
            )
        except SystemExit as chyba:  # dávka nesmí spadnout na jedné ikoně
            print(f'chyba: {chyba}')
            continue
        (raw / f'{name}.png').write_bytes(blob)
        usd = sprites.log_spend(f'icon:{name}', sprites.SIZE_SQUARE)
        spent += usd
        if not args.brand:
            fit(raw / f'{name}.png', args.out_dir / f'{name}.png')
        done += 1
        print(f'{usd:.3f} USD', flush=True)

    print(f'\n{done} vygenerováno do {raw}, odhad {spent:.2f} USD.')
    if not args.brand:
        print(f'Zmenšeno do {args.out_dir}. Dál: python tools/make-webp.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
