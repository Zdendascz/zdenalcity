import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { checkFootprint } from '@/sim/buildings';
import {
  buildRoad,
  bulldoze,
  estimatePlacement,
  estimateRoad,
  placeDefinition,
} from '@/sim/commands';
import {
  applyCornerChanges,
  cornerIndex,
  isFlatTile,
  isTwistedTile,
  MAX_HEIGHT,
  planCornerHeight,
  planUntwist,
} from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { createTrafficSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { assumeWatered } from './support/water';
import { MAP_SIZE, CORNER_SIZE } from './support/grid';

/** Cena ulice z dat, ať test nepřepisuje balanc. */
const STREET_COST = VANILLA_BALANCE.traffic.roadTypes[0]?.cost ?? 0;

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

function world(funds = 200000): WorldState {
  const created = createWorld(1, VANILLA_BALANCE.economy);
  created.economy.funds = funds;
  return created;
}

/** Zvedne roh i s kaskádou, aby vznikl skutečný svah. */
function raise(w: WorldState, x: number, y: number, h: number): void {
  applyCornerChanges(w.cornerHeight, planCornerHeight(w.cornerHeight, x, y, h));
}

describe('budovy chtějí rovinu (§7 fáze 3)', () => {
  it('na svahu se ručně nepostaví, dokud se parcela nesrovná', async () => {
    const content = await vanilla();
    const w = world();
    raise(w, 20, 20, 3);
    expect(isFlatTile(w.cornerHeight, 20, 20)).toBe(false);

    const definition = content.get('vanilla:park_small');
    expect(definition).toBeDefined();
    if (!definition) return;

    // Samotná kontrola půdorysu svah odmítne…
    expect(checkFootprint(w, definition, 20, 20).ok).toBe(false);
    expect(checkFootprint(w, definition, 20, 20).ok === false).toBe(true);

    // …ale stavba ho **srovná a postaví**, protože o to hráči jde.
    expect(placeDefinition(w, content, 'vanilla:park_small', 20, 20, VANILLA_BALANCE).ok).toBe(true);
    expect(isFlatTile(w.cornerHeight, 20, 20)).toBe(true);
  });

  it('cena srovnání se ukáže předem a sedí s tím, co se pak strhne (kritérium 14)', async () => {
    const content = await vanilla();
    const w = world();
    raise(w, 30, 30, 3);

    const plan = estimatePlacement(w, content, 'vanilla:park_small', 30, 30, VANILLA_BALANCE);
    expect(plan.levelling).toBeGreaterThan(0);
    expect(plan.total).toBe(plan.building + plan.levelling);

    const before = w.economy.funds;
    expect(placeDefinition(w, content, 'vanilla:park_small', 30, 30, VANILLA_BALANCE).ok).toBe(true);
    expect(before - w.economy.funds).toBe(plan.total);
  });

  it('odhad na rovině nic navíc neúčtuje', async () => {
    const content = await vanilla();
    const w = world();

    const plan = estimatePlacement(w, content, 'vanilla:park_small', 40, 40, VANILLA_BALANCE);

    expect(plan.levelling).toBe(0);
    expect(plan.total).toBe(plan.building);
    expect(plan.changes.size).toBe(0);
  });

  it('na svah bez peněz na srovnání se nestaví', async () => {
    const content = await vanilla();
    const w = world();
    raise(w, 50, 50, 4);

    const plan = estimatePlacement(w, content, 'vanilla:park_small', 50, 50, VANILLA_BALANCE);
    w.economy.funds = plan.total - 1;

    const result = placeDefinition(w, content, 'vanilla:park_small', 50, 50, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.notEnoughFunds');
    expect(isFlatTile(w.cornerHeight, 50, 50)).toBe(false); // terén se nehnul
  });

  it('na břehu se parcela srovná dolů, ne na průměr', async () => {
    // Našlo se to při hraní: elektrárna celá na souši se odmítala postavit
    // s hláškou „zvedat dno moře neumíme". Průměr rohů by totiž zvedl roh
    // sdílený s vodou a moře by se naklonilo. Pobřežní svah se proto odkope.
    const content = await vanilla();
    const w = world();
    raise(w, 70, 70, 4);
    // Voda hned vedle parcely, takže sdílí rohy.
    w.layers.terrain[index(71, 71, MAP_SIZE)] = TERRAIN.water;
    w.cornerHeight[cornerIndex(71, 71, CORNER_SIZE)] = 0;
    w.cornerHeight[cornerIndex(72, 71, CORNER_SIZE)] = 0;
    w.cornerHeight[cornerIndex(71, 72, CORNER_SIZE)] = 0;
    w.cornerHeight[cornerIndex(72, 72, CORNER_SIZE)] = 0;

    const result = placeDefinition(w, content, 'vanilla:park_small', 70, 70, VANILLA_BALANCE);

    expect(result.ok).toBe(true);
    expect(isFlatTile(w.cornerHeight, 70, 70)).toBe(true);
    // A hladina zůstala na nule — moře se nenaklonilo.
    for (const [cx, cy] of [
      [71, 71],
      [72, 71],
      [71, 72],
      [72, 72],
    ] as const) {
      expect(
        w.cornerHeight[cornerIndex(cx, cy, CORNER_SIZE)],
        `${cx},${cy}`,
      ).toBe(0);
    }
  });

  it('srovnání pod sousední budovou stavbu zastaví', async () => {
    // Kaskáda by sáhla pod budovu vedle, a tam se terén hýbat nesmí (T32).
    const content = await vanilla();
    const w = world();
    raise(w, 60, 60, 5);
    w.layers.buildingId[index(61, 60, MAP_SIZE)] = 3;

    const result = placeDefinition(w, content, 'vanilla:park_small', 60, 60, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.terraformBuilding');
  });
});

describe('silnice na svahu', () => {
  it('rovnoměrný svah vozovka snese', () => {
    const w = world();
    // Svah stoupající na východ: obě východní rohy o patro výš.
    w.cornerHeight[cornerIndex(11, 10, CORNER_SIZE)] = 1;
    w.cornerHeight[cornerIndex(11, 11, CORNER_SIZE)] = 1;

    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
  });

  it('zkroucenou dlaždici si silnice srovná sama', () => {
    // Sedlo: protilehlé rohy nahoře. Po takové dlaždici se nedá jet po rovině,
    // ale hráč kvůli tomu nemá hledat, na který ze čtyř rohů má kliknout —
    // silnice roh srovná a připočte terraforming (T61).
    const w = world();
    w.cornerHeight[cornerIndex(20, 20, CORNER_SIZE)] = 1;
    w.cornerHeight[cornerIndex(21, 21, CORNER_SIZE)] = 1;
    const before = w.economy.funds;

    expect(buildRoad(w, 20, 20, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(isTwistedTile(w.cornerHeight, 20, 20)).toBe(false);
    expect(before - w.economy.funds).toBeGreaterThan(STREET_COST);
  });

  it('srovnání se účtuje po rozích, ne paušálem', () => {
    // Cena musí sedět na počet rohů, které se opravdu hnuly. Paušál by dělal
    // z mělkého sedla stejně drahou stavbu jako z hlubokého.
    const w = world();
    w.cornerHeight[cornerIndex(20, 20, CORNER_SIZE)] = 1;
    w.cornerHeight[cornerIndex(21, 21, CORNER_SIZE)] = 1;

    const plan = planUntwist(w.cornerHeight, 20, 20);
    expect(plan.size).toBeGreaterThan(0);

    const before = w.economy.funds;
    expect(buildRoad(w, 20, 20, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(before - w.economy.funds).toBe(
      STREET_COST + plan.size * VANILLA_BALANCE.map.terraformCost,
    );
  });

  it('náhled ceny sedí na to, co se strhne', () => {
    // Cenovka při tažení počítá `estimateRoad`, kasu strhává `buildRoad`.
    // Jsou to dvě cesty ke stejnému číslu a musí se shodnout — jinak hráč
    // vidí deset a zaplatí devadesát.
    const cases: [number, number, () => WorldState][] = [
      [30, 30, () => world()],
      [31, 31, () => {
        const w = world();
        w.layers.terrain[index(31, 31, MAP_SIZE)] = TERRAIN.forest;
        return w;
      }],
      [32, 32, () => {
        const w = world();
        w.layers.terrain[index(32, 32, MAP_SIZE)] = TERRAIN.rock;
        return w;
      }],
      [33, 33, () => {
        const w = world();
        w.cornerHeight[cornerIndex(33, 33, CORNER_SIZE)] = 1;
        w.cornerHeight[cornerIndex(34, 34, CORNER_SIZE)] = 1;
        return w;
      }],
    ];

    for (const [x, y, make] of cases) {
      const w = make();
      const preview = estimateRoad(w, x, y, ROAD.street, VANILLA_BALANCE).total;
      const before = w.economy.funds;

      expect(buildRoad(w, x, y, ROAD.street, VANILLA_BALANCE).ok, `${x},${y}`).toBe(true);
      expect(before - w.economy.funds, `${x},${y}`).toBe(preview);
    }
  });

  it('u stropu výšky se roh nezvedá nad něj', () => {
    // Sedlo těsně pod stropem. Dva ze čtyř rohů by se musely zvednout na 16;
    // `planCornerHeight` cíl ořízne na 15, takže plán vznikne — a byl by
    // dokonce ten nejlevnější, jen by dlaždici nesrovnal. Proto se výsledek
    // ověřuje, ne předpokládá.
    const w = world();
    // Náhorní plošina, ať kaskáda nesjíždí až k nule a plán zůstane malý.
    for (let cy = 36; cy <= 46; cy++) {
      for (let cx = 36; cx <= 46; cx++) raise(w, cx, cy, MAX_HEIGHT - 1);
    }
    w.cornerHeight[cornerIndex(40, 40, CORNER_SIZE)] = MAX_HEIGHT;
    w.cornerHeight[cornerIndex(41, 41, CORNER_SIZE)] = MAX_HEIGHT;
    expect(isTwistedTile(w.cornerHeight, 40, 40)).toBe(true);

    expect(buildRoad(w, 40, 40, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(isTwistedTile(w.cornerHeight, 40, 40)).toBe(false);
    for (const height of w.cornerHeight) expect(height).toBeLessThanOrEqual(MAX_HEIGHT);
  });

  it('srovnaná dlaždice je rovná terasa, ne osamocený špičák', () => {
    // Nahlásil autor: silnice tažená šikmo přes svah nechala za sebou schodiště
    // z jehel. Sedlo šlo zrušit i jedním rohem — levněji — jenže z dlaždice se
    // pak stala špička mezi sousedy. Dozdí se proto **celá**.
    const w = world();
    // Roh 1 patro nad okolím: sedlo, které jedním rohem zrušit jde.
    w.cornerHeight[cornerIndex(51, 51, CORNER_SIZE)] = 1;
    expect(isTwistedTile(w.cornerHeight, 50, 50)).toBe(true);

    expect(buildRoad(w, 50, 50, ROAD.street, VANILLA_BALANCE).ok).toBe(true);

    const [nw, ne, sw, se] = [
      [50, 50], [51, 50], [50, 51], [51, 51],
    ].map(([cx, cy]) => w.cornerHeight[cornerIndex(cx ?? 0, cy ?? 0, CORNER_SIZE)] ?? 0);

    expect(isTwistedTile(w.cornerHeight, 50, 50)).toBe(false);
    // Rovná, ne jen nezkroucená: čtyři stejné rohy.
    expect(new Set([nw, ne, sw, se]).size).toBe(1);
    // A dozděná nahoru, ne odkopaná dolů.
    expect(nw).toBe(1);
  });

  it('srovnání nikdy nekope', () => {
    // Levnější cesta ze sedla často vede dolů. Kdyby si ji silnice vzala,
    // vyhloubila by hráči ve svahu díru tam, kde čekal násep.
    const w = world();
    w.cornerHeight[cornerIndex(61, 61, CORNER_SIZE)] = 1;
    const before = Uint8Array.from(w.cornerHeight);

    expect(buildRoad(w, 60, 60, ROAD.street, VANILLA_BALANCE).ok).toBe(true);

    for (let i = 0; i < before.length; i++) {
      expect(w.cornerHeight[i] ?? 0, `roh ${i}`).toBeGreaterThanOrEqual(before[i] ?? 0);
    }
  });

  it('nezkroucená dlaždice dostane prázdný plán, ne odmítnutí', () => {
    // Dvě různé odpovědi: „nemám co dělat" je prázdný plán. Kdyby se místo něj
    // vracelo odmítnutí, silnice by se neplatila jen na sedlech, ale nikde.
    const w = world();
    // Rovná dlaždice.
    expect(planUntwist(w.cornerHeight, 70, 70).size).toBe(0);

    // Rovnoměrný svah — taky není sedlo, i když rovný není.
    w.cornerHeight[cornerIndex(71, 70, CORNER_SIZE)] = 1;
    w.cornerHeight[cornerIndex(71, 71, CORNER_SIZE)] = 1;
    expect(isTwistedTile(w.cornerHeight, 70, 70)).toBe(false);
    expect(planUntwist(w.cornerHeight, 70, 70).size).toBe(0);
  });

  it('rovnou dlaždici nikdo nesrovnává', () => {
    // Kdyby se plán počítal vždycky, platil by hráč terraforming i na rovině.
    const w = world();
    const before = w.economy.funds;

    expect(buildRoad(w, 22, 22, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(before - w.economy.funds).toBe(STREET_COST);
  });

  it('budova u sedla srovnání zastaví', () => {
    // Srovnání hne rohem, o který se dělí čtyři dlaždice. Kdyby na jedné
    // stála budova, spadla by hráči do svahu, aniž by o to řekl.
    const w = world();
    w.cornerHeight[cornerIndex(20, 20, CORNER_SIZE)] = 1;
    w.cornerHeight[cornerIndex(21, 21, CORNER_SIZE)] = 1;
    for (const [bx, by] of [
      [19, 19], [20, 19], [21, 19],
      [19, 20], [21, 20],
      [19, 21], [20, 21], [21, 21],
    ] as const) {
      w.layers.buildingId[index(bx, by, MAP_SIZE)] = 7;
    }

    const result = buildRoad(w, 20, 20, ROAD.street, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.terraformBuilding');
  });
});

describe('mosty (§7 fáze 3)', () => {
  /** Řeka svisle přes mapu a silnice na obou březích. */
  function riverbanks(w: WorldState): void {
    for (let y = 0; y < w.size; y++)
      w.layers.terrain[index(30, y, MAP_SIZE)] = TERRAIN.water;
    for (let x = 25; x <= 29; x++)
      buildRoad(w, x, 40, ROAD.street, VANILLA_BALANCE);
    for (let x = 31; x <= 35; x++)
      buildRoad(w, x, 40, ROAD.street, VANILLA_BALANCE);
  }

  it('most se staví z břehu a stojí vlastní cenu', () => {
    const w = world();
    riverbanks(w);
    const before = w.economy.funds;

    expect(buildRoad(w, 30, 40, ROAD.street, VANILLA_BALANCE).ok).toBe(true);

    expect(w.layers.road[index(30, 40, MAP_SIZE)]).toBe(ROAD.street);
    expect(w.layers.terrain[index(30, 40, MAP_SIZE)]).toBe(TERRAIN.water); // pořád voda pod ním
    expect(before - w.economy.funds).toBe(VANILLA_BALANCE.traffic.bridgeCost);
    expect(VANILLA_BALANCE.traffic.bridgeCost).toBeGreaterThan(
      VANILLA_BALANCE.traffic.roadTypes[0]?.cost ?? 0,
    );
  });

  it('uprostřed vody most nezačne', () => {
    const w = world();
    for (let y = 0; y < w.size; y++)
      w.layers.terrain[index(30, y, MAP_SIZE)] = TERRAIN.water;

    const result = buildRoad(w, 30, 40, ROAD.street, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.bridgeNeedsBank');
  });

  it('zbouraný most nechá vodu vodou', () => {
    const w = world();
    riverbanks(w);
    buildRoad(w, 30, 40, ROAD.street, VANILLA_BALANCE);

    expect(bulldoze(w, 30, 40, VANILLA_BALANCE).ok).toBe(true);

    expect(w.layers.road[index(30, 40, MAP_SIZE)]).toBe(ROAD.none);
    expect(w.layers.terrain[index(30, 40, MAP_SIZE)]).toBe(TERRAIN.water);
  });

  it('doprava po mostě projde (§12 kritérium 15)', async () => {
    const content = await vanilla();
    const balance = content.getBalance();
    const w = world();
    riverbanks(w);

    const house = content.get('vanilla:residential_small');
    const shop = content.get('vanilla:commercial_small');
    expect(house && shop).toBeTruthy();
    if (!house || !shop) return;

    // Dům na levém břehu, práce na pravém — mezi nimi jen řeka.
    assumeWatered(w); // test je o mostě, ne o vodovodu
    const built = placeDefinition(w, content, house.id, 27, 41, balance);
    expect(built.ok).toBe(true);
    for (const building of w.buildings.values()) building.population = 8;
    expect(placeDefinition(w, content, shop.id, 33, 41, balance).ok).toBe(true);

    const traffic = [createTrafficSystem(content, balance)];
    const access = (): number => {
      for (let tick = 0; tick < 40; tick++) tickWorld(w, traffic);
      let sum = 0;
      for (const value of w.jobAccess.values()) sum += value;
      return sum;
    };

    const bezMostu = access();
    expect(buildRoad(w, 30, 40, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    const sMostem = access();

    expect(bezMostu).toBe(0); // přes vodu se nedostane nikdo
    expect(sMostem).toBeGreaterThan(0);
  });
});
