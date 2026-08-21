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
import { COARSE_CELLS } from '@/sim/coarse';
import { applyCornerChanges, countViolations, planCornerHeight } from '@/sim/heights';
import {
  buildPipe,
  buildRoad,
  placeDefinition,
  setServiceFunding,
  setTaxRate,
  zoneArea,
} from '@/sim/commands';
import { hashLayers, index, LAYER_ORDER, MAP_SIZE, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { assumeWatered } from './support/water';

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
  // Potrubí pod celou hlavní ulicí. Od verze 5 je vrstva `pipe` v savu, takže
  // ji testovací město musí mít doopravdy položenou, ne jen předstíranou.
  for (let x = 20; x <= 45; x++) buildPipe(world, x, 40);

  // Vodárna na téhle mapě stát nemůže — je to holá tráva bez břehu — takže
  // samotné zavodnění zůstává danost. Save se testuje na tom, co ve světě je,
  // ne na tom, jestli hráč stihl postavit vodárnu (§8 fáze 3).
  assumeWatered(world);

  const systems = createDefaultSystems(content, content.getBalance());
  for (let tick = 0; tick < 600; tick++) {
    tickWorld(world, systems);
    assumeWatered(world);
  }

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

  it('v savu jsou všechny vrstvy, žádná nezůstala stranou', () => {
    // Kdyby vznikla nová vrstva a zapomnělo se na ni v savu, tenhle test spadne.
    // Do verze 4 tu byla výjimka `pipe`; T40 ji zrušil, takže seznam je prázdný
    // a nová vrstva se bez nové verze formátu neprotáhne.
    const saved: readonly string[] = SAVE_LAYER_ORDER;
    const missing = [...LAYER_ORDER].filter((layer) => !saved.includes(layer));
    expect(missing).toEqual([]);
  });

  it('layers.bin má očekávanou délku', async () => {
    const { world } = await builtCity();
    expect(packLayers(world.layers).byteLength).toBe(expectedLayersByteLength());
    // 6 vrstev, z toho jedna dvoubajtová. `elevation` zmizela ve verzi 4
    // (výšku nese `heights.bin`), `pipe` přibyla ve verzi 5.
    expect(expectedLayersByteLength()).toBe(MAP_SIZE * MAP_SIZE * 7);
  });

  it('meta.json je v ZIPu nekomprimovaná, aby se dala číst samostatně', async () => {
    const { world } = await builtCity();
    const bytes = serializeSave(world, OPTIONS);
    expect(containsBytes(bytes, `"formatVersion": ${CURRENT_FORMAT_VERSION}`)).toBe(true);
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
    // Obě města mají vodu jako danost, protože na téhle mapě nemá vodárna kde
    // stát (viz `builtCity`). Kdyby ji dostalo jen jedno, rozešla by se kvůli
    // chybějící vodě, ne kvůli savu — a to by tenhle test netestoval.
    assumeWatered(restored);

    expect(hashLayers(restored.layers)).toBe(before.hash);
    expect(restored.rng.getState()).toBe(before.rng);
    expect(restored.tick).toBe(before.tick);
    // Od verze 2 přežije entita round-trip celá, včetně `levelChangedAtTick`
    // a `abandoned`.
    expect([...restored.buildings.values()]).toEqual(before.buildings);
    expect(restored.nextBuildingId).toBe(before.nextBuildingId);
    expect(restored.economy).toEqual(before.economy);
    expect(restored.demand).toEqual(before.demand);
    expect(restored.seed).toBe(before.seed);

    // A hlavně: pokračování hry se nesmí rozejít.
    const systems = createDefaultSystems(content, content.getBalance());
    for (let tick = 0; tick < 120; tick++) {
      tickWorld(world, systems);
      tickWorld(restored, systems);
      assumeWatered(world);
      assumeWatered(restored);
    }
    expect(hashLayers(restored.layers)).toBe(hashLayers(world.layers));
    expect(restored.rng.getState()).toBe(world.rng.getState());
  });

  it('po loadu znovu spočítá pokrytí službami', async () => {
    // Regrese: load nastavoval jen `powerNetworkDirty`, ne `coverageDirty`.
    // Načtené město tím přišlo o všechny služby — žádný bonus k ceně půdy,
    // žádné srážení kriminality, žádné zdravotnictví — a nikdo si toho nevšiml,
    // dokud hráč nepostavil další stanici. V uloženém městě to dělalo rozdíl
    // mezi cenou půdy 0 a 27.
    const content = await loadedContent();
    const world = createWorld(1);
    for (let x = 20; x <= 30; x++) buildRoad(world, x, 40);
    placeDefinition(world, content, 'vanilla:police_small', 22, 41);

    const systems = createDefaultSystems(content, content.getBalance());
    for (let tick = 0; tick < 40; tick++) tickWorld(world, systems);
    const expected = world.coverage.get('police');
    expect(expected?.some((value) => value > 0)).toBe(true);

    const bytes = serializeSave(world, OPTIONS);
    const restored = createWorld(1);
    applySaveToWorld(restored, migrate(unpackSave(bytes)));

    // Hned po loadu ještě pokrytí není, ale svět ví, že ho má spočítat.
    expect(restored.coverageDirty).toBe(true);
    for (let tick = 0; tick < 40; tick++) tickWorld(restored, systems);
    expect([...(restored.coverage.get('police') ?? [])]).toEqual([...(expected ?? [])]);
  });

  it('nenechá do načteného města protéct stav toho předchozího', async () => {
    const content = await loadedContent();
    const { world } = await builtCity();
    const bytes = serializeSave(world, OPTIONS);

    // Svět, ve kterém se už hrálo něco jiného.
    const restored = createWorld(1);
    restored.coverage.set('parks', new Uint8Array(COARSE_CELLS).fill(200));
    restored.serviceFunding.set('parks', 0.3);
    restored.coarse.landValue.fill(200);
    restored.coarse.crime.fill(200);
    restored.downgradeStreak.set(1, 2);
    // Vodovod minulého města: budovy s cizími id a rozvedená voda tam, kde
    // v načtené mapě žádná trubka nevede.
    restored.waterSupply.fill(1);
    restored.watered.add(4242);
    restored.waterlessStreak.set(4242, 7);

    applySaveToWorld(restored, migrate(unpackSave(bytes)));

    // Voda je odvozená (R10), takže se po loadu **nuluje**, ne dědí.
    expect(restored.watered.size).toBe(0);
    expect(restored.waterlessStreak.size).toBe(0);
    expect([...restored.waterSupply].every((value) => value === 0)).toBe(true);
    expect(restored.waterNetworkDirty).toBe(true);

    assumeWatered(restored); // viz round-trip: vodárna nemá na téhle mapě břeh

    // Pokrytí je odvozené, do savu nepatří a po loadu se počítá znovu.
    expect(restored.coverage.size).toBe(0);
    expect(restored.coverageDirty).toBe(true);
    expect(restored.downgradeStreak.size).toBe(0);
    // Financování i hrubé vrstvy přepsal save, ne zbytek po minulém městě.
    expect(restored.serviceFunding.has('parks')).toBe(false);
    expect([...restored.coarse.landValue]).toEqual([...world.coarse.landValue]);
    expect([...restored.coarse.crime]).toEqual([...world.coarse.crime]);
    expect([...restored.coarse.pollution]).toEqual([...world.coarse.pollution]);

    // A pokračování hry se nesmí rozejít.
    const systems = createDefaultSystems(content, content.getBalance());
    for (let tick = 0; tick < 60; tick++) {
      tickWorld(world, systems);
      tickWorld(restored, systems);
      assumeWatered(world);
      assumeWatered(restored);
    }
    expect([...restored.coarse.landValue]).toEqual([...world.coarse.landValue]);
  });

  it('financování tříd přežije round-trip', async () => {
    const { world } = await builtCity();
    setServiceFunding(world, 'police', 0.3);
    setServiceFunding(world, 'parks', 1);

    const restored = createWorld(1);
    applySaveToWorld(restored, migrate(unpackSave(serializeSave(world, OPTIONS))));

    expect(restored.serviceFunding.get('police')).toBe(0.3);
    expect(restored.serviceFunding.get('parks')).toBe(1);
  });

  it('kurzor vzorkování dopravy přežije round-trip (verze 3)', async () => {
    // Jediné, co z celé dopravy do savu patří. Bez něj by se po načtení
    // vzorkovalo od začátku a determinismus by padl.
    const { world } = await builtCity();
    world.trafficCursor = 37;

    const restored = createWorld(1);
    applySaveToWorld(restored, migrate(unpackSave(serializeSave(world, OPTIONS))));

    expect(restored.trafficCursor).toBe(37);
  });

  it('odvozená doprava se neukládá a po loadu je čistá (R10)', async () => {
    // Zátěž a dosažitelnost předchozího města nesmí přetéct do načteného:
    // silnice jsou jinde a budovy mají jiná id.
    const { world } = await builtCity();
    const bytes = serializeSave(world, OPTIONS);

    const restored = createWorld(1);
    restored.trafficLoad[index(5, 5)] = 999;
    restored.jobAccess.set(1234, 0.9);
    restored.jobAccessCells.fill(0.15);
    restored.cityJobAccess = 0.15;

    applySaveToWorld(restored, migrate(unpackSave(bytes)));

    expect([...restored.trafficLoad].every((value) => value === 0)).toBe(true);
    expect(restored.jobAccess.size).toBe(0);
    expect([...restored.jobAccessCells].every((value) => value === 1)).toBe(true);
    expect(restored.cityJobAccess).toBe(1);
  });

  it('patra terénu přežijí round-trip (verze 4)', async () => {
    // Do verze 3 se `cornerHeight` neukládalo vůbec a načtené město dostalo
    // placku. Tohle je ten dluh, který T34 splácí.
    const { world } = await builtCity();
    applyCornerChanges(world.cornerHeight, planCornerHeight(world.cornerHeight, 60, 60, 5));
    const before = Uint8Array.from(world.cornerHeight);
    expect(new Set(before).size).toBeGreaterThan(1);

    const restored = createWorld(1);
    applySaveToWorld(restored, migrate(unpackSave(serializeSave(world, OPTIONS))));

    expect(restored.cornerHeight).toEqual(before);
    expect(countViolations(restored.cornerHeight)).toBe(0);
  });

  it('potrubí přežije round-trip (verze 5)', async () => {
    // Do verze 4 se `pipe` neukládala vůbec: uložené město přišlo o vodovod
    // a začalo chátrat. Tohle je ten dluh, který T40 splácí.
    const { world } = await builtCity();
    const before = Uint8Array.from(world.layers.pipe);
    expect([...before].filter(Boolean).length).toBeGreaterThan(10);

    const restored = createWorld(1);
    applySaveToWorld(restored, migrate(unpackSave(serializeSave(world, OPTIONS))));

    expect(restored.layers.pipe).toEqual(before);
    // A síť se po loadu musí přepočítat — voda sama se neukládá (R10).
    expect(restored.waterNetworkDirty).toBe(true);
    expect(restored.watered.size).toBe(0);
    expect([...restored.waterSupply].every((value) => value === 0)).toBe(true);
  });

  it('save dvou stejných stavů je bajtově stejný', async () => {
    // ZIP si u každé položky ukládá čas. Dokud se bral systémový, lišily se dva
    // savy téhož města — a fixtura se nedala vygenerovat znovu a porovnat.
    const { world } = await builtCity();
    expect([...serializeSave(world, OPTIONS)]).toEqual([...serializeSave(world, OPTIONS)]);
  });

  it('čas v ZIPu je z meta.modifiedAt, ne ze systémových hodin', async () => {
    // Dvě uložení ve stejné vteřině vyjdou stejně i se systémovým časem, takže
    // předchozí test sám o sobě nestačí. Tenhle přečte datum přímo z hlavičky
    // první položky: DOS formát, rok od 1980 v horních sedmi bitech.
    const { world } = await builtCity();
    const bytes = serializeSave(world, { ...OPTIONS, modifiedAt: '2001-09-11T08:46:00.000Z' });

    const date = (bytes[12] ?? 0) | ((bytes[13] ?? 0) << 8);
    expect(1980 + ((date >> 9) & 0x7f)).toBe(2001);
  });

  it('vrstva elevation je pryč a nikdo ji nehledá (verze 4)', () => {
    // Od T29 byla mrtvá — výšku nese `cornerHeight`. Kdyby se někdy vrátila,
    // musí to být vědomé rozhodnutí, ne omyl.
    expect([...SAVE_LAYER_ORDER]).not.toContain('elevation');
    expect([...LAYER_ORDER]).not.toContain('elevation');
  });

  it('původ mapy přežije round-trip (verze 3)', async () => {
    const { world } = await builtCity();
    world.map = { seed: 123456, generated: true };

    const restored = createWorld(1);
    applySaveToWorld(restored, migrate(unpackSave(serializeSave(world, OPTIONS))));

    expect(restored.map).toEqual({ seed: 123456, generated: true });
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
    // Město má potrubí položené, takže se nemá na co stěžovat.
    expect(warnings.waterlessBuildings).toBe(0);
  });
});

describe('ZIP kontejner', () => {
  it('obsahuje právě šest očekávaných souborů', async () => {
    const { world } = await builtCity();
    const files = unzipSync(serializeSave(world, OPTIONS));
    expect(Object.keys(files).sort()).toEqual(
      [
        'coarse.bin',
        'entities.json',
        'heights.bin',
        'layers.bin',
        'meta.json',
        'state.json',
      ].sort(),
    );
  });
});
