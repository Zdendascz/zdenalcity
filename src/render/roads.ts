import { TILE_H, TILE_W } from './projection';

/**
 * Auto-tiling silnic. Bitmask sousedů se počítá **v rendereru** — simulace zná
 * jen `road: 0|1` a o tvaru napojení nic neví (P3).
 *
 * N je `(x, y-1)`, tedy směr „nahoru vpravo" po projekci do izometrie.
 */
export const ROAD_N = 1;
export const ROAD_E = 2;
export const ROAD_S = 4;
export const ROAD_W = 8;

export type IsRoad = (x: number, y: number) => boolean;

export function roadMask(isRoad: IsRoad, x: number, y: number): number {
  let mask = 0;
  if (isRoad(x, y - 1)) mask |= ROAD_N;
  if (isRoad(x + 1, y)) mask |= ROAD_E;
  if (isRoad(x, y + 1)) mask |= ROAD_S;
  if (isRoad(x - 1, y)) mask |= ROAD_W;
  return mask;
}

/**
 * Jak velká část dlaždice připadá na středový kus vozovky.
 *
 * Zároveň je to **šířka vozovky**: širší jádro dá širší silnici, takže se tím
 * odlišují typy z §4 fáze 3, aniž by k tomu byla potřeba druhá geometrie.
 */
const CORE_SCALE = 0.5;

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

function towardCenter(
  px: number,
  py: number,
  cx: number,
  cy: number,
  scale: number,
): [number, number] {
  return [cx + (px - cx) * scale, cy + (py - cy) * scale];
}

/**
 * Vozovka jedné dlaždice jako seznam polygonů: středový kus plus jedno rameno
 * na každou stranu, kam silnice pokračuje. Tím vznikne všech 16 variant
 * (slepý konec, rovinka, zatáčka, T, křižovatka) bez jediné hardcoded tabulky.
 *
 * `originX/Y` je horní vrchol diamantu, stejně jako u `gridToScreen`.
 */
export function roadPolygons(
  originX: number,
  originY: number,
  mask: number,
  width: number = CORE_SCALE,
): number[][] {
  const top: [number, number] = [originX, originY];
  const right: [number, number] = [originX + HALF_W, originY + HALF_H];
  const bottom: [number, number] = [originX, originY + TILE_H];
  const left: [number, number] = [originX - HALF_W, originY + HALF_H];
  const [cx, cy] = [originX, originY + HALF_H];

  const topCore = towardCenter(top[0], top[1], cx, cy, width);
  const rightCore = towardCenter(right[0], right[1], cx, cy, width);
  const bottomCore = towardCenter(bottom[0], bottom[1], cx, cy, width);
  const leftCore = towardCenter(left[0], left[1], cx, cy, width);

  const polygons: number[][] = [
    [...topCore, ...rightCore, ...bottomCore, ...leftCore],
  ];

  // Rameno leží mezi zmenšenou a plnou hranou diamantu, takže na sebe
  // sousední dlaždice navazují bez mezery.
  if (mask & ROAD_N) polygons.push([...topCore, ...rightCore, ...right, ...top]);
  if (mask & ROAD_E) polygons.push([...rightCore, ...bottomCore, ...bottom, ...right]);
  if (mask & ROAD_S) polygons.push([...bottomCore, ...leftCore, ...left, ...bottom]);
  if (mask & ROAD_W) polygons.push([...leftCore, ...topCore, ...top, ...left]);

  return polygons;
}
