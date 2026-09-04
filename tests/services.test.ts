import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { COARSE_FACTOR, coarseIndex, hashCoarseLayers } from '@/sim/coarse';
import {
  createCrimeSystem,
  createLandValueSystem,
  createServiceSystem,
} from '@/sim/systems';
import { createWorld, removeBuilding, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';
import { powerAll } from './support/power';

const STATION: Definition = {
  id: 'test:station',
  type: 'building',
  category: 'service',
  name: 'building.station.name',
  description: 'building.station.desc',
  footprint: [2, 2],
  level: 1,
  construction: { cost: 500, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 100 },
  // Dosah je od T91 v **dlaždicích**, ne v buňkách hrubé mřížky. Dvacet čtyři
  // dlaždic je šest buněk, tedy přesně to, co tenhle fixture míval.
  service: { class: 'police', radius: 24, strength: 120 },
  graphics: { color: '#6f7fa8', heightLevels: 1 },
};

const HOUSE: Definition = {
  id: 'test:house',
  type: 'building',
  category: 'residential',
  name: 'building.house.name',
  description: 'building.house.desc',
  footprint: [1, 1],
  level: 1,
  construction: { cost: 100, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
  economy: { upkeep: 10 },
  population: { capacity: 8 },
  graphics: { color: '#8fb4dd', heightLevels: 1 },
};

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Pokrytí se přepočítá jedním tikem, protože systém běží každý tik. */
function recomputeCoverage(world: WorldState, catalogue: BuildingCatalogue): void {
  powerAll(world);
  tickWorld(world, [createServiceSystem(catalogue)]);
}

function coverage(world: WorldState, x: number, y: number): number {
  return world.coverage.get('police')?.[coarseIndex(x, y, MAP_SIZE)] ?? 0;
}

function crime(world: WorldState, x: number, y: number): number {
  return world.coarse.crime[coarseIndex(x, y, MAP_SIZE)] ?? 0;
}

describe('pokrytí službami', () => {
  it('je nejsilnější u stanice a se vzdáleností klesá', () => {
    const world = createWorld(1);
    placeBuilding(world, STATION, 64, 64);
    recomputeCoverage(world, catalogueOf(STATION));

    const uStanice = coverage(world, 64, 64);
    const blízko = coverage(world, 64 + COARSE_FACTOR * 2, 64);
    const daleko = coverage(world, 64 + COARSE_FACTOR * 5, 64);

    expect(uStanice).toBeGreaterThan(blízko);
    expect(blízko).toBeGreaterThan(daleko);
    expect(daleko).toBeGreaterThan(0);
  });

  it('za dosahem je nulové', () => {
    const world = createWorld(1);
    placeBuilding(world, STATION, 64, 64);
    recomputeCoverage(world, catalogueOf(STATION));

    // Dosah 24 dlaždic = 6 buněk.
    expect(coverage(world, 64 + COARSE_FACTOR * 8, 64)).toBe(0);
  });

  it('dvě stanice vedle sebe pokrývají víc než jedna', () => {
    const jedna = createWorld(1);
    placeBuilding(jedna, STATION, 64, 64);
    recomputeCoverage(jedna, catalogueOf(STATION));

    const dvě = createWorld(1);
    placeBuilding(dvě, STATION, 64, 64);
    placeBuilding(dvě, STATION, 68, 64);
    recomputeCoverage(dvě, catalogueOf(STATION));

    expect(coverage(dvě, 66, 64)).toBeGreaterThan(coverage(jedna, 66, 64));
  });

  it('podfinancování zmenší dosah i sílu', () => {
    const plné = createWorld(1);
    placeBuilding(plné, STATION, 64, 64);
    recomputeCoverage(plné, catalogueOf(STATION));

    const poloviční = createWorld(1);
    placeBuilding(poloviční, STATION, 64, 64);
    poloviční.serviceFunding.set('police', 0.5);
    recomputeCoverage(poloviční, catalogueOf(STATION));

    expect(coverage(poloviční, 64, 64)).toBeLessThan(coverage(plné, 64, 64));
    // Na okraji původního dosahu už podfinancovaná stanice nedosáhne.
    expect(coverage(poloviční, 64 + COARSE_FACTOR * 5, 64)).toBe(0);
    expect(coverage(plné, 64 + COARSE_FACTOR * 5, 64)).toBeGreaterThan(0);
  });

  it('po zbourání stanice pokrytí zmizí', () => {
    const world = createWorld(1);
    const station = placeBuilding(world, STATION, 64, 64);
    recomputeCoverage(world, catalogueOf(STATION));
    expect(coverage(world, 64, 64)).toBeGreaterThan(0);

    removeBuilding(world, station.id);
    recomputeCoverage(world, catalogueOf(STATION));

    expect(coverage(world, 64, 64)).toBe(0);
  });

  it('počítá se jen při změně', () => {
    const world = createWorld(1);
    placeBuilding(world, STATION, 64, 64);
    recomputeCoverage(world, catalogueOf(STATION));
    expect(world.coverageDirty).toBe(false);

    // Ruční zásah do pokrytí bez nastavení vlajky systém nepřepíše.
    world.coverage.get('police')?.fill(7);
    recomputeCoverage(world, catalogueOf(STATION));
    expect(coverage(world, 64, 64)).toBe(7);
  });
});

describe('kriminalita', () => {
  /** Odtiká tolik tiků, aby kriminalita proběhla `runs`krát (interval 16, offset 11). */
  function runCrime(world: WorldState, catalogue: BuildingCatalogue, runs: number): void {
    const systems = [createServiceSystem(catalogue), createCrimeSystem(VANILLA_BALANCE)];
    powerAll(world);
    for (let tick = 0; tick < runs * 16 + 11; tick++) tickWorld(world, systems);
  }

  it('roste s hustotou obyvatel', () => {
    const world = createWorld(1);
    for (let i = 0; i < 12; i++) placeBuilding(world, HOUSE, 64 + (i % 4), 64 + ((i / 4) | 0));

    runCrime(world, catalogueOf(HOUSE), 30);

    expect(crime(world, 64, 64)).toBeGreaterThan(0);
    expect(crime(world, 100, 100)).toBeLessThan(crime(world, 64, 64));
  });

  it('policie ji srazí', () => {
    const build = (withStation: boolean): WorldState => {
      const world = createWorld(1);
      for (let i = 0; i < 12; i++) placeBuilding(world, HOUSE, 64 + (i % 4), 64 + ((i / 4) | 0));
      if (withStation) placeBuilding(world, STATION, 70, 64);
      runCrime(world, catalogueOf(HOUSE, STATION), 30);
      return world;
    };

    expect(crime(build(true), 64, 64)).toBeLessThan(crime(build(false), 64, 64));
  });

  it('prázdné město je bez kriminality', () => {
    const world = createWorld(1);
    runCrime(world, catalogueOf(HOUSE), 10);
    expect(Math.max(...world.coarse.crime)).toBe(0);
  });

  it('nezaměstnanost ji zvedá celoměstsky', () => {
    const world = createWorld(1);
    // Domy bez jediného pracovního místa: nezaměstnanost je 100 %.
    for (let i = 0; i < 4; i++) placeBuilding(world, HOUSE, 64 + i, 64);
    runCrime(world, catalogueOf(HOUSE), 30);

    // I buňka bez obyvatel dostane příspěvek z celoměstské nezaměstnanosti.
    expect(crime(world, 4, 4)).toBeGreaterThan(0);
  });

  it('běží každých 16 tiků s offsetem 11', () => {
    const system = createCrimeSystem(VANILLA_BALANCE);
    expect([system.name, system.interval, system.offset]).toEqual(['crime', 16, 11]);
  });
});

describe('vazba na cenu půdy', () => {
  function runAll(world: WorldState, catalogue: BuildingCatalogue, runs: number): void {
    const systems = [createServiceSystem(catalogue), createCrimeSystem(VANILLA_BALANCE), createLandValueSystem(VANILLA_BALANCE)];
    powerAll(world);
    for (let tick = 0; tick < runs * 16 + 11; tick++) tickWorld(world, systems);
  }

  it('policejní stanice cenu půdy zvedne', () => {
    const bezStanice = createWorld(1);
    runAll(bezStanice, catalogueOf(STATION), 40);

    const seStanicí = createWorld(1);
    placeBuilding(seStanicí, STATION, 64, 64);
    runAll(seStanicí, catalogueOf(STATION), 40);

    const doma = seStanicí.coarse.landValue[coarseIndex(64, 64, MAP_SIZE)] ?? 0;
    const bez = bezStanice.coarse.landValue[coarseIndex(64, 64, MAP_SIZE)] ?? 0;

    expect(doma).toBeGreaterThan(bez);
  });

  it('kriminalita cenu půdy srazí', () => {
    const world = createWorld(1);
    for (let i = 0; i < 16; i++) placeBuilding(world, HOUSE, 64 + (i % 4), 64 + ((i / 4) | 0));

    runAll(world, catalogueOf(HOUSE), 40);

    const uKriminality =
      world.coarse.landValue[coarseIndex(64, 64, MAP_SIZE)] ?? 0;
    const klid = world.coarse.landValue[coarseIndex(4, 100, MAP_SIZE)] ?? 0;

    expect(crime(world, 64, 64)).toBeGreaterThan(0);
    expect(uKriminality).toBeLessThan(klid);
  });

  it('celá sestava je deterministická', () => {
    const build = (): WorldState => {
      const world = createWorld(9);
      for (let i = 0; i < 8; i++) placeBuilding(world, HOUSE, 60 + i, 60);
      placeBuilding(world, STATION, 70, 60);
      runAll(world, catalogueOf(HOUSE, STATION), 20);
      return world;
    };

    expect(hashCoarseLayers(build().coarse)).toBe(hashCoarseLayers(build().coarse));
  });
});

describe('vanilla policejní stanice', () => {
  it('projde schématem a nese třídu, dosah i sílu', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const station = content.get('vanilla:police_small');
    expect(station?.category).toBe('service');
    expect(station?.service).toEqual({ class: 'police', radius: 12, strength: 60 });
  });

  it('je v katalogu služeb, takže se objeví v paletě', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    expect(content.byCategory('service').map((d) => d.id)).toContain('vanilla:police_small');
  });

  it('vanilla nabízí osm tříd služeb plus odpady', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const classes = [
      ...new Set(
        content
          .getAll('building')
          .map((d) => d.service?.class)
          .filter((c): c is string => c !== undefined),
      ),
    ].sort();

    expect(classes).toEqual([
      'culture',
      'education',
      'fire',
      'health',
      'parks',
      'police',
      'social',
      'transit',
    ]);

    const waste = content.getAll('building').filter((d) => d.waste !== undefined);
    expect(waste.map((d) => d.id).sort()).toEqual(['vanilla:incinerator', 'vanilla:landfill']);
    // Skládka je levnější, ale znečišťuje víc a pobere míň.
    const landfill = content.get('vanilla:landfill');
    const incinerator = content.get('vanilla:incinerator');
    expect(landfill?.construction.cost).toBeLessThan(incinerator?.construction.cost ?? 0);
    expect(landfill?.waste?.capacity).toBeLessThan(incinerator?.waste?.capacity ?? 0);
    expect(landfill?.environment?.pollution).toBeGreaterThan(
      incinerator?.environment?.pollution ?? 0,
    );
  });
});
