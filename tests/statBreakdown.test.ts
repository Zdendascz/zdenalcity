import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { ROAD, ZONE } from '@/sim/layers';
import { EXPLAINED_STATS, explainStat } from '@/sim/statBreakdown';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld, totalJobs, totalPopulation } from '@/sim/world';
import type { WorldState } from '@/sim/world';

/**
 * Rozpis údajů z lišty (T112).
 *
 * Zadání: „u statistik by bylo fajn, kdyby šlo každou z hodnot rozkliknout
 * a naskočí tabulka, z čeho se čísla skládají."
 *
 * Testuje se přesně to, co dělá rozpis k něčemu: **souhrn musí sedět s tím,
 * co je v liště**. Tabulka, která tvrdí něco jiného než číslo nad ní, je horší
 * než žádná.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Město s ulicí, zónami a elektrárnou, chvíli běžící. */
function city(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 10000000;

  for (let x = 10; x < 50; x++) buildRoad(world, x, 20, ROAD.street, balance);
  zoneArea(world, 10, 17, 30, 3, ZONE.residential);
  zoneArea(world, 10, 21, 20, 3, ZONE.industrial);
  zoneArea(world, 31, 21, 9, 3, ZONE.commercial);
  placeDefinition(world, content, 'vanilla:coal_power_plant', 42, 21, balance);

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 400; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
  return world;
}

describe('rozpis údaje z lišty', () => {
  it('souhrn sedí s číslem, které lišta ukazuje', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = city(content);
    expect(world.buildings.size).toBeGreaterThan(5);

    const of = (key: (typeof EXPLAINED_STATS)[number]) =>
      explainStat(world, content, balance, key);

    expect(of('population').total).toBe(totalPopulation(world.buildings));
    expect(of('jobs').total).toBe(totalJobs(world.buildings));

    /*
     * Bilance je jediný údaj, kde se souhrn s lištou **nemusí** shodovat:
     * v liště visí poslední měsíční uzávěrka, v rozpisu dnešní rozpočet.
     * Rozepsat uzávěrku nejde, protože se po řádcích nikam neukládá. Sedět
     * proto musí aspoň sám se sebou — a poznámka to hráči řekne.
     */
    const monthly = of('balance');
    const income = monthly.plus.reduce((sum, row) => sum + row.value, 0);
    const expenses = monthly.minus.reduce((sum, row) => sum + row.value, 0);
    expect(monthly.total).toBe(income - expenses);
    expect(monthly.note?.key).toBe('ui.stat.note.balance');

    let lit = 0;
    for (const building of world.buildings.values()) if (building.powered) lit++;
    expect(of('powered').total).toBe(lit);

    // Proud: souhrn je výroba běžících elektráren.
    let production = 0;
    for (const building of world.buildings.values()) {
      if (building.abandoned) continue;
      production += content.get(building.definitionId)?.power?.production ?? 0;
    }
    expect(of('power').total).toBe(production);
  });

  it('sloupce se dají sečíst — nejsou to jen popisky', async () => {
    const content = await vanilla();
    const world = city(content);
    const breakdown = explainStat(world, content, content.getBalance(), 'population');

    const sum = breakdown.plus.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(breakdown.total);
    expect(breakdown.plus.length).toBeGreaterThan(0);
  });

  it('kasa ukazuje letošní knihu a řekne, že je to jen letošek', async () => {
    const content = await vanilla();
    const world = city(content);
    const breakdown = explainStat(world, content, content.getBalance(), 'funds');

    expect(breakdown.note?.key).toBe('ui.stat.note.funds');
    expect(breakdown.note?.params['funds']).toBe(world.economy.funds);
    const income = breakdown.plus.reduce((total, row) => total + row.value, 0);
    const expenses = breakdown.minus.reduce((total, row) => total + row.value, 0);
    expect(breakdown.total).toBe(income - expenses);
  });

  it('odstavená elektrárna se do výroby nepočítá, ale je vidět', async () => {
    // Přesně ta chyba, kterou autor nahlásil: lišta hlásila velkou rezervu,
    // zatímco půlka města byla potmě.
    const content = await vanilla();
    const world = city(content);
    const before = explainStat(world, content, content.getBalance(), 'power').total;

    for (const [id, building] of world.buildings) {
      if (content.get(building.definitionId)?.power?.production) world.disasters.offlinePlants.add(id);
    }
    const after = explainStat(world, content, content.getBalance(), 'power');

    expect(after.total).toBeLessThan(before);
    expect(after.minus.map((row) => row.label)).toContain('ui.stat.row.offlinePlants');
  });

  it('každý popisek, který rozpis vyrobí, má překlad', async () => {
    /*
     * Chybějící klíč by se v tabulce vypsal syrový. Prochází se **skutečné
     * rozpisy živého města**, ne seznam v kódu: tím se chytí i popisek, který
     * vznikne z kategorie budovy nebo třídy služby, tedy z obsahu.
     */
    const content = await vanilla();
    const balance = content.getBalance();
    const world = city(content);

    const definitionNames = new Set(content.getAll('building').map((item) => item.name));
    for (const language of content.getLanguages()) {
      const table = content.getLocaleTable(language);
      for (const key of EXPLAINED_STATS) {
        const breakdown = explainStat(world, content, balance, key);
        for (const row of [...breakdown.plus, ...breakdown.minus]) {
          // Jméno budovy má překlad z obsahu, hlídá ho vlastní test.
          if (definitionNames.has(row.label)) continue;
          expect(table[row.label], `${language}: ${row.label}`).toBeTruthy();
        }
        if (breakdown.note) {
          expect(table[breakdown.note.key], `${language}: ${breakdown.note.key}`).toBeTruthy();
        }
        expect(table[`ui.hud.${key}`], `${language}: ui.hud.${key}`).toBeTruthy();
      }
      for (const key of ['explain', 'plus', 'minus', 'total', 'nothing']) {
        expect(table[`ui.stat.${key}`], `${language}: ui.stat.${key}`).toBeTruthy();
      }
    }
  });
});
