import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { applySaveToWorld, collectLoadWarnings, readSaveMeta, unpackSave } from '@/save/deserialize';
import { CURRENT_FORMAT_VERSION } from '@/save/format';
import { migrate } from '@/save/migrations';
import { hashLayers } from '@/sim/layers';
import { createWorld, totalPopulation } from '@/sim/world';

/**
 * Fixtury savů (P7).
 *
 * Ke každé vydané verzi formátu patří **skutečný save** a tenhle test ověřuje,
 * že se načte do aktuální verze. Na rozdíl od databázových migrací tu nejde nic
 * rollbacknout — soubory jsou u hráčů.
 *
 * Fixtura je uložená jako base64, ne jako binárka: testy nemají typy pro `fs`
 * (`@types/node` není mezi závislostmi), takže binární soubor by nešlo přečíst.
 */
const fixtures = import.meta.glob('./fixtures/saves/*.base64', {
  eager: true,
  import: 'default',
  query: '?raw',
});

function decode(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

describe('fixtury savů', () => {
  it('nějaká fixtura existuje — jinak by tenhle test nic netestoval', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(0);
  });

  for (const [path, raw] of Object.entries(fixtures)) {
    const name = path.split('/').pop() ?? path;

    it(`${name} se načte do aktuální verze formátu`, async () => {
      const bytes = decode(raw as string);

      const meta = readSaveMeta(bytes);
      expect(meta.formatVersion).toBeLessThanOrEqual(CURRENT_FORMAT_VERSION);

      const save = migrate(unpackSave(bytes));
      expect(save.meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);

      const world = createWorld(1);
      applySaveToWorld(world, save);

      // Město z fixtury: 22 budov, 136 obyvatel, 600 tiků.
      expect(world.tick).toBe(meta.preview.tick);
      expect(totalPopulation(world.buildings)).toBe(meta.preview.population);
      expect(world.economy.funds).toBe(meta.preview.funds);
      expect(world.buildings.size).toBeGreaterThan(0);

      // Vrstvy proti snapshotu: kdyby se změnilo čtení layers.bin, tohle spadne.
      expect(hashLayers(world.layers)).toMatchSnapshot();
    });

    it(`${name} nehlásí chybějící obsah proti vanilla registru`, async () => {
      const content = new ContentRegistry();
      await content.load(createVanillaSource());

      const save = migrate(unpackSave(decode(raw as string)));
      const warnings = collectLoadWarnings(save, content, content.getLoadedSources());

      expect(warnings.missingSources).toEqual([]);
      expect(warnings.missingDefinitions).toEqual([]);
    });
  }
});
