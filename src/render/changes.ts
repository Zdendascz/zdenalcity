import type { ReadonlyWorldView } from '@/sim/simHost';
import type { DirtySet } from '@/sim/world';

/**
 * Co se od minulého snímku změnilo, **roztříděné podle druhu** (T133).
 *
 * `DirtySet` ze simulace říká jen „na téhle dlaždici se něco stalo". Renderer
 * s tím dřív zacházel jako s nejhorším případem: jedna dlaždice v ohni
 * přestavěla všechny stromy (90–130 ms), lampy, vedení a celou silniční síť
 * (190 ms kreslení + 266 ms teselace). Oheň přitom značí hořící dlaždice
 * každé dva tiky — při požáru hra skoro stála.
 *
 * Druh změny se **nezjišťuje od simulace, ale porovnáním se snímkem vrstev**.
 * Simulace by musela u každého `markTileDirty` říct, co změnila, a na jedno
 * zapomenuté místo by se přišlo až podle chybějícího stromu. Porovnání se
 * nesplete: renderer si pamatuje, jak dlaždice vypadala, když ji kreslil,
 * a projde jen dlaždice z `dirty.tiles`.
 *
 * Dlaždice, na které se nepozná žádný rozdíl, spadne do `other` — třeba
 * oheň, povodeň nebo proud. Ty se kreslí jen v překryvné vrstvě chunku.
 */
export interface FrameChanges {
  /** Surová množina ze simulace, pro ty, kdo ji chtějí celou. */
  readonly dirty: DirtySet;
  /** Načtení savu, nový svět: překreslí se všechno. */
  readonly full: boolean;
  /** Druh terénu nebo výška některého rohu. Mění povrch, pásy, stromy. */
  readonly surface: readonly number[];
  readonly road: readonly number[];
  readonly wire: readonly number[];
  /** `buildingId` nebo zóna. */
  readonly parcel: readonly number[];
  readonly rubble: readonly number[];
  /** Nic z výše uvedeného — oheň, povodeň, proud, voda v trubkách. */
  readonly other: readonly number[];
  /**
   * Budovy, které se musí překreslit: vznikly, zmizely, nebo se jim změnila
   * definice, úroveň, zchátrání, proud či terén pod nimi.
   *
   * **Ne počet obyvatel.** Ten se mění stovkám domů každých pár tiků a na
   * budově není vidět; dřív kvůli němu šla znovu celá silniční síť.
   */
  readonly buildings: readonly number[];
  /**
   * Dlaždice silnic, kterým se mohl změnit chodník: soused budovy, která
   * vznikla, zmizela, povýšila nebo zchátrala (`houseSides`).
   */
  readonly streets: readonly number[];
}

/** Jak budova vypadá — co z ní renderer kreslí. */
interface Known {
  identity: string;
  /** Dává budova chodník sousední silnici? */
  sidewalk: boolean;
  x: number;
  y: number;
  width: number;
  depth: number;
}

/** Od kolikáté úrovně má dům u silnice chodník. Viz `streets.ts`. */
const SIDEWALK_MIN_LEVEL = 2;

export class ChangeTracker {
  private readonly world: ReadonlyWorldView;
  private terrain = new Uint8Array(0);
  private road = new Uint8Array(0);
  private wire = new Uint8Array(0);
  private zone = new Uint8Array(0);
  private buildingId = new Uint32Array(0);
  private rubble = new Uint8Array(0);
  private heights = new Uint8Array(0);
  private readonly known = new Map<number, Known>();

  constructor(world: ReadonlyWorldView) {
    this.world = world;
  }

  /** Roztřídí `dirty` a srovná snímek se světem. */
  collect(dirty: DirtySet): FrameChanges {
    const world = this.world;
    const size = world.size;
    const cells = size * size;
    const full = dirty.fullRedraw || this.terrain.length !== cells;
    if (full) {
      this.snapshot();
      return {
        dirty,
        full: true,
        surface: [],
        road: [],
        wire: [],
        parcel: [],
        rubble: [],
        other: [],
        buildings: [...world.buildings.keys()],
        streets: [],
      };
    }

    const surface: number[] = [];
    const road: number[] = [];
    const wire: number[] = [];
    const parcel: number[] = [];
    const rubble: number[] = [];
    const other: number[] = [];
    const layers = world.layers;
    const corners = world.cornerHeight;
    const stride = size + 1;
    // Rohy se porovnávají pro všechny dlaždice dřív, než se snímek přepíše:
    // roh sdílejí čtyři dlaždice a každá se musí dozvědět, že se pohnul.
    const movedCorners: number[] = [];
    for (const tile of dirty.tiles) {
      const x = tile % size;
      const y = (tile - x) / size;
      const c = y * stride + x;
      let kind = 0;
      if (dirty.heightsChanged) {
        for (const corner of [c, c + 1, c + stride, c + stride + 1]) {
          if (corners[corner] !== this.heights[corner]) {
            kind |= 1;
            movedCorners.push(corner);
          }
        }
      }
      if (layers.terrain[tile] !== this.terrain[tile]) {
        this.terrain[tile] = layers.terrain[tile] ?? 0;
        kind |= 1;
      }
      if (kind & 1) surface.push(tile);
      if (layers.road[tile] !== this.road[tile]) {
        this.road[tile] = layers.road[tile] ?? 0;
        road.push(tile);
        kind |= 2;
      }
      if (layers.wire[tile] !== this.wire[tile]) {
        this.wire[tile] = layers.wire[tile] ?? 0;
        wire.push(tile);
        kind |= 4;
      }
      if (layers.buildingId[tile] !== this.buildingId[tile] || layers.zone[tile] !== this.zone[tile]) {
        this.buildingId[tile] = layers.buildingId[tile] ?? 0;
        this.zone[tile] = layers.zone[tile] ?? 0;
        parcel.push(tile);
        kind |= 8;
      }
      if (world.rubble[tile] !== this.rubble[tile]) {
        this.rubble[tile] = world.rubble[tile] ?? 0;
        rubble.push(tile);
        kind |= 16;
      }
      if (kind === 0) other.push(tile);
    }
    for (const corner of movedCorners) this.heights[corner] = corners[corner] ?? 0;

    // Budovy: překreslit jen ty, kterým se změnil vzhled.
    const buildings: number[] = [];
    const streetTiles = new Set<number>();
    for (const id of dirty.buildings) {
      const building = world.buildings.get(id);
      const previous = this.known.get(id);
      const next = building === undefined ? undefined : this.describe(id, building);
      const changed =
        previous?.identity !== next?.identity ||
        // Terén pod ní se pohnul — `markTerrainChanged` ji proto do `dirty`
        // přidal. Podezdívka i výška obrázku se musí přepočítat.
        (dirty.heightsChanged && next !== undefined);
      if (!changed) continue;
      buildings.push(id);
      if (next === undefined) this.known.delete(id);
      else this.known.set(id, next);
      if ((previous?.sidewalk ?? false) !== (next?.sidewalk ?? false)) {
        if (previous) this.streetsAround(previous, streetTiles);
        if (next) this.streetsAround(next, streetTiles);
      }
    }
    // Nová nebo zmizelá parcela u silnice: chodník se mohl objevit či zmizet.
    for (const tile of parcel) this.streetsAround({ x: tile % size, y: Math.floor(tile / size), width: 1, depth: 1 }, streetTiles);

    return {
      dirty,
      full: false,
      surface,
      road,
      wire,
      parcel,
      rubble,
      other,
      buildings,
      streets: [...streetTiles],
    };
  }

  private describe(id: number, building: { definitionId: string; level: number; abandoned: boolean; powered: boolean; x: number; y: number }): Known {
    const size = this.world.size;
    const ids = this.world.layers.buildingId;
    let width = 1;
    while (building.x + width < size && ids[building.y * size + building.x + width] === id) width++;
    let depth = 1;
    while (building.y + depth < size && ids[(building.y + depth) * size + building.x] === id) depth++;
    return {
      identity: `${building.definitionId}#${building.level}#${building.abandoned ? 1 : 0}#${building.powered ? 1 : 0}#${building.x}#${building.y}#${width}#${depth}`,
      sidewalk: !building.abandoned && building.level >= SIDEWALK_MIN_LEVEL,
      x: building.x,
      y: building.y,
      width,
      depth,
    };
  }

  /** Dlaždice silnic přiléhající k obdélníku. */
  private streetsAround(area: { x: number; y: number; width: number; depth: number }, out: Set<number>): void {
    const size = this.world.size;
    const road = this.world.layers.road;
    const add = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const tile = y * size + x;
      if ((road[tile] ?? 0) !== 0) out.add(tile);
    };
    for (let dx = 0; dx < area.width; dx++) {
      add(area.x + dx, area.y - 1);
      add(area.x + dx, area.y + area.depth);
    }
    for (let dy = 0; dy < area.depth; dy++) {
      add(area.x - 1, area.y + dy);
      add(area.x + area.width, area.y + dy);
    }
  }

  private snapshot(): void {
    const world = this.world;
    this.terrain = Uint8Array.from(world.layers.terrain);
    this.road = Uint8Array.from(world.layers.road);
    this.wire = Uint8Array.from(world.layers.wire);
    this.zone = Uint8Array.from(world.layers.zone);
    this.buildingId = Uint32Array.from(world.layers.buildingId);
    this.rubble = Uint8Array.from(world.rubble);
    this.heights = Uint8Array.from(world.cornerHeight);
    this.known.clear();
    for (const [id, building] of world.buildings) this.known.set(id, this.describe(id, building));
  }
}
