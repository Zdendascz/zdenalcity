import { MAP_SIZE } from './layers';

/**
 * Hrubá mřížka pro difuzní vrstvy (fáze 2, §2 zadání).
 *
 * Jedna buňka na 4×4 dlaždice. Difuze na plné mřížce by znamenala 16 384 buněk
 * krát osm sousedů krát dva průchody každých osm tiků; na hrubé mřížce je to
 * šestnáctina práce a pro veličiny, které se mění po čtvrtích, je to dost jemné.
 *
 * Odchylka od architektury §4, kde jsou tyhle vrstvy vedené v plném rozlišení —
 * schválená autorem v zadání fáze 2.
 */

export const COARSE_FACTOR = 4;
export const COARSE_SIZE = MAP_SIZE / COARSE_FACTOR; // 32
export const COARSE_CELLS = COARSE_SIZE * COARSE_SIZE;

/** Buňka hrubé mřížky pro dlaždici v plném rozlišení. */
export function coarseIndex(x: number, y: number): number {
  return ((y / COARSE_FACTOR) | 0) * COARSE_SIZE + ((x / COARSE_FACTOR) | 0);
}

export function coarseInBounds(cellX: number, cellY: number): boolean {
  return cellX >= 0 && cellY >= 0 && cellX < COARSE_SIZE && cellY < COARSE_SIZE;
}

/**
 * Vrstvy na hrubé mřížce. Přibývají po úkolech: `landValue` v T12, `crime` v T13.
 * Pokrytí službami se sem nikdy nedostane — je odvozené a nepatří ani do savu.
 */
export interface CoarseLayers {
  pollution: Uint8Array;
  landValue: Uint8Array;
}

/** Pevné pořadí pro hashování. Stejný důvod jako u `LAYER_ORDER` v `layers.ts`. */
export const COARSE_LAYER_ORDER = [
  'pollution',
  'landValue',
] as const satisfies readonly (keyof CoarseLayers)[];

export type ReadonlyCoarseLayers = { readonly [K in keyof CoarseLayers]: Readonly<CoarseLayers[K]> };

export function createCoarseLayers(): CoarseLayers {
  return { pollution: new Uint8Array(COARSE_CELLS), landValue: new Uint8Array(COARSE_CELLS) };
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a přes hrubé vrstvy. Vlastní hash vedle `hashLayers`, protože jde
 * o jinou mřížku — determinismus fáze 2 se ověřuje obojím.
 */
export function hashCoarseLayers(layers: ReadonlyCoarseLayers): string {
  let hash = FNV_OFFSET_BASIS;

  for (const name of COARSE_LAYER_ORDER) {
    for (let i = 0; i < name.length; i++) {
      hash = Math.imul(hash ^ name.charCodeAt(i), FNV_PRIME);
    }
    for (const value of layers[name]) {
      hash = Math.imul(hash ^ value, FNV_PRIME);
    }
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
