import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { index, MAP_SIZE, ROAD } from '../layers';
import type { WorldState } from '../world';
import type { Building } from '../world';
import type { System } from './index';

/**
 * Dopravní model (§5 zadání fáze 3).
 *
 * **Vzorkování náhodných cest po vzoru Micropolisu** (rozhodnutí autora): z
 * každého domu se vypustí pár chodců, ti se náhodně toulají po silnicích a
 * počítá se, kolik jich narazí na práci. Není to hledání nejkratší cesty a
 * záměrně: výsledek je „jak snadno se odsud dostanu do práce", což je přesně
 * ta veličina, která má řídit růst.
 *
 * Dvě věci z toho plynou:
 * - **`trafficLoad`** — kudy chodci šli, tedy zatížení silnic. Kolony z něj
 *   dělá T26.
 * - **`jobAccess`** — podíl úspěšných cest, vyhlazený v čase.
 *
 * Cesta se **nevrací tam, odkud přišla**. Bez toho se náhodná procházka zacyklí
 * mezi dvěma dlaždicemi a nikam nedojde.
 *
 * Vzorkuje se, protože při tisících budov by se každý běh procházelo celé
 * město. Kde se skončilo, drží `world.trafficCursor` — a ten je součástí savu,
 * jinak by se po načtení začalo od začátku a determinismus by padl.
 */
const INTERVAL = 8;
/** Offset mimo znečištění (8/3), aby dva průchody mapou nespadly do stejného tiku. */
const OFFSET = 4;

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export function createTrafficSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'traffic',
    interval: INTERVAL,
    offset: OFFSET,
    run(world: WorldState) {
      world.trafficLoad.fill(0);

      const homes = residentialBuildings(world, catalogue);
      if (homes.length === 0) return;

      const destinations = jobTiles(world, catalogue);
      const sample = takeSample(world, homes, balance.traffic.maxBuildingsPerRun);

      for (const building of sample) {
        const footprint = catalogue.get(building.definitionId)?.footprint ?? [1, 1];
        world.jobAccess.set(
          building.id,
          walkFrom(world, balance, building, footprint, destinations, world.jobAccess.get(building.id) ?? 0),
        );
      }
    },
  };
}

/** Obytné budovy v pevném pořadí podle id — vzorek musí být deterministický. */
function residentialBuildings(world: WorldState, catalogue: BuildingCatalogue): Building[] {
  const homes: Building[] = [];
  for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building || building.abandoned || building.population === 0) continue;
    if (catalogue.get(building.definitionId)?.category !== 'residential') continue;
    homes.push(building);
  }
  return homes;
}

/**
 * Silniční dlaždice, ze kterých je na dosah práce.
 *
 * „Volná místa" nesledujeme po budovách — zaměstnanost je v téhle hře veličina
 * celoměstská, ne per budova (§7 fáze 1). Cílem je proto každá komerční nebo
 * průmyslová budova, která nějaká místa má a jede.
 */
function jobTiles(world: WorldState, catalogue: BuildingCatalogue): Uint8Array {
  const tiles = new Uint8Array(world.layers.road.length);

  for (const building of world.buildings.values()) {
    if (building.abandoned || building.jobs === 0) continue;
    const definition = catalogue.get(building.definitionId);
    const category = definition?.category;
    if (category !== 'commercial' && category !== 'industrial') continue;

    const [width, depth] = definition?.footprint ?? [1, 1];
    forEachRoadAround(world, building.x, building.y, width, depth, (tile) => {
      tiles[tile] = 1;
    });
  }

  return tiles;
}

/** Zavolá `visit` pro každou silniční dlaždici sousedící s obdélníkem. */
function forEachRoadAround(
  world: WorldState,
  x: number,
  y: number,
  width: number,
  depth: number,
  visit: (tile: number) => void,
): void {
  for (let dy = -1; dy <= depth; dy++) {
    for (let dx = -1; dx <= width; dx++) {
      // Jen okraj, ne vnitřek půdorysu.
      const onEdge = dx === -1 || dy === -1 || dx === width || dy === depth;
      if (!onEdge) continue;

      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) continue;

      const tile = index(tx, ty);
      if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) visit(tile);
    }
  }
}

/**
 * Vybere z kruhu budov ty, na které tenhle běh vyšlo.
 *
 * Kurzor se posouvá i tehdy, když je budov míň než strop — jinak by se u malého
 * města pořád dokola vzorkovaly tytéž a `trafficCursor` by nic neznamenal.
 */
function takeSample(world: WorldState, homes: readonly Building[], limit: number): Building[] {
  const count = Math.min(limit, homes.length);
  const sample: Building[] = [];

  for (let i = 0; i < count; i++) {
    const building = homes[(world.trafficCursor + i) % homes.length];
    if (building) sample.push(building);
  }

  world.trafficCursor = (world.trafficCursor + count) % homes.length;
  return sample;
}

/**
 * Vypustí z budovy chodce a vrátí novou vyhlazenou dosažitelnost práce.
 *
 * Dům bez silnice v sousedství má dosažitelnost nula — a je to tak správně,
 * odnikud se nikam nedojde.
 */
function walkFrom(
  world: WorldState,
  balance: Balance,
  building: Building,
  footprint: readonly [number, number],
  destinations: Uint8Array,
  previous: number,
): number {
  const starts = startTiles(world, balance, building, footprint);
  if (starts.length === 0) return 0;

  const { attempts, maxSteps, smoothing } = balance.traffic;
  // Váha se dělí počtem pokusů: budova pošle do ulic svou populaci, ne
  // populaci krát počet vzorkovacích cest. Kapacita silnice tak znamená
  // „kolika obyvatelům odsud stačí" a jde nastavit podle rozumu.
  const weight = building.population / attempts;
  let hits = 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let position = starts[world.rng.int(starts.length)] ?? starts[0] ?? 0;
    let previousTile = -1;

    for (let step = 0; step < maxSteps; step++) {
      world.trafficLoad[position] = (world.trafficLoad[position] ?? 0) + weight;

      if (destinations[position] === 1) {
        hits++;
        break;
      }

      const next = neighbourRoads(world, position, previousTile);
      if (next.length === 0) break;

      previousTile = position;
      position = next[world.rng.int(next.length)] ?? position;
    }
  }

  const measured = hits / attempts;
  return previous + (measured - previous) * smoothing;
}

/**
 * Odkud chodec vyráží: nejbližší silnice **v dosahu růstu**, ne nutně hned
 * vedle domu.
 *
 * Kdyby se trvalo na sousedství, polovina domů by měla dosažitelnost práce
 * nula napořád — růst je totiž staví až tři dlaždice od vozovky (§9 fáze 2).
 * Ukázalo se to hned na první zkoušce ve hře: 17 z 32 domů nemělo odkud vyjít.
 * Dosah proto sdílí obě pravidla, ať si neodporují.
 */
function startTiles(
  world: WorldState,
  balance: Balance,
  building: Building,
  footprint: readonly [number, number],
): number[] {
  const maxDistance = balance.growth.roadFactors.length - 1;
  const seen = new Set<number>();
  let frontier: number[] = [];

  // Nultý krok je samotný půdorys; z něj se šíříme ven přes prázdné dlaždice.
  for (let dy = 0; dy < footprint[1]; dy++) {
    for (let dx = 0; dx < footprint[0]; dx++) {
      const tx = building.x + dx;
      const ty = building.y + dy;
      if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) continue;
      const tile = index(tx, ty);
      seen.add(tile);
      frontier.push(tile);
    }
  }

  for (let step = 0; step <= maxDistance && frontier.length > 0; step++) {
    const roads: number[] = [];
    const next: number[] = [];

    for (const tile of frontier) {
      const x = tile % MAP_SIZE;
      const y = (tile - x) / MAP_SIZE;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
        const at = index(nx, ny);
        if (seen.has(at)) continue;
        seen.add(at);

        if ((world.layers.road[at] ?? ROAD.none) !== ROAD.none) roads.push(at);
        else next.push(at);
      }
    }

    // První prstenec, ve kterém je silnice, vyhrává — dál už hledat nemá smysl.
    if (roads.length > 0) return roads;
    frontier = next;
  }

  return [];
}

/** Silniční sousedé dlaždice kromě té, ze které jsme přišli. */
function neighbourRoads(world: WorldState, tile: number, from: number): number[] {
  const x = tile % MAP_SIZE;
  const y = (tile - x) / MAP_SIZE;
  const roads: number[] = [];

  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;

    const at = index(nx, ny);
    if (at === from) continue;
    if ((world.layers.road[at] ?? ROAD.none) !== ROAD.none) roads.push(at);
  }

  return roads;
}
