import { Container, Graphics } from 'pixi.js';
import { COARSE_FACTOR, coarseSizeOf } from '@/sim/coarse';
import { cornerIndex, cornerSideOf } from '@/sim/heights';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { areaQuad } from './projection';

/**
 * Jeden diagnostický pohled na hrubou mřížku.
 *
 * Hodnoty se čtou přes funkci, ne z pevné vrstvy — pokrytí službami totiž
 * v `CoarseLayers` není (je odvozené) a přesto se zobrazuje stejně.
 */
export interface CoarseLayerView {
  id: string;
  color: number;
  maxAlpha: number;
  values(): Uint8Array | undefined;
}

/**
 * Overlay pro veličiny na hrubé mřížce.
 *
 * Kreslí **jeden čtyřúhelník na buňku 32×32**, ne na dlaždici. Hodnota je přes
 * blok 4×4 konstantní, takže kreslit ji šestnáctkrát je jen šestnáctkrát víc
 * práce za stejný obrázek. Prakticky: překreslení po každé difuzi stálo 33 ms
 * jako součást chunků, tady je to zlomek.
 *
 * Sílu nese průhlednost, ne barva — barevný přechod by se pletl se zónami.
 */
export class CoarseOverlay {
  private readonly graphics = new Graphics();
  private readonly layers = new Map<string, CoarseLayerView>();
  private active = 'none';
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

  /** Volá se, když simulace ohlásí změnu — vypnutý overlay nic nekreslí. */
  update(coarseChanged: boolean): void {
    if (this.active !== 'none' && coarseChanged) this.redraw();
  }

  private redraw(): void {
    this.graphics.clear();

    const layer = this.layers.get(this.active);
    const values = layer?.values();
    if (!layer || !values) return;

    const coarseSize = coarseSizeOf(this.world.size);
    for (let cellY = 0; cellY < coarseSize; cellY++) {
      for (let cellX = 0; cellX < coarseSize; cellX++) {
        const value = values[cellY * coarseSize + cellX] ?? 0;
        if (value === 0) continue;

        // Blok se naklopí podle **svých čtyř rohů**, ne podle každé dlaždice
        // uvnitř. Je to aproximace: uvnitř bloku může terén stoupat jinak, než
        // rovina mezi rohy. Šestnáctkrát víc polygonů za stejnou informaci ale
        // nestojí za to — a přesně kvůli tomu tenhle overlay vznikl.
        const x = cellX * COARSE_FACTOR;
        const y = cellY * COARSE_FACTOR;
        const quad = areaQuad(x, y, COARSE_FACTOR, COARSE_FACTOR, this.blockCorners(x, y));
        this.graphics
          .poly(quad)
          .fill({ color: layer.color, alpha: (value / 255) * layer.maxAlpha });
      }
    }
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
