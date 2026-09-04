"""Vygeneruje ikony rozhraní přes OpenAI API do `art/icons/raw/`.

    python tools/generate-icons.py --dry-run       # co by se generovalo
    python tools/generate-icons.py --only police_small
    python tools/generate-icons.py --all           # všechno, co chybí

Prompty čte ze zadání `docs/09-IKONY.md`, ne z tabulky v sobě — stejné pravidlo
jako u budov a dlaždic. Klíč z `OPENAI_API_KEY`; skript ho nikam nevypisuje.

Sdílené kusy (`request`, TLS, model) si bere z `generate-sprites.py` přes
`importlib`, protože v názvu je pomlčka.

Bez `--all` se udělají jen tři obrázky. Každé spuštění stojí peníze.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'docs' / '09-IKONY.md'
OUT = ROOT / 'art' / 'icons' / 'raw'

# Oplocený blok v oddílu „Styl" je hlavička, která se lepí ke každému promptu.
FENCE = re.compile(r'```(.*?)```', re.S)

# Řádek tabulky ikon: `| \`police_small\` | prompt |`. Jméno smí mít pomlčku,
# protože `coverage-police` a `view-decor` ji mají.
ICON_ROW = re.compile(r'^\| `([a-z0-9_-]+)` \| (.+?) \|\s*$', re.M)

PARAGRAPH = '\n\n'


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
    found = re.search(rf'^## {re.escape(title)}\s*$(.*?)(?=^## |\Z)', text, re.M | re.S)
    return found.group(1) if found else ''


def fence_of(text: str, title: str) -> str:
    found = FENCE.search(section(text, title))
    if found is None:
        raise SystemExit(f'{SPEC.name}: oddíl „{title}" nemá oplocený blok')
    return found.group(1).strip()


def read_spec() -> dict[str, str]:
    """Prompty ikon i značky, každý už i se svou hlavičkou.

    Značka má **vlastní hlavičku**: je to logo, ne tlačítko, takže se kolem něj
    nekreslí štítek. Kdyby se sdílela hlavička ikon, mělo by logo rámeček
    a na světlém pozadí by překáželo.
    """
    text = SPEC.read_text(encoding='utf-8')
    out: dict[str, str] = {}

    for title, header in (('Ikony', fence_of(text, 'Styl')), ('Značka', fence_of(text, 'Značka'))):
        # Bere se **jen ten oddíl**, ne celý dokument: tabulka barev má taky
        # tři sloupce a bez omezení by se z „pořádek | modrá | bílý" stala ikona.
        rows = ICON_ROW.findall(section(text, title))
        if not rows:
            raise SystemExit(f'{SPEC.name}: v oddílu „{title}" nejsou žádné řádky')
        for name, prompt in rows:
            out[name] = PARAGRAPH.join([header, prompt])

    return out


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--only', default=None)
    parser.add_argument('--model', default=None)
    args, _ = parser.parse_known_args()

    jobs = list(read_spec().items())
    if args.only:
        jobs = [job for job in jobs if job[0] == args.only]
        if not jobs:
            print(f'„{args.only}" v zadání není')
            return 1

    OUT.mkdir(parents=True, exist_ok=True)
    missing = [job for job in jobs if not (OUT / f'{job[0]}.png').exists()]
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
        except Exception as chyba:  # noqa: BLE001 — dávka nesmí spadnout na jedné
            print(f'chyba: {chyba}')
            continue
        (OUT / f'{name}.png').write_bytes(blob)
        done += 1
        print('ok')

    print(f'\n{done} vygenerováno do {OUT.relative_to(ROOT)}.')
    print('Dál: python tools/fit-icons.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
