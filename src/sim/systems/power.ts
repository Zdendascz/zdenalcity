import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { parcelConducts } from '../conduct';
import { index, WIRE } from '../layers';
import { isFlooded } from '../disasters/flood';
import { markBuildingDirty, markCoverageDirty, markTileDirty } from '../world';
import type { TransformerLoad, WorldState } from '../world';
import type { System } from './index';

/**
 * Elektřina (T129, rozhodnutí autora).
 *
 * **Co vede:** souvislý blok zón a budov sám (`parcelConducts`) a elektrické
 * vedení (`layers.wire`). Silnice nevede nic, zchátralá a pobořená parcela
 * taky ne. Hráč tedy natahuje vedení jen mezi bloky a k elektrárně.
 *
 * **Kapacita:** každý úsek vedení přenese nejvýš `balance.power.wires[typ]`.
 * Síť se prochází do šířky od elektráren; zátěž se sčítá od spotřebičů
 * zpátky ke zdroji. Úsek, přes který by šlo víc, než unese, **vypadne**
 * a s ním všechno, co za ním leží — pokud k tomu nevede jiná cesta. Proto
 * se výpočet opakuje: vypadlé úseky se vyřadí a proud zkusí jinudy, dokud
 * nic dalšího nevypadne. Výpadek tak zasáhne **oblast**, ne náhodné domy.
 *
 * **Výroba:** každá souvislá síť má svou. Elektrárna na jednom konci mapy
 * nenapájí čtvrť, ke které nevede vedení. V síti se výroba rozdává podle
 * `id` budov, tedy od nejstarší.
 *
 * Systém běží každý tik (§5), ale přepočítává se jen po změně sítě.
 */

/** Pojistka proti nekonečnému kolu vyřazování. Každé kolo vyřadí aspoň úsek. */
const MAX_ROUNDS = 64;

/**
 * Snímek toho, **co vede** — parcely a vedení (nebo potrubí) — z posledního
 * úplného přepočtu sítě (T133).
 *
 * Každý nový dům spustil přepočet celé sítě elektřiny i vody (6,1 a 6,4 ms).
 * Od T129 přitom zónovaná dlaždice vede sama, takže dům, který na zóně
 * vyroste, **tvar sítě nemění** — mění jen spotřebu. Přepočet se proto ptá
 * sem: když se vodivost nezměnila, vezme minulé vodiče a strom hledání
 * a přepočítá jen rozdělení.
 *
 * Nerozhoduje o tom volající, ale **porovnání vstupů**: silnice, zóny, suť,
 * povodeň, vedení a budovy. Vlajku `powerNetworkDirty` nastavuje přes deset
 * míst a spoléhat na to, že každé řekne „jen spotřeba", by znamenalo, že
 * jedno zapomenuté místo tiše rozbije síť. Porovnání je jeden průchod
 * polem — zlomek toho, co stojí `parcelConducts` pro každou dlaždici.
 *
 * Výsledek je proto **bitově stejný** jako z úplného přepočtu; zrychlí se jen
 * cesta k němu. Snímek žije mimo `WorldState` (ve `WeakMap`), do savu nepatří
 * a načtený svět začne úplným přepočtem.
 */
export class ConductSnapshot {
  private road = new Uint8Array(0);
  private zone = new Uint8Array(0);
  private rubble = new Uint8Array(0);
  private flood = new Uint8Array(0);
  private links = new Uint8Array(0);
  private ids = new Uint32Array(0);
  private readonly abandoned = new Map<number, boolean>();

  /** Zapamatuje si vstupy. */
  capture(world: WorldState, links: Uint8Array): void {
    this.road = world.layers.road.slice();
    this.zone = world.layers.zone.slice();
    this.rubble = world.rubble.slice();
    this.flood = world.flood.slice();
    this.links = links.slice();
    this.ids = world.layers.buildingId.slice();
    this.rememberBuildings(world);
  }

  private rememberBuildings(world: WorldState): void {
    this.abandoned.clear();
    for (const [id, building] of world.buildings) this.abandoned.set(id, building.abandoned);
  }

  /**
   * `parcelConducts` dlaždice **v okamžiku snímku** — složené ze snímku
   * samého, stejnými pravidly. Počítá se jen pro dlaždice, kde se od té doby
   * změnilo `buildingId`; celou mapu předem by to stálo tolik, kolik se
   * šetří.
   */
  private parcelWas(tile: number): boolean {
    if ((this.rubble[tile] ?? 0) !== 0 || (this.road[tile] ?? 0) !== 0) return false;
    const id = this.ids[tile] ?? 0;
    if (id !== 0) return this.abandoned.get(id) === false;
    return (this.zone[tile] ?? 0) !== 0;
  }

  /**
   * Vede všechno stejně jako při snímku? Změna `buildingId` nevadí, pokud
   * dlaždice vede pořád stejně — to je právě dům vyrostlý na zóně. Při shodě
   * se snímek srovná se světem, ať se příště porovnává jen nová změna.
   */
  matches(world: WorldState, links: Uint8Array): boolean {
    const cells = this.ids.length;
    const layers = world.layers;
    if (layers.road.length !== cells || layers.buildingId.length !== cells || links.length !== cells) return false;
    if (!same(layers.road, this.road) || !same(layers.zone, this.zone)) return false;
    if (!same(world.rubble, this.rubble) || !same(world.flood, this.flood)) return false;
    if (!same(links, this.links)) return false;
    // Zchátrání mění vodivost bez změny `buildingId`.
    for (const [id, building] of world.buildings) {
      const was = this.abandoned.get(id);
      if (was !== undefined && was !== building.abandoned) return false;
    }
    const ids = layers.buildingId;
    for (let tile = 0; tile < cells; tile++) {
      if (ids[tile] === this.ids[tile]) continue;
      if (parcelConducts(world, tile) !== this.parcelWas(tile)) return false;
    }
    this.ids.set(ids);
    this.rememberBuildings(world);
    return true;
  }
}

/** Jsou dvě pole stejně dlouhá a stejná? */
function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Co zůstává z minulého úplného přepočtu elektřiny. */
interface PowerCache {
  readonly snapshot: ConductSnapshot;
  /** Elektrárny (id, výkon, dlaždice) a odstavené — mění strom hledání. */
  readonly plantsKey: string;
  /** Vodiče před vyřazováním přetížených úseků. Kopíruje se, kola ho mění. */
  readonly conducts: Uint8Array;
  readonly limited: Uint8Array;
  /** Dlaždice, kde se potkají vrstvy (elektrárny a trafa). */
  readonly bridges: Uint8Array;
  /** Strom prvního hledání; pořadí zdrojů je v `plantsKey`. */
  readonly tree: Tree;
}

const powerCache = new WeakMap<WorldState, PowerCache>();

/** Zapomene tvar sítě — příští přepočet bude úplný. Pro testy shody obou cest. */
export function forgetPowerCache(world: WorldState): void {
  powerCache.delete(world);
}

export function createPowerSystem(catalogue: BuildingCatalogue, balance?: Balance): System {
  // Bez balancu (starší testy) má vedení neomezenou kapacitu.
  const capacity = (type: number): number =>
    balance?.power.wires[type - 1]?.capacity ?? Number.POSITIVE_INFINITY;
  return {
    name: 'power',
    interval: 1,
    offset: 0,
    run(world: WorldState) {
      if (!world.powerNetworkDirty) return;
      world.powerNetworkDirty = false;
      recompute(world, catalogue, capacity);
    },
  };
}

interface Plant {
  readonly id: number;
  readonly production: number;
  readonly tiles: number[];
}

interface Consumer {
  readonly id: number;
  readonly consumption: number;
  readonly tiles: number[];
}

/** Trafostanice (T136): spojí vysoké napětí s nízkým na jedné dlaždici. */
interface Transformer {
  readonly id: number;
  readonly capacity: number;
  /** Dlaždice, kde se napětí přepojuje — první dlaždice půdorysu. */
  readonly bridge: number;
  readonly tiles: number[];
}

/*
 * **Dvě vrstvy sítě** (T136, rozhodnutí autora). Uzel sítě je dlaždice
 * v jedné ze dvou vrstev:
 *
 * - nízké napětí (0 … cells−1): všechno, co odebírá — souvislý blok zón
 *   a budov — a vedení nízkého napětí.
 * - vysoké napětí (cells … 2·cells−1): vedení vysokého napětí.
 *
 * Vrstvy se potkají **jen** v elektrárně (na všech jejích dlaždicích, bez
 * omezení — elektrárna napájí obojí) a v trafostanici (na jedné dlaždici,
 * s kapacitou trafa). Vysoké napětí tak vede přes blok, ale do něj ne:
 * „Vysoké napětí nejde napojit do budov, vyjma elektráren. Do budov a zón
 * jde jen nízké napětí a mezi vysokým a nízkým musí být trafo."
 */

function recompute(
  world: WorldState,
  catalogue: BuildingCatalogue,
  capacity: (type: number) => number,
): void {
  // Pořadí budov je vzestupně podle id — deterministické bez ohledu na to,
  // jak se mapa naplnila (P2).
  const ids = [...world.buildings.keys()].sort((a, b) => a - b);
  const cells = world.layers.power.length;

  const plants: Plant[] = [];
  const consumers: Consumer[] = [];
  const transformers: Transformer[] = [];
  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building || building.abandoned) continue;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    const tiles = footprintTiles(world, building.x, building.y, definition.footprint);
    const produced = definition.power?.production ?? 0;
    // Odpojená elektrárna (blackout) nevyrábí — a nevyrábí ani zchátralá.
    if (produced > 0 && !world.disasters.offlinePlants.has(id)) {
      plants.push({ id, production: produced, tiles });
    }
    const transformer = definition.power?.transformer ?? 0;
    const bridge = tiles[0];
    if (transformer > 0 && bridge !== undefined) {
      transformers.push({ id, capacity: transformer, bridge, tiles });
    }
    consumers.push({ id, consumption: definition.power?.consumption ?? 0, tiles });
  }

  // Tvar sítě z minula, když se nezměnilo, co vede, ani kde jsou elektrárny
  // a trafa (T133, viz `ConductSnapshot`).
  const offline = [...world.disasters.offlinePlants].sort((a, b) => a - b).join(',');
  const plantsKey =
    `${plants.map((plant) => `${plant.id}:${plant.production}:${plant.tiles.join(',')}`).join('|')}#${offline}` +
    `#${transformers.map((t) => `${t.id}:${t.capacity}:${t.tiles.join(',')}`).join('|')}`;
  const cached = powerCache.get(world);
  let conducts: Uint8Array;
  let limited: Uint8Array;
  let bridges: Uint8Array;
  let tree: Tree;
  if (cached && cached.plantsKey === plantsKey && cached.snapshot.matches(world, world.layers.wire)) {
    conducts = cached.conducts.slice();
    limited = cached.limited;
    bridges = cached.bridges;
    tree = cached.tree;
  } else {
    conducts = new Uint8Array(cells * 2);
    // Kapacitu má jen vedení mimo parcelu: přes parcelu vede blok sám
    // a neomezeně. Kdyby se úsek počítal, jeho přetížení by zhaslo i parcelu
    // pod ním — a s ní celý blok (audit, hlášení autora „i když mám napojeno").
    limited = new Uint8Array(cells * 2);
    // Kde se vrstvy potkají: elektrárna všude, trafo na jedné dlaždici.
    bridges = new Uint8Array(cells);
    const hub = new Uint8Array(cells);
    for (const plant of plants) {
      for (const tile of plant.tiles) {
        bridges[tile] = 1;
        hub[tile] = 1;
      }
    }
    for (const transformer of transformers) {
      for (const tile of transformer.tiles) hub[tile] = 1;
      bridges[transformer.bridge] = 1;
    }
    for (let tile = 0; tile < cells; tile++) {
      if (isFlooded(world, tile)) continue;
      const parcel = parcelConducts(world, tile);
      const wire = (world.rubble[tile] ?? 0) === 0 ? (world.layers.wire[tile] ?? WIRE.none) : WIRE.none;
      if (parcel || wire === WIRE.low) conducts[tile] = 1;
      if (wire === WIRE.low && !parcel) limited[tile] = 1;
      // Vysoké napětí má svou vrstvu; elektrárna a trafo v ní stojí celým
      // půdorysem, ať se k nim vedení připojí z kterékoli strany.
      if (wire === WIRE.high || hub[tile] === 1) conducts[cells + tile] = 1;
      if (wire === WIRE.high && hub[tile] === 0) limited[cells + tile] = 1;
    }
    // Odpojená elektrárna nevede — kdyby vedla, vzdálená čtvrť by zůstala
    // „připojená k ničemu" a hráč by na mapě viděl síť, která nefunguje.
    for (const id of world.disasters.offlinePlants) {
      const building = world.buildings.get(id);
      const definition = building && catalogue.get(building.definitionId);
      if (!building || !definition) continue;
      for (const tile of footprintTiles(world, building.x, building.y, definition.footprint)) {
        conducts[tile] = 0;
        conducts[cells + tile] = 0;
        bridges[tile] = 0;
      }
    }
    tree = spread(world, conducts, bridges, plants);
    const snapshot = cached?.snapshot ?? new ConductSnapshot();
    snapshot.capture(world, world.layers.wire);
    powerCache.set(world, { snapshot, plantsKey, conducts: conducts.slice(), limited, bridges, tree });
  }

  const trafoAt = new Map<number, Transformer>();
  for (const transformer of transformers) trafoAt.set(transformer.bridge, transformer);
  const nodeCapacity = (node: number): number => {
    if (limited[node] !== 1) return Number.POSITIVE_INFINITY;
    return capacity(node >= cells ? WIRE.high : WIRE.low);
  };

  const overloaded = new Uint8Array(cells * 2);
  const trafoOverloaded = new Set<number>();
  let load = loads(tree, consumers, cells);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const cut = overloadedNodes(tree, load, cells, nodeCapacity, trafoAt, trafoOverloaded);
    if (cut.length === 0) break;
    for (const node of cut) {
      overloaded[node] = 1;
      conducts[node] = 0;
    }
    tree = spread(world, conducts, bridges, plants);
    load = loads(tree, consumers, cells);
  }

  // Zátěž a přetížení pro vrstvu elektřiny, po dlaždicích vedení: uzel té
  // vrstvy, ve které vedení leží. Přetížený úsek ukazuje, kolik by přes něj
  // šlo — tedy zátěž z posledního kola, kdy ještě vedl.
  const wireLoad = world.wireLoad;
  const wireOverloaded = new Uint8Array(cells);
  const wireLive = new Uint8Array(cells);
  for (let tile = 0; tile < cells; tile++) {
    const type = world.layers.wire[tile] ?? WIRE.none;
    if (type === WIRE.none) {
      wireLoad[tile] = 0;
      continue;
    }
    const node = type === WIRE.high ? cells + tile : tile;
    wireOverloaded[tile] = overloaded[node] ?? 0;
    wireLive[tile] = tree.reached[node] ?? 0;
    if (overloaded[node] === 0) wireLoad[tile] = tree.reached[node] === 1 ? (load[node] ?? 0) : 0;
  }
  world.wireOverloaded = wireOverloaded;
  world.wireLive = wireLive;

  // Zatížení trafostanic: tok přes přepojení vrstev na jejich dlaždici.
  const transformerLoad = new Map<number, TransformerLoad>();
  for (const transformer of transformers) {
    transformerLoad.set(transformer.id, {
      load: Math.round(bridgeFlow(tree, load, cells, transformer.bridge)),
      capacity: transformer.capacity,
      overloaded: trafoOverloaded.has(transformer.bridge),
    });
  }
  world.transformerLoad = transformerLoad;
  world.powerRevision++;

  writePowerLayer(world, tree.reached);
  distributeCapacity(world, catalogue, ids, plants, tree, cells);
}

interface Tree {
  /** Dosažený uzel 0/1 (obě vrstvy za sebou). */
  reached: Uint8Array;
  /** Rodič ve stromu hledání, −1 u zdroje. */
  parent: Int32Array;
  /** Síť, do které uzel patří — index první elektrárny, která ho zasáhla. */
  network: Int32Array;
  /** Pořadí, ve kterém se uzly dosáhly. */
  order: number[];
}

/** Do šířky od všech elektráren naráz, po vodivých uzlech obou vrstev. */
function spread(
  world: WorldState,
  conducts: Uint8Array,
  bridges: Uint8Array,
  plants: readonly Plant[],
): Tree {
  const nodes = conducts.length;
  const cells = nodes / 2;
  const reached = new Uint8Array(nodes);
  const parent = new Int32Array(nodes).fill(-1);
  const network = new Int32Array(nodes).fill(-1);
  const order: number[] = [];
  const size = world.size;

  // Dvě elektrárny, jejichž sítě se dotknou, jsou jedna síť: kdo narazí na
  // uzel s cizím označením, sítě sloučí.
  const root = plants.map((_, p) => p);
  const find = (p: number): number => {
    while (root[p] !== p) p = root[p] = root[root[p]!]!;
    return p;
  };

  plants.forEach((plant, p) => {
    for (const tile of plant.tiles) {
      for (const node of [tile, cells + tile]) {
        if (conducts[node] === 0 || reached[node] === 1) continue;
        reached[node] = 1;
        network[node] = p;
        order.push(node);
      }
    }
  });

  for (let head = 0; head < order.length; head++) {
    const node = order[head]!;
    const layer = node >= cells ? cells : 0;
    const tile = node - layer;
    const x = tile % size;
    const y = (tile - x) / size;
    const visit = (n: number): void => {
      if (conducts[n] === 0) return;
      if (reached[n] === 1) {
        const a = find(network[node]!);
        const b = find(network[n]!);
        if (a !== b) root[Math.max(a, b)] = Math.min(a, b);
        return;
      }
      reached[n] = 1;
      parent[n] = node;
      network[n] = network[node]!;
      order.push(n);
    };
    if (y > 0) visit(layer + tile - size);
    if (x < size - 1) visit(layer + tile + 1);
    if (y < size - 1) visit(layer + tile + size);
    if (x > 0) visit(layer + tile - 1);
    // Přepojení vrstev v elektrárně a trafu.
    if (bridges[tile] === 1) visit(layer === 0 ? cells + tile : tile);
  }

  for (const node of order) network[node] = find(network[node]!);
  return { reached, parent, network, order };
}

/**
 * Zátěž uzlů: spotřeba budovy visí na její první dosažené dlaždici nízkého
 * napětí a sčítá se ke zdroji.
 */
function loads(tree: Tree, consumers: readonly Consumer[], cells: number): Float64Array {
  const load = new Float64Array(tree.reached.length);
  const rank = new Int32Array(cells).fill(-1);
  tree.order.forEach((node, i) => {
    if (node < cells) rank[node] = i;
  });
  for (const consumer of consumers) {
    if (consumer.consumption <= 0) continue;
    let best = -1;
    for (const tile of consumer.tiles) {
      const r = rank[tile] ?? -1;
      if (r >= 0 && (best < 0 || r < (rank[best] ?? 0))) best = tile;
    }
    if (best >= 0) load[best] = (load[best] ?? 0) + consumer.consumption;
  }
  for (let i = tree.order.length - 1; i >= 0; i--) {
    const node = tree.order[i]!;
    const parent = tree.parent[node] ?? -1;
    if (parent >= 0) load[parent] = (load[parent] ?? 0) + (load[node] ?? 0);
  }
  return load;
}

/**
 * Kolik teče přes přepojení vrstev na dlaždici trafa: zátěž toho konce, který
 * visí na druhém. Trafo může jet oběma směry (elektrárna na nízkém napětí
 * napájí vysoké), proto se neptá, která vrstva je nahoře.
 */
function bridgeFlow(tree: Tree, load: Float64Array, cells: number, tile: number): number {
  if (tree.parent[tile] === cells + tile) return load[tile] ?? 0;
  if (tree.parent[cells + tile] === tile) return load[cells + tile] ?? 0;
  return 0;
}

/**
 * Přetížené uzly: úsek vedení nad kapacitou, nebo trafo, přes které teče víc,
 * než unese. Bere se jen ten **nejblíž spotřebičům** — jeho vypadnutím se
 * zátěž nad ním sníží, takže vyšší úsek může vydržet. Vypadne tak nejmenší
 * možná oblast. U trafa vypadne jeho výstup: uzel, který na přepojení visí.
 */
function overloadedNodes(
  tree: Tree,
  load: Float64Array,
  cells: number,
  nodeCapacity: (node: number) => number,
  trafoAt: ReadonlyMap<number, Transformer>,
  trafoOverloaded: Set<number>,
): number[] {
  const carried = new Float64Array(load.length);
  const out: number[] = [];
  for (let i = tree.order.length - 1; i >= 0; i--) {
    const node = tree.order[i]!;
    const parent = tree.parent[node] ?? -1;
    if (parent < 0) continue;
    const tile = node >= cells ? node - cells : node;
    // Zátěž bez vypadlých větví pod sebou.
    const own = (load[node] ?? 0) - (carried[node] ?? 0);
    let limit = nodeCapacity(node);
    const trafo = trafoAt.get(tile);
    // Uzel visí na druhé vrstvě téže dlaždice: tohle je výstup trafa.
    const throughTrafo = trafo !== undefined && parent === (node >= cells ? tile : cells + tile);
    if (trafo !== undefined && throughTrafo) limit = Math.min(limit, trafo.capacity);
    if (own > limit) {
      out.push(node);
      if (throughTrafo) trafoOverloaded.add(tile);
      // Tahle větev vypadne celá: předkům se její zátěž odečte.
      for (let p = parent; p >= 0; p = tree.parent[p] ?? -1) {
        carried[p] = (carried[p] ?? 0) + own;
      }
    }
  }
  return out;
}

function footprintTiles(
  world: WorldState,
  x: number,
  y: number,
  footprint: readonly [number, number] | undefined,
): number[] {
  const [width, depth] = footprint ?? [1, 1];
  const tiles: number[] = [];
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (x + dx >= world.size || y + dy >= world.size) continue;
      tiles.push(index(x + dx, y + dy, world.size));
    }
  }
  return tiles;
}

/** Vrstva `power` je proud **na parcele** — nízké napětí, ne vedení nad ní. */
function writePowerLayer(world: WorldState, reached: Uint8Array): void {
  const power = world.layers.power;

  for (let tile = 0; tile < power.length; tile++) {
    const next = reached[tile] === 1 ? 1 : 0;
    if (power[tile] === next) continue;
    power[tile] = next;
    const x = tile % world.size;
    markTileDirty(world, x, (tile - x) / world.size);
  }
}

function distributeCapacity(
  world: WorldState,
  catalogue: BuildingCatalogue,
  ids: readonly number[],
  plants: readonly Plant[],
  tree: Tree,
  cells: number,
): void {
  // Výroba po sítích: elektrárna patří do sítě své první dosažené dlaždice.
  // Stojí v obou vrstvách a ty jsou v ní propojené, takže síť je jedna, ať ji
  // hledání zasáhlo kteroukoli.
  const remaining = new Map<number, number>();
  for (const plant of plants) {
    let net = -1;
    for (const tile of plant.tiles) {
      if (tree.reached[tile] === 1) net = tree.network[tile] ?? -1;
      else if (tree.reached[cells + tile] === 1) net = tree.network[cells + tile] ?? -1;
      if (net >= 0) break;
    }
    if (net < 0) continue;
    remaining.set(net, (remaining.get(net) ?? 0) + plant.production);
  }

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;

    const definition = catalogue.get(building.definitionId);
    const consumption = definition?.power?.consumption ?? 0;
    const tiles = footprintTiles(world, building.x, building.y, definition?.footprint);
    // Budova bere proud z nízkého napětí; vysoké nad ní nestačí.
    const tile = tiles.find((t) => tree.reached[t] === 1);

    let powered = false;
    // Ruina proud nebere ani nevede (T129).
    if (tile !== undefined && !building.abandoned) {
      const net = tree.network[tile] ?? -1;
      const left = remaining.get(net) ?? 0;
      if (consumption === 0) {
        powered = true; // elektrárny a budovy bez spotřeby
      } else if (left >= consumption) {
        powered = true;
        remaining.set(net, left - consumption);
      }
    }

    if (building.powered !== powered) {
      building.powered = powered;
      markBuildingDirty(world, id);
      // Temná služba nepokrývá (T53), takže změna proudu je změnou pokrytí.
      if (definition?.service) markCoverageDirty(world);
    }
  }
}
