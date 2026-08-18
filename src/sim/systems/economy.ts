import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from '../catalogue';
import { isRciCategory } from '../rci';
import type { Building, WorldState } from '../world';
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

/** Jeden řádek rozpočtu — jedna definice budovy. */
export interface BudgetLine {
  definitionId: string;
  /** Lokalizační klíč jména budovy. */
  nameKey: string;
  count: number;
  poweredCount: number;
  income: number;
  upkeep: number;
}

export interface Budget {
  lines: BudgetLine[];
  income: number;
  expenses: number;
}

/**
 * Kolik daně odvede jedna budova za měsíc. Sdílí to rozpočet i detail budovy
 * v UI, aby daňový vzorec existoval jen na jednom místě.
 */
export function buildingMonthlyTax(
  world: WorldState,
  definition: Definition,
  building: Building,
): number {
  const category = definition.category;
  if (!isRciCategory(category) || !building.powered) return 0;

  const taxable = category === 'residential' ? building.population : building.jobs;
  return Math.round((taxable * TAXABLE_VALUE_PER_UNIT * world.economy.taxRates[category]) / 100);
}

/** Platí budova údržbu? Temná budova je mimo provoz, takže ne. */
export function buildingMonthlyUpkeep(definition: Definition, building: Building): number {
  if (isRciCategory(definition.category) && !building.powered) return 0;
  return definition.economy.upkeep;
}

/**
 * Rozpad měsíčního rozpočtu po definicích.
 *
 * Sdílí ho `economySystem` i tabulka v UI, aby daňový vzorec existoval jen
 * na jednom místě — jinak by se výpis a skutečnost dřív nebo později rozešly.
 */
export function computeBudget(world: WorldState, catalogue: BuildingCatalogue): Budget {
  const byDefinition = new Map<string, BudgetLine>();
  let income = 0;
  let expenses = 0;

  for (const building of world.buildings.values()) {
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;

    let line = byDefinition.get(definition.id);
    if (!line) {
      line = {
        definitionId: definition.id,
        nameKey: definition.name,
        count: 0,
        poweredCount: 0,
        income: 0,
        upkeep: 0,
      };
      byDefinition.set(definition.id, line);
    }

    line.count++;
    if (building.powered) line.poweredCount++;

    const upkeep = buildingMonthlyUpkeep(definition, building);
    const tax = buildingMonthlyTax(world, definition, building);

    line.upkeep += upkeep;
    line.income += tax;
    expenses += upkeep;
    income += tax;
  }

  return {
    // Stabilní pořadí, ať tabulka neposkakuje.
    lines: [...byDefinition.values()].sort((a, b) => a.definitionId.localeCompare(b.definitionId)),
    income,
    expenses,
  };
}

export function createEconomySystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'economy',
    interval: 30,
    offset: 0,
    run(world: WorldState) {
      const budget = computeBudget(world, catalogue);
      world.economy.lastIncome = budget.income;
      world.economy.lastExpenses = budget.expenses;
      world.economy.funds += budget.income - budget.expenses;
    },
  };
}
