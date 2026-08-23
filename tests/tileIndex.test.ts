import { describe, expect, it } from 'vitest';
import { buildRoad, bulldoze, zoneArea } from '@/sim/commands';
import { applySaveToWorld, unpackSave } from '@/save/deserialize';
import { serializeSave } from '@/save/serialize';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { coarseTerrainShare } from '@/sim/terrain';
import { waterProximity } from '@/sim/systems/landValue';
import {
  createWorld,
  markTerrainChanged,
  rebuildTileIndex,
  resizeWorld,
  setRoadTile,
  setZoneTile,
} from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

/**
 * Udržované seznamy a keše odvozené z terénu (R20 fáze 4).
 *
 * Od T45 si systémy nechodí pro silnice a zóny průchodem celé mapy, ale berou
 * je ze seznamu, který se udržuje při zápisu. Je to výhra: spokojenost spadla
 * z 8,9 ms na 0,3 ms a růst z 1,65 ms na 0,1 ms.
 *
 * A je to zároveň **nová možnost, jak to potichu rozbít**: kdo zapíše do
 * vrstvy mimo `setRoadTile` / `setZoneTile`, rozejde seznam s mapou a nic
 * nespadne — jen město přestane růst v místech, o kterých hra neví. Tenhle
 * soubor a golden test po tisíci tikách jsou to jediné, co takovou chybu
 * odhalí.
 */

/** Seznamy postavené znovu z vrstev. Nezávislé na tom, co se udržovalo cestou. */
function fromLayers(world: WorldState): { roads: number[]; zones: number[] } {
  const roads: number[] = [];
  const zones: number[] = [];
  for (let tile = 0; tile < world.layers.road.length; tile++) {
    if ((world.layers.road[tile] ?? 0) !== 0) roads.push(tile);
    if ((world.layers.zone[tile] ?? 0) !== 0) zones.push(tile);
  }
  return { roads, zones };
}

function sorted(set: ReadonlySet<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

function expectInSync(world: WorldState): void {
  const truth = fromLayers(world);
  expect(sorted(world.roadTiles)).toEqual(truth.roads);
  expect(sorted(world.zonedTiles)).toEqual(truth.zones);
}

describe('seznam silnic a zón', () => {
  it('zápis přes setter seznam doplní i vyprázdní', () => {
    const world = createWorld(1);
    const tile = index(10, 10, MAP_SIZE);

    setRoadTile(world, tile, ROAD.street);
    expect(world.roadTiles.has(tile)).toBe(true);

    setRoadTile(world, tile, ROAD.none);
    expect(world.roadTiles.has(tile)).toBe(false);

    setZoneTile(world, tile, ZONE.residential);
    expect(world.zonedTiles.has(tile)).toBe(true);
    setZoneTile(world, tile, ZONE.none);
    expect(world.zonedTiles.has(tile)).toBe(false);
  });

  it('stavba, zónování i bourání drží seznam v souladu s vrstvou', () => {
    const world = createWorld(1);
    world.economy.funds = 100000;

    for (let x = 5; x < 25; x++) buildRoad(world, x, 5, ROAD.street, VANILLA_BALANCE);
    zoneArea(world, 5, 6, 20, 4, ZONE.residential);
    expectInSync(world);

    bulldoze(world, 10, 5, VANILLA_BALANCE); // silnice
    bulldoze(world, 10, 6, VANILLA_BALANCE); // zóna
    expectInSync(world);

    // Přezónování z obytné na průmyslovou nesmí dlaždici ze seznamu vyhodit.
    zoneArea(world, 5, 6, 20, 4, ZONE.industrial);
    expectInSync(world);
    expect(world.zonedTiles.size).toBeGreaterThan(0);

    // A odzónování ano.
    zoneArea(world, 5, 6, 20, 4, ZONE.none);
    expectInSync(world);
  });

  it('načtení savu seznam postaví znovu z vrstev', () => {
    // Seznamy se neukládají (R10). Kdyby se po loadu nepostavily, načtené
    // město by se tvářilo, že v něm není ani silnice — a nic by nevyrostlo.
    const world = createWorld(3);
    world.economy.funds = 100000;
    for (let x = 5; x < 15; x++) buildRoad(world, x, 5, ROAD.street, VANILLA_BALANCE);
    zoneArea(world, 5, 6, 10, 3, ZONE.commercial);

    const bytes = serializeSave(world, {
      cityName: 'Seznam',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      playtimeSeconds: 0,
      sources: [],
    });

    const loaded = createWorld(0);
    // Cizí obsah seznamu z předchozího města nesmí přetéct do načteného.
    setRoadTile(loaded, index(100, 100, MAP_SIZE), ROAD.highway);
    applySaveToWorld(loaded, unpackSave(bytes));

    expectInSync(loaded);
    expect(sorted(loaded.roadTiles)).toEqual(sorted(world.roadTiles));
    expect(sorted(loaded.zonedTiles)).toEqual(sorted(world.zonedTiles));
  });

  it('přestavba světa na jinou velikost seznamy vyprázdní', () => {
    const world = createWorld(1, undefined, 128);
    setRoadTile(world, index(10, 10, 128), ROAD.street);
    setZoneTile(world, index(11, 10, 128), ZONE.residential);

    resizeWorld(world, 192);
    // Indexy patřily staré mřížce; v nové ukazují někam jinam.
    expect(world.roadTiles.size).toBe(0);
    expect(world.zonedTiles.size).toBe(0);
  });

  it('rebuildTileIndex je čistá obnova, ne přírůstek', () => {
    const world = createWorld(1);
    world.layers.road[index(3, 3, MAP_SIZE)] = ROAD.street;
    world.roadTiles.add(index(90, 90, MAP_SIZE)); // smyšlený záznam

    rebuildTileIndex(world);
    expectInSync(world);
  });
});

describe('keše odvozené z terénu', () => {
  it('podruhé se nepočítají znovu', () => {
    const world = createWorld(5);
    applyGeneratedMap(world, generateTerrain(5, VANILLA_BALANCE, MAP_SIZE));

    const water = waterProximity(world);
    expect(waterProximity(world)).toBe(water);

    const forest = coarseTerrainShare(world, TERRAIN.forest);
    expect(coarseTerrainShare(world, TERRAIN.forest)).toBe(forest);
    // Jiný terén má vlastní záznam, ne přepsaný ten první.
    expect(coarseTerrainShare(world, TERRAIN.sand)).not.toBe(forest);
  });

  it('změna terénu je zahodí', () => {
    const world = createWorld(5);
    applyGeneratedMap(world, generateTerrain(5, VANILLA_BALANCE, MAP_SIZE));

    const water = waterProximity(world);
    coarseTerrainShare(world, TERRAIN.forest);

    markTerrainChanged(world);
    expect(world.waterNear).toBeNull();
    expect(world.terrainShares.size).toBe(0);
    expect(waterProximity(world)).not.toBe(water);
  });

  it('vykácení lesa se v podílech projeví', () => {
    // Tohle je ta chyba, kterou by keš bez zneplatnění udělala: hráč vykácí
    // les, cena půdy okolo má klesnout — a nestalo by se nic, protože podíl
    // lesa by zůstal viset na hodnotě z doby, kdy tam ještě stál.
    const world = createWorld(7);
    world.economy.funds = 100000;
    world.layers.terrain.fill(TERRAIN.forest);
    markTerrainChanged(world);

    const before = coarseTerrainShare(world, TERRAIN.forest);
    const cell = 0;
    expect(before[cell]).toBeCloseTo(1);

    bulldoze(world, 0, 0, VANILLA_BALANCE); // vykácí les
    const after = coarseTerrainShare(world, TERRAIN.forest);
    expect(after[cell]).toBeLessThan(before[cell] ?? 0);
  });

  it('nová mapa zahodí, co se počítalo z té staré', () => {
    const world = createWorld(9);
    world.layers.terrain.fill(TERRAIN.water);
    markTerrainChanged(world);
    const allWater = waterProximity(world);
    expect(allWater[0]).toBe(1);

    applyGeneratedMap(world, generateTerrain(9, VANILLA_BALANCE, MAP_SIZE));
    expect(world.waterNear).toBeNull();
  });
});
