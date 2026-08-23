import { coarseIndex } from '../coarse';
import { markCoverageDirty, markTileDirty, removeBuilding } from '../world';
import type { WorldState } from '../world';
import { coarseCellsOfShape, tilesOf } from './shapes';
import type { Shape, ShapeFilter } from './shapes';
import type { Modifier } from './state';

/**
 * Společné operace katastrof (R13 fáze 4).
 *
 * Rozhodnutí autora zní: každá katastrofa má vlastní mechaniku, ne konfiguraci
 * nad společným tvarem. Podmínkou je, že **tohle** se nekopíruje. Patnáct
 * vlastních verzí „zboř, co je v okruhu" by se lišilo v tom, jestli počítají
 * s budovou, která do okruhu zasahuje jen rohem, a hráč by z toho měl patnáct
 * různých pravidel.
 *
 * Vrací počty, ne texty (§10 fáze 2) — hlášení skládá UI.
 *
 * Dočasné postihy se **neuplatňují tady**. Zapíšou se do `world.disasters
 * .modifiers` a přečte si je systém, který tu veličinu vlastní; jinak by je
 * přepsal hned při příštím běhu.
 */

/** Zbourá, co ve tvaru stojí. Vrací počet zničených budov. */
export function destroyArea(
  world: WorldState,
  shape: Shape,
  filter?: ShapeFilter,
): number {
  const doomed = new Set<number>();
  for (const tile of tilesOf(world, shape, filter)) {
    const buildingId = world.layers.buildingId[tile] ?? 0;
    if (buildingId !== 0) doomed.add(buildingId);
  }

  // Vzestupně podle id, aby na pořadí nezáleželo, v jakém pořadí je našel tvar.
  let destroyed = 0;
  for (const id of [...doomed].sort((a, b) => a - b)) {
    if (removeBuilding(world, id)) destroyed++;
  }
  return destroyed;
}

/**
 * Zapálí dlaždice tvaru. Vrací počet nových ohnisek.
 *
 * Vrstvy ohně přidává T48; do té doby je tohle **prázdná operace**, která
 * vrací nulu. Je to vědomý dluh, ne opomenutí: ostatní katastrofy na ni
 * odkazují a je lepší, aby volání existovalo a nic nedělalo, než aby patnáct
 * míst čekalo s prázdným `TODO`.
 */
export function ignite(
  world: WorldState,
  shape: Shape,
  intensity: number,
  filter?: ShapeFilter,
): number {
  const fire = world.fire;
  if (!fire) return 0;

  let lit = 0;
  for (const tile of tilesOf(world, shape, filter)) {
    if ((fire[tile] ?? 0) > 0) continue;
    fire[tile] = Math.max(0, Math.min(255, Math.round(intensity)));
    markTileAt(world, tile);
    lit++;
  }
  return lit;
}

/** Zaplaví dlaždice tvaru do dané hloubky. Vrstvu přidává T49. */
export function floodArea(
  world: WorldState,
  shape: Shape,
  depth: number,
  filter?: ShapeFilter,
): number {
  const flood = world.flood;
  if (!flood) return 0;

  let flooded = 0;
  for (const tile of tilesOf(world, shape, filter)) {
    const value = Math.max(0, Math.min(255, Math.round(depth)));
    if (value <= (flood[tile] ?? 0)) continue;
    flood[tile] = value;
    markTileAt(world, tile);
    flooded++;
  }
  return flooded;
}

/**
 * Sníží pokrytí třídy služeb na `factor` násobek po dobu `duration` tiků.
 *
 * Uplatní ho `serviceSystem` po přepočtu pokrytí. Kdyby se zapsalo rovnou do
 * vrstvy, první běh systému by ho přepsal a hráč by si stávky ani nevšiml.
 */
export function suppressService(
  world: WorldState,
  serviceClass: string,
  shape: Shape,
  factor: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'suppressService',
    serviceClass,
    cells: cellsFor(world, shape),
    amount: factor,
    until: world.tick + duration,
    source,
  });
  markCoverageDirty(world);
}

/** Zvýší dopravní zátěž na `factor` násobek. Uplatní `trafficSystem`. */
export function spikeTraffic(
  world: WorldState,
  shape: Shape,
  factor: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'spikeTraffic',
    cells: cellsFor(world, shape),
    amount: factor,
    until: world.tick + duration,
    source,
  });
}

/** Přičte ke kriminalitě. Uplatní `crimeSystem` po difuzi. */
export function spikeCrime(
  world: WorldState,
  shape: Shape,
  amount: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'spikeCrime',
    cells: cellsFor(world, shape),
    amount,
    until: world.tick + duration,
    source,
  });
}

/**
 * Drží kriminalitu **aspoň** na dané hodnotě (válka gangů).
 *
 * Na rozdíl od `spikeCrime` se nepřičítá: čtvrť ovládaná gangem má svoje dno
 * bez ohledu na to, kolik do ní hráč nasype policie. Právě proto je válka
 * gangů nejdelší katastrofa v katalogu — nedá se přeplatit, jen přečkat.
 */
export function crimeFloor(
  world: WorldState,
  shape: Shape,
  minValue: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'crimeFloor',
    cells: cellsFor(world, shape),
    amount: minValue,
    until: world.tick + duration,
    source,
  });
}

/** Srazí spokojenost. Uplatní `happinessSystem`. */
export function happinessPenalty(
  world: WorldState,
  shape: Shape,
  amount: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'happinessPenalty',
    cells: cellsFor(world, shape),
    amount,
    until: world.tick + duration,
    source,
  });
}

/** Srazí cenu půdy. Uplatní `landValueSystem`. */
export function landValuePenalty(
  world: WorldState,
  shape: Shape,
  amount: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'landValuePenalty',
    cells: cellsFor(world, shape),
    amount,
    until: world.tick + duration,
    source,
  });
}

/**
 * Jednorázový výdech znečištění.
 *
 * Zapisuje se **rovnou do vrstvy**, ne jako postih: znečištění je difuzní
 * veličina, která si mrak sama rozfouká a nechá opadnout. Přesně tak se chová
 * i kouř ze skutečného výbuchu.
 */
export function pollutionBurst(world: WorldState, shape: Shape, amount: number): number {
  const cells = cellsFor(world, shape);
  const layer = world.coarse.pollution;
  for (const cell of cells) {
    layer[cell] = Math.max(0, Math.min(255, (layer[cell] ?? 0) + amount));
  }
  world.dirty.coarseChanged = true;
  return cells.length;
}

/** Zamoří vodu — vodárny v zasažených buňkách přestanou dodávat. */
export function contaminateWater(
  world: WorldState,
  shape: Shape,
  intensity: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'contaminateWater',
    cells: cellsFor(world, shape),
    amount: intensity,
    until: world.tick + duration,
    source,
  });
  world.waterNetworkDirty = true;
}

/**
 * Ubere obyvatele podílem `ratio`. Vrací, o kolik lidí město přišlo.
 *
 * Budova nezmizí — epidemie ani havárie domy neboří. Prázdný dům se časem
 * zaplní zpátky, což je ta správná pomalá cesta: hráč vidí, že se město
 * vzpamatovává, ne že mu na mapě chybí kus.
 */
export function populationLoss(
  world: WorldState,
  shape: Shape,
  ratio: number,
  filter?: ShapeFilter,
): number {
  const hit = new Set<number>();
  for (const tile of tilesOf(world, shape, filter)) {
    const buildingId = world.layers.buildingId[tile] ?? 0;
    if (buildingId !== 0) hit.add(buildingId);
  }

  let lost = 0;
  for (const id of [...hit].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building || building.population === 0) continue;
    const gone = Math.min(building.population, Math.round(building.population * ratio));
    building.population -= gone;
    lost += gone;
  }
  return lost;
}

/** Zablokuje dlaždici — doprava přes ni neprojde. Uplatní `trafficSystem`. */
export function blockTile(
  world: WorldState,
  tile: number,
  duration: number,
  source = 0,
): void {
  pushModifier(world, {
    kind: 'blockTile',
    cells: [tile],
    amount: 1,
    until: world.tick + duration,
    source,
  });
}

/**
 * Zahodí postihy, kterým vypršel čas.
 *
 * Volá se jednou za tik z plánovače. Kdyby se čistilo až při čtení, seznam by
 * u dlouhé hry rostl donekonečna.
 */
export function expireModifiers(world: WorldState): void {
  const modifiers = world.disasters.modifiers;
  let write = 0;
  for (let read = 0; read < modifiers.length; read++) {
    const modifier = modifiers[read];
    if (!modifier || modifier.until <= world.tick) continue;
    modifiers[write++] = modifier;
  }
  modifiers.length = write;
}

/** Zruší postihy, které zavedla daná katastrofa. Volá se, když skončí. */
export function clearModifiersOf(world: WorldState, source: number): void {
  const modifiers = world.disasters.modifiers;
  let write = 0;
  for (let read = 0; read < modifiers.length; read++) {
    const modifier = modifiers[read];
    if (!modifier || modifier.source === source) continue;
    modifiers[write++] = modifier;
  }
  modifiers.length = write;
}

/**
 * Nejsilnější postih daného druhu pro buňku, nebo `fallback`, když žádný není.
 *
 * Postihy se **neskládají**. Dvě stávky ve stejné čtvrti nepotlačí hasiče na
 * čtvrtinu — platí ta horší. Skládání by z několika souběžných katastrof
 * udělalo násobek, ze kterého se město nevzpamatuje.
 */
export function strongestModifier(
  world: WorldState,
  kind: Modifier['kind'],
  cell: number,
  fallback: number,
  serviceClass?: string,
  pick: (a: number, b: number) => number = Math.min,
): number {
  let value = fallback;
  let found = false;
  for (const modifier of world.disasters.modifiers) {
    if (modifier.kind !== kind) continue;
    if (serviceClass !== undefined && modifier.serviceClass !== serviceClass) continue;
    // Prázdný seznam buněk znamená celé město.
    if (modifier.cells.length > 0 && !modifier.cells.includes(cell)) continue;
    value = found ? pick(value, modifier.amount) : modifier.amount;
    found = true;
  }
  return value;
}

/** Je dlaždice zablokovaná? Ptá se na to hledání cesty. */
export function isBlocked(world: WorldState, tile: number): boolean {
  for (const modifier of world.disasters.modifiers) {
    if (modifier.kind === 'blockTile' && modifier.cells.includes(tile)) return true;
  }
  return false;
}

function pushModifier(world: WorldState, modifier: Modifier): void {
  world.disasters.modifiers.push(modifier);
}

function cellsFor(world: WorldState, shape: Shape): number[] {
  return coarseCellsOfShape(world, shape);
}

function markTileAt(world: WorldState, tile: number): void {
  const x = tile % world.size;
  markTileDirty(world, x, (tile - x) / world.size);
}

/** Buňka hrubé mřížky pro dlaždici. Vystaveno kvůli katastrofám, které si ji počítají samy. */
export function cellOfTile(world: WorldState, tile: number): number {
  const x = tile % world.size;
  return coarseIndex(x, (tile - x) / world.size, world.size);
}
