/**
 * @vitest-environment jsdom
 *
 * Podzemní pohled se kreslí do `Graphics`, a ten si Pixi vyžádá `navigator`.
 * Ostatní testy v souboru DOM nepotřebují; pragma je za jeden soubor levnější
 * než rozdělovat vyhodnocení fáze do dvou.
 */
import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { bulldoze, buildPipe, buildRoad, placeDefinition } from '@/sim/commands';
import { coarseIndex } from '@/sim/coarse';
import { coarseCongestion } from '@/sim/diagnostics';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { createLandValueSystem, createTrafficSystem } from '@/sim/systems';
import { generateTerrain } from '@/sim/mapgen';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { ChunkRenderer, viewportFor } from '@/render/chunkRenderer';
import type { Balance } from '@/content/balance';
import { VANILLA_BALANCE } from './support/balance';

/**
 * Vyhodnocení fáze 3 (T41).
 *
 * Sada je tu ze stejného důvodu jako `phase4.test.ts`: **průřezová tvrzení
 * nemají kde vzniknout, když každý úkol testuje jen sebe.** Kritérium 4 stojí
 * mezi terénem a cenou půdy, kritérium 5 mezi typy silnic a dopravou,
 * kritérium 18 mezi sítí a rendererem. Každá půlka svůj test měla, spojka ne.
 *
 * Co drží sady jednotlivých úkolů, se sem nekopíruje.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/* --------------------------------------------- kritérium 4: les a cena --- */

describe('kritérium 4 — vykácení lesa uvolní místo a srazí cenu půdy', () => {
  /** Ustálená cena půdy v buňce kolem daných souřadnic. */
  function settledValue(world: WorldState, x: number, y: number): number {
    const system = createLandValueSystem(VANILLA_BALANCE);
    // Cena se hýbe po zlomcích (`smoothing`), takže se musí nechat dojet.
    for (let tick = 0; tick < 16 * 60; tick++) tickWorld(world, [system]);
    return world.coarse.landValue[coarseIndex(x, y, world.size)] ?? 0;
  }

  /** Mapa s lesem přes celou buňku hrubé mřížky kolem (64, 64). */
  function forestAround(size = 16): WorldState {
    const world = createWorld(1);
    for (let y = 64 - size; y <= 64 + size; y++) {
      for (let x = 64 - size; x <= 64 + size; x++) {
        world.layers.terrain[index(x, y, world.size)] = TERRAIN.forest;
      }
    }
    return world;
  }

  it('les cenu půdy v okolí zvedá', () => {
    // Kontrolní půlka. Bez ní by test níž mohl klesat z jakéhokoli důvodu.
    const sLesem = settledValue(forestAround(), 64, 64);
    const bezLesa = settledValue(createWorld(1), 64, 64);

    expect(sLesem).toBeGreaterThan(bezLesa);
  });

  it('vykácení ji zase srazí', () => {
    const world = forestAround();
    world.economy.funds = 1_000_000;
    const pred = settledValue(world, 64, 64);

    for (let y = 48; y <= 80; y++) {
      for (let x = 48; x <= 80; x++) bulldoze(world, x, y, VANILLA_BALANCE);
    }

    expect(world.layers.terrain[index(64, 64, world.size)]).toBe(TERRAIN.grass);
    expect(settledValue(world, 64, 64)).toBeLessThan(pred);
  });

  it('a uvolní místo, na kterém les stavbu nedovolil', async () => {
    // „Uvolní místo" je druhá půlka kritéria. Sama o sobě je to tvrzení
    // o stavebních pravidlech, ale s cenou půdy tvoří tu volbu, o kterou jde:
    // hráč platí za stavební parcelu tím, že si srazí okolí.
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 1_000_000;
    for (let x = 60; x <= 70; x++) {
      world.layers.terrain[index(x, 64, world.size)] = TERRAIN.forest;
      buildRoad(world, x, 63, ROAD.street, balance);
    }

    const naLes = placeDefinition(world, content, 'vanilla:park_small', 64, 64, balance);
    expect(naLes.ok).toBe(false);

    expect(bulldoze(world, 64, 64, balance).ok).toBe(true);
    expect(placeDefinition(world, content, 'vanilla:park_small', 64, 64, balance).ok).toBe(true);
  });
});

/* ------------------------------------- kritérium 5: třída sníží kolony --- */

describe('kritérium 5 — vylepšení ulice na třídu sníží kolony na úseku', () => {
  /**
   * Ulice mezi domem a obchodem, s vylepšeným prostředním úsekem, nebo bez něj.
   *
   * Měří se **součet přes 200 tiků, ne hodnota v jednom**: doprava se vzorkuje
   * (`attempts` v balancu), takže zátěž na jedné dlaždici mezi tiky poskakuje
   * 0–4 a jediný odečet by netvrdil nic. A měří se **dva světy vedle sebe**,
   * ne jeden před a po — RNG běží dál a druhé měření by nebylo srovnatelné
   * s prvním.
   */
  async function measure(
    upgrade: number | null,
    ticks = 200,
  ): Promise<{ load: number; congestion: number }> {
    const content = await vanilla();
    const balance = content.getBalance();
    const world = createWorld(1, balance.economy);
    world.economy.funds = 1_000_000;

    for (let x = 10; x <= 30; x++) buildRoad(world, x, 10, ROAD.street, balance);
    if (upgrade !== null) {
      for (let x = 18; x <= 22; x++) buildRoad(world, x, 10, upgrade, balance);
    }

    // Staví se pod stavebními pravidly, ne přes ně: test je o dopravě, ne
    // o vodovodu, a `placeDefinition` by chtěl potrubí i rovinu.
    const house = content.get('vanilla:residential_small');
    const shop = content.get('vanilla:commercial_small');
    if (!house || !shop) throw new Error('chybí vanilla obsah');
    placeBuilding(world, house, 11, 11).population = 8;
    placeBuilding(world, shop, 29, 11);

    const system = createTrafficSystem(content, balance);
    let load = 0;
    let congestion = 0;
    for (let tick = 0; tick < ticks; tick++) {
      tickWorld(world, [system]);
      for (let x = 18; x <= 22; x++) load += world.trafficLoad[index(x, 10, world.size)] ?? 0;
      congestion += coarseCongestion(world, balance)[coarseIndex(20, 10, world.size)] ?? 0;
    }
    return { load, congestion };
  }

  it('týž úsek je po vylepšení míň vytížený', async () => {
    const ulice = await measure(null);
    const trida = await measure(ROAD.avenue);

    expect(ulice.congestion).toBeGreaterThan(0);
    expect(trida.congestion).toBeLessThan(ulice.congestion);
  });

  it('ubyde vytížení, ne aut', async () => {
    // Kdyby vylepšení ubíralo zátěž, byla by to sleva na dopravě místo
    // investice do kapacity. Hráč staví širší silnici, ne míň cest — a je to
    // rozdíl, který na overlayi vypadá stejně a v modelu ne.
    const ulice = await measure(null);
    const trida = await measure(ROAD.avenue);

    expect(trida.load).toBe(ulice.load);
  });

  it('dálnice ubere víc než třída', async () => {
    // Kontrolní případ: kdyby na typu nezáleželo a klesalo se z jiného důvodu,
    // vyšly by oba stejně.
    const trida = await measure(ROAD.avenue);
    const dalnice = await measure(ROAD.highway);

    expect(dalnice.congestion).toBeLessThan(trida.congestion);
  });
});

/* --------------------------- kritérium 18: podzemní pohled ukáže síť ---- */

/** Barvy výplní, které renderer do chunku zapsal. */
function fills(graphics: Graphics): number[] {
  const context = graphics.context as unknown as {
    instructions: { action: string; data: { style?: { color?: number } } }[];
  };
  return context.instructions
    .filter((instruction) => instruction.action === 'fill')
    .map((instruction) => instruction.data.style?.color ?? -1);
}

/** Chunky, které renderer upekl. */
function bakedFills(world: WorldState, overlay: 'none' | 'underground'): number[] {
  const container = new Container();
  const renderer = new ChunkRenderer(world, container);
  renderer.setOverlay(overlay);
  // Rozpočet nula znamená „právě jeden zastaralý chunk za snímek"; díra se
  // dopeče vždycky. Pár průchodů stačí, protože se dívá jen na kus mapy.
  const view = viewportFor(0, 0, 1, 400, 300);
  for (let frame = 0; frame < 8; frame++) renderer.cull(view, 0);

  const out: number[] = [];
  for (const child of container.children[0]?.children ?? []) {
    if (child instanceof Graphics) out.push(...fills(child));
  }
  return out;
}

describe('kritérium 18 — podzemní pohled ukáže síť a pokrytí', () => {
  /** Potrubí kolem počátku mapy, kam se kamera na (0, 0) dívá. */
  function piped(wet: boolean): WorldState {
    const world = createWorld(1);
    world.economy.funds = 1_000_000;
    for (let x = 0; x < 12; x++) buildPipe(world, x, 0, VANILLA_BALANCE);
    if (wet) world.waterSupply.fill(1);
    return world;
  }

  it('suchá trubka se kreslí jinou barvou než zavodněná', () => {
    // Bez toho vypadá síť, která nikam nedosáhla, přesně jako ta funkční —
    // a hráč nemá jak poznat, proč mu domy chátrají.
    //
    // Tvrdí se, že barva suché trubky **ze zavodněné mapy zmizí**. Opačná
    // formulace („mokrá má barvu navíc") by prošla i tehdy, kdyby obě trubky
    // byly stejné — tu barvu navíc přidává pokrytí vodou, ne trubka.
    const sucha = new Set(bakedFills(piped(false), 'underground'));
    const mokra = new Set(bakedFills(piped(true), 'underground'));

    expect([...sucha].some((color) => !mokra.has(color))).toBe(true);
  });

  it('pokrytí vodou je vidět i tam, kde trubka není', () => {
    // Pokrytí je dosah sítě, ne sama trubka. Kdyby se kreslila jen trubka,
    // hráč by nevěděl, kam až voda dosáhne, a stavěl by naslepo.
    //
    // Měří se na mapě **bez jediné trubky**, aby se do rozdílu nepřimíchala
    // barva potrubí — jinak by test prošel i s nekresleným pokrytím.
    const prazdna = createWorld(1);
    const pokryta = createWorld(1);
    pokryta.waterSupply.fill(1);

    const bez = new Set(bakedFills(prazdna, 'underground'));
    const s = new Set(bakedFills(pokryta, 'underground'));

    expect([...s].some((color) => !bez.has(color))).toBe(true);
  });

  it('na povrchu se potrubí nekreslí vůbec', () => {
    // Kontrolní případ: kdyby se síť kreslila pořád, netvrdil by test nic
    // o podzemním pohledu.
    const podzemi = bakedFills(piped(true), 'underground');
    const povrch = bakedFills(piped(true), 'none');

    expect(podzemi).not.toEqual(povrch);
    // Trubka je jediné, co na téhle mapě přibylo — povrch má tedy míň výplní.
    expect(povrch.length).toBeLessThan(podzemi.length);
  });
});

/* ---------------------- průřezově: žádná konstanta balancu v kódu (§10) --- */

describe('parametry generátoru jsou v datech, ne v kódu', () => {
  /**
   * T22 předepisoval „parametry v `balance.json`", jenže měřítka šumu
   * a strop zaplavovaných ostrůvků zůstaly v kódu — vedle `octaves`
   * a `roughness`, které jdou do **téhož volání** a v datech byly. Testy tady
   * tvrdí, že se hodnoty opravdu berou z balancu; jinak by je šlo přesunout
   * a nechat kód číst si dál svoje.
   */
  function withMap(patch: Partial<Balance['map']>): Balance {
    return { ...VANILLA_BALANCE, map: { ...VANILLA_BALANCE.map, ...patch } };
  }

  /** Podíl vody na mapě. Hrubá, ale na parametry citlivá míra tvaru. */
  function waterShare(balance: Balance, seed: number): number {
    const map = generateTerrain(seed, balance, 64);
    let water = 0;
    for (const tile of map.terrain) if (tile === TERRAIN.water) water++;
    return water / map.terrain.length;
  }

  it('měřítko výškového šumu mění tvar pevniny', () => {
    const drobne = generateTerrain(7, withMap({ heightScale: 8 }), 64);
    const rozlehle = generateTerrain(7, withMap({ heightScale: 80 }), 64);

    expect([...drobne.cornerHeight]).not.toEqual([...rozlehle.cornerHeight]);
  });

  it('měřítko lesního šumu mění, kde les roste', () => {
    const drobny = generateTerrain(7, withMap({ forestScale: 4 }), 64);
    const souvisly = generateTerrain(7, withMap({ forestScale: 60 }), 64);

    expect([...drobny.terrain]).not.toEqual([...souvisly.terrain]);
  });

  it('strop zaplavovaných ostrůvků opravdu zaplavuje', () => {
    // Vyšší strop utopí i větší odříznuté kusy, takže vody přibyde. Řeky musí
    // téct — bez koryta se ostrůvek nemá jak odříznout a parametr nic nedělá.
    //
    // Přes několik seedů: na jednom konkrétním nemusí koryto odříznout nic,
    // co by mezi oba prahy padlo.
    const nizky = withMap({ rivers: 4, scrapIslandTiles: 4 });
    const vysoky = withMap({ rivers: 4, scrapIslandTiles: 400 });

    const seedy = [1, 2, 3, 4, 5, 6, 7, 8];
    const rozdily = seedy.filter((seed) => waterShare(vysoky, seed) > waterShare(nizky, seed));

    expect(rozdily.length).toBeGreaterThan(0);
  });
});
