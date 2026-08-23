import { coarseIndex } from '../coarse';
import { index, inBounds } from '../layers';
import type { WorldState } from '../world';

/**
 * Tvary zásahu katastrof (R13 fáze 4).
 *
 * Každá katastrofa má vlastní mechaniku — tornádo je pohyb v čase, nepokoje
 * stav, oheň šíření — ale **kam** dopadnou, se popisuje jednotně. Bez toho by
 * si každá z patnácti nesla vlastní verzi „projdi okolí bodu" a lišily by se
 * v tom, jestli počítají vzdálenost eukleidovsky, nebo po šachovnici.
 *
 * Souřadnice jsou gridové (P3). O obrazovce tenhle soubor neví.
 */

export type Shape =
  /** Jediná dlaždice. */
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  /** Kruh o poloměru v dlaždicích, měřeno eukleidovsky od středu. */
  | { readonly kind: 'radius'; readonly x: number; readonly y: number; readonly radius: number }
  /**
   * Pás od bodu k bodu o dané šířce — dráha tornáda, koryto sesuvu.
   * Šířka je poloměr kolmo na osu, takže `width: 1` je pás tří dlaždic.
   */
  | {
      readonly kind: 'band';
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
      readonly width: number;
    }
  /**
   * Celá mapa, ale jen každá `sample`-tá dlaždice.
   *
   * Zemětřesení ani epidemie nezasáhnou všech 262 144 dlaždic velké mapy —
   * vzorkování je zároveň mechanika (škody jsou roztroušené) a zároveň to,
   * co drží cenu jednoho zásahu nezávislou na velikosti mapy.
   */
  | { readonly kind: 'global'; readonly sample: number };

/** Zúžení tvaru na to, co hráč postavil, nebo na druh terénu. */
export interface ShapeFilter {
  /** Jen tyhle zóny. Prázdné pole nebo `undefined` znamená „nefiltruj". */
  readonly zones?: readonly number[];
  readonly terrain?: readonly number[];
  /** Jen dlaždice, na kterých stojí budova. */
  readonly builtOnly?: boolean;
  /** Jen dlaždice se silnicí. */
  readonly roadOnly?: boolean;
}

/**
 * Dlaždice tvaru, **vzestupně podle indexu**.
 *
 * Pořadí je součástí determinismu: katastrofy losují z tohohle seznamu a jiné
 * pořadí by při stejném seedu dalo jiné město (P2).
 */
export function tilesOf(world: WorldState, shape: Shape, filter?: ShapeFilter): number[] {
  const tiles: number[] = [];
  const size = world.size;

  switch (shape.kind) {
    case 'point': {
      if (inBounds(shape.x, shape.y, size)) tiles.push(index(shape.x, shape.y, size));
      break;
    }
    case 'radius': {
      const reach = Math.ceil(shape.radius);
      const squared = shape.radius * shape.radius;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if (dx * dx + dy * dy > squared) continue;
          const x = shape.x + dx;
          const y = shape.y + dy;
          if (inBounds(x, y, size)) tiles.push(index(x, y, size));
        }
      }
      break;
    }
    case 'band': {
      collectBand(tiles, world, shape);
      break;
    }
    case 'global': {
      const step = Math.max(1, Math.floor(shape.sample));
      for (let tile = 0; tile < size * size; tile += step) tiles.push(tile);
      break;
    }
  }

  // Netřídí se: **každá větev generuje vzestupně už sama** — vnější smyčka jde
  // po řádcích, vnitřní po sloupcích, globální tvar po krocích. Řadit to znovu
  // by byl mrtvý kód, který se nedá porušit a tím pádem ani otestovat. Že to
  // pořadí platí, hlídá test nad všemi čtyřmi tvary; kdo přidá pátý, musí ho
  // splnit taky, protože katastrofy z tohohle seznamu losují (P2).
  return filter ? tiles.filter((tile) => matches(world, tile, filter)) : tiles;
}

/**
 * Pás kolem úsečky.
 *
 * Vzdálenost se počítá k **úsečce**, ne k přímce — jinak by tornádo ničilo
 * i za svým koncem. Kandidáti se berou z obdélníku kolem úsečky, což je pár
 * set dlaždic i u dráhy přes celou mapu.
 */
function collectBand(
  tiles: number[],
  world: WorldState,
  shape: Extract<Shape, { kind: 'band' }>,
): void {
  const size = world.size;
  const { fromX, fromY, toX, toY, width } = shape;
  const reach = Math.ceil(width);

  const minX = Math.max(0, Math.min(fromX, toX) - reach);
  const maxX = Math.min(size - 1, Math.max(fromX, toX) + reach);
  const minY = Math.max(0, Math.min(fromY, toY) - reach);
  const maxY = Math.min(size - 1, Math.max(fromY, toY) + reach);

  const dx = toX - fromX;
  const dy = toY - fromY;
  const lengthSquared = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Průmět bodu na úsečku, oříznutý na její konce.
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - fromX) * dx + (y - fromY) * dy) / lengthSquared));
      const nearX = fromX + t * dx;
      const nearY = fromY + t * dy;
      const distance = (x - nearX) ** 2 + (y - nearY) ** 2;
      if (distance <= width * width) tiles.push(index(x, y, size));
    }
  }
}

function matches(world: WorldState, tile: number, filter: ShapeFilter): boolean {
  if (filter.zones && filter.zones.length > 0) {
    if (!filter.zones.includes(world.layers.zone[tile] ?? 0)) return false;
  }
  if (filter.terrain && filter.terrain.length > 0) {
    if (!filter.terrain.includes(world.layers.terrain[tile] ?? 0)) return false;
  }
  if (filter.builtOnly && (world.layers.buildingId[tile] ?? 0) === 0) return false;
  if (filter.roadOnly && (world.layers.road[tile] ?? 0) === 0) return false;
  return true;
}

/** Buňky hrubé mřížky, kterých se tvar dotkne. Pro efekty, které žijí na ní. */
export function coarseCellsOfShape(world: WorldState, shape: Shape, filter?: ShapeFilter): number[] {
  const cells = new Set<number>();
  for (const tile of tilesOf(world, shape, filter)) {
    const x = tile % world.size;
    cells.add(coarseIndex(x, (tile - x) / world.size, world.size));
  }
  return [...cells].sort((a, b) => a - b);
}
