import { describe, expect, it } from 'vitest';
import { hashLayers, index } from '@/sim/layers';
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
