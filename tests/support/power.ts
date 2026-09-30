import { WIRE } from '@/sim/layers';
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

/**
 * Položí vedení nízkého napětí pod každou silnici. Pro testy, které stavějí
 * město ulicemi a o síť jim nejde: do T129 vedla proud silnice sama. Nízké,
 * ne vysoké: od T136 vede do bloků jen nízké napětí (vysoké jen přes trafo).
 */
export function wireUnderRoads(world: WorldState): void {
  for (let tile = 0; tile < world.layers.road.length; tile++) {
    if ((world.layers.road[tile] ?? 0) !== 0) world.layers.wire[tile] = WIRE.low;
  }
  world.powerNetworkDirty = true;
}
