import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { bulldoze } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { explainLandValue, landValueContext } from '@/sim/diagnostics';
import { index, TERRAIN } from '@/sim/layers';
import { createPollutionSystem } from '@/sim/systems';
import { coarseTerrainShare, needsClearing } from '@/sim/terrain';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Vyplní čtverec 4×4 dlaždic, tedy přesně jednu buňku hrubé mřížky. */
function fillCell(world: WorldState, x: number, y: number, terrain: number): void {
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++) world.layers.terrain[index(x + dx, y + dy)] = terrain;
  }
}

describe('podíl terénu v buňce', () => {
  it('plná buňka je 1, poloviční 0,5', () => {
    const world = createWorld(1);
    fillCell(world, 20, 20, TERRAIN.forest);
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 4; dy++) world.layers.terrain[index(24 + dx, 20 + dy)] = TERRAIN.forest;
    }

    const share = coarseTerrainShare(world, TERRAIN.forest);
    expect(share[coarseIndex(20, 20)]).toBeCloseTo(1);
    expect(share[coarseIndex(24, 20)]).toBeCloseTo(0.5);
    expect(share[coarseIndex(60, 60)]).toBe(0);
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
    const cell = coarseIndex(20, 20);

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

    const explained = explainLandValue(world, VANILLA_BALANCE, coarseIndex(20, 20), landValueContext(world, VANILLA_BALANCE));
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
      return world.coarse.pollution[coarseIndex(21, 21)] ?? 0;
    };

    const bare = measure(false);
    const forested = measure(true);

    expect(bare).toBeGreaterThan(0);
    expect(forested).toBeLessThan(bare);
  });
});

describe('kácení lesa', () => {
  it('stojí peníze a uvolní místo', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.layers.terrain[index(30, 30)] = TERRAIN.forest;
    const before = world.economy.funds;

    expect(bulldoze(world, 30, 30, VANILLA_BALANCE).ok).toBe(true);

    expect(world.layers.terrain[index(30, 30)]).toBe(TERRAIN.grass);
    expect(world.economy.funds).toBe(before - VANILLA_BALANCE.map.clearForestCost);
  });

  it('bez peněz se nekácí', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.layers.terrain[index(30, 30)] = TERRAIN.forest;
    world.economy.funds = 0;

    const result = bulldoze(world, 30, 30, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.notEnoughFunds');
    expect(world.layers.terrain[index(30, 30)]).toBe(TERRAIN.forest);
  });

  it('mokřad ani skálu buldozer nespraví — to je až terraforming (3b)', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy);
    world.layers.terrain[index(30, 30)] = TERRAIN.marsh;
    world.layers.terrain[index(31, 30)] = TERRAIN.rock;

    expect(bulldoze(world, 30, 30, VANILLA_BALANCE).ok).toBe(false);
    expect(bulldoze(world, 31, 30, VANILLA_BALANCE).ok).toBe(false);
  });

  it('na lese nic nevyroste, dokud se nevykácí', async () => {
    const content = await vanilla();
    const house = content.get('vanilla:residential_small');
    expect(house?.construction.allowedTerrain).not.toContain(TERRAIN.forest);
    expect(house?.construction.allowedTerrain).not.toContain(TERRAIN.marsh);
    expect(house?.construction.allowedTerrain).not.toContain(TERRAIN.rock);
  });
});
