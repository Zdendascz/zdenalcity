import { describe, expect, it } from 'vitest';
import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, bulldoze, placeDefinition, zoneArea } from '@/sim/commands';
import { index, TERRAIN, ZONE } from '@/sim/layers';
import { createSimHost } from '@/sim/simHost';
import { createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { MAP_SIZE } from './support/grid';

/** Prázdný katalog — silnice ani zóny obsah nepotřebují. */
const NO_CONTENT = { get: () => undefined, byCategory: () => [] };

const TOWER: Definition = {
  id: 'test:tower',
  type: 'building',
  category: 'utility',
  name: 'building.tower.name',
  description: 'building.tower.desc',
  footprint: [2, 2],
  level: 1,
  construction: { cost: 500, requiresRoad: true, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 20 },
  graphics: { color: '#5a5a62', heightLevels: 2 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

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
    expect(world.layers.road[index(10, 20, MAP_SIZE)]).toBe(1);
  });

  it('označí dlaždici i její čtyři sousedy jako dirty', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 10, 20);

    expect(dirtyTiles(world)).toEqual(
      [
        index(10, 20, MAP_SIZE),
        index(10, 19, MAP_SIZE),
        index(11, 20, MAP_SIZE),
        index(10, 21, MAP_SIZE),
        index(9, 20, MAP_SIZE),
      ].sort((a, b) => a - b),
    );
  });

  it('u okraje mapy označí jen sousedy, kteří existují', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 0, 0);
    expect(dirtyTiles(world)).toEqual(
      [
        index(0, 0, MAP_SIZE),
        index(1, 0, MAP_SIZE),
        index(0, 1, MAP_SIZE),
      ].sort((a, b) => a - b),
    );
  });

  it('nestaví na vodu', () => {
    const world = worldWithCleanDirty();
    world.layers.terrain[index(5, 5, MAP_SIZE)] = TERRAIN.water;

    buildRoad(world, 5, 5);

    expect(world.layers.road[index(5, 5, MAP_SIZE)]).toBe(0);
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

    expect(world.layers.road[index(10, 20, MAP_SIZE)]).toBe(0);
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

describe('odmítnutí říká proč', () => {
  it('silnice na vodu, mimo mapu a na obsazenou dlaždici', () => {
    const world = worldWithCleanDirty();
    world.layers.terrain[index(5, 5, MAP_SIZE)] = TERRAIN.water;
    world.layers.buildingId[index(6, 5, MAP_SIZE)] = 7;

    // Od T33 je vozovka na vodě most, ale musí začínat na břehu — uprostřed
    // moře se stavět nedá.
    expect(buildRoad(world, 5, 5)).toEqual({ ok: false, reason: 'error.bridgeNeedsBank' });
    expect(buildRoad(world, -1, 0)).toEqual({ ok: false, reason: 'error.outOfBounds' });
    expect(buildRoad(world, 6, 5)).toEqual({ ok: false, reason: 'error.occupied' });

    expect(buildRoad(world, 8, 8)).toEqual({ ok: true });
    expect(buildRoad(world, 8, 8)).toEqual({ ok: false, reason: 'error.roadExists' });
  });

  it('bourání prázdné dlaždice', () => {
    const world = worldWithCleanDirty();
    expect(bulldoze(world, 3, 3)).toEqual({ ok: false, reason: 'error.nothingToBulldoze' });
  });

  it('zóna, ze které neprojde ani jedna dlaždice', () => {
    const world = worldWithCleanDirty();
    world.layers.terrain[index(4, 4, MAP_SIZE)] = TERRAIN.water;

    expect(zoneArea(world, 4, 4, 1, 1, ZONE.residential)).toEqual({
      ok: false,
      reason: 'error.water',
    });
    // Stačí jedna použitelná dlaždice a příkaz je úspěšný.
    expect(zoneArea(world, 4, 4, 2, 1, ZONE.residential)).toEqual({ ok: true });
  });

  it('stavba bez peněz řekne kolik chybí', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 5, 5);
    world.economy.funds = 10;

    const result = placeDefinition(world, catalogueOf(TOWER), 'test:tower', 5, 6);

    expect(result).toEqual({
      ok: false,
      reason: 'error.notEnoughFunds',
      params: { cost: 500, funds: 10 },
    });
  });

  it('stavba bez silnice a na neznámou definici', () => {
    const world = worldWithCleanDirty();
    const catalogue = catalogueOf(TOWER);

    // Daleko od všeho: hláška to musí říct, ne jen zopakovat pravidlo.
    expect(placeDefinition(world, catalogue, 'test:tower', 40, 40)).toEqual({
      ok: false,
      reason: 'error.needsRoadFar',
    });
    expect(placeDefinition(world, catalogue, 'test:nic', 5, 5)).toEqual({
      ok: false,
      reason: 'error.unknownDefinition',
      params: { id: 'test:nic' },
    });
  });

  it('u silnice o kus dál řekne, o kolik dlaždic', () => {
    // Rozdíl proti `error.needsRoadFar`: tohle je rada „posuň se", ne
    // „postav cestu". Autor si vyžádal, aby odmítnutí říkalo i proč a co s tím.
    const world = worldWithCleanDirty();
    buildRoad(world, 5, 5);

    expect(placeDefinition(world, catalogueOf(TOWER), 'test:tower', 8, 5)).toEqual({
      ok: false,
      reason: 'error.needsRoad',
      params: { distance: 3 },
    });
  });

  it('obsazený footprint hlásí i potřebnou velikost', () => {
    const world = worldWithCleanDirty();
    buildRoad(world, 5, 5);
    world.layers.buildingId[index(6, 7, MAP_SIZE)] = 9;

    expect(placeDefinition(world, catalogueOf(TOWER), 'test:tower', 5, 6)).toEqual({
      ok: false,
      reason: 'error.occupiedFootprint',
      params: { width: 2, depth: 2 },
    });
  });
});

describe('cesta přes SimHost.dispatch', () => {
  it('build_road a bulldoze projdou fasádou až do vrstvy', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);

    host.dispatch({ type: 'build_road', x: 3, y: 7 });
    expect(host.getSnapshot().layers.road[index(3, 7, MAP_SIZE)]).toBe(1);

    host.dispatch({ type: 'bulldoze', x: 3, y: 7 });
    expect(host.getSnapshot().layers.road[index(3, 7, MAP_SIZE)]).toBe(0);
  });

  it('změny se objeví v consumeDirty a pak se vyprázdní', () => {
    const host = createSimHost(createWorld(1), [], NO_CONTENT);
    host.consumeDirty(); // spolkni úvodní fullRedraw

    host.dispatch({ type: 'build_road', x: 3, y: 7 });

    expect(host.consumeDirty().tiles.size).toBe(5);
    expect(host.consumeDirty().tiles.size).toBe(0);
  });
});
