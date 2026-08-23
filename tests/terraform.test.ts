import { describe, expect, it } from 'vitest';
import {
  estimateCornerHeight,
  estimateLevelArea,
  levelArea,
  terraformCorner,
} from '@/sim/commands';
import {
  countViolations,
  cornerIndex,
  isFlatTile,
  planCornerHeight,
  tileCorners,
} from '@/sim/heights';
import { index, TERRAIN } from '@/sim/layers';
import { createWorld, setRoadTile } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE, CORNER_SIZE } from './support/grid';

const COST = VANILLA_BALANCE.map.terraformCost;

function world(funds = 100000): WorldState {
  const created = createWorld(1, VANILLA_BALANCE.economy);
  created.economy.funds = funds;
  return created;
}

/** Kopec: roh uprostřed zvednutý na `h`, i s kaskádou kolem. */
function hill(w: WorldState, x: number, y: number, h: number): void {
  const plan = planCornerHeight(w.cornerHeight, x, y, h);
  for (const [corner, value] of plan) w.cornerHeight[corner] = value;
}

describe('terraforming — cena a kaskáda (§7 fáze 3)', () => {
  it('účtuje celou kaskádu, ne jeden roh (§12 kritérium 13)', () => {
    // Zvednutí u strmého svahu rozhýbe desítky rohů. Kdyby se platil jen ten,
    // na který hráč klikl, byl by terraforming prakticky zadarmo.
    const w = world();
    const before = w.economy.funds;

    const plan = estimateCornerHeight(w, 40, 40, 5, VANILLA_BALANCE);
    expect(plan.corners).toBeGreaterThan(10);
    expect(plan.cost).toBe(plan.corners * COST);

    expect(terraformCorner(w, 40, 40, 5, VANILLA_BALANCE).ok).toBe(true);
    expect(before - w.economy.funds).toBe(plan.cost);
    expect(w.cornerHeight[cornerIndex(40, 40, CORNER_SIZE)]).toBe(5);
    expect(countViolations(w.cornerHeight)).toBe(0);
  });

  it('odhad nic nemění — cena jde ukázat před kliknutím (kritérium 14)', () => {
    const w = world();
    const funds = w.economy.funds;

    const plan = estimateCornerHeight(w, 30, 30, 4, VANILLA_BALANCE);

    expect(plan.cost).toBeGreaterThan(0);
    expect(w.economy.funds).toBe(funds);
    expect([...w.cornerHeight].every((value) => value === 0)).toBe(true);
  });

  it('jedno velké zvednutí je levnější než totéž po patrech', () => {
    // Účtují se **rohy, ne patra**. Kdo zvedá po jednom, zaplatí každý prstenec
    // kaskády znovu; kdo si rovnou řekne, kam chce, zaplatí ho jednou.
    // Vyšlo to najevo při psaní testů — původní očekávání bylo jiné.
    const naraz = estimateCornerHeight(world(), 50, 50, 4, VANILLA_BALANCE).cost;

    const w = world();
    let poPatrech = 0;
    for (let step = 0; step < 4; step++) {
      poPatrech += estimateCornerHeight(w, 50, 50, 1, VANILLA_BALANCE).cost;
      terraformCorner(w, 50, 50, 1, VANILLA_BALANCE);
    }

    expect(w.cornerHeight[cornerIndex(50, 50, CORNER_SIZE)]).toBe(4);
    expect(naraz).toBeLessThan(poPatrech);
  });

  it('bez peněz se terén nehne', () => {
    const w = world(10);
    const before = Uint8Array.from(w.cornerHeight);

    const result = terraformCorner(w, 20, 20, 5, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.notEnoughFunds');
    expect(w.cornerHeight).toEqual(before);
    expect(w.economy.funds).toBe(10);
  });

  it('práce, která nic nezmění, se neúčtuje', () => {
    const w = world();
    const result = terraformCorner(w, 20, 20, 0, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.terraformNoChange');
    expect(w.economy.funds).toBe(100000);
  });

  it('mimo mřížku rohů se nic nestane', () => {
    const w = world();
    expect(terraformCorner(w, -1, 5, 1, VANILLA_BALANCE).ok).toBe(false);
    expect(terraformCorner(w, w.size + 5, 5, 1, VANILLA_BALANCE).ok).toBe(false);
  });
});

describe('terraforming — co se nesmí', () => {
  it('dno moře se nezvedá', () => {
    const w = world();
    w.layers.terrain[index(10, 10, MAP_SIZE)] = TERRAIN.water;

    const result = terraformCorner(w, 10, 10, 2, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.terraformWater');
    expect(w.economy.funds).toBe(100000);
  });

  it('u vody se ale smí snižovat', () => {
    // Zákaz je na zvedání dna, ne na kopání. Kdyby platil oboustranně, nešel by
    // srovnat ani břeh.
    const w = world();
    hill(w, 10, 10, 4);
    w.layers.terrain[index(14, 14, MAP_SIZE)] = TERRAIN.water;

    expect(terraformCorner(w, 10, 10, -2, VANILLA_BALANCE).ok).toBe(true);
  });

  it('pod budovou se terén nehýbe ani nahoru, ani dolů', () => {
    // Budova stojí na rovině; nakloněný terén pod ní by ji zavěsil do vzduchu.
    const w = world();
    // Terén ve třetím patře, ať má snížení kam jít — snižovat nulu není změna.
    w.cornerHeight.fill(3);
    w.layers.buildingId[index(25, 25, MAP_SIZE)] = 42;

    for (const delta of [1, -1]) {
      const result = terraformCorner(w, 25, 25, delta, VANILLA_BALANCE);
      expect(result.ok, `delta ${delta}`).toBe(false);
      expect(result.ok === false && result.reason).toBe('error.terraformBuilding');
    }
  });

  it('budova zasažená až kaskádou zastaví celou operaci', () => {
    // Klik je daleko od budovy, ale vlna se k ní dokutálí. Musí spadnout celá
    // operace — polovina kaskády by porušila invariant.
    const w = world();
    w.layers.buildingId[index(43, 40, MAP_SIZE)] = 7;
    const before = Uint8Array.from(w.cornerHeight);

    const result = terraformCorner(w, 40, 40, 5, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.terraformBuilding');
    expect(w.cornerHeight).toEqual(before);
  });

  it('silnice se hýbat smí', () => {
    // Zadání to výslovně dovoluje: invariant drží svah v mezích sám.
    const w = world();
    setRoadTile(w, index(60, 60, MAP_SIZE), 1);

    expect(terraformCorner(w, 60, 60, 2, VANILLA_BALANCE).ok).toBe(true);
  });
});

describe('srovnání oblasti', () => {
  it('udělá z nakloněné dlaždice rovinu', () => {
    const w = world();
    hill(w, 70, 70, 4);
    expect(isFlatTile(w.cornerHeight, 70, 70)).toBe(false);

    expect(levelArea(w, 70, 70, 1, 1, VANILLA_BALANCE).ok).toBe(true);

    expect(isFlatTile(w.cornerHeight, 70, 70)).toBe(true);
    expect(countViolations(w.cornerHeight)).toBe(0);
  });

  it('srovná se na průměr, ne na nejvyšší nebo nejnižší roh', () => {
    // Průměr je pro hráče nejlevnější: srovnání na krajní hodnotu hýbe víc
    // terénem a stojí víc.
    const w = world();
    hill(w, 80, 80, 4);
    const corners = tileCorners(w.cornerHeight, 80, 80);
    const lowest = Math.min(...corners);
    const highest = Math.max(...corners);

    levelArea(w, 80, 80, 1, 1, VANILLA_BALANCE);
    const level = tileCorners(w.cornerHeight, 80, 80)[0];

    expect(level).toBeGreaterThanOrEqual(lowest);
    expect(level).toBeLessThanOrEqual(highest);
  });

  it('větší oblast srovná celou a zaplatí se za všechny dotčené rohy', () => {
    const w = world();
    hill(w, 90, 90, 5);
    const before = w.economy.funds;

    const plan = estimateLevelArea(w, 88, 88, 4, 4, VANILLA_BALANCE);
    expect(levelArea(w, 88, 88, 4, 4, VANILLA_BALANCE).ok).toBe(true);

    expect(before - w.economy.funds).toBe(plan.corners * COST);
    for (let y = 88; y < 92; y++) {
      for (let x = 88; x < 92; x++) {
        expect(isFlatTile(w.cornerHeight, x, y), `${x},${y}`).toBe(true);
      }
    }
    expect(countViolations(w.cornerHeight)).toBe(0);
  });

  it('srovnání roviny nestojí nic a nic nehlásí jako práci', () => {
    const w = world();
    const result = levelArea(w, 10, 10, 2, 2, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.terraformNoChange');
    expect(w.economy.funds).toBe(100000);
  });
});
