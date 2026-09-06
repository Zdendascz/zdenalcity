import { describe, expect, it } from 'vitest';
import { validateBalance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import {
  addTransitStop,
  buildPipe,
  buildRoad,
  createTransitLine,
  placeDefinition,
  setLineFare,
  setLineVehicles,
} from '@/sim/commands';
import { COARSE_FACTOR, coarseIndex, coarseSizeOf } from '@/sim/coarse';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { index, ROAD } from '@/sim/layers';
import {
  computeLineStats,
  fareSensitivity,
  modeOf,
  servedCells,
  transitReliefAt,
  transitTotals,
} from '@/sim/transit';
import type { TransitLine } from '@/sim/transit';
import { computeBudget } from '@/sim/systems/economy';
import { createDefaultSystems, createTrafficSystem, createTransitSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

/**
 * Jízdné a přeprava (T56).
 *
 * Dvě věci, na kterých to celé stojí:
 *
 * - **Linka s podkapacitou dopravě prakticky nepomůže** a přidání vozidel to
 *   zvedne. Zastávka sama o sobě nikoho nikam nedopraví.
 * - **Zvýšení jízdného zvedne příjem jen do určité meze, pak ho sníží.**
 *   Optimum se dá najít, a to je smysl.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Ulice, depo, elektrárna a řada domů s obyvateli. */
function town(content: ContentRegistry, houses = 12): WorldState {
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 10000000;

  for (let x = 8; x < 60; x++) buildRoad(world, x, 20, ROAD.street, balance);
  expect(placeDefinition(world, content, 'vanilla:transit_depot', 8, 21, balance).ok).toBe(true);
  expect(
    placeDefinition(world, content, 'vanilla:coal_power_plant', 54, 21, balance).ok,
  ).toBe(true);

  // Domy chtějí vodovod. Test je o MHD, ne o infrastruktuře, tak ať ji mají.
  for (let x = 8; x < 60; x++) buildPipe(world, x, 18, balance);
  world.waterSupply.fill(1);

  const house = content.get('vanilla:residential_small');
  if (!house) throw new Error('chybí obytná budova');
  for (let i = 0; i < houses; i++) {
    const placed = placeDefinition(world, content, house.id, 12 + i * 3, 19, balance);
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
  }
  for (const building of world.buildings.values()) {
    if (building.definitionId === house.id) building.population = 50;
  }

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);
  return world;
}

/** Autobusová linka přes celou ulici. */
function busLine(world: WorldState, content: ContentRegistry, vehicles: number): TransitLine {
  const balance = content.getBalance();
  const stops = [12, 48].map((x) => {
    const before = new Set(world.buildings.keys());
    const placed = placeDefinition(world, content, 'vanilla:transit_stop', x, 21, balance);
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
    const id = [...world.buildings.keys()].find((key) => !before.has(key));
    if (id === undefined) throw new Error('zastávka nevznikla');
    return id;
  });

  expect(createTransitLine(world, balance, 'bus').ok).toBe(true);
  const line = world.lines[world.lines.length - 1];
  if (!line) throw new Error('linka nevznikla');
  for (const stop of stops) {
    expect(addTransitStop(world, content, balance, line.id, stop).ok).toBe(true);
  }
  expect(setLineVehicles(world, balance, line.id, vehicles).ok).toBe(true);
  return line;
}

describe('citlivost na jízdné', () => {
  it('zdarma jede každý, nad limitem nikdo', () => {
    const balance = VANILLA_BALANCE;
    expect(fareSensitivity(balance, 0)).toBe(1);
    expect(fareSensitivity(balance, balance.transit.fareLimit)).toBe(0);
    expect(fareSensitivity(balance, balance.transit.fareLimit * 2)).toBe(0);
  });

  it('klesá plynule, ne skokem', () => {
    const balance = VANILLA_BALANCE;
    const limit = balance.transit.fareLimit;
    let previous = fareSensitivity(balance, 0);
    for (let fare = 1; fare <= limit; fare++) {
      const now = fareSensitivity(balance, fare);
      expect(now, `jízdné ${fare}`).toBeLessThan(previous);
      previous = now;
    }
  });

  it('validace odmítne nulový limit', () => {
    const raw = rawBalance();
    const transit = raw['transit'] as Record<string, unknown>;
    transit['fareLimit'] = 0;

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('transit.fareLimit');
  });
});

describe('kapacita a poptávka', () => {
  it('poptávka jsou lidé v dosahu zastávek, ne celé město', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    const line = busLine(world, content, 2);

    computeLineStats(world, content, balance);
    const stats = world.lineStats.get(line.id);
    if (!stats) throw new Error('bez statistik');

    const everyone = [...world.buildings.values()].reduce(
      (sum, b) => sum + b.population + b.jobs,
      0,
    );
    expect(stats.demand).toBeGreaterThan(0);
    expect(stats.demand).toBeLessThan(everyone);

    // A jsou to opravdu ti v dosahu: buňka mimo dosah do poptávky nepřispívá.
    const cells = new Set(servedCells(world, content, line));
    expect(cells.has(coarseIndex(20, 20, MAP_SIZE))).toBe(true);
    expect(cells.has(coarseIndex(MAP_SIZE - 5, MAP_SIZE - 5, MAP_SIZE))).toBe(false);
  });

  it('odveze nejvýš tolik, kolik unese, a nikdy víc než kolik lidí je', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const capacity = modeOf(balance, 'bus')?.capacity ?? 0;

    const transportedWith = (vehicles: number): number => {
      const world = town(content);
      const line = busLine(world, content, vehicles);
      computeLineStats(world, content, balance);
      return world.lineStats.get(line.id)?.transported ?? 0;
    };

    // Jedno vozidlo: stropem je kapacita.
    expect(transportedWith(1)).toBeCloseTo(capacity, 5);
    // Sto vozidel: stropem je poptávka, ne kapacita.
    const flooded = transportedWith(100);
    expect(flooded).toBeLessThan(capacity * 100);
  });

  it('linka, která nejede, neodveze nikoho ani s plnou garáží', async () => {
    // Tramvaj bez proudu má vozidla i zastávky, a přesto stojí. Kdyby vozila,
    // byl by blackout pro MHD neviditelný.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);

    const stops = [12, 48].map((x) => {
      const before = new Set(world.buildings.keys());
      expect(placeDefinition(world, content, 'vanilla:tram_stop', x, 21, balance).ok).toBe(true);
      const id = [...world.buildings.keys()].find((key) => !before.has(key));
      if (id === undefined) throw new Error('zastávka nevznikla');
      return id;
    });
    expect(createTransitLine(world, balance, 'tram').ok).toBe(true);
    const line = world.lines[world.lines.length - 1];
    if (!line) throw new Error('linka nevznikla');
    for (const stop of stops) addTransitStop(world, content, balance, line.id, stop);
    setLineVehicles(world, balance, line.id, 5);

    const systems = createDefaultSystems(content, balance);
    for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);
    computeLineStats(world, content, balance);
    expect(world.lineStats.get(line.id)?.transported ?? 0).toBeGreaterThan(0);

    // Blackout.
    for (const [id, building] of world.buildings) {
      if (content.get(building.definitionId)?.power?.production) {
        world.disasters.offlinePlants.add(id);
      }
    }
    world.powerNetworkDirty = true;
    for (let tick = 0; tick < 3; tick++) tickWorld(world, systems);

    computeLineStats(world, content, balance);
    expect(world.lineStats.get(line.id)?.transported).toBe(0);
    // Ale kapacita zůstala: vozidla nezmizela, jen stojí.
    expect(world.lineStats.get(line.id)?.upkeep).toBeGreaterThan(0);
  });

  it('linka bez vozidel neodveze nikoho', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    const line = busLine(world, content, 0);

    computeLineStats(world, content, balance);
    expect(world.lineStats.get(line.id)?.transported).toBe(0);
  });
});

describe('kdo do poptávky patří', () => {
  it('práce se počítá stejně jako bydliště', async () => {
    // Do práce se taky jezdí. Kdyby se počítali jen obyvatelé, byla by MHD
    // v obchodní čtvrti k ničemu — a to je zrovna místo, kde dává největší smysl.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    const line = busLine(world, content, 2);

    computeLineStats(world, content, balance);
    const before = world.lineStats.get(line.id)?.demand ?? 0;
    expect(before).toBeGreaterThan(0);

    // Přidej pracovní místa do téže čtvrti.
    for (const building of world.buildings.values()) {
      if (building.population > 0) building.jobs = 20;
    }
    computeLineStats(world, content, balance);
    expect(world.lineStats.get(line.id)?.demand ?? 0).toBeGreaterThan(before);
  });

  it('z ruiny nikdo nejezdí', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    const line = busLine(world, content, 2);

    computeLineStats(world, content, balance);
    const before = world.lineStats.get(line.id)?.demand ?? 0;

    for (const building of world.buildings.values()) {
      if (building.population > 0) building.abandoned = true;
    }
    computeLineStats(world, content, balance);
    expect(world.lineStats.get(line.id)?.demand ?? 0).toBeLessThan(before);
  });

  it('dosah zastávky je kruh, ne čtverec', async () => {
    // Rohy opsaného čtverce jsou o polovinu dál než okraj. Kdyby patřily do
    // dosahu, obsloužila by zastávka po diagonále výrazně dál než rovně.
    const content = await vanilla();
    const world = town(content);
    const line = busLine(world, content, 1);

    const stop = world.buildings.get(line.stops[0] ?? 0);
    if (!stop) throw new Error('bez zastávky');
    // Dosah je v definici v **dlaždicích**, obsluha se počítá na hrubé mřížce.
    const radiusTiles = content.get(stop.definitionId)?.service?.radius ?? 0;
    const radius = radiusTiles / COARSE_FACTOR;
    expect(radius).toBeGreaterThan(1);

    const cells = new Set(servedCells(world, content, line));
    const side = coarseSizeOf(MAP_SIZE);
    const origin = coarseIndex(stop.x, stop.y, MAP_SIZE);
    const reach = Math.floor(radius);

    // Rovně na okraji ano.
    expect(cells.has(origin + reach)).toBe(true);
    // V rohu opsaného čtverce ne.
    expect(cells.has(origin + reach * side + reach)).toBe(false);
  });

  it('zastávka bez dosahu neobslouží ani sebe', async () => {
    // Obsah může mít zastávku bez `service` — mód a pokrytí jsou dvě různé věci.
    // Bez dosahu nemá koho svážet, ani lidi přímo pod ní.
    const content = await vanilla();
    const world = town(content);
    const line = busLine(world, content, 2);

    // Katalog, ve kterém zastávky nemají `service`. Mód a pokrytí jsou dvě
    // různé věci a obsah je může mít odděleně.
    const blind: BuildingCatalogue = {
      get: (id) => {
        const definition = content.get(id);
        if (!definition?.transit) return definition;
        const stripped = { ...definition };
        delete stripped.service;
        return stripped;
      },
      byCategory: (category) => content.byCategory(category),
    };

    expect(servedCells(world, content, line).length).toBeGreaterThan(0);
    expect(servedCells(world, blind, line)).toHaveLength(0);
  });
});

describe('účinek na dopravu', () => {
  /** Zátěž na ulici po ustálení. */
  function roadLoad(world: WorldState): number {
    let total = 0;
    for (let x = 8; x < 60; x++) total += world.trafficLoad[index(x, 20, MAP_SIZE)] ?? 0;
    return total;
  }

  it('podkapacitní linka prakticky nepomůže, přidání vozidel účinek zvedne', async () => {
    // Akceptační kritérium 16. Linka s jedním autobusem a tisíci obyvateli
    // v dosahu je gesto, ne doprava.
    const content = await vanilla();
    const balance = content.getBalance();

    const loadWith = (vehicles: number | null): number => {
      const world = town(content);
      if (vehicles !== null) busLine(world, content, vehicles);
      const systems = [
        createTransitSystem(content, balance),
        createTrafficSystem(content, balance),
      ];
      for (let tick = 0; tick < 40; tick++) tickWorld(world, systems);
      return roadLoad(world);
    };

    const none = loadWith(null);
    const thin = loadWith(1);
    const fat = loadWith(60);

    expect(none).toBeGreaterThan(0);
    // Jeden autobus na celou čtvrť: rozdíl je v jednotkách procent.
    expect(thin).toBeLessThanOrEqual(none);
    expect(thin / none).toBeGreaterThan(0.9);
    // Šedesát autobusů: znát to musí.
    expect(fat).toBeLessThan(thin);
    expect(fat / none).toBeLessThan(0.8);
  });

  it('úleva nikdy nepřekročí jedničku, ani s absurdní kapacitou', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    busLine(world, content, 10000);

    computeLineStats(world, content, balance);
    for (const value of world.transitRelief.values()) {
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('druhá linka přes tutéž čtvrť pomůže, až když je první plná', async () => {
    // Lidé jsou společný a konečný fond. Bez toho by šlo postavit deset
    // stejných linek a každá by vozila — a vydělávala — na týchž lidech.
    const content = await vanilla();
    const balance = content.getBalance();

    const reliefWith = (lines: number, vehicles: number): number => {
      const world = town(content);
      for (let i = 0; i < lines; i++) {
        const stops = [12 + i * 2, 48 - i * 2].map((x) => {
          const before = new Set(world.buildings.keys());
          expect(
            placeDefinition(world, content, 'vanilla:transit_stop', x, 21, balance).ok,
          ).toBe(true);
          const id = [...world.buildings.keys()].find((key) => !before.has(key));
          if (id === undefined) throw new Error('zastávka nevznikla');
          return id;
        });
        createTransitLine(world, balance, 'bus');
        const line = world.lines[world.lines.length - 1];
        if (!line) throw new Error('linka nevznikla');
        for (const stop of stops) addTransitStop(world, content, balance, line.id, stop);
        setLineVehicles(world, balance, line.id, vehicles);
      }

      computeLineStats(world, content, balance);
      // Buňka, kde **bydlí lidé** (domy stojí na y=19), ne kde vede ulice —
      // úleva se zapisuje jen tam, odkud je koho odvézt. A dost blízko
      // zastávce: ta stojí o řadu buněk níž, takže se dosah po diagonále krátí.
      return transitReliefAt(world, coarseIndex(20, 19, MAP_SIZE));
    };

    // Málo vozidel: druhá linka bere ze zbytku, takže pomůže.
    const oneThin = reliefWith(1, 1);
    const twoThin = reliefWith(2, 1);
    expect(twoThin).toBeGreaterThan(oneThin);

    // Dost vozidel: první linka odveze, co unese poptávka, a druhá už nemá koho.
    const oneFat = reliefWith(1, 200);
    const twoFat = reliefWith(2, 200);
    expect(twoFat).toBeCloseTo(oneFat, 5);
  });

  it('druhá linka odveze jen zbytek, ne tytéž lidi znovu', async () => {
    // Tohle je ta podstatná půlka: kdyby se poptávka počítala z celého fondu
    // místo ze zbytku, deset stejných linek by vozilo — a vydělávalo —
    // desetkrát na týchž lidech.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);

    const first = busLine(world, content, 200);
    // Druhá linka přes tytéž zastávky by se nedala postavit, tak vedle nich.
    const stops = [14, 46].map((x) => {
      const before = new Set(world.buildings.keys());
      expect(placeDefinition(world, content, 'vanilla:transit_stop', x, 21, balance).ok).toBe(true);
      const id = [...world.buildings.keys()].find((key) => !before.has(key));
      if (id === undefined) throw new Error('zastávka nevznikla');
      return id;
    });
    expect(createTransitLine(world, balance, 'bus').ok).toBe(true);
    const second = world.lines[world.lines.length - 1];
    if (!second) throw new Error('linka nevznikla');
    for (const stop of stops) addTransitStop(world, content, balance, second.id, stop);
    setLineVehicles(world, balance, second.id, 200);

    computeLineStats(world, content, balance);
    const a = world.lineStats.get(first.id);
    const b = world.lineStats.get(second.id);
    expect(a?.transported ?? 0).toBeGreaterThan(0);
    // Druhá vidí **jen zbytek**: její zastávky sahají skoro na tytéž buňky,
    // ale lidi z nich už odvezla první. Poptávka, kterou uvidí, tak musí být
    // výrazně nižší — bez odebírání z fondu by byla naopak vyšší, protože její
    // dosah je o kus širší.
    expect(b?.demand ?? 0).toBeLessThan((a?.demand ?? 0) * 0.5);
    expect(b?.transported ?? 0).toBeLessThan(a?.transported ?? 0);
  });

  it('rozdělení nezávisí na pořadí linek v poli', async () => {
    // Save načte linky v pořadí, v jakém jsou v souboru. Kdyby o tom, kdo bere
    // první, rozhodovalo pole místo id, mělo by město po loadu jinou dopravu
    // než před ním (P2).
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);

    // Kapacita schválně **mezi**: obě linky dohromady neodvezou všechny, takže
    // na pořadí opravdu záleží. S přebytkem vozidel by odvezly obě všechno
    // a test by neměřil nic.
    const vehicles = 7;
    const first = busLine(world, content, vehicles);
    const stops = [14, 46].map((x) => {
      const before = new Set(world.buildings.keys());
      expect(placeDefinition(world, content, 'vanilla:transit_stop', x, 21, balance).ok).toBe(true);
      const id = [...world.buildings.keys()].find((key) => !before.has(key));
      if (id === undefined) throw new Error('zastávka nevznikla');
      return id;
    });
    createTransitLine(world, balance, 'bus');
    const second = world.lines[world.lines.length - 1];
    if (!second) throw new Error('linka nevznikla');
    for (const stop of stops) addTransitStop(world, content, balance, second.id, stop);
    setLineVehicles(world, balance, second.id, vehicles);

    const dump = (): string =>
      [...world.lineStats.entries()]
        .map(([id, stats]) => `${id}:${stats.transported.toFixed(6)}`)
        .sort()
        .join(',');

    computeLineStats(world, content, balance);
    const inOrder = dump();

    world.lines = [...world.lines].reverse();
    computeLineStats(world, content, balance);
    expect(dump()).toBe(inOrder);
    expect(first.id).toBeLessThan(second.id);
  });
});

describe('jízdné a peníze', () => {
  it('zvýšení jízdného zvedne příjem jen do meze, pak ho sníží', async () => {
    // Akceptační kritérium 18. Příjem je `přepraveno × jízdné` a ochota platit
    // klesá lineárně — součin je parabola s vrcholem v polovině limitu.
    const content = await vanilla();
    const balance = content.getBalance();
    const limit = balance.transit.fareLimit;

    // Dost vozidel, ať o výsledku rozhoduje jízdné, ne kapacita.
    const world = town(content);
    const line = busLine(world, content, 200);

    const incomeAt = (fare: number): number => {
      expect(setLineFare(world, line.id, fare).ok).toBe(true);
      computeLineStats(world, content, balance);
      return world.lineStats.get(line.id)?.income ?? 0;
    };

    const curve: { fare: number; income: number }[] = [];
    for (let fare = 0; fare <= limit; fare += 2) curve.push({ fare, income: incomeAt(fare) });

    const best = curve.reduce((a, b) => (b.income > a.income ? b : a));
    expect(best.income).toBeGreaterThan(0);
    // Vrchol uvnitř rozsahu, ne na kraji: existuje optimum, které jde najít.
    expect(best.fare).toBeGreaterThan(0);
    expect(best.fare).toBeLessThan(limit);
    // A vrchol je zhruba v polovině limitu.
    expect(best.fare).toBeCloseTo(limit / 2, -0.5);

    expect(incomeAt(0)).toBe(0);
    expect(incomeAt(limit)).toBe(0);
  });

  it('vozidla stojí údržbu každý měsíc, i když linka stojí', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    const line = busLine(world, content, 3);
    // Rozbitá linka: zastávky odebrány, ale vozidla se platí dál.
    line.stops = [];

    computeLineStats(world, content, balance);
    const stats = world.lineStats.get(line.id);
    const upkeep = modeOf(balance, 'bus')?.vehicleUpkeep ?? 0;
    expect(stats?.transported).toBe(0);
    expect(stats?.upkeep).toBe(3 * upkeep);
  });

  it('jízdné i údržba jsou vidět v rozpočtu', async () => {
    // Hráč musí vidět, kam peníze tečou. Skryté číslo v kase je chyba.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    const line = busLine(world, content, 4);
    setLineFare(world, line.id, balance.transit.fareLimit / 2);
    computeLineStats(world, content, balance);

    const budget = computeBudget(world, content, balance);
    const totals = transitTotals(world);
    expect(budget.transit.lines).toBe(1);
    expect(budget.transit.vehicles).toBe(4);
    expect(budget.transit.income).toBe(totals.income);
    expect(budget.transit.upkeep).toBe(totals.upkeep);
    expect(budget.transit.income).toBeGreaterThan(0);
    expect(budget.transit.upkeep).toBeGreaterThan(0);

    // A propisují se do součtů, ne jen do vlastního řádku.
    const withoutTransit = computeBudget(
      { ...world, lines: [], lineStats: new Map() } as WorldState,
      content,
      balance,
    );
    expect(budget.income - withoutTransit.income).toBe(budget.transit.income);
    expect(budget.expenses - withoutTransit.expenses).toBe(budget.transit.upkeep);
  });

  it('přepočítává se jednou za měsíc, ne každý tik', async () => {
    // Kapacita v katalogu je měsíční a poptávka se mění pomalu. Projít pro
    // každou linku všechny obsluhované buňky čtyřikrát za sekundu by byla
    // nejdražší věc v simulaci a hráč by z toho neměl nic.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = town(content);
    const line = busLine(world, content, 4);

    const systems = [createTransitSystem(content, balance)];
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);
    expect(world.lineStats.get(line.id)?.transported).toBeGreaterThan(0);

    // Podvržená hodnota: kdyby se počítalo pořád, přepis by ji smazal.
    const stats = world.lineStats.get(line.id);
    if (!stats) throw new Error('bez statistik');
    stats.transported = -1;
    tickWorld(world, systems);
    expect(world.lineStats.get(line.id)?.transported).toBe(-1);

    // Za měsíc se přepočet vrátí.
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);
    expect(world.lineStats.get(line.id)?.transported).toBeGreaterThan(0);
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
