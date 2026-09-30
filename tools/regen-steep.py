"""Přegeneruje obrázky budov nakreslené z příliš strmého pohledu (T124).

    python tools/regen-steep.py                 # všechny pod MIN_RATIO
    python tools/regen-steep.py school__c ...   # jen vyjmenované

Autor hlásil budovy „pod špatným úhlem". Příčina: generátor některé nakreslil
skoro shora — podstava vyšla 0,9–1,3 : 1 místo 2 : 1 — a `fit-sprites.py`
je svisle zmáčkl až o polovinu. Stěny pak vypadají přikrčené a budova jako
z jiné kamery než zbytek města.

Postup pro každý obrázek: nejvýš `TRIES` pokusů, po každém se naladí
a změří projekce; zůstane **nejlepší** pokus (ne poslední) a skončí se, jakmile
projekce přesáhne `GOOD_RATIO`. Staré syrové obrázky jdou do
`art/sprites/archive/strme/`.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'sprites' / 'raw'
ARCHIVE = ROOT / 'art' / 'sprites' / 'archive' / 'strme'
MIN_RATIO = 1.4
GOOD_RATIO = 1.5
TRIES = 3
PY = sys.executable


def run(*args: str) -> str:
    out = subprocess.run([PY, *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return out.stdout + out.stderr


def ratio_of(stem: str) -> float | None:
    """Naladí jeden obrázek a vrátí změřenou projekci, nebo None."""
    text = run('tools/fit-sprites.py', '--only', stem)
    line = next((l for l in text.splitlines() if l.strip().startswith(f'{stem}  ')), '')
    found = re.search(r'projekce ([0-9.]+):1', line)
    if found:
        return float(found.group(1))
    # Projekce se neopravuje, když už je 2:1 (≥ 1,96) — pak je to dobře.
    return 2.0 if '→' in line and 'podstavu nejde' not in line else None


def steep() -> list[tuple[float, str]]:
    text = run('tools/fit-sprites.py', '--check')
    out = []
    for line in text.splitlines():
        found = re.match(r'^  ([a-z_]+__[abc])  →.*projekce ([0-9.]+):1', line)
        if found and float(found.group(2)) < MIN_RATIO:
            out.append((float(found.group(2)), found.group(1)))
    return sorted(out)


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    wanted = [(0.0, stem) for stem in sys.argv[1:]] or steep()
    print(f'{len(wanted)} obrázků ke zlepšení.', flush=True)
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    for before, stem in wanted:
        name = stem.rsplit('__', 1)[0]
        target = RAW / f'{stem}.png'
        best_ratio = before
        best_file = ARCHIVE / f'{stem}__0.png'
        if target.exists():
            shutil.move(target, best_file)
        for attempt in range(1, TRIES + 1):
            out = run('tools/generate-sprites.py', '--only', name)
            if not target.exists():
                print(f'  {stem}: generování selhalo\n{out[-400:]}', flush=True)
                break
            ratio = ratio_of(stem) or 0.0
            kept = ARCHIVE / f'{stem}__{attempt}.png'
            shutil.copy(target, kept)
            print(f'  {stem}: pokus {attempt} → {ratio:.2f}:1 (předtím nejlíp {best_ratio:.2f})', flush=True)
            if ratio > best_ratio:
                best_ratio, best_file = ratio, kept
            if ratio >= GOOD_RATIO:
                break
            target.unlink()
        # Nejlepší pokus zpátky do raw/ a naladit.
        if best_file.exists():
            shutil.copy(best_file, target)
            ratio_of(stem)
        print(f'  {stem}: zůstává {best_ratio:.2f}:1', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
