import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from './catalogue';
import { cityUtilities, coarseCongestion } from './diagnostics';
import { strongestModifier } from './disasters/effects';
import { populationPerCell } from './disasters/unrest';
import { ledgerTotal } from './ledger';
import { taxPenalty } from './systems/happiness';
import { computeBudget } from './systems/economy';
import type { WorldState } from './world';

/**
 * Z čeho se skládá číslo v liště (§12).
 *
 * Zadání autora: „u statistik by bylo fajn, kdyby šlo každou z hodnot
 * rozkliknout a naskočí tabulka, z čeho se čísla skládají — jeden sloupec
 * plus, druhý mínus, na konci souhrn."
 *
 * Rozpis se počítá **stejnými cestami jako to číslo samo**: rozpočet z
 * `computeBudget`, kapacity z `cityUtilities`, kasa z účetní knihy. Vlastní
 * paralelní součet by se s lištou po první změně pravidel rozešel a hráč by
 * měl dvě čísla, ze kterých ani jedno nemůže věřit.
 *
 * Vrací **klíče a čísla, ne věty** (§10): `label` je buď lokalizační klíč
 * hry, nebo jméno definice z obsahu.
 */

export interface StatRow {
  /** Lokalizační klíč popisku. U budov je to `definition.name`. */
  label: string;
  value: number;
}

export interface StatBreakdown {
  plus: StatRow[];
  minus: StatRow[];
  /** Souhrn, který se má rovnat tomu, co je v liště. */
  total: number;
  /** Doplňující věta pod tabulkou, když má co dodat. */
  note?: { key: string; params: Record<string, number | string> };
}

/** Které hodnoty v liště se dají rozkliknout. */
export const EXPLAINED_STATS = [
  'funds',
  'balance',
  'population',
  'jobs',
  'happiness',
  'powered',
  'power',
  'waste',
  'sewage',
  'water',
] as const;

export type ExplainedStat = (typeof EXPLAINED_STATS)[number];

export function explainStat(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  key: ExplainedStat,
): StatBreakdown {
  switch (key) {
    case 'funds':
      return explainFunds(world);
    case 'balance':
      return explainBalance(world, catalogue, balance);
    case 'population':
      return byDefinition(world, catalogue, (building) => building.population);
    case 'jobs':
      return byDefinition(world, catalogue, (building) => building.jobs);
    case 'happiness':
      return explainHappiness(world, balance);
    case 'powered':
      return explainPowered(world);
    case 'power':
      return explainPower(world, catalogue);
    default:
      return explainUtility(world, catalogue, balance, key);
  }
}

/**
 * Kasa: **letošní kniha**, ne stav účtu.
 *
 * Stav účtu je jedno číslo bez rozkladu — z čeho se skládá, se dá říct jedině
 * tak, že se ukáže, co letos přiteklo a co odteklo. Loňský zůstatek je v tom
 * schovaný a poznámka pod tabulkou ho pojmenuje.
 */
function explainFunds(world: WorldState): StatBreakdown {
  const { ledger, funds } = world.economy;
  const plus = rowsOf(ledger.income, 'ui.ledger.');
  const minus = rowsOf(ledger.expenses, 'ui.ledger.');
  return {
    plus,
    minus,
    total: ledgerTotal(ledger.income) - ledgerTotal(ledger.expenses),
    note: { key: 'ui.stat.note.funds', params: { year: ledger.year, funds } },
  };
}

/** Měsíční bilance: přesně to, co spočítal rozpočet. */
function explainBalance(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): StatBreakdown {
  const budget = computeBudget(world, catalogue, balance);
  const income: Record<string, number> = {};
  const expenses: Record<string, number> = {};

  for (const line of budget.lines) {
    const category = catalogue.get(line.definitionId)?.category ?? 'other';
    if (line.income > 0) add(income, `ui.stat.row.${category}`, line.income);
    if (line.upkeep > 0) add(expenses, 'ui.ledger.upkeep.buildings', line.upkeep);
  }
  add(income, 'ui.ledger.fare', budget.transit.income);
  add(expenses, 'ui.ledger.upkeep.roads', budget.roads.upkeep);
  add(expenses, 'ui.ledger.upkeep.transit', budget.transit.upkeep);
  add(expenses, 'ui.ledger.loanPayment', budget.debt.payment);
  add(expenses, 'ui.ledger.bondCoupon', budget.debt.bondPayment);

  /*
   * Souhrn je rozpočet **jak vypadá teď**, ne poslední uzávěrka.
   *
   * V liště visí `lastIncome`/`lastExpenses`, tedy čísla z posledního
   * prvního dne v měsíci. Rozepsat je nejde — rozpočet se po řádcích nikam
   * neukládá, jen se sečte — takže by se muselo buď lhát, nebo mlčet.
   * Vypisuje se tedy dnešní stav a poznámka řekne, že se od lišty může lišit;
   * v rostoucím městě je dnešní vždycky o něco větší.
   */
  return {
    plus: rowsOf(income),
    minus: rowsOf(expenses),
    total: budget.income - budget.expenses,
    note: { key: 'ui.stat.note.balance', params: {} },
  };
}

/** Obyvatelé a práce: po budovách, protože jinde nevznikají. */
function byDefinition(
  world: WorldState,
  catalogue: BuildingCatalogue,
  pick: (building: { population: number; jobs: number }) => number,
): StatBreakdown {
  const plus: Record<string, number> = {};
  let idle = 0;
  for (const building of world.buildings.values()) {
    const value = pick(building);
    if (value <= 0) continue;
    // Opuštěná budova se počítá zvlášť: lidé v ní nebydlí a práce v ní není,
    // ale hráč ji na mapě pořád vidí a hledá, kam se čísla poděla.
    if (building.abandoned) {
      idle += value;
      continue;
    }
    const name = catalogue.get(building.definitionId)?.name ?? building.definitionId;
    add(plus, name, value);
  }
  const rows = rowsOf(plus);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    plus: rows,
    minus: idle > 0 ? [{ label: 'ui.stat.row.abandoned', value: idle }] : [],
    total,
  };
}

/**
 * Spokojenost: členy vzorce vážené počtem lidí.
 *
 * Vzorec žije v `systems/happiness.ts` a tady se **opakuje**, což je jediné
 * místo v rozpisech, kde se to děje — systém píše rovnou do vrstvy a mezivýsledky
 * si nikam neukládá. Kdyby se rozešly, pozná se to na součtu: ten musí sedět
 * s průměrem ve vrstvě.
 *
 * Čísla jsou v procentech, ne v surové škále 0–255, protože takhle se
 * spokojenost ukazuje i v liště.
 */
function explainHappiness(world: WorldState, balance: Balance): StatBreakdown {
  const { happiness } = balance;
  const congestion = coarseCongestion(world, balance);
  const perCell = populationPerCell(world);

  let population = 0;
  let jobs = 0;
  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    population += building.population;
    jobs += building.jobs;
  }
  const workers = population * balance.demand.workerRatio;
  const unemployment = workers > 0 ? Math.max(0, Math.min(1, (workers - jobs) / workers)) : 0;

  const plus: Record<string, number> = {};
  const minus: Record<string, number> = {};
  const scale = 100 / 255;

  add(plus, 'ui.stat.row.happiness.base', happiness.base * scale);
  add(minus, 'ui.stat.row.happiness.tax', taxPenalty(balance, world.economy.taxRates.residential) * scale);
  add(minus, 'ui.stat.row.happiness.unemployment', unemployment * happiness.unemployment * scale);

  let people = 0;
  const weighted: Record<string, number> = {};
  for (const [cell, count] of perCell) {
    if (count <= 0) continue;
    people += count;
    for (const [serviceClass, weight] of Object.entries(happiness.weights)) {
      const coverage = world.coverage.get(serviceClass);
      if (!coverage || weight === 0) continue;
      weighted[`ui.service.${serviceClass}`] =
        (weighted[`ui.service.${serviceClass}`] ?? 0) + (coverage[cell] ?? 0) * weight * count;
    }
    weighted['landValue'] =
      (weighted['landValue'] ?? 0) + (world.coarse.landValue[cell] ?? 0) * happiness.landValue * count;
    weighted['pollution'] =
      (weighted['pollution'] ?? 0) + (world.coarse.pollution[cell] ?? 0) * happiness.pollution * count;
    weighted['crime'] =
      (weighted['crime'] ?? 0) + (world.coarse.crime[cell] ?? 0) * happiness.crime * count;
    weighted['congestion'] =
      (weighted['congestion'] ?? 0) + (congestion[cell] ?? 0) * happiness.congestion * count;
    weighted['disaster'] =
      (weighted['disaster'] ?? 0) +
      strongestModifier(world, 'happinessPenalty', cell, 0, undefined, Math.max) * count;
  }

  const share = people > 0 ? scale / people : 0;
  for (const [key, value] of Object.entries(weighted)) {
    const amount = value * share;
    if (amount <= 0) continue;
    if (key === 'landValue') add(plus, 'ui.stat.row.happiness.landValue', amount);
    else if (key.startsWith('ui.service.')) add(plus, key, amount);
    else add(minus, `ui.stat.row.happiness.${key}`, amount);
  }

  // Souhrn je **skutečný průměr ve vrstvě**, ne součet členů: vrstva se
  // k surové hodnotě vyhlazuje, takže po změně daně sedí až za pár měsíců.
  let sum = 0;
  let cells = 0;
  for (const [cell, count] of perCell) {
    if (count <= 0) continue;
    sum += (world.happiness[cell] ?? 0) * count;
    cells += count;
  }
  return {
    plus: rowsOf(plus),
    minus: rowsOf(minus),
    total: cells > 0 ? Math.round((sum / cells) * scale) : 0,
    note: { key: 'ui.stat.note.happiness', params: {} },
  };
}

/** Kolik budov svítí a kolik ne. */
function explainPowered(world: WorldState): StatBreakdown {
  let lit = 0;
  let dark = 0;
  for (const building of world.buildings.values()) {
    if (building.powered) lit++;
    else dark++;
  }
  return {
    plus: [{ label: 'ui.stat.row.powered', value: lit }],
    minus: dark > 0 ? [{ label: 'ui.stat.row.dark', value: dark }] : [],
    total: lit,
  };
}

/** Proud: výroba po elektrárnách, spotřeba po kategoriích. */
function explainPower(world: WorldState, catalogue: BuildingCatalogue): StatBreakdown {
  const plus: Record<string, number> = {};
  const minus: Record<string, number> = {};
  let offline = 0;

  for (const [id, building] of world.buildings) {
    if (building.abandoned) continue;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    const produced = definition.power?.production ?? 0;
    if (produced > 0) {
      // Odstavená elektrárna nevyrábí. Kdyby se počítala, přehled by během
      // výpadku tvrdil, že je proudu dost — přesně to hra dělala do T112.
      if (world.disasters.offlinePlants.has(id)) offline += produced;
      else add(plus, definition.name, produced);
    }
    add(minus, `ui.stat.row.${definition.category}`, definition.power?.consumption ?? 0);
  }
  if (offline > 0) add(minus, 'ui.stat.row.offlinePlants', offline);

  const production = Object.values(plus).reduce((sum, value) => sum + value, 0);
  return { plus: rowsOf(plus), minus: rowsOf(minus), total: production };
}

/** Odpad, kanalizace, voda: kapacita po budovách proti potřebě. */
function explainUtility(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  key: 'waste' | 'sewage' | 'water',
): StatBreakdown {
  const utilities = cityUtilities(world, catalogue, balance);
  const plus: Record<string, number> = {};

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    const capacity =
      key === 'water' ? (definition.water?.production ?? 0) : (definition[key]?.capacity ?? 0);
    if (capacity > 0) add(plus, definition.name, capacity);
  }

  const needed =
    key === 'waste'
      ? utilities.wasteNeeded
      : key === 'sewage'
        ? utilities.sewageNeeded
        : utilities.waterNeeded;
  const capacity =
    key === 'waste'
      ? utilities.wasteCapacity
      : key === 'sewage'
        ? utilities.sewageCapacity
        : utilities.waterCapacity;

  return {
    plus: rowsOf(plus),
    minus: [{ label: `ui.stat.row.need.${key}`, value: needed }],
    total: capacity - needed,
  };
}

function add(into: Record<string, number>, key: string, value: number): void {
  if (value <= 0) return;
  into[key] = (into[key] ?? 0) + value;
}

/** Řádky od největšího. Malé položky dole nikoho nezajímají dřív než ty velké. */
function rowsOf(source: Record<string, number>, prefix = ''): StatRow[] {
  return Object.entries(source)
    .map(([label, value]) => ({ label: prefix + label, value: Math.round(value) }))
    .filter((row) => row.value !== 0)
    .sort((a, b) => b.value - a.value);
}
