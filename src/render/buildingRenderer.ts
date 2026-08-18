import { Container, Graphics } from 'pixi.js';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import { shade, WALL_LEFT_SHADE, WALL_RIGHT_SHADE } from './palette';
import { cuboidFaces, LEVEL_H } from './projection';

/**
 * Co renderer potřebuje vědět o definici budovy. Úzké rozhraní, aby `render/`
 * nezávisel na tvaru content registru — barvu z hexu na číslo převádí volající.
 */
export interface BuildingAppearance {
  color: number;
  heightLevels: number;
  footprint: readonly [number, number];
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

    const appearance = this.appearance(building.definitionId);
    if (!appearance) return; // chybějící definice řeší content registry, ne renderer

    let view = this.views.get(id);
    if (!view) {
      view = new Graphics();
      this.container.addChild(view);
      this.views.set(id, view);
    }

    const [width, depth] = appearance.footprint;
    const height = building.level * appearance.heightLevels * LEVEL_H;
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

    // Hloubka se řídí **předním rohem** půdorysu, ne počátkem. Kdyby se řadilo
    // podle `x + y`, dvoudlaždicová továrna by se schovala za jednodlaždicový
    // obchod, který stojí za ní — právě tak vypadala nahlášená chyba.
    view.zIndex = building.x + width + (building.y + depth);
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
