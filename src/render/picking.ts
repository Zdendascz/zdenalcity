import { MAX_HEIGHT, tileCorners } from '@/sim/heights';
import type { Camera } from './camera';
import { viewportToWorld } from './camera';
import type { Point } from './projection';
import { LEVEL_H, TILE_H, TILE_W, tileQuad } from './projection';

/**
 * Picking s převýšením (§7 zadání fáze 3).
 *
 * `screenToGrid` z fáze 1 tady **končí**. Byla to inverze projekce, jenže ta
 * je jednoznačná jen na ploché mapě: jakmile má každý roh vlastní výšku, jeden
 * bod na obrazovce může patřit několika dlaždicím nad sebou a inverze nemá co
 * vracet. Zadání proto předepisuje nahrazení, ne opravu.
 *
 * Nový postup: procházej dlaždice **od nejbližší k pozorovateli dozadu** a ptej
 * se, jestli kurzor leží uvnitř promítnutého čtyřúhelníku. První zásah vyhrává —
 * je to přesně ta dlaždice, kterou hráč vidí.
 *
 * Nezkouší se celá mapa. Zvednutá dlaždice se na obrazovce posune **nahoru**
 * přesně o patro na výškovou úroveň, a protože `LEVEL_H` je půlka `TILE_H`,
 * je to zároveň posun o jedna v součtu `x + y`. Kandidáti proto leží v pásu
 * `x + y ∈ [odhad, odhad + MAX_HEIGHT]`. Rozdíl `x − y` výška nemění vůbec,
 * takže ten pás je úzký a testů je pár desítek.
 */

/** Kolik dlaždic na každou stranu od odhadu se ještě zkouší. */
const DIAGONAL_SLACK = 1;
/** O kolik se sahá pod odhad hloubky — kvůli zaokrouhlení a výšce dlaždice. */
const DEPTH_SLACK = 2;

export function pickTile(
  camera: Camera,
  viewX: number,
  viewY: number,
  viewWidth: number,
  viewHeight: number,
  mapSize: number,
  heights: Readonly<Uint8Array>,
): Point | null {
  const world = viewportToWorld(camera, viewX, viewY, viewWidth, viewHeight);

  // `diagonal` = x − y, `depth` = x + y na ploché mapě. Výška `diagonal`
  // nemění vůbec, `depth` posouvá o patro na výškovou úroveň.
  const diagonal = world.x / (TILE_W / 2);
  const depth = world.y / (TILE_H / 2);
  const levelsPerDepth = LEVEL_H / (TILE_H / 2);

  const highest = Math.floor(depth + MAX_HEIGHT * levelsPerDepth) + 1;
  const lowest = Math.floor(depth) - DEPTH_SLACK;

  // Sestupně podle součtu = od nejbližší dlaždice dozadu. První zásah vyhrává.
  for (let sum = highest; sum >= lowest; sum--) {
    // `x − y` musí mít stejnou paritu jako `x + y`, jinak by vyšly půlky
    // dlaždic. Odhad se proto zarovná a sousedi se berou po dvou — to jsou
    // právě dlaždice na téže protiúhlopříčce.
    const estimate = Math.round(diagonal);
    const aligned = ((estimate + sum) & 1) === 0 ? estimate : estimate - 1;

    for (let slack = -DIAGONAL_SLACK; slack <= DIAGONAL_SLACK; slack++) {
      const difference = aligned + slack * 2;
      const x = (sum + difference) / 2;
      const y = (sum - difference) / 2;
      if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) continue;

      if (containsPoint(tileQuad(x, y, tileCorners(heights, x, y)), world.x, world.y)) {
        return { x, y };
      }
    }
  }

  return null;
}

/**
 * Leží bod uvnitř čtyřúhelníku? Klasický ray casting.
 *
 * Nestačí test na konvexní tvar: zkroucená dlaždice (sedlo) se do izometrie
 * promítne jako nekonvexní čtyřúhelník a hráč na ni musí umět kliknout stejně
 * jako na každou jinou.
 */
export function containsPoint(polygon: readonly number[], px: number, py: number): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length / 2 - 1; i < polygon.length / 2; j = i++) {
    const xi = polygon[i * 2] ?? 0;
    const yi = polygon[i * 2 + 1] ?? 0;
    const xj = polygon[j * 2] ?? 0;
    const yj = polygon[j * 2 + 1] ?? 0;

    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}
