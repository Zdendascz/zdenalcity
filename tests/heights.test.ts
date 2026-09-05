import { describe, expect, it } from 'vitest';
import {
  applyCornerChanges,
  cornerIndex,
  countViolations,
  areaHeightRange,
  createCornerHeights,
  groundHeightAt,
  isFlatTile,
  isTwistedTile,
  MAX_HEIGHT,
  planCornerHeight,
  relaxHeights,
  tileBaseHeight,
  tileCorners,
} from '@/sim/heights';
import { gridToScreen, skirtFaces } from '@/render/projection';
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

/**
 * Podezdívka pod budovou na svahu.
 *
 * Kreslí se ze dvou stěn a **jde jen dolů**. Když terén na viditelné straně
 * stoupá nad podlahu, není co dozdívat — dům se do svahu zařezává. Bez
 * zastropení se polygon obrátil a vysázel šedou zeď přes svah a přes fasádu;
 * autor to hlásil jako „podezdívky bez textur" a jako „baráky mimo pozici",
 * protože ta zeď vypadá jako špatně posazený dům.
 */
describe('podezdívka nikdy neleze nad podlahu', () => {
  /** Nejvyšší bod polygonu na obrazovce. Menší `y` je výš. */
  function highest(face: readonly number[]): number {
    return Math.min(...face.filter((_, i) => i % 2 === 1));
  }

  it('na stoupajícím svahu zůstane pod podlahou', () => {
    // Podlaha ve výšce 2, terén na jihu vystoupá na 4 — tedy nad ni.
    const faces = skirtFaces(0, 0, 1, 1, 2, (_fx, fy) => (fy >= 1 ? 4 : 0));
    const floor = gridToScreen(0, 1, 2).y;

    // Před opravou sahal polygon 32 px (dvě úrovně) nad podlahu.
    expect(highest(faces.left)).toBeGreaterThanOrEqual(floor - 0.01);
    expect(highest(faces.right)).toBeGreaterThanOrEqual(gridToScreen(1, 0, 2).y - 0.01);
  });

  it('na klesajícím svahu dozdívá až k zemi, jak má', () => {
    // Opačný případ: terén klesá, podezdívka ho musí doplnit celý. Zastropení
    // se ho nesmí dotknout — jinak by oprava vypnula podezdívku úplně.
    const faces = skirtFaces(0, 0, 1, 1, 4, (_fx, fy) => (fy >= 1 ? 0 : 4));
    const lowest = Math.max(...faces.left.filter((_, i) => i % 2 === 1));

    // Jižní hrana leží na terénu ve výšce nula, tedy o čtyři úrovně níž.
    expect(lowest).toBeCloseTo(gridToScreen(1, 1, 0).y, 1);
    expect(lowest - gridToScreen(1, 1, 4).y).toBeCloseTo(4 * 16, 1);
  });

  it('sedlo: stoupá na jedné straně a klesá na druhé', () => {
    // Nejhorší případ a přesně ten, který autor popsal slovy „nejvíc to
    // hapruje tam, kde jsou dvě strany z kopce".
    const faces = skirtFaces(0, 0, 2, 2, 3, (fx, fy) => (fx + fy > 2 ? 0 : 5));

    expect(highest(faces.left)).toBeGreaterThanOrEqual(gridToScreen(0, 2, 3).y - 0.01);
    expect(highest(faces.right)).toBeGreaterThanOrEqual(gridToScreen(2, 0, 3).y - 0.01);
  });
});

/**
 * Kam se sází předmět, který stojí na zemi — strom, hromada suti, scéna
 * katastrofy.
 *
 * Všechny tři to dřív dělaly po svém a všechny tři špatně: suť brala
 * **zaokrouhlený průměr** rohů dlaždice, scéna katastrofy **nejvyšší** roh.
 * Na svahu to znamenalo až celou úroveň vedle a autor to hlásil slovy
 * „zbořeniny v kopcích jsou úplně mimo". Správně je výška terénu přesně v tom
 * bodě, kde předmět stojí.
 */
describe('výška terénu pod předmětem', () => {
  /** Roh dlaždice (0,0) je nula, ostatní tři čtyři — svah k severozápadu. */
  function slope(): Uint8Array {
    const heights = new Uint8Array(CORNER_CELLS);
    heights.fill(4);
    heights[0] = 0;
    return heights;
  }

  it('uprostřed dlaždice leží mezi nejnižším a nejvyšším rohem', () => {
    const at = groundHeightAt(slope(), 0.5, 0.5);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(4);
    // Bilineárně přesně: (0 + 4 + 4 + 4) / 4.
    expect(at).toBeCloseTo(3, 5);
  });

  it('rozliší i posun uvnitř dlaždice', () => {
    // Předmět se uvnitř dlaždice posouvá až o třetinu, takže pod ním je jiná
    // výška než uprostřed. Zaokrouhlený průměr rohů tenhle rozdíl neviděl.
    const heights = slope();
    expect(groundHeightAt(heights, 0.2, 0.2)).toBeLessThan(groundHeightAt(heights, 0.8, 0.8));
  });

  it('v rohu vrátí přesně výšku toho rohu', () => {
    const heights = slope();
    expect(groundHeightAt(heights, 0, 0)).toBe(0);
    expect(groundHeightAt(heights, 1, 1)).toBe(4);
  });
});

/**
 * Na jaké výšce leží podlaha budovy, která má obrázek.
 *
 * Kvádr si smí zaříznout do svahu — je to holá krabice. Obrázek ne: nese
 * **vlastní rovný pozemek** (chodník, trávu, plot) a když ho podlaha posadí
 * níž, než kam sahá terén, prorostou mu okolní dlaždice skrz. Dům pak vypadá
 * odsunutý do silnice a bez podezdívky; autor to hlásil dvakrát.
 *
 * Pravidlo je proto: **podlaha na nejvyšším rohu parcely**, zbytek doplní
 * podezdívka. Změřeno na městě autora — z 681 budov jich 82 sedělo pod
 * terénem, po opravě má 228 z 236 podezdívku vysokou jednu jedinou úroveň.
 */
describe('podlaha obrázku nesmí být pod terénem', () => {
  /** Parcela 2×2, jejíž jihovýchodní roh je o dvě úrovně výš. */
  function bump(): Uint8Array {
    const heights = createCornerHeights(MAP_SIZE);
    heights[cornerIndex(2, 2, CORNER_SIZE)] = 2;
    return heights;
  }

  it('nejvyšší roh je nad terénem v celé parcele, průměr ne', () => {
    const heights = bump();
    const { min, max, pad } = areaHeightRange(heights, 0, 0, 2, 2);

    expect(min).toBe(0);
    expect(max).toBe(2);
    // Průměr se zaokrouhlí na nulu, tedy pod hrb — a přesně tudy terén prorostl.
    expect(pad).toBe(0);
    expect(groundHeightAt(heights, 2, 2)).toBeGreaterThan(pad);

    // Nejvyšší roh takový bod nemá: pozemek obrázku je nad terénem všude.
    for (let fx = 0; fx <= 2; fx += 0.25) {
      for (let fy = 0; fy <= 2; fy += 0.25) {
        expect(groundHeightAt(heights, fx, fy), `${fx},${fy}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('na rovné parcele se podlaha nezvedne, takže se podezdívka nekreslí', () => {
    const { min, max } = areaHeightRange(createCornerHeights(MAP_SIZE), 5, 5, 2, 2);
    expect(max).toBe(min);
  });
});
