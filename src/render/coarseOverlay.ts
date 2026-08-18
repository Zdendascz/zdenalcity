import { Container, Graphics } from 'pixi.js';
import { COARSE_FACTOR, COARSE_SIZE } from '@/sim/coarse';
import { footprintQuad } from './projection';

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

  constructor(parent: Container, layers: readonly CoarseLayerView[]) {
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

    for (let cellY = 0; cellY < COARSE_SIZE; cellY++) {
      for (let cellX = 0; cellX < COARSE_SIZE; cellX++) {
        const value = values[cellY * COARSE_SIZE + cellX] ?? 0;
        if (value === 0) continue;

        const quad = footprintQuad(
          cellX * COARSE_FACTOR,
          cellY * COARSE_FACTOR,
          COARSE_FACTOR,
          COARSE_FACTOR,
        );
        this.graphics
          .poly(quad)
          .fill({ color: layer.color, alpha: (value / 255) * layer.maxAlpha });
      }
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
