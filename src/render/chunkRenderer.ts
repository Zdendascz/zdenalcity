import { Container, Graphics } from 'pixi.js';
import { index } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import {
  POWER_OFF_COLOR,
  POWER_ON_COLOR,
  POWER_OVERLAY_ALPHA,
  ROAD_COLOR,
  shade,
  TERRAIN_COLORS,
  TILE_EDGE_SHADE,
  ZONE_COLOR_BY_VALUE,
  ZONE_OVERLAY_ALPHA,
} from './palette';
import { diamondPoints, gridToScreen } from './projection';
import { roadMask, roadPolygons } from './roads';

/** Chunk = 16×16 dlaždic. Změna jedné dlaždice invaliduje jeden chunk, ne mapu. */
export const CHUNK_SIZE = 16;

/**
 * Který diagnostický pohled je zapnutý. Vždycky nejvýš jeden — dva překryvy
 * přes sebe by se nedaly přečíst. Skutečný přepínač s ikonami je T21.
 */
export type OverlayMode = 'none' | 'power';

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
  private overlay: OverlayMode = 'none';

  constructor(world: ReadonlyWorldView, container: Container) {
    this.world = world;
    this.chunksPerAxis = Math.ceil(world.size / CHUNK_SIZE);

    for (let cy = 0; cy < this.chunksPerAxis; cy++) {
      for (let cx = 0; cx < this.chunksPerAxis; cx++) {
        const graphics = new Graphics();
        container.addChild(graphics);
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
    const elevation = this.world.layers.elevation[tileIndex] ?? 0;
    const color = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS[0];

    const origin = gridToScreen(x, y, elevation);
    const points = diamondPoints(origin.x, origin.y);

    graphics
      .poly(points)
      .fill({ color })
      .stroke({ color: shade(color, TILE_EDGE_SHADE), width: 1, alignment: 0.5 });

    const zone = this.world.layers.zone[tileIndex] ?? 0;
    const zoneColor = ZONE_COLOR_BY_VALUE[zone];
    if (zone !== 0 && zoneColor !== undefined) {
      graphics.poly(points).fill({ color: zoneColor, alpha: ZONE_OVERLAY_ALPHA });
    }

    if (this.world.layers.road[tileIndex] === 1) {
      const mask = roadMask((nx, ny) => this.isRoad(nx, ny), x, y);
      for (const polygon of roadPolygons(origin.x, origin.y, mask)) {
        graphics.poly(polygon).fill({ color: ROAD_COLOR });
      }
    }

    // Elektřina je veličina po dlaždicích, takže patří do chunku. Vrstvy
    // na hrubé mřížce kreslí `CoarseOverlay` — ty do chunků nepatří.
    if (this.overlay === 'power') {
      this.drawPowerOverlay(graphics, points, tileIndex);
    }
  }

  /**
   * Barví se jen vodiče — silnice a budovy. Prázdná dlaždice proud vést nemůže,
   * takže by červená znamenala „chybí tu vedení", což by mátlo.
   */
  private drawPowerOverlay(graphics: Graphics, points: number[], tileIndex: number): void {
    const isConductor =
      this.world.layers.road[tileIndex] === 1 || this.world.layers.buildingId[tileIndex] !== 0;
    if (!isConductor) return;

    const color = this.world.layers.power[tileIndex] === 1 ? POWER_ON_COLOR : POWER_OFF_COLOR;
    graphics.poly(points).fill({ color, alpha: POWER_OVERLAY_ALPHA });
  }

  /** Mimo mapu silnice nikdy není — okraj mapy se tak chová jako slepý konec. */
  private isRoad(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.world.size || y >= this.world.size) return false;
    return this.world.layers.road[index(x, y)] === 1;
  }

  destroy(): void {
    for (const chunk of this.chunks) {
      chunk.graphics.destroy();
    }
    this.chunks.length = 0;
  }
}
