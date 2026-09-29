import { Container, Graphics } from 'pixi.js';
import { tileCorners } from '@/sim/heights';
import { index, WIRE } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { roadMask } from '@/sim/roads';
import { tileQuad } from './projection';
import { roadPolygons } from './roads';

/**
 * Elektrické vedení ve vrstvě elektřiny (T129).
 *
 * Kreslí se jen se zapnutou vrstvou Elektřina — stejně jako potrubí jen
 * v podzemí. Tvar vedení se počítá jako tvar silnice (`roadPolygons`), jen
 * užší, takže úseky navazují a odbočky sedí.
 *
 * Barva je **vytížení**: zelená volné, přes žlutou a oranžovou k červené
 * u kapacity, tmavě červený přetížený úsek, za kterým je výpadek.
 * Vysoké napětí je širší.
 */

const WIDTH = [0, 0.14, 0.24] as const;
const LOAD_COLORS = [0x3ecf5a, 0xb9d63a, 0xf1c232, 0xf08a24, 0xe23b2e] as const;
const OVERLOAD_COLOR = 0x7a0d0d;
const OUTLINE_COLOR = 0x1b1f24;

export class WireOverlay {
  private readonly world: ReadonlyWorldView;
  private readonly graphics = new Graphics();
  private readonly capacity: (type: number) => number;
  private visible = false;
  private drawnRevision = -1;

  constructor(parent: Container, world: ReadonlyWorldView, capacity: (type: number) => number) {
    this.world = world;
    this.capacity = capacity;
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.graphics.visible = visible;
    if (visible) this.redraw();
  }

  /** Překreslí, když se síť přepočítala nebo změnilo vedení. */
  update(wiresChanged: boolean): void {
    if (!this.visible) return;
    if (!wiresChanged && this.world.powerRevision === this.drawnRevision) return;
    this.redraw();
  }

  private redraw(): void {
    const world = this.world;
    this.drawnRevision = world.powerRevision;
    this.graphics.clear();
    const size = this.world.size;
    const wire = this.world.layers.wire;
    const isWire = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < size && y < size && (wire[index(x, y, size)] ?? 0) !== WIRE.none;

    for (let tile = 0; tile < wire.length; tile++) {
      const type = wire[tile] ?? WIRE.none;
      if (type === WIRE.none) continue;
      const x = tile % size;
      const y = (tile - x) / size;
      const points = tileQuad(x, y, tileCorners(this.world.cornerHeight, x, y));
      const mask = roadMask(isWire, x, y);
      const width = WIDTH[type] ?? 0.14;

      let color: number;
      if ((world.wireOverloaded[tile] ?? 0) !== 0) {
        color = OVERLOAD_COLOR;
      } else {
        const ratio = Math.min(1, (world.wireLoad[tile] ?? 0) / Math.max(1, this.capacity(type)));
        color = LOAD_COLORS[Math.min(LOAD_COLORS.length - 1, Math.floor(ratio * LOAD_COLORS.length))] ?? LOAD_COLORS[0];
      }
      for (const polygon of roadPolygons(points, mask, width + 0.06)) {
        this.graphics.poly(polygon).fill({ color: OUTLINE_COLOR, alpha: 0.8 });
      }
      for (const polygon of roadPolygons(points, mask, width)) {
        this.graphics.poly(polygon).fill({ color });
      }
    }
  }
}
