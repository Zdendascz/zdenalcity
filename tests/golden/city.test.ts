import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { hashCoarseLayers } from '@/sim/coarse';
import { hashLayers, index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import {
  createWorld,
  rebuildTileIndex,
  tickWorld,
  totalJobs,
  totalPopulation,
} from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { assumeWatered } from '../support/water';
import { MAP_SIZE } from '../support/grid';

/**
 * Golden test **celého města**, ne jen silnic (architektura §12).
 *
 * Do téhle chvíle existoval jediný golden test a běžel bez systémů — hlídal
 * příkazy a silnice, ne růst. Zadání ale předepisuje „1000 tiků z fixního
 * seedu → snapshot hashe vrstev", tedy simulaci se vším všudy: poptávka, růst,
 * úrovně, difuze, doprava, spokojenost.
 *
 * Hash je neprůhledný, proto jsou vedle něj čitelná čísla — když se snapshot
 * změní, napoví, jestli šlo o změnu chování, nebo jen o jiný způsob hashování.
 *
 * Přegenerování: `npm run test:update-golden`. Změna musí být vidět v diffu.
 */
const SEED = 483928492;
const TICKS = 1000;

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/**
 * Město na generované mapě: páteřní silnice, tři zóny a elektrárna.
 *
 * Vodovod se předstírá (`assumeWatered`), protože vodárna potřebuje břeh
 * a tenhle test není o tom, jestli se na daném seedu najde. Kde končí voda,
 * hlídá `water.test.ts`.
 */
function buildCity(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(SEED, balance.economy);
  applyGeneratedMap(world, generateTerrain(SEED, balance));
  world.map = { seed: SEED, generated: true };

  // Místo pro město se **hledá**, nesází se natvrdo. Generátor se ladí a
  // souřadnice, které dnes padnou na louku, můžou zítra padnout do jezera —
  // a z golden testu by se stal test prázdné mapy. Hledání je deterministické,
  // takže snapshot zůstává stabilní stejně jako pevná čísla.
  const site = findSite(world);

  const roadY = site.y + 3;
  for (let x = site.x; x < site.x + SITE_W; x++) buildRoad(world, x, roadY, ROAD.street, balance);

  zoneArea(world, site.x, site.y, SITE_W, 3, ZONE.residential);
  zoneArea(world, site.x, roadY + 1, SITE_W / 2, 3, ZONE.commercial);
  zoneArea(world, site.x + SITE_W / 2, roadY + 1, SITE_W / 2, 3, ZONE.industrial);

  // Elektrárna hned nad zónou, u téže silnice.
  placeDefinition(world, content, 'vanilla:coal_power_plant', site.x, site.y - 5, balance);
  return world;
}

const SITE_W = 16;
const SITE_H = 8;

/** Okno `SITE_W × SITE_H` s nejvíc stavitelnými dlaždicemi. První vyhrává. */
function findSite(world: WorldState): { x: number; y: number } {
  let best = { x: 8, y: 8, score: -1 };

  for (let y = 8; y < MAP_SIZE - SITE_H - 8; y += 2) {
    for (let x = 8; x < MAP_SIZE - SITE_W - 8; x += 2) {
      let score = 0;
      for (let dy = 0; dy < SITE_H; dy++) {
        for (let dx = 0; dx < SITE_W; dx++) {
          const terrain =
            world.layers.terrain[index(x + dx, y + dy, world.size)] ??
            TERRAIN.water;
          if (terrain === TERRAIN.grass || terrain === TERRAIN.sand) score++;
        }
      }
      if (score > best.score) best = { x, y, score };
    }
  }

  return best;
}

/*
 * Snapshot se v T61 posunul a je to v pořádku: v řadě, kudy vede hlavní ulice,
 * jsou na tomhle seedu **tři zkroucené dlaždice**. Do T61 tam silnice odmítla
 * vzniknout a zůstaly v ní díry; teď si sedla srovná a ulice je souvislá, takže
 * má víc parcel přístup k silnici a město vyroste na 192 obyvatel místo 180.
 */
/*
 * V T66 se posunuly **hashe terénu, ne město**: zóna se při vyznačení srovná
 * (viz `levelZonedArea`), takže domy stojí na rovině místo na podezdívce.
 * Počet budov, obyvatel i práce zůstal na chlup stejný — právě proto, že
 * srovnání není podmínkou růstu, jen vzhledem.
 */
describe('golden: město po 1000 tikách', () => {
  it('pevný seed a plná sestava systémů dají stabilní hashe', async () => {
    const content = await vanilla();
    const world = buildCity(content);
    const systems = createDefaultSystems(content, content.getBalance());

    for (let tick = 0; tick < TICKS; tick++) {
      tickWorld(world, systems);
      assumeWatered(world);
    }

    expect({
      layers: hashLayers(world.layers),
      coarse: hashCoarseLayers(world.coarse),
      buildings: world.buildings.size,
      population: totalPopulation(world.buildings),
      jobs: totalJobs(world.buildings),
      funds: world.economy.funds,
    }).toMatchSnapshot();
  });

  it('udržované seznamy sedí s vrstvami i po tisíci tikách', async () => {
    // Seznamy silnic a zón se od T45 udržují při zápisu. Jediné místo, kde se
    // do vrstvy zapíše mimo `setRoadTile` / `setZoneTile`, je rozejde — a
    // nepoznalo by se to: růst by prostě přestal vidět kus města.
    //
    // Tenhle test je proto nezávislé orákulum: po celém běhu se seznamy
    // postaví znovu průchodem vrstev a porovnají s tím, co se udržovalo.
    const content = await vanilla();
    const world = buildCity(content);
    const systems = createDefaultSystems(content, content.getBalance());

    for (let tick = 0; tick < TICKS; tick++) {
      tickWorld(world, systems);
      assumeWatered(world);
    }

    const maintainedRoads = [...world.roadTiles].sort((a, b) => a - b);
    const maintainedZones = [...world.zonedTiles].sort((a, b) => a - b);
    expect(maintainedRoads.length).toBeGreaterThan(0);
    expect(maintainedZones.length).toBeGreaterThan(0);

    rebuildTileIndex(world);
    expect([...world.roadTiles].sort((a, b) => a - b)).toEqual(maintainedRoads);
    expect([...world.zonedTiles].sort((a, b) => a - b)).toEqual(maintainedZones);
  });

  it('dva běhy téhož seedu dají identické město', async () => {
    // Golden hlídá „nezměnilo se chování", tohle „chování je vůbec
    // reprodukovatelné". Bez druhého by se dal snapshot přegenerovat i nad
    // nedeterministickým kódem a nikdo by si toho nevšiml.
    const content = await vanilla();
    const run = (): string => {
      const world = buildCity(content);
      const systems = createDefaultSystems(content, content.getBalance());
      for (let tick = 0; tick < TICKS; tick++) {
        tickWorld(world, systems);
        assumeWatered(world);
      }
      return `${hashLayers(world.layers)}:${hashCoarseLayers(world.coarse)}`;
    };

    expect(run()).toBe(run());
  });
});
