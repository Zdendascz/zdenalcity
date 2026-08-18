import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { tryDowngrade, tryUpgrade } from '../levels';
import { isRciCategory } from '../rci';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Úrovně budov: povýšení, snížení, chátrání a opuštění (§8 zadání fáze 2).
 *
 * Budova povýší, když je kolem ní dost drahá půda, po její kategorii je
 * poptávka a od poslední změny uběhl cooldown. Klesne, když cena půdy spadne
 * pod práh její úrovně o víc než hystereze, a to **několikrát po sobě** —
 * jednorázový výkyv budovu shazovat nemá.
 *
 * Chátrání okolím je v ceně půdy samo. Navíc chátrá **věkem, ale jen při
 * podfinancování**: stará budova v nedostatečně obsloužené buňce dostane
 * penalizaci k efektivní ceně půdy. Plně obsloužená budova nechátrá nikdy.
 */
const INTERVAL = 20;
/** Offset mimo růst (12/2) i cenu půdy (16/5), ze které systém čte. */
const OFFSET = 9;

export function createLevelSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'levels',
    interval: INTERVAL,
    offset: OFFSET,
    run(world: WorldState) {
      // Povýšení pohlcuje sousedy, takže se mapa během běhu mění. Pevné pořadí
      // podle `id` drží výsledek nezávislý na tom, jak se do mapy vkládalo.
      const ids = [...world.buildings.keys()].sort((a, b) => a - b);
      const neglect = neglectPenalty(world, balance);

      for (const id of ids) {
        const building = world.buildings.get(id);
        if (!building || building.abandoned) continue; // ruinu řeší až buldozer

        const definition = catalogue.get(building.definitionId);
        if (!definition || !isRciCategory(definition.category)) continue;
        if (world.tick - building.levelChangedAtTick < balance.levels.cooldown) continue;

        const cell = coarseIndex(building.x, building.y);
        const landValue = (world.coarse.landValue[cell] ?? 0) - neglect(building, cell);

        // Snížení má přednost: chátrající čtvrť nemá růst, i kdyby na horní
        // práh náhodou dosáhla.
        const floor = (balance.levels.thresholds[building.level] ?? 0) - balance.levels.hysteresis;
        if (landValue < floor) {
          const streak = (world.downgradeStreak.get(id) ?? 0) + 1;
          if (streak < balance.levels.downgradeConfirm) {
            world.downgradeStreak.set(id, streak);
            continue;
          }
          world.downgradeStreak.delete(id);
          tryDowngrade(world, catalogue, building);
          continue;
        }
        world.downgradeStreak.delete(id);

        // Bez poptávky nikdo nerozšiřuje. Prázdná čtvrť má růst přestat,
        // i když je půda drahá.
        if (world.demand[definition.category] <= 0) continue;

        const threshold = balance.levels.thresholds[building.level + 1];
        if (threshold === undefined) continue; // nad poslední úrovní není kam růst
        if (landValue < threshold) continue;

        tryUpgrade(world, catalogue, building);
      }
    },
  };
}

/**
 * Penalizace za zanedbanost: **stará budova ve špatně obsloužené buňce**.
 *
 * Obsluhu měříme průměrem přes třídy, které ve městě existují — jedna hasičská
 * zbrojnice tak celou čtvrť nezachrání, ale ani město bez jediné školy nezačne
 * plošně chátrat kvůli té jedné chybějící třídě.
 *
 * Kolik penalizace dělá, je věc balancu (`levels.decayPenalty`) — doplněk
 * zadání, které výši neurčuje.
 */
function neglectPenalty(
  world: WorldState,
  balance: Balance,
): (building: { builtAtTick: number }, cell: number) => number {
  const coverages = [...world.coverage.values()];

  return (building, cell) => {
    if (world.tick - building.builtAtTick < balance.levels.decayAge) return 0;
    if (coverages.length === 0) return balance.levels.decayPenalty;

    let total = 0;
    for (const coverage of coverages) total += coverage[cell] ?? 0;
    const average = total / coverages.length;

    return average < balance.levels.decayCoverageThreshold ? balance.levels.decayPenalty : 0;
  };
}
