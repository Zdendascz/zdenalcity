import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import {
  COARSE_FACTOR,
  coarseIndex,
  createCoarseLayers,
  hashCoarseLayers,
} from '@/sim/coarse';
import { diffuse } from '@/sim/diffusion';
import { createPollutionSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE, COARSE_SIZE, COARSE_CELLS } from './support/grid';

const FACTORY: Definition = {
  id: 'test:factory',
  type: 'building',
  category: 'industrial',
  name: 'building.factory.name',
  description: 'building.factory.desc',
  footprint: [1, 1],
  level: 1,
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
  const system = createPollutionSystem(catalogue, VANILLA_BALANCE);
  for (let tick = 0; tick < runs * system.interval + system.offset; tick++) {
    tickWorld(world, [system]);
  }
}

function cell(world: WorldState, x: number, y: number): number {
  return world.coarse.pollution[coarseIndex(x, y, MAP_SIZE)] ?? 0;
}

describe('hrubá mřížka', () => {
  it('je 32×32 a jedna buňka pokrývá 4×4 dlaždice', () => {
    expect(COARSE_SIZE).toBe(32);
    expect(COARSE_CELLS).toBe(1024);
    expect(MAP_SIZE / COARSE_FACTOR).toBe(COARSE_SIZE);
  });

  it('všechny dlaždice jednoho bloku 4×4 padnou do stejné buňky', () => {
    const target = coarseIndex(8, 12, MAP_SIZE);
    for (let dy = 0; dy < COARSE_FACTOR; dy++) {
      for (let dx = 0; dx < COARSE_FACTOR; dx++) {
        expect(coarseIndex(8 + dx, 12 + dy, MAP_SIZE)).toBe(target);
      }
    }
    expect(coarseIndex(12, 12, MAP_SIZE)).not.toBe(target);
  });

  it('hash reaguje na změnu jediné buňky', () => {
    const layers = createCoarseLayers(MAP_SIZE);
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

    expect(coarseIndex(62, 62, MAP_SIZE)).not.toBe(
      coarseIndex(65, 65, MAP_SIZE),
    );
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
  it('dílna a elektrárna znečišťují, dům sám o sobě ne', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    expect(content.get('vanilla:industrial_small')?.environment?.pollution).toBeGreaterThan(0);
    expect(content.get('vanilla:coal_power_plant')?.environment?.pollution).toBeGreaterThan(0);
    // Bydlení špiní přes odpad, který obyvatelé vyrobí, ne přímo. Jinak se
    // hustá čtvrť otráví sama a zahušťování ztratí smysl.
    expect(content.get('vanilla:residential_small')?.environment?.pollution ?? 0).toBe(0);
  });

  it('čtvrť bez průmyslu zůstane měřitelně čistší než ta s ním', async () => {
    // Nahlásil autor: overlay znečištění byl celý stejně fialový, u elektrárny
    // i v parku. Difuze se ustaluje zhruba na dvouapůlnásobku zdroje, takže
    // hodnoty volené „jak špinavá ta budova je" se v husté čtvrti sečetly přes
    // strop 255 a mapa přestala cokoli rozlišovat.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const balance = content.getBalance();

    const world = createWorld(1, balance.economy);
    // Průmyslový areál v jednom rohu, obytná čtvrť daleko v druhém.
    const factory = content.get('vanilla:industrial_small');
    const house = content.get('vanilla:residential_small');
    expect(factory && house).toBeTruthy();
    if (!factory || !house) return;

    for (let x = 8; x < 16; x++) {
      for (let y = 8; y < 16; y++) placeBuilding(world, factory, x, y);
    }
    for (let x = 100; x < 108; x++) {
      for (let y = 100; y < 108; y++) placeBuilding(world, house, x, y);
    }

    const system = createPollutionSystem(content, balance);
    for (let tick = 0; tick < 2000; tick++) tickWorld(world, [system]);

    const dirty = world.coarse.pollution[coarseIndex(12, 12, MAP_SIZE)] ?? 0;
    const clean = world.coarse.pollution[coarseIndex(104, 104, MAP_SIZE)] ?? 0;

    expect(dirty).toBeGreaterThan(50); // areál musí být vidět
    expect(clean).toBeLessThan(dirty / 4); // a čtvrť daleko od něj musí být jinak
  });

  it('jedna skládka pobere odpad malého města', async () => {
    // Původní kapacita 20 znamenala, že město o třech tisících lidech potřebuje
    // patnáct skládek — a nepokrytý odpad zaplavil znečištěním celou mapu
    // rovnoměrně, tedy i parky.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const balance = content.getBalance();

    const landfill = content.get('vanilla:landfill')?.waste?.capacity ?? 0;
    const incinerator = content.get('vanilla:incinerator')?.waste?.capacity ?? 0;

    expect(landfill).toBeGreaterThanOrEqual(1000 * balance.waste.perCitizen);
    expect(incinerator).toBeGreaterThan(landfill * 2);
  });
});
