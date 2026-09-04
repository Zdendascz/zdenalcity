"""Vygeneruje propagacni sceny z urovne oci do `art/scenes/`.

    python tools/generate-scenes.py --dry-run
    python tools/generate-scenes.py --only ulice
    python tools/generate-scenes.py --all

Prompty cte ze zadani `docs/10-SCENY.md`. Klic z `OPENAI_API_KEY`; skript ho
nikam nevypisuje.

Proti ikonam a dlazdicim se lisi ve dvou vecech: obrazek je **na sirku**
a **krycí**, ne pruhledny. Scena vyplnuje cely ramecek vcetne oblohy.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'docs' / '10-SCENY.md'
OUT = ROOT / 'art' / 'scenes'

FENCE = re.compile(r'```(.*?)```', re.S)
SCENE_ROW = re.compile(r'^\| `([a-z0-9_-]+)` \| (.+?) \|\s*$', re.M)

PARAGRAPH = '\n\n'


def shared():
    """Kus `generate-sprites.py`, ktery mluvi s API. Jedna kopie, ne dvě."""
    path = ROOT / 'tools' / 'generate-sprites.py'
    spec = importlib.util.spec_from_file_location('generate_sprites', path)
    if spec is None or spec.loader is None:
        raise SystemExit(f'nepodarilo se nacist {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def section(text: str, title: str) -> str:
    found = re.search(rf'^## {re.escape(title)}\s*$(.*?)(?=^## |\Z)', text, re.M | re.S)
    return found.group(1) if found else ''


def read_spec() -> dict[str, str]:
    text = SPEC.read_text(encoding='utf-8')

    found = FENCE.search(section(text, 'Styl'))
    if found is None:
        raise SystemExit(f'{SPEC.name}: oddil "Styl" nema oploceny blok')
    header = found.group(1).strip()

    rows = SCENE_ROW.findall(section(text, 'Scény'))
    if not rows:
        raise SystemExit(f'{SPEC.name}: v oddilu "Scény" nejsou zadne radky')
    return {name: PARAGRAPH.join([header, prompt]) for name, prompt in rows}


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
            print(f'"{args.only}" v zadani neni')
            return 1

    OUT.mkdir(parents=True, exist_ok=True)
    missing = [job for job in jobs if not (OUT / f'{job[0]}.png').exists()]
    print(f'Chybi {len(missing)} z {len(jobs)}.')
    if not missing:
        return 0

    batch = missing if (args.all or args.only) else missing[:2]

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
        print('Chybi OPENAI_API_KEY.')
        return 1
    model = args.model or sprites.MODEL

    done = 0
    for name, prompt in batch:
        print(f'   {name} ... ', end='', flush=True)
        try:
            blob = sprites.request(key, prompt, model, None, sprites.SIZE_WIDE, 'opaque')
        except Exception as chyba:  # noqa: BLE001 - davka nesmi spadnout na jedne
            print(f'chyba: {chyba}')
            continue
        (OUT / f'{name}.png').write_bytes(blob)
        done += 1
        print('ok')

    print(f'\n{done} vygenerovano do {OUT.relative_to(ROOT)}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
