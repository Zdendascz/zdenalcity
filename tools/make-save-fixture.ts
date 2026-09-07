/**
 * Vyrobí fixturu savu pro aktuální verzi formátu z té předchozí.
 *
 *   npx vite build --ssr tools/make-save-fixture.ts --outDir tools/.build --logLevel error
 *   node tools/.build/make-save-fixture.js 8 9
 *
 * Vezme `tests/fixtures/saves/v<z>.city.base64`, přežene ho migracemi a zapíše
 * `v<na>.city.base64`. Fixtury musí existovat ke **každé vydané verzi**
 * (hlídá `tests/migrations.test.ts`), a ruční výroba přes hru je zbytečná
 * práce: migrace samy jsou to, co se testuje.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from '@/save/migrations';
import { packSave } from '@/save/serialize';
import { unpackSave } from '@/save/deserialize';

// Skript se pouští z kořene repa (`node tools/.build/...`), takže stačí
// relativní cesta — `import.meta.dirname` ukazuje do `tools/.build`.
const ROOT = process.cwd();
const DIR = resolve(ROOT, 'tests', 'fixtures', 'saves');

const from = Number(process.argv[2] ?? 8);
const to = Number(process.argv[3] ?? 9);

const text = readFileSync(resolve(DIR, `v${from}.city.base64`), 'utf8').replace(/\s+/g, '');
const bytes = Uint8Array.from(Buffer.from(text, 'base64'));

const migrated = migrate(unpackSave(bytes));
if (migrated.meta.formatVersion !== to) {
  throw new Error(`migrace dala verzi ${migrated.meta.formatVersion}, čekal jsem ${to}`);
}

const packed = packSave(migrated);
const out = Buffer.from(packed).toString('base64').replace(/(.{76})/g, '$1\n');
writeFileSync(resolve(DIR, `v${to}.city.base64`), `${out}\n`, 'utf8');
process.stdout.write(`v${from} → v${to}: ${packed.length} bajtů\n`);
