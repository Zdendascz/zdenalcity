import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { buildRoad } from '@/sim/commands';
import { takeLoan } from '@/sim/finance';
import { ROAD } from '@/sim/layers';
import {
  LEDGER_EXPENSES,
  LEDGER_INCOME,
  closeYearIfDue,
  ledgerResult,
  ledgerTotal,
  yearOf,
} from '@/sim/ledger';
import { createEconomySystem, createFinanceSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import { serializeSave } from '@/save/serialize';
import { applySaveToWorld, unpackSave } from '@/save/deserialize';
import { migrate } from '@/save/migrations';

/**
 * Účetní kniha a celoroční vyúčtování (T112).
 *
 * Kniha není druhý výpočet, ale **jediná cesta k penězům**: kdo hne kasou,
 * hne s ní přes `earn`/`spend`. Testuje se přesně tahle vlastnost — kdyby se
 * někde platilo bokem, výkaz by tiše přestal souhlasit s kasou.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

describe('účetní kniha', () => {
  it('co ubude z kasy, je i v knize', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    const before = world.economy.funds;

    for (let x = 10; x < 20; x++) buildRoad(world, x, 10, ROAD.street, balance);

    const spent = before - world.economy.funds;
    expect(spent).toBeGreaterThan(0);
    expect(world.economy.ledger.expenses['roads']).toBe(spent);
    expect(ledgerTotal(world.economy.ledger.expenses)).toBe(spent);
  });

  it('půjčka přijde jako příjem a splátka se strhne jednou, ne dvakrát', async () => {
    /*
     * Nález z ledna 2026: splátka byla v měsíčním rozpočtu (aby hráč viděl
     * celý náklad) **a zároveň** ji o tik později strhl finanční systém.
     * Změřeno na půjčce se splátkou 540: kasa klesla o 1080 za měsíc, dluh
     * jen o 540. Město tedy platilo dvojnásobek a dluh mu ubýval polovinou
     * rychlostí.
     */
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    const house = content.get('vanilla:residential_small');
    expect(house).toBeDefined();
    if (!house) return;
    placeBuilding(world, house, 10, 10);

    world.economy.funds = 100000;
    world.economy.lastIncome = 5000;
    const loan = takeLoan(world, balance, 12000, 24);
    expect(loan).not.toBeNull();
    if (!loan) return;
    expect(world.economy.ledger.income['loan']).toBe(12000);

    const owedBefore = loan.remaining;
    const fundsBefore = world.economy.funds;
    const systems = [
      createEconomySystem(content, balance),
      createFinanceSystem(content, balance, []),
    ];
    // Přesně jeden měsíc: uzávěrka i splátka proběhnou jednou.
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);

    expect(owedBefore - loan.remaining).toBe(loan.payment);
    const paid = world.economy.ledger.expenses['loanPayment'] ?? 0;
    expect(paid).toBe(loan.payment);

    // A kasa se hnula přesně o to, co kniha říká — daň z jednoho domku
    // v tom je taky, tak se porovnává bilance, ne holá splátka.
    const change = world.economy.funds - fundsBefore;
    const booked =
      ledgerTotal(world.economy.ledger.income) -
      ledgerTotal(world.economy.ledger.expenses) -
      12000; // půjčka přišla ještě před měřením
    expect(change).toBe(booked);
  });

  it('rok se uzavře na přelomu a nový začne prázdný', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);

    buildRoad(world, 10, 10, ROAD.street, balance);
    expect(world.economy.ledger.year).toBe(1);
    expect(closeYearIfDue(world)).toBe(false);

    world.tick = 360;
    expect(yearOf(world.tick)).toBe(2);
    expect(closeYearIfDue(world)).toBe(true);

    expect(world.economy.lastYear?.year).toBe(1);
    expect(world.economy.ledger.year).toBe(2);
    expect(ledgerTotal(world.economy.ledger.expenses)).toBe(0);
    // Výsledek roku je rozdíl stran, ne odhad z kasy.
    const closed = world.economy.lastYear;
    expect(closed).not.toBeNull();
    if (closed) {
      expect(ledgerResult(closed)).toBe(
        ledgerTotal(closed.income) - ledgerTotal(closed.expenses),
      );
    }
  });

  it('prázdný rok se nehlásí — město založené v prosinci nedostane výkaz o ničem', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.tick = 360;

    expect(closeYearIfDue(world)).toBe(false);
    expect(world.economy.lastYear).toBeNull();
    expect(world.economy.ledger.year).toBe(2);
  });

  it('kniha přežije uložení a načtení', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    for (let x = 10; x < 16; x++) buildRoad(world, x, 10, ROAD.street, balance);
    world.economy.lastYear = { year: 1, income: { grant: 500 }, expenses: { roads: 120 } };

    const bytes = serializeSave(world, {
      cityName: 'Nový Brod',
      createdAt: '2026-08-18T10:00:00.000Z',
      modifiedAt: '2026-08-18T12:30:00.000Z',
      playtimeSeconds: 1,
      sources: [{ id: 'vanilla', version: '0.1.0' }],
    });
    const restored = createWorld(2, balance.economy);
    applySaveToWorld(restored, migrate(unpackSave(bytes)));

    expect(restored.economy.ledger).toEqual(world.economy.ledger);
    expect(restored.economy.lastYear).toEqual(world.economy.lastYear);
  });

  it('každá položka knihy má překlad ve všech jazycích', async () => {
    // Neznámý klíč by se ve vyúčtování vypsal syrový. Je to vidět na první
    // pohled, ale až v hotové hře — tenhle test to chytí dřív.
    const content = await vanilla();
    for (const language of content.getLanguages()) {
      const table = content.getLocaleTable(language);
      for (const key of [...LEDGER_INCOME, ...LEDGER_EXPENSES]) {
        expect(table[`ui.ledger.${key}`], `${language}: ui.ledger.${key}`).toBeTruthy();
      }
    }
  });
});
