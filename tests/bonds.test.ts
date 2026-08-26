import { describe, expect, it } from 'vitest';
import { validateBalance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { issueBondCommand } from '@/sim/commands';
import {
  annualCoupons,
  bondCap,
  bondDebt,
  bondProblems,
  issueBond,
  issueFee,
  serviceBonds,
  subscriptionRate,
  takeLoan,
} from '@/sim/finance';
import { computeBudget } from '@/sim/systems/economy';
import { createFinanceSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

/**
 * Dluhopisy (T58).
 *
 * **Jediný nástroj ve hře, kde hráč licituje.** U půjčky je sazba dána; tady ji
 * nabízí sám a hádá, kolik lidí to koupí. Nízký úrok v nespokojeném městě
 * znamená, že se neupíše skoro nic — a poplatek za vydání propadne i tak (R19).
 *
 * Bez toho pravidla by bylo optimální vypisovat nesmyslně velké emise
 * s minimálním úrokem: co se upíše, je zisk, a co ne, nic nestojí.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Město s daným příjmem, spokojeností a kriminalitou. */
function city(options: {
  income?: number;
  funds?: number;
  happiness?: number;
  crime?: number;
} = {}): WorldState {
  const world = createWorld(1, VANILLA_BALANCE.economy);
  world.economy.funds = options.funds ?? 1_000_000;
  world.economy.lastIncome = options.income ?? 20000;
  world.happiness.fill(options.happiness ?? 128);
  world.coarse.crime.fill(options.crime ?? 0);
  return world;
}

const YEAR = 360;

describe('úspěšnost úpisu', () => {
  it('vyšší nabídnutý úrok zvedne upsanou část', () => {
    // Tohle je ta licitace: hráč platí úrokem za to, aby se emise prodala.
    const balance = VANILLA_BALANCE;
    const world = city();

    const low = subscriptionRate(world, balance, balance.finance.bonds.referenceRate);
    const high = subscriptionRate(world, balance, balance.finance.bonds.maxRate);
    expect(high).toBeGreaterThan(low);
  });

  it('spokojené město si půjčí líp než nespokojené', () => {
    const balance = VANILLA_BALANCE;
    const rate = balance.finance.bonds.referenceRate + 3;

    const happy = subscriptionRate(city({ happiness: 250 }), balance, rate);
    const grim = subscriptionRate(city({ happiness: 10 }), balance, rate);
    expect(happy).toBeGreaterThan(grim);
  });

  it('kriminalita a dluhy úpis srážejí', () => {
    const balance = VANILLA_BALANCE;
    const rate = balance.finance.bonds.referenceRate + 3;

    const clean = subscriptionRate(city(), balance, rate);
    expect(subscriptionRate(city({ crime: 255 }), balance, rate)).toBeLessThan(clean);

    const indebted = city();
    takeLoan(indebted, balance, indebted.economy.lastIncome * 20, 120);
    expect(subscriptionRate(indebted, balance, rate)).toBeLessThan(clean);
  });

  it('rostoucí město si půjčí líp než stagnující', () => {
    const content = VANILLA_BALANCE;
    const rate = content.finance.bonds.referenceRate + 3;

    const still = city();
    still.economy.lastPopulation = 1000;
    addResidents(still, 1000);

    const growing = city();
    growing.economy.lastPopulation = 1000;
    addResidents(growing, 1500);

    expect(subscriptionRate(growing, content, rate)).toBeGreaterThan(
      subscriptionRate(still, content, rate),
    );
  });

  it('klesající město se netrestá dvakrát', () => {
    // Pokles už trestá spokojenost a kriminalita. Záporný růst by z dluhopisů
    // udělal past, ze které se padající město nedostane.
    const balance = VANILLA_BALANCE;
    const rate = balance.finance.bonds.referenceRate + 3;

    const still = city();
    still.economy.lastPopulation = 1000;
    addResidents(still, 1000);

    const shrinking = city();
    shrinking.economy.lastPopulation = 1000;
    addResidents(shrinking, 200);

    expect(subscriptionRate(shrinking, balance, rate)).toBe(subscriptionRate(still, balance, rate));
  });

  it('podíl se nikdy nevymkne z rozsahu 0–1', () => {
    const balance = VANILLA_BALANCE;
    const best = city({ happiness: 255, crime: 0 });
    best.economy.lastPopulation = 100;
    addResidents(best, 100000);
    expect(subscriptionRate(best, balance, balance.finance.bonds.maxRate)).toBeLessThanOrEqual(1);

    const worst = city({ happiness: 0, crime: 255 });
    takeLoan(worst, balance, worst.economy.lastIncome * 20, 120);
    expect(subscriptionRate(worst, balance, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('vydání emise', () => {
  it('poplatek se platí z celé nabídky, dostane se jen upsané (R19)', () => {
    // Bez toho by bylo optimální vypisovat nesmyslně velké emise s minimálním
    // úrokem: co se upíše, je zisk, a co ne, nic nestojí.
    const balance = VANILLA_BALANCE;
    const world = city({ happiness: 60, funds: 500_000 });
    const offered = 200000;
    const before = world.economy.funds;

    // Referenční sazba: upíše se část, ne nula ani všechno. Kdyby se neupsalo
    // nic, netestovalo by se, že se poplatek platí z **nabídky**.
    const bond = issueBond(
      world,
      balance,
      offered,
      balance.finance.bonds.referenceRate,
      balance.finance.bonds.minMaturityTicks,
    );
    if (!bond) throw new Error('emise neprošla');

    expect(bond.offered).toBe(offered);
    expect(bond.subscribed).toBeLessThan(offered);
    expect(bond.subscribed).toBeGreaterThan(0);

    const fee = issueFee(balance, offered);
    expect(fee).toBe(Math.ceil(offered * balance.finance.bonds.feeRate));
    expect(world.economy.funds).toBe(before - fee + bond.subscribed);
    // Poplatek se počítá z nabídky, ne z upsaného — jinak by nic nestál.
    expect(fee).toBeGreaterThan(Math.ceil(bond.subscribed * balance.finance.bonds.feeRate));
  });

  it('nízký úrok v nespokojeném městě se upíše jen zčásti a poplatek propadne', () => {
    // Akceptační kritérium 19.
    const balance = VANILLA_BALANCE;
    const world = city({ happiness: 5, crime: 200, funds: 500_000 });
    const offered = 300000;
    const before = world.economy.funds;

    const bond = issueBond(world, balance, offered, 0, balance.finance.bonds.minMaturityTicks);
    if (!bond) throw new Error('emise neprošla');

    expect(bond.subscribed).toBeLessThan(offered * 0.3);
    // A město je po ní chudší o poplatek, i kdyby se neupsalo nic.
    const fee = issueFee(balance, offered);
    expect(world.economy.funds).toBe(before - fee + bond.subscribed);
    expect(fee).toBeGreaterThan(0);
  });

  it('neupsaná část nezůstane viset — emise je událost, ne trh', () => {
    const balance = VANILLA_BALANCE;
    const world = city({ happiness: 60 });
    const bond = issueBond(world, balance, 100000, 3, balance.finance.bonds.minMaturityTicks);
    if (!bond) throw new Error('emise neprošla');

    // Splácí se jen to, co se upsalo.
    expect(bondDebt(world)).toBe(bond.subscribed);
    expect(bondDebt(world)).toBeLessThan(bond.offered);
  });

  it('nesmyslná nabídka, úrok ani splatnost neprojdou', () => {
    const balance = VANILLA_BALANCE;
    const bonds = balance.finance.bonds;
    const world = city();

    expect(bondProblems(world, balance, 0, 5, bonds.minMaturityTicks)).toContain('invalidAmount');
    expect(bondProblems(world, balance, 999999999, 5, bonds.minMaturityTicks)).toContain(
      'invalidAmount',
    );
    expect(bondProblems(world, balance, 1000, -1, bonds.minMaturityTicks)).toContain('invalidRate');
    expect(bondProblems(world, balance, 1000, bonds.maxRate + 1, bonds.minMaturityTicks)).toContain(
      'invalidRate',
    );
    expect(bondProblems(world, balance, 1000, 5, bonds.minMaturityTicks - 1)).toContain(
      'invalidMaturity',
    );
    expect(bondProblems(world, balance, 1000, 5, bonds.maxMaturityTicks + 1)).toContain(
      'invalidMaturity',
    );
  });

  it('na poplatek město musí mít předem', () => {
    // Emise není zadarmo a nejde ji zaplatit z toho, co teprve přinese.
    const balance = VANILLA_BALANCE;
    const world = city({ funds: 10 });
    expect(bondProblems(world, balance, 100000, 5, balance.finance.bonds.minMaturityTicks)).toContain(
      'cannotAffordFee',
    );
    expect(issueBond(world, balance, 100000, 5, balance.finance.bonds.minMaturityTicks)).toBeNull();
    expect(world.economy.funds).toBe(10);
  });

  it('strop se odvozuje od příjmu a už vydané se odečítá', () => {
    const balance = VANILLA_BALANCE;
    const world = city({ income: 10000 });
    const full = bondCap(world, balance);
    expect(full).toBe(10000 * balance.finance.bonds.incomeMultiple);

    issueBond(world, balance, Math.floor(full / 2), 8, balance.finance.bonds.minMaturityTicks);
    expect(bondCap(world, balance)).toBeLessThan(full);
  });

  it('příkaz řekne, proč to nejde', () => {
    const balance = VANILLA_BALANCE;
    const bonds = balance.finance.bonds;
    const world = city({ income: 1000 });

    expect(issueBondCommand(world, balance, 999999999, 5, bonds.minMaturityTicks)).toEqual({
      ok: false,
      reason: 'error.overBondCap',
      params: { cap: bondCap(world, balance) },
    });
    expect(issueBondCommand(world, balance, 1000, 999, bonds.minMaturityTicks)).toEqual({
      ok: false,
      reason: 'error.invalidRate',
      params: { max: bonds.maxRate },
    });
    expect(issueBondCommand(world, balance, 1000, 5, 1)).toEqual({
      ok: false,
      reason: 'error.invalidMaturity',
      params: { min: bonds.minMaturityTicks, max: bonds.maxMaturityTicks },
    });
    expect(issueBondCommand(world, undefined, 1000, 5, bonds.minMaturityTicks)).toEqual({
      ok: false,
      reason: 'error.noFinanceRules',
    });
  });
});

describe('kupóny a splatnost', () => {
  it('úrok se platí jednou za rok, ne měsíčně', () => {
    const balance = VANILLA_BALANCE;
    const world = city({ happiness: 200, funds: 1_000_000 });
    const bond = issueBond(world, balance, 100000, 10, YEAR * 5);
    if (!bond) throw new Error('emise neprošla');

    const after = world.economy.funds;
    // Půl roku: nic.
    world.tick += YEAR / 2;
    expect(serviceBonds(world, balance).missedCoupons).toBe(0);
    expect(world.economy.funds).toBe(after);

    // Rok: kupón.
    world.tick += YEAR / 2;
    serviceBonds(world, balance);
    const coupon = Math.round((bond.subscribed * bond.rate) / 100);
    expect(coupon).toBeGreaterThan(0);
    expect(world.economy.funds).toBe(after - coupon);

    // A hned znovu: **jednou za rok znamená jednou**. Kdyby zaplacený kupón
    // neposunul termín, platil by se při každém dalším zavolání obsluhy, tedy
    // fakticky každý měsíc.
    serviceBonds(world, balance);
    serviceBonds(world, balance);
    expect(world.economy.funds, 'kupón se platí víckrát za rok').toBe(after - coupon);

    // Za další rok zase právě jeden.
    world.tick += YEAR;
    serviceBonds(world, balance);
    expect(world.economy.funds).toBe(after - coupon * 2);
  });

  it('jistina se vrací jednorázově ve splatnosti', () => {
    const balance = VANILLA_BALANCE;
    const world = city({ happiness: 200, funds: 1_000_000 });
    const bond = issueBond(world, balance, 100000, 6, balance.finance.bonds.minMaturityTicks);
    if (!bond) throw new Error('emise neprošla');
    const owed = bond.subscribed;

    world.tick = bond.maturityTick;
    const before = world.economy.funds;
    serviceBonds(world, balance);

    // Kupón i jistina naráz — proto se odečítá víc než jistina sama.
    expect(before - world.economy.funds).toBeGreaterThanOrEqual(owed);
    expect(world.bonds).toHaveLength(0);
    expect(bondDebt(world)).toBe(0);
  });

  it('nesplacená jistina sníží rating a zablokuje další emisi', () => {
    // Akceptační kritérium 20.
    const balance = VANILLA_BALANCE;
    const world = city({ happiness: 200, funds: 1_000_000 });
    const bond = issueBond(world, balance, 200000, 6, balance.finance.bonds.minMaturityTicks);
    if (!bond) throw new Error('emise neprošla');

    world.economy.funds = 0;
    world.tick = bond.maturityTick;
    const before = world.economy.creditRating;
    const result = serviceBonds(world, balance);

    expect(result.defaults).toBe(1);
    expect(world.economy.creditRating).toBeLessThan(before);
    expect(world.bondsBlockedUntil).toBe(world.tick + balance.finance.bonds.blockTicks);

    // A další emise neprojde, dokud blokace neskončí.
    world.economy.funds = 1_000_000;
    world.economy.lastIncome = 50000;
    expect(bondProblems(world, balance, 10000, 10, balance.finance.bonds.minMaturityTicks)).toContain(
      'blocked',
    );
    expect(issueBondCommand(world, balance, 10000, 10, balance.finance.bonds.minMaturityTicks)).toEqual(
      { ok: false, reason: 'error.bondsBlocked', params: { until: world.bondsBlockedUntil } },
    );

    world.tick = world.bondsBlockedUntil;
    expect(bondProblems(world, balance, 10000, 10, balance.finance.bonds.minMaturityTicks)).not.toContain(
      'blocked',
    );
  });

  it('nesplacená jistina bolí víc než zmeškaný kupón', () => {
    const balance = VANILLA_BALANCE;
    expect(balance.finance.bonds.defaultPenalty).toBeGreaterThan(balance.finance.missedPenalty);

    const missed = city({ happiness: 200 });
    const bondA = issueBond(missed, balance, 100000, 10, YEAR * 5);
    if (!bondA) throw new Error('emise neprošla');
    missed.economy.funds = 0;
    missed.tick += YEAR;
    serviceBonds(missed, balance);
    const afterMissed = missed.economy.creditRating;

    const broken = city({ happiness: 200 });
    const bondB = issueBond(broken, balance, 100000, 10, balance.finance.bonds.minMaturityTicks);
    if (!bondB) throw new Error('emise neprošla');
    broken.economy.funds = 0;
    broken.tick = bondB.maturityTick;
    serviceBonds(broken, balance);

    expect(broken.economy.creditRating).toBeLessThan(afterMissed);
  });

  it('zmeškaný kupón se nehromadí do skoku', () => {
    // Kdyby se odkládal, přišel by po letech účet, kterým se město dorazí samo.
    const balance = VANILLA_BALANCE;
    const world = city({ happiness: 200 });
    const bond = issueBond(world, balance, 100000, 10, YEAR * 6);
    if (!bond) throw new Error('emise neprošla');

    world.economy.funds = 0;
    world.tick += YEAR;
    serviceBonds(world, balance);
    world.tick += YEAR;
    serviceBonds(world, balance);

    // Tři roky po vydání a s penězi: zaplatí se jeden kupón, ne tři.
    world.economy.funds = 1_000_000;
    world.tick += YEAR;
    const before = world.economy.funds;
    serviceBonds(world, balance);
    const coupon = Math.round((bond.subscribed * bond.rate) / 100);
    expect(before - world.economy.funds).toBe(coupon);

    // A dluh se **nedohání**: další zavolání ve stejném tiku už nic nestrhne.
    // Kdyby se zmeškané kupóny hromadily, přišel by po letech účet, kterým se
    // město dorazí samo.
    serviceBonds(world, balance);
    serviceBonds(world, balance);
    expect(before - world.economy.funds, 'zmeškané kupóny se dohánějí').toBe(coupon);
  });

  it('systém obsluhuje dluhopisy sám', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = city({ happiness: 200, funds: 1_000_000 });
    const bond = issueBond(world, balance, 100000, 10, YEAR * 5);
    if (!bond) throw new Error('emise neprošla');

    const systems = [createFinanceSystem(content, balance, [])];
    const before = world.economy.funds;
    for (let tick = 0; tick < YEAR + 30; tick++) tickWorld(world, systems);

    const coupon = Math.round((bond.subscribed * bond.rate) / 100);
    expect(before - world.economy.funds).toBe(coupon);
  });

  it('dluhopisy jsou vidět v rozpočtu vedle půjček', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = city({ happiness: 200, funds: 1_000_000 });
    const bond = issueBond(world, balance, 150000, 8, YEAR * 5);
    if (!bond) throw new Error('emise neprošla');

    const budget = computeBudget(world, content, balance);
    expect(budget.debt.bonds).toBe(1);
    expect(budget.debt.bondOwed).toBe(bondDebt(world));
    expect(budget.debt.bondPayment).toBe(Math.round(annualCoupons(world) / 12));
    expect(budget.debt.bondPayment).toBeGreaterThan(0);

    const clean = computeBudget({ ...world, bonds: [] } as WorldState, content, balance);
    expect(budget.expenses - clean.expenses).toBe(budget.debt.bondPayment);
  });
});

describe('validace dluhopisů', () => {
  it('odmítne, když nesplacená jistina bolí míň než zmeškaná splátka', () => {
    const raw = rawBalance();
    const finance = raw['finance'] as Record<string, unknown>;
    const bonds = finance['bonds'] as Record<string, unknown>;
    bonds['defaultPenalty'] = finance['missedPenalty'];

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('finance.bonds');
  });

  it('odmítne nejdelší splatnost kratší než nejkratší', () => {
    const raw = rawBalance();
    const finance = raw['finance'] as Record<string, unknown>;
    const bonds = finance['bonds'] as Record<string, unknown>;
    bonds['maxMaturityTicks'] = 100;
    bonds['minMaturityTicks'] = 1000;

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('finance.bonds');
  });

  it('odmítne chybějící sekci', () => {
    const raw = rawBalance();
    const finance = raw['finance'] as Record<string, unknown>;
    delete finance['bonds'];

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    // A řekne **že chybí**, ne že jsou v ní špatná čísla. Bez toho by chybějící
    // sekce prošla jako sekce se samými nulami a hráč by hledal, proč se mu nic
    // neupisuje.
    expect(result.issues).toContainEqual({
      field: 'finance.bonds',
      message: 'chybí, nebo není objekt',
    });
  });
});

/** Přidá do světa obytnou budovu s danou populací. */
function addResidents(world: WorldState, population: number): void {
  world.buildings.set(world.nextBuildingId, {
    id: world.nextBuildingId,
    definitionId: 'vanilla:residential_small',
    x: 10,
    y: 10,
    level: 1,
    population,
    jobs: 0,
    powered: true,
    abandoned: false,
    builtAtTick: 0,
    levelChangedAtTick: 0,
  });
  world.nextBuildingId++;
}

/** Syrový balanc z obsahu, aby šly zkoušet chyby ve validaci. */
function rawBalance(): Record<string, unknown> {
  const modules = import.meta.glob('../content/vanilla/balance.json', {
    eager: true,
    import: 'default',
  });
  return structuredClone(Object.values(modules)[0]) as Record<string, unknown>;
}
