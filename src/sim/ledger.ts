import { TICKS_PER_YEAR } from './disasters/risk';
import type { WorldState } from './world';

/**
 * Účetní kniha města (§12).
 *
 * Autor si vyžádal celoroční vyúčtování: „vždy 1. 1. každého roku vyskočí
 * přehled — levý sloupec příjmy, prostřední výdaje, pravý výsledek."
 *
 * Klíčové rozhodnutí: **kniha není druhý výpočet, ale jediná cesta k penězům.**
 * Kdo hne kasou, hne s ní přes `earn` nebo `spend`, a tím se to zapíše. Kdyby
 * si kniha sčítala vlastní odhad vedle skutečnosti, po první změně pravidel by
 * vyúčtování nesouhlasilo s tím, co je v kase — a nesouhlasící výkaz je horší
 * než žádný.
 *
 * Položky jsou **řetězcové klíče, ne výčet**: přibývají s tím, co hra umí, a
 * překlad je `ui.ledger.<klíč>`. Neznámý klíč se vypíše syrový, což je vidět
 * na první pohled; test hlídá, že žádný takový není.
 */

/** Kam se peníze zapisují. Kladné částky na obou stranách. */
export interface Ledger {
  /** Rok, ke kterému se sbírá. Rok 1 je ten, ve kterém město vzniklo. */
  year: number;
  income: Record<string, number>;
  expenses: Record<string, number>;
}

/** Příjmy: daně po zónách, jízdné, granty, půjčky a upsané dluhopisy. */
export const LEDGER_INCOME = [
  'tax.residential',
  'tax.commercial',
  'tax.industrial',
  'fare',
  'grant',
  'loan',
  'bond',
  // Vrácené peníze. Odebrané vozidlo se proplácí celé, takže musí být kam ho
  // zapsat — jinak by kniha nesouhlasila s kasou přesně o tu částku.
  'refund',
] as const;

/**
 * Výdaje. Stavba a údržba jsou **oddělené**: první je rozhodnutí hráče, druhá
 * jeho následek, a celý rozdíl mezi mladým a zralým městem je v tom poměru.
 */
export const LEDGER_EXPENSES = [
  'build',
  'roads',
  'pipes',
  'wires',
  'zoning',
  'terrain',
  'bulldoze',
  'vehicles',
  'upkeep.buildings',
  'upkeep.roads',
  'upkeep.wires',
  'upkeep.transit',
  'loanPayment',
  'bondCoupon',
  'bondRepay',
  'bondFee',
] as const;

export type LedgerIncome = (typeof LEDGER_INCOME)[number];
export type LedgerExpense = (typeof LEDGER_EXPENSES)[number];

export function createLedger(year: number): Ledger {
  return { year, income: {}, expenses: {} };
}

/** Ve kterém herním roce jsme. Rok 1 je ten, ve kterém město vzniklo. */
export function yearOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_YEAR) + 1;
}

/**
 * Přijaté peníze. Kasa i kniha, vždycky obojí.
 *
 * Záporná částka by knihu tiše rozhodila (příjem, který ubírá), takže se
 * ignoruje — volající, který chce ubrat, má `spend`.
 */
export function earn(world: WorldState, key: LedgerIncome, amount: number): void {
  if (amount <= 0) return;
  world.economy.funds += amount;
  const book = world.economy.ledger.income;
  book[key] = (book[key] ?? 0) + amount;
}

/** Vydané peníze. Kasa i kniha. */
export function spend(world: WorldState, key: LedgerExpense, amount: number): void {
  if (amount <= 0) return;
  world.economy.funds -= amount;
  const book = world.economy.ledger.expenses;
  book[key] = (book[key] ?? 0) + amount;
}

/** Součet jedné strany knihy. */
export function ledgerTotal(side: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(side)) total += value;
  return total;
}

/** Výsledek roku: příjmy minus výdaje. */
export function ledgerResult(ledger: Ledger): number {
  return ledgerTotal(ledger.income) - ledgerTotal(ledger.expenses);
}

/**
 * Přelom roku. Uzavře knihu a založí novou.
 *
 * Volá se z měsíční uzávěrky, ne z každého tiku: rok začíná měsícem a
 * uzávěrka je jediné místo, které se o kalendář stará.
 */
export function closeYearIfDue(world: WorldState): boolean {
  const year = yearOf(world.tick);
  if (year === world.economy.ledger.year) return false;

  // Prázdný první rok se nezobrazuje: město založené v prosinci by hned
  // v lednu dostalo výkaz o ničem.
  const closing = world.economy.ledger;
  const empty =
    ledgerTotal(closing.income) === 0 && ledgerTotal(closing.expenses) === 0;
  world.economy.lastYear = empty ? null : closing;
  world.economy.ledger = createLedger(year);
  return !empty;
}
