import { beforeAll, describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { applySaveToWorld, unpackSave } from '@/save/deserialize';
import type { SaveData } from '@/save/format';
import { migrate } from '@/save/migrations';
import { serializeSave, toSaveData } from '@/save/serialize';
import type { SaveOptions } from '@/save/serialize';
import { checkFootprint, placeBuilding } from '@/sim/buildings';
import { buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { hashLayers, index, MAX_BUILDING_ID, ZONE } from '@/sim/layers';
import { createGrowthSystem } from '@/sim/systems/growth';
import { createWorld, removeBuilding } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { assumeWatered } from './support/water';

/**
 * Id budov a jejich strop.
 *
 * Id se po zbourání nevrací, takže `nextBuildingId` počítá všechny budovy, které
 * ve městě **kdy** vznikly. Do verze savu 11 byla vrstva `buildingId`
 * dvoubajtová: id 65 536 se do ní zapsalo jako nula, budova stála neviditelně
 * na „prázdné" dlaždici a save se už nenačetl. Simulovaný hráč za sto let
 * spotřeboval tři až dvanáctkrát víc id, než kolik budov ve městě stálo
 * (`tools/id-probe.ts`).
 */

const OPTIONS: SaveOptions = {
  cityName: 'Stropov',
  createdAt: '2026-09-11T10:00:00.000Z',
  modifiedAt: '2026-09-11T10:00:00.000Z',
  playtimeSeconds: 60,
  sources: [{ id: 'vanilla', version: '0.1.0' }],
};

/** Dvě dlaždice volné pro kontrolu půdorysu bez silnice a srovnání. */
const LOOSE = { skipRoadCheck: true, skipFlatCheck: true };

let content: ContentRegistry;
let house: Definition;

beforeAll(async () => {
  content = new ContentRegistry();
  await content.load(createVanillaSource());
  const definition = content.get('vanilla:residential_small');
  if (!definition) throw new Error('vanilla:residential_small chybí');
  // Testy počítají s jednou dlaždicí na dům; kdyby obsah dům zvětšil, ať to
  // spadne tady a srozumitelně.
  expect(definition.footprint).toEqual([1, 1]);
  house = definition;
});

/** Načte save stejnou cestou jako hra při startu. */
function load(bytes: Uint8Array): WorldState {
  const world = createWorld(1);
  applySaveToWorld(world, migrate(unpackSave(bytes)));
  return world;
}

describe('id nad 65 535', () => {
  it('se na mapě neztratí a dlaždice nezůstane „prázdná"', () => {
    const world = createWorld(1);
    world.nextBuildingId = 0xffff; // poslední id, které se vešlo do Uint16

    const placed = [10, 11, 12].map((x) => placeBuilding(world, house, x, 10));

    expect(placed.map((building) => building.id)).toEqual([65_535, 65_536, 65_537]);
    for (const building of placed) {
      expect(world.layers.buildingId[index(building.x, building.y, world.size)]).toBe(building.id);
    }
    // Se starou vrstvou by tu byla nula a na dům by šlo postavit další.
    expect(checkFootprint(world, house, 11, 10, LOOSE)).toMatchObject({
      ok: false,
      reason: 'error.occupiedFootprint',
    });

    // Bourání najde dlaždice podle id — s přetečením by nenašlo nic a budova
    // by po sobě nechala na mapě cizí číslo.
    expect(removeBuilding(world, 65_536)).toBe(true);
    expect(world.layers.buildingId[index(11, 10, world.size)]).toBe(0);
    expect(world.layers.buildingId[index(10, 10, world.size)]).toBe(65_535);
    expect(world.layers.buildingId[index(12, 10, world.size)]).toBe(65_537);
  });

  it('přežijí uložení a načtení a číslování pokračuje, kde skončilo', () => {
    const world = createWorld(7);
    world.nextBuildingId = 70_000;
    placeBuilding(world, house, 20, 20);
    placeBuilding(world, house, 21, 20);

    const restored = load(serializeSave(world, OPTIONS));

    expect(restored.nextBuildingId).toBe(70_002);
    expect([...restored.buildings.values()]).toEqual([...world.buildings.values()]);
    expect(restored.layers.buildingId[index(20, 20, restored.size)]).toBe(70_000);
    expect(restored.layers.buildingId[index(21, 20, restored.size)]).toBe(70_001);
    expect(hashLayers(restored.layers)).toBe(hashLayers(world.layers));
    expect(placeBuilding(restored, house, 22, 20).id).toBe(70_002);
  });
});

describe('strop na id', () => {
  it('poslední id se ještě přidělí, další stavba dostane důvod', () => {
    const world = createWorld(1);
    world.nextBuildingId = MAX_BUILDING_ID;

    const last = placeBuilding(world, house, 5, 5);

    expect(last.id).toBe(MAX_BUILDING_ID);
    expect(world.layers.buildingId[index(5, 5, world.size)]).toBe(MAX_BUILDING_ID);
    expect(world.nextBuildingId).toBe(MAX_BUILDING_ID + 1);
    expect(checkFootprint(world, house, 6, 5, LOOSE)).toEqual({
      ok: false,
      reason: 'error.buildingIdsExhausted',
    });
  });

  it('hráč se dozví proč a nic nezaplatí', () => {
    const world = createWorld(1, content.getBalance().economy);
    world.nextBuildingId = MAX_BUILDING_ID + 1;
    const funds = world.economy.funds;

    const result = placeDefinition(
      world,
      content,
      'vanilla:residential_small',
      5,
      5,
      content.getBalance(),
    );

    expect(result).toEqual({ ok: false, reason: 'error.buildingIdsExhausted' });
    expect(world.economy.funds).toBe(funds);
    expect(world.buildings.size).toBe(0);
  });

  it('růst na stropu nepostaví nic a nespadne', () => {
    const grown = (nextBuildingId: number): number => {
      const world = createWorld(1, content.getBalance().economy);
      for (let x = 10; x <= 30; x++) buildRoad(world, x, 10);
      zoneArea(world, 10, 11, 21, 2, ZONE.residential);
      assumeWatered(world);
      world.demand.residential = 100;
      world.nextBuildingId = nextBuildingId;

      const growth = createGrowthSystem(content, content.getBalance());
      for (let run = 0; run < 3; run++) growth.run(world);
      return world.buildings.size;
    };

    // Kontrola, že tahle čtvrť vůbec roste — jinak by nula níž nic nedokazovala.
    expect(grown(1)).toBeGreaterThan(0);
    expect(grown(MAX_BUILDING_ID + 1)).toBe(0);
  });

  it('placeBuilding bez kontroly radši spadne, než by zapsal nulu', () => {
    const world = createWorld(1);
    world.nextBuildingId = MAX_BUILDING_ID + 1;

    expect(() => placeBuilding(world, house, 5, 5)).toThrow(/nevejde/);
    expect(world.buildings.size).toBe(0);
    expect(world.layers.buildingId[index(5, 5, world.size)]).toBe(0);
  });

  it('save města, kterému čísla došla, se načte a stavět pořád nejde', () => {
    const world = createWorld(3);
    world.nextBuildingId = MAX_BUILDING_ID;
    placeBuilding(world, house, 8, 8);

    const restored = load(serializeSave(world, OPTIONS));

    expect(restored.nextBuildingId).toBe(MAX_BUILDING_ID + 1);
    expect(restored.layers.buildingId[index(8, 8, restored.size)]).toBe(MAX_BUILDING_ID);
    expect(restored.buildings.get(MAX_BUILDING_ID)?.definitionId).toBe(house.id);
    expect(checkFootprint(restored, house, 9, 8, LOOSE)).toEqual({
      ok: false,
      reason: 'error.buildingIdsExhausted',
    });
  });
});

describe('loader hlídá id', () => {
  function saveWithOneHouse(): SaveData {
    const world = createWorld(1);
    world.nextBuildingId = 500;
    placeBuilding(world, house, 4, 4);
    return toSaveData(world, OPTIONS);
  }

  function withEntities(save: SaveData, entities: SaveData['entities']): SaveData {
    return { ...save, entities };
  }

  it('id nad stropem se nenačte', () => {
    const save = saveWithOneHouse();
    const [building] = save.entities.buildings;
    if (!building) throw new Error('save bez budovy');
    const broken = withEntities(save, {
      nextBuildingId: MAX_BUILDING_ID + 1,
      buildings: [{ ...building, id: MAX_BUILDING_ID + 1 }],
    });

    expect(() => applySaveToWorld(createWorld(1), broken)).toThrow(
      /entities\.buildings\[id=4294967296\]\.id/,
    );
  });

  it('nextBuildingId víc než o jedna nad stropem se nenačte', () => {
    const save = saveWithOneHouse();
    const broken = withEntities(save, {
      ...save.entities,
      nextBuildingId: MAX_BUILDING_ID + 2,
    });

    expect(() => applySaveToWorld(createWorld(1), broken)).toThrow(/entities\.nextBuildingId/);
  });

  it('nextBuildingId na stojícím id se nenačte — další stavba by budovu přepsala', () => {
    const save = saveWithOneHouse();
    expect(save.entities.buildings.map((building) => building.id)).toEqual([500]);
    const broken = withEntities(save, { ...save.entities, nextBuildingId: 500 });

    expect(() => applySaveToWorld(createWorld(1), broken)).toThrow(/entities\.nextBuildingId/);
  });
});
