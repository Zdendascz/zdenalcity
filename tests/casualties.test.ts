import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, zoneArea } from '@/sim/commands';
import { noLosses, destroyTile } from '@/sim/disasters/damage';
import { addToll, blameFor, tollOf } from '@/sim/disasters/state';
import type { ActiveDisaster } from '@/sim/disasters/state';
import { createEarthquakeDisaster } from '@/sim/disasters/earthquake';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { startDisaster } from '@/sim/disasters/scheduler';
import { index, ROAD, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

/**
 * Oběti katastrof (T113).
 *
 * Autor: „při katastrofách dokážeme orientačně spočítat, kolik lidí při nich
 * umřelo? Pokud jo, bylo by fajn to dát do té informace o katastrofě.
 * U déletrvajících, jako je epidemie, může být odhad."
 *
 * Odhad se počítá ze dvou různých věcí a testuje se obojí zvlášť: z lidí,
 * kteří ubyli z domů, co pořád stojí (epidemie, havárie — tam je to přesné),
 * a z obyvatel domů, které spadly (tam se násobí podílem z balancu).
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Obydlené městečko: ulice a obytný pruh po obou stranách. */
function city(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(7, balance.economy);
  world.economy.funds = 1000000;

  for (let x = 10; x < 40; x++) buildRoad(world, x, 20, ROAD.street, balance);
  zoneArea(world, 10, 17, 30, 3, ZONE.residential);
  zoneArea(world, 10, 21, 30, 3, ZONE.residential);

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 500; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
  return world;
}

function fakeDisaster(kind: string, startedAtTick = 0): ActiveDisaster {
  return { id: 1, kind, startedAtTick, x: 0, y: 0, state: {}, finished: false };
}

describe('odhad obětí', () => {
  it('sečte se ve zlomcích a zaokrouhlí až při čtení', () => {
    /*
     * Zlomek se **nesmí** zaokrouhlovat u každé škody. Malý požár, který
     * pokaždé zabije 0,4 člověka, by po zaokrouhlení nezabil nikdy nikoho
     * a mechanika by tiše nefungovala — tatáž past jako u úmrtnosti epidemie.
     */
    const fire = fakeDisaster('fire');
    for (let i = 0; i < 5; i++) addToll(fire, 0.4);
    expect(tollOf(fire)).toBe(2);
  });

  it('pohroma, která nikoho nezabila, hlásí nulu', () => {
    expect(tollOf(fakeDisaster('fire'))).toBe(0);
  });

  it('zbořený dům přispěje svými obyvateli, prázdná parcela ničím', async () => {
    const content = await vanilla();
    const world = city(content);
    const lived = [...world.buildings.values()].find((building) => building.population > 0);
    expect(lived).toBeDefined();
    if (!lived) return;

    const losses = noLosses();
    const before = lived.population;
    destroyTile(world, content, index(lived.x, lived.y, world.size), losses);

    expect(losses.buildings).toBe(1);
    expect(losses.residents).toBe(before);

    // Prázdná dlaždice vedle: nic nespadlo, nikdo tam nebydlel.
    const empty = noLosses();
    destroyTile(world, content, index(1, 1, world.size), empty);
    expect(empty.residents).toBe(0);
  });

  it('zemětřesení si oběti připíše samo', async () => {
    const content = await vanilla();
    const world = city(content);
    const registry = new DisasterRegistry();
    registry.register(createEarthquakeDisaster());

    const before = world.buildings.size;
    const entry = startDisaster(world, content, content.getBalance(), registry, 'earthquake', 25, 20);
    expect(entry).not.toBeNull();
    if (!entry) return;

    // Otřes sám o sobě nemusí trefit obydlený dům; test tvrdí jen tolik, že
    // kde spadly domy, tam se objevily i oběti, a kde ne, tam ne.
    const fell = before - world.buildings.size;
    if (fell > 0) expect(tollOf(entry)).toBeGreaterThan(0);
    else expect(tollOf(entry)).toBe(0);
  });

  it('vinu za oheň nese nejdéle běžící požár, ne ten poslední', () => {
    /*
     * Oheň se šíří vlastním systémem mimo `advance`, takže sám neví, čí je.
     * Přiřazuje se nejstarší běžící pohromě daného druhu — kdyby se bral
     * poslední, přepsal by čerstvý požár účet toho, který hoří půl roku.
     */
    const older = { ...fakeDisaster('fire', 100), id: 1 };
    const newer = { ...fakeDisaster('wildfire', 300), id: 2 };
    expect(blameFor([newer, older], ['fire', 'wildfire'])).toBe(older);
    expect(blameFor([newer, older], ['flood'])).toBeNull();
  });

  it('skončená pohroma už za nic nemůže', () => {
    const done = { ...fakeDisaster('fire', 10), finished: true };
    expect(blameFor([done], ['fire'])).toBeNull();
  });
});
