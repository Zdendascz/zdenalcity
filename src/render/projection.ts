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
 *
 * Souřadnice smí být lomené: `gridToScreen(x + 0.5, y)` je bod uprostřed
 * severní hrany. Toho využívá kreslení budov i symbolů.
 */
export function gridToScreen(x: number, y: number, elevation = 0): Point {
  return {
    x: (x - y) * (TILE_W / 2),
    y: (x + y) * (TILE_H / 2) - elevation * LEVEL_H,
  };
}

/**
 * Čtyřúhelník dlaždice ze **čtyř výšek jejích rohů** (§7 fáze 3).
 *
 * Tohle je ta změna, kvůli které přestal stačit pravidelný diamant: každý roh
 * se zvedne o svou vlastní výšku, takže dlaždice se nakloní. Sousední dlaždice
 * sdílí rohy, a protože se počítají ze stejných čísel, terén nikde nepraskne.
 *
 * Pořadí je sever → východ → jih → západ, tedy obvod dokola; `Graphics.poly`
 * nic jiného nepřijme.
 */
export function tileQuad(
  x: number,
  y: number,
  corners: readonly [number, number, number, number],
): number[] {
  return areaQuad(x, y, 1, 1, corners);
}

/**
 * Totéž pro obdélník `w × h` dlaždic — půdorys budovy nebo buňka hrubé mřížky.
 * Rohy jsou v pořadí severozápad, severovýchod, jihozápad, jihovýchod.
 */
export function areaQuad(
  x: number,
  y: number,
  w: number,
  h: number,
  corners: readonly [number, number, number, number],
): number[] {
  const [nw, ne, sw, se] = corners;
  const north = gridToScreen(x, y, nw);
  const east = gridToScreen(x + w, y, ne);
  const south = gridToScreen(x + w, y + h, se);
  const west = gridToScreen(x, y + h, sw);
  return [north.x, north.y, east.x, east.y, south.x, south.y, west.x, west.y];
}

/**
 * O kolik ztmavit nebo zesvětlit dlaždici podle sklonu.
 *
 * Bez tohohle by se svah od roviny nedal rozeznat: obě plochy mají stejnou
 * barvu terénu a izometrie nemá perspektivu, která by tvar prozradila.
 * Světlo svítí od severozápadu, takže plochy nakloněné k pozorovateli
 * (na jih a na východ) jsou světlejší a odvrácené tmavší.
 *
 * Vrací násobitel kolem jedničky, ne barvu — mísení barev patří do palety.
 */
export function slopeLight(corners: readonly [number, number, number, number], strength = 0.14): number {
  const [nw, ne, sw, se] = corners;
  const southFall = (sw + se) / 2 - (nw + ne) / 2;
  const eastFall = (ne + se) / 2 - (nw + sw) / 2;
  // Průměr obou spádů, ať se úhlopříčný svah nepočítá dvakrát.
  return 1 + ((southFall + eastFall) / 2) * strength;
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

/**
 * Obdélníková oblast mřížky `w × h` od `(x, y)` jako čtyřúhelník na zemi.
 * Pro 1×1 vyjde přesně diamant dlaždice.
 */
export function footprintQuad(x: number, y: number, w: number, h: number, base = 0): number[] {
  const back = gridToScreen(x, y, base);
  const right = gridToScreen(x + w, y, base);
  const front = gridToScreen(x + w, y + h, base);
  const left = gridToScreen(x, y + h, base);
  return [back.x, back.y, right.x, right.y, front.x, front.y, left.x, left.y];
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
  base = 0,
): CuboidFaces {
  const back = gridToScreen(x, y, base);
  const right = gridToScreen(x + w, y, base);
  const front = gridToScreen(x + w, y + h, base);
  const left = gridToScreen(x, y + h, base);

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
