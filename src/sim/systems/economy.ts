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
 * **Budova bez proudu nejede: nic nevydělá a nic nestojí.** To je herní důsledek
 * elektřiny — dokud město nemá dost výroby, část čtvrtí je temná a městu
 * nevydělává ani korunu.
 *
 * Že temná budova neplatí ani údržbu, je záměr. Kdyby ji platila, město bez
 * elektrárny by mělo nulový příjem a nenulové výdaje, spadlo by do mínusu
 * a už by na elektrárnu nikdy nevydělalo — past, ze které není cesty ven.
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

        const category = definition.category;
        const isTaxable = isRciCategory(category);

        // Temná budova je mimo provoz — nedaní a nefiguruje ani ve výdajích.
        // Infrastruktura je vždycky připojená, takže se jí to netýká.
        if (isTaxable && !building.powered) continue;

        expenses += definition.economy.upkeep;
        if (!isTaxable) continue;

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
