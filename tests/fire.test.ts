import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, bulldoze, placeDefinition, zoneArea } from '@/sim/commands';
import {
  countBurning,
  createFireDisaster,
  createFireSystem,
  createWildfireDisaster,
  extinguishTile,
  flammableAt,
  igniteTile,
} from '@/sim/disasters/fire';
import { DisasterRegistry } from '@/sim/disasters/registry';
import { createDisasterSystem, startDisaster } from '@/sim/disasters/scheduler';
import { coarseCellsOfShape } from '@/sim/disasters/shapes';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { createDefaultSystems } from '@/sim/systems';
import { createWorld, setRoadTile, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

/**
 * Oheň (T48, §4 fáze 4).
 *
 * Jediná katastrofa s plnohodnotným šířením — a proto ta, na které stojí
 * polovina zbytku katalogu. Testuje se hlavně **závod**: buď hasiči srazí
 * intenzitu dřív, než dojde palivo, nebo dům shoří. Kdyby se ta rovnováha
 * rozešla, projeví se to jako „všechno vždycky shoří" nebo „oheň je k ničemu"
 * a obojí se pozná až dlouhým hraním.
 *
 * Druhá půlka je **průsek**: silnice a prázdná dlaždice nehoří, takže hráč má
 * proti ohni aktivní obranu. Bez toho by byl požár jen daň z rozpočtu.
 */

/** Prázdný katalog: stráže hořlavosti se na definice neptají. */
const EMPTY_CATALOGUE = new ContentRegistry();

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Svět s rovným terénem a bez vody — testy ohně nezajímá generátor. */
function flatWorld(content: ContentRegistry): WorldState {
  const world = createWorld(1, content.getBalance().economy);
  world.economy.funds = 1000000;
  return world;
}

/** Postaví řadu domů, ať je co zapálit. Vrací jejich souřadnice. */
function row(world: WorldState, content: ContentRegistry, y: number, from: number, to: number): void {
  const balance = content.getBalance();
  for (let x = from - 1; x <= to + 1; x++) buildRoad(world, x, y + 1, ROAD.street, balance);
  zoneArea(world, from, y, to - from + 1, 1, ZONE.residential);
  world.waterSupply.fill(1);

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 400; tick++) {
    tickWorld(world, systems);
    world.waterSupply.fill(1);
    for (const id of world.buildings.keys()) world.watered.add(id);
  }
}

function fireOnly(content: ContentRegistry): ReturnType<typeof createFireSystem>[] {
  return [createFireSystem(content, content.getBalance())];
}

describe('hořlavost dlaždice', () => {
  it('silnice, voda ani prázdná tráva nehoří', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();

    buildRoad(world, 10, 10, ROAD.street, balance);
    world.layers.terrain[index(11, 10, MAP_SIZE)] = TERRAIN.water;

    expect(flammableAt(world, content, balance, index(10, 10, MAP_SIZE)).flammability).toBe(0);
    expect(flammableAt(world, content, balance, index(11, 10, MAP_SIZE)).flammability).toBe(0);
    // Prázdná tráva: není co zapálit.
    expect(flammableAt(world, content, balance, index(12, 10, MAP_SIZE)).flammability).toBe(0);
  });

  it('les hoří nejlíp a má nejmíň paliva', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    world.layers.terrain[index(20, 20, MAP_SIZE)] = TERRAIN.forest;

    const forest = flammableAt(world, content, balance, index(20, 20, MAP_SIZE));
    expect(forest.flammability).toBeCloseTo(0.55);
    expect(forest.fuel).toBe(6);
  });

  it('silnice přebije i les — jinak by průsek nefungoval', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    world.layers.terrain[index(20, 20, MAP_SIZE)] = TERRAIN.forest;
    // Les se musí nejdřív vykácet — přesně to hráč při stavbě průseku dělá.
    expect(bulldoze(world, 20, 20, balance).ok).toBe(true);
    expect(buildRoad(world, 20, 20, ROAD.street, balance).ok).toBe(true);

    expect(flammableAt(world, content, balance, index(20, 20, MAP_SIZE)).flammability).toBe(0);
  });

  it('silnice nehoří ani nad hořlavým podkladem', () => {
    // **Stráž, ne běžný stav.** Dnešní příkazy silnici na les položit nedovolí,
    // protože se les musí nejdřív vykácet. Pravidlo „silnice je protipožární
    // linie" ale nesmí záviset na tom, co zrovna dovolují příkazy: stačilo by,
    // aby budoucí obsah povolil cestu lesem, a průsek — hráčova jediná aktivní
    // obrana proti ohni — by tiše přestal fungovat.
    const world = createWorld(1);
    const tile = index(20, 20, MAP_SIZE);
    world.layers.terrain[tile] = TERRAIN.forest;
    setRoadTile(world, tile, ROAD.street);

    expect(flammableAt(world, EMPTY_CATALOGUE, VANILLA_BALANCE, tile).flammability).toBe(0);
  });

  it('voda nehoří, i kdyby na ní něco leželo', () => {
    // Stejná stráž jako u silnice. Most přes řeku má pod sebou vodu a nesmí
    // ohni sloužit jako lávka.
    const world = createWorld(1);
    const tile = index(21, 21, MAP_SIZE);
    world.layers.terrain[tile] = TERRAIN.water;
    world.rubble = new Uint8Array(world.fire.length);
    world.rubble[tile] = 1;

    expect(flammableAt(world, EMPTY_CATALOGUE, VANILLA_BALANCE, tile).flammability).toBe(0);
  });

  it('opuštěná budova hoří hůř než obydlená', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    row(world, content, 30, 10, 14);

    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    const tile = index(building.x, building.y, MAP_SIZE);

    const alive = flammableAt(world, content, balance, tile).flammability;
    building.abandoned = true;
    const ruin = flammableAt(world, content, balance, tile).flammability;

    // Ruina je pro oheň pozvánka. Je to zároveň důvod, proč se vyplatí bourat.
    expect(ruin).toBeGreaterThan(alive);
    expect(ruin).toBeCloseTo(0.45);
  });

  it('park hoří výrazně hůř než ostatní služby', async () => {
    // Tohle je celý smysl `byClass`: park a hasičárna jsou obojí služba, ale
    // z parku se dá udělat bariéra a z hasičárny ne.
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();

    expect(placeDefinition(world, content, 'vanilla:park_small', 40, 40, balance).ok).toBe(true);
    for (let x = 43; x <= 47; x++) buildRoad(world, x, 42, ROAD.street, balance);
    expect(placeDefinition(world, content, 'vanilla:fire_station', 44, 40, balance).ok).toBe(true);

    const park = flammableAt(world, content, balance, index(40, 40, MAP_SIZE));
    const station = flammableAt(world, content, balance, index(44, 40, MAP_SIZE));

    expect(park.flammability).toBeCloseTo(0.05);
    expect(station.flammability).toBeCloseTo(0.18);
    expect(park.flammability).toBeLessThan(station.flammability);
    expect(park.fuel).toBeLessThan(station.fuel);
  });

  it('každá hořlavost má palivo', () => {
    // Obsah s hořlavostí bez paliva by hořel donekonečna.
    const fire = VANILLA_BALANCE.disasters.fire;
    for (const key of Object.keys(fire.flammability)) {
      expect(fire.fuel[key], key).toBeGreaterThan(0);
    }
  });
});

describe('ohňový tik', () => {
  it('bez hasičů dům shoří', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 14);
    const before = world.buildings.size;
    expect(before).toBeGreaterThan(0);

    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    igniteTile(world, content, content.getBalance(), index(building.x, building.y, MAP_SIZE), 100, false);

    const systems = fireOnly(content);
    for (let tick = 0; tick < 200; tick++) tickWorld(world, systems);

    expect(world.buildings.size).toBeLessThan(before);
  });

  it('s plným pokrytím hasičů dům přežije', async () => {
    // Práh záchrany obytné budovy je zhruba `coverage[fire] = 160`; tady je
    // pokrytí na maximu, takže musí uhasit s rezervou.
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 14);
    const before = world.buildings.size;

    const coverage = new Uint8Array(world.coarse.pollution.length).fill(255);
    world.coverage.set('fire', coverage);

    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    igniteTile(world, content, content.getBalance(), index(building.x, building.y, MAP_SIZE), 100, false);

    const systems = fireOnly(content);
    for (let tick = 0; tick < 200; tick++) tickWorld(world, systems);

    expect(world.buildings.size).toBe(before);
    expect(world.disasters.burning.normal).toBe(0);

    // Po uhašení nesmí zůstat viset ani palivo, ani příznak lesního požáru.
    // Zbytek starého stavu na dlaždici je tichá past pro všechno, co se ho
    // později zeptá — třeba počítadlo hořících dlaždic.
    for (let tile = 0; tile < world.fire.length; tile++) {
      expect(world.fuel[tile], `palivo na ${tile}`).toBe(0);
      expect(world.fireFlags[tile], `příznak na ${tile}`).toBe(0);
    }
  });

  it('slabé pokrytí nestačí — je to závod, ne vypínač', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 14);
    const before = world.buildings.size;

    // Pokrytí 40 přidá k základnímu hašení jen čtyři body, kdežto přírůstek
    // intenzity je šest. Oheň tedy pořád sílí.
    world.coverage.set('fire', new Uint8Array(world.coarse.pollution.length).fill(40));

    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    igniteTile(world, content, content.getBalance(), index(building.x, building.y, MAP_SIZE), 100, false);

    const systems = fireOnly(content);
    for (let tick = 0; tick < 200; tick++) tickWorld(world, systems);

    expect(world.buildings.size).toBeLessThan(before);
  });

  it('hoření znečišťuje okolí', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 14);

    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    const tile = index(building.x, building.y, MAP_SIZE);
    const cell = coarseCellsOfShape(world, { kind: 'point', x: building.x, y: building.y })[0] ?? 0;
    const before = world.coarse.pollution[cell] ?? 0;

    igniteTile(world, content, content.getBalance(), tile, 100, false);
    const systems = fireOnly(content);
    for (let tick = 0; tick < 6; tick++) tickWorld(world, systems);

    expect(world.coarse.pollution[cell] ?? 0).toBeGreaterThan(before);
  });

  it('vyhořelý dům srazí spokojenost celému městu', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 14);

    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');
    igniteTile(world, content, content.getBalance(), index(building.x, building.y, MAP_SIZE), 100, false);

    const systems = fireOnly(content);
    for (let tick = 0; tick < 200; tick++) tickWorld(world, systems);

    const penalty = world.disasters.modifiers.find((m) => m.kind === 'happinessPenalty');
    expect(penalty).toBeDefined();
    // Prázdný seznam buněk znamená celé město: vyhořelý dům je zpráva pro všechny.
    expect(penalty?.cells).toHaveLength(0);
  });
});

describe('šíření a průseky', () => {
  it('oheň přeskočí na souseda', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    // Souvislý les: hořlavost 0,55 je nejvyšší v tabulce, takže se to stane rychle.
    for (let x = 20; x < 40; x++) {
      for (let y = 20; y < 24; y++) world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.forest;
    }

    igniteTile(world, content, balance, index(21, 21, MAP_SIZE), 200, true);
    const systems = fireOnly(content);
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);

    // Něco muselo chytnout dál od ohniska, nebo už shořet na trávu.
    let touched = 0;
    for (let x = 20; x < 40; x++) {
      for (let y = 20; y < 24; y++) {
        const tile = index(x, y, MAP_SIZE);
        if ((world.fire[tile] ?? 0) > 0 || world.layers.terrain[tile] === TERRAIN.grass) touched++;
      }
    }
    expect(touched).toBeGreaterThan(1);
  });

  it('silniční průsek oheň zastaví', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();

    // Les vlevo, silniční pás uprostřed, les vpravo.
    for (let y = 20; y < 30; y++) {
      for (let x = 20; x < 30; x++) world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.forest;
      for (let x = 34; x < 44; x++) world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.forest;
      for (let x = 30; x < 34; x++) buildRoad(world, x, y, ROAD.street, balance);
    }

    igniteTile(world, content, balance, index(21, 25, MAP_SIZE), 220, true);
    const systems = fireOnly(content);
    for (let tick = 0; tick < 400; tick++) tickWorld(world, systems);

    // Za průsekem nesmí chytnout ani jedna dlaždice — silnice nehoří, takže
    // oheň nemá po čem přejít. Tohle je hráčova jediná aktivní obrana.
    let beyond = 0;
    for (let y = 20; y < 30; y++) {
      for (let x = 34; x < 44; x++) {
        const tile = index(x, y, MAP_SIZE);
        if ((world.fire[tile] ?? 0) > 0 || world.layers.terrain[tile] !== TERRAIN.forest) beyond++;
      }
    }
    expect(beyond).toBe(0);
  });

  it('buldozer hasí', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    world.layers.terrain[index(25, 25, MAP_SIZE)] = TERRAIN.forest;
    igniteTile(world, content, balance, index(25, 25, MAP_SIZE), 200, false);
    expect(world.fire[index(25, 25, MAP_SIZE)]).toBeGreaterThan(0);

    bulldoze(world, 25, 25, balance);
    expect(world.fire[index(25, 25, MAP_SIZE)]).toBe(0);
  });

  it('zapálit se dá jen to, co hoří', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    buildRoad(world, 15, 15, ROAD.street, balance);

    expect(igniteTile(world, content, balance, index(15, 15, MAP_SIZE), 100, false)).toBe(false);
    // Prázdná tráva taky ne.
    expect(igniteTile(world, content, balance, index(16, 15, MAP_SIZE), 100, false)).toBe(false);
  });

  it('hořící dlaždice se znovu nezapálí', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    const tile = index(25, 25, MAP_SIZE);
    world.layers.terrain[tile] = TERRAIN.forest;

    expect(igniteTile(world, content, balance, tile, 100, false)).toBe(true);
    // Druhý pokus by jinak vynuloval palivo a dlaždice by hořela navěky.
    expect(igniteTile(world, content, balance, tile, 200, false)).toBe(false);
    expect(world.fire[tile]).toBe(100);
  });
});

describe('lesní požár', () => {
  it('vyhořelý les se mění na trávu, ne na trosky', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    const tile = index(25, 25, MAP_SIZE);
    world.layers.terrain[tile] = TERRAIN.forest;

    igniteTile(world, content, balance, tile, 200, true);
    const systems = fireOnly(content);
    for (let tick = 0; tick < 60; tick++) tickWorld(world, systems);

    expect(world.layers.terrain[tile]).toBe(TERRAIN.grass);
    expect(world.fire[tile]).toBe(0);
  });

  it('hoří prudčeji než běžný požár', () => {
    // Zadání: počáteční intenzita 130 proti 100, přírůstek +9 proti +6,
    // šíření ×0,7 proti ×0,5, a vzniká z jediného ohniska.
    const fire = VANILLA_BALANCE.disasters.types['fire']?.burn;
    const wild = VANILLA_BALANCE.disasters.types['wildfire']?.burn;
    expect(fire?.ignitionIntensity).toBe(100);
    expect(wild?.ignitionIntensity).toBe(130);
    expect(wild?.intensityGrowth ?? 0).toBeGreaterThan(fire?.intensityGrowth ?? 0);
    expect(wild?.spreadChance ?? 0).toBeGreaterThan(fire?.spreadChance ?? 0);
    expect(wild?.maxIgnitions).toBe(1);
  });

  it('vzniká v lese, ne v zástavbě', async () => {
    // Ve městě je spousta hořlavého — domy hoří ochotněji než leckterý keř.
    // Lesní požár si přesto musí vybrat les, jinak by to byl obyčejný požár
    // s jiným jménem a hráč by přišel o čas na reakci, který mu má dát.
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 20);
    expect(world.buildings.size).toBeGreaterThan(0);

    // Lesík je **menší než město**. Kdyby byl velký, vyhrál by v losu i bez
    // podmínky na terén, protože souvislý les má vyšší váhu — a test by pak
    // neměřil nic.
    for (let x = 60; x < 63; x++) {
      for (let y = 60; y < 63; y++) world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.forest;
    }
    // A hasiči ať kryjí všechno — lesní požár je neřeší.
    world.coverage.set('fire', new Uint8Array(world.coarse.pollution.length).fill(255));

    for (let attempt = 0; attempt < 30; attempt++) {
      const origin = createWildfireDisaster().pickOrigin(world, content, content.getBalance());
      expect(origin).not.toBeNull();
      const tile = index(origin?.x ?? 0, origin?.y ?? 0, MAP_SIZE);
      expect(world.layers.terrain[tile], `pokus ${attempt}`).toBe(TERRAIN.forest);
    }
  });

  it('bez lesa nemá kde vzniknout', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    expect(createWildfireDisaster().pickOrigin(world, content, content.getBalance())).toBeNull();
  });

  it('hájí se od uhašení, ne od vzniku', () => {
    // Jinak by mohl začít druhý, zatímco první ještě hoří.
    expect(createWildfireDisaster().cooldownFromEnd).toBe(true);
    expect(createFireDisaster().cooldownFromEnd).toBeUndefined();
  });
});

describe('požár jako katastrofa', () => {
  it('hoří spíš tam, kde nikdo nehasí', async () => {
    // Vážený los je celý smysl: požár má hráče upozornit, že něco zanedbal.
    // Rovnoměrný los by z něj udělal daň z rozpočtu, na kterou se nedá
    // reagovat — a tenhle test je jediné místo, kde se ten rozdíl pozná.
    const content = await vanilla();
    const world = flatWorld(content);
    // Jedna dlouhá ulice: západní půlka pod plným pokrytím, východní bez ničeho.
    row(world, content, 20, 10, 45);
    expect(world.buildings.size).toBeGreaterThan(4);

    const coverage = new Uint8Array(world.coarse.pollution.length);
    let covered = 0;
    let bare = 0;
    for (const building of world.buildings.values()) {
      const cell = coarseCellsOfShape(world, { kind: 'point', x: building.x, y: building.y })[0];
      if (cell === undefined) continue;
      if (building.x < 28) {
        coverage[cell] = 255;
        covered++;
      } else {
        bare++;
      }
    }
    world.coverage.set('fire', coverage);
    expect(covered).toBeGreaterThan(0);
    expect(bare).toBeGreaterThan(0);

    const disaster = createFireDisaster();
    let west = 0;
    let east = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const origin = disaster.pickOrigin(world, content, content.getBalance());
      if (!origin) continue;
      if (origin.x < 28) west++;
      else east++;
    }

    expect(east).toBeGreaterThan(0);
    // Krytá čtvrť hoří výrazně méně. Není to zákaz — pokrytí váhu jen srazí.
    expect(east).toBeGreaterThan(west * 3);
  });

  it('vzniká tam, kde je co zapálit', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 20);

    const origin = createFireDisaster().pickOrigin(world, content, content.getBalance());
    expect(origin).not.toBeNull();
    const tile = index(origin?.x ?? 0, origin?.y ?? 0, MAP_SIZE);
    expect(flammableAt(world, content, content.getBalance(), tile).flammability).toBeGreaterThan(0);
  });

  it('v prázdném městě nemá kde vzniknout', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    expect(createFireDisaster().pickOrigin(world, content, content.getBalance())).toBeNull();
  });

  it('spuštěná z menu zapálí a skončí, až dohoří', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    row(world, content, 30, 10, 20);

    const registry = new DisasterRegistry();
    registry.register(createFireDisaster());
    const building = [...world.buildings.values()][0];
    if (!building) throw new Error('nic nevyrostlo');

    const entry = startDisaster(
      world,
      content,
      content.getBalance(),
      registry,
      'fire',
      building.x,
      building.y,
    );
    expect(entry).not.toBeNull();
    expect(world.disasters.burning.normal).toBeGreaterThan(0);
    expect(entry?.finished).toBe(false);

    const systems = [createFireSystem(content, content.getBalance())];
    for (let tick = 0; tick < 400; tick++) tickWorld(world, systems);
    expect(world.disasters.burning.normal).toBe(0);
  });

  it('spuštěná na holé pláni skončí hned', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const registry = new DisasterRegistry();
    registry.register(createFireDisaster());

    // Jinde ať klidně hoří: konec téhle katastrofy se pozná podle toho, že
    // nezapálila nic, ne podle toho, že ve městě náhodou nic nehoří.
    world.layers.terrain[index(90, 90, MAP_SIZE)] = TERRAIN.forest;
    igniteTile(world, content, content.getBalance(), index(90, 90, MAP_SIZE), 100, false);
    countBurning(world);
    expect(world.disasters.burning.normal).toBe(1);

    const entry = startDisaster(world, content, content.getBalance(), registry, 'fire', 60, 60);
    // Nic nechytlo, tedy se nic nestalo — a katastrofa je rovnou hotová.
    expect(entry?.finished).toBe(true);

    // Ze seznamu ji vyřadí až plánovač: uklízí se na jednom místě, ať se na
    // rušení postihů a zápis hájení nezapomene u některé z patnácti.
    const scheduler = createDisasterSystem(content, content.getBalance(), registry);
    tickWorld(world, [scheduler]);
    expect(world.disasters.active).toHaveLength(0);
  });
});

describe('počítadlo hořících dlaždic', () => {
  it('se dopočítá z vrstvy', async () => {
    const content = await vanilla();
    const world = flatWorld(content);
    const balance = content.getBalance();
    for (const [x, y] of [
      [25, 25],
      [26, 25],
      [40, 40],
    ] as const) {
      world.layers.terrain[index(x, y, MAP_SIZE)] = TERRAIN.forest;
    }

    igniteTile(world, content, balance, index(25, 25, MAP_SIZE), 100, false);
    igniteTile(world, content, balance, index(26, 25, MAP_SIZE), 100, false);
    igniteTile(world, content, balance, index(40, 40, MAP_SIZE), 100, true);

    // Po načtení savu se počty neukládají — dopočítají se odsud.
    world.disasters.burning = { normal: 0, wildfire: 0 };
    countBurning(world);
    expect(world.disasters.burning).toEqual({ normal: 2, wildfire: 1 });

    extinguishTile(world, index(25, 25, MAP_SIZE));
    countBurning(world);
    expect(world.disasters.burning).toEqual({ normal: 1, wildfire: 1 });
  });
});
