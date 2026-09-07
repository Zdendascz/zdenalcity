"""Vygeneruje ikony domovské stránky přes OpenAI API do `art/icons/scene/`.

    python tools/generate-home-icons.py --dry-run
    python tools/generate-home-icons.py --all
    python tools/generate-home-icons.py --only home-share

Prompty čte ze zadání `docs/09-IKONY.md`, oddíl „Ikony domovské stránky", ne
z tabulky v sobě — stejné pravidlo jako u budov, dlaždic i zbytku ikon.
Klíč z `OPENAI_API_KEY`; skript ho nikam nevypisuje.

Proč vlastní skript a ne `generate-icons.py`: tyhle čtyři ikony nejsou ploché
štítky do HUD, ale měkce stínované izometrické objekty na průhledném pozadí.
Liší se hlavičkou promptu i tím, co se s výsledkem dělá dál — badge se na ně
nelepí, viz `tools/fit-scene-icons.py`.

Sdílené kusy (`request`, TLS, model) si bere z `generate-sprites.py` přes
`importlib`, protože v názvu je pomlčka.

Každé spuštění stojí peníze.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / 'docs' / '09-IKONY.md'
OUT = ROOT / 'art' / 'icons' / 'scene'
SECTION = 'Ikony domovské stránky'
SIZE = '1024x1024'

FENCE = re.compile(r'```(.*?)```', re.S)
ICON_ROW = re.compile(r'^\| `([a-z0-9-]+)` \| (.+?) \|\s*$', re.M)
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


def section(text: str) -> str:
    """Tělo oddílu `## <SECTION>` až po další `## ` na stejné úrovni."""
    found = re.search(rf'^## {re.escape(SECTION)}\s*$(.*?)(?=^## |\Z)', text, re.M | re.S)
    if found is None:
        raise SystemExit(f'{SPEC.name}: oddíl „{SECTION}" chybí')
    return found.group(1)


def read_spec() -> tuple[str, dict[str, str]]:
    text = SPEC.read_text(encoding='utf-8')
    body = section(text)

    style = FENCE.search(body)
    if style is None:
        raise SystemExit(f'{SPEC.name}: oddíl „{SECTION}" nemá oplocený styl')

    prompts = {name: prompt.strip() for name, prompt in ICON_ROW.findall(body)}
    if not prompts:
        raise SystemExit(f'{SPEC.name}: oddíl „{SECTION}" nemá tabulku ikon')
    return style.group(1).strip(), prompts


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--only', default=None)
    args = parser.parse_args()

    style, prompts = read_spec()
    wanted = set(args.only.split(',')) if args.only else set(prompts)
    unknown = wanted - set(prompts)
    if unknown:
        raise SystemExit('zadání nezná: ' + ', '.join(sorted(unknown)))

    OUT.mkdir(parents=True, exist_ok=True)
    todo = [name for name in sorted(wanted) if not (OUT / f'{name}.png').exists()]
    print(f'Chybí {len(todo)} z {len(wanted)}.')
    if not todo:
        return 0

    # Bez `--all` ani `--only` se nic negeneruje: každé spuštění stojí peníze
    # a omylem spuštěná celá sada je zbytečný účet.
    if not args.all and not args.only:
        print('Přidej --all nebo --only <id>.')
        return 0

    if args.dry_run:
        print('Generovalo by se:')
        for name in todo:
            print(f'   {name}')
        print('\n--dry-run: neutraceno nic.')
        return 0

    sprites = shared()
    # Klíč se čte tady, ne v modulu: `generate-sprites.py` si ho bere až
    # ve svém `main`, který se odsud nepouští.
    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if key == '':
        raise SystemExit('Chybí OPENAI_API_KEY.')

    for name in todo:
        prompt = style + PARAGRAPH + prompts[name]
        print(f'   {name} … ', end='', flush=True)
        image = sprites.request(key, prompt, sprites.MODEL, None, SIZE)
        (OUT / f'{name}.png').write_bytes(image)
        print('ok')

    print(f'\n{len(todo)} vygenerováno do {OUT.relative_to(ROOT)}.')
    print('Dál: python tools/fit-scene-icons.py')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
