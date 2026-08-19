import { describe, expect, it } from 'vitest';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad } from '@/sim/commands';
import { index, ROAD } from '@/sim/layers';
import { createTrafficSystem } from '@/sim/systems';
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

const traffic = createTrafficSystem(CATALOGUE, VANILLA_BALANCE);

/** Odtiká přesně `runs` běhů systému — první padne na `offset`, další po intervalu. */
function run(world: WorldState, runs = 1): void {
  const ticks = traffic.offset + (runs - 1) * traffic.interval;
  for (let i = 0; i < ticks; i++) tickWorld(world, [traffic]);
}

/** Ulice od `x0` do `x1` na řádku `y`. */
function street(world: WorldState, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) buildRoad(world, x, y, ROAD.street, VANILLA_BALANCE);
}

describe('dosažitelnost práce', () => {
  it('dům spojený s obchodem ji má, dům bez silnice nulovou', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 20, 10);
    const connected = placeBuilding(world, HOUSE, 10, 11);
    placeBuilding(world, SHOP, 20, 11);
    // Dům úplně bez silnice v sousedství.
    const isolated = placeBuilding(world, HOUSE, 60, 60);

    run(world, 6);

    expect(world.jobAccess.get(connected.id) ?? 0).toBeGreaterThan(0);
    expect(world.jobAccess.get(isolated.id) ?? 0).toBe(0);
  });

  it('bez práce ve městě je nulová i u domu na silnici', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 20, 10);
    const house = placeBuilding(world, HOUSE, 12, 11);

    run(world, 6);

    expect(world.jobAccess.get(house.id) ?? 0).toBe(0);
  });

  it('bližší práce je dostupnější než vzdálená', () => {
    const near = createWorld(1, VANILLA_BALANCE.economy);
    street(near, 10, 30, 10);
    const nearHouse = placeBuilding(near, HOUSE, 10, 11);
    placeBuilding(near, SHOP, 12, 11);

    // Dál, než kolik má chodec kroků — takový obchod je prakticky nedostupný.
    const far = createWorld(1, VANILLA_BALANCE.economy);
    const distance = VANILLA_BALANCE.traffic.maxSteps + 10;
    street(far, 10, 10 + distance, 10);
    const farHouse = placeBuilding(far, HOUSE, 10, 11);
    placeBuilding(far, SHOP, 10 + distance, 11);

    run(near, 10);
    run(far, 10);

    expect(near.jobAccess.get(nearHouse.id) ?? 0).toBeGreaterThan(
      far.jobAccess.get(farHouse.id) ?? 0,
    );
  });

  it('chodec se nevrací, odkud přišel — jinak nikam nedojde (§5)', () => {
    // Rovná ulice bez odboček: kdo se nevrací, musí dojít na konec vždycky.
    // Kdyby se vracet směl, je z toho náhodná procházka a na dvacet dlaždic
    // daleký obchod dojde jen výjimečně.
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 30, 10);
    const house = placeBuilding(world, HOUSE, 10, 11);
    placeBuilding(world, SHOP, 30, 11);

    run(world, 1);

    // Většina pokusů dojde. Ne všechny: kdo vyrazí z dlaždice vedle domu
    // směrem ke slepému konci ulice, nemá se kam vrátit a cestu vzdá —
    // to je vlastnost pravidla, ne chyba.
    expect(world.jobAccess.get(house.id) ?? 0).toBeGreaterThan(
      VANILLA_BALANCE.traffic.smoothing * 0.5,
    );
  });

  it('mění se plynule, ne skokem — vyhlazení drží (§5)', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 14, 10);
    const house = placeBuilding(world, HOUSE, 10, 11);
    placeBuilding(world, SHOP, 14, 11);

    run(world, 1);
    const first = world.jobAccess.get(house.id) ?? 0;

    expect(first).toBeGreaterThan(0);
    // Po jednom běhu nemůže být na maximu: vyhlazení je 0,3.
    expect(first).toBeLessThanOrEqual(VANILLA_BALANCE.traffic.smoothing + 0.001);
  });
});

describe('zátěž silnic', () => {
  it('vzniká jen na silnicích a jen kde chodci šli', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 20, 10);
    placeBuilding(world, HOUSE, 10, 11);
    placeBuilding(world, SHOP, 20, 11);

    run(world, 4);

    let onRoads = 0;
    let offRoads = 0;
    for (let tile = 0; tile < world.trafficLoad.length; tile++) {
      const load = world.trafficLoad[tile] ?? 0;
      if (load === 0) continue;
      if ((world.layers.road[tile] ?? ROAD.none) === ROAD.none) offRoads += load;
      else onRoads += load;
    }

    expect(onRoads).toBeGreaterThan(0);
    expect(offRoads).toBe(0);
  });

  it('každý běh začíná od nuly, zátěž se nekumuluje donekonečna', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 20, 10);
    placeBuilding(world, HOUSE, 10, 11);
    placeBuilding(world, SHOP, 20, 11);

    run(world, 3);
    const after3 = [...world.trafficLoad].reduce((sum, value) => sum + value, 0);
    run(world, 3);
    const after6 = [...world.trafficLoad].reduce((sum, value) => sum + value, 0);

    // Zátěž jednoho běhu je omezená počtem pokusů a kroků, ne dobou hry.
    const ceiling =
      8 * VANILLA_BALANCE.traffic.attempts * VANILLA_BALANCE.traffic.maxSteps + 1;
    expect(after3).toBeLessThanOrEqual(ceiling);
    expect(after6).toBeLessThanOrEqual(ceiling);
  });

  it('zátěž nese váhu budovy, ne jen počet průchodů', () => {
    const light = createWorld(1, VANILLA_BALANCE.economy);
    street(light, 10, 16, 10);
    placeBuilding(light, HOUSE, 10, 11).population = 4;
    placeBuilding(light, SHOP, 16, 11);

    const heavy = createWorld(1, VANILLA_BALANCE.economy);
    street(heavy, 10, 16, 10);
    placeBuilding(heavy, HOUSE, 10, 11).population = 40;
    placeBuilding(heavy, SHOP, 16, 11);

    run(light, 2);
    run(heavy, 2);

    const sum = (world: WorldState) => [...world.trafficLoad].reduce((a, b) => a + b, 0);
    expect(sum(heavy)).toBeGreaterThan(sum(light));
  });
});

describe('vzorkování', () => {
  it('kurzor se posouvá a obchází budovy dokola', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 30, 10);
    for (let i = 0; i < 5; i++) placeBuilding(world, HOUSE, 10 + i * 2, 11);
    placeBuilding(world, SHOP, 30, 11);

    // Strop nižší než počet domů, aby se vzorek musel točit.
    const sampled = createTrafficSystem(CATALOGUE, {
      ...VANILLA_BALANCE,
      traffic: { ...VANILLA_BALANCE.traffic, maxBuildingsPerRun: 2 },
    });

    const cursors: number[] = [];
    for (let i = 0; i < 5; i++) {
      for (let tick = 0; tick < sampled.interval; tick++) tickWorld(world, [sampled]);
      cursors.push(world.trafficCursor);
    }

    expect(cursors).toEqual([2, 4, 1, 3, 0]);
    // Po pěti bězích se dostalo na všech pět domů.
    expect(world.jobAccess.size).toBe(5);
  });

  it('je deterministické — stejný seed dá stejnou zátěž', () => {
    const build = (): WorldState => {
      const world = createWorld(42, VANILLA_BALANCE.economy);
      street(world, 10, 24, 10);
      street(world, 17, 17, 10, );
      for (let i = 0; i < 4; i++) placeBuilding(world, HOUSE, 10 + i * 3, 11);
      placeBuilding(world, SHOP, 24, 11);
      run(world, 8);
      return world;
    };

    const a = build();
    const b = build();

    expect([...a.trafficLoad]).toEqual([...b.trafficLoad]);
    expect([...a.jobAccess.entries()]).toEqual([...b.jobAccess.entries()]);
    expect(a.trafficCursor).toBe(b.trafficCursor);
  });
});

describe('ruiny a prázdné domy', () => {
  it('opuštěný dům žádnou dopravu negeneruje', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 20, 10);
    const house = placeBuilding(world, HOUSE, 10, 11);
    house.abandoned = true;
    placeBuilding(world, SHOP, 20, 11);

    run(world, 3);

    expect([...world.trafficLoad].reduce((a, b) => a + b, 0)).toBe(0);
    expect(world.jobAccess.has(house.id)).toBe(false);
  });

  it('zbouraná budova zmizí i z dosažitelnosti', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 20, 10);
    const house = placeBuilding(world, HOUSE, 10, 11);
    placeBuilding(world, SHOP, 20, 11);
    run(world, 3);
    expect(world.jobAccess.has(house.id)).toBe(true);

    world.buildings.delete(house.id);
    world.layers.buildingId[index(10, 11)] = 0;
    world.jobAccess.delete(house.id);

    expect(world.jobAccess.has(house.id)).toBe(false);
  });
});

describe('dům dál od silnice', () => {
  it('taky se dostane do práce — růst ho staví až tři dlaždice od vozovky', () => {
    // Regrese z první zkoušky ve hře: doprava chtěla silnici hned vedle domu,
    // takže 17 z 32 domů mělo dosažitelnost práce nula napořád.
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 24, 10);
    // Dům dvě dlaždice od vozovky, přesně jak ho umí postavit růst.
    const house = placeBuilding(world, HOUSE, 12, 12);
    placeBuilding(world, SHOP, 24, 11);

    run(world, 6);

    expect(world.jobAccess.get(house.id) ?? 0).toBeGreaterThan(0);
  });

  it('dál než kam sahá růst už ne', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    street(world, 10, 24, 10);
    const house = placeBuilding(world, HOUSE, 12, 20);
    placeBuilding(world, SHOP, 24, 11);

    run(world, 6);

    expect(world.jobAccess.get(house.id) ?? 0).toBe(0);
  });
});
