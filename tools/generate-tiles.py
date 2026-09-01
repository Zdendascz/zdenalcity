"""Vygeneruje obrázky dlaždic přes OpenAI API do `art/tiles/raw/`.

    python tools/generate-tiles.py --dry-run        # co by se generovalo
    python tools/generate-tiles.py --only grass     # jeden povrch
    python tools/generate-tiles.py --only street    # jeden typ vozovky
    python tools/generate-tiles.py --all            # všechno, co chybí

Prompty čte ze zadání `docs/08-DLAZDICE.md`, ne z tabulky v sobě — stejné
pravidlo jako u budov. Klíč z `OPENAI_API_KEY`; skript ho nikam nevypisuje.

Sdílené kusy (`request`, TLS, model) si bere z `generate-sprites.py` přes
`importlib`, protože v názvu je pomlčka. Je to ošklivé, ale lepší než druhá
kopie kódu, který mluví s API.

Bez `--all` se udělají jen tři obrázky. Každé spuštění stojí peníze.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'docs' / '08-DLAZDICE.md'
OUT = ROOT / 'art' / 'tiles' / 'raw'

# Povrchy mají tři varianty, aby se sousední dlaždice neopakovaly.
VARIANTS = ('a', 'b', 'c')

# Oplocený blok v dokumentu. První je hlavička stylu, druhý věta o navazování
# vozovky. Potrubí ji má stejnou, jen s jiným slovem — dokument to tak říká
# a skript to tak dělá, aby nebyla dvakrát.
FENCE = re.compile(r'```(.*?)```', re.S)

# `### `grass`` — id povrchu. Za nadpisem je tabulka variant.
SURFACE = re.compile(r'^### `([a-z_]+)`\s*$(.*?)(?=^### |^## |\Z)', re.M | re.S)
VARIANT_ROW = re.compile(r'^\| \*\*([abc])\*\* \| (.+?) \|\s*$', re.M)

# Řádky tabulek typů a tvarů: `| id | popis |` a `| maska | id | popis |`.
TYPE_ROW = re.compile(r'^\| `([a-z_]+)` \| (.+?) \|\s*$', re.M)
# Tvar bez napojení má id `0`, takže i číslice — jinak z šestnácti tvarů
# projde patnáct a chybí zrovna ten osamocený.
SHAPE_ROW = re.compile(r'^\| (\d+) \| `([a-z0-9]+)` \| (.+?) \|\s*$', re.M)

PARAGRAPH = '''

'''


def shared():
    """Kus `generate-sprites.py`, který mluví s API. Jedna kopie, ne dvě."""
    path = ROOT / 'tools' / 'generate-sprites.py'
    spec = importlib.util.spec_from_file_location('generate_sprites', path)
    if spec is None or spec.loader is None:
        raise SystemExit(f'nepodařilo se načíst {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def section(text: str, title: str) -> str:
    """Tělo oddílu `## <title>` až po další `## `."""
    found = re.search(
        rf'^## {re.escape(title)}\s*$(.*?)(?=^## |\Z)', text, re.M | re.S
    )
    return found.group(1) if found else ''


def read_spec() -> dict:
    """Hlavička stylu, věty o navazování, povrchy, typy vozovek a tvary."""
    text = SPEC.read_text(encoding='utf-8')
    fences = [f.strip() for f in FENCE.findall(text)]
    if len(fences) < 2:
        raise SystemExit(f'{SPEC.name}: čekám dva oplocené bloky, mám {len(fences)}')

    header, road_seam, *_ = fences
    # Věta o navazování je u potrubí stejná, jen jiné slovo — říká to dokument.
    pipe_seam = road_seam.replace('carriageway', 'pipe')

    surfaces: dict[str, dict[str, str]] = {}
    for name, body in SURFACE.findall(section(text, 'Povrchy')):
        rows = dict(VARIANT_ROW.findall(body))
        if set(rows) != set(VARIANTS):
            raise SystemExit(f'{SPEC.name}: povrch „{name}" nemá varianty a/b/c')
        surfaces[name] = rows

    roads = section(text, 'Silnice')
    types = dict(TYPE_ROW.findall(roads))
    shapes = {shape: prompt for _, shape, prompt in SHAPE_ROW.findall(roads)}
    if len(shapes) != 16:
        raise SystemExit(f'{SPEC.name}: čekám 16 tvarů vozovky, mám {len(shapes)}')

    pipes = dict(TYPE_ROW.findall(section(text, 'Potrubí')))

    return {
        'header': header,
        'road_seam': road_seam,
        'pipe_seam': pipe_seam,
        'surfaces': surfaces,
        'types': types,
        'shapes': shapes,
        'pipes': pipes,
    }


def plan(spec: dict) -> list[tuple[str, str]]:
    """Co se má vygenerovat: dvojice `(jméno souboru, prompt)`."""
    jobs: list[tuple[str, str]] = []

    for name, rows in spec['surfaces'].items():
        for variant in VARIANTS:
            jobs.append((f'{name}__{variant}', PARAGRAPH.join([spec['header'], rows[variant]])))

    for family, seam in (('types', 'road_seam'), ('pipes', 'pipe_seam')):
        for name, popis in spec[family].items():
            for shape, tvar in spec['shapes'].items():
                jobs.append((
                    f'{name}__{shape}',
                    PARAGRAPH.join([spec['header'], popis, tvar, spec[seam]]),
                ))

    return jobs


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--only', default=None)
    parser.add_argument('--model', default=None)
    args, _ = parser.parse_known_args()

    spec = read_spec()
    jobs = plan(spec)
    if args.only:
        jobs = [j for j in jobs if j[0].split('__')[0] == args.only]
        if not jobs:
            print(f'„{args.only}" v zadání není')
            return 1

    OUT.mkdir(parents=True, exist_ok=True)
    missing = [j for j in jobs if not (OUT / f'{j[0]}.png').exists()]
    print(f'Chybí {len(missing)} z {len(jobs)}.')
    if not missing:
        return 0

    # Bez --all jen tři: menší dávka, kterou jde posoudit, než se pustí zbytek.
    batch = missing if (args.all or args.only) else missing[:3]

    if args.dry_run:
        print(f'\nGenerovalo by se {len(batch)}:')
        for name, _ in batch:
            print(f'   {name}')
        print('\n--dry-run: neutraceno nic.')
        return 0

    import os

    sprites = shared()
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key:
        print()
        print('Chybí OPENAI_API_KEY. Nastav si ho v prostředí:')
        print('   setx OPENAI_API_KEY "..."      (Windows, pak nové okno)')
        print('   export OPENAI_API_KEY="..."    (bash)')
        return 1
    model = args.model or sprites.MODEL

    done = 0
    for name, prompt in batch:
        print(f'   {name} … ', end='', flush=True)
        try:
            blob = sprites.request(key, prompt, model, None, sprites.SIZE_SQUARE)
        except Exception as chyba:  # noqa: BLE001 — dávka nesmí spadnout na jednom
            print(f'chyba: {chyba}')
            continue
        (OUT / f'{name}.png').write_bytes(blob)
        done += 1
        print('ok')

    print(f'\n{done} vygenerováno do {OUT.relative_to(ROOT)}.')
    print('Dál: python tools/fit-tiles.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
