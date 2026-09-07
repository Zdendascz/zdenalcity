import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { buildRoad, bulldoze, plantTrees, zoneArea } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { explainLandValue, landValueContext } from '@/sim/diagnostics';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createPollutionSystem } from '@/sim/systems';
import { coarseTerrainShare, needsClearing } from '@/sim/terrain';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

/** Důvod odmítnutí, nebo prázdno, když příkaz prošel. */
function reasonOf(result: { ok: boolean; reason?: string }): string {
  return result.ok ? '' : (result.reason ?? '');
}

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Vyplní čtverec 4×4 dlaždic, tedy přesně jednu buňku hrubé mřížky. */
function fillCell(world: WorldState, x: number, y: number, terrain: number): void {
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++)
      world.layers.terrain[index(x + dx, y + dy, world.size)] = terrain;
  }
}

describe('podíl terénu v buňce', () => {
  it('plná buňka je 1, poloviční 0,5', () => {
    const world = createWorld(1);
    fillCell(world, 20, 20, TERRAIN.forest);
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 4; dy++)
        world.layers.terrain[index(24 + dx, 20 + dy, world.size)] =
          TERRAIN.forest;
    }

    const share = coarseTerrainShare(world, TERRAIN.forest);
    expect(share[coarseIndex(20, 20, world.size)]).toBeCloseTo(1);
    expect(share[coarseIndex(24, 20, world.size)]).toBeCloseTo(0.5);
    expect(share[coarseIndex(60, 60, world.size)]).toBe(0);
  });

  it('zná terény, které se musí nejdřív upravit', () => {
    expect(needsClearing(TERRAIN.forest)).toBe(true);
    expect(needsClearing(TERRAIN.marsh)).toBe(true);
    expect(needsClearing(TERRAIN.rock)).toBe(true);
    expect(needsClearing(TERRAIN.grass)).toBe(false);
    expect(needsClearing(TERRAIN.sand)).toBe(false);
  });
});

describe('les v ceně půdy', () => {
  it('zvedá ji, dokud stojí, a po vykácení bonus zmizí (§13 krok 4)', () => {
    const world = createWorld(1);
    fillCell(world, 20, 20, TERRAIN.forest);
    const cell = coarseIndex(20, 20, world.size);

    const withForest = explainLandValue(world, VANILLA_BALANCE, cell, landValueContext(world, VANILLA_BALANCE));
    const forestTerm = withForest.terms.find((term) => term.source === 'forest');
    expect(forestTerm?.amount).toBeCloseTo(VANILLA_BALANCE.landValue.weights['forest'] ?? 0);

    // Vykácení celé buňky.
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) bulldoze(world, 20 + dx, 20 + dy, VANILLA_BALANCE);
    }

    const cleared = explainLandValue(world, VANILLA_BALANCE, cell, landValueContext(world, VANILLA_BALANCE));
    expect(cleared.terms.some((term) => term.source === 'forest')).toBe(false);
    expect(cleared.raw).toBeLessThan(withForest.raw);
  });

  it('písek cenu půdy naopak mírně sráží', () => {
    const world = createWorld(1);
    fillCell(world, 20, 20, TERRAIN.sand);

    const explained = explainLandValue(
      world,
      VANILLA_BALANCE,
      coarseIndex(20, 20, world.size),
      landValueContext(world, VANILLA_BALANCE),
    );
    const sand = explained.terms.find((term) => term.source === 'sand');

    expect(sand?.amount).toBeLessThan(0);
  });
});

describe('les pohlcuje znečištění', () => {
  it('továrna v lese špiní míň než na holé pláni', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const factory = content.get('vanilla:industrial_small');
    expect(factory).toBeDefined();
    if (!factory) return;

    const measure = (forested: boolean): number => {
      const world = createWorld(1, balance.economy);
      if (forested) fillCell(world, 20, 20, TERRAIN.forest);
      placeBuilding(world, factory, 21, 21);

      const system = createPollutionSystem(content, balance);
      for (let tick = 0; tick < 400; tick++) tickWorld(world, [system]);
      return world.coarse.pollution[coarseIndex(21, 21, world.size)] ?? 0;
    };

    const bare = measure(false);
    const forested = measure(true);

    expect(bare).toBeGreaterThan(0);
    expect(forested).toBeLessThan(bare);
  });
});

describe('sázení lesa', () => {
  it('z trávy udělá les a zaplatí se za to', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    const before = world.economy.funds;

    expect(plantTrees(world, 30, 30, VANILLA_BALANCE).ok).toBe(true);

    expect(world.layers.terrain[index(30, 30, world.size)]).toBe(TERRAIN.forest);
    expect(world.economy.funds).toBe(before - VANILLA_BALANCE.map.plantTreesCost);
  });

  it('sázet je levnější než kácet — les se má vyplatit dřív než po továrně', () => {
    // Není to kosmetika: les pohlcuje polovinu znečištění v buňce a nemá
    // údržbu, takže je to jediná obrana proti kouři, která se platí jednou.
    expect(VANILLA_BALANCE.map.plantTreesCost).toBeLessThan(VANILLA_BALANCE.map.clearForestCost);
  });

  it('na lese, silnici, sutí ani na vyznačené parcele to nejde', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);

    world.layers.terrain[index(10, 10, world.size)] = TERRAIN.forest;
    expect(reasonOf(plantTrees(world, 10, 10, VANILLA_BALANCE))).toBe('error.forestExists');

    expect(buildRoad(world, 12, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(reasonOf(plantTrees(world, 12, 10, VANILLA_BALANCE))).toBe('error.roadInTheWay');

    world.rubble[index(14, 10, world.size)] = 1;
    expect(reasonOf(plantTrees(world, 14, 10, VANILLA_BALANCE))).toBe('error.rubbleInTheWay');

    // Zóna je překážka schválně: les by na vyznačené parcele jen tiše zabránil
    // růstu a hráč by koukal, proč mu čtvrť nezarostla, když si ji sám zalesnil.
    expect(zoneArea(world, 16, 10, 1, 1, ZONE.residential, VANILLA_BALANCE).ok).toBe(true);
    expect(reasonOf(plantTrees(world, 16, 10, VANILLA_BALANCE))).toBe('error.zoneInTheWay');
  });

  it('na vodě ani na skále les nezakoření', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.layers.terrain[index(20, 20, world.size)] = TERRAIN.water;
    world.layers.terrain[index(22, 20, world.size)] = TERRAIN.rock;

    expect(reasonOf(plantTrees(world, 20, 20, VANILLA_BALANCE))).toBe('error.terrainNotAllowed');
    expect(reasonOf(plantTrees(world, 22, 20, VANILLA_BALANCE))).toBe('error.terrainNotAllowed');
  });

  it('bez peněz se nesází', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.economy.funds = 0;

    const result = plantTrees(world, 30, 30, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.notEnoughFunds');
    expect(world.layers.terrain[index(30, 30, world.size)]).toBe(TERRAIN.grass);
  });

  it('vysazený les opravdu pohltí kouř — ne jen změní obrázek', async () => {
    /*
     * Celý smysl nástroje. Měří se stejným způsobem jako u lesa z generátoru
     * o pár testů výš: dvě stejné továrny, jedna na holé pláni, druhá v buňce,
     * kterou hráč zalesnil ručně.
     */
    const content = await vanilla();
    const balance = content.getBalance();

    const bare = createWorld(1, balance.economy);
    const planted = createWorld(1, balance.economy);
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        expect(plantTrees(planted, 40 + dx, 40 + dy, balance).ok).toBe(true);
      }
    }

    const definition = content.get('vanilla:industrial_small');
    expect(definition).toBeDefined();
    if (!definition) return;

    const system = createPollutionSystem(content, balance);
    for (const world of [bare, planted]) {
      placeBuilding(world, definition, 40, 40);
      for (let tick = 0; tick < 40; tick++) tickWorld(world, [system]);
    }

    const cell = coarseIndex(40, 40, bare.size);
    expect(planted.coarse.pollution[cell] ?? 0).toBeLessThan(bare.coarse.pollution[cell] ?? 0);
  });
});

describe('kácení lesa', () => {
  it('stojí peníze a uvolní místo', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.layers.terrain[index(30, 30, world.size)] = TERRAIN.forest;
    const before = world.economy.funds;

    expect(bulldoze(world, 30, 30, VANILLA_BALANCE).ok).toBe(true);

    expect(world.layers.terrain[index(30, 30, world.size)]).toBe(TERRAIN.grass);
    expect(world.economy.funds).toBe(
      before - VANILLA_BALANCE.map.clearForestCost,
    );
  });

  it('bez peněz se nekácí', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.layers.terrain[index(30, 30, world.size)] = TERRAIN.forest;
    world.economy.funds = 0;

    const result = bulldoze(world, 30, 30, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.notEnoughFunds');
    expect(world.layers.terrain[index(30, 30, world.size)]).toBe(
      TERRAIN.forest,
    );
  });

  it('mokřad se zaveze a skála odtěží — od 3b už to jde (§7)', () => {
    // Do fáze 3a to byly terény, se kterými hráč nemohl dělat vůbec nic.
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.layers.terrain[index(30, 30, world.size)] = TERRAIN.marsh;
    world.layers.terrain[index(31, 30, world.size)] = TERRAIN.rock;
    const funds = world.economy.funds;

    expect(bulldoze(world, 30, 30, VANILLA_BALANCE).ok).toBe(true);
    expect(bulldoze(world, 31, 30, VANILLA_BALANCE).ok).toBe(true);

    expect(world.layers.terrain[index(30, 30, world.size)]).toBe(TERRAIN.grass);
    expect(world.layers.terrain[index(31, 30, world.size)]).toBe(TERRAIN.grass);
    // Skála stojí víc než mokřad — je to těžba, ne navážka.
    expect(funds - world.economy.funds).toBe(
      VANILLA_BALANCE.map.fillMarshCost + VANILLA_BALANCE.map.clearRockCost,
    );
    expect(VANILLA_BALANCE.map.clearRockCost).toBeGreaterThan(VANILLA_BALANCE.map.fillMarshCost);
  });

  it('na lese nic nevyroste, dokud se nevykácí', async () => {
    const content = await vanilla();
    const house = content.get('vanilla:residential_small');
    expect(house?.construction.allowedTerrain).not.toContain(TERRAIN.forest);
    expect(house?.construction.allowedTerrain).not.toContain(TERRAIN.marsh);
    expect(house?.construction.allowedTerrain).not.toContain(TERRAIN.rock);
  });
});
