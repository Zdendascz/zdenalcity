import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Balance } from '@/content/balance';
import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, buildWire, placeDefinition, removeWire, zoneArea } from '@/sim/commands';
import { spawnRubble } from '@/sim/disasters/rubble';
import { index, WIRE, ZONE } from '@/sim/layers';
import { createGrowthSystem, createPowerSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { assumeWatered } from './support/water';

const PLANT: Definition = {
  id: 'test:plant',
  type: 'building',
  category: 'utility',
  name: 'building.plant.name',
  description: 'building.plant.desc',
  footprint: [2, 2],
  level: 1,
  construction: { cost: 1000, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
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
  level: 1,
  construction: { cost: 100, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
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
function tickPower(world: WorldState, catalogue: BuildingCatalogue, balance?: Balance): void {
  tickWorld(world, [createPowerSystem(catalogue, balance)]);
}

/**
 * Vedení nízkého napětí na y = 10 od x = 5 do x = 25 (T129). Poptávka je
 * nastavená rovnou — tyhle testy zkoumají elektřinu, ne RCI.
 */
function withWire(seed = 1): WorldState {
  const world = createWorld(seed);
  // Silnice kvůli růstu zón (potřebují přístup); proud vede jen vedení.
  for (let x = 5; x <= 25; x++) {
    buildRoad(world, x, 10);
    buildWire(world, x, 10, WIRE.low);
  }
  world.demand.residential = 50;
  world.demand.commercial = 50;
  world.demand.industrial = 50;
  return world;
}

function at(world: WorldState, x: number, y: number): number {
  return world.layers.power[index(x, y, world.size)] ?? 0;
}

describe('co vede proud (T129)', () => {
  it('vedení rozvede proud od elektrárny', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    tickPower(world, catalogue);

    expect(at(world, 5, 11)).toBe(1); // vlastní dlaždice
    expect(at(world, 5, 10)).toBe(1); // vedení u elektrárny
    expect(at(world, 25, 10)).toBe(1); // druhý konec vedení
  });

  it('silnice ani prázdná dlaždice proud nevede', () => {
    const catalogue = catalogueOf(PLANT);
    const world = createWorld(1);
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    for (let x = 7; x <= 20; x++) buildRoad(world, x, 11);
    tickPower(world, catalogue);

    expect(at(world, 7, 11)).toBe(0);
    expect(at(world, 15, 20)).toBe(0);
  });

  it('souvislý blok zón vede sám a vedení stačí k jeho okraji', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    zoneArea(world, 15, 11, 6, 3, ZONE.residential);
    tickPower(world, catalogue);

    expect(at(world, 15, 11)).toBe(1);
    expect(at(world, 20, 13)).toBe(1); // nejvzdálenější roh bloku
  });

  it('odpojený ostrůvek vedení zůstane bez proudu', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    buildWire(world, 40, 40, WIRE.low);
    tickPower(world, catalogue);

    expect(at(world, 40, 40)).toBe(0);
  });

  it('přerušení vedení odřízne zbytek sítě', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    tickPower(world, catalogue);
    expect(at(world, 25, 10)).toBe(1);

    removeWire(world, 15, 10);
    tickPower(world, catalogue);

    expect(at(world, 14, 10)).toBe(1);
    expect(at(world, 25, 10)).toBe(0);
  });

  it('bez elektrárny není proud nikde', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withWire();
    tickPower(world, catalogue);
    expect(at(world, 5, 10)).toBe(0);
  });

  it('zchátralá budova proud nevede', () => {
    const catalogue = catalogueOf(PLANT, HOUSE);
    const world = createWorld(1);
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    // Elektrárna – dům – dům v řadě, bez zón a bez vedení.
    placeDefinition(world, catalogue, 'test:house', 7, 11);
    placeDefinition(world, catalogue, 'test:house', 8, 11);
    tickPower(world, catalogue);
    const houses = [...world.buildings.values()].filter((b) => b.definitionId === 'test:house');
    const first = houses.find((b) => b.x === 7);
    const second = houses.find((b) => b.x === 8);
    expect(second?.powered).toBe(true);

    first!.abandoned = true;
    world.powerNetworkDirty = true;
    tickPower(world, catalogue);
    expect(second?.powered).toBe(false);
  });

  it('suť proud nevede, ani na zóně', () => {
    const catalogue = catalogueOf(PLANT);
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    zoneArea(world, 15, 11, 1, 3, ZONE.residential);
    spawnRubble(world, index(15, 12, world.size));
    tickPower(world, catalogue);

    expect(at(world, 15, 11)).toBe(1);
    expect(at(world, 15, 12)).toBe(0);
    expect(at(world, 15, 13)).toBe(0); // za sutí už blok nepokračuje
  });
});

describe('flag sítě', () => {
  it('stavba vedení síť zašpiní a přepočet flag zhasne', () => {
    const catalogue = catalogueOf(PLANT);
    const world = createWorld(1);
    expect(world.powerNetworkDirty).toBe(false);

    buildWire(world, 5, 5, WIRE.low);
    expect(world.powerNetworkDirty).toBe(true);
    tickPower(world, catalogue);
    expect(world.powerNetworkDirty).toBe(false);
  });

  it('zónování síť mění — zóna je vodič', () => {
    const world = createWorld(1);
    zoneArea(world, 5, 5, 3, 3, ZONE.residential);
    expect(world.powerNetworkDirty).toBe(true);
    expect(world.waterNetworkDirty).toBe(true);
  });
});

describe('kapacita výroby', () => {
  it('rozdá výrobu připojeným budovám a na zbytek nezbude', () => {
    // Elektrárna dává 50, dům bere 20 → utáhne dva domy, třetí zůstane bez proudu.
    const catalogue = catalogueOf(PLANT, HOUSE);
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    zoneArea(world, 15, 11, 6, 1, ZONE.residential);

    const growth = createGrowthSystem(catalogue, VANILLA_BALANCE);
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
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    tickPower(world, catalogue);
    expect([...world.buildings.values()][0]?.powered).toBe(true);
  });

  it('výroba jedné sítě nenapájí jinou síť', () => {
    const catalogue = catalogueOf(PLANT, HOUSE);
    const world = createWorld(1);
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    placeDefinition(world, catalogue, 'test:house', 40, 40);
    tickPower(world, catalogue);
    const house = [...world.buildings.values()].find((b) => b.definitionId === 'test:house');
    expect(house?.powered).toBe(false);
  });
});

describe('kapacita vedení (T129)', () => {
  const weak: Balance = {
    ...VANILLA_BALANCE,
    power: { wires: [{ cost: 0, capacity: 30 }, { cost: 0, capacity: 1000 }] },
  };

  /** Elektrárna – jeden úsek vedení na (7, 11) – dva domy za ním (40 z výroby 50). */
  function behindOneWire(type: number): { world: WorldState; catalogue: BuildingCatalogue } {
    const catalogue = catalogueOf(PLANT, HOUSE);
    const world = createWorld(1);
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    buildWire(world, 7, 11, type);
    for (const x of [8, 9]) placeDefinition(world, catalogue, 'test:house', x, 11);
    return { world, catalogue };
  }

  it('přetížený úsek vypadne a oblast za ním zhasne', () => {
    // Dva domy po 20 = 40 přes úsek s kapacitou 30.
    const { world, catalogue } = behindOneWire(WIRE.low);
    tickPower(world, catalogue, weak);

    const houses = [...world.buildings.values()].filter((b) => b.definitionId === 'test:house');
    expect(houses.every((b) => !b.powered)).toBe(true);
    expect(world.wireOverloaded[index(7, 11, world.size)]).toBe(1);
    // Elektrárna sama svítí dál.
    expect(at(world, 5, 11)).toBe(1);
  });

  it('vysoké napětí stejnou zátěž unese', () => {
    const { world, catalogue } = behindOneWire(WIRE.high);
    tickPower(world, catalogue, weak);

    const houses = [...world.buildings.values()].filter((b) => b.definitionId === 'test:house');
    expect(houses.every((b) => b.powered)).toBe(true);
    expect(world.wireOverloaded[index(7, 11, world.size)]).toBe(0);
    expect(world.wireLoad[index(7, 11, world.size)]).toBe(40);
  });

  it('když úsek vypadne, proud zkusí jinou cestu', () => {
    // Nízké napětí vypadne; druhá cesta vysokým napětím oblast zachrání.
    const { world, catalogue } = behindOneWire(WIRE.low);
    // Obchvat vysokým napětím: (6, 12) elektrárna → (7, 12) → (8, 12) → dům (8, 11).
    buildWire(world, 7, 12, WIRE.high);
    buildWire(world, 8, 12, WIRE.high);
    tickPower(world, catalogue, weak);
    const houses = [...world.buildings.values()].filter((b) => b.definitionId === 'test:house');
    expect(houses.every((b) => b.powered)).toBe(true);
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
    const world = withWire();
    zoneArea(world, 15, 11, 6, 1, ZONE.residential);

    const growth = createGrowthSystem(catalogue, VANILLA_BALANCE);
    for (let tick = 0; tick < 300; tick++) {
      tickWorld(world, [growth]);
    }

    expect(world.buildings.size).toBe(0);
  });

  it('s proudem v bloku vyroste', () => {
    const needsPower: Definition = {
      ...HOUSE,
      id: 'test:needy',
      construction: { ...HOUSE.construction, requiresPower: true },
      power: { consumption: 0 },
    };
    const catalogue = catalogueOf(PLANT, needsPower);
    const world = withWire();
    placeDefinition(world, catalogue, 'test:plant', 5, 11);
    zoneArea(world, 15, 11, 6, 1, ZONE.residential);

    const power = createPowerSystem(catalogue);
    const growth = createGrowthSystem(catalogue, VANILLA_BALANCE);
    for (let tick = 0; tick < 300; tick++) {
      tickWorld(world, [power, growth]);
    }

    expect(world.buildings.size).toBeGreaterThan(1);
  });
});

describe('vanilla elektrárna', () => {
  it('rozvede proud vedením a rozsvítí domy', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const world = withWire(9);
    zoneArea(world, 15, 11, 8, 1, ZONE.residential);
    // Tenhle test je o elektřině; vodovod si odpustíme (§8 fáze 3).
    assumeWatered(world);

    const power = createPowerSystem(content, content.getBalance());
    const growth = createGrowthSystem(content, VANILLA_BALANCE);
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
