import { describe, expect, it } from 'vitest';
import { validateBalance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  addTransitStop,
  buildRoad,
  createTransitLine,
  deleteTransitLine,
  placeDefinition,
  removeTransitStop,
  setLineFare,
  setLineVehicles,
  setLinePaused,
} from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { coarseCongestion } from '@/sim/diagnostics';
import {
  corridorTiles,
  lineProblems,
  lineRuns,
  modeOf,
  rebuildTramTiles,
  roadCapacityFactor,
  stopMode,
} from '@/sim/transit';
import type { TransitLine } from '@/sim/transit';
import { index, ROAD } from '@/sim/layers';
import { createDefaultSystems, createTransitSystem } from '@/sim/systems';
import { createWorld, removeBuilding, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

/**
 * Linky MHD (T55): datový model, výběr zastávek, tři módy, tramvaj v dopravě.
 *
 * Podstatné je, že **mód je obsah, ne kód**: rozdíl mezi autobusem a tramvají
 * je v `balance.json`, ne v `if`. A že tramvaj je jediná, která do dopravního
 * modelu zasahuje záporně — bez toho by nebyl důvod volit autobus.
 *
 * Jízdné a kapacita se tady jen ukládají; co s nimi, přidává T56.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Ulice s depem a elektrárnou — bez nich se zastávka postavit nedá. */
function street(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 10000000;

  for (let x = 8; x < 60; x++) buildRoad(world, x, 20, ROAD.street, balance);
  expect(placeDefinition(world, content, 'vanilla:transit_depot', 8, 21, balance).ok).toBe(true);
  expect(
    placeDefinition(world, content, 'vanilla:coal_power_plant', 54, 21, balance).ok,
  ).toBe(true);

  // Zastávka s trakcí se bez proudu postavit nedá, takže síť musí naběhnout
  // dřív, než test začne stavět.
  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);
  return world;
}

/** Postaví zastávku daného druhu a vrátí její id. */
function addStop(
  world: WorldState,
  content: ContentRegistry,
  definitionId: string,
  x: number,
): number {
  const before = new Set(world.buildings.keys());
  const placed = placeDefinition(world, content, definitionId, x, 21, content.getBalance());
  expect(placed.ok, JSON.stringify(placed)).toBe(true);
  const id = [...world.buildings.keys()].find((key) => !before.has(key));
  if (id === undefined) throw new Error('zastávka nevznikla');
  return id;
}

function lastLine(world: WorldState): TransitLine {
  const line = world.lines[world.lines.length - 1];
  if (!line) throw new Error('žádná linka');
  return line;
}

describe('módy jsou obsah, ne kód', () => {
  it('vanilla nabízí autobus, tramvaj a metro', () => {
    const modes = VANILLA_BALANCE.transit.modes;
    expect(Object.keys(modes).sort()).toEqual(['bus', 'metro', 'tram']);
  });

  it('kapacita roste od autobusu k metru a cena s ní', () => {
    // Kdyby dražší mód nevozil víc, nebyl by důvod ho stavět.
    const { bus, tram, metro } = VANILLA_BALANCE.transit.modes;
    if (!bus || !tram || !metro) throw new Error('chybí mód');

    expect(tram.capacity).toBeGreaterThan(bus.capacity);
    expect(metro.capacity).toBeGreaterThan(tram.capacity);
    expect(tram.vehicleCost).toBeGreaterThan(bus.vehicleCost);
    expect(metro.vehicleCost).toBeGreaterThan(tram.vehicleCost);
  });

  it('jen tramvaj ukusuje ze silnice', () => {
    // Tohle je jediný důvod, proč vůbec volit autobus. Kdyby ukusovaly
    // všechny nebo žádná, byla by volba módu jen otázka rozpočtu.
    const { bus, tram, metro } = VANILLA_BALANCE.transit.modes;
    if (!bus || !tram || !metro) throw new Error('chybí mód');

    expect(bus.roadShare).toBe(0);
    expect(metro.roadShare).toBe(0);
    expect(tram.roadShare).toBeGreaterThan(0);
  });

  it('elektrickou trakci má tramvaj i metro, autobus ne', () => {
    const { bus, tram, metro } = VANILLA_BALANCE.transit.modes;
    if (!bus || !tram || !metro) throw new Error('chybí mód');

    expect(bus.needsPower).toBe(false);
    expect(tram.needsPower).toBe(true);
    expect(metro.needsPower).toBe(true);
  });

  it('neznámý mód nejde založit', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const result = createTransitLine(world, content.getBalance(), 'vanilla:teleport');
    expect(result).toEqual({
      ok: false,
      reason: 'error.unknownTransitMode',
      params: { mode: 'vanilla:teleport' },
    });
    expect(world.lines).toHaveLength(0);
  });

  it('validace odmítne balanc bez jediného módu', () => {
    const raw = rawBalance();
    const transit = raw['transit'] as Record<string, unknown>;
    transit['modes'] = {};

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('transit.modes');
  });

  it('validace odmítne strop zastávek pod dnem', () => {
    const raw = rawBalance();
    const transit = raw['transit'] as Record<string, unknown>;
    transit['maxStops'] = 2;
    transit['minStops'] = 5;

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('transit');
  });
});

describe('výběr zastávek', () => {
  it('zastávka zná svůj mód z katalogu, ne z id', async () => {
    const content = await vanilla();
    const world = street(content);

    const bus = addStop(world, content, 'vanilla:transit_stop', 12);
    const tram = addStop(world, content, 'vanilla:tram_stop', 16);
    const metro = addStop(world, content, 'vanilla:metro_station', 20);

    expect(stopMode(world, content, bus)).toBe('bus');
    expect(stopMode(world, content, tram)).toBe('tram');
    expect(stopMode(world, content, metro)).toBe('metro');
  });

  it('depo zastávka není', async () => {
    const content = await vanilla();
    const world = street(content);
    const depot = [...world.buildings.entries()].find(
      ([, b]) => b.definitionId === 'vanilla:transit_depot',
    );
    if (!depot) throw new Error('bez depa');
    expect(stopMode(world, content, depot[0])).toBeNull();
  });

  it('do linky jde přidat jen zastávka téhož módu', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const bus = addStop(world, content, 'vanilla:transit_stop', 12);
    const tram = addStop(world, content, 'vanilla:tram_stop', 16);

    expect(createTransitLine(world, balance, 'bus').ok).toBe(true);
    const line = lastLine(world);

    expect(addTransitStop(world, content, balance, line.id, bus).ok).toBe(true);
    // Tramvaj po autobusové zastávce nepojede.
    expect(addTransitStop(world, content, balance, line.id, tram)).toEqual({
      ok: false,
      reason: 'error.wrongStopMode',
      params: { mode: 'tram', expected: 'bus' },
    });
    expect(line.stops).toEqual([bus]);
  });

  it('budova, která není zastávka, se do linky nedostane', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const depot = [...world.buildings.keys()][0];
    if (depot === undefined) throw new Error('bez depa');

    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    expect(addTransitStop(world, content, balance, line.id, depot)).toEqual({
      ok: false,
      reason: 'error.notAStop',
    });
  });

  it('stejná zastávka se do linky nepřidá dvakrát', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const bus = addStop(world, content, 'vanilla:transit_stop', 12);

    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    expect(addTransitStop(world, content, balance, line.id, bus).ok).toBe(true);
    expect(addTransitStop(world, content, balance, line.id, bus)).toEqual({
      ok: false,
      reason: 'error.stopAlreadyOnLine',
    });
    expect(line.stops).toHaveLength(1);
  });

  it('víc zastávek než strop se nevejde', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);

    for (let i = 0; i < balance.transit.maxStops; i++) {
      const stop = addStop(world, content, 'vanilla:transit_stop', 12 + i * 3);
      expect(addTransitStop(world, content, balance, line.id, stop).ok, `zastávka ${i}`).toBe(true);
    }
    const extra = addStop(world, content, 'vanilla:transit_stop', 50);
    expect(addTransitStop(world, content, balance, line.id, extra)).toEqual({
      ok: false,
      reason: 'error.tooManyStops',
      params: { max: balance.transit.maxStops },
    });
  });

  it('pořadí zastávek je pořadí, ve kterém linka jede', async () => {
    // Odsud se odvozuje koridor. Kdyby na pořadí nezáleželo, tramvaj by
    // ukusovala kapacitu jinde, než kudy podle hráče jede.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const a = addStop(world, content, 'vanilla:transit_stop', 12);
    const b = addStop(world, content, 'vanilla:transit_stop', 30);
    const c = addStop(world, content, 'vanilla:transit_stop', 50);

    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    for (const stop of [c, a, b]) addTransitStop(world, content, balance, line.id, stop);
    expect(line.stops).toEqual([c, a, b]);

    expect(removeTransitStop(world, line.id, a).ok).toBe(true);
    expect(line.stops).toEqual([c, b]);
    expect(removeTransitStop(world, line.id, a)).toEqual({
      ok: false,
      reason: 'error.stopNotOnLine',
    });
  });

  it('linka s jednou zastávkou nikam nevede', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const bus = addStop(world, content, 'vanilla:transit_stop', 12);

    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    expect(lineProblems(world, content, balance, line)).toContain('tooFewStops');

    addTransitStop(world, content, balance, line.id, bus);
    expect(lineProblems(world, content, balance, line)).toContain('tooFewStops');

    const second = addStop(world, content, 'vanilla:transit_stop', 30);
    addTransitStop(world, content, balance, line.id, second);
    expect(lineProblems(world, content, balance, line)).toEqual([]);
  });
});

describe('vozidla a jízdné', () => {
  it('vozidla se platí a při ubrání se peníze vrátí', async () => {
    // Vozidlo se dá přesunout na jinou linku; hráč by jinak platil pokutu za
    // to, že si to rozmyslel.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    const cost = modeOf(balance, 'bus')?.vehicleCost ?? 0;
    expect(cost).toBeGreaterThan(0);

    const start = world.economy.funds;
    expect(setLineVehicles(world, balance, line.id, 3).ok).toBe(true);
    expect(world.economy.funds).toBe(start - cost * 3);

    expect(setLineVehicles(world, balance, line.id, 1).ok).toBe(true);
    expect(world.economy.funds).toBe(start - cost);
    expect(line.vehicles).toBe(1);
  });

  it('na co město nemá, to nekoupí', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);

    world.economy.funds = 10;
    const result = setLineVehicles(world, balance, line.id, 5);
    expect(result.ok).toBe(false);
    expect(line.vehicles).toBe(0);
    expect(world.economy.funds).toBe(10);
  });

  it('záporný počet vozidel ani jízdné neprojde', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);

    expect(setLineVehicles(world, balance, line.id, -1).ok).toBe(false);
    expect(setLineVehicles(world, balance, line.id, 1.5).ok).toBe(false);
    expect(setLineFare(world, line.id, -5).ok).toBe(false);
    expect(setLineFare(world, line.id, 12).ok).toBe(true);
    expect(line.fare).toBe(12);
  });

  it('smazaná linka zmizí i s vozidly', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);

    expect(deleteTransitLine(world, line.id).ok).toBe(true);
    expect(world.lines).toHaveLength(0);
    expect(deleteTransitLine(world, line.id)).toEqual({
      ok: false,
      reason: 'error.unknownLine',
      params: { id: line.id },
    });
  });
});

describe('tramvaj v dopravě', () => {
  /** Tramvajová linka po ulici y=20. `shift` posune zastávky, ať se netlučou. */
  function tramLine(world: WorldState, content: ContentRegistry, shift = 0): TransitLine {
    const balance = content.getBalance();
    const a = addStop(world, content, 'vanilla:tram_stop', 12 + shift);
    const b = addStop(world, content, 'vanilla:tram_stop', 48 - shift);
    createTransitLine(world, balance, 'tram');
    const line = lastLine(world);
    addTransitStop(world, content, balance, line.id, a);
    addTransitStop(world, content, balance, line.id, b);
    return line;
  }

  it('koridor vede po silnicích mezi zastávkami', async () => {
    const content = await vanilla();
    const world = street(content);
    const line = tramLine(world, content);

    const tiles = corridorTiles(world, line);
    expect(tiles.length).toBeGreaterThan(10);
    // Všechno jsou to silnice — koridor si nevymýšlí cestu přes louku.
    for (const tile of tiles) {
      expect(world.layers.road[tile], `dlaždice ${tile}`).not.toBe(ROAD.none);
    }
    // A vede tudy, kudy hráč zastávky postavil.
    expect(tiles).toContain(index(30, 20, MAP_SIZE));
  });

  it('kolej ubere silnici kapacitu, autobus ne', async () => {
    const content = await vanilla();
    const balance = content.getBalance();

    const withMode = (mode: string, stopId: string): number => {
      const world = street(content);
      const a = addStop(world, content, stopId, 12);
      const b = addStop(world, content, stopId, 48);
      createTransitLine(world, balance, mode);
      const line = lastLine(world);
      addTransitStop(world, content, balance, line.id, a);
      addTransitStop(world, content, balance, line.id, b);

      rebuildTramTiles(world, content, balance);
      return roadCapacityFactor(world, index(30, 20, MAP_SIZE));
    };

    const tilesAfter = (mode: string, stopId: string): number => {
      const world = street(content);
      const a = addStop(world, content, stopId, 12);
      const b = addStop(world, content, stopId, 48);
      createTransitLine(world, balance, mode);
      const line = lastLine(world);
      addTransitStop(world, content, balance, line.id, a);
      addTransitStop(world, content, balance, line.id, b);

      rebuildTramTiles(world, content, balance);
      return world.tramTiles.size;
    };

    expect(withMode('bus', 'vanilla:transit_stop')).toBe(1);
    expect(withMode('metro', 'vanilla:metro_station')).toBe(1);
    // A ani si nezakládají evidenci: mód bez kolejí nemá co udržovat.
    expect(tilesAfter('bus', 'vanilla:transit_stop')).toBe(0);
    expect(tilesAfter('metro', 'vanilla:metro_station')).toBe(0);
    const tram = withMode('tram', 'vanilla:tram_stop');
    expect(tram).toBeLessThan(1);
    expect(tram).toBeCloseTo(1 - (modeOf(balance, 'tram')?.roadShare ?? 0), 5);
  });

  it('menší kapacita znamená měřitelně horší kolony', async () => {
    // Akceptační kritérium 17: tramvajová linka měřitelně sníží kapacitu
    // silnic, po kterých vede.
    const content = await vanilla();
    const balance = content.getBalance();

    const congestionWith = (tram: boolean): number => {
      const world = street(content);
      if (tram) {
        tramLine(world, content);
        rebuildTramTiles(world, content, balance);
      }
      // Stejné zatížení v obou případech: měří se kapacita, ne provoz.
      for (let x = 8; x < 60; x++) world.trafficLoad[index(x, 20, MAP_SIZE)] = 30;
      return coarseCongestion(world, balance)[coarseIndex(30, 20, MAP_SIZE)] ?? 0;
    };

    const plain = congestionWith(false);
    const withTram = congestionWith(true);
    expect(plain).toBeGreaterThan(0);
    expect(withTram).toBeGreaterThan(plain);
  });

  it('dvě linky přes jednu ulici neuberou dvakrát', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);

    // Dvě samostatné linky po téže ulici, jen s jinými zastávkami.
    tramLine(world, content);
    tramLine(world, content, 2);
    rebuildTramTiles(world, content, balance);

    expect(roadCapacityFactor(world, index(30, 20, MAP_SIZE))).toBeCloseTo(
      1 - (modeOf(balance, 'tram')?.roadShare ?? 0),
      5,
    );
  });

  it('rozbitá linka koridor nedělá', async () => {
    // Linka s jedinou zastávkou nikam nevede, takže nemá co ubírat.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const a = addStop(world, content, 'vanilla:tram_stop', 12);
    createTransitLine(world, balance, 'tram');
    addTransitStop(world, content, balance, lastLine(world).id, a);

    rebuildTramTiles(world, content, balance);
    expect(world.tramTiles.size).toBe(0);
  });

  it('koridor se přepočítá sám, když hráč sáhne na linku', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const line = tramLine(world, content);

    const systems = [createTransitSystem(content, balance)];
    tickWorld(world, systems);
    expect(world.tramTiles.size).toBeGreaterThan(0);
    expect(world.transitDirty).toBe(false);

    // Přidání zastávky je taky změna: koridor se musí protáhnout.
    const short = world.tramTiles.size;
    const third = addStop(world, content, 'vanilla:tram_stop', 52);
    expect(addTransitStop(world, content, balance, line.id, third).ok).toBe(true);
    expect(world.transitDirty, 'přidání zastávky neoznačilo přepočet').toBe(true);
    tickWorld(world, systems);
    expect(world.tramTiles.size).toBeGreaterThan(short);

    expect(removeTransitStop(world, line.id, line.stops[0] ?? 0).ok).toBe(true);
    expect(world.transitDirty).toBe(true);
    tickWorld(world, systems);
    expect(world.tramTiles.size).toBeLessThan(short);
  });

  it('počítá se jen při změně, ne každý tik', async () => {
    // Koridor je odvozený stav jako elektřina nebo pokrytí. Přepočítávat ho
    // každý tik znamená pro každou linku projít celý koridor, a to i ve městě,
    // kde se na linky nesáhlo měsíce.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    tramLine(world, content);

    const systems = [createTransitSystem(content, balance)];
    tickWorld(world, systems);
    expect(world.transitDirty).toBe(false);

    // Podvržená hodnota: kdyby se přepočítávalo pořád, přepis by ji smazal.
    world.tramTiles.set(999_999, 0.5);
    tickWorld(world, systems);
    expect(world.tramTiles.get(999_999)).toBe(0.5);

    // A po skutečné změně se přepočet vrátí a podvrh zmizí.
    world.transitDirty = true;
    tickWorld(world, systems);
    expect(world.tramTiles.has(999_999)).toBe(false);
  });
});

describe('linka rozbitá zvenčí', () => {
  /**
   * Příkazy nepovolenou linku nepustí, ale `lineProblems` musí platit i tak.
   *
   * Do stavu se dá dostat jinudy než příkazem: savem ze starší verze, savem
   * z modu, který zastávku odebral, nebo obsahem, kde zastávka změnila mód.
   * Model si na to musí umět odpovědět sám — jinak by hra mlčky jezdila po
   * lince, která nedává smysl.
   */
  async function brokenLine(): Promise<{
    world: WorldState;
    content: ContentRegistry;
    line: TransitLine;
    good: [number, number];
  }> {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);

    const a = addStop(world, content, 'vanilla:tram_stop', 12);
    const b = addStop(world, content, 'vanilla:tram_stop', 48);
    const alien = addStop(world, content, 'vanilla:transit_stop', 30);

    createTransitLine(world, balance, 'tram');
    const line = lastLine(world);
    addTransitStop(world, content, balance, line.id, a);
    addTransitStop(world, content, balance, line.id, b);
    // Cizí mód rovnou do stavu, mimo příkaz.
    line.stops.push(alien);
    world.transitDirty = true;

    // Proud do všech zastávek: kdyby některá zůstala tmavá, `lineRuns` by
    // vracela `false` kvůli trakci a test by měřil něco jiného, než chce.
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);
    for (const stop of line.stops) expect(world.buildings.get(stop)?.powered).toBe(true);

    return { world, content, line, good: [a, b] };
  }

  it('zastávka cizího módu je problém, i když prošla mimo příkaz', async () => {
    const { world, content, line } = await brokenLine();
    expect(lineProblems(world, content, content.getBalance(), line)).toContain('wrongMode');
  });

  it('dvakrát tatáž zastávka je problém', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const a = addStop(world, content, 'vanilla:transit_stop', 12);
    const b = addStop(world, content, 'vanilla:transit_stop', 48);

    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    addTransitStop(world, content, balance, line.id, a);
    addTransitStop(world, content, balance, line.id, b);
    expect(lineProblems(world, content, balance, line)).toEqual([]);

    line.stops.push(a);
    expect(lineProblems(world, content, balance, line)).toContain('duplicateStop');
  });

  it('rozbitá linka nejezdí, i když má vozidla', async () => {
    const { world, content, line } = await brokenLine();
    const balance = content.getBalance();
    expect(setLineVehicles(world, balance, line.id, 3).ok).toBe(true);

    expect(lineProblems(world, content, balance, line).length).toBeGreaterThan(0);
    expect(lineRuns(world, content, balance, line)).toBe(false);
  });

  it('rozbitá linka neubírá kapacitu, i když by koridor byl', async () => {
    // Zastávky a, b spolu koridor tvoří — rozhodnout musí to, že linka je jako
    // celek vadná, ne to, že se nemá kudy táhnout.
    const { world, content, line } = await brokenLine();
    const balance = content.getBalance();

    // Bez vadné zastávky by koridor existoval.
    const healthy: TransitLine = { ...line, stops: line.stops.slice(0, 2) };
    expect(corridorTiles(world, healthy).length).toBeGreaterThan(10);

    rebuildTramTiles(world, content, balance);
    expect(world.tramTiles.size).toBe(0);
  });
});

describe('jede, nebo nejede', () => {
  function poweredTram(world: WorldState, content: ContentRegistry): TransitLine {
    const balance = content.getBalance();
    const a = addStop(world, content, 'vanilla:tram_stop', 12);
    const b = addStop(world, content, 'vanilla:tram_stop', 48);
    createTransitLine(world, balance, 'tram');
    const line = lastLine(world);
    addTransitStop(world, content, balance, line.id, a);
    addTransitStop(world, content, balance, line.id, b);
    setLineVehicles(world, balance, line.id, 2);

    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 10; tick++) tickWorld(world, systems);
    return line;
  }

  it('tramvaj nejezdí bez proudu, autobus ano', async () => {
    // Akceptační kritérium 17, druhá půlka. Je to jeden z důvodů, proč blackout
    // otevírá dveře všemu ostatnímu.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const tram = poweredTram(world, content);
    expect(lineRuns(world, content, balance, tram)).toBe(true);

    // Autobusová linka na týchž ulicích.
    const busA = addStop(world, content, 'vanilla:transit_stop', 16);
    const busB = addStop(world, content, 'vanilla:transit_stop', 44);
    createTransitLine(world, balance, 'bus');
    const bus = lastLine(world);
    addTransitStop(world, content, balance, bus.id, busA);
    addTransitStop(world, content, balance, bus.id, busB);
    setLineVehicles(world, balance, bus.id, 1);
    expect(lineRuns(world, content, balance, bus)).toBe(true);

    // Blackout: elektrárna dolů.
    for (const [id, building] of world.buildings) {
      if (content.get(building.definitionId)?.power?.production) {
        world.disasters.offlinePlants.add(id);
      }
    }
    world.powerNetworkDirty = true;
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 3; tick++) tickWorld(world, systems);

    expect(lineRuns(world, content, balance, tram), 'tramvaj jede bez proudu').toBe(false);
    expect(lineRuns(world, content, balance, bus), 'autobus stojí kvůli elektřině').toBe(true);
  });

  it('kolej ukusuje z vozovky i za blackoutu', async () => {
    // Kapacitu ubírá kolej, ne provoz. Koleje z vozovky nezmizí tím, že po nich
    // zrovna nikdo nejede.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    poweredTram(world, content);
    rebuildTramTiles(world, content, balance);
    const before = roadCapacityFactor(world, index(30, 20, MAP_SIZE));
    expect(before).toBeLessThan(1);

    for (const [id, building] of world.buildings) {
      if (content.get(building.definitionId)?.power?.production) {
        world.disasters.offlinePlants.add(id);
      }
    }
    world.powerNetworkDirty = true;
    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 3; tick++) tickWorld(world, systems);
    rebuildTramTiles(world, content, balance);

    expect(roadCapacityFactor(world, index(30, 20, MAP_SIZE))).toBe(before);
  });

  it('linka bez vozidel nejede', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const a = addStop(world, content, 'vanilla:transit_stop', 12);
    const b = addStop(world, content, 'vanilla:transit_stop', 48);
    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    addTransitStop(world, content, balance, line.id, a);
    addTransitStop(world, content, balance, line.id, b);

    expect(lineRuns(world, content, balance, line)).toBe(false);
    setLineVehicles(world, balance, line.id, 1);
    expect(lineRuns(world, content, balance, line)).toBe(true);
  });

  it('zbouraná zastávka z linky zmizí sama a linka jede dál', async () => {
    /*
     * Do T105 zastávka na lince zůstávala viset a `lineProblems` ji hlásil jako
     * „tohle není zastávka" — což **zastavilo celou linku natrvalo**, dokud ji
     * hráč ručně nevyhodil. Zastávky přitom nemají jméno, takže ani nepoznal,
     * která to byla; nahlásil to slovy „není šance zjistit, která to byla".
     *
     * Mizí proto sama. Linka o zastávku přijde, ale jezdí dál po zbylých —
     * a když jich zbude míň než dvě, hlásí `tooFewStops`, což je pravda a
     * hráč s ní umí něco udělat.
     */
    const content = await vanilla();
    const balance = content.getBalance();
    const world = street(content);
    const line = tramLineOf(world, content);
    const first = line.stops[0] ?? 0;
    addTransitStop(world, content, balance, line.id, addStop(world, content, 'vanilla:tram_stop', 30));
    expect(line.stops.length).toBe(3);

    expect(removeBuilding(world, first)).toBe(true);
    expect(line.stops, 'zastávka na lince zůstala viset').not.toContain(first);
    expect(lineProblems(world, content, balance, line)).not.toContain('notAStop');
    // A přepočet koridoru na tom nespadne.
    rebuildTramTiles(world, content, balance);
  });

  it('odstavená linka nejezdí, ale nic neztratí', async () => {
    // Hráč si to vyžádal: „jede spustí linku, nejede jen pozastaví, mimo
    // provoz úplně se po zvolení nejede odstraní."
    const content = await vanilla();
    const balance = content.getBalance();
    // Autobus, ne tramvaj: tramvaj potřebuje proud u zastávek a test je
    // o odstavení, ne o elektřině.
    const world = street(content);
    const a = addStop(world, content, 'vanilla:transit_stop', 12);
    const b = addStop(world, content, 'vanilla:transit_stop', 48);
    createTransitLine(world, balance, 'bus');
    const line = lastLine(world);
    addTransitStop(world, content, balance, line.id, a);
    addTransitStop(world, content, balance, line.id, b);
    setLineVehicles(world, balance, line.id, 2);
    expect(lineRuns(world, content, balance, line)).toBe(true);

    expect(setLinePaused(world, line.id, true).ok).toBe(true);
    expect(lineRuns(world, content, balance, line)).toBe(false);
    expect(line.stops.length, 'odstavení nesmí sebrat zastávky').toBe(2);
    expect(line.vehicles, 'ani vozidla').toBe(2);

    expect(setLinePaused(world, line.id, false).ok).toBe(true);
    expect(lineRuns(world, content, balance, line)).toBe(true);
  });

  function tramLineOf(world: WorldState, content: ContentRegistry): TransitLine {
    const balance = content.getBalance();
    const a = addStop(world, content, 'vanilla:tram_stop', 12);
    const b = addStop(world, content, 'vanilla:tram_stop', 48);
    createTransitLine(world, balance, 'tram');
    const line = lastLine(world);
    addTransitStop(world, content, balance, line.id, a);
    addTransitStop(world, content, balance, line.id, b);
    return line;
  }
});

/** Syrový balanc z obsahu, aby šly zkoušet chyby ve validaci. */
function rawBalance(): Record<string, unknown> {
  const modules = import.meta.glob('../content/vanilla/balance.json', {
    eager: true,
    import: 'default',
  });
  return structuredClone(Object.values(modules)[0]) as Record<string, unknown>;
}
