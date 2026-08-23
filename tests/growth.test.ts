import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { buildRoad, bulldoze, setTaxRate, zoneArea } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { hashLayers, index, TERRAIN, ZONE } from '@/sim/layers';
import type { ZoneType } from '@/sim/layers';
import { applyCornerChanges, isFlatTile, planCornerHeight } from '@/sim/heights';
import { tryUpgrade } from '@/sim/levels';
import { createGrowthSystem } from '@/sim/systems';
import type { BuildingCatalogue } from '@/sim/systems';
import { createWorld, tickWorld, totalJobs, totalPopulation } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { assumeWatered } from './support/water';

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

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Odtiká tolik tiků, aby růstový systém (interval 12) proběhl `runs`krát. */
function run(world: WorldState, catalogue: BuildingCatalogue, runs: number): void {
  const growth = createGrowthSystem(catalogue, VANILLA_BALANCE);
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
    expect(
      world.layers.buildingId[index(building.x, building.y, world.size)],
    ).toBe(building.id);
  });

  it('bez silnice nevyroste nic — žádná parcela není v dosahu', () => {
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
      world.layers.terrain[index(x, 11, world.size)] = TERRAIN.rock;
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
      expect(
        world.layers.buildingId[
          index(building.x + (dx ?? 0), building.y + (dy ?? 0), world.size)
        ],
      ).toBe(building.id);
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

describe('skóre parcely (§9)', () => {
  /** Silnice na y = 10 a hluboká zóna pod ní, až za dosah. */
  function deepZone(seed = 5): WorldState {
    const world = createWorld(seed);
    for (let x = 5; x <= 15; x++) buildRoad(world, x, 10);
    zoneArea(world, 5, 11, 11, 6, ZONE.residential);
    return saturateDemand(world);
  }

  it('zóna dvě dlaždice od silnice se zastaví (§13 krok 8)', () => {
    const world = deepZone();
    run(world, catalogueOf(HOUSE), 60);

    const rows = new Set([...world.buildings.values()].map((b) => b.y));
    expect(rows.has(11)).toBe(true); // sousedí
    expect([...rows].some((y) => y >= 12)).toBe(true); // dosah, ne sousedství
  });

  it('dál než tři dlaždice od silnice nevyroste nic', () => {
    const world = deepZone();
    run(world, catalogueOf(HOUSE), 60);

    // Silnice je na y = 10, takže y = 14 už je čtvrtá dlaždice.
    for (const building of world.buildings.values()) {
      expect(building.y, `budova na ${building.x},${building.y}`).toBeLessThanOrEqual(13);
    }
    expect(world.buildings.size).toBeGreaterThan(5);
  });

  it('dosah je věc balancu, ne kódu', () => {
    // Delší tabulka = hlubší zástavba. Kdyby dosah zůstal v kódu, tenhle
    // případ by šel jen přepsáním zdrojáku.
    const far = {
      ...VANILLA_BALANCE,
      growth: { ...VANILLA_BALANCE.growth, roadFactors: [1, 1, 0.8, 0.6, 0.4, 0.2] },
    };
    const world = deepZone();
    const growth = createGrowthSystem(catalogueOf(HOUSE), far);
    for (let tick = 0; tick < 60 * growth.interval; tick++) tickWorld(world, [growth]);

    const rows = [...world.buildings.values()].map((b) => b.y);
    expect(Math.max(...rows)).toBe(15); // silnice na y = 10, pátá dlaždice
  });

  it('rozšiřování dosahem omezené není — budova smí přesáhnout', () => {
    // Dosah řeší jen to, kde smí vzniknout **první** dlaždice zástavby.
    // Půdorys až 5×5 je proto podle §8 v pořádku i v hlubokém bloku.
    const world = deepZone();
    const seed: Definition = { ...HOUSE, id: 'test:seed' };
    const deep: Definition = { ...HOUSE, id: 'test:deep', footprint: [1, 2] };

    run(world, catalogueOf(seed), 60);
    const building = [...world.buildings.values()].find((b) => b.y === 13);
    expect(building, 'na kraji dosahu má stát budova').toBeDefined();
    if (!building) return;

    // Vpravo i vlevo stojí sousedi téže úrovně, takže zbývá jen směr do hloubky.
    expect(tryUpgrade(world, catalogueOf(seed, deep), building)).toBe(true);
    expect(building.definitionId).toBe(deep.id);
    // Druhá dlaždice leží čtyři pole od silnice, tedy za dosahem růstu.
    expect(world.layers.buildingId[index(building.x, 14, world.size)]).toBe(
      building.id,
    );
  });

  it('drahá půda se zastaví dřív než levná', () => {
    const world = createWorld(11);
    for (let x = 4; x <= 60; x++) buildRoad(world, x, 10);
    zoneArea(world, 5, 11, 20, 1, ZONE.residential); // levná strana
    zoneArea(world, 40, 11, 20, 1, ZONE.residential); // drahá strana
    saturateDemand(world);

    for (let cell = 0; cell < world.coarse.landValue.length; cell++) {
      world.coarse.landValue[cell] = 20;
    }
    for (let x = 40; x <= 59; x++) {
      world.coarse.landValue[coarseIndex(x, 11, world.size)] = 200;
    }

    run(world, catalogueOf(HOUSE), 3);

    // Poměr vah je (201 / 21) ^ 1,5, tedy skoro třicetinásobek — pár budov na
    // levné straně je v pořádku, ale většina musí stát na drahé.
    const expensive = [...world.buildings.values()].filter((b) => b.x >= 40).length;
    const cheap = [...world.buildings.values()].filter((b) => b.x < 40).length;
    expect(expensive).toBeGreaterThan(cheap * 3);
  });
});

describe('poptávka jako rychlost (§9)', () => {
  function zoned(seed: number, demand: number): WorldState {
    const world = createWorld(seed);
    for (let x = 5; x <= 25; x++) buildRoad(world, x, 10);
    zoneArea(world, 5, 11, 21, 3, ZONE.residential);
    world.demand.residential = demand;
    return world;
  }

  it('poptávka 5 a 50 se liší, nejen znaménkem', () => {
    const slow = zoned(9, VANILLA_BALANCE.growth.demandPerAttempt);
    const fast = zoned(9, VANILLA_BALANCE.growth.demandPerAttempt * 8);

    run(slow, catalogueOf(HOUSE), 3);
    run(fast, catalogueOf(HOUSE), 3);

    expect(fast.buildings.size).toBeGreaterThan(slow.buildings.size * 3);
  });

  it('víc než strop pokusů se za jeden běh nepostaví', () => {
    const world = zoned(9, 1000);
    const growth = createGrowthSystem(catalogueOf(HOUSE), VANILLA_BALANCE);

    // Přesně po první běh systému, ne o jeden navíc.
    for (let tick = 0; tick <= growth.offset; tick++) tickWorld(world, [growth]);

    expect(world.buildings.size).toBeLessThanOrEqual(VANILLA_BALANCE.growth.maxAttempts);
    expect(world.buildings.size).toBeGreaterThan(0);
  });

  it('bez poptávky se nestaví', () => {
    const world = zoned(9, 0);
    run(world, catalogueOf(HOUSE), 10);
    expect(world.buildings.size).toBe(0);
  });

  it('město v mínusu nestaví', () => {
    const world = zoned(9, 100);
    world.economy.funds = -1;
    run(world, catalogueOf(HOUSE), 10);
    expect(world.buildings.size).toBe(0);
  });
});

describe('daň brzdí růst (§13 krok 9)', () => {
  function taxedCity(rate: number): WorldState {
    const world = createWorld(13);
    for (let x = 5; x <= 25; x++) buildRoad(world, x, 10);
    zoneArea(world, 5, 11, 21, 3, ZONE.residential);
    world.demand.residential = 50;
    setTaxRate(world, ZONE.residential, rate);
    return world;
  }

  it('vyšší sazba znamená měřitelně pomalejší růst', () => {
    const neutral = taxedCity(VANILLA_BALANCE.growth.neutralTaxRate);
    const heavy = taxedCity(18);

    run(neutral, catalogueOf(HOUSE), 5);
    run(heavy, catalogueOf(HOUSE), 5);

    expect(heavy.buildings.size).toBeLessThan(neutral.buildings.size);
  });

  it('nižší sazba růst naopak zrychlí', () => {
    const neutral = taxedCity(VANILLA_BALANCE.growth.neutralTaxRate);
    const cheap = taxedCity(0);

    run(neutral, catalogueOf(HOUSE), 3);
    run(cheap, catalogueOf(HOUSE), 3);

    expect(cheap.buildings.size).toBeGreaterThan(neutral.buildings.size);
  });
});

describe('zónování', () => {
  it('vyznačí obdélník', () => {
    const world = createWorld(1);
    zoneArea(world, 3, 4, 2, 3, ZONE.commercial);

    expect(world.layers.zone[index(3, 4, world.size)]).toBe(ZONE.commercial);
    expect(world.layers.zone[index(4, 6, world.size)]).toBe(ZONE.commercial);
    expect(world.layers.zone[index(5, 4, world.size)]).toBe(ZONE.none);
  });

  it('přeskočí vodu, silnici i obsazenou dlaždici', () => {
    const world = createWorld(1);
    world.layers.terrain[index(3, 4, world.size)] = TERRAIN.water;
    buildRoad(world, 4, 4);
    world.layers.buildingId[index(5, 4, world.size)] = 7;

    zoneArea(world, 3, 4, 3, 1, ZONE.residential);

    expect(world.layers.zone[index(3, 4, world.size)]).toBe(ZONE.none);
    expect(world.layers.zone[index(4, 4, world.size)]).toBe(ZONE.none);
    expect(world.layers.zone[index(5, 4, world.size)]).toBe(ZONE.none);
  });

  it('ZONE.none zónu ruší', () => {
    const world = createWorld(1);
    zoneArea(world, 3, 4, 2, 2, ZONE.residential);
    zoneArea(world, 3, 4, 2, 2, ZONE.none);
    expect(world.layers.zone[index(3, 4, world.size)]).toBe(ZONE.none);
  });

  it('ořízne se o okraj mapy místo pádu', () => {
    const world = createWorld(1);
    expect(() =>
      zoneArea(world, 126, 126, 8, 8, ZONE.residential),
    ).not.toThrow();
    expect(world.layers.zone[index(127, 127, world.size)]).toBe(
      ZONE.residential,
    );
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
    expect(
      world.layers.buildingId[index(building.x, building.y, world.size)],
    ).toBe(0);
    expect(world.layers.zone[index(building.x, building.y, world.size)]).toBe(
      ZONE.residential,
    );
    // Obyvatelé zmizeli s domem, ne s celým městem.
    expect(totalPopulation(world.buildings)).toBe(populationBefore - building.population);
  });

  it('na dlaždici bez budovy zboří silnici, jinak zónu', () => {
    const world = createWorld(1);
    buildRoad(world, 5, 5);
    zoneArea(world, 6, 5, 1, 1, ZONE.residential);

    bulldoze(world, 5, 5);
    expect(world.layers.road[index(5, 5, world.size)]).toBe(0);

    bulldoze(world, 6, 5);
    expect(world.layers.zone[index(6, 5, world.size)]).toBe(ZONE.none);
  });
});

describe('vanilla obsah v simulaci', () => {
  it('z reálných definic vyroste obytná čtvrť', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const world = cityWithZone(7);
    // Test je o růstu z reálných definic, ne o vodovodu (§8 fáze 3).
    assumeWatered(world);
    run(world, content, 25);

    expect(world.buildings.size).toBeGreaterThan(0);
    for (const building of world.buildings.values()) {
      expect(building.definitionId).toBe('vanilla:residential_small');
    }
    expect(totalPopulation(world.buildings)).toBe(world.buildings.size * 8);
  });
});

describe('stavba na svahu', () => {
  /**
   * Rozhodnutí autora (T41): zóna na kopci **musí** vyrůst. Do té doby růst
   * vyžadoval rovinu a sám nic nesrovnal, takže na generované mapě byla
   * necelá polovina souše nezastavitelná — a hra o tom mlčela.
   */
  it('dům ze zóny vyroste i na svahu', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const world = createWorld(7, content.getBalance().economy);
    for (let x = 20; x <= 30; x++) buildRoad(world, x, 30);
    zoneArea(world, 20, 31, 10, 1, ZONE.residential);
    // Svah přes celou zónu: žádná z parcel není rovná.
    applyCornerChanges(world.cornerHeight, planCornerHeight(world.cornerHeight, 25, 32, 3));
    expect([20, 22, 25, 28].some((x) => !isFlatTile(world.cornerHeight, x, 31))).toBe(true);

    assumeWatered(world);
    saturateDemand(world);

    const systems = [createGrowthSystem(content, content.getBalance())];
    for (let tick = 0; tick < 400; tick++) {
      tickWorld(world, systems);
      assumeWatered(world);
      saturateDemand(world);
    }

    expect(world.buildings.size).toBeGreaterThan(0);
  });

  it('ale na rovině se staví ochotněji', () => {
    // „O třicet procent dražší" se v losu projeví jako menší váha, ne jako
    // účet — dům ze zóny hráč neplatí.
    expect(VANILLA_BALANCE.growth.slopeFactor).toBeGreaterThan(0);
    expect(VANILLA_BALANCE.growth.slopeFactor).toBeLessThan(1);
  });
});
