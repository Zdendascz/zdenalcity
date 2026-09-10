import { describe, expect, it } from 'vitest';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { coarseIndex, COARSE_FACTOR } from '@/sim/coarse';
import { explainParcel } from '@/sim/diagnostics';
import {
  createCrimeSystem,
  createDemandSystem,
  createHappinessSystem,
  createLandValueSystem,
  createServiceSystem,
} from '@/sim/systems';
import {
  averageHappiness,
  happinessDemandFactor,
  taxPenalty,
} from '@/sim/systems/happiness';
import { createWorld, NEUTRAL_HAPPINESS, setRoadTile, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { COARSE_CELLS } from './support/grid';
import { powerAll } from './support/power';

/**
 * Spokojenost (§9 fáze 3).
 *
 * Testy nesledují konkrétní čísla — ta jsou balanc a mění se. Sledují **směr**:
 * co spokojenost zvedá, co ji sráží a že růstu nepřekáží úplně.
 */
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
  graphics: { color: '#8fb4dd', heightLevels: 1 },
};

const PARK: Definition = {
  id: 'test:park',
  type: 'building',
  category: 'service',
  name: 'building.park.name',
  description: 'building.park.desc',
  footprint: [2, 2],
  level: 1,
  construction: { cost: 200, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 20 },
  service: { class: 'parks', radius: 8, strength: 200 },
  graphics: { color: '#6fa86f', heightLevels: 1 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Odtiká tolik tiků, aby spokojenost proběhla `runs`krát (interval 16, offset 13). */
function run(world: WorldState, catalogue: BuildingCatalogue, runs: number): void {
  const systems = [
    createServiceSystem(catalogue, VANILLA_BALANCE),
    createCrimeSystem(VANILLA_BALANCE),
    createLandValueSystem(VANILLA_BALANCE),
    createHappinessSystem(VANILLA_BALANCE),
  ];
  for (let tick = 0; tick < runs * 16 + 13; tick++) tickWorld(world, systems);
}

/**
 * Jen spokojenost, žádné jiné systémy.
 *
 * Většina testů níž si vstupní vrstvu nastaví rukou. Kdyby vedle běžela cena
 * půdy nebo kriminalita, měřily by se vazby přes ni — a test na kriminalitu by
 * prošel i tehdy, kdyby spokojenost o kriminalitě vůbec nevěděla.
 */
function runAlone(world: WorldState, runs: number): void {
  const systems = [createHappinessSystem(VANILLA_BALANCE)];
  for (let tick = 0; tick < runs * 16 + 13; tick++) tickWorld(world, systems);
}

function happiness(world: WorldState, x: number, y: number): number {
  return world.happiness[coarseIndex(x, y, world.size)] ?? 0;
}

describe('spokojenost', () => {
  it('běží každých 16 tiků s offsetem 13', () => {
    const system = createHappinessSystem(VANILLA_BALANCE);
    expect([system.name, system.interval, system.offset]).toEqual(['happiness', 16, 13]);
  });

  it('nové město začíná neutrální, ne na nule', () => {
    const world = createWorld(1);
    expect(happiness(world, 64, 64)).toBe(NEUTRAL_HAPPINESS);
    // Kdyby začínala nulou, overlay by hlásil katastrofu ještě před prvním domem.
    expect(Math.min(...world.happiness)).toBe(NEUTRAL_HAPPINESS);
  });

  it('park ji v okolí zvedne', () => {
    const build = (withPark: boolean): WorldState => {
      const world = createWorld(1);
      for (let i = 0; i < 8; i++) placeBuilding(world, HOUSE, 60 + i, 60);
      if (withPark) placeBuilding(world, PARK, 62, 62);
      powerAll(world);
      run(world, catalogueOf(HOUSE, PARK), 40);
      return world;
    };

    expect(happiness(build(true), 61, 61)).toBeGreaterThan(happiness(build(false), 61, 61));
  });

  it('kriminalita ji srazí', () => {
    const world = createWorld(1);
    world.coarse.crime[coarseIndex(64, 64, world.size)] = 200;
    runAlone(world, 40);

    expect(happiness(world, 64, 64)).toBeLessThan(happiness(world, 4, 100));
  });

  it('znečištění ji srazí', () => {
    const world = createWorld(1);
    world.coarse.pollution[coarseIndex(64, 64, world.size)] = 200;
    runAlone(world, 40);

    expect(happiness(world, 64, 64)).toBeLessThan(happiness(world, 4, 100));
  });

  it('cena půdy ji zvedá', () => {
    const world = createWorld(1);
    world.coarse.landValue[coarseIndex(64, 64, world.size)] = 200;
    runAlone(world, 40);

    expect(happiness(world, 64, 64)).toBeGreaterThan(happiness(world, 4, 100));
  });

  it('pokrytí službami ji zvedá přímo, ne jen přes cenu půdy', () => {
    const world = createWorld(1);
    const parks = new Uint8Array(COARSE_CELLS);
    parks[coarseIndex(64, 64, world.size)] = 255;
    world.coverage.set('parks', parks);
    runAlone(world, 40);

    expect(happiness(world, 64, 64)).toBeGreaterThan(happiness(world, 4, 100));
  });

  it('daně ji srazí celoměstsky', () => {
    const build = (taxRate: number): WorldState => {
      const world = createWorld(1);
      world.economy.taxRates.residential = taxRate;
      for (let i = 0; i < 4; i++) placeBuilding(world, HOUSE, 64 + i, 64);
      run(world, catalogueOf(HOUSE), 40);
      return world;
    };

    // I na druhém konci mapy: daň se neplatí po čtvrtích.
    expect(happiness(build(18), 4, 4)).toBeLessThan(happiness(build(2), 4, 4));
  });

  it('vyhlazení brání skokům', () => {
    const measure = (runs: number): number => {
      const world = createWorld(1);
      world.coarse.crime[coarseIndex(64, 64, world.size)] = 255;
      runAlone(world, runs);
      return happiness(world, 64, 64);
    };

    const start = NEUTRAL_HAPPINESS;
    const poJednom = measure(1);
    const ustálené = measure(60);

    // Po jednom běhu je hodnota **mezi** výchozí a ustálenou: kus cesty ušla,
    // celou ne. Bez vyhlazení by první běh skočil rovnou na cíl.
    expect(poJednom).toBeLessThan(start);
    expect(poJednom).toBeGreaterThan(ustálené);
  });

  it('kolony ji srazí', () => {
    const ucpané = createWorld(1);
    const volné = createWorld(1);
    for (const world of [ucpané, volné]) {
      for (let i = 0; i < 4; i++) placeBuilding(world, HOUSE, 64 + i, 64);
    }
    // Zátěž se dopočítává dopravou; tady ji nastavíme rovnou, aby test měřil
    // jen vazbu kolony → spokojenost.
    for (let x = 64; x < 64 + COARSE_FACTOR; x++) {
      for (let y = 64; y < 64 + COARSE_FACTOR; y++) {
        setRoadTile(ucpané, y * ucpané.size + x, 1);
        ucpané.trafficLoad[y * ucpané.size + x] = 10000;
      }
    }
    run(ucpané, catalogueOf(HOUSE), 40);
    run(volné, catalogueOf(HOUSE), 40);

    expect(happiness(ucpané, 64, 64)).toBeLessThan(happiness(volné, 64, 64));
  });
});

describe('průměrná spokojenost', () => {
  it('počítá jen z obydlených buněk', () => {
    const world = createWorld(1);
    placeBuilding(world, HOUSE, 64, 64);
    // Park lidi nemá; jeho čtvrť do průměru nepatří, i když tam budova stojí.
    placeBuilding(world, PARK, 4, 100);
    world.happiness.fill(0);
    world.happiness[coarseIndex(64, 64, world.size)] = 200;

    // Prázdných buněk je 1023 z 1024; kdyby se počítaly, průměr by byl skoro nula.
    expect(averageHappiness(world)).toBe(200);
  });

  it('prázdné město má nulu', () => {
    expect(averageHappiness(createWorld(1))).toBe(0);
  });
});

describe('vazba na poptávku', () => {
  /** Poptávka běží každé 4 tiky — jedním tikem by se podruhé nepřepočítala. */
  function demandOf(world: WorldState, catalogue: BuildingCatalogue): number {
    const system = createDemandSystem(catalogue, VANILLA_BALANCE);
    for (let tick = 0; tick < 4; tick++) tickWorld(world, [system]);
    return world.demand.residential;
  }

  it('nespokojené město roste pomaleji než spokojené', () => {
    const build = (value: number): WorldState => {
      const world = createWorld(1);
      placeBuilding(world, HOUSE, 64, 64);
      world.buildings.get(1)!.population = 8;
      world.happiness.fill(value);
      return world;
    };

    const spokojené = demandOf(build(255), catalogueOf(HOUSE));
    const nespokojené = demandOf(build(0), catalogueOf(HOUSE));

    expect(nespokojené).toBeLessThan(spokojené);
    // …ale pořád roste. Nulová poptávka by hru zamkla přesně ve chvíli, kdy se
    // hráč snaží situaci otočit (R6).
    expect(nespokojené).toBeGreaterThan(0);
  });

  it('město bez obyvatel se nikoho neptá', () => {
    const world = createWorld(1);
    world.happiness.fill(0);
    expect(happinessDemandFactor(world, VANILLA_BALANCE)).toBe(1);
  });

  it('přebytek bytů spokojenost nezmírňuje', () => {
    // Záporná poptávka znamená „bytů je dost“ — s náladou nesouvisí a násobit
    // se nesmí, jinak by nespokojené město hlásilo menší přebytek.
    const world = createWorld(1);
    for (let i = 0; i < 40; i++) placeBuilding(world, HOUSE, 40 + (i % 8), 40 + ((i / 8) | 0));
    for (const building of world.buildings.values()) building.population = 8;
    world.happiness.fill(0);

    const nespokojené = demandOf(world, catalogueOf(HOUSE));
    world.happiness.fill(255);
    const spokojené = demandOf(world, catalogueOf(HOUSE));

    expect(nespokojené).toBeLessThan(0);
    expect(nespokojené).toBe(spokojené);
  });
});

describe('čitelnost', () => {
  it('panel parcely spokojenost ukazuje', () => {
    const world = createWorld(1);
    world.happiness[coarseIndex(64, 64, world.size)] = 42;
    expect(explainParcel(world, VANILLA_BALANCE, 64, 64).happiness).toBe(42);
  });
});

/**
 * Progrese daní (T113).
 *
 * Autor: „zdvojnásob vliv vysokých daní na spokojenost, respektive měla by
 * tam být nějaká progrese — čím vyšší daň, tím vyšší nespokojenost."
 *
 * Testuje se tvar křivky, ne konkrétní srážka: koeficienty jsou balanc.
 */
describe('daň a spokojenost', () => {
  it('nulová daň nesráží nic', () => {
    expect(taxPenalty(VANILLA_BALANCE, 0)).toBe(0);
  });

  it('každé další procento bolí víc než to předchozí', () => {
    let previous = 0;
    for (let rate = 1; rate <= 20; rate++) {
      const step = taxPenalty(VANILLA_BALANCE, rate) - taxPenalty(VANILLA_BALANCE, rate - 1);
      expect(step).toBeGreaterThanOrEqual(previous);
      previous = step;
    }
  });

  it('u stropu sazby je srážka dvojnásobná proti přímce', () => {
    // Přesně ten „zdvojnásob" ze zadání. Dole se nemění nic, nahoře dvakrát.
    const { tax } = VANILLA_BALANCE.happiness;
    expect(taxPenalty(VANILLA_BALANCE, 20) / (20 * tax)).toBeCloseTo(2, 1);
    expect(taxPenalty(VANILLA_BALANCE, 5)).toBeCloseTo(5 * tax, 10);
  });
});
