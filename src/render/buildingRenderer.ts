import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import { iconShape } from './icons';
import {
  ABANDONED_COLOR,
  ICON_ALPHA,
  ICON_COLOR,
  luminance,
  POWER_OFF_COLOR,
  shade,
  UNPOWERED_SHADE,
  WALL_LEFT_SHADE,
  WALL_RIGHT_SHADE,
  FOUNDATION_COLOR,
} from './palette';
import { areaHeightRange, groundHeightAt } from '@/sim/heights';
import { compareDepth } from './depth';
import type { DepthBox } from './depth';
import { cuboidFaces, gridToScreen, LEVEL_H, skirtFaces } from './projection';

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
  /** Barva symbolu; bez ní se volí podle jasu budovy. */
  iconColor?: number;
  /** Bere budova proud? Bez něj se kreslí jako odstavená. */
  consumesPower?: boolean;
  /**
   * Obrázek budovy, když ho obsah dodal (T70).
   *
   * Bez něj se kreslí kvádr jako dřív. **Ruina si obrázek nebere**: vyhořelý
   * dům nemá vypadat jako nová škola, takže se u ní vzhled zahodí ještě dřív,
   * než se sem dostane.
   */
  sprite?: {
    readonly url: string;
    readonly width: number;
    readonly height: number;
    readonly anchor: readonly [number, number];
    readonly scale: number;
  };
}

/**
 * Vzhled budovy. Bere **id entity**, ne jen definici, protože z něj se vybírá
 * varianta obrázku — dva domy téhož druhu mají vypadat jinak.
 */
export type AppearanceLookup = (
  definitionId: string,
  buildingId: number,
) => BuildingAppearance | undefined;

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
/** Jak moc budovy zprůhlední. Dost na to, aby pod nimi šla vidět vozovka. */
const GHOST_ALPHA = 0.35;

export class BuildingRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly container: Container;
  private readonly appearance: AppearanceLookup;
  private readonly views = new Map<number, Graphics | Sprite>();
  /**
   * Podezdívky spritů. Sprite polygony kreslit neumí, takže terénní úprava pod
   * obrázkem musí být vlastní uzel — a `Graphics` je jediný, kdo ji nakreslí.
   *
   * Kvádrová cesta si podezdívku kreslí do sebe, takže tady nemá záznam.
   */
  private readonly skirts = new Map<number, Graphics>();
  /** Půdorysy pro řazení. Klíč je id budovy. */
  private readonly boxes = new Map<number, DepthBox>();

  constructor(world: ReadonlyWorldView, parent: Container, appearance: AppearanceLookup) {
    this.world = world;
    this.appearance = appearance;
    this.container = new Container();
    this.container.sortableChildren = true;
    parent.addChild(this.container);
  }

  /**
   * Schová nebo ukáže všechny budovy naráz.
   *
   * Podzemní pohled se dívá **pod** ně, takže by v cestě jen překážely (§8).
   * Je to jeden příznak na kontejneru, ne překreslení — přepnutí pohledu se
   * nesmí projevit prodlevou.
   */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Zprůhlední budovy, aby bylo vidět, co je pod nimi.
   *
   * Ve vyrostlém městě zakryje blok 3×3 celou křižovatku a hráč nemá jak
   * trefit silnici, kterou chce vylepšit. Skrýt je úplně nejde — pak by
   * nevěděl, kam smí stavět; průhledné je oboje naráz.
   */
  setGhost(ghost: boolean): void {
    this.container.alpha = ghost ? GHOST_ALPHA : 1;
  }

  update(dirty: DirtySet): void {
    this.refreshAll(dirty);
    this.reorder();
  }

  /**
   * Přiřadí pořadí kreslení. Volá se **po** každé změně sady budov.
   *
   * Řadí se celá sada, ne jen to, co se změnilo: nová budova může přesunout
   * dozadu i tu, které se nikdo nedotkl. Při tisícovce budov je to řádově
   * deset tisíc porovnání a děje se to jen při změně, ne každý snímek.
   *
   * Podezdívka jde **o krok před svou budovu**, aby ji obrázek překryl —
   * jinak by přes fasádu vedl pruh kamene.
   */
  private reorder(): void {
    const order = [...this.boxes.entries()].sort((a, b) => compareDepth(a[1], b[1]));
    for (let i = 0; i < order.length; i++) {
      const id = order[i]![0];
      const view = this.views.get(id);
      if (view) view.zIndex = i * 2 + 1;
      const skirt = this.skirts.get(id);
      if (skirt) skirt.zIndex = i * 2;
    }
  }

  private refreshAll(dirty: DirtySet): void {
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

    const found = this.appearance(building.definitionId, id);
    if (!found) return; // chybějící definice řeší content registry, ne renderer

    // Ruina si drží půdorys, ale ne vzhled: šedý kvádr o jedné úrovni, bez
    // symbolu. Vzhled je vlastnost entity, ne definice — proto až tady.
    //
    // Temná budova je taky stav entity: ztmavne a dostane na střechu červený
    // blesk, aby bylo na první pohled vidět, kam proud nedošel. Bez toho se to
    // hráč dozvěděl jen z detailu budovy, jednu po druhé.
    const unpowered = !building.abandoned && found.consumesPower === true && !building.powered;
    const appearance: BuildingAppearance = building.abandoned
      ? { color: ABANDONED_COLOR, heightLevels: 1, footprint: found.footprint }
      : unpowered
        ? {
            ...found,
            color: shade(found.color, UNPOWERED_SHADE),
            icon: 'bolt',
            iconColor: POWER_OFF_COLOR,
          }
        : found;

    const [width, depth] = appearance.footprint;

    if (appearance.sprite) {
      this.drawSprite(id, building.x, building.y, width, depth, appearance.sprite);
      return;
    }

    let view = this.views.get(id);
    if (view instanceof Sprite) {
      // Budova přišla o obrázek — třeba tím, že zchátrala. Uzel se musí
      // vyměnit, `Sprite` polygony kreslit neumí.
      this.remove(id);
      view = undefined;
    }
    if (!view) {
      view = new Graphics();
      this.container.addChild(view);
      this.views.set(id, view);
    }
    // Výšku určuje **definice**, ne úroveň entity. Násobit obojím by od T16
    // znamenalo patnáctipatrový věžák, protože vyšší úroveň už má vyšší
    // `heightLevels` sama.
    const height = appearance.heightLevels * LEVEL_H;

    // Budova ze zóny smí stát i na svahu (rozhodnutí autora, T41). Stojí proto
    // horní plochou na **nejvyšším** rohu půdorysu a chybějící kus ke dnu
    // vyplní podezdívka — jinak by na kopci visela rohem ve vzduchu.
    //
    // Ruční stavby si parcelu srovnají, takže u nich vyjde rozdíl nula a
    // podezdívka se nekreslí. Kód je jeden pro obojí.
    const { min, max } = areaHeightRange(
      this.world.cornerHeight,
      building.x,
      building.y,
      width,
      depth,
    );


    const insetX = building.x + BUILDING_INSET;
    const insetY = building.y + BUILDING_INSET;
    const insetW = width - BUILDING_INSET * 2;
    const insetD = depth - BUILDING_INSET * 2;

    const faces = cuboidFaces(insetX, insetY, insetW, insetD, height, max);

    view.clear();

    if (max > min) {
      // Podezdívka je **kámen, ne barva domu**: má být vidět, že je to terénní
      // úprava pod stavbou, a ne že dům na svahu povyrostl o dvě patra.
      //
      // Spodní hrana **kopíruje terén**. Rovný kvádr od nejnižšího rohu
      // k nejvyššímu se svahem protínal a hráč pak nepoznal, na které dlaždici
      // budova stojí — nahlásil to autor.
      const foundation = skirtFaces(insetX, insetY, insetW, insetD, max, (fx, fy) =>
        groundHeightAt(this.world.cornerHeight, fx, fy),
      );
      view
        .poly(foundation.right)
        .fill({ color: shade(FOUNDATION_COLOR, WALL_RIGHT_SHADE) })
        .poly(foundation.left)
        .fill({ color: shade(FOUNDATION_COLOR, WALL_LEFT_SHADE) });
    }

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
      base: max,
    });

    // zIndex se **nepočítá tady**. Hloubka se v izometrii nedá vyjádřit jedním
    // číslem na budovu, jakmile mají různé půdorysy — viz `depth.ts`. Přiřadí
    // ji `reorder()` porovnáním po dvojicích.
    this.boxes.set(id, { x: building.x, y: building.y, width, depth, base: min });
  }

  /**
   * Budova jako obrázek (T70).
   *
   * Kotva obrázku sedne na **přední roh půdorysu** — `gridToScreen(x+w, y+d)` —
   * ve výšce nejvyššího rohu, tedy tam, kde by stála horní plocha kvádru.
   * Podezdívka se nekreslí: obrázek si svůj pozemek nese sám.
   *
   * Řadí se **stejným výrazem jako kvádr**, jinak by se sprity s kvádry
   * navzájem prokládaly ve špatném pořadí, dokud nejsou nakreslené všechny.
   */
  private drawSprite(
    id: number,
    x: number,
    y: number,
    width: number,
    depth: number,
    image: NonNullable<BuildingAppearance['sprite']>,
  ): void {
    let view = this.views.get(id);
    if (view instanceof Graphics) {
      this.remove(id);
      view = undefined;
    }

    let sprite = view as Sprite | undefined;
    if (!sprite) {
      // Textura se dotahuje na pozadí. Do té doby je sprite prázdný, ne chybný:
      // prázdné místo na jeden snímek je lepší než kvádr, který by pak zmizel.
      sprite = new Sprite(Texture.EMPTY);
      this.container.addChild(sprite);
      this.views.set(id, sprite);
    }

    // Rozměry jdou z manifestu, ne z textury: ta nemusí být načtená a kotva
    // spočítaná z nuly by budovu posadila do rohu obrazovky.
    sprite.anchor.set(image.anchor[0] / image.width, image.anchor[1] / image.height);
    sprite.scale.set(1 / image.scale);

    const { min, max } = areaHeightRange(this.world.cornerHeight, x, y, width, depth);
    const front = gridToScreen(x + width, y + depth, max);
    sprite.position.set(front.x, front.y);
    this.boxes.set(id, { x, y, width, depth, base: min });

    // Podezdívka. Obrázek si nese **rovný** pozemek, jenže terén pod ním rovný
    // není — bez ní budova na svahu visí rohem ve vzduchu. Přesně to nahlásil
    // autor a je to chyba, kterou jsem sem zanesl s kvádrem: kvádrová cesta ji
    // kreslí od začátku, sprite ji zapomněl.
    //
    // Kreslí se **o krok dřív** než sprite, aby ji obrázek překryl. Sprite by
    // ji jinak nepřekryl a byl by vidět pruh kamene přes fasádu.
    this.drawSkirt(id, x, y, width, depth, min, max);

    const texture = sprite.texture;
    if (texture === Texture.EMPTY || texture.label !== image.url) {
      void Assets.load(image.url).then((loaded: Texture) => {
        // Než se textura donačte, mohla budova zmizet nebo dostat jiný obrázek.
        if (this.views.get(id) !== sprite) return;
        sprite.texture = loaded;
      });
    }
  }

  /**
   * Kámen mezi rovným pozemkem obrázku a nerovným terénem pod ním.
   *
   * Spodní hrana **kopíruje terén**, ne rovný diamant: rovná čára od rohu
   * k rohu by na svahu terén protínala a hráč by nepoznal, na které dlaždici
   * budova stojí. Totéž pravidlo jako u kvádru.
   *
   * Kreslí se na **plný půdorys**, bez odsazení. Kvádr je proti své parcele
   * zmenšený, aby se sousední domy neslily, ale obrázek svůj pozemek vyplňuje
   * celý — odsazená podezdívka by pod ním nechala mezeru.
   */
  private drawSkirt(
    id: number,
    x: number,
    y: number,
    width: number,
    depth: number,
    min: number,
    max: number,
  ): void {
    if (max <= min) {
      // Rovná parcela podezdívku nepotřebuje. Uzel se zahodí, ať se nedrží
      // prázdný `Graphics` pro každou budovu ve městě.
      this.skirts.get(id)?.destroy();
      this.skirts.delete(id);
      return;
    }

    let skirt = this.skirts.get(id);
    if (!skirt) {
      skirt = new Graphics();
      this.container.addChild(skirt);
      this.skirts.set(id, skirt);
    }

    const faces = skirtFaces(x, y, width, depth, max, (fx, fy) =>
      groundHeightAt(this.world.cornerHeight, fx, fy),
    );
    skirt.clear();
    skirt
      .poly(faces.right)
      .fill({ color: shade(FOUNDATION_COLOR, WALL_RIGHT_SHADE) })
      .poly(faces.left)
      .fill({ color: shade(FOUNDATION_COLOR, WALL_LEFT_SHADE) });
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
    size: { width: number; depth: number; height: number; base: number },
  ): void {
    const shape = iconShape(appearance.icon);
    if (!shape) return;

    // Světlá budova potřebuje tmavý symbol a naopak, jinak splyne.
    const color =
      appearance.iconColor ??
      (luminance(appearance.color) > 0.55 ? shade(appearance.color, 0.45) : ICON_COLOR);

    for (const polygon of shape) {
      const points: number[] = [];
      for (const [u, v] of polygon) {
        // Symbol zabírá prostřední polovinu střechy, ať nelepí na hrany.
        const point = gridToScreen(
          originX + (0.25 + u * 0.5) * size.width,
          originY + (0.25 + v * 0.5) * size.depth,
          size.base,
        );
        points.push(point.x, point.y - size.height);
      }
      view.poly(points).fill({ color, alpha: ICON_ALPHA });
    }
  }

  private remove(id: number): void {
    this.skirts.get(id)?.destroy();
    this.skirts.delete(id);
    this.boxes.delete(id);
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
