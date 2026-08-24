import { COARSE_FACTOR, coarseIndex, coarseSizeOf } from '../coarse';
import type { WorldState } from '../world';
import type { ActiveDisaster } from './state';

/**
 * Společné pro stávku, nepokoje a válku gangů (T52).
 *
 * Všechny tři jsou **stav, ne děj**: nemají dráhu ani epicentrum šíření, mají
 * oblast a podmínku, za které skončí. A všechny tři sdílejí jednu myšlenku,
 * kvůli které vůbec existují — **hráč je umí zkrátit tím, že zareaguje**.
 * Odpočet se každý tik nesnižuje o jedničku, ale o to, jak moc město tlačí
 * zpátky. Kdyby to byl pevný čas, nebylo by co hrát: čekalo by se.
 *
 * Ničivé katastrofy z T51 jsou opak — ty se odehrají a hráč uklízí. Proto mají
 * vlastní vrstvu (`damage.ts`) a tyhle vlastní.
 */

/** Průměrná spokojenost v buňkách oblasti, 0–255. Prázdná oblast = celé město. */
export function areaHappiness(world: WorldState, cells: readonly number[]): number {
  if (cells.length === 0) {
    let sum = 0;
    for (const value of world.happiness) sum += value;
    return world.happiness.length === 0 ? 0 : sum / world.happiness.length;
  }

  let sum = 0;
  let count = 0;
  for (const cell of cells) {
    const value = world.happiness[cell];
    if (value === undefined) continue;
    sum += value;
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

/** Průměrné pokrytí třídou služby v oblasti, 0–255. */
export function areaCoverage(
  world: WorldState,
  serviceClass: string,
  cells: readonly number[],
): number {
  const layer = world.coverage.get(serviceClass);
  if (!layer) return 0;
  if (cells.length === 0) {
    let sum = 0;
    for (const value of layer) sum += value;
    return layer.length === 0 ? 0 : sum / layer.length;
  }

  let sum = 0;
  let count = 0;
  for (const cell of cells) {
    const value = layer[cell];
    if (value === undefined) continue;
    sum += value;
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * O kolik se spokojenost v oblasti změnila od minulého tiku.
 *
 * Ukládá si předchozí hodnotu do stavu katastrofy, takže přežije save. Kladné
 * číslo znamená, že hráč něco udělal a zabralo to — a přesně na tohle se ptají
 * všechny tři ukončovací podmínky.
 */
export function happinessChange(
  world: WorldState,
  active: ActiveDisaster,
  cells: readonly number[],
): number {
  const now = areaHappiness(world, cells);
  const before = (active.state['happinessBefore'] as number | undefined) ?? now;
  active.state['happinessBefore'] = now;
  return now - before;
}

/** Buňky hrubé mřížky v okruhu kolem místa. Vzestupně, kvůli determinismu. */
export function cellsAround(world: WorldState, x: number, y: number, radius: number): number[] {
  const side = coarseSizeOf(world.size);
  const centreX = (x / COARSE_FACTOR) | 0;
  const centreY = (y / COARSE_FACTOR) | 0;
  const reach = Math.max(0, Math.round(radius));

  const cells: number[] = [];
  for (let cy = centreY - reach; cy <= centreY + reach; cy++) {
    if (cy < 0 || cy >= side) continue;
    for (let cx = centreX - reach; cx <= centreX + reach; cx++) {
      if (cx < 0 || cx >= side) continue;
      if (Math.hypot(cx - centreX, cy - centreY) > reach) continue;
      cells.push(cy * side + cx);
    }
  }
  return cells;
}

/**
 * Vážený los místa mezi budovami.
 *
 * `weightOf` vrátí váhu; nula nebo záporná budovu vyřadí. Prochází se
 * **vzestupně podle id**, ne v pořadí `Map`: save načte budovy v pořadí, v jakém
 * je v souboru, a bez toho by město po loadu losovalo jinak (P2).
 */
export function pickWeighted(
  world: WorldState,
  weightOf: (building: { x: number; y: number; id: number }) => number,
): { x: number; y: number } | null {
  const ids = [...world.buildings.keys()].sort((a, b) => a - b);
  const targets: { x: number; y: number }[] = [];
  const weights: number[] = [];
  let total = 0;

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;
    const weight = weightOf(building);
    if (!(weight > 0)) continue;
    targets.push({ x: building.x, y: building.y });
    weights.push(weight);
    total += weight;
  }

  if (total <= 0) return null;

  let roll = world.rng.next() * total;
  for (let i = 0; i < targets.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return targets[i] ?? null;
  }
  return targets[targets.length - 1] ?? null;
}

/**
 * Obyvatelé po buňkách hrubé mřížky. Jeden průchod, ne jeden na dotaz.
 *
 * Hustota je součást váhy u stávky i války gangů, a ta se ptá na každou budovu.
 * Počítat ji pokaždé znovu je na dvou tisících budov čtyři miliony iterací za
 * jediný los.
 */
export function populationPerCell(world: WorldState): Map<number, number> {
  const perCell = new Map<number, number>();
  for (const building of world.buildings.values()) {
    if (building.population === 0) continue;
    const cell = coarseIndex(building.x, building.y, world.size);
    perCell.set(cell, (perCell.get(cell) ?? 0) + building.population);
  }
  return perCell;
}

/** Hustota v buňce, znormovaná na `perCellFull` obyvatel. */
export function densityOfCell(
  perCell: ReadonlyMap<number, number>,
  cell: number,
  perCellFull: number,
): number {
  return Math.min(1, (perCell.get(cell) ?? 0) / Math.max(1, perCellFull));
}

/**
 * Sníží zbývající dobu o `amount` a řekne, jestli je konec.
 *
 * Zlomková čísla jsou záměr: válka gangů ubývá o 0,3 za tik bez zásahu a o 2,5
 * s plným pokrytím, což je rozdíl třinácti měsíců proti dvěma.
 */
export function drain(active: ActiveDisaster, amount: number): boolean {
  const left = ((active.state['left'] as number | undefined) ?? 0) - amount;
  active.state['left'] = left;
  return left <= 0;
}

export function remainingOf(active: ActiveDisaster): number {
  return (active.state['left'] as number | undefined) ?? 0;
}

/** Obyvatelé a pracovní místa po buňkách. Jeden průchod, jako `populationPerCell`. */
export interface WorkCells {
  readonly population: ReadonlyMap<number, number>;
  readonly jobs: ReadonlyMap<number, number>;
}

export function workPerCell(world: WorldState): WorkCells {
  const population = new Map<number, number>();
  const jobs = new Map<number, number>();

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    const cell = coarseIndex(building.x, building.y, world.size);
    if (building.population > 0) {
      population.set(cell, (population.get(cell) ?? 0) + building.population);
    }
    if (building.jobs > 0) jobs.set(cell, (jobs.get(cell) ?? 0) + building.jobs);
  }
  return { population, jobs };
}

/** Obyvatelé v oblasti, kteří mají práci. Podíl 0–1; bez obyvatel nula. */
export function areaEmployment(
  work: WorkCells,
  cells: readonly number[],
  workerRatio: number,
): number {
  let population = 0;
  let jobs = 0;

  if (cells.length === 0) {
    for (const value of work.population.values()) population += value;
    for (const value of work.jobs.values()) jobs += value;
  } else {
    for (const cell of cells) {
      population += work.population.get(cell) ?? 0;
      jobs += work.jobs.get(cell) ?? 0;
    }
  }

  const workers = population * workerRatio;
  if (workers <= 0) return 0;
  return Math.min(1, jobs / workers);
}

/**
 * Nezaměstnanost kolem místa, 0–1.
 *
 * Bere předpočítané buňky, ne svět: los stávky se ptá na každou budovu a
 * průchod všemi budovami uvnitř průchodu všemi budovami je čtverec.
 */
export function localUnemployment(
  world: WorldState,
  work: WorkCells,
  x: number,
  y: number,
  radius: number,
  workerRatio: number,
): number {
  return 1 - areaEmployment(work, cellsAround(world, x, y, radius), workerRatio);
}
