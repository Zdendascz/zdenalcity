import { TERRAIN } from '@/sim/layers';

/**
 * Přechody mezi povrchy (T130, rozhodnutí autora).
 *
 * „Nejde jen o vodu a písek, ale o všechny přechody mezi všemi povrchy …
 * všude přechodové parcely." Na hranici dvou povrchů se na jednu z dlaždic
 * položí **pás přechodového materiálu**: řídnoucí tráva v písku, okraj lesa,
 * suť pod skálou, rákos u mokřadu, mokrý břeh u vody. Na vodní straně
 * břehu je mělčina s pěnou.
 *
 * Tvar pásu je v souřadnicích dlaždice `(u, v)`; vnitřní okraj se vlní šumem,
 * který se počítá ze **světových** souřadnic, takže pás plynule pokračuje
 * přes hranice dlaždic. Kde pás končí, zúží se do ztracena.
 */

export type BandMaterial =
  | 'band_grass_sand'
  | 'band_forest_edge'
  | 'band_scree'
  | 'band_reeds'
  | 'band_shore'
  | 'shallow';

/**
 * Jaký pás patří na dlaždici `self` na straně k sousedovi `other`, nebo
 * `null`. Každá dvojice má pás jen na jedné straně hranice.
 */
export function bandFor(self: number, other: number): BandMaterial | null {
  if (self === other) return null;
  const { grass, water, sand, rock, forest, marsh } = TERRAIN;
  if (self === water) return 'shallow';
  if (other === water) return 'band_shore';
  if (other === rock) return 'band_scree';
  if (self === rock) return null;
  if (other === marsh) return 'band_reeds';
  if (self === marsh) return null;
  if (other === forest) return 'band_forest_edge';
  if (self === forest) return null;
  if (self === sand && other === grass) return 'band_grass_sand';
  return null;
}

/** Hladký šum 0–1 podél přímky: interpolace hodnot v celých bodech. */
function edgeNoise(line: number, along: number, seed: number): number {
  const hash = (i: number): number => {
    let h = Math.imul(i ^ Math.imul(line, 0x27d4eb2d) ^ seed, 0x9e3779b1) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  // Dvě oktávy, ať okraj není jen plynulá vlna.
  const sample = (scale: number): number => {
    const p = along * scale;
    const i = Math.floor(p);
    const f = p - i;
    const s = f * f * (3 - 2 * f);
    return hash(i) * (1 - s) + hash(i + 1) * s;
  };
  return sample(1.7) * 0.65 + sample(4.3) * 0.35;
}

/** Strana dlaždice: sever, východ, jih, západ (jako maska silnic). */
export const SIDES = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** Šířka pásu v podílu dlaždice, průměr a rozkmit. */
const DEPTH = 0.3;
const WAVE = 0.3;
const STEPS = 10;

/**
 * Pás na straně `side` dlaždice `(x, y)`. Vrací body `(u, v)` mnohoúhelníku
 * a vnitřní okraj (pro prolnutí a pěnu).
 *
 * `taperStart`/`taperEnd`: pás na tom konci nepokračuje na sousední
 * dlaždici, takže se zúží do ztracena.
 */
export function bandShape(
  x: number,
  y: number,
  side: number,
  taperStart: boolean,
  taperEnd: boolean,
  widthScale = 1,
): { polygon: [number, number][]; inner: [number, number][] } {
  // Přímka hranice ve světě a poloha podél ní — ať šum navazuje přes dlaždice.
  const horizontal = side === 0 || side === 2;
  const line = horizontal ? y + (side === 2 ? 1 : 0) : x + (side === 1 ? 1 : 0);
  const base = horizontal ? x : y;
  const inner: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    let depth = (DEPTH + WAVE * (edgeNoise(line, base + t, horizontal ? 11 : 23) - 0.5)) * widthScale;
    if (taperStart) depth *= Math.min(1, t / 0.45);
    if (taperEnd) depth *= Math.min(1, (1 - t) / 0.45);
    inner.push(toUV(side, t, depth));
  }
  const edge: [number, number][] = [toUV(side, 0, 0), toUV(side, 1, 0)];
  return { polygon: [edge[0]!, ...inner, edge[1]!].reverse(), inner };
}

/** Bod na straně `side` v poloze `t` podél ní a hloubce `depth` do dlaždice. */
function toUV(side: number, t: number, depth: number): [number, number] {
  switch (side) {
    case 0:
      return [t, depth];
    case 1:
      return [1 - depth, t];
    case 2:
      return [t, 1 - depth];
    default:
      return [depth, t];
  }
}
