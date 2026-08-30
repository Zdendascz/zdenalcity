import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { validateBalance } from '@/content/balance';
import type { Balance } from '@/content/balance';
import { buildPipe, buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import {
  createExplosionDisaster,
  createIndustrialAccidentDisaster,
} from '@/sim/disasters/blast';
import {
  contentKindAt,
  destroyTile,
  downgradeTile,
  noLosses,
  rollDamage,
} from '@/sim/disasters/damage';
import { createEarthquakeDisaster } from '@/sim/disasters/earthquake';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { hasRubble } from '@/sim/disasters/rubble';
import { tilesOf } from '@/sim/disasters/shapes';
import { startDisaster } from '@/sim/disasters/scheduler';
import { axisFalloff, createTornadoDisaster, strengthAt } from '@/sim/disasters/tornado';
import { COARSE_FACTOR, coarseSizeOf } from '@/sim/coarse';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { Rng } from '@/sim/rng';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

/**
 * Ničivé katastrofy (T51): tornádo, zemětřesení, výbuch, průmyslová havárie.
 *
 * Čtyři různé mechaniky, jeden společný způsob, jak se ničí — podle **obsahu
 * dlaždice**. Kdyby si každá zjišťovala obsah po svém, lišily by se v tom,
 * jestli je opuštěný dům pořád obytný a odkud se počítá vysoká zástavba, a
 * hráč by z toho měl čtyři různá pravidla místo jednoho.
 *
 * Testuje se hlavně to, co dělá z každé z nich vlastní zážitek: tornádo se
 * pohybuje a přichází zvenčí, zemětřesení zasáhne celé město a umí jen
 * nalomit, výbuch zapaluje dál, než boří, a havárie navíc kontaminuje.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Vyrostlé městečko: ulice, obytná a průmyslová zóna. */
function growCity(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 1000000;

  for (let x = 10; x < 40; x++) buildRoad(world, x, 20, ROAD.street, balance);
  zoneArea(world, 10, 17, 30, 3, ZONE.residential);
  zoneArea(world, 10, 21, 30, 3, ZONE.industrial);
  world.waterSupply.fill(1);

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 500; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
  return world;
}

describe('obsah dlaždice', () => {
  it('rozlišuje nízkou a vysokou zástavbu', async () => {
    // Panelák snese tornádo i otřes líp než chalupa. Je to jediné místo ve
    // hře, kde se hustota vyplácí jinak než ekonomicky.
    const content = await vanilla();
    const world = growCity(content);
    const building = [...world.buildings.values()].find((b) => b.population > 0);
    if (!building) throw new Error('nic nevyrostlo');

    const tile = index(building.x, building.y, MAP_SIZE);
    building.level = 1;
    const low = contentKindAt(world, content, VANILLA_BALANCE, tile);
    building.level = 4;
    const high = contentKindAt(world, content, VANILLA_BALANCE, tile);

    expect(low).toBe('residentialLow');
    expect(high).toBe('residentialHigh');
  });

  it('opuštěná budova není obytná ani průmyslová', async () => {
    const content = await vanilla();
    const world = growCity(content);
    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');

    const tile = index(building.x, building.y, MAP_SIZE);
    building.abandoned = true;
    expect(contentKindAt(world, content, VANILLA_BALANCE, tile)).toBe('abandoned');
  });

  it('silnice, potrubí, les i prázdno mají vlastní druh', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.economy.funds = 100000;

    buildRoad(world, 10, 10, ROAD.street, content.getBalance());
    buildPipe(world, 11, 10, content.getBalance());
    world.layers.terrain[index(12, 10, MAP_SIZE)] = TERRAIN.forest;

    expect(contentKindAt(world, content, VANILLA_BALANCE, index(10, 10, MAP_SIZE))).toBe('road');
    expect(contentKindAt(world, content, VANILLA_BALANCE, index(11, 10, MAP_SIZE))).toBe('pipe');
    expect(contentKindAt(world, content, VANILLA_BALANCE, index(12, 10, MAP_SIZE))).toBe('forest');
    expect(contentKindAt(world, content, VANILLA_BALANCE, index(13, 10, MAP_SIZE))).toBe('empty');
  });

  it('tabulky odolnosti jsou úplné', () => {
    // Chybějící klíč se v kódu chová jako nula — u odolnosti „zničí se vždycky",
    // u zranitelnosti „nikdy". Obojí je tichá chyba, kterou by hráč objevil až
    // tím, že mu tornádo nechává stát zrovna továrny.
    const kinds = [
      'forest',
      'abandoned',
      'residentialLow',
      'residentialHigh',
      'commercial',
      'industrial',
      'service',
      'utility',
      'road',
      'pipe',
      'rubble',
      'empty',
    ];
    for (const kind of kinds) {
      expect(VANILLA_BALANCE.disasters.tornado.survival[kind], `tornádo ${kind}`).toBeDefined();
      expect(
        VANILLA_BALANCE.disasters.earthquake.vulnerability[kind],
        `zemětřesení ${kind}`,
      ).toBeDefined();
      expect(VANILLA_BALANCE.disasters.blast.resistance[kind], `výbuch ${kind}`).toBeDefined();
    }
  });

  it('validace neúplnou tabulku odmítne', () => {
    const raw = rawBalance();
    const disasters = raw['disasters'] as Record<string, unknown>;
    const tornado = disasters['tornado'] as Record<string, unknown>;
    delete (tornado['survival'] as Record<string, unknown>)['industrial'];

    const result = validateBalance(raw);
    expect(result.balance).toBeNull();
    expect(
      result.issues.some((i) => i.field === 'disasters.tornado.survival.industrial'),
    ).toBe(true);
  });
});

describe('ničení dlaždice', () => {
  it('budova mizí celá i s půdorysem a nechá trosky', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.economy.funds = 1000000;
    for (let x = 19; x <= 24; x++) buildRoad(world, x, 24, ROAD.street, content.getBalance());
    expect(
      placeDefinition(world, content, 'vanilla:coal_power_plant', 20, 19, content.getBalance()).ok,
    ).toBe(true);

    const losses = noLosses();
    // Zásah do jednoho rohu čtyřkřížky: dům s ustřelenou půlkou není poloviční dům.
    destroyTile(world, content, index(23, 23, MAP_SIZE), losses);

    expect(losses.buildings).toBe(1);
    expect(world.buildings.size).toBe(0);
    let covered = 0;
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        if (hasRubble(world, index(20 + dx, 20 + dy, MAP_SIZE))) covered++;
      }
    }
    expect(covered).toBe(16);
  });

  it('silnice a potrubí mizí samy za sebe', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    world.economy.funds = 100000;
    buildRoad(world, 30, 30, ROAD.street, content.getBalance());
    buildPipe(world, 31, 30, content.getBalance());

    const losses = noLosses();
    destroyTile(world, content, index(30, 30, MAP_SIZE), losses);
    destroyTile(world, content, index(31, 30, MAP_SIZE), losses);

    expect(losses.infrastructure).toBe(2);
    expect(world.layers.road[index(30, 30, MAP_SIZE)]).toBe(ROAD.none);
    expect(world.layers.pipe[index(31, 30, MAP_SIZE)]).toBe(0);
    // Seznam silnic se s vrstvou nesmí rozejít (T45).
    expect(world.roadTiles.has(index(30, 30, MAP_SIZE))).toBe(false);
    expect(hasRubble(world, index(30, 30, MAP_SIZE))).toBe(true);
  });

  it('snížení úrovně nechá budovu stát', async () => {
    const content = await vanilla();
    const world = growCity(content);
    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    // Úroveň se nastaví ručně: tohle je test o snižování, ne o tom, jestli
    // město bez služeb stihne za pět set tiků povýšit.
    building.level = 3;

    const before = building.level;
    const losses = noLosses();
    expect(downgradeTile(world, index(building.x, building.y, MAP_SIZE), losses)).toBe(true);

    expect(building.level).toBe(before - 1);
    expect(losses.downgraded).toBe(1);
    expect(world.buildings.has(building.id)).toBe(true);
  });

  it('úroveň jedna se snížit nedá', async () => {
    const content = await vanilla();
    const world = growCity(content);
    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    building.level = 1;

    const losses = noLosses();
    expect(downgradeTile(world, index(building.x, building.y, MAP_SIZE), losses)).toBe(false);
    expect(losses.downgraded).toBe(0);
  });
});

describe('hod na zničení', () => {
  it('velká budova dostane jeden hod, ne jeden za každou dlaždici', async () => {
    // Nemocnice 3×3 by jinak dostala devět hodů a nepřežila by nikdy. Hráč by
    // se naučil, že velké služby jsou past, a stavěl by jen malé.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 1000000;
    for (let x = 18; x < 25; x++) buildRoad(world, x, 19, ROAD.street, balance);
    const placed = placeDefinition(world, content, 'vanilla:hospital', 20, 20, balance);
    expect(placed.ok, JSON.stringify(placed)).toBe(true);

    let draws = 0;
    const real = world.rng.next.bind(world.rng);
    world.rng.next = (): number => {
      draws++;
      return real();
    };

    // Šance nula: nic se nezničí, počítají se čistě hody.
    const shape = { kind: 'radius' as const, x: 21, y: 21, radius: 4 };
    const tiles = tilesOf(world, shape).length;
    rollDamage(world, content, VANILLA_BALANCE, shape, () => 0, noLosses());
    expect(draws).toBe(tiles);

    // A při jistotě: devět dlaždic nemocnice spolkne jediný hod navíc.
    draws = 0;
    const hit = rollDamage(world, content, VANILLA_BALANCE, shape, () => 1, noLosses());
    expect(draws).toBe(tiles);
    expect(hit).toHaveLength(tiles - 8);
    expect(world.buildings.size).toBe(0);
  });

  it('škody srazí spokojenost celému městu', async () => {
    // Spadlý dům je zpráva pro celé město, ne jen pro jeho ulici.
    const content = await vanilla();
    const world = growCity(content);
    expect(world.disasters.modifiers).toHaveLength(0);

    const registry = new DisasterRegistry();
    registry.register(createExplosionDisaster());
    const building = [...world.buildings.values()].find((b) => b.x > 20 && b.x < 30);
    if (!building) throw new Error('nic nevyrostlo');
    // Velká budova = velký poloměr: test má stát na tom, jestli se škody hlásí,
    // ne na tom, jestli jediný hod vyšel.
    building.level = 5;
    startDisaster(
      world,
      content,
      content.getBalance(),
      registry,
      'explosion',
      building.x,
      building.y,
    );

    const penalty = world.disasters.modifiers.find((m) => m.kind === 'happinessPenalty');
    expect(penalty, 'zbořené domy nikoho netrápí').toBeDefined();
    expect(penalty?.amount).toBeGreaterThan(0);
    expect(penalty?.cells).toHaveLength(0);
    expect(penalty?.until).toBeGreaterThan(world.tick);
  });
});

describe('tornádo', () => {
  it('vzniká na okraji mapy, ne uprostřed', async () => {
    // Hráč tím dostane pár tiků, než dorazí k zástavbě — a to je jediné, co se
    // s tornádem dá dělat.
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const disaster = createTornadoDisaster();

    const sides = new Set<string>();
    for (let attempt = 0; attempt < 60; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      expect(origin).not.toBeNull();
      if (!origin) continue;
      const onEdge =
        origin.x === 0 ||
        origin.y === 0 ||
        origin.x === MAP_SIZE - 1 ||
        origin.y === MAP_SIZE - 1;
      expect(onEdge, `pokus ${attempt}`).toBe(true);

      if (origin.y === 0) sides.add('sever');
      else if (origin.x === MAP_SIZE - 1) sides.add('vychod');
      else if (origin.y === MAP_SIZE - 1) sides.add('jih');
      else sides.add('zapad');
    }

    // Ze všech čtyř stran, ne pořád z jedné. Kdyby tornádo chodilo jen ze
    // západu, hráč by si na východní straně stavěl bez rizika.
    expect([...sides].sort()).toEqual(['jih', 'sever', 'vychod', 'zapad']);
  });

  it('pohybuje se a po dráze ničí', async () => {
    const content = await vanilla();
    const world = growCity(content);
    const before = world.buildings.size;
    expect(before).toBeGreaterThan(5);

    const registry = new DisasterRegistry();
    registry.register(createTornadoDisaster());
    const disaster = createTornadoDisaster();
    const entry = startDisaster(world, content, content.getBalance(), registry, 'tornado', 25, 0);
    if (!entry) throw new Error('tornádo nezačalo');

    const startX = entry.state['x'] as number;
    const startY = entry.state['y'] as number;

    for (let tick = 0; tick < 40; tick++) {
      if (disaster.isFinished(world, entry)) break;
      disaster.tick(
        { world, catalogue: content, balance: content.getBalance(), x: entry.x, y: entry.y },
        entry,
      );
    }

    // Posunulo se.
    expect(entry.state['x']).not.toBe(startX);
    expect(entry.state['y']).not.toBe(startY);
    // A něco po sobě nechalo — buď zbořené domy, nebo aspoň trosky.
    const rubble = [...world.rubble].filter((value) => value !== 0).length;
    expect(world.buildings.size < before || rubble > 0).toBe(true);
  });

  it('skončí, až mu vyprší život', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const registry = new DisasterRegistry();
    registry.register(createTornadoDisaster());
    const disaster = createTornadoDisaster();

    const entry = startDisaster(world, content, content.getBalance(), registry, 'tornado', 0, 60);
    if (!entry) throw new Error('tornádo nezačalo');
    expect(disaster.isFinished(world, entry)).toBe(false);

    for (let tick = 0; tick < 200; tick++) {
      disaster.tick(
        { world, catalogue: content, balance: content.getBalance(), x: entry.x, y: entry.y },
        entry,
      );
    }
    expect(disaster.isFinished(world, entry)).toBe(true);
  });

  it('síla jde slabě → naplno → doznívá', () => {
    // Křivka životnosti je celý rozdíl mezi tornádem a pojízdným buldozerem:
    // hráč má na začátku pár tiků, kdy to ještě není nejhorší, a na konci
    // vidí, že už to slábne. Konstantní síla by z toho udělala rovnou čáru.
    expect(strengthAt(0)).toBeCloseTo(0.4, 5);
    expect(strengthAt(0.5)).toBeCloseTo(1, 5);
    expect(strengthAt(1)).toBeCloseTo(0.3, 5);

    expect(strengthAt(0.25)).toBeGreaterThan(strengthAt(0));
    expect(strengthAt(0.5)).toBeGreaterThan(strengthAt(0.25));
    expect(strengthAt(0.75)).toBeLessThan(strengthAt(0.5));
    expect(strengthAt(1)).toBeLessThan(strengthAt(0.75));
  });

  it('na kraji pásu jen olízne, v ose sebere všechno', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const shape = { fromX: 10, fromY: 20, toX: 30, toY: 20 };
    const width = 6;

    const at = (x: number, y: number): number =>
      axisFalloff(index(x, y, MAP_SIZE), world, shape, width);

    expect(at(20, 20)).toBeCloseTo(1, 5);
    expect(at(20, 21)).toBeLessThan(at(20, 20));
    expect(at(20, 22)).toBeLessThan(at(20, 21));
    expect(at(20, 23)).toBeCloseTo(0, 5);
    // Symetrické kolem osy.
    expect(at(20, 18)).toBeCloseTo(at(20, 22), 5);
  });

  it('dráha se stáčí, nejde po pravítku', async () => {
    // Bez stáčení by hráč po prvním zásahu věděl, kudy to příště půjde.
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const registry = new DisasterRegistry();
    registry.register(createTornadoDisaster());
    const disaster = createTornadoDisaster();

    const entry = startDisaster(world, content, content.getBalance(), registry, 'tornado', 5, 5);
    if (!entry) throw new Error('tornádo nezačalo');

    const angles: number[] = [];
    for (let tick = 0; tick < 15; tick++) {
      disaster.tick(
        { world, catalogue: content, balance: content.getBalance(), x: entry.x, y: entry.y },
        entry,
      );
      angles.push(entry.state['angle'] as number);
    }

    expect(new Set(angles).size).toBe(angles.length);
    const first = angles[0] ?? 0;
    const deltas = angles.map((angle) => Math.abs(angle - first));
    expect(Math.max(...deltas)).toBeGreaterThan(0.02);
  });

  it('zapaluje jen část toho, co zboří', async () => {
    // Následné požáry nadělají víc škody než tornádo samo, ale musí jich být
    // část — hořící celá dráha je konec města bez šance zasáhnout.
    const content = await vanilla();
    const balance = content.getBalance();
    const quiet = structuredClone(balance) as Balance;
    (quiet.disasters.tornado as { igniteChance: number }).igniteChance = 0;

    const world = growCity(content);
    const registry = new DisasterRegistry();
    registry.register(createTornadoDisaster());
    const disaster = createTornadoDisaster();
    const entry = startDisaster(world, content, quiet, registry, 'tornado', 25, 0);
    if (!entry) throw new Error('tornádo nezačalo');
    entry.state['angle'] = Math.PI / 2;

    for (let tick = 0; tick < 40; tick++) {
      if (disaster.isFinished(world, entry)) break;
      disaster.tick({ world, catalogue: content, balance: quiet, x: entry.x, y: entry.y }, entry);
    }

    // Něco spadlo — jinak by test neměl co tvrdit.
    expect([...world.rubble].filter((value) => value !== 0).length).toBeGreaterThan(0);
    // A při nulové šanci nehoří nic: šance se opravdu čte.
    expect([...world.fire].filter((value) => value !== 0)).toHaveLength(0);
  });
});

describe('zemětřesení', () => {
  it('zasáhne celé město, ne jen okruh', async () => {
    // Útlum nikdy neklesne pod čtvrtinu, takže i druhý konec mapy dostane
    // ránu. Právě proto se prochází seznam budov, ne tvar.
    const content = await vanilla();
    const world = growCity(content);
    const before = world.buildings.size;

    const registry = new DisasterRegistry();
    registry.register(createEarthquakeDisaster());
    // Epicentrum daleko od města; silná rána se vynutí přes stav.
    const entry = startDisaster(world, content, content.getBalance(), registry, 'earthquake', 120, 120);
    if (!entry) throw new Error('zemětřesení nezačalo');

    // Slabé otřesy jsou nejčastější, takže se dopad ověří na vynucené síle.
    entry.state['magnitude'] = 1;
    const disaster = createEarthquakeDisaster();
    for (let tick = 0; tick < 5; tick++) {
      world.tick += 100;
      disaster.tick(
        { world, catalogue: content, balance: content.getBalance(), x: 120, y: 120 },
        entry,
      );
    }

    expect(world.buildings.size).toBeLessThan(before);
  });

  it('umí budovu nalomit, ne jen srovnat se zemí', async () => {
    // Snížená budova je mírnější trest, který hráč pozná na dani a kapacitě,
    // ne na mapě. Kdyby zemětřesení umělo jen bořit, byla by celá polovina
    // jeho mechaniky k ničemu.
    const content = await vanilla();
    const world = growCity(content);
    for (const building of world.buildings.values()) building.level = 3;

    const survivors = () => [...world.buildings.values()];
    const levelSum = (): number => survivors().reduce((sum, b) => sum + b.level, 0);
    const before = { count: world.buildings.size, levels: levelSum() };
    expect(before.count).toBeGreaterThan(5);

    const registry = new DisasterRegistry();
    registry.register(createEarthquakeDisaster());
    const disaster = createEarthquakeDisaster();
    const entry = startDisaster(
      world,
      content,
      content.getBalance(),
      registry,
      'earthquake',
      25,
      20,
    );
    if (!entry) throw new Error('zemětřesení nezačalo');

    // Slabá, ale opakovaná rána: mnoho hodů na snížení, málo na zboření.
    for (let shake = 0; shake < 6; shake++) {
      entry.state['magnitude'] = 0.3;
      entry.state['left'] = 5;
      world.tick += 100;
      disaster.tick(
        { world, catalogue: content, balance: content.getBalance(), x: 25, y: 20 },
        entry,
      );
    }

    // Aspoň někdo přežil sníženej, ne že by všechno spadlo.
    expect(world.buildings.size).toBeGreaterThan(0);
    const lowered = survivors().filter((b) => b.level < 3).length;
    expect(lowered).toBeGreaterThan(0);
    expect(levelSum()).toBeLessThan(before.levels);
  });

  it('otřes dopadne stejně bez ohledu na pořadí v mapě budov', async () => {
    // Save načte budovy v pořadí, v jakém je v souboru. Kdyby na něm záviselo,
    // komu padne který hod, mělo by město po loadu jinou škodu než před ním
    // — a determinismus by platil jen do prvního uložení (P2).
    const content = await vanilla();
    const registry = new DisasterRegistry();
    registry.register(createEarthquakeDisaster());

    const shakeIt = (reverse: boolean): string => {
      const world = growCity(content);
      if (reverse) world.buildings = new Map([...world.buildings.entries()].reverse());
      world.rng = Rng.fromState(4242);
      startDisaster(world, content, content.getBalance(), registry, 'earthquake', 25, 20);
      return [...world.buildings.values()]
        .map((b) => `${b.id}:${b.level}`)
        .sort()
        .join(',');
    };

    expect(shakeIt(true)).toBe(shakeIt(false));
  });

  it('síla se losuje s velkým sklonem k malým hodnotám', async () => {
    // `base + span × rng()³`. Velká rána musí být vzácná, jinak si na ni hráč
    // zvykne a přestane mít smysl finanční rezerva.
    const content = await vanilla();
    // Malá prázdná mapa: test se dívá jen na vylosované číslo, ale každý start
    // projde pobřežní pás a seznam budov.
    const world = createWorld(1, content.getBalance().economy, 32);
    const registry = new DisasterRegistry();
    registry.register(createEarthquakeDisaster());

    let strong = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const entry = startDisaster(
        world,
        content,
        content.getBalance(),
        registry,
        'earthquake',
        10,
        10,
      );
      if (!entry) continue;
      if ((entry.state['magnitude'] as number) > 0.8) strong++;
      world.disasters.active.length = 0;
    }

    // Zadání čeká zhruba pět procent nad 0,8.
    expect(strong / 200).toBeLessThan(0.15);
  });

  it('má dotřesy, které slábnou', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const registry = new DisasterRegistry();
    registry.register(createEarthquakeDisaster());

    const entry = startDisaster(world, content, content.getBalance(), registry, 'earthquake', 30, 30);
    if (!entry) throw new Error('zemětřesení nezačalo');
    entry.state['magnitude'] = 1;

    const left = entry.state['left'] as number;
    expect(left).toBeGreaterThan(0);

    const disaster = createEarthquakeDisaster();
    world.tick += 200;
    disaster.tick({ world, catalogue: content, balance: content.getBalance(), x: 30, y: 30 }, entry);

    expect(entry.state['left']).toBe(left - 1);
    // Dotřes je slabší než hlavní rána, ne stejný.
    expect(entry.state['magnitude'] as number).toBeLessThan(1);
  });
});

describe('výbuch a průmyslová havárie', () => {
  it('havárie si vybírá průmysl, výbuch cokoli', async () => {
    const content = await vanilla();
    const world = growCity(content);

    const accident = createIndustrialAccidentDisaster();
    for (let attempt = 0; attempt < 20; attempt++) {
      const origin = accident.pickOrigin(world, content, content.getBalance());
      if (!origin) continue;
      const tile = index(origin.x, origin.y, MAP_SIZE);
      const kind = contentKindAt(world, content, VANILLA_BALANCE, tile);
      expect(['industrial', 'abandoned'], `pokus ${attempt}`).toContain(kind);
    }
  });

  it('havárie kontaminuje, výbuch ne', async () => {
    // Jediný rozdíl, kvůli kterému se havárie pozná i po týdnech.
    const content = await vanilla();
    const balance = content.getBalance();
    expect(balance.disasters.blast.industrialAccident.pollution).toBeGreaterThan(0);
    expect(balance.disasters.blast.explosion.pollution).toBe(0);

    const world = growCity(content);
    const industrial = [...world.buildings.values()].find(
      (b) => content.get(b.definitionId)?.category === 'industrial',
    );
    if (!industrial) throw new Error('žádný průmysl');

    const before = Math.max(...world.coarse.pollution);
    const registry = new DisasterRegistry();
    registry.register(createIndustrialAccidentDisaster());
    startDisaster(
      world,
      content,
      balance,
      registry,
      'industrialAccident',
      industrial.x,
      industrial.y,
    );

    expect(Math.max(...world.coarse.pollution)).toBeGreaterThan(before);
  });

  it('výbuch zapaluje dál, než boří', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    // Dosah zapálení je násobek poloměru — okraj tlakové vlny dům nesloží,
    // ale zapálí ho.
    expect(balance.disasters.blast.explosion.igniteReach).toBeGreaterThan(1);
    expect(balance.disasters.blast.industrialAccident.igniteReach).toBeGreaterThan(1);
  });

  it('výbuch boří míň, ale zapaluje víc než havárie', () => {
    const blast = VANILLA_BALANCE.disasters.blast;
    expect(blast.explosion.destroyChance).toBeLessThan(blast.industrialAccident.destroyChance);
    expect(blast.explosion.igniteChance).toBeGreaterThan(blast.industrialAccident.igniteChance);
    expect(blast.explosion.radiusBase).toBeLessThan(blast.industrialAccident.radiusBase);
  });

  it('bez zástavby nemá kde vybuchnout', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    expect(
      createExplosionDisaster().pickOrigin(world, content, content.getBalance()),
    ).toBeNull();
  });

  it('je to jednorázový zásah, ne proces', async () => {
    const content = await vanilla();
    const world = growCity(content);
    const registry = new DisasterRegistry();
    registry.register(createExplosionDisaster());
    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');

    const entry = startDisaster(
      world,
      content,
      content.getBalance(),
      registry,
      'explosion',
      building.x,
      building.y,
    );
    // Celá práce se odehraje ve `start()`; co po výbuchu zbude, dohořívá
    // vlastním systémem.
    expect(entry?.finished).toBe(true);
  });
  it('poloměr roste s úrovní budovy, ve které to bouchlo', async () => {
    // Velká továrna nadělá víc škody než dílna. Bez toho by hráč neměl důvod
    // dívat se na to, co mu ve čtvrti vyrostlo.
    const content = await vanilla();
    const world = growCity(content);
    const registry = new DisasterRegistry();
    registry.register(createExplosionDisaster());

    const building = [...world.buildings.values()].find((b) => b.x > 20 && b.x < 30);
    if (!building) throw new Error('nic nevyrostlo');

    const radiusAtLevel = (level: number): number => {
      building.level = level;
      const entry = startDisaster(
        world,
        content,
        content.getBalance(),
        registry,
        'explosion',
        building.x,
        building.y,
      );
      if (!entry) throw new Error('výbuch nezačal');
      world.disasters.active.length = 0;
      return entry.state['radius'] as number;
    };

    expect(radiusAtLevel(5)).toBeGreaterThan(radiusAtLevel(1));
  });

  it('zapaluje dál, než kam dosáhne bourání', async () => {
    // Okraj tlakové vlny dům nesloží, ale zapálí ho — a hráč tak má co hasit
    // i mimo kráter.
    const content = await vanilla();
    const world = growCity(content);
    const registry = new DisasterRegistry();
    registry.register(createExplosionDisaster());

    const building = [...world.buildings.values()].find((b) => b.x > 20 && b.x < 30);
    if (!building) throw new Error('nic nevyrostlo');
    building.level = 5;

    const entry = startDisaster(
      world,
      content,
      content.getBalance(),
      registry,
      'explosion',
      building.x,
      building.y,
    );
    if (!entry) throw new Error('výbuch nezačal');
    const radius = entry.state['radius'] as number;

    let farthestFire = 0;
    for (let tile = 0; tile < world.fire.length; tile++) {
      if ((world.fire[tile] ?? 0) === 0) continue;
      const x = tile % MAP_SIZE;
      const y = (tile - x) / MAP_SIZE;
      farthestFire = Math.max(farthestFire, Math.hypot(x - building.x, y - building.y));
    }

    expect(farthestFire, 'nehoří vůbec nic').toBeGreaterThan(0);
    expect(farthestFire).toBeGreaterThan(radius);
  });

  it('bouchne spíš tam, kde hráč nechal starou nekrytou továrnu', async () => {
    // Vážený los z toho dělá zprávu, ne loterii: zanedbaná a nekrytá polovina
    // města to musí schytat citelně častěji.
    const content = await vanilla();
    const world = growCity(content);
    // Město bez hasičárny žádnou vrstvu pokrytí nemá; test si ji vyrobí sám,
    // aby měl co srovnávat.
    const coarse = coarseSizeOf(MAP_SIZE);
    const coverage = new Uint8Array(coarse * coarse);
    world.coverage.set('fire', coverage);

    // Zástavba stojí v pásu x 10–40; dělicí čára musí vést jí, ne prázdnou
    // mapou. Západní půlka pod dohledem hasičů, východní bez.
    const split = 25;
    for (let cy = 0; cy < coarse; cy++) {
      for (let cx = 0; cx < coarse; cx++) {
        coverage[cy * coarse + cx] = cx * COARSE_FACTOR < split ? 255 : 0;
      }
    }

    const covered = [...world.buildings.values()].filter((b) => b.x < split).length;
    const uncovered = world.buildings.size - covered;
    expect(covered).toBeGreaterThan(3);
    expect(uncovered).toBeGreaterThan(3);

    const disaster = createExplosionDisaster();
    let hitUncovered = 0;
    const draws = 300;
    for (let attempt = 0; attempt < draws; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      if (!origin) continue;
      if (origin.x >= split) hitUncovered++;
    }

    // Na dlaždici, ne v součtu: půlky nemusí mít stejně budov.
    const perUncovered = hitUncovered / draws / uncovered;
    const perCovered = (draws - hitUncovered) / draws / covered;
    expect(perCovered, 'krytá půlka bouchá stejně často').toBeLessThan(perUncovered * 0.5);
  });

});

/** Syrový balanc z obsahu, aby šly zkoušet chyby ve validaci. */
function rawBalance(): Record<string, unknown> {
  const modules = import.meta.glob('../content/vanilla/balance.json', {
    eager: true,
    import: 'default',
  });
  const raw = Object.values(modules)[0];
  return structuredClone(raw) as Record<string, unknown>;
}
