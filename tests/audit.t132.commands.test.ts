import { beforeAll, describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  buildRoad,
  createTransitLine,
  deleteTransitLine,
  levelArea,
  placeDefinition,
  placeDefinitionCommand,
  requestLoan,
  setLineVehicles,
  setTaxRate,
  zoneArea,
} from '@/sim/commands';
import { issueBondCommand } from '@/sim/commands';
import { index, ROAD, ZONE } from '@/sim/layers';
import { createSimHost } from '@/sim/simHost';
import { createWorld } from '@/sim/world';

/**
 * Příkazy po auditu T132 (nálezy 7 a 10).
 *
 * Příkaz nemusí přijít z lišty: umí ho poslat konzole nebo budoucí vstup.
 * Validace proto patří do simulace (architektura §5) a hlídá hodnoty, které
 * by jinak rozbily vrstvu, kasu nebo save.
 */

let content: ContentRegistry;
beforeAll(async () => {
  content = new ContentRegistry();
  await content.load(createVanillaSource());
});

describe('zrušená linka proplatí vozidla (nález 7)', () => {
  it('stejně jako vyprázdnění linky na nulu', () => {
    const balance = content.getBalance();
    const vehicleCost = balance.transit.modes['bus']!.vehicleCost;

    const world = createWorld(1, balance.economy);
    world.economy.funds = 100000;
    createTransitLine(world, balance, 'bus');
    const line = world.lines.at(-1)!;
    expect(setLineVehicles(world, balance, line.id, 4).ok).toBe(true);
    const before = world.economy.funds;

    expect(deleteTransitLine(world, line.id, balance).ok).toBe(true);
    expect(world.economy.funds).toBe(before + 4 * vehicleCost);
    // Tentýž řádek knihy jako při snížení počtu vozidel.
    expect(world.economy.ledger.income['refund']).toBe(4 * vehicleCost);
  });

  it('přes SimHost taky', () => {
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    const host = createSimHost(world, [], content, balance);
    host.dispatch({ type: 'create_line', mode: 'bus' });
    const line = world.lines.at(-1)!;
    host.dispatch({ type: 'set_vehicles', lineId: line.id, vehicles: 2 });
    const before = world.economy.funds;

    expect(host.dispatch({ type: 'delete_line', lineId: line.id }).ok).toBe(true);
    expect(world.economy.funds).toBe(before + 2 * balance.transit.modes['bus']!.vehicleCost);
  });
});

describe('validace příkazů (nález 10)', () => {
  it('silnice jen známého typu', () => {
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    for (const type of [0, 4, 1.5, Number.NaN, -1, 255]) {
      const result = buildRoad(world, 10, 10, type, balance);
      expect(result.ok, `typ ${type}`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('error.unknownRoadType');
    }
    expect(world.layers.road[index(10, 10, world.size)]).toBe(ROAD.none);
    expect(buildRoad(world, 10, 10, ROAD.highway, balance).ok).toBe(true);
  });

  it('budovu zóny ručně postavit nejde, službu ano', () => {
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 1e6;
    for (let x = 5; x < 20; x++) buildRoad(world, x, 10, ROAD.street, balance);

    expect(placeDefinitionCommand(world, content, 'vanilla:residential_small', 6, 11, balance)).toEqual({
      ok: false,
      reason: 'error.notPlaceable',
    });
    expect(world.buildings.size).toBe(0);
    expect(placeDefinitionCommand(world, content, 'vanilla:police_small', 6, 11, balance).ok).toBe(true);

    // Přes SimHost jde totéž — to je cesta z konzole.
    const host = createSimHost(world, [], content, balance);
    expect(
      host.dispatch({ type: 'place_building', definitionId: 'vanilla:industrial_small', x: 10, y: 11 }).ok,
    ).toBe(false);
    // Pomocník pro testy a nástroje zůstává, jak byl. Průmysl chce vodu.
    world.waterSupply.fill(1);
    const helper = placeDefinition(world, content, 'vanilla:industrial_small', 10, 11, balance);
    expect(helper.ok, JSON.stringify(helper)).toBe(true);
  });

  it('daňová sazba musí být číslo', () => {
    const world = createWorld(1);
    const before = world.economy.taxRates.residential;
    for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(setTaxRate(world, ZONE.residential, rate)).toEqual({
        ok: false,
        reason: 'error.invalidTaxRate',
      });
    }
    expect(world.economy.taxRates.residential).toBe(before);
  });

  it('půjčka i dluhopis jen na celé koruny', () => {
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    // Strop půjčky i emise se počítá z příjmů; čerstvé město žádné nemá.
    world.economy.lastIncome = 100000;
    const funds = world.economy.funds;
    const term = balance.finance.minTermMonths;

    expect(requestLoan(world, balance, 1000.5, term).ok).toBe(false);
    expect(world.economy.funds).toBe(funds);
    expect(world.loans).toHaveLength(0);
    expect(requestLoan(world, balance, 1000, term).ok).toBe(true);

    const bond = issueBondCommand(
      world,
      balance,
      10000.25,
      5,
      balance.finance.bonds.minMaturityTicks,
    );
    expect(bond.ok).toBe(false);
  });

  it('obdélník zón i srovnání má horní mez', () => {
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    const started = Date.now();
    for (const [w, h] of [
      [1e9, 1],
      [1, 1e9],
      [world.size + 1, 1],
      [2.5, 2],
      [-3, 2],
    ] as const) {
      expect(zoneArea(world, 0, 0, w, h, ZONE.residential, balance)).toEqual({
        ok: false,
        reason: 'error.outOfBounds',
      });
      expect(levelArea(world, 0, 0, w, h, balance)).toEqual({
        ok: false,
        reason: 'error.outOfBounds',
      });
    }
    // Odmítnutí je okamžité, ne po miliardě průchodů smyčkou.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(zoneArea(world, 0, 0, world.size, 2, ZONE.residential, balance).ok).toBe(true);
  });
});
