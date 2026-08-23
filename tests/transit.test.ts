import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { buildRoad, placeDefinition } from '@/sim/commands';
import { index, ROAD } from '@/sim/layers';
import { presentDefinitions } from '@/sim/requirements';
import { createServiceSystem, createTrafficSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

const STOP = 'vanilla:transit_stop';
const DEPOT = 'vanilla:transit_depot';

/** Ulice s domem u ní a prací na druhém konci — nejmenší město, kde jezdí auta. */
function street(content: ContentRegistry, world: WorldState): void {
  const balance = content.getBalance();
  world.economy.funds = 100000;
  for (let x = 10; x <= 30; x++) buildRoad(world, x, 10, ROAD.street, balance);

  const house = content.get('vanilla:residential_small');
  const shop = content.get('vanilla:commercial_small');
  if (!house || !shop) throw new Error('chybí vanilla obsah');

  const built = placeBuilding(world, house, 11, 11);
  built.population = 8;
  placeBuilding(world, shop, 29, 11);
}

/** Celková zátěž na ulici po ustálení. */
function roadLoad(world: WorldState): number {
  let total = 0;
  for (let x = 10; x <= 30; x++)
    total += world.trafficLoad[index(x, 10, world.size)] ?? 0;
  return total;
}

describe('MHD ubírá dopravu (§6)', () => {
  it('zastávka v obytné čtvrti sníží zátěž na okolních silnicích', async () => {
    const content = await vanilla();
    const balance = content.getBalance();

    const measure = (withStop: boolean): number => {
      const world = createWorld(1, balance.economy);
      street(content, world);
      if (withStop) {
        expect(placeDefinition(world, content, DEPOT, 20, 11).ok).toBe(true);
        expect(placeDefinition(world, content, STOP, 12, 11).ok).toBe(true);
      }
      const systems = [createServiceSystem(content), createTrafficSystem(content, balance)];
      for (let tick = 0; tick < 40; tick++) tickWorld(world, systems);
      return roadLoad(world);
    };

    const without = measure(false);
    const withStop = measure(true);

    expect(without).toBeGreaterThan(0);
    expect(withStop).toBeLessThan(without);
  });

  it('plné pokrytí ubere přesně tolik, kolik říká balanc', async () => {
    const content = await vanilla();
    const balance = content.getBalance();

    // Dva světy se stejným seedem: chodci jdou krok za krokem stejně, takže
    // rozdíl v zátěži je čistě ten násobitel a nic jiného.
    const measure = (covered: boolean): number => {
      const world = createWorld(1, balance.economy);
      street(content, world);
      // Pokrytí naplno, bez ohledu na to, kolik zastávek by na to bylo třeba.
      if (covered) world.coverage.set('transit', new Uint8Array(32 * 32).fill(255));
      const systems = [createTrafficSystem(content, balance)];
      for (let tick = 0; tick < 16; tick++) tickWorld(world, systems);
      return roadLoad(world);
    };

    const bare = measure(false);
    const served = measure(true);

    expect(bare).toBeGreaterThan(0);
    expect(served / bare).toBeCloseTo(1 - balance.traffic.transitReduction, 5);
    expect(served).toBeGreaterThan(0); // ubírá, neruší
  });

  it('nesahá na dosažitelnost práce — jen na zátěž', async () => {
    // Kdyby zastávka zvedala i jobAccess, dala by se jí obejít nutnost stavět
    // silnice. MHD v tomhle modelu jen přesouvá lidi z aut, nic nezkracuje.
    const content = await vanilla();
    const balance = content.getBalance();

    const measure = (covered: boolean): number => {
      const world = createWorld(1, balance.economy);
      street(content, world);
      if (covered) world.coverage.set('transit', new Uint8Array(32 * 32).fill(255));
      const systems = [createTrafficSystem(content, balance)];
      for (let tick = 0; tick < 40; tick++) tickWorld(world, systems);
      return [...world.jobAccess.values()].reduce((sum, value) => sum + value, 0);
    };

    expect(measure(true)).toBeCloseTo(measure(false), 5);
  });
});

describe('vozovna jako prerekvizita (§6)', () => {
  it('zastávka bez vozovny se nepostaví, s vozovnou ano', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 100000;
    for (let x = 10; x <= 30; x++) buildRoad(world, x, 10, ROAD.street, balance);

    const refused = placeDefinition(world, content, STOP, 12, 11);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.reason).toBe('error.requiresBuilding');

    expect(placeDefinition(world, content, DEPOT, 20, 11).ok).toBe(true);
    expect(placeDefinition(world, content, STOP, 12, 11).ok).toBe(true);
  });

  it('vypálená vozovna zastávku neodemyká', async () => {
    // Prerekvizita čte jen budovy, které opravdu jedou — ruina nic neposkytuje.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 100000;
    for (let x = 10; x <= 30; x++) buildRoad(world, x, 10, ROAD.street, balance);

    const depot = placeDefinition(world, content, DEPOT, 20, 11);
    expect(depot.ok).toBe(true);
    for (const building of world.buildings.values()) building.abandoned = true;

    expect(presentDefinitions(world).has(DEPOT)).toBe(false);
    expect(placeDefinition(world, content, STOP, 12, 11).ok).toBe(false);
  });

  it('vozovna sama nic nepokrývá — je to podmínka, ne služba', async () => {
    const content = await vanilla();
    expect(content.get(DEPOT)?.service).toBeUndefined();
    expect(content.get(STOP)?.service?.class).toBe('transit');
    expect(content.get(STOP)?.requirements?.buildings).toContain(DEPOT);
  });
});
