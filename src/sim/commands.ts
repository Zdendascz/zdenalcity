import { checkFootprint, placeBuilding } from './buildings';
import type { BuildingCatalogue } from './catalogue';
import { inBounds, index, TERRAIN, ZONE } from './layers';
import type { ZoneType } from './layers';
import { categoryForZone } from './rci';
import { checkRequirements, presentDefinitions } from './requirements';
import { OK, reject } from './result';
import type { CommandResult } from './result';
import {
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
  | { type: 'build_road'; x: number; y: number }
  | { type: 'bulldoze'; x: number; y: number }
  | { type: 'zone'; x: number; y: number; w: number; h: number; zone: ZoneType }
  | { type: 'place_building'; definitionId: string; x: number; y: number }
  | { type: 'set_tax_rate'; zone: ZoneType; rate: number }
  | { type: 'set_service_funding'; serviceClass: string; funding: number }
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
export function buildRoad(world: WorldState, x: number, y: number): CommandResult {
  if (!inBounds(x, y)) return reject('error.outOfBounds');

  const tile = index(x, y);
  if (world.layers.terrain[tile] === TERRAIN.water) return reject('error.water');
  if (world.layers.buildingId[tile] !== 0) return reject('error.occupied');
  if (world.layers.road[tile] === 1) return reject('error.roadExists');

  world.layers.road[tile] = 1;
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
      if (world.layers.road[tile] === 1) {
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
export function bulldoze(world: WorldState, x: number, y: number): CommandResult {
  if (!inBounds(x, y)) return reject('error.outOfBounds');

  const tile = index(x, y);

  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId !== 0) {
    removeBuilding(world, buildingId);
    return OK;
  }

  if (world.layers.road[tile] === 1) {
    world.layers.road[tile] = 0;
    markRoadNeighbourhoodDirty(world, x, y);
    markPowerNetworkDirty(world);
    return OK;
  }

  if (world.layers.zone[tile] !== ZONE.none) {
    world.layers.zone[tile] = ZONE.none;
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
