import { describe, expect, it } from 'vitest';
import { buildSprites, createVanillaSource } from '@/content/loader';
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
      'vanilla:city_park',
      'vanilla:clinic',
      'vanilla:coal_power_plant',
      'vanilla:commercial_arcade',
      'vanilla:commercial_centre',
      'vanilla:commercial_downtown',
      'vanilla:commercial_gallery',
      'vanilla:commercial_highrise',
      'vanilla:commercial_large',
      'vanilla:commercial_mall',
      'vanilla:commercial_medium',
      'vanilla:commercial_offices',
      'vanilla:commercial_plaza',
      'vanilla:commercial_row',
      'vanilla:commercial_small',
      'vanilla:commercial_tower',
      'vanilla:community_centre',
      'vanilla:fire_station',
      'vanilla:fire_station_large',
      'vanilla:gallery',
      'vanilla:gas_power_plant',
      'vanilla:high_school',
      'vanilla:hospital',
      'vanilla:incinerator',
      'vanilla:industrial_chemical',
      'vanilla:industrial_complex',
      'vanilla:industrial_foundry',
      'vanilla:industrial_hall',
      'vanilla:industrial_large',
      'vanilla:industrial_medium',
      'vanilla:industrial_park',
      'vanilla:industrial_refinery',
      'vanilla:industrial_row',
      'vanilla:industrial_small',
      'vanilla:industrial_smelter',
      'vanilla:industrial_works',
      'vanilla:industrial_yard',
      'vanilla:landfill',
      'vanilla:metro_station',
      'vanilla:museum',
      'vanilla:nuclear_power_plant',
      'vanilla:park_large',
      'vanilla:park_small',
      'vanilla:plaza',
      'vanilla:police_large',
      'vanilla:police_small',
      'vanilla:prison',
      'vanilla:pump_station',
      'vanilla:residential_court',
      'vanilla:residential_estate',
      'vanilla:residential_highrise',
      'vanilla:residential_large',
      'vanilla:residential_medium',
      'vanilla:residential_quarter',
      'vanilla:residential_row',
      'vanilla:residential_skyline',
      'vanilla:residential_small',
      'vanilla:residential_spire',
      'vanilla:residential_terrace',
      'vanilla:residential_terraces',
      'vanilla:residential_tower',
      'vanilla:retirement_home',
      'vanilla:school',
      'vanilla:substation',
      'vanilla:theatre',
      'vanilla:tram_stop',
      'vanilla:transformer',
      'vanilla:transit_depot',
      'vanilla:transit_stop',
      'vanilla:university',
      'vanilla:water_treatment',
      'vanilla:water_works',
      'vanilla:wind_turbine',
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
    // Přesná výroba ani půdorys se **nepřibíjejí**. Test se jmenuje podle
    // toho, co tvrdí, a to je „vyrábí a smí stát na souši" — konkrétní čísla
    // jsou ladění a to se hýbe. Přibité by z toho udělalo změnodetektor,
    // který spadne pokaždé, když někdo elektrárnu přeladí.
    const registry = new ContentRegistry();
    await registry.load(createVanillaSource());

    const plant = registry.get('vanilla:coal_power_plant');
    expect(plant?.power?.production ?? 0).toBeGreaterThan(0);
    expect(plant?.power?.consumption).toBeUndefined();
    expect(plant?.construction.allowedTerrain).toEqual([0, 2]);
  });

  it('každá elektrárna vyrábí a žádná proud nebere (trafa nevyrábí, jen přepojují)', async () => {
    // Elektrárna, které by proud omylem ubýval, by síť shodila sama sebou.
    const registry = new ContentRegistry();
    await registry.load(createVanillaSource());

    const plants = registry
      .getAll('building')
      .filter((definition) => definition.menu === 'power' && definition.power?.transformer === undefined);

    expect(plants.length).toBeGreaterThan(1);
    for (const plant of plants) {
      expect(plant.power?.production ?? 0, plant.id).toBeGreaterThan(0);
      expect(plant.power?.consumption, plant.id).toBeUndefined();
    }
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

/**
 * Obrázky budov (T70).
 *
 * Jdou touž cestou jako ikony — přes `ContentSource`, ne přímým sáhnutím
 * rendereru do `content/` — aby je mod směl přidat i přepsat (P5). Testuje se
 * to, co jde rozbít potichu: chybějící obrázek nesmí hru zastavit a pořadí
 * variant nesmí záviset na tom, v jakém pořadí je vrátil glob (P2).
 */
describe('obrázky budov', () => {
  const sprite = (url: string) => ({
    url,
    width: 768,
    height: 448,
    anchor: [384, 448] as const,
    scale: 4,
  });

  it('registr je vydá podle budovy a varianty', async () => {
    const registry = new ContentRegistry();
    await registry.load(source({ sprites: { 'test:thing|a': sprite('/a.png') } }));

    expect(registry.getSprite('test:thing', 'a')?.url).toBe('/a.png');
  });

  it('budova bez obrázku vrátí undefined, ne výjimku', async () => {
    // Renderer si pak nakreslí kvádr jako dřív. Chybějící obrázek je vzhled,
    // ne podmínka běhu — mod, který žádný nedodá, nesmí hru zastavit.
    const registry = new ContentRegistry();
    await registry.load(source());

    expect(registry.getSprite('test:thing', 'a')).toBeUndefined();
    expect(registry.getSpriteVariants('test:thing')).toEqual([]);
  });

  it('varianty přijdou seřazené', async () => {
    // Losovat se z nich bude přes `world.rng`. Kdyby pořadí záviselo na tom,
    // jak glob vrátil soubory, dva běhy téhož seedu by daly jiné město (P2).
    const registry = new ContentRegistry();
    await registry.load(
      source({
        sprites: {
          'test:thing|c': sprite('/c.png'),
          'test:thing|a': sprite('/a.png'),
          'test:thing|b': sprite('/b.png'),
        },
      }),
    );

    expect(registry.getSpriteVariants('test:thing')).toEqual(['a', 'b', 'c']);
  });

  it('pozdější zdroj smí obrázek přepsat i přidat variantu', async () => {
    const registry = new ContentRegistry();
    await registry.load(source({ sprites: { 'test:thing|a': sprite('/vanilla.png') } }));
    await registry.load({
      label: 'mod',
      manifest: { ...MANIFEST, id: 'mod', name: 'Mod' },
      definitions: [],
      locales: {},
      sprites: { 'test:thing|a': sprite('/mod.png'), 'test:thing|b': sprite('/novy.png') },
    });

    expect(registry.getSprite('test:thing', 'a')?.url).toBe('/mod.png');
    expect(registry.getSpriteVariants('test:thing')).toEqual(['a', 'b']);
  });

  it('varianty jedné budovy nepřetečou do jiné', async () => {
    // Klíč je `id|varianta` a hledá se podle předpony. Kdyby se předpona
    // nekončila svislítkem, `test:thing` by si přivlastnilo i `test:thing2`.
    const registry = new ContentRegistry();
    await registry.load(
      source({
        sprites: {
          'test:thing|a': sprite('/a.png'),
          'test:thing2|a': sprite('/jina.png'),
        },
      }),
    );

    expect(registry.getSpriteVariants('test:thing')).toEqual(['a']);
    expect(registry.getSprite('test:thing', 'a')?.url).toBe('/a.png');
  });
});

/**
 * Párování manifestu spritů se soubory.
 *
 * `sprites/index.json` vyrábí `tools/fit-sprites.py` ze složky, takže se
 * rozejít může jen tak, že někdo obrázek smaže a skript nepustí. To nemá být
 * důvod, proč hra nenaběhne — vadný záznam se zahodí a budova dostane kvádr.
 */
describe('manifest spritů', () => {
  const zaznam = (over: Record<string, unknown> = {}) => ({
    building: 'test:thing',
    variant: 'a',
    file: 'thing__a.png',
    width: 768,
    height: 448,
    anchor: [384, 448],
    ...over,
  });

  it('spáruje záznam s obrázkem', () => {
    const out = buildSprites({ scale: 4, sprites: [zaznam()] }, { thing__a: '/url.png' });

    expect(out['test:thing|a']).toEqual({
      url: '/url.png',
      width: 768,
      height: 448,
      anchor: [384, 448],
      scale: 4,
    });
  });

  it('záznam bez obrázku zahodí', () => {
    // Jinak by budova dostala sprite s `url: undefined` a renderer by se ho
    // pokusil stáhnout. Kvádr je lepší než rozbitý obrázek.
    expect(buildSprites({ scale: 4, sprites: [zaznam()] }, {})).toEqual({});
  });

  it('zahodí i záznam bez rozměrů nebo bez kotvy', () => {
    // Rozměry nesou kotvu, dokud se textura nestáhne. Bez nich by budova
    // skočila do rohu obrazovky, jakmile se obrázek načte.
    const urls = { thing__a: '/url.png' };
    expect(buildSprites({ scale: 4, sprites: [zaznam({ width: undefined })] }, urls)).toEqual({});
    expect(buildSprites({ scale: 4, sprites: [zaznam({ anchor: [1] })] }, urls)).toEqual({});
  });

  it('nesmyslný manifest vrátí prázdno, ne výjimku', () => {
    expect(buildSprites(null, {})).toEqual({});
    expect(buildSprites({ scale: 0, sprites: [] }, {})).toEqual({});
    expect(buildSprites({ scale: 4, sprites: 'ne' }, {})).toEqual({});
  });
});

/**
 * Rejstřík spritů proti geometrii půdorysu.
 *
 * Obrázek se na dlaždici sází za **spodní vrchol podstavy**, a ten leží
 * v `w / (w + d)` šířky: diamant sahá `32·d` doleva a `32·w` doprava od zadního
 * rohu. U čtvercového půdorysu je to půlka, u 2 × 1 dvě třetiny.
 *
 * `fit-sprites.py` kotvu **měří**, protože generátor kreslí podstavu často
 * zkosenou. Když měření selhalo, bral se do T72 střed obrázku — a ten je
 * u nečtvercového půdorysu špatně. Šestnáct spritů kvůli tomu sedělo vedle,
 * `commercial_row__b` o 143 px, tedy víc než půl dlaždice, a lezly do sousedů.
 * Autor to nahlásil jako „špatné překrytí" a „spíš je vybrán špatný typ budovy".
 */
describe('sprity sedí na svém půdorysu', () => {
  /** Kolik smí kotva utéct od geometrie. Stejná mez jako ve `fit-sprites.py`. */
  const TOLERANCE = 0.06;

  it('šířka odpovídá půdorysu a kotva leží tam, kam vrchol podstavy patří', async () => {
    const registry = new ContentRegistry();
    await registry.load(createVanillaSource());

    const problems: string[] = [];
    for (const definition of registry.getAll('building')) {
      const [w, d] = definition.footprint;
      for (const variant of registry.getSpriteVariants(definition.id)) {
        const sprite = registry.getSprite(definition.id, variant);
        if (!sprite) continue;

        /*
         * Podstava je široká `(w + d)` půldlaždic; `scale` je nadvzorkování.
         *
         * Do T113 se čekala **rovnost**. Jenže generátor kreslí zem, jakou
         * uzná, ne jakou si objednáme: `industrial_yard` má u všech tří
         * variant podstavu skoro čtvercovou, přestože parcela je 2 × 1. Šířka
         * pak seděla, ale zem přetekla o půl dlaždice dozadu a hala lezla
         * sousedovi na střechu — autor to hlásil jako „úplně ujeté budovy".
         * `fit-sprites.py` takový obrázek zmenší, aby se podstava do parcely
         * vešla, takže je **užší** než parcela. Přerůst ji nesmí nikdy.
         */
        const expectedWidth = (w + d) * 32 * sprite.scale;
        if (sprite.width > expectedWidth) {
          problems.push(
            `${definition.id}|${variant}: šířka ${sprite.width} přerůstá parcelu (${expectedWidth})`,
          );
        }
        // A zmenšit se smí jen potud, aby budova na parcele nebyla ztracená.
        if (sprite.width < expectedWidth * 0.45) {
          problems.push(
            `${definition.id}|${variant}: šířka ${sprite.width} je proti parcele (${expectedWidth}) drobek`,
          );
        }

        const expectedX = (sprite.width * w) / (w + d);
        if (Math.abs(sprite.anchor[0] - expectedX) > sprite.width * TOLERANCE) {
          problems.push(
            `${definition.id}|${variant}: kotva x ${sprite.anchor[0]}, čekám kolem ${Math.round(expectedX)}`,
          );
        }
        // Svisle sedí budova spodní hranou obrázku — tam je vrchol podstavy.
        if (sprite.anchor[1] !== sprite.height) {
          problems.push(`${definition.id}|${variant}: kotva y ${sprite.anchor[1]} není spodní hrana`);
        }
      }
    }

    expect(problems, problems.join('\n')).toEqual([]);
  });
});
