/**
 * @vitest-environment jsdom
 *
 * Čtvercová síť po hranicích dlaždic.
 *
 * Testuje se to, co jde rozbít potichu:
 *
 * - **výřez** — kdyby počítal špatně, síť by u okraje obrazovky chyběla nebo by
 *   se kreslila celá mapa a hra by se u toho zadrhla,
 * - **příznak změny výšek** — kdyby ho nastavovala i zóna nebo silnice, síť by
 *   se v živém městě přestavovala několikrát za sekundu,
 * - a **že přepnutí sítě nehýbe pohledem**, což si autor vyžádal doslova.
 */
import { describe, expect, it } from 'vitest';
import { cornerRange } from '@/render/gridOverlay';
import { viewportFor } from '@/render/chunkRenderer';
import { gridToScreen, LEVEL_H, TILE_H, TILE_W } from '@/render/projection';
import { buildRoad, terraformCorner, zoneArea } from '@/sim/commands';
import { MAX_HEIGHT } from '@/sim/heights';
import { ROAD, ZONE } from '@/sim/layers';
import { createWorld } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

const SIZE = 128;

/** Kamera nad daným rohem mřížky, v daném měřítku, na okně 1280×720. */
function viewAt(cornerX: number, cornerY: number, zoom: number) {
  const center = gridToScreen(cornerX, cornerY, 0);
  return viewportFor(center.x, center.y, zoom, 1280, 720);
}

describe('výřez čtvercové sítě', () => {
  it('obsahuje roh, na který se kamera dívá', () => {
    for (const [x, y] of [
      [0, 0],
      [10, 90],
      [64, 64],
      [127, 3],
    ] as const) {
      const range = cornerRange(viewAt(x, y, 1), SIZE);
      expect(range.x0, `x0 u ${x},${y}`).toBeLessThanOrEqual(x);
      expect(range.x1, `x1 u ${x},${y}`).toBeGreaterThanOrEqual(x);
      expect(range.y0, `y0 u ${x},${y}`).toBeLessThanOrEqual(y);
      expect(range.y1, `y1 u ${x},${y}`).toBeGreaterThanOrEqual(y);
    }
  });

  it('nikdy nevyleze z mřížky', () => {
    // Kamera za rohem mapy. Bez zastřižení by se sahalo mimo `cornerHeight`
    // a síť by se kreslila do prázdna.
    for (const [x, y] of [
      [-40, -40],
      [200, 200],
      [-40, 200],
    ] as const) {
      const range = cornerRange(viewAt(x, y, 1), SIZE);
      expect(range.x0).toBeGreaterThanOrEqual(0);
      expect(range.y0).toBeGreaterThanOrEqual(0);
      expect(range.x1).toBeLessThanOrEqual(SIZE);
      expect(range.y1).toBeLessThanOrEqual(SIZE);
    }
  });

  it('počítá s tím, že kopec je nakreslený výš, než kde stojí', () => {
    // Dlaždice na vrcholu se kreslí až o `MAX_HEIGHT · LEVEL_H` výš. Kdyby se
    // s tím výřez nepočítal, hory u horní hrany obrazovky by síť neměly.
    const flat = cornerRange(viewAt(64, 64, 1), SIZE);
    const raised = MAX_HEIGHT * LEVEL_H;
    // Rezerva se projeví na dolním konci obou os: rohy „zpod obrazovky"
    // se po zvednutí dostanou nahoru do záběru.
    expect(flat.x1 - flat.x0).toBeGreaterThan(raised / TILE_H / 2);
    expect(flat.y1 - flat.y0).toBeGreaterThan(raised / TILE_H / 2);
  });

  it('při oddálení je větší než při přiblížení', () => {
    const near = cornerRange(viewAt(64, 64, 4), SIZE);
    const far = cornerRange(viewAt(64, 64, 0.5), SIZE);
    expect(far.x1 - far.x0).toBeGreaterThan(near.x1 - near.x0);
    expect(far.y1 - far.y0).toBeGreaterThan(near.y1 - near.y0);
  });

  it('posun o pár pixelů výřezem nehne', () => {
    // Kdyby s ním hnul, síť by se přestavovala každý snímek tažení.
    const a = cornerRange(viewAt(64, 64, 1), SIZE);
    const center = gridToScreen(64, 64, 0);
    const b = cornerRange(viewportFor(center.x + 3, center.y + 3, 1, 1280, 720), SIZE);
    expect(b).toEqual(a);
  });

  it('posun o celou obrazovku výřezem hne', () => {
    const a = cornerRange(viewAt(64, 64, 1), SIZE);
    const center = gridToScreen(64, 64, 0);
    const b = cornerRange(viewportFor(center.x + TILE_W * 30, center.y, 1, 1280, 720), SIZE);
    expect(b).not.toEqual(a);
  });
});

describe('kdy se síť překresluje', () => {
  it('změna výšky terénu se ohlásí', () => {
    const world = createWorld(1, VANILLA_BALANCE.economy, SIZE);
    const rules = VANILLA_BALANCE;
    world.dirty.heightsChanged = false;

    terraformCorner(world, 30, 30, 1, rules);

    expect(world.dirty.heightsChanged).toBe(true);
  });

  it('zóna ani silnice výšky nemění, takže se síť nepřestavuje', () => {
    // Tohle je celý smysl vlastního příznaku. Dům, který vyroste, a silnice,
    // kterou hráč táhne, špiní dlaždice — ale rohy nechávají být.
    const world = createWorld(1, VANILLA_BALANCE.economy, SIZE);
    const rules = VANILLA_BALANCE;

    // Rovina schválně: zónování si od T68 terén samo srovnává, takže na svahu
    // by výšku změnilo právem. Čerstvý svět je celý v nule.
    world.dirty.heightsChanged = false;
    zoneArea(world, 20, 20, 3, 3, ZONE.residential, rules);
    expect(world.dirty.heightsChanged).toBe(false);

    world.dirty.heightsChanged = false;
    buildRoad(world, 40, 40, ROAD.street, rules);
    expect(world.dirty.tiles.size).toBeGreaterThan(0);
    expect(world.dirty.heightsChanged).toBe(false);
  });
});
