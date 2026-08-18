import type { BuildingCatalogue } from '../catalogue';
import { isRciCategory } from '../rci';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Měsíční rozpočet. 30 tiků = měsíc (§5).
 *
 * Daň se počítá z toho, co budova opravdu drží: u obytné z populace, u ostatních
 * z pracovních míst. Infrastruktura se nedaní, ale svou údržbu platí.
 *
 * Elektřina do rozpočtu **nezasahuje** — viz poznámka v PROGRESS.md.
 */

/** Kolik peněz za měsíc vynese jeden obyvatel nebo jedno pracovní místo při 100 %. */
const TAXABLE_VALUE_PER_UNIT = 40;

export function createEconomySystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'economy',
    interval: 30,
    offset: 0,
    run(world: WorldState) {
      let income = 0;
      let expenses = 0;

      for (const building of world.buildings.values()) {
        const definition = catalogue.get(building.definitionId);
        if (!definition) continue;

        expenses += definition.economy.upkeep;

        const category = definition.category;
        if (!isRciCategory(category)) continue;

        const taxable = category === 'residential' ? building.population : building.jobs;
        const rate = world.economy.taxRates[category];
        income += Math.round((taxable * TAXABLE_VALUE_PER_UNIT * rate) / 100);
      }

      world.economy.lastIncome = income;
      world.economy.lastExpenses = expenses;
      world.economy.funds += income - expenses;
    },
  };
}
