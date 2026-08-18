import { Container, Graphics } from 'pixi.js';
import { COARSE_FACTOR, COARSE_SIZE } from '@/sim/coarse';
import type { CoarseLayers } from '@/sim/coarse';
import type { ReadonlyWorldView } from '@/sim/simHost';
import {
  LAND_VALUE_COLOR,
  LAND_VALUE_MAX_ALPHA,
  POLLUTION_COLOR,
  POLLUTION_MAX_ALPHA,
} from './palette';
import { footprintQuad } from './projection';

/** Kterou vrstvu hrubé mřížky overlay ukazuje. */
export type CoarseOverlayLayer = 'none' | keyof CoarseLayers;

const STYLES: Readonly<Record<keyof CoarseLayers, { color: number; maxAlpha: number }>> = {
  pollution: { color: POLLUTION_COLOR, maxAlpha: POLLUTION_MAX_ALPHA },
  landValue: { color: LAND_VALUE_COLOR, maxAlpha: LAND_VALUE_MAX_ALPHA },
};

/**
 * Overlay pro vrstvy na hrubé mřížce.
 *
 * Kreslí **jeden čtyřúhelník na buňku 32×32**, ne na dlaždici. Hodnota je přes
 * blok 4×4 konstantní, takže kreslit ji šestnáctkrát je jen šestnáctkrát víc
 * práce za stejný obrázek. Prakticky: překreslení po každé difuzi stálo 33 ms
 * jako součást chunků, tady je to zlomek.
 *
 * Sílu nese průhlednost, ne barva — barevný přechod by se pletl se zónami.
 */
export class CoarseOverlay {
  private readonly world: ReadonlyWorldView;
  private readonly graphics = new Graphics();
  private layer: CoarseOverlayLayer = 'none';

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  setLayer(layer: CoarseOverlayLayer): void {
    if (this.layer === layer) return;
    this.layer = layer;
    this.graphics.visible = layer !== 'none';
    if (layer !== 'none') this.redraw();
  }

  getLayer(): CoarseOverlayLayer {
    return this.layer;
  }

  /** Volá se, když difuze ohlásí změnu — vypnutý overlay nic nekreslí. */
  update(coarseChanged: boolean): void {
    if (this.layer !== 'none' && coarseChanged) this.redraw();
  }

  private redraw(): void {
    this.graphics.clear();
    if (this.layer === 'none') return;

    const values = this.world.coarse[this.layer];
    const style = STYLES[this.layer];

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
          .fill({ color: style.color, alpha: (value / 255) * style.maxAlpha });
      }
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
