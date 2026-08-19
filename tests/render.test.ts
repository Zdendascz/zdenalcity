import { describe, expect, it } from 'vitest';
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
import { pickTile } from '@/render/picking';
import {
  cuboidFaces,
  diamondPoints,
  gridToScreen,
  screenToGrid,
  TILE_H,
  TILE_W,
} from '@/render/projection';
import { shade, TERRAIN_COLORS } from '@/render/palette';
import { roadMask, roadPolygons, ROAD_E, ROAD_N, ROAD_S, ROAD_W } from '@/render/roads';
import { MAP_SIZE, TERRAIN } from '@/sim/layers';

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

  it('screenToGrid je inverzní ke gridToScreen na ploché mapě', () => {
    for (let y = 0; y < MAP_SIZE; y += 7) {
      for (let x = 0; x < MAP_SIZE; x += 7) {
        const center = tileCenter(x, y);
        expect(screenToGrid(center.x, center.y), `${x},${y}`).toEqual({ x, y });
      }
    }
  });

  it('diamondPoints vrací čtyři vrcholy kolem horního rohu', () => {
    expect(diamondPoints(0, 0)).toEqual([0, 0, 32, 16, 0, 32, -32, 16]);
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
      expect(roadPolygons(0, 0, mask), `mask ${mask}`).toHaveLength(1 + arms);
    }
  });

  it('středový kus je zmenšený diamant kolem středu dlaždice', () => {
    expect(roadPolygons(0, 0, 0)[0]).toEqual([0, 8, 16, 16, 0, 24, -16, 16]);
  });

  it('rameno sahá až na hranu diamantu, aby sousedé navazovali bez mezery', () => {
    // Severní hrana dlaždice vede z horního vrcholu (0,0) do pravého (32,16).
    expect(roadPolygons(0, 0, ROAD_N)[1]).toEqual([0, 8, 16, 16, 32, 16, 0, 0]);
  });

  it('respektuje posun počátku dlaždice', () => {
    const shifted = roadPolygons(100, 200, 0)[0];
    expect(shifted).toEqual([100, 208, 116, 216, 100, 224, 84, 216]);
  });
});

describe('picking', () => {
  it('trefí dlaždici, na kterou se kamera dívá', () => {
    const target = { x: 40, y: 90 };
    const center = tileCenter(target.x, target.y);
    const camera = createCamera(center.x, center.y, 1);

    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE)).toEqual(target);
  });

  it('funguje i mimo jednotkový zoom', () => {
    const target = { x: 7, y: 3 };
    const center = tileCenter(target.x, target.y);
    const camera = createCamera(center.x, center.y, 3.5);

    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE)).toEqual(target);
  });

  it('vrací null mimo mapu', () => {
    const outside = tileCenter(-3, -3);
    const camera = createCamera(outside.x, outside.y, 1);
    expect(pickTile(camera, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE)).toBeNull();

    const beyond = tileCenter(MAP_SIZE + 2, MAP_SIZE + 2);
    const far = createCamera(beyond.x, beyond.y, 1);
    expect(pickTile(far, VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, MAP_SIZE)).toBeNull();
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
