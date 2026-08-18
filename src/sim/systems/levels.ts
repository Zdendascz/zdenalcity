import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { tryUpgrade } from '../levels';
import { isRciCategory } from '../rci';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Povyšování budov (§8 zadání fáze 2).
 *
 * Budova povýší, když je kolem ní dost drahá půda, po její kategorii je
 * poptávka a od poslední změny uběhl cooldown. Co se stane pak — jestli se
 * rozšíří do souseda, nebo vyroste o patro — rozhoduje `tryUpgrade` podle toho,
 * co katalog nabízí.
 *
 * Snížení úrovně, chátrání a opuštění patří k T17.
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

      for (const id of ids) {
        const building = world.buildings.get(id);
        if (!building) continue; // pohlcena jinou budovou v tomhle běhu

        const definition = catalogue.get(building.definitionId);
        if (!definition || !isRciCategory(definition.category)) continue;

        // Bez poptávky nikdo nerozšiřuje. Prázdná čtvrť má růst přestat,
        // i když je půda drahá.
        if (world.demand[definition.category] <= 0) continue;
        if (world.tick - building.levelChangedAtTick < balance.levels.cooldown) continue;

        const threshold = balance.levels.thresholds[building.level + 1];
        if (threshold === undefined) continue; // nad poslední úrovní není kam růst

        const landValue = world.coarse.landValue[coarseIndex(building.x, building.y)] ?? 0;
        if (landValue < threshold) continue;

        tryUpgrade(world, catalogue, building);
      }
    },
  };
}
