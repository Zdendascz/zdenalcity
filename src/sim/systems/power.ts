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
 * **Kapacita:** každý úsek vedení přenese nejvýš `balance.power.wires[typ]`,
 * trafo nejvýš svou kapacitu. Síť se počítá jako **maximální tok** (T137):
 * souběžné přípojky se sčítají a úsek, který jede na plno, dál nic nepustí.
 * Co se do bloku nevejde, nedostanou jeho nejnovější budovy.
 *
 * **Výroba:** každá souvislá síť má svou. Elektrárna na jednom konci mapy
 * nenapájí čtvrť, ke které nevede vedení. V oblasti se proud rozdává podle
 * `id` budov, tedy od nejstarší.
 *
 * Systém běží každý tik (§5), ale přepočítává se jen po změně sítě.
 */

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

/** Tvar sítě z minulého úplného přepočtu (T133) — graf pro výpočet toku. */
interface PowerCache {
  readonly snapshot: ConductSnapshot;
  /** Elektrárny, odstavené a trafa — mění tvar grafu. */
  readonly plantsKey: string;
  readonly graph: Graph;
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
 * **Dvě vrstvy sítě** (T136, rozhodnutí autora). Uzel mřížky je dlaždice
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
 *
 * **Tok, ne strom** (T137, hlášení autora „jakto, že je tam vedení
 * přetížené? je tam 8 520 z 20 000"). Do T137 se síť procházela stromem
 * hledání: celá spotřeba bloku šla jedinou cestou, i když k němu vedly tři
 * souběžné přípojky. Jedna vypadla, pak druhá, pak třetí, a blok zhasl, ač
 * dohromady unesly trojnásobek. Teď se síť počítá jako **maximální tok**:
 *
 * - Co vede bez omezení (blok, elektrárna, trafostanice), se slije do
 *   jedné **oblasti**. Úsek vedení mimo parcelu je vlastní uzel s kapacitou
 *   typu vedení, trafo hrana s kapacitou trafa.
 * - Elektrárny dodávají do své oblasti nejvýš svůj výkon, oblast odebírá
 *   nejvýš spotřebu svých budov. Proud se rozdělí do všech cest, kudy vede.
 * - Úsek, který jede na plno, je **plný** (ve vrstvě tmavě červený); dál už
 *   nic nepustí. Co se do oblasti nevejde, nedostanou budovy s vyšším id —
 *   výpadek zasáhne část bloku, ne celý blok kvůli jednomu drátu.
 */

/** Kapacita „bez omezení" — větší než jakákoli výroba ve hře. */
const UNLIMITED = 1e15;

/** Stažení kapacit při rozkládání zátěže, od nejmenšího (viz `recompute`). */
const BALANCE_STEPS = [0.25, 0.5, 0.75] as const;

function sum(values: Float64Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Graf sítě: oblasti a úseky vedení s kapacitou, spojené hranami. */
interface Graph {
  readonly cells: number;
  /** Uzel grafu každého uzlu mřížky (2·cells): −1 nevede. */
  readonly nodeOf: Int32Array;
  /** Počet oblastí; mají uzly 0 … regions−1. Úsek vedení k je `regions + k`. */
  readonly regions: number;
  /** Uzel mřížky úseku vedení k. */
  readonly wireNode: Int32Array;
  /** Kapacita úseku vedení k. */
  readonly wireCap: Float64Array;
  /** Neomezené hrany mezi uzly grafu, po dvojicích [a, b, a, b, …]. */
  readonly links: Int32Array;
  /** Trafa: uzly grafu obou stran, kapacita, id budovy. */
  readonly trafos: readonly { a: number; b: number; capacity: number; id: number }[];
}

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
  // a trafa (T133, viz `ConductSnapshot`). Tok se počítá pokaždé znovu —
  // mění se se spotřebou.
  const offline = [...world.disasters.offlinePlants].sort((a, b) => a - b).join(',');
  const plantsKey =
    `${plants.map((plant) => `${plant.id}:${plant.tiles.join(',')}`).join('|')}#${offline}` +
    `#${transformers.map((t) => `${t.id}:${t.capacity}:${t.tiles.join(',')}`).join('|')}`;
  const cached = powerCache.get(world);
  let graph: Graph;
  if (cached && cached.plantsKey === plantsKey && cached.snapshot.matches(world, world.layers.wire)) {
    graph = cached.graph;
  } else {
    graph = buildGraph(world, catalogue, capacity, plants, transformers);
    const snapshot = cached?.snapshot ?? new ConductSnapshot();
    snapshot.capture(world, world.layers.wire);
    powerCache.set(world, { snapshot, plantsKey, graph });
  }

  const { nodeOf, regions } = graph;
  const regionOfTiles = (tiles: readonly number[]): number => {
    for (const tile of tiles) {
      const node = nodeOf[tile] ?? -1;
      if (node >= 0 && node < regions) return node;
    }
    return -1;
  };

  // Výroba a spotřeba po oblastech.
  const supply = new Float64Array(regions);
  for (const plant of plants) {
    const region = regionOfTiles(plant.tiles);
    if (region >= 0) supply[region] = (supply[region] ?? 0) + plant.production;
  }
  const demand = new Float64Array(regions);
  const consumerRegion = new Map<number, number>();
  for (const consumer of consumers) {
    const region = regionOfTiles(consumer.tiles);
    consumerRegion.set(consumer.id, region);
    if (region >= 0 && consumer.consumption > 0) demand[region] = (demand[region] ?? 0) + consumer.consumption;
  }

  // Tok s rozloženou zátěží: nejdřív s kapacitami staženými na čtvrtinu,
  // polovinu, tři čtvrtiny. Když i tak projde všechno, co projít může, bere
  // se ten — maximální tok si jinak cesty vybírá libovolně a ukázal by plný
  // úsek tam, kde by stačila desetina (hráč by hledal problém, který není).
  let flow = maxFlow(graph, supply, demand, 1);
  const best = sum(flow.delivered);
  for (const scale of BALANCE_STEPS) {
    const tried = maxFlow(graph, supply, demand, scale);
    if (sum(tried.delivered) >= best - 1e-6) {
      flow = tried;
      break;
    }
  }

  // Kam proud dojde: oblasti spojené s elektrárnou cestou, která vede.
  const reached = reachFromSources(graph, supply);

  // Výstupy po dlaždicích vedení.
  const wireLoad = world.wireLoad;
  const wireOverloaded = new Uint8Array(cells);
  const wireLive = new Uint8Array(cells);
  wireLoad.fill(0);
  for (let k = 0; k < graph.wireNode.length; k++) {
    const gridNode = graph.wireNode[k]!;
    const tile = gridNode >= cells ? gridNode - cells : gridNode;
    const through = flow.wire[k] ?? 0;
    wireLoad[tile] = Math.round(through);
    wireLive[tile] = reached[regions + k] ?? 0;
    // Plný je jen úsek, který opravdu omezuje — leží na úzkém hrdle sítě.
    if (flow.wireLimits[k] === 1) wireOverloaded[tile] = 1;
  }
  // Vedení přes parcelu nebo trafo nemá vlastní uzel — žije s oblastí.
  for (let tile = 0; tile < cells; tile++) {
    const type = world.layers.wire[tile] ?? WIRE.none;
    if (type === WIRE.none) continue;
    const node = nodeOf[type === WIRE.high ? cells + tile : tile] ?? -1;
    if (node >= 0 && node < regions) wireLive[tile] = reached[node] ?? 0;
  }
  world.wireOverloaded = wireOverloaded;
  world.wireLive = wireLive;

  const transformerLoad = new Map<number, TransformerLoad>();
  graph.trafos.forEach((trafo, i) => {
    const load = Math.abs(flow.trafo[i] ?? 0);
    transformerLoad.set(trafo.id, {
      load: Math.round(load),
      capacity: trafo.capacity,
      overloaded: flow.trafoLimits[i] === 1,
    });
  });
  // Trafo, které do sítě vůbec nevede (zaplavené), hlásí nulu.
  for (const transformer of transformers) {
    if (!transformerLoad.has(transformer.id)) {
      transformerLoad.set(transformer.id, { load: 0, capacity: transformer.capacity, overloaded: false });
    }
  }
  world.transformerLoad = transformerLoad;
  world.powerRevision++;

  writePowerLayer(world, graph, reached, flow.delivered, demand);
  distributeCapacity(world, catalogue, ids, consumerRegion, reached, flow.delivered);
}

/**
 * Sestaví graf sítě: sleje neomezené uzly do oblastí a dá vlastní uzel
 * každému úseku vedení s kapacitou.
 */
function buildGraph(
  world: WorldState,
  catalogue: BuildingCatalogue,
  capacity: (type: number) => number,
  plants: readonly Plant[],
  transformers: readonly Transformer[],
): Graph {
  const cells = world.layers.power.length;
  const size = world.size;
  const conducts = new Uint8Array(cells * 2);
  // Kapacitu má jen vedení mimo parcelu: přes parcelu vede blok sám
  // a neomezeně. Kdyby se úsek počítal, jeho přetížení by zhaslo i parcelu
  // pod ním — a s ní celý blok (audit, hlášení autora „i když mám napojeno").
  const limited = new Uint8Array(cells * 2);
  // Elektrárna stojí v obou vrstvách celým půdorysem a vrstvy v ní splývají;
  // trafo v obou vrstvách stojí taky, ale přepojuje jen přes svou kapacitu.
  const hub = new Uint8Array(cells);
  const plantTile = new Uint8Array(cells);
  for (const plant of plants) {
    for (const tile of plant.tiles) {
      hub[tile] = 1;
      plantTile[tile] = 1;
    }
  }
  for (const transformer of transformers) for (const tile of transformer.tiles) hub[tile] = 1;
  for (let tile = 0; tile < cells; tile++) {
    if (isFlooded(world, tile)) continue;
    const parcel = parcelConducts(world, tile);
    const wire = (world.rubble[tile] ?? 0) === 0 ? (world.layers.wire[tile] ?? WIRE.none) : WIRE.none;
    if (parcel || wire === WIRE.low) conducts[tile] = 1;
    if (wire === WIRE.low && !parcel) limited[tile] = 1;
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
      plantTile[tile] = 0;
    }
  }

  // Oblasti: sjednocení neomezených uzlů po sousedech v téže vrstvě
  // a v elektrárně napříč vrstvami.
  const nodes = cells * 2;
  const root = new Int32Array(nodes);
  for (let n = 0; n < nodes; n++) root[n] = n;
  const find = (n: number): number => {
    while (root[n] !== n) {
      root[n] = root[root[n]!]!;
      n = root[n]!;
    }
    return n;
  };
  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) root[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const free = (n: number): boolean => conducts[n] === 1 && limited[n] === 0;
  for (let layer = 0; layer < nodes; layer += cells) {
    for (let tile = 0; tile < cells; tile++) {
      const n = layer + tile;
      if (!free(n)) continue;
      const x = tile % size;
      if (x < size - 1 && free(n + 1)) unite(n, n + 1);
      if (tile + size < cells && free(n + size)) unite(n, n + size);
    }
  }
  for (let tile = 0; tile < cells; tile++) {
    if (plantTile[tile] === 1 && free(tile) && free(cells + tile)) unite(tile, cells + tile);
  }

  // Čísla uzlů grafu: oblasti v pořadí uzlů mřížky, pak úseky vedení.
  const nodeOf = new Int32Array(nodes).fill(-1);
  const regionOfRoot = new Map<number, number>();
  for (let n = 0; n < nodes; n++) {
    if (!free(n)) continue;
    const r = find(n);
    let region = regionOfRoot.get(r);
    if (region === undefined) {
      region = regionOfRoot.size;
      regionOfRoot.set(r, region);
    }
    nodeOf[n] = region;
  }
  const regions = regionOfRoot.size;
  const wireNodes: number[] = [];
  const wireCaps: number[] = [];
  for (let n = 0; n < nodes; n++) {
    if (conducts[n] !== 1 || limited[n] !== 1) continue;
    nodeOf[n] = regions + wireNodes.length;
    wireNodes.push(n);
    wireCaps.push(capacity(n >= cells ? WIRE.high : WIRE.low));
  }

  // Hrany mezi různými uzly grafu (oblast–úsek, úsek–úsek) po sousedech.
  const links: number[] = [];
  for (let layer = 0; layer < nodes; layer += cells) {
    for (let tile = 0; tile < cells; tile++) {
      const a = nodeOf[layer + tile] ?? -1;
      if (a < 0) continue;
      const x = tile % size;
      if (x < size - 1) {
        const b = nodeOf[layer + tile + 1] ?? -1;
        if (b >= 0 && b !== a) links.push(a, b);
      }
      if (tile + size < cells) {
        const b = nodeOf[layer + tile + size] ?? -1;
        if (b >= 0 && b !== a) links.push(a, b);
      }
    }
  }

  const trafos: { a: number; b: number; capacity: number; id: number }[] = [];
  for (const transformer of transformers) {
    const a = nodeOf[transformer.bridge] ?? -1;
    const b = nodeOf[cells + transformer.bridge] ?? -1;
    if (a < 0 || b < 0 || a === b) continue;
    trafos.push({ a, b, capacity: transformer.capacity, id: transformer.id });
  }

  return {
    cells,
    nodeOf,
    regions,
    wireNode: Int32Array.from(wireNodes),
    wireCap: Float64Array.from(wireCaps),
    links: Int32Array.from(links),
    trafos,
  };
}

interface FlowResult {
  /** Kolik dostala každá oblast (≤ spotřeba). */
  delivered: Float64Array;
  /** Tok přes úsek vedení k. */
  wire: Float64Array;
  /** Čistý tok přes trafo i (znaménko podle směru). */
  trafo: Float64Array;
  /** Úsek vedení k je úzké hrdlo: jede na plno a za ním chybí proud. */
  wireLimits: Uint8Array;
  /** Totéž pro trafo i. */
  trafoLimits: Uint8Array;
}

/**
 * Maximální tok (Dinic) od elektráren ke spotřebě. Úsek vedení je rozdělený
 * na vstup a výstup s kapacitou mezi nimi; oblast je jeden uzel. Pořadí hran
 * je dané pořadím uzlů, takže výsledek je deterministický (P2).
 */
function maxFlow(graph: Graph, supply: Float64Array, demand: Float64Array, scale: number): FlowResult {
  const R = graph.regions;
  const W = graph.wireNode.length;
  const S = R + 2 * W;
  const T = S + 1;
  const N = T + 1;
  const into = (g: number): number => (g < R ? g : R + 2 * (g - R));
  const outOf = (g: number): number => (g < R ? g : R + 2 * (g - R) + 1);

  const head: number[] = new Array<number>(N).fill(-1);
  const to: number[] = [];
  const cap: number[] = [];
  const next: number[] = [];
  const addArc = (u: number, v: number, c: number): number => {
    const e = to.length;
    to.push(v, u);
    cap.push(c, 0);
    next.push(head[u]!, head[v]!);
    head[u] = e;
    head[v] = e + 1;
    return e;
  };

  const wireArc: number[] = [];
  for (let k = 0; k < W; k++) {
    wireArc.push(addArc(R + 2 * k, R + 2 * k + 1, (graph.wireCap[k] ?? UNLIMITED) * scale));
  }
  const links = graph.links;
  for (let i = 0; i < links.length; i += 2) {
    const a = links[i]!;
    const b = links[i + 1]!;
    addArc(outOf(a), into(b), UNLIMITED);
    addArc(outOf(b), into(a), UNLIMITED);
  }
  const trafoArcs: [number, number][] = graph.trafos.map((trafo) => [
    addArc(outOf(trafo.a), into(trafo.b), trafo.capacity * scale),
    addArc(outOf(trafo.b), into(trafo.a), trafo.capacity * scale),
  ]);
  const sinkArc: number[] = [];
  for (let r = 0; r < R; r++) {
    if ((supply[r] ?? 0) > 0) addArc(S, r, supply[r]!);
    sinkArc.push((demand[r] ?? 0) > 0 ? addArc(r, T, demand[r]!) : -1);
  }
  // Původní kapacity, ať jde na konci spočítat tok hrany.
  const initial = cap.slice();

  const level = new Int32Array(N);
  const iter = new Int32Array(N);
  const queue = new Int32Array(N);
  const bfs = (): boolean => {
    level.fill(-1);
    level[S] = 0;
    let qh = 0;
    let qt = 0;
    queue[qt++] = S;
    while (qh < qt) {
      const u = queue[qh++]!;
      for (let e = head[u]!; e >= 0; e = next[e]!) {
        const v = to[e]!;
        if (cap[e]! > 1e-9 && level[v] === -1) {
          level[v] = level[u]! + 1;
          queue[qt++] = v;
        }
      }
    }
    return level[T] !== -1;
  };
  // Hledání cesty bez rekurze (mapa 512² má tisíce úseků za sebou).
  const stackNode = new Int32Array(N);
  const stackEdge = new Int32Array(N);
  const augment = (): number => {
    let depth = 0;
    stackNode[0] = S;
    for (;;) {
      const u = stackNode[depth]!;
      if (u === T) {
        let pushed = Infinity;
        for (let d = 0; d < depth; d++) pushed = Math.min(pushed, cap[stackEdge[d]!]!);
        for (let d = 0; d < depth; d++) {
          const e = stackEdge[d]!;
          cap[e]! -= pushed;
          cap[e ^ 1]! += pushed;
        }
        return pushed;
      }
      let advanced = false;
      for (; iter[u]! >= 0; iter[u] = next[iter[u]!]!) {
        const e = iter[u]!;
        const v = to[e]!;
        if (cap[e]! > 1e-9 && level[v] === level[u]! + 1) {
          stackEdge[depth] = e;
          stackNode[++depth] = v;
          advanced = true;
          break;
        }
      }
      if (advanced) continue;
      // Slepá ulička: uzel vyřadit z vrstvy a vrátit se.
      level[u] = -1;
      if (depth === 0) return 0;
      depth--;
      const back = stackNode[depth]!;
      iter[back] = next[iter[back]!]!;
    }
  };
  while (bfs()) {
    for (let u = 0; u < N; u++) iter[u] = head[u]!;
    for (;;) {
      const pushed = augment();
      if (pushed <= 1e-9) break;
    }
  }

  const used = (e: number): number => (initial[e] ?? 0) - (cap[e] ?? 0);
  const delivered = new Float64Array(R);
  sinkArc.forEach((e, r) => {
    if (e >= 0) delivered[r] = used(e);
  });
  const wire = new Float64Array(W);
  wireArc.forEach((e, k) => {
    wire[k] = used(e);
  });
  const trafo = new Float64Array(graph.trafos.length);
  trafoArcs.forEach(([ab, ba], i) => {
    trafo[i] = used(ab) - used(ba);
  });

  // Úzké hrdlo: po posledním hledání drží `level` dosažitelnost od zdroje ve
  // zbytkové síti. Hrana, jejíž začátek dosažitelný je a konec ne, leží na
  // minimálním řezu — ta opravdu omezuje. Při staženém měřítku nic z toho
  // neplatí: tok tam prošel celý, vedení tedy nic neomezuje.
  const wireLimits = new Uint8Array(W);
  const trafoLimits = new Uint8Array(graph.trafos.length);
  if (scale === 1) {
    for (let k = 0; k < W; k++) {
      if (level[R + 2 * k] !== -1 && level[R + 2 * k + 1] === -1) wireLimits[k] = 1;
    }
    graph.trafos.forEach((t, i) => {
      const ab = level[outOf(t.a)] !== -1 && level[into(t.b)] === -1;
      const ba = level[outOf(t.b)] !== -1 && level[into(t.a)] === -1;
      if (ab || ba) trafoLimits[i] = 1;
    });
  }
  return { delivered, wire, trafo, wireLimits, trafoLimits };
}

/** Uzly grafu spojené s elektrárnou cestou, která vede (bez ohledu na kapacitu). */
function reachFromSources(graph: Graph, supply: Float64Array): Uint8Array {
  const total = graph.regions + graph.wireNode.length;
  const adjacency: number[][] = Array.from({ length: total }, () => []);
  const links = graph.links;
  for (let i = 0; i < links.length; i += 2) {
    adjacency[links[i]!]!.push(links[i + 1]!);
    adjacency[links[i + 1]!]!.push(links[i]!);
  }
  for (const trafo of graph.trafos) {
    adjacency[trafo.a]!.push(trafo.b);
    adjacency[trafo.b]!.push(trafo.a);
  }
  const reached = new Uint8Array(total);
  const queue: number[] = [];
  for (let r = 0; r < graph.regions; r++) {
    if ((supply[r] ?? 0) > 0) {
      reached[r] = 1;
      queue.push(r);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const v of adjacency[queue[head]!]!) {
      if (reached[v] === 1) continue;
      reached[v] = 1;
      queue.push(v);
    }
  }
  return reached;
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

/**
 * Vrstva `power` je proud **na parcele** — nízké napětí, ne vedení nad ní.
 * Parcela má proud, když je její oblast spojená s elektrárnou a něco do ní
 * teče (nebo nic nepotřebuje). Blok, kterému plné přípojky nedají nic, proud
 * nemá, i když k němu vedení vede.
 */
function writePowerLayer(
  world: WorldState,
  graph: Graph,
  reached: Uint8Array,
  delivered: Float64Array,
  demand: Float64Array,
): void {
  const power = world.layers.power;
  const { nodeOf, regions } = graph;
  for (let tile = 0; tile < power.length; tile++) {
    const node = nodeOf[tile] ?? -1;
    let next = 0;
    if (node >= 0 && reached[node] === 1) {
      next = node >= regions || (demand[node] ?? 0) === 0 || (delivered[node] ?? 0) > 0 ? 1 : 0;
    }
    if (power[tile] === next) continue;
    power[tile] = next;
    const x = tile % world.size;
    markTileDirty(world, x, (tile - x) / world.size);
  }
}

/**
 * Proud budovám: každá oblast rozdá, co do ní dotekla, **od nejstarší
 * budovy** (podle id). Když přípojky nestačí, zhasnou nejnovější domy, ne
 * celý blok.
 */
function distributeCapacity(
  world: WorldState,
  catalogue: BuildingCatalogue,
  ids: readonly number[],
  consumerRegion: ReadonlyMap<number, number>,
  reached: Uint8Array,
  delivered: Float64Array,
): void {
  const remaining = Float64Array.from(delivered);
  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;

    const definition = catalogue.get(building.definitionId);
    const consumption = definition?.power?.consumption ?? 0;
    const region = consumerRegion.get(id) ?? -1;

    let powered = false;
    // Ruina proud nebere ani nevede (T129).
    if (region >= 0 && reached[region] === 1 && !building.abandoned) {
      if (consumption === 0) {
        powered = true; // elektrárny a budovy bez spotřeby
      } else if ((remaining[region] ?? 0) >= consumption - 1e-6) {
        powered = true;
        remaining[region] = (remaining[region] ?? 0) - consumption;
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
