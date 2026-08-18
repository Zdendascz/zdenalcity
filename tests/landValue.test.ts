import { describe, expect, it } from 'vitest';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { COARSE_FACTOR, coarseIndex, hashCoarseLayers } from '@/sim/coarse';
import { index, TERRAIN } from '@/sim/layers';
import { createLandValueSystem, createPollutionSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

const FACTORY: Definition = {
  id: 'test:factory',
  type: 'building',
  category: 'industrial',
  name: 'building.factory.name',
  description: 'building.factory.desc',
  footprint: [1, 1],
  construction: { cost: 200, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 25 },
  jobs: { capacity: 12 },
  environment: { pollution: 40 },
  graphics: { color: '#d9c07f', heightLevels: 1 },
};

const catalogue: BuildingCatalogue = {
  get: (id) => (id === FACTORY.id ? FACTORY : undefined),
  byCategory: (category) => (category === 'industrial' ? [FACTORY] : []),
};

/** Odtiká tolik tiků, aby cena půdy proběhla `runs`krát (interval 16, offset 5). */
function runLandValue(world: WorldState, runs: number, withPollution = false): void {
  const systems = withPollution
    ? [createPollutionSystem(catalogue), createLandValueSystem()]
    : [createLandValueSystem()];
  const total = runs * 16 + 5;
  for (let tick = 0; tick < total; tick++) tickWorld(world, systems);
}

function value(world: WorldState, x: number, y: number): number {
  return world.coarse.landValue[coarseIndex(x, y)] ?? 0;
}

/** Kaluž vody o rozměru jedné hrubé buňky. */
function addWater(world: WorldState, x: number, y: number): void {
  for (let dy = 0; dy < COARSE_FACTOR; dy++) {
    for (let dx = 0; dx < COARSE_FACTOR; dx++) {
      world.layers.terrain[index(x + dx, y + dy)] = TERRAIN.water;
    }
  }
}

describe('cena půdy', () => {
  it('na prázdné mapě vystoupá na základ a tam se zastaví', () => {
    const world = createWorld(1);
    runLandValue(world, 40);

    expect(value(world, 64, 64)).toBe(40);
    // Základ platí všude stejně, dokud nic mapu nerozliší.
    expect(value(world, 8, 120)).toBe(40);
  });

  it('roste postupně, ne skokem', () => {
    const world = createWorld(1);

    runLandValue(world, 1);
    const poPrvním = value(world, 64, 64);
    runLandValue(world, 1);
    const poDruhém = value(world, 64, 64);

    expect(poPrvním).toBeGreaterThan(0);
    expect(poPrvním).toBeLessThan(40);
    expect(poDruhém).toBeGreaterThan(poPrvním);
    expect(poDruhém).toBeLessThanOrEqual(40);
  });

  it('u vody je vyšší než ve vnitrozemí', () => {
    const world = createWorld(1);
    addWater(world, 40, 40);

    runLandValue(world, 40);

    const uVody = value(world, 44, 40); // sousední buňka
    const vnitrozemí = value(world, 100, 100);

    expect(uVody).toBeGreaterThan(vnitrozemí);
    expect(uVody).toBe(65); // základ 40 + bonus 25
  });

  it('bonus dostane i buňka s vodou samotnou', () => {
    const world = createWorld(1);
    addWater(world, 40, 40);
    runLandValue(world, 40);
    expect(value(world, 40, 40)).toBe(65);
  });

  it('znečištění ji srazí', () => {
    const world = createWorld(1);
    placeBuilding(world, FACTORY, 64, 64);

    runLandValue(world, 60, true);

    const uTovárny = value(world, 64, 64);
    const daleko = value(world, 8, 8);

    expect(uTovárny).toBeLessThan(daleko);
    expect(daleko).toBeGreaterThan(0);
  });

  it('těžké znečištění ji srazí až na nulu, ale ne pod ni', () => {
    const world = createWorld(1);
    // Šest továren v jedné buňce: 240 znečištění × 0,8 přebije základ 40.
    for (let i = 0; i < 6; i++) placeBuilding(world, FACTORY, 64 + i, 64);

    runLandValue(world, 80, true);

    expect(value(world, 64, 64)).toBe(0);
    expect(Math.min(...world.coarse.landValue)).toBeGreaterThanOrEqual(0);
  });

  it('nepřeteče 255', () => {
    const world = createWorld(1);
    addWater(world, 40, 40);
    runLandValue(world, 200);
    expect(Math.max(...world.coarse.landValue)).toBeLessThanOrEqual(255);
  });

  it('ohlásí změnu hrubé mřížky', () => {
    const world = createWorld(1);
    world.dirty.coarseChanged = false;
    runLandValue(world, 1);
    expect(world.dirty.coarseChanged).toBe(true);
  });

  it('je deterministická', () => {
    const build = (): WorldState => {
      const world = createWorld(77);
      addWater(world, 20, 20);
      placeBuilding(world, FACTORY, 64, 64);
      runLandValue(world, 30, true);
      return world;
    };

    expect(hashCoarseLayers(build().coarse)).toBe(hashCoarseLayers(build().coarse));
  });

  it('běží každých 16 tiků s offsetem 5', () => {
    const system = createLandValueSystem();
    expect([system.name, system.interval, system.offset]).toEqual(['landValue', 16, 5]);
  });
});
