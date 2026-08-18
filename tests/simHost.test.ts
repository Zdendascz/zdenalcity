import { describe, expect, it } from 'vitest';
import { createSimHost, MAX_TICKS_PER_FRAME, SPEEDS, TICK_MS } from '@/sim/simHost';
import { createDefaultSystems } from '@/sim/systems';
import type { System } from '@/sim/systems';
import { createWorld, markTileDirty, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { index } from '@/sim/layers';
import { VANILLA_BALANCE } from './support/balance';

/** Prázdný katalog — tyhle testy se obsahu netýkají. */
const NO_CONTENT = { get: () => undefined, byCategory: () => [] };

/** Systém, který si pamatuje, na kterých ticích běžel. */
function recorder(interval: number, offset: number): System & { ticks: number[] } {
  const ticks: number[] = [];
  return {
    name: 'test:recorder',
    interval,
    offset,
    ticks,
    run(world: WorldState) {
      ticks.push(world.tick);
    },
  };
}

describe('akumulátor', () => {
  it('step(1000) při 1× odsimuluje přesně 4 tiky', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.step(1000);
    expect(host.getSnapshot().tick).toBe(1000 / TICK_MS);
  });

  it('zbytek se přenáší mezi voláními', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.step(300); // 1 tick, zbývá 50 ms
    expect(host.getSnapshot().tick).toBe(1);
    host.step(200); // 50 + 200 = 250 → 1 tick
    expect(host.getSnapshot().tick).toBe(2);
  });

  it('pauza (rychlost 0) netiká', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.dispatch({ type: 'set_speed', speed: 0 });
    host.step(10_000);
    expect(host.getSnapshot().tick).toBe(0);
  });

  it('při 8× je jeden snímek zastropován na MAX_TICKS_PER_FRAME', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.dispatch({ type: 'set_speed', speed: 4 }); // index 4 = 8×
    host.step(1000); // 8000 ms herního času = 32 tiků, kdyby se nestropovalo
    expect(host.getSnapshot().tick).toBe(MAX_TICKS_PER_FRAME);
  });

  it('po zastropování se skluz zahodí, ne dohání', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.dispatch({ type: 'set_speed', speed: 4 });
    host.step(1000);
    host.dispatch({ type: 'set_speed', speed: 1 }); // 1×
    host.step(TICK_MS); // kdyby zbytek zůstal v akumulátoru, přijde víc než 1 tick
    expect(host.getSnapshot().tick).toBe(MAX_TICKS_PER_FRAME + 1);
  });

  it('ignoruje nesmyslný index rychlosti', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.dispatch({ type: 'set_speed', speed: SPEEDS.length }); // mimo rozsah
    host.step(1000);
    expect(host.getSnapshot().tick).toBe(4); // zůstala výchozí 1×
  });
});

describe('fázování systémů', () => {
  it('systém s interval 12, offset 2 běží na ticích 2, 14, 26…', () => {
    const system = recorder(12, 2);
    const world = createWorld(1);
    for (let i = 0; i < 30; i++) {
      tickWorld(world, [system]);
    }
    expect(system.ticks).toEqual([2, 14, 26]);
  });

  it('interval 1 běží každý tick', () => {
    const system = recorder(1, 0);
    const world = createWorld(1);
    for (let i = 0; i < 5; i++) {
      tickWorld(world, [system]);
    }
    expect(system.ticks).toEqual([1, 2, 3, 4, 5]);
  });

  it('registrované systémy mají intervaly a offsety podle architektury §5', () => {
    const systems = createDefaultSystems(NO_CONTENT, VANILLA_BALANCE);
    expect(systems.map((s) => [s.name, s.interval, s.offset])).toEqual([
      ['power', 1, 0],
      ['services', 1, 0],
      ['demand', 4, 1],
      ['growth', 12, 2],
      ['levels', 20, 9],
      ['economy', 30, 0],
      ['pollution', 8, 3],
      ['crime', 16, 11],
      ['health', 16, 13],
      ['landValue', 16, 5],
    ]);
  });
});

describe('dirty tracking', () => {
  it('čerstvý svět vyžaduje plné překreslení, po odebrání už ne', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);

    const first = host.consumeDirty();
    expect(first.fullRedraw).toBe(true);

    const second = host.consumeDirty();
    expect(second.fullRedraw).toBe(false);
    expect(second.tiles.size).toBe(0);
    expect(second.buildings.size).toBe(0);
  });

  it('změny ze systému se objeví v DirtySet a odebráním se vyprázdní', () => {
    const marker: System = {
      name: 'test:marker',
      interval: 1,
      offset: 0,
      run: (world) => markTileDirty(world, 3, 4),
    };
    const host = createSimHost(createWorld(1), [marker], NO_CONTENT);
    host.consumeDirty();

    host.step(TICK_MS);
    expect([...host.consumeDirty().tiles]).toEqual([index(3, 4)]);
    expect(host.consumeDirty().tiles.size).toBe(0);
  });
});

describe('snapshot', () => {
  it('je živý pohled, ne kopie', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    const snapshot = host.getSnapshot();
    host.step(1000);
    expect(snapshot.tick).toBe(4);
  });

  it('je typově read-only', () => {
    const snapshot = createSimHost(createWorld(1), [], NO_CONTENT).getSnapshot();
    // @ts-expect-error P1: renderer do simulace nezapisuje
    snapshot.layers.terrain[0] = 1;
    // @ts-expect-error P1: renderer do simulace nezapisuje
    snapshot.tick = 99;
  });
});
