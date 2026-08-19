import { Container, Graphics } from 'pixi.js';
import { index, MAP_SIZE, ROAD } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { TRAFFIC_COLORS, TRAFFIC_MAX_ALPHA } from './palette';
import { footprintQuad } from './projection';

/**
 * Overlay dopravy (§5 zadání fáze 3).
 *
 * Na rozdíl od znečištění nebo ceny půdy se kreslí **v plném rozlišení**, ne na
 * hrubé mřížce: zátěž se liší dlaždici od dlaždice a smysl overlaye je ukázat
 * konkrétní ucpaný úsek, ne barevnou skvrnu nad čtvrtí.
 *
 * Kreslí se jen silnice, kterých je pár tisíc, ne celá mapa.
 *
 * Barva jde od zelené po červenou, protože **vytížení má práh**: hráče zajímá,
 * kde se blíží kapacitě, ne jaké je absolutní číslo. Sílu proto nenese
 * průhlednost jako u ostatních overlayů.
 */
export class TrafficOverlay {
  private readonly graphics = new Graphics();
  private readonly world: ReadonlyWorldView;
  private readonly capacityOf: (roadType: number) => number;
  private visible = false;

  constructor(
    parent: Container,
    world: ReadonlyWorldView,
    capacityOf: (roadType: number) => number,
  ) {
    this.world = world;
    this.capacityOf = capacityOf;
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.graphics.visible = visible;
    if (visible) this.redraw();
  }

  /** Zátěž se mění každých osm tiků, takže se překresluje na vyžádání. */
  update(): void {
    if (this.visible) this.redraw();
  }

  private redraw(): void {
    this.graphics.clear();

    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const tile = index(x, y);
        const roadType = this.world.layers.road[tile] ?? ROAD.none;
        if (roadType === ROAD.none) continue;

        const capacity = this.capacityOf(roadType);
        if (capacity <= 0) continue;

        const load = this.world.trafficLoad[tile] ?? 0;
        const ratio = Math.min(1, load / capacity);
        if (ratio === 0) continue;

        const color = TRAFFIC_COLORS[Math.min(TRAFFIC_COLORS.length - 1, Math.floor(ratio * TRAFFIC_COLORS.length))];
        this.graphics.poly(footprintQuad(x, y, 1, 1)).fill({
          color: color ?? TRAFFIC_COLORS[0] ?? 0,
          alpha: TRAFFIC_MAX_ALPHA,
        });
      }
    }
  }
}
