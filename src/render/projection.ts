/**
 * Izometrická projekce. Existuje **výhradně tady a v pickingu** (P3) —
 * simulace zná jen gridové souřadnice a o obrazovce neví nic.
 */

export const TILE_W = 64; // šířka izometrického diamantu v px
export const TILE_H = 32; // výška diamantu (poměr 2:1)
export const LEVEL_H = 16; // px na jednu výškovou úroveň terénu

export interface Point {
  x: number;
  y: number;
}

/**
 * Vrací **horní vrchol** diamantu dlaždice, ne jeho střed. Zbylé tři vrcholy
 * jsou na (+W/2, +H/2), (0, +H) a (−W/2, +H/2) — viz `diamondPoints`.
 */
export function gridToScreen(x: number, y: number, elevation = 0): Point {
  return {
    x: (x - y) * (TILE_W / 2),
    y: (x + y) * (TILE_H / 2) - elevation * LEVEL_H,
  };
}

/**
 * Inverze `gridToScreen`.
 *
 * **Platí jen pro plochý terén.** Fáze 1 má `elevation` všude 0, takže inverze
 * sedí přesně. Jakmile přibude převýšení, tahle funkce přestane stačit a picking
 * se bude muset dělat testováním dlaždic od předu dozadu (architektura §3).
 * Proto je izolovaná sem a nikdo si ji nepočítá inline.
 */
export function screenToGrid(screenX: number, screenY: number): Point {
  const a = screenX / (TILE_W / 2); // = x - y
  const b = screenY / (TILE_H / 2); // = x + y
  return {
    x: Math.floor((a + b) / 2),
    y: Math.floor((b - a) / 2),
  };
}

export interface CuboidFaces {
  top: number[];
  left: number[];
  right: number[];
}

/**
 * Tři viditelné stěny kvádru budovy o půdorysu `w × h` dlaždic a výšce
 * `heightPx`. Zadní dvě stěny jsou vždy zakryté, takže se nekreslí.
 *
 * Půdorys je čtyřúhelník přes rohy mřížky (x, y) → (x+w, y) → (x+w, y+h) →
 * (x, y+h); pro 1×1 vyjde přesně diamant dlaždice.
 */
export function cuboidFaces(
  x: number,
  y: number,
  w: number,
  h: number,
  heightPx: number,
): CuboidFaces {
  const back = gridToScreen(x, y);
  const right = gridToScreen(x + w, y);
  const front = gridToScreen(x + w, y + h);
  const left = gridToScreen(x, y + h);

  const lifted = (point: Point): [number, number] => [point.x, point.y - heightPx];
  const ground = (point: Point): [number, number] => [point.x, point.y];

  return {
    top: [...lifted(back), ...lifted(right), ...lifted(front), ...lifted(left)],
    right: [...lifted(right), ...lifted(front), ...ground(front), ...ground(right)],
    left: [...lifted(front), ...lifted(left), ...ground(left), ...ground(front)],
  };
}

/**
 * Čtyři vrcholy diamantu jako plochý seznam souřadnic pro `Graphics.poly`.
 * `originX/Y` je horní vrchol.
 */
export function diamondPoints(originX: number, originY: number): number[] {
  return [
    originX,
    originY,
    originX + TILE_W / 2,
    originY + TILE_H / 2,
    originX,
    originY + TILE_H,
    originX - TILE_W / 2,
    originY + TILE_H / 2,
  ];
}
