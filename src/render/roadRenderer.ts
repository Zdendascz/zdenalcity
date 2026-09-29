import { Container, Graphics, Matrix } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { tileCorners } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { roadMask } from '@/sim/roads';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import {
  BRIDGE_COLOR,
  BRIDGE_GIRDER_COLOR,
  BRIDGE_RAIL_COLOR,
  BRIDGE_SHADOW_ALPHA,
  BRIDGE_SHADOW_COLOR,
  KERB_COLOR,
  MARKING_ALPHA,
  MARKING_COLOR,
  ROAD_COLOR,
  ROAD_COLORS,
  ROAD_WIDTHS,
  shade,
  SIDEWALK_COLOR,
  VERGE_COLOR,
} from './palette';
import { inside, roadPolygons, ROAD_E, ROAD_N, ROAD_S, ROAD_W } from './roads';
import type { TileQuad } from './roads';
import { bridgeParts, hasRoundabout, roadMarkings, roundabout, sidewalks } from './roadDetails';
import type { UV } from './roadDetails';
import { houseSides } from './streets';
import { slopeLight, surfaceCorners, tileQuad } from './projection';

/**
 * Vozovka: **tvar se počítá, obrázek dodá jen povrch.**
 *
 * Čtvrtý pokus a první, který nestojí na tom, že generátor trefí geometrii.
 * Předchozí tři:
 *
 * 1. **Ploché polygony.** Spoje seděly, ale byla z toho šedá stuha bez
 *    obrubníku.
 * 2. **Šestnáct hotových dlaždic na typ, vyplněných do chunku.** Chunk je
 *    jedna kreslicí dávka a do té se vejde jen pár textur — na silnici byla
 *    tráva.
 * 3. **Sedm dlaždic na typ jako sprity.** Dávka už nevadila, ale obrázky se
 *    rozešly. Změřeno na hotové sadě: šířka vozovky na hraně kolísala u ulice
 *    od 0,07 do 0,41 a u křižovatky **na středu hrany vozovka nebyla vůbec** —
 *    ramena mířila do rohů dlaždice místo přes hrany.
 *
 * Geometrie proto zůstává v kódu (`roadPolygons`), kde je šířka **číslo**,
 * a obrázek nese jen materiál. Tím sedí:
 *
 * - **každý spoj**, protože obě dlaždice počítají ze stejných rohů;
 * - **každá kombinace typů**, protože každá dlaždice kreslí svou šířku
 *   a přechod se stane přesně na hranici mezi nimi;
 * - **každý svah**, protože se kreslí do skutečných rohů dlaždice.
 *
 * Kreslí se do **vlastního `Graphics`**, ne do terénního chunku. Tři asfalty
 * v jedné dávce jsou hluboko pod stropem karty; právě jeho překročení zabilo
 * druhý pokus.
 */

/** Jména materiálů podle typu. Index je hodnota vrstvy `road`. */
export const ROAD_FAMILIES: readonly (string | undefined)[] = [
  undefined,
  'street',
  'avenue',
  'highway',
];

/**
 * O kolik je obruba širší než vozovka, v podílu dlaždice.
 *
 * Kreslí se jako **širší kopie téhož tvaru pod vozovkou**, ne jako obtah.
 * Obtah kolem každého polygonu by nakreslil čáru i po vnitřních spárách mezi
 * jádrem a rameny, tedy mřížku přes celou silnici.
 */
const KERB = 0.08;

/** Jak často se smí síť přestavět kvůli změně budov (chodníky), v ms. */
const HOUSE_REBUILD_MS = 500;

export class RoadRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly graphics = new Graphics();
  private textures: ReadonlyMap<string, Texture> = new Map();
  private sidewalkTexture: Texture | undefined;
  /** Čeká přestavba kvůli budovám? A kdy naposledy proběhla. */
  private housesChanged = false;
  private lastRebuild = 0;

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    parent.addChild(this.graphics);
  }

  /** Podzemní pohled se dívá pod silnice, takže tam jen překážejí. */
  setVisible(visible: boolean): void {
    this.graphics.visible = visible;
  }

  /** Dlažba chodníku (T122). Bez ní se chodník kreslí barvou. */
  setSidewalkTexture(texture: Texture | undefined): void {
    this.sidewalkTexture = texture;
    this.rebuild();
  }

  /** Nastaví materiály vozovky a překreslí. */
  setTextures(textures: ReadonlyMap<string, Texture>): void {
    this.textures = textures;
    this.rebuild();
  }

  /**
   * Překreslí, když se něco změnilo.
   *
   * Přestavuje se **celá síť, ne jen dotčená dlaždice**: postavením jedné
   * silnice se změní tvar až čtyř sousedů a jejich indexy v `dirty` nejsou.
   * Je to jeden `Graphics` a přestavba běží jen při stavbě nebo bourání.
   */
  update(dirty: DirtySet): void {
    if (dirty.fullRedraw || dirty.tiles.size > 0) {
      this.rebuild();
      return;
    }
    // Dům u silnice povyrostl → přibude chodník. Budovy se mění často (růst
    // zón), takže se to sbírá a přestavuje nejvýš dvakrát za sekundu.
    if (dirty.buildings.size > 0) this.housesChanged = true;
    if (this.housesChanged && performance.now() - this.lastRebuild > HOUSE_REBUILD_MS) {
      this.rebuild();
    }
  }

  private rebuild(): void {
    const { road, terrain } = this.world.layers;
    this.graphics.clear();
    this.housesChanged = false;
    this.lastRebuild = performance.now();

    for (let tile = 0; tile < road.length; tile++) {
      const type = road[tile] ?? ROAD.none;
      if (type === ROAD.none) continue;

      const x = tile % this.world.size;
      const y = (tile - x) / this.world.size;
      const corners = tileCorners(this.world.cornerHeight, x, y);
      const points = tileQuad(x, y, corners);
      const mask = roadMask((nx, ny) => this.isRoad(nx, ny), x, y);
      const width = ROAD_WIDTHS[type] ?? 0.5;

      // Most je konstrukce nad vodou, ne asfalt na zemi: kreslí se barvou, ať
      // je poznat, kde silnice opouští břeh (§7 fáze 3).
      const bridge = (terrain[tile] ?? 0) === TERRAIN.water;
      const light = slopeLight(corners);
      const circle = type === ROAD.avenue && mask === 15 && !bridge && hasRoundabout(x, y);

      // Most: stín na vodě a bočnice pod deskou jdou **pod** vozovku.
      const parts = bridge ? bridgeParts(mask, width) : [];
      for (const part of parts) {
        if (part.kind === 'shadow') {
          this.graphics
            .poly(project(points, part.points))
            .fill({ color: BRIDGE_SHADOW_COLOR, alpha: BRIDGE_SHADOW_ALPHA });
        } else if (part.kind === 'girder') {
          this.drawGirder(points, part.points, part.lift ?? -5, light);
        }
      }

      // Chodník a zelený pás u domů (T122). Leží mimo vozovku, takže pořadí
      // vůči ní nehraje roli.
      if (!bridge) {
        const sides = houseSides(this.world, x, y);
        for (const part of sidewalks(mask, sides, width, KERB)) {
          const polygon = project(points, part.points);
          if (part.kind === 'verge') {
            this.graphics.poly(polygon).fill({ color: shade(VERGE_COLOR, light) });
            continue;
          }
          this.graphics.poly(polygon).fill({ color: shade(SIDEWALK_COLOR, light) });
          if (this.sidewalkTexture) {
            this.graphics.poly(polygon).fill({
              texture: this.sidewalkTexture,
              matrix: tileMatrix(x, y, corners, this.sidewalkTexture.width || 1),
              color: shade(0xffffff, light),
              textureSpace: 'global',
            });
          }
        }
      }

      // Obruba nejdřív a **širší**, vozovka na ni. Tím vznikne pás kolem
      // celého tvaru bez čar po vnitřních spárách. Most má obrubu taky —
      // je to okraj betonové desky.
      {
        for (const polygon of roadPolygons(points, mask, Math.min(1, width + KERB))) {
          this.graphics.poly(polygon).fill({ color: shade(KERB_COLOR, light) });
        }
      }

      const texture = this.textureFor(type);
      const surfaces = roadPolygons(points, mask, width);
      if (circle) {
        const [ring, kerb] = roundabout();
        // Obrubník kolem kruhu: kopie o kus větší, pod asfaltem — stejný
        // trik jako u ramen.
        if (kerb) this.graphics.poly(project(points, kerb.points)).fill({ color: shade(KERB_COLOR, light) });
        if (ring) surfaces.push(project(points, ring.points));
      }
      for (const polygon of surfaces) {
        // Barva se kreslí **vždycky, i pod obrázek**. Když materiál chybí
        // nebo se nedokreslí, zůstane vozovka, ne díra.
        this.graphics
          .poly(polygon)
          .fill({ color: bridge ? BRIDGE_COLOR : (ROAD_COLORS[type] ?? ROAD_COLOR) });
        if (texture === undefined) continue;
        this.graphics.poly(polygon).fill({
          texture,
          matrix: tileMatrix(x, y, corners, texture.width || 1),
          // Tón je bílá ztlumená sklonem, ne barva vozovky: obrázek už šedý
          // je a vynásobit ho šedou znamená bláto. Most je o kus světlejší
          // — beton, ne asfalt na zemi.
          color: shade(0xffffff, bridge ? Math.min(1.15, light * 1.12) : light),
          textureSpace: 'global',
        });
      }

      if (circle) {
        for (const part of roundabout().slice(2)) {
          const color = part.kind === 'island' ? VERGE_COLOR : KERB_COLOR;
          this.graphics.poly(project(points, part.points)).fill({ color: shade(color, light) });
        }
      } else {
        // Vodorovné značení. Ulice má jen středovou, třída i krajnice,
        // dálnice čtyři pruhy. Na křižovatce ulic a tříd přechod.
        const arms = [ROAD_N, ROAD_E, ROAD_S, ROAD_W].filter((arm) => mask & arm).length;
        const lines = roadMarkings(mask, {
          width,
          lanes: type === ROAD.highway ? 4 : 2,
          edges: type !== ROAD.street,
          ...(arms >= 3 && type !== ROAD.highway ? { zebraArms: mask } : {}),
        });
        for (const line of lines) {
          this.graphics
            .poly(project(points, line))
            .fill({ color: MARKING_COLOR, alpha: MARKING_ALPHA * light });
        }
      }

      // Zábradlí mostu až úplně nahoře.
      for (const part of parts) {
        if (part.kind === 'railing') this.drawRailing(points, part.points, part.lift ?? 4);
      }
    }
  }

  /**
   * Bočnice mostu: svislý pás pod hranou desky, na stranách k divákovi.
   * Uprostřed hrany k tomu kus pilíře, ať deska na vodě nevisí ve vzduchu.
   */
  private drawGirder(quad: TileQuad, edge: readonly UV[], drop: number, light: number): void {
    const [a, b] = edge;
    if (!a || !b) return;
    const p = inside(quad, a[0], a[1]);
    const q = inside(quad, b[0], b[1]);
    const down = -drop;
    this.graphics
      .poly([p[0], p[1], q[0], q[1], q[0], q[1] + down, p[0], p[1] + down])
      .fill({ color: shade(BRIDGE_GIRDER_COLOR, light) });
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    this.graphics
      .rect(mx - 1.5, my + down, 3, 6)
      .fill({ color: shade(BRIDGE_GIRDER_COLOR, light * 0.8) });
  }

  /** Zábradlí: madlo zvednuté nad desku a sloupky každou pětinu délky. */
  private drawRailing(quad: TileQuad, edge: readonly UV[], lift: number): void {
    const [a, b] = edge;
    if (!a || !b) return;
    const p = inside(quad, a[0], a[1]);
    const q = inside(quad, b[0], b[1]);
    this.graphics
      .moveTo(p[0], p[1] - lift)
      .lineTo(q[0], q[1] - lift)
      .stroke({ width: 0.8, color: BRIDGE_RAIL_COLOR });
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const x = p[0] + (q[0] - p[0]) * t;
      const y = p[1] + (q[1] - p[1]) * t;
      this.graphics.moveTo(x, y).lineTo(x, y - lift).stroke({ width: 0.6, color: BRIDGE_RAIL_COLOR });
    }
  }

  private textureFor(type: number): Texture | undefined {
    const family = ROAD_FAMILIES[type];
    return family === undefined ? undefined : this.textures.get(family);
  }

  private isRoad(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return false;
    return (
      (this.world.layers.road[index(x, y, this.world.size)] ?? ROAD.none) !== ROAD.none
    );
  }
}

/** Mnohoúhelník z `(u, v)` dlaždice na obrazovku přes její skutečné rohy. */
function project(quad: TileQuad, points: readonly UV[]): number[] {
  return points.flatMap(([u, v]) => inside(quad, u, v));
}

/**
 * Matice, která položí čtvercový obrázek na dlaždici.
 *
 * Táž věc jako u povrchu terénu, i se stejnou pastí: matice vede **z textury
 * do plochy** a Pixi si ji obrací sama. A musí se předat `textureSpace:
 * 'global'`, jinak ji Pixi ještě znormalizuje podle obálky tvaru a obrázek se
 * začne opakovat — na terénu z toho byla mřížka „6 × 6 textur na dlaždici".
 */
function tileMatrix(
  x: number,
  y: number,
  corners: readonly [number, number, number, number],
  size: number,
): Matrix {
  const quad = surfaceCorners(x, y, corners);
  const origin = quad[0]!;
  const alongU = quad[1]!;
  const alongV = quad[3]!;
  return new Matrix(
    (alongU[0] - origin[0]) / size,
    (alongU[1] - origin[1]) / size,
    (alongV[0] - origin[0]) / size,
    (alongV[1] - origin[1]) / size,
    origin[0],
    origin[1],
  );
}
