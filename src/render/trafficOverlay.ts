import { Container, Graphics } from 'pixi.js';
import { index, ROAD } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { TRAFFIC_COLORS, TRAFFIC_MAX_ALPHA } from './palette';
import { tileCorners } from '@/sim/heights';
import { tileQuad } from './projection';

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
  /**
   * Zátěž, podle které se naposledy kreslilo (T133). Overlay dřív mazal
   * a znovu kreslil ~2 900 mnohoúhelníků **každý snímek**, i na pauze;
   * zátěž se přitom mění jen při běhu dopravy, jednou za několik tiků.
   * Kopie pole se porovná jednou za tik — to je zlomek jednoho překreslení.
   */
  private drawnLoad = new Float32Array(0);
  private drawnTick = -1;
  private stale = true;

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

  /**
   * Překreslí, když se změnila zátěž nebo silnice. `roadsChanged` hlásí
   * volající — přibylá silnice či svah zátěž nezmění, ale tvar ano.
   */
  update(roadsChanged = false): void {
    if (roadsChanged) this.stale = true;
    if (!this.visible) return;
    if (!this.stale && this.world.tick === this.drawnTick) return;
    this.drawnTick = this.world.tick;
    const load = this.world.trafficLoad;
    if (!this.stale && load.length === this.drawnLoad.length) {
      let same = true;
      for (let i = 0; i < load.length; i++) {
        if (load[i] !== this.drawnLoad[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.redraw();
  }

  private redraw(): void {
    this.graphics.clear();
    this.stale = false;
    this.drawnTick = this.world.tick;
    this.drawnLoad = Float32Array.from(this.world.trafficLoad);

    const size = this.world.size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = index(x, y, size);
        const roadType = this.world.layers.road[tile] ?? ROAD.none;
        if (roadType === ROAD.none) continue;

        const capacity = this.capacityOf(roadType);
        if (capacity <= 0) continue;

        const load = this.world.trafficLoad[tile] ?? 0;
        const ratio = Math.min(1, load / capacity);
        if (ratio === 0) continue;

        const color = TRAFFIC_COLORS[Math.min(TRAFFIC_COLORS.length - 1, Math.floor(ratio * TRAFFIC_COLORS.length))];
        this.graphics.poly(tileQuad(x, y, tileCorners(this.world.cornerHeight, x, y))).fill({
          color: color ?? TRAFFIC_COLORS[0] ?? 0,
          alpha: TRAFFIC_MAX_ALPHA,
        });
      }
    }
  }
}
