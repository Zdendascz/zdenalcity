import { Container, Graphics, Matrix } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { tileCorners } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { roadMask } from '@/sim/roads';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { FrameChanges } from './changes';
import { CHUNK_MARGIN, CHUNK_SIZE, chunkBounds, expand, overlaps } from './chunkRenderer';
import type { Viewport } from './chunkRenderer';
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

/** Silniční chunk: stejné dělení jako terén, ať se změna dotkne jednoho kusu. */
interface RoadChunk {
  readonly x0: number;
  readonly y0: number;
  readonly graphics: Graphics;
  readonly bounds: Viewport;
  /** Čeká na přepečení? Peče se, až na něj bude vidět. */
  stale: boolean;
}

export class RoadRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly container = new Container();
  private readonly chunks: RoadChunk[] = [];
  private readonly chunksPerAxis: number;
  private textures: ReadonlyMap<string, Texture> = new Map();
  private sidewalkTexture: Texture | undefined;
  /** Kolik chunků se od začátku upeklo. Pro měření. */
  private bakes = 0;

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    /*
     * Síť se kreslí **po chuncích 16 × 16** (T133), ne do jednoho `Graphics`.
     *
     * Jeden `Graphics` znamenal, že každá změna — nová silnice, dům, který
     * povyrostl a dostal chodník, i požár, který jen označil dlaždici — smazala
     * a znovu nakreslila celou síť: 81 387 instrukcí, 190 ms kreslení a 266 ms
     * teselace na městě s 1 500 budovami. Teď se přepeče chunk se změnou
     * a nanejvýš soused, přes jehož hranu vede změněné rameno.
     *
     * Řadí se podle `cx + cy` jako terén: most a zábradlí přečuhují do
     * sousední dlaždice a musí ležet přes chunk za sebou, ne pod ním.
     */
    this.container.sortableChildren = true;
    // Vlastní skupina vykreslování, stejně jako terén.
    this.container.isRenderGroup = true;
    parent.addChild(this.container);
    this.chunksPerAxis = Math.ceil(world.size / CHUNK_SIZE);
    for (let cy = 0; cy < this.chunksPerAxis; cy++) {
      for (let cx = 0; cx < this.chunksPerAxis; cx++) {
        const graphics = new Graphics();
        graphics.zIndex = cx + cy;
        this.container.addChild(graphics);
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        this.chunks.push({ x0, y0, graphics, bounds: chunkBounds(x0, y0), stale: true });
      }
    }
  }

  /** Podzemní pohled se dívá pod silnice, takže tam jen překážejí. */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /** Dlažba chodníku (T122). Bez ní se chodník kreslí barvou. */
  setSidewalkTexture(texture: Texture | undefined): void {
    this.sidewalkTexture = texture;
    this.invalidateAll();
  }

  /** Nastaví materiály vozovky a překreslí. */
  setTextures(textures: ReadonlyMap<string, Texture>): void {
    this.textures = textures;
    this.invalidateAll();
  }

  /** Kolik chunků se od začátku upeklo. Pro měření a testy. */
  getBakeCount(): number {
    return this.bakes;
  }

  private invalidateAll(): void {
    for (const chunk of this.chunks) chunk.stale = true;
  }

  /**
   * Zaznamená, co se změnilo. **Nekreslí** — to dělá `cull()`, a jen to,
   * na co je vidět.
   *
   * Tvar dlaždice závisí na sousedech (ramena, šířka ramene k širšímu
   * sousedovi), takže se se změněnou dlaždicí značí i její čtyři sousedé —
   * a s nimi případně sousední chunk.
   */
  update(changes: FrameChanges): void {
    if (changes.full) {
      this.invalidateAll();
      return;
    }
    const size = this.world.size;
    const road = this.world.layers.road;
    for (const tile of changes.road) {
      const x = tile % size;
      const y = (tile - x) / size;
      this.markTile(x, y);
      this.markTile(x, y - 1);
      this.markTile(x + 1, y);
      this.markTile(x, y + 1);
      this.markTile(x - 1, y);
    }
    // Svah a most (vozovka nad vodou) i chodník podle domů — jen tam, kde
    // silnice je.
    for (const list of [changes.surface, changes.streets]) {
      for (const tile of list) {
        if ((road[tile] ?? 0) === 0) continue;
        const x = tile % size;
        this.markTile(x, (tile - x) / size);
      }
    }
  }

  private markTile(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return;
    const chunk = this.chunks[Math.floor(y / CHUNK_SIZE) * this.chunksPerAxis + Math.floor(x / CHUNK_SIZE)];
    if (chunk) chunk.stale = true;
  }

  /**
   * Upeče zastaralé chunky, na které je vidět nebo které jsou hned za okrajem.
   *
   * Upečený chunk se neuvolňuje: na rozdíl od terénu je většina mapy bez
   * silnic a prázdný `Graphics` nic nestojí. Zastaralý chunk mimo výřez
   * počká, až na něj hráč najede — načtené město se tak nepeče celé naráz.
   */
  cull(view: Viewport): void {
    const ring = expand(view, CHUNK_MARGIN);
    for (const chunk of this.chunks) {
      if (chunk.stale && overlaps(chunk.bounds, ring)) this.bake(chunk);
    }
  }

  private bake(chunk: RoadChunk): void {
    const g = chunk.graphics;
    g.clear();
    chunk.stale = false;
    this.bakes++;
    const size = this.world.size;
    const road = this.world.layers.road;
    const xEnd = Math.min(size, chunk.x0 + CHUNK_SIZE);
    const yEnd = Math.min(size, chunk.y0 + CHUNK_SIZE);
    for (let y = chunk.y0; y < yEnd; y++) {
      for (let x = chunk.x0; x < xEnd; x++) {
        if ((road[y * size + x] ?? ROAD.none) !== ROAD.none) this.drawRoadTile(g, x, y);
      }
    }
  }

  private drawRoadTile(g: Graphics, x: number, y: number): void {
    const { road, terrain } = this.world.layers;
    const tile = y * this.world.size + x;
    const type = road[tile] ?? ROAD.none;
    const corners = tileCorners(this.world.cornerHeight, x, y);
    const points = tileQuad(x, y, corners);
    const mask = roadMask((nx, ny) => this.isRoad(nx, ny), x, y);
    const width = ROAD_WIDTHS[type] ?? 0.5;
    // Šířka ramen na hraně: k širšímu sousedovi se rameno rozšíří (T124).
    const edges = [
      Math.max(width, ROAD_WIDTHS[this.roadType(x, y - 1)] ?? 0),
      Math.max(width, ROAD_WIDTHS[this.roadType(x + 1, y)] ?? 0),
      Math.max(width, ROAD_WIDTHS[this.roadType(x, y + 1)] ?? 0),
      Math.max(width, ROAD_WIDTHS[this.roadType(x - 1, y)] ?? 0),
    ];

    // Most je konstrukce nad vodou, ne asfalt na zemi: kreslí se barvou, ať
    // je poznat, kde silnice opouští břeh (§7 fáze 3).
    const bridge = (terrain[tile] ?? 0) === TERRAIN.water;
    const light = slopeLight(corners);
    const circle = type === ROAD.avenue && mask === 15 && !bridge && hasRoundabout(x, y);

    // Most: stín na vodě a bočnice pod deskou jdou **pod** vozovku.
    const parts = bridge ? bridgeParts(mask, width) : [];
    for (const part of parts) {
      if (part.kind === 'shadow') {
        g.poly(project(points, part.points)).fill({ color: BRIDGE_SHADOW_COLOR, alpha: BRIDGE_SHADOW_ALPHA });
      } else if (part.kind === 'girder') {
        this.drawGirder(g, points, part.points, part.lift ?? -5, light);
      }
    }

    // Chodník a zelený pás u domů (T122). Leží mimo vozovku, takže pořadí
    // vůči ní nehraje roli.
    if (!bridge) {
      const sides = houseSides(this.world, x, y);
      for (const part of sidewalks(mask, sides, width, KERB)) {
        const polygon = project(points, part.points);
        if (part.kind === 'verge') {
          g.poly(polygon).fill({ color: shade(VERGE_COLOR, light) });
          continue;
        }
        g.poly(polygon).fill({ color: shade(SIDEWALK_COLOR, light) });
        if (this.sidewalkTexture) {
          g.poly(polygon).fill({
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
    for (const polygon of roadPolygons(points, mask, Math.min(1, width + KERB), edges.map((edge) => Math.min(1, edge + KERB)))) {
      g.poly(polygon).fill({ color: shade(KERB_COLOR, light) });
    }

    const texture = this.textureFor(type);
    const surfaces = roadPolygons(points, mask, width, edges);
    if (circle) {
      const [ring, kerb] = roundabout();
      // Obrubník kolem kruhu: kopie o kus větší, pod asfaltem — stejný
      // trik jako u ramen.
      if (kerb) g.poly(project(points, kerb.points)).fill({ color: shade(KERB_COLOR, light) });
      if (ring) surfaces.push(project(points, ring.points));
    }
    // Matice stejná pro všechny kusy dlaždice — počítá se jednou.
    const matrix = texture === undefined ? undefined : tileMatrix(x, y, corners, texture.width || 1);
    for (const polygon of surfaces) {
      // Barva se kreslí **vždycky, i pod obrázek**. Když materiál chybí
      // nebo se nedokreslí, zůstane vozovka, ne díra.
      g.poly(polygon).fill({ color: bridge ? BRIDGE_COLOR : (ROAD_COLORS[type] ?? ROAD_COLOR) });
      if (texture === undefined) continue;
      g.poly(polygon).fill({
        texture,
        matrix,
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
        g.poly(project(points, part.points)).fill({ color: shade(color, light) });
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
        armEdges: edges,
      });
      for (const line of lines) {
        g.poly(project(points, line)).fill({ color: MARKING_COLOR, alpha: MARKING_ALPHA * light });
      }
    }

    // Zábradlí mostu až úplně nahoře.
    for (const part of parts) {
      if (part.kind === 'railing') this.drawRailing(g, points, part.points, part.lift ?? 4);
    }
  }

  /**
   * Bočnice mostu: svislý pás pod hranou desky, na stranách k divákovi.
   * Uprostřed hrany k tomu kus pilíře, ať deska na vodě nevisí ve vzduchu.
   */
  private drawGirder(g: Graphics, quad: TileQuad, edge: readonly UV[], drop: number, light: number): void {
    const [a, b] = edge;
    if (!a || !b) return;
    const p = inside(quad, a[0], a[1]);
    const q = inside(quad, b[0], b[1]);
    const down = -drop;
    g
      .poly([p[0], p[1], q[0], q[1], q[0], q[1] + down, p[0], p[1] + down])
      .fill({ color: shade(BRIDGE_GIRDER_COLOR, light) });
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    g
      .rect(mx - 1.5, my + down, 3, 6)
      .fill({ color: shade(BRIDGE_GIRDER_COLOR, light * 0.8) });
  }

  /** Zábradlí: madlo zvednuté nad desku a sloupky každou pětinu délky. */
  private drawRailing(g: Graphics, quad: TileQuad, edge: readonly UV[], lift: number): void {
    const [a, b] = edge;
    if (!a || !b) return;
    const p = inside(quad, a[0], a[1]);
    const q = inside(quad, b[0], b[1]);
    g
      .moveTo(p[0], p[1] - lift)
      .lineTo(q[0], q[1] - lift)
      .stroke({ width: 0.8, color: BRIDGE_RAIL_COLOR });
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const x = p[0] + (q[0] - p[0]) * t;
      const y = p[1] + (q[1] - p[1]) * t;
      g.moveTo(x, y).lineTo(x, y - lift).stroke({ width: 0.6, color: BRIDGE_RAIL_COLOR });
    }
  }

  private textureFor(type: number): Texture | undefined {
    const family = ROAD_FAMILIES[type];
    return family === undefined ? undefined : this.textures.get(family);
  }

  private roadType(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return ROAD.none;
    return this.world.layers.road[index(x, y, this.world.size)] ?? ROAD.none;
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
