import { describe, expect, it } from 'vitest';
import {
  applyCornerChanges,
  cornerIndex,
  countViolations,
  createCornerHeights,
  isFlatTile,
  isTwistedTile,
  MAX_HEIGHT,
  planCornerHeight,
  relaxHeights,
  tileBaseHeight,
  tileCorners,
} from '@/sim/heights';
import { index } from '@/sim/layers';
import { applyHeightChanges, createWorld } from '@/sim/world';
import { MAP_SIZE, CORNER_SIZE, CORNER_CELLS } from './support/grid';

/** Zvedne roh a rovnou zapíše, což je to, co bude dělat terraforming z T32. */
function raise(heights: Uint8Array, x: number, y: number, target: number): number {
  const changes = planCornerHeight(heights, x, y, target);
  applyCornerChanges(heights, changes);
  return changes.size;
}

describe('mřížka rohů', () => {
  it('je o jedna větší než mřížka dlaždic', () => {
    // Dlaždice sdílí rohy se sousedy, takže rohů je o řadu a sloupec víc.
    expect(CORNER_SIZE).toBe(MAP_SIZE + 1);
    expect(CORNER_CELLS).toBe((MAP_SIZE + 1) * (MAP_SIZE + 1));
    expect(createCornerHeights(MAP_SIZE).length).toBe(CORNER_CELLS);
  });

  it('dlaždice čte čtyři rohy, které opravdu sousedí', () => {
    const heights = createCornerHeights(MAP_SIZE);
    heights[cornerIndex(5, 5, CORNER_SIZE)] = 1;
    heights[cornerIndex(6, 5, CORNER_SIZE)] = 2;
    heights[cornerIndex(5, 6, CORNER_SIZE)] = 3;
    heights[cornerIndex(6, 6, CORNER_SIZE)] = 4;

    expect(tileCorners(heights, 5, 5)).toEqual([1, 2, 3, 4]);
    expect(tileBaseHeight(heights, 5, 5)).toBe(1);
  });
});

describe('tvar dlaždice', () => {
  it('rovná dlaždice má všechny rohy stejně', () => {
    const heights = createCornerHeights(MAP_SIZE);
    expect(isFlatTile(heights, 3, 3)).toBe(true);

    heights[cornerIndex(4, 3, CORNER_SIZE)] = 1;
    expect(isFlatTile(heights, 3, 3)).toBe(false);
  });

  it('rovnoměrný svah není zkroucený, sedlo ano', () => {
    const heights = createCornerHeights(MAP_SIZE);
    // Svah stoupající na východ: obě západní nuly, obě východní jedničky.
    heights[cornerIndex(11, 10, CORNER_SIZE)] = 1;
    heights[cornerIndex(11, 11, CORNER_SIZE)] = 1;
    expect(isTwistedTile(heights, 10, 10)).toBe(false);

    // Sedlo: protilehlé rohy nahoře, zbylé dole.
    const saddle = createCornerHeights(MAP_SIZE);
    saddle[cornerIndex(20, 20, CORNER_SIZE)] = 1;
    saddle[cornerIndex(21, 21, CORNER_SIZE)] = 1;
    expect(isTwistedTile(saddle, 20, 20)).toBe(true);
  });
});

describe('invariant sousedních rohů', () => {
  it('zvednutí rohu si vytáhne sousedy s sebou (kaskáda)', () => {
    const heights = createCornerHeights(MAP_SIZE);
    const touched = raise(heights, 40, 40, 4);

    expect(heights[cornerIndex(40, 40, CORNER_SIZE)]).toBe(4);
    expect(countViolations(heights)).toBe(0);
    // Kužel o čtyřech patrech: špička plus čtyři prstence.
    expect(touched).toBeGreaterThan(1);
    expect(heights[cornerIndex(41, 40, CORNER_SIZE)]).toBe(3);
    expect(heights[cornerIndex(44, 40, CORNER_SIZE)]).toBe(0);
  });

  it('snížení funguje stejně na druhou stranu', () => {
    const heights = createCornerHeights(MAP_SIZE);
    heights.fill(8);

    raise(heights, 40, 40, 2);

    expect(heights[cornerIndex(40, 40, CORNER_SIZE)]).toBe(2);
    expect(heights[cornerIndex(41, 40, CORNER_SIZE)]).toBe(3);
    expect(countViolations(heights)).toBe(0);
  });

  it('plán nic nemění, dokud se nezapíše (§12 kritérium 14)', () => {
    // Terraforming musí umět říct cenu dřív, než hráč klikne. Kdyby plán
    // rovnou zapisoval, nešlo by se zeptat.
    const heights = createCornerHeights(MAP_SIZE);
    const changes = planCornerHeight(heights, 30, 30, 5);

    expect(changes.size).toBeGreaterThan(1);
    expect([...heights].every((value) => value === 0)).toBe(true);

    applyCornerChanges(heights, changes);
    expect(heights[cornerIndex(30, 30, CORNER_SIZE)]).toBe(5);
  });

  it('drží se v mezích 0 až MAX_HEIGHT', () => {
    const heights = createCornerHeights(MAP_SIZE);
    raise(heights, 50, 50, 999);
    expect(heights[cornerIndex(50, 50, CORNER_SIZE)]).toBe(MAX_HEIGHT);

    raise(heights, 50, 50, -999);
    expect(heights[cornerIndex(50, 50, CORNER_SIZE)]).toBe(0);
    expect(countViolations(heights)).toBe(0);
  });

  it('kaskáda u kraje mapy nespadne ani neuteče ven', () => {
    const heights = createCornerHeights(MAP_SIZE);
    raise(heights, 0, 0, MAX_HEIGHT);

    expect(heights[cornerIndex(0, 0, CORNER_SIZE)]).toBe(MAX_HEIGHT);
    expect(countViolations(heights)).toBe(0);
  });

  it('zvednutí už zvednutého rohu nic nestojí', () => {
    const heights = createCornerHeights(MAP_SIZE);
    raise(heights, 60, 60, 3);
    expect(planCornerHeight(heights, 60, 60, 3).size).toBe(0);
  });
});

describe('srovnání pole (relaxHeights)', () => {
  it('rozbité pole srovná do invariantu', () => {
    const heights = createCornerHeights(MAP_SIZE);
    // Svislá stěna: půlka mapy na deseti patrech, půlka na nule.
    for (let y = 0; y < CORNER_SIZE; y++) {
      for (let x = 0; x < CORNER_SIZE / 2; x++)
        heights[cornerIndex(x, y, CORNER_SIZE)] = 10;
    }
    expect(countViolations(heights)).toBeGreaterThan(0);

    relaxHeights(heights);

    expect(countViolations(heights)).toBe(0);
    // Sráží se dolů, nikdy nezvedá: nejvyšší roh nesmí přerůst původní maximum.
    expect(Math.max(...heights)).toBeLessThanOrEqual(10);
  });

  it('pole, které invariant splňuje, nechá být', () => {
    const heights = createCornerHeights(MAP_SIZE);
    raise(heights, 30, 30, 6);
    const before = Uint8Array.from(heights);

    expect(relaxHeights(heights)).toBe(1); // jeden průchod, nic se nezměnilo
    expect(heights).toEqual(before);
  });
});

describe('překreslení po změně výšky (T30)', () => {
  it('jeden roh označí všechny čtyři dlaždice kolem sebe', () => {
    // Kdyby se označila jen jedna, zůstal by na mapě viset zlom: sousední
    // chunk by si dál kreslil starý tvar.
    const world = createWorld(1);
    world.dirty.tiles.clear();

    applyHeightChanges(world, planCornerHeight(world.cornerHeight, 20, 20, 1));

    for (const [x, y] of [
      [19, 19],
      [20, 19],
      [19, 20],
      [20, 20],
    ] as const) {
      expect(world.dirty.tiles.has(index(x, y, MAP_SIZE)), `${x},${y}`).toBe(
        true,
      );
    }
    expect(world.cornerHeight[cornerIndex(20, 20, CORNER_SIZE)]).toBe(1);
  });

  it('u kraje mapy neoznačí dlaždici mimo mřížku', () => {
    const world = createWorld(1);
    world.dirty.tiles.clear();

    applyHeightChanges(world, planCornerHeight(world.cornerHeight, 0, 0, 1));

    expect(world.dirty.tiles.has(index(0, 0, MAP_SIZE))).toBe(true);
    for (const tile of world.dirty.tiles) {
      expect(tile).toBeGreaterThanOrEqual(0);
      expect(tile).toBeLessThan(MAP_SIZE * MAP_SIZE);
    }
  });

  it('budovu na dotčené dlaždici pošle překreslit taky', () => {
    // Budova stojí na výšce základny, takže se s terénem musí posunout —
    // a kreslí ji jiný renderer než dlaždice, který `dirty.tiles` nečte.
    const world = createWorld(1);
    world.layers.buildingId[index(50, 50, MAP_SIZE)] = 7;
    world.dirty.buildings.clear();

    applyHeightChanges(world, planCornerHeight(world.cornerHeight, 50, 50, 2));

    expect(world.dirty.buildings.has(7)).toBe(true);
  });
});
