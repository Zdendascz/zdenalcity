import type { Balance } from '@/content/balance';
import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from '../catalogue';
import { cellOfTile, strongestModifier } from '../disasters/effects';
import { index, ROAD } from '../layers';
import { isRciCategory } from '../rci';
import type { RciCategory } from '../rci';
import { closeYearIfDue } from '../ledger';
import { annualCoupons, bondDebt, monthlyPayments, totalDebt } from '../finance';
import { transitTotals } from '../transit';
import { fundingCost } from '../funding';
import { serviceFunding } from '../world';
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


/**
 * Jeden řádek rozpočtu — jedna definice budovy.
 *
 * Kromě výsledků nese i vstupy, ze kterých se spočítal, aby UI mohlo ukázat
 * **z čeho se příjem a náklad skládá**, a ne jen hotové číslo.
 */
export interface BudgetLine {
  definitionId: string;
  /** Lokalizační klíč jména budovy. */
  nameKey: string;
  count: number;
  poweredCount: number;
  income: number;
  upkeep: number;

  /** Zdaňovaná veličina za všechny vydělávající budovy: obyvatelé, nebo místa. */
  taxBase: number;
  /** Lokalizační klíč jednotky základu; `null` u budov, které se nedaní. */
  taxUnitKey: string | null;
  /** Sazba v procentech; `null` u budov, které se nedaní. */
  taxRate: number | null;
  /** Hodnota jednoho obyvatele či místa pro daň — u bydlení snížená. */
  valuePerUnit: number;
  /** Údržba jedné budovy podle definice. */
  upkeepEach: number;
  /** Kolik budov údržbu opravdu platí — temné jsou mimo provoz. */
  upkeepCount: number;
}

/** Silnice v rozpočtu: kolik jich stojí a co dohromady stojí za měsíc. */
export interface RoadBudget {
  count: number;
  upkeep: number;
}

/** MHD v rozpočtu: jízdné proti údržbě vozidel (§7 fáze 4). */
export interface TransitBudget {
  lines: number;
  vehicles: number;
  income: number;
  upkeep: number;
}

export interface DebtBudget {
  loans: number;
  owed: number;
  payment: number;
  bonds: number;
  bondOwed: number;
  /** Dvanáctina ročních kupónů — v měsíčním rozpisu se počítá měsíčně. */
  bondPayment: number;
}

export interface Budget {
  lines: BudgetLine[];
  /** Údržba silnic. Nejsou to budovy, takže mají vlastní řádek (§4 fáze 3). */
  roads: RoadBudget;
  /**
   * MHD. Taky vlastní řádek: vozidlo není budova a jízdné není daň, takže
   * do rozpisu po definicích nepatří ani jedno.
   */
  transit: TransitBudget;
  /** Půjčky: kolik jich běží, kolik se dluží a kolik se tenhle měsíc platí. */
  debt: DebtBudget;
  income: number;
  expenses: number;
  /** Kolik vynese jedna jednotka základu při 100 %. Do rozpisu v UI. */
  valuePerUnit: number;
}

/**
 * Daň ze zdaňovaného základu. Jediný daňový vzorec v celé hře — používá ho
 * rozpočet i detail budovy, takže se výpis nemůže rozejít se skutečností.
 */
export function taxFrom(base: number, ratePercent: number, valuePerUnit: number): number {
  return Math.round((base * valuePerUnit * ratePercent) / 100);
}

/**
 * Kolik daně odvede jedna budova za měsíc.
 *
 * Rozpočet zaokrouhluje až celý řádek, takže součet jednotlivých budov se od
 * řádku může lišit o jednotky — tohle je podíl budovy, ne účetní doklad.
 */
export function buildingMonthlyTax(
  world: WorldState,
  definition: Definition,
  building: Building,
  balance: Balance,
): number {
  const category = definition.category;
  if (!isRciCategory(category) || !building.powered || building.abandoned) return 0;

  const taxable = category === 'residential' ? building.population : building.jobs;
  return taxFrom(taxable, world.economy.taxRates[category], taxValuePerUnit(balance, category));
}

/**
 * Hodnota jednotky pro daň podle kategorie.
 *
 * Bydlení vynáší jen část (`residentialTaxShare`, 2026-09-30: polovina).
 * Autor: vyúčtování „strašně nesedí" — město mělo přebytek 4,5 milionu ročně
 * a daň z bydlení tvořila většinu příjmů.
 */
export function taxValuePerUnit(balance: Balance, category: string): number {
  const base = balance.economy.taxableValuePerUnit;
  return category === 'residential' ? base * balance.economy.residentialTaxShare : base;
}

/**
 * Údržba budovy za měsíc.
 *
 * Temná budova je mimo provoz, takže neplatí nic. U služeb se údržba škáluje
 * financováním třídy — kdo šetří na policii, platí za ni míň, ale i dosah
 * je menší (§6 zadání fáze 2).
 */
export function buildingMonthlyUpkeep(
  world: WorldState,
  balance: Balance,
  definition: Definition,
  building: Building,
): number {
  if (building.abandoned) return 0; // ruina nikoho nestojí, jen kazí okolí
  if (isRciCategory(definition.category) && !building.powered) return 0;

  const serviceClass = definition.service?.class;
  // Nadfinancování se **platí progresivně** (T113): dvojnásobný rozpočet
  // služby stojí dvanáctinásobek údržby, ne dvojnásobek. Křivka je jedna
  // a bydlí v `sim/funding.ts`, ať se cena nemůže rozejít s posuvníkem.
  const funding = serviceClass === undefined ? 1 : serviceFunding(world, serviceClass);
  // Služby stojí násobek údržby z definice (`serviceUpkeepMultiplier`,
  // 2026-09-30: dvojnásobek). Násobí se tady, ne v definicích, ať se dá
  // ladit jedním číslem a mod s vlastní službou ho dostane zadarmo.
  const multiplier = serviceClass === undefined ? 1 : balance.economy.serviceUpkeepMultiplier;
  return Math.round(definition.economy.upkeep * multiplier * fundingCost(balance, funding));
}

/**
 * Kolik daně budově ubírá běžící katastrofa, 0–1.
 *
 * Postihy se neskládají — platí ten nejhorší (`Math.max`), stejně jako všude
 * jinde v `effects.ts`. Dvě stávky přes jednu čtvrť nedaní dvakrát nula.
 */
function taxLossAt(world: WorldState, tile: number): number {
  if (world.disasters.modifiers.length === 0) return 0;
  return strongestModifier(world, 'taxLoss', cellOfTile(world, tile), 0, undefined, Math.max);
}

/**
 * Rozpad měsíčního rozpočtu po definicích.
 *
 * Sdílí ho `economySystem` i tabulka v UI, aby daňový vzorec existoval jen
 * na jednom místě — jinak by se výpis a skutečnost dřív nebo později rozešly.
 */
export function computeBudget(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): Budget {
  const byDefinition = new Map<string, BudgetLine>();
  let income = 0;
  let expenses = 0;

  for (const building of world.buildings.values()) {
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;

    const category = definition.category;
    const taxedAs = isRciCategory(category) ? category : null;
    /** Temná i opuštěná budova je mimo provoz: nedaní a neplatí údržbu. */
    const operating = !building.abandoned && (taxedAs === null || building.powered);

    let line = byDefinition.get(definition.id);
    if (!line) {
      line = {
        definitionId: definition.id,
        nameKey: definition.name,
        count: 0,
        poweredCount: 0,
        income: 0,
        upkeep: 0,
        taxBase: 0,
        taxUnitKey:
          taxedAs === null
            ? null
            : taxedAs === 'residential'
              ? 'ui.budget.unit.population'
              : 'ui.budget.unit.jobs',
        taxRate: taxedAs === null ? null : world.economy.taxRates[taxedAs],
        valuePerUnit: taxedAs === null ? 0 : taxValuePerUnit(balance, taxedAs),
        upkeepEach: definition.economy.upkeep,
        upkeepCount: 0,
      };
      byDefinition.set(definition.id, line);
    }

    line.count++;
    if (building.powered) line.poweredCount++;
    if (!operating) continue;

    line.upkeepCount++;
    if (taxedAs !== null) {
      const taxable = taxedAs === 'residential' ? building.population : building.jobs;
      // Stávkující čtvrť nedaní, nepokoje a válka gangů seberou část. Odečítá
      // se od základu, ne od výsledku: sazba se nemění, mění se to, z čeho se
      // počítá, a rozpis v UI tak pořád odpovídá skutečnosti.
      const lost = taxLossAt(world, index(building.x, building.y, world.size));
      line.taxBase += lost === 0 ? taxable : taxable - Math.round(taxable * lost);
    }

    const upkeep = buildingMonthlyUpkeep(world, balance, definition, building);
    // Skutečná částka za kus, ne ta z definice — u služeb ji škáluje financování
    // a rozpis v UI by jinak tvrdil „1 × 120 = 60".
    line.upkeepEach = upkeep;
    line.upkeep += upkeep;
    expenses += upkeep;
  }

  // Silnice se neúčtují po dlaždicích, ale jedním řádkem — hráč jich má tisíce
  // a zajímá ho součet, ne kolik stojí každá zvlášť.
  // Prochází se seznam silnic, ne celá mapa (R20 fáze 4). Rozpočet se počítá
  // jednou za herní měsíc, ale i tak: na 512 × 512 to byla čtvrt milionu
  // porovnání pro pár tisíc dlaždic, a rozpočet si o něj řekne i panel
  // pokaždé, když ho hráč otevře.
  const roads: RoadBudget = { count: 0, upkeep: 0 };
  for (const tile of world.roadTiles) {
    const value = world.layers.road[tile] ?? ROAD.none;
    if (value === ROAD.none) continue;
    roads.count++;
    roads.upkeep += balance.traffic.roadTypes[value - 1]?.upkeep ?? 0;
  }
  roads.upkeep = Math.round(roads.upkeep);
  expenses += roads.upkeep;

  // Jízdné a údržba vozidel. Obojí je měsíční a počítá ho `transitSystem`,
  // rozpočet jen sečte — jinak by se výpis a skutečnost rozešly.
  const totals = transitTotals(world);
  const transit: TransitBudget = {
    lines: world.lines.length,
    vehicles: totals.vehicles,
    income: totals.income,
    upkeep: totals.upkeep,
  };
  income += transit.income;
  expenses += transit.upkeep;

  // Splátky půjček. Vlastní řádek, protože to není údržba ničeho — je to
  // cena za to, že si město kdysi vypomohlo.
  const debt: DebtBudget = {
    loans: world.loans.length,
    owed: totalDebt(world),
    payment: monthlyPayments(world),
    bonds: world.bonds.length,
    bondOwed: bondDebt(world),
    // Kupón se platí ročně; v měsíčním rozpisu se ukazuje dvanáctina, aby si
    // hráč uměl srovnat, co ho to stojí měsíčně.
    bondPayment: Math.round(annualCoupons(world) / 12),
  };
  expenses += debt.payment + debt.bondPayment;

  // Daň se zaokrouhluje **jednou za řádek**, ne u každé budovy. Jinak by rozpis
  // v UI tvrdil něco jiného, než kolik ve sloupci opravdu stojí.
  for (const line of byDefinition.values()) {
    if (line.taxRate === null) continue;
    line.income = taxFrom(line.taxBase, line.taxRate, line.valuePerUnit);
    income += line.income;
  }

  return {
    // Stabilní pořadí, ať tabulka neposkakuje.
    lines: [...byDefinition.values()].sort((a, b) => a.definitionId.localeCompare(b.definitionId)),
    roads,
    transit,
    debt,
    income,
    expenses,
    valuePerUnit: balance.economy.taxableValuePerUnit,
  };
}

export function createEconomySystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'economy',
    interval: 30,
    offset: 0,
    run(world: WorldState) {
      const budget = computeBudget(world, catalogue, balance);
      world.economy.lastIncome = budget.income;
      world.economy.lastExpenses = budget.expenses;

      /*
       * Do kasy jde **jen to, co platí tenhle systém**.
       *
       * Splátky půjček a kupóny dluhopisů jsou v rozpočtu proto, aby hráč
       * viděl celý měsíční náklad, jenže peníze za ně strhává `finance`
       * o tik později (`payLoans`, `serviceBonds`). Do T112 se odečítaly
       * i tady, takže se **platily dvakrát**: změřeno na půjčce se splátkou
       * 540 — kasa klesla o 1080 za měsíc, dluh jen o 540.
       */
      const paidElsewhere = budget.debt.payment + budget.debt.bondPayment;
      const cash = budget.income - (budget.expenses - paidElsewhere);
      world.economy.funds += cash;

      // Do knihy se zapisuje po položkách, ne jednou částkou: vyúčtování má
      // říct, kde ty peníze byly, ne jen kolik jich zbylo.
      for (const line of budget.lines) {
        const category = catalogue.get(line.definitionId)?.category;
        if (line.income > 0 && isTaxable(category)) {
          record(world.economy.ledger.income, `tax.${category}`, line.income);
        }
        record(world.economy.ledger.expenses, 'upkeep.buildings', line.upkeep);
      }
      record(world.economy.ledger.expenses, 'upkeep.roads', budget.roads.upkeep);
      record(world.economy.ledger.expenses, 'upkeep.transit', budget.transit.upkeep);
      record(world.economy.ledger.income, 'fare', budget.transit.income);

      closeYearIfDue(world);
    },
  };
}

/** Daní se jen zóny; služby a infrastruktura mají v knize jen údržbu. */
function isTaxable(category: string | undefined): category is RciCategory {
  return category === 'residential' || category === 'commercial' || category === 'industrial';
}

/** Přičte do knihy. Nula ani záporná částka řádek nezaloží. */
function record(side: Record<string, number>, key: string, amount: number): void {
  if (amount <= 0) return;
  side[key] = (side[key] ?? 0) + amount;
}
