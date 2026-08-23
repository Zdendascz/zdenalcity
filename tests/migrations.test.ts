import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  applySaveToWorld,
  collectLoadWarnings,
  expectedCoarseByteLength,
  expectedHeightsByteLength,
  expectedLayersByteLength,
  readSaveMeta,
  unpackSave,
} from '@/save/deserialize';
import { CURRENT_FORMAT_VERSION } from '@/save/format';
import { migrate, MIGRATIONS } from '@/save/migrations';
import { countViolations } from '@/sim/heights';
import { hashLayers, ROAD, TERRAIN } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld, totalPopulation } from '@/sim/world';
import { MAP_SIZE, COARSE_SIZE } from './support/grid';

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

    const after = migrate(before, MIGRATIONS, 2);

    expect(after.meta.formatVersion).toBe(2);
    expect([...after.coarse].every((value) => value === 0)).toBe(true);
    expect(after.state.serviceFunding).toEqual({}); // všem třídám 100 %
    for (const building of after.entities.buildings) {
      expect(building.abandoned).toBe(false);
      expect(building.levelChangedAtTick).toBe(0);
    }
  });

  it('migrace v2 → v3 doplní přesně to, co §10 předepisuje', () => {
    const v2 = Object.entries(fixtures).find(([path]) => path.includes('v2.city'));
    expect(v2).toBeDefined();
    if (!v2) return;

    const before = migrate(unpackSave(decode(v2[1] as string)), MIGRATIONS, 2);
    const after = migrate(before, MIGRATIONS, 3);

    expect(after.meta.formatVersion).toBe(3);
    // Mapa verze 2 byla holá tráva, žádný generátor tehdy nebyl. Tvářit se, že
    // vznikla ze seedu, by byla lež — podle toho seedu by vyšel jiný terén.
    expect(after.meta.map).toEqual({ seed: 0, generated: false });
    expect(after.state.trafficCursor).toBe(0);

    // Bajty vrstev se nepřepisují: `ROAD.street` je 1 stejně jako ve verzi 2 a
    // nové terény se přidaly až za stávající hodnoty.
    expect(after.layers).toBe(before.layers);
    expect(after.coarse).toBe(before.coarse);
  });

  it('typy silnic a nové terény ze staré mapy znamenají pořád totéž', () => {
    // Kdyby někdo přečísloval ROAD nebo TERRAIN, tenhle test spadne dřív, než
    // se hráči rozsypou uložená města.
    expect(ROAD.none).toBe(0);
    expect(ROAD.street).toBe(1);
    expect(TERRAIN.grass).toBe(0);
    expect(TERRAIN.water).toBe(1);
    expect(TERRAIN.sand).toBe(2);
    expect(TERRAIN.rock).toBe(3);
  });

  it('fixtura v3 si původ mapy i kurzor dopravy nese sama', () => {
    const v3 = Object.entries(fixtures).find(([path]) => path.includes('v3.city'));
    expect(v3).toBeDefined();
    if (!v3) return;

    const save = unpackSave(decode(v3[1] as string));

    expect(save.meta.formatVersion).toBe(3);
    expect(save.meta.map?.generated).toBe(true);
    expect(save.meta.map?.seed).toBeGreaterThan(0);
    expect(Number.isInteger(save.state.trafficCursor)).toBe(true);

    // Mapa z generátoru: víc terénů než jen tráva, a všechny tři typy vozovky.
    const world = createWorld(1);
    applySaveToWorld(world, migrate(save));
    const terrains = new Set(world.layers.terrain);
    const roads = new Set(world.layers.road);
    expect(terrains.size).toBeGreaterThan(2);
    expect([...roads].sort()).toEqual([ROAD.none, ROAD.street, ROAD.avenue, ROAD.highway]);
  });

  it('migrace v3 → v4 udělá z mapy rovinu a vystřihne mrtvou vrstvu', () => {
    const v3 = Object.entries(fixtures).find(([path]) => path.includes('v3.city'));
    expect(v3).toBeDefined();
    if (!v3) return;

    const before = migrate(unpackSave(decode(v3[1] as string)), MIGRATIONS, 3);
    expect(before.heights.byteLength).toBe(0); // verze 3 patra nenese

    const after = migrate(before, MIGRATIONS, 4);

    expect(after.meta.formatVersion).toBe(4);
    // Rovná mapa: dopočítat patra ze seedu by šlo jen u map z generátoru a
    // i tam by se rozešla s tím, co hráč mezitím postavil.
    expect(after.heights.byteLength).toBe(expectedHeightsByteLength(MAP_SIZE));
    expect([...after.heights].every((value) => value === 0)).toBe(true);

    // `layers.bin` se zkrátil přesně o jednu jednobajtovou vrstvu.
    expect(before.layers.byteLength - after.layers.byteLength).toBe(MAP_SIZE * MAP_SIZE);
    // Ve verzi 4 to bylo 6 vrstev; `pipe` přibyla až v pětce, takže tady se
    // nesmí porovnávat s aktuální délkou — migrace popisuje minulost.
    expect(after.layers.byteLength).toBe(MAP_SIZE * MAP_SIZE * 6);
  });

  it('vystřižení vrstvy nepřeházelo ty ostatní', () => {
    // Nejnebezpečnější místo celé migrace: vrstvy leží v jednom bufferu za
    // sebou, takže špatný posun by z terénu udělal zóny a nikdo by si toho
    // nemusel všimnout, dokud se mapa nevykreslí.
    const v3 = Object.entries(fixtures).find(([path]) => path.includes('v3.city'));
    if (!v3) return;

    const cells = MAP_SIZE * MAP_SIZE;
    const before = migrate(unpackSave(decode(v3[1] as string)), MIGRATIONS, 3);
    const after = migrate(before, MIGRATIONS, 4);

    // Terén zůstal na začátku beze změny…
    expect([...after.layers.subarray(0, cells)]).toEqual([...before.layers.subarray(0, cells)]);
    // …a zbytek se posunul o přesně jednu vrstvu doleva.
    expect([...after.layers.subarray(cells)]).toEqual([...before.layers.subarray(cells * 2)]);
  });

  it('migrace v4 → v5 připíše prázdné potrubí a nic jiného', () => {
    const v4 = Object.entries(fixtures).find(([path]) => path.includes('v4.city'));
    expect(v4).toBeDefined();
    if (!v4) return;

    const before = migrate(unpackSave(decode(v4[1] as string)), MIGRATIONS, 4);
    const after = migrate(before, MIGRATIONS, 5);
    const cells = MAP_SIZE * MAP_SIZE;

    expect(after.meta.formatVersion).toBe(5);
    expect(after.layers.byteLength - before.layers.byteLength).toBe(cells);
    expect(after.layers.byteLength).toBe(expectedLayersByteLength(MAP_SIZE));

    // Stávající vrstvy zůstaly bajt po bajtu tam, kde byly…
    expect([...after.layers.subarray(0, before.layers.byteLength)]).toEqual([...before.layers]);
    // …a nová je prázdná: síť, kterou hráč nepostavil, se vymýšlet nesmí.
    expect([...after.layers.subarray(before.layers.byteLength)].every((v) => v === 0)).toBe(true);

    const world = createWorld(1);
    applySaveToWorld(world, after);
    expect([...world.layers.pipe].every((value) => value === 0)).toBe(true);
  });

  it('město po migraci na v5 dostane hlášku, ne tichou zkázu', async () => {
    // §10: „Hráč o tom musí být zpraven hláškou při načtení, ne až úbytkem
    // obyvatel." Bez potrubí přestane budovám téct voda a začnou chátrat.
    const v4 = Object.entries(fixtures).find(([path]) => path.includes('v4.city'));
    if (!v4) return;

    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const save = migrate(unpackSave(decode(v4[1] as string)));
    const warnings = collectLoadWarnings(save, content, content.getLoadedSources());

    expect(warnings.waterlessBuildings).toBeGreaterThan(0);
    // Není to zástupná jednička: tolik budov ve městě opravdu vodu potřebuje.
    const needWater = save.entities.buildings.filter(
      (b) => content.get(b.definitionId)?.construction.requiresWater === true,
    ).length;
    expect(warnings.waterlessBuildings).toBe(needWater);
  });

  it('fixtura v5 nese skutečné potrubí a voda po něm teče', async () => {
    const v5 = Object.entries(fixtures).find(([path]) => path.includes('v5.city'));
    expect(v5).toBeDefined();
    if (!v5) return;

    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const save = unpackSave(decode(v5[1] as string));
    expect(save.meta.formatVersion).toBe(5);

    const world = createWorld(1, content.getBalance().economy);
    applySaveToWorld(world, migrate(save));

    // Kdyby fixtura byla bez trubek, neověřila by na potrubí vůbec nic.
    expect([...world.layers.pipe].filter(Boolean).length).toBeGreaterThan(20);

    // Voda se po loadu dopočítá ze zdrojů a potrubí — a musí někam dotéct.
    const systems = createDefaultSystems(content, content.getBalance());
    for (let tick = 0; tick < 20; tick++) tickWorld(world, systems);
    expect(world.watered.size).toBeGreaterThan(0);

    // A město s vodovodem se nemá na co stěžovat.
    const warnings = collectLoadWarnings(migrate(save), content, content.getLoadedSources());
    expect(warnings.waterlessBuildings).toBe(0);
  });

  it('fixtura v4 nese skutečná patra, ne rovinu', () => {
    const v4 = Object.entries(fixtures).find(([path]) => path.includes('v4.city'));
    expect(v4).toBeDefined();
    if (!v4) return;

    const save = unpackSave(decode(v4[1] as string));
    expect(save.meta.formatVersion).toBe(4);

    const world = createWorld(1);
    applySaveToWorld(world, migrate(save));

    // Kdyby fixtura byla z placky, neověřila by na patrech vůbec nic.
    expect(new Set(world.cornerHeight).size).toBeGreaterThan(3);
    expect(Math.max(...world.cornerHeight)).toBeGreaterThan(2);
    expect(countViolations(world.cornerHeight)).toBe(0);
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
      expect(save.meta.grid).toEqual({
        size: MAP_SIZE,
        coarseSize: COARSE_SIZE,
      });
      expect(save.coarse.byteLength).toBe(expectedCoarseByteLength(MAP_SIZE));
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
