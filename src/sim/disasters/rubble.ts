import { coarseIndex, coarseSizeOf } from '../coarse';
import { markTileDirty } from '../world';
import type { WorldState } from '../world';

/**
 * Trosky (R15 fáze 4).
 *
 * **Vrstva, ne stav budovy** — a je to rozhodnutí, ne detail. Trosky zůstanou
 * i tam, kde žádná budova nestála: po zničené silnici, po prokopaném potrubí,
 * po dlaždici, kterou přejelo tornádo. Kdyby byly příznakem budovy, půlka
 * katastrof by po sobě neuklidila vůbec nic.
 *
 * Chovají se jako opuštěné budovy z fáze 2: srážejí cenu půdy a živí
 * kriminalitu. Hlavně ale **blokují stavbu**, dokud je hráč nezbourá — z toho
 * plyne jediná věc, kterou po katastrofě musí zaplatit, a tím pádem i
 * rozhodnutí, kterou čtvrť obnovit dřív.
 */

/**
 * Zanechá trosky na dlaždici.
 *
 * Bez kontroly, jestli tam už jsou: zapsat jedničku podruhé je totéž co
 * poprvé a `dirty.tiles` je množina, takže se ani překreslení nezdvojí.
 * Stráž by byla řádek, který nejde porušit — a tím pádem ani otestovat.
 */
export function spawnRubble(world: WorldState, tile: number): void {
  world.rubble[tile] = 1;
  markTileAt(world, tile);
}

/** Uklidí trosky. Cenu řeší volající — tady se jen zapisuje. */
export function clearRubble(world: WorldState, tile: number): void {
  if ((world.rubble[tile] ?? 0) === 0) return;
  world.rubble[tile] = 0;
  markTileAt(world, tile);
}

export function hasRubble(world: WorldState, tile: number): boolean {
  return (world.rubble[tile] ?? 0) !== 0;
}

/**
 * Kolik trosek leží v které buňce hrubé mřížky.
 *
 * Cena půdy i kriminalita žijí na hrubé mřížce, trosky na plné. Průchod se
 * dělá **jednou za běh** a výsledek se předá dál; kdyby si ho každá z 16 384
 * buněk počítala sama, byl by z toho průchod čtvrt milionem dlaždic pro každou.
 */
export function rubblePerCell(world: WorldState): Float32Array {
  const coarse = coarseSizeOf(world.size);
  const counts = new Float32Array(coarse * coarse);

  for (let tile = 0; tile < world.rubble.length; tile++) {
    if ((world.rubble[tile] ?? 0) === 0) continue;
    const x = tile % world.size;
    const cell = coarseIndex(x, (tile - x) / world.size, world.size);
    counts[cell] = (counts[cell] ?? 0) + 1;
  }

  return counts;
}

function markTileAt(world: WorldState, tile: number): void {
  const x = tile % world.size;
  markTileDirty(world, x, (tile - x) / world.size);
}
