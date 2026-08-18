import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, bulldoze, placeDefinition, zoneArea } from '@/sim/commands';
import { index, ZONE } from '@/sim/layers';
import { createGrowthSystem, createPowerSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

const PLANT: Definition = {
  id: 'test:plant',
  type: 'building',
  category: 'utility',
  name: 'building.plant.name',
  description: 'building.plant.desc',
  footprint: [2, 2],
  construction: { cost: 1000, requiresRoad: true, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 100 },
  power: { production: 50 },
  graphics: { color: '#5a5a62', heightLevels: 2 },
};

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
  power: { consumption: 20 },
  graphics: { color: '#8fb4dd', heightLevels: 1 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Odtiká jeden tik, tedy jeden běh powerSystemu (interval 1, offset 0). */
function tickPower(world: WorldState, catalogue: BuildingCatalogue): void {
  tickWorld(world, [createPowerSystem(catalogue)]);
}

/**
 * Silnice na y = 10 od x = 5 do x = 25. Poptávka je nastavená rovnou — tyhle
 * testy zkoumají elektřinu, ne RCI.
 */
function withRoad(seed = 1): WorldState {
  const world = createWorld(seed);
  for (let x = 5; x <= 25; x++) {
    buildRoad(world, x, 10);
  }
  world.demand.residential = 50;
  world.demand.commercial = 50;
  world.demand.industrial = 50;
  return world;
}

describe('flood fill elektřiny', () => {
  it('rozvede proud po silnici od elektrárny', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);

    tickPower(world, catalogue);

    expect(world.layers.power[index(5, 11)]).toBe(1); // vlastní dlaždice
    expect(world.layers.power[index(5, 10)]).toBe(1); // připojená silnice
    expect(world.layers.power[index(25, 10)]).toBe(1); // druhý konec silnice
  });

  it('prázdná dlaždice proud nevede', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);

    tickPower(world, catalogue);

    expect(world.layers.power[index(15, 20)]).toBe(0);
    expect(world.layers.power[index(15, 11)]).toBe(0);
  });

  it('odpojená větev silnice zůstane bez proudu', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    // Ostrůvek silnice, který se sítě nedotýká.
    buildRoad(world, 40, 40);
    buildRoad(world, 41, 40);

    tickPower(world, catalogue);

    expect(world.layers.power[index(40, 40)]).toBe(0);
    expect(world.layers.power[index(41, 40)]).toBe(0);
  });

  it('přerušení silnice odřízne zbytek sítě', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    tickPower(world, catalogue);
    expect(world.layers.power[index(25, 10)]).toBe(1);

    bulldoze(world, 15, 10);
    tickPower(world, catalogue);

    expect(world.layers.power[index(14, 10)]).toBe(1);
    expect(world.layers.power[index(25, 10)]).toBe(0);
  });

  it('bez elektrárny není proud nikde', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withRoad();

    tickPower(world, catalogue);

    expect(world.layers.power[index(5, 10)]).toBe(0);
  });
});

describe('flag sítě', () => {
  it('stavba silnice síť zašpiní a přepočet flag zhasne', () => {
    const catalogue = catalogueOf(PLANT);
    const world = createWorld(1);
    expect(world.powerNetworkDirty).toBe(false);

    buildRoad(world, 5, 5);
    expect(world.powerNetworkDirty).toBe(true);

    tickPower(world, catalogue);
    expect(world.powerNetworkDirty).toBe(false);
  });

  it('zónování síť nemění', () => {
    const world = createWorld(1);
    zoneArea(world, 5, 5, 3, 3, ZONE.residential);
    expect(world.powerNetworkDirty).toBe(false);
  });
});

describe('kapacita', () => {
  it('rozdá výrobu připojeným budovám a na zbytek nezbude', () => {
    // Elektrárna dává 50, dům bere 20 → utáhne dva domy, třetí zůstane bez proudu.
    const catalogue = catalogueOf(PLANT, HOUSE);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    zoneArea(world, 15, 11, 6, 1, ZONE.residential);

    const growth = createGrowthSystem(catalogue);
    const power = createPowerSystem(catalogue);
    for (let tick = 0; tick < 400; tick++) {
      tickWorld(world, [power, growth]);
    }

    const houses = [...world.buildings.values()].filter((b) => b.definitionId === 'test:house');
    expect(houses.length).toBeGreaterThanOrEqual(3);

    const powered = houses.filter((b) => b.powered);
    expect(powered).toHaveLength(2);
    expect(powered.map((b) => b.id)).toEqual(
      [...houses].sort((a, b) => a.id - b.id).slice(0, 2).map((b) => b.id),
    );
  });

  it('elektrárna je pod proudem sama od sebe', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);

    tickPower(world, catalogue);

    const plant = [...world.buildings.values()][0];
    expect(plant?.powered).toBe(true);
  });

  it('odpojená budova o proud přijde', () => {
    const catalogue = catalogueOf(PLANT, HOUSE);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    placeDefinition(world, catalogue, 'test:house', 20, 11);
    tickPower(world, catalogue);

    const house = [...world.buildings.values()].find((b) => b.definitionId === 'test:house');
    expect(house?.powered).toBe(true);

    // Zbourat silnici pod domem i vedle něj -> zůstane ostrov.
    for (let x = 15; x <= 25; x++) bulldoze(world, x, 10);
    tickPower(world, catalogue);

    expect(house?.powered).toBe(false);
  });
});

describe('requiresPower při růstu', () => {
  it('budova, která proud vyžaduje, bez sítě nevyroste', () => {
    const needsPower: Definition = {
      ...HOUSE,
      id: 'test:needy',
      construction: { ...HOUSE.construction, requiresPower: true },
    };
    const catalogue = catalogueOf(needsPower);
    const world = withRoad();
    zoneArea(world, 15, 11, 6, 1, ZONE.residential);

    const growth = createGrowthSystem(catalogue);
    for (let tick = 0; tick < 300; tick++) {
      tickWorld(world, [growth]);
    }

    expect(world.buildings.size).toBe(0);
  });

  it('s proudem na sousední silnici vyroste', () => {
    const needsPower: Definition = {
      ...HOUSE,
      id: 'test:needy',
      construction: { ...HOUSE.construction, requiresPower: true },
      power: { consumption: 0 },
    };
    const catalogue = catalogueOf(PLANT, needsPower);
    const world = withRoad();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    zoneArea(world, 15, 11, 6, 1, ZONE.residential);

    const power = createPowerSystem(catalogue);
    const growth = createGrowthSystem(catalogue);
    for (let tick = 0; tick < 300; tick++) {
      tickWorld(world, [power, growth]);
    }

    expect(world.buildings.size).toBeGreaterThan(1);
  });
});

describe('vanilla elektrárna', () => {
  it('rozvede proud po silnici a rozsvítí domy', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const world = withRoad(9);
    zoneArea(world, 15, 11, 8, 1, ZONE.residential);

    const power = createPowerSystem(content);
    const growth = createGrowthSystem(content);
    for (let tick = 0; tick < 400; tick++) {
      tickWorld(world, [power, growth]);
    }

    const housesBefore = [...world.buildings.values()];
    expect(housesBefore.length).toBeGreaterThan(0);
    expect(housesBefore.every((b) => !b.powered)).toBe(true);

    placeDefinition(world, content, 'vanilla:coal_power_plant', 5, 11);
    tickWorld(world, [power]);

    expect([...world.buildings.values()].filter((b) => b.powered).length).toBe(
      housesBefore.length + 1,
    );
  });
});
