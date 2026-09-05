import { Container, Graphics } from 'pixi.js';
import { cornerIndex, MAX_HEIGHT } from '@/sim/heights';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { Viewport } from './chunkRenderer';
import { GRID_ALPHA, GRID_COLOR_SURFACE, GRID_COLOR_UNDERGROUND, GRID_WIDTH } from './palette';
import { gridToScreen, LEVEL_H, TILE_H, TILE_W } from './projection';

/**
 * Čtvercová síť po hranicích dlaždic.
 *
 * Vyžádal si ji autor: v izometrii bez ní nejde poznat, kde jedna dlaždice
 * končí a druhá začíná, dokud na ni nenajedeš myší — a na telefonu ani pak.
 *
 * Síť **kopíruje terén**, nekreslí se jako rovná mřížka přes obrazovku. Vede
 * přes rohy dlaždic i s jejich výškami, takže na svahu jde s kopcem. Rovná
 * mřížka by na kopci lhala přesně tam, kde je zarovnání nejtěžší.
 *
 * Barva se řídí pohledem, ne přepínačem: na povrchu černá, pod zemí bílá.
 * Přepnout síť **pohled nemění** — to je půlka zadání a je to tím, že tohle
 * není nástroj, ale zobrazení. Nikdo tu nevolá `setView`.
 */
export class GridOverlay {
  private readonly graphics = new Graphics();
  private readonly world: ReadonlyWorldView;
  private visible = false;
  private underground = false;
  /** Co je zrovna nakreslené. `null` = nic, příště se kreslí tak jako tak. */
  private drawn: Range | null = null;

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.graphics.visible = visible;
    this.drawn = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setUnderground(underground: boolean): void {
    if (this.underground === underground) return;
    this.underground = underground;
    this.drawn = null;
  }

  /**
   * Překreslí, jen když je co.
   *
   * Tři důvody a žádný jiný: změnil se terén, hráč odjel jinam, nebo se změnilo
   * měřítko (síla čáry se jím dělí). Posun se přitom měří **po blocích**
   * `STEP` dlaždic — jinak by se síť přestavovala každý snímek tažení.
   */
  update(heightsChanged: boolean, view: Viewport, zoom: number): void {
    if (!this.visible) return;
    if (heightsChanged) this.drawn = null;

    const range = { ...cornerRange(view, this.world.size), zoom };
    if (
      this.drawn !== null &&
      this.drawn.x0 === range.x0 &&
      this.drawn.y0 === range.y0 &&
      this.drawn.x1 === range.x1 &&
      this.drawn.y1 === range.y1 &&
      this.drawn.zoom === range.zoom
    ) {
      return;
    }

    this.redraw(range);
  }

  /**
   * Kreslí se **lomené čáry po celých řadách**, ne úsečka na každou hranu.
   *
   * Úseček je stejně, ale cesta je jedna na řadu místo jedné na dlaždici —
   * u pohledu na celou mapu je to rozdíl mezi třiceti tisíci cestami a dvěma
   * sty padesáti.
   */
  private redraw(range: Range): void {
    this.drawn = range;
    this.graphics.clear();

    const corners = this.world.size + 1;
    const heights = this.world.cornerHeight;
    const at = (x: number, y: number): { x: number; y: number } =>
      gridToScreen(x, y, heights[cornerIndex(x, y, corners)] ?? 0);

    for (let y = range.y0; y <= range.y1; y++) {
      const start = at(range.x0, y);
      this.graphics.moveTo(start.x, start.y);
      for (let x = range.x0 + 1; x <= range.x1; x++) {
        const point = at(x, y);
        this.graphics.lineTo(point.x, point.y);
      }
    }

    for (let x = range.x0; x <= range.x1; x++) {
      const start = at(x, range.y0);
      this.graphics.moveTo(start.x, start.y);
      for (let y = range.y0 + 1; y <= range.y1; y++) {
        const point = at(x, y);
        this.graphics.lineTo(point.x, point.y);
      }
    }

    this.graphics.stroke({
      color: this.underground ? GRID_COLOR_UNDERGROUND : GRID_COLOR_SURFACE,
      alpha: GRID_ALPHA,
      // Čára má na obrazovce zůstat vlasová, ať je hráč přiblížený jakkoli.
      // Kontejner světa je zvětšený měřítkem, takže se jím šířka musí vydělit.
      width: GRID_WIDTH / range.zoom,
    });
  }
}

interface Range {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  zoom: number;
}

/**
 * Po kolika rozích se rozsah zaokrouhluje.
 *
 * Bez zaokrouhlení by posun o jediný pixel znamenal jiný rozsah a tedy
 * překreslení každý snímek. Osm je velikost chunku — stejná úvaha, stejné číslo.
 */
const STEP = 8;

/**
 * Které rohy mřížky mohou být na obrazovce.
 *
 * Obrácená izometrie. Z `sx = (x − y)·TILE_W/2` a `sy = (x + y)·TILE_H/2 − e·LEVEL_H`
 * plyne
 *
 * ```
 * x = sx/TILE_W + u/TILE_H
 * y = u/TILE_H − sx/TILE_W        kde u = sy + e·LEVEL_H
 * ```
 *
 * Výšku `e` nikdo dopředu nezná, tak se počítá s celým jejím rozsahem: dlaždice
 * na vrcholu kopce se kreslí až o `MAX_HEIGHT·LEVEL_H` výš, takže její roh může
 * být vidět, i když její místo na rovině dávno vyjelo dolem z obrazovky.
 */
export function cornerRange(
  view: Viewport,
  size: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const last = size; // rohů je size + 1, poslední má index size
  const uMin = view.minY;
  const uMax = view.maxY + MAX_HEIGHT * LEVEL_H;

  return {
    x0: snap(view.minX / TILE_W + uMin / TILE_H, last, false),
    x1: snap(view.maxX / TILE_W + uMax / TILE_H, last, true),
    y0: snap(-view.maxX / TILE_W + uMin / TILE_H, last, false),
    y1: snap(-view.minX / TILE_W + uMax / TILE_H, last, true),
  };
}

/** Zaokrouhlí ven na násobek `STEP` a zastřihne do mřížky. */
function snap(value: number, last: number, up: boolean): number {
  const stepped = (up ? Math.ceil(value / STEP) : Math.floor(value / STEP)) * STEP;
  return Math.max(0, Math.min(last, stepped));
}
