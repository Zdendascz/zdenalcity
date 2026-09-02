import { Container, Graphics, Matrix } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { MAX_HEIGHT, tileCorners } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import {
  BRIDGE_COLOR,
  BRIDGE_RAIL_COLOR,
  FIRE_COLORS,
  FIRE_MAX_ALPHA,
  FIRE_MIN_ALPHA,
  FLOOD_COLOR,
  FLOOD_FULL_DEPTH,
  FLOOD_MAX_ALPHA,
  FLOOD_MIN_ALPHA,
  PIPE_COLOR,
  PIPE_DRY_COLOR,
  PIPE_WIDTH,
  POWER_OFF_COLOR,
  POWER_ON_COLOR,
  POWER_OVERLAY_ALPHA,
  ROAD_COLOR,
  ROAD_COLORS,
  RUBBLE_ALPHA,
  RUBBLE_COLOR,
  RUBBLE_MARK_ALPHA,
  RUBBLE_MARK_COLOR,
  ROAD_WIDTHS,
  shade,
  TERRAIN_COLORS,
  TERRAIN_VARIATION,
  TILE_EDGE_SHADE,
  UNDERGROUND_BUILDING_ALPHA,
  UNDERGROUND_BUILDING_COLOR,
  UNDERGROUND_ROAD_ALPHA,
  UNDERGROUND_ROAD_COLOR,
  UNDERGROUND_TERRAIN_SHADE,
  UNDERGROUND_ZONE_ALPHA,
  WATER_SUPPLY_ALPHA,
  WATER_SUPPLY_COLOR,
  ZONE_COLOR_BY_VALUE,
  ZONE_OVERLAY_ALPHA,
} from './palette';
import {
  gridToScreen,
  LEVEL_H,
  slopeLight,
  TILE_H,
  TILE_W,
  surfaceCorners,
  tileQuad,
  tileVariation,
} from './projection';
import { iconShape } from './icons';
import { isRubbleMarkOrigin } from '@/sim/disasters/rubble';
import { roadMask, roadPolygons } from './roads';

/**
 * Jména terénů pro klíč obrázku povrchu. Index je hodnota vrstvy `terrain`,
 * takže to musí sedět na `TERRAIN` v `sim/layers.ts` — na pořadí, ne na jméno
 * konstanty. Druh, který obrázek nemá, se kreslí barvou jako dřív.
 */
const TERRAIN_NAMES: readonly (string | undefined)[] = [
  'grass',
  'water',
  'sand',
  'rock',
  'forest',
  'marsh',
];

/**
 * Stojí na téhle dlaždici předmět, nebo je mezera?
 *
 * Bez mezer je z lesa **hradba**: pravidelná mřížka stejných korun, které se
 * navíc překrývají. Kolik jich zůstane, říká `decorDensity`.
 */
function decorHere(x: number, y: number, density: number): boolean {
  let h = Math.imul((x * 0x27d4eb2d) ^ (y * 0x165667b1), 0x9e3779b1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h % 1000) / 1000 < density;
}

/** Která varianta předmětu padne na dlaždici. Vlastní míchačka, ať se neváže
 * na mezery ani na posun — jinak by třeba všechny smrky stály vlevo. */
function decorPick(x: number, y: number): number {
  let h = Math.imul((x * 0x2545f491) ^ (y * 0x9e3779b1), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * O kolik se předmět posune od středu dlaždice, v dílech dlaždice.
 *
 * Ze stejného důvodu jako mezery: kdyby všechny stromy stály přesně na středu,
 * vyjde z toho mřížka. Drží se do třetiny dlaždice od středu, aby strom
 * nepřelezl k sousedovi.
 */
function decorShift(x: number, y: number): [number, number] {
  let h = Math.imul((x * 0x85ebca6b) ^ (y * 0xc2b2ae35), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return [((h & 15) / 15 - 0.5) / 1.5, (((h >>> 8) & 15) / 15 - 0.5) / 1.5];
}

/** Co padlo na dlaždici: obrázek a o kolik čtvrtin otočený. */
interface SurfacePick {
  texture: Texture;
  turn: number;
}

/**
 * Předmět, který stojí na terénu — strom nebo balvan.
 *
 * `anchor` je bod obrázku, který sedí na **předním rohu dlaždice**, v pixelech
 * obrázku. `scale` je nadvzorkování, kterým ho vyrobil `fit-sprites.py`.
 */
export interface TerrainDecor {
  texture: Texture;
  anchor: readonly [number, number];
  scale: number;
}

/**
 * Jak často předmět stojí, podle toho, jak je široký.
 *
 * Strom je široký dvě dlaždice, takže na dvou třetinách dlaždic se stromy
 * překrývají v hradbu. Hustota se proto odvozuje z jeho vlastní šířky:
 * jeden na tolik dlaždic, kolik jich zabere. Nad dvě třetiny se nejde —
 * z plné hustoty by byla souvislá plocha bez mezer.
 */
function decorDensity(decor: TerrainDecor): number {
  const tiles = Math.max(1, Math.round(decor.texture.width / (2 * 32 * decor.scale)));
  return Math.min(2 / 3, 1 / (tiles * tiles));
}

/** Chunk = 16×16 dlaždic. Změna jedné dlaždice invaliduje jeden chunk, ne mapu. */
export const CHUNK_SIZE = 16;

/**
 * Kolik chunků za okrajem obrazovky se ještě drží upečených.
 *
 * Nula by znamenala, že se chunk peče přesně v okamžiku, kdy do něj hráč
 * najede — a to je vidět jako záblesk prázdna. Jeden prstenec navíc stačí:
 * při běžném posunu se stihne upéct dřív, než se doroluje.
 */
export const CHUNK_MARGIN = 1;

/**
 * Kolik chunků z prstence se smí upéct v jednom snímku.
 *
 * Prstenec je zásoba dopředu, ne to, na co hráč kouká — nemá důvod vzniknout
 * naráz. Bez rozpočtu vyskočil při plynulém posouvání nad 512 × 512 p95 na
 * 19,5 ms, tedy nad rozpočet šedesáti snímků. Viditelné chunky rozpočtu
 * **nepodléhají**: odložit je znamená díru v mapě.
 */
export const RING_BUDGET = 2;

/**
 * Kolik milisekund smí v jednom snímku sežrat přepékání **zastaralých** chunků.
 *
 * Rozlišuje se prázdný chunk od zastaralého, a je v tom celý rozdíl. Prázdný je
 * díra v mapě a musí se upéct hned, ať to stojí co chce. Zastaralý drží obrázek
 * z minula — pořád je na co koukat, jen o chvíli starší.
 *
 * Naráz jich zastarají stovky jen při **přepnutí diagnostické vrstvy**, a to
 * při plném oddálení na 512 × 512 stálo 52 až 90 ms v jednom snímku, tedy
 * zahozený snímek. Naměřeno.
 *
 * Rozpočet je v **čase, ne v počtu**, a to je poučení z prvního pokusu: chunk
 * prázdného moře se upeče za setinu milisekundy, chunk plný ulic za dvě a půl.
 * Počet by tedy jednou znamenal dvě milisekundy a jindy dvě stě.
 *
 * Aspoň jeden chunk se upeče vždycky, i když ho rozpočet nepobere — jinak by
 * se na mapě s drahými chunky nepohnulo nikdy nic.
 *
 * **Dvě milisekundy, ne čtyři**, a to je druhé poučení z měření: rozpočet měří
 * jen pečení, jenže přepečený chunk se pak musí nahrát na GPU, a to stojí
 * zhruba dvakrát tolik. Se čtyřmi vycházel snímek na 13 až 17 ms — v rozpočtu,
 * ale bez rezervy.
 *
 * Přeteče se vždycky o jeden chunk: hodiny se čtou **před** pečením, ne během.
 * Naměřeno na 512 × 512 při plném oddálení — tři až šest chunků za snímek,
 * `cull` mezi 3 a 9 ms. Bez rozpočtu na tomtéž místě 207 ms v jediném snímku.
 */
export const STALE_BUDGET_MS = 2;

/**
 * Hodiny pro rozpočet. Vlastní funkce proto, že `performance` v čistém Node
 * testu nemusí existovat — a renderer kvůli měření času spadnout nesmí.
 */
function now(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

/** Obdélník v projekčních souřadnicích. */
export interface Viewport {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Který diagnostický pohled je zapnutý. Vždycky nejvýš jeden — dva překryvy
 * přes sebe by se nedaly přečíst. Skutečný přepínač s ikonami je T21.
 */
export type OverlayMode = 'none' | 'power' | 'underground';

interface Chunk {
  readonly x0: number;
  readonly y0: number;
  readonly graphics: Graphics;
  /**
   * Meze chunku v projekčních souřadnicích. Počítají se jednou v konstruktoru
   * — terén se sice hýbe, ale jen v rámci `MAX_HEIGHT`, se kterým se tady
   * počítá rovnou.
   */
  readonly bounds: Viewport;
  /** Má chunk nakreslenou geometrii? Uvolněný chunk je prázdný `Graphics`. */
  baked: boolean;
  /** Změnilo se v něm něco od posledního upečení? */
  stale: boolean;
}

/**
 * Terén po chuncích 16×16. Chunk se překresluje jen tehdy, když se ho dotkne
 * `DirtySet` — renderer nikdy nepřekresluje celou mapu.
 *
 * Chunk je **retained `Graphics`**, ne `RenderTexture`. Architektura §6
 * předepisuje `RenderTexture`, jenže izometrické diamanty se zaklesávají, takže
 * opsaný obdélník chunku měl 1024×512 px a 64 chunků zabralo 128 MB VRAM —
 * a polovina každé textury byla průhledná. `Graphics` se do GPU nahraje jednou
 * a mezi překreslením se jen vykresluje, takže výkonový důvod chunkování
 * (nepřepočítávat 16 384 dlaždic každý snímek) platí dál za zlomek paměti.
 */
/**
 * Jméno střešního symbolu pro definici budovy. Renderer terénu obsah nezná
 * a znát nemá — dostane jen tuhle jednu funkci.
 */
export type RoofIconLookup = (definitionId: string) => string | undefined;

/** Jak velký je symbol na troskách vůči dlaždici. */
const MARK_SCALE = 0.42;

export class ChunkRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly roofIcon: RoofIconLookup | undefined;
  private readonly chunksPerAxis: number;
  private readonly chunks: Chunk[] = [];
  private readonly container: Container;
  private overlay: OverlayMode = 'none';
  /**
   * Chunky upečené právě teď. Sleduje se to kvůli měření — bez čísla by
   * nešlo poznat, jestli uvolňování vůbec funguje.
   */
  private bakedCount = 0;
  /**
   * Kolik pečení proběhlo celkem. Monotónní — na rozdíl od `bakedCount` se
   * nesnižuje. Bez toho nejde poznat rozdíl mezi „nepřekreslilo se to" a
   * „překreslilo se to a vyšlo to stejně".
   */
  private bakes = 0;

  /**
   * Obrázky povrchu. Klíč `<druh>|<varianta>`; chybí-li, kreslí se barva.
   *
   * Dodává je volající už načtené, protože pečení chunku je synchronní a na
   * dotažení textury nemá kde počkat. Než dorazí, kreslí se barva — a to je
   * i trvalý stav, když obsah obrázky nemá (P5, „chybějící obrázek hru
   * nezastaví").
   */
  /**
   * Obrázky povrchu po druzích terénu.
   *
   * Všechny **sdílejí jeden zdroj** — jsou to výřezy z atlasu, který se skládá
   * při načtení. Chunk je jeden `Graphics` a jeho výplně jdou na kartu jednou
   * dávkou; do té se vejde jen omezený počet různých textur a zbytek karta
   * zahodí. S osmnácti samostatnými obrázky se to projevilo jako fialové skvrny
   * ve vodě, se šesti zmizely. Atlas ten strop obchází.
   */
  private surfacesByTerrain = new Map<number, Texture[]>();
  /**
   * Stromy a balvany podle druhu terénu.
   *
   * Kreslí se **do chunku jako texturovaný obdélník**, ne jako Pixi sprite.
   * Sprite by musel do řazení hloubky vedle budov, a les o dvou tisících
   * dlaždicích by tam přidal dva tisíce uzlů. Takhle se upeče spolu s terénem
   * a nestojí nic navíc.
   *
   * Cena: chunk se kreslí **pod** budovami, takže strom na dlaždici před domem
   * zůstane za ním. Nikdy naopak — na lese se nestaví, dokud se nevykácí —
   * takže se to potká jen na hranici lesa a zástavby.
   */
  private decorByTerrain = new Map<number, TerrainDecor[]>();

  constructor(world: ReadonlyWorldView, parent: Container, roofIcon?: RoofIconLookup) {
    this.world = world;
    this.roofIcon = roofIcon;
    this.chunksPerAxis = Math.ceil(world.size / CHUNK_SIZE);

    // Chunky se musí kreslit zezadu dopředu, tedy podle `cx + cy`. Na ploché
    // mapě to bylo jedno — diamanty do sebe zapadají bez přesahu a pořadí
    // vzniku (po řádcích) nikoho netrápilo. S převýšením ale kopec přesahuje
    // do sousedního chunku, a ten se pak kreslí přes něj.
    //
    // Řadí se **vlastní kontejner terénu**, ne ten světový. Když se zapnulo
    // `sortableChildren` na světovém, propadly pod terén všechny uzly, které
    // zIndex nemají — rámeček pod kurzorem a s ním i obrys půdorysu. Hráč
    // nahlásil, že „diamanty se nezobrazují"; tohle byla ta příčina.
    this.container = new Container();
    this.container.sortableChildren = true;
    parent.addChild(this.container);

    for (let cy = 0; cy < this.chunksPerAxis; cy++) {
      for (let cx = 0; cx < this.chunksPerAxis; cx++) {
        const graphics = new Graphics();
        graphics.zIndex = cx + cy;
        this.container.addChild(graphics);
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        this.chunks.push({
          x0,
          y0,
          graphics,
          bounds: chunkBounds(x0, y0),
          // Čerstvý chunk je prázdný a čeká, jestli na něj bude vidět.
          baked: false,
          stale: true,
        });
      }
    }
  }

  /**
   * Přepne overlay. Zneplatní všechny chunky; upečou se ty, na které je vidět.
   */
  setOverlay(mode: OverlayMode): void {
    if (this.overlay === mode) return;
    this.overlay = mode;
    this.invalidateAll();
  }

  getOverlay(): OverlayMode {
    return this.overlay;
  }

  /** Kolik chunků je právě upečených. Slouží měření a testům. */
  getBakedCount(): number {
    return this.bakedCount;
  }

  getChunkCount(): number {
    return this.chunks.length;
  }

  /** Kolik chunků se od začátku upeklo. Slouží měření a testům. */
  getBakeCount(): number {
    return this.bakes;
  }

  private invalidateAll(): void {
    for (const chunk of this.chunks) chunk.stale = true;
  }

  /**
   * Upeče, co je vidět, a uvolní, co vidět není (R20 fáze 4).
   *
   * Do T44 se pekly všechny chunky naráz. Na mapě 128 × 128 jich bylo 64 a
   * nikoho to netrápilo; u 512 × 512 je jich 1024, první snímek trval 1,6 s
   * a halda vyskočila na 573 MB. Naměřeno, ne odhadnuto.
   *
   * Uvolněný chunk si drží svůj `Graphics` — zahodí se jen geometrie. Uzel
   * samotný je pár desítek bajtů a jeho opětovné zakládání by rozbilo pořadí
   * kreslení, které stojí na `zIndex`.
   */
  cull(view: Viewport, staleBudgetMs: number = STALE_BUDGET_MS): void {
    const ring = expand(view, CHUNK_MARGIN);
    let budget = RING_BUDGET;
    const deadline = now() + staleBudgetMs;
    let staleDone = 0;

    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      if (!chunk) continue;

      const needsWork = !chunk.baked || chunk.stale;

      if (overlaps(chunk.bounds, view)) {
        if (!chunk.baked) {
          // Prázdný chunk je **díra v mapě**. Peče se bez ohledu na rozpočet.
          this.redraw(i);
        } else if (chunk.stale && (staleDone === 0 || now() < deadline)) {
          // Zastaralý drží obrázek z minula, takže smí počkat na příští snímek.
          this.redraw(i);
          staleDone++;
        }
      } else if (overlaps(chunk.bounds, ring)) {
        // Zásoba za okrajem. Klidně počká na příští snímek.
        if (needsWork && budget > 0) {
          this.redraw(i);
          budget--;
        }
      } else if (chunk.baked) {
        chunk.graphics.clear();
        chunk.baked = false;
        this.bakedCount--;
      }
    }
  }

  /** Index chunku, do kterého spadá dlaždice. */
  private chunkIndexFor(x: number, y: number): number {
    return Math.floor(y / CHUNK_SIZE) * this.chunksPerAxis + Math.floor(x / CHUNK_SIZE);
  }

  /**
   * Zaznamená, co se změnilo. **Nekreslí** — jen značí.
   *
   * Kreslí se až v `cull()`, a to jen to, na co je vidět. Změna v chunku za
   * okrajem obrazovky se tím neztratí: chunk zůstane označený a upeče se,
   * jakmile na něj hráč najede.
   */
  update(dirty: DirtySet): void {
    if (dirty.fullRedraw) {
      this.invalidateAll();
      return;
    }

    for (const tileIndex of dirty.tiles) {
      const x = tileIndex % this.world.size;
      const y = (tileIndex - x) / this.world.size;
      const chunk = this.chunks[this.chunkIndexFor(x, y)];
      if (chunk) chunk.stale = true;
    }
  }

  private redraw(chunkIndex: number): void {
    const chunk = this.chunks[chunkIndex];
    if (!chunk) return;

    const { x0, y0, graphics } = chunk;
    graphics.clear();
    if (!chunk.baked) this.bakedCount++;
    this.bakes++;
    chunk.baked = true;
    chunk.stale = false;

    const last = CHUNK_SIZE - 1;
    // Kreslení vzestupně podle x + y (back-to-front). Na ploché mapě na pořadí
    // nezáleží, s převýšením a budovami ano — pravidlo platí od začátku.
    for (let sum = 0; sum <= last * 2; sum++) {
      for (let dy = Math.max(0, sum - last); dy <= Math.min(last, sum); dy++) {
        this.drawTile(graphics, x0 + sum - dy, y0 + dy);
      }
    }
  }

  /** Nastaví obrázky povrchu a překreslí, co je vidět. */
  setSurfaces(surfaces: ReadonlyMap<string, Texture>): void {
    // Losuje se **z toho, co přišlo**, ne z pevné trojice a/b/c. Kdyby některý
    // druh terénu variantu neměl a sahalo se po ní, zůstala by část dlaždic bez
    // obrázku a mapa by vyšla flekatá.
    this.surfacesByTerrain = new Map();
    for (let terrain = 0; terrain < TERRAIN_NAMES.length; terrain++) {
      const name = TERRAIN_NAMES[terrain];
      if (name === undefined) continue;
      const found = [...surfaces.entries()]
        .filter(([key]) => key.startsWith(`${name}|`))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, texture]) => texture);
      if (found.length > 0) this.surfacesByTerrain.set(terrain, found);
    }

    this.invalidateAll();
  }

  /** Nastaví stromy a balvany a překreslí, co je vidět. */
  setDecor(decor: ReadonlyMap<string, TerrainDecor[]>): void {
    this.decorByTerrain = new Map();
    for (let terrain = 0; terrain < TERRAIN_NAMES.length; terrain++) {
      const name = TERRAIN_NAMES[terrain];
      if (name === undefined) continue;
      const found = decor.get(name);
      if (found !== undefined && found.length > 0) this.decorByTerrain.set(terrain, found);
    }
    this.invalidateAll();
  }

  /**
   * Který obrázek padne na tuhle dlaždici.
   *
   * Losuje se ze **souřadnic**, ne z `world.rng`: musí to vyjít stejně při
   * každém překreslení i po načtení savu, a rng se mezitím posune. Stejná
   * míchačka jako u variant budov, jen krmená jinak.
   */
  private surfaceFor(terrain: number, x: number, y: number): SurfacePick | undefined {
    const found = this.surfacesByTerrain.get(terrain);
    if (found === undefined) return undefined;

    // Jedno zamíchání, dvě odpovědi: která varianta a jak otočená. Otočení je
    // to podstatné — bez něj mají všechny dlaždice kresbu ve stejném směru,
    // navážou na sebe přes hranice a udělají pruh přes celou obrazovku. Přesně
    // tak dopadl první pokus: „tráva jako manšestr".
    let h = Math.imul((x * 0x1f1f1f1f) ^ y, 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;

    const texture = found[h % found.length];
    if (texture === undefined) return undefined;
    return { texture, turn: (h >>> 8) & 3 };
  }

  private drawTile(graphics: Graphics, x: number, y: number): void {
    if (x >= this.world.size || y >= this.world.size) return;

    const tileIndex = index(x, y, this.world.size);
    const terrain = this.world.layers.terrain[tileIndex] ?? 0;
    const corners = tileCorners(this.world.cornerHeight, x, y);
    const underground = this.overlay === 'underground';
    const flat = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS[0];
    // Sklon se promítne do jasu, jinak by svah vypadal jako rovina (§7).
    // V podzemním pohledu se terén ztlumí, ať nepřekřičí potrubí (§8).
    // Sklon i variace jdou do jednoho násobku, aby se barva počítala jednou.
    const variation = tileVariation(x, y, TERRAIN_VARIATION[terrain] ?? 0);
    const lit = shade(flat, slopeLight(corners) * variation);
    const color = underground ? shade(lit, UNDERGROUND_TERRAIN_SHADE) : lit;

    // Vše ostatní na dlaždici — vozovka i překryvy — se kreslí do téhle plochy,
    // ne do pravidelného diamantu. Na svahu by se od terénu odlepilo.
    const points = tileQuad(x, y, corners);

    // Obrázek povrchu, když ho obsah dodal. Kreslí se **jako výplň polygonu**
    // s maticí, ne přes mesh: dlaždice se peče do jednoho `Graphics` na chunk
    // a mesh by tuhle úsporu zahodil. Matice mapuje čtverec textury na tři rohy
    // dlaždice, takže na rovině sedí přesně a na svahu je to afinní přiblížení —
    // u trávy a skály to oko nepozná, protože v obrázku není žádná přímka.
    //
    // Barva zůstává jako **tón**: bez ní by ze svahu zmizel stín a kopec by
    // vypadal jako rovina.
    // **Barva se kreslí vždycky, i pod obrázek.** Texturová výplň nechává na
    // některých dlaždicích průhledná místa — projevilo se to jako černé klíny
    // u pobřeží a autor to nahlásil. Barva pod ní je zároveň to, co tam patří:
    // když obrázek chybí nebo se nedokreslí, zůstane terén, ne díra.
    graphics.poly(points).fill({ color });

    const surface = this.surfaceFor(terrain, x, y);
    if (surface !== undefined) {
      const size = surface.texture.width || 1;
      // Otočení se dělá **výběrem rohů**, ne otáčením obrázku: který roh je
      // počátek a kterými dvěma vedou osy, to o čtvrtinu otočí celou kresbu
      // zadarmo. Rohy chodí po směru hodin, takže `turn` je počet čtvrtin.
      const quad = surfaceCorners(x, y, corners);
      const origin = quad[surface.turn]!;
      const alongU = quad[(surface.turn + 1) & 3]!;
      const alongV = quad[(surface.turn + 3) & 3]!;
      // Matice vede **z textury do plochy**: obrázek 256 px na dlaždici širokou
      // 64. Obracet ji nemá, a dělal jsem to — kresba pak byla osmkrát zvětšená
      // a na trávě to nešlo poznat, protože zvětšený trávník je pořád trávník.
      // Prozradil to až písek, který vyšel rozmazaný, a strom, ze kterého zbyl
      // svislý proužek.
      const matrix = new Matrix(
        (alongU[0] - origin[0]) / size,
        (alongU[1] - origin[1]) / size,
        (alongV[0] - origin[0]) / size,
        (alongV[1] - origin[1]) / size,
        origin[0],
        origin[1],
      );
      // Tón je **bílá ztlumená sklonem**, ne barva terénu: obrázek už zelený je
      // a vynásobit ho zelenou znamená bahno. Zůstat musí jen světlo, jinak by
      // ze svahu zmizel stín a kopec by vypadal jako rovina.
      const light = shade(0xffffff, slopeLight(corners) * (underground ? UNDERGROUND_TERRAIN_SHADE : 1));
      graphics.poly(points).fill({ texture: surface.texture, matrix, color: light });
    } else {
      // Obrys jen u barevné dlaždice. Na obrázku by z něj byla světlá mřížka
      // přes celou mapu — tvar terénu tam čte samo světlo a kresba povrchu.
      graphics
        .poly(points)
        .stroke({ color: shade(color, TILE_EDGE_SHADE), width: 1, alignment: 0.5 });
    }

    const zone = this.world.layers.zone[tileIndex] ?? 0;
    const zoneColor = ZONE_COLOR_BY_VALUE[zone];
    if (zone !== 0 && zoneColor !== undefined) {
      // Pod zemí zůstává zóna vidět jen jako náznak: je to hlavní důvod, proč
      // se tam potrubí vede, takže úplně zmizet nesmí.
      graphics
        .poly(points)
        .fill({ color: zoneColor, alpha: underground ? UNDERGROUND_ZONE_ALPHA : ZONE_OVERLAY_ALPHA });
    }

    // Strom nebo balvan. Kreslí se **po** povrchu i po zóně, ale pořád uvnitř
    // téže dlaždice, takže ho bližší dlaždice v chunku správně překryje.
    //
    // V podzemí ne: tam se dívá pod zem a koruna stromu by clonila potrubí.
    const choices = underground ? undefined : this.decorByTerrain.get(terrain);
    const decor = choices === undefined ? undefined : choices[decorPick(x, y) % choices.length];
    if (decor !== undefined && decorHere(x, y, decorDensity(decor))) {
      const [nw, ne, sw, se] = corners;
      // Předmět stojí na **průměrné výšce** rohů, ne na jednom z nich: na svahu
      // by jinak visel v jednom rohu ve vzduchu, stejně jako to dělaly budovy.
      const pad = Math.round((nw + ne + sw + se) / 4);
      // **Střed dlaždice, ne přední roh.** Na předním rohu by strom stál na
      // hraně a půlkou přečuhoval do sousední dlaždice. Kolem středu se ještě
      // rozhodí, jinak je z lesa sad.
      const [shiftX, shiftY] = decorShift(x, y);
      const front = gridToScreen(x + 0.5 + shiftX, y + 0.5 + shiftY, pad);
      const width = decor.texture.width;
      const height = decor.texture.height;
      const left = front.x - decor.anchor[0] / decor.scale;
      const top = front.y - decor.anchor[1] / decor.scale;
      const box = [
        left,
        top,
        left + width / decor.scale,
        top,
        left + width / decor.scale,
        top + height / decor.scale,
        left,
        top + height / decor.scale,
      ];
      // Totéž co u povrchu: z textury do plochy. Obrázek je `scale`× větší,
      // než jak se kreslí, takže se zmenšuje.
      const matrix = new Matrix(1 / decor.scale, 0, 0, 1 / decor.scale, left, top);
      graphics.poly(box).fill({ texture: decor.texture, matrix });
    }

    if (underground) {
      this.drawUnderground(graphics, points, tileIndex, x, y);
      return;
    }

    const roadType = this.world.layers.road[tileIndex] ?? ROAD.none;
    // Vozovka na vodě je most. Kreslí se přes celou dlaždici a světleji, aby
    // šlo poznat, kde silnice opouští břeh (§7 fáze 3).
    const bridge = roadType !== ROAD.none && terrain === TERRAIN.water;
    if (bridge) {
      graphics.poly(points).fill({ color: BRIDGE_RAIL_COLOR });
    }
    if (roadType !== ROAD.none) {
      // Bitmask se počítá z „je tam jakákoli silnice" — všechny typy se
      // navzájem napojují (§4). Šířku a barvu určuje typ vlastní dlaždice.
      const mask = roadMask((nx, ny) => this.isRoad(nx, ny), x, y);
      for (const polygon of roadPolygons(points, mask, ROAD_WIDTHS[roadType])) {
        graphics
          .poly(polygon)
          .fill({ color: bridge ? BRIDGE_COLOR : (ROAD_COLORS[roadType] ?? ROAD_COLOR) });
      }
    }

    // Elektřina je veličina po dlaždicích, takže patří do chunku. Vrstvy
    // na hrubé mřížce kreslí `CoarseOverlay` — ty do chunků nepatří.
    if (this.overlay === 'power') {
      this.drawPowerOverlay(graphics, points, tileIndex);
    }

    // Voda pod trosky i oheň: zaplavená suť je pořád suť pod vodou.
    const depth = this.world.floodDepth[tileIndex] ?? 0;
    if ((this.world.flood[tileIndex] ?? 0) > 0 && depth > 0) {
      const share = Math.min(1, depth / FLOOD_FULL_DEPTH);
      graphics.poly(points).fill({
        color: FLOOD_COLOR,
        alpha: FLOOD_MIN_ALPHA + (FLOOD_MAX_ALPHA - FLOOD_MIN_ALPHA) * share,
      });
    }

    // Trosky pod oheň: hořící suť má být vidět jako oheň, ne jako suť.
    if ((this.world.rubble[tileIndex] ?? 0) !== 0) {
      graphics.poly(points).fill({ color: RUBBLE_COLOR, alpha: RUBBLE_ALPHA });
      this.drawRubbleMark(graphics, points, tileIndex);
    }

    // Oheň úplně nahoru, přes silnici i překryvy. Není to diagnostická vrstva,
    // kterou si hráč zapíná — je to věc, na kterou musí reagovat hned.
    this.drawFire(graphics, points, tileIndex);
  }

  /**
   * Symbol toho, co na troskách stálo.
   *
   * Kreslí se jen na **levý horní roh** bloku, ne na každou dlaždici: nemocnice
   * po sobě nechá devět hromad a devět křížků by z toho udělalo mřížku. Roh se
   * pozná tím, že soused nahoře ani vlevo nenese totéž id — žádný extra stav
   * to nepotřebuje.
   *
   * Symbol je ten, který budova nosila na střeše, v barvě poplachu. Hráč tak
   * pozná, že tady byla nemocnice, aniž by na hromadu musel klikat.
   */
  private drawRubbleMark(graphics: Graphics, points: number[], tileIndex: number): void {
    const was = this.world.rubbleOf.get(tileIndex);
    if (was === undefined) return;
    if (!isRubbleMarkOrigin(this.world.rubbleOf, tileIndex, this.world.size)) return;

    const shape = iconShape(this.roofIcon?.(was));
    if (!shape) return;

    // Střed dlaždice ze čtyř jejích rohů — trosky leží na terénu, který se
    // může naklánět, a symbol se musí naklonit s ním.
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i += 2) {
      cx += points[i] ?? 0;
      cy += points[i + 1] ?? 0;
    }
    cx /= points.length / 2;
    cy /= points.length / 2;

    for (const polygon of shape) {
      const mark: number[] = [];
      for (const [u, v] of polygon) {
        const point = gridToScreen(u - 0.5, v - 0.5);
        mark.push(cx + point.x * MARK_SCALE, cy + point.y * MARK_SCALE);
      }
      graphics.poly(mark).fill({ color: RUBBLE_MARK_COLOR, alpha: RUBBLE_MARK_ALPHA });
    }
  }

  /**
   * Plamen na hořící dlaždici.
   *
   * Barva i průhlednost rostou s intenzitou, protože právě podle ní se pozná,
   * kde se rozhoduje: dlaždice s nízkou intenzitou hasiči uhasí, ta s vysokou
   * shoří. Kdyby všechen oheň vypadal stejně, hráč by nevěděl, kam poslat
   * buldozer dřív.
   */
  private drawFire(graphics: Graphics, points: number[], tileIndex: number): void {
    const intensity = this.world.fire[tileIndex] ?? 0;
    if (intensity === 0) return;

    const share = intensity / 255;
    const step = Math.min(FIRE_COLORS.length - 1, Math.floor(share * FIRE_COLORS.length));
    graphics.poly(points).fill({
      color: FIRE_COLORS[step] ?? FIRE_COLORS[0],
      alpha: FIRE_MIN_ALPHA + (FIRE_MAX_ALPHA - FIRE_MIN_ALPHA) * share,
    });
  }

  /**
   * Podzemní pohled: potrubí a pokrytí vodou (§8 fáze 3).
   *
   * Trubky se skládají ze stejné geometrie jako vozovka, jen užší — auto-tiling
   * tak vyjde zadarmo a napojení vypadá jako napojení, ne jako řada čtverečků.
   */
  private drawUnderground(
    graphics: Graphics,
    points: number[],
    tileIndex: number,
    x: number,
    y: number,
  ): void {
    // Půdorys domu: budovy se pod zemí nekreslí, ale hráč potřebuje vědět,
    // kam vodu vede. Bez toho tam byla jen tma.
    if (this.world.layers.buildingId[tileIndex] !== 0) {
      graphics
        .poly(points)
        .fill({ color: UNDERGROUND_BUILDING_COLOR, alpha: UNDERGROUND_BUILDING_ALPHA });
    }

    // Vozovka jako matný stín — podle ní se hráč na mapě orientuje.
    const roadType = this.world.layers.road[tileIndex] ?? ROAD.none;
    if (roadType !== ROAD.none) {
      const roadMaskBits = roadMask((nx, ny) => this.isRoad(nx, ny), x, y);
      for (const polygon of roadPolygons(points, roadMaskBits, ROAD_WIDTHS[roadType])) {
        graphics
          .poly(polygon)
          .fill({ color: UNDERGROUND_ROAD_COLOR, alpha: UNDERGROUND_ROAD_ALPHA });
      }
    }

    if (this.world.waterSupply[tileIndex] === 1) {
      graphics.poly(points).fill({ color: WATER_SUPPLY_COLOR, alpha: WATER_SUPPLY_ALPHA });
    }

    if (this.world.layers.pipe[tileIndex] !== 1) return;

    // Suchá trubka je šedá, zavodněná modrá. Bez toho vypadá síť, která nikam
    // nedosáhla, přesně jako ta funkční.
    const wet = this.world.waterSupply[tileIndex] === 1;
    const mask = roadMask((nx, ny) => this.isPipe(nx, ny), x, y);
    for (const polygon of roadPolygons(points, mask, PIPE_WIDTH)) {
      graphics.poly(polygon).fill({ color: wet ? PIPE_COLOR : PIPE_DRY_COLOR });
    }
  }

  /** Mimo mapu potrubí není — okraj se chová jako slepý konec, stejně jako u silnic. */
  private isPipe(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size)
      return false;
    return this.world.layers.pipe[index(x, y, this.world.size)] === 1;
  }

  /**
   * Barví se jen vodiče — silnice a budovy. Prázdná dlaždice proud vést nemůže,
   * takže by červená znamenala „chybí tu vedení", což by mátlo.
   */
  private drawPowerOverlay(graphics: Graphics, points: number[], tileIndex: number): void {
    const isConductor =
      (this.world.layers.road[tileIndex] ?? ROAD.none) !== ROAD.none ||
      this.world.layers.buildingId[tileIndex] !== 0;
    if (!isConductor) return;

    const color = this.world.layers.power[tileIndex] === 1 ? POWER_ON_COLOR : POWER_OFF_COLOR;
    graphics.poly(points).fill({ color, alpha: POWER_OVERLAY_ALPHA });
  }

  /** Mimo mapu silnice nikdy není — okraj mapy se tak chová jako slepý konec. */
  private isRoad(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size)
      return false;
    return (
      (this.world.layers.road[index(x, y, this.world.size)] ?? ROAD.none) !==
      ROAD.none
    );
  }

  destroy(): void {
    for (const chunk of this.chunks) {
      chunk.graphics.destroy();
    }
    this.chunks.length = 0;
    this.bakedCount = 0;
    this.container.destroy();
  }
}

/**
 * Obálka chunku v projekčních souřadnicích.
 *
 * Počítá se **s nejvyšším možným terénem**, ne se skutečným: kopec se dá
 * srovnat i vztyčit a přepočítávat obálky při každém hrábnutí do terénu by
 * bylo dražší než ten kus obrazovky navíc. Obálka je tím pádem konzervativní —
 * občas se upeče chunk, na který ve skutečnosti vidět není. To je ta správná
 * strana chyby: opačná by znamenala díru v mapě.
 */
function chunkBounds(x0: number, y0: number): Viewport {
  const n = CHUNK_SIZE;
  return {
    // x = (x − y) · TILE_W/2; nejmenší u jihozápadního rohu, největší u severovýchodního
    minX: (x0 - (y0 + n)) * (TILE_W / 2),
    maxX: (x0 + n - y0) * (TILE_W / 2),
    // y = (x + y) · TILE_H/2 − výška · LEVEL_H
    minY: (x0 + y0) * (TILE_H / 2) - MAX_HEIGHT * LEVEL_H,
    maxY: (x0 + n + y0 + n) * (TILE_H / 2),
  };
}

function overlaps(a: Viewport, b: Viewport): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Obdélník obrazovky v projekčních souřadnicích.
 *
 * Vrací **přesně to, co je vidět** — o prstenec navíc se stará `cull()` sám.
 * Volitelný `margin` je pro testy a měření; okraj je v chuncích, ne v pixelech,
 * protože „jeden chunk za hranou" znamená totéž při každém přiblížení, kdežto
 * „sto pixelů" ne.
 */
export function viewportFor(
  centerX: number,
  centerY: number,
  zoom: number,
  viewWidth: number,
  viewHeight: number,
  margin = 0,
): Viewport {
  const halfW = viewWidth / 2 / zoom;
  const halfH = viewHeight / 2 / zoom;

  return expand(
    {
      minX: centerX - halfW,
      maxX: centerX + halfW,
      minY: centerY - halfH,
      maxY: centerY + halfH,
    },
    margin,
  );
}

/** Roztáhne obdélník o `margin` chunků na každou stranu. */
function expand(view: Viewport, margin: number): Viewport {
  const padX = margin * CHUNK_SIZE * (TILE_W / 2);
  const padY = margin * CHUNK_SIZE * (TILE_H / 2);
  return {
    minX: view.minX - padX,
    maxX: view.maxX + padX,
    minY: view.minY - padY,
    maxY: view.maxY + padY,
  };
}
