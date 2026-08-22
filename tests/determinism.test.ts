import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { hashCoarseLayers } from '@/sim/coarse';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { createDefaultSystems } from '@/sim/systems';
import { assumeWatered } from './support/water';
import { hashLayers, index, MAP_SIZE, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createWorld, markTileDirty, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import type { System } from '@/sim/systems';
import { createSimHost } from '@/sim/simHost';
import type { Command } from '@/sim/commands';

/**
 * Determinismus (P2): stejný seed + stejná posloupnost vstupů = bit-identický výsledek.
 *
 * V T1 žádný ostrý systém nic nemění, takže by test se samotnými `DEFAULT_SYSTEMS`
 * porovnával dvě netknuté mapy a prošel by i s rozbitým RNG. Proto se registruje
 * testovací systém, který mapu skutečně přepisuje přes `world.rng` — tím se ověří
 * to, co ověřit jde: RNG, plánovač systémů a pořadí vyhodnocení.
 */
const chaosSystem: System = {
  name: 'test:chaos',
  interval: 1,
  offset: 0,
  run(world: WorldState) {
    const x = world.rng.int(world.size);
    const y = world.rng.int(world.size);
    world.layers.terrain[index(x, y)] = world.rng.int(4);
    world.layers.road[index(x, y)] = world.rng.int(2);
    markTileDirty(world, x, y);
  },
};

const TICKS = 1000;

function runWorld(seed: number): WorldState {
  const world = createWorld(seed);
  for (let i = 0; i < TICKS; i++) {
    tickWorld(world, [chaosSystem]);
  }
  return world;
}

describe('determinismus simulace', () => {
  it('stejný seed a 1000 tiků → identické vrstvy i stav RNG', () => {
    const a = runWorld(483928492);
    const b = runWorld(483928492);

    expect(a.tick).toBe(TICKS);
    expect(b.tick).toBe(TICKS);
    expect(hashLayers(a.layers)).toBe(hashLayers(b.layers));
    expect(a.rng.getState()).toBe(b.rng.getState());
  });

  it('jiný seed → jiný výsledek (kontrolní případ)', () => {
    const a = runWorld(483928492);
    const b = runWorld(483928493);

    expect(hashLayers(a.layers)).not.toBe(hashLayers(b.layers));
    expect(a.rng.getState()).not.toBe(b.rng.getState());
  });

  it('stejná posloupnost příkazů přes SimHost → identické vrstvy', () => {
    // Rychlost mění počet odsimulovaných tiků na volání, takže tohle je zároveň
    // test, že cesta dispatch → step → tick je reprodukovatelná.
    const script: ReadonlyArray<Command | number> = [
      { type: 'set_speed', speed: 2 },
      1000,
      { type: 'set_speed', speed: 0 },
      5000,
      { type: 'set_speed', speed: 4 },
      1000,
      750,
      { type: 'set_speed', speed: 1 },
      2000,
    ];

    function play(seed: number): string {
      const host = createSimHost(createWorld(seed), [chaosSystem], {
        get: () => undefined,
        byCategory: () => [],
      });
      for (const entry of script) {
        if (typeof entry === 'number') host.step(entry);
        else host.dispatch(entry);
      }
      return hashLayers(host.getSnapshot().layers);
    }

    expect(play(1)).toBe(play(1));
    expect(play(1)).not.toBe(play(2));
  });
});

describe('determinismus celé sestavy (kritérium fáze 3)', () => {
  /**
   * Zadání fáze 3 chce „determinismus po 5000 tikách **včetně dopravy
   * a generátoru**". Test výš běží s umělým systémem, který jen míchá vrstvy —
   * to hlídá tikání a RNG, ne skutečnou hru.
   *
   * Tenhle vezme generovanou mapu a plnou sestavu systémů: poptávku, růst,
   * úrovně, difuzi, dopravu se vzorkováním, vodu i spokojenost. Doprava je
   * z nich nejcitlivější — vzorkuje náhodné cesty a nese si kurzor napříč
   * běhy, takže kdyby se pořadí kdekoli rozešlo, pozná se to tady.
   */
  const SEED = 20260822;
  const LONG_TICKS = 5000;

  async function cityRun(): Promise<string> {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const balance = content.getBalance();

    const world = createWorld(SEED, balance.economy);
    applyGeneratedMap(world, generateTerrain(SEED, balance));

    // Město se staví na místě s nejvíc stavitelnými dlaždicemi, ať test měří
    // determinismus a ne to, jestli seed náhodou trefil jezero.
    let best = { x: 8, y: 8, score: -1 };
    for (let y = 8; y < MAP_SIZE - 16; y += 2) {
      for (let x = 8; x < MAP_SIZE - 24; x += 2) {
        let score = 0;
        for (let dy = 0; dy < 10; dy++) {
          for (let dx = 0; dx < 20; dx++) {
            const terrain = world.layers.terrain[index(x + dx, y + dy)] ?? TERRAIN.water;
            if (terrain === TERRAIN.grass || terrain === TERRAIN.sand) score++;
          }
        }
        if (score > best.score) best = { x, y, score };
      }
    }

    const roadY = best.y + 4;
    for (let x = best.x; x < best.x + 20; x++) {
      buildRoad(world, x, roadY, ROAD.street, balance);
    }
    zoneArea(world, best.x, best.y, 20, 4, ZONE.residential);
    zoneArea(world, best.x, roadY + 1, 10, 4, ZONE.commercial);
    zoneArea(world, best.x + 10, roadY + 1, 10, 4, ZONE.industrial);
    placeDefinition(world, content, 'vanilla:coal_power_plant', best.x, best.y - 5, balance);

    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < LONG_TICKS; tick++) {
      tickWorld(world, systems);
      assumeWatered(world);
    }

    const buildings = [...world.buildings.values()]
      .sort((a, b) => a.id - b.id)
      .map((b) => `${b.id}:${b.definitionId}:${b.x},${b.y}:${b.level}:${b.population}:${b.jobs}`)
      .join('|');

    return [
      hashLayers(world.layers),
      hashCoarseLayers(world.coarse),
      world.rng.getState(),
      world.trafficCursor,
      world.economy.funds,
      buildings,
    ].join('/');
  }

  it('dva běhy 5000 tiků nad generovanou mapou dají identické město', { timeout: 120000 }, async () => {
    const a = await cityRun();
    const b = await cityRun();

    expect(a).toBe(b);
    // Kdyby se město nepostavilo, test by porovnával dvě prázdné mapy a prošel
    // by vždycky.
    expect(a.split('/').at(-1)?.length ?? 0).toBeGreaterThan(200);
  });
});
