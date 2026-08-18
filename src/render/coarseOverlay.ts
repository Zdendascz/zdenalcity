import { Container, Graphics } from 'pixi.js';
import { COARSE_FACTOR, COARSE_SIZE } from '@/sim/coarse';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { POLLUTION_COLOR, POLLUTION_MAX_ALPHA } from './palette';
import { footprintQuad } from './projection';

/**
 * Overlay pro vrstvy na hrubé mřížce.
 *
 * Kreslí **jeden čtyřúhelník na buňku 32×32**, ne na dlaždici. Hodnota je přes
 * blok 4×4 konstantní, takže kreslit ji šestnáctkrát je jen šestnáctkrát víc
 * práce za stejný obrázek. Prakticky: překreslení po každé difuzi stálo 33 ms
 * jako součást chunků, tady je to zlomek.
 *
 * Je to vlastní vrstva nad terénem, takže zapnutí ani přepočet difuze
 * nevyžadují sáhnout na chunky.
 */
export class CoarseOverlay {
  private readonly world: ReadonlyWorldView;
  private readonly graphics = new Graphics();
  private visible = false;

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.graphics.visible = visible;
    if (visible) this.redraw();
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Volá se, když difuze ohlásí změnu — mimo zapnutý overlay se nic nekreslí. */
  update(coarseChanged: boolean): void {
    if (this.visible && coarseChanged) this.redraw();
  }

  private redraw(): void {
    this.graphics.clear();
    const pollution = this.world.coarse.pollution;

    for (let cellY = 0; cellY < COARSE_SIZE; cellY++) {
      for (let cellX = 0; cellX < COARSE_SIZE; cellX++) {
        const value = pollution[cellY * COARSE_SIZE + cellX] ?? 0;
        if (value === 0) continue;

        const quad = footprintQuad(
          cellX * COARSE_FACTOR,
          cellY * COARSE_FACTOR,
          COARSE_FACTOR,
          COARSE_FACTOR,
        );
        // Sílu nese průhlednost, ne barva — ramp by se pletl s barevnými zónami.
        this.graphics
          .poly(quad)
          .fill({ color: POLLUTION_COLOR, alpha: (value / 255) * POLLUTION_MAX_ALPHA });
      }
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
