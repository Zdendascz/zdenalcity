import { describe, expect, it } from 'vitest';
import { validateBalance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { validateDefinition } from '@/content/schema';
import type { GrantDefinition } from '@/content/schema';
import { requestLoan } from '@/sim/commands';
import {
  awardGrants,
  grantConditionHolds,
  loanCap,
  loanProblems,
  loanRate,
  loanTerms,
  monthlyPayments,
  payLoans,
  takeLoan,
  totalDebt,
} from '@/sim/finance';
import { computeBudget } from '@/sim/systems/economy';
import { createFinanceSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

/**
 * Půjčky, granty a rating (T57).
 *
 * Tři věci, které spolu drží. Půjčka je **jediná cesta z mínusu** — bankrot je
 * v téhle hře měkký, takže bez úvěru se město po zemětřesení jen pomalu rozpadá
 * a hráč nemá čím zasáhnout. Rating je jediný trest za nesplácení. Grant je
 * odměna za milník, ne za správu, a přizná se jednou za hru.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Svět s daným měsíčním příjmem — od něj se odvozuje strop půjčky. */
function city(income: number, funds = 10000): WorldState {
  const world = createWorld(1, VANILLA_BALANCE.economy);
  world.economy.funds = funds;
  world.economy.lastIncome = income;
  return world;
}

describe('strop a úrok půjčky', () => {
  it('strop se odvozuje od příjmu, ne od kasy', async () => {
    // Půjčka má být přemostěním, ne způsobem, jak si koupit město, které se
    // neuživí. Kasa o splatitelnosti neříká nic.
    const balance = VANILLA_BALANCE;
    const poor = city(1000, 5_000_000);
    const rich = city(50000, 0);

    expect(loanCap(poor, balance)).toBe(1000 * balance.finance.loanIncomeMultiple);
    expect(loanCap(rich, balance)).toBeGreaterThan(loanCap(poor, balance));
  });

  it('už půjčené se od stropu odečítá', () => {
    const balance = VANILLA_BALANCE;
    const world = city(10000);
    const full = loanCap(world, balance);

    takeLoan(world, balance, Math.floor(full / 2), 24);
    // Zbývá míň než polovina: dluží se i úrok.
    expect(loanCap(world, balance)).toBeLessThan(full / 2);
    expect(loanCap(world, balance)).toBeGreaterThan(0);
  });

  it('město bez příjmu si nepůjčí nic', () => {
    const world = city(0, 100000);
    expect(loanCap(world, VANILLA_BALANCE)).toBe(0);
    expect(loanProblems(world, VANILLA_BALANCE, 1000, 24)).toContain('overCap');
  });

  it('špatný rating zdraží úrok', () => {
    // Jediný trest za nesplácení, protože tvrdý bankrot hra nemá.
    const balance = VANILLA_BALANCE;
    const clean = city(10000);
    const spoiled = city(10000);
    spoiled.economy.creditRating = 0;

    expect(loanRate(clean, balance)).toBe(balance.finance.baseRate);
    expect(loanRate(spoiled, balance)).toBe(balance.finance.baseRate + balance.finance.ratePenalty);
    expect(loanRate(spoiled, balance)).toBeGreaterThan(loanRate(clean, balance));
  });

  it('dražší úrok znamená vyšší splátku za tutéž jistinu', () => {
    const balance = VANILLA_BALANCE;
    const clean = city(10000);
    const spoiled = city(10000);
    spoiled.economy.creditRating = 0;

    const a = takeLoan(clean, balance, 100000, 24);
    const b = takeLoan(spoiled, balance, 100000, 24);
    expect(a?.payment).toBeGreaterThan(0);
    expect(b?.payment).toBeGreaterThan(a?.payment ?? 0);
    // Jistina je stejná, liší se jen to, kolik se vrátí navíc.
    expect(a?.principal).toBe(b?.principal);
    expect(b?.remaining).toBeGreaterThan(a?.remaining ?? 0);
  });
});

describe('sjednání a splácení', () => {
  it('peníze přijdou hned, splácí se od příštího měsíce', () => {
    const balance = VANILLA_BALANCE;
    const world = city(10000, 500);
    const loan = takeLoan(world, balance, 60000, 24);

    expect(loan).not.toBeNull();
    expect(world.economy.funds).toBe(500 + 60000);
    expect(loan?.paidMonths).toBe(0);
    // Vrací se víc, než přišlo: to je ten úrok.
    expect(loan?.remaining).toBeGreaterThan(60000);
  });

  it('splátky ubírají dluh a po doplacení půjčka zmizí', () => {
    const balance = VANILLA_BALANCE;
    const world = city(10000, 1_000_000);
    const loan = takeLoan(world, balance, 12000, 12);
    if (!loan) throw new Error('půjčka nevznikla');
    // Dluh se během splácení mění, tak si ho zapamatuj teď.
    const owed = loan.remaining;

    for (let month = 0; month < loan.termMonths + 2; month++) {
      expect(payLoans(world, balance), `měsíc ${month}`).toBe(0);
    }

    expect(world.loans).toHaveLength(0);
    expect(totalDebt(world)).toBe(0);
    // Zaplatilo se přesně to, co se dlužilo — ani koruna navíc.
    expect(world.economy.funds).toBe(1_000_000 + 12000 - owed);
  });

  it('poslední splátka nepřeplatí dluh', () => {
    // Splátka se zaokrouhluje nahoru, takže poslední měsíc bývá menší.
    const balance = VANILLA_BALANCE;
    const world = city(10000, 1_000_000);
    const loan = takeLoan(world, balance, 7777, 13);
    if (!loan) throw new Error('půjčka nevznikla');
    const owed = loan.remaining;

    const before = world.economy.funds;
    for (let month = 0; month < loan.termMonths + 2; month++) payLoans(world, balance);
    expect(before - world.economy.funds).toBe(owed);
  });

  it('na co město nemá, to nesplatí — a rating klesne', () => {
    const balance = VANILLA_BALANCE;
    const world = city(10000, 1_000_000);
    const loan = takeLoan(world, balance, 100000, 24);
    if (!loan) throw new Error('půjčka nevznikla');

    world.economy.funds = 0;
    const before = world.economy.creditRating;
    expect(payLoans(world, balance)).toBe(1);

    expect(world.economy.creditRating).toBeCloseTo(before - balance.finance.missedPenalty, 5);
    // Dluh zůstal celý: nesplacená splátka se neodpouští.
    expect(loan.remaining).toBe(world.loans[0]?.remaining);
    expect(loan.paidMonths).toBe(0);
  });

  it('rating se léčí pomaleji, než padá', () => {
    // Kdyby to bylo naopak, stačilo by pár měsíců v černých číslech
    // a nesplácení by nic nestálo.
    const balance = VANILLA_BALANCE;
    expect(balance.finance.ratingRecovery).toBeLessThan(balance.finance.missedPenalty);

    const world = city(10000, 1_000_000);
    takeLoan(world, balance, 100000, 24);
    world.economy.funds = 0;
    payLoans(world, balance);
    const wounded = world.economy.creditRating;

    world.economy.funds = 1_000_000;
    payLoans(world, balance);
    const healed = world.economy.creditRating;

    expect(healed).toBeGreaterThan(wounded);
    expect(healed - wounded).toBeLessThan(balance.finance.missedPenalty);
  });

  it('rating nikdy nepřeteče mimo rozsah', () => {
    const balance = VANILLA_BALANCE;
    const world = city(10000, 1_000_000);
    for (let month = 0; month < 200; month++) payLoans(world, balance);
    expect(world.economy.creditRating).toBe(1);

    takeLoan(world, balance, 100000, 120);
    world.economy.funds = 0;
    for (let month = 0; month < 200; month++) payLoans(world, balance);
    expect(world.economy.creditRating).toBe(0);
  });

  it('víc půjček než strop nejde sjednat', () => {
    const balance = VANILLA_BALANCE;
    const world = city(100000, 0);
    for (let i = 0; i < balance.finance.maxLoans; i++) {
      expect(takeLoan(world, balance, 1000, 24), `půjčka ${i}`).not.toBeNull();
    }
    expect(takeLoan(world, balance, 1000, 24)).toBeNull();
    expect(loanProblems(world, balance, 1000, 24)).toContain('tooMany');
  });

  it('nesmyslná částka ani doba neprojdou', () => {
    const balance = VANILLA_BALANCE;
    const world = city(10000);

    expect(loanProblems(world, balance, 0, 24)).toContain('invalidAmount');
    expect(loanProblems(world, balance, -5, 24)).toContain('invalidAmount');
    expect(loanProblems(world, balance, 1000, balance.finance.minTermMonths - 1)).toContain(
      'invalidTerm',
    );
    expect(loanProblems(world, balance, 1000, balance.finance.maxTermMonths + 1)).toContain(
      'invalidTerm',
    );
    expect(loanProblems(world, balance, 1000, 24.5)).toContain('invalidTerm');
  });

  it('příkaz řekne, proč to nejde', () => {
    // Půjčka je jediná cesta z mínusu; hráč, který ji nedostane, musí vědět co s tím.
    const balance = VANILLA_BALANCE;
    const world = city(1000);

    expect(requestLoan(world, balance, 0, 24)).toEqual({
      ok: false,
      reason: 'error.invalidAmount',
      params: { amount: 0 },
    });
    expect(requestLoan(world, balance, 999999999, 24)).toEqual({
      ok: false,
      reason: 'error.overLoanCap',
      params: { cap: loanCap(world, balance) },
    });
    expect(requestLoan(world, balance, 1000, 1)).toEqual({
      ok: false,
      reason: 'error.invalidTerm',
      params: { min: balance.finance.minTermMonths, max: balance.finance.maxTermMonths },
    });
    expect(requestLoan(world, undefined, 1000, 24)).toEqual({
      ok: false,
      reason: 'error.noFinanceRules',
    });
  });

  it('dluh a splátky jsou vidět v rozpočtu', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = city(10000, 1_000_000);
    const loan = takeLoan(world, balance, 50000, 24);
    if (!loan) throw new Error('půjčka nevznikla');

    const budget = computeBudget(world, content, balance);
    expect(budget.debt.loans).toBe(1);
    expect(budget.debt.owed).toBe(totalDebt(world));
    expect(budget.debt.payment).toBe(monthlyPayments(world));
    expect(budget.debt.payment).toBeGreaterThan(0);

    // A propisuje se do výdajů, ne jen do vlastního řádku.
    const clean = computeBudget({ ...world, loans: [] } as WorldState, content, balance);
    expect(budget.expenses - clean.expenses).toBe(budget.debt.payment);
  });
});

describe('granty jsou obsah', () => {
  it('vanilla je má ve vlastní složce a registr je vede zvlášť', async () => {
    const content = await vanilla();
    const grants = content.grants();

    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant.type).toBe('grant');
      expect(grant.amount).toBeGreaterThan(0);
    }
    // Grant není budova a mezi budovy se neplete.
    const ids = new Set(content.getAll('building').map((definition) => definition.id));
    for (const grant of grants) expect(ids.has(grant.id)).toBe(false);
  });

  it('pořadí grantů je pevné, ne v jakém je vrátil glob', async () => {
    const content = await vanilla();
    const ids = content.grants().map((grant) => grant.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('pořadí nezávisí na tom, jak se soubory jmenují', async () => {
    // Vanilla má jména souborů náhodou v pořadí id. Mod je mít nemusí — a na
    // pořadí záleží, protože granty se přiznávají v témže tiku a každý přidá
    // peníze (P2).
    const registry = new ContentRegistry();
    await registry.load({
      label: 'test',
      manifest: {
        id: 'testmod',
        name: 'Test Mod',
        version: '1.0.0',
        gameVersion: '>=0.1.0',
        dependencies: [],
      },
      definitions: [
        {
          path: 'grants/aaa.json',
          data: {
            id: 'testmod:zzz',
            type: 'grant',
            name: 'grant.z.name',
            description: 'grant.z.desc',
            amount: 1,
            condition: { metric: 'population', atLeast: 1 },
          },
        },
        {
          path: 'grants/zzz.json',
          data: {
            id: 'testmod:aaa',
            type: 'grant',
            name: 'grant.a.name',
            description: 'grant.a.desc',
            amount: 1,
            condition: { metric: 'population', atLeast: 1 },
          },
        },
      ],
      locales: {
        en: {
          'grant.z.name': 'Z',
          'grant.z.desc': 'Z.',
          'grant.a.name': 'A',
          'grant.a.desc': 'A.',
        },
      },
    });

    expect(registry.grants().map((grant) => grant.id)).toEqual([
      'testmod:aaa',
      'testmod:zzz',
    ]);
  });

  it('schéma odmítne grant bez částky i bez podmínky', () => {
    const base = {
      id: 'testmod:grant',
      type: 'grant',
      name: 'grant.x.name',
      description: 'grant.x.desc',
      amount: 100,
      condition: { metric: 'population', atLeast: 10 },
    };
    expect(validateDefinition(base, 'testmod').issues).toEqual([]);

    const without = (key: keyof typeof base): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...base };
      delete copy[key];
      return copy;
    };
    expect(validateDefinition(without('amount'), 'testmod').definition).toBeNull();
    expect(validateDefinition(without('condition'), 'testmod').definition).toBeNull();

    expect(
      validateDefinition({ ...base, condition: { metric: 'population' } }, 'testmod').definition,
    ).toBeNull();
  });

  it('schéma odmítne neznámý typ, ale grant s cizí veličinou pustí', () => {
    // Neznámá veličina je rozšíření, ne překlep: mod si smí přidat vlastní
    // milník a hra ho nesmí odmítnout jen proto, že o něm neví.
    // A řekne **proč**: neznámý typ, ne dvacet chybějících sekcí budovy.
    const alien = validateDefinition({ id: 'testmod:x', type: 'vozidlo' }, 'testmod');
    expect(alien.definition).toBeNull();
    expect(alien.issues).toEqual([
      { field: 'type', message: 'podporováno je "building" a "grant"' },
    ]);

    const exotic = validateDefinition(
      {
        id: 'testmod:grant',
        type: 'grant',
        name: 'grant.x.name',
        description: 'grant.x.desc',
        amount: 100,
        condition: { metric: 'sopky', atLeast: 3 },
      },
      'testmod',
    );
    expect(exotic.issues).toEqual([]);
    expect(exotic.definition?.type).toBe('grant');
  });
});

describe('přiznávání grantů', () => {
  const grant = (
    id: string,
    condition: GrantDefinition['condition'],
    amount = 1000,
  ): GrantDefinition => ({
    id,
    type: 'grant',
    name: `${id}.name`,
    description: `${id}.desc`,
    amount,
    condition,
  });

  const emptyCatalogue = { get: () => undefined, byCategory: () => [] };

  it('přizná se, jakmile milník padne — a peníze přijdou', async () => {
    const content = await vanilla();
    const world = city(0, 0);
    const one = grant('test:pop', { metric: 'population', atLeast: 100 }, 5000);

    expect(awardGrants(world, content, [one])).toEqual([]);
    expect(world.economy.funds).toBe(0);

    const house = content.get('vanilla:residential_small');
    if (!house) throw new Error('chybí obytná budova');
    world.buildings.set(1, {
      id: 1,
      definitionId: house.id,
      x: 10,
      y: 10,
      level: 1,
      population: 150,
      jobs: 0,
      powered: true,
      abandoned: false,
      builtAtTick: 0,
      levelChangedAtTick: 0,
    });

    expect(awardGrants(world, content, [one])).toEqual(['test:pop']);
    expect(world.economy.funds).toBe(5000);
  });

  it('do populace se ruiny nepočítají', async () => {
    // Vylidněný dům není obyvatel. Kdyby se počítal, dostalo by město dotaci
    // za tisícovku lidí zrovna ve chvíli, kdy se odstěhovali.
    const content = await vanilla();
    const world = city(0, 0);
    const one = grant('test:pop', { metric: 'population', atLeast: 100 }, 5000);

    const house = content.get('vanilla:residential_small');
    if (!house) throw new Error('chybí obytná budova');
    world.buildings.set(1, {
      id: 1,
      definitionId: house.id,
      x: 10,
      y: 10,
      level: 1,
      population: 150,
      jobs: 0,
      powered: true,
      abandoned: true,
      builtAtTick: 0,
      levelChangedAtTick: 0,
    });

    expect(grantConditionHolds(world, content, one)).toBe(false);

    const building = world.buildings.get(1);
    if (building) building.abandoned = false;
    expect(grantConditionHolds(world, content, one)).toBe(true);
  });

  it('každý grant jen jednou za hru', async () => {
    const content = await vanilla();
    const world = city(0, 0);
    const one = grant('test:always', { metric: 'buildings', atLeast: 0 }, 100);

    expect(awardGrants(world, content, [one])).toEqual(['test:always']);
    expect(awardGrants(world, content, [one])).toEqual([]);
    expect(awardGrants(world, content, [one])).toEqual([]);
    expect(world.economy.funds).toBe(100);
    expect(world.grantsAwarded.has('test:always')).toBe(true);
  });

  it('podmínka na čas musí platit v kuse', async () => {
    // Bez toho by šel grant za spokojenost sebrat tím, že hráč na jediný tik
    // srazí daně na nulu, vybere si odměnu a hned je vrátí zpátky.
    const content = await vanilla();
    const world = city(0, 0);
    const one = grant('test:calm', { metric: 'happiness', atLeast: 200, forTicks: 5 }, 700);

    world.happiness.fill(220);
    for (let tick = 0; tick < 4; tick++) expect(awardGrants(world, content, [one])).toEqual([]);

    // Přerušení počítadlo maže.
    world.happiness.fill(10);
    expect(awardGrants(world, content, [one])).toEqual([]);
    expect(world.grantProgress.has('test:calm')).toBe(false);

    world.happiness.fill(220);
    for (let tick = 0; tick < 4; tick++) expect(awardGrants(world, content, [one])).toEqual([]);
    expect(awardGrants(world, content, [one])).toEqual(['test:calm']);
    expect(world.economy.funds).toBe(700);
  });

  it('podmínka na budovu se ptá katalogu, ne na jméno', async () => {
    const content = await vanilla();
    const world = city(0, 0);
    const one = grant('test:uni', {
      metric: 'building',
      atLeast: 1,
      definitionId: 'vanilla:university',
    });

    expect(grantConditionHolds(world, content, one)).toBe(false);

    world.buildings.set(1, {
      id: 1,
      definitionId: 'vanilla:university',
      x: 10,
      y: 10,
      level: 1,
      population: 0,
      jobs: 0,
      powered: true,
      abandoned: false,
      builtAtTick: 0,
      levelChangedAtTick: 0,
    });
    expect(grantConditionHolds(world, content, one)).toBe(true);

    // Ruina se nepočítá: vysokou školu, ze které zbyl vrak, nikdo nepochválí.
    const building = world.buildings.get(1);
    if (building) building.abandoned = true;
    expect(grantConditionHolds(world, content, one)).toBe(false);
  });

  it('neznámá veličina grant nepřizná a nespadne', async () => {
    const content = await vanilla();
    const world = city(0, 0);
    const one = grant('test:sopky', { metric: 'sopky', atLeast: 1 });

    expect(grantConditionHolds(world, content, one)).toBe(false);
    expect(awardGrants(world, content, [one])).toEqual([]);
    expect(world.economy.funds).toBe(0);
  });

  it('systém granty rozdá sám', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = city(0, 0);
    const one = grant('test:free', { metric: 'buildings', atLeast: 0 }, 250);

    const systems = [createFinanceSystem(content, balance, [one])];
    tickWorld(world, systems);
    expect(world.economy.funds).toBe(250);
    tickWorld(world, systems);
    expect(world.economy.funds).toBe(250);
  });

  it('systém splácí jednou za měsíc, ne každý tik', async () => {
    // Splátky patří za rozpočet: město má nejdřív vybrat daně a pak platit.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = city(10000, 1_000_000);
    const loan = takeLoan(world, balance, 24000, 24);
    if (!loan) throw new Error('půjčka nevznikla');
    const owed = loan.remaining;

    const systems = [createFinanceSystem(content, balance, [])];
    // Splátka padne jednou za měsíc — první hned v prvním tiku, další za třicet.
    tickWorld(world, systems);
    expect(loan.paidMonths).toBe(1);
    expect(loan.remaining).toBeLessThan(owed);

    // Dalších devětadvacet tiků je ticho: neplatí se každý tik.
    const afterFirst = loan.remaining;
    for (let tick = 0; tick < 29; tick++) tickWorld(world, systems);
    expect(loan.remaining, 'splácí se častěji než jednou za měsíc').toBe(afterFirst);
    expect(loan.paidMonths).toBe(1);

    // A třicátý tik po první splátce zase.
    tickWorld(world, systems);
    expect(loan.remaining).toBeLessThan(afterFirst);
    expect(loan.paidMonths).toBe(2);
  });

  it('prázdný katalog granty nerozbije', () => {
    const world = city(0, 0);
    const one = grant('test:x', { metric: 'population', atLeast: 1 });
    expect(awardGrants(world, emptyCatalogue, [one])).toEqual([]);
  });
});

describe('validace financí', () => {
  it('odmítne balanc, kde se rating léčí rychleji, než padá', () => {
    const raw = rawBalance();
    const finance = raw['finance'] as Record<string, unknown>;
    finance['ratingRecovery'] = finance['missedPenalty'];

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('finance');
  });

  it('odmítne nejdelší dobu kratší než nejkratší', () => {
    const raw = rawBalance();
    const finance = raw['finance'] as Record<string, unknown>;
    finance['maxTermMonths'] = 6;
    finance['minTermMonths'] = 12;

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('finance');
  });
});

describe('podmínky půjčky', () => {
  it('slíbená doba půjčku opravdu splatí', () => {
    // Splátka se zaokrouhluje **nahoru**. Kdyby dolů, součet splátek by byl
    // menší než dluh, poslední měsíc by nic nedoplatil a půjčka by městu
    // visela dál — přestože panel i evidence tvrdí „splaceno 60 z 60".
    for (const amount of [1000, 12_345, 100_000, 999_999]) {
      for (const rate of [0, 4, 7.5, 12]) {
        for (const term of [12, 36, 60, 120]) {
          const terms = loanTerms(amount, rate, term);
          expect(terms.payment * term, `${amount} / ${rate} % / ${term} m`).toBeGreaterThanOrEqual(
            terms.total,
          );
        }
      }
    }
  });

  it('bezúročná půjčka vrátí přesně jistinu', () => {
    expect(loanTerms(60_000, 0, 60)).toEqual({ total: 60_000, payment: 1000 });
  });
});

/** Syrový balanc z obsahu, aby šly zkoušet chyby ve validaci. */
function rawBalance(): Record<string, unknown> {
  const modules = import.meta.glob('../content/vanilla/balance.json', {
    eager: true,
    import: 'default',
  });
  return structuredClone(Object.values(modules)[0]) as Record<string, unknown>;
}
