import { beforeAll, describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { ownedTiles, placeBuilding } from '@/sim/buildings';
import { destroyInfrastructure, destroyTile, noLosses } from '@/sim/disasters/damage';
import {
  clearModifiersOf,
  contaminateWater,
  expireModifiers,
  floodArea,
  suppressService,
} from '@/sim/disasters/effects';
import { createFloodSystem, drainTile, floodTile } from '@/sim/disasters/flood';
import { hasRubble } from '@/sim/disasters/rubble';
import { coarseIndex } from '@/sim/coarse';
import { index, ROAD, WIRE } from '@/sim/layers';
import { tryDowngrade } from '@/sim/levels';
import { createWorld, setRoadTile } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

/**
 * Katastrofy a úrovně po auditu T132 (nálezy 3, 4, 5 a 8).
 *
 * Elektřina, vodovod a pokrytí se přepočítávají **jen při změně**. Každé místo,
 * které mění to, na co se ptají, je proto musí označit za špinavé — jinak
 * město žije se starým stavem, dokud hráč náhodou nesáhne na síť, a po
 * načtení savu (kde se přepočítá vždy) se chová jinak než bez něj.
 */

let content: ContentRegistry;
beforeAll(async () => {
  content = new ContentRegistry();
  await content.load(createVanillaSource());
});

function clean(world: WorldState): void {
  world.powerNetworkDirty = false;
  world.waterNetworkDirty = false;
  world.coverageDirty = false;
}

describe('konec postihu přepočítá, co postih ovlivňoval (nález 3)', () => {
  const area = { kind: 'radius' as const, x: 20, y: 20, radius: 4 };

  it('vypršelé zamoření vody přepočítá vodovod', () => {
    const world = createWorld(1);
    contaminateWater(world, area, 1, 10);
    clean(world);

    world.tick = 5;
    expireModifiers(world);
    expect(world.waterNetworkDirty).toBe(false); // ještě platí

    world.tick = 10;
    expireModifiers(world);
    expect(world.disasters.modifiers).toHaveLength(0);
    expect(world.waterNetworkDirty).toBe(true);
  });

  it('vypršelé potlačení služby přepočítá pokrytí', () => {
    const world = createWorld(1);
    suppressService(world, 'fire', area, 0.5, 10);
    clean(world);

    world.tick = 10;
    expireModifiers(world);
    expect(world.coverageDirty).toBe(true);
  });

  it('i předčasně zrušený postih skončené katastrofy', () => {
    const world = createWorld(1);
    contaminateWater(world, area, 1, 1000, 7);
    suppressService(world, 'police', area, 0.5, 1000, 7);
    clean(world);

    clearModifiersOf(world, 7);
    expect(world.disasters.modifiers).toHaveLength(0);
    expect(world.waterNetworkDirty).toBe(true);
    expect(world.coverageDirty).toBe(true);
  });

  it('postih, který zůstává, nic nešpiní', () => {
    const world = createWorld(1);
    contaminateWater(world, area, 1, 1000, 7);
    clean(world);

    clearModifiersOf(world, 8);
    expireModifiers(world);
    expect(world.waterNetworkDirty).toBe(false);
    expect(world.coverageDirty).toBe(false);
  });
});

describe('zaplavení a opadnutí přepočítá sítě (nález 4)', () => {
  it('suchá dlaždice pod vodou a zase suchá', () => {
    const world = createWorld(1);
    const tile = index(10, 10, world.size);
    clean(world);

    expect(floodTile(world, tile, 1, 20)).toBe(true);
    expect(world.powerNetworkDirty).toBe(true);
    expect(world.waterNetworkDirty).toBe(true);

    // Hlubší voda na už mokré dlaždici sítě nemění — vede tak jako tak.
    clean(world);
    expect(floodTile(world, tile, 3, 30)).toBe(true);
    expect(world.powerNetworkDirty).toBe(false);

    drainTile(world, tile);
    expect(world.powerNetworkDirty).toBe(true);
    expect(world.waterNetworkDirty).toBe(true);
  });

  it('zaplavení přes efekt katastrofy taky', () => {
    const world = createWorld(1);
    clean(world);
    floodArea(world, { kind: 'radius', x: 10, y: 10, radius: 1 }, 5);
    expect(world.powerNetworkDirty).toBe(true);
    expect(world.waterNetworkDirty).toBe(true);
  });

  it('opadnutí se zbytkem pod půl tiku vysuší dlaždici celou', () => {
    // Zbytek 0,4 se do T132 zaokrouhlil na nulu mimo `drainTile`: dlaždice
    // byla suchá, ale hloubka na ní zůstala a sítě se nepřepočítaly.
    const world = createWorld(1);
    const tile = index(10, 10, world.size);
    world.flood[tile] = 2;
    world.floodDepth[tile] = 1;
    const cells = new Uint8Array(world.happiness.length);
    // 1 + 15 × 0,04 = 1,6 odteče za tik, zbude 0,4.
    cells[coarseIndex(10, 10, world.size)] = 15;
    world.coverage.set('fire', cells);
    clean(world);

    createFloodSystem(content, VANILLA_BALANCE).run(world);
    expect(world.flood[tile]).toBe(0);
    expect(world.floodDepth[tile]).toBe(0);
    expect(world.powerNetworkDirty).toBe(true);
  });
});

describe('katastrofa bere i vedení (nález 5)', () => {
  it('samotné vedení se zničí a nechá trosky', () => {
    const world = createWorld(1);
    const tile = index(10, 10, world.size);
    world.layers.wire[tile] = WIRE.high;
    clean(world);

    const losses = noLosses();
    destroyInfrastructure(world, tile, losses);
    expect(world.layers.wire[tile]).toBe(WIRE.none);
    expect(hasRubble(world, tile)).toBe(true);
    expect(world.powerNetworkDirty).toBe(true);
    expect(losses.infrastructure).toBe(1);
  });

  it('vedení přes silnici padne spolu se silnicí', () => {
    const world = createWorld(1);
    const tile = index(10, 10, world.size);
    setRoadTile(world, tile, ROAD.street);
    world.layers.wire[tile] = WIRE.low;

    destroyTile(world, content, tile, noLosses());
    expect(world.layers.road[tile]).toBe(ROAD.none);
    expect(world.layers.wire[tile]).toBe(WIRE.none);
  });
});

/**
 * Budova z doby, kdy byla její definice menší: drží méně dlaždic, než dnes
 * říká obsah. Přesně tak vypadají staré uhelné elektrárny 4 × 4 (dnes 5 × 5).
 */
function shrunkBuilding(world: WorldState, definitionId: string, x: number, y: number, keep: number) {
  const definition = content.get(definitionId)!;
  const building = placeBuilding(world, definition, x, y);
  const [width, depth] = definition.footprint;
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (dx < keep && dy < keep) continue;
      world.layers.buildingId[index(x + dx, y + dy, world.size)] = 0;
    }
  }
  return building;
}

describe('trosky a úrovně podle skutečných dlaždic (nález 8)', () => {
  it('stará elektrárna nechá trosky jen na svých dlaždicích, ne u souseda', () => {
    const world = createWorld(1);
    const plant = shrunkBuilding(world, 'vanilla:coal_power_plant', 10, 10, 4);
    const park = placeBuilding(world, content.get('vanilla:park_small')!, 14, 10);
    expect(ownedTiles(world, plant, [5, 5])).toHaveLength(16);

    destroyTile(world, content, index(10, 10, world.size), noLosses());

    let rubble = 0;
    for (let tile = 0; tile < world.rubble.length; tile++) if (hasRubble(world, tile)) rubble++;
    expect(rubble).toBe(16);
    // Park vedle zůstal stát a bez trosek.
    expect(world.buildings.has(park.id)).toBe(true);
    expect(hasRubble(world, index(14, 10, world.size))).toBe(false);
  });

  it('snížení úrovně nesmaže kus sousední budovy', () => {
    const world = createWorld(1);
    // Dvorní dům 2 × 2 (úroveň 2), který drží jen jednu dlaždici…
    const court = shrunkBuilding(world, 'vanilla:residential_court', 10, 10, 1);
    // …a na té vedlejší už stojí soused.
    const neighbour = placeBuilding(world, content.get('vanilla:residential_small')!, 11, 10);

    expect(tryDowngrade(world, content, court)).toBe(true);
    expect(court.level).toBe(1);
    expect(world.layers.buildingId[index(11, 10, world.size)]).toBe(neighbour.id);
    expect(world.layers.buildingId[index(10, 10, world.size)]).toBe(court.id);
    // Scvrklá budova se vešla do toho, co držela.
    expect(ownedTiles(world, court, content.get(court.definitionId)!.footprint)).toHaveLength(1);
  });

  it('u okraje mapy se nesahá mimo ni', () => {
    const world = createWorld(1);
    const edge = world.size - 3;
    const plant = shrunkBuilding(world, 'vanilla:coal_power_plant', edge, edge, 3);
    expect(ownedTiles(world, plant, [5, 5])).toHaveLength(9);
    destroyTile(world, content, index(edge, edge, world.size), noLosses());
    expect(world.buildings.has(plant.id)).toBe(false);
  });
});
