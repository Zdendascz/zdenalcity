import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  applySaveToWorld,
  collectLoadWarnings,
  expectedLayersByteLength,
  readSaveMeta,
  unpackSave,
} from '@/save/deserialize';
import {
  CURRENT_FORMAT_VERSION,
  GAME_VERSION,
  SAVE_FILES,
  SAVE_LAYER_ORDER,
  SaveFormatError,
  SaveMigrationError,
} from '@/save/format';
import type { SaveData } from '@/save/format';
import { migrate } from '@/save/migrations';
import type { Migration } from '@/save/migrations';
import { packLayers, serializeSave, toSaveData } from '@/save/serialize';
import type { SaveOptions } from '@/save/serialize';
import { buildRoad, placeDefinition, setTaxRate, zoneArea } from '@/sim/commands';
import { hashLayers, index, LAYER_ORDER, MAP_SIZE, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { Building, WorldState } from '@/sim/world';

const OPTIONS: SaveOptions = {
  cityName: 'Nový Brod',
  createdAt: '2026-08-18T10:00:00.000Z',
  modifiedAt: '2026-08-18T12:30:00.000Z',
  playtimeSeconds: 9000,
  sources: [{ id: 'vanilla', version: '0.1.0' }],
};

async function loadedContent(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Postaví deterministické město: silnice, obytná a průmyslová zóna, elektrárna. */
async function builtCity(seed = 483928492): Promise<{ world: WorldState; content: ContentRegistry }> {
  const content = await loadedContent();
  const world = createWorld(seed);

  for (let x = 20; x <= 45; x++) buildRoad(world, x, 40);
  for (let x = 22; x <= 40; x++) zoneArea(world, x, 41, 1, 1, ZONE.residential);
  zoneArea(world, 22, 37, 12, 2, ZONE.industrial);
  for (let x = 22; x <= 40; x++) buildRoad(world, x, 39);
  placeDefinition(world, content, 'vanilla:coal_power_plant', 20, 41);
  setTaxRate(world, ZONE.residential, 9);

  const systems = createDefaultSystems(content, content.getBalance());
  for (let tick = 0; tick < 600; tick++) tickWorld(world, systems);

  return { world, content };
}

function containsBytes(haystack: Uint8Array, needle: string): boolean {
  const target = strToU8(needle);
  outer: for (let start = 0; start + target.length <= haystack.length; start++) {
    for (let i = 0; i < target.length; i++) {
      if (haystack[start + i] !== target[i]) continue outer;
    }
    return true;
  }
  return false;
}

describe('formát savu', () => {
  it('GAME_VERSION odpovídá package.json', () => {
    const modules = import.meta.glob('../package.json', { eager: true, import: 'default' });
    const pkg = Object.values(modules)[0] as { version: string };
    expect(GAME_VERSION).toBe(pkg.version);
  });

  it('pořadí vrstev v savu pokrývá přesně všechny vrstvy', () => {
    // Kdyby vznikla nová vrstva a zapomnělo se na ni v savu, tenhle test spadne.
    expect([...SAVE_LAYER_ORDER].sort()).toEqual([...LAYER_ORDER].sort());
  });

  it('layers.bin má očekávanou délku', async () => {
    const { world } = await builtCity();
    expect(packLayers(world.layers).byteLength).toBe(expectedLayersByteLength());
    // 6 vrstev, z toho jedna dvoubajtová.
    expect(expectedLayersByteLength()).toBe(MAP_SIZE * MAP_SIZE * 7);
  });

  it('meta.json je v ZIPu nekomprimovaná, aby se dala číst samostatně', async () => {
    const { world } = await builtCity();
    const bytes = serializeSave(world, OPTIONS);
    expect(containsBytes(bytes, '"formatVersion": 1')).toBe(true);
    expect(containsBytes(bytes, '"Nový Brod"')).toBe(true);
  });

  it('readSaveMeta přečte metadata bez rozbalení zbytku', async () => {
    const { world } = await builtCity();
    const bytes = serializeSave(world, OPTIONS);

    const meta = readSaveMeta(bytes);

    expect(meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(meta.gameVersion).toBe(GAME_VERSION);
    expect(meta.city).toEqual({ name: 'Nový Brod', seed: 483928492 });
    expect(meta.playtimeSeconds).toBe(9000);
    expect(meta.content.sources).toEqual([{ id: 'vanilla', version: '0.1.0' }]);
    expect(meta.preview.tick).toBe(600);
    expect(meta.preview.population).toBeGreaterThan(0);
  });
});

describe('round-trip', () => {
  it('serialize → deserialize dá identický stav (§13 krok 8)', async () => {
    const { world, content } = await builtCity();
    const before = {
      hash: hashLayers(world.layers),
      rng: world.rng.getState(),
      tick: world.tick,
      buildings: [...world.buildings.values()],
      nextBuildingId: world.nextBuildingId,
      economy: JSON.parse(JSON.stringify(world.economy)),
      demand: { ...world.demand },
      seed: world.seed,
    };
    expect(before.buildings.length).toBeGreaterThan(5);

    const bytes = serializeSave(world, OPTIONS);
    const restored = createWorld(1); // jiný seed, ať je vidět, že se přepíše
    applySaveToWorld(restored, migrate(unpackSave(bytes)));

    expect(hashLayers(restored.layers)).toBe(before.hash);
    expect(restored.rng.getState()).toBe(before.rng);
    expect(restored.tick).toBe(before.tick);
    // `levelChangedAtTick` save verze 1 nenese — podle §11 zadání fáze 2 se při
    // migraci nuluje a ukládat ho začne až formát v2 v T20. Jediné pole, které
    // round-trip nepřežije; kdyby jich přibylo víc, tenhle test to řekne.
    const withoutLevelClock = (buildings: readonly Building[]): Partial<Building>[] =>
      buildings.map((building) => {
        const copy: Partial<Building> = { ...building };
        delete copy.levelChangedAtTick;
        return copy;
      });
    expect(withoutLevelClock([...restored.buildings.values()])).toEqual(
      withoutLevelClock(before.buildings),
    );
    expect([...restored.buildings.values()].every((b) => b.levelChangedAtTick === 0)).toBe(true);
    expect(restored.nextBuildingId).toBe(before.nextBuildingId);
    expect(restored.economy).toEqual(before.economy);
    expect(restored.demand).toEqual(before.demand);
    expect(restored.seed).toBe(before.seed);

    // A hlavně: pokračování hry se nesmí rozejít.
    const systems = createDefaultSystems(content, content.getBalance());
    for (let tick = 0; tick < 120; tick++) {
      tickWorld(world, systems);
      tickWorld(restored, systems);
    }
    expect(hashLayers(restored.layers)).toBe(hashLayers(world.layers));
    expect(restored.rng.getState()).toBe(world.rng.getState());
  });

  it('přežije hodnotu buildingId nad 255 (endianita)', () => {
    const world = createWorld(1);
    world.layers.buildingId[index(10, 10)] = 4242;

    const restored = createWorld(1);
    applySaveToWorld(restored, unpackSave(serializeSave(world, OPTIONS)));

    expect(restored.layers.buildingId[index(10, 10)]).toBe(4242);
  });

  it('po loadu se překresluje všechno a síť se přepočítá', async () => {
    const { world } = await builtCity();
    const bytes = serializeSave(world, OPTIONS);

    const restored = createWorld(1);
    restored.dirty.fullRedraw = false;
    restored.powerNetworkDirty = false;

    applySaveToWorld(restored, unpackSave(bytes));

    expect(restored.dirty.fullRedraw).toBe(true);
    expect(restored.powerNetworkDirty).toBe(true);
  });

  it('v savu jsou definice jako stringy s namespace, nikdy indexy (P6)', async () => {
    const { world } = await builtCity();
    const save = toSaveData(world, OPTIONS);

    for (const building of save.entities.buildings) {
      expect(building.definitionId).toMatch(/^vanilla:[a-z_]+$/);
    }
  });
});

describe('rozbité savy', () => {
  async function validSave(): Promise<SaveData> {
    const { world } = await builtCity();
    return toSaveData(world, OPTIONS);
  }

  it('nesmyslné bajty nejsou ZIP', () => {
    expect(() => unpackSave(new Uint8Array([1, 2, 3, 4]))).toThrow(SaveFormatError);
  });

  it('chybějící soubor v ZIPu je chyba, ne tichý pád', async () => {
    const save = await validSave();
    const bytes = zipSync({
      [SAVE_FILES.meta]: strToU8(JSON.stringify(save.meta)),
      [SAVE_FILES.layers]: save.layers,
      // entities.json schválně chybí
      [SAVE_FILES.state]: strToU8(JSON.stringify(save.state)),
    });

    expect(() => unpackSave(bytes)).toThrow(/entities\.json/);
  });

  it('layers.bin špatné délky je chyba', async () => {
    const save = await validSave();
    const bytes = zipSync({
      [SAVE_FILES.meta]: strToU8(JSON.stringify(save.meta)),
      [SAVE_FILES.layers]: new Uint8Array(100),
      [SAVE_FILES.entities]: strToU8(JSON.stringify(save.entities)),
      [SAVE_FILES.state]: strToU8(JSON.stringify(save.state)),
    });

    expect(() => applySaveToWorld(createWorld(1), unpackSave(bytes))).toThrow(
      /layers\.bin má 100 B/,
    );
  });

  it('chybějící pole v entitě je chyba s uvedením místa', async () => {
    const save = await validSave();
    const broken = {
      nextBuildingId: save.entities.nextBuildingId,
      buildings: [{ ...save.entities.buildings[0], powered: undefined }],
    };
    const bytes = zipSync({
      [SAVE_FILES.meta]: strToU8(JSON.stringify(save.meta)),
      [SAVE_FILES.layers]: save.layers,
      [SAVE_FILES.entities]: strToU8(JSON.stringify(broken)),
      [SAVE_FILES.state]: strToU8(JSON.stringify(save.state)),
    });

    expect(() => unpackSave(bytes)).toThrow(/entities\.buildings\[0\]\.powered/);
  });

  it('stav RNG mimo uint32 je chyba — jinak by se rozešel determinismus', async () => {
    const save = await validSave();
    const bytes = zipSync({
      [SAVE_FILES.meta]: strToU8(JSON.stringify(save.meta)),
      [SAVE_FILES.layers]: save.layers,
      [SAVE_FILES.entities]: strToU8(JSON.stringify(save.entities)),
      [SAVE_FILES.state]: strToU8(JSON.stringify({ ...save.state, rngState: -5 })),
    });

    expect(() => unpackSave(bytes)).toThrow(/rngState/);
  });
});

describe('migrace', () => {
  async function saveWithVersion(version: number): Promise<SaveData> {
    const { world } = await builtCity();
    const save = toSaveData(world, OPTIONS);
    return { ...save, meta: { ...save.meta, formatVersion: version } };
  }

  it('aktuální verze projde bez zásahu', async () => {
    const save = await saveWithVersion(CURRENT_FORMAT_VERSION);
    expect(migrate(save)).toBe(save);
  });

  it('save z novější hry skončí SaveMigrationError', async () => {
    const save = await saveWithVersion(CURRENT_FORMAT_VERSION + 1);
    expect(() => migrate(save)).toThrow(SaveMigrationError);
  });

  it('chybějící migrace skončí chybou s uvedením verze', async () => {
    const save = await saveWithVersion(1);
    expect(() => migrate(save, {}, 3)).toThrow(/formatVersion 1/);
  });

  it('řetěz migrací se projde postupně a v pořadí', async () => {
    // Mechanika se testuje falešným řetězem, ne vymyšlenou verzí formátu.
    const visited: number[] = [];
    const bump =
      (to: number): Migration =>
      (save) => {
        visited.push(save.meta.formatVersion);
        return { ...save, meta: { ...save.meta, formatVersion: to } };
      };

    const save = await saveWithVersion(1);
    const migrated = migrate(save, { 1: bump(2), 2: bump(3) }, 3);

    expect(visited).toEqual([1, 2]);
    expect(migrated.meta.formatVersion).toBe(3);
  });

  it('migrace, která verzi nezvýší, neskončí v nekonečné smyčce', async () => {
    const save = await saveWithVersion(1);
    expect(() => migrate(save, { 1: (s) => s }, 2)).toThrow(SaveMigrationError);
  });
});

describe('chybějící obsah při načtení', () => {
  it('vypíše chybějící zdroj i definici a budovy nesmaže', async () => {
    const { world } = await builtCity();
    const save = toSaveData(world, {
      ...OPTIONS,
      sources: [
        { id: 'vanilla', version: '0.1.0' },
        { id: 'zdendas_pack', version: '1.2.0' },
      ],
    });
    save.entities.buildings.push({
      ...save.entities.buildings[0]!,
      id: 9999,
      definitionId: 'zdendas_pack:castle',
    });

    const content = await loadedContent();
    const warnings = collectLoadWarnings(save, content, content.getLoadedSources());

    expect(warnings.missingSources).toEqual([{ id: 'zdendas_pack', version: '1.2.0' }]);
    expect(warnings.missingDefinitions).toEqual(['zdendas_pack:castle']);

    // Budova se nesmí zahodit, jen se nevykreslí.
    const restored = createWorld(1);
    applySaveToWorld(restored, save);
    expect(restored.buildings.get(9999)?.definitionId).toBe('zdendas_pack:castle');
  });

  it('u kompletního obsahu nic nehlásí', async () => {
    const { world } = await builtCity();
    const save = toSaveData(world, OPTIONS);
    const content = await loadedContent();

    const warnings = collectLoadWarnings(save, content, content.getLoadedSources());

    expect(warnings.missingSources).toEqual([]);
    expect(warnings.missingDefinitions).toEqual([]);
  });
});

describe('ZIP kontejner', () => {
  it('obsahuje právě čtyři očekávané soubory', async () => {
    const { world } = await builtCity();
    const files = unzipSync(serializeSave(world, OPTIONS));
    expect(Object.keys(files).sort()).toEqual(
      ['entities.json', 'layers.bin', 'meta.json', 'state.json'].sort(),
    );
  });
});
