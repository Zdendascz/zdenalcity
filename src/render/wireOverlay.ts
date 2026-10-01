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
 * Barva je **stav**, ne vytížení (T137): zelená má rezervu, tmavě červená
 * je úzké hrdlo, fialová je připojená, ale proud nestačí, šedá je bez
 * proudu. Vytížení úseku s rezervou je v propojené síti libovolné číslo —
 * proud jde mnoha cestami a přechod do červené ukazoval plné úseky tam,
 * kde nic neomezovaly („přes každou silnici jsou dráty červené").
 * Vysoké napětí je širší.
 */

const WIDTH = [0, 0.14, 0.24] as const;
const SPARE_COLOR = 0x3ecf5a;
const OVERLOAD_COLOR = 0x7a0d0d;
/**
 * Vedení, kam proud nedojde. Dřív bylo zelené jako „zátěž 0" — a hráč na
 * mapě viděl zelenou čáru, i když vedení k žádné elektrárně nevedlo (hlásil
 * autor: „jak je možné, že na té dlaždici není elektřina?").
 */
const DEAD_COLOR = 0x8a8f96;
/**
 * Vedení k síti připojené, ale proud za ním nestačí — úzké hrdlo je proti
 * proudu u tmavě červeného úseku (T137). Zelená s nulou tu lhala.
 */
const STARVED_COLOR = 0xb06ad9;
const OUTLINE_COLOR = 0x1b1f24;

export class WireOverlay {
  private readonly world: ReadonlyWorldView;
  private readonly graphics = new Graphics();
  private visible = false;
  private drawnRevision = -1;

  constructor(parent: Container, world: ReadonlyWorldView) {
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
      } else if ((world.wireLive[tile] ?? 0) === 0) {
        color = DEAD_COLOR;
      } else if ((world.powerStarved[tile] ?? 0) === 1) {
        color = STARVED_COLOR;
      } else {
        color = SPARE_COLOR;
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
