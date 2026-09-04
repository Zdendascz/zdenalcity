import { Container, Graphics } from 'pixi.js';
import { COARSE_FACTOR, coarseSizeOf } from '@/sim/coarse';
import { cornerIndex, cornerSideOf } from '@/sim/heights';
import { index, ROAD } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import {
  COVERAGE_COLOR,
  COVERAGE_EDGE_COLOR,
  COVERAGE_EDGE_WIDTH,
  COVERAGE_GOOD,
  COVERAGE_MAX_ALPHA,
  COVERAGE_MIN_ALPHA,
  HEAT_ALPHA,
  heatColor,
} from './palette';
import { areaQuad } from './projection';

/**
 * Jeden diagnostický pohled na hrubou mřížku.
 *
 * Hodnoty se čtou přes funkci, ne z pevné vrstvy — pokrytí službami totiž
 * v `CoarseLayers` není (je odvozené) a přesto se zobrazuje stejně.
 */
export interface CoarseLayerView {
  id: string;
  /**
   * Jak se pohled kreslí.
   *
   * `heat` je tepelná mapa od zelené po rudou, `coverage` je mapa dosahu
   * s bílou hranicí. Jsou to **dvě různé otázky** — „jak je na tom tahle čtvrť"
   * a „kam ta stanice dosáhne" — a autor si vyžádal obě zvlášť.
   */
  kind: 'heat' | 'coverage';
  /**
   * Hodnota 0–255 → jak dobře na tom dlaždice je (0 strašné, 1 skvělé).
   *
   * Směr si nese každý pohled sám: u znečištění je vysoká hodnota zlá, u ceny
   * půdy dobrá. Bez toho by tepelná mapa svítila rudě na bohaté čtvrti.
   */
  goodness?(value: number): number;
  values(): Uint8Array | undefined;
}

/**
 * Overlay pro veličiny na hrubé mřížce.
 *
 * Kreslí **jeden čtyřúhelník na buňku 32×32**, ne na dlaždici. Hodnota je přes
 * blok 4×4 konstantní, takže kreslit ji šestnáctkrát je jen šestnáctkrát víc
 * práce za stejný obrázek. Prakticky: překreslení po každé difuzi stálo 33 ms
 * jako součást chunků, tady je to zlomek.
 */
export class CoarseOverlay {
  private readonly graphics = new Graphics();
  private readonly layers = new Map<string, CoarseLayerView>();
  private active = 'none';
  /** Minule nebylo co kreslit — zkusí se to znovu, i když se nic neohlásilo. */
  private empty = false;
  private readonly world: ReadonlyWorldView;

  constructor(
    world: ReadonlyWorldView,
    parent: Container,
    layers: readonly CoarseLayerView[],
  ) {
    this.world = world;
    for (const layer of layers) this.layers.set(layer.id, layer);
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  setActive(id: string): void {
    if (this.active === id) return;
    this.active = this.layers.has(id) ? id : 'none';
    this.graphics.visible = this.active !== 'none';
    if (this.active !== 'none') this.redraw();
  }

  getActive(): string {
    return this.active;
  }

  /**
   * Volá se, když simulace ohlásí změnu — vypnutý overlay nic nekreslí.
   *
   * Zkouší to znovu i **bez ohlášené změny**, pokud minule nebylo co kreslit.
   * Pokrytí službami se po načtení savu zahodí a dopočítá se až prvním během
   * systému služeb; kdo si ten pohled zapnul v pauze dřív, díval se na prázdno
   * a už nikdy by se mu nerozsvítilo.
   */
  update(coarseChanged: boolean): void {
    if (this.active === 'none') return;
    if (coarseChanged || this.empty) this.redraw();
  }

  private redraw(): void {
    this.graphics.clear();

    const layer = this.layers.get(this.active);
    const values = layer?.values();
    this.empty = !values;
    if (!layer || !values) return;

    if (layer.kind === 'coverage') this.drawCoverage(values);
    else this.drawHeat(layer, values);
  }

  /**
   * Tepelná mapa. Kreslí se **jen tam, kde město je**.
   *
   * Nulová hodnota je u většiny veličin ten nejlepší možný stav, takže by se
   * celá mapa i s lesy a horami natřela zeleně a hráč by v tom čtvrť nenašel.
   * Diagnostika se ptá na město; kde nic nestojí, není co diagnostikovat.
   */
  private drawHeat(layer: CoarseLayerView, values: Uint8Array): void {
    const coarseSize = coarseSizeOf(this.world.size);
    const goodness = layer.goodness ?? ((value: number) => 1 - value / 255);

    for (let cellY = 0; cellY < coarseSize; cellY++) {
      for (let cellX = 0; cellX < coarseSize; cellX++) {
        if (!this.isBuilt(cellX, cellY)) continue;
        const value = values[cellY * coarseSize + cellX] ?? 0;
        this.graphics
          .poly(this.cellQuad(cellX, cellY))
          .fill({ color: heatColor(goodness(value)), alpha: HEAT_ALPHA });
      }
    }
  }

  /**
   * Mapa dosahu: závoj podle síly a **bílá hranice tam, kde dosah končí**.
   *
   * Hranice se kreslí po hranách buněk, ne obtahem každé buňky. Obtah kolem
   * všech pokrytých buněk by nakreslil mřížku přes celou oblast; zajímavá je
   * jen ta hrana, za kterou už služba nedosáhne.
   *
   * Čáry jsou dvě: vnější je konec dosahu, vnitřní odděluje slabé pokrytí od
   * dostatečného. Podle té vnitřní se pozná, kde stanice sotva dosahuje a kde
   * doopravdy funguje.
   */
  private drawCoverage(values: Uint8Array): void {
    const coarseSize = coarseSizeOf(this.world.size);
    const at = (cellX: number, cellY: number): number =>
      cellX < 0 || cellY < 0 || cellX >= coarseSize || cellY >= coarseSize
        ? 0
        : (values[cellY * coarseSize + cellX] ?? 0);

    for (let cellY = 0; cellY < coarseSize; cellY++) {
      for (let cellX = 0; cellX < coarseSize; cellX++) {
        const value = at(cellX, cellY);
        if (value === 0) continue;
        // Sytost od `COVERAGE_MIN_ALPHA` nahoru, ne od nuly. Skutečné pokrytí se
        // drží kolem třetiny stupnice, takže čistě poměrný závoj byl na mapě
        // sotva vidět — a otázka „kam ta stanice dosáhne" se ptá především na
        // to, jestli je dlaždice pokrytá, teprve potom jak silně.
        const strength = value / 255;
        this.graphics.poly(this.cellQuad(cellX, cellY)).fill({
          color: COVERAGE_COLOR,
          alpha: COVERAGE_MIN_ALPHA + strength * (COVERAGE_MAX_ALPHA - COVERAGE_MIN_ALPHA),
        });
      }
    }

    this.strokeBoundary(coarseSize, at, 1, COVERAGE_EDGE_WIDTH, 1);
    this.strokeBoundary(coarseSize, at, COVERAGE_GOOD, COVERAGE_EDGE_WIDTH / 2, 0.65);
  }

  /** Obtáhne hranu mezi „nad prahem" a „pod prahem". */
  private strokeBoundary(
    coarseSize: number,
    at: (cellX: number, cellY: number) => number,
    threshold: number,
    width: number,
    alpha: number,
  ): void {
    // Vrcholy `areaQuad` jdou sever → východ → jih → západ, takže hrana
    // k severnímu sousedovi je úsečka mezi prvním a druhým bodem.
    const edges = [
      [0, 1, 0, -1],
      [1, 2, 1, 0],
      [2, 3, 0, 1],
      [3, 0, -1, 0],
    ] as const;

    for (let cellY = 0; cellY < coarseSize; cellY++) {
      for (let cellX = 0; cellX < coarseSize; cellX++) {
        if (at(cellX, cellY) < threshold) continue;
        const quad = this.cellQuad(cellX, cellY);
        for (const [from, to, dx, dy] of edges) {
          if (at(cellX + dx, cellY + dy) >= threshold) continue;
          this.graphics
            .moveTo(quad[from * 2] ?? 0, quad[from * 2 + 1] ?? 0)
            .lineTo(quad[to * 2] ?? 0, quad[to * 2 + 1] ?? 0)
            .stroke({ color: COVERAGE_EDGE_COLOR, width, alpha });
        }
      }
    }
  }

  /**
   * Stojí v buňce vůbec něco?
   *
   * Silnice se počítá stejně jako budova: prázdná parcela u ulice je pořád
   * součást města a hráč na ni bude stavět. Les za městem ne.
   */
  private isBuilt(cellX: number, cellY: number): boolean {
    const startX = cellX * COARSE_FACTOR;
    const startY = cellY * COARSE_FACTOR;
    for (let y = startY; y < startY + COARSE_FACTOR && y < this.world.size; y++) {
      for (let x = startX; x < startX + COARSE_FACTOR && x < this.world.size; x++) {
        const tile = index(x, y, this.world.size);
        if ((this.world.layers.buildingId[tile] ?? 0) !== 0) return true;
        if ((this.world.layers.road[tile] ?? ROAD.none) !== ROAD.none) return true;
      }
    }
    return false;
  }

  /**
   * Čtyřúhelník buňky. Blok se naklopí podle **svých čtyř rohů**, ne podle
   * každé dlaždice uvnitř. Je to aproximace: uvnitř bloku může terén stoupat
   * jinak než rovina mezi rohy. Šestnáctkrát víc polygonů za stejnou informaci
   * ale nestojí za to — a přesně kvůli tomu tenhle overlay vznikl.
   */
  private cellQuad(cellX: number, cellY: number): number[] {
    const x = cellX * COARSE_FACTOR;
    const y = cellY * COARSE_FACTOR;
    return areaQuad(x, y, COARSE_FACTOR, COARSE_FACTOR, this.blockCorners(x, y));
  }

  /** Výšky čtyř rohů bloku 4×4 v pořadí SZ, SV, JZ, JV. */
  private blockCorners(x: number, y: number): [number, number, number, number] {
    const heights = this.world.cornerHeight;
    const side = cornerSideOf(heights);
    const far = COARSE_FACTOR;
    return [
      heights[cornerIndex(x, y, side)] ?? 0,
      heights[cornerIndex(x + far, y, side)] ?? 0,
      heights[cornerIndex(x, y + far, side)] ?? 0,
      heights[cornerIndex(x + far, y + far, side)] ?? 0,
    ];
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
