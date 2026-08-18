import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, placeDefinition, setTaxRate, zoneArea } from '@/sim/commands';
import { ZONE } from '@/sim/layers';
import { createDemandSystem, createEconomySystem, createGrowthSystem } from '@/sim/systems';
import { computeBudget, taxFrom } from '@/sim/systems/economy';
import {
  createWorld,
  DEFAULT_TAX_RATE,
  MAX_TAX_RATE,
  STARTING_FUNDS,
  tickWorld,
} from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import type { Balance } from '@/content/balance';

/**
 * Balanc pro testy vzorců. Vychází z vanilly, ale daňovou jednotku drží na
 * kulaté čtyřicítce — zdejší testy zkoumají vzorec a zapojení, ne vyladěná
 * čísla, takže je přeladění ekonomiky nemá co rozbít.
 *
 * Že vanilla čísla dávají smysl, hlídá zvlášť test „vanilla balanc".
 */
const BALANCE: Balance = {
  ...VANILLA_BALANCE,
  economy: { ...VANILLA_BALANCE.economy, taxableValuePerUnit: 40 },
};

const HOUSE: Definition = {
  id: 'test:house',
  type: 'building',
  category: 'residential',
  name: 'building.house.name',
  description: 'building.house.desc',
  footprint: [1, 1],
  level: 1,
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

/**
 * Postaví budovu a rovnou ji připojí k proudu.
 *
 * Bez proudu budova nedaní ani nedává práci, což je záměr — ale většina testů
 * tady zkoumá ekonomiku, ne elektřinu, takže si ji připojí rovnou.
 */
function place(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
  powered = true,
): void {
  placeBuilding(world, definition, x, y).powered = powered;
}

/** Odtiká přesně jeden měsíc, tedy jeden běh economySystemu (interval 30). */
function tickMonth(world: WorldState, catalogue: BuildingCatalogue): void {
  const economy = createEconomySystem(catalogue, BALANCE);
  for (let i = 0; i < economy.interval; i++) {
    tickWorld(world, [economy]);
  }
}

function tickDemand(world: WorldState, catalogue: BuildingCatalogue): void {
  const demand = createDemandSystem(catalogue, BALANCE);
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
      place(world, HOUSE, 5 + i, 5);
    }

    tickDemand(world, catalogueOf(HOUSE));

    // 48 obyvatel → 24 pracujících, nula míst.
    expect(world.demand.industrial).toBe(24);
    expect(world.demand.residential).toBeLessThan(0); // dokud není práce, nikdo další nepřijde
  });

  it('práce obytnou poptávku vrátí do plusu', () => {
    const world = createWorld(1);
    for (let i = 0; i < 6; i++) place(world, HOUSE, 5 + i, 5);
    for (let i = 0; i < 3; i++) place(world, FACTORY, 5 + i, 8);

    tickDemand(world, catalogueOf(HOUSE, FACTORY));

    // 36 míst proti 24 pracujícím.
    expect(world.demand.residential).toBeGreaterThan(0);
    expect(world.demand.industrial).toBeLessThan(0);
  });

  it('obchody sytí poptávku po obchodech', () => {
    const world = createWorld(1);
    for (let i = 0; i < 6; i++) place(world, HOUSE, 5 + i, 5);

    tickDemand(world, catalogueOf(HOUSE, SHOP));
    const bezObchodu = world.demand.commercial;
    expect(bezObchodu).toBeGreaterThan(0);

    place(world, SHOP, 5, 8);
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
    const demand = createDemandSystem(catalogue, BALANCE);
    for (let tick = 0; tick < 200; tick++) {
      tickWorld(world, [demand, growth]);
    }

    expect(world.buildings.size).toBe(0);

    // Přistěhuj lidi ručně a průmysl se rozjede.
    for (let i = 0; i < 6; i++) place(world, HOUSE, 5 + i, 8);
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
    place(world, HOUSE, 5, 5);

    tickMonth(world, catalogue);

    // 8 obyvatel × 40 × 7 % = 22,4 → 22. Údržba 10.
    expect(world.economy.lastIncome).toBe(22);
    expect(world.economy.lastExpenses).toBe(10);
    expect(world.economy.funds).toBe(STARTING_FUNDS + 12);
  });

  it('nedaní infrastrukturu, ale její údržbu platí', () => {
    const catalogue = catalogueOf(MONUMENT);
    const world = createWorld(1);
    place(world, MONUMENT, 5, 5);

    tickMonth(world, catalogue);

    expect(world.economy.lastIncome).toBe(0);
    expect(world.economy.lastExpenses).toBe(200);
    expect(world.economy.funds).toBe(STARTING_FUNDS - 200);
  });

  it('u neobytné budovy daní pracovní místa', () => {
    const catalogue = catalogueOf(FACTORY);
    const world = createWorld(1);
    place(world, FACTORY, 5, 5);

    tickMonth(world, catalogue);

    // 12 míst × 40 × 7 % = 33,6 → 34.
    expect(world.economy.lastIncome).toBe(34);
  });

  it('vyšší sazba znamená vyšší příjem', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    place(world, HOUSE, 5, 5);
    setTaxRate(world, ZONE.residential, 14);

    tickMonth(world, catalogue);

    expect(world.economy.lastIncome).toBe(45); // 8 × 40 × 14 %
  });

  it('proběhne jen raz za 30 tiků', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    place(world, HOUSE, 5, 5);
    const economy = createEconomySystem(catalogue, BALANCE);

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
    place(world, MONUMENT, 5, 5);

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

describe('rozpad rozpočtu', () => {
  it('nese vstupy, ze kterých se příjem a údržba spočítaly', () => {
    const catalogue = catalogueOf(HOUSE, FACTORY);
    const world = createWorld(1);
    for (let i = 0; i < 3; i++) place(world, HOUSE, 5 + i, 5);
    place(world, HOUSE, 9, 5, false); // temný dům
    place(world, FACTORY, 5, 8);

    const budget = computeBudget(world, catalogue, BALANCE);
    const domy = budget.lines.find((line) => line.definitionId === 'test:house');
    const tovarna = budget.lines.find((line) => line.definitionId === 'test:factory');

    // Tři svítící domy po osmi obyvatelích; temný se do základu nepočítá.
    expect(domy).toMatchObject({
      count: 4,
      poweredCount: 3,
      taxBase: 24,
      taxUnitKey: 'ui.budget.unit.population',
      taxRate: 7,
      upkeepEach: 10,
      upkeepCount: 3,
    });
    // 24 × 40 × 7 % = 67,2 → 67. Údržba 3 × 10.
    expect(domy?.income).toBe(67);
    expect(domy?.upkeep).toBe(30);

    expect(tovarna).toMatchObject({ taxBase: 12, taxUnitKey: 'ui.budget.unit.jobs' });
  });

  it('u infrastruktury nevykazuje daň, jen údržbu', () => {
    const catalogue = catalogueOf(MONUMENT);
    const world = createWorld(1);
    place(world, MONUMENT, 5, 5);

    const line = computeBudget(world, catalogue, BALANCE).lines[0];

    expect(line?.taxRate).toBeNull();
    expect(line?.taxUnitKey).toBeNull();
    expect(line?.upkeepCount).toBe(1);
    expect(line?.upkeep).toBe(200);
  });

  it('financování škáluje údržbu služby i částku za kus', () => {
    const STATION: Definition = {
      ...MONUMENT,
      id: 'test:station',
      category: 'service',
      economy: { upkeep: 120 },
      service: { class: 'health', radius: 5, strength: 50 },
    };
    const catalogue = catalogueOf(STATION);
    const world = createWorld(1);
    place(world, STATION, 5, 5);

    expect(computeBudget(world, catalogue, BALANCE).lines[0]).toMatchObject({
      upkeep: 120,
      upkeepEach: 120,
    });

    world.serviceFunding.set('health', 0.5);

    // Rozpis musí sedět: 1 × 60 = 60, ne 1 × 120 = 60.
    expect(computeBudget(world, catalogue, BALANCE).lines[0]).toMatchObject({
      upkeep: 60,
      upkeepEach: 60,
      upkeepCount: 1,
      count: 1,
    });
  });

  it('součet řádků sedí s celkem', () => {
    const catalogue = catalogueOf(HOUSE, FACTORY, MONUMENT);
    const world = createWorld(1);
    for (let i = 0; i < 5; i++) place(world, HOUSE, 5 + i, 5);
    place(world, FACTORY, 5, 8);
    place(world, MONUMENT, 9, 8);

    const budget = computeBudget(world, catalogue, BALANCE);

    expect(budget.lines.reduce((sum, line) => sum + line.income, 0)).toBe(budget.income);
    expect(budget.lines.reduce((sum, line) => sum + line.upkeep, 0)).toBe(budget.expenses);
  });
});

describe('důsledek elektřiny', () => {
  it('budova bez proudu nedaní a nefiguruje ani ve výdajích', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    place(world, HOUSE, 5, 5, false);

    tickMonth(world, catalogue);

    expect(world.economy.lastIncome).toBe(0);
    expect(world.economy.lastExpenses).toBe(0);
    expect(world.economy.funds).toBe(STARTING_FUNDS);
  });

  it('město bez elektrárny nespadne do mínusu, jen nevydělává', () => {
    // Kdyby temné budovy platily údržbu, město by se dostalo do mínusu
    // a na elektrárnu by pak nikdy nevydělalo — past bez východiska.
    const catalogue = catalogueOf(HOUSE, FACTORY);
    const world = createWorld(1);
    for (let i = 0; i < 6; i++) place(world, HOUSE, 5 + i, 5, false);
    for (let i = 0; i < 3; i++) place(world, FACTORY, 5 + i, 8, false);

    for (let month = 0; month < 12; month++) tickMonth(world, catalogue);

    expect(world.economy.funds).toBe(STARTING_FUNDS);
  });

  it('připojení k proudu rozjede daně (§13 krok 7)', () => {
    const catalogue = catalogueOf(HOUSE);
    const world = createWorld(1);
    const houses = [0, 1, 2].map((i) => placeBuilding(world, HOUSE, 5 + i, 5));

    tickMonth(world, catalogue);
    expect(world.economy.lastIncome).toBe(0);

    for (const house of houses) house.powered = true;
    tickMonth(world, catalogue);

    // 24 obyvatel × 40 × 7 % = 67
    expect(world.economy.lastIncome).toBe(67);
    expect(world.economy.lastExpenses).toBe(30);
  });

  it('poptávku sytí i budovy bez proudu, jinak by hráč stavěl další a další', () => {
    const catalogue = catalogueOf(HOUSE, FACTORY);
    const world = createWorld(1);
    for (let i = 0; i < 6; i++) place(world, HOUSE, 5 + i, 5, false);
    for (let i = 0; i < 3; i++) place(world, FACTORY, 5 + i, 8, false);

    tickDemand(world, catalogue);

    expect(world.demand.industrial).toBeLessThan(0);
  });

  it('elektrárna utáhne jen omezený počet budov a fabrika žere víc než dům', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const house = content.get('vanilla:residential_small');
    const shop = content.get('vanilla:commercial_small');
    const factory = content.get('vanilla:industrial_small');
    const plant = content.get('vanilla:coal_power_plant');

    expect(house?.power?.consumption).toBeLessThan(shop?.power?.consumption ?? 0);
    expect(shop?.power?.consumption).toBeLessThan(factory?.power?.consumption ?? 0);

    // Jedna elektrárna uživí desítky domů, ale řádově míň fabrik.
    const production = plant?.power?.production ?? 0;
    expect(Math.floor(production / (house?.power?.consumption ?? 1))).toBe(60);
    expect(Math.floor(production / (factory?.power?.consumption ?? 1))).toBe(20);
  });
});

describe('vanilla balanc', () => {
  it('výchozí hodnoty světa se neliší od balance.json', () => {
    // `createWorld` má konstanty jen jako záložní hodnotu pro testy. Kdyby se
    // rozešly s obsahem, hráč by hrál jinou hru než ta, kterou testujeme.
    expect(STARTING_FUNDS).toBe(VANILLA_BALANCE.economy.startingFunds);
    expect(DEFAULT_TAX_RATE).toBe(VANILLA_BALANCE.economy.defaultTaxRate);

    const world = createWorld(1, VANILLA_BALANCE.economy);
    expect(world.economy.funds).toBe(VANILLA_BALANCE.economy.startingFunds);
    expect(world.economy.taxRates.residential).toBe(VANILLA_BALANCE.economy.defaultTaxRate);
  });

  it('každá RCI budova při výchozí dani utáhne aspoň dvojnásobek své údržby', async () => {
    // Kdyby se dům sotva zaplatil, město by nikdy nevydělalo na policii ani
    // školu a hráč by při 7 % neufinancoval nic — přesně to se stalo před
    // přeladěním, kdy byl poměr 1,1× u obchodu.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const { taxableValuePerUnit: unit, defaultTaxRate: rate } = VANILLA_BALANCE.economy;

    const cases: [string, (d: Definition) => number][] = [
      ['vanilla:residential_small', (d) => d.population?.capacity ?? 0],
      ['vanilla:commercial_small', (d) => d.jobs?.capacity ?? 0],
      ['vanilla:industrial_small', (d) => d.jobs?.capacity ?? 0],
    ];

    for (const [id, base] of cases) {
      const definition = content.get(id);
      expect(definition, id).toBeDefined();
      if (!definition) continue;

      const tax = taxFrom(base(definition), rate, unit);
      expect(tax / definition.economy.upkeep, id).toBeGreaterThanOrEqual(2);
    }
  });
});
