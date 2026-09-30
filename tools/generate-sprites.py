"""Vygeneruje obrázky budov přes OpenAI API rovnou do `art/sprites/raw/`.

    python tools/generate-sprites.py --dry-run           # co by se generovalo
    python tools/generate-sprites.py --only clinic       # jedna budova
    python tools/generate-sprites.py                     # tři obrázky (výchozí)
    python tools/generate-sprites.py --all               # zbytek, co chybí

Model je `gpt-image-2`. `gpt-image-1` byl první odhad a měřitelně horší; přepsat
jde přes `--model=`.

Prompty čte **ze zadání** `docs/06-SPRITY-SLUZEB.md`, ne z tabulky v sobě:
kdyby si je opsal, rozešly by se s dokumentem při první úpravě a nikdo by si
toho nevšiml. Hlavička i varianty jsou tam, kde je čte i člověk.

Ukládá rovnou pod správným jménem, takže `name-sprites.py` netřeba. Co už
v `raw/` leží, přeskočí — dá se pouštět opakovaně a dogenerovat, co chybí.

## Klíč

Čte se z proměnné prostředí `OPENAI_API_KEY`. Do repozitáře ani do promptu
nepatří a skript ho nikam nevypisuje.

    setx OPENAI_API_KEY "..."        # Windows, jednou; nové okno terminálu
    export OPENAI_API_KEY="..."      # bash

## Peníze

Každé spuštění **stojí peníze** a generování 96 obrázků není zadarmo. Proto se
bez `--all` udělají jen tři: menší dávka, kterou jde posoudit, než se pustí
zbytek. `--dry-run` neutratí nic.
"""

from __future__ import annotations

import base64
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'sprites' / 'raw'
# Hlavička je jen v prvním; ostatní přispívají prompty. Zástavba v zónách má
# vlastní dokument, protože se řídí týmž stylem, ale jinou logikou úrovní.
SPECS = (
    ROOT / 'docs' / '06-SPRITY-SLUZEB.md',
    ROOT / 'docs' / '07-SPRITY-ZONY.md',
)
REFERENCE = ROOT / 'art' / 'sprites' / 'reference.png'

API = 'https://api.openai.com/v1/images'

# `gpt-image-1` byl první odhad a měřitelně horší: podstavu z něj šlo změřit
# u jednoho obrázku ze tří a výšky utíkaly o 35–40 % (376/433/448 tam, kde se
# čeká 320). `gpt-image-2` dá 3 ze 3 a výšky 315/313/332.
#
# `chatgpt-image-latest` — nejspíš to, co jede v aplikaci — chce ověřenou
# organizaci a účet ji zatím nemá. Až bude, stojí za pokus: aplikace dělá
# světlejší obrázky (jas 151 proti 134).
MODEL = 'gpt-image-2'

# Vzory, kterymi se cte zadani. Nadpis budovy je ### nebo ####.
# Vzory, kterými se čte zadání. Nadpis budovy je ### nebo ####; oddíly
# hlavičky jsou oplocené trojicí zpětných apostrofů.
FENCE = r'```(.*?)```'
SUBJECT = r'^#{3,4} `([a-z0-9_]+)`.*?$(.*?)(?=^#{3,4} |^## |\Z)'
VARIANT = r'^\| \*\*([abc])\*\* \| (.+?) \|\s*$'
# Čtvercové plátno má strop na výšku budovy: podstava má vyplnit šířku, takže
# vysoká stavba se do čtverce nevejde. Naměřeno na první dávce — 129 z 228
# budov vyšlo nižších, než čeká `heightLevels`, medián o 32 %. Vysoké se proto
# kreslí **na výšku**.
SIZE_SQUARE = '1024x1024'
SIZE_TALL = '1024x1536'
# Na šířku. Používají to jen scény z ulice, sprity ani dlaždice ne.
SIZE_WIDE = '1536x1024'

# Kolik místa nad podstavou zbývá ve čtvercovém plátně.
#
# Podstava má vyplnit šířku a v projekci 2:1 je dvakrát širší než vyšší, takže
# ve čtverci o straně `W` zabere pás `W × W/2` uprostřed — nad ní zbývá `W/4`.
# Tělo budovy potřebuje `W · pater / (2·(w+d))`. Do čtverce se tedy vejde,
# dokud `pater ≤ (w+d)/2`; nad tím je potřeba plátno na výšku.

# Bez `--all` se udělá jen tahle hrstka. Utrácí se cizí peníze, takže výchozí
# chování má být to opatrné.
DEFAULT_BATCH = 3

# Kolikrát to zkusit znovu, když API odmítne kvůli zahlcení. Roste to
# dvojnásobně, protože limity se uvolňují po vteřinách, ne po milisekundách.
RETRIES = 4
BACKOFF = 8.0


def tls_context() -> ssl.SSLContext:
    """Kontext pro HTTPS.

    Na tomhle stroji má windowsové úložiště certifikátů vadný záznam a Python
    na něm při načítání spadne (`ASN1 nested asn1 error`). Bere se proto seznam
    z `certifi`, když je k dispozici.

    **Ověřování se nevypíná.** Přes tohle spojení jde API klíč; neověřené
    spojení by ho vystavilo komukoli po cestě. Když certifikáty nejsou,
    skript radši skončí, než by posílal klíč naslepo.
    """
    try:
        return ssl.create_default_context()
    except ssl.SSLError:
        pass
    try:
        import certifi
    except ImportError:
        raise SystemExit(
            'Úložiště certifikátů je poškozené a `certifi` chybí. '
            'Nainstaluj ho: pip install certifi'
        )
    return ssl.create_default_context(cafile=certifi.where())


# Oddělovač odstavců v promptu. Doslovný prázdný řádek.
PARAGRAPH = '''

'''


def load_footprints() -> dict[str, tuple[int, int, int]]:
    """Půdorys a patra budov z definic. Klíč je holé id bez jmenného prostoru."""
    out: dict[str, tuple[int, int, int]] = {}
    for path in sorted((ROOT / 'content' / 'vanilla' / 'buildings').glob('*.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        if data.get('type') != 'building':
            continue
        w, d = data['footprint']
        out[data['id'].split(':', 1)[1]] = (w, d, data['graphics']['heightLevels'])
    for n in (1, 2, 3, 4):
        out[f'ruin_{n}x{n}'] = (n, n, 1)
    return out


def canvas_for(name: str, shapes: dict[str, tuple[int, int, int]]) -> str:
    """Které plátno na tuhle budovu. Odvozeno z půdorysu a pater v datech."""
    size = shapes.get(name)
    if size is None:
        return SIZE_SQUARE
    w, d, levels = size
    return SIZE_TALL if levels > (w + d) / 2 else SIZE_SQUARE


def read_spec() -> tuple[str, dict[str, dict[str, str]]]:
    """Hlavicka a prompty variant ze zadani.

    Format je dany dokumentem: hlavicka je prvni blok kodu za sekci o ni,
    varianty jsou radky tabulky pod nadpisem se jmenem budovy. Zadani je
    vic -- hlavicka je jen v prvnim, prompty prispivaji vsechna. Zastavba
    v zonach ma vlastni dokument, protoze se ridi tymz stylem, ale jinou
    logikou urovni.
    """
    first = SPECS[0].read_text(encoding='utf-8')
    start = first.index('## 4. Společná hlavička promptu')
    header = re.search(FENCE, first[start:], re.S)
    if header is None:
        raise SystemExit('v zadání chybí blok se společnou hlavičkou promptu')

    prompts: dict[str, dict[str, str]] = {}
    for spec in SPECS:
        if not spec.exists():
            continue
        text = spec.read_text(encoding='utf-8')
        for name, body in re.findall(SUBJECT, text, re.S | re.M):
            found = dict(re.findall(VARIANT, body, re.M))
            if found:
                prompts[name] = found

    return header.group(1).strip(), prompts

def plot_sentence(name: str, shapes: dict[str, tuple[int, int]]) -> str:
    """Věta o tvaru pozemku, odvozená z půdorysu v datech.

    Do promptu se **nepíše ručně**. U čtvercové budovy je pozemek pravidelný
    diamant, u obdélníkové protažený — a kdyby to prompt neřekl, generátor
    nakreslí čtverec a budova bude mít špatné proporce. Odvozeno z definice,
    aby se to nemohlo rozejít se hrou (P5).
    """
    size = shapes.get(name)
    if size is None:
        return ''
    w, d, _ = size
    if w == d:
        return f'The plot is a square of {w} by {d} city tiles.'
    # **Která osa, ne jen „jedna z nich".** Do T72 tu stálo „elongated along one
    # axis" a generátor si směr vybíral sám — `commercial_row__b` vyšel otočený
    # o devadesát stupňů a autor to našel na mapě. Delší strana leží podél
    # mřížkové osy x, a ta v izometrii míří doprava dolů.
    smer = (
        'from the upper-left to the lower-right'
        if w > d
        else 'from the upper-right to the lower-left'
    )
    return (
        f'The plot is a RECTANGLE of {w} by {d} city tiles, not a square. '
        f'Its LONG side runs {smer}; the short ends face the other two corners. '
        f'Do not rotate the building by ninety degrees.'
    )


def multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes]]) -> tuple[bytes, str]:
    """Tělo `multipart/form-data`. Ručně, aby nepřibyla závislost."""
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for key, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
            .encode('utf-8')
        )
    for key, (filename, blob) in files.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; '
            f'filename="{filename}"\r\nContent-Type: image/png\r\n\r\n'.encode('utf-8')
        )
        parts.append(blob)
        parts.append(b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode('utf-8'))
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'


def request(
    key: str,
    prompt: str,
    model: str,
    reference: bytes | None,
    size: str,
    background: str = 'transparent',
) -> bytes:
    """Jeden obrázek. Vrací PNG.

    S referencí jde požadavek na `images/edits`, bez ní na `images/generations`.
    Reference nese styl — bez ní se sada rozejde, protože každé sezení kreslí
    trochu jinak. Ověřeno na prvních devíti obrázcích: projekce kolísala od
    1,18 : 1 po 1,60 : 1.
    """
    if reference is None:
        body = json.dumps({
            'model': model,
            'prompt': prompt,
            'size': size,
            'n': 1,
            # Průhledné pozadí chtějí sprity a dlaždice, protože se lepí na
            # mapu. Scéna z ulice vyplňuje celý rámeček a průhlednost by jí
            # ubrala oblohu, takže si řekne o 'opaque'.
            'background': background,
            'output_format': 'png',
        }).encode('utf-8')
        req = urllib.request.Request(
            f'{API}/generations',
            data=body,
            headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
        )
    else:
        body, content_type = multipart(
            {
                'model': model,
                'prompt': prompt,
                'size': size,
                'n': '1',
                'background': 'transparent',
                'output_format': 'png',
            },
            {'image[]': ('reference.png', reference)},
        )
        req = urllib.request.Request(
            f'{API}/edits',
            data=body,
            headers={'Authorization': f'Bearer {key}', 'Content-Type': content_type},
        )

    delay = BACKOFF
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=300, context=TLS) as response:
                payload = json.loads(response.read())
            global LAST_USAGE
            LAST_USAGE = payload.get('usage') or {}
            return base64.b64decode(payload['data'][0]['b64_json'])
        except urllib.error.HTTPError as error:
            # 429 je limit, 5xx je jejich strana — obojí má smysl zkusit znovu.
            # Cokoli jiného je špatný požadavek a opakováním se nespraví.
            if error.code not in (408, 429, 500, 502, 503, 504) or attempt == RETRIES - 1:
                detail = error.read().decode('utf-8', 'replace')[:400]
                raise SystemExit(f'API odmítlo ({error.code}): {detail}')
            print(f'      limit, zkouším za {delay:.0f} s')
            time.sleep(delay)
            delay *= 2
    raise SystemExit('nepodařilo se ani po opakování')


# Jednou za běh, ne při každém požadavku — načítání seznamu certifikátů není
# zadarmo a mezi obrázky se nemění.
TLS = tls_context()

# Útrata se od 2026-09-29 píše do téhož deníku jako díly pro animace
# (`tools/generate-parts.py`), aby se rozpočet hlídal na jednom místě.
LEDGER = ROOT / 'art' / 'parts' / 'spend.jsonl'
LAST_USAGE: dict = {}


def log_spend(name: str, size: str) -> float:
    details = LAST_USAGE.get('input_tokens_details') or {}
    text_in = details.get('text_tokens', LAST_USAGE.get('input_tokens', 0))
    image_in = details.get('image_tokens', 0)
    out = LAST_USAGE.get('output_tokens', 0)
    # Ceník gpt-image-1, stejně jako v generate-parts.py: odhad spíš vyšší.
    usd = (text_in * 5 + image_in * 10 + out * 40) / 1e6
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open('a', encoding='utf-8') as ledger:
        ledger.write(json.dumps({
            'part': f'sprite:{name}', 'model': MODEL, 'size': size, 'usage': LAST_USAGE,
            'usd': round(usd, 4), 'at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        }) + '\n')
    return usd


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    argv = sys.argv[1:]
    dry = '--dry-run' in argv
    everything = '--all' in argv
    model = next((a.split('=', 1)[1] for a in argv if a.startswith('--model=')), MODEL)
    only = next((a.split('=', 1)[1] for a in argv if a.startswith('--only=')), None)
    if only is None and '--only' in argv:
        at = argv.index('--only')
        only = argv[at + 1] if at + 1 < len(argv) else None

    header, prompts = read_spec()
    shapes = load_footprints()
    wanted = set(only.split(',')) if only else None
    if wanted:
        unknown = wanted - set(prompts)
        if unknown:
            print('Zadání nezná: ' + ', '.join(sorted(unknown)))
            return 1

    RAW.mkdir(parents=True, exist_ok=True)
    celkem = sum(len(v) for name, v in prompts.items() if wanted is None or name in wanted)
    todo = [
        (name, variant, prompt)
        for name in sorted(prompts)
        if wanted is None or name in wanted
        for variant, prompt in sorted(prompts[name].items())
        if not (RAW / f'{name}__{variant}.png').exists()
    ]

    if not todo:
        print('Není co generovat — všechno už v raw/ leží.')
        return 0

    # Reference je **vypnutá, dokud se o ni neřekne**. Měla styl držet, jenže
    # přes `images/edits` ho stahuje k tmavému polorealistickému renderu —
    # naměřeno na kině: podstava šla změřit u jednoho obrázku ze tří a výšky
    # utíkaly o 35–40 %. Bez ní vyšly 3 ze 3 a výšky na jednotky přesně.
    #
    # Styl proto nese **hlavička promptu**, ne přiložený obrázek. Kdyby byla
    # reference výchozí, stačilo by na ni při dávce zapomenout a osmdesát
    # obrázků by vyšlo špatně — což se málem stalo.
    reference = REFERENCE.read_bytes() if ('--reference' in argv and REFERENCE.exists()) else None
    print(f'Chybí {len(todo)} z {celkem}.')
    print(f'Reference: {"ano, " + REFERENCE.name + " (--reference)" if reference else "ne, styl nese prompt"}')

    batch = todo if (everything or wanted) else todo[:DEFAULT_BATCH]
    if len(batch) < len(todo):
        print(f'Bez --all se udělají jen {len(batch)}. Utrácí se tvoje peníze.')

    if dry:
        print(f'\nGenerovalo by se {len(batch)}:')
        for name, variant, _ in batch:
            print(f'   {name}__{variant}')
        print('\n--dry-run: neutraceno nic.')
        return 0

    key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not key:
        print('\nChybí OPENAI_API_KEY. Nastav si ho v prostředí:')
        print('   setx OPENAI_API_KEY "..."      (Windows, pak nové okno)')
        print('   export OPENAI_API_KEY="..."    (bash)')
        return 1

    print()
    done = 0
    for name, variant, prompt in batch:
        target = RAW / f'{name}__{variant}.png'
        print(f'   {name}__{variant} …', end='', flush=True)
        canvas = canvas_for(name, shapes)
        png = request(
            key,
            PARAGRAPH.join([header, plot_sentence(name, shapes), prompt]),
            model,
            reference,
            canvas,
        )
        target.write_bytes(png)
        usd = log_spend(f'{name}__{variant}', canvas)
        print(f' {canvas}, {usd:.3f} USD', flush=True)
        done += 1

    print(f'\n{done} vygenerováno do {RAW.relative_to(ROOT)}.')
    print('Dál: python tools/fit-sprites.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
