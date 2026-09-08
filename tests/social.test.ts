import { describe, expect, it } from 'vitest';
import { validateBalance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, zoneArea } from '@/sim/commands';
import { coarseIndex, coarseSizeOf } from '@/sim/coarse';
import { strongestModifier } from '@/sim/disasters/effects';
import { createGangWarDisaster } from '@/sim/disasters/gangWar';
import { createPileupDisaster } from '@/sim/disasters/pileup';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { createRiotDisaster, escalatesToRiot } from '@/sim/disasters/riot';
import { dominantTerm } from '@/sim/disasters/risk';
import { startDisaster } from '@/sim/disasters/scheduler';
import { createStrikeDisaster } from '@/sim/disasters/strike';
import { ROAD, ZONE } from '@/sim/layers';
import { computeBudget } from '@/sim/systems/economy';
import { createDefaultSystems } from '@/sim/systems';
import { Rng } from '@/sim/rng';
import { cellsAround } from '@/sim/disasters/unrest';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

/**
 * Sociální katastrofy (T52): hromadná nehoda, stávka, nepokoje, válka gangů.
 *
 * Žádná z nich není o škodě na mapě. Všechny čtyři berou **peníze a čas** a
 * všechny čtyři jde zkrátit reakcí — a přesně tohle se tady testuje, protože
 * to je jediné, co z nich dělá hru a ne čekání.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Vyrostlé městečko s ulicí, obytnou a průmyslovou zónou. */
function growCity(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 1000000;

  for (let x = 10; x < 40; x++) buildRoad(world, x, 20, ROAD.street, balance);
  zoneArea(world, 10, 17, 30, 3, ZONE.residential);
  zoneArea(world, 10, 21, 30, 3, ZONE.industrial);
  world.waterSupply.fill(1);

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 500; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
  return world;
}

/**
 * Rozsvítí město.
 *
 * `buildingMonthlyTax` netuje temnou budovu, a testovací pás zástavby žádnou
 * elektrárnu nemá — bez tohohle je celý rozpočet nula a test o daních by
 * neměřil vůbec nic.
 */
function powerUp(world: WorldState): void {
  for (const building of world.buildings.values()) building.powered = true;
}

/** Vrstva pokrytí, kterou si test vyrobí sám — město bez služeb žádnou nemá. */
function setCoverage(world: WorldState, serviceClass: string, value: number): Uint8Array {
  const coarse = coarseSizeOf(MAP_SIZE);
  const layer = new Uint8Array(coarse * coarse).fill(value);
  world.coverage.set(serviceClass, layer);
  return layer;
}

function registryOf(...disasters: ReturnType<typeof createStrikeDisaster>[]): DisasterRegistry {
  const registry = new DisasterRegistry();
  for (const disaster of disasters) registry.register(disaster);
  return registry;
}

describe('výpadek daní', () => {
  it('stávkující čtvrť nedaní, vzdálená čtvrť ano', async () => {
    // Jediná přímá cena stávky. Musí být vidět v rozpisu rozpočtu, ne jako
    // záhadně nižší číslo v kase — a musí být **místní**, jinak by z ní byla
    // celoměstská daň z velikosti města.
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createStrikeDisaster());

    const hit = growCity(content);
    powerUp(hit);
    const before = computeBudget(hit, content, balance).income;
    expect(before).toBeGreaterThan(0);
    startDisaster(hit, content, balance, registry, 'strike', 25, 20);
    expect(computeBudget(hit, content, balance).income).toBeLessThan(before);

    // Stávka na druhém konci mapy se rozpočtu nedotkne. Poloměr je 6–10 buněk,
    // takže testovací pás zástavby padne celý do jedné — proto se lokalita
    // zkouší vzdáleností, ne dělením města napůl.
    const far = growCity(content);
    powerUp(far);
    startDisaster(far, content, balance, registry, 'strike', MAP_SIZE - 5, MAP_SIZE - 5);
    expect(computeBudget(far, content, balance).income).toBe(before);
  });

  it('postihy se neskládají a platí ten nejhorší, ne nejmírnější', async () => {
    // Válka gangů bere polovinu, stávka všechno. Přes sebe musí platit stávka
    // — kdyby se bral mírnější postih, hráč by si horší katastrofu „vyléčil"
    // tím, že na ni přijde ještě jedna.
    const content = await vanilla();
    const balance = content.getBalance();
    expect(balance.disasters.gangWar.taxLoss).toBeLessThan(1);

    const registry = registryOf(createStrikeDisaster(), createGangWarDisaster());

    const warOnly = growCity(content);
    powerUp(warOnly);
    const full = computeBudget(warOnly, content, balance).income;
    startDisaster(warOnly, content, balance, registry, 'gangWar', 25, 20);
    const halved = computeBudget(warOnly, content, balance).income;
    expect(halved).toBeLessThan(full);
    expect(halved).toBeGreaterThan(0);

    // Stávka přes tutéž čtvrť to musí srazit až na nulu.
    const both = growCity(content);
    powerUp(both);
    startDisaster(both, content, balance, registry, 'gangWar', 25, 20);
    startDisaster(both, content, balance, registry, 'strike', 25, 20);
    expect(computeBudget(both, content, balance).income).toBe(0);

    // A dvě stejné stávky přes sebe nedaní dvakrát nula.
    const twice = growCity(content);
    powerUp(twice);
    startDisaster(twice, content, balance, registry, 'strike', 25, 20);
    const once = computeBudget(twice, content, balance).income;
    startDisaster(twice, content, balance, registry, 'strike', 25, 20);
    expect(computeBudget(twice, content, balance).income).toBe(once);
  });

  it('celoměstský postih nevypisuje buňky', async () => {
    // `strongestModifier` se ptá `cells.includes(cell)`. Kdyby celoměstský
    // postih vyjmenoval všechny buňky, byla by to lineární prohlídka při
    // každém dotazu každého systému.
    const content = await vanilla();
    const world = growCity(content);
    const registry = registryOf(createRiotDisaster());
    startDisaster(world, content, content.getBalance(), registry, 'riot', 25, 18);

    const global = world.disasters.modifiers.filter((m) => m.cells.length === 0);
    expect(global.length).toBeGreaterThan(0);
    // A pořád platí všude, i na buňce daleko od místa vzniku.
    const far = coarseIndex(MAP_SIZE - 5, MAP_SIZE - 5, MAP_SIZE);
    expect(strongestModifier(world, 'taxLoss', far, 0, undefined, Math.max)).toBeGreaterThan(0);
  });
});

describe('hromadná nehoda', () => {
  it('nezničí ani jednu budovu', async () => {
    // Celá váha je v blokaci, ne ve škodě. Kdyby bořila, splynula by
    // s výbuchem a hráč by neměl důvod stavět okružní síť.
    const content = await vanilla();
    const world = growCity(content);
    const before = world.buildings.size;
    expect(before).toBeGreaterThan(5);

    const registry = registryOf(createPileupDisaster());
    startDisaster(world, content, content.getBalance(), registry, 'pileup', 25, 20);

    expect(world.buildings.size).toBe(before);
    expect([...world.rubble].filter((value) => value !== 0)).toHaveLength(0);
  });

  it('zablokuje dlaždici, po které stála', async () => {
    const content = await vanilla();
    const world = growCity(content);
    const registry = registryOf(createPileupDisaster());
    const entry = startDisaster(world, content, content.getBalance(), registry, 'pileup', 25, 20);
    if (!entry) throw new Error('nehoda nezačala');

    const tile = 20 * MAP_SIZE + 25;
    const blocked = world.disasters.modifiers.filter((m) => m.kind === 'blockTile');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.cells).toEqual([tile]);
  });

  it('zdravotnické pokrytí zkracuje trvání víc než dvojnásobně', async () => {
    // Nepokrytá čtvrť si odbude deset tiků, pokrytá čtyři. Je to hlavní důvod,
    // proč se klinika vyplatí i tam, kde zrovna nikdo nestůně.
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createPileupDisaster());

    const bare = growCity(content);
    setCoverage(bare, 'health', 0);
    const slow = startDisaster(bare, content, balance, registry, 'pileup', 25, 20);

    const covered = growCity(content);
    setCoverage(covered, 'health', 255);
    const fast = startDisaster(covered, content, balance, registry, 'pileup', 25, 20);

    const slowLeft = slow?.state['left'] as number;
    const fastLeft = fast?.state['left'] as number;
    expect(slowLeft).toBe(balance.disasters.pileup.durationBase + balance.disasters.pileup.durationSpan);
    expect(fastLeft).toBe(balance.disasters.pileup.durationBase);
    expect(slowLeft).toBeGreaterThan(fastLeft * 2);
  });

  it('potlačí i hasiče — je to násobič ostatních katastrof', async () => {
    const content = await vanilla();
    const world = growCity(content);
    const registry = registryOf(createPileupDisaster());
    startDisaster(world, content, content.getBalance(), registry, 'pileup', 25, 20);

    const cell = coarseIndex(25, 20, MAP_SIZE);
    const fire = strongestModifier(world, 'suppressService', cell, 1, 'fire');
    expect(fire).toBeLessThan(1);
  });

  it('vzniká na vytížené silnici, ne na slepé ulici', async () => {
    // Váha je zátěž × kapacita. Kdyby byl los rovnoměrný, hráč by nehodu nikdy
    // nespojil s tím, že si postavil jednu přetíženou spojnici.
    const content = await vanilla();
    const world = growCity(content);
    world.trafficLoad.fill(0);
    const busy = 20 * MAP_SIZE + 33;
    const quiet = 20 * MAP_SIZE + 12;
    world.trafficLoad[busy] = 100;
    world.trafficLoad[quiet] = 1;

    const disaster = createPileupDisaster();
    let onBusy = 0;
    const draws = 300;
    for (let attempt = 0; attempt < draws; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      if (origin?.x === 33) onBusy++;
      else expect(origin, `pokus ${attempt}`).toEqual({ x: 12, y: 20 });
    }

    // Stokrát vytíženější dlaždice musí dostat drtivou většinu losů; při
    // rovnoměrném losu by to byla polovina.
    expect(onBusy / draws).toBeGreaterThan(0.9);
  });

  it('neprojížděná silnice se nevylosuje nikdy', async () => {
    const content = await vanilla();
    const world = growCity(content);
    world.trafficLoad.fill(0);
    world.trafficLoad[20 * MAP_SIZE + 33] = 50;

    const disaster = createPileupDisaster();
    for (let attempt = 0; attempt < 100; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      expect(origin, `pokus ${attempt}`).toEqual({ x: 33, y: 20 });
    }
  });

  it('bez provozu nemá kde vzniknout', async () => {
    const content = await vanilla();
    const world = growCity(content);
    world.trafficLoad.fill(0);
    expect(
      createPileupDisaster().pickOrigin(world, content, content.getBalance()),
    ).toBeNull();
  });
});

describe('stávka', () => {
  it('reakce ji zkrátí zhruba na polovinu', async () => {
    // Celá hra o stávce. Kdyby to byl pevný čas, hráč by jen čekal.
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createStrikeDisaster());
    const disaster = createStrikeDisaster();

    const runUntilOver = (improving: boolean): number => {
      const world = growCity(content);
      const entry = startDisaster(world, content, balance, registry, 'strike', 25, 18);
      if (!entry) throw new Error('stávka nezačala');

      let ticks = 0;
      while (!disaster.isFinished(world, entry) && ticks < 500) {
        if (improving) {
          // Hráč něco udělal a zabralo to: spokojenost v oblasti roste.
          for (let cell = 0; cell < world.happiness.length; cell++) {
            world.happiness[cell] = Math.min(255, (world.happiness[cell] ?? 0) + 1);
          }
        }
        world.tick++;
        disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
        ticks++;
      }
      return ticks;
    };

    const idle = runUntilOver(false);
    const reacting = runUntilOver(true);
    expect(reacting).toBeLessThan(idle);
    expect(reacting).toBeCloseTo(idle / 2, -0.5);
  });

  it('hlásí hlavní důvod, a je to týž výpočet, jaký použilo riziko', async () => {
    // Bez důvodu by to byl náhodný trest. A kdyby si ho hlášení počítalo po
    // svém, dřív nebo později by tvrdilo něco jiného, než podle čeho stávka
    // vznikla.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    // Extrémní daň: daňová zátěž musí přebít ostatní složky.
    world.economy.taxRates.residential = 20;
    world.economy.taxRates.commercial = 20;
    world.economy.taxRates.industrial = 20;
    // A město jinak spokojené. Bez toho soupeří daň s nespokojeností z kouře
    // — testovací město je pruh domů přilepený na pruh fabrik — a vyhrává ta
    // nespokojenost. Test se ptá na to, jestli hlášení sedí s výpočtem rizika,
    // ne na to, který člen zrovna vede.
    world.happiness.fill(255);

    const registry = registryOf(createStrikeDisaster());
    const entry = startDisaster(world, content, balance, registry, 'strike', 25, 18);
    expect(entry?.state['reason']).toBe('taxBurden');

    // A při nízké dani to musí být něco jiného.
    const calm = growCity(content);
    calm.happiness.fill(255);
    calm.economy.taxRates.residential = 5;
    calm.economy.taxRates.commercial = 5;
    calm.economy.taxRates.industrial = 5;
    const other = startDisaster(calm, content, balance, registry, 'strike', 25, 18);
    expect(other?.state['reason']).not.toBe('taxBurden');
  });

  it('důvod je vždycky jeden z členů rizika, ne vymyšlené jméno', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const type = balance.disasters.types['strike'];
    if (!type) throw new Error('stávka není v katalogu');
    const names = type.risk.map((term) => term.indicator);

    const registry = registryOf(createStrikeDisaster());
    const world = growCity(content);
    const entry = startDisaster(world, content, balance, registry, 'strike', 25, 18);
    expect(names).toContain(entry?.state['reason']);
  });

  it('sráží spokojenost i mimo stávkující čtvrť', async () => {
    // Stávka je zpráva pro celé město, ne lokální nepříjemnost. Bez toho by
    // hráč mohl jednu čtvrť odepsat a zbytek města by si toho nevšiml.
    const content = await vanilla();
    const world = growCity(content);
    const registry = registryOf(createStrikeDisaster());
    startDisaster(world, content, content.getBalance(), registry, 'strike', 25, 18);

    const far = coarseIndex(MAP_SIZE - 5, MAP_SIZE - 5, MAP_SIZE);
    const penalty = strongestModifier(world, 'happinessPenalty', far, 0, undefined, Math.max);
    expect(penalty).toBe(content.getBalance().disasters.strike.happinessCity);
  });

  it('vzniká v hustší čtvrti, ne kdekoli', async () => {
    const content = await vanilla();
    const world = growCity(content);
    // Vylidni západní polovinu: los musí chodit skoro výhradně na východ.
    for (const building of world.buildings.values()) {
      if (building.x < 25) building.population = 0;
    }

    /*
     * Váha je hustota **hrubé buňky**, ne jedné budovy. Buňka, která leží na
     * hranici, tedy nese obyvatele z východní půlky i pro budovu ze západní —
     * a los takovou budovu právem vybere. Test proto neměří souřadnici, ale
     * pravidlo: los nikdy nesmí padnout do čtvrti, kde nikdo nebydlí.
     */
    const inhabited = new Set<number>();
    for (const building of world.buildings.values()) {
      if (building.population > 0) {
        inhabited.add(coarseIndex(building.x, building.y, MAP_SIZE));
      }
    }

    const disaster = createStrikeDisaster();
    let east = 0;
    const draws = 200;
    for (let attempt = 0; attempt < draws; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      expect(origin, 'los nenašel nikoho').not.toBeNull();
      if (!origin) break;
      expect(
        inhabited.has(coarseIndex(origin.x, origin.y, MAP_SIZE)),
        'stávka vznikla ve vylidněné čtvrti',
      ).toBe(true);
      if (origin.x >= 25) east++;
    }
    // A těžiště je stejně na východě: hraniční buňky jsou jen pár procent.
    expect(east / draws).toBeGreaterThan(0.8);
  });
});

describe('nepokoje', () => {
  it('platí všude, ale síla se řídí kriminalitou v místě vzniku', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createRiotDisaster());

    const at = (crime: number): number => {
      const world = growCity(content);
      world.coarse.crime.fill(crime);
      const entry = startDisaster(world, content, balance, registry, 'riot', 25, 18);
      return entry?.state['strength'] as number;
    };

    expect(at(0)).toBeCloseTo(balance.disasters.riot.strengthBase, 5);
    expect(at(255)).toBeCloseTo(1, 5);
    expect(at(128)).toBeGreaterThan(at(0));
    expect(at(128)).toBeLessThan(at(255));
  });

  it('mapa síly se během trvání nepřepočítává', async () => {
    // Nepokoje kriminalitu zvyšují. Kdyby z ní zároveň braly sílu, posilovaly
    // by samy sebe a nikdy by neskončily.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    world.coarse.crime.fill(50);

    const registry = registryOf(createRiotDisaster());
    const disaster = createRiotDisaster();
    const entry = startDisaster(world, content, balance, registry, 'riot', 25, 18);
    if (!entry) throw new Error('nepokoje nezačaly');
    const before = entry.state['strength'] as number;

    world.coarse.crime.fill(255);
    for (let tick = 0; tick < 10; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
    }
    expect(entry.state['strength']).toBe(before);
  });

  it('počet ohnisek se během trvání nemění, i když kriminalita roste', async () => {
    // Nepokoje kriminalitu zvyšují. Kdyby z ní zároveň braly počet ohnisek,
    // posilovaly by samy sebe a vypálily by město do základů.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    world.coarse.crime.fill(60);

    const registry = registryOf(createRiotDisaster());
    const disaster = createRiotDisaster();
    const entry = startDisaster(world, content, balance, registry, 'riot', 25, 18);
    if (!entry) throw new Error('nepokoje nezačaly');

    const batchAfter = (crime: number): number => {
      world.coarse.crime.fill(crime);
      let seen = 0;
      for (let tick = 0; tick < balance.disasters.riot.igniteEvery * 2; tick++) {
        world.tick++;
        disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
        const batch = entry.state['batch'];
        if (typeof batch === 'number') seen = batch;
      }
      return seen;
    };

    const quiet = batchAfter(60);
    const boiling = batchAfter(255);
    expect(quiet).toBeGreaterThan(0);
    expect(boiling).toBe(quiet);
  });

  it('zapaluje tam, kde je kriminalita a nejsou hasiči', async () => {
    // Tenhle součin dělá z hasičského pokrytí to, co rozhoduje, jestli po
    // nepokojích zbude vzpomínka nebo vypálená čtvrť.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);

    // Východní půlka vře, západní je čistá.
    const coarse = coarseSizeOf(MAP_SIZE);
    for (let cy = 0; cy < coarse; cy++) {
      for (let cx = 0; cx < coarse; cx++) {
        world.coarse.crime[cy * coarse + cx] = cx * 4 >= 25 ? 255 : 0;
      }
    }

    const registry = registryOf(createRiotDisaster());
    const disaster = createRiotDisaster();
    const entry = startDisaster(world, content, balance, registry, 'riot', 30, 18);
    if (!entry) throw new Error('nepokoje nezačaly');

    for (let tick = 0; tick < 60; tick++) {
      world.tick++;
      disaster.tick({ world, catalogue: content, balance, x: 30, y: 18 }, entry);
    }

    let west = 0;
    let east = 0;
    for (let tile = 0; tile < world.fire.length; tile++) {
      if ((world.fire[tile] ?? 0) === 0) continue;
      if (tile % MAP_SIZE < 25) west++;
      else east++;
    }
    expect(east).toBeGreaterThan(0);
    expect(west).toBe(0);
  });

  it('policie i spokojenost dohromady zkracují nejvíc', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createRiotDisaster());
    const disaster = createRiotDisaster();

    const drainOver = (rising: boolean, police: number): number => {
      const world = growCity(content);
      setCoverage(world, 'police', police);
      const entry = startDisaster(world, content, balance, registry, 'riot', 25, 18);
      if (!entry) throw new Error('nepokoje nezačaly');
      const start = entry.state['left'] as number;

      for (let tick = 0; tick < 5; tick++) {
        if (rising) {
          for (let cell = 0; cell < world.happiness.length; cell++) {
            world.happiness[cell] = Math.min(255, (world.happiness[cell] ?? 0) + 1);
          }
        }
        world.tick++;
        disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
      }
      return start - (entry.state['left'] as number);
    };

    const nothing = drainOver(false, 0);
    const happier = drainOver(true, 0);
    const both = drainOver(true, 255);
    expect(happier).toBeGreaterThan(nothing);
    expect(both).toBeGreaterThan(happier);
  });

  it('neřešená stávka může přerůst v nepokoje', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    world.coarse.crime.fill(255);

    const registry = registryOf(createStrikeDisaster());
    const strike = startDisaster(world, content, balance, registry, 'strike', 25, 18);
    if (!strike) throw new Error('stávka nezačala');

    // Spokojenost během stávky klesla, kriminalita je vysoká.
    strike.state['happinessAtStart'] = 200;
    world.happiness.fill(10);

    let escalated = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (escalatesToRiot(world, balance, strike)) escalated++;
    }
    expect(escalated).toBeGreaterThan(0);
  });

  it('řešená stávka v nepokoje nepřeroste nikdy', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    world.coarse.crime.fill(255);

    const registry = registryOf(createStrikeDisaster());
    const strike = startDisaster(world, content, balance, registry, 'strike', 25, 18);
    if (!strike) throw new Error('stávka nezačala');

    // Hráč zareagoval: spokojenost během stávky vzrostla.
    strike.state['happinessAtStart'] = 10;
    world.happiness.fill(200);

    for (let attempt = 0; attempt < 200; attempt++) {
      expect(escalatesToRiot(world, balance, strike)).toBe(false);
    }
  });

  it('nízká kriminalita eskalaci zastaví, i když spokojenost klesla', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    world.coarse.crime.fill(0);

    const registry = registryOf(createStrikeDisaster());
    const strike = startDisaster(world, content, balance, registry, 'strike', 25, 18);
    if (!strike) throw new Error('stávka nezačala');
    strike.state['happinessAtStart'] = 200;
    world.happiness.fill(10);

    for (let attempt = 0; attempt < 100; attempt++) {
      expect(escalatesToRiot(world, balance, strike)).toBe(false);
    }
  });
});

describe('válka gangů', () => {
  it('bez zásahu trvá měsíce, s plným pokrytím týdny', async () => {
    // Jediná pohroma, která trestá dlouhodobé zanedbání. Hráč, který nic
    // neudělá, se jí prakticky nezbaví.
    const content = await vanilla();
    const balance = content.getBalance();
    const registry = registryOf(createGangWarDisaster());
    const disaster = createGangWarDisaster();

    const drainPerTick = (police: number, rising: boolean): number => {
      const world = growCity(content);
      setCoverage(world, 'police', police);
      const entry = startDisaster(world, content, balance, registry, 'gangWar', 25, 18);
      if (!entry) throw new Error('válka nezačala');
      const start = entry.state['left'] as number;

      const ticks = 10;
      for (let tick = 0; tick < ticks; tick++) {
        if (rising) {
          for (let cell = 0; cell < world.happiness.length; cell++) {
            world.happiness[cell] = Math.min(255, (world.happiness[cell] ?? 0) + 2);
          }
        }
        world.tick++;
        disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
      }
      return (start - (entry.state['left'] as number)) / ticks;
    };

    const war = balance.disasters.gangWar;
    const abandoned = drainPerTick(0, false);
    const managed = drainPerTick(255, true);

    // Bez policie a bez zlepšení tlačí jen zaměstnanost. `drainBase` je dno,
    // ne obvyklá rychlost — město s prací se z války dostane o kousek dřív
    // i bez zásahu, a to je správně.
    expect(abandoned).toBeGreaterThanOrEqual(war.drainBase);
    expect(abandoned).toBeLessThanOrEqual(
      war.drainBase + war.pressureEmployment * war.pressureScale + 1e-9,
    );

    // A zásah to musí zrychlit řádově, ne o pár procent: jinak nemá smysl.
    expect(managed).toBeGreaterThan(abandoned * 3);
    expect(managed).toBeGreaterThan(war.drainBase * 6);
  });

  it('policie kriminalitu nesrazí, jen zkracuje trvání', async () => {
    // `crimeFloor` drží dno bez ohledu na to, kolik do čtvrti nasypeš.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    setCoverage(world, 'police', 255);

    const registry = registryOf(createGangWarDisaster());
    startDisaster(world, content, balance, registry, 'gangWar', 25, 18);

    const cell = coarseIndex(25, 18, MAP_SIZE);
    const floor = strongestModifier(world, 'crimeFloor', cell, 0, undefined, Math.max);
    expect(floor).toBe(balance.disasters.gangWar.crimeFloor);
  });

  it('bez policie a s klesající spokojeností se rozšiřuje', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const war = balance.disasters.gangWar;
    const registry = registryOf(createGangWarDisaster());
    const disaster = createGangWarDisaster();

    const radiusAfter = (police: number, falling: boolean): number => {
      const world = growCity(content);
      setCoverage(world, 'police', police);
      world.happiness.fill(200);
      const entry = startDisaster(world, content, balance, registry, 'gangWar', 25, 18);
      if (!entry) throw new Error('válka nezačala');
      const start = entry.state['radius'] as number;

      for (let tick = 0; tick <= war.spreadEvery * 2; tick++) {
        if (falling) {
          for (let cell = 0; cell < world.happiness.length; cell++) {
            world.happiness[cell] = Math.max(0, (world.happiness[cell] ?? 0) - 2);
          }
        }
        world.tick++;
        disaster.tick({ world, catalogue: content, balance, x: 25, y: 18 }, entry);
      }
      return (entry.state['radius'] as number) - start;
    };

    expect(radiusAfter(0, true)).toBeGreaterThan(0);
    // Pokrytí nad prahem rozšiřování zastaví — první věc, která zabere.
    expect(radiusAfter(255, true)).toBe(0);
    // A stejně tak rostoucí spokojenost.
    expect(radiusAfter(0, false)).toBe(0);
  });

  it('vybírá nejhorší čtvrť, ne průměrnou', async () => {
    // Třetí mocnina kriminality: stačí nemít jednu extrémní čtvrť.
    const content = await vanilla();
    const world = growCity(content);
    setCoverage(world, 'police', 0);
    world.coarse.crime.fill(60);

    const hotspot = coarseIndex(35, 18, MAP_SIZE);
    world.coarse.crime[hotspot] = 255;

    const disaster = createGangWarDisaster();
    let inHotspot = 0;
    const draws = 200;
    for (let attempt = 0; attempt < draws; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      if (origin && coarseIndex(origin.x, origin.y, MAP_SIZE) === hotspot) inHotspot++;
    }

    // Buňka je jedna z mnoha obydlených, a přesto na ni padne většina losů.
    expect(inHotspot / draws).toBeGreaterThan(0.5);
  });
});

describe('sdílená vrstva nepokojů', () => {
  it('los místa nezávisí na pořadí v mapě budov', async () => {
    // Save načte budovy v pořadí, v jakém je v souboru. Kdyby na něm los
    // závisel, mělo by město po loadu stávku jinde než před ním (P2).
    const content = await vanilla();
    const world = growCity(content);
    const disaster = createStrikeDisaster();

    const seed = world.rng.getState();
    const first = disaster.pickOrigin(world, content, content.getBalance());

    world.buildings = new Map([...world.buildings.entries()].reverse());
    world.rng = Rng.fromState(seed);
    expect(disaster.pickOrigin(world, content, content.getBalance())).toEqual(first);
  });

  it('oblast je kruh, ne čtverec', async () => {
    // Rohy opsaného čtverce jsou o polovinu dál než okraj. Kdyby patřily do
    // oblasti, byla by stávka v rozích o půlku zákeřnější než na stranách.
    const world = createWorld(1);
    const side = coarseSizeOf(MAP_SIZE);
    const centreX = 16;
    const centreY = 16;
    const radius = 4;
    const cells = new Set(cellsAround(world, centreX * 4, centreY * 4, radius));

    // Přímo na okraji ano.
    expect(cells.has(centreY * side + (centreX + radius))).toBe(true);
    expect(cells.has((centreY + radius) * side + centreX)).toBe(true);
    // V rohu opsaného čtverce ne.
    expect(cells.has((centreY + radius) * side + (centreX + radius))).toBe(false);
    expect(cells.has((centreY - radius) * side + (centreX - radius))).toBe(false);
  });
});

describe('vyváženost sociálních katastrof', () => {
  it('reakce se u každé z nich vyplatí', () => {
    // Kdyby `drainRising` byl nižší než `drainIdle`, hráč by katastrofu
    // prodlužoval tím, že se snaží — a nikdo by na to nepřišel, protože obojí
    // je jen číslo v datech.
    const result = validateBalance(rawBalance());
    const social = result.issues.filter((issue) =>
      ['disasters.strike', 'disasters.riot', 'disasters.gangWar'].includes(issue.field),
    );
    expect(social).toEqual([]);

    const balance = VANILLA_BALANCE.disasters;
    expect(balance.strike.drainRising).toBeGreaterThan(balance.strike.drainIdle);
    expect(balance.riot.drainRising).toBeGreaterThan(balance.riot.drainIdle);
    expect(balance.riot.drainBoth).toBeGreaterThan(balance.riot.drainRising);
  });

  it('validace odmítne balanc, kde se reakce nevyplácí', () => {
    const raw = rawBalance();
    const disasters = raw['disasters'] as Record<string, unknown>;
    const strike = disasters['strike'] as Record<string, unknown>;
    strike['drainRising'] = strike['drainIdle'];

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(result.issues.map((issue) => issue.field)).toContain('disasters.strike');
  });

  it('hlavní důvod je vždycky nejsilnější člen, ne první v pořadí', () => {
    const type = VANILLA_BALANCE.disasters.types['strike'];
    if (!type) throw new Error('stávka není v katalogu');

    const only = (name: string): { get(key: string): number } => ({
      get: (key) => (key === name ? 1 : 0),
    });
    for (const term of type.risk) {
      expect(dominantTerm(type, only(term.indicator))).toBe(term.indicator);
    }
    // Samé nuly nemají vítěze — hlásit „nezaměstnanost" jen proto, že je první
    // v pořadí, by hráče poslalo řešit něco, co není problém.
    expect(dominantTerm(type, only('nic'))).toBeNull();
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
