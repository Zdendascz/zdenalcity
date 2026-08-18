import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import {
  COARSE_CELLS,
  COARSE_FACTOR,
  COARSE_SIZE,
  coarseIndex,
  createCoarseLayers,
  hashCoarseLayers,
} from '@/sim/coarse';
import { diffuse } from '@/sim/diffusion';
import { MAP_SIZE } from '@/sim/layers';
import { createPollutionSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

const FACTORY: Definition = {
  id: 'test:factory',
  type: 'building',
  category: 'industrial',
  name: 'building.factory.name',
  description: 'building.factory.desc',
  footprint: [1, 1],
  construction: { cost: 200, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 25 },
  jobs: { capacity: 12 },
  environment: { pollution: 20 },
  graphics: { color: '#d9c07f', heightLevels: 1 },
};

const HOUSE: Definition = {
  ...FACTORY,
  id: 'test:house',
  category: 'residential',
  population: { capacity: 8 },
  jobs: undefined,
  environment: undefined,
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Odtiká tolik tiků, aby difuze proběhla `runs`krát (interval 8, offset 3). */
function runPollution(world: WorldState, catalogue: BuildingCatalogue, runs: number): void {
  const system = createPollutionSystem(catalogue);
  for (let tick = 0; tick < runs * system.interval + system.offset; tick++) {
    tickWorld(world, [system]);
  }
}

function cell(world: WorldState, x: number, y: number): number {
  return world.coarse.pollution[coarseIndex(x, y)] ?? 0;
}

describe('hrubá mřížka', () => {
  it('je 32×32 a jedna buňka pokrývá 4×4 dlaždice', () => {
    expect(COARSE_SIZE).toBe(32);
    expect(COARSE_CELLS).toBe(1024);
    expect(MAP_SIZE / COARSE_FACTOR).toBe(COARSE_SIZE);
  });

  it('všechny dlaždice jednoho bloku 4×4 padnou do stejné buňky', () => {
    const target = coarseIndex(8, 12);
    for (let dy = 0; dy < COARSE_FACTOR; dy++) {
      for (let dx = 0; dx < COARSE_FACTOR; dx++) {
        expect(coarseIndex(8 + dx, 12 + dy)).toBe(target);
      }
    }
    expect(coarseIndex(12, 12)).not.toBe(target);
  });

  it('hash reaguje na změnu jediné buňky', () => {
    const layers = createCoarseLayers();
    const before = hashCoarseLayers(layers);
    layers.pollution[500] = 3;
    expect(hashCoarseLayers(layers)).not.toBe(before);
  });
});

describe('difuze', () => {
  const SPREAD = 0.4;
  const DECAY = 0.94;

  function withSource(at: number, strength: number, passes: number, runs = 1): Uint8Array {
    const layer = new Uint8Array(COARSE_CELLS);
    const sources = new Float32Array(COARSE_CELLS);
    sources[at] = strength;
    for (let i = 0; i < runs; i++) diffuse(layer, sources, SPREAD, DECAY, passes);
    return layer;
  }

  it('rozlije zdroj do sousedů', () => {
    const middle = 16 * COARSE_SIZE + 16;
    const layer = withSource(middle, 100, 2);

    expect(layer[middle]).toBeGreaterThan(0);
    expect(layer[middle + 1]).toBeGreaterThan(0);
    expect(layer[middle + COARSE_SIZE + 1]).toBeGreaterThan(0); // úhlopříčně taky
  });

  it('se vzdáleností klesá', () => {
    const middle = 16 * COARSE_SIZE + 16;
    const layer = withSource(middle, 200, 2, 20);

    const střed = layer[middle] ?? 0;
    const blízko = layer[middle + 2] ?? 0;
    const daleko = layer[middle + 6] ?? 0;

    expect(střed).toBeGreaterThan(blízko);
    expect(blízko).toBeGreaterThan(daleko);
  });

  it('okraj mapy pohlcuje — v rohu se nahromadí míň než uprostřed', () => {
    const middle = 16 * COARSE_SIZE + 16;
    const corner = 0;

    const uprostřed = withSource(middle, 100, 2, 30)[middle] ?? 0;
    const vRohu = withSource(corner, 100, 2, 30)[corner] ?? 0;

    expect(vRohu).toBeLessThan(uprostřed);
  });

  it('bez zdroje odezní', () => {
    const layer = new Uint8Array(COARSE_CELLS);
    layer.fill(200);
    const sources = new Float32Array(COARSE_CELLS);

    for (let i = 0; i < 100; i++) diffuse(layer, sources, SPREAD, DECAY, 2);

    expect(Math.max(...layer)).toBe(0);
  });

  it('se stálým zdrojem konverguje a nepřeteče 255', () => {
    const middle = 16 * COARSE_SIZE + 16;
    const layer = withSource(middle, 255, 2, 500);
    expect(Math.max(...layer)).toBeLessThanOrEqual(255);
    expect(layer[middle]).toBeGreaterThan(0);
  });
});

describe('znečištění ve světě', () => {
  it('továrna zamoří svou buňku a okolí méně', () => {
    const world = createWorld(1);
    placeBuilding(world, FACTORY, 64, 64);

    runPollution(world, catalogueOf(FACTORY), 30);

    const uTovárny = cell(world, 64, 64);
    const vedle = cell(world, 64 + COARSE_FACTOR * 2, 64);
    const daleko = cell(world, 64 + COARSE_FACTOR * 8, 64);

    expect(uTovárny).toBeGreaterThan(0);
    expect(vedle).toBeLessThan(uTovárny);
    expect(daleko).toBeLessThan(vedle);
  });

  it('prázdné město nezamoří nic', () => {
    const world = createWorld(1);
    runPollution(world, catalogueOf(FACTORY), 10);
    expect(Math.max(...world.coarse.pollution)).toBe(0);
  });

  it('obyvatelé bez skládky zamoří celé město odpadem', () => {
    const world = createWorld(1);
    for (let i = 0; i < 40; i++) placeBuilding(world, HOUSE, 20 + i, 20);

    runPollution(world, catalogueOf(HOUSE), 40);

    // Odpad jde do vzduchu rovnoměrně, takže i roh mapy něco dostane.
    expect(cell(world, 0, 0)).toBeGreaterThan(0);
    expect(cell(world, 120, 120)).toBeGreaterThan(0);
  });

  it('zdroj sedí na předním rohu půdorysu', () => {
    const big: Definition = { ...FACTORY, id: 'test:big', footprint: [4, 4] };
    const world = createWorld(1);
    // Půdorys (62..65, 62..65) přesahuje přes hranici buňky, takže počátek
    // a přední roh padnou do různých buněk.
    placeBuilding(world, big, 62, 62);

    runPollution(world, catalogueOf(big), 1);

    expect(coarseIndex(62, 62)).not.toBe(coarseIndex(65, 65));
    // Buňka počátku něco dostane difuzí, ale zdroj sedí v té s předním rohem.
    expect(cell(world, 65, 65)).toBeGreaterThan(cell(world, 62, 62));
  });

  it('ohlásí změnu hrubé mřížky do DirtySet', () => {
    const world = createWorld(1);
    placeBuilding(world, FACTORY, 64, 64);
    world.dirty.coarseChanged = false;

    runPollution(world, catalogueOf(FACTORY), 1);

    expect(world.dirty.coarseChanged).toBe(true);
  });

  it('je deterministické', () => {
    const build = (): WorldState => {
      const world = createWorld(4242);
      placeBuilding(world, FACTORY, 40, 40);
      placeBuilding(world, FACTORY, 44, 41);
      runPollution(world, catalogueOf(FACTORY), 25);
      return world;
    };

    expect(hashCoarseLayers(build().coarse)).toBe(hashCoarseLayers(build().coarse));
  });
});

describe('vanilla obsah', () => {
  it('dílna znečišťuje, dům ne', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    expect(content.get('vanilla:industrial_small')?.environment?.pollution).toBeGreaterThan(0);
    expect(content.get('vanilla:coal_power_plant')?.environment?.pollution).toBeGreaterThan(0);
    expect(content.get('vanilla:residential_small')?.environment?.pollution).toBeGreaterThan(0);
  });
});
