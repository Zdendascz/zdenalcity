import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { checkFootprint } from '@/sim/buildings';
import { buildRoad, bulldoze, estimatePlacement, placeDefinition } from '@/sim/commands';
import { applyCornerChanges, cornerIndex, isFlatTile, planCornerHeight } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { createTrafficSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { assumeWatered } from './support/water';

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
    w.layers.terrain[index(71, 71)] = TERRAIN.water;
    w.cornerHeight[cornerIndex(71, 71)] = 0;
    w.cornerHeight[cornerIndex(72, 71)] = 0;
    w.cornerHeight[cornerIndex(71, 72)] = 0;
    w.cornerHeight[cornerIndex(72, 72)] = 0;

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
      expect(w.cornerHeight[cornerIndex(cx, cy)], `${cx},${cy}`).toBe(0);
    }
  });

  it('srovnání pod sousední budovou stavbu zastaví', async () => {
    // Kaskáda by sáhla pod budovu vedle, a tam se terén hýbat nesmí (T32).
    const content = await vanilla();
    const w = world();
    raise(w, 60, 60, 5);
    w.layers.buildingId[index(61, 60)] = 3;

    const result = placeDefinition(w, content, 'vanilla:park_small', 60, 60, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.terraformBuilding');
  });
});

describe('silnice na svahu', () => {
  it('rovnoměrný svah vozovka snese', () => {
    const w = world();
    // Svah stoupající na východ: obě východní rohy o patro výš.
    w.cornerHeight[cornerIndex(11, 10)] = 1;
    w.cornerHeight[cornerIndex(11, 11)] = 1;

    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
  });

  it('zkroucená dlaždice ji nepobere', () => {
    // Sedlo: protilehlé rohy nahoře. Po takové dlaždici se nedá jet po rovině.
    const w = world();
    w.cornerHeight[cornerIndex(20, 20)] = 1;
    w.cornerHeight[cornerIndex(21, 21)] = 1;

    const result = buildRoad(w, 20, 20, ROAD.street, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.roadTwisted');
  });
});

describe('mosty (§7 fáze 3)', () => {
  /** Řeka svisle přes mapu a silnice na obou březích. */
  function riverbanks(w: WorldState): void {
    for (let y = 0; y < w.size; y++) w.layers.terrain[index(30, y)] = TERRAIN.water;
    for (let x = 25; x <= 29; x++) buildRoad(w, x, 40, ROAD.street, VANILLA_BALANCE);
    for (let x = 31; x <= 35; x++) buildRoad(w, x, 40, ROAD.street, VANILLA_BALANCE);
  }

  it('most se staví z břehu a stojí vlastní cenu', () => {
    const w = world();
    riverbanks(w);
    const before = w.economy.funds;

    expect(buildRoad(w, 30, 40, ROAD.street, VANILLA_BALANCE).ok).toBe(true);

    expect(w.layers.road[index(30, 40)]).toBe(ROAD.street);
    expect(w.layers.terrain[index(30, 40)]).toBe(TERRAIN.water); // pořád voda pod ním
    expect(before - w.economy.funds).toBe(VANILLA_BALANCE.traffic.bridgeCost);
    expect(VANILLA_BALANCE.traffic.bridgeCost).toBeGreaterThan(
      VANILLA_BALANCE.traffic.roadTypes[0]?.cost ?? 0,
    );
  });

  it('uprostřed vody most nezačne', () => {
    const w = world();
    for (let y = 0; y < w.size; y++) w.layers.terrain[index(30, y)] = TERRAIN.water;

    const result = buildRoad(w, 30, 40, ROAD.street, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.bridgeNeedsBank');
  });

  it('zbouraný most nechá vodu vodou', () => {
    const w = world();
    riverbanks(w);
    buildRoad(w, 30, 40, ROAD.street, VANILLA_BALANCE);

    expect(bulldoze(w, 30, 40, VANILLA_BALANCE).ok).toBe(true);

    expect(w.layers.road[index(30, 40)]).toBe(ROAD.none);
    expect(w.layers.terrain[index(30, 40)]).toBe(TERRAIN.water);
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
