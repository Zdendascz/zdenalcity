import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import { iconShape } from './icons';
import { sampleSmooth } from './textures';
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
import { depthOrder } from './depth';
import type { DepthBox } from './depth';
import { decorDensity, decorHere, decorPick, decorShift, decorTiles } from './decor';
import type { TerrainDecor } from './decor';
import { index, TERRAIN } from '@/sim/layers';
import { cuboidFaces, gridToScreen, LEVEL_H, skirtFaces } from './projection';

/** Na kolik dlaždic je nakreslená zpustlá budova. Viz `DECOR` ve `fit-sprites.py`. */
const DERELICT_TILES = 2;

/** Obrázek budovy tak, jak ho popisuje `sprites/index.json`. */
export interface SpriteImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly anchor: readonly [number, number];
  readonly scale: number;
}

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
  sprite?: SpriteImage;
  /**
   * Obrázek zpustlé budovy podle kategorie (T93).
   *
   * Do té doby se opuštěná budova kreslila jako **šedý kvádr** a autor to
   * zavrhl: „místo šedých kvádrů nějaké pěkné brownfieldové hrůzy… místo
   * zbořených obytných zón nějaké odpudivé slumy".
   *
   * Je jeden na kategorii, ne jeden na každý půdorys: renderer ho posadí
   * doprostřed parcely a **zmenší**, když je parcela menší. Roztáhnout ho
   * nesmí — tím by rozbil izometrii.
   */
  derelict?: SpriteImage;
  /**
   * Klíč materiálu podezdívky, například `residential__b`.
   *
   * Vybírá ho `createAppearanceLookup` z kategorie definice a z id budovy,
   * takže se po načtení savu ani po překreslení nezmění.
   */
  skirt?: string;
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
  /** Materiály podezdívek pod klíčem `kategorie__varianta`. */
  private skirtTextures: ReadonlyMap<string, Texture> = new Map();
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
  /**
   * Stromy a balvany podle druhu terénu.
   *
   * Jsou tady, a ne v terénním chunku, protože se **musí řadit spolu
   * s budovami**. V chunku byly dřív a park se pak nakreslil přes stromy, které
   * měly stát před ním. Chunk se kreslí pod celou zástavbou, takže se z něj
   * správné pořadí vzít nedá.
   *
   * Cena je počet uzlů: les na velké mapě jich přidá řádově tisíc. Řazení to
   * unese — naměřeno 2,1 ms na 2 500 krabicích a přerovnává se jen při změně.
   */
  private decorByTerrain = new Map<number, TerrainDecor[]>();
  /** Hromady suti. Kreslí se na dlaždice s troskami, jedna na dlaždici. */
  private rubblePiles: readonly TerrainDecor[] = [];
  /**
   * Kreslí se stromy a balvany?
   *
   * **Ne průhlednost, ale úplné vypnutí** (rozhodnutí autora). Průhledný les
   * pořád překáží: hráč pod ním hledá dlaždici, na kterou chce kliknout, a
   * poloprůhledná koruna mu ji zakrývá stejně jako plná.
   */
  private decorVisible = true;

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
    // Terén se mění zřídka (terraforming, kácení), ale když se změní, musí se
    // stromy přepočítat celé: mizí i přibývají a jejich id nejsou v `dirty`.
    if (dirty.fullRedraw || dirty.tiles.size > 0) {
      this.rebuildDecor();
      // Suť přibývá i mizí po jedné dlaždici a její id v `dirty.buildings`
      // nejsou. Průchod mapou je levný a děje se jen při stavbě nebo bourání.
      this.rebuildRubble();
    }
    this.reorder();
  }

  /** Nastaví materiály podezdívek a překreslí je. */
  setSkirtTextures(textures: ReadonlyMap<string, Texture>): void {
    this.skirtTextures = textures;
    for (const skirt of this.skirts.values()) skirt.clear();
    this.refreshAll({
      tiles: new Set(),
      buildings: new Set(),
      fullRedraw: true,
      coarseChanged: false,
      heightsChanged: false,
    });
    this.reorder();
  }

  /** Zapne nebo vypne stromy a balvany. Vypnuté se **vůbec nevytvářejí**. */
  setDecorVisible(visible: boolean): void {
    if (this.decorVisible === visible) return;
    this.decorVisible = visible;
    this.rebuildDecor();
    this.reorder();
  }

  /**
   * Nastaví obrázky hromad suti a postaví je znovu.
   *
   * Do T93 byly trosky **jen textura pod nohama** a autor to zavrhl: „u těch
   * rozbitých věcí místo té textury udělej obrázky". Textura zůstala jako
   * rozrytá zem, hromada je to, co z toho dělá demolici a ne pole.
   */
  setRubblePiles(piles: readonly TerrainDecor[]): void {
    this.rubblePiles = piles;
    this.rebuildRubble();
    this.reorder();
  }

  /** Nastaví obrázky stromů a balvanů a postaví je znovu. */
  setDecor(decor: ReadonlyMap<number, TerrainDecor[]>): void {
    this.decorByTerrain = new Map(decor);
    this.rebuildDecor();
    this.reorder();
  }

  /**
   * Rozestaví stromy a balvany po mapě.
   *
   * Id jsou **záporná**, aby se nesrazila s budovami: `-(index dlaždice + 1)`.
   * Díky tomu je nese táž mapa a řadí je totéž porovnání.
   */
  private rebuildDecor(): void {
    for (const id of [...this.views.keys()]) {
      if (id < 0) this.remove(id);
    }
    // Vypnuté se nejen skryjí, ale ani nevzniknou: uzel, který nikdo nevidí,
    // nemá co dělat ani v řazení hloubky.
    if (!this.decorVisible || this.decorByTerrain.size === 0) return;

    const size = this.world.size;
    const terrainLayer = this.world.layers.terrain;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const tile = index(x, y, size);
        const choices = this.decorByTerrain.get(terrainLayer[tile] ?? 0);
        if (choices === undefined || choices.length === 0) continue;

        const decor = choices[decorPick(x, y) % choices.length];
        if (decor === undefined || !decorHere(x, y, decorDensity(decor))) continue;
        // Nad vodou strom nestojí. Je široký víc než dlaždici, takže by na
        // břehu přečuhoval nad hladinu a vypadal, že letí — autor to nahlásil.
        if (this.nearWater(x, y, decorTiles(decor))) continue;

        this.placeDecor(-(tile + 1), x, y, decor);
      }
    }
  }

  /**
   * Rozestaví hromady suti.
   *
   * Id jsou záporná jako u stromů, ale **posunutá o velikost mapy**, aby se
   * s nimi nesrazila: obojí bydlí v téže mapě uzlů a řadí je totéž porovnání.
   */
  private rebuildRubble(): void {
    const size = this.world.size;
    const offset = size * size;
    for (const id of [...this.views.keys()]) {
      if (id <= -offset) this.remove(id);
    }
    if (this.rubblePiles.length === 0) return;

    const rubble = this.world.rubble;
    for (let tile = 0; tile < rubble.length; tile++) {
      if ((rubble[tile] ?? 0) === 0) continue;
      const x = tile % size;
      const y = (tile - x) / size;
      // Varianta ze souřadnic, ne z `world.rng`: musí vyjít stejně při každém
      // překreslení i po načtení savu, jinak by se suť při každém pohledu
      // přeskládala.
      const pile = this.rubblePiles[decorPick(x, y) % this.rubblePiles.length];
      if (pile === undefined) continue;
      this.placeDecor(-(tile + 1 + offset), x, y, pile, true);
    }
  }

  /** Je v dosahu předmětu voda? Nad ní se nestaví. */
  private nearWater(x: number, y: number, tiles: number): boolean {
    const reach = Math.max(1, tiles - 1);
    const size = this.world.size;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (this.world.layers.terrain[index(nx, ny, size)] === TERRAIN.water) return true;
      }
    }
    return false;
  }

  private placeDecor(
    id: number,
    x: number,
    y: number,
    decor: TerrainDecor,
    /**
     * Leží předmět na zemi celou plochou, nebo se jí dotýká jen v jednom bodě?
     *
     * Strom se země dotýká kmenem, takže mu stačí výška přesně pod patou.
     * Hromada suti zabírá celou dlaždici a má **plochou spodní hranu**: na
     * svahu pak polovina hromady visí ve vzduchu. Autor to popsal takhle —
     * „suť je pořád nad kopcem, ne na stráni".
     */
    onGround = false,
  ): void {
    const sprite = new Sprite(decor.texture);
    sprite.anchor.set(decor.anchor[0] / decor.texture.width, decor.anchor[1] / decor.texture.height);
    sprite.scale.set(1 / decor.scale);

    // Strom roste svisle a na svahu se mění jen místo, kde se dotýká země —
    // proto pro něj nejsou zvláštní obrázky podle svahu, kreslily by osmkrát
    // totéž. O to důležitější je to místo trefit.
    //
    // Výška se bere **přesně pod patou předmětu**, ne jako zaokrouhlený průměr
    // rohů dlaždice. Průměr chyboval dvakrát: zaokrouhlením na celé úrovně až
    // o půl úrovně (osm pixelů) a tím, že předmět je uvnitř dlaždice posunutý
    // až o třetinu, takže pod ním je jiná výška než uprostřed. Na svahu se to
    // sečetlo a suť visela vedle své dlaždice — hlásil to autor slovy
    // „zbořeniny v kopcích jsou úplně mimo".
    const [shiftX, shiftY] = decorShift(x, y);
    const fx = x + 0.5 + shiftX;
    const fy = y + 0.5 + shiftY;
    /*
     * Plošný předmět sedá na **nejnižší roh dlaždice**, bodový na výšku přesně
     * pod patou.
     *
     * Rozdíl je v tom, co je pod obrázkem. Strom má pod sebou jeden bod, takže
     * interpolovaná výška je přesně ta správná. Hromada suti má plochou spodní
     * hranu přes celou dlaždici, a ta na svahu nemůže sedět nikde jinde než na
     * nejnižším rohu — jinak jí zbytek visí. Radši ať se do svahu zaboří, než
     * aby nad ním plavala: zabořená suť vypadá jako suť na stráni, plovoucí
     * jako chyba.
     */
    const pad = onGround
      ? areaHeightRange(this.world.cornerHeight, x, y, 1, 1).min
      : groundHeightAt(this.world.cornerHeight, fx, fy);
    const at = gridToScreen(fx, fy, pad);
    sprite.position.set(at.x, at.y);

    this.container.addChild(sprite);
    this.views.set(id, sprite);
    this.boxes.set(id, { x, y, width: 1, depth: 1, base: pad });
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
    const order = depthOrder(this.boxes);
    for (let i = 0; i < order.length; i++) {
      const id = order[i]!;
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
      ? {
          color: ABANDONED_COLOR,
          heightLevels: 1,
          footprint: found.footprint,
          // Obrázek zpustlé budovy, když ho obsah dodal. Bez něj zůstane šedý
          // kvádr jako dřív — chybějící obrázek hru nezastaví (P5).
          ...(found.derelict === undefined ? {} : { sprite: found.derelict }),
        }
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
      // Zpustlá budova má obrázek pro dvě dlaždice na dvě. Na menší parcele
      // se **zmenší celý**, ne zúží: roztažením by se rozešla izometrie.
      const fit = building.abandoned
        ? Math.min(1, (width + depth) / (DERELICT_TILES * 2))
        : 1;
      this.drawSprite(id, building.x, building.y, width, depth, appearance.sprite, fit);
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

    // Budova ze zóny smí stát i na svahu (rozhodnutí autora, T41). Podlaha leží
    // v **průměrné** výšce rohů půdorysu a chybějící kus ke dnu vyplní
    // podezdívka — jinak by na kopci visela rohem ve vzduchu.
    //
    // Průměr, ne nejvyšší roh: na nejvyšším musí podezdívka sáhnout až
    // k nejnižšímu, takže dům stojí celou parcelou na soklu. Autor to nahlásil
    // slovy „dům pořád visí". Na průměru se zařízne do svahu a dozdívá se jen
    // dolní půlka, jak se na kopci opravdu staví.
    //
    // Ruční stavby si parcelu srovnají, takže u nich vyjde rozdíl nula a
    // podezdívka se nekreslí. Kód je jeden pro obojí.
    const { min, pad } = areaHeightRange(
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

    const faces = cuboidFaces(insetX, insetY, insetW, insetD, height, pad);

    view.clear();

    if (pad > min) {
      // Podezdívka je **kámen, ne barva domu**: má být vidět, že je to terénní
      // úprava pod stavbou, a ne že dům na svahu povyrostl o dvě patra.
      //
      // Spodní hrana **kopíruje terén**. Rovný kvádr od nejnižšího rohu
      // k nejvyššímu se svahem protínal a hráč pak nepoznal, na které dlaždici
      // budova stojí — nahlásil to autor.
      const foundation = skirtFaces(insetX, insetY, insetW, insetD, pad, (fx, fy) =>
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
      base: pad,
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
    /** Dodatečné zmenšení. Jednička je přirozená velikost obrázku. */
    fit = 1,
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
    sprite.scale.set(fit / image.scale);

    /*
     * Podlaha obrázku leží na **nejvyšším rohu parcely**, ne na průměru.
     *
     * Kvádr si smí zaříznout do svahu, protože je to holá krabice. Obrázek ne:
     * nese **vlastní rovný pozemek** — chodník, trávu, plot — a když ho podlaha
     * posadí níž, než kam sahá terén, prorostou mu okolní dlaždice skrz ten
     * pozemek. Dům pak vypadá odsunutý do silnice a bez podezdívky. Změřeno na
     * městě autora: z 681 budov jich takhle sedělo 82.
     *
     * Na nejvyšším rohu je pozemek celý nad terénem a zbytek doplní podezdívka.
     */
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
        // Mipmapy i tady: při odzoomování je budova na obrazovce menší než její
        // obrázek a bez nich se z fasády stane zrno, stejně jako z povrchu.
        sampleSmooth(loaded);
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
  /** Materiál podezdívky pro budovu, pokud ho obsah dodal. */
  private skirtTextureFor(id: number): Texture | undefined {
    const building = this.world.buildings.get(id);
    if (building === undefined) return undefined;
    const key = this.appearance(building.definitionId, id)?.skirt;
    return key === undefined ? undefined : this.skirtTextures.get(key);
  }

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

    const texture = this.skirtTextureFor(id);
    for (const [face, tone] of [
      [faces.right, WALL_RIGHT_SHADE],
      [faces.left, WALL_LEFT_SHADE],
    ] as const) {
      // Barva se kreslí **vždycky, i pod obrázek** — stejně jako u terénu.
      // Když materiál chybí nebo se nedokreslí, zůstane kámen, ne díra.
      skirt.poly(face).fill({ color: shade(FOUNDATION_COLOR, tone) });
      if (texture === undefined) continue;
      // `textureSpace: 'local'` roztáhne materiál přes obálku stěny. U zdi to
      // stačí a matici to ušetří: materiál je schválně bez směru a bez
      // přechodu, takže na roztažení není co poznat. U terénu to nejde —
      // tam se obrázek musí trefit na rohy dlaždice.
      skirt.poly(face).fill({
        texture,
        textureSpace: 'local',
        color: shade(0xffffff, tone),
      });
    }
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
