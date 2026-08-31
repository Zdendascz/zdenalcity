import { describe, expect, it } from 'vitest';
import { compareDepth, isBehind } from '@/render/depth';
import {
  clampZoom,
  createCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  pan,
  viewportToWorld,
  worldToViewport,
  zoomAt,
} from '@/render/camera';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { iconShape } from '@/render/icons';
import { containsPoint, pickTile } from '@/render/picking';
import { createCornerHeights, cornerIndex, groundHeightAt, MAX_HEIGHT } from '@/sim/heights';
import {
  cuboidFaces,
  diamondPoints,
  gridToScreen,
  skirtFaces,
  LEVEL_H,
  slopeLight,
  tileQuad,
  TILE_H,
  TILE_W,
  tileVariation,
} from '@/render/projection';
import {
  HAPPINESS_CLEAN_AT,
  shade,
  TERRAIN_COLORS,
  unhappinessValue,
} from '@/render/palette';
import {
  roadMask,
  roadPolygons,
  ROAD_E,
  ROAD_N,
  ROAD_S,
  ROAD_W,
} from '@/render/roads';
import { TERRAIN } from '@/sim/layers';
import { MAP_SIZE, CORNER_SIZE } from './support/grid';

/** Rovná dlaždice v počátku — nejčastější vstup do testů vozovky. */
const FLAT_TILE = tileQuad(0, 0, [0, 0, 0, 0]);

/**
 * Inverze projekce z fáze 1 — vzorec, který T31 nahradil.
 *
 * Ve `src/` už neexistuje schválně: na svahu vrací špatnou dlaždici a nechat ji
 * tam by byla past. Tady zůstává jako doklad, že nová cesta řeší něco, co ta
 * stará neuměla.
 */
function flatInverse(screenX: number, screenY: number): { x: number; y: number } {
  const a = screenX / (TILE_W / 2);
  const b = screenY / (TILE_H / 2);
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
}

/** Placka: mřížka rohů samých nul, tedy terén fáze 1. */
const FLAT_HEIGHTS = createCornerHeights(MAP_SIZE);

const VIEW_W = 1280;
const VIEW_H = 720;

/** Střed diamantu dlaždice — `gridToScreen` vrací její horní vrchol. */
function tileCenter(x: number, y: number): { x: number; y: number } {
  const origin = gridToScreen(x, y);
  return { x: origin.x, y: origin.y + TILE_H / 2 };
}

describe('projection', () => {
  it('používá konstanty z architektury §3', () => {
    expect([TILE_W, TILE_H]).toEqual([64, 32]);
  });

  it('gridToScreen odpovídá vzorcům ze specifikace', () => {
    expect(gridToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(gridToScreen(1, 0)).toEqual({ x: 32, y: 16 });
    expect(gridToScreen(0, 1)).toEqual({ x: -32, y: 16 });
    expect(gridToScreen(1, 1)).toEqual({ x: 0, y: 32 });
  });

  it('elevation posouvá dlaždici nahoru o LEVEL_H', () => {
    expect(gridToScreen(0, 0, 2).y).toBe(-32);
  });

  it('diamondPoints vrací čtyři vrcholy kolem horního rohu', () => {
    expect(diamondPoints(0, 0)).toEqual([0, 0, 32, 16, 0, 32, -32, 16]);
  });
});

describe('dlaždice s převýšením (§7 fáze 3)', () => {
  it('rovná dlaždice vyjde jako pravidelný diamant', () => {
    expect(tileQuad(0, 0, [0, 0, 0, 0])).toEqual(diamondPoints(0, 0));
  });

  it('každý roh se zvedne o svou vlastní výšku', () => {
    // Východní roh o patro výš: v pořadí sever, východ, jih, západ je to
    // druhá dvojice a posune se nahoru přesně o LEVEL_H.
    const flat = tileQuad(0, 0, [0, 0, 0, 0]);
    const slope = tileQuad(0, 0, [0, 1, 0, 0]);

    expect(slope[2]).toBe(flat[2]); // x se nemění, zvedá se jen y
    expect((slope[3] ?? 0) - (flat[3] ?? 0)).toBe(-LEVEL_H);
    expect(slope.slice(4)).toEqual(flat.slice(4));
  });

  it('sousední dlaždice sdílí rohy, takže terén nepraskne', () => {
    // Východní roh dlaždice (0,0) je západní roh dlaždice (1,0). Pokud se
    // počítají ze stejné výšky, musí vyjít týž bod.
    const left = tileQuad(0, 0, [0, 2, 0, 1]);
    const right = tileQuad(1, 0, [2, 0, 1, 0]);

    expect([left[2], left[3]]).toEqual([right[0], right[1]]);
    expect([left[4], left[5]]).toEqual([right[6], right[7]]);
  });

  it('sklon mění jas: přivrácený svah je světlejší, odvrácený tmavší', () => {
    // Bez toho by svah vypadal jako rovina — izometrie nemá perspektivu,
    // která by tvar prozradila.
    const flat = slopeLight([0, 0, 0, 0]);
    const towardsViewer = slopeLight([2, 2, 0, 0]); // klesá na jih
    const awayFromViewer = slopeLight([0, 0, 2, 2]); // stoupá na jih

    expect(flat).toBe(1);
    expect(towardsViewer).toBeLessThan(flat);
    expect(awayFromViewer).toBeGreaterThan(flat);
  });

  it('stejně vysoká rovina má stejný jas bez ohledu na patro', () => {
    // Plošina ve třetím patře není svah, takže se nesmí stínovat.
    expect(slopeLight([3, 3, 3, 3])).toBe(slopeLight([0, 0, 0, 0]));
  });

  it('budova se posadí na výšku základny', () => {
    const ground = cuboidFaces(0, 0, 1, 1, 16);
    const hill = cuboidFaces(0, 0, 1, 1, 16, 3);

    // Celý kvádr se zvedne o tři patra, tvar zůstane.
    for (let i = 1; i < ground.top.length; i += 2) {
      expect((hill.top[i] ?? 0) - (ground.top[i] ?? 0)).toBe(-3 * LEVEL_H);
    }
  });
});

describe('palette', () => {
  it('shade ztmavuje i zesvětluje a drží se v rozsahu kanálu', () => {
    expect(shade(0x804020, 0.5)).toBe(0x402010);
    expect(shade(0x804020, 2)).toBe(0xff8040);
    expect(shade(0x000000, 0.5)).toBe(0x000000);
  });

  it('má barvu pro každou hodnotu vrstvy terrain', () => {
    // Kdyby přibyl terén bez barvy, renderer by ho kreslil jako `undefined`.
    expect(TERRAIN_COLORS).toHaveLength(Object.keys(TERRAIN).length);
    for (const value of Object.values(TERRAIN)) {
      expect(TERRAIN_COLORS[value], `terén ${value}`).toBeTypeOf('number');
    }
  });
});

describe('camera', () => {
  it('clampuje zoom na 0.25–4', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('worldToViewport a viewportToWorld jsou navzájem inverzní', () => {
    const camera = createCamera(120, -340, 2.5);
    const view = worldToViewport(camera, 42, 17, VIEW_W, VIEW_H);
    const world = viewportToWorld(camera, view.x, view.y, VIEW_W, VIEW_H);
    expect(world.x).toBeCloseTo(42);
    expect(world.y).toBeCloseTo(17);
  });

  it('střed viewportu odpovídá pozici kamery', () => {
    const camera = createCamera(500, 900, 1.75);
    const world = viewportToWorld(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H);
    expect(world).toEqual({ x: 500, y: 900 });
  });

  it('pan posouvá o stejný počet světových jednotek nezávisle na zoomu', () => {
    const near = createCamera(0, 0, 2);
    pan(near, 100, 0);
    expect(near.x).toBe(-50);

    const far = createCamera(0, 0, 0.5);
    pan(far, 100, 0);
    expect(far.x).toBe(-200);
  });

  it('zoom drží bod pod kurzorem na místě, ne střed obrazovky', () => {
    const camera = createCamera(0, 0, 1);
    const cursor = { x: 320, y: 180 };
    const before = viewportToWorld(camera, cursor.x, cursor.y, VIEW_W, VIEW_H);

    zoomAt(camera, 2, cursor.x, cursor.y, VIEW_W, VIEW_H);

    const after = viewportToWorld(camera, cursor.x, cursor.y, VIEW_W, VIEW_H);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(camera.zoom).toBe(2);
  });

  it('na zastropovaném zoomu se kamera nehne', () => {
    const camera = createCamera(10, 20, MAX_ZOOM);
    zoomAt(camera, 2, 0, 0, VIEW_W, VIEW_H);
    expect(camera).toEqual({ x: 10, y: 20, zoom: MAX_ZOOM });
  });
});

describe('kvádr budovy', () => {
  it('při nulové výšce splyne půdorys 1×1 s diamantem dlaždice', () => {
    const faces = cuboidFaces(0, 0, 1, 1, 0);
    expect(faces.top).toEqual(diamondPoints(0, 0));
  });

  it('horní plocha je zvednutá o výšku, spodní hrany zůstávají na zemi', () => {
    const faces = cuboidFaces(0, 0, 1, 1, 16);

    // Horní plocha = diamant posunutý o 16 px nahoru.
    expect(faces.top).toEqual([0, -16, 32, 0, 0, 16, -32, 0]);
    // Pravá stěna: dva zvednuté vrcholy a pod nimi tytéž body na zemi.
    expect(faces.right).toEqual([32, 0, 0, 16, 0, 32, 32, 16]);
    // Levá stěna navazuje na pravou v předním rohu.
    expect(faces.left).toEqual([0, 16, -32, 0, -32, 16, 0, 32]);
  });

  it('větší půdorys roztáhne kvádr do obou os mřížky', () => {
    const faces = cuboidFaces(0, 0, 2, 2, 0);
    // Rohy mřížky (0,0), (2,0), (2,2), (0,2).
    expect(faces.top).toEqual([0, 0, 64, 32, 0, 64, -64, 32]);
  });

  it('respektuje pozici budovy v mřížce', () => {
    const shifted = cuboidFaces(10, 4, 1, 1, 0);
    const origin = gridToScreen(10, 4);
    expect(shifted.top.slice(0, 2)).toEqual([origin.x, origin.y]);
  });
});

describe('auto-tiling silnic', () => {
  /** Predikát, který hlásí silnici na jediné dlaždici. */
  const only =
    (tx: number, ty: number) =>
    (x: number, y: number): boolean =>
      x === tx && y === ty;

  it('bitmask je N=1, E=2, S=4, W=8 se severem na (x, y-1)', () => {
    expect(roadMask(only(5, 4), 5, 5)).toBe(ROAD_N);
    expect(roadMask(only(6, 5), 5, 5)).toBe(ROAD_E);
    expect(roadMask(only(5, 6), 5, 5)).toBe(ROAD_S);
    expect(roadMask(only(4, 5), 5, 5)).toBe(ROAD_W);
  });

  it('nezapočítá dlaždici samotnou ani úhlopříčné sousedy', () => {
    expect(roadMask(only(5, 5), 5, 5)).toBe(0);
    expect(roadMask(only(6, 6), 5, 5)).toBe(0);
  });

  it('všech 16 variant má středový kus a rameno na každý připojený směr', () => {
    for (let mask = 0; mask < 16; mask++) {
      const arms = [ROAD_N, ROAD_E, ROAD_S, ROAD_W].filter((bit) => mask & bit).length;
      expect(roadPolygons(FLAT_TILE, mask), `mask ${mask}`).toHaveLength(1 + arms);
    }
  });

  it('středový kus je zmenšený diamant kolem středu dlaždice', () => {
    expect(roadPolygons(FLAT_TILE, 0)[0]).toEqual([0, 8, 16, 16, 0, 24, -16, 16]);
  });

  it('rameno sahá až na hranu diamantu, aby sousedé navazovali bez mezery', () => {
    // Severní hrana dlaždice vede z horního vrcholu (0,0) do pravého (32,16).
    expect(roadPolygons(FLAT_TILE, ROAD_N)[1]).toEqual([0, 8, 16, 16, 32, 16, 0, 0]);
  });

  it('respektuje posun počátku dlaždice', () => {
    const shifted = roadPolygons(
      FLAT_TILE.map((value, i) => value + (i % 2 === 0 ? 100 : 200)),
      0,
    )[0];
    expect(shifted).toEqual([100, 208, 116, 216, 100, 224, 84, 216]);
  });

  it('na svahu jde vozovka po ploše dlaždice, ne po pravidelném diamantu', () => {
    // Dlaždice stoupající na východ: východní roh je o patro výš, takže se
    // musí zvednout i střed vozovky. Kdyby se počítala z pravidelného diamantu,
    // silnice by se od terénu odlepila.
    const flat = roadPolygons(FLAT_TILE, 0)[0] ?? [];
    const slope = roadPolygons(tileQuad(0, 0, [0, 1, 0, 1]), 0)[0] ?? [];
    expect(slope).not.toEqual(flat);

    // Plošina o patro výš: vozovka musí být přesně ta samá, jen zvednutá.
    const lifted = roadPolygons(tileQuad(0, 0, [1, 1, 1, 1]), 0)[0] ?? [];
    expect(lifted).toEqual(flat.map((value, i) => (i % 2 === 0 ? value : value - LEVEL_H)));
  });
});

describe('picking', () => {
  it('trefí dlaždici, na kterou se kamera dívá', () => {
    const target = { x: 40, y: 90 };
    const center = tileCenter(target.x, target.y);
    const camera = createCamera(center.x, center.y, 1);

    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, FLAT_HEIGHTS)).toEqual(target);
  });

  it('funguje i mimo jednotkový zoom', () => {
    const target = { x: 7, y: 3 };
    const center = tileCenter(target.x, target.y);
    const camera = createCamera(center.x, center.y, 3.5);

    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, FLAT_HEIGHTS)).toEqual(target);
  });

  it('vrací null mimo mapu', () => {
    const outside = tileCenter(-3, -3);
    const camera = createCamera(outside.x, outside.y, 1);
    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, FLAT_HEIGHTS)).toBeNull();

    const beyond = tileCenter(MAP_SIZE + 2, MAP_SIZE + 2);
    const far = createCamera(beyond.x, beyond.y, 1);
    expect(pickTile(far, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, FLAT_HEIGHTS)).toBeNull();
  });
});

describe('picking s převýšením (§7 fáze 3)', () => {
  /** Mřížka rohů, kde celá plocha od `x0,y0` do konce mapy stojí ve výšce `h`. */
  function plateau(x0: number, y0: number, h: number): Uint8Array {
    const heights = createCornerHeights(MAP_SIZE);
    for (let y = y0; y < MAP_SIZE + 1; y++) {
      for (let x = x0; x < MAP_SIZE + 1; x++)
        heights[cornerIndex(x, y, CORNER_SIZE)] = h;
    }
    return heights;
  }

  /** Kam se na obrazovce promítne střed dlaždice, když je ve výšce `h`. */
  function centerOf(x: number, y: number, h: number): { x: number; y: number } {
    const origin = gridToScreen(x, y, h);
    return { x: origin.x, y: origin.y + TILE_H / 2 };
  }

  it('zvednutá dlaždice se trefí tam, kde se opravdu kreslí', () => {
    // Tohle je přesně ten případ, na kterém `screenToGrid` selhalo: inverze
    // projekce o výšce neví, takže by vrátila dlaždici o pět polí vedle.
    const target = { x: 60, y: 60 };
    const heights = plateau(50, 50, 5);
    const center = centerOf(target.x, target.y, 5);
    const camera = createCamera(center.x, center.y, 1);

    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, heights)).toEqual(
      target,
    );
    // Kontrola, že to není náhoda: vzorec z fáze 1 na témž bodě mine.
    expect(flatInverse(center.x, center.y)).not.toEqual(target);
  });

  it('vyhrává dlaždice blíž k pozorovateli, ne ta za ní', () => {
    // Vysoká dlaždice vpředu zakrývá kus té za sebou. Klik do překryvu patří
    // té přední — to je smysl průchodu od předu dozadu.
    const heights = createCornerHeights(MAP_SIZE);
    for (const [x, y] of [
      [40, 40],
      [41, 40],
      [40, 41],
      [41, 41],
    ] as const) {
      heights[cornerIndex(x, y, CORNER_SIZE)] = MAX_HEIGHT;
    }

    // Střed vysoké dlaždice (40,40) leží nad dlaždicemi, které jsou dál.
    const center = centerOf(40, 40, MAX_HEIGHT);
    const camera = createCamera(center.x, center.y, 1);

    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, heights)).toEqual({
      x: 40,
      y: 40,
    });
  });

  it('trefí i zkroucenou dlaždici (sedlo)', () => {
    // Sedlo se promítne jako nekonvexní čtyřúhelník. Test na konvexní tvar by
    // ho odmítl, ray casting ne.
    const heights = createCornerHeights(MAP_SIZE);
    heights[cornerIndex(30, 30, CORNER_SIZE)] = 1;
    heights[cornerIndex(31, 31, CORNER_SIZE)] = 1;

    const center = { x: gridToScreen(30, 30).x, y: gridToScreen(30, 30).y + TILE_H / 2 - LEVEL_H / 2 };
    const camera = createCamera(center.x, center.y, 1);

    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, heights)).toEqual({
      x: 30,
      y: 30,
    });
  });

  it('na stoupajícím svahu vrátí přední dlaždici, i když míříš na střed zadní', () => {
    // Vypadá to jako chyba, ale je to správně: terén stoupající k pozorovateli
    // znamená, že přední dlaždice je nakreslená výš a zadní zakryje. Přesně
    // tenhle případ vyplaval při zkoušce na vygenerované mapě (4 z 625 vzorků).
    const heights = createCornerHeights(MAP_SIZE);
    for (let y = 0; y < MAP_SIZE + 1; y++) {
      for (let x = 0; x < MAP_SIZE + 1; x++) {
        // Terén stoupá na jihovýchod o patro na dlaždici.
        heights[cornerIndex(x, y, CORNER_SIZE)] = Math.min(
          MAX_HEIGHT,
          Math.max(0, x + y - 100),
        );
      }
    }

    const back = { x: 52, y: 52 };
    const corners = [
      heights[cornerIndex(back.x, back.y, CORNER_SIZE)] ?? 0,
      heights[cornerIndex(back.x + 1, back.y, CORNER_SIZE)] ?? 0,
      heights[cornerIndex(back.x, back.y + 1, CORNER_SIZE)] ?? 0,
      heights[cornerIndex(back.x + 1, back.y + 1, CORNER_SIZE)] ?? 0,
    ];
    const quad = tileQuad(back.x, back.y, corners as [number, number, number, number]);
    const center = {
      x: (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4,
      y: (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4,
    };

    const camera = createCamera(center.x, center.y, 1);
    const hit = pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, heights);

    expect(hit).not.toBeNull();
    // Ať už vyjde kterákoli, musí to být dlaždice, která ten bod opravdu kryje.
    const hitCorners = [
      heights[cornerIndex(hit!.x, hit!.y, CORNER_SIZE)] ?? 0,
      heights[cornerIndex(hit!.x + 1, hit!.y, CORNER_SIZE)] ?? 0,
      heights[cornerIndex(hit!.x, hit!.y + 1, CORNER_SIZE)] ?? 0,
      heights[cornerIndex(hit!.x + 1, hit!.y + 1, CORNER_SIZE)] ?? 0,
    ] as [number, number, number, number];
    expect(containsPoint(tileQuad(hit!.x, hit!.y, hitCorners), center.x, center.y)).toBe(true);
    // A nesmí být dál než ta, na kterou se mířilo.
    expect(hit!.x + hit!.y).toBeGreaterThanOrEqual(back.x + back.y);
  });

  it('na ploché mapě se shoduje se starou inverzí', () => {
    // Regrese: nová cesta nesmí nic pokazit tam, kde ta stará fungovala.
    for (let y = 3; y < MAP_SIZE - 3; y += 11) {
      for (let x = 3; x < MAP_SIZE - 3; x += 11) {
        const center = tileCenter(x, y);
        const camera = createCamera(center.x, center.y, 1);
        expect(
          pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE, FLAT_HEIGHTS),
          `${x},${y}`,
        ).toEqual({ x, y });
      }
    }
  });
});

describe('bod ve čtyřúhelníku', () => {
  it('pozná vnitřek, vnějšek i nekonvexní tvar', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(containsPoint(square, 5, 5)).toBe(true);
    expect(containsPoint(square, 15, 5)).toBe(false);
    expect(containsPoint(square, -1, -1)).toBe(false);

    // Šipka dovnitř: bod ve výřezu leží venku, i když je uvnitř obalu.
    const arrow = [0, 0, 10, 0, 5, 5, 10, 10, 0, 10];
    expect(containsPoint(arrow, 2, 5)).toBe(true);
    expect(containsPoint(arrow, 8, 5)).toBe(false);
  });
});

describe('symboly na střechách', () => {
  it('každý icon z obsahu má tvar, který renderer umí nakreslit', async () => {
    // Neznámý název se dnes jen tiše ignoruje: budova vyjde bez symbolu a nic
    // nikde nezahlásí. Tenhle test je jediné místo, kde se překlep pozná.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const icons = content
      .getAll('building')
      .map((definition) => definition.graphics.icon)
      .filter((icon): icon is string => icon !== undefined);

    expect(icons.length).toBeGreaterThan(0);
    for (const icon of new Set(icons)) {
      expect(iconShape(icon), `chybí tvar pro icon: ${icon}`).toBeDefined();
    }
  });
});

describe('overlay spokojenosti', () => {
  it('spokojenou čtvrť nemaluje vůbec', () => {
    expect(unhappinessValue(HAPPINESS_CLEAN_AT)).toBe(0);
    expect(unhappinessValue(255)).toBe(0);
  });

  it('čím hůř, tím silněji', () => {
    const řada = [190, 128, 76, 0].map(unhappinessValue);
    for (let i = 1; i < řada.length; i++) {
      expect(řada[i]).toBeGreaterThan(řada[i - 1] ?? 0);
    }
    expect(unhappinessValue(0)).toBe(255);
  });

  it('běžné hodnoty využijí většinu stupnice', () => {
    // Toho si všimlo až měření pixelů: první verze škálovala od 128, takže
    // rozdíl mezi „ujde to“ a „zle“ byl v obrázku skoro neviditelný.
    expect(unhappinessValue(76) - unhappinessValue(130)).toBeGreaterThan(60);
  });
});

describe('výška terénu mezi rohy', () => {
  /** Mřížka 3×3 rohů: západní sloupec dole, východní nahoře. */
  function slope(): Uint8Array {
    const heights = createCornerHeights(2);
    const side = 3;
    for (let y = 0; y < side; y++) {
      heights[cornerIndex(0, y, side)] = 0;
      heights[cornerIndex(1, y, side)] = 1;
      heights[cornerIndex(2, y, side)] = 2;
    }
    return heights;
  }

  it('v rohu vrátí přesně jeho výšku', () => {
    const heights = slope();
    expect(groundHeightAt(heights, 0, 0)).toBe(0);
    expect(groundHeightAt(heights, 1, 0)).toBe(1);
    expect(groundHeightAt(heights, 2, 1)).toBe(2);
  });

  it('mezi rohy interpoluje', () => {
    // Podezdívka je zasazená dovnitř dlaždice, takže na celé rohy nepadne.
    // Kdyby se zaokrouhlovalo na nejbližší roh, spodní hrana by po svahu
    // skákala po patrech místo aby ho kopírovala.
    const heights = slope();
    expect(groundHeightAt(heights, 0.5, 0)).toBeCloseTo(0.5);
    expect(groundHeightAt(heights, 0.25, 0)).toBeCloseTo(0.25);
    expect(groundHeightAt(heights, 1.5, 0.5)).toBeCloseTo(1.5);
  });

  it('interpoluje i podél druhé osy', () => {
    // Svah k jihu se musí chovat stejně jako svah k východu. Bez toho by
    // podezdívka kopírovala terén jen v jednom směru a v druhém by ho řezala.
    const heights = createCornerHeights(2);
    const side = 3;
    for (let x = 0; x < side; x++) {
      heights[cornerIndex(x, 0, side)] = 0;
      heights[cornerIndex(x, 1, side)] = 1;
      heights[cornerIndex(x, 2, side)] = 2;
    }

    expect(groundHeightAt(heights, 0, 0.5)).toBeCloseTo(0.5);
    expect(groundHeightAt(heights, 1, 1.25)).toBeCloseTo(1.25);
  });

  it('mimo mapu vrátí nulu, ne výjimku', () => {
    // Je to dotaz na vzhled, ne na pravidlo. Budova u kraje mapy nemá kvůli
    // němu spadnout.
    expect(groundHeightAt(slope(), -3, -3)).toBe(0);
    expect(groundHeightAt(slope(), 99, 99)).toBe(0);
  });

  it('za levým okrajem nesáhne na konec předchozího řádku', () => {
    // Ošemetné: index rohu je `y * side + x`, takže `x = -1` na druhém řádku
    // vyjde jako poslední roh řádku prvního. To je platný index a čte se z něj
    // úplně jiné místo mapy — bez stráže by u západního okraje vyrostl kopec
    // opsaný z východního.
    const heights = slope();
    expect(groundHeightAt(heights, -0.5, 1)).toBe(0);
  });
});

describe('podezdívka kopíruje terén', () => {
  function heightsFor(values: readonly (readonly number[])[]): Uint8Array {
    const side = values.length;
    const heights = createCornerHeights(side - 1);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        heights[cornerIndex(x, y, side)] = values[y]?.[x] ?? 0;
      }
    }
    return heights;
  }

  /** Svislé souřadnice bodů, které leží na spodní hraně (za dvěma horními). */
  function bottomY(face: number[]): number[] {
    const out: number[] = [];
    for (let i = 4; i < face.length; i += 2) out.push(face[i + 1] ?? 0);
    return out;
  }

  it('na svahu se spodní hrana liší od rovné země', () => {
    // Tohle je celá ta nahlášená chyba: podezdívka měla spodní hranu vodorovnou
    // a svah pod ní se sklápěl, takže budova terén protínala. Porovnává se
    // s rovinou, ne „mají body různé y" — v izometrii se hrana sklání i na
    // rovině, protože se vzdaluje od pozorovatele.
    const heights = heightsFor([
      [0, 1],
      [0, 1],
    ]);
    const sloped = skirtFaces(0.12, 0.12, 0.76, 0.76, 1, (fx, fy) =>
      groundHeightAt(heights, fx, fy),
    );
    const flat = skirtFaces(0.12, 0.12, 0.76, 0.76, 1, () => 0);

    expect(bottomY(sloped.left)).not.toEqual(bottomY(flat.left));
    expect(bottomY(sloped.right)).not.toEqual(bottomY(flat.right));
  });

  it('na rovné parcele vyjde totéž co dřív', () => {
    // Ruční stavby si parcelu srovnají. Tam se nesmí nic změnit — jinak by
    // oprava svahu rozhodila všechny budovy ve městě.
    const heights = heightsFor([
      [3, 3],
      [3, 3],
    ]);
    const following = skirtFaces(0.12, 0.12, 0.76, 0.76, 3, (fx, fy) =>
      groundHeightAt(heights, fx, fy),
    );
    const flat = skirtFaces(0.12, 0.12, 0.76, 0.76, 3, () => 3);

    expect(following).toEqual(flat);
  });

  it('přes víc dlaždic se hrana láme na každé hranici', () => {
    // Rovná čára od rohu k rohu by na lomeném svahu budovu buď podřízla, nebo
    // ji nechala viset — proto se vzorkuje i uvnitř půdorysu.
    const heights = heightsFor([
      [0, 2, 0],
      [0, 2, 0],
      [0, 2, 0],
    ]);
    const faces = skirtFaces(0.12, 0.12, 1.76, 1.76, 2, (fx, fy) =>
      groundHeightAt(heights, fx, fy),
    );

    // Dva konce plus jedna vnitřní hranice dlaždic.
    expect(bottomY(faces.left).length).toBe(3);
    const [start, middle, end] = bottomY(faces.left);
    expect(middle).not.toBe(start);
    expect(middle).not.toBe(end);
  });

  it('horní hrana zůstává rovná', () => {
    // Na podezdívce stojí dům a ten rovný je.
    const heights = heightsFor([
      [0, 2],
      [1, 3],
    ]);
    const faces = skirtFaces(0.12, 0.12, 0.76, 0.76, 3, (fx, fy) =>
      groundHeightAt(heights, fx, fy),
    );

    // První dva body každé stěny jsou horní; v izometrii se liší jen posunem
    // daným půdorysem, ne výškou terénu.
    const flat = skirtFaces(0.12, 0.12, 0.76, 0.76, 3, () => 3);
    expect(faces.left.slice(0, 4)).toEqual(flat.left.slice(0, 4));
    expect(faces.right.slice(0, 4)).toEqual(flat.right.slice(0, 4));
  });
});

/**
 * Variace dlaždic (A z rozvahy o terénu).
 *
 * Terén je šest plných barev a na velké louce vypadá jako plast. Variace mu
 * dá zrno bez jediného obrázku. Testuje se to, co jde rozbít potichu:
 * nedeterminismus (terén by se při každém zapečení chunku přebarvil) a
 * příliš velká amplituda (z trávy by byl šum).
 */
describe('variace dlaždic', () => {
  it('je deterministická — stejná dlaždice dá vždy totéž', () => {
    // Kdyby ne, přebarvil by se terén při každém přepečení chunku a mapa by
    // se pod rukama míhala. Chunky se pečou i při pouhém přepnutí vrstvy.
    for (const [x, y] of [[0, 0], [7, 13], [63, 64], [127, 1]] as const) {
      expect(tileVariation(x, y, 0.08)).toBe(tileVariation(x, y, 0.08));
    }
  });

  it('drží se v zadané amplitudě', () => {
    let low = 1;
    let high = 1;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const value = tileVariation(x, y, 0.08);
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
    expect(low).toBeGreaterThanOrEqual(1 - 0.08);
    expect(high).toBeLessThanOrEqual(1 + 0.08);
  });

  it('nulová amplituda znamená žádnou změnu', () => {
    // Voda i skála mají amplitudu skoro nulovou; přesná nula musí vracet
    // přesnou jedničku, aby se barva nepohnula ani o jednotku.
    expect(tileVariation(5, 9, 0)).toBe(1);
  });

  it('sousední dlaždice se liší, ale ne o celou amplitudu', () => {
    // Sůl a pepř by při oddálení splynuly v šum. Hrubá oktáva drží sousedy
    // blízko sebe, takže vznikají skvrny přes několik dlaždic.
    const rozdily: number[] = [];
    for (let y = 10; y < 40; y++) {
      for (let x = 10; x < 40; x++) {
        rozdily.push(Math.abs(tileVariation(x, y, 0.08) - tileVariation(x + 1, y, 0.08)));
      }
    }
    const prumer = rozdily.reduce((a, b) => a + b, 0) / rozdily.length;
    expect(prumer).toBeGreaterThan(0);
    expect(prumer).toBeLessThan(0.08);
  });

  it('rozprostře se kolem jedničky, ne k jednomu kraji', () => {
    // Kdyby hash táhl k jedné straně, celá mapa by ztmavla nebo zesvětlala
    // proti barvě z palety — a to už není variace, ale jiná barva.
    let sum = 0;
    let count = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        sum += tileVariation(x, y, 0.08);
        count++;
      }
    }
    expect(Math.abs(sum / count - 1)).toBeLessThan(0.006);
  });
});

/**
 * Pořadí kreslení budov (nahlásil autor: „některé domy předkreslují ty, co
 * jsou za nimi").
 *
 * Dokud měly všechny budovy stejný půdorys, stačilo řadit podle `x + y`.
 * S obdélníky různých velikostí to přestane platit a **nejde to zachránit
 * jiným skalárem** — protipříklady si odporují. Proto se porovnává po dvojicích.
 */
describe('hloubka budov', () => {
  const box = (x: number, y: number, width: number, depth: number, base = 0) =>
    ({ x, y, width, depth, base });

  it('velká budova se kreslí dřív než malá před ní', () => {
    // Přesně nahlášený případ. Domek hned za pravým okrajem sídliště je
    // blíž pozorovateli, takže sídliště nesmí být nakreslené po něm.
    const sidliste = box(62, 62, 3, 3);
    const domek = box(65, 62, 1, 1);

    expect(compareDepth(sidliste, domek)).toBeLessThan(0);
    expect(compareDepth(domek, sidliste)).toBeGreaterThan(0);
  });

  it('to platí i v druhé ose', () => {
    expect(compareDepth(box(62, 62, 3, 3), box(62, 65, 1, 1))).toBeLessThan(0);
  });

  it('žádné jediné číslo to nezvládne — dva protichůdné případy', () => {
    // Kdyby se řadilo podle x, jeden z těch dvou by vyšel obráceně.
    // Továrna 2×2 a obchod za ní: obchod má VĚTŠÍ x a kreslí se dřív.
    expect(compareDepth(box(11, 9, 1, 1), box(10, 10, 2, 2))).toBeLessThan(0);
    // Dva domky vedle sebe: první má MENŠÍ x a kreslí se dřív.
    expect(compareDepth(box(10, 11, 1, 1), box(11, 10, 1, 1))).toBeLessThan(0);
  });

  it('ve stejné hloubce je výš položená budova dál', () => {
    // Dvě budovy vedle sebe, jedna na kopci: v izometrii se překrývají a ta
    // výš stojící je od pozorovatele dál (§7 fáze 3).
    const nahore = box(20, 20, 1, 1, 5);
    const dole = box(20, 20, 1, 1, 0);

    expect(compareDepth(nahore, dole)).toBeLessThan(0);
  });

  it('řada domů se seřadí od zadního k přednímu', () => {
    const rada = [box(14, 10, 1, 1), box(10, 10, 1, 1), box(12, 10, 1, 1)];
    const serazeno = [...rada].sort(compareDepth).map((b) => b.x);

    expect(serazeno).toEqual([10, 12, 14]);
  });

  it('sousedící budovy se považují za zaň sebou, ne za překrývající', () => {
    // Dotýkají se hranou: `A.x + A.width === B.x`. Musí se to počítat jako
    // „za sebou", jinak by o jejich pořadí rozhodovala až výška.
    expect(isBehind(box(10, 10, 2, 2), box(12, 10, 2, 2))).toBe(true);
    expect(isBehind(box(12, 10, 2, 2), box(10, 10, 2, 2))).toBe(false);
  });
});
