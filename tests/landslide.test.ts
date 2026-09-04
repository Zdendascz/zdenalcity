import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad, placeDefinition } from '@/sim/commands';
import {
  createLandslideDisaster,
  isFreshlyTerraformed,
  steepestDescent,
} from '@/sim/disasters/landslide';
import type { ActiveDisaster } from '@/sim/disasters/state';
import { cornerIndex, countViolations, planCornerHeight, tileCorners } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { applyHeightChanges, createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { CORNER_SIZE, MAP_SIZE } from './support/grid';

/**
 * Sesuv půdy (T54, katalog 14).
 *
 * Jediná katastrofa, která **mění mapu**. Testy jsou proto hlavně o terénu:
 * že se zem přesune a neztratí, že po ní nezůstane nemožný tvar a že sesuv
 * nepadá tam, kde není svah.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Svah klesající k východu: každý sloupec rohů o patro níž než ten před ním. */
function slope(w: WorldState, fromX: number, height: number): void {
  for (let cy = 0; cy < CORNER_SIZE; cy++) {
    for (let cx = 0; cx < CORNER_SIZE; cx++) {
      const step = Math.max(0, height - Math.max(0, cx - fromX));
      w.cornerHeight[cornerIndex(cx, cy, CORNER_SIZE)] = Math.min(height, step);
    }
  }
}

function world(): WorldState {
  const w = createWorld(1, VANILLA_BALANCE.economy);
  w.economy.funds = 500000;
  return w;
}

/** Kolik dlaždic nese silnici. */
function countRoads(w: WorldState): number {
  let total = 0;
  for (const value of w.layers.road) if (value !== ROAD.none) total++;
  return total;
}

function active(x: number, y: number): ActiveDisaster {
  return { id: 1, kind: 'landslide', startedAtTick: 0, x, y, state: {}, finished: false };
}

async function run(w: WorldState, x: number, y: number): Promise<ContentRegistry> {
  const content = await vanilla();
  createLandslideDisaster().start(
    { world: w, catalogue: content, balance: VANILLA_BALANCE, x, y },
    active(x, y),
  );
  return content;
}

describe('kam se svah utrhne', () => {
  it('po spádnici, ne nahoru', () => {
    const w = world();
    slope(w, 10, 6);

    // Terén klesá k východu, takže i sesuv musí jít k východu.
    expect(steepestDescent(w, 12, 20)).toEqual([1, 0]);
  });

  it('na rovině se neutrhne nic', () => {
    // `null` znamená „tady není kam", ne chybu — plánovač to bere jako letos ne.
    expect(steepestDescent(world(), 40, 40)).toBeNull();
  });

  it('do vody se svah nesype', () => {
    // Sesuv končí na břehu. Kdyby šel dál, sypal by hlínu do moře a hladina by
    // se naklonila.
    const w = world();
    slope(w, 10, 6);
    for (let y = 0; y < w.size; y++) w.layers.terrain[index(14, y, MAP_SIZE)] = TERRAIN.water;

    expect(steepestDescent(w, 13, 20)).toBeNull();
  });
});

describe('sesuv přesune zem', () => {
  it('horní rohy klesnou, dolní stoupnou', async () => {
    // Tohle je celý sesuv: materiál se **přesune**, neztratí.
    const w = world();
    slope(w, 10, 6);
    const upper = cornerIndex(12, 20, CORNER_SIZE);
    const lower = cornerIndex(13, 20, CORNER_SIZE);
    const before = { upper: w.cornerHeight[upper] ?? 0, lower: w.cornerHeight[lower] ?? 0 };

    await run(w, 12, 20);

    expect(w.cornerHeight[upper]).toBeLessThan(before.upper);
    expect(w.cornerHeight[lower]).toBeGreaterThanOrEqual(before.lower);
  });

  it('po sesuvu nezůstane nemožný terén', async () => {
    // Sousední rohy smějí být nejvýš o patro od sebe. Kaskáda je součást jevu,
    // ne úklid po něm — utržený svah strhne i to nad sebou.
    const w = world();
    slope(w, 10, 6);
    expect(countViolations(w.cornerHeight)).toBe(0);

    await run(w, 12, 20);

    expect(countViolations(w.cornerHeight)).toBe(0);
  });

  it('mapa se změní trvale', async () => {
    // Jediná katastrofa, po které mapa nevypadá jako předtím. Ostatní ničí, co
    // na ní stojí.
    const w = world();
    slope(w, 10, 6);
    const before = Uint8Array.from(w.cornerHeight);

    await run(w, 12, 20);

    expect([...w.cornerHeight]).not.toEqual([...before]);
  });

  it('u vody sesuv skončí, nepřeskočí ji', async () => {
    // Hlína se sype do moře a tam to končí. Kdyby vodu přeskočil, objevil by se
    // na druhém břehu — a hladina by se cestou naklonila.
    const w = world();
    slope(w, 10, 6);
    for (let cy = 0; cy < CORNER_SIZE; cy++) {
      w.layers.terrain[index(13, cy, MAP_SIZE)] = TERRAIN.water;
    }
    const beyond = [
      cornerIndex(15, 20, CORNER_SIZE),
      cornerIndex(16, 20, CORNER_SIZE),
    ].map((corner) => w.cornerHeight[corner] ?? 0);

    await run(w, 11, 20);

    // Za vodou se nehnulo nic.
    expect(w.cornerHeight[cornerIndex(15, 20, CORNER_SIZE)]).toBe(beyond[0]);
    expect(w.cornerHeight[cornerIndex(16, 20, CORNER_SIZE)]).toBe(beyond[1]);
    expect(w.rubble[index(14, 20, MAP_SIZE)]).toBe(0);
  });

  it('okrajem dráhy nepodkope břeh', async () => {
    // Dráha je široká až tři dlaždice, takže její okraj umí zasáhnout vodu
    // vedle. Vodní dlaždice se do dráhy nepočítá — jinak by se zem **pod
    // hladinou** propadla o patro a pobřeží by se sesypalo samo od sebe.
    //
    // Seed 5 schválně: dává šířku tři. S jedničkou je dráha jednořadá, okraje
    // nemá a test by neověřoval nic.
    const w = createWorld(5, VANILLA_BALANCE.economy);
    w.economy.funds = 500000;
    slope(w, 10, 6);
    for (let x = 0; x < w.size; x++) w.layers.terrain[index(x, 21, MAP_SIZE)] = TERRAIN.water;
    const shore = [
      cornerIndex(11, 22, CORNER_SIZE),
      cornerIndex(12, 22, CORNER_SIZE),
    ];
    const before = shore.map((corner) => w.cornerHeight[corner] ?? 0);

    await run(w, 11, 20);

    // Roh za vodou klesne **nejvýš o patro**, a to jen kaskádou od dráhy vedle.
    // Kdyby se do dráhy počítala i vodní dlaždice, dostal by srážku ještě od ní
    // a břeh by se propadl o tři — naměřeno.
    for (const [i, corner] of shore.entries()) {
      expect((before[i] ?? 0) - (w.cornerHeight[corner] ?? 0), `roh ${i}`).toBeLessThanOrEqual(1);
    }
  });

  it('na rovině neudělá nic', async () => {
    const w = world();
    const before = Uint8Array.from(w.cornerHeight);

    await run(w, 40, 40);

    expect([...w.cornerHeight]).toEqual([...before]);
  });
});

describe('co sesuv strhne', () => {
  it('zboří, co stálo v dráze, a nechá trosky', async () => {
    const w = world();
    slope(w, 10, 6);
    const content = await vanilla();
    for (let x = 8; x < 20; x++) buildRoad(w, x, 20, ROAD.street, VANILLA_BALANCE);
    const tile = index(12, 20, MAP_SIZE);
    expect(w.layers.road[tile]).not.toBe(0);

    createLandslideDisaster().start(
      { world: w, catalogue: content, balance: VANILLA_BALANCE, x: 12, y: 20 },
      active(12, 20),
    );

    expect(w.layers.road[tile]).toBe(0);
    expect(w.rubble[tile]).not.toBe(0);
  });

  it('nezapaluje a nezamořuje', async () => {
    // Sesuv je hlína, ne exploze. Kdyby zapaloval, byl by to jen další výbuch.
    const w = world();
    slope(w, 10, 6);
    for (let x = 8; x < 20; x++) buildRoad(w, x, 20, ROAD.street, VANILLA_BALANCE);

    await run(w, 12, 20);

    expect([...w.fire].some((value) => value !== 0)).toBe(false);
  });

  it('srazí spokojenost za zbořené', async () => {
    const w = world();
    slope(w, 10, 6);
    const content = await vanilla();
    for (let x = 8; x < 20; x++) buildRoad(w, x, 20, ROAD.street, VANILLA_BALANCE);
    expect(
      placeDefinition(w, content, 'vanilla:park_small', 12, 21, VANILLA_BALANCE).ok,
    ).toBe(true);

    createLandslideDisaster().start(
      { world: w, catalogue: content, balance: VANILLA_BALANCE, x: 12, y: 21 },
      active(12, 21),
    );

    expect(w.buildings.size).toBe(0);
    expect(w.disasters.modifiers.some((m) => m.kind === 'happinessPenalty')).toBe(true);
  });
});

describe('kde sesuv vzniká', () => {
  it('bez svahu nemá kde', async () => {
    // Prázdná rovina: `null` znamená letos ne, ne chybu.
    const content = await vanilla();
    expect(createLandslideDisaster().pickOrigin(world(), content, VANILLA_BALANCE)).toBeNull();
  });

  it('vybere svah, ne rovinu', async () => {
    const w = world();
    slope(w, 10, 6);
    const content = await vanilla();

    const origin = createLandslideDisaster().pickOrigin(w, content, VANILLA_BALANCE);

    expect(origin).not.toBeNull();
    if (origin) expect(steepestDescent(w, origin.x, origin.y)).not.toBeNull();
  });
});

describe('čerstvě přesypaná půda', () => {
  it('terénní úprava si zapíše tik', () => {
    // Bez razítka by sesuv nevěděl, kde hráč nedávno kopal — a právě tam drží
    // půda nejhůř. Píše se v `applyHeightChanges`, protože tudy jde **každá**
    // změna terénu: ruční i ta, kterou si udělá silnice nebo zóna sama.
    const w = world();
    w.tick = 700;
    const tile = index(30, 30, MAP_SIZE);
    expect(w.terraformTick[tile]).toBe(0);

    applyHeightChanges(w, planCornerHeight(w.cornerHeight, 30, 30, 2));

    expect(w.terraformTick[tile]).toBe(700);
    expect(isFreshlyTerraformed(w, tile, 360)).toBe(true);
  });

  it('razítko dostanou i sousední dlaždice rohu', () => {
    // Roh drží čtyři dlaždice a hlína se přesypala pod všemi. Kdyby se
    // razítkovala jen jedna, byla by čerstvá půda vidět jen ze čtvrtiny.
    const w = world();
    w.tick = 50;

    applyHeightChanges(w, planCornerHeight(w.cornerHeight, 30, 30, 2));

    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      expect(w.terraformTick[index(30 + dx, 30 + dy, MAP_SIZE)], `${dx},${dy}`).toBe(50);
    }
  });

  it('stará úprava už čerstvá není', () => {
    const w = world();
    w.tick = 10;
    applyHeightChanges(w, planCornerHeight(w.cornerHeight, 30, 30, 2));

    w.tick = 10 + 400;

    expect(isFreshlyTerraformed(w, index(30, 30, MAP_SIZE), 360)).toBe(false);
  });

  it('po přetečení hodin se čerstvá půda pozná dál', () => {
    // Razítko je `tick & 0xffff`, tedy po 65 536 ticích začne od nuly. Kdyby se
    // stáří počítalo prostým odečtením plného tiku, vyšlo by po přetečení
    // pětašedesát tisíc a čerstvá půda by se hlásila jako prastará.
    const w = world();
    const tile = index(30, 30, MAP_SIZE);

    // 70 000 tiků je 194 herních let — mimo dosah Uint16.
    w.tick = 70000;
    applyHeightChanges(w, planCornerHeight(w.cornerHeight, 30, 30, 2));
    expect(w.terraformTick[tile]).toBe(70000 & 0xffff);

    w.tick = 70100;

    expect(isFreshlyTerraformed(w, tile, 360)).toBe(true);
    expect(isFreshlyTerraformed(w, tile, 50)).toBe(false);
  });

it('silnici, které sesuv podhrabal roh, zboří', async () => {
    // Sesuv hne rohy i **mimo svou dráhu** a dlaždice pod vozovkou tím
    // přestane být rovnoběžník. Do T87 taková silnice zůstala stát a kreslila
    // se našikmo přes zlom; autor to nahlásil obrázkem. Rozbitá silnice je
    // správná odpověď: přes utržený svah se jezdit nedá.
    const w = world();
    slope(w, 20, 6);

    // Silnice se staví **pod svahem, ne na něm**: stavba si srovná příčný
    // spád, takže pás vozovky přes svah by z něj udělal rovinu a sesuv by se
    // neměl kde utrhnout. Na tom padl první pokus o tenhle test.
    for (let x = 27; x <= 31; x++) {
      for (let y = 28; y <= 32; y++) {
        expect(buildRoad(w, x, y, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
      }
    }
    expect(countRoads(w)).toBe(25);

    await run(w, 24, 30);

    // **Nestačí, že něco spadlo.** Silnice v dráze boural sesuv i předtím;
    // vada byla v kaskádě, která hne rohy vedle dráhy. Testuje se proto
    // pravidlo, ne počet: po sesuvu nesmí zůstat vozovka na zkroucené
    // dlaždici. Zkroucená je ta, které se nerovnají součty protilehlých rohů
    // — rovina ani rovnoběžný svah takový tvar nemají.
    for (let tile = 0; tile < w.layers.road.length; tile++) {
      if ((w.layers.road[tile] ?? ROAD.none) === ROAD.none) continue;
      const x = tile % MAP_SIZE;
      const y = (tile - x) / MAP_SIZE;
      const [nw, ne, sw, se] = tileCorners(w.cornerHeight, x, y);
      expect(nw + se, `dlaždice ${x}, ${y} je zkroucená`).toBe(ne + sw);
    }
  });

  it('neupravená dlaždice není čerstvá', () => {
    // Nula znamená „nikdy", ne „v tiku nula".
    const w = world();
    w.tick = 5;
    expect(isFreshlyTerraformed(w, index(30, 30, MAP_SIZE), 360)).toBe(false);
  });
});
