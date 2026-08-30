"""Vygeneruje obrázky budov přes OpenAI API rovnou do `art/sprites/raw/`.

    python tools/generate-sprites.py --dry-run           # co by se generovalo
    python tools/generate-sprites.py --only clinic       # jedna budova
    python tools/generate-sprites.py                     # tři obrázky (výchozí)
    python tools/generate-sprites.py --all               # zbytek, co chybí

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
SPEC = ROOT / 'docs' / '06-SPRITY-SLUZEB.md'
REFERENCE = ROOT / 'art' / 'sprites' / 'reference.png'

API = 'https://api.openai.com/v1/images'
MODEL = 'gpt-image-1'
SIZE = '1024x1024'

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


def read_spec() -> tuple[str, dict[str, dict[str, str]]]:
    """Hlavička a prompty variant ze zadání.

    Formát je daný dokumentem: hlavička je první blok kódu za sekcí o ní,
    varianty jsou řádky tabulky `| **a** | text |` pod nadpisem `#### \\`id\\``.
    """
    text = SPEC.read_text(encoding='utf-8')

    start = text.index('## 4. Společná hlavička promptu')
    header = re.search(r'```\n(.*?)```', text[start:], re.S)
    if header is None:
        raise SystemExit('v zadání chybí blok se společnou hlavičkou promptu')

    prompts: dict[str, dict[str, str]] = {}
    for name, body in re.findall(
        r'^#### `([a-z0-9_]+)`.*?$(.*?)(?=^#### |^## |\Z)', text, re.S | re.M
    ):
        found = dict(re.findall(r'^\| \*\*([abc])\*\* \| (.+?) \|\s*$', body, re.M))
        if found:
            prompts[name] = found

    return header.group(1).strip(), prompts


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


def request(key: str, prompt: str, model: str, reference: bytes | None) -> bytes:
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
            'size': SIZE,
            'n': 1,
            'background': 'transparent',
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
                'size': SIZE,
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
    wanted = set(only.split(',')) if only else None
    if wanted:
        unknown = wanted - set(prompts)
        if unknown:
            print('Zadání nezná: ' + ', '.join(sorted(unknown)))
            return 1

    RAW.mkdir(parents=True, exist_ok=True)
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

    # `--no-reference` je na porovnání. Reference měla styl držet, jenže přes
    # `images/edits` ho spíš stahuje k tmavému polorealistickému renderu —
    # naměřeno na kině. Styl proto nese hlavička promptu a reference je volba.
    use_reference = '--no-reference' not in argv
    reference = REFERENCE.read_bytes() if (use_reference and REFERENCE.exists()) else None
    print(f'Chybí {len(todo)} z 96.')
    print(f'Reference: {"ano, " + REFERENCE.name if reference else "ŽÁDNÁ — sada se rozejde ve stylu"}')

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
        print(f'   {name}__{variant} …', flush=True)
        png = request(key, f'{header}\n\n{prompt}', model, reference)
        target.write_bytes(png)
        done += 1

    print(f'\n{done} vygenerováno do {RAW.relative_to(ROOT)}.')
    print('Dál: python tools/fit-sprites.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
