import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { validateDefinition } from '@/content/schema';
import type { Definition } from '@/content/schema';
import { placeBuilding } from '@/sim/buildings';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { COARSE_CELLS, coarseIndex } from '@/sim/coarse';
import { ZONE } from '@/sim/layers';
import { tryUpgrade } from '@/sim/levels';
import { checkRequirements, presentDefinitions } from '@/sim/requirements';
import { createGrowthSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

function definition(id: string, overrides: Partial<Definition> = {}): Definition {
  return {
    id: `test:${id}`,
    type: 'building',
    category: 'residential',
    name: `building.${id}.name`,
    description: `building.${id}.desc`,
    footprint: [1, 1],
    level: 1,
    construction: { cost: 10, requiresRoad: false, requiresPower: false, allowedTerrain: [0] },
    economy: { upkeep: 1 },
    population: { capacity: 8 },
    graphics: { color: '#8fb4dd', heightLevels: 1 },
    ...overrides,
  };
}

function catalogueOf(...definitions: Definition[]): BuildingCatalogue {
  return {
    get: (id) => definitions.find((d) => d.id === id),
    byCategory: (category) => definitions.filter((d) => d.category === category),
  };
}

/** Zóna u silnice s poptávkou, kde se dá růst i povyšovat. */
function zonedWorld(): WorldState {
  const world = createWorld(1);
  for (let x = 4; x <= 16; x++) buildRoad(world, x, 4);
  zoneArea(world, 5, 5, 10, 6, ZONE.residential);
  world.demand.residential = 50;
  return world;
}

function withCoverage(world: WorldState, serviceClass: string, value: number): WorldState {
  world.coverage.set(serviceClass, new Uint8Array(COARSE_CELLS).fill(value));
  return world;
}

describe('schéma prerekvizit', () => {
  const base = {
    id: 'testmod:thing',
    type: 'building',
    category: 'residential',
    name: 'building.thing.name',
    description: 'building.thing.desc',
    footprint: [1, 1],
    construction: { cost: 1, requiresRoad: true, requiresPower: false, allowedTerrain: [0] },
    economy: { upkeep: 1 },
    graphics: { color: '#8fb4dd', heightLevels: 1 },
  };

  it('přijme obě části i každou zvlášť', () => {
    const both = validateDefinition(
      { ...base, requirements: { services: { education: 40 }, buildings: ['vanilla:school'] } },
      'testmod',
    );
    expect(both.issues).toEqual([]);
    expect(both.definition?.requirements).toEqual({
      services: { education: 40 },
      buildings: ['vanilla:school'],
    });

    const onlyServices = validateDefinition(
      { ...base, requirements: { services: { police: 10 } } },
      'testmod',
    );
    expect(onlyServices.definition?.requirements).toEqual({
      services: { police: 10 },
      buildings: [],
    });
  });

  it('bez sekce je definice bez podmínek', () => {
    expect(validateDefinition(base, 'testmod').definition?.requirements).toBeUndefined();
  });

  it('odmítne překlep, ne aby budova tiše nikdy nevyrostla', () => {
    const bad = validateDefinition(
      { ...base, requirements: { services: { education: 999 }, buildings: ['skola'] } },
      'testmod',
    );

    expect(bad.definition).toBeNull();
    expect(bad.issues.map((i) => i.field)).toEqual([
      'requirements.services.education',
      'requirements.buildings[0]',
    ]);
  });
});

describe('vyhodnocení podmínek', () => {
  const gated = definition('gated', {
    requirements: { services: { education: 40 }, buildings: ['test:school'] },
  });
  const school = definition('school', { category: 'utility', population: undefined });
  const catalogue = catalogueOf(gated, school);

  it('bez pokrytí neprojde, s pokrytím ano', () => {
    const world = zonedWorld();
    placeBuilding(world, school, 6, 9);

    const low = checkRequirements(world, catalogue, gated, 6, 6, presentDefinitions(world));
    expect(low.ok).toBe(false);
    expect(low.ok === false && low.reason).toBe('error.requiresService');

    withCoverage(world, 'education', 40);
    expect(checkRequirements(world, catalogue, gated, 6, 6, presentDefinitions(world)).ok).toBe(true);
  });

  it('chybějící budova ve městě podmínku neprojde', () => {
    const world = withCoverage(zonedWorld(), 'education', 255);

    const without = checkRequirements(world, catalogue, gated, 6, 6, presentDefinitions(world));
    expect(without.ok).toBe(false);
    // Hláška nese **jméno** budovy, ne id — parametr, který je sám klíčem,
    // si přeloží `I18n.t`. Hráči je „vanilla:school" k ničemu.
    expect(without.ok === false && without.params).toEqual({ id: school.name });

    placeBuilding(world, school, 6, 9);
    expect(checkRequirements(world, catalogue, gated, 6, 6, presentDefinitions(world)).ok).toBe(true);
  });

  it('ruina se za postavenou budovu nepočítá', () => {
    const world = withCoverage(zonedWorld(), 'education', 255);
    const ruin = placeBuilding(world, school, 6, 9);
    ruin.abandoned = true;

    expect(checkRequirements(world, catalogue, gated, 6, 6, presentDefinitions(world)).ok).toBe(false);
  });

  it('pokrytí se čte v buňce budovy, ne celoměstsky', () => {
    const world = zonedWorld();
    placeBuilding(world, school, 6, 9);
    const coverage = new Uint8Array(COARSE_CELLS);
    coverage[coarseIndex(6, 6)] = 40;
    world.coverage.set('education', coverage);

    expect(checkRequirements(world, catalogue, gated, 6, 6, presentDefinitions(world)).ok).toBe(true);
    expect(checkRequirements(world, catalogue, gated, 60, 60, presentDefinitions(world)).ok).toBe(false);
  });
});

describe('podmínky platí pro růst, povýšení i ruční stavbu', () => {
  const gated = definition('gated', { requirements: { services: {}, buildings: ['test:school'] } });
  const school = definition('school', { category: 'utility', population: undefined });

  it('růst nepostaví budovu, jejíž podmínka není splněná', () => {
    const world = zonedWorld();
    const growth = createGrowthSystem(catalogueOf(gated), VANILLA_BALANCE);
    for (let tick = 0; tick < 200; tick++) tickWorld(world, [growth]);
    expect(world.buildings.size).toBe(0);

    placeBuilding(world, school, 5, 12);
    for (let tick = 0; tick < 200; tick++) tickWorld(world, [growth]);
    expect(world.buildings.size).toBeGreaterThan(1);
  });

  it('povýšení kontroluje podmínky kandidáta, ne současné budovy', () => {
    const small = definition('small');
    const wide = definition('wide', {
      footprint: [2, 1],
      population: { capacity: 20 },
      requirements: { services: { education: 40 }, buildings: [] },
    });

    const world = zonedWorld();
    const building = placeBuilding(world, small, 6, 6);

    expect(tryUpgrade(world, catalogueOf(small, wide), building)).toBe(false);

    withCoverage(world, 'education', 40);
    expect(tryUpgrade(world, catalogueOf(small, wide), building)).toBe(true);
    expect(building.definitionId).toBe(wide.id);
  });

  it('ruční stavba řekne, co chybí', () => {
    const world = zonedWorld();
    const catalogue = catalogueOf(gated, school);

    const rejected = placeDefinition(world, catalogue, gated.id, 6, 6);
    expect(rejected.ok).toBe(false);
    expect(rejected.ok === false && rejected.reason).toBe('error.requiresBuilding');
    // Odmítnutá stavba nesmí stát peníze.
    expect(world.economy.funds).toBe(createWorld(1).economy.funds);

    placeDefinition(world, catalogue, school.id, 6, 9);
    expect(placeDefinition(world, catalogue, gated.id, 6, 6).ok).toBe(true);
  });
});

describe('vanilla obsah', () => {
  it('jediná podmíněná budova je zastávka MHD, a čeká na vozovnu (§6 fáze 3)', async () => {
    // Mechanismus vznikl v T19 a rok ležel ladem; MHD je jeho první ostré
    // použití. Kdyby podmínku dostalo něco dalšího, ať je to vidět tady.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const gated = content
      .getAll('building')
      .filter((building) => {
        const requirements = building.requirements;
        return (
          (requirements?.buildings.length ?? 0) +
            Object.keys(requirements?.services ?? {}).length >
          0
        );
      })
      .map((building) => building.id);

    expect(gated).toEqual(['vanilla:transit_stop']);
    expect(content.get('vanilla:transit_stop')?.requirements?.buildings).toEqual([
      'vanilla:transit_depot',
    ]);
  });
});
