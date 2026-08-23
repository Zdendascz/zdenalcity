import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildPipe, buildRoad, placeDefinition, zoneArea } from '@/sim/commands';
import { explainLandValue, landValueContext } from '@/sim/diagnostics';
import {
  createFloodDisaster,
  createFloodSystem,
  drainTile,
  floodPerCell,
  floodTile,
  isFlooded,
} from '@/sim/disasters/flood';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { hasRubble } from '@/sim/disasters/rubble';
import { startDisaster } from '@/sim/disasters/scheduler';
import { coarseCellsOfShape } from '@/sim/disasters/shapes';
import { applyHeightChanges, createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { cornerIndex } from '@/sim/heights';
import { inBounds, index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createPowerSystem } from '@/sim/systems/power';
import { createTrafficSystem } from '@/sim/systems/traffic';
import { createWaterSystem } from '@/sim/systems/water';
import { MAP_SIZE } from './support/grid';

/**
 * Povodeň (T49, §5 fáze 4).
 *
 * Druhá a poslední katastrofa s vlastní vrstvou (R14). Testuje se hlavně to,
 * co z ní dělá hru a ne trest:
 *
 * - **hráz o jednu úroveň vlnu zastaví** — zadání to označuje za platné
 *   trvalé řešení a je to jediná odměna za investici do převýšení, kterou
 *   hráč dostane hned
 * - **škoda se hromadí**, nepůsobí naráz, takže rychlé opadnutí zachraňuje
 * - **hasiči opadání zrychlují** — jediné místo, kde se pokrytí hasiči
 *   vyplatí i tam, kde nikdy nehořelo
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

function floodOnly(content: ContentRegistry): ReturnType<typeof createFloodSystem>[] {
  return [createFloodSystem(content, content.getBalance())];
}

/** Rovná mapa s vodou v levém sloupci — břeh je na x = 1. */
function coastWorld(content: ContentRegistry): WorldState {
  const world = createWorld(1, content.getBalance().economy);
  world.economy.funds = 1000000;
  for (let y = 0; y < MAP_SIZE; y++) world.layers.terrain[index(0, y, MAP_SIZE)] = TERRAIN.water;
  return world;
}

/** Zvedne svislý pás rohů o `height` — hráz. */
function raiseWall(world: WorldState, x: number, height: number): void {
  const side = world.size + 1;
  const changes = new Map<number, number>();
  for (let y = 0; y <= world.size; y++) {
    changes.set(cornerIndex(x, y, side), height);
    changes.set(cornerIndex(x + 1, y, side), height);
  }
  applyHeightChanges(world, changes);
}

/**
 * Rozjede povodeň a nechá ji běžet.
 *
 * Vlnu posouvá sama katastrofa, ne systém — ten jen počítá škodu a opadání.
 * Testy proto musí volat obojí, stejně jako to dělá plánovač.
 */
function runFlood(
  world: WorldState,
  content: ContentRegistry,
  x: number,
  y: number,
  ticks: number,
): void {
  const registry = new DisasterRegistry();
  registry.register(createFloodDisaster());
  const disaster = createFloodDisaster();
  startDisaster(world, content, content.getBalance(), registry, 'flood', x, y);

  const systems = floodOnly(content);
  for (let tick = 0; tick < ticks; tick++) {
    for (const entry of world.disasters.active) {
      disaster.tick(
        { world, catalogue: content, balance: content.getBalance(), x: entry.x, y: entry.y },
        entry,
      );
    }
    tickWorld(world, systems);
  }
}

/** Ulice, obytná i průmyslová zóna a pár set tiků, aby vzniklo, co jezdí. */
function growCity(content: ContentRegistry): WorldState {
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);
  world.economy.funds = 1000000;

  for (let x = 10; x < 30; x++) buildRoad(world, x, 12, ROAD.street, balance);
  zoneArea(world, 10, 9, 20, 3, ZONE.residential);
  zoneArea(world, 10, 13, 20, 3, ZONE.industrial);
  world.waterSupply.fill(1);

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 400; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
  return world;
}

describe('vrstva záplavy', () => {
  it('drží dobu i hloubku zvlášť', () => {
    const world = createWorld(1);
    const tile = index(20, 20, MAP_SIZE);

    expect(isFlooded(world, tile)).toBe(false);
    expect(floodTile(world, tile, 2, 15)).toBe(true);
    expect(world.floodDepth[tile]).toBe(2);
    expect(world.flood[tile]).toBe(15);

    drainTile(world, tile);
    expect(isFlooded(world, tile)).toBe(false);
    expect(world.floodDepth[tile]).toBe(0);
  });

  it('dvě vlny se nesčítají, platí ta horší', () => {
    // Sčítání by z každého zemětřesení udělalo potopu, ze které se město
    // nevzpamatuje.
    const world = createWorld(1);
    const tile = index(20, 20, MAP_SIZE);

    floodTile(world, tile, 3, 20);
    expect(floodTile(world, tile, 1, 5)).toBe(false);
    expect(world.floodDepth[tile]).toBe(3);
    expect(world.flood[tile]).toBe(20);

    // Horší vlna ale přebije.
    expect(floodTile(world, tile, 4, 30)).toBe(true);
    expect(world.floodDepth[tile]).toBe(4);
  });

  it('delší mělká vlna nesmí snížit hloubku', () => {
    // Zákeřný případ: druhá vlna je delší, ale mělčí. Doba se má prodloužit,
    // hloubka zůstat — jinak by druhá vlna dům z metru vody „zachránila".
    const world = createWorld(1);
    const tile = index(20, 20, MAP_SIZE);

    floodTile(world, tile, 3, 10);
    expect(floodTile(world, tile, 1, 40)).toBe(true);
    expect(world.floodDepth[tile]).toBe(3);
    expect(world.flood[tile]).toBe(40);
  });

  it('opadnutí nemaže nasbírané poškození', () => {
    // Voda odteče, ale co nalomila, zůstane nalomené. Bez toho by druhá vlna
    // začínala od nuly a série povodní by byla stejně neškodná jako jedna.
    const world = createWorld(1);
    const tile = index(20, 20, MAP_SIZE);
    floodTile(world, tile, 2, 10);
    world.floodDamage[tile] = 100;

    drainTile(world, tile);
    expect(world.floodDamage[tile]).toBe(100);
  });

  it('podíl buňky pod vodou se počítá z šestnácti dlaždic', () => {
    const world = createWorld(1);
    for (let dx = 0; dx < 4; dx++) floodTile(world, index(dx, 0, MAP_SIZE), 1, 10);
    expect(floodPerCell(world)[0]).toBeCloseTo(4 / 16);
  });
});

describe('postup vlny', () => {
  it('rozlije se od břehu do vnitrozemí', async () => {
    const content = await vanilla();
    const world = coastWorld(content);
    const registry = new DisasterRegistry();
    registry.register(createFloodDisaster());

    startDisaster(world, content, content.getBalance(), registry, 'flood', 1, 40);
    expect(isFlooded(world, index(1, 40, MAP_SIZE))).toBe(true);

    const systems = floodOnly(content);
    // Vlna postupuje po prstencích, jeden za tik.
    for (let tick = 0; tick < 3; tick++) {
      for (const entry of world.disasters.active) {
        createFloodDisaster().tick(
          { world, catalogue: content, balance: content.getBalance(), x: entry.x, y: entry.y },
          entry,
        );
      }
      tickWorld(world, systems);
    }

    expect(isFlooded(world, index(2, 40, MAP_SIZE))).toBe(true);
  });

  it('hráz o jednu úroveň vlnu zastaví', async () => {
    // Tohle je celý smysl převýšení jako obrany. Zadání ho označuje za platné
    // trvalé řešení; kdyby hráz nedržela, byl by terraforming k ničemu a
    // povodeň neodvratitelná daň.
    //
    // Testuje se **párově**: stejný seed, jednou s hrází a jednou bez. Bez
    // srovnání by test prošel i tehdy, kdyby se vlna zastavila sama.
    const content = await vanilla();

    const open = coastWorld(content);
    const walled = coastWorld(content);
    raiseWall(walled, 2, 1);

    // Krátce: po dvaceti ticích už by voda stihla opadnout a test by pak
    // porovnával dvě suché mapy.
    for (const world of [open, walled]) runFlood(world, content, 1, 40, 5);

    // Bez hráze voda dorazí za druhý sloupec.
    expect(isFlooded(open, index(3, 40, MAP_SIZE))).toBe(true);

    // S hrází je za ní sucho po celé její délce.
    for (let y = 30; y < 50; y++) {
      expect(isFlooded(walled, index(3, y, MAP_SIZE)), `za hrází na y=${y}`).toBe(false);
      expect(isFlooded(walled, index(4, y, MAP_SIZE)), `za hrází na y=${y}`).toBe(false);
    }
  });

  it('vlna se zastaví, nerozlije se přes celou mapu', async () => {
    // Dosah je 2–5 dlaždic. Bez zastavení by voda tekla donekonečna a celá
    // mechanika obrany by ztratila smysl.
    //
    // Sleduje se **největší dosah za celý průběh**, ne stav na konci: to už je
    // dávno sucho a test by prošel, i kdyby se voda mezitím rozlila přes půl
    // mapy.
    const content = await vanilla();
    const world = coastWorld(content);
    const registry = new DisasterRegistry();
    registry.register(createFloodDisaster());
    const disaster = createFloodDisaster();
    startDisaster(world, content, content.getBalance(), registry, 'flood', 1, 40);

    const systems = floodOnly(content);
    let furthest = 0;
    for (let tick = 0; tick < 60; tick++) {
      for (const entry of world.disasters.active) {
        disaster.tick(
          { world, catalogue: content, balance: content.getBalance(), x: entry.x, y: entry.y },
          entry,
        );
      }
      tickWorld(world, systems);
      for (let tile = 0; tile < world.flood.length; tile++) {
        if ((world.flood[tile] ?? 0) > 0) furthest = Math.max(furthest, tile % MAP_SIZE);
      }
    }

    const reachMax = content.getBalance().disasters.flood.reachMax;
    expect(furthest).toBeGreaterThan(1);
    expect(furthest).toBeLessThanOrEqual(1 + reachMax);
  });

  it('výběžek do moře je zranitelnější než rovná pláž', async () => {
    // Doplněk k testu ústí. Ten sám neodliší, jestli se délka pobřeží dělí
    // **souší v okolí**, nebo celým oknem — u zálivu vyjde obojí podobně.
    //
    // Výběžek to rozliší: kolem něj je skoro samá voda, takže souše je málo a
    // je celá pobřežní. Dělení souší proto dá skoro jedničku, dělení oknem
    // sotva pětinu. A správně je první: kosa obklopená vodou ze tří stran je
    // to nejzranitelnější místo na mapě.
    const content = await vanilla();
    const size = 64;
    const world = createWorld(1, content.getBalance().economy, size);

    // Otevřené moře vlevo a jedna kosa, která do něj vybíhá.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x <= 10; x++) world.layers.terrain[index(x, y, size)] = TERRAIN.water;
    }
    for (let x = 3; x <= 10; x++) world.layers.terrain[index(x, 32, size)] = TERRAIN.grass;

    const onSpit = (x: number, y: number): boolean => y === 32 && x <= 10;

    let spitTiles = 0;
    let plainTiles = 0;
    for (let tile = 0; tile < world.flood.length; tile++) {
      if (world.layers.terrain[tile] === TERRAIN.water) continue;
      const x = tile % size;
      const y = (tile - x) / size;
      let touches = false;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        if (!inBounds(x + dx, y + dy, size)) continue;
        if (world.layers.terrain[index(x + dx, y + dy, size)] === TERRAIN.water) touches = true;
      }
      if (!touches) continue;
      if (onSpit(x, y)) spitTiles++;
      else plainTiles++;
    }
    expect(spitTiles).toBeGreaterThan(0);
    expect(plainTiles).toBeGreaterThan(0);

    const disaster = createFloodDisaster();
    let spit = 0;
    let plain = 0;
    for (let attempt = 0; attempt < 1200; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      if (!origin) continue;
      if (onSpit(origin.x, origin.y)) spit++;
      else plain++;
    }

    expect(spit / spitTiles).toBeGreaterThan((plain / plainTiles) * 1.5);
  });

  it('do vody se nerozlévá — moře už tam je', async () => {
    // Musí se nechat postoupit: při vzniku se zaplaví jen ohnisko, takže
    // kontrola hned po startu by prošla, i kdyby se voda do moře rozlévala.
    const content = await vanilla();
    const world = coastWorld(content);
    runFlood(world, content, 1, 40, 10);

    for (let y = 20; y < 60; y++) {
      expect(isFlooded(world, index(0, y, MAP_SIZE)), `moře na y=${y}`).toBe(false);
    }
  });

  it('bez pobřeží nemá kde vzniknout', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    expect(createFloodDisaster().pickOrigin(world, content, content.getBalance())).toBeNull();
  });

  it('vzniká na břehu, ne uprostřed pevniny', async () => {
    const content = await vanilla();
    const world = coastWorld(content);
    const disaster = createFloodDisaster();

    for (let attempt = 0; attempt < 20; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      expect(origin).not.toBeNull();
      // Břeh je na x = 1: souš, která sousedí s vodou v nultém sloupci.
      expect(origin?.x, `pokus ${attempt}`).toBe(1);
    }
  });

  it('ústí je zranitelnější než rovná pláž', async () => {
    // Vážený los je celý smysl volby ohniska: do ústí se voda nahrne ze tří
    // stran. Rovnoměrný los by z povodně udělal loterii bez místa, které si
    // o ni říká.
    //
    // Měří se **pravděpodobnost na dlaždici**, ne souhrnný podíl ústí na
    // losech. Souhrn preferenci ředí: ústí tvoří skoro polovinu pobřeží, takže
    // i výrazná výhoda na dlaždici se v něm projeví jako pár procent. Naměřeno
    // je to zhruba **1,3× na dlaždici**, kdežto souhrnně jen 1,15×.
    const content = await vanilla();
    // Malá mapa schválně: každý los prochází celé pobřeží, takže na výchozí
    // velikosti by dvě tisícovky losů trvaly déle než celý zbytek souboru.
    const size = 64;
    const world = createWorld(1, content.getBalance().economy, size);

    // Krátké pobřeží: voda jen v jednom sloupci a jen na kus mapy.
    for (let y = 10; y <= 30; y++) world.layers.terrain[index(0, y, size)] = TERRAIN.water;
    // A jedno úzké ústí zaříznuté do pevniny. Mělký zářez by nestačil: pár
    // dlaždic vody u břehu vypadá skoro jako rovná pláž a rozdíl by zapadl
    // v šumu. Zadání mluví o zálivech **a ústích** — tohle je ústí.
    for (let x = 1; x <= 8; x++) world.layers.terrain[index(x, 20, size)] = TERRAIN.water;

    const inBay = (y: number): boolean => y >= 19 && y <= 21;

    // Kolik pobřežních dlaždic je u ústí a kolik na rovné pláži. Meze se
    // **musí** hlídat: `index(-1, y)` přeteče na druhý konec mapy a napočítal
    // by dvacet neexistujících dlaždic u protějšího okraje.
    let bayTiles = 0;
    let plainTiles = 0;
    for (let tile = 0; tile < world.flood.length; tile++) {
      if (world.layers.terrain[tile] === TERRAIN.water) continue;
      const x = tile % size;
      const y = (tile - x) / size;
      let touches = false;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        if (!inBounds(x + dx, y + dy, size)) continue;
        if (world.layers.terrain[index(x + dx, y + dy, size)] === TERRAIN.water) touches = true;
      }
      if (!touches) continue;
      if (inBay(y)) bayTiles++;
      else plainTiles++;
    }
    expect(bayTiles).toBeGreaterThan(0);
    expect(plainTiles).toBeGreaterThan(0);

    const disaster = createFloodDisaster();
    let bay = 0;
    let plain = 0;
    for (let attempt = 0; attempt < 1200; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      if (!origin) continue;
      if (inBay(origin.y)) bay++;
      else plain++;
    }

    // Při rovnoměrném losu by se pravděpodobnosti na dlaždici rovnaly.
    expect(bay / bayTiles).toBeGreaterThan((plain / plainTiles) * 1.2);
  });
});

describe('škoda a opadání', () => {
  it('mělká voda se dá přečkat, hluboká ne', async () => {
    // Hloubka 1 je zhruba třináct tiků do zničení, hloubka 3 čtyři. Kdyby to
    // bylo stejné, nemělo by převýšení ani částečnou cenu.
    const content = await vanilla();
    const balance = content.getBalance();
    const systems = floodOnly(content);

    const shallow = createWorld(1, balance.economy);
    const deep = createWorld(1, balance.economy);
    floodTile(shallow, index(20, 20, MAP_SIZE), 1, 200);
    floodTile(deep, index(20, 20, MAP_SIZE), 3, 200);

    for (let tick = 0; tick < 5; tick++) {
      tickWorld(shallow, systems);
      tickWorld(deep, systems);
    }

    expect(deep.floodDamage[index(20, 20, MAP_SIZE)] ?? 0).toBeGreaterThan(
      shallow.floodDamage[index(20, 20, MAP_SIZE)] ?? 0,
    );
  });

  it('voda opadne sama a hasiči to zrychlí', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const systems = floodOnly(content);

    const alone = createWorld(1, balance.economy);
    const covered = createWorld(1, balance.economy);
    covered.coverage.set('fire', new Uint8Array(covered.coarse.pollution.length).fill(255));

    const tile = index(20, 20, MAP_SIZE);
    floodTile(alone, tile, 1, 60);
    floodTile(covered, tile, 1, 60);

    for (let tick = 0; tick < 6; tick++) {
      tickWorld(alone, systems);
      tickWorld(covered, systems);
    }

    // Jediné místo, kde se pokrytí hasiči vyplatí i tam, kde nikdy nehořelo.
    expect(covered.flood[tile] ?? 0).toBeLessThan(alone.flood[tile] ?? 0);
  });

  it('dlouhá voda budovu strhne a nechá trosky', async () => {
    const content = await vanilla();
    const world = coastWorld(content);
    const balance = content.getBalance();
    for (let x = 19; x <= 22; x++) buildRoad(world, x, 22, ROAD.street, balance);
    expect(placeDefinition(world, content, 'vanilla:park_small', 20, 20, balance).ok).toBe(true);

    floodTile(world, index(20, 20, MAP_SIZE), 3, 250);
    const systems = floodOnly(content);
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);

    expect(world.buildings.size).toBe(0);
    expect(hasRubble(world, index(20, 20, MAP_SIZE))).toBe(true);
  });

  it('strhne i silnici a potrubí, kde žádná budova nestála', async () => {
    // Tohle je ten důvod, proč jsou trosky vrstva a ne stav budovy (R15).
    const content = await vanilla();
    const world = coastWorld(content);
    const balance = content.getBalance();
    buildRoad(world, 30, 30, ROAD.street, balance);
    buildPipe(world, 31, 30, balance);

    floodTile(world, index(30, 30, MAP_SIZE), 3, 250);
    floodTile(world, index(31, 30, MAP_SIZE), 3, 250);
    const systems = floodOnly(content);
    for (let tick = 0; tick < 30; tick++) tickWorld(world, systems);

    expect(world.layers.road[index(30, 30, MAP_SIZE)]).toBe(ROAD.none);
    expect(world.layers.pipe[index(31, 30, MAP_SIZE)]).toBe(0);
    expect(hasRubble(world, index(30, 30, MAP_SIZE))).toBe(true);
    expect(hasRubble(world, index(31, 30, MAP_SIZE))).toBe(true);
    // A seznam silnic se s vrstvou nesmí rozejít (T45).
    expect(world.roadTiles.has(index(30, 30, MAP_SIZE))).toBe(false);
  });

  it('stojatá voda znečišťuje', async () => {
    const content = await vanilla();
    const world = createWorld(1, content.getBalance().economy);
    const cell = coarseCellsOfShape(world, { kind: 'point', x: 20, y: 20 })[0] ?? 0;
    const before = world.coarse.pollution[cell] ?? 0;

    floodTile(world, index(20, 20, MAP_SIZE), 2, 30);
    const systems = floodOnly(content);
    for (let tick = 0; tick < 5; tick++) tickWorld(world, systems);

    expect(world.coarse.pollution[cell] ?? 0).toBeGreaterThan(before);
  });
});

describe('zaplavená dlaždice nefunguje', () => {
  it('nevede proud', async () => {
    const content = await vanilla();
    const balance = content.getBalance();

    const dry = createWorld(1, balance.economy);
    const wet = createWorld(1, balance.economy);
    for (const world of [dry, wet]) {
      world.economy.funds = 1000000;
      // Elektrárna je 4×4 (20–23); ulice vede pod ní a slouží jako vedení.
      for (let x = 10; x < 30; x++) buildRoad(world, x, 24, ROAD.street, balance);
      expect(
        placeDefinition(world, content, 'vanilla:coal_power_plant', 20, 20, balance).ok,
      ).toBe(true);
      world.powerNetworkDirty = true;
    }
    // Přehradíme vedení uprostřed ulice.
    for (let x = 14; x <= 16; x++) floodTile(wet, index(x, 24, MAP_SIZE), 2, 200);

    const power = [createPowerSystem(content)];
    tickWorld(dry, power);
    tickWorld(wet, power);

    const far = index(11, 24, MAP_SIZE);
    expect(dry.layers.power[far]).toBe(1);
    // Za zaplaveným úsekem proud není — přerušené sítě bolí víc než pár
    // zbořených domů.
    expect(wet.layers.power[far]).toBe(0);
  });

  it('nevede vodu', async () => {
    const content = await vanilla();
    const balance = content.getBalance();

    const dry = createWorld(1, balance.economy);
    const wet = createWorld(1, balance.economy);
    for (const world of [dry, wet]) {
      world.economy.funds = 1000000;
      // Vodárna chce břeh, takže jí ho uděláme.
      for (let y = 28; y <= 36; y++) world.layers.terrain[index(18, y, MAP_SIZE)] = TERRAIN.water;
      for (let x = 19; x <= 26; x++) buildRoad(world, x, 34, ROAD.street, balance);
      expect(
        placeDefinition(world, content, 'vanilla:water_works', 19, 31, balance).ok,
      ).toBe(true);
      for (let x = 19; x <= 40; x++) buildPipe(world, x, 30, balance);
      world.waterNetworkDirty = true;
    }
    for (let x = 28; x <= 30; x++) floodTile(wet, index(x, 30, MAP_SIZE), 2, 200);

    const systems = [createWaterSystem(content, balance)];
    tickWorld(dry, systems);
    tickWorld(wet, systems);

    const far = index(38, 30, MAP_SIZE);
    expect(dry.waterSupply[far]).toBe(1);
    // Za zaplaveným úsekem voda neteče.
    expect(wet.waterSupply[far]).toBe(0);
  });

  it('zaplavená vozovka sama nenese žádnou zátěž', async () => {
    // Ostřejší než celoplošný test: ulice kolem jezdí dál, ale právě ta jedna
    // zaplavená dlaždice musí zůstat na nule. Kdyby se přes ni jezdilo, byla
    // by objížďka jen kosmetika a povodeň by dopravu vůbec neřešila.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    const systems = [createTrafficSystem(content, balance)];

    world.trafficLoad.fill(0);
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);

    // Najdi dlaždici, po které se opravdu jezdí.
    let busiest = -1;
    for (let tile = 0; tile < world.trafficLoad.length; tile++) {
      if ((world.trafficLoad[tile] ?? 0) > (world.trafficLoad[busiest] ?? 0)) busiest = tile;
    }
    expect(busiest).toBeGreaterThanOrEqual(0);
    expect(world.trafficLoad[busiest] ?? 0).toBeGreaterThan(0);

    floodTile(world, busiest, 2, 250);
    world.trafficLoad.fill(0);
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);

    expect(world.trafficLoad[busiest]).toBe(0);
    // A zbytek města jezdí dál — test neměří jen to, že se doprava zastavila.
    expect(world.trafficLoad.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('z domu se na zaplavenou ulici ani nevyjede', async () => {
    // Ostřejší než předchozí test: doprava začíná u budovy a hledá první
    // silnici v okolí. Kdyby se ta kontrola vynechala **jen tam**, cesta by
    // z domu na zatopenou vozovku vyrazila a teprve pak se zasekla — zátěž
    // by se na ní objevila, i když se po ní nedá jet.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = growCity(content);
    const systems = [createTrafficSystem(content, balance)];

    // Dlaždice se odvodí od **skutečné budovy**, ne od kraje zóny: tam nemusí
    // nic stát a doprava by z ní nikdy nevyjížděla, takže by test neměřil nic.
    let street = -1;
    for (const building of [...world.buildings.values()].sort((p, q) => p.id - q.id)) {
      if (building.population === 0) continue;
      for (const dy of [-1, 1]) {
        const tile = index(building.x, building.y + dy, MAP_SIZE);
        if ((world.layers.road[tile] ?? 0) !== 0) street = tile;
      }
      if (street >= 0) break;
    }
    expect(street).toBeGreaterThanOrEqual(0);

    floodTile(world, street, 2, 250);
    world.trafficLoad.fill(0);
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);

    expect(world.trafficLoad[street]).toBe(0);
    expect(world.trafficLoad.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('je neprůjezdná', async () => {
    // Doprava se počítá z cest obyvatel do práce, takže je potřeba opravdové
    // město, ne jedna budova.
    const content = await vanilla();
    const balance = content.getBalance();

    const dry = growCity(content);
    const wet = growCity(content);
    for (let x = 0; x < MAP_SIZE; x++) {
      for (let y = 0; y < MAP_SIZE; y++) {
        const tile = index(x, y, MAP_SIZE);
        if ((wet.layers.road[tile] ?? 0) !== 0) floodTile(wet, tile, 2, 250);
      }
    }

    const systems = [createTrafficSystem(content, balance)];
    dry.trafficLoad.fill(0);
    wet.trafficLoad.fill(0);
    for (let tick = 0; tick < 60; tick++) {
      tickWorld(dry, systems);
      tickWorld(wet, systems);
    }

    const sum = (world: WorldState): number => world.trafficLoad.reduce((a, b) => a + b, 0);
    expect(sum(dry)).toBeGreaterThan(0);
    // Objížďka je součást škody, ne kosmetika: po zaplavené vozovce se nejezdí.
    expect(sum(wet)).toBe(0);
  });

  it('srazí cenu půdy, dokud voda neopadne', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) floodTile(world, index(x, y, MAP_SIZE), 2, 50);
    }

    const context = landValueContext(world, balance);
    expect(context.flood[0]).toBeCloseTo(1);

    const flooded = explainLandValue(world, balance, 0, context);
    const term = flooded.terms.find((entry) => entry.source === 'flood');
    expect(term).toBeDefined();
    expect(term?.amount ?? 0).toBeCloseTo(-balance.disasters.flood.landValuePenalty);

    // Na rozdíl od trosek je to dočasné: voda opadne a cena se vrátí sama.
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) drainTile(world, index(x, y, MAP_SIZE));
    }
    const dry = explainLandValue(world, balance, 0, landValueContext(world, balance));
    expect(dry.terms.some((entry) => entry.source === 'flood')).toBe(false);
    expect(dry.raw).toBeGreaterThan(flooded.raw);
  });
});
