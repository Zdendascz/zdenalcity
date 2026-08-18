import { Container, Graphics } from 'pixi.js';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import { iconShape } from './icons';
import {
  ABANDONED_COLOR,
  ICON_ALPHA,
  ICON_COLOR,
  luminance,
  shade,
  WALL_LEFT_SHADE,
  WALL_RIGHT_SHADE,
} from './palette';
import { cuboidFaces, gridToScreen, LEVEL_H } from './projection';

/**
 * Co renderer potřebuje vědět o definici budovy. Úzké rozhraní, aby `render/`
 * nezávisel na tvaru content registru — barvu z hexu na číslo převádí volající.
 */
export interface BuildingAppearance {
  color: number;
  heightLevels: number;
  footprint: readonly [number, number];
  /** Jméno symbolu na střeše, pokud ho definice má. */
  icon?: string;
}

export type AppearanceLookup = (definitionId: string) => BuildingAppearance | undefined;

/**
 * O kolik dlaždice se kvádr zmenší proti svému půdorysu, na každé straně.
 *
 * Bez odsazení se sousedící domy 1×1 slily v jeden dlouhý hřeben a nešlo poznat,
 * kde končí jedna budova a začíná druhá. Nula vrátí původní chování.
 */
const BUILDING_INSET = 0.12;

/**
 * Budovy se **nezapékají do chunků**: přesahují dlaždici do výšky i do stran
 * a musely by se ořezávat na hranici chunku. Každá je vlastní `Graphics`
 * a řadí se back-to-front podle `x + y`.
 */
export class BuildingRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly container: Container;
  private readonly appearance: AppearanceLookup;
  private readonly views = new Map<number, Graphics>();

  constructor(world: ReadonlyWorldView, parent: Container, appearance: AppearanceLookup) {
    this.world = world;
    this.appearance = appearance;
    this.container = new Container();
    this.container.sortableChildren = true;
    parent.addChild(this.container);
  }

  update(dirty: DirtySet): void {
    if (dirty.fullRedraw) {
      for (const id of [...this.views.keys()]) {
        this.remove(id);
      }
      for (const id of this.world.buildings.keys()) {
        this.refresh(id);
      }
      return;
    }

    for (const id of dirty.buildings) {
      this.refresh(id);
    }
  }

  private refresh(id: number): void {
    const building = this.world.buildings.get(id);
    if (!building) {
      this.remove(id);
      return;
    }

    const found = this.appearance(building.definitionId);
    if (!found) return; // chybějící definice řeší content registry, ne renderer

    // Ruina si drží půdorys, ale ne vzhled: šedý kvádr o jedné úrovni, bez
    // symbolu. Vzhled je vlastnost entity, ne definice — proto až tady.
    const appearance: BuildingAppearance = building.abandoned
      ? { color: ABANDONED_COLOR, heightLevels: 1, footprint: found.footprint }
      : found;

    let view = this.views.get(id);
    if (!view) {
      view = new Graphics();
      this.container.addChild(view);
      this.views.set(id, view);
    }

    const [width, depth] = appearance.footprint;
    // Výšku určuje **definice**, ne úroveň entity. Násobit obojím by od T16
    // znamenalo patnáctipatrový věžák, protože vyšší úroveň už má vyšší
    // `heightLevels` sama.
    const height = appearance.heightLevels * LEVEL_H;
    const faces = cuboidFaces(
      building.x + BUILDING_INSET,
      building.y + BUILDING_INSET,
      width - BUILDING_INSET * 2,
      depth - BUILDING_INSET * 2,
      height,
    );

    view.clear();
    view
      .poly(faces.right)
      .fill({ color: shade(appearance.color, WALL_RIGHT_SHADE) })
      .poly(faces.left)
      .fill({ color: shade(appearance.color, WALL_LEFT_SHADE) })
      .poly(faces.top)
      .fill({ color: appearance.color });

    this.drawIcon(view, appearance, building.x + BUILDING_INSET, building.y + BUILDING_INSET, {
      width: width - BUILDING_INSET * 2,
      depth: depth - BUILDING_INSET * 2,
      height,
    });

    // Hloubka se řídí **předním rohem** půdorysu, ne počátkem. Kdyby se řadilo
    // podle `x + y`, dvoudlaždicová továrna by se schovala za jednodlaždicový
    // obchod, který stojí za ní — právě tak vypadala nahlášená chyba.
    view.zIndex = building.x + width + (building.y + depth);
  }

  /**
   * Symbol na horní plochu. Kreslí se v jednotkovém čtverci a promítne se přes
   * `gridToScreen`, takže sedí na půdorysu jakékoli velikosti a sám se naklopí
   * do izometrie.
   */
  private drawIcon(
    view: Graphics,
    appearance: BuildingAppearance,
    originX: number,
    originY: number,
    size: { width: number; depth: number; height: number },
  ): void {
    const shape = iconShape(appearance.icon);
    if (!shape) return;

    // Světlá budova potřebuje tmavý symbol a naopak, jinak splyne.
    const color = luminance(appearance.color) > 0.55 ? shade(appearance.color, 0.45) : ICON_COLOR;

    for (const polygon of shape) {
      const points: number[] = [];
      for (const [u, v] of polygon) {
        // Symbol zabírá prostřední polovinu střechy, ať nelepí na hrany.
        const point = gridToScreen(
          originX + (0.25 + u * 0.5) * size.width,
          originY + (0.25 + v * 0.5) * size.depth,
        );
        points.push(point.x, point.y - size.height);
      }
      view.poly(points).fill({ color, alpha: ICON_ALPHA });
    }
  }

  private remove(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    view.destroy();
    this.views.delete(id);
  }

  destroy(): void {
    for (const id of [...this.views.keys()]) {
      this.remove(id);
    }
    this.container.destroy();
  }
}
