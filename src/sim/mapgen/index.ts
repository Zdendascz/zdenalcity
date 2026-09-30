import type { Balance } from '@/content/balance';
import {
  cornerIndex,
  cornerSizeOf,
  createCornerHeights,
  relaxHeights,
  tileBaseHeight,
} from '../heights';
import {
  DEFAULT_MAP_SIZE,
  index,
  inBounds,
  sizeOfLayer,
  TERRAIN,
} from '../layers';
import { Rng } from '../rng';
import { markTerrainChanged } from '../world';
import type { WorldState } from '../world';
import { createNoiseField, fbm } from './noise';

/**
 * Generátor mapy (§2 zadání fáze 3).
 *
 * Žije pod P1: žádný renderer, žádný DOM, veškerá náhoda z `Rng` (P2). Stejný
 * seed proto dá vždycky identickou mapu — hlídá to golden test.
 *
 * Postup:
 * 1. výškové pole z fBm
 * 2. voda pod hladinou a **garance souvislé souše** (R7)
 * 3. písek kolem vody
 * 4. skála nad prahem
 * 5. les z druhé šumové vrstvy, jen na trávě
 * 6. mokřad v nížinách u vody
 * 7. patra v rozích a koryta řek (3b)
 *
 * Výškové pole na dlaždicích slouží jen k rozmístění terénu. Patra, se kterými
 * pak hra pracuje, se vzorkují zvlášť **v rozích** — viz `buildCornerHeights`.
 */

/**
 * Velikost mřížky náhodných hodnot, ze které se interpoluje.
 *
 * **Zůstává v kódu, na rozdíl od měřítek šumu.** Není to ladicí knoflík, ale
 * rozlišení zdroje náhody: mřížka se opakuje, takže příliš malá by mapu
 * vydláždila kopiemi téhož kopce. Měřítko říká, jak velké mají útvary být;
 * tohle jen kolik čísel se na ně natáhne.
 */
const FIELD_SIZE = 64;

export interface GeneratedMap {
  terrain: Uint8Array;
  /** Výškové pole 0–1 na dlaždicích. Slouží ke generování, do světa nejde. */
  height: Float32Array;
  /** Patra v rozích, 0–`maxHeight`. Tohle je to, co si svět odnese (§7 fáze 3). */
  cornerHeight: Uint8Array;
}

/**
 * Co si o krajině přeje hráč, než se mapa vygeneruje.
 *
 * Autor: „při vytváření nové mapy musí být možnost upravit podíl vody, souše
 * a kopců." Souš je doplněk vody, takže čísla jsou dvě.
 *
 * `seaLevel` je **kvantil**, ne hladina — 0,3 vždycky znamená „třetina mapy
 * je voda", ať šum u toho seedu vyšel jakkoli. `maxHeight` je počet pater
 * nejvyššího kopce; nula dá placku.
 */
export interface MapChoice {
  seaLevel: number;
  maxHeight: number;
}

/**
 * Volba hráče vražená do balancu. Generátor jiný vstup nezná (P5).
 *
 * Přepisují se **tři** čísla, ne dvě. To třetí je `minLandShare`: generátor
 * si hlídá, aby souš nebyla roztříštěná na ostrůvky, a když je, **ubere vodu**
 * a zkusí to znovu (`shapeCoastline`). Při výchozích 28 % to je záchranná
 * brzda, ale hráči, který si posuvníkem vyžádal 55 % vody, vrátila mapu
 * s 28 % — pětkrát po sobě ubrala pětinu a skončila skoro tam, kde začala.
 * Změřeno: souš 72 % při obou nastaveních.
 *
 * Čím víc vody než kolik chce obsah, tím míň se proto trvá na jednom celistvém
 * kusu. Archipel je při padesáti procentech vody **přání, ne porucha** — a most
 * hra umí. Výchozí generování se tím nemění: bez přání je přírůstek nula.
 */
export function balanceWithMap(balance: Balance, choice: MapChoice | undefined): Balance {
  if (!choice) return balance;
  const extraWater = Math.max(0, choice.seaLevel - balance.map.seaLevel);
  return {
    ...balance,
    map: {
      ...balance.map,
      seaLevel: choice.seaLevel,
      maxHeight: choice.maxHeight,
      minLandShare: Math.max(0.5, balance.map.minLandShare - extraWater * 1.2),
    },
  };
}

export function generateTerrain(
  seed: number,
  balance: Balance,
  size: number = DEFAULT_MAP_SIZE,
): GeneratedMap {
  const rng = new Rng(seed);
  const {
    rockLevel,
    beachWidth,
    forestDensity,
    marshThreshold,
    octaves,
    roughness,
    heightScale,
    forestScale,
  } = balance.map;

  const heightField = createNoiseField(rng, FIELD_SIZE);
  const forestField = createNoiseField(rng, FIELD_SIZE);

  const cells = size * size;
  const height = new Float32Array(cells);
  const terrain = new Uint8Array(cells);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      height[index(x, y, size)] = fbm(
        heightField,
        x,
        y,
        octaves,
        roughness,
        heightScale,
      );
    }
  }

  // Prahy se berou jako **kvantily**, ne jako pevné hodnoty výšky. Normalizovaný
  // fBm má u každého seedu jiné rozpětí, takže pevná hladina dá jednou pevninu
  // bez moře a podruhé mapu z 87 % pod vodou — obojí se stalo při ladění.
  // Takhle `seaLevel = 0,3` vždycky znamená „třetina mapy je voda".
  const sorted = Float32Array.from(height).sort();
  const seaHeight = shapeCoastline(terrain, height, sorted, balance);
  const rockHeight = quantileOf(sorted, rockLevel);

  paintBeaches(terrain, beachWidth);

  for (let tile = 0; tile < cells; tile++) {
    if (terrain[tile] === TERRAIN.grass && (height[tile] ?? 0) > rockHeight) {
      terrain[tile] = TERRAIN.rock;
    }
  }

  paintMarshes(terrain, height, seaHeight, marshThreshold);

  // Les taky kvantilem, ne pevným prahem: `forestDensity = 0,35` má znamenat
  // „třetina trávy zaroste", ne „zaroste to, co náhodou přeleze 0,65" — což
  // při normalizovaném fBm vycházelo na šest procent.
  const grassTiles: number[] = [];
  const forestNoise = new Float32Array(cells);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = index(x, y, size);
      if (terrain[tile] !== TERRAIN.grass) continue;
      forestNoise[tile] = fbm(forestField, x, y, octaves, roughness, forestScale);
      grassTiles.push(tile);
    }
  }

  const forestValues = Float32Array.from(grassTiles, (tile) => forestNoise[tile] ?? 0);
  const forestHeight = quantiles(forestValues, [1 - forestDensity])[0] ?? 1;
  for (const tile of grassTiles) {
    if ((forestNoise[tile] ?? 0) >= forestHeight) terrain[tile] = TERRAIN.forest;
  }

  // Patra až nakonec: potřebují hotové pobřeží, aby voda ležela na nule.
  const cornerHeight = buildCornerHeights(heightField, terrain, seaHeight, sorted, balance);
  carveRivers(rng, terrain, cornerHeight, balance);

  return { terrain, height, cornerHeight };
}

/**
 * Zapíše vygenerovaný terén i patra do světa.
 *
 * Bere celý `WorldState`, protože přepsat terén znamená zahodit i to, co se
 * z terénu počítá. Dokud byl terén konstantou hry, stačily dvě vrstvy.
 */
export function applyGeneratedMap(world: WorldState, map: GeneratedMap): void {
  world.layers.terrain.set(map.terrain);
  world.cornerHeight.set(map.cornerHeight);
  markTerrainChanged(world);
}

/**
 * Převede šum na patra v rozích (§7 fáze 3).
 *
 * Tři kroky, každý má důvod:
 * 1. **vzorkuje se v rozích, ne v dlaždicích** — fBm umí libovolné souřadnice,
 *    takže se nic neprůměruje a sousední dlaždice na sebe přesně navazují,
 * 2. **rohy vody jdou na nulu** — jinak by moře leželo na kopci. Sráží se
 *    i rohy sdílené se souší, takže z toho vznikne pobřežní svah zadarmo,
 * 3. **`relaxHeights` srovná zbytek** — šum o invariantu nic neví.
 *
 * Škáluje se od hladiny, ne od nuly: výška 0 znamená „u moře" bez ohledu na to,
 * kde zrovna u tohohle seedu hladina vyšla.
 */
function buildCornerHeights(
  heightField: ReturnType<typeof createNoiseField>,
  terrain: Uint8Array,
  seaHeight: number,
  sorted: Float32Array,
  balance: Balance,
): Uint8Array {
  const { maxHeight, heightCurve, octaves, roughness, heightScale } = balance.map;
  const size = sizeOfLayer(terrain);
  const side = cornerSizeOf(size);
  const heights = createCornerHeights(size);
  if (maxHeight <= 0) return heights;

  // Vrchol bereme jako kvantil, ne maximum: jediná špička šumu by jinak
  // stlačila celou zbylou souš do prvního patra.
  const peak = quantileOf(sorted, 0.995);
  const span = Math.max(1e-6, peak - seaHeight);

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const value = fbm(heightField, x, y, octaves, roughness, heightScale);
      const above = Math.max(0, Math.min(1, (value - seaHeight) / span));
      heights[cornerIndex(x, y, side)] = Math.round(
        Math.pow(above, heightCurve) * maxHeight,
      );
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (terrain[index(x, y, size)] !== TERRAIN.water) continue;
      for (const [dx, dy] of TILE_CORNERS)
        heights[cornerIndex(x + dx, y + dy, side)] = 0;
    }
  }

  relaxHeights(heights);
  return heights;
}

/**
 * Prokope řeky od pramene k moři (R7).
 *
 * Řeka teče **po spádnici**: z pramene se pokaždé jde do nejnižšího souseda.
 * Když se zasekne v proláklině, koryto se prokope dál k nejbližšímu nižšímu
 * místu — jinak by na mapě zůstávaly slepé stružky končící uprostřed pole.
 *
 * Koryto klesá monotónně a rohy se srovnají, takže voda neteče do kopce.
 *
 * Řeka rozdělí souš na dva břehy; přes vodu se staví mosty (T33). Vanilla
 * má `map.rivers` zapnuté (R7), nula řeky vypne.
 */
function carveRivers(rng: Rng, terrain: Uint8Array, heights: Uint8Array, balance: Balance): void {
  const { rivers, riverSourceHeight } = balance.map;
  if (rivers <= 0) return;

  const size = sizeOfLayer(terrain);
  const sources: number[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const tile = index(x, y, size);
      if (terrain[tile] === TERRAIN.water) continue;
      if (tileBaseHeight(heights, x, y) >= riverSourceHeight) sources.push(tile);
    }
  }
  if (sources.length === 0) return;

  for (let river = 0; river < rivers; river++) {
    const start = sources[rng.int(sources.length)];
    if (start === undefined) continue;
    carveOne(rng, terrain, heights, start);
  }

  // Koryto umí odříznout pár dlaždic od zbytku pevniny. Most se na takový
  // ostrůvek nevyplatí a hráč o něm ani neví, takže se zaplaví — stejně jako
  // ostrovy při tvorbě pobřeží. Větší kusy zůstanou: přes řeku vede most.
  drownScraps(terrain, heights, balance.map.scrapIslandTiles);
  relaxHeights(heights);
}

/**
 * Zaplaví ostrůvky menší než `map.scrapIslandTiles`, které vznikly korytem řeky.
 *
 * Nepočítá se největší komponenta, ale **velikost**: řeka může rozdělit mapu
 * na dvě velké části a to je v pořádku — přes koryto se dá postavit most.
 * Odříznutá trojice dlaždic uprostřed vody most nikdy neuvidí.
 */
function drownScraps(terrain: Uint8Array, heights: Uint8Array, scrapIslandTiles: number): void {
  const size = sizeOfLayer(terrain);
  const side = cornerSizeOf(size);
  const { componentOf, sizes } = landComponents(terrain);
  for (let tile = 0; tile < terrain.length; tile++) {
    const id = componentOf[tile];
    if (id === undefined || id < 0) continue;
    if ((sizes[id] ?? 0) >= scrapIslandTiles) continue;

    terrain[tile] = TERRAIN.water;
    // Zaplavená dlaždice musí klesnout na hladinu, jinak by voda zůstala
    // ležet na kopci.
    const x = tile % size;
    const y = (tile - x) / size;
    for (const [dx, dy] of TILE_CORNERS) {
      heights[cornerIndex(x + dx, y + dy, side)] = 0;
    }
  }
}

/** Jedna řeka od pramene dolů. Vrací délku koryta v dlaždicích. */
function carveOne(rng: Rng, terrain: Uint8Array, heights: Uint8Array, start: number): number {
  const path: number[] = [];
  const size = sizeOfLayer(terrain);
  const side = cornerSizeOf(size);
  const visited = new Set<number>();
  let tile = start;

  // Strop kroků je obvod mapy: delší koryto než okolo dokola být nemůže.
  for (let step = 0; step < size * 4; step++) {
    if (visited.has(tile)) break;
    visited.add(tile);
    path.push(tile);

    if (terrain[tile] === TERRAIN.water) break; // dotekli jsme moře, hotovo

    const x = tile % size;
    const y = (tile - x) / size;
    const here = tileBaseHeight(heights, x, y);

    let next = -1;
    let lowest = here;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny, size)) continue;
      const at = index(nx, ny, size);
      if (visited.has(at)) continue;

      const level = terrain[at] === TERRAIN.water ? -1 : tileBaseHeight(heights, nx, ny);
      // Shodnou výšku bere jen náhoda, jinak by koryto jelo pořád stejným směrem.
      if (level < lowest || (level === lowest && next >= 0 && rng.int(2) === 0)) {
        lowest = level;
        next = at;
      }
    }

    if (next < 0) {
      // Prolákliny: pokračuj k nejbližšímu okraji mapy, ať řeka někde skončí.
      next = stepTowardsEdge(size, x, y, visited);
      if (next < 0) break;
    }

    tile = next;
  }

  // Koryto se zapíše až teď: cesta se mohla zaseknout a nedokončená řeka
  // uprostřed pole vypadá jako chyba generátoru.
  //
  // Celé koryto klesne **na nulu**, ne po schodech dolů. Sousední dlaždice
  // sdílejí rohy, takže klesající řeka by musela mít každou dlaždici v jiné
  // výšce — a to nejde: společný roh nemůže být zároveň ve třech i ve dvou.
  // Voda by se naklonila a vypadala jako vodopád visící ve vzduchu. Nulou se
  // řeka srovná s mořem, do kterého stejně teče, a `relaxHeights` z toho udělá
  // údolí.
  for (const at of path) {
    terrain[at] = TERRAIN.water;
    const x = at % size;
    const y = (at - x) / size;
    for (const [dx, dy] of TILE_CORNERS) {
      heights[cornerIndex(x + dx, y + dy, side)] = 0;
    }
  }

  return path.length;
}

/** Krok k nejbližšímu okraji mapy. Slouží jen k dokopání řeky z prolákliny. */
function stepTowardsEdge(
  size: number,
  x: number,
  y: number,
  visited: ReadonlySet<number>,
): number {
  const toEdge = [
    [0, -1, y],
    [1, 0, size - 1 - x],
    [0, 1, size - 1 - y],
    [-1, 0, x],
  ] as const;

  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [dx, dy, distance] of toEdge) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny, size)) continue;
    const at = index(nx, ny, size);
    if (visited.has(at) || distance >= bestDistance) continue;
    best = at;
    bestDistance = distance;
  }
  return best;
}

/** Posuny k rohům dlaždice. Pořadí nehraje roli, jde jen o úplnost. */
const TILE_CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

function isLand(terrain: Uint8Array, tile: number): boolean {
  return terrain[tile] !== TERRAIN.water;
}

/** Hodnota, pod kterou leží `share` podíl už setříděného pole. */
function quantileOf(sorted: Float32Array, share: number): number {
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
  return sorted[at] ?? 0;
}

function quantiles(values: Float32Array, shares: readonly number[]): number[] {
  const sorted = Float32Array.from(values).sort();
  return shares.map((share) => quantileOf(sorted, share));
}

/**
 * Rozhodne, kudy vede pobřeží, a zaručí souvislou souš (R7).
 *
 * Ostrovy se **zaplaví**, ne spojí. Původní verze k nim stavěla šíje a na
 * členitých mapách z toho byly hřebeny přes celé moře — nahlásil autor. Ztráta
 * je malá: medián mapy má 99 % souše v jednom kuse, takže se topí pár ostrůvků,
 * které stejně nebylo jak zastavět.
 *
 * Když by tím ale souš přišla o víc než `minLandShare`, hladina se o kus sníží
 * a zkusí se to znovu — méně vody znamená míň ostrovů. Takhle vzniká souvislá
 * mapa bez jediného umělého pásu.
 *
 * Vrací výšku hladiny, kterou nakonec zvolil.
 */
function shapeCoastline(
  terrain: Uint8Array,
  height: Float32Array,
  sorted: Float32Array,
  balance: Balance,
): number {
  const { seaLevel, minLandShare } = balance.map;
  let waterShare = seaLevel;
  let seaHeight = quantileOf(sorted, waterShare);

  for (let attempt = 0; attempt < 5; attempt++) {
    seaHeight = quantileOf(sorted, waterShare);
    for (let tile = 0; tile < terrain.length; tile++) {
      terrain[tile] = (height[tile] ?? 0) < seaHeight ? TERRAIN.water : TERRAIN.grass;
    }

    const { componentOf, sizes } = landComponents(terrain);
    if (sizes.length === 0) {
      terrain.fill(TERRAIN.grass); // celá mapa pod vodou, radši bez moře
      return seaHeight;
    }

    let largest = 0;
    let land = 0;
    for (let id = 0; id < sizes.length; id++) {
      land += sizes[id] ?? 0;
      if ((sizes[id] ?? 0) > (sizes[largest] ?? 0)) largest = id;
    }

    const keeps = (sizes[largest] ?? 0) / land;
    if (keeps >= minLandShare || attempt === 4) {
      for (let tile = 0; tile < terrain.length; tile++) {
        if (isLand(terrain, tile) && componentOf[tile] !== largest) terrain[tile] = TERRAIN.water;
      }
      return seaHeight;
    }

    // Míň vody = míň ostrovů. Pětina dolů je dost hrubý krok na to, aby se
    // pár pokusy dostal i ze zálivů plných ostrůvků.
    waterShare *= 0.8;
  }

  return seaHeight;
}

/** Očísluje souvislé plochy souše. Vrací pole indexů komponent a jejich velikosti. */
function landComponents(terrain: Uint8Array): {
  componentOf: Int32Array;
  sizes: number[];
} {
  const mapSize = sizeOfLayer(terrain);
  const componentOf = new Int32Array(terrain.length).fill(-1);
  const sizes: number[] = [];

  for (let start = 0; start < terrain.length; start++) {
    if (!isLand(terrain, start) || componentOf[start] !== -1) continue;

    const id = sizes.length;
    let size = 0;
    const stack = [start];
    componentOf[start] = id;

    while (stack.length > 0) {
      const tile = stack.pop();
      if (tile === undefined) break;
      size++;

      const x = tile % mapSize;
      const y = (tile - x) / mapSize;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, mapSize)) continue;
        const next = index(nx, ny, mapSize);
        if (!isLand(terrain, next) || componentOf[next] !== -1) continue;
        componentOf[next] = id;
        stack.push(next);
      }
    }

    sizes.push(size);
  }

  return { componentOf, sizes };
}

function paintBeaches(terrain: Uint8Array, beachWidth: number): void {
  if (beachWidth <= 0) return;

  const size = sizeOfLayer(terrain);
  const distance = new Uint8Array(terrain.length).fill(255);
  let frontier: number[] = [];
  for (let tile = 0; tile < terrain.length; tile++) {
    if (terrain[tile] === TERRAIN.water) {
      distance[tile] = 0;
      frontier.push(tile);
    }
  }

  for (let step = 1; step <= beachWidth && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const tile of frontier) {
      const x = tile % size;
      const y = (tile - x) / size;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, size)) continue;
        const at = index(nx, ny, size);
        if (distance[at] !== 255 || terrain[at] !== TERRAIN.grass) continue;
        distance[at] = step;
        terrain[at] = TERRAIN.sand;
        next.push(at);
      }
    }
    frontier = next;
  }
}

/**
 * Mokřady: nízko položená místa poblíž vody, která vodou nejsou.
 *
 * Kreslí se **až za pískem**, takže vznikají za pobřežním pásem, ne místo něj.
 */
function paintMarshes(
  terrain: Uint8Array,
  height: Float32Array,
  seaLevel: number,
  marshThreshold: number,
): void {
  const size = sizeOfLayer(terrain);
  const limit = seaLevel + marshThreshold;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = index(x, y, size);
      if (terrain[tile] !== TERRAIN.grass) continue;
      if ((height[tile] ?? 0) > limit) continue;

      let nearWater = false;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, size)) continue;
        const at = index(nx, ny, size);
        if (terrain[at] === TERRAIN.water || terrain[at] === TERRAIN.sand) {
          nearWater = true;
          break;
        }
      }

      if (nearWater) terrain[tile] = TERRAIN.marsh;
    }
  }
}
