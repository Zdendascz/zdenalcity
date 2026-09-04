import { Container, Matrix, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { tileCorners } from '@/sim/heights';
import { index, ROAD } from '@/sim/layers';
import { roadMask } from '@/sim/roads';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import { roadPiece } from './roadShapes';
import { surfaceCorners } from './projection';

/**
 * Vozovka jako **sprity**, ne jako výplň v chunku.
 *
 * Chunk je jeden `Graphics` a všechny výplně v něm jdou na kartu jednou
 * dávkou; do té se vejde jen pár různých textur a zbytek karta zahodí. Tak
 * padl pokus se šestnácti dlaždicemi na typ: na silnici byla tráva. Sprity
 * se dávkují po svém a strop na počet obrázků tam není — přesně tak už fungují
 * budovy a stromy.
 *
 * Sprite se nekreslí na pravidelný kosočtverec, ale **na skutečné rohy
 * dlaždice**. Silnice si při stavbě srovná příčný spád, takže je dlaždice pod
 * ní vždycky rovnoběžník, a rovnoběžník je afinní obraz čtverce: matice ze
 * tří rohů ho posadí přesně. Kdyby zůstala zkroucená do sedla, afinní
 * zobrazení by nestačilo — po srovnání ale sedlo nevznikne.
 */

/** Šířka obrázku dlaždice. Musí sedět na to, co vyrábí `fit-roads.py`. */
const TILE_IMAGE_W = 512;

/** Výška obrázku dlaždice. Kosočtverec 2 : 1, nenarovnaný na čtverec. */
const TILE_IMAGE_H = 256;

/**
 * Jména typů vozovky. Index je hodnota vrstvy `road`, takže to musí sedět na
 * `ROAD` v `sim/layers.ts`. Nula je „žádná silnice" a obrázek nemá.
 */
export const ROAD_FAMILIES: readonly (string | undefined)[] = [
  undefined,
  'street',
  'avenue',
  'highway',
];

export class RoadRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly container: Container;
  private readonly sprites = new Map<number, Sprite>();
  /** Obrázky pod klíčem `rodina__tvar`, jak je pojmenoval `fit-roads.py`. */
  private textures: ReadonlyMap<string, Texture> = new Map();

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    this.container = new Container();
    parent.addChild(this.container);
  }

  /** Podzemní pohled se dívá pod silnice, takže tam jen překážejí. */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /** Nastaví obrázky vozovky a postaví je znovu. */
  setTextures(textures: ReadonlyMap<string, Texture>): void {
    this.textures = textures;
    this.rebuild();
  }

  /**
   * Překreslí, co se změnilo.
   *
   * Přestavuje se **celá síť, ne jen dotčená dlaždice**: postavením jedné
   * silnice se změní tvar až čtyř sousedů a jejich indexy v `dirty` nejsou.
   * Sprity jsou levné a staví se jen na dlaždicích, kde silnice opravdu je.
   */
  update(dirty: DirtySet): void {
    if (dirty.fullRedraw || dirty.tiles.size > 0) this.rebuild();
  }

  private rebuild(): void {
    if (this.textures.size === 0) {
      this.clear();
      return;
    }

    const seen = new Set<number>();
    const { road } = this.world.layers;

    for (let tile = 0; tile < road.length; tile++) {
      const type = road[tile] ?? ROAD.none;
      if (type === ROAD.none) continue;

      const x = tile % this.world.size;
      const y = (tile - x) / this.world.size;
      const texture = this.textureFor(type, x, y);
      if (texture === undefined) continue;

      seen.add(tile);
      let sprite = this.sprites.get(tile);
      if (sprite === undefined) {
        sprite = new Sprite();
        this.sprites.set(tile, sprite);
        this.container.addChild(sprite);
      }
      sprite.texture = texture.texture;
      sprite.setFromMatrix(this.place(x, y, texture.flipX, texture.flipY));
    }

    for (const [tile, sprite] of this.sprites) {
      if (seen.has(tile)) continue;
      sprite.destroy();
      this.sprites.delete(tile);
    }
  }

  private clear(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
  }

  /** Obrázek pro dlaždici i s tím, jestli se má překlopit. */
  private textureFor(
    type: number,
    x: number,
    y: number,
  ): { texture: Texture; flipX: boolean; flipY: boolean } | undefined {
    const family = ROAD_FAMILIES[type];
    if (family === undefined) return undefined;

    // Bitmask se počítá z „je tam jakákoli silnice" — všechny typy se navzájem
    // napojují (§4). Obrázek určuje typ vlastní dlaždice.
    const mask = roadMask((nx, ny) => this.isRoad(nx, ny), x, y);
    const piece = roadPiece(mask);
    if (piece === undefined) return undefined;

    const texture = this.textures.get(`${family}__${piece.shape}`);
    if (texture === undefined) return undefined;
    return { texture, flipX: piece.flipX, flipY: piece.flipY };
  }

  /**
   * Matice, která posadí obrázek na skutečné rohy dlaždice.
   *
   * Obrázek je kosočtverec: sever nahoře uprostřed, východ vpravo, jih dole,
   * západ vlevo. Překlopení se dělá **výběrem, kam který roh obrázku patří**,
   * ne otáčením spritu — sprite otočený o devadesát stupňů by z kosočtverce
   * 2 : 1 udělal 1 : 2 a to není totéž.
   */
  private place(x: number, y: number, mirrorX: boolean, mirrorY: boolean): Matrix {
    const corners = tileCorners(this.world.cornerHeight, x, y);
    // `surfaceCorners` vrací rohy dlaždice po směru hodin od severu.
    const [north, east, south, west] = surfaceCorners(x, y, corners);

    // Vodorovné překlopení prohodí sever se západem a východ s jihem, svislé
    // sever s jihem a východ se západem — přesně jako v masce.
    // **Kam který roh obrázku patří.**
    //
    // Tady jsem to jednou spletl a stálo to celou sadu: transformace **hran**
    // není totéž co transformace **rohů**. `roadShapes` počítá s hranami,
    // protože maska mluví o sousedech; kreslení potřebuje rohy.
    //
    // Vodorovné zrcadlení prohodí levý a pravý roh (horní a dolní zůstanou)
    // a na hranách z toho vyjde sever ↔ západ, východ ↔ jih. Druhé překlopení
    // v `roadShapes` je ve skutečnosti **otočení o sto osmdesát stupňů** —
    // prohodí obě dvojice rohů a na hranách dá sever ↔ jih, východ ↔ západ.
    // Obojí naráz je pak svislé zrcadlení, tedy prohození horního a dolního
    // rohu.
    //
    // | vodorovné | otočení | sever obrázku | východ obrázku | západ obrázku |
    // |---|---|---|---|---|
    // | ne | ne | sever | východ | západ |
    // | ano | ne | sever | západ | východ |
    // | ne | ano | jih | západ | východ |
    // | ano | ano | jih | východ | západ |
    const [n, e, w] = mirrorX
      ? mirrorY
        ? [south, east, west]
        : [north, west, east]
      : mirrorY
        ? [south, west, east]
        : [north, east, west];

    // **Tři body určí afinní zobrazení.** Obrázkové souřadnice kosočtverce
    // jsou pevné: sever `(W/2, 0)`, východ `(W, H/2)`, západ `(0, H/2)`.
    // Z rovnic pro tyhle tři body vyjde matice přímo, bez dopočítávání:
    //
    //     a·(W/2) + tx = n.x            (sever)
    //     a·W + c·(H/2) + tx = e.x      (východ)
    //     c·(H/2) + tx = w.x            (západ)
    //
    // Odečtením západu od východu zmizí `c` i `tx` a zbude `a`; zbytek se
    // dosadí. Jih se nepoužívá — u rovnoběžníku vyjde sám, a kdyby dlaždice
    // rovnoběžník nebyla, afinní zobrazení by ji stejně neuneslo.
    const halfW = TILE_IMAGE_W / 2;
    const halfH = TILE_IMAGE_H / 2;

    const a = (e[0] - w[0]) / TILE_IMAGE_W;
    const b = (e[1] - w[1]) / TILE_IMAGE_W;
    const tx = n[0] - a * halfW;
    const ty = n[1] - b * halfW;
    const c = (w[0] - tx) / halfH;
    const d = (w[1] - ty) / halfH;

    return new Matrix(a, b, c, d, tx, ty);
  }

  private isRoad(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return false;
    return (
      (this.world.layers.road[index(x, y, this.world.size)] ?? ROAD.none) !== ROAD.none
    );
  }
}
