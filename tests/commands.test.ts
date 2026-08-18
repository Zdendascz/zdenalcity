import { describe, expect, it } from 'vitest';
import { buildRoad, bulldoze } from '@/sim/commands';
import { index, MAP_SIZE, TERRAIN } from '@/sim/layers';
import { createSimHost } from '@/sim/simHost';
import { createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

/** Prázdný katalog — silnice ani zóny obsah nepotřebují. */
const NO_CONTENT = { get: () => undefined, byCategory: () => [] };

/** Čerstvý svět má `fullRedraw`, což by u testů dirty trackingu překáželo. */
function worldWithCleanDirty(): WorldState {
  const world = createWorld(1);
  world.dirty.tiles.clear();
  world.dirty.fullRedraw = false;
  return world;
}

function dirtyTiles(world: WorldState): number[] {
  return [...world.dirty.tiles].sort((a, b) => a - b);
}

describe('build_road', () => {
  it('zapíše silnici do vrstvy', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 10, 20);
    expect(world.layers.road[index(10, 20)]).toBe(1);
  });

  it('označí dlaždici i její čtyři sousedy jako dirty', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 10, 20);

    expect(dirtyTiles(world)).toEqual(
      [index(10, 20), index(10, 19), index(11, 20), index(10, 21), index(9, 20)].sort(
        (a, b) => a - b,
      ),
    );
  });

  it('u okraje mapy označí jen sousedy, kteří existují', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 0, 0);
    expect(dirtyTiles(world)).toEqual([index(0, 0), index(1, 0), index(0, 1)].sort((a, b) => a - b));
  });

  it('nestaví na vodu', () => {
    const world = worldWithCleanDirty();
    world.layers.terrain[index(5, 5)] = TERRAIN.water;

    buildRoad(world, 5, 5);

    expect(world.layers.road[index(5, 5)]).toBe(0);
    expect(dirtyTiles(world)).toEqual([]);
  });

  it('nestaví mimo mapu', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, -1, 10);
    buildRoad(world, 10, MAP_SIZE);
    expect(dirtyTiles(world)).toEqual([]);
  });

  it('opakovaná stavba na stejnou dlaždici je no-op', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 10, 20);
    world.dirty.tiles.clear();

    buildRoad(world, 10, 20);

    expect(dirtyTiles(world)).toEqual([]);
  });
});

describe('bulldoze', () => {
  it('odstraní silnici a přepočítá sousedy', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 10, 20);
    world.dirty.tiles.clear();

    bulldoze(world, 10, 20);

    expect(world.layers.road[index(10, 20)]).toBe(0);
    expect(dirtyTiles(world)).toHaveLength(5);
  });

  it('na prázdné dlaždici je no-op', () => {
    const world = worldWithCleanDirty();
    bulldoze(world, 10, 20);
    expect(dirtyTiles(world)).toEqual([]);
  });

  it('mimo mapu je no-op', () => {
    const world = worldWithCleanDirty();
    bulldoze(world, MAP_SIZE, 0);
    expect(dirtyTiles(world)).toEqual([]);
  });
});

describe('cesta přes SimHost.dispatch', () => {
  it('build_road a bulldoze projdou fasádou až do vrstvy', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);

    host.dispatch({ type: 'build_road', x: 3, y: 7 });
    expect(host.getSnapshot().layers.road[index(3, 7)]).toBe(1);

    host.dispatch({ type: 'bulldoze', x: 3, y: 7 });
    expect(host.getSnapshot().layers.road[index(3, 7)]).toBe(0);
  });

  it('změny se objeví v consumeDirty a pak se vyprázdní', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.consumeDirty(); // spolkni úvodní fullRedraw

    host.dispatch({ type: 'build_road', x: 3, y: 7 });

    expect(host.consumeDirty().tiles.size).toBe(5);
    expect(host.consumeDirty().tiles.size).toBe(0);
  });
});
