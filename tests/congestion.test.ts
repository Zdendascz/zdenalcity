import { describe, expect, it } from 'vitest';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, zoneArea } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { coarseCongestion, explainLandValue, landValueContext } from '@/sim/diagnostics';
import { index, ROAD, ZONE } from '@/sim/layers';
import { createGrowthSystem, createTrafficSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

function definition(id: string, category: string, capacity: number): Definition {
  return {
    id: `test:${id}`,
    type: 'building',
    category,
    name: `building.${id}.name`,
    description: `building.${id}.desc`,
    footprint: [1, 1],
    level: 1,
    construction: { cost: 10, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
    economy: { upkeep: 1 },
    ...(category === 'residential' ? { population: { capacity } } : { jobs: { capacity } }),
    graphics: { color: '#8fb4dd', heightLevels: 1 },
  };
}

const HOUSE = definition('house', 'residential', 8);
const SHOP = definition('shop', 'commercial', 6);
const CATALOGUE: BuildingCatalogue = {
  get: (id) => [HOUSE, SHOP].find((d) => d.id === id),
  byCategory: (category) => [HOUSE, SHOP].filter((d) => d.category === category),
};

function world(): WorldState {
  return createWorld(1, VANILLA_BALANCE.economy);
}

function street(w: WorldState, x0: number, x1: number, y: number, type: number = ROAD.street): void {
  for (let x = x0; x <= x1; x++) buildRoad(w, x, y, type, VANILLA_BALANCE);
}

describe('kolony', () => {
  it('vytížení je zátěž dělená kapacitou typu silnice (§5)', () => {
    const w = world();
    // Buňka hrubé mřížky pokrývá dlaždice 8–11; ulice ji projde celou.
    street(w, 8, 11, 8);
    w.trafficLoad[index(8, 8)] = VANILLA_BALANCE.traffic.roadTypes[0]?.capacity ?? 0;

    const congestion = coarseCongestion(w, VANILLA_BALANCE);
    // Čtyři silniční dlaždice, jedna z nich je plná — průměr je čtvrtina.
    expect(congestion[coarseIndex(8, 8)]).toBeCloseTo(0.25, 5);
  });

  it('širší silnice snese stejnou zátěž s menším vytížením', () => {
    const load = 120;

    const narrow = world();
    street(narrow, 8, 11, 8);
    for (let x = 8; x <= 11; x++) narrow.trafficLoad[index(x, 8)] = load;

    const wide = world();
    street(wide, 8, 11, 8, ROAD.avenue);
    for (let x = 8; x <= 11; x++) wide.trafficLoad[index(x, 8)] = load;

    const cell = coarseIndex(8, 8);
    expect(coarseCongestion(wide, VANILLA_BALANCE)[cell] ?? 0).toBeLessThan(
      coarseCongestion(narrow, VANILLA_BALANCE)[cell] ?? 0,
    );
  });

  it('buňka bez silnice má nulu, ne dělení nulou', () => {
    const congestion = coarseCongestion(world(), VANILLA_BALANCE);
    expect([...congestion].every((value) => value === 0)).toBe(true);
  });

  it('srážejí cenu půdy jako záporný člen', () => {
    const w = world();
    street(w, 8, 11, 8);
    for (let x = 8; x <= 11; x++) w.trafficLoad[index(x, 8)] = 200;

    const cell = coarseIndex(8, 8);
    const explained = explainLandValue(w, VANILLA_BALANCE, cell, landValueContext(w, VANILLA_BALANCE));
    const term = explained.terms.find((t) => t.source === 'congestion');

    expect(term).toBeDefined();
    expect(term?.amount ?? 0).toBeLessThan(0);

    // Bez kolon je cena půdy vyšší.
    const clean = world();
    street(clean, 8, 11, 8);
    const withoutTraffic = explainLandValue(
      clean,
      VANILLA_BALANCE,
      cell,
      landValueContext(clean, VANILLA_BALANCE),
    );
    expect(explained.raw).toBeLessThan(withoutTraffic.raw);
  });
});

describe('dostupnost práce v růstu (R6)', () => {
  const growth = createGrowthSystem(CATALOGUE, VANILLA_BALANCE);
  const traffic = createTrafficSystem(CATALOGUE, VANILLA_BALANCE);

  /** Pás zóny podél silnice, dost velký, aby růst brzdila rychlost, ne místo. */
  function zoned(seed: number): WorldState {
    const w = createWorld(seed, VANILLA_BALANCE.economy);
    street(w, 10, 30, 10);
    zoneArea(w, 10, 11, 20, 3, ZONE.residential);
    w.demand.residential = 60;
    return w;
  }

  function run(ticks: number, shop: [number, number] | null, seed = 7): number {
    const w = zoned(seed);
    if (shop) placeBuilding(w, SHOP, shop[0], shop[1]);
    for (let tick = 0; tick < ticks; tick++) tickWorld(w, [traffic, growth]);
    return w.buildings.size;
  }

  it('bez jediného pracovního místa se staví plnou rychlostí — žádné uzamčení', () => {
    // Pojistka ze zadání: dokud město nemá práci, nesmí ho dostupnost brzdit,
    // jinak by nevzniklo nic a práce by nikdy nepřibyla.
    expect(run(60, null, 1)).toBeGreaterThan(30);
  });

  it('špatně obsloužená čtvrť roste pomaleji, ale roste (R6)', () => {
    // Dvě stejná města: v jednom je práce v ulici, ve druhém na jejím konci.
    const near = run(120, [12, 9]);
    const far = run(120, [30, 9]);

    expect(far).toBeGreaterThan(1); // roste, nezasekne se
    expect(near).toBeGreaterThan(far);
  });

  it('při nulové dostupnosti se staví pomalu, ale staví', () => {
    // Tvrdá nula by z dostupnosti udělala bránu, ze které není cesta ven:
    // nikdo by se nepřistěhoval, takže by nikdo nepostavil silnici k práci.
    expect(VANILLA_BALANCE.growth.minAccessFactor).toBeGreaterThan(0);

    const w = zoned(3);
    placeBuilding(w, SHOP, 12, 9); // práce existuje, jen se do ní nikdo nedostane
    // Bez dopravního systému zůstane dosažitelnost na nule, kam ji tu dáme.
    for (let tick = 0; tick < 400; tick++) {
      for (const building of w.buildings.values()) w.jobAccess.set(building.id, 0);
      tickWorld(w, [growth]);
    }

    // S podlahou 0,15 vzniknou desítky domů; s tvrdou nulou se stavba zadrhne
    // hned, jak se do prvních domů někdo nastěhuje.
    expect(w.buildings.size).toBeGreaterThan(25);
  });
});
