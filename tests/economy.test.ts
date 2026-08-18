import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, placeDefinition, setTaxRate, zoneArea } from '@/sim/commands';
import { ZONE } from '@/sim/layers';
import { createDemandSystem, createEconomySystem, createGrowthSystem } from '@/sim/systems';
import { createWorld, MAX_TAX_RATE, STARTING_FUNDS, tickWorld } from '@/sim/world';
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

const FACTORY: Definition = {
  ...HOUSE,
  id: 'test:factory',
  category: 'industrial',
  economy: { upkeep: 25 },
  population: undefined,
  jobs: { capacity: 12 },
};

const SHOP: Definition = {
  ...HOUSE,
  id: 'test:shop',
  category: 'commercial',
  economy: { upkeep: 15 },
  population: undefined,
  jobs: { capacity: 6 },
};

const MONUMENT: Definition = {
  ...HOUSE,
  id: 'test:monument',
  category: 'utility',
  economy: { upkeep: 200 },
  population: undefined,
  graphics: { color: '#5a5a62', heightLevels: 2 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Odtiká přesně jeden měsíc, tedy jeden běh economySystemu (interval 30). */
function tickMonth(world: WorldState, catalogue: BuildingCatalogue): void {
  const economy = createEconomySystem(catalogue);
  for (let i = 0; i < economy.interval; i++) {
    tickWorld(world, [economy]);
  }
}

function tickDemand(world: WorldState, catalogue: BuildingCatalogue): void {
  const demand = createDemandSystem(catalogue);
  for (let i = 0; i <= demand.offset + demand.interval; i++) {
    tickWorld(world, [demand]);
  }
}

describe('RCI poptávka', () => {
  it('na prázdné mapě chtějí lidé bydlet, ale po práci a obchodech není poptávka', () => {
    const world = createWorld(1);
    tickDemand(world, catalogueOf());

    expect(world.demand.residential).toBeGreaterThan(0);
    expect(world.demand.industrial).toBe(0);
    expect(world.demand.commercial).toBe(0);
  });

  it('obyvatelé bez práce vytvoří průmyslovou poptávku (§13 krok 4)', () => {
    const world = createWorld(1);
    for (let i = 0; i < 6; i++) {
      placeBuilding(world, HOUSE, 5 + i, 5);
    }

    tickDemand(world, catalogueOf(HOUSE));

    // 48 obyvatel → 24 pracujících, nula míst.
    expect(world.demand.industrial).toBe(24);
    expect(world.demand.residential).toBeLessThan(0); // dokud není práce, nikdo další nepřijde
  });

  it('práce obytnou poptávku vrátí do plusu', () => {
    const world = createWorld(1);
    for (let i = 0; i < 6; i++) placeBuilding(world, HOUSE, 5 + i, 5);
    for (let i = 0; i < 3; i++) placeBuilding(world, FACTORY, 5 + i, 8);

    tickDemand(world, catalogueOf(HOUSE, FACTORY));

    // 36 míst proti 24 pracujícím.
    expect(world.demand.residential).toBeGreaterThan(0);
    expect(world.demand.industrial).toBeLessThan(0);
  });

  it('obchody sytí poptávku po obchodech', () => {
    const world = createWorld(1);
    for (let i = 0; i < 6; i++) placeBuilding(world, HOUSE, 5 + i, 5);

    tickDemand(world, catalogueOf(HOUSE, SHOP));
    const bezObchodu = world.demand.commercial;
    expect(bezObchodu).toBeGreaterThan(0);

    placeBuilding(world, SHOP, 5, 8);
    tickDemand(world, catalogueOf(HOUSE, SHOP));

    expect(world.demand.commercial).toBeLessThan(bezObchodu);
  });
});

describe('poptávka řídí růst', () => {
  it('průmyslová zóna zůstane prázdná, dokud nejsou lidé bez práce (§13 krok 5)', () => {
    const catalogue = catalogueOf(FACTORY);
    const world = createWorld(1);
    for (let x = 5; x <= 15; x++) buildRoad(world, x, 10);
    zoneArea(world, 5, 11, 10, 1, ZONE.industrial);

    const growth = createGrowthSystem(catalogue);
    const demand = createDemandSystem(catalogue);
    for (let tick = 0; tick < 200; tick++) {
      tickWorld(world, [demand, growth]);
    }

    expect(world.buildings.size).toBe(0);

    // Přistěhuj lidi ručně a průmysl se rozjede.
    for (let i = 0; i < 6; i++) placeBuilding(world, HOUSE, 5 + i, 8);
    for (let tick = 0; tick < 200; tick++) {
      tickWorld(world, [demand, growth]);
    }

    expect(world.buildings.size).toBeGreaterThan(6);
  });
});

describe('měsíční rozpočet', () => {
  it('vybere daň z populace a zaplatí údržbu', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    placeBuilding(world, HOUSE, 5, 5);

    tickMonth(world, catalogue);

    // 8 obyvatel × 40 × 7 % = 22,4 → 22. Údržba 10.
    expect(world.economy.lastIncome).toBe(22);
    expect(world.economy.lastExpenses).toBe(10);
    expect(world.economy.funds).toBe(STARTING_FUNDS + 12);
  });

  it('nedaní infrastrukturu, ale její údržbu platí', () => {
    const catalogue = catalogueOf(MONUMENT);
    const world = createWorld(1);
    placeBuilding(world, MONUMENT, 5, 5);

    tickMonth(world, catalogue);

    expect(world.economy.lastIncome).toBe(0);
    expect(world.economy.lastExpenses).toBe(200);
    expect(world.economy.funds).toBe(STARTING_FUNDS - 200);
  });

  it('u neobytné budovy daní pracovní místa', () => {
    const catalogue = catalogueOf(FACTORY);
    const world = createWorld(1);
    placeBuilding(world, FACTORY, 5, 5);

    tickMonth(world, catalogue);

    // 12 míst × 40 × 7 % = 33,6 → 34.
    expect(world.economy.lastIncome).toBe(34);
  });

  it('vyšší sazba znamená vyšší příjem', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    placeBuilding(world, HOUSE, 5, 5);
    setTaxRate(world, ZONE.residential, 14);

    tickMonth(world, catalogue);

    expect(world.economy.lastIncome).toBe(45); // 8 × 40 × 14 %
  });

  it('proběhne jen raz za 30 tiků', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    placeBuilding(world, HOUSE, 5, 5);
    const economy = createEconomySystem(catalogue);

    for (let i = 0; i < 29; i++) tickWorld(world, [economy]);
    expect(world.economy.funds).toBe(STARTING_FUNDS);

    tickWorld(world, [economy]);
    expect(world.economy.funds).toBe(STARTING_FUNDS + 12);
  });
});

describe('daňová sazba', () => {
  it('přiřízne se na povolený rozsah', () => {
    const world = createWorld(1);

    setTaxRate(world, ZONE.residential, 999);
    expect(world.economy.taxRates.residential).toBe(MAX_TAX_RATE);

    setTaxRate(world, ZONE.residential, -5);
    expect(world.economy.taxRates.residential).toBe(0);
  });

  it('mění jen svou kategorii', () => {
    const world = createWorld(1);
    const commercialBefore = world.economy.taxRates.commercial;

    setTaxRate(world, ZONE.industrial, 12);

    expect(world.economy.taxRates.industrial).toBe(12);
    expect(world.economy.taxRates.commercial).toBe(commercialBefore);
  });

  it('na dlaždici bez zóny nedělá nic', () => {
    const world = createWorld(1);
    const before = { ...world.economy.taxRates };
    setTaxRate(world, ZONE.none, 20);
    expect(world.economy.taxRates).toEqual(before);
  });
});

describe('bankrot', () => {
  it('v minusu město neroste', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    for (let x = 5; x <= 15; x++) buildRoad(world, x, 10);
    zoneArea(world, 5, 11, 10, 1, ZONE.residential);
    world.demand.residential = 50;
    world.economy.funds = -1;

    const growth = createGrowthSystem(catalogue);
    for (let tick = 0; tick < 200; tick++) tickWorld(world, [growth]);

    expect(world.buildings.size).toBe(0);

    world.economy.funds = 0;
    for (let tick = 0; tick < 200; tick++) tickWorld(world, [growth]);

    expect(world.buildings.size).toBeGreaterThan(0);
  });

  it('údržba srazí rozpočet i do minusu', () => {
    const catalogue = catalogueOf(MONUMENT);
    const world = createWorld(1);
    world.economy.funds = 100;
    placeBuilding(world, MONUMENT, 5, 5);

    tickMonth(world, catalogue);

    expect(world.economy.funds).toBe(-100);
  });
});

describe('stavba za peníze', () => {
  it('odečte cenu z rozpočtu', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const world = createWorld(1);
    for (let x = 5; x <= 15; x++) buildRoad(world, x, 10);

    placeDefinition(world, content, 'vanilla:coal_power_plant', 5, 11);

    expect(world.buildings.size).toBe(1);
    expect(world.economy.funds).toBe(STARTING_FUNDS - 4000);
  });

  it('bez peněz se nepostaví nic', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const world = createWorld(1);
    for (let x = 5; x <= 15; x++) buildRoad(world, x, 10);
    world.economy.funds = 3999;

    placeDefinition(world, content, 'vanilla:coal_power_plant', 5, 11);

    expect(world.buildings.size).toBe(0);
    expect(world.economy.funds).toBe(3999);
  });
});
