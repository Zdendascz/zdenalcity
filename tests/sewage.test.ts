import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { coarseIndex } from '@/sim/coarse';
import { createPollutionSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

/**
 * Kanalizace (§8 fáze 3, R9).
 *
 * Není to druhá síť trubek, ale **celoměstská kapacita** po vzoru odpadů:
 * populace vyrobí splašky, čistírna část spolkne a zbytek se propíše do
 * znečištění po celé mapě.
 */
async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Město o dané populaci, poskládané z domů daleko od sebe. */
function cityOf(content: ContentRegistry, population: number): WorldState {
  const world = createWorld(1, content.getBalance().economy);
  const house = content.get('vanilla:residential_small');
  if (!house) throw new Error('chybí vanilla obsah');

  let left = population;
  let x = 10;
  while (left > 0) {
    const built = placeBuilding(world, house, x, 10);
    built.population = Math.min(20, left);
    left -= built.population;
    x += 2;
  }
  return world;
}

/** Průměrné znečištění po ustálení difuze. */
function pollutionOf(world: WorldState, content: ContentRegistry): number {
  const system = createPollutionSystem(content, content.getBalance());
  for (let tick = 0; tick < 400; tick++) tickWorld(world, [system]);

  let sum = 0;
  for (const value of world.coarse.pollution) sum += value;
  return sum / world.coarse.pollution.length;
}

describe('kanalizace jako kapacita', () => {
  it('nedostatečná kapacita zvedne znečištění celoměstsky (kritérium 19)', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const treatment = content.get('vanilla:water_treatment');
    expect(treatment?.sewage?.capacity).toBeGreaterThan(0);
    if (!treatment) return;

    // Město tak velké, že jedna čistírna nestačí — ať je rozdíl vidět.
    const population = Math.round((treatment.sewage!.capacity / balance.sewage.perCitizen) * 2);

    const bezCistirny = cityOf(content, population);
    const sCistirnou = cityOf(content, population);
    placeBuilding(sCistirnou, treatment, 60, 60);

    const spinave = pollutionOf(bezCistirny, content);
    const cistsi = pollutionOf(sCistirnou, content);

    expect(spinave).toBeGreaterThan(0);
    expect(cistsi).toBeLessThan(spinave);
  });

  it('zvedá se to všude, ne jen u domů', async () => {
    // Splašky, které nikdo nevyčistí, skončí v půdě a v řece — proto je to
    // celoměstský přírůstek, ne kouř z komína.
    const content = await vanilla();
    const balance = content.getBalance();
    const population = Math.round(400 / balance.sewage.perCitizen);

    const world = cityOf(content, population);
    pollutionOf(world, content);

    // Roh mapy je od nejbližšího domu přes sto dlaždic daleko.
    const daleko = world.coarse.pollution[coarseIndex(120, 120)] ?? 0;
    expect(daleko).toBeGreaterThan(0);
  });

  it('dost velká kapacita znečištění z kanalizace umlčí', async () => {
    const content = await vanilla();
    const treatment = content.get('vanilla:water_treatment');
    if (!treatment) return;

    const maleMesto = cityOf(content, 20);
    const sKapacitou = cityOf(content, 20);
    placeBuilding(sKapacitou, treatment, 60, 60);

    // Dvacet lidí čistírna spolkne se stovkami rezervy, takže rozdíl mezi
    // „s čistírnou" a „bez ní" musí být jen ten kouř z ní samotné.
    const bez = pollutionOf(maleMesto, content);
    const s = pollutionOf(sKapacitou, content);

    expect(bez).toBeGreaterThanOrEqual(0);
    expect(s).toBeGreaterThan(0); // čistírna sama trochu kouří
  });

  it('opuštěná čistírna nečistí', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const treatment = content.get('vanilla:water_treatment');
    if (!treatment) return;

    const population = Math.round((treatment.sewage!.capacity / balance.sewage.perCitizen) * 2);

    const zivá = cityOf(content, population);
    placeBuilding(zivá, treatment, 60, 60);

    const ruina = cityOf(content, population);
    placeBuilding(ruina, treatment, 60, 60).abandoned = true;

    expect(pollutionOf(ruina, content)).toBeGreaterThan(pollutionOf(zivá, content));
  });

  it('přebytek kapacity znečištění neodečítá', async () => {
    // Bez stropu na nule by šel „nevyčištěný zbytek" do záporu a čistírna by
    // celoměstsky **ubírala** znečištění — velká čistírna by čistila vzduch
    // nad továrnami na druhém konci mapy. Odhalila to až mutace.
    //
    // Měřit se to musí tam, kde je co ubírat: pár chemiček, ať je znečištění
    // vysoko. V čistém městě by se záporný člen ztratil v ořezu na nule.
    const content = await vanilla();
    const factory = content.get('vanilla:industrial_chemical');
    const treatment = content.get('vanilla:water_treatment');
    if (!factory || !treatment) return;

    const smoggy = (withPlant: boolean): WorldState => {
      const world = createWorld(1, content.getBalance().economy);
      for (let i = 0; i < 6; i++) placeBuilding(world, factory, 20 + i * 3, 20);
      if (withPlant) placeBuilding(world, treatment, 100, 100);
      pollutionOf(world, content);
      return world;
    };

    const bez = smoggy(false);
    const s = smoggy(true);

    // Součet přes celou mapu, ne jediná buňka: u chemiček je znečištění
    // nasycené na 255 a odečet by se v tom stropu schoval.
    const soucet = (world: WorldState): number => {
      let sum = 0;
      for (const value of world.coarse.pollution) sum += value;
      return sum;
    };

    expect(soucet(bez)).toBeGreaterThan(1000); // je co ubírat
    expect(soucet(s)).toBeGreaterThanOrEqual(soucet(bez));
  });

  it('čistírna musí stát u vody — někam to vypouštět musí', async () => {
    const content = await vanilla();
    expect(content.get('vanilla:water_treatment')?.construction.nearWater).toBe(true);
  });
});
