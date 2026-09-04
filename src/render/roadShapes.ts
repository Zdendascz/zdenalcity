import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from '@/sim/roads';

/**
 * Který obrázek a jak otočený nakreslit pro danou bitmasku sousedů.
 *
 * Šestnáct masek, ale **sedm obrázků**. Dlaždice se dá překlopit vodorovně
 * (v mřížce prohodit `x` a `y`) a svisle (otočit obojí); ty dva pohyby dávají
 * čtyřprvkovou grupu a šestnáct masek se v ní rozpadne na sedm oběžných drah.
 *
 * Není to úspora, ale **záruka**: rovinka na sever a rovinka na východ jsou
 * doslova tentýž obrázek, takže se nemůžou rozejít v šířce ani v odstínu.
 * Přesně na tom padla první sada, kde mělo 42 ze 64 dlaždic vozovku jinde.
 */

/** Vodorovné překlopení = prohodit `x` a `y`: sever ↔ západ, východ ↔ jih. */
function flipX(mask: number): number {
  let out = 0;
  if (mask & ROAD_N) out |= ROAD_W;
  if (mask & ROAD_W) out |= ROAD_N;
  if (mask & ROAD_E) out |= ROAD_S;
  if (mask & ROAD_S) out |= ROAD_E;
  return out;
}

/** Svislé překlopení = otočit obě osy: sever ↔ jih, východ ↔ západ. */
function flipY(mask: number): number {
  let out = 0;
  if (mask & ROAD_N) out |= ROAD_S;
  if (mask & ROAD_S) out |= ROAD_N;
  if (mask & ROAD_E) out |= ROAD_W;
  if (mask & ROAD_W) out |= ROAD_E;
  return out;
}

/** Jméno tvaru z bitmasky: písmena v pořadí n, e, s, w. Prázdná je `0`. */
export function shapeName(mask: number): string {
  let name = '';
  if (mask & ROAD_N) name += 'n';
  if (mask & ROAD_E) name += 'e';
  if (mask & ROAD_S) name += 's';
  if (mask & ROAD_W) name += 'w';
  return name === '' ? '0' : name;
}

/**
 * Sedm obrázků, které se generují. Zbytek z nich vznikne překlopením.
 *
 * Zástupci jsou vybraní tak, jak vyšly z generátoru — na tom, který ze dvou
 * tvarů v oběžné dráze se nakreslí, nezáleží. Jméno ale záleží: písmena jdou
 * vždycky v pořadí `n, e, s, w`, jak je skládá `shapeName`. Zástupce
 * pojmenovaný `wn` by se nenašel nikdy, protože takové jméno nevznikne.
 */
export const ROAD_SHAPES = ['0', 'ew', 'ne', 'nesw', 'new', 'nw', 'w'] as const;

const SHAPES = new Set<string>(ROAD_SHAPES);

/** Co se má nakreslit: jméno obrázku a jestli ho překlopit. */
export interface RoadPiece {
  shape: string;
  flipX: boolean;
  flipY: boolean;
}

/**
 * Najde obrázek pro masku. Zkouší čtyři polohy a bere první, která sedí.
 *
 * Vrátit `undefined` nemůže: sedm oběžných drah pokrývá všech šestnáct masek.
 * Kontrola tu přesto je — kdyby někdo ze seznamu zástupce vyhodil, ať se to
 * pozná jako chybějící silnice, ne jako tiše špatný tvar.
 */
export function roadPiece(mask: number): RoadPiece | undefined {
  const bits = mask & (ROAD_N | ROAD_E | ROAD_S | ROAD_W);

  for (const [x, y] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    let turned = bits;
    if (x) turned = flipX(turned);
    if (y) turned = flipY(turned);
    const name = shapeName(turned);
    if (SHAPES.has(name)) return { shape: name, flipX: x, flipY: y };
  }

  return undefined;
}
