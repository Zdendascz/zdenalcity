import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, placeDefinition } from '@/sim/commands';
import { spikeCrime, suppressService } from '@/sim/disasters/effects';
import { floodTile } from '@/sim/disasters/flood';
import { clearRubble, isRubbleMarkOrigin, spawnRubble } from '@/sim/disasters/rubble';
import { destroyTile, noLosses } from '@/sim/disasters/damage';
import { issueBond, takeLoan } from '@/sim/finance';
import { index, ROAD } from '@/sim/layers';
import { createLine } from '@/sim/transit';
import { applySaveToWorld, unpackSave } from '@/save/deserialize';
import { CURRENT_FORMAT_VERSION, SAVE_DISASTER_LAYER_ORDER, SaveFormatError } from '@/save/format';
import { migrate } from '@/save/migrations';
import { serializeSave, toSaveData } from '@/save/serialize';
import { createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { MAP_SIZE } from './support/grid';

/**
 * Save verze 6 (T59).
 *
 * **Ukládá se i probíhající pohroma** (rozhodnutí autora) — jinak by si hráč
 * uložil, nechal město shořet a načetl zpátky. Odvozené se naopak neukládá:
 * počet hořících dlaždic, mapa kolejí ani statistiky linek. Ty se dopočítají,
 * protože jinak by stačil jeden ručně upravený save k tomu, aby si hra myslela,
 * že hoří něco, co nehoří.
 */

const OPTIONS = {
  cityName: 'Testov',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
  playtimeSeconds: 60,
  sources: [{ id: 'vanilla', version: '0.1.0' }],
};

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Uloží a hned načte do čerstvého světa. */
function roundTrip(world: WorldState): WorldState {
  const bytes = serializeSave(world, OPTIONS);
  const restored = createWorld(1);
  applySaveToWorld(restored, migrate(unpackSave(bytes)));
  return restored;
}

/** Město s ulicí, elektrárnou a pár budovami. */
async function city(): Promise<{ world: WorldState; content: ContentRegistry }> {
  const content = await vanilla();
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 2_000_000;
  world.economy.lastIncome = 20000;

  for (let x = 10; x < 40; x++) buildRoad(world, x, 20, ROAD.street, balance);
  expect(placeDefinition(world, content, 'vanilla:coal_power_plant', 34, 21, balance).ok).toBe(true);
  expect(placeDefinition(world, content, 'vanilla:transit_depot', 10, 21, balance).ok).toBe(true);
  return { world, content };
}

describe('vrstvy katastrof', () => {
  it('oheň, povodeň i trosky přežijí uložení a načtení', async () => {
    // Akceptační kritérium 21: probíhající požár se uloží a po načtení hoří dál.
    const { world, content } = await city();
    const balance = content.getBalance();

    const burning = index(15, 20, MAP_SIZE);
    world.fuel[burning] = 200;
    world.fire[burning] = 180;
    world.fireFlags[burning] = 1;

    floodTile(world, index(18, 20, MAP_SIZE), 3, 40);
    world.floodDamage[index(18, 20, MAP_SIZE)] = 25;
    spawnRubble(world, index(22, 20, MAP_SIZE));

    const restored = roundTrip(world);

    expect(restored.fire[burning]).toBe(180);
    expect(restored.fuel[burning]).toBe(200);
    expect(restored.fireFlags[burning]).toBe(1);
    expect(restored.flood[index(18, 20, MAP_SIZE)]).toBe(world.flood[index(18, 20, MAP_SIZE)]);
    expect(restored.floodDepth[index(18, 20, MAP_SIZE)]).toBe(3);
    expect(restored.floodDamage[index(18, 20, MAP_SIZE)]).toBe(25);
    expect(restored.rubble[index(22, 20, MAP_SIZE)]).not.toBe(0);
    void balance;
  });

  it('počet hořících dlaždic se dopočítá, nebere se ze savu', async () => {
    // Odvozené se neukládá. Jinak by stačil ručně upravený save k tomu, aby si
    // hra myslela, že hoří něco, co nehoří.
    const { world } = await city();
    // Hoří dvě dlaždice, z toho jedna lesním požárem. Zapisuje se do vrstev
    // přímo: test je o tom, co se dopočítá po načtení, ne o šíření ohně.
    world.fire[index(15, 20, MAP_SIZE)] = 120;
    world.fire[index(16, 20, MAP_SIZE)] = 90;
    world.fireFlags[index(16, 20, MAP_SIZE)] = 1;
    world.disasters.burning = { normal: 999, wildfire: 999 };

    const restored = roundTrip(world);
    expect(restored.disasters.burning.normal).toBe(1);
    expect(restored.disasters.burning.wildfire).toBe(1);
  });

  it('poškozený `disasters.bin` je chyba, ne důvod k dopočtu', async () => {
    // Tichý fallback by z poškozeného savu udělal město, ve kterém náhodně hoří.
    const { world } = await city();
    const save = toSaveData(world, OPTIONS);
    const broken = { ...save, disasters: save.disasters.subarray(0, 10) };

    expect(() => applySaveToWorld(createWorld(1), broken)).toThrow(SaveFormatError);
  });

  it('všech sedm vrstev má v souboru své místo', async () => {
    const { world } = await city();
    const save = toSaveData(world, OPTIONS);
    expect(save.disasters.byteLength).toBe(
      MAP_SIZE * MAP_SIZE * SAVE_DISASTER_LAYER_ORDER.length,
    );
  });
});

describe('běžící katastrofy a postihy', () => {
  it('probíhající pohroma se uloží i s vlastním stavem', async () => {
    const { world } = await city();
    world.disasters.active.push({
      id: 7,
      kind: 'tornado',
      startedAtTick: 120,
      x: 15,
      y: 20,
      // Vlastní stav: save o něm nic neví a je to záměr.
      state: { angle: 1.25, life: 30, age: 4, width: 3 },
      finished: false,
    });
    world.disasters.nextId = 8;

    const restored = roundTrip(world);
    const entry = restored.disasters.active[0];
    expect(entry?.kind).toBe('tornado');
    expect(entry?.startedAtTick).toBe(120);
    expect(entry?.state).toEqual({ angle: 1.25, life: 30, age: 4, width: 3 });
    expect(restored.disasters.nextId).toBe(8);
  });

  it('dočasné postihy přežijí, včetně třídy služby', async () => {
    const { world } = await city();
    suppressService(world, 'fire', { kind: 'radius', x: 20, y: 20, radius: 4 }, 0.4, 50, 3);
    spikeCrime(world, { kind: 'radius', x: 20, y: 20, radius: 4 }, 30, 50, 3);

    const restored = roundTrip(world);
    expect(restored.disasters.modifiers).toHaveLength(2);

    const suppressed = restored.disasters.modifiers.find((m) => m.kind === 'suppressService');
    expect(suppressed?.serviceClass).toBe('fire');
    expect(suppressed?.amount).toBe(0.4);
    expect(suppressed?.source).toBe(3);
    expect(suppressed?.cells.length).toBeGreaterThan(0);
  });

  it('přepínač katastrof, hájení i strop rizika se pamatují', async () => {
    const { world } = await city();
    world.disasters.enabled = false;
    world.disasters.lastOccurrence.set('fire', 300);
    world.disasters.lastOccurrence.set('flood', 90);
    world.disasters.riskCeiling.set('fire', 2.5);

    const restored = roundTrip(world);
    expect(restored.disasters.enabled).toBe(false);
    expect(restored.disasters.lastOccurrence.get('fire')).toBe(300);
    expect(restored.disasters.lastOccurrence.get('flood')).toBe(90);
    expect(restored.disasters.riskCeiling.get('fire')).toBe(2.5);
  });

  it('odpojené elektrárny se pamatují — jinak by po loadu naskočily samy', async () => {
    const { world, content } = await city();
    const plant = [...world.buildings.entries()].find(
      ([, b]) => content.get(b.definitionId)?.power?.production,
    );
    if (!plant) throw new Error('bez elektrárny');
    world.disasters.offlinePlants.add(plant[0]);

    const restored = roundTrip(world);
    expect(restored.disasters.offlinePlants.has(plant[0])).toBe(true);
  });

  it('nakaženost se ukládá řídce a beze zbytku', async () => {
    const { world } = await city();
    world.infection.set(120, 0.75);
    world.infection.set(121, 0.5);

    const restored = roundTrip(world);
    expect(restored.infection.size).toBe(2);
    expect(restored.infection.get(120)).toBe(0.75);
    expect(restored.infection.get(121)).toBe(0.5);
  });
});

describe('linky a závazky', () => {
  it('linka přežije i se zastávkami, vozidly a jízdným', async () => {
    const { world, content } = await city();
    const balance = content.getBalance();
    const stop = (() => {
      const before = new Set(world.buildings.keys());
      expect(placeDefinition(world, content, 'vanilla:transit_stop', 14, 21, balance).ok).toBe(true);
      const id = [...world.buildings.keys()].find((key) => !before.has(key));
      if (id === undefined) throw new Error('zastávka nevznikla');
      return id;
    })();

    const line = createLine(world, 'bus');
    line.stops.push(stop);
    line.vehicles = 4;
    line.fare = 15;

    const restored = roundTrip(world);
    const loaded = restored.lines[0];
    expect(loaded?.mode).toBe('bus');
    expect(loaded?.stops).toEqual([stop]);
    expect(loaded?.vehicles).toBe(4);
    expect(loaded?.fare).toBe(15);
    expect(restored.nextLineId).toBe(world.nextLineId);
  });

  it('odvozený stav linek nepřeteče z předchozího města', async () => {
    // Load je přepis, ne sloučení. Kdyby v mapě kolejí zůstala data minulého
    // města, ubírala by tramvaj kapacitu na ulicích, které v načteném městě
    // vedou úplně jinudy — a hráč by hledal kolony tam, kde nic nejezdí.
    const { world } = await city();
    createLine(world, 'bus');
    const bytes = serializeSave(world, OPTIONS);

    // Svět, ve kterém se už hrálo něco jiného.
    const restored = createWorld(1);
    restored.lineStats.set(99, {
      demand: 500,
      capacity: 500,
      transported: 500,
      income: 500,
      upkeep: 500,
    });
    restored.transitRelief.set(7, 0.9);
    restored.tramTiles.set(11, 0.35);

    applySaveToWorld(restored, migrate(unpackSave(bytes)));

    expect(restored.lineStats.has(99)).toBe(false);
    expect(restored.transitRelief.has(7)).toBe(false);
    expect(restored.tramTiles.has(11)).toBe(false);
  });

  it('statistiky linek se nepřebírají, dopočítají se', async () => {
    // Odvozené do savu nepatří. Koridor se navíc musí označit k přepočtu,
    // jinak by tramvaj po loadu neubírala kapacitu, dokud na ni hráč nesáhne.
    const { world } = await city();
    createLine(world, 'tram');
    world.lineStats.set(1, {
      demand: 999,
      capacity: 999,
      transported: 999,
      income: 999,
      upkeep: 999,
    });
    world.transitRelief.set(10, 1);
    world.tramTiles.set(20, 0.5);

    const restored = roundTrip(world);
    expect(restored.lineStats.size).toBe(0);
    expect(restored.transitRelief.size).toBe(0);
    expect(restored.tramTiles.size).toBe(0);
    expect(restored.transitDirty).toBe(true);
  });

  it('půjčky, dluhopisy, rating i přiznané granty přežijí', async () => {
    const { world, content } = await city();
    const balance = content.getBalance();
    world.happiness.fill(220);

    const loan = takeLoan(world, balance, 50000, 24);
    const bond = issueBond(world, balance, 100000, 9, balance.finance.bonds.minMaturityTicks);
    if (!loan || !bond) throw new Error('závazek nevznikl');

    world.economy.creditRating = 0.62;
    world.bondsBlockedUntil = 4242;
    world.grantsAwarded.add('vanilla:grant_first_thousand');
    world.grantProgress.set('vanilla:grant_content_city', 120);

    const restored = roundTrip(world);

    expect(restored.loans).toHaveLength(1);
    expect(restored.loans[0]?.remaining).toBe(loan.remaining);
    expect(restored.loans[0]?.rate).toBe(loan.rate);
    expect(restored.nextLoanId).toBe(world.nextLoanId);

    expect(restored.bonds).toHaveLength(1);
    expect(restored.bonds[0]?.subscribed).toBe(bond.subscribed);
    expect(restored.bonds[0]?.maturityTick).toBe(bond.maturityTick);
    expect(restored.nextBondId).toBe(world.nextBondId);

    expect(restored.economy.creditRating).toBe(0.62);
    expect(restored.bondsBlockedUntil).toBe(4242);
    expect(restored.grantsAwarded.has('vanilla:grant_first_thousand')).toBe(true);
    expect(restored.grantProgress.get('vanilla:grant_content_city')).toBe(120);
  });

  it('přiznaný grant se po loadu nepřizná znovu', async () => {
    // Bez seznamu v savu by měl hráč nekonečný zdroj peněz: ulož, načti, inkasuj.
    const { world } = await city();
    world.grantsAwarded.add('vanilla:grant_first_thousand');

    const restored = roundTrip(world);
    expect(restored.grantsAwarded.has('vanilla:grant_first_thousand')).toBe(true);
  });
});

describe('bajtová stabilita', () => {
  it('na pořadí vkládání do map nezáleží', async () => {
    // Save musí být bajtově stabilní, jinak se fixtura nedá vygenerovat znovu
    // a porovnat. `Map` si pamatuje pořadí vkládání a to závisí na tom, co se
    // ve městě dělo dřív — proto se klíče před zápisem třídí.
    const a = (await city()).world;
    const b = (await city()).world;

    a.disasters.lastOccurrence.set('fire', 100);
    a.disasters.lastOccurrence.set('flood', 200);
    a.disasters.riskCeiling.set('fire', 1.5);
    a.disasters.riskCeiling.set('gangWar', 2);
    a.grantsAwarded.add('vanilla:grant_university');
    a.grantsAwarded.add('vanilla:grant_first_thousand');

    // Totéž, jen vložené obráceně.
    b.disasters.lastOccurrence.set('flood', 200);
    b.disasters.lastOccurrence.set('fire', 100);
    b.disasters.riskCeiling.set('gangWar', 2);
    b.disasters.riskCeiling.set('fire', 1.5);
    b.grantsAwarded.add('vanilla:grant_first_thousand');
    b.grantsAwarded.add('vanilla:grant_university');

    expect([...serializeSave(a, OPTIONS)]).toEqual([...serializeSave(b, OPTIONS)]);
  });
});

describe('migrace v5 → v6', () => {
  it('starý save se načte: nic nehoří, katastrofy zapnuté, žádné závazky', () => {
    const v5 = fixture('v5.city');
    const migrated = migrate(unpackSave(v5));

    expect(migrated.meta.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(migrated.state.disasters.enabled).toBe(true);
    expect(migrated.state.disasters.active).toEqual([]);
    expect(migrated.state.disasters.lastOccurrence).toEqual({});
    expect(migrated.state.transit.lines).toEqual([]);
    expect(migrated.state.finance.loans).toEqual([]);
    expect(migrated.state.finance.bonds).toEqual([]);
    expect(migrated.state.finance.grantsAwarded).toEqual([]);

    // `disasters.bin` je prázdný, ale správně dlouhý.
    const size = migrated.meta.grid?.size ?? 0;
    expect(migrated.disasters.byteLength).toBe(
      size * size * SAVE_DISASTER_LAYER_ORDER.length,
    );
    expect([...migrated.disasters].every((value) => value === 0)).toBe(true);
  });

  it('starý save se dá načíst do světa a nic v něm nehoří', () => {
    const world = createWorld(1);
    applySaveToWorld(world, migrate(unpackSave(fixture('v5.city'))));

    expect([...world.fire].every((value) => value === 0)).toBe(true);
    expect([...world.rubble].every((value) => value === 0)).toBe(true);
    expect(world.disasters.enabled).toBe(true);
    expect(world.lines).toEqual([]);
    expect(world.loans).toEqual([]);
    expect(world.economy.creditRating).toBe(1);
  });

  it('fixtura v6 nese hořící město, linku i závazky', () => {
    // Fixtura je skutečné odehrané město. Kdyby se formát rozešel s kódem,
    // pozná se to tady, ne až u hráče.
    const world = createWorld(1);
    applySaveToWorld(world, migrate(unpackSave(fixture('v6.city'))));

    expect(world.buildings.size).toBeGreaterThan(10);
    expect([...world.fire].filter((value) => value !== 0).length).toBeGreaterThan(0);
    expect(world.disasters.active.map((entry) => entry.kind)).toContain('fire');
    expect(world.lines).toHaveLength(1);
    expect(world.lines[0]?.vehicles).toBe(3);
    expect(world.loans).toHaveLength(1);
    expect(world.bonds).toHaveLength(1);
  });
});

const fixtures = import.meta.glob('./fixtures/saves/*.base64', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function fixture(name: string): Uint8Array {
  const entry = Object.entries(fixtures).find(([path]) => path.includes(name));
  if (!entry) throw new Error(`chybí fixtura ${name}`);
  const binary = atob((entry[1] as string).trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('paměť trosek (verze 7)', () => {
  it('trosky si pamatují, co na nich stálo, i po načtení', async () => {
    // Nahlásil autor: po vyhořelém městě se nedalo poznat, co kde bylo.
    // Hromada po nemocnici vypadala stejně jako hromada po hasičárně.
    const { world, content } = await city();
    const balance = content.getBalance();
    expect(placeDefinition(world, content, 'vanilla:clinic', 25, 21, balance).ok).toBe(true);

    const tile = index(25, 21, MAP_SIZE);
    destroyTile(world, content, tile, noLosses());
    expect(world.rubbleOf.get(tile)).toBe('vanilla:clinic');

    const restored = roundTrip(world);

    expect(restored.rubble[tile]).not.toBe(0);
    expect(restored.rubbleOf.get(tile)).toBe('vanilla:clinic');
  });

  it('úklid trosek smaže i paměť', async () => {
    // Prázdná parcela se nesmí pořád hlásit jako bývalá klinika.
    const { world, content } = await city();
    const balance = content.getBalance();
    placeDefinition(world, content, 'vanilla:clinic', 25, 21, balance);
    const tile = index(25, 21, MAP_SIZE);
    destroyTile(world, content, tile, noLosses());

    clearRubble(world, tile);

    expect(world.rubbleOf.has(tile)).toBe(false);
    expect(roundTrip(world).rubbleOf.has(tile)).toBe(false);
  });

  it('trosky po silnici jsou bezejmenné', async () => {
    // Hromada po silnici vypadá jako hromada a hráč silnici najde podle
    // sousedů. Ukládat u ní id by byl zbytečný záznam v každém savu.
    const { world } = await city();
    const tile = index(15, 20, MAP_SIZE);
    spawnRubble(world, tile);

    expect(world.rubble[tile]).not.toBe(0);
    expect(world.rubbleOf.has(tile)).toBe(false);
  });

  it('starý save se načte, jen bez paměti', async () => {
    // Migrace nemá co doplnit — ta informace v savu verze 6 nikdy nebyla.
    // Hádat ji podle okolí by znamenalo napsat hráči do města nemocnici,
    // která tam nikdy nestála.
    const { world, content } = await city();
    const balance = content.getBalance();
    placeDefinition(world, content, 'vanilla:clinic', 25, 21, balance);
    const tile = index(25, 21, MAP_SIZE);
    destroyTile(world, content, tile, noLosses());

    const save = unpackSave(serializeSave(world, OPTIONS));
    // Verze 6 klíč `rubbleOf` neměla vůbec, takže se doopravdy odstraní —
    // `undefined` by byl jiný stav než „chybí" a test by neověřil to, co má.
    const disastersV6: Record<string, unknown> = { ...save.state.disasters };
    delete disastersV6['rubbleOf'];
    const asV6 = {
      ...save,
      meta: { ...save.meta, formatVersion: 6 },
      state: { ...save.state, disasters: disastersV6 },
    } as unknown as typeof save;

    const restored = createWorld(1);
    applySaveToWorld(restored, migrate(asV6));

    expect(restored.rubble[tile]).not.toBe(0);
    expect(restored.rubbleOf.size).toBe(0);
  });
});

describe('značka na troskách', () => {
  const SIZE = MAP_SIZE;
  const at = (x: number, y: number): number => index(x, y, SIZE);

  it('velká budova dostane jednu značku, ne devět', async () => {
    // Devět křížků po nemocnici by udělalo mřížku, ze které se nepozná,
    // jestli padla jedna velká budova nebo devět malých.
    const { world, content } = await city();
    const balance = content.getBalance();
    placeDefinition(world, content, 'vanilla:hospital', 25, 21, balance);
    destroyTile(world, content, at(25, 21), noLosses());

    const marks = [...world.rubbleOf.keys()].filter((tile) =>
      isRubbleMarkOrigin(world.rubbleOf, tile, SIZE),
    );

    expect(world.rubbleOf.size).toBeGreaterThan(1);
    expect(marks).toEqual([at(25, 21)]);
  });

  it('dvě různé budovy vedle sebe mají značku každá', async () => {
    // Kdyby se blok poznával jen podle „jsou tu trosky", splynuly by dvě
    // sousední budovy v jednu a hráč by přišel o půlku informace.
    const rubbleOf = new Map<number, string>([
      [at(10, 10), 'vanilla:clinic'],
      [at(11, 10), 'vanilla:fire_station'],
    ]);

    expect(isRubbleMarkOrigin(rubbleOf, at(10, 10), SIZE)).toBe(true);
    expect(isRubbleMarkOrigin(rubbleOf, at(11, 10), SIZE)).toBe(true);
  });

  it('bezejmenné trosky značku nemají', async () => {
    expect(isRubbleMarkOrigin(new Map<number, string>(), at(10, 10), SIZE)).toBe(false);
  });

  it('prázdná dlaždice obklopená troskami značku nedostane', async () => {
    // Ošemetný případ: sousedé nesou id, tahle dlaždice ne. Bez kontroly „mám
    // vůbec co značit" by porovnání `undefined !== 'clinic'` vyšlo jako
    // „jsem roh" a hráč by dostal křížek na prázdné parcele.
    const rubbleOf = new Map<number, string>([
      [at(10, 11), 'vanilla:clinic'],
      [at(11, 10), 'vanilla:clinic'],
    ]);

    expect(isRubbleMarkOrigin(rubbleOf, at(11, 11), SIZE)).toBe(false);
  });

  it('u levého okraje mapy se nekouká za hranu', async () => {
    // Dlaždice ve sloupci 0 nemá souseda vlevo. Bez té stráže by se sáhlo na
    // poslední sloupec předchozího řádku, což je úplně jiné místo mapy.
    const rubbleOf = new Map<number, string>([
      [at(SIZE - 1, 4), 'vanilla:clinic'],
      [at(0, 5), 'vanilla:clinic'],
    ]);

    expect(isRubbleMarkOrigin(rubbleOf, at(0, 5), SIZE)).toBe(true);
  });
});
