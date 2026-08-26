import type { Balance } from '@/content/balance';
import type { GrantDefinition } from '@/content/schema';
import type { BuildingCatalogue } from './catalogue';
import type { WorldState } from './world';

/**
 * Půjčky, granty a úvěrový rating (§8 fáze 4).
 *
 * Tři věci, které spolu drží:
 *
 * - **Půjčka** je cesta ven z mínusu. Bankrot v téhle hře je měkký, ale bez
 *   úvěru z něj nevede cesta zpátky — město bez rezervy po zemětřesení jen
 *   pomalu chátrá a hráč nemá čím zasáhnout.
 * - **Grant** je odměna za milník, ne za správu. Přizná se sám a jednou.
 * - **Rating** je paměť. Nesplácení nevede k tvrdému konci, ale příští půjčka
 *   je dražší — a dluhopisy (T58) se hůř upisují.
 */

export interface Loan {
  id: number;
  /** Kolik si město půjčilo. Do hlášení; splácí se `remaining`. */
  principal: number;
  /** Kolik zbývá splatit včetně úroku. */
  remaining: number;
  /** Roční úrok v procentech, zafixovaný při sjednání. */
  rate: number;
  /** Měsíční splátka. */
  payment: number;
  termMonths: number;
  paidMonths: number;
}

export type LoanProblem =
  | 'tooMany'
  | 'overCap'
  | 'invalidAmount'
  | 'invalidTerm';

/**
 * Strop půjčky: násobek měsíčního příjmu, snížený o to, co město už dluží.
 *
 * Odvozuje se od **příjmu, ne od kasy**. Půjčka má být přemostěním, ne
 * způsobem, jak si koupit město, které se neuživí — a příjem je jediné číslo,
 * které říká, jestli se to má z čeho splácet.
 */
export function loanCap(world: WorldState, balance: Balance): number {
  const ceiling = world.economy.lastIncome * balance.finance.loanIncomeMultiple;
  const owed = world.loans.reduce((sum, loan) => sum + loan.remaining, 0);
  return Math.max(0, Math.floor(ceiling - owed));
}

/**
 * Úrok pro nově sjednanou půjčku.
 *
 * Základ plus přirážka podle ratingu. Město, které nesplácí, si příště půjčí
 * dráž — a je to jediný trest za nesplácení, protože tvrdý bankrot hra nemá.
 */
export function loanRate(world: WorldState, balance: Balance): number {
  const finance = balance.finance;
  return finance.baseRate + (1 - world.economy.creditRating) * finance.ratePenalty;
}

/** Co brání sjednat půjčku. Prázdné pole znamená „jde to". */
export function loanProblems(
  world: WorldState,
  balance: Balance,
  amount: number,
  termMonths: number,
): LoanProblem[] {
  const problems: LoanProblem[] = [];
  if (!Number.isFinite(amount) || amount <= 0) problems.push('invalidAmount');
  else if (amount > loanCap(world, balance)) problems.push('overCap');

  if (!Number.isInteger(termMonths) || termMonths < balance.finance.minTermMonths) {
    problems.push('invalidTerm');
  } else if (termMonths > balance.finance.maxTermMonths) {
    problems.push('invalidTerm');
  }

  if (world.loans.length >= balance.finance.maxLoans) problems.push('tooMany');
  return problems;
}

/**
 * Sjedná půjčku. Peníze přijdou hned, splácí se od příštího měsíce.
 *
 * Úrok je **jednoduchý, ne složený**: celkem se vrátí `jistina × (1 + sazba ×
 * roky)`, rozdělené na stejné splátky. Anuita by byla přesnější, ale hráč by
 * z ní neuměl v hlavě odhadnout, kolik ho to bude stát — a tohle je hra, ne
 * hypoteční kalkulačka.
 */
export function takeLoan(
  world: WorldState,
  balance: Balance,
  amount: number,
  termMonths: number,
): Loan | null {
  if (loanProblems(world, balance, amount, termMonths).length > 0) return null;

  const rate = loanRate(world, balance);
  const total = amount * (1 + (rate / 100) * (termMonths / 12));
  const loan: Loan = {
    id: world.nextLoanId++,
    principal: amount,
    remaining: Math.round(total),
    rate,
    payment: Math.ceil(total / termMonths),
    termMonths,
    paidMonths: 0,
  };

  world.loans.push(loan);
  world.economy.funds += amount;
  return loan;
}

/**
 * Měsíční splátky. Vrací, kolik splátek město nezvládlo.
 *
 * Nezvládnutá splátka se **neodpouští ani nehromadí do skoku**: dluh zůstane,
 * měsíc se nepočítá jako splacený a rating klesne. Kdyby se nesplacená splátka
 * jen odložila, nesplácení by nic nestálo; kdyby se strhla do mínusu, spadlo by
 * město do díry, ze které ho má půjčka zrovna dostat.
 */
export function payLoans(world: WorldState, balance: Balance): number {
  if (world.loans.length === 0) return 0;

  let missed = 0;
  const finance = balance.finance;

  for (const loan of world.loans) {
    const due = Math.min(loan.payment, loan.remaining);
    if (world.economy.funds < due) {
      missed++;
      continue;
    }

    world.economy.funds -= due;
    loan.remaining -= due;
    loan.paidMonths++;
  }

  world.loans = world.loans.filter((loan) => loan.remaining > 0);

  // Rating: nesplácení sráží, klid pomalu léčí. Uzdravování je pomalejší než
  // pád — jinak by stačilo pár měsíců v černých číslech a hráč by si beztrestně
  // vzal další úvěr.
  const rating = world.economy.creditRating;
  const next =
    missed > 0
      ? rating - missed * finance.missedPenalty
      : rating + (world.loans.length > 0 ? finance.ratingRecovery : finance.ratingRecovery / 2);
  world.economy.creditRating = Math.max(0, Math.min(1, next));

  return missed;
}

/* ------------------------------------------------------------- granty --- */

/**
 * Platí podmínka grantu právě teď?
 *
 * Jména veličin zná kód, hodnoty a prahy jsou obsah (P5). Neznámá veličina
 * vrací `false` — mod si smí přidat vlastní milník, jen ho tahle verze hry
 * nepřizná, místo aby spadla.
 */
export function grantConditionHolds(
  world: WorldState,
  catalogue: BuildingCatalogue,
  grant: GrantDefinition,
): boolean {
  const { metric, atLeast, definitionId } = grant.condition;

  switch (metric) {
    case 'population':
      return totalPopulation(world) >= atLeast;
    case 'buildings':
      return world.buildings.size >= atLeast;
    case 'happiness':
      return averageHappiness(world) >= atLeast;
    case 'building': {
      if (definitionId === undefined) return false;
      let count = 0;
      for (const building of world.buildings.values()) {
        if (building.definitionId !== definitionId || building.abandoned) continue;
        count++;
        if (count >= Math.max(1, atLeast)) return true;
      }
      return false;
    }
    default:
      void catalogue;
      return false;
  }
}

/**
 * Přizná granty, na které město dosáhlo. Vrací id přiznaných.
 *
 * Podmínka s `forTicks` musí platit **v kuse**. Bez toho by šel grant za
 * spokojenost sebrat tím, že hráč na jediný tik srazí daně na nulu, vybere si
 * odměnu a hned je vrátí zpátky.
 */
export function awardGrants(
  world: WorldState,
  catalogue: BuildingCatalogue,
  grants: readonly GrantDefinition[],
): string[] {
  const awarded: string[] = [];

  for (const grant of grants) {
    if (world.grantsAwarded.has(grant.id)) continue;

    if (!grantConditionHolds(world, catalogue, grant)) {
      world.grantProgress.delete(grant.id);
      continue;
    }

    const needed = grant.condition.forTicks ?? 0;
    if (needed > 0) {
      const held = (world.grantProgress.get(grant.id) ?? 0) + 1;
      if (held < needed) {
        world.grantProgress.set(grant.id, held);
        continue;
      }
    }

    world.grantsAwarded.add(grant.id);
    world.grantProgress.delete(grant.id);
    world.economy.funds += grant.amount;
    awarded.push(grant.id);
  }

  return awarded;
}

function totalPopulation(world: WorldState): number {
  let total = 0;
  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    total += building.population;
  }
  return total;
}

function averageHappiness(world: WorldState): number {
  if (world.happiness.length === 0) return 0;
  let sum = 0;
  for (const value of world.happiness) sum += value;
  return sum / world.happiness.length;
}

/** Kolik město dluží. Do rozpočtu i do panelu. */
export function totalDebt(world: WorldState): number {
  return world.loans.reduce((sum, loan) => sum + loan.remaining, 0);
}

/** Měsíční splátky dohromady. Do rozpočtu. */
export function monthlyPayments(world: WorldState): number {
  return world.loans.reduce((sum, loan) => sum + Math.min(loan.payment, loan.remaining), 0);
}
