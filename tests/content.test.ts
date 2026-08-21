import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry, ContentValidationError } from '@/content/registry';
import type { ContentSource } from '@/content/registry';
import { validateDefinition } from '@/content/schema';

const MANIFEST = {
  id: 'testmod',
  name: 'Test Mod',
  version: '1.0.0',
  gameVersion: '>=0.1.0',
  dependencies: [],
};

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'testmod:thing',
    type: 'building',
    category: 'residential',
    name: 'building.thing.name',
    description: 'building.thing.desc',
    footprint: [1, 1],
    construction: { cost: 100, requiresRoad: true, requiresPower: true, allowedTerrain: [0] },
    economy: { upkeep: 10 },
    graphics: { color: '#8fb4dd', heightLevels: 1 },
    ...overrides,
  };
}

function source(overrides: Partial<ContentSource> = {}): ContentSource {
  return {
    label: 'test',
    manifest: MANIFEST,
    definitions: [{ path: 'buildings/thing.json', data: definition() }],
    locales: {
      en: { 'building.thing.name': 'Thing', 'building.thing.desc': 'A thing.' },
    },
    ...overrides,
  };
}

async function loadExpectingError(src: ContentSource): Promise<ContentValidationError> {
  try {
    await new ContentRegistry().load(src);
  } catch (error) {
    if (error instanceof ContentValidationError) return error;
    throw error;
  }
  throw new Error('Načtení mělo selhat, ale prošlo.');
}

describe('vanilla obsah', () => {
  it('projde schématem a zaregistruje všechny budovy', async () => {
    const registry = new ContentRegistry();
    await registry.load(createVanillaSource());

    const buildings = registry.getAll('building');
    expect(buildings.map((b) => b.id).sort()).toEqual([
      'vanilla:cinema',
      'vanilla:clinic',
      'vanilla:coal_power_plant',
      'vanilla:commercial_arcade',
      'vanilla:commercial_centre',
      'vanilla:commercial_large',
      'vanilla:commercial_medium',
      'vanilla:commercial_row',
      'vanilla:commercial_small',
      'vanilla:commercial_tower',
      'vanilla:community_centre',
      'vanilla:fire_station',
      'vanilla:gallery',
      'vanilla:incinerator',
      'vanilla:industrial_chemical',
      'vanilla:industrial_large',
      'vanilla:industrial_medium',
      'vanilla:industrial_row',
      'vanilla:industrial_small',
      'vanilla:industrial_works',
      'vanilla:industrial_yard',
      'vanilla:landfill',
      'vanilla:museum',
      'vanilla:park_small',
      'vanilla:police_small',
      'vanilla:pump_station',
      'vanilla:residential_court',
      'vanilla:residential_large',
      'vanilla:residential_medium',
      'vanilla:residential_row',
      'vanilla:residential_small',
      'vanilla:residential_terrace',
      'vanilla:residential_tower',
      'vanilla:retirement_home',
      'vanilla:school',
      'vanilla:theatre',
      'vanilla:transit_depot',
      'vanilla:transit_stop',
      'vanilla:water_treatment',
      'vanilla:water_works',
    ]);
  });

  it('hlásí načtený zdroj i s verzí (jde do meta.json savu)', async () => {
    const registry = new ContentRegistry();
    await registry.load(createVanillaSource());

    expect(registry.getLoadedSources()).toEqual([
      { id: 'vanilla', name: 'Base Game', version: '0.1.0' },
    ]);
  });

  it('elektrárna má vyrábět proud a stát na trávě nebo písku', async () => {
    const registry = new ContentRegistry();
    await registry.load(createVanillaSource());

    const plant = registry.get('vanilla:coal_power_plant');
    expect(plant?.power?.production).toBe(6000);
    expect(plant?.construction.allowedTerrain).toEqual([0, 2]);
    expect(plant?.footprint).toEqual([4, 4]);
  });

  it('žádná definice nemá text natvrdo — name i description jsou klíče', async () => {
    const registry = new ContentRegistry();
    await registry.load(createVanillaSource());

    for (const building of registry.getAll('building')) {
      expect(building.name, building.id).toMatch(/^building\.[a-z0-9_]+\.name$/);
      expect(building.description, building.id).toMatch(/^building\.[a-z0-9_]+\.desc$/);
    }
  });
});

describe('registr', () => {
  it('neznámé id vrací undefined a neznámý typ prázdné pole', async () => {
    const registry = new ContentRegistry();
    await registry.load(source());

    expect(registry.get('testmod:nic')).toBeUndefined();
    expect(registry.getAll('vehicle')).toEqual([]);
  });

  it('odmítne druhé načtení téhož zdroje', async () => {
    const registry = new ContentRegistry();
    await registry.load(source());
    await expect(registry.load(source())).rejects.toThrow(/už je načtený/);
  });

  it('při chybě nezaregistruje nic, ani validní sourozence', async () => {
    const registry = new ContentRegistry();
    const broken = source({
      definitions: [
        { path: 'buildings/ok.json', data: definition({ id: 'testmod:ok' }) },
        { path: 'buildings/bad.json', data: definition({ footprint: [0, 1] }) },
      ],
    });

    await expect(registry.load(broken)).rejects.toThrow(ContentValidationError);
    expect(registry.getAll('building')).toEqual([]);
    expect(registry.getLoadedSources()).toEqual([]);
  });
});

describe('validace', () => {
  it('chyba pojmenuje zdroj, soubor i konkrétní pole', async () => {
    const error = await loadExpectingError(
      source({ definitions: [{ path: 'buildings/bad.json', data: definition({ economy: {} }) }] }),
    );

    expect(error.message).toContain('test');
    expect(error.problems).toContain(
      'buildings/bad.json: economy.upkeep — musí být celé číslo v rozsahu 0–9007199254740991',
    );
  });

  it('sbírá všechny chyby najednou, ne jen první', async () => {
    const error = await loadExpectingError(
      source({
        definitions: [
          {
            path: 'buildings/bad.json',
            data: definition({ economy: {}, graphics: { color: 'modrá', heightLevels: 0 } }),
          },
        ],
      }),
    );

    expect(error.problems.length).toBeGreaterThanOrEqual(3);
  });

  it('odmítne definici, která nepatří namespace svého zdroje (P6)', () => {
    const { definition: parsed, issues } = validateDefinition(
      definition({ id: 'jinymod:thing' }),
      'testmod',
    );

    expect(parsed).toBeNull();
    expect(issues).toContainEqual({
      field: 'id',
      message: 'musí začínat namespace zdroje "testmod:"',
    });
  });

  it('odmítne číselné ani bezjmenné id (P6)', () => {
    expect(validateDefinition(definition({ id: 42 }), 'testmod').definition).toBeNull();
    expect(validateDefinition(definition({ id: 'thing' }), 'testmod').definition).toBeNull();
  });

  it('odmítne neznámou sekci, protože to bývá překlep', () => {
    const { issues } = validateDefinition(definition({ construcion: {} }), 'testmod');
    expect(issues).toContainEqual({ field: 'construcion', message: 'neznámá sekce — překlep?' });
  });

  it('odmítne terén, který ve vrstvě neexistuje', () => {
    const { issues } = validateDefinition(
      definition({
        construction: { cost: 1, requiresRoad: true, requiresPower: true, allowedTerrain: [9] },
      }),
      'testmod',
    );
    expect(issues).toContainEqual({
      field: 'construction.allowedTerrain[0]',
      message: 'není platná hodnota vrstvy terrain',
    });
  });

  it('odmítne duplicitní id uvnitř jednoho zdroje', async () => {
    const error = await loadExpectingError(
      source({
        definitions: [
          { path: 'buildings/a.json', data: definition() },
          { path: 'buildings/b.json', data: definition() },
        ],
      }),
    );
    expect(error.problems.join('\n')).toContain('je už definované');
  });

  it('odmítne lokalizační klíč, ke kterému neexistuje překlad', async () => {
    const error = await loadExpectingError(source({ locales: {} }));
    expect(error.problems.join('\n')).toContain('nemá překlad v žádném jazyce');
  });

  it('stačí překlad v jednom jazyce — chybějící čeština je věc fallbacku (§10)', async () => {
    const registry = new ContentRegistry();
    await registry.load(
      source({
        locales: {
          cs: { 'building.thing.name': 'Věc', 'building.thing.desc': 'Nějaká věc.' },
        },
      }),
    );
    expect(registry.get('testmod:thing')).toBeDefined();
  });

  it('odmítne rozbitý manifest a nesahá přitom na definice', async () => {
    const error = await loadExpectingError(source({ manifest: { ...MANIFEST, version: '1.0' } }));
    expect(error.problems.join('\n')).toContain('manifest.json: version');
  });
});
