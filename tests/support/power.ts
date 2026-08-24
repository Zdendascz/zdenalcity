import type { WorldState } from '@/sim/world';

/**
 * Rozsvítí všechny budovy ve světě.
 *
 * Od T53 platí, že **temná služba nepokrývá** (katalog 12). Testy, které
 * zkoumají něco jiného než elektřinu, si kvůli tomu nemusí stavět elektrárnu —
 * zapnou proud rovnou a měří to, o co jim jde.
 *
 * Volá se **před** přepočtem pokrytí; `serviceSystem` čte `powered` v tom
 * okamžiku, kdy běží.
 */
export function powerAll(world: WorldState): void {
  let changed = false;
  for (const building of world.buildings.values()) {
    if (building.powered) continue;
    building.powered = true;
    changed = true;
  }
  // Změna proudu je změnou pokrytí — stejně jako v `powerSystem`. Značí se jen
  // při skutečné změně, jinak by pomocník rozbil testy, které ověřují, že se
  // pokrytí počítá **jen** při změně.
  if (changed) world.coverageDirty = true;
}
