import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { groundHeightAt } from '@/sim/heights';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { motionRandom } from './effects';
import type { MotionView } from './effects';
import { gridToScreen } from './projection';
import { tilesIn } from './vehicles';

/**
 * Lidé u zastávek a metra (T118, `docs/17-ANIMACE.md` bod 5).
 *
 * Autor: „u metra prochází lidé. Na zastávkách chvíli sedí, chvíli ne…“
 *
 * - **Sedící**: na lavičkách zastávek (body `vanilla:seat` v `effects.json`)
 *   si lidé sedají a vstávají. Jednou za čas přijede spoj a lavička se
 *   vyprázdní. Kdy spoj přijede, simulace **neví** — zná jen počet vozů
 *   a cestujících linky —, takže i příjezd je kosmetika.
 * - **Chodci**: k zastávce a metru přicházejí lidé z okolí a mizí ve vchodu,
 *   jiní z něj odcházejí. Jdou do L, nejdřív po jedné ose, pak po druhé,
 *   stejnými čtyřmi směry jako auta.
 *
 * Jen vzhled, na simulaci nesahá a `world.rng` nepoužívá.
 */

export interface PersonImage {
  readonly texture: Texture;
  readonly anchor: readonly [number, number];
}

/** Obrázky: chůze k divákovi (na východ), od diváka (na sever) a sezení. */
export interface PeopleLooks {
  readonly front: readonly PersonImage[];
  readonly rear: readonly PersonImage[];
  readonly sit: readonly PersonImage[];
}

/** Vchod budovy, ke kterému se chodí. Mřížkové souřadnice. */
export interface Entrance {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Jak často tam někdo přijde, relativně (metro víc než zastávka). */
  readonly busy: number;
}

/** Pod tímhle zoomem je člověk pixel. */
export const PEOPLE_MIN_ZOOM = 0.9;
const MAX_WALKERS = 160;
/** Rychlost chůze v dlaždicích za sekundu při 1×. */
const WALK_SPEED = 0.32;
/** Obrázky jsou ve čtyřnásobku. */
const SCALE = 4;

interface Walker {
  sprite: Sprite;
  image: number;
  /** Cesta: body v mřížce, jde se od prvního k poslednímu. */
  path: [number, number][];
  leg: number;
  progress: number;
  /** Kde začal a skončí vidět — mizí do vchodu, vynořuje se z něj. */
  fadeIn: boolean;
  fadeOut: boolean;
}

interface Bench {
  /** Obsazení míst: kdo na kterém sedí, nebo `null`. */
  sitting: (Sprite | null)[];
  clock: number;
  arrival: number;
}

export class People {
  private readonly world: ReadonlyWorldView;
  private readonly container = new Container();
  private readonly random = motionRandom(0x9e0e);
  private looks: PeopleLooks = { front: [], rear: [], sit: [] };
  private readonly walkers: Walker[] = [];
  private readonly benches = new Map<number, Bench>();
  private readonly clocks = new Map<number, number>();
  private enabled = true;

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    // Nad budovami: člověk na lavičce sedí **před** přístřeškem, a kdyby byl
    // pod budovami, zakryl by ho obrázek zastávky, na které sedí.
    this.container.zIndex = 850_000;
    this.container.sortableChildren = true;
    parent.addChild(this.container);
  }

  setLooks(looks: PeopleLooks): void {
    this.looks = looks;
    this.clear();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  update(
    deltaMS: number,
    speedFactor: number,
    view: MotionView,
    zoom: number,
    seats: ReadonlyMap<number, readonly { x: number; y: number }[]>,
    entrances: readonly Entrance[],
  ): void {
    const hidden = !this.enabled || zoom < PEOPLE_MIN_ZOOM || this.looks.front.length === 0;
    this.container.visible = !hidden;
    if (hidden) {
      if (this.walkers.length > 0 || this.benches.size > 0) this.clear();
      return;
    }
    const elapsed = deltaMS * speedFactor;
    this.updateBenches(elapsed, seats, view);
    this.spawnWalkers(elapsed, entrances, view);
    this.moveWalkers(deltaMS * speedFactor);
  }

  /** Lavičky: sem tam si někdo sedne nebo vstane, po příjezdu spoje prázdno. */
  private updateBenches(
    elapsed: number,
    seats: ReadonlyMap<number, readonly { x: number; y: number }[]>,
    view: MotionView,
  ): void {
    for (const [id, bench] of this.benches) {
      if (seats.has(id)) continue;
      for (const person of bench.sitting) person?.destroy();
      this.benches.delete(id);
    }
    if (this.looks.sit.length === 0) return;
    for (const [id, spots] of seats) {
      const first = spots[0];
      if (!first || first.x < view.minX - 60 || first.x > view.maxX + 60 || first.y < view.minY - 60 || first.y > view.maxY + 60) {
        continue;
      }
      let bench = this.benches.get(id);
      if (!bench) {
        bench = {
          sitting: spots.map(() => null),
          clock: 1000 + this.random() * 4000,
          arrival: 20000 + this.random() * 25000,
        };
        this.benches.set(id, bench);
      }
      if (elapsed <= 0) continue;
      bench.clock -= elapsed;
      bench.arrival -= elapsed;
      if (bench.arrival <= 0) {
        // Přijel spoj: všichni nastoupí.
        bench.arrival = 20000 + this.random() * 25000;
        for (let i = 0; i < bench.sitting.length; i++) {
          bench.sitting[i]?.destroy();
          bench.sitting[i] = null;
        }
        continue;
      }
      if (bench.clock > 0) continue;
      bench.clock = 2500 + this.random() * 6000;
      const i = Math.floor(this.random() * spots.length);
      const spot = spots[i];
      if (!spot) continue;
      const current = bench.sitting[i];
      if (current) {
        // Vstát je méně časté než si sednout — lavička se pomalu plní.
        if (this.random() < 0.3) {
          current.destroy();
          bench.sitting[i] = null;
        }
        continue;
      }
      const look = this.looks.sit[Math.floor(this.random() * this.looks.sit.length)]!;
      const sprite = new Sprite(look.texture);
      sprite.anchor.set(look.anchor[0] / look.texture.width, look.anchor[1] / look.texture.height);
      sprite.scale.set((this.random() < 0.5 ? -1 : 1) / SCALE, 1 / SCALE);
      sprite.position.set(spot.x, spot.y);
      sprite.zIndex = spot.y;
      this.container.addChild(sprite);
      bench.sitting[i] = sprite;
    }
  }

  private spawnWalkers(elapsed: number, entrances: readonly Entrance[], view: MotionView): void {
    if (elapsed <= 0) return;
    const range = tilesIn(view, this.world.size);
    for (const entrance of entrances) {
      if (entrance.x < range.x0 || entrance.x > range.x1 || entrance.y < range.y0 || entrance.y > range.y1) {
        continue;
      }
      const left = (this.clocks.get(entrance.id) ?? this.random() * 3000) - elapsed;
      if (left > 0) {
        this.clocks.set(entrance.id, left);
        continue;
      }
      this.clocks.set(entrance.id, (2200 + this.random() * 3500) / entrance.busy);
      if (this.walkers.length >= MAX_WALKERS) continue;

      // Odkud: bod dvě až tři dlaždice daleko, na kraji dlaždice — tam, kde
      // by vedl chodník. Cesta do L: po jedné ose, pak po druhé.
      const angle = Math.floor(this.random() * 4);
      const far = 2 + this.random() * 1.5;
      const side = (this.random() - 0.5) * 2.5;
      const sx = entrance.x + (angle === 0 ? far : angle === 2 ? -far : side);
      const sy = entrance.y + (angle === 1 ? far : angle === 3 ? -far : side);
      const corner: [number, number] = this.random() < 0.5 ? [entrance.x, sy] : [sx, entrance.y];
      const toward = this.random() < 0.6;
      const path: [number, number][] = toward
        ? [[sx, sy], corner, [entrance.x, entrance.y]]
        : [[entrance.x, entrance.y], corner, [sx, sy]];
      const image = Math.floor(this.random() * Math.min(this.looks.front.length, this.looks.rear.length));
      const sprite = new Sprite();
      this.container.addChild(sprite);
      this.walkers.push({ sprite, image, path, leg: 0, progress: 0, fadeIn: !toward, fadeOut: toward });
    }
  }

  private moveWalkers(elapsed: number): void {
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const walker = this.walkers[i]!;
      const from = walker.path[walker.leg];
      const to = walker.path[walker.leg + 1];
      if (!from || !to) {
        walker.sprite.destroy();
        this.walkers.splice(i, 1);
        continue;
      }
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (length < 1e-3) {
        walker.leg++;
        continue;
      }
      walker.progress += ((WALK_SPEED * elapsed) / 1000) / length;
      if (walker.progress >= 1) {
        walker.leg++;
        walker.progress = 0;
        continue;
      }
      const gx = from[0] + (to[0] - from[0]) * walker.progress;
      const gy = from[1] + (to[1] - from[1]) * walker.progress;
      // Směr podle převažující osy úseku, stejně jako u aut: východ a jih
      // zepředu, sever a západ zezadu; jih a západ zrcadlově.
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      const set = dir === 1 || dir === 2 ? this.looks.front : this.looks.rear;
      const look = set[walker.image % set.length]!;
      if (walker.sprite.texture !== look.texture) {
        walker.sprite.texture = look.texture;
        walker.sprite.anchor.set(look.anchor[0] / look.texture.width, look.anchor[1] / look.texture.height);
      }
      const flip = dir === 2 || dir === 3 ? -1 : 1;
      walker.sprite.scale.set(flip / SCALE, 1 / SCALE);
      const at = gridToScreen(gx, gy, groundHeightAt(this.world.cornerHeight, gx, gy));
      walker.sprite.position.set(at.x, at.y);
      walker.sprite.zIndex = at.y;
      // Vynoří se z vchodu a zmizí v něm, ne že by se objevil z ničeho.
      const legs = walker.path.length - 1;
      const total = (walker.leg + walker.progress) / legs;
      walker.sprite.alpha = Math.min(walker.fadeIn ? total * 6 : 1, walker.fadeOut ? (1 - total) * 6 : 1, 1);
    }
  }

  private clear(): void {
    for (const walker of this.walkers) walker.sprite.destroy();
    this.walkers.length = 0;
    for (const bench of this.benches.values()) for (const person of bench.sitting) person?.destroy();
    this.benches.clear();
  }
}
