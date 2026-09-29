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

/**
 * Rychlost v dlaždicích za sekundu při 1× podle typu silnice.
 * O pětinu pomalejší než původně (0,9 / 1,3 / 2,1) — přání autora.
 */
const SPEED = [0, 0.72, 1.04, 1.68] as const;
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
  /**
   * Svislé zkosení (radiány), které položí podélnou osu na izometrickou.
   * Generátor kreslí auta pod ~20° místo 26,6°; bez toho jela bokem (T124).
   */
  readonly skew: number;
}

/** Nejmenší rozestup mezi auty v jednom pruhu, v dlaždicích. */
const GAP_CAR = 0.3;
/** Za autobusem a náklaďákem se drží větší odstup — jsou delší. */
const GAP_LONG = 0.5;

interface Vehicle {
  sprite: Sprite;
  look: VehicleLook;
  /** Dlaždice, ze které auto vyjelo, a směr, kterým jede. */
  x: number;
  y: number;
  dir: number;
  /** Kolik z cesty mezi středy už ujelo (0–1). */
  progress: number;
  /** Pruh: index do `LANES[typ]`. Posun se k němu dotahuje plynule. */
  laneIndex: number;
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
  /**
   * Vrstva budov, ne vlastní kontejner (T124). Auto se musí **řadit mezi
   * domy**: ve vlastní vrstvě pod budovami ho na svahu uřízla podezdívka domu
   * za ním — autor to hlásil jako auta „uříznutá při klesání a stoupání".
   */
  private readonly container: Container;
  private readonly depthAt: (x: number, y: number) => number;
  private visible = true;
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

  constructor(
    world: ReadonlyWorldView,
    layer: Container,
    capacityOf: (roadType: number) => number,
    depthAt: (x: number, y: number) => number,
  ) {
    this.world = world;
    this.container = layer;
    this.capacityOf = capacityOf;
    this.depthAt = depthAt;
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
    this.visible = visible;
    for (const vehicle of this.live) vehicle.sprite.visible = visible;
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
    const lanes = this.byLane();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const vehicle = this.live[i]!;
      if (seconds > 0) {
        // Rozestup: auto nevjede do auta před sebou. Na dálnici ho předjede
        // v druhém pruhu, jinak zpomalí a počká (autor: „vjíždějí do sebe").
        const step = vehicle.speed * seconds;
        const gap = this.gapAhead(vehicle, lanes, vehicle.laneIndex);
        const need = gap.long ? GAP_LONG : GAP_CAR;
        let move = step;
        if (gap.distance - step < need) {
          const other = this.freeLane(vehicle, lanes, need);
          if (other >= 0) vehicle.laneIndex = other;
          else move = Math.max(0, gap.distance - need);
        }
        const target = LANES[this.roadAt(vehicle.x, vehicle.y)]?.[vehicle.laneIndex] ?? vehicle.lane;
        vehicle.lane += (target - vehicle.lane) * Math.min(1, seconds * 3);
        vehicle.progress += move;
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
    sprite.visible = this.visible;
    const vehicle: Vehicle = {
      sprite,
      look,
      x,
      y,
      dir,
      progress: this.random() * 0.9,
      laneIndex: -1,
      lane: 0,
      speed: 0,
      remaining: tiles,
    };
    this.turn(vehicle, dir);
    vehicle.lane = LANES[this.roadAt(x, y)]?.[vehicle.laneIndex] ?? 0.1;
    this.live.push(vehicle);
    this.place(vehicle);
  }

  /** Nastaví směr: obrázek, zrcadlení, pruh a rychlost podle silnice. */
  private turn(vehicle: Vehicle, dir: number): void {
    vehicle.dir = dir;
    const type = this.roadAt(vehicle.x, vehicle.y);
    const lanes = LANES[type] ?? [0.1];
    // Pruh se drží, dokud ho silnice má; z dálnice na ulici se sjede do jediného.
    if (vehicle.laneIndex < 0 || vehicle.laneIndex >= lanes.length) {
      vehicle.laneIndex = Math.floor(this.random() * lanes.length);
    }
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
    // Zrcadlený obrázek jede na druhou stranu, takže i zkosení je opačné.
    vehicle.sprite.skew.y = flip * image.skew;
  }

  /** Auta podle dlaždice, směru a pruhu — pro hledání toho, kdo jede vepředu. */
  private byLane(): Map<string, Vehicle[]> {
    const out = new Map<string, Vehicle[]>();
    for (const vehicle of this.live) {
      const key = `${vehicle.x},${vehicle.y},${vehicle.dir},${vehicle.laneIndex}`;
      const list = out.get(key);
      if (list) list.push(vehicle);
      else out.set(key, [vehicle]);
    }
    return out;
  }

  /** Jak daleko je nejbližší auto vepředu v daném pruhu (v dlaždicích). */
  private gapAhead(
    vehicle: Vehicle,
    lanes: Map<string, Vehicle[]>,
    lane: number,
  ): { distance: number; long: boolean } {
    let best = Infinity;
    let long = false;
    const here = lanes.get(`${vehicle.x},${vehicle.y},${vehicle.dir},${lane}`) ?? [];
    for (const other of here) {
      if (other === vehicle || other.progress <= vehicle.progress) continue;
      const distance = other.progress - vehicle.progress;
      if (distance < best) {
        best = distance;
        long = other.look.weight < 1;
      }
    }
    const nx = vehicle.x + DX[vehicle.dir]!;
    const ny = vehicle.y + DY[vehicle.dir]!;
    for (const other of lanes.get(`${nx},${ny},${vehicle.dir},${lane}`) ?? []) {
      const distance = 1 - vehicle.progress + other.progress;
      if (distance < best) {
        best = distance;
        long = other.look.weight < 1;
      }
    }
    return { distance: best, long };
  }

  /** Volný vedlejší pruh pro předjetí, nebo `-1`. */
  private freeLane(vehicle: Vehicle, lanes: Map<string, Vehicle[]>, need: number): number {
    const count = LANES[this.roadAt(vehicle.x, vehicle.y)]?.length ?? 1;
    for (let lane = 0; lane < count; lane++) {
      if (lane === vehicle.laneIndex) continue;
      const beside = lanes.get(`${vehicle.x},${vehicle.y},${vehicle.dir},${lane}`) ?? [];
      // Pruh je volný, když v něm vedle nikdo nejede a vepředu je místo.
      if (beside.some((other) => Math.abs(other.progress - vehicle.progress) < need)) continue;
      if (this.gapAhead(vehicle, lanes, lane).distance > need * 2) return lane;
    }
    return -1;
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
    // Hloubka mezi budovami: za domy, které stojí za dlaždicí, před ostatními.
    // Přiřazuje se jen při změně — každé přiřazení by vrstvu přeřazovalo.
    const depth = this.depthAt(Math.floor(gx), Math.floor(gy)) + 0.5 + at.y * 1e-6;
    if (Math.abs(vehicle.sprite.zIndex - depth) > 1e-3) vehicle.sprite.zIndex = depth;
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
