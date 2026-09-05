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
# Objekty na terénu jdou mezi sprity, ne mezi dlaždice: ladí je `fit-sprites.py`,
# protože se jim měří kotva, ne kosočtverec.
OUT_OBJECTS = ROOT / 'art' / 'sprites' / 'raw'

# Povrchy mají tři varianty, aby se sousední dlaždice neopakovaly.
VARIANTS = ('a', 'b', 'c')

# Oplocený blok v dokumentu. První je hlavička stylu, druhý věta o navazování
# vozovky. Potrubí ji má stejnou, jen s jiným slovem — dokument to tak říká
# a skript to tak dělá, aby nebyla dvakrát.
FENCE = re.compile(r'```(.*?)```', re.S)

# `### `grass`` — id povrchu. Za nadpisem je tabulka variant.
SURFACE = re.compile(r'^### `([a-z_]+)`\s*$(.*?)(?=^### |^## |\Z)', re.M | re.S)
VARIANT_ROW = re.compile(r'^\| \*\*([abc])\*\* \| (.+?) \|\s*$', re.M)

# Řádek tabulky vzorů: `| grass | park_small__a.png | ... |`.
REFERENCE_ROW = re.compile(r'^\| `([a-z_]+)` \| `([a-z0-9_]+\.png)` \| .+? \|\s*$', re.M)

# Řádek tabulky materiálů: `| id | prompt |`. Tvary vozovky se negenerují —
# tvar se počítá z rohů dlaždice, obrázek dodá jen povrch. Proč, viz „Silnice"
# v zadání: šestnáct tvarů na typ se nevejde do jedné kreslicí dávky.
TYPE_ROW = re.compile(r'^\| `([a-z_]+)` \| (.+?) \|\s*$', re.M)

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

    # Každý blok se bere **ze svého oddílu**, ne podle pořadí v dokumentu.
    # Podle pořadí to tu jednou bylo a stačilo vložit nový oddíl doprostřed:
    # objekty dostaly jako hlavičku větu o navazování vozovky a generátor kolem
    # stromů nakreslil silnice.
    def fence(title: str) -> str:
        found = FENCE.search(section(text, title))
        if found is None:
            raise SystemExit(f'{SPEC.name}: oddíl „{title}" nemá oplocený blok')
        return found.group(1).strip()

    header = fence('Styl')
    reference_note = fence('Vzory')
    object_header = fence('Objekty na terénu')

    surfaces: dict[str, dict[str, str]] = {}
    for name, body in SURFACE.findall(section(text, 'Povrchy')):
        rows = dict(VARIANT_ROW.findall(body))
        if set(rows) != set(VARIANTS):
            raise SystemExit(f'{SPEC.name}: povrch „{name}" nemá varianty a/b/c')
        surfaces[name] = rows

    # Materiál vozovky a výkopu. Jeden obrázek na typ, ne šestnáct tvarů.
    materials = dict(TYPE_ROW.findall(section(text, 'Silnice')))
    materials.update(TYPE_ROW.findall(section(text, 'Potrubí')))
    # Trosky jsou taky materiál: jeden obrázek, kreslí se do polygonu dlaždice.
    materials.update(TYPE_ROW.findall(section(text, 'Trosky')))
    references = dict(REFERENCE_ROW.findall(section(text, 'Vzory')))

    return {
        'header': header,
        'surfaces': surfaces,
        'materials': materials,
        'references': references,
        'reference_note': reference_note,
        'object_header': object_header,
        'objects': {
            name: dict(VARIANT_ROW.findall(body))
            for name, body in (
                SURFACE.findall(section(text, 'Objekty na terénu'))
                # Katastrofy na ulici jsou taky vystrizene objekty s kotvou,
                # jen se nesazi do terenu, ale tam, kde nesteti nastalo.
                + SURFACE.findall(section(text, 'Katastrofy na ulici'))
                # Zpustla zastavba a sut: objekty misto sedych kvadru a textury.
                + SURFACE.findall(section(text, 'Zpustlá zástavba a suť'))
            )
        },
    }


def plan(spec: dict) -> list[tuple[str, str, str | None]]:
    """Co se má vygenerovat: `(jméno souboru, prompt, vzor)`."""
    jobs: list[tuple[str, str, str | None]] = []

    for name, rows in spec['surfaces'].items():
        for variant in VARIANTS:
            vzor = spec['references'].get(name)
            casti = [spec['header'], rows[variant]]
            if vzor:
                casti.append(spec['reference_note'])
            jobs.append((f'{name}__{variant}', PARAGRAPH.join(casti), vzor))

    for name, rows in spec['objects'].items():
        for variant in VARIANTS:
            jobs.append((
                f'{name}__{variant}',
                PARAGRAPH.join([spec['object_header'], rows[variant]]),
                None,
            ))

    # Materiál je jeden obrázek, ale jméno má tvar `id__varianta` jako všechno
    # ostatní — `fit-tiles.py` i `index.json` počítají s tím, že za dvěma
    # podtržítky je varianta.
    for name, prompt in spec['materials'].items():
        jobs.append((f'{name}__a', PARAGRAPH.join([spec['header'], prompt]), None))

    return jobs


# Kam který obrázek patří. Objekty mezi sprity, zbytek mezi dlaždice.
OBJECT_NAMES = (
    'forest_clump',
    'boulders',
    'riot_crowd',
    'pileup_wreck',
    'fire_blaze',
    'derelict_residential',
    'derelict_commercial',
    'derelict_industrial',
    'rubble_pile',
)


def target_for(name: str) -> Path:
    root = OUT_OBJECTS if name.partition('__')[0] in OBJECT_NAMES else OUT
    return root / f'{name}.png'


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
    OUT_OBJECTS.mkdir(parents=True, exist_ok=True)
    missing = [j for j in jobs if not target_for(j[0]).exists()]
    print(f'Chybí {len(missing)} z {len(jobs)}.')
    if not missing:
        return 0

    # Bez --all jen tři: menší dávka, kterou jde posoudit, než se pustí zbytek.
    batch = missing if (args.all or args.only) else missing[:3]

    if args.dry_run:
        print(f'\nGenerovalo by se {len(batch)}:')
        for name, _, vzor in batch:
            print(f'   {name}' + (f'   (vzor {vzor})' if vzor else ''))
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
    for name, prompt, vzor in batch:
        print(f'   {name} … ', end='', flush=True)
        # Vzor je hotový sprite z obsahu. Když chybí, jede se bez něj — obrázek
        # bez reference je pořád lepší než spadlá dávka.
        reference = None
        if vzor:
            path = ROOT / 'content' / 'vanilla' / 'sprites' / vzor
            if path.exists():
                reference = path.read_bytes()
        try:
            blob = sprites.request(key, prompt, model, reference, sprites.SIZE_SQUARE)
        except Exception as chyba:  # noqa: BLE001 — dávka nesmí spadnout na jednom
            print(f'chyba: {chyba}')
            continue
        target_for(name).write_bytes(blob)
        done += 1
        print('ok')

    print(f'\n{done} vygenerováno do {OUT.relative_to(ROOT)}.')
    print('Dál: python tools/fit-tiles.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
