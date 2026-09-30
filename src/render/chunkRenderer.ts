import { Container, Graphics, Matrix } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { MAX_HEIGHT, tileCorners } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import { BAND_STEPS, bandDepths, bandFor, bandU, bandV, SIDES } from './terrainBands';

/** Mělčina u břehu (T130). */
const SHALLOW_COLOR = 0x7fc4c0;
/**
 * Vrstvy pásu: šířka (násobek) a průhlednost — dohromady měkký přechod.
 *
 * **Šest, ne devět** (T133, se souhlasem autora). Pečení chunku s devíti
 * vrstvami stálo v mediánu 2,6–4,7 ms a v nejhorším přes 16 ms při rozpočtu
 * 2 ms. Průhlednosti jsou přeladěné tak, aby součet v každém pásmu hloubky
 * seděl na průměr původních devíti (u hranice 0,83, pak 0,72, 0,59, 0,46,
 * 0,28 a na kraji 0,14) — stejný spád, jen v šesti krocích.
 *
 * Zkoušely se i čtyři: pečení vyšlo ještě o chlup levněji, ale na mělčině
 * byly schody vidět jako vrstevnice. Šest je na snímku při přiblížení 3,5
 * od devíti skoro nerozeznatelných a měřeně stojí zhruba polovinu.
 */
const BAND_LAYERS: readonly (readonly [number, number])[] = [
  [0.225, 0.385],
  [0.45, 0.317],
  [0.675, 0.242],
  [0.9, 0.251],
  [1.125, 0.169],
  [1.35, 0.137],
];
/** Poloměr zaoblení rohu dlaždice (T130), v podílu hrany. */
const CORNER_RADIUS = 0.55;
/** Rohy dlaždice v `(u, v)` a strany, které se v nich potkávají. */
const CORNERS: readonly (readonly [number, number, number, number])[] = [
  // u, v, strana A, strana B (indexy do SIDES: 0 S, 1 V, 2 J, 3 Z)
  [0, 0, 0, 3],
  [1, 0, 0, 1],
  [1, 1, 2, 1],
  [0, 1, 2, 3],
];
/**
 * Zaoblení každého rohu v `(u, v)`, jako plochá dvojice čísel: roh a oblouk
 * o devíti bodech. Je pro všechny dlaždice stejné, tak se počítá jednou.
 */
const CORNER_ARCS: readonly (readonly number[])[] = CORNERS.map(([cu, cv]) => {
  const su = cu === 0 ? 1 : -1;
  const sv = cv === 0 ? 1 : -1;
  const centreU = cu + su * CORNER_RADIUS;
  const centreV = cv + sv * CORNER_RADIUS;
  const points = [cu, cv];
  for (let i = 0; i <= 8; i++) {
    const angle = (i / 8) * (Math.PI / 2);
    points.push(centreU - su * CORNER_RADIUS * Math.cos(angle), centreV - sv * CORNER_RADIUS * Math.sin(angle));
  }
  return points;
});
/** Hloubky okraje pásu pro právě kreslenou stranu. Sdílené, kreslí se synchronně. */
const BAND_DEPTHS = new Float64Array(BAND_STEPS + 1);

/** Druh terénu, mimo mapu `fallback` — okraj mapy přechod nemá. */
function terrainAt(layer: ArrayLike<number>, size: number, x: number, y: number, fallback: number): number {
  return x < 0 || y < 0 || x >= size || y >= size ? fallback : (layer[y * size + x] ?? 0);
}

/**
 * Body `(u, v)` (plochá dvojice) do obrazovky přes rohy dlaždice. Totéž co
 * `inside` z `roads.ts`, jen bez pole na každý bod.
 */
function projectInto(quad: readonly number[], uv: readonly number[], out: number[]): number[] {
  const nwX = quad[0] ?? 0;
  const nwY = quad[1] ?? 0;
  const neX = quad[2] ?? 0;
  const neY = quad[3] ?? 0;
  const seX = quad[4] ?? 0;
  const seY = quad[5] ?? 0;
  const swX = quad[6] ?? 0;
  const swY = quad[7] ?? 0;
  for (let i = 0; i < uv.length; i += 2) {
    const u = uv[i]!;
    const v = uv[i + 1]!;
    const topX = (1 - u) * nwX + u * neX;
    const bottomX = (1 - u) * swX + u * seX;
    const topY = (1 - u) * nwY + u * neY;
    const bottomY = (1 - u) * swY + u * seY;
    out.push((1 - v) * topX + v * bottomX, (1 - v) * topY + v * bottomY);
  }
  return out;
}

/**
 * Mnohoúhelník pásu na straně `side` v měřítku `scale`, z hloubek
 * v `BAND_DEPTHS`. Stejné pořadí bodů jako `bandShape`: konec hrany, vnitřní
 * okraj pozpátku, začátek hrany.
 *
 * Vrací **nové pole**: `Graphics.poly` si ho nekopíruje, jen uloží odkaz.
 */
function bandPolygon(quad: readonly number[], side: number, scale: number): number[] {
  const uv: number[] = [bandU(side, 1, 0), bandV(side, 1, 0)];
  for (let i = BAND_STEPS; i >= 0; i--) {
    const t = i / BAND_STEPS;
    const depth = BAND_DEPTHS[i]! * scale;
    uv.push(bandU(side, t, depth), bandV(side, t, depth));
  }
  uv.push(bandU(side, 0, 0), bandV(side, 0, 0));
  return projectInto(quad, uv, []);
}
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import type { FrameChanges } from './changes';
import {
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

/** Co padlo na dlaždici: obrázek a o kolik čtvrtin otočený. */
interface SurfacePick {
  texture: Texture;
  turn: number;
}

/**
 * Matice, která položí čtvercový obrázek na dlaždici.
 *
 * Vede **z textury do plochy**: obrázek 256 px na dlaždici širokou 64. Obracet
 * ji nemá, a dělal jsem to — kresba pak byla osmkrát zvětšená a na trávě to
 * nešlo poznat, protože zvětšený trávník je pořád trávník. Prozradil to až
 * písek, který vyšel rozmazaný, a strom, ze kterého zbyl svislý proužek.
 *
 * Otočení se dělá **výběrem rohů**, ne otáčením obrázku: který roh je počátek
 * a kterými dvěma vedou osy, to o čtvrtinu otočí celou kresbu zadarmo. Rohy
 * chodí po směru hodin, takže `turn` je počet čtvrtin.
 *
 * Platí to **jen s `textureSpace: 'global'`**, a to je celá historie téhle
 * funkce. Ve výchozím `'local'` Pixi matici ještě znormalizuje podle obálky
 * tvaru, tedy podle obdélníku 64 × 32 kolem dlaždice — obrázek se tím zmenší
 * čtyřikrát na šířku a osmkrát na výšku a `generateTextureMatrix` ho navíc
 * nechá opakovat, protože si `clamp-to-edge` přepíše na `repeat`. Na mapě z
 * toho byla mřížka a vypadala jako zrnitost. Autor to popsal přesně: „vypadá
 * to, jak by na jedné dlaždici bylo 6x6 textur".
 *
 * Používá ji terén i vozovka. U vozovky je to podstatné: polygon vozovky je
 * jen **výřez dlaždice**, takže když se obrázek mapuje na celou dlaždici,
 * asfalt v rameni navazuje na asfalt v jádru sám od sebe.
 */
/**
 * Jak je obrázek trosek na téhle dlaždici otočený.
 *
 * Ze souřadnic, ne z `world.rng`: musí to vyjít stejně při každém překreslení
 * i po načtení savu. Bez otočení mají všechny hromady kresbu ve stejném směru
 * a přes velké spáleniště jde vidět pruh — táž past jako u trávy.
 */
function rubbleTurn(x: number, y: number): number {
  let h = Math.imul((x * 0x2545f491) ^ (y * 0x9e3779b9), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h & 3;
}

function tileMatrix(
  x: number,
  y: number,
  corners: readonly [number, number, number, number],
  turn: number,
  size: number,
): Matrix {
  const quad = surfaceCorners(x, y, corners);
  const origin = quad[turn]!;
  const alongU = quad[(turn + 1) & 3]!;
  const alongV = quad[(turn + 3) & 3]!;
  return new Matrix(
    (alongU[0] - origin[0]) / size,
    (alongU[1] - origin[1]) / size,
    (alongV[0] - origin[0]) / size,
    (alongV[1] - origin[1]) / size,
    origin[0],
    origin[1],
  );
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
  /** Přechodové pásy mezi povrchy (T130). Vlastní dávka textur. */
  readonly bands: Graphics;
  /** Zóny, oheň, suť, elektřina a podzemí — nad pásy. */
  readonly over: Graphics;
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
  /**
   * Musí se přepéct i povrch a pásy, nebo stačí překryvná vrstva (T133)?
   *
   * Oheň, povodeň, suť, zóny i proud se kreslí jen do `over`. Povrch s pásy
   * je přitom to drahé — 9 vrstev na každé hranici — a hořící dlaždice se
   * značí každé dva tiky. Bez rozlišení se kvůli plamenu přepékal celý chunk.
   */
  surfaceStale: boolean;
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
  /** Chunky pod každou budovou, ať se po zbourání ví, co přepéct. */
  private readonly buildingChunks = new Map<number, number[]>();
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
  /** Materiály přechodových pásů podle jména (T130). */
  private bandTextures: ReadonlyMap<string, Texture> = new Map();
  /** Obrázek trosek. Bez něj se kreslí plná barva jako dřív. */
  private rubbleTexture: Texture | undefined;

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
    // Vlastní skupina vykreslování (T133): chunky se mění zřídka, tak ať se
    // jejich seznam instrukcí nestaví znovu kvůli autům a kouři.
    this.container.isRenderGroup = true;
    parent.addChild(this.container);

    for (let cy = 0; cy < this.chunksPerAxis; cy++) {
      for (let cx = 0; cx < this.chunksPerAxis; cx++) {
        const graphics = new Graphics();
        graphics.zIndex = cx + cy;
        this.container.addChild(graphics);
        // Pásy a překryvy jsou vlastní `Graphics`, aby pásy měly vlastní
        // rozpočet textur (chunk jich jinak nese sedm) a zóny ležely nad
        // nimi. Řadí se hned za povrch svého chunku, pod povrch toho před ním.
        const bands = new Graphics();
        bands.zIndex = cx + cy + 0.3;
        this.container.addChild(bands);
        const over = new Graphics();
        over.zIndex = cx + cy + 0.6;
        this.container.addChild(over);
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        this.chunks.push({
          x0,
          y0,
          graphics,
          bands,
          over,
          bounds: chunkBounds(x0, y0),
          // Čerstvý chunk je prázdný a čeká, jestli na něj bude vidět.
          baked: false,
          stale: true,
          surfaceStale: true,
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
    for (const chunk of this.chunks) {
      chunk.stale = true;
      chunk.surfaceStale = true;
    }
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
        chunk.bands.clear();
        chunk.over.clear();
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
  update(dirty: DirtySet, changes?: FrameChanges): void {
    if (dirty.fullRedraw || changes?.full === true) {
      this.invalidateAll();
      return;
    }

    // Bez roztřídění (testy, starší volající) se každá dlaždice bere jako
    // změna povrchu — to je bezpečná strana.
    const surface: Iterable<number> = changes ? changes.surface : dirty.tiles;
    for (const tileIndex of surface) {
      const x = tileIndex % this.world.size;
      const y = (tileIndex - x) / this.world.size;
      this.markStale(this.chunkIndexFor(x, y), true);
      // Přechodový pás sousední dlaždice záleží na téhle (T130) — soused
      // může ležet v jiném chunku.
      for (const [dx, dy] of SIDES) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.world.size || ny >= this.world.size) continue;
        this.markStale(this.chunkIndexFor(nx, ny), true);
      }
    }
    if (changes) {
      // Zbytek se kreslí jen do překryvné vrstvy: zóna, suť, oheň, voda,
      // proud a v podzemním pohledu i silnice a potrubí.
      for (const list of [changes.road, changes.parcel, changes.rubble, changes.other]) {
        for (const tileIndex of list) {
          const x = tileIndex % this.world.size;
          this.markStale(this.chunkIndexFor(x, (tileIndex - x) / this.world.size), false);
        }
      }
    }

    /*
     * Barva zóny se kreslí jen na volné parcele, takže se chunk musí
     * přepéct, i když se změnila **jen budova**. Růst zóny hlásí nový dům
     * v `dirty.buildings`, ne v `dirty.tiles` — a pod domem pak zůstala
     * barva zóny a vykukovala po okrajích pozemku (hlásil autor). U zbourané
     * budovy už půdorys ve světě není, proto se pamatuje, kde stála.
     *
     * Stačí překryvná vrstva: zóna je v ní, povrch pod domem se nemění.
     */
    for (const id of changes ? changes.buildings : dirty.buildings) {
      const building = this.world.buildings.get(id);
      const previous = this.buildingChunks.get(id);
      if (previous) for (const index of previous) this.markStale(index, false);
      if (!building) {
        this.buildingChunks.delete(id);
        continue;
      }
      const covered = new Set<number>();
      const [width, depth] = this.footprintOf(id, building);
      for (let dy = 0; dy < depth; dy++) {
        for (let dx = 0; dx < width; dx++) {
          covered.add(this.chunkIndexFor(building.x + dx, building.y + dy));
        }
      }
      for (const index of covered) this.markStale(index, false);
      this.buildingChunks.set(id, [...covered]);
    }
  }

  private markStale(chunkIndex: number, surface: boolean): void {
    const chunk = this.chunks[chunkIndex];
    if (!chunk) return;
    chunk.stale = true;
    if (surface) chunk.surfaceStale = true;
  }

  /** Půdorys budovy podle dlaždic, které opravdu drží (vrstva `buildingId`). */
  private footprintOf(id: number, building: { x: number; y: number }): [number, number] {
    const size = this.world.size;
    const ids = this.world.layers.buildingId;
    let width = 1;
    while (building.x + width < size && ids[building.y * size + building.x + width] === id) width++;
    let depth = 1;
    while (building.y + depth < size && ids[(building.y + depth) * size + building.x] === id) depth++;
    return [width, depth];
  }

  private redraw(chunkIndex: number): void {
    const chunk = this.chunks[chunkIndex];
    if (!chunk) return;

    const { x0, y0, graphics, bands, over } = chunk;
    // Jen překryvná vrstva, když povrch platí (T133). Uvolněný chunk nemá
    // nic, takže ten se peče vždycky celý.
    const surface = !chunk.baked || chunk.surfaceStale;
    if (surface) {
      graphics.clear();
      bands.clear();
    }
    over.clear();
    if (!chunk.baked) this.bakedCount++;
    this.bakes++;
    chunk.baked = true;
    chunk.stale = false;
    chunk.surfaceStale = false;

    const last = CHUNK_SIZE - 1;
    // Kreslení vzestupně podle x + y (back-to-front). Na ploché mapě na pořadí
    // nezáleží, s převýšením a budovami ano — pravidlo platí od začátku.
    for (let sum = 0; sum <= last * 2; sum++) {
      for (let dy = Math.max(0, sum - last); dy <= Math.min(last, sum); dy++) {
        this.drawTile(surface ? graphics : null, x0 + sum - dy, y0 + dy, bands, over);
      }
    }
  }

  /**
   * Zaoblí rohy dlaždice (T130): kde na obou stranách rohu leží stejný jiný
   * povrch a jeden z nich je voda, jeho obrázek překryje roh obloukem. Z vody
   * tak mizí hvězdy ze špiček kosočtverců.
   */
  private roundCorners(
    g: Graphics,
    x: number,
    y: number,
    terrain: number,
    corners: readonly [number, number, number, number],
    quad: number[],
    light: number,
  ): void {
    const size = this.world.size;
    const layer = this.world.layers.terrain;
    for (let c = 0; c < 4; c++) {
      const [, , a, b] = CORNERS[c]!;
      const [adx, ady] = SIDES[a]!;
      const [bdx, bdy] = SIDES[b]!;
      const other = terrainAt(layer, size, x + adx, y + ady, terrain);
      // Jen na rozhraní s vodou. Mezi souší to řeší pásy; zaoblený roh cizí
      // souše s jiným osvětlením a bez stromů vypadal jako vystřižený.
      if (other === terrain || terrainAt(layer, size, x + bdx, y + bdy, terrain) !== other) continue;
      if (other !== TERRAIN.water && terrain !== TERRAIN.water) continue;
      const surface = this.surfaceFor(other, x, y);
      // Oblouk je pro každý roh pořád stejný, v `(u, v)` spočítaný předem
      // (`CORNER_ARCS`); tady se jen promítne do rohů dlaždice.
      const polygon = projectInto(quad, CORNER_ARCS[c]!, []);
      g.poly(polygon).fill({ color: shade(TERRAIN_COLORS[other] ?? TERRAIN_COLORS[0], slopeLight(corners)) });
      if (surface) {
        const matrix = tileMatrix(x, y, corners, surface.turn, surface.texture.width || 1);
        g.poly(polygon).fill({ texture: surface.texture, matrix, color: light, textureSpace: 'global' });
      }
      // Roh patří k hranici, takže nese i její pás — mělčinu, mokrý písek.
      // Bez něj svítil holý povrch v pásu jako klín.
      const band = bandFor(other, terrain);
      if (band === 'shallow') {
        g.poly(polygon).fill({ color: SHALLOW_COLOR, alpha: 0.6 });
      } else if (band !== null) {
        const texture = this.bandTextures.get(band);
        if (texture) {
          const matrix = tileMatrix(x, y, corners, 0, texture.width || 1);
          g.poly(polygon).fill({ texture, matrix, color: light, textureSpace: 'global', alpha: 0.8 });
        }
      }
    }
  }

  /** Materiály přechodových pásů (T130). Bez nich se pásy nekreslí, kromě mělčiny. */
  setBands(textures: ReadonlyMap<string, Texture>): void {
    this.bandTextures = textures;
    this.invalidateAll();
  }

  /**
   * Přechodové pásy dlaždice (T130): na každé straně, kde soused je jiný
   * povrch, pás podle `bandFor`. Na vodě mělčina s pěnou.
   *
   * Šum okraje se počítá **jednou na stranu** (`bandDepths`) a vrstvy se
   * z něj jen škálují (T133). Dřív si ho každá z devíti vrstev počítala
   * znovu, přes uzávěry, `forEach` a `flatMap` — medián pečení chunku
   * 4,7 ms proti rozpočtu 2 ms.
   */
  private drawBands(
    g: Graphics,
    x: number,
    y: number,
    terrain: number,
    corners: readonly [number, number, number, number],
    quad: number[],
    light: number,
  ): void {
    const size = this.world.size;
    const layer = this.world.layers.terrain;
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = SIDES[side]!;
      const other = terrainAt(layer, size, x + dx, y + dy, terrain);
      const material = bandFor(terrain, other);
      if (material === null) continue;
      const texture = material === 'shallow' ? undefined : this.bandTextures.get(material);
      if (material !== 'shallow' && !texture) continue;
      // Konce pásu: pokračuje, když i dlaždice vedle (podél hrany) má za
      // hranicí stejný cizí povrch. Jinak se zúží do ztracena.
      const ax = dx === 0 ? 1 : 0;
      const ay = dx === 0 ? 0 : 1;
      const start = !(
        terrainAt(layer, size, x - ax, y - ay, terrain) === terrain &&
        terrainAt(layer, size, x - ax + dx, y - ay + dy, terrain) === other
      );
      const end = !(
        terrainAt(layer, size, x + ax, y + ay, terrain) === terrain &&
        terrainAt(layer, size, x + ax + dx, y + ay + dy, terrain) === other
      );
      bandDepths(x, y, side, start, end, BAND_DEPTHS);

      if (material === 'shallow') {
        // Mělčina: světlejší voda u břehu, ztrácí se do hloubky, a pěna na
        // čáře vody.
        for (const [scale, alpha] of BAND_LAYERS) {
          g.poly(bandPolygon(quad, side, scale * 0.8)).fill({ color: SHALLOW_COLOR, alpha: alpha * 0.9 });
        }
        g.poly(bandPolygon(quad, side, 0.12)).fill({ color: 0xf4f7f5, alpha: 0.3 });
        continue;
      }
      const matrix = tileMatrix(x, y, corners, 0, texture!.width || 1);
      // Několik vrstev rostoucí šířky, každá průsvitná: u hranice se sečtou
      // do plného pásu, dovnitř dlaždice se pás ztrácí. Jeden ostrý okraj
      // vypadal jako nalepená záplata.
      for (const [scale, alpha] of BAND_LAYERS) {
        g.poly(bandPolygon(quad, side, scale)).fill({ texture: texture!, matrix, color: light, textureSpace: 'global', alpha });
      }
    }
  }

  /**
   * Nastaví obrázek trosek a překreslí.
   *
   * Vlastní setter, ne položka v `setSurfaces`: trosky nejsou druh terénu, jsou
   * **vrstva nad ním**. Kdyby se vydávaly za terén, musela by se kvůli nim
   * rozšířit `TERRAIN` a save by nesl hodnotu, která do něj nepatří.
   */
  setRubble(texture: Texture | undefined): void {
    this.rubbleTexture = texture;
    this.invalidateAll();
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

  /**
   * Nakreslí dlaždici. S `graphics === null` jen překryvnou vrstvu — povrch
   * a pásy chunku zůstávají z minula (T133).
   */
  private drawTile(surfaceGraphics: Graphics | null, x: number, y: number, bands?: Graphics, over?: Graphics): void {
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
    if (surfaceGraphics) {
      const graphics = surfaceGraphics;
      graphics.poly(points).fill({ color });

      // Tón je **bílá ztlumená sklonem**, ne barva terénu: obrázek už zelený je
      // a vynásobit ho zelenou znamená bahno. Zůstat musí jen světlo, jinak by
      // ze svahu zmizel stín a kopec by vypadal jako rovina.
      const light = shade(
        0xffffff,
        slopeLight(corners) * (underground ? UNDERGROUND_TERRAIN_SHADE : 1),
      );

      const surface = this.surfaceFor(terrain, x, y);
      if (surface !== undefined) {
        const matrix = tileMatrix(x, y, corners, surface.turn, surface.texture.width || 1);
        graphics
          .poly(points)
          .fill({ texture: surface.texture, matrix, color: light, textureSpace: 'global' });
      } else {
        // Obrys jen u barevné dlaždice. Na obrázku by z něj byla světlá mřížka
        // přes celou mapu — tvar terénu tam čte samo světlo a kresba povrchu.
        graphics
          .poly(points)
          .stroke({ color: shade(color, TILE_EDGE_SHADE), width: 1, alignment: 0.5 });
      }

      // Zaoblení až po pásech a do jejich vrstvy: jinak by ho pás břehu,
      // kreslený až ke hraně, zase překryl a špičky by zůstaly.
      if (bands && !underground) this.drawBands(bands, x, y, terrain, corners, points, light);
      if (!underground) this.roundCorners(bands ?? graphics, x, y, terrain, corners, points, light);
    }
    // Všechno od zón dál jde do vrstvy nad pásy.
    const graphics = over ?? surfaceGraphics;
    if (!graphics) return;

    const zone = this.world.layers.zone[tileIndex] ?? 0;
    const zoneColor = ZONE_COLOR_BY_VALUE[zone];
    // **Barva zóny jen na volné parcele.** Kde už budova stojí, je zóna
    // splněná a nemá co ukazovat — od chvíle, kdy je krycí, by se pod domem
    // prostíral barevný koberec a z města byla mozaika. Rozhodnutí autora:
    // „ty barvy zón jen tam, kde v té parcele není budova".
    //
    // A ani pod silnicí: zóna na dlaždici zůstane, i když se přes ni postaví
    // vozovka, a ta dlaždici nepokryje celou — barva pak vykukovala u krajů
    // silnic a před zastávkou (hlásil autor).
    const empty =
      (this.world.layers.buildingId[tileIndex] ?? 0) === 0 &&
      (this.world.layers.road[tileIndex] ?? 0) === 0;
    if (zone !== 0 && zoneColor !== undefined && (empty || underground)) {
      // Pod zemí zůstává zóna vidět jen jako náznak: je to hlavní důvod, proč
      // se tam potrubí vede, takže úplně zmizet nesmí.
      //
      // Na povrchu je to naopak plná barva a podklad zmizí. Sklon se do ní
      // promítne pořád: kdyby ne, kopec pod zónou by vypadal jako rovina
      // a hráč by při stavbě neviděl, kam staví.
      graphics.poly(points).fill({
        color: underground ? zoneColor : shade(zoneColor, slopeLight(corners)),
        alpha: underground ? UNDERGROUND_ZONE_ALPHA : ZONE_OVERLAY_ALPHA,
      });
    }

    if (underground) {
      this.drawUnderground(graphics, points, tileIndex, x, y);
      return;
    }

    // Most (vozovka na vodě) se tu dřív vyplnil světlou barvou přes celou
    // dlaždici. Od T122 ho kreslí `RoadRenderer` i se zábradlím, bočnicí
    // a stínem — a kolem desky má být vidět voda, jinak to most není.
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
      // Barva zůstává **pod obrázkem**, ne místo něj: když se textura
      // nedokreslí, má tam zbýt suť, ne díra. Do T92 tam byla jen ta barva —
      // plochá olivová skvrna, kterou autor nazval „hrůzným nesmyslem",
      // protože vypadala jako zorané pole uprostřed města.
      graphics.poly(points).fill({ color: RUBBLE_COLOR, alpha: RUBBLE_ALPHA });
      if (this.rubbleTexture !== undefined) {
        const turn = rubbleTurn(x, y);
        const matrix = tileMatrix(x, y, corners, turn, this.rubbleTexture.width || 1);
        graphics.poly(points).fill({
          texture: this.rubbleTexture,
          matrix,
          // Tón je bílá ztlumená sklonem, stejně jako u povrchu: obrázek už
          // šedohnědý je a vynásobit ho barvou suti znamená bláto.
          color: shade(0xffffff, slopeLight(corners)),
          textureSpace: 'global',
        });
      }
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
    // Od T129 vede proud blok zón a budov, silnice ne. Vedení kreslí
    // `WireOverlay` nad silnicemi, i s vytížením.
    const isConductor =
      (this.world.layers.zone[tileIndex] ?? 0) !== 0 ||
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
      chunk.bands.destroy();
      chunk.over.destroy();
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
export function chunkBounds(x0: number, y0: number): Viewport {
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

export function overlaps(a: Viewport, b: Viewport): boolean {
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
export function expand(view: Viewport, margin: number): Viewport {
  const padX = margin * CHUNK_SIZE * (TILE_W / 2);
  const padY = margin * CHUNK_SIZE * (TILE_H / 2);
  return {
    minX: view.minX - padX,
    maxX: view.maxX + padX,
    minY: view.minY - padY,
    maxY: view.maxY + padY,
  };
}
