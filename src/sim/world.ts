import { createCoarseLayers } from './coarse';
import type { CoarseLayers } from './coarse';
import { createLayers, inBounds, index, MAP_SIZE } from './layers';
import type { Layers } from './layers';
import type { RciCategory } from './rci';
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

/** Výchozí daňová sazba v procentech. */
export const DEFAULT_TAX_RATE = 7;
export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 20;

/** Startovní kapitál. Vyjde tak na elektrárnu a pár kilometrů silnic. */
export const STARTING_FUNDS = 20000;

export interface EconomyState {
  funds: number;
  /** Daňová sazba v procentech pro každou zónovou kategorii. */
  taxRates: Record<RciCategory, number>;
  /** Bilance posledního měsíčního rozpočtu. Nulová, dokud první neproběhne. */
  lastIncome: number;
  lastExpenses: number;
}

/**
 * Poptávka po zónách. Kladná hodnota znamená „tady se chce stavět", záporná
 * „je toho už dost".
 */
export type DemandState = Record<RciCategory, number>;

/** Změny od posledního snímku. Renderer překresluje jen dotčené chunky. */
export interface DirtySet {
  tiles: Set<number>;
  buildings: Set<number>;
  fullRedraw: boolean;
  /**
   * Změnila se některá vrstva na hrubé mřížce?
   *
   * Vlastní příznak, ne 16 384 položek v `tiles`: difuze mění celou mapu naráz
   * a překreslit se to musí jen tehdy, když je zrovna zapnutý příslušný overlay.
   */
  coarseChanged: boolean;
}

export function createDirtySet(): DirtySet {
  return { tiles: new Set(), buildings: new Set(), fullRedraw: false, coarseChanged: false };
}

export interface WorldState {
  readonly size: number;
  readonly seed: number;
  tick: number; // monotónní počítadlo od začátku hry

  layers: Layers;
  /** Difuzní vrstvy na hrubé mřížce 32×32 (fáze 2). */
  coarse: CoarseLayers;
  buildings: Map<number, Building>;
  nextBuildingId: number;

  economy: EconomyState;
  demand: DemandState;
  rng: Rng;

  /** Runtime-only, do savu nepatří — po loadu se stejně překresluje všechno. */
  dirty: DirtySet;

  /**
   * Pokrytí službami: klíč je třída, hodnota mřížka 32×32.
   *
   * **Neukládá se** — dá se spočítat z rozmístění budov a financování, takže by
   * se v savu mohlo rozejít se skutečností (§2 zadání fáze 2).
   */
  coverage: Map<string, Uint8Array>;

  /** Financování služeb v procentech (0–1) podle třídy. Chybějící klíč = plné. */
  serviceFunding: Map<string, number>;

  /** Změnilo se rozmístění služeb nebo jejich financování? */
  coverageDirty: boolean;

  /**
   * Změnila se od posledního přepočtu topologie elektrické sítě?
   * `powerSystem` běží každý tik, ale flood fill pouští jen při tomhle flagu (§5).
   * Runtime-only — po loadu se síť přepočítá znovu.
   */
  powerNetworkDirty: boolean;
}

export function createWorld(seed: number): WorldState {
  return {
    size: MAP_SIZE,
    seed: seed >>> 0,
    tick: 0,
    layers: createLayers(MAP_SIZE),
    coarse: createCoarseLayers(),
    buildings: new Map(),
    nextBuildingId: 1, // 0 ve vrstvě `buildingId` znamená prázdno
    economy: {
      funds: STARTING_FUNDS,
      taxRates: {
        residential: DEFAULT_TAX_RATE,
        commercial: DEFAULT_TAX_RATE,
        industrial: DEFAULT_TAX_RATE,
      },
      lastIncome: 0,
      lastExpenses: 0,
    },
    demand: { residential: 0, commercial: 0, industrial: 0 },
    rng: new Rng(seed),
    // Čerstvý svět renderer ještě neviděl.
    dirty: { tiles: new Set(), buildings: new Set(), fullRedraw: true, coarseChanged: true },
    coverage: new Map(),
    serviceFunding: new Map(),
    coverageDirty: false,
    powerNetworkDirty: false, // prázdná mapa nemá co propočítávat
  };
}

/** Vodiče (silnice, budovy) se změnily — síť se musí přepočítat. */
export function markPowerNetworkDirty(world: WorldState): void {
  world.powerNetworkDirty = true;
}

/** Přibyla nebo zmizela služba, případně se změnilo financování. */
export function markCoverageDirty(world: WorldState): void {
  world.coverageDirty = true;
}

/** Financování třídy v rozsahu 0–1. Neznámá třída je plně financovaná. */
export function serviceFunding(world: WorldState, serviceClass: string): number {
  return world.serviceFunding.get(serviceClass) ?? 1;
}

export function coverageOf(world: WorldState, serviceClass: string): Uint8Array | undefined {
  return world.coverage.get(serviceClass);
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
  markPowerNetworkDirty(world); // budova byla vodič i možný zdroj
  // Zbouraná budova mohla být služba; přepočet je levný, rozlišovat se nevyplatí.
  markCoverageDirty(world);
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
