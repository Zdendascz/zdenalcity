import { coarseIndex, coarseSizeOf } from '../coarse';
import { markNetworksDirty, markTileDirty } from '../world';
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
 *
 * `definitionId` je **co na dlaždici stálo**. Zapisuje se do `rubbleOf`, aby
 * hráč po katastrofě poznal, že tady byla nemocnice, a ne jen že tu je hromada
 * suti. Nahlásil to autor: po vyhořelém městě se nedalo zjistit, co kde bylo,
 * takže obnova byla hádání. Silnice ani potrubí id nemají a nepotřebují —
 * hromada po silnici vypadá jako hromada a hráč silnici najde podle sousedů.
 */
export function spawnRubble(world: WorldState, tile: number, definitionId?: string): void {
  world.rubble[tile] = 1;
  // Pobořená parcela nevede proud ani vodu (T129).
  markNetworksDirty(world);
  if (definitionId !== undefined) world.rubbleOf.set(tile, definitionId);
  markTileAt(world, tile);
}

/** Uklidí trosky. Cenu řeší volající — tady se jen zapisuje. */
export function clearRubble(world: WorldState, tile: number): void {
  if ((world.rubble[tile] ?? 0) === 0) return;
  world.rubble[tile] = 0;
  markNetworksDirty(world);
  // Paměť odchází s troskami. Kdyby zůstala, prázdná parcela by se pořád
  // hlásila jako bývalá nemocnice.
  world.rubbleOf.delete(tile);
  markTileAt(world, tile);
}

/** Co na téhle dlaždici stálo, než ji katastrofa srovnala. */
export function rubbleWas(world: WorldState, tile: number): string | undefined {
  return (world.rubble[tile] ?? 0) === 0 ? undefined : world.rubbleOf.get(tile);
}

/**
 * Je tahle dlaždice levý horní roh bloku trosek po téže budově?
 *
 * Značku „tady stála nemocnice" nese jen roh. Nemocnice po sobě nechá devět
 * hromad a devět křížků by z toho udělalo mřížku, ze které se nepozná, jestli
 * padla jedna velká budova nebo devět malých.
 *
 * Roh se pozná tím, že soused nahoře ani vlevo nenese totéž id — žádný extra
 * stav to nepotřebuje. Dva stejné domy vedle sebe splynou v jeden blok; je to
 * cena za to, že se nikde nevede, kde budova začínala.
 */
export function isRubbleMarkOrigin(
  rubbleOf: ReadonlyMap<number, string>,
  tile: number,
  size: number,
): boolean {
  const was = rubbleOf.get(tile);
  if (was === undefined) return false;

  const x = tile % size;
  const y = (tile - x) / size;
  if (x > 0 && rubbleOf.get(tile - 1) === was) return false;
  if (y > 0 && rubbleOf.get(tile - size) === was) return false;
  return true;
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
