import { Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { tileCorners } from '@/sim/heights';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { MARKER_FILL, MARKER_LINE } from './palette';
import { gridToScreen } from './projection';

/**
 * Značky nad budovami služby, jejíž dosah se zrovna kreslí.
 *
 * Autor u mapy dosahu napsal: „takhle já vůbec netuším, kde tu hasičskou
 * stanici mám." A má pravdu — mapa pokrytí ukazuje kruh, ale ne jeho střed.
 * Bez značky se stanice hledá klikáním po městě, a to je přesně ta práce, které
 * má přehledový pohled ušetřit.
 *
 * Kreslí se **nad budovami**, ne na jejich střeše: střešní symbol zapadne mezi
 * domy stejné výšky a při oddálení zmizí úplně. Špendlík nad městem je vidět
 * z každého přiblížení.
 */

/** Co renderer potřebuje vědět o jedné budově. */
export interface ServiceSite {
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Výška budovy v pixelech — značka se posadí nad ni. */
  height: number;
}

/** Kolik pixelů je značka nad střechou. Menší mezera lepí na komín. */
const LIFT = 18;
/** Poloměr kolečka značky. */
const RADIUS = 13;
/** Jak vysoký je hrot špendlíku pod kolečkem. */
const TIP = 10;

export class ServiceMarkers {
  private readonly world: ReadonlyWorldView;
  private readonly container = new Container();
  private readonly pins = new Graphics();
  private textures: ReadonlyMap<string, Texture> = new Map();
  private sites: (definitionId: string) => ServiceSite | undefined = () => undefined;
  private classOf: (definitionId: string) => string | undefined = () => undefined;
  private active: string | null = null;

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    this.container.addChild(this.pins);
    this.container.visible = false;
    parent.addChild(this.container);
  }

  /** Ikony podle třídy služby. Chybějící ikona nechá jen špendlík. */
  setTextures(textures: ReadonlyMap<string, Texture>): void {
    this.textures = textures;
    this.redraw();
  }

  /** Odkud se berou rozměry budovy a její třída služby. */
  setLookup(
    sites: (definitionId: string) => ServiceSite | undefined,
    classOf: (definitionId: string) => string | undefined,
  ): void {
    this.sites = sites;
    this.classOf = classOf;
    this.redraw();
  }

  /** `null` značky zhasne. */
  setActive(serviceClass: string | null): void {
    if (this.active === serviceClass) return;
    this.active = serviceClass;
    this.container.visible = serviceClass !== null;
    this.redraw();
  }

  /** Budovy vznikají a mizí; značky se překreslí, když se něco změnilo. */
  update(changed: boolean): void {
    if (this.active !== null && changed) this.redraw();
  }

  private redraw(): void {
    this.pins.clear();
    // Ikony jsou samostatné uzly, ne kresba — musí se odstranit ručně.
    for (const child of [...this.container.children]) {
      if (child !== this.pins) child.destroy();
    }
    if (this.active === null) return;

    for (const building of this.world.buildings.values()) {
      if (building.abandoned) continue;
      if (this.classOf(building.definitionId) !== this.active) continue;
      const site = this.sites(building.definitionId);
      if (!site) continue;

      // Střed půdorysu, ne jeho roh: velká stanice by měla značku u kraje.
      const corners = tileCorners(this.world.cornerHeight, building.x, building.y);
      const base = Math.max(...corners);
      const point = gridToScreen(
        building.x + site.width / 2,
        building.y + site.depth / 2,
        base,
      );
      const cx = point.x;
      const cy = point.y - site.height - LIFT - RADIUS;

      this.pins
        .moveTo(cx, cy + RADIUS + TIP)
        .lineTo(cx - RADIUS * 0.55, cy + RADIUS * 0.6)
        .lineTo(cx + RADIUS * 0.55, cy + RADIUS * 0.6)
        .fill({ color: MARKER_FILL });
      this.pins
        .circle(cx, cy, RADIUS)
        .fill({ color: MARKER_FILL })
        .stroke({ color: MARKER_LINE, width: 2 });

      const texture = this.textures.get(this.active);
      if (texture === undefined) continue;
      const icon = new Sprite(texture);
      icon.anchor.set(0.5);
      icon.width = RADIUS * 1.5;
      icon.height = RADIUS * 1.5;
      icon.position.set(cx, cy);
      this.container.addChild(icon);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
