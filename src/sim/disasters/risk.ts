import type { DisasterBalance, ScaleBalance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { TERRAIN } from '../layers';
import type { WorldState } from '../world';
import { riskySlopeCount } from './indicators';
import type { Indicators } from './indicators';

/**
 * Model rizika (§3 fáze 4).
 *
 * Plánovač běží jednou za herní měsíc, což je důvod, proč jsou všechny základní
 * pravděpodobnosti v katalogu měsíční — žádný přepočet na tik se nedělá a
 * hodnota z katalogu znamená přesně to, co je na ní napsané.
 *
 * ```
 * riziko = min(základ × měřítko × sezóna × faktorTypu, strop)
 * ```
 *
 * Skládání je **prostý součin** čtyř činitelů. Není to úmysl zjednodušit —
 * je to úmysl, aby šlo ladit: když hráč hlásí, že mu hoří pořád, dá se to
 * rozebrat na čtyři čísla a jedno z nich opravit.
 */

/** Veličiny, podle kterých se katastrofy škálují a podmiňují. */
export type Metric =
  | 'none'
  | 'buildings'
  | 'population'
  | 'roadTiles'
  | 'coastTiles'
  | 'forestTiles'
  | 'flatShare'
  | 'industrialBuildings'
  | 'residentialBuildings'
  | 'heavyIndustry'
  | 'powerPlants'
  | 'riskySlopes';

/** Hodnoty všech metrik pro daný svět. Počítají se jednou za běh plánovače. */
export type Metrics = Readonly<Record<Metric, number>>;

export function computeMetrics(world: WorldState, catalogue: BuildingCatalogue): Metrics {
  let buildings = 0;
  let population = 0;
  let industrial = 0;
  let residential = 0;
  let heavy = 0;
  let plants = 0;

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    buildings++;
    population += building.population;

    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    if (definition.category === 'industrial') {
      industrial++;
      // Těžký provoz je průmysl vyšších úrovní plus odpadová infrastruktura —
      // skládky a spalovny jsou v katalogu výslovně jmenované.
      if (building.level >= 3 || (definition.waste?.capacity ?? 0) > 0) heavy++;
    }
    if (definition.category === 'residential') residential++;
    if ((definition.power?.production ?? 0) > 0) plants++;
  }

  let coast = 0;
  let forest = 0;
  let flat = 0;
  let land = 0;
  const size = world.size;
  const side = size + 1;
  const heights = world.cornerHeight;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = y * size + x;
      const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;
      if (terrain === TERRAIN.water) continue;

      land++;
      if (terrain === TERRAIN.forest) forest++;
      if (touchesWater(world, x, y)) coast++;

      const nw = heights[y * side + x] ?? 0;
      const ne = heights[y * side + x + 1] ?? 0;
      const sw = heights[(y + 1) * side + x] ?? 0;
      const se = heights[(y + 1) * side + x + 1] ?? 0;
      if (nw === ne && ne === sw && sw === se) flat++;
    }
  }

  return {
    none: 1,
    buildings,
    population,
    roadTiles: world.roadTiles.size,
    coastTiles: coast,
    forestTiles: forest,
    flatShare: land === 0 ? 0 : flat / land,
    industrialBuildings: industrial,
    residentialBuildings: residential,
    heavyIndustry: heavy,
    powerPlants: plants,
    riskySlopes: riskySlopeCount(world),
  };
}

function touchesWater(world: WorldState, x: number, y: number): boolean {
  const size = world.size;
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    if (world.layers.terrain[ny * size + nx] === TERRAIN.water) return true;
  }
  return false;
}

/**
 * Měřítkový faktor.
 *
 * Není u všech počet budov: povodeň se škáluje délkou pobřeží, tornádo podílem
 * roviny, epidemie populací. Zemětřesení a blackout se neškálují vůbec — velké
 * město jimi netrpí častěji, jen hůř.
 */
export function scaleFactor(scale: ScaleBalance | undefined, metrics: Metrics): number {
  if (!scale) return 1;
  const raw = metrics[scale.metric] / scale.divisor;
  const shaped = scale.curve === 'sqrt' ? Math.sqrt(Math.max(0, raw)) : raw;
  return clamp(scale.offset + shaped, scale.min, scale.max);
}

/**
 * Sezónní faktor. Rok má 360 tiků, tedy dvanáct měsíců po třiceti.
 *
 * Okno se zadává v tikách od začátku roku a smí přesahovat přes Silvestra —
 * `from > to` se čte jako „od podzimu do jara".
 */
export function seasonFactor(disaster: DisasterBalance, tick: number): number {
  const season = disaster.season;
  if (!season) return 1;

  const dayOfYear = ((tick % TICKS_PER_YEAR) + TICKS_PER_YEAR) % TICKS_PER_YEAR;
  const inside =
    season.from <= season.to
      ? dayOfYear >= season.from && dayOfYear < season.to
      : dayOfYear >= season.from || dayOfYear < season.to;
  return inside ? season.inFactor : season.outFactor;
}

export const TICKS_PER_YEAR = 360;

/**
 * Faktor typu — jediné místo, kde do rizika mluví to, jak hráč město spravuje.
 *
 * Přírodní katastrofy mají jedničku a je to jejich definice: povodeň nezávisí
 * na tom, jak se stará o hasiče, jen na tom, že má město u vody.
 *
 * `below` u členu znamená „počítej, o kolik ukazatel **chybí** pod hodnotu".
 * Používá to rezerva elektrické sítě: nad čtvrtinou rezervy nepřispívá nic,
 * pod ní roste strmě. Bez toho by se strmost musela napsat do kódu.
 */
export function typeFactor(
  disaster: DisasterBalance,
  indicators: Indicators,
  maxMultiplier: number,
): number {
  if (disaster.natural) return 1;

  let sum = 1;
  for (const term of disaster.risk) {
    const raw = indicators.get(term.indicator);
    const value = term.below === undefined ? raw : Math.max(0, term.below - raw);
    sum += value * term.weight;
  }
  return clamp(sum, 1, maxMultiplier);
}

/** Kolik téhle katastrofy smí běžet naráz. */
export function concurrentLimit(disaster: DisasterBalance, metrics: Metrics): number {
  const limit = disaster.concurrent;
  if (limit.metric === 'none') return limit.min;
  return clamp(Math.floor(metrics[limit.metric] / limit.divisor), limit.min, limit.max);
}

/** Splňuje město podmínky pro vznik? Neplatí pro ruční spuštění z menu. */
export function meetsConditions(disaster: DisasterBalance, metrics: Metrics): boolean {
  for (const condition of disaster.require) {
    if (metrics[condition.metric] < condition.min) return false;
  }
  return true;
}

/**
 * Měsíční pravděpodobnost vzniku, 0–1.
 *
 * `ceiling` je strop faktoru typu z R16: při záporném rozpočtu se riziko dál
 * nezvyšuje, takže se použije to, na čem bylo naposledy v černých číslech.
 */
export function monthlyChance(
  disaster: DisasterBalance,
  metrics: Metrics,
  indicators: Indicators,
  tick: number,
  maxMultiplier: number,
  ceiling: number,
): number {
  const factor = Math.min(typeFactor(disaster, indicators, maxMultiplier), ceiling);
  const chance =
    disaster.baseMonthlyChance * scaleFactor(disaster.scale, metrics) * seasonFactor(disaster, tick) * factor;
  return Math.min(chance, disaster.maxMonthlyChance);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
