import { Container, Graphics, Matrix } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { tileCorners } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { roadMask } from '@/sim/roads';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import { BRIDGE_COLOR, KERB_COLOR, ROAD_COLOR, ROAD_COLORS, ROAD_WIDTHS, shade } from './palette';
import { roadPolygons } from './roads';
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

export class RoadRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly graphics = new Graphics();
  private textures: ReadonlyMap<string, Texture> = new Map();

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    parent.addChild(this.graphics);
  }

  /** Podzemní pohled se dívá pod silnice, takže tam jen překážejí. */
  setVisible(visible: boolean): void {
    this.graphics.visible = visible;
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
    if (dirty.fullRedraw || dirty.tiles.size > 0) this.rebuild();
  }

  private rebuild(): void {
    const { road, terrain } = this.world.layers;
    this.graphics.clear();

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

      // Obruba nejdřív a **širší**, vozovka na ni. Tím vznikne pás kolem
      // celého tvaru bez čar po vnitřních spárách.
      if (!bridge) {
        for (const polygon of roadPolygons(points, mask, Math.min(1, width + KERB))) {
          this.graphics.poly(polygon).fill({ color: shade(KERB_COLOR, light) });
        }
      }

      const texture = bridge ? undefined : this.textureFor(type);
      for (const polygon of roadPolygons(points, mask, width)) {
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
          // je a vynásobit ho šedou znamená bláto.
          color: shade(0xffffff, light),
          textureSpace: 'global',
        });
      }
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
