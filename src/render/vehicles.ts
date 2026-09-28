import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { groundHeightAt } from '@/sim/heights';
import { index, ROAD } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { motionRandom } from './effects';
import type { MotionView } from './effects';
import { gridToScreen } from './projection';

/**
 * Auta na silnicích (T115, `docs/17-ANIMACE.md`).
 *
 * Simulace auta nezná, zná jen **zátěž dlaždice** (`trafficLoad`). Tahle
 * vrstva si z ní vyrobí falešná auta: na viditelných silnicích drží počet
 * úměrný zátěži, takže ucpaná ulice je vidět i bez overlaye a overlay s auty
 * si neodporují. Na simulaci nesahá a `world.rng` nepoužívá.
 *
 * Auto jede **od středu dlaždice ke středu sousední** a na středu si vybere,
 * kam dál. Otočí se jen ve slepé ulici. Jezdí se vpravo — posun do strany
 * závisí na šířce silnice.
 *
 * Čtyři směry jízdy stojí na **dvou obrázcích**: zepředu jede doprava dolů
 * (východ), zezadu doprava nahoru (sever). Vodorovně překlopené jedou na jih
 * a na západ.
 */

/** Směry: sever (`y − 1`), východ, jih, západ — stejně jako maska silnic. */
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/** Rychlost v dlaždicích za sekundu při 1× podle typu silnice. */
const SPEED = [0, 0.9, 1.3, 2.1] as const;
/** Kam se jezdí vpravo: posun od osy v podílu dlaždice. Dálnice má dva pruhy. */
const LANES: readonly (readonly number[])[] = [[], [0.09], [0.13], [0.11, 0.26]];

/** Kolik aut na dlaždici při plné zátěži. Prázdná silnice má pořád pár aut. */
const DENSITY_FULL = 0.9;
const DENSITY_EMPTY = 0.05;
/** Strop aut ve výřezu. Víc by na velkém monitoru bylo vidět jen jako šum. */
const MAX_VEHICLES = 400;
/** Pod tímhle zoomem jsou auta pár pixelů a jen zrní obraz. */
export const VEHICLES_MIN_ZOOM = 0.45;

/** Dvojice obrázků jednoho vozidla: zepředu (jede na východ) a zezadu (na sever). */
export interface VehicleLook {
  readonly front: VehicleImage;
  readonly rear: VehicleImage;
  /** Jak často se ve městě objeví, relativně k ostatním. */
  readonly weight: number;
}

export interface VehicleImage {
  readonly texture: Texture;
  /** Kotva v pixelech obrázku: střed podvozku. */
  readonly anchor: readonly [number, number];
  /** Obrázek je `scale`× větší než při zoomu 1. */
  readonly scale: number;
}

interface Vehicle {
  sprite: Sprite;
  look: VehicleLook;
  /** Dlaždice, ze které auto vyjelo, a směr, kterým jede. */
  x: number;
  y: number;
  dir: number;
  /** Kolik z cesty mezi středy už ujelo (0–1). */
  progress: number;
  lane: number;
  /** Rychlost v dlaždicích za sekundu, už se zohledněnou zátěží. */
  speed: number;
  /** Vozidlo služby: kolik dlaždic ještě ujede, než zmizí. */
  remaining: number;
}

/** Rozsah dlaždic, které jsou vidět. */
interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Vehicles {
  private readonly world: ReadonlyWorldView;
  private readonly container = new Container();
  private readonly capacityOf: (roadType: number) => number;
  private readonly live: Vehicle[] = [];
  private readonly pool: Sprite[] = [];
  private readonly random = motionRandom(0xca75);
  private looks: readonly VehicleLook[] = [];
  private lookTotal = 0;
  private enabled = true;
  /** Kolik aut má ve výřezu jezdit. Přepočítává se jednou za čas, ne každý snímek. */
  private target = 0;
  private recount = 0;
  private range: TileRange = { x0: 0, y0: 0, x1: -1, y1: -1 };
  /** Silnice ve výřezu z posledního přepočtu — z nich se losuje, kde auto vyjede. */
  private roads: number[] = [];

  constructor(world: ReadonlyWorldView, parent: Container, capacityOf: (roadType: number) => number) {
    this.world = world;
    this.capacityOf = capacityOf;
    this.container.sortableChildren = true;
    parent.addChild(this.container);
  }

  setLooks(looks: readonly VehicleLook[]): void {
    this.looks = looks;
    this.lookTotal = looks.reduce((sum, look) => sum + look.weight, 0);
    this.clear();
  }

  /** Vypne auta. Vypnutá se nejen schovají, ale zahodí — nic se nepočítá. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Pošle z budovy služby jedno vozidlo (T118): policejní auto na obchůzku,
   * hasiče, popeláře. Vyjede na silnici vedle budovy, projede pár dlaždic
   * a zmizí. Vrací `false`, když vedle budovy silnice není.
   */
  dispatch(look: VehicleLook, x: number, y: number, width: number, depth: number, tiles: number): boolean {
    if (!this.enabled || this.live.length >= MAX_VEHICLES) return false;
    // Silnice podél obvodu parcely; vyjíždí se směrem od budovy po silnici.
    const exits: [number, number][] = [];
    for (let i = 0; i < width; i++) exits.push([x + i, y - 1], [x + i, y + depth]);
    for (let j = 0; j < depth; j++) exits.push([x - 1, y + j], [x + width, y + j]);
    const roads = exits.filter(([ex, ey]) => this.roadAt(ex, ey) !== ROAD.none);
    if (roads.length === 0) return false;
    const [rx, ry] = roads[Math.floor(this.random() * roads.length)]!;
    const dir = this.pickDirection(rx, ry, -1);
    if (dir < 0) return false;
    this.spawnAt(rx, ry, dir, look, tiles);
    return true;
  }

  update(deltaMS: number, speedFactor: number, view: MotionView, zoom: number): void {
    const hidden = !this.enabled || zoom < VEHICLES_MIN_ZOOM || this.looks.length === 0;
    this.container.visible = !hidden;
    if (hidden) {
      if (this.live.length > 0) this.clear();
      return;
    }

    this.recount -= deltaMS;
    if (this.recount <= 0) {
      this.recount = 600;
      this.range = tilesIn(view, this.world.size);
      this.countRoads();
    }

    // Doplní se po pár kusech za snímek, ať se po posunu kamery neobjeví
    // stovka aut naráz.
    for (let i = 0; i < 6 && this.live.length < this.target && this.roads.length > 0; i++) {
      const tile = this.roads[Math.floor(this.random() * this.roads.length)]!;
      const x = tile % this.world.size;
      const y = (tile - x) / this.world.size;
      const dir = this.pickDirection(x, y, -1);
      if (dir >= 0) this.spawnAt(x, y, dir, this.pickLook(), Infinity);
    }

    const seconds = (deltaMS / 1000) * speedFactor;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const vehicle = this.live[i]!;
      if (seconds > 0) {
        vehicle.progress += vehicle.speed * seconds;
        while (vehicle.progress >= 1) {
          vehicle.progress -= 1;
          vehicle.x += DX[vehicle.dir]!;
          vehicle.y += DY[vehicle.dir]!;
          vehicle.remaining -= 1;
          const next = this.pickDirection(vehicle.x, vehicle.y, vehicle.dir);
          if (next < 0 || vehicle.remaining <= 0 || !this.inRange(vehicle.x, vehicle.y)) {
            vehicle.progress = -1;
            break;
          }
          this.turn(vehicle, next);
        }
      }
      if (vehicle.progress < 0) {
        this.release(i);
        continue;
      }
      this.place(vehicle);
    }
  }

  /** Přepočítá, kolik aut má být vidět, podle zátěže silnic ve výřezu. */
  private countRoads(): void {
    const { x0, y0, x1, y1 } = this.range;
    const size = this.world.size;
    const roads: number[] = [];
    let wanted = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = index(x, y, size);
        const type = this.world.layers.road[tile] ?? ROAD.none;
        if (type === ROAD.none) continue;
        roads.push(tile);
        const capacity = this.capacityOf(type);
        const ratio = capacity > 0 ? Math.min(1, (this.world.trafficLoad[tile] ?? 0) / capacity) : 0;
        wanted += DENSITY_EMPTY + (DENSITY_FULL - DENSITY_EMPTY) * ratio;
      }
    }
    this.roads = roads;
    this.target = Math.min(MAX_VEHICLES, Math.round(wanted));
  }

  private pickLook(): VehicleLook {
    let roll = this.random() * this.lookTotal;
    for (const look of this.looks) {
      roll -= look.weight;
      if (roll <= 0) return look;
    }
    return this.looks[this.looks.length - 1]!;
  }

  /**
   * Kam jet z dlaždice dál. Zpátky jen když jinam nejde; `-1`, když
   * dlaždice silnice není vůbec.
   */
  private pickDirection(x: number, y: number, from: number): number {
    if (this.roadAt(x, y) === ROAD.none) return -1;
    const back = from < 0 ? -1 : (from + 2) % 4;
    const options: number[] = [];
    for (let dir = 0; dir < 4; dir++) {
      if (dir === back) continue;
      if (this.roadAt(x + DX[dir]!, y + DY[dir]!) !== ROAD.none) options.push(dir);
    }
    if (options.length === 0) {
      return back >= 0 && this.roadAt(x + DX[back]!, y + DY[back]!) !== ROAD.none ? back : -1;
    }
    // Rovně jede auto častěji než do zatáčky — jinak kličkuje jako opilé.
    if (from >= 0 && options.includes(from) && this.random() < 0.6) return from;
    return options[Math.floor(this.random() * options.length)]!;
  }

  private spawnAt(x: number, y: number, dir: number, look: VehicleLook, tiles: number): void {
    const sprite = this.pool.pop() ?? new Sprite();
    this.container.addChild(sprite);
    const vehicle: Vehicle = {
      sprite,
      look,
      x,
      y,
      dir,
      progress: this.random() * 0.9,
      lane: 0,
      speed: 0,
      remaining: tiles,
    };
    this.turn(vehicle, dir);
    this.live.push(vehicle);
    this.place(vehicle);
  }

  /** Nastaví směr: obrázek, zrcadlení, pruh a rychlost podle silnice. */
  private turn(vehicle: Vehicle, dir: number): void {
    vehicle.dir = dir;
    const type = this.roadAt(vehicle.x, vehicle.y);
    const lanes = LANES[type] ?? [0.1];
    vehicle.lane = lanes[Math.floor(this.random() * lanes.length)] ?? 0.1;
    const capacity = this.capacityOf(type);
    const tile = index(vehicle.x, vehicle.y, this.world.size);
    const ratio = capacity > 0 ? Math.min(1, (this.world.trafficLoad[tile] ?? 0) / capacity) : 0;
    // V zácpě se jede pomalu; o kus pomaleji jedou i nákladní a autobus.
    vehicle.speed =
      (SPEED[type] ?? 1) * (1 - 0.65 * ratio) * (0.85 + this.random() * 0.3) * (vehicle.look.weight < 1 ? 0.8 : 1);

    // Východ = zepředu, jih = zepředu zrcadlově, sever = zezadu, západ = zezadu zrcadlově.
    const image = dir === 1 || dir === 2 ? vehicle.look.front : vehicle.look.rear;
    const flip = dir === 2 || dir === 3 ? -1 : 1;
    vehicle.sprite.texture = image.texture;
    vehicle.sprite.anchor.set(image.anchor[0] / image.texture.width, image.anchor[1] / image.texture.height);
    vehicle.sprite.scale.set(flip / image.scale, 1 / image.scale);
  }

  /** Poloha na obrazovce: od středu dlaždice ke středu sousední, vpravo od osy. */
  private place(vehicle: Vehicle): void {
    const dx = DX[vehicle.dir]!;
    const dy = DY[vehicle.dir]!;
    // Vpravo od směru jízdy: otočení vektoru směru o 90° po směru hodinek.
    const gx = vehicle.x + 0.5 + dx * vehicle.progress - dy * vehicle.lane;
    const gy = vehicle.y + 0.5 + dy * vehicle.progress + dx * vehicle.lane;
    const at = gridToScreen(gx, gy, groundHeightAt(this.world.cornerHeight, gx, gy));
    vehicle.sprite.position.set(at.x, at.y);
    vehicle.sprite.zIndex = at.y;
  }

  private roadAt(x: number, y: number): number {
    const size = this.world.size;
    if (x < 0 || y < 0 || x >= size || y >= size) return ROAD.none;
    return this.world.layers.road[index(x, y, size)] ?? ROAD.none;
  }

  private inRange(x: number, y: number): boolean {
    const { x0, y0, x1, y1 } = this.range;
    return x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2;
  }

  private release(i: number): void {
    const vehicle = this.live[i]!;
    this.live[i] = this.live[this.live.length - 1]!;
    this.live.pop();
    vehicle.sprite.removeFromParent();
    this.pool.push(vehicle.sprite);
  }

  private clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.release(i);
  }

  destroy(): void {
    this.clear();
    for (const sprite of this.pool) sprite.destroy();
    this.container.destroy();
  }
}

/**
 * Dlaždice, které jsou (i s rezervou) vidět.
 *
 * Obrazovka je v izometrii kosočtverec mřížky, takže se vezmou čtyři rohy
 * obdélníku a jejich obálka. Výška terénu posouvá dlaždice nahoru, proto se
 * spodní okraj natahuje o kus navíc.
 */
export function tilesIn(view: MotionView, size: number): TileRange {
  const toGrid = (sx: number, sy: number): [number, number] => [
    (sx / 32 + sy / 16) / 2,
    (sy / 16 - sx / 32) / 2,
  ];
  const corners = [
    toGrid(view.minX, view.minY),
    toGrid(view.maxX, view.minY),
    toGrid(view.minX, view.maxY),
    toGrid(view.maxX, view.maxY),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const margin = 2;
  const lift = 6;
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs)) - margin),
    y0: Math.max(0, Math.floor(Math.min(...ys)) - margin),
    x1: Math.min(size - 1, Math.ceil(Math.max(...xs)) + margin + lift),
    y1: Math.min(size - 1, Math.ceil(Math.max(...ys)) + margin + lift),
  };
}
