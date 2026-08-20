import { COARSE_CELLS, createCoarseLayers } from './coarse';
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
  /** Úroveň 1–5. Jaký půdorys a kapacitu k ní patří, říká definice (§8 fáze 2). */
  level: number;
  population: number;
  jobs: number;
  powered: boolean;
  builtAtTick: number;
  /**
   * Kdy budova naposledy změnila úroveň nebo půdorys.
   *
   * Cooldown proti blikání: bez něj by budova na hraně prahu skákala nahoru
   * a dolů každý běh systému úrovní.
   */
  levelChangedAtTick: number;
  /**
   * Opuštěná budova: stojí, ale nic nedělá. Nedaní, nestojí údržbu, nemá
   * obyvatele ani práci a přispívá do kriminality. **Sama nezmizí** — hráč ji
   * musí zbourat (§8 zadání fáze 2).
   */
  abandoned: boolean;
}

export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 20;

/**
 * Výchozí sazba a startovní kapitál, když se svět tvoří bez balancu.
 *
 * Slouží testům; hra vždycky předá `balance.economy`. Že se obojí neshoduje,
 * hlídá test — jinak by se tichý default rozešel s obsahem.
 */
export const DEFAULT_TAX_RATE = 7;
export const STARTING_FUNDS = 20000;

/** Ekonomické počáteční hodnoty světa. Bere se z `balance.economy`. */
export interface WorldEconomyDefaults {
  startingFunds: number;
  defaultTaxRate: number;
}

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
   * Zátěž na silnicích, plné rozlišení. **Neukládá se** (R10) — je odvozená
   * a po načtení savu se do pár tiků spočítá znovu.
   */
  trafficLoad: Float32Array;

  /** Jak dobře se z budovy dostane do práce, 0–1. Klíč je id budovy. */
  jobAccess: Map<number, number>;

  /**
   * Poslední násobitele skóre za dostupnost práce po buňkách hrubé mřížky a
   * jeden celoměstský, kterým se škrtí rychlost růstu (R6).
   *
   * **Neukládá se** — je to výstup růstu, ne stav světa. Drží se tu jen proto,
   * aby panel parcely ukazoval přesně to číslo, se kterým růst opravdu počítal,
   * a hráč viděl, proč se čtvrť zadrhla. Než růst poprvé proběhne, jsou to
   * jedničky, tedy „nic to nebrzdí“.
   */
  jobAccessCells: Float32Array;
  cityJobAccess: number;

  /**
   * Kde skončilo vzorkování dopravy minule. **Do savu patří**: bez něj by se
   * po načtení vzorkovalo od začátku a determinismus by padl (§5 fáze 3).
   */
  trafficCursor: number;

  /**
   * Odkud se vzala mapa. **Do savu patří** (§10 fáze 3): ze seedu jde terén
   * kdykoli vygenerovat znovu, takže město zůstává reprodukovatelné i pro
   * nástroje mimo hru.
   *
   * `generated: false` znamená „mapa nevznikla generátorem" — ruční mapa,
   * testovací svět, nebo město ze savu, který generátor ještě nezažil.
   * Parametry generátoru se sem nepíšou: sedí v balancu, a ten je obsah, takže
   * ho save eviduje přes `meta.content.sources`.
   */
  map: { seed: number; generated: boolean };

  /**
   * Kolikrát po sobě vyšla budově cena půdy pod prahem její úrovně.
   *
   * **Neukládá se.** Je to jen hystereze proti kmitání na hranici prahu; po
   * načtení savu se počítá znovu, takže se snížení nanejvýš o pár vyhodnocení
   * odloží. Uložený stav by naopak musel držet krok s obsahem, který se mezi
   * savem a načtením mohl změnit.
   */
  downgradeStreak: Map<number, number>;

  /**
   * Změnila se od posledního přepočtu topologie elektrické sítě?
   * `powerSystem` běží každý tik, ale flood fill pouští jen při tomhle flagu (§5).
   * Runtime-only — po loadu se síť přepočítá znovu.
   */
  powerNetworkDirty: boolean;
}

export function createWorld(
  seed: number,
  economy: WorldEconomyDefaults = {
    startingFunds: STARTING_FUNDS,
    defaultTaxRate: DEFAULT_TAX_RATE,
  },
): WorldState {
  return {
    size: MAP_SIZE,
    seed: seed >>> 0,
    tick: 0,
    layers: createLayers(MAP_SIZE),
    coarse: createCoarseLayers(),
    buildings: new Map(),
    nextBuildingId: 1, // 0 ve vrstvě `buildingId` znamená prázdno
    economy: {
      funds: economy.startingFunds,
      taxRates: {
        residential: economy.defaultTaxRate,
        commercial: economy.defaultTaxRate,
        industrial: economy.defaultTaxRate,
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
    trafficLoad: new Float32Array(MAP_SIZE * MAP_SIZE),
    jobAccess: new Map(),
    jobAccessCells: new Float32Array(COARSE_CELLS).fill(1),
    cityJobAccess: 1,
    trafficCursor: 0,
    map: { seed: seed >>> 0, generated: false },
    downgradeStreak: new Map(),
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
  world.downgradeStreak.delete(buildingId);
  world.jobAccess.delete(buildingId);

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
