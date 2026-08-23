import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { checkFootprint } from '@/sim/buildings';
import { buildRoad, bulldoze } from '@/sim/commands';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { tileQuad } from '@/render/projection';
import { roadMask, roadPolygons } from '@/render/roads';
import { ROAD_COLORS, ROAD_WIDTHS } from '@/render/palette';
import { computeBudget } from '@/sim/systems/economy';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { createWorld } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

const EMPTY: BuildingCatalogue = { get: () => undefined, byCategory: () => [] };

function world() {
  return createWorld(1, VANILLA_BALANCE.economy);
}

const [STREET, AVENUE, HIGHWAY] = VANILLA_BALANCE.traffic.roadTypes;

describe('typy silnic v balancu', () => {
  it('kapacita, cena i údržba rostou s typem (§4)', () => {
    expect(STREET && AVENUE && HIGHWAY).toBeTruthy();
    if (!STREET || !AVENUE || !HIGHWAY) return;

    for (const key of ['capacity', 'cost', 'upkeep'] as const) {
      expect(AVENUE[key], key).toBeGreaterThan(STREET[key]);
      expect(HIGHWAY[key], key).toBeGreaterThan(AVENUE[key]);
    }
  });

  it('pořadí v balancu odpovídá hodnotám ve vrstvě', () => {
    expect(VANILLA_BALANCE.traffic.roadTypes.map((road) => road.id)).toEqual([
      'street',
      'avenue',
      'highway',
    ]);
    expect(ROAD.street).toBe(1);
    expect(ROAD.highway).toBe(3);
  });
});

describe('stavba silnic', () => {
  it('stojí podle typu', () => {
    const w = world();
    const before = w.economy.funds;

    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(w.economy.funds).toBe(before - (STREET?.cost ?? 0));
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.street);
  });

  it('vylepšení na místě přepíše typ a účtuje plnou cenu nového (§4)', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    const afterStreet = w.economy.funds;

    expect(buildRoad(w, 10, 10, ROAD.avenue, VANILLA_BALANCE).ok).toBe(true);

    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.avenue);
    expect(w.economy.funds).toBe(afterStreet - (AVENUE?.cost ?? 0));
  });

  it('stejný typ na stejné místo je odmítnutí, ne další útrata', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.avenue, VANILLA_BALANCE);
    const funds = w.economy.funds;

    const again = buildRoad(w, 10, 10, ROAD.avenue, VANILLA_BALANCE);

    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toBe('error.roadExists');
    expect(w.economy.funds).toBe(funds);
  });

  it('snížit typ nejde — jen zbourat a postavit znovu', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.highway, VANILLA_BALANCE);

    const downgrade = buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    expect(downgrade.ok).toBe(false);
    expect(downgrade.ok === false && downgrade.reason).toBe(
      'error.roadDowngrade',
    );
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.highway);

    expect(bulldoze(w, 10, 10, VANILLA_BALANCE).ok).toBe(true);
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.none);
    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
  });

  it('bez peněz se nestaví', () => {
    const w = world();
    w.economy.funds = 0;

    const result = buildRoad(w, 10, 10, ROAD.highway, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.notEnoughFunds');
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.none);
  });

  it('na vodu ani do lesa se silnice neklade', () => {
    const w = world();
    w.layers.terrain[index(10, 10, MAP_SIZE)] = TERRAIN.water;
    w.layers.terrain[index(11, 10, MAP_SIZE)] = TERRAIN.forest;

    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(false);
    expect(buildRoad(w, 11, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(false);
  });
});

describe('údržba silnic v rozpočtu', () => {
  it('platí se každý měsíc podle typu', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    buildRoad(w, 11, 10, ROAD.avenue, VANILLA_BALANCE);
    buildRoad(w, 12, 10, ROAD.highway, VANILLA_BALANCE);

    const budget = computeBudget(w, EMPTY, VANILLA_BALANCE);

    expect(budget.roads.count).toBe(3);
    expect(budget.roads.upkeep).toBe(
      (STREET?.upkeep ?? 0) + (AVENUE?.upkeep ?? 0) + (HIGHWAY?.upkeep ?? 0),
    );
    expect(budget.expenses).toBe(budget.roads.upkeep);
  });

  it('bez silnic se nic neúčtuje', () => {
    expect(computeBudget(world(), EMPTY, VANILLA_BALANCE).roads).toEqual({ count: 0, upkeep: 0 });
  });
});

describe('vykreslení', () => {
  it('všechny typy se navzájem napojují (§4)', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    buildRoad(w, 11, 10, ROAD.highway, VANILLA_BALANCE);

    // Bitmask se počítá z „je tam jakákoli silnice", ne ze shody typů.
    const isRoad = (x: number, y: number): boolean =>
      (w.layers.road[index(x, y, MAP_SIZE)] ?? ROAD.none) !== ROAD.none;

    expect(roadMask(isRoad, 10, 10)).toBe(2); // ROAD_E
    expect(roadMask(isRoad, 11, 10)).toBe(8); // ROAD_W
  });

  it('vyšší typ je širší a má vlastní barvu', () => {
    expect(ROAD_WIDTHS[ROAD.avenue]).toBeGreaterThan(ROAD_WIDTHS[ROAD.street] ?? 0);
    expect(ROAD_WIDTHS[ROAD.highway]).toBeGreaterThan(ROAD_WIDTHS[ROAD.avenue] ?? 0);
    expect(new Set(ROAD_COLORS.slice(1)).size).toBe(3);
  });

  it('stavět jde u každého typu vozovky, ne jen u ulice', async () => {
    // Nahlásil autor při hraní: u třídy ani dálnice nešlo postavit nic.
    // `touchesRoad` porovnávala vrstvu s jedničkou, jenže od T24 je 1 ulice,
    // 2 třída a 3 dálnice — takže všechno kromě ulice bylo pro budovy neviditelné.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    // Klinika je budova, která silnici podle definice **vyžaduje** — na parku
    // by test neukázal nic, ten se obejde bez ní.
    const clinic = content.get('vanilla:clinic');
    expect(clinic?.construction.requiresRoad).toBe(true);
    if (!clinic) return;

    for (const [name, roadType] of [
      ['ulice', ROAD.street],
      ['třída', ROAD.avenue],
      ['dálnice', ROAD.highway],
    ] as const) {
      const world = createWorld(1, VANILLA_BALANCE.economy);
      world.economy.funds = 100000;
      expect(buildRoad(world, 20, 20, roadType, VANILLA_BALANCE).ok, name).toBe(true);

      expect(checkFootprint(world, clinic, 20, 21).ok, name).toBe(true);
    }
  });

  it('šířka mění geometrii vozovky, ne počet dílů', () => {
    const narrow = roadPolygons(tileQuad(0, 0, [0, 0, 0, 0]), 0, 0.5);
    const wide = roadPolygons(tileQuad(0, 0, [0, 0, 0, 0]), 0, 0.86);

    expect(narrow).toHaveLength(wide.length);
    expect(narrow[0]).not.toEqual(wide[0]);
  });
});
