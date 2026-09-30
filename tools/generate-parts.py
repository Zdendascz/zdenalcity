r"""Vygeneruje díly pro animace a silnice přes OpenAI API (T115–T126).

    python tools/generate-parts.py --dry-run             # co by se generovalo a za kolik
    python tools/generate-parts.py --only rotor           # jeden díl
    python tools/generate-parts.py --all                  # všechno, co chybí

Zadání čte z `docs/18-DILY.md`: díl je nadpis `#### \`id\``, pod ním řádky
`Plátno:`, `Kvalita:`, volitelně `Vstup:` (obrázek, ze kterého se vychází —
pak jde požadavek na `images/edits`) a prompt v oploceném bloku. Hlavička
stylu je první oplocený blok dokumentu a připojuje se ke každému promptu,
pokud díl neřekne `Hlavička: ne`.

Výstup jde do `art/parts/raw/<id>.png` tak, jak ho vrátil generátor. Co tam
už leží, se přeskočí — dá se pouštět opakovaně.

## Peníze

Autor povolil **24 USD** (2026-09-29). Každá odpověď API nese `usage`
a skript z ní spočítá cenu a připíše ji do `art/parts/spend.jsonl`. Před
každým požadavkem sečte deník a odhad dalšího obrázku; když by součet
přesáhl `BUDGET`, skončí. Sazby jsou ceník `gpt-image-1` — pro `gpt-image-2`
ho nemám ověřený, a tak je odhad schválně spíš vyšší než nižší.
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
SPEC = ROOT / 'docs' / '18-DILY.md'
RAW = ROOT / 'art' / 'parts' / 'raw'
LEDGER = ROOT / 'art' / 'parts' / 'spend.jsonl'
API = 'https://api.openai.com/v1/images'
MODEL = 'gpt-image-2'

# Strop útraty. O dva dolary pod povolenými 24 — rezerva na nepřesný ceník.
BUDGET = 22.0

# USD za milion tokenů (ceník gpt-image-1, viz docstring).
RATE_TEXT_IN = 5.0
RATE_IMAGE_IN = 10.0
RATE_IMAGE_OUT = 40.0

# Odhad výstupních tokenů pro kontrolu před požadavkem.
OUT_TOKENS = {
    ('1024x1024', 'low'): 272, ('1024x1024', 'medium'): 1056, ('1024x1024', 'high'): 4160,
    ('1024x1536', 'low'): 408, ('1024x1536', 'medium'): 1584, ('1024x1536', 'high'): 6240,
    ('1536x1024', 'low'): 400, ('1536x1024', 'medium'): 1568, ('1536x1024', 'high'): 6208,
}

FENCE = re.compile(r'```(?:text)?\n(.*?)```', re.S)
PART = re.compile(r'^#### `([a-z0-9_]+)`.*?$(.*?)(?=^#### |^## |\Z)', re.S | re.M)


def tls_context() -> ssl.SSLContext:
    """HTTPS s ověřením. Windowsové úložiště má na tomhle stroji vadný záznam
    (`ASN1 nested asn1 error`), takže se v nouzi bere `certifi` — stejně jako
    v `generate-sprites.py`. Ověřování se nevypíná, jde tudy API klíč."""
    try:
        return ssl.create_default_context()
    except ssl.SSLError:
        pass
    try:
        import certifi
    except ImportError:
        raise SystemExit('Úložiště certifikátů je poškozené a chybí certifi: pip install certifi')
    return ssl.create_default_context(cafile=certifi.where())


TLS = tls_context()


def read_spec() -> tuple[str, dict[str, dict]]:
    text = SPEC.read_text(encoding='utf-8')
    header_match = FENCE.search(text)
    if header_match is None:
        raise SystemExit('V zadání chybí hlavička stylu.')
    header = header_match.group(1).strip()
    parts: dict[str, dict] = {}
    for match in PART.finditer(text):
        name, body = match.group(1), match.group(2)
        prompt = FENCE.search(body)
        if prompt is None:
            continue

        def field(label: str, default: str | None = None) -> str | None:
            found = re.search(rf'^{label}:\s*`?([^`\n]+)`?\s*$', body, re.M)
            return found.group(1).strip() if found else default

        parts[name] = {
            'prompt': prompt.group(1).strip(),
            'size': field('Plátno', '1024x1024'),
            'quality': field('Kvalita', 'high'),
            'input': field('Vstup'),
            'header': field('Hlavička', 'ano') != 'ne',
        }
    return header, parts


def spent() -> float:
    if not LEDGER.exists():
        return 0.0
    total = 0.0
    for line in LEDGER.read_text(encoding='utf-8').splitlines():
        if line.strip():
            total += float(json.loads(line).get('usd', 0.0))
    return total


def estimate(size: str, quality: str, with_input: bool) -> float:
    out = OUT_TOKENS.get((size, quality), 6240)
    image_in = 1500 if with_input else 0
    return (out * RATE_IMAGE_OUT + image_in * RATE_IMAGE_IN + 600 * RATE_TEXT_IN) / 1e6


def cost(usage: dict) -> float:
    details = usage.get('input_tokens_details') or {}
    text_in = details.get('text_tokens', usage.get('input_tokens', 0))
    image_in = details.get('image_tokens', 0)
    out = usage.get('output_tokens', 0)
    return (text_in * RATE_TEXT_IN + image_in * RATE_IMAGE_IN + out * RATE_IMAGE_OUT) / 1e6


def multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes]]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        parts.append(value.encode('utf-8'))
        parts.append(b'\r\n')
    for name, (filename, blob) in files.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
            f'filename="{filename}"\r\nContent-Type: image/png\r\n\r\n'.encode()
        )
        parts.append(blob)
        parts.append(b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'


def request(key: str, prompt: str, size: str, quality: str, source: bytes | None) -> tuple[bytes, dict]:
    fields = {
        'model': MODEL,
        'prompt': prompt,
        'size': size,
        'quality': quality,
        'n': '1',
        'background': 'transparent',
        'output_format': 'png',
    }
    if source is None:
        body = json.dumps({**fields, 'n': 1}).encode('utf-8')
        req = urllib.request.Request(
            f'{API}/generations',
            data=body,
            headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
        )
    else:
        body, content_type = multipart(fields, {'image[]': ('source.png', source)})
        req = urllib.request.Request(
            f'{API}/edits',
            data=body,
            headers={'Authorization': f'Bearer {key}', 'Content-Type': content_type},
        )

    delay = 20.0
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=400, context=TLS) as response:
                payload = json.loads(response.read())
            return base64.b64decode(payload['data'][0]['b64_json']), payload.get('usage') or {}
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429, 500, 502, 503, 504) or attempt == 4:
                detail = error.read().decode('utf-8', 'replace')[:400]
                raise SystemExit(f'API odmítlo ({error.code}): {detail}')
            print(f'      {error.code}, zkouším za {delay:.0f} s')
            time.sleep(delay)
            delay *= 2
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 4:
                raise SystemExit(f'spojení selhalo: {error}')
            print(f'      spojení: {error}, zkouším za {delay:.0f} s')
            time.sleep(delay)
            delay *= 2
    raise SystemExit('nepodařilo se ani po opakování')


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    argv = sys.argv[1:]
    dry = '--dry-run' in argv
    everything = '--all' in argv
    only = next((a.split('=', 1)[1] for a in argv if a.startswith('--only=')), None)
    if only is None and '--only' in argv:
        at = argv.index('--only')
        only = argv[at + 1] if at + 1 < len(argv) else None
    if only is None and not everything and not dry:
        print('Řekni --only <id>[,<id>] nebo --all.')
        return 1

    header, parts = read_spec()
    wanted = set(only.split(',')) if only else None
    if wanted and wanted - set(parts):
        print('Zadání nezná: ' + ', '.join(sorted(wanted - set(parts))))
        return 1

    RAW.mkdir(parents=True, exist_ok=True)
    todo = [
        name for name in sorted(parts)
        if (wanted is None or name in wanted) and not (RAW / f'{name}.png').exists()
    ]
    total = spent()
    planned = sum(
        estimate(parts[n]['size'], parts[n]['quality'], parts[n]['input'] is not None) for n in todo
    )
    print(f'Utraceno {total:.2f} USD z {BUDGET:.0f}, v plánu {len(todo)} dílů za ~{planned:.2f} USD.')
    if dry or not todo:
        for name in todo:
            part = parts[name]
            print(f'  {name}: {part["size"]} {part["quality"]}' + (f' ← {part["input"]}' if part['input'] else ''))
        return 0

    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        print('Chybí OPENAI_API_KEY.')
        return 1

    for name in todo:
        part = parts[name]
        guess = estimate(part['size'], part['quality'], part['input'] is not None)
        total = spent()
        if total + guess > BUDGET:
            print(f'Stop: {total:.2f} + {guess:.2f} by přesáhlo {BUDGET:.0f} USD.')
            return 2
        source = (ROOT / part['input']).read_bytes() if part['input'] else None
        prompt = f'{header}\n\n{part["prompt"]}' if part['header'] else part['prompt']
        print(f'  {name} ({part["size"]}, {part["quality"]}) …', flush=True)
        started = time.time()
        png, usage = request(key, prompt, part['size'], part['quality'], source)
        (RAW / f'{name}.png').write_bytes(png)
        usd = cost(usage) if usage else guess
        with LEDGER.open('a', encoding='utf-8') as ledger:
            ledger.write(json.dumps({
                'part': name, 'model': MODEL, 'size': part['size'], 'quality': part['quality'],
                'usage': usage, 'usd': round(usd, 4), 'at': time.strftime('%Y-%m-%dT%H:%M:%S'),
            }) + '\n')
        print(f'    hotovo za {time.time() - started:.0f} s, {usd:.3f} USD (celkem {spent():.2f})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
