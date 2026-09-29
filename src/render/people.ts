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
 *   jiní z něj odcházejí. Jdou **po silnici**, podél jejího kraje — do T124
 *   chodili do L přímo, a tedy i přes domy (hlásil autor). Poslední krok
 *   vede ze silnice k parcele.
 *
 * Jen vzhled, na simulaci nesahá a `world.rng` nepoužívá.
 */

export interface PersonImage {
  readonly texture: Texture;
  readonly anchor: readonly [number, number];
}

/**
 * Obrázky: chůze k divákovi (na východ), od diváka (na sever) a sezení.
 *
 * Chůze je **po postavách a fázích kroku** (T126): `front[postava][fáze]`.
 * Autor chtěl, aby chodci hýbali rukama a nohama; postava s jedinou fází
 * se prostě posouvá, jako dřív.
 */
export interface PeopleLooks {
  readonly front: readonly (readonly PersonImage[])[];
  readonly rear: readonly (readonly PersonImage[])[];
  readonly sit: readonly PersonImage[];
}

/** Kolik fází kroku připadá na jednu dlaždici chůze. */
const FRAMES_PER_TILE = 22;

/** Budova, ke které se chodí: parcela v mřížce. */
export interface Entrance {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly depth: number;
  /** Jak často tam někdo přijde, relativně (metro víc než zastávka). */
  readonly busy: number;
}

const STEP_X = [0, 1, 0, -1] as const;
const STEP_Y = [-1, 0, 1, 0] as const;
/** Jak daleko od osy silnice chodec jde — u kraje, kde by byl chodník. */
const WALK_SIDE = 0.4;

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
  /** Ušlá vzdálenost v dlaždicích — podle ní se střídají fáze kroku. */
  walked: number;
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
  /** Vrstva budov: lidé se řadí s domy stejně jako auta (T124). */
  private readonly container: Container;
  private readonly depthAt: (x: number, y: number) => number;
  private readonly zIndexOf: (buildingId: number) => number;
  private visible = true;
  private readonly random = motionRandom(0x9e0e);
  private looks: PeopleLooks = { front: [], rear: [], sit: [] };
  private readonly walkers: Walker[] = [];
  private readonly benches = new Map<number, Bench>();
  private readonly clocks = new Map<number, number>();
  private enabled = true;

  constructor(
    world: ReadonlyWorldView,
    layer: Container,
    depthAt: (x: number, y: number) => number,
    zIndexOf: (buildingId: number) => number,
  ) {
    this.world = world;
    this.container = layer;
    this.depthAt = depthAt;
    this.zIndexOf = zIndexOf;
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
    this.visible = visible;
    for (const walker of this.walkers) walker.sprite.visible = visible;
    for (const bench of this.benches.values()) for (const person of bench.sitting) if (person) person.visible = visible;
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
      // Hned za svou zastávkou: před přístřeškem, pod domy vepředu.
      sprite.zIndex = this.zIndexOf(id) + 0.6;
      sprite.visible = this.visible;
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

      const route = this.route(entrance);
      if (route === null) continue;
      const toward = this.random() < 0.6;
      const path = toward ? route.reverse() : route;
      const image = Math.floor(this.random() * Math.min(this.looks.front.length, this.looks.rear.length));
      const sprite = new Sprite();
      sprite.visible = this.visible;
      this.container.addChild(sprite);
      this.walkers.push({ sprite, image, walked: this.random() * 4, path, leg: 0, progress: 0, fadeIn: !toward, fadeOut: toward });
    }
  }

  /**
   * Cesta od budovy po silnici: bod u parcely, pak podél silnice dvě až šest
   * dlaždic daleko. `null`, když u budovy silnice není.
   */
  private route(entrance: Entrance): [number, number][] | null {
    const size = this.world.size;
    const road = this.world.layers.road;
    const isRoad = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < size && y < size && (road[y * size + x] ?? 0) !== 0;

    // Silnice podél obvodu parcely.
    const starts: [number, number][] = [];
    for (let i = 0; i < entrance.width; i++) {
      starts.push([entrance.x + i, entrance.y - 1], [entrance.x + i, entrance.y + entrance.depth]);
    }
    for (let j = 0; j < entrance.depth; j++) {
      starts.push([entrance.x - 1, entrance.y + j], [entrance.x + entrance.width, entrance.y + j]);
    }
    const roads = starts.filter(([x, y]) => isRoad(x, y));
    if (roads.length === 0) return null;
    const [rx, ry] = roads[Math.floor(this.random() * roads.length)]!;

    // Do šířky po silnici, nejvýš šest kroků; cíl je náhodná dlaždice
    // aspoň dva kroky daleko.
    const parent = new Map<number, number>([[ry * size + rx, -1]]);
    let frontier = [ry * size + rx];
    const far: number[] = [];
    for (let depth = 1; depth <= 6 && frontier.length > 0; depth++) {
      const next: number[] = [];
      for (const tile of frontier) {
        const x = tile % size;
        const y = (tile - x) / size;
        for (let dir = 0; dir < 4; dir++) {
          const nx = x + STEP_X[dir]!;
          const ny = y + STEP_Y[dir]!;
          const key = ny * size + nx;
          if (!isRoad(nx, ny) || parent.has(key)) continue;
          parent.set(key, tile);
          next.push(key);
          if (depth >= 2) far.push(key);
        }
      }
      frontier = next;
    }
    const goal = far.length > 0 ? far[Math.floor(this.random() * far.length)]! : ry * size + rx;
    const tiles: number[] = [];
    for (let tile = goal; tile !== -1; tile = parent.get(tile) ?? -1) tiles.push(tile);
    tiles.reverse();

    // Body: střed dlaždice posunutý ke kraji, vpravo od směru chůze.
    const points: [number, number][] = [];
    // Krok od budovy: nejbližší bod parcely k první dlaždici silnice.
    const cx = Math.min(Math.max(rx + 0.5, entrance.x), entrance.x + entrance.width);
    const cy = Math.min(Math.max(ry + 0.5, entrance.y), entrance.y + entrance.depth);
    points.push([cx, cy]);
    for (let k = 0; k < tiles.length; k++) {
      const tile = tiles[k]!;
      const x = tile % size;
      const y = (tile - x) / size;
      const ahead = tiles[k + 1] ?? tiles[k - 1];
      const ax = ahead === undefined ? x : ahead % size;
      const ay = ahead === undefined ? y : (ahead - ax) / size;
      let dx = Math.sign(ax - x);
      let dy = Math.sign(ay - y);
      if (tiles[k + 1] === undefined) {
        dx = -dx;
        dy = -dy;
      }
      points.push([x + 0.5 - dy * WALK_SIDE, y + 0.5 + dx * WALK_SIDE]);
    }
    return points;
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
      walker.walked += (WALK_SPEED * elapsed) / 1000;
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
      const frames = set[walker.image % set.length]!;
      const look = frames[Math.floor(walker.walked * FRAMES_PER_TILE) % frames.length]!;
      if (walker.sprite.texture !== look.texture) {
        walker.sprite.texture = look.texture;
        walker.sprite.anchor.set(look.anchor[0] / look.texture.width, look.anchor[1] / look.texture.height);
      }
      const flip = dir === 2 || dir === 3 ? -1 : 1;
      walker.sprite.scale.set(flip / SCALE, 1 / SCALE);
      const at = gridToScreen(gx, gy, groundHeightAt(this.world.cornerHeight, gx, gy));
      walker.sprite.position.set(at.x, at.y);
      const depth = this.depthAt(Math.floor(gx), Math.floor(gy)) + 0.5 + at.y * 1e-6;
      if (Math.abs(walker.sprite.zIndex - depth) > 1e-3) walker.sprite.zIndex = depth;
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
