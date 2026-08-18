import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { index } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';
import { shade, TERRAIN_COLORS, TILE_EDGE_SHADE } from './palette';
import { diamondPoints, gridToScreen, TILE_H, TILE_W } from './projection';

/** Chunk = 16×16 dlaždic. Změna jedné dlaždice invaliduje jeden chunk, ne mapu. */
export const CHUNK_SIZE = 16;

interface ChunkBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * Opsaný obdélník diamantů celého chunku. Diamanty se do sebe zaklesávají,
 * takže obdélník je zhruba dvakrát větší než plocha, kterou reálně pokryjí —
 * to je daň za izometrii, ne chyba výpočtu.
 */
function chunkBounds(x0: number, y0: number): ChunkBounds {
  const x1 = x0 + CHUNK_SIZE - 1;
  const y1 = y0 + CHUNK_SIZE - 1;
  const minX = (x0 - y1) * (TILE_W / 2) - TILE_W / 2;
  const maxX = (x1 - y0) * (TILE_W / 2) + TILE_W / 2;
  const minY = (x0 + y0) * (TILE_H / 2);
  const maxY = (x1 + y1) * (TILE_H / 2) + TILE_H;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

interface Chunk {
  readonly x0: number;
  readonly y0: number;
  readonly bounds: ChunkBounds;
  readonly texture: RenderTexture;
  readonly sprite: Sprite;
}

/**
 * Terén po chuncích do `RenderTexture`. Chunk se překresluje jen tehdy, když
 * se ho dotkne `DirtySet` — renderer nikdy nepřekresluje celou mapu.
 */
export class ChunkRenderer {
  private readonly renderer: Renderer;
  private readonly world: ReadonlyWorldView;
  private readonly chunksPerAxis: number;
  private readonly chunks: Chunk[] = [];

  constructor(renderer: Renderer, world: ReadonlyWorldView, container: Container) {
    this.renderer = renderer;
    this.world = world;
    this.chunksPerAxis = Math.ceil(world.size / CHUNK_SIZE);

    for (let cy = 0; cy < this.chunksPerAxis; cy++) {
      for (let cx = 0; cx < this.chunksPerAxis; cx++) {
        const x0 = cx * CHUNK_SIZE;
        const y0 = cy * CHUNK_SIZE;
        const bounds = chunkBounds(x0, y0);
        // resolution: 1 natvrdo — jinak by se na HiDPI displeji alokovaly
        // čtyřnásobně velké textury (viz poznámka o paměti v PROGRESS.md).
        const texture = RenderTexture.create({
          width: bounds.width,
          height: bounds.height,
          resolution: 1,
        });
        const sprite = new Sprite(texture);
        sprite.position.set(bounds.minX, bounds.minY);
        container.addChild(sprite);
        this.chunks.push({ x0, y0, bounds, texture, sprite });
      }
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

    const graphics = new Graphics();
    const { x0, y0, bounds } = chunk;
    const last = CHUNK_SIZE - 1;

    // Kreslení vzestupně podle x + y (back-to-front). Na ploché mapě na pořadí
    // nezáleží, s převýšením a budovami ano — pravidlo platí od začátku.
    for (let sum = 0; sum <= last * 2; sum++) {
      for (let dy = Math.max(0, sum - last); dy <= Math.min(last, sum); dy++) {
        this.drawTile(graphics, x0 + sum - dy, y0 + dy, bounds);
      }
    }

    this.renderer.render({ container: graphics, target: chunk.texture, clear: true });
    graphics.destroy();
  }

  private drawTile(graphics: Graphics, x: number, y: number, bounds: ChunkBounds): void {
    if (x >= this.world.size || y >= this.world.size) return;

    const tileIndex = index(x, y);
    const terrain = this.world.layers.terrain[tileIndex] ?? 0;
    const elevation = this.world.layers.elevation[tileIndex] ?? 0;
    const color = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS[0];

    const origin = gridToScreen(x, y, elevation);
    const points = diamondPoints(origin.x - bounds.minX, origin.y - bounds.minY);

    graphics
      .poly(points)
      .fill({ color })
      .stroke({ color: shade(color, TILE_EDGE_SHADE), width: 1, alignment: 0.5 });
  }

  destroy(): void {
    for (const chunk of this.chunks) {
      chunk.sprite.destroy();
      chunk.texture.destroy(true);
    }
    this.chunks.length = 0;
  }
}
