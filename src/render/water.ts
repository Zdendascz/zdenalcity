import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { index, TERRAIN } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { tileBaseHeight } from '@/sim/heights';
import { motionRandom } from './effects';
import type { MotionView } from './effects';
import { gridToScreen } from './projection';
import { tilesIn } from './vehicles';

/**
 * Odlesky na vodě (T117, `docs/17-ANIMACE.md` vrstva 4).
 *
 * Voda je upečená v chunku a kvůli ní se pečení rozbíjet nebude. Nad vodními
 * dlaždicemi ve výřezu se proto kreslí **odlesky**: krátké světlé čárky, které
 * se pomalu rozsvítí, kousek popojedou a zhasnou, a objeví se jinde. Běží
 * i na pauze — pauza zastavuje město, ne vodu.
 */

/** Kolik odlesků na viditelnou vodní dlaždici a strop celkem. */
const PER_TILE = 0.6;
const MAX_GLINTS = 500;
/** Pod tímhle zoomem by odlesky jen zrnily. */
const MIN_ZOOM = 0.5;

interface Glint {
  sprite: Sprite;
  age: number;
  life: number;
  drift: number;
  peak: number;
}

export class WaterGlints {
  private readonly world: ReadonlyWorldView;
  private readonly container = new Container();
  private readonly texture: Texture;
  private readonly random = motionRandom(0x3a7e);
  private readonly live: Glint[] = [];
  private readonly pool: Sprite[] = [];
  private water: number[] = [];
  private target = 0;
  private recount = 0;
  private enabled = true;

  constructor(world: ReadonlyWorldView, parent: Container, renderer: Renderer) {
    this.world = world;
    const g = new Graphics();
    // Čárka po vodě: plochá elipsa se světlým jádrem.
    g.ellipse(0, 0, 6, 1.4).fill({ color: 0xffffff, alpha: 0.45 });
    g.ellipse(0, 0, 3.5, 0.8).fill({ color: 0xffffff, alpha: 0.9 });
    this.texture = renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    // Vlastní skupina vykreslování (T133): odlesky přibývají a mizí každý
    // snímek a s nimi se staví znovu seznam instrukcí. Ať je to jen ten jejich.
    this.container.isRenderGroup = true;
    parent.addChild(this.container);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  update(deltaMS: number, view: MotionView, zoom: number): void {
    if (!this.enabled || zoom < MIN_ZOOM) {
      if (this.live.length > 0) this.clear();
      return;
    }
    this.recount -= deltaMS;
    if (this.recount <= 0) {
      this.recount = 700;
      this.countWater(view);
    }
    for (let i = 0; i < 4 && this.live.length < this.target && this.water.length > 0; i++) {
      this.spawn();
    }
    const seconds = deltaMS / 1000;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const glint = this.live[i]!;
      glint.age += deltaMS;
      const t = glint.age / glint.life;
      if (t >= 1) {
        this.release(i);
        continue;
      }
      glint.sprite.x += glint.drift * seconds;
      // Pomalu se rozsvítí a zhasne — sinus přes celý život.
      glint.sprite.alpha = glint.peak * Math.sin(t * Math.PI);
    }
  }

  private countWater(view: MotionView): void {
    const { x0, y0, x1, y1 } = tilesIn(view, this.world.size);
    const size = this.world.size;
    const terrain = this.world.layers.terrain;
    const road = this.world.layers.road;
    const water: number[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = index(x, y, size);
        // Pod mostem odlesk nebude: deska ho zakryje a lesknout se nemá co.
        if (terrain[tile] === TERRAIN.water && (road[tile] ?? 0) === 0) water.push(tile);
      }
    }
    this.water = water;
    this.target = Math.min(MAX_GLINTS, Math.round(water.length * PER_TILE));
  }

  private spawn(): void {
    const tile = this.water[Math.floor(this.random() * this.water.length)]!;
    const size = this.world.size;
    const x = tile % size;
    const y = (tile - x) / size;
    const gx = x + 0.15 + this.random() * 0.7;
    const gy = y + 0.15 + this.random() * 0.7;
    const at = gridToScreen(gx, gy, tileBaseHeight(this.world.cornerHeight, x, y));
    const sprite = this.pool.pop() ?? new Sprite(this.texture);
    sprite.anchor.set(0.5);
    sprite.position.set(at.x, at.y);
    sprite.scale.set(0.6 + this.random() * 0.8, 1);
    sprite.alpha = 0;
    this.container.addChild(sprite);
    this.live.push({
      sprite,
      age: 0,
      life: 1400 + this.random() * 1800,
      drift: 2 + this.random() * 3,
      peak: 0.35 + this.random() * 0.35,
    });
  }

  private release(i: number): void {
    const glint = this.live[i]!;
    this.live[i] = this.live[this.live.length - 1]!;
    this.live.pop();
    glint.sprite.removeFromParent();
    this.pool.push(glint.sprite);
  }

  private clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.release(i);
  }
}
