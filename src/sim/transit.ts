import type { Balance, TransitModeBalance } from '@/content/balance';
import type { BuildingCatalogue } from './catalogue';
import { COARSE_FACTOR, coarseIndex, coarseSizeOf } from './coarse';
import { index, ROAD } from './layers';
import type { WorldState } from './world';

/**
 * Linky MHD (§7 fáze 4).
 *
 * Rozšiřuje třídu `transit` z fáze 3, kde zastávka nedělala nic než pokrytí.
 * Linka je nadstavba, ne náhrada: zastávka pokrývá dál sama o sobě, linka jí
 * dá kapacitu a jízdné.
 *
 * **Trasa se nekreslí** (rozhodnutí autora) — hráč vybere zastávky a pořadí,
 * zbytek je abstrakce. Kudy to jede, se dopočítá jako úsečka mezi sousedními
 * zastávkami; slouží to jedinému účelu, a to tramvaji, která **sdílí dlaždici
 * se silnicí a ubírá jí kapacitu**. Bez toho by nebyl důvod volit autobus.
 *
 * Mód je **jméno z katalogu**, ne výčet v kódu. Vlastnosti si nese obsah
 * (P5): kapacita vozidla, cena, údržba, kolik silnice ukrojí a jestli
 * potřebuje proud.
 */

export interface TransitLine {
  id: number;
  /** Jméno módu z katalogu — `bus`, `tram`, `metro` ve vanille. */
  mode: string;
  /** Id budov se zastávkou, v pořadí, ve kterém linka jede. */
  stops: number[];
  vehicles: number;
  /** Jízdné za cestu. Účinek přidává T56. */
  fare: number;
}

export type LineProblem =
  | 'unknownMode'
  | 'tooFewStops'
  | 'tooManyStops'
  | 'notAStop'
  | 'wrongMode'
  | 'duplicateStop';

/** Vlastnosti módu z katalogu, nebo `undefined` u módu, který obsah nezná. */
export function modeOf(balance: Balance, mode: string): TransitModeBalance | undefined {
  return balance.transit.modes[mode];
}

/**
 * Je budova zastávkou daného módu?
 *
 * Ptá se katalogu, ne id budovy: mod si přidá vlastní zastávku a hra o ní
 * nemusí vědět.
 */
export function stopMode(
  world: WorldState,
  catalogue: BuildingCatalogue,
  buildingId: number,
): string | null {
  const building = world.buildings.get(buildingId);
  if (!building) return null;
  return catalogue.get(building.definitionId)?.transit?.mode ?? null;
}

/**
 * Co je na lince špatně. Prázdné pole znamená „v pořádku".
 *
 * Vrací **všechny** problémy, ne první: hráč, který sestavuje linku, má vidět
 * celý seznam, ne ho odkrývat po jednom.
 */
export function lineProblems(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  line: TransitLine,
): LineProblem[] {
  const problems: LineProblem[] = [];
  if (!modeOf(balance, line.mode)) problems.push('unknownMode');
  if (line.stops.length < balance.transit.minStops) problems.push('tooFewStops');
  if (line.stops.length > balance.transit.maxStops) problems.push('tooManyStops');

  const seen = new Set<number>();
  for (const stop of line.stops) {
    if (seen.has(stop)) {
      if (!problems.includes('duplicateStop')) problems.push('duplicateStop');
      continue;
    }
    seen.add(stop);

    const mode = stopMode(world, catalogue, stop);
    if (mode === null) {
      if (!problems.includes('notAStop')) problems.push('notAStop');
    } else if (mode !== line.mode) {
      if (!problems.includes('wrongMode')) problems.push('wrongMode');
    }
  }
  return problems;
}

/**
 * Jede linka teď?
 *
 * Elektrická linka **nejezdí, když nemá proud** — tramvaj ani metro se bez
 * elektřiny nehnou, a je to jeden z důvodů, proč blackout otevírá dveře všemu
 * ostatnímu. Autobus jezdí dál; naftu blackout nezastaví.
 *
 * Stačí, aby byla bez proudu **jediná** zastávka: linka je jeden okruh, ne
 * několik nezávislých kusů.
 */
export function lineRuns(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  line: TransitLine,
): boolean {
  if (line.vehicles <= 0) return false;
  if (lineProblems(world, catalogue, balance, line).length > 0) return false;

  const mode = modeOf(balance, line.mode);
  if (!mode?.needsPower) return true;

  for (const stop of line.stops) {
    if (world.buildings.get(stop)?.powered !== true) return false;
  }
  return true;
}

/**
 * Silniční dlaždice, po kterých linka vede.
 *
 * Úsečka mezi sousedními zastávkami, oříznutá na to, co je opravdu silnice.
 * Není to hledání cesty a schválně: trasa se nekreslí, tohle je jen odhad
 * koridoru, aby tramvaj měla čemu ubrat kapacitu. Kdyby se hledala skutečná
 * cesta, hráč by čekal, že po ní tramvaj i **pojede** — a ona nikam nejede,
 * protože je to abstrakce.
 */
export function corridorTiles(world: WorldState, line: TransitLine): number[] {
  const tiles = new Set<number>();

  for (let i = 1; i < line.stops.length; i++) {
    const from = world.buildings.get(line.stops[i - 1] ?? 0);
    const to = world.buildings.get(line.stops[i] ?? 0);
    if (!from || !to) continue;

    for (const tile of segment(world, from, to)) {
      // Pás kolem úsečky, ne úsečka sama. **Zastávka stojí vedle silnice**, ne
      // na ní — spojnice dvou zastávek by tak nemusela protnout vozovku vůbec
      // a tramvaj by neubírala nic. Vyzkoušené: linka podél ulice dala nula
      // dlaždic, protože zastávky ležely o řadu vedle.
      for (const near of aroundTile(world, tile)) {
        if ((world.layers.road[near] ?? ROAD.none) !== ROAD.none) tiles.add(near);
      }
    }
  }

  return [...tiles].sort((a, b) => a - b);
}

/** Dlaždice a její čtyři sousedé, oříznuté na mapu. */
function aroundTile(world: WorldState, tile: number): number[] {
  const x = tile % world.size;
  const y = (tile - x) / world.size;
  const out = [tile];

  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
    out.push(index(nx, ny, world.size));
  }
  return out;
}

/** Dlaždice úsečky mezi dvěma body včetně obou konců (Bresenham). */
function segment(
  world: WorldState,
  from: { x: number; y: number },
  to: { x: number; y: number },
): number[] {
  const tiles: number[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const stepX = x < to.x ? 1 : -1;
  const stepY = y < to.y ? 1 : -1;
  let error = dx + dy;

  // Strop kroků: bez něj by chyba v datech (zastávka mimo mapu) roztočila
  // nekonečnou smyčku uvnitř simulace.
  const limit = world.size * 2;
  for (let step = 0; step < limit; step++) {
    if (x >= 0 && y >= 0 && x < world.size && y < world.size) {
      tiles.push(index(x, y, world.size));
    }
    if (x === to.x && y === to.y) break;

    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
  return tiles;
}

/**
 * Přepočítá, které silnice ukusuje kolejová doprava.
 *
 * Drží se v `world.tramTiles` jako udržovaný seznam (R20): kolony se počítají
 * z každé silniční dlaždice a ptát se přitom pokaždé na všechny linky by byl
 * součin dvou velkých čísel.
 *
 * Kapacitu ubírá **kolej, ne provoz**: penalizace platí i během blackoutu, kdy
 * tramvaje stojí. Koleje z vozovky nezmizí tím, že po nich nikdo nejede.
 */
export function rebuildTramTiles(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): void {
  world.tramTiles.clear();

  for (const line of world.lines) {
    const mode = modeOf(balance, line.mode);
    if (!mode || mode.roadShare <= 0) continue;
    if (lineProblems(world, catalogue, balance, line).length > 0) continue;

    for (const tile of corridorTiles(world, line)) {
      const worst = world.tramTiles.get(tile) ?? 0;
      // Dvě linky přes jednu ulici neubírají dvakrát — platí ta horší. Stejné
      // pravidlo jako u postihů z katastrof.
      world.tramTiles.set(tile, Math.max(worst, mode.roadShare));
    }
  }

  world.transitDirty = false;
}

/**
 * Kolik kapacity zbývá silnici po kolejích, 0–1.
 *
 * Čte se z udržovaného seznamu, takže dotaz stojí jeden `Map.get`.
 */
export function roadCapacityFactor(world: WorldState, tile: number): number {
  if (world.tramTiles.size === 0) return 1;
  return 1 - (world.tramTiles.get(tile) ?? 0);
}

/** Nová linka bez zastávek. Vlastní evidenci si drží svět. */
export function createLine(world: WorldState, mode: string): TransitLine {
  const line: TransitLine = {
    id: world.nextLineId++,
    mode,
    stops: [],
    vehicles: 0,
    fare: 0,
  };
  world.lines.push(line);
  world.transitDirty = true;
  return line;
}

export function findLine(world: WorldState, id: number): TransitLine | undefined {
  return world.lines.find((line) => line.id === id);
}

export function removeLine(world: WorldState, id: number): boolean {
  const at = world.lines.findIndex((line) => line.id === id);
  if (at < 0) return false;
  world.lines.splice(at, 1);
  world.transitDirty = true;
  return true;
}

/**
 * Zastávky linky, které stojí. Zbytek se přeskočí.
 *
 * Zbouraná zastávka z linky **nezmizí sama** — smazat ji musí příkaz, jinak by
 * se hráči linka tiše rozpadla a on by nevěděl proč. Systémy si ale musí umět
 * poradit s tím, že zastávka zrovna neexistuje.
 */
export function liveStops(world: WorldState, line: TransitLine): number[] {
  return line.stops.filter((stop) => world.buildings.has(stop));
}

/* ------------------------------------------------- jízdné a přeprava (T56) */

/** Co linka za měsíc odveze a vydělá. Do rozpočtu, hlášení i panelu. */
export interface LineStats {
  /** Lidé v dosahu zastávek, o které se linka uchází. */
  demand: number;
  /** `vozidla × kapacita módu`. */
  capacity: number;
  /** Kolik jich opravdu odveze. Nikdy víc než kapacita ani než poptávka. */
  transported: number;
  /** `přepraveno × jízdné` za měsíc. */
  income: number;
  upkeep: number;
}

export function noStats(): LineStats {
  return { demand: 0, capacity: 0, transported: 0, income: 0, upkeep: 0 };
}

/**
 * Kolik lidí je ochotno zaplatit dané jízdné, 0–1.
 *
 * Lineární pokles do nuly na `fareLimit`. Příjem je `přepraveno × jízdné`,
 * takže součin dává parabolu: **zvýšení jízdného zvedne příjem jen do
 * poloviny limitu, pak ho sráží.** Optimum se dá najít, a to je smysl —
 * jízdné je rozhodnutí, ne posuvník s jedním správným koncem.
 */
export function fareSensitivity(balance: Balance, fare: number): number {
  const limit = balance.transit.fareLimit;
  if (limit <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - fare / limit));
}

/**
 * Buňky, které linka obsluhuje: dosah zastávek podle katalogu.
 *
 * Dosah je vlastnost **zastávky**, ne linky: metro obslouží víc než autobusová
 * zastávka, protože k němu lidé dojdou dál. Sjednocené, ne sečtené — dvě
 * zastávky vedle sebe nepokrývají tutéž ulici dvakrát.
 */
export function servedCells(
  world: WorldState,
  catalogue: BuildingCatalogue,
  line: TransitLine,
): number[] {
  const cells = new Set<number>();
  const side = coarseSizeOf(world.size);

  for (const stop of line.stops) {
    const building = world.buildings.get(stop);
    if (!building) continue;
    // Dosah je v **dlaždicích**, buňka hrubé mřížky jich má `COARSE_FACTOR`.
    //
    // Tudy oprava jednotky z T91 nešla a zůstalo tu čtení po buňkách, takže
    // linka sbírala poptávku ze čtyřikrát většího okolí, než kam zastávka
    // doopravdy dosáhne. Vyplavalo to, až když se dosahy služeb přepočítaly:
    // testovací městečko se celé vešlo do dosahu jedné zastávky.
    const radiusTiles = catalogue.get(building.definitionId)?.service?.radius ?? 0;
    const radius = radiusTiles / COARSE_FACTOR;
    if (radius <= 0) continue;

    const origin = coarseIndex(building.x, building.y, world.size);
    const originX = origin % side;
    const originY = (origin - originX) / side;
    const reach = Math.ceil(radius);

    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cx = originX + dx;
        const cy = originY + dy;
        if (cx < 0 || cy < 0 || cx >= side || cy >= side) continue;
        if (Math.hypot(dx, dy) > radius) continue;
        cells.add(cy * side + cx);
      }
    }
  }
  return [...cells].sort((a, b) => a - b);
}

/** Lidé po buňkách: obyvatelé i pracovní místa. Obojí někam jezdí. */
function ridersPerCell(world: WorldState): Map<number, number> {
  const perCell = new Map<number, number>();
  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    const riders = building.population + building.jobs;
    if (riders <= 0) continue;
    const cell = coarseIndex(building.x, building.y, world.size);
    perCell.set(cell, (perCell.get(cell) ?? 0) + riders);
  }
  return perCell;
}

/**
 * Rozdělí cestující mezi linky a spočítá, co která odveze.
 *
 * **Lidé jsou společný a konečný fond.** Linky se o ně dělí v pořadí podle id,
 * každá si vezme, co unese, a další už bere jen ze zbytku. Bez toho by šlo
 * postavit deset stejných linek přes jednu čtvrť a každá by vozila — a
 * vydělávala — na týchž lidech.
 *
 * Zároveň z toho plyne přesně to, co má hráč poznat: **druhá linka přes tutéž
 * čtvrť pomůže, až když je ta první plná.** Přidat vozidla je většinou lepší
 * než přidat linku.
 */
export function computeLineStats(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): void {
  const total = ridersPerCell(world);
  const left = new Map(total);
  world.lineStats.clear();
  world.transitRelief.clear();

  // Vzestupně podle id: pořadí rozhoduje o tom, kdo bere první, takže nesmí
  // záviset na pořadí v poli (to mění mazání linek).
  for (const line of [...world.lines].sort((a, b) => a.id - b.id)) {
    const stats = noStats();
    world.lineStats.set(line.id, stats);

    const mode = modeOf(balance, line.mode);
    if (!mode) continue;

    stats.upkeep = line.vehicles * mode.vehicleUpkeep;
    if (!lineRuns(world, catalogue, balance, line)) continue;

    stats.capacity = line.vehicles * mode.capacity;
    const cells = servedCells(world, catalogue, line);

    let available = 0;
    for (const cell of cells) available += left.get(cell) ?? 0;
    stats.demand = available;
    if (available <= 0) continue;

    const willing = available * fareSensitivity(balance, line.fare);
    stats.transported = Math.min(stats.capacity, willing);
    stats.income = Math.round(stats.transported * line.fare);
    if (stats.transported <= 0) continue;

    // Odebírá se **poměrně ze všech obsluhovaných buněk**, ne postupně od
    // první. Jinak by čtvrť u první zastávky měla plnou obsluhu a ta u poslední
    // žádnou, přestože jsou na téže lince.
    const share = stats.transported / available;
    for (const cell of cells) {
      const here = left.get(cell) ?? 0;
      if (here <= 0) continue;
      const taken = here * share;
      left.set(cell, here - taken);

      const capacity = total.get(cell) ?? 0;
      if (capacity <= 0) continue;
      world.transitRelief.set(cell, (world.transitRelief.get(cell) ?? 0) + taken / capacity);
    }
  }

  // Strop úlevy se **nehlídá**: plyne z toho, že se odebírá ze zbytku. Součet
  // odvezených přes všechny linky nemůže překročit, kolik lidí v buňce je,
  // takže součet podílů nemůže překročit jedničku. `Math.min(1, …)` navíc by
  // byl kód, který nejde rozbít — a takový kód jen předstírá, že něco hlídá.
}

/** Kolik cest v buňce vezme MHD, 0–1. Čte doprava. */
export function transitReliefAt(world: WorldState, cell: number): number {
  if (world.transitRelief.size === 0) return 0;
  return world.transitRelief.get(cell) ?? 0;
}

/** Součet přes všechny linky. Do rozpočtu. */
export function transitTotals(world: WorldState): { income: number; upkeep: number; vehicles: number } {
  let income = 0;
  let upkeep = 0;
  let vehicles = 0;
  for (const line of world.lines) {
    const stats = world.lineStats.get(line.id);
    income += stats?.income ?? 0;
    upkeep += stats?.upkeep ?? 0;
    vehicles += line.vehicles;
  }
  return { income, upkeep, vehicles };
}
