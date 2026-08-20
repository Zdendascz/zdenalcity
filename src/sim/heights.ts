import { MAP_SIZE } from './layers';

/**
 * Výškový model terénu (§7 zadání fáze 3).
 *
 * Výška sedí **v rozích, ne v dlaždicích**. Dlaždice `(x, y)` má rohy
 * `(x,y)`, `(x+1,y)`, `(x,y+1)` a `(x+1,y+1)`, takže mřížka rohů je o jedna
 * větší v obou směrech než mřížka dlaždic. Kdyby výška patřila dlaždici, každý
 * svah by byl schod a sousední dlaždice by se nikdy nedotýkaly.
 *
 * **Invariant: sousední rohy se smí lišit nejvýš o 1.** Vynucuje se kaskádou —
 * zvednutí rohu automaticky zvedne sousedy, kteří by jinak invariant porušili.
 * Bez něj by šlo vytvořit svislou stěnu, kterou by renderer neuměl nakreslit
 * a picking trefit.
 *
 * Invariant se schválně týká jen **kolmých** sousedů, ne úhlopříčných. Rohy
 * jedné dlaždice se tím pádem můžou lišit až o dva a vznikne „zkroucená"
 * dlaždice tvaru sedla. Zadání s ní počítá: silnice ji nepobere, ale existovat
 * smí, jinak by terén ztuhl do samých teras.
 */

/** Mřížka rohů je o jedna větší než mřížka dlaždic. */
export const CORNER_SIZE = MAP_SIZE + 1;
export const CORNER_CELLS = CORNER_SIZE * CORNER_SIZE;

/** Rozsah výšek 0–15 (R8). Víc by se do půlbajtu nevešlo, kdyby došlo na packing. */
export const MAX_HEIGHT = 15;

export function cornerIndex(x: number, y: number): number {
  return y * CORNER_SIZE + x;
}

export function cornerInBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < CORNER_SIZE && y < CORNER_SIZE;
}

export function createCornerHeights(): Uint8Array {
  return new Uint8Array(CORNER_CELLS);
}

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** Rohy dlaždice v pořadí severozápad, severovýchod, jihozápad, jihovýchod. */
export function tileCorners(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
): [number, number, number, number] {
  return [
    heights[cornerIndex(x, y)] ?? 0,
    heights[cornerIndex(x + 1, y)] ?? 0,
    heights[cornerIndex(x, y + 1)] ?? 0,
    heights[cornerIndex(x + 1, y + 1)] ?? 0,
  ];
}

/** Rovná dlaždice má všechny čtyři rohy stejně vysoko. Na těch stojí budovy. */
export function isFlatTile(heights: Readonly<Uint8Array>, x: number, y: number): boolean {
  const [nw, ne, sw, se] = tileCorners(heights, x, y);
  return nw === ne && ne === sw && sw === se;
}

/**
 * Zkroucená dlaždice — čtyři rohy neleží v jedné rovině (sedlo).
 *
 * Rovinu poznáme z toho, že se součty úhlopříček rovnají. Nerovnají-li se,
 * dlaždice se nedá nakreslit jako plocha a silnice po ní nepovede (§7).
 */
export function isTwistedTile(heights: Readonly<Uint8Array>, x: number, y: number): boolean {
  const [nw, ne, sw, se] = tileCorners(heights, x, y);
  return nw + se !== ne + sw;
}

/** Nejnižší roh dlaždice. Základna, podle které se ve 3b řadí kreslení. */
export function tileBaseHeight(heights: Readonly<Uint8Array>, x: number, y: number): number {
  const [nw, ne, sw, se] = tileCorners(heights, x, y);
  return Math.min(nw, ne, sw, se);
}

/**
 * Dvojice sousedních rohů, které porušují invariant.
 *
 * Vrací počet, ne `boolean`: při ladění generátoru je rozdíl mezi „jedna
 * dvojice" a „šest tisíc dvojic" ta nejcennější informace.
 */
export function countViolations(heights: Readonly<Uint8Array>): number {
  let violations = 0;
  for (let y = 0; y < CORNER_SIZE; y++) {
    for (let x = 0; x < CORNER_SIZE; x++) {
      const here = heights[cornerIndex(x, y)] ?? 0;
      // Stačí doprava a dolů, jinak by se každá dvojice počítala dvakrát.
      if (x + 1 < CORNER_SIZE && Math.abs(here - (heights[cornerIndex(x + 1, y)] ?? 0)) > 1) {
        violations++;
      }
      if (y + 1 < CORNER_SIZE && Math.abs(here - (heights[cornerIndex(x, y + 1)] ?? 0)) > 1) {
        violations++;
      }
    }
  }
  return violations;
}

/**
 * Spočítá, co se musí změnit, aby roh `x, y` skončil ve výšce `target` a
 * invariant zůstal celý.
 *
 * **Nic nemění** — vrací jen mapu `roh → nová výška`. Terraforming z T32 z ní
 * spočítá cenu **než** se hráče zeptá, a stejnou mapu pak použije k zápisu.
 * Kdyby se měnilo rovnou, nešlo by cenu ukázat předem (§12 kritérium 14).
 *
 * Kaskáda jde do šířky: zvednutý roh dotlačí souseda nejvýš na `výška − 1`,
 * ten svého souseda, a tak dál, dokud se vlna nezastaví o terén, který
 * invariant splňuje sám.
 */
export function planCornerHeight(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
  target: number,
): Map<number, number> {
  const changes = new Map<number, number>();
  if (!cornerInBounds(x, y)) return changes;

  const clamped = Math.max(0, Math.min(MAX_HEIGHT, Math.round(target)));
  const start = cornerIndex(x, y);
  if ((heights[start] ?? 0) === clamped) return changes;

  const heightAt = (corner: number): number => changes.get(corner) ?? heights[corner] ?? 0;

  changes.set(start, clamped);
  const queue = [start];

  while (queue.length > 0) {
    const corner = queue.shift();
    if (corner === undefined) break;

    const here = heightAt(corner);
    const cx = corner % CORNER_SIZE;
    const cy = (corner - cx) / CORNER_SIZE;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!cornerInBounds(nx, ny)) continue;

      const neighbour = cornerIndex(nx, ny);
      const value = heightAt(neighbour);
      // Soused smí zůstat, jen když je v mezích jednoho patra.
      const wanted = value < here - 1 ? here - 1 : value > here + 1 ? here + 1 : value;
      if (wanted === value) continue;

      changes.set(neighbour, Math.max(0, Math.min(MAX_HEIGHT, wanted)));
      queue.push(neighbour);
    }
  }

  return changes;
}

/**
 * Plán srovnání obdélníku dlaždic do jedné výšky (§7 fáze 3).
 *
 * Skládá se z jednotlivých kaskád, protože ty se **navzájem ovlivňují**:
 * srovnání druhého rohu už musí vidět, co udělal ten první. Proto se počítá nad
 * pracovní kopií a vrací se sjednocení změn.
 *
 * Cílová výška je zaokrouhlený průměr rohů oblasti. Je to volba pro hráče
 * nejlevnější: srovnání na nejvyšší nebo nejnižší roh by hýbalo víc terénem
 * a stálo víc.
 */
export function planLevelArea(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
  width: number,
  depth: number,
  target?: number,
): Map<number, number> {
  const corners: number[] = [];
  for (let cy = y; cy <= y + depth; cy++) {
    for (let cx = x; cx <= x + width; cx++) {
      if (cornerInBounds(cx, cy)) corners.push(cornerIndex(cx, cy));
    }
  }

  const changes = new Map<number, number>();
  if (corners.length === 0) return changes;

  let level = target;
  if (level === undefined) {
    let sum = 0;
    for (const corner of corners) sum += heights[corner] ?? 0;
    level = Math.round(sum / corners.length);
  }

  const working = Uint8Array.from(heights);
  for (const corner of corners) {
    const cx = corner % CORNER_SIZE;
    const cy = (corner - cx) / CORNER_SIZE;
    const step = planCornerHeight(working, cx, cy, level);
    applyCornerChanges(working, step);
    for (const [at, value] of step) changes.set(at, value);
  }

  // Roh, který se vrátil na původní hodnotu, se do účtu počítat nemá.
  for (const [at, value] of [...changes]) {
    if ((heights[at] ?? 0) === value) changes.delete(at);
  }

  return changes;
}

/** Zapíše plán z `planCornerHeight`. Oddělené schválně — viz komentář tamtéž. */
export function applyCornerChanges(heights: Uint8Array, changes: ReadonlyMap<number, number>): void {
  for (const [corner, value] of changes) heights[corner] = value;
}

/**
 * Srovná výškové pole tak, aby invariant platil všude.
 *
 * Používá to generátor: šum ani koryto řeky se o sousedy nestarají, tak se
 * výsledek nakonec „nechá stéct" — každý roh se stlačí nejvýš na `soused + 1`.
 * Opakuje se, dokud se něco mění; kroky jsou zastropované, aby nešlo o
 * nekonečnou smyčku, kdyby se model někdy změnil.
 *
 * Vrací počet průchodů, což je jediné, co při ladění generátoru zajímá.
 */
export function relaxHeights(heights: Uint8Array, maxPasses = 64): number {
  for (let pass = 1; pass <= maxPasses; pass++) {
    let changed = false;

    for (let y = 0; y < CORNER_SIZE; y++) {
      for (let x = 0; x < CORNER_SIZE; x++) {
        const corner = cornerIndex(x, y);
        const here = heights[corner] ?? 0;

        let lowest = MAX_HEIGHT;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!cornerInBounds(nx, ny)) continue;
          lowest = Math.min(lowest, heights[cornerIndex(nx, ny)] ?? 0);
        }

        if (here > lowest + 1) {
          heights[corner] = lowest + 1;
          changed = true;
        }
      }
    }

    if (!changed) return pass;
  }

  return maxPasses;
}
