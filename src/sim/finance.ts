import type { Balance } from '@/content/balance';
import type { GrantDefinition } from '@/content/schema';
import type { BuildingCatalogue } from './catalogue';
import { earn, spend } from './ledger';
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
 * Strop půjčky pro danou splatnost, snížený o to, co město už dluží.
 *
 * Odvozuje se od **příjmu, ne od kasy**. Půjčka má být přemostěním, ne
 * způsobem, jak si koupit město, které se neuživí — a příjem je jediné číslo,
 * které říká, jestli se to má z čeho splácet.
 *
 * Rozhoduje **udržitelná splátka**, ne celková částka (T-revize, nález 5).
 * Do teď byl strop `příjem × 24` bez ohledu na splatnost, takže maximální
 * půjčka na dvanáct měsíců měla splátku přes dvojnásobek měsíčního příjmu.
 * Město ji nemělo z čeho platit, dluh se nezmenšoval, předčasně splatit nejde
 * — a protože se od stropu odečítá zbytek dluhu, zůstal úvěr napořád zavřený.
 * Jedno kliknutí a hotovo.
 *
 * ```
 * strop = příjem × podíl × měsíců / (1 + úrok × roky)
 * ```
 *
 * Čitatel je to, co město za tu dobu unese na splátkách; jmenovatel z toho
 * ubere úrok, protože splácí se jistina **i** on. Delší splatnost tedy znamená
 * větší půjčku, což hráč čeká. Původní násobek příjmu zůstává jako tvrdý
 * strop na celkový dluh: i na deset let si má město půjčit rozumně.
 */
export function loanCap(
  world: WorldState,
  balance: Balance,
  termMonths: number = balance.finance.minTermMonths,
): number {
  const { loanIncomeMultiple, loanPaymentShare, minTermMonths, maxTermMonths } = balance.finance;
  const months = Math.min(maxTermMonths, Math.max(minTermMonths, Math.round(termMonths)));
  const rate = loanRate(world, balance);

  const sustainable =
    (world.economy.lastIncome * loanPaymentShare * months) / (1 + (rate / 100) * (months / 12));
  const ceiling = Math.min(sustainable, world.economy.lastIncome * loanIncomeMultiple);
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
  // Celé číslo, ne jen konečné (audit T132): jistina jde rovnou do kasy
  // a kasa s desetinnou čárkou už nejde uložit — `checkSaveFits` ji odmítne.
  if (!Number.isInteger(amount) || amount <= 0) problems.push('invalidAmount');
  else if (amount > loanCap(world, balance, termMonths)) problems.push('overCap');

  if (!Number.isInteger(termMonths) || termMonths < balance.finance.minTermMonths) {
    problems.push('invalidTerm');
  } else if (termMonths > balance.finance.maxTermMonths) {
    problems.push('invalidTerm');
  }

  if (world.loans.length >= balance.finance.maxLoans) problems.push('tooMany');
  return problems;
}

/**
 * Kolik se celkem vrátí a kolik dělá měsíční splátka.
 *
 * Úrok je **jednoduchý, ne složený**: celkem se vrátí `jistina × (1 + sazba ×
 * roky)`, rozdělené na stejné splátky. Anuita by byla přesnější, ale hráč by
 * z ní neuměl v hlavě odhadnout, kolik ho to bude stát — a tohle je hra, ne
 * hypoteční kalkulačka.
 *
 * Vyčleněné z `takeLoan`, aby si rozhraní mohlo spočítat totéž **dřív, než
 * hráč klikne**. Kdyby si panel vzorec opsal, rozešel by se s ním při první
 * změně pravidel a nabízel by jinou splátku, než jakou by pak město platilo.
 */
export function loanTerms(
  amount: number,
  rate: number,
  termMonths: number,
): { total: number; payment: number } {
  const total = amount * (1 + (rate / 100) * (termMonths / 12));
  return { total: Math.round(total), payment: Math.ceil(total / termMonths) };
}

/** Sjedná půjčku. Peníze přijdou hned, splácí se od příštího měsíce. */
export function takeLoan(
  world: WorldState,
  balance: Balance,
  amount: number,
  termMonths: number,
): Loan | null {
  if (loanProblems(world, balance, amount, termMonths).length > 0) return null;

  const rate = loanRate(world, balance);
  const terms = loanTerms(amount, rate, termMonths);
  const loan: Loan = {
    id: world.nextLoanId++,
    principal: amount,
    remaining: terms.total,
    rate,
    payment: terms.payment,
    termMonths,
    paidMonths: 0,
  };

  world.loans.push(loan);
  earn(world, 'loan', amount);
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

    spend(world, 'loanPayment', due);
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
    earn(world, 'grant', grant.amount);
    awarded.push(grant.id);
  }

  return awarded;
}

/**
 * Stav milníků pro rozhraní: co je přiznané, co se plní a jak daleko.
 *
 * Vrací **klíče a čísla, ne věty** (§10). Počítá se ze stavu, který svět už
 * drží, takže tu nevzniká druhá pravda o tom, na co město dosáhlo.
 */
export interface GrantStatus {
  id: string;
  /** Lokalizační klíč jména a popisu z definice. */
  name: string;
  description: string;
  amount: number;
  awarded: boolean;
  /** Platí podmínka právě teď? U milníku na výdrž to ještě nestačí. */
  holds: boolean;
  /** Kolik tiků už podmínka drží v kuse a kolik jich je potřeba. `0` = bez výdrže. */
  held: number;
  needed: number;
}

export function grantStatus(
  world: WorldState,
  catalogue: BuildingCatalogue,
  grants: readonly GrantDefinition[],
): GrantStatus[] {
  return grants.map((grant) => {
    const awarded = world.grantsAwarded.has(grant.id);
    const holds = !awarded && grantConditionHolds(world, catalogue, grant);
    return {
      id: grant.id,
      name: grant.name,
      description: grant.description,
      amount: grant.amount,
      awarded,
      holds,
      held: holds ? (world.grantProgress.get(grant.id) ?? 0) : 0,
      needed: grant.condition.forTicks ?? 0,
    };
  });
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

/* ---------------------------------------------------------- dluhopisy --- */

/**
 * Emise dluhopisů (§8 fáze 4).
 *
 * **Jediný nástroj ve hře, kde hráč licituje.** U půjčky je sazba dána; tady
 * ji nabízí sám a hádá, kolik lidí to koupí. Nízký úrok v nespokojeném městě
 * znamená, že se neupíše skoro nic — a poplatek za vydání propadne i tak (R19).
 *
 * Bez toho pravidla by bylo optimální vypisovat nesmyslně velké emise
 * s minimálním úrokem: co se upíše, to je zisk, a co ne, nic nestojí.
 *
 * Úrok se vyplácí **ročně**, jistina jednorázově ve splatnosti. Nesplacení
 * jistiny sráží rating výrazně a na několik let znemožní další emisi.
 */
export interface Bond {
  id: number;
  /** Kolik hráč nabídl. Z toho se platí poplatek. */
  offered: number;
  /** Kolik se skutečně upsalo. Tolik město dostane a tolik bude splácet. */
  subscribed: number;
  /** Roční kupón v procentech, který hráč vypsal. */
  rate: number;
  issuedAtTick: number;
  maturityTick: number;
  /** Kdy se naposledy vyplácel kupón. */
  lastCouponTick: number;
  /** Nesplacená jistina ve splatnosti. Zůstává v evidenci jako ostuda. */
  defaulted: boolean;
}

export type BondProblem =
  | 'blocked'
  | 'invalidAmount'
  | 'invalidRate'
  | 'invalidMaturity'
  | 'cannotAffordFee';

/** Rok má 360 tiků (§5). Kupón se vyplácí jednou za rok. */
const YEAR = 360;

/**
 * Kolik se z nabídky upíše, 0–1.
 *
 * Sčítá se pět věcí a každá je rozhodnutí, které hráč udělal dřív: kolik
 * nabídl nad referenční sazbu, jak se ve městě žije, jestli roste, kolik je
 * v něm kriminality a kolik už dluží.
 *
 * Vrací se **podíl, ne částka** — o tu se stará `issueBond`, aby se počítání
 * a placení nepletlo dohromady.
 */
export function subscriptionRate(
  world: WorldState,
  balance: Balance,
  rate: number,
): number {
  const bonds = balance.finance.bonds;
  const happiness = averageHappiness(world) / 255;
  const growth = populationGrowth(world);
  const crime = averageCrime(world) / 255;
  const debt = debtBurden(world, balance);

  const success =
    bonds.base +
    (rate - bonds.referenceRate) * bonds.rateWeight +
    happiness * bonds.happinessWeight +
    growth * bonds.growthWeight -
    crime * bonds.crimeWeight -
    debt * bonds.debtWeight;

  return Math.max(0, Math.min(1, success));
}

/**
 * Strop emise: násobek měsíčního příjmu, snížený o to, co už město dluží
 * na dluhopisech.
 *
 * Stejná úvaha jako u půjčky — dluhopis se splácí z rozpočtu, ne z kasy.
 */
export function bondCap(world: WorldState, balance: Balance): number {
  const ceiling = world.economy.lastIncome * balance.finance.bonds.incomeMultiple;
  const owed = world.bonds.reduce((sum, bond) => sum + (bond.defaulted ? 0 : bond.subscribed), 0);
  return Math.max(0, Math.floor(ceiling - owed));
}

/** Poplatek za vydání. Počítá se z **celé nabídky**, ne z upsaného (R19). */
export function issueFee(balance: Balance, offered: number): number {
  return Math.ceil(offered * balance.finance.bonds.feeRate);
}

export function bondProblems(
  world: WorldState,
  balance: Balance,
  offered: number,
  rate: number,
  maturityTicks: number,
): BondProblem[] {
  const bonds = balance.finance.bonds;
  const problems: BondProblem[] = [];

  if (world.tick < world.bondsBlockedUntil) problems.push('blocked');

  // Celé číslo ze stejného důvodu jako u půjčky (T132): `offered` jde do
  // savu a ten desetinné číslo odmítne načíst.
  if (!Number.isInteger(offered) || offered <= 0) problems.push('invalidAmount');
  else if (offered > bondCap(world, balance)) problems.push('invalidAmount');

  if (!Number.isFinite(rate) || rate < 0 || rate > bonds.maxRate) problems.push('invalidRate');

  if (
    !Number.isInteger(maturityTicks) ||
    maturityTicks < bonds.minMaturityTicks ||
    maturityTicks > bonds.maxMaturityTicks
  ) {
    problems.push('invalidMaturity');
  }

  if (problems.length === 0 && world.economy.funds < issueFee(balance, offered)) {
    problems.push('cannotAffordFee');
  }
  return problems;
}

/**
 * Vypíše emisi. Poplatek odejde hned, upsaná část přijde hned.
 *
 * Neupsaná část **propadá** — nezůstane viset jako nabídka, kterou by někdo
 * mohl koupit později. Emise je jednorázová událost, ne trh.
 */
export function issueBond(
  world: WorldState,
  balance: Balance,
  offered: number,
  rate: number,
  maturityTicks: number,
): Bond | null {
  if (bondProblems(world, balance, offered, rate, maturityTicks).length > 0) return null;

  const share = subscriptionRate(world, balance, rate);
  const bond: Bond = {
    id: world.nextBondId++,
    offered,
    subscribed: Math.floor(offered * share),
    rate,
    issuedAtTick: world.tick,
    maturityTick: world.tick + maturityTicks,
    lastCouponTick: world.tick,
    defaulted: false,
  };

  spend(world, 'bondFee', issueFee(balance, offered));
  earn(world, 'bond', bond.subscribed);
  world.bonds.push(bond);
  return bond;
}

/**
 * Roční kupóny a splatné jistiny. Vrací, co se nezvládlo zaplatit.
 *
 * Nezaplacený **kupón** je jen ostuda: rating klesne jako u půjčky, dluh
 * zůstane. Nesplacená **jistina** je jiná liga — sráží rating výrazně a na
 * několik let znemožní další emisi. Kdo nezaplatí, tomu příště nikdo nepůjčí.
 */
export function serviceBonds(
  world: WorldState,
  balance: Balance,
): { missedCoupons: number; defaults: number } {
  if (world.bonds.length === 0) return { missedCoupons: 0, defaults: 0 };

  const settings = balance.finance.bonds;
  let missedCoupons = 0;
  let defaults = 0;

  for (const bond of world.bonds) {
    if (bond.defaulted) continue;

    // Kupón: jednou za rok od vydání, ne od začátku hry.
    if (world.tick - bond.lastCouponTick >= YEAR) {
      const coupon = Math.round((bond.subscribed * bond.rate) / 100);
      if (world.economy.funds >= coupon) {
        spend(world, 'bondCoupon', coupon);
        bond.lastCouponTick += YEAR;
      } else {
        missedCoupons++;
        // Termín se posouvá i tak: nezaplacený kupón se nehromadí do skoku,
        // kterým by se město dorazilo samo.
        bond.lastCouponTick += YEAR;
      }
    }

    if (world.tick < bond.maturityTick) continue;

    if (world.economy.funds >= bond.subscribed) {
      spend(world, 'bondRepay', bond.subscribed);
      bond.defaulted = false;
      bond.subscribed = 0;
    } else {
      bond.defaulted = true;
      defaults++;
      world.bondsBlockedUntil = world.tick + settings.blockTicks;
    }
  }

  world.bonds = world.bonds.filter((bond) => bond.subscribed > 0 || bond.defaulted);

  if (missedCoupons > 0 || defaults > 0) {
    const penalty =
      missedCoupons * balance.finance.missedPenalty + defaults * settings.defaultPenalty;
    world.economy.creditRating = Math.max(0, world.economy.creditRating - penalty);
  }
  return { missedCoupons, defaults };
}

/** Kolik město dluží na dluhopisech. Do rozpočtu a do panelu. */
export function bondDebt(world: WorldState): number {
  return world.bonds.reduce((sum, bond) => sum + bond.subscribed, 0);
}

/** Roční kupóny dohromady. Do rozpočtu. */
export function annualCoupons(world: WorldState): number {
  return world.bonds.reduce(
    (sum, bond) => sum + (bond.defaulted ? 0 : Math.round((bond.subscribed * bond.rate) / 100)),
    0,
  );
}

/**
 * Zadluženost, 0–1: kolik město dluží proti tomu, kolik si smí dovolit.
 *
 * Do úspěšnosti emise vstupuje záporně — kdo už dluží, tomu se upisuje hůř.
 */
function debtBurden(world: WorldState, balance: Balance): number {
  const ceiling = world.economy.lastIncome * balance.finance.bonds.incomeMultiple;
  if (ceiling <= 0) return 1;
  return Math.min(1, (totalDebt(world) + bondDebt(world)) / ceiling);
}

/**
 * Meziroční růst populace, oříznutý na 0–1.
 *
 * Porovnává se s hodnotou zapsanou při posledním měsíčním uzavření. Klesající
 * město má nulu, ne záporné číslo: pokles už trestá spokojenost a kriminalita,
 * a dvojí trest za totéž dělá z dluhopisů past.
 */
function populationGrowth(world: WorldState): number {
  const before = world.economy.lastPopulation;
  if (before <= 0) return 0;
  const now = totalPopulation(world);
  return Math.max(0, Math.min(1, (now - before) / before));
}

function averageCrime(world: WorldState): number {
  const layer = world.coarse.crime;
  if (layer.length === 0) return 0;
  let sum = 0;
  for (const value of layer) sum += value;
  return sum / layer.length;
}

/** Zapíše populaci, proti které se příště měří růst. Volá měsíční uzávěrka. */
export function rememberPopulation(world: WorldState): void {
  world.economy.lastPopulation = totalPopulation(world);
}
