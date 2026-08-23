import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { coarseCongestion } from '../diagnostics';
import { averageHappiness } from '../systems/happiness';
import { ROAD, TERRAIN } from '../layers';
import { MAX_TAX_RATE } from '../world';
import type { WorldState } from '../world';

/**
 * Ukazatele, ze kterých se skládá riziko nepřírodních katastrof (§3 fáze 4).
 *
 * Všechny jsou **normalizované na 0–1**, protože váhy v katalogu s tím počítají:
 * vrstvy 0–255 se dělí 255, podíly se počítají přímo. Kdyby jeden ukazatel
 * chodil v jiném rozsahu, jeho váha by znamenala něco jiného než ostatní a
 * ladit se to nedá.
 *
 * Počítají se **jednou za běh plánovače** a předají se všem typům naráz.
 * Patnáct katastrof, které si každá projde město zvlášť, by z měsíčního
 * vyhodnocení udělalo nejdražší věc ve hře.
 */

/** Prahy a děliče, které ukazatele potřebují. Čísla jsou v balancu (P5). */
export interface IndicatorSettings {
  /** Pod tímhle pokrytím se buňka počítá za nekrytou. */
  readonly uncoveredBelow: number;
  /** Od téhle úrovně výš je budova „vysoká". */
  readonly denseLevel: number;
  /** Od tolika tiků výš je zařízení „staré". */
  readonly ageTicks: number;
}

export interface Indicators {
  /** Hodnota ukazatele podle jména, 0–1. Neznámé jméno je nula. */
  get(name: string): number;
}

/**
 * Spočítá všechny ukazatele pro daný svět.
 *
 * Jména jsou dvojího tvaru: prosté (`crime`, `unemployment`) a s třídou služby
 * za dvojtečkou (`uncovered:fire`, `underfunded:police`). Třídy jsou obsah —
 * mod si přidá vlastní a katalog na ni může vážit, aniž by se sáhlo do kódu.
 */
export function computeIndicators(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  settings: IndicatorSettings,
): Indicators {
  const values = new Map<string, number>();
  const size = world.size;

  // --- jeden průchod budovami; víc jich být nemusí ------------------------
  let buildings = 0;
  let abandoned = 0;
  let population = 0;
  let jobs = 0;
  let industrial = 0;
  let dense = 0;
  let old = 0;
  let waterless = 0;
  /** Kolik budov je v které buňce — váha pro průměry vrstev. */
  const perCell = new Map<number, number>();

  for (const building of world.buildings.values()) {
    buildings++;
    if (building.abandoned) {
      abandoned++;
      continue;
    }
    population += building.population;
    jobs += building.jobs;

    const definition = catalogue.get(building.definitionId);
    if (definition?.category === 'industrial') industrial++;
    if (building.level >= settings.denseLevel) dense++;
    if (world.tick - building.builtAtTick >= settings.ageTicks) old++;
    if (definition?.construction.requiresWater === true && !world.watered.has(building.id)) {
      waterless++;
    }

    const cell = coarseIndex(building.x, building.y, size);
    perCell.set(cell, (perCell.get(cell) ?? 0) + 1);
  }

  const liveBuildings = Math.max(1, buildings);

  // --- vrstvy vážené počtem budov ----------------------------------------
  // Průměr přes celou mapu by u velkého města říkal hlavně to, kolik je kolem
  // prázdné louky. Váží se proto zástavbou: zajímá nás, v čem lidé žijí.
  values.set('crime', weightedLayerAverage(world.coarse.crime, perCell));
  values.set('pollution', weightedLayerAverage(world.coarse.pollution, perCell));
  values.set('crimeMax', maxOverInhabited(world.coarse.crime, perCell));

  // --- podíly ze zástavby -------------------------------------------------
  values.set('industryShare', industrial / liveBuildings);
  values.set('denseShare', dense / liveBuildings);
  values.set('equipmentAge', old / liveBuildings);
  values.set('waterless', waterless / liveBuildings);
  values.set('highLevelShare', industrial === 0 ? 0 : Math.min(1, dense / industrial));

  // Zanedbanost: ruiny a trosky proti celé zástavbě. Trosky přidává T50 —
  // do té doby je vrstva prázdná a ukazatel počítá jen opuštěné budovy.
  const rubbleTiles = countRubble(world);
  values.set('neglect', Math.min(1, (abandoned + rubbleTiles) / liveBuildings));
  values.set(
    'neglectIndustry',
    industrial === 0 ? 0 : Math.min(1, (abandoned + rubbleTiles) / industrial),
  );

  // --- celoměstské veličiny ----------------------------------------------
  const workers = population * balance.demand.workerRatio;
  values.set('unemployment', workers > 0 ? clamp01((workers - jobs) / workers) : 0);
  values.set('unhappiness', 1 - averageHappiness(world) / 255);
  values.set('density', densityOf(perCell));

  // Daňová zátěž: nula u nejnižší sazby, jedna u nejvyšší. Katalog počítá
  // s tím, že výchozích sedm procent je „normál", ne trest.
  const averageRate =
    (world.economy.taxRates.residential +
      world.economy.taxRates.commercial +
      world.economy.taxRates.industrial) /
    3;
  const defaultRate = balance.economy.defaultTaxRate;
  values.set(
    'taxBurden',
    clamp01((averageRate - defaultRate) / Math.max(1, MAX_TAX_RATE - defaultRate)),
  );

  // --- doprava ------------------------------------------------------------
  const congestion = coarseCongestion(world, balance);
  values.set('congestion', clamp01(weightedLayerAverage(congestion, perCell)));
  values.set('majorRoadShare', majorRoadShare(world));

  // --- elektřina ----------------------------------------------------------
  const power = powerIndicators(world, catalogue);
  values.set('powerReserve', power.reserve);
  values.set('singlePlantShare', power.singlePlantShare);

  return {
    get(name: string): number {
      const direct = values.get(name);
      if (direct !== undefined) return direct;

      const colon = name.indexOf(':');
      if (colon < 0) return 0;
      const prefix = name.slice(0, colon);
      const serviceClass = name.slice(colon + 1);

      if (prefix === 'uncovered') {
        return uncoveredShare(world, serviceClass, perCell, settings.uncoveredBelow);
      }
      if (prefix === 'underfunded') {
        return clamp01(1 - (world.serviceFunding.get(serviceClass) ?? 1));
      }
      return 0;
    },
  };
}

/** Podíl budov v buňkách, kde je pokrytí třídy pod prahem. */
function uncoveredShare(
  world: WorldState,
  serviceClass: string,
  perCell: ReadonlyMap<number, number>,
  below: number,
): number {
  const coverage = world.coverage.get(serviceClass);
  // Město bez jediné stanice je nekryté celé, ne kryté celé.
  if (!coverage) return perCell.size === 0 ? 0 : 1;

  let total = 0;
  let uncovered = 0;
  for (const [cell, count] of perCell) {
    total += count;
    if ((coverage[cell] ?? 0) < below) uncovered += count;
  }
  return total === 0 ? 0 : uncovered / total;
}

/** Průměr vrstvy 0–255 vážený počtem budov, převedený na 0–1. */
function weightedLayerAverage(
  layer: Readonly<Uint8Array> | Readonly<Float32Array>,
  perCell: ReadonlyMap<number, number>,
): number {
  let sum = 0;
  let weight = 0;
  for (const [cell, count] of perCell) {
    sum += (layer[cell] ?? 0) * count;
    weight += count;
  }
  if (weight === 0) return 0;
  const average = sum / weight;
  // Vrstvy jsou 0–255, kolony 0–2. Normalizuje se podle toho, co přišlo.
  return clamp01(layer instanceof Float32Array ? average / 2 : average / 255);
}

/** Nejhorší obydlená buňka, ne průměr. Válka gangů se rodí v jedné čtvrti. */
function maxOverInhabited(
  layer: Readonly<Uint8Array>,
  perCell: ReadonlyMap<number, number>,
): number {
  let worst = 0;
  for (const cell of perCell.keys()) worst = Math.max(worst, layer[cell] ?? 0);
  return clamp01(worst / 255);
}

/**
 * Hustota osídlení: obydlené buňky proti všem, které se dají obydlet.
 *
 * Není to populace na plochu — to by na velké mapě vyšlo skoro nula bez ohledu
 * na to, jak hustě se staví. Zajímá nás, jak namačkané je to tam, kde lidé jsou.
 */
function densityOf(perCell: ReadonlyMap<number, number>): number {
  if (perCell.size === 0) return 0;
  let sum = 0;
  for (const count of perCell.values()) sum += count;
  // Šestnáct dlaždic v buňce, tedy nejvýš šestnáct budov 1×1.
  return clamp01(sum / perCell.size / 16);
}

/** Podíl tříd a dálnic na silniční síti. Rychlé silnice znamenají horší nehody. */
function majorRoadShare(world: WorldState): number {
  let major = 0;
  let total = 0;
  for (const tile of world.roadTiles) {
    const type = world.layers.road[tile] ?? ROAD.none;
    if (type === ROAD.none) continue;
    total++;
    if (type >= ROAD.avenue) major++;
  }
  return total === 0 ? 0 : major / total;
}

/** Rezerva sítě a podíl největší elektrárny na výrobě. */
function powerIndicators(
  world: WorldState,
  catalogue: BuildingCatalogue,
): { reserve: number; singlePlantShare: number } {
  let capacity = 0;
  let biggest = 0;
  let demand = 0;

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    const output = definition.power?.production ?? 0;
    if (output > 0) {
      capacity += output;
      biggest = Math.max(biggest, output);
    }
    demand += definition.power?.consumption ?? 0;
  }

  if (capacity === 0) return { reserve: 0, singlePlantShare: demand > 0 ? 1 : 0 };
  return {
    reserve: clamp01((capacity - demand) / capacity),
    singlePlantShare: clamp01(biggest / capacity),
  };
}

/** Dlaždice trosek. Vrstvu přidává T50; do té doby je jich nula. */
function countRubble(world: WorldState): number {
  const rubble = world.rubble;
  if (!rubble) return 0;
  let count = 0;
  for (let tile = 0; tile < rubble.length; tile++) if ((rubble[tile] ?? 0) !== 0) count++;
  return count;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Terén bez převýšení. Sesuv bez něj nemá kde vzniknout (R22). */
export function riskySlopeCount(world: WorldState): number {
  const heights = world.cornerHeight;
  const side = world.size + 1;
  let count = 0;
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const tile = y * world.size + x;
      // Prázdný svah v divočině se nepočítá — sesuv musí mít co strhnout.
      const built =
        (world.layers.buildingId[tile] ?? 0) !== 0 || (world.layers.road[tile] ?? 0) !== 0;
      if (!built) continue;
      if (world.layers.terrain[tile] === TERRAIN.water) continue;

      const nw = heights[y * side + x] ?? 0;
      const ne = heights[y * side + x + 1] ?? 0;
      const sw = heights[(y + 1) * side + x] ?? 0;
      const se = heights[(y + 1) * side + x + 1] ?? 0;
      const drop = Math.max(nw, ne, sw, se) - Math.min(nw, ne, sw, se);
      if (drop >= 1) count++;
    }
  }
  return count;
}
