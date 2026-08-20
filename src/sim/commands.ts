import type { Balance } from '@/content/balance';
import { checkFootprint, placeBuilding } from './buildings';
import type { BuildingCatalogue } from './catalogue';
import {
  cornerInBounds,
  cornerIndex,
  planCornerHeight,
  planLevelArea,
} from './heights';
import { inBounds, index, ROAD, TERRAIN, ZONE } from './layers';
import type { ZoneType } from './layers';
import { categoryForZone } from './rci';
import { checkRequirements, presentDefinitions } from './requirements';
import { needsClearing } from './terrain';
import { OK, reject } from './result';
import type { CommandResult } from './result';
import {
  applyHeightChanges,
  MAX_TAX_RATE,
  MIN_TAX_RATE,
  markCoverageDirty,
  markPowerNetworkDirty,
  markTileDirty,
  removeBuilding,
} from './world';
import type { WorldState } from './world';

/**
 * Všechny hráčské akce jdou přes `SimHost.dispatch`. `WorldState` se nikdy
 * nemodifikuje z UI ani z rendereru přímo.
 *
 * Každá funkce vrací `CommandResult` — když příkaz neprojde, řekne proč.
 */
export type Command =
  | { type: 'build_road'; x: number; y: number; roadType?: number }
  | { type: 'bulldoze'; x: number; y: number }
  | { type: 'zone'; x: number; y: number; w: number; h: number; zone: ZoneType }
  | { type: 'place_building'; definitionId: string; x: number; y: number }
  | { type: 'set_tax_rate'; zone: ZoneType; rate: number }
  | { type: 'set_service_funding'; serviceClass: string; funding: number }
  | { type: 'terraform_corner'; x: number; y: number; delta: number }
  | { type: 'level_area'; x: number; y: number; w: number; h: number }
  | { type: 'set_speed'; speed: number };

/**
 * Změna silnice mění auto-tiling i u čtyř sousedů, takže do `DirtySet` musí
 * i oni — jinak by zůstali vykreslení se starým napojením.
 */
function markRoadNeighbourhoodDirty(world: WorldState, x: number, y: number): void {
  markTileDirty(world, x, y);
  markTileDirty(world, x, y - 1);
  markTileDirty(world, x + 1, y);
  markTileDirty(world, x, y + 1);
  markTileDirty(world, x - 1, y);
}

/**
 * Validace patří sem, ne do UI (architektura §5) — jinak by ji obcházel každý
 * další vstup, který kdy vznikne.
 */
export function buildRoad(
  world: WorldState,
  x: number,
  y: number,
  type: number = ROAD.street,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y)) return reject('error.outOfBounds');

  const tile = index(x, y);
  if (world.layers.terrain[tile] === TERRAIN.water) return reject('error.water');
  if (world.layers.buildingId[tile] !== 0) return reject('error.occupied');
  if (needsClearing(world.layers.terrain[tile] ?? TERRAIN.grass)) {
    return reject('error.terrainNotAllowed');
  }

  const current = world.layers.road[tile] ?? ROAD.none;
  if (current === type) return reject('error.roadExists');
  // Vylepšení na místě ano, snížení ne (§4). Kdo chce ulici zpátky, zbourá
  // a postaví — jinak by se dala třída „prodat" za rozdíl cen.
  if (current > type) return reject('error.roadDowngrade');

  const cost = balance?.traffic.roadTypes[type - 1]?.cost ?? 0;
  if (world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }
  world.economy.funds -= cost;

  world.layers.road[tile] = type;
  markRoadNeighbourhoodDirty(world, x, y);
  markPowerNetworkDirty(world); // silnice je vodič
  return OK;
}

/**
 * Ruční stavba konkrétní budovy. Používá se na to, co nevyroste ze zóny —
 * typicky infrastruktura. Definici hledá v katalogu, takže v kódu není ani
 * jedna budova (P5).
 */
export function placeDefinition(
  world: WorldState,
  catalogue: BuildingCatalogue,
  definitionId: string,
  x: number,
  y: number,
): CommandResult {
  const definition = catalogue.get(definitionId);
  if (!definition) return reject('error.unknownDefinition', { id: definitionId });

  // Zóna se nekontroluje: elektrárna smí stát i na nezónované půdě.
  const fits = checkFootprint(world, definition, x, y);
  if (!fits.ok) return fits;

  // Prerekvizity platí i pro ruční stavbu, ne jen pro růst (§7).
  const met = checkRequirements(world, catalogue, definition, x, y, presentDefinitions(world));
  if (!met.ok) return met;

  // Na co nejsou peníze, to se nepostaví. Na rozdíl od budov, které vyrostou
  // ze zóny samy, tuhle platí hráč.
  const cost = definition.construction.cost;
  if (world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }

  world.economy.funds -= cost;
  placeBuilding(world, definition, x, y);
  return OK;
}

/**
 * Vyznačí obdélník zónou. Dlaždice, na které to nejde (voda, silnice, budova),
 * se přeskočí — hráč nemá důvod řešit, že mu výběr zasahuje do řeky. Když
 * neprojde ani jedna, je to odmítnutí i s důvodem.
 *
 * `ZONE.none` zónu ruší.
 */
export function zoneArea(
  world: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
  zone: ZoneType,
): CommandResult {
  let changed = 0;
  let lastReason = 'error.zoneNoChange';

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (!inBounds(tileX, tileY)) {
        lastReason = 'error.outOfBounds';
        continue;
      }

      const tile = index(tileX, tileY);
      if (world.layers.terrain[tile] === TERRAIN.water) {
        lastReason = 'error.water';
        continue;
      }
      if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) {
        lastReason = 'error.roadInTheWay';
        continue;
      }
      if (world.layers.buildingId[tile] !== 0) {
        lastReason = 'error.occupied';
        continue;
      }
      if (world.layers.zone[tile] === zone) continue;

      world.layers.zone[tile] = zone;
      markTileDirty(world, tileX, tileY);
      changed++;
    }
  }

  return changed > 0 ? OK : reject(lastReason);
}

/**
 * Boura vždycky to nejvrchnější: budovu, jinak silnici, jinak zónu.
 *
 * Zóna po zbourání budovy **zůstává**, aby na ní mohlo vyrůst něco nového —
 * hráč, který chce zónu zrušit, klikne podruhé.
 */
export function bulldoze(
  world: WorldState,
  x: number,
  y: number,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y)) return reject('error.outOfBounds');

  const tile = index(x, y);

  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId !== 0) {
    removeBuilding(world, buildingId);
    return OK;
  }

  if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) {
    world.layers.road[tile] = ROAD.none;
    markRoadNeighbourhoodDirty(world, x, y);
    markPowerNetworkDirty(world);
    return OK;
  }

  if (world.layers.zone[tile] !== ZONE.none) {
    world.layers.zone[tile] = ZONE.none;
    markTileDirty(world, x, y);
    return OK;
  }

  // Vykácení lesa. Stojí peníze a je to **volba**: les do té doby zvedá cenu
  // půdy a pohlcuje znečištění, po vykácení zbude místo na stavbu (§2 fáze 3).
  if (world.layers.terrain[tile] === TERRAIN.forest) {
    const cost = balance?.map.clearForestCost ?? 0;
    if (world.economy.funds < cost) {
      return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
    }
    world.economy.funds -= cost;
    world.layers.terrain[tile] = TERRAIN.grass;
    markTileDirty(world, x, y);
    return OK;
  }

  return reject('error.nothingToBulldoze');
}

/**
 * Financování třídy služeb, 0–1. Mění dosah, sílu i skutečnou údržbu naráz —
 * hráč musí vidět, na čem šetří.
 */
export function setServiceFunding(
  world: WorldState,
  serviceClass: string,
  funding: number,
): CommandResult {
  if (!Number.isFinite(funding)) return reject('error.invalidFunding');

  world.serviceFunding.set(serviceClass, Math.max(0, Math.min(1, funding)));
  markCoverageDirty(world);
  return OK;
}

/** Sazba je v procentech a drží se v <0, 20>. Hodnota mimo rozsah se přiřízne. */
export function setTaxRate(world: WorldState, zone: ZoneType, rate: number): CommandResult {
  const category = categoryForZone(zone);
  if (!category) return reject('error.notAZone');

  world.economy.taxRates[category] = Math.max(
    MIN_TAX_RATE,
    Math.min(MAX_TAX_RATE, Math.round(rate)),
  );
  return OK;
}

/**
 * Terraforming (§7 zadání fáze 3).
 *
 * Dvě věci, které dělá kaskáda z T29, se tady potkávají s ekonomikou: plán se
 * spočítá **napřed** a teprve pak se ptá na peníze, takže cena jde ukázat dřív,
 * než hráč klikne (§12 kritérium 14). A účtuje se **celá kaskáda**, ne jeden
 * roh — zvednutí u strmého svahu rozhýbe desítky rohů a hráč to má vidět na
 * účtu (kritérium 13).
 */
export interface TerraformEstimate {
  /** Kolik rohů se změní včetně kaskády. */
  corners: number;
  cost: number;
  changes: Map<number, number>;
}

/** Dlaždice, které se dotýkají rohu. Roh drží čtyři, u kraje mapy míň. */
function tilesAroundCorner(world: WorldState, corner: number): number[] {
  const cornerSize = world.size + 1;
  const cx = corner % cornerSize;
  const cy = (corner - cx) / cornerSize;

  const tiles: number[] = [];
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ] as const) {
    const x = cx + dx;
    const y = cy + dy;
    if (inBounds(x, y)) tiles.push(index(x, y));
  }
  return tiles;
}

/**
 * Smí se terén na tomhle plánu vůbec hnout?
 *
 * - **pod vodou se nezvedá** — zavážení moře je jiná mechanika, ne terraforming,
 * - **pod budovou se nehýbe vůbec.** Zadání zakazuje snižování; zvedání
 *   zakazuju taky, protože budova stojí na rovině a nakloněný terén pod ní by
 *   ji zavěsil do vzduchu. Srovnat parcelu jde **před** stavbou (to je T33).
 *
 * Silnice se hýbat smí — invariant drží svah v mezích sám.
 */
function checkTerraform(world: WorldState, changes: ReadonlyMap<number, number>): CommandResult {
  for (const [corner, target] of changes) {
    const current = world.cornerHeight[corner] ?? 0;

    for (const tile of tilesAroundCorner(world, corner)) {
      if (world.layers.buildingId[tile] !== 0) return reject('error.terraformBuilding');
      if (target > current && world.layers.terrain[tile] === TERRAIN.water) {
        return reject('error.terraformWater');
      }
    }
  }

  return OK;
}

function estimate(changes: Map<number, number>, balance?: Balance): TerraformEstimate {
  const perCorner = balance?.map.terraformCost ?? 0;
  return { corners: changes.size, cost: changes.size * perCorner, changes };
}

/** Kolik by stálo zvednutí nebo snížení rohu. Nic nemění — jen počítá. */
export function estimateCornerHeight(
  world: WorldState,
  x: number,
  y: number,
  delta: number,
  balance?: Balance,
): TerraformEstimate {
  const corner = cornerIndex(x, y);
  const current = world.cornerHeight[corner] ?? 0;
  return estimate(planCornerHeight(world.cornerHeight, x, y, current + delta), balance);
}

/** Kolik by stálo srovnání oblasti. Nic nemění — jen počítá. */
export function estimateLevelArea(
  world: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
  balance?: Balance,
): TerraformEstimate {
  return estimate(planLevelArea(world.cornerHeight, x, y, w, h), balance);
}

function commit(world: WorldState, plan: TerraformEstimate): CommandResult {
  if (plan.corners === 0) return reject('error.terraformNoChange');

  const allowed = checkTerraform(world, plan.changes);
  if (!allowed.ok) return allowed;

  if (world.economy.funds < plan.cost) {
    return reject('error.notEnoughFunds', { cost: plan.cost, funds: world.economy.funds });
  }
  world.economy.funds -= plan.cost;

  applyHeightChanges(world, plan.changes);
  return OK;
}

/** Zvedne nebo sníží roh mřížky o `delta` pater, i s kaskádou a účtem. */
export function terraformCorner(
  world: WorldState,
  x: number,
  y: number,
  delta: number,
  balance?: Balance,
): CommandResult {
  if (!cornerInBounds(x, y)) return reject('error.outOfBounds');
  return commit(world, estimateCornerHeight(world, x, y, delta, balance));
}

/** Srovná obdélník dlaždic do jedné výšky, i s kaskádou a účtem. */
export function levelArea(
  world: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y)) return reject('error.outOfBounds');
  return commit(world, estimateLevelArea(world, x, y, w, h, balance));
}
