import { Assets, Container, Graphics, Matrix, Sprite, Texture } from 'pixi.js';
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
import { placedFootprint } from '@/sim/buildings';
import { areaHeightRange, groundHeightAt } from '@/sim/heights';
import { depthOrder } from './depth';
import type { DepthBox } from './depth';
import { decorDensity, decorHere, decorPick, decorShift, decorTiles, rubbleSlope } from './decor';
import type { RubbleSlope, TerrainDecor } from './decor';
import { index, ROAD, TERRAIN, WIRE } from '@/sim/layers';
import { houseSides } from './streets';
import { SIDEWALK, VERGE } from './roadDetails';
import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from './roads';
import { cuboidFaces, gridToScreen, LEVEL_H, skirtFaces } from './projection';
import { POP_MS, popScale } from './effects';
import type { DustArea } from './effects';

/** Na kolik dlaždic je nakreslená zpustlá budova. Viz `DECOR` ve `fit-sprites.py`. */
const DERELICT_TILES = 2;

/** Obrázek budovy tak, jak ho popisuje `sprites/index.json`. */
export interface SpriteImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly anchor: readonly [number, number];
  readonly scale: number;
  /** Efekty z `sprites/effects.json` (T116). */
  readonly effects?: readonly SpriteEffectView[];
}

/** Efekt na obrázku budovy — úzká kopie `SpriteEffect` z registru. */
export interface SpriteEffectView {
  readonly type: string;
  readonly at: readonly [number, number];
  readonly when?: 'always' | 'powered';
  readonly part?: string;
  readonly axes?: readonly [readonly [number, number], readonly [number, number]];
  readonly rate?: number;
  readonly color?: string;
}

/** Načtený díl: textura, kotva a u rotoru délka lopatky, vše v px dílu. */
export interface LoadedPart {
  readonly texture: Texture;
  readonly anchor: readonly [number, number];
  readonly radius?: number;
  readonly skew?: number;
}

/** Kouř, který má zrovna stoupat: bod ve světě a hustota. */
export interface SmokeSource {
  readonly x: number;
  readonly y: number;
  readonly rate: number;
  readonly color: number;
  /** Stálé číslo zdroje, ať si emitor drží vlastní rytmus. */
  readonly key: number;
}

/** Točící se díl (rotor) jedné budovy. */
interface Spinner {
  readonly node: Container;
  readonly blade: Sprite;
  readonly rate: number;
}

/** Díly se kreslí ve čtyřnásobku, stejně jako budovy. */
const PART_SCALE = 4;

/**
 * Výška úchytů drátů nad zemí v patrech (16 px): nízké napětí na vrcholu
 * dřevěného sloupu (30 px), vysoké ve dvou úrovních ramen stožáru (62 px).
 */
const WIRE_HEIGHTS: Record<number, readonly number[]> = {
  [WIRE.low]: [1.75],
  [WIRE.high]: [2.8, 2.0],
};

/** Pořadí strany v id lampy: dlaždice × 4 + strana. */
const ARM_INDEX: Record<number, number> = { [ROAD_N]: 0, [ROAD_E]: 1, [ROAD_S]: 2, [ROAD_W]: 3 };

/** Kam z dlaždice vede silnice — maska jako `roadMask`, jen bez závislosti na sim. */
function roadArms(road: ArrayLike<number>, size: number, x: number, y: number): number {
  const at = (nx: number, ny: number): boolean =>
    nx >= 0 && ny >= 0 && nx < size && ny < size && (road[ny * size + nx] ?? 0) !== 0;
  return (
    (at(x, y - 1) ? ROAD_N : 0) |
    (at(x + 1, y) ? ROAD_E : 0) |
    (at(x, y + 1) ? ROAD_S : 0) |
    (at(x - 1, y) ? ROAD_W : 0)
  );
}

/** Pod tímhle zoomem je strom pár pixelů a houpání by jen zrnilo. */
const SWAY_MIN_ZOOM = 0.6;

/**
 * Zkosení stromu v čase `t` (s) v bodě `x, y` obrazovky světa.
 *
 * Vlna jde šikmo přes mapu rychlostí zhruba dvou dlaždic za sekundu. Jen její
 * hřeben (`gust` nad nulou) stromy ohne; v něm se ještě každý strom kýve
 * vlastní fází. Záporné zkosení nakloní korunu doprava — po větru, kterým
 * se ženou i obláčky kouře.
 */
export function swayAt(x: number, y: number, t: number, phase: number): number {
  const wave = Math.sin(x * 0.006 + y * 0.004 - t * 0.9) + 0.5 * Math.sin(x * 0.0023 - y * 0.0031 - t * 0.37);
  const gust = Math.max(0, (wave - 0.6) / 0.9);
  if (gust === 0) return 0;
  return -0.07 * gust * (0.55 + 0.45 * Math.sin(t * 2.4 + phase));
}

/** Výchozí otáčky rotoru za sekundu. Skutečné větrníky dělají 0,2–0,5. */
const SPIN_RATE = 0.35;

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
  private rubblePiles: ReadonlyMap<RubbleSlope, readonly TerrainDecor[]> = new Map();
  /**
   * Kreslí se stromy a balvany?
   *
   * **Ne průhlednost, ale úplné vypnutí** (rozhodnutí autora). Průhledný les
   * pořád překáží: hráč pod ním hledá dlaždici, na kterou chce kliknout, a
   * poloprůhledná koruna mu ji zakrývá stejně jako plná.
   */
  private decorVisible = true;
  /**
   * Čím budova byla při minulém kreslení: `definice#úroveň`. Podle toho se
   * pozná, že **vyrostla** — nová, nebo povýšená — a ne jen že se překreslila
   * kvůli proudu nebo podezdívce (T114).
   */
  private readonly known = new Map<number, string>();
  /** Budovy, které právě vyrůstají, a kolik ms už rostou. */
  private readonly growing = new Map<number, number>();
  /** Měřítko spritu bez animace. `drawSprite` ho přepisuje, animace z něj násobí. */
  private readonly baseScale = new Map<number, number>();
  /** Hýbou se budovy? Vypíná přepínač animací i `prefers-reduced-motion`. */
  private motion = true;
  /** Hloubka pro auta podle dlaždice. Maže se při každém přeřazení. */
  private readonly depthCache = new Map<number, number>();
  /** Sloupy vedení (T129). */
  private lowPole: LoadedPart | undefined;
  private pylon: LoadedPart | undefined;
  /** Obrázek lampy (T122). Bez něj se lampy nestaví. */
  private lamp: LoadedPart | undefined;
  private lampsStale = false;
  private lampsBuilt = 0;
  /** Stromy, které se houpou ve větru (T119), s vlastní fází kmitu. */
  private trees: { sprite: Sprite; phase: number }[] = [];
  /** Hodiny větru v ms. Běží i na pauze — pauza zastavuje město, ne vítr. */
  private wind = 0;
  /** Houpaly se stromy minulý snímek? Po vypnutí se jednou srovnají. */
  private swayed = false;
  /** Rotory podle id budovy (T116). */
  private readonly spinners = new Map<number, Spinner[]>();
  /** Komíny podle id budovy — body ve světě, odkud stoupá kouř. */
  private readonly chimneys = new Map<number, SmokeSource[]>();
  /** Místa k sezení na zastávkách (T118) — body ve světě podle id budovy. */
  private readonly seats = new Map<number, { x: number; y: number }[]>();
  /** Díly pro efekty. Bez nich se efekt nekreslí, budova stojí dál. */
  private parts: ReadonlyMap<string, LoadedPart> = new Map();
  /** Budova zmizela z mapy. Dostane půdorys, nad kterým se má zaprášit. */
  onVanished: ((area: DustArea) => void) | null = null;

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

  /** Zapne nebo vypne vyrůstání budov. Rozběhnuté se hned dorovnají. */
  setMotion(motion: boolean): void {
    this.motion = motion;
    if (!motion) {
      for (const id of [...this.growing.keys()]) this.applyGrowth(id, 1);
      this.growing.clear();
    }
  }

  /** Nastaví díly pro efekty a překreslí budovy, které je používají. */
  setParts(parts: ReadonlyMap<string, LoadedPart>): void {
    this.parts = parts;
    for (const id of this.world.buildings.keys()) this.refresh(id, false);
    this.reorder();
  }

  /**
   * Rozhoupe stromy ve výřezu (T119).
   *
   * Přes mapu jde **pomalá vlna větru** a hýbe se jen to, co je zrovna na
   * jejím hřebeni. Celý les vlnící se v jednom rytmu by vypadal jako porucha;
   * autor chtěl, aby se stromy hýbaly „tu a tam". Fáze kmitu jde ze
   * souřadnic, takže po posunu kamery strom nezačne odjinud.
   */
  sway(deltaMS: number, view: { minX: number; maxX: number; minY: number; maxY: number }, zoom: number): void {
    const active = this.motion && this.decorVisible && zoom >= SWAY_MIN_ZOOM;
    if (!active) {
      if (this.swayed) for (const tree of this.trees) tree.sprite.skew.x = 0;
      this.swayed = false;
      return;
    }
    this.swayed = true;
    this.wind += deltaMS;
    const t = this.wind / 1000;
    const margin = 80;
    for (const tree of this.trees) {
      if (tree.sprite.destroyed) continue;
      const { x, y } = tree.sprite.position;
      if (x < view.minX - margin || x > view.maxX + margin || y < view.minY || y > view.maxY + margin * 3) {
        continue;
      }
      tree.sprite.skew.x = swayAt(x, y, t, tree.phase);
    }
  }

  /**
   * Vrstva, ve které se řadí budovy, stromy a lampy. Auta do ní přidávají
   * své sprity, aby se řadila s domy (T124).
   */
  get layer(): Container {
    return this.container;
  }

  /**
   * Hloubka pro pohyblivý předmět na dlaždici `x, y`: nejvyšší `zIndex`
   * mezi domy, stromy a lampami, které stojí **za** ní (celé severně nebo
   * západně). Předmět s `depthAt + 0,5` se pak nakreslí přes ně a pod vším,
   * co je vepředu.
   *
   * Hledá se jen v okně čtyř dlaždic zpět — dál už nic nesahá tak, aby
   * překrylo auto. Výsledek se pamatuje, dokud se budovy nepřeřadí.
   */
  depthAt(x: number, y: number): number {
    const size = this.world.size;
    if (x < 0 || y < 0 || x >= size || y >= size) return 0;
    const key = y * size + x;
    const cached = this.depthCache.get(key);
    if (cached !== undefined) return cached;
    let best = 0;
    const ids = this.world.layers.buildingId;
    const lampBase = 2 * size * size;
    for (let j = Math.max(0, y - 4); j <= y; j++) {
      for (let i = Math.max(0, x - 4); i <= x; i++) {
        const tile = j * size + i;
        const id = ids[tile] ?? 0;
        if (id > 0) {
          const box = this.boxes.get(id);
          const view = this.views.get(id);
          if (box && view && (box.x + box.width <= x || box.y + box.depth <= y)) {
            best = Math.max(best, view.zIndex);
          }
        }
        // Strom, suť a lampy stojí na své dlaždici; za námi jsou, když je
        // ta dlaždice celá severně nebo západně.
        if (i < x || j < y) {
          for (const other of [-(tile + 1), -(tile + 1 + size * size)]) {
            const view = this.views.get(other);
            if (view) best = Math.max(best, view.zIndex);
          }
          for (let side = 0; side < 4; side++) {
            const view = this.views.get(-(lampBase + tile * 4 + side + 1));
            if (view) best = Math.max(best, view.zIndex);
          }
        } else {
          // Lampa na **téže** dlaždici: stojí-li na severním nebo západním
          // kraji, je za autem. Bez tohohle trčela lampa z auta (hlásil
          // autor). Jižní a východní zůstávají před ním.
          for (const side of [0, 3]) {
            const view = this.views.get(-(lampBase + tile * 4 + side + 1));
            if (view) best = Math.max(best, view.zIndex);
          }
        }
      }
    }
    this.depthCache.set(key, best);
    return best;
  }

  /** `zIndex` budovy, nebo 0. Lidé na lavičce se řadí hned za ni. */
  zIndexOf(id: number): number {
    return this.views.get(id)?.zIndex ?? 0;
  }

  /** Lavičky na zastávkách podle id budovy. Sedí na nich `People`. */
  seatSpots(): ReadonlyMap<number, readonly { x: number; y: number }[]> {
    return this.seats;
  }

  /** Odkud právě stoupá kouř. `Effects` z toho dělá obláčky. */
  smokeSources(): Iterable<SmokeSource> {
    const all: SmokeSource[] = [];
    for (const list of this.chimneys.values()) all.push(...list);
    return all;
  }

  /** Posune vyrůstající budovy a rotory o snímek. Volá se každý snímek. */
  animate(deltaMS: number): void {
    if (this.motion && this.spinners.size > 0) {
      const turn = (deltaMS / 1000) * Math.PI * 2;
      for (const list of this.spinners.values()) {
        for (const spinner of list) spinner.blade.rotation += turn * spinner.rate;
      }
    }
    if (this.growing.size === 0) return;
    for (const [id, elapsed] of this.growing) {
      const next = elapsed + deltaMS;
      const t = next / POP_MS;
      this.applyGrowth(id, t);
      if (t >= 1) this.growing.delete(id);
      else this.growing.set(id, next);
    }
  }

  /**
   * Nastaví budově měřítko vyrůstání.
   *
   * Roste **od paty**, ne od středu: sprite má kotvu na předním rohu půdorysu,
   * takže stačí měřítko. Kvádr se kreslí ve světových souřadnicích, a tak mu
   * pivot musí na ten roh přestěhovat až animace — a po ní ho vrátit.
   */
  private applyGrowth(id: number, t: number): void {
    const view = this.views.get(id);
    const box = this.boxes.get(id);
    if (!view || !box) return;
    const [sx, sy] = popScale(t);
    // Rotor a spol. se během vyrůstání schovají: rostou z jiného bodu než
    // budova a vypadalo by to, že lopatky visí ve vzduchu.
    for (const spinner of this.spinners.get(id) ?? []) spinner.node.visible = t >= 1;
    if (view instanceof Sprite) {
      const base = this.baseScale.get(id) ?? view.scale.y;
      view.scale.set(base * sx, base * sy);
      return;
    }
    if (t >= 1) {
      view.pivot.set(0, 0);
      view.position.set(0, 0);
      view.scale.set(1, 1);
      return;
    }
    const foot = gridToScreen(box.x + box.width, box.y + box.depth, box.base);
    view.pivot.set(foot.x, foot.y);
    view.position.set(foot.x, foot.y);
    view.scale.set(sx, sy);
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
      this.rebuildLamps();
      this.rebuildWires();
    } else if (dirty.buildings.size > 0) {
      // Dům povyrostl → u silnice přibude chodník a s ním lampa. Sbírá se
      // to stejně jako u vozovky, nejvýš dvakrát za sekundu.
      this.lampsStale = true;
    }
    if (this.lampsStale && performance.now() - this.lampsBuilt > 500) {
      this.rebuildLamps();
      // Dráty nízkého napětí se chytají domů a zón — nový dům je přesměruje.
      this.rebuildWires();
    }
    this.reorder();
  }

  /** Obrázky sloupů vedení (T129). Bez nich se vedení kreslí jen dráty. */
  setPoles(lowPole: LoadedPart | undefined, pylon: LoadedPart | undefined): void {
    this.lowPole = lowPole;
    this.pylon = pylon;
    this.rebuildWires();
    this.reorder();
  }

  /**
   * Elektrické vedení na mapě (T129). Autor: „dráty musí být vidět, vysoké
   * napětí musí být normálně sloupy, nízké musí vést od budovy k budově".
   *
   * Každá dlaždice vedení je jeden uzel řazený s domy: sloup (dřevěný, nebo
   * ocelový stožár) a dráty k sousedům. Dráty vedou ke **každému sousednímu
   * vedení** a u nízkého napětí i **k sousední zóně či budově** — tím je vidět,
   * že vedení spojuje bloky. Na silnici ani na budově sloup nestojí: drát
   * tam jen visí přes ni mezi sloupy nebo domy po stranách.
   *
   * Id jsou za lampami: `-(6 · plocha + dlaždice + 1)`.
   */
  private rebuildWires(): void {
    const size = this.world.size;
    const cells = size * size;
    const floor = -6 * cells;
    for (const id of [...this.views.keys()]) {
      if (id <= floor && id > floor - cells - 1) this.remove(id);
    }
    const wire = this.world.layers.wire;
    const road = this.world.layers.road;
    const ids = this.world.layers.buildingId;
    const zone = this.world.layers.zone;
    const typeAt = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= size || y >= size ? WIRE.none : (wire[index(x, y, size)] ?? WIRE.none);
    const parcelAt = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= size || y >= size) return false;
      const t = index(x, y, size);
      return (ids[t] ?? 0) !== 0 || (zone[t] ?? 0) !== 0;
    };
    const ground = (gx: number, gy: number): number => groundHeightAt(this.world.cornerHeight, gx, gy);

    for (let tile = 0; tile < cells; tile++) {
      const type = wire[tile] ?? WIRE.none;
      if (type === WIRE.none) continue;
      const x = tile % size;
      const y = (tile - x) / size;
      const node = new Container();
      const base = ground(x + 0.5, y + 0.5);
      const heights = WIRE_HEIGHTS[type] ?? WIRE_HEIGHTS[WIRE.low]!;
      const vertical = typeAt(x, y - 1) !== WIRE.none || typeAt(x, y + 1) !== WIRE.none;
      const horizontal = typeAt(x - 1, y) !== WIRE.none || typeAt(x + 1, y) !== WIRE.none;

      const cables = new Graphics();
      const color = type === WIRE.high ? 0x3a3d42 : 0x2b2622;
      const width = type === WIRE.high ? 0.9 : 0.7;
      const drawSpan = (fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): void => {
        const a = gridToScreen(fx, fy, fz);
        const b = gridToScreen(tx, ty, tz);
        // Průvěs: drát mezi úchyty lehce klesá.
        const sag = Math.hypot(b.x - a.x, b.y - a.y) * 0.08;
        cables
          .moveTo(a.x, a.y)
          .quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + sag, b.x, b.y)
          .stroke({ width, color, alpha: 0.9 });
      };
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const other = typeAt(nx, ny);
        if (other !== WIRE.none) {
          // K sousednímu vedení do půlky cesty — soused dokreslí zbytek.
          const mx = x + 0.5 + dx * 0.5;
          const my = y + 0.5 + dy * 0.5;
          const otherHeights = WIRE_HEIGHTS[other] ?? heights;
          heights.forEach((h, i) => {
            const mid = (h + (otherHeights[i] ?? otherHeights[0] ?? h)) / 2;
            drawSpan(x + 0.5, y + 0.5, base + h, mx, my, ground(mx, my) + mid);
          });
        } else if (parcelAt(nx, ny)) {
          // Přípojka do bloku: drát k domu nebo do zóny za sousední hranou.
          const px = x + 0.5 + dx * 0.9;
          const py = y + 0.5 + dy * 0.9;
          drawSpan(x + 0.5, y + 0.5, base + heights[0]!, px, py, ground(px, py) + 0.9);
        }
      }
      node.addChild(cables);

      // Sloup jen na volné dlaždici — ne uprostřed silnice ani v domě.
      // A ne na každé: na rovném úseku stojí vysoké napětí na každé třetí,
      // nízké na každé druhé dlaždici; na konci, v zatáčce a na odbočce vždy.
      const free = (road[tile] ?? ROAD.none) === ROAD.none && (ids[tile] ?? 0) === 0;
      const straight = (vertical && !horizontal) || (horizontal && !vertical);
      const through =
        straight &&
        ((vertical && typeAt(x, y - 1) !== WIRE.none && typeAt(x, y + 1) !== WIRE.none) ||
          (horizontal && typeAt(x - 1, y) !== WIRE.none && typeAt(x + 1, y) !== WIRE.none));
      const step = type === WIRE.high ? 3 : 2;
      const spaced = !through || (vertical ? y : x) % step === 0;
      const part = type === WIRE.high ? this.pylon : this.lowPole;
      if (free && spaced && part) {
        const pole = new Sprite(part.texture);
        pole.anchor.set(part.anchor[0] / part.texture.width, part.anchor[1] / part.texture.height);
        // Ramena stožáru jsou na obrázku podél osy x, tedy napříč vedení
        // podél osy y. Vedení podél osy x potřebuje stožár zrcadlově.
        const flip = type === WIRE.high && horizontal && !vertical ? -1 : 1;
        pole.scale.set(flip / PART_SCALE, 1 / PART_SCALE);
        const at = gridToScreen(x + 0.5, y + 0.5, base);
        pole.position.set(at.x, at.y);
        // Sloup pod dráty — dráty začínají u jeho vrcholu.
        node.addChildAt(pole, 0);
      }

      const id = floor - tile - 1;
      this.container.addChild(node);
      this.views.set(id, node as unknown as Sprite);
      this.boxes.set(id, { x, y, width: 1, depth: 1, base });
    }
  }

  /** Nastaví obrázek lampy (T122) a rozestaví lampy znovu. */
  setLamp(lamp: LoadedPart | undefined): void {
    this.lamp = lamp;
    this.rebuildLamps();
    this.reorder();
  }

  /**
   * Pouliční lampy na zeleném pásu mezi obrubníkem a chodníkem (T122).
   *
   * Stojí jen tam, kde je chodník, tedy u domů úrovně 2 a víc, a jen na každé
   * druhé dlaždici — lampa na každé by z ulice udělala plot. Rameno míří
   * nad vozovku, proto se obrázek na dvou stranách zrcadlí.
   *
   * Id jsou záporná a posunutá o dvě velikosti mapy, za stromy i suť.
   */
  private rebuildLamps(): void {
    const size = this.world.size;
    const offset = 2 * size * size;
    for (const id of [...this.views.keys()]) {
      // Jen pásmo lamp — za ním bydlí vedení (T129).
      if (id <= -offset && id > -6 * size * size) this.remove(id);
    }
    this.lampsStale = false;
    this.lampsBuilt = performance.now();
    const lamp = this.lamp;
    if (lamp === undefined || !this.decorVisible) return;

    const road = this.world.layers.road;
    // Na kraji pásu u obrubníku, ať chodec na chodníku lampou neprochází.
    const place = SIDEWALK + VERGE;
    // Strana → poloha na dlaždici a zda zrcadlit (obrázek má rameno vlevo).
    const spots: [number, number, number, boolean][] = [
      [ROAD_N, 0.5, place, false],
      [ROAD_S, 0.5, 1 - place, true],
      [ROAD_W, place, 0.5, true],
      [ROAD_E, 1 - place, 0.5, false],
    ];
    for (let tile = 0; tile < road.length; tile++) {
      const type = road[tile] ?? ROAD.none;
      if (type === ROAD.none || type === ROAD.highway) continue;
      const x = tile % size;
      const y = (tile - x) / size;
      if ((x + y) % 2 !== 0) continue;
      const sides = houseSides(this.world, x, y);
      if (sides === 0) continue;
      const arms = roadArms(road, size, x, y);
      for (const [side, u, v, flip] of spots) {
        if (!(sides & side) || arms & side) continue;
        const gx = x + u;
        const gy = y + v;
        const base = groundHeightAt(this.world.cornerHeight, gx, gy);
        const at = gridToScreen(gx, gy, base);
        const sprite = new Sprite(lamp.texture);
        sprite.anchor.set(lamp.anchor[0] / lamp.texture.width, lamp.anchor[1] / lamp.texture.height);
        sprite.scale.set((flip ? -1 : 1) / PART_SCALE, 1 / PART_SCALE);
        sprite.position.set(at.x, at.y);
        const id = -(offset + tile * 4 + ARM_INDEX[side]! + 1);
        this.container.addChild(sprite);
        this.views.set(id, sprite);
        this.boxes.set(id, { x, y, width: 1, depth: 1, base });
        break;
      }
    }
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
  setRubblePiles(piles: ReadonlyMap<RubbleSlope, readonly TerrainDecor[]>): void {
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
    // Jen pásmo stromů a balvanů (`-(dlaždice + 1)`). Suť a lampy mají id
    // dál a staví si je vlastní metody.
    const decorFloor = -this.world.size * this.world.size;
    for (const id of [...this.views.keys()]) {
      if (id < 0 && id >= decorFloor) this.remove(id);
    }
    this.trees = [];
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
        // Houpe se les, ne skála (T119).
        const placed = this.views.get(-(tile + 1));
        if ((terrainLayer[tile] ?? 0) === TERRAIN.forest && placed instanceof Sprite) {
          this.trees.push({ sprite: placed, phase: (decorPick(x, y) % 628) / 100 });
        }
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
      if (id <= -offset && id > -2 * offset) this.remove(id);
    }
    if (this.rubblePiles.size === 0) return;

    const rubble = this.world.rubble;
    // Lampy mají id za sutí; `id <= -offset` výš by je smazalo taky, a proto
    // se maže jen pás suti.
    for (let tile = 0; tile < rubble.length; tile++) {
      if ((rubble[tile] ?? 0) === 0) continue;
      const x = tile % size;
      const y = (tile - x) / size;

      /*
       * Podle sklonu dlaždice se vybere sada, teprve v ní varianta.
       *
       * Hromada kreslená do svahu má spodní hranu nakloněnou, takže sedne na
       * výšku přesně pod svou patou jako strom. Rovná hromada takovou hranu
       * nemá a musí na nejnižší roh, jinak jí polovina visí — o tom je celý
       * `onGround`.
       */
      const slope = rubbleSlope(this.world.cornerHeight, x, y);
      const set = this.rubblePiles.get(slope) ?? this.rubblePiles.get('flat') ?? [];
      if (set.length === 0) continue;
      // Varianta ze souřadnic, ne z `world.rng`: musí vyjít stejně při každém
      // překreslení i po načtení savu, jinak by se suť při každém pohledu
      // přeskládala.
      const pile = set[decorPick(x, y) % set.length];
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
     * Vyplňuje předmět celou dlaždici, nebo se jí dotýká jen v jednom bodě?
     *
     * Strom se země dotýká **kmenem**, tedy bodem uprostřed dlaždice — a tam
     * taky patří jeho kotva. Hromada suti stojí na **celém kosočtverci** a její
     * nejnižší bod je jižní roh dlaždice, přesně jako u budov. Kotvit ji
     * doprostřed znamenalo posadit ji o půl dlaždice moc vysoko: hromada pak
     * seděla nad severní půlkou dlaždice a přečuhovala nahoru. Autor to hlásil
     * dvakrát — „zbořeniny v kopcích jsou úplně mimo" a „suť je pořád nad
     * kopcem, ne na stráni" — a obojí bylo tímhle, ne sklonem terénu.
     */
    fillsTile = false,
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
    // Bodový předmět stojí uprostřed dlaždice, plošný na jejím jižním rohu.
    // Posun se přidává oběma — dvě sousední hromady nemají stát v zákrytu.
    const fx = (fillsTile ? x + 1 : x + 0.5) + shiftX;
    const fy = (fillsTile ? y + 1 : y + 0.5) + shiftY;
    /*
     * Výška se bere tam, kde předmět **stojí**: u stromu přesně pod patou,
     * u haldy v jižním rohu dlaždice, tedy v jejím nejnižším viditelném bodě.
     * Ptát se na výšku i s posunem by u haldy znamenalo brát ji z cizí
     * dlaždice, přes kterou halda jen přečuhuje.
     */
    const pad = fillsTile
      ? groundHeightAt(this.world.cornerHeight, x + 1, y + 1)
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
    this.depthCache.clear();
    const order = depthOrder(this.boxes);
    for (let i = 0; i < order.length; i++) {
      const id = order[i]!;
      const view = this.views.get(id);
      if (view) view.zIndex = i * 2 + 1;
      // Rotor hned za svou budovou: před její věží, za domem, který stojí
      // blíž k divákovi.
      for (const spinner of this.spinners.get(id) ?? []) spinner.node.zIndex = i * 2 + 1.5;
      const skirt = this.skirts.get(id);
      if (skirt) skirt.zIndex = i * 2;
    }
  }

  private refreshAll(dirty: DirtySet): void {
    if (dirty.fullRedraw) {
      // Jen budovy (kladná id). Stromy a suť si přestaví `rebuildDecor`
      // a `rebuildRubble` — při načtení savu je `update()` volá hned potom.
      // Mazat je tady znamenalo, že je přepnutí materiálu podezdívek
      // (`setSkirtTextures`) smazalo a už nikdo nepostavil.
      for (const id of [...this.views.keys()]) {
        if (id > 0) this.remove(id);
      }
      // Načtení savu ani přepnutí materiálů není stavba: nic nevyrůstá,
      // jen se zapamatuje, co na mapě stojí.
      this.known.clear();
      this.growing.clear();
      for (const id of this.world.buildings.keys()) {
        this.refresh(id, false);
      }
      return;
    }

    for (const id of dirty.buildings) {
      this.refresh(id, true);
    }
  }

  private refresh(id: number, animate: boolean): void {
    const building = this.world.buildings.get(id);
    if (!building) {
      // Zmizela budova, kterou jsme kreslili — zbourala se, vyhořela, nebo
      // ustoupila větší. Prach dostane půdorys, dokud ho ještě známe.
      const box = this.boxes.get(id);
      if (animate && this.known.has(id) && box) this.onVanished?.(box);
      this.known.delete(id);
      this.growing.delete(id);
      this.baseScale.delete(id);
      this.remove(id);
      return;
    }

    // Nová, nebo povýšená? Zchátrání se nepočítá: ruina nevyrůstá, padá.
    const identity = `${building.definitionId}#${building.level}`;
    const previous = this.known.get(id);
    this.known.set(id, identity);
    if (animate && this.motion && previous !== identity && !building.abandoned) {
      this.growing.set(id, 0);
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

    /*
     * Kreslí se na dlaždice, které budova **doopravdy drží**, ne na ty, které
     * jí přisuzuje dnešní definice. Půdorys je obsah a ten se mění: uhelná
     * elektrárna povyrostla ze 4 × 4 na 5 × 5 a budovy postavené předtím
     * zůstaly na čtyřech dlaždicích. Obrázek pro pět dlaždic pak přetekl
     * o půl dlaždice na každou stranu a lezl do sousedů — autor to hlásil
     * slovy „tady jsou úplně ujeté budovy, úplně mimo". Ve stejné situaci
     * skončí každý mod, který sáhne na půdorys už postavené budovy.
     */
    const [width, depth] = placedFootprint(this.world, building, appearance.footprint);
    // Zmenšení obrázku na parcelu, na které budova stojí. Zúžit ho nejde —
    // roztažením jedné strany by se rozešla izometrie — takže se zmenší celý
    // podle té strany, které chybí víc.
    const shrunk = Math.min(
      width / appearance.footprint[0],
      depth / appearance.footprint[1],
    );

    if (appearance.sprite) {
      // Zpustlá budova má **jeden obrázek na dvě dlaždice na dvě** a nosí ho
      // každý půdorys. Na jinou parcelu se proto celý zmenší, ne zúží:
      // roztažením by se rozešla izometrie.
      //
      // Měřítko se řídí **kratší stranou**, ne obvodem. Podle obvodu vycházelo
      // u podlouhlé parcely (2 × 1) měřítko 0,75, jenže obrázek je čtvercový —
      // po delší straně se vešel a po kratší přetekl do ulice. Autor to hlásil
      // dvakrát: „tyhle zborceniny jdou dost mimo pozice, vytékají z parcel."
      // Podle kratší strany se ruina vejde vždycky; na podlouhlé parcele je
      // menší, což je pořád lepší než hromada suti přes chodník.
      const fit = building.abandoned
        ? Math.min(1, Math.min(width, depth) / DERELICT_TILES)
        : shrunk;
      this.drawSprite(id, building.x, building.y, width, depth, appearance.sprite, fit);
      const running = !building.abandoned && (appearance.consumesPower !== true || building.powered);
      this.placeEffects(id, appearance.sprite, fit, running);
      this.resumeGrowth(id);
      return;
    }
    this.clearEffects(id);

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
    this.resumeGrowth(id);
  }

  /**
   * Překreslení uprostřed vyrůstání nastaví plné měřítko — třeba když nová
   * budova hned v dalším tiku dostane proud. Tohle ho vrátí tam, kde animace
   * právě je, jinak by dům v půlce skočil do plné velikosti.
   */
  private resumeGrowth(id: number): void {
    const elapsed = this.growing.get(id);
    if (elapsed !== undefined) this.applyGrowth(id, elapsed / POP_MS);
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
    this.baseScale.set(id, fit / image.scale);

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

  /**
   * Postaví efekty budovy podle jejího obrázku (T116).
   *
   * Staví se znovu při každém překreslení. Děje se to jen při změně budovy,
   * ne každý snímek, a přestavět pár uzlů je jednodušší než hlídat, co se
   * na nich změnilo. Natočení rotoru se přenese, ať se při dodání proudu
   * lopatky necuknou.
   */
  private placeEffects(
    id: number,
    image: NonNullable<BuildingAppearance['sprite']>,
    fit: number,
    running: boolean,
  ): void {
    const previous = this.spinners.get(id)?.map((spinner) => spinner.blade.rotation) ?? [];
    this.clearEffects(id);
    const sprite = this.views.get(id);
    if (!(sprite instanceof Sprite) || image.effects === undefined) return;

    const scale = fit / image.scale;
    const spinners: Spinner[] = [];
    const chimneys: SmokeSource[] = [];
    const seats: { x: number; y: number }[] = [];
    for (const effect of image.effects) {
      if (effect.when === 'powered' && !running) continue;
      const x = sprite.position.x + (effect.at[0] - image.anchor[0]) * scale;
      const y = sprite.position.y + (effect.at[1] - image.anchor[1]) * scale;

      if (effect.type === 'vanilla:spin') {
        const part = effect.part === undefined ? undefined : this.parts.get(effect.part);
        if (part === undefined || effect.axes === undefined || part.radius === undefined) continue;
        const [ax, ay] = effect.axes;
        const node = new Container();
        node.setFromMatrix(
          new Matrix(ax[0] * scale, ax[1] * scale, ay[0] * scale, ay[1] * scale, x, y),
        );
        const blade = new Sprite(part.texture);
        blade.anchor.set(
          part.anchor[0] / part.texture.width,
          part.anchor[1] / part.texture.height,
        );
        blade.scale.set(1 / part.radius);
        // Každý větrník jinak natočený a trochu jinak rychlý, jinak by se
        // celá farma točila v jednom rytmu jako hodinky.
        const spread = ((id * 0.618034) % 1 + 1) % 1;
        blade.rotation = previous[spinners.length] ?? spread * Math.PI * 2;
        node.addChild(blade);
        node.visible = !this.growing.has(id);
        this.container.addChild(node);
        spinners.push({
          node,
          blade,
          rate: (effect.rate ?? SPIN_RATE) * (0.85 + spread * 0.3),
        });
      } else if (effect.type === 'vanilla:seat') {
        // Na lavičku se dá sednout i bez proudu — jen ne u ruiny.
        if (this.world.buildings.get(id)?.abandoned !== true) seats.push({ x, y });
      } else if (effect.type === 'vanilla:smoke') {
        if (!running) continue;
        chimneys.push({
          x,
          y,
          rate: effect.rate ?? 1,
          color: effect.color === undefined ? 0x8a8a8a : Number.parseInt(effect.color.slice(1), 16),
          key: id * 16 + chimneys.length,
        });
      }
    }
    if (spinners.length > 0) this.spinners.set(id, spinners);
    if (chimneys.length > 0) this.chimneys.set(id, chimneys);
    if (seats.length > 0) this.seats.set(id, seats);
  }

  private clearEffects(id: number): void {
    for (const spinner of this.spinners.get(id) ?? []) spinner.node.destroy({ children: true });
    this.spinners.delete(id);
    this.chimneys.delete(id);
    this.seats.delete(id);
  }

  private remove(id: number): void {
    this.clearEffects(id);
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
