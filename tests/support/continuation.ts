import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Balance } from '@/content/balance';
import {
  addTransitStop,
  buildPipe,
  buildRoad,
  buildWire,
  createTransitLine,
  placeDefinition,
  setLineVehicles,
  zoneArea,
} from '@/sim/commands';
import type { CommandResult } from '@/sim/result';
import { hashCoarseLayers } from '@/sim/coarse';
import { hashLayers, index, ROAD, TERRAIN, WIRE, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import type { System } from '@/sim/systems';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { createFireDisaster, createWildfireDisaster } from '@/sim/disasters/fire';
import { createFloodDisaster } from '@/sim/disasters/flood';
import { createTornadoDisaster } from '@/sim/disasters/tornado';
import { createEarthquakeDisaster } from '@/sim/disasters/earthquake';
import { createExplosionDisaster, createIndustrialAccidentDisaster } from '@/sim/disasters/blast';
import { createPileupDisaster } from '@/sim/disasters/pileup';
import { createStrikeDisaster } from '@/sim/disasters/strike';
import { createRiotDisaster } from '@/sim/disasters/riot';
import { createGangWarDisaster } from '@/sim/disasters/gangWar';
import { createBlackoutDisaster } from '@/sim/disasters/blackout';
import { createEpidemicDisaster } from '@/sim/disasters/epidemic';
import { createChemicalSpillDisaster } from '@/sim/disasters/chemicalSpill';
import { createLandslideDisaster } from '@/sim/disasters/landslide';
import { createWorld, markTerrainChanged } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { applySaveToWorld, unpackSave } from '@/save/deserialize';
import { serializeSave } from '@/save/serialize';
import { migrate } from '@/save/migrations';

/**
 * Opravdové malé město pro test „ulož, načti, hraj dál" (T132).
 *
 * Vodárna, elektrárna, policie, hasiči, linka s vozidly, vedení a potrubí přes
 * ulice — a zóny vyznačené schválně **na přeskáčku**, aby se pořadí příkazů
 * lišilo od pořadí dlaždic.
 */

export interface CitySetup {
  content: ContentRegistry;
  balance: Balance;
}

export async function loadCityContent(): Promise<CitySetup> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return { content, balance: content.getBalance() };
}

/** Všechny pohromy jako ve hře — ať se ukládá i jejich stav a postihy. */
function disasterRegistry(): DisasterRegistry {
  const registry = new DisasterRegistry();
  registry.register(createFireDisaster());
  registry.register(createWildfireDisaster());
  registry.register(createFloodDisaster());
  registry.register(createTornadoDisaster());
  registry.register(createEarthquakeDisaster());
  registry.register(createExplosionDisaster());
  registry.register(createIndustrialAccidentDisaster());
  registry.register(createPileupDisaster());
  registry.register(createStrikeDisaster());
  registry.register(createRiotDisaster());
  registry.register(createGangWarDisaster());
  registry.register(createBlackoutDisaster());
  registry.register(createEpidemicDisaster());
  registry.register(createChemicalSpillDisaster());
  registry.register(createLandslideDisaster());
  return registry;
}

export function citySystems({ content, balance }: CitySetup): System[] {
  return createDefaultSystems(content, balance, disasterRegistry());
}

function must(result: CommandResult, what: string): void {
  if (!result.ok) throw new Error(`${what}: ${result.reason}`);
}

export function buildTestCity({ content, balance }: CitySetup, seed = 777): WorldState {
  const world = createWorld(seed, balance.economy);
  world.economy.funds = 400000;

  // Jezero pro vodárnu.
  for (let y = 10; y < 40; y++) {
    for (let x = 8; x < 14; x++) world.layers.terrain[index(x, y, world.size)] = TERRAIN.water;
  }
  markTerrainChanged(world);

  for (let x = 14; x < 70; x++) {
    buildRoad(world, x, 15, ROAD.street, balance);
    buildRoad(world, x, 26, ROAD.street, balance);
  }
  for (let y = 16; y < 26; y++) buildRoad(world, 40, y, ROAD.street, balance);

  const place = (id: string, x: number, y: number): void => {
    must(placeDefinition(world, content, id, x, y, balance), id);
  };
  place('vanilla:water_works', 14, 16);
  place('vanilla:coal_power_plant', 17, 16);
  place('vanilla:police_small', 22, 16);
  place('vanilla:fire_station', 24, 16);
  place('vanilla:transit_depot', 30, 12);

  // Zóny **na přeskáčku**: pořadí příkazů se liší od pořadí dlaždic. Bez
  // toho by test prošel i s růstem, který bere kandidáty v pořadí vložení.
  // Každý blok mezi ulicemi je souvislý, takže vede proud i vodu sám (T129).
  zoneArea(world, 50, 16, 20, 10, ZONE.residential);
  zoneArea(world, 17, 21, 23, 5, ZONE.industrial);
  zoneArea(world, 41, 16, 9, 10, ZONE.commercial);
  zoneArea(world, 22, 18, 5, 3, ZONE.commercial);
  zoneArea(world, 26, 16, 14, 5, ZONE.residential);
  zoneArea(world, 14, 27, 50, 6, ZONE.residential);

  // Spojky mezi bloky přes ulice: vedení i potrubí.
  for (const [x, y] of [
    [40, 20],
    [30, 26],
  ] as const) {
    must(buildWire(world, x, y, WIRE.low, balance), 'wire');
    must(buildPipe(world, x, y, balance), 'pipe');
  }

  // Linka se dvěma zastávkami a vozidly — ať se ukládá i statistika přepravy.
  place('vanilla:transit_stop', 44, 14);
  place('vanilla:transit_stop', 66, 14);
  must(createTransitLine(world, balance, 'bus'), 'line');
  const line = world.lines.at(-1)!;
  const stops = [...world.buildings.values()]
    .filter((b) => b.definitionId === 'vanilla:transit_stop')
    .map((b) => b.id);
  for (const id of stops) must(addTransitStop(world, content, balance, line.id, id), 'stop');
  must(setLineVehicles(world, balance, line.id, 3), 'vehicles');
  return world;
}

/** Uloží a načte do **cizího** světa jiného seedu — tak, jak to dělá start hry. */
export function reloadWorld(world: WorldState): WorldState {
  const bytes = serializeSave(world, {
    cityName: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    playtimeSeconds: 0,
    sources: [],
  });
  const fresh = createWorld(1);
  applySaveToWorld(fresh, migrate(unpackSave(bytes)));
  return fresh;
}

export function cityFingerprint(world: WorldState): Record<string, unknown> {
  return {
    tick: world.tick,
    layers: hashLayers(world.layers),
    coarse: hashCoarseLayers(world.coarse),
    rng: world.rng.getState(),
    funds: world.economy.funds,
    demand: { ...world.demand },
    trafficCursor: world.trafficCursor,
    happiness: Array.from(world.happiness).join(','),
    buildings: [...world.buildings.values()]
      .sort((a, b) => a.id - b.id)
      .map(
        (b) =>
          `${b.id}:${b.definitionId}:${b.x},${b.y}:${b.level}:${b.population}:${b.jobs}:${b.powered ? 1 : 0}:${b.abandoned ? 1 : 0}`,
      )
      .join('|'),
  };
}
