import { createLayers, inBounds, index, MAP_SIZE } from './layers';
import type { Layers } from './layers';
import { Rng } from './rng';
import { shouldRun } from './systems';
import type { System } from './systems';

/**
 * Entita — na rozdíl od vrstev má identitu a životní cyklus (P4).
 * Obyvatelé entity nejsou: budova má `population: 83`, ne 83 objektů.
 */
export interface Building {
  id: number;
  definitionId: string; // "vanilla:residential_small" — P6
  x: number; // levý horní roh footprintu
  y: number;
  level: number;
  population: number;
  jobs: number;
  powered: boolean;
  builtAtTick: number;
}

export interface EconomyState {
  /** Rozpočet, daně a měsíční bilance přijdou v T7. */
  funds: number;
}

export interface DemandState {
  residential: number;
  commercial: number;
  industrial: number;
}

/** Změny od posledního snímku. Renderer překresluje jen dotčené chunky. */
export interface DirtySet {
  tiles: Set<number>;
  buildings: Set<number>;
  fullRedraw: boolean;
}

export function createDirtySet(): DirtySet {
  return { tiles: new Set(), buildings: new Set(), fullRedraw: false };
}

export interface WorldState {
  readonly size: number;
  readonly seed: number;
  tick: number; // monotónní počítadlo od začátku hry

  layers: Layers;
  buildings: Map<number, Building>;
  nextBuildingId: number;

  economy: EconomyState;
  demand: DemandState;
  rng: Rng;

  /** Runtime-only, do savu nepatří — po loadu se stejně překresluje všechno. */
  dirty: DirtySet;
}

export function createWorld(seed: number): WorldState {
  return {
    size: MAP_SIZE,
    seed: seed >>> 0,
    tick: 0,
    layers: createLayers(MAP_SIZE),
    buildings: new Map(),
    nextBuildingId: 1, // 0 ve vrstvě `buildingId` znamená prázdno
    economy: { funds: 0 },
    demand: { residential: 0, commercial: 0, industrial: 0 },
    rng: new Rng(seed),
    // Čerstvý svět renderer ještě neviděl.
    dirty: { tiles: new Set(), buildings: new Set(), fullRedraw: true },
  };
}

export function markTileDirty(world: WorldState, x: number, y: number): void {
  if (inBounds(x, y)) {
    world.dirty.tiles.add(index(x, y));
  }
}

export function markBuildingDirty(world: WorldState, buildingId: number): void {
  world.dirty.buildings.add(buildingId);
}

/**
 * Odstraní budovu i její otisk ve vrstvě `buildingId`.
 *
 * Footprint se hledá průchodem celou vrstvou, protože entita svou velikost
 * nenese (architektura §4) a bez definice ji nelze odvodit. Bourání je akce
 * hráče, ne věc tiku, takže 16 384 porovnání nikoho nebolí.
 */
export function removeBuilding(world: WorldState, buildingId: number): boolean {
  if (!world.buildings.delete(buildingId)) return false;

  const layer = world.layers.buildingId;
  for (let tile = 0; tile < layer.length; tile++) {
    if (layer[tile] !== buildingId) continue;
    layer[tile] = 0;
    const x = tile % world.size;
    markTileDirty(world, x, (tile - x) / world.size);
  }

  markBuildingDirty(world, buildingId);
  return true;
}

/**
 * Populace je agregát přes budovy — obyvatelé nejsou entity (§4).
 *
 * Bere rovnou mapu budov, aby funkce fungovala i nad `ReadonlyWorldView`,
 * ze kterého čte UI.
 */
export function totalPopulation(buildings: ReadonlyMap<number, Readonly<Building>>): number {
  let total = 0;
  for (const building of buildings.values()) {
    total += building.population;
  }
  return total;
}

export function totalJobs(buildings: ReadonlyMap<number, Readonly<Building>>): number {
  let total = 0;
  for (const building of buildings.values()) {
    total += building.jobs;
  }
  return total;
}

/**
 * Jeden herní den. `tick` se zvyšuje jako první, takže systémy vidí číslo tiku,
 * který právě probíhá, a po N voláních platí `world.tick === N`.
 */
export function tickWorld(world: WorldState, systems: readonly System[]): void {
  world.tick += 1;
  for (const system of systems) {
    if (shouldRun(world.tick, system.interval, system.offset)) {
      system.run(world);
    }
  }
}
