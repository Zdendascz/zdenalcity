import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  applySaveToWorld,
  collectLoadWarnings,
  expectedCoarseByteLength,
  readSaveMeta,
  unpackSave,
} from '@/save/deserialize';
import { CURRENT_FORMAT_VERSION } from '@/save/format';
import { migrate } from '@/save/migrations';
import { COARSE_SIZE } from '@/sim/coarse';
import { hashLayers, MAP_SIZE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld, totalPopulation } from '@/sim/world';

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
  it('ke každé vydané verzi formátu existuje fixtura', () => {
    const versions = Object.keys(fixtures)
      .map((path) => Number(/v(\d+)\.city/.exec(path)?.[1] ?? 0))
      .sort((a, b) => a - b);

    expect(versions).toEqual(
      Array.from({ length: CURRENT_FORMAT_VERSION }, (_, i) => i + 1),
    );
  });

  it('migrace v1 → v2 doplní přesně to, co §11 předepisuje', () => {
    const v1 = Object.entries(fixtures).find(([path]) => path.includes('v1.city'));
    expect(v1).toBeDefined();
    if (!v1) return;

    const before = unpackSave(decode(v1[1] as string));
    expect(before.meta.formatVersion).toBe(1);
    expect(before.coarse.byteLength).toBe(0); // v1 hrubé vrstvy nenese

    const after = migrate(before);

    expect(after.meta.formatVersion).toBe(2);
    expect([...after.coarse].every((value) => value === 0)).toBe(true);
    expect(after.state.serviceFunding).toEqual({}); // všem třídám 100 %
    for (const building of after.entities.buildings) {
      expect(building.abandoned).toBe(false);
      expect(building.levelChangedAtTick).toBe(0);
    }
  });

  it('save verze 2 si hrubé vrstvy i financování nese sám', () => {
    const v2 = Object.entries(fixtures).find(([path]) => path.includes('v2.city'));
    expect(v2).toBeDefined();
    if (!v2) return;

    const save = migrate(unpackSave(decode(v2[1] as string)));

    expect([...save.coarse].some((value) => value > 0)).toBe(true);
    expect(save.state.serviceFunding).toEqual({ parks: 0.75 });
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

    it(`${name} po načtení pokračuje ve hře bez pádu`, async () => {
      const content = new ContentRegistry();
      await content.load(createVanillaSource());

      const world = createWorld(1, content.getBalance().economy);
      applySaveToWorld(world, migrate(unpackSave(decode(raw as string))));

      const systems = createDefaultSystems(content, content.getBalance());
      for (let tick = 0; tick < 200; tick++) tickWorld(world, systems);

      // Město ze starého savu nesmí po migraci vymřít ani zůstat bez ceny půdy.
      expect(totalPopulation(world.buildings)).toBeGreaterThan(0);
      expect([...world.coarse.landValue].some((value) => value > 0)).toBe(true);
    });

    it(`${name} projde migrací na tvar, který umí aktuální hra`, () => {
      const save = migrate(unpackSave(decode(raw as string)));

      // Kontejner si od verze 2 nese rozměry mřížek — bez nich by se `layers.bin`
      // četl podle toho, jak je zrovna velká mapa v kódu.
      expect(save.meta.grid).toEqual({ size: MAP_SIZE, coarseSize: COARSE_SIZE });
      expect(save.coarse.byteLength).toBe(expectedCoarseByteLength());
      for (const building of save.entities.buildings) {
        expect(typeof building.abandoned).toBe('boolean');
        expect(Number.isInteger(building.levelChangedAtTick)).toBe(true);
      }
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
