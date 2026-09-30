import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { groundHeightAt } from '@/sim/heights';
import { index } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { MotionView, SmokeEmitter } from './effects';
import { gridToScreen } from './projection';
import { decorPick } from './decor';
import { tilesIn } from './vehicles';

/**
 * Plameny na hořících dlaždicích (T120, `docs/17-ANIMACE.md` bod 7).
 *
 * Do teď měl požár oranžový nádech dlaždice upečený v chunku a **jeden**
 * obrázek plamenů na místě, kde začal. Hořící čtvrť tak vypadala jako jeden
 * táborák. Teď hoří **každá dlaždice, která hoří** — vrstva `fire` nese
 * intenzitu po dlaždicích a podle ní přibývá plamenů a roste jejich výška.
 * Nad plameny stoupá tmavý kouř, podle kterého se požár najde i z dálky.
 *
 * Kreslí se jen to, co hoří. Kam se oheň šíří, rozhoduje simulace; jiskry
 * přeskakující na sousední dům by lhaly.
 */

/** Kolik plamenů na dlaždici při plné intenzitě. */
const MAX_FLAMES = 3;
/** Jak často plamen vymění obrázek — tím se „hýbe“. */
const FLICKER_MS = 110;
/** Strop plamenů ve výřezu. Hořící les na velké mapě má stovky dlaždic. */
const MAX_VISIBLE = 360;

interface Flame {
  readonly sprite: Sprite;
  /** Fáze kmitu a posun obrázků, ať dva plameny vedle sebe nekmitají spolu. */
  readonly phase: number;
  readonly height: number;
}

export class FireLayer {
  private readonly world: ReadonlyWorldView;
  private readonly container = new Container();
  private textures: readonly Texture[] = [];
  private anchors: readonly (readonly [number, number])[] = [];
  private scale = 4;
  /** Plameny podle dlaždice. */
  private readonly flames = new Map<number, Flame[]>();
  private readonly smoke: SmokeEmitter[] = [];
  private clock = 0;
  private rescan = 0;
  private enabled = true;

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    // Nad budovami: hoří dům, a plamen z okna má být před fasádou.
    this.container.zIndex = 800_000;
    // Vlastní skupina vykreslování, stejně jako kouř (T133).
    this.container.isRenderGroup = true;
    parent.addChild(this.container);
  }

  setTextures(
    textures: readonly Texture[],
    anchors: readonly (readonly [number, number])[],
    scale: number,
  ): void {
    this.textures = textures;
    this.anchors = anchors;
    this.scale = scale;
    this.clear();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /** Kouř z hořících dlaždic, pro `Effects.smoke`. */
  smokeSources(): readonly SmokeEmitter[] {
    return this.smoke;
  }

  update(deltaMS: number, view: MotionView): void {
    if (this.textures.length === 0) return;
    this.clock += deltaMS;
    this.rescan -= deltaMS;
    if (this.rescan <= 0) {
      this.rescan = 250;
      this.scan(view);
    }
    // Vypnuté animace: plameny stojí, ale jsou vidět — požár je informace,
    // ne ozdoba.
    if (!this.enabled) return;
    const frame = Math.floor(this.clock / FLICKER_MS);
    const t = this.clock / 1000;
    for (const list of this.flames.values()) {
      for (const flame of list) {
        const pick = (frame + Math.floor(flame.phase * 7)) % this.textures.length;
        const texture = this.textures[pick];
        if (texture && flame.sprite.texture !== texture) {
          flame.sprite.texture = texture;
          const anchor = this.anchors[pick] ?? [texture.width / 2, texture.height];
          flame.sprite.anchor.set(anchor[0] / texture.width, anchor[1] / texture.height);
        }
        const flicker = 0.85 + 0.15 * Math.sin(t * 9 + flame.phase * 6.28);
        flame.sprite.scale.set((0.8 + 0.2 * flicker) * flame.height / this.scale, flicker * flame.height / this.scale);
      }
    }
  }

  /** Srovná plameny s vrstvou `fire` ve výřezu. */
  private scan(view: MotionView): void {
    const { x0, y0, x1, y1 } = tilesIn(view, this.world.size);
    const size = this.world.size;
    const fire = this.world.fire;
    const seen = new Set<number>();
    this.smoke.length = 0;
    let shown = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = index(x, y, size);
        const intensity = fire[tile] ?? 0;
        if (intensity === 0) continue;
        seen.add(tile);
        const share = intensity / 255;
        const count = Math.max(1, Math.round(share * MAX_FLAMES));
        const base = groundHeightAt(this.world.cornerHeight, x + 0.5, y + 0.5);
        // Hořící dům má plameny výš — z oken a střechy, ne z trávníku.
        const building = (this.world.layers.buildingId[tile] ?? 0) !== 0;
        const lift = building ? 1.2 : 0;
        const centre = gridToScreen(x + 0.5, y + 0.5, base + lift);
        this.smoke.push({
          x: centre.x,
          y: centre.y - 24,
          rate: 0.8 + share * 1.4,
          color: 0x2f2c2a,
          key: -(tile + 1),
          size: 1.9,
        });

        let list = this.flames.get(tile);
        if (list && list.length !== count) {
          for (const flame of list) flame.sprite.destroy();
          list = undefined;
        }
        if (!list) {
          list = [];
          for (let i = 0; i < count && shown < MAX_VISIBLE; i++) {
            const pick = decorPick(x * 3 + i, y * 5 + i);
            const phase = (pick % 1000) / 1000;
            const sprite = new Sprite(this.textures[0]);
            const dx = ((pick >> 3) % 100) / 100 - 0.5;
            const dy = ((pick >> 7) % 100) / 100 - 0.5;
            const at = gridToScreen(x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5, base + lift);
            sprite.position.set(at.x, at.y);
            sprite.zIndex = at.y;
            this.container.addChild(sprite);
            list.push({ sprite, phase, height: 1.3 + share * 1.4 });
          }
          this.flames.set(tile, list);
        }
        shown += list.length;
      }
    }
    this.container.sortableChildren = true;
    for (const [tile, list] of this.flames) {
      if (seen.has(tile)) continue;
      for (const flame of list) flame.sprite.destroy();
      this.flames.delete(tile);
    }
  }

  private clear(): void {
    for (const list of this.flames.values()) for (const flame of list) flame.sprite.destroy();
    this.flames.clear();
  }
}
