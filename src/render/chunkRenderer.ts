import { Container, Graphics } from 'pixi.js';
import { tileCorners } from '@/sim/heights';
import { index, ROAD, TERRAIN } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import {
  BRIDGE_COLOR,
  BRIDGE_RAIL_COLOR,
  PIPE_COLOR,
  PIPE_WIDTH,
  POWER_OFF_COLOR,
  POWER_ON_COLOR,
  POWER_OVERLAY_ALPHA,
  ROAD_COLOR,
  ROAD_COLORS,
  ROAD_WIDTHS,
  shade,
  TERRAIN_COLORS,
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
import { slopeLight, tileQuad } from './projection';
import { roadMask, roadPolygons } from './roads';

/** Chunk = 16×16 dlaždic. Změna jedné dlaždice invaliduje jeden chunk, ne mapu. */
export const CHUNK_SIZE = 16;

/**
 * Který diagnostický pohled je zapnutý. Vždycky nejvýš jeden — dva překryvy
 * přes sebe by se nedaly přečíst. Skutečný přepínač s ikonami je T21.
 */
export type OverlayMode = 'none' | 'power' | 'underground';

interface Chunk {
  readonly x0: number;
  readonly y0: number;
  readonly graphics: Graphics;
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
export class ChunkRenderer {
  private readonly world: ReadonlyWorldView;
  private readonly chunksPerAxis: number;
  private readonly chunks: Chunk[] = [];
  private readonly container: Container;
  private overlay: OverlayMode = 'none';

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
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
        this.chunks.push({ x0: cx * CHUNK_SIZE, y0: cy * CHUNK_SIZE, graphics });
      }
    }
  }

  /**
   * Přepne overlay. Překreslí všechny chunky, ale je to reakce na stisk
   * klávesy, ne věc snímku.
   */
  setOverlay(mode: OverlayMode): void {
    if (this.overlay === mode) return;
    this.overlay = mode;
    this.redrawAll();
  }

  getOverlay(): OverlayMode {
    return this.overlay;
  }

  private redrawAll(): void {
    for (let chunkIndex = 0; chunkIndex < this.chunks.length; chunkIndex++) {
      this.redraw(chunkIndex);
    }
  }

  /** Index chunku, do kterého spadá dlaždice. */
  private chunkIndexFor(x: number, y: number): number {
    return Math.floor(y / CHUNK_SIZE) * this.chunksPerAxis + Math.floor(x / CHUNK_SIZE);
  }

  update(dirty: DirtySet): void {
    const pending = new Set<number>();

    if (dirty.fullRedraw) {
      for (let i = 0; i < this.chunks.length; i++) {
        pending.add(i);
      }
    } else {
      for (const tileIndex of dirty.tiles) {
        const x = tileIndex % this.world.size;
        const y = (tileIndex - x) / this.world.size;
        pending.add(this.chunkIndexFor(x, y));
      }
    }

    for (const chunkIndex of pending) {
      this.redraw(chunkIndex);
    }
  }

  private redraw(chunkIndex: number): void {
    const chunk = this.chunks[chunkIndex];
    if (!chunk) return;

    const { x0, y0, graphics } = chunk;
    graphics.clear();

    const last = CHUNK_SIZE - 1;
    // Kreslení vzestupně podle x + y (back-to-front). Na ploché mapě na pořadí
    // nezáleží, s převýšením a budovami ano — pravidlo platí od začátku.
    for (let sum = 0; sum <= last * 2; sum++) {
      for (let dy = Math.max(0, sum - last); dy <= Math.min(last, sum); dy++) {
        this.drawTile(graphics, x0 + sum - dy, y0 + dy);
      }
    }
  }

  private drawTile(graphics: Graphics, x: number, y: number): void {
    if (x >= this.world.size || y >= this.world.size) return;

    const tileIndex = index(x, y);
    const terrain = this.world.layers.terrain[tileIndex] ?? 0;
    const corners = tileCorners(this.world.cornerHeight, x, y);
    const underground = this.overlay === 'underground';
    const flat = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS[0];
    // Sklon se promítne do jasu, jinak by svah vypadal jako rovina (§7).
    // V podzemním pohledu se terén ztlumí, ať nepřekřičí potrubí (§8).
    const lit = shade(flat, slopeLight(corners));
    const color = underground ? shade(lit, UNDERGROUND_TERRAIN_SHADE) : lit;

    // Vše ostatní na dlaždici — vozovka i překryvy — se kreslí do téhle plochy,
    // ne do pravidelného diamantu. Na svahu by se od terénu odlepilo.
    const points = tileQuad(x, y, corners);

    graphics
      .poly(points)
      .fill({ color })
      .stroke({ color: shade(color, TILE_EDGE_SHADE), width: 1, alignment: 0.5 });

    const zone = this.world.layers.zone[tileIndex] ?? 0;
    const zoneColor = ZONE_COLOR_BY_VALUE[zone];
    if (zone !== 0 && zoneColor !== undefined) {
      // Pod zemí zůstává zóna vidět jen jako náznak: je to hlavní důvod, proč
      // se tam potrubí vede, takže úplně zmizet nesmí.
      graphics
        .poly(points)
        .fill({ color: zoneColor, alpha: underground ? UNDERGROUND_ZONE_ALPHA : ZONE_OVERLAY_ALPHA });
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

    const mask = roadMask((nx, ny) => this.isPipe(nx, ny), x, y);
    for (const polygon of roadPolygons(points, mask, PIPE_WIDTH)) {
      graphics.poly(polygon).fill({ color: PIPE_COLOR });
    }
  }

  /** Mimo mapu potrubí není — okraj se chová jako slepý konec, stejně jako u silnic. */
  private isPipe(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return false;
    return this.world.layers.pipe[index(x, y)] === 1;
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
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return false;
    return (this.world.layers.road[index(x, y)] ?? ROAD.none) !== ROAD.none;
  }

  destroy(): void {
    for (const chunk of this.chunks) {
      chunk.graphics.destroy();
    }
    this.chunks.length = 0;
    this.container.destroy();
  }
}
