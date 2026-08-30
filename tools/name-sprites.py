"""Pojmenuje čerstvě nahrané obrázky jedné budovy na `<id>__a/b/c.png`.

    python tools/name-sprites.py hospital           # přejmenuje
    python tools/name-sprites.py hospital --check    # jen ukáže, co by udělal

Nahraj do `art/sprites/raw/` tři varianty **jedné** budovy tak, jak je vrátil
generátor, a řekni která to je. Skript je seřadí podle času vzniku a přiřadí
`a`, `b`, `c` v tom pořadí.

Bere jen soubory, které ještě jméno nemají — hotové `<id>__<varianta>.png`
nechá být, takže se dá pouštět opakovaně.

**Řadí se podle času, ne podle abecedy.** Generátor dává do jména české datum
(`ChatGPT Image 30. 8. 2026 00_00_20.png`), a to se abecedně seřadí špatně:
`30. 8.` by předběhlo `3. 9.`. Když se datum ze jména přečíst nedá, rozhodne
čas souboru na disku.
"""

from __future__ import annotations

import difflib
import importlib.util
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'sprites' / 'raw'
VARIANTS = ('a', 'b', 'c')

# Už pojmenovaný soubor. Dvojité podtržítko a jedna z variant na konci.
NAMED = re.compile(r'^[a-z0-9_]+__[abc]$')

# `ChatGPT Image 30. 8. 2026 00_00_20 (3)` — den, měsíc, rok, hodina, minuta,
# sekunda a nepovinné pořadí, které přidává prohlížeč při stahování ve stejnou
# sekundu. Nesufixovaný soubor je z nich nejstarší.
STAMP = re.compile(
    r'(?P<d>\d{1,2})\.\s*(?P<m>\d{1,2})\.\s*(?P<y>\d{4})\s+'
    r'(?P<H>\d{1,2})[_:](?P<M>\d{2})[_:](?P<S>\d{2})'
    r'(?:\s*\((?P<n>\d+)\))?'
)


def known_ids() -> set[str]:
    """Id, pro která má smysl obrázek mít. Bere je ze stejného místa jako `fit-sprites`.

    Načítá se přes `importlib`, protože v názvu `fit-sprites.py` je pomlčka
    a normální `import` na ni nestačí. Je to ošklivé, ale lepší než druhá kopie
    seznamu budov, která by se s obsahem časem rozešla (P5).
    """
    path = ROOT / 'tools' / 'fit-sprites.py'
    spec = importlib.util.spec_from_file_location('fit_sprites', path)
    if spec is None or spec.loader is None:
        raise SystemExit(f'nepodařilo se načíst {path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return set(module.load_definitions())


def sort_key(path: Path) -> tuple:
    """Čas vzniku. Ze jména, a když tam není, tak ze souboru."""
    found = STAMP.search(path.stem)
    if found:
        g = found.groupdict()
        return (
            0,
            int(g['y']), int(g['m']), int(g['d']),
            int(g['H']), int(g['M']), int(g['S']),
            int(g['n'] or 0),
        )
    # Bez razítka ve jméně: čas na disku. Řadí se za ty s razítkem, aby se
    # pořadí nemíchalo mezi dvěma různými zdroji času.
    return (1, path.stat().st_mtime, 0, 0, 0, 0, 0, 0)


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check = '--check' in sys.argv
    if len(args) != 1:
        print(__doc__)
        return 1

    building = args[0]
    ids = known_ids()
    if building not in ids:
        # Překlep je pravděpodobnější než vymyšlená budova, takže se napovídá
        # podle podobnosti, ne podle podřetězce — „hospitl" v „hospital" není.
        blizke = difflib.get_close_matches(building, sorted(ids), n=3, cutoff=0.6)
        print(f'Budovu „{building}" obsah nezná.')
        if blizke:
            print('Myslel jsi: ' + ', '.join(blizke))
        return 1

    if not RAW.exists():
        print(f'Složka {RAW.relative_to(ROOT)} neexistuje.')
        return 1

    fresh = sorted(
        (p for p in RAW.glob('*.png') if not NAMED.match(p.stem)),
        key=sort_key,
    )
    if not fresh:
        print('Žádné nepojmenované obrázky. Vše v raw/ už jméno má.')
        return 0

    # Víc než tři je skoro jistě omyl — dvě budovy naráz nebo zapomenutý zmetek.
    # Přejmenovat první tři by tiše udělalo špatnou sadu, tak radši nic.
    if len(fresh) != len(VARIANTS):
        print(f'Nepojmenovaných obrázků je {len(fresh)}, čekám {len(VARIANTS)}:')
        for p in fresh:
            print(f'   {p.name}')
        print('\nNahraj právě tři varianty jedné budovy, nebo přebytečné odstraň.')
        return 1

    plan = list(zip(fresh, VARIANTS))
    collisions = [v for _, v in plan if (RAW / f'{building}__{v}.png').exists()]
    if collisions:
        print(f'Už existuje: ' + ', '.join(f'{building}__{v}.png' for v in collisions))
        print('Smaž je, nebo přejmenuj ručně — přepisovat je nebudu.')
        return 1

    for source, variant in plan:
        target = RAW / f'{building}__{variant}.png'
        print(f'   {source.name}\n     → {target.name}')
        if not check:
            source.rename(target)

    print(f'\n{len(plan)} {"by se přejmenovalo" if check else "přejmenováno"}.')
    if not check:
        print('Dál: python tools/fit-sprites.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
