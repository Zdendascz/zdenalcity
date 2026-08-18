import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { buildRoad, bulldoze, zoneArea } from '@/sim/commands';
import { hashLayers, index, TERRAIN, ZONE } from '@/sim/layers';
import type { ZoneType } from '@/sim/layers';
import { createGrowthSystem } from '@/sim/systems';
import type { BuildingCatalogue } from '@/sim/systems';
import { createWorld, tickWorld, totalJobs, totalPopulation } from '@/sim/world';
import type { WorldState } from '@/sim/world';

const HOUSE: Definition = {
  id: 'test:house',
  type: 'building',
  category: 'residential',
  name: 'building.house.name',
  description: 'building.house.desc',
  footprint: [1, 1],
  construction: { cost: 100, requiresRoad: true, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 10 },
  population: { capacity: 8 },
  graphics: { color: '#8fb4dd', heightLevels: 1 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Odtiká tolik tiků, aby růstový systém (interval 12) proběhl `runs`krát. */
function run(world: WorldState, catalogue: BuildingCatalogue, runs: number): void {
  const growth = createGrowthSystem(catalogue);
  for (let tick = 0; tick < runs * growth.interval + growth.offset; tick++) {
    tickWorld(world, [growth]);
  }
}

/**
 * Poptávku počítá `demandSystem` (T7). Tyhle testy zkoumají růst, ne poptávku,
 * takže ji nastavíme rovnou na kladnou.
 */
function saturateDemand(world: WorldState): WorldState {
  world.demand.residential = 50;
  world.demand.commercial = 50;
  world.demand.industrial = 50;
  return world;
}

/** Silnice na y = 10, zóna hned pod ní. */
function cityWithZone(seed = 1, zone: ZoneType = ZONE.residential): WorldState {
  const world = createWorld(seed);
  for (let x = 5; x <= 15; x++) {
    buildRoad(world, x, 10);
  }
  zoneArea(world, 5, 11, 11, 1, zone);
  return saturateDemand(world);
}

describe('růst budov', () => {
  it('na zóně u silnice vyroste budova a přijdou obyvatelé', () => {
    const world = cityWithZone();

    run(world, catalogueOf(HOUSE), 20);

    expect(world.buildings.size).toBeGreaterThan(0);
    expect(totalPopulation(world.buildings)).toBe(world.buildings.size * 8);

    const first = [...world.buildings.values()][0];
    expect(first?.definitionId).toBe('test:house');
    expect(first?.level).toBe(1);
    expect(first?.powered).toBe(false); // elektřina je až T6
  });

  it('zapíše se do vrstvy buildingId', () => {
    const world = cityWithZone();
    run(world, catalogueOf(HOUSE), 20);

    const building = [...world.buildings.values()][0];
    expect(building).toBeDefined();
    if (!building) return;
    expect(world.layers.buildingId[index(building.x, building.y)]).toBe(building.id);
  });

  it('bez silnice nevyroste nic, když ji definice vyžaduje', () => {
    const world = saturateDemand(createWorld(1));
    zoneArea(world, 5, 11, 11, 1, ZONE.residential);

    run(world, catalogueOf(HOUSE), 30);

    expect(world.buildings.size).toBe(0);
  });

  it('na holé zóně bez obsahu dané kategorie nevyroste nic', () => {
    const world = cityWithZone();
    run(world, catalogueOf(), 20);
    expect(world.buildings.size).toBe(0);
  });

  it('do průmyslové zóny nepostaví dům', () => {
    const world = cityWithZone(1, ZONE.industrial);
    run(world, catalogueOf(HOUSE), 20);
    expect(world.buildings.size).toBe(0);
  });

  it('nestaví na terén, který definice nedovoluje', () => {
    const world = cityWithZone();
    for (let x = 5; x <= 15; x++) {
      world.layers.terrain[index(x, 11)] = TERRAIN.rock;
    }

    run(world, catalogueOf(HOUSE), 20);

    expect(world.buildings.size).toBe(0);
  });

  it('vícedlaždicová budova zabere celý footprint', () => {
    const factory: Definition = {
      ...HOUSE,
      id: 'test:factory',
      category: 'industrial',
      footprint: [2, 2],
      population: undefined,
      jobs: { capacity: 12 },
    };
    const world = saturateDemand(createWorld(3));
    for (let x = 5; x <= 15; x++) buildRoad(world, x, 10);
    zoneArea(world, 5, 11, 10, 2, ZONE.industrial);

    run(world, catalogueOf(factory), 20);

    const building = [...world.buildings.values()][0];
    expect(building).toBeDefined();
    if (!building) return;

    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      expect(world.layers.buildingId[index(building.x + (dx ?? 0), building.y + (dy ?? 0))]).toBe(
        building.id,
      );
    }
    expect(totalJobs(world.buildings)).toBe(12 * world.buildings.size);
  });

  it('je deterministický — stejný seed dá stejné město', () => {
    const a = cityWithZone(42);
    const b = cityWithZone(42);

    run(a, catalogueOf(HOUSE), 25);
    run(b, catalogueOf(HOUSE), 25);

    expect(hashLayers(a.layers)).toBe(hashLayers(b.layers));
    expect(a.rng.getState()).toBe(b.rng.getState());
    expect([...a.buildings.values()]).toEqual([...b.buildings.values()]);
  });

  it('jiný seed dá jiné rozmístění (kontrolní případ)', () => {
    const a = cityWithZone(42);
    const b = cityWithZone(43);

    run(a, catalogueOf(HOUSE), 25);
    run(b, catalogueOf(HOUSE), 25);

    expect(hashLayers(a.layers)).not.toBe(hashLayers(b.layers));
  });
});

describe('zónování', () => {
  it('vyznačí obdélník', () => {
    const world = createWorld(1);
    zoneArea(world, 3, 4, 2, 3, ZONE.commercial);

    expect(world.layers.zone[index(3, 4)]).toBe(ZONE.commercial);
    expect(world.layers.zone[index(4, 6)]).toBe(ZONE.commercial);
    expect(world.layers.zone[index(5, 4)]).toBe(ZONE.none);
  });

  it('přeskočí vodu, silnici i obsazenou dlaždici', () => {
    const world = createWorld(1);
    world.layers.terrain[index(3, 4)] = TERRAIN.water;
    buildRoad(world, 4, 4);
    world.layers.buildingId[index(5, 4)] = 7;

    zoneArea(world, 3, 4, 3, 1, ZONE.residential);

    expect(world.layers.zone[index(3, 4)]).toBe(ZONE.none);
    expect(world.layers.zone[index(4, 4)]).toBe(ZONE.none);
    expect(world.layers.zone[index(5, 4)]).toBe(ZONE.none);
  });

  it('ZONE.none zónu ruší', () => {
    const world = createWorld(1);
    zoneArea(world, 3, 4, 2, 2, ZONE.residential);
    zoneArea(world, 3, 4, 2, 2, ZONE.none);
    expect(world.layers.zone[index(3, 4)]).toBe(ZONE.none);
  });

  it('ořízne se o okraj mapy místo pádu', () => {
    const world = createWorld(1);
    expect(() => zoneArea(world, 126, 126, 8, 8, ZONE.residential)).not.toThrow();
    expect(world.layers.zone[index(127, 127)]).toBe(ZONE.residential);
  });
});

describe('bourání', () => {
  it('odstraní budovu, ale zónu nechá — může vyrůst znovu', () => {
    const world = cityWithZone();
    run(world, catalogueOf(HOUSE), 20);

    const building = [...world.buildings.values()][0];
    expect(building).toBeDefined();
    if (!building) return;
    const populationBefore = totalPopulation(world.buildings);

    bulldoze(world, building.x, building.y);

    expect(world.buildings.has(building.id)).toBe(false);
    expect(world.layers.buildingId[index(building.x, building.y)]).toBe(0);
    expect(world.layers.zone[index(building.x, building.y)]).toBe(ZONE.residential);
    // Obyvatelé zmizeli s domem, ne s celým městem.
    expect(totalPopulation(world.buildings)).toBe(populationBefore - building.population);
  });

  it('na dlaždici bez budovy zboří silnici, jinak zónu', () => {
    const world = createWorld(1);
    buildRoad(world, 5, 5);
    zoneArea(world, 6, 5, 1, 1, ZONE.residential);

    bulldoze(world, 5, 5);
    expect(world.layers.road[index(5, 5)]).toBe(0);

    bulldoze(world, 6, 5);
    expect(world.layers.zone[index(6, 5)]).toBe(ZONE.none);
  });
});

describe('vanilla obsah v simulaci', () => {
  it('z reálných definic vyroste obytná čtvrť', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const world = cityWithZone(7);
    run(world, content, 25);

    expect(world.buildings.size).toBeGreaterThan(0);
    for (const building of world.buildings.values()) {
      expect(building.definitionId).toBe('vanilla:residential_small');
    }
    expect(totalPopulation(world.buildings)).toBe(world.buildings.size * 8);
  });
});
