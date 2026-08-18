import type { Definition } from '@/content/schema';
import { inBounds, index } from './layers';
import { OK, reject } from './result';
import type { CommandResult } from './result';
import { markBuildingDirty, markCoverageDirty, markPowerNetworkDirty, markTileDirty } from './world';
import type { Building, WorldState } from './world';

/**
 * Stavba a testování místa pro budovu. Sdílí to růstový systém (staví sám)
 * i příkaz `place_building` (staví hráč) — pravidla musí být na jednom místě,
 * jinak by se rozešla.
 */

export interface FitOptions {
  /** Když je zadáno, všechny dlaždice footprintu musí mít právě tuhle zónu. */
  requireZone?: number;
  /**
   * Vynechá kontrolu sousedství se silnicí.
   *
   * Používá ji růst, kterému silnici nahradil **dosah** (§9 zadání fáze 2):
   * parcela dvě dlaždice od vozovky se zastavět smí, jen vzácněji. Ruční
   * stavba hráče pravidlo z definice dodržuje dál.
   */
  skipRoadCheck?: boolean;
}

/**
 * Vejde se budova na tohle místo? Vrací **konkrétní důvod**, ne jen ano/ne —
 * hráč musí vědět, proč mu klik nic neudělal.
 */
export function checkFootprint(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
  options: FitOptions = {},
): CommandResult {
  const [width, depth] = definition.footprint;

  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (!inBounds(tileX, tileY)) {
        return reject('error.outOfBounds');
      }

      const tile = index(tileX, tileY);
      if (options.requireZone !== undefined && world.layers.zone[tile] !== options.requireZone) {
        return reject('error.wrongZone');
      }
      if (world.layers.road[tile] !== 0) {
        return reject('error.roadInTheWay');
      }
      if (world.layers.buildingId[tile] !== 0) {
        // Vlastní klíč, ne `error.occupied`: u víceldlaždicové budovy je
        // podstatné, kolik místa potřebuje, a text s parametry by u jednoduché
        // silnice vypsal syrové zástupné symboly.
        return reject('error.occupiedFootprint', { width, depth });
      }

      const terrain = world.layers.terrain[tile] ?? 0;
      if (!definition.construction.allowedTerrain.includes(terrain)) {
        return reject('error.terrainNotAllowed');
      }
    }
  }

  if (
    definition.construction.requiresRoad &&
    !options.skipRoadCheck &&
    !touchesRoad(world, definition, x, y)
  ) {
    return reject('error.needsRoad');
  }
  if (definition.construction.requiresPower && !touchesPower(world, definition, x, y)) {
    return reject('error.needsPower');
  }

  return OK;
}

/** Sousedí footprint aspoň jednou stranou se silnicí? */
export function touchesRoad(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
): boolean {
  return touchesLayerValue(world.layers.road, definition, x, y);
}

/**
 * Sousedí footprint s dlaždicí, kam vede proud? Vlastní dlaždice se nepočítají —
 * budova ještě nestojí, takže vodičem není.
 */
export function touchesPower(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
): boolean {
  return touchesLayerValue(world.layers.power, definition, x, y);
}

function touchesLayerValue(
  layer: Uint8Array,
  definition: Definition,
  x: number,
  y: number,
): boolean {
  const [width, depth] = definition.footprint;

  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (
        isSet(layer, tileX, tileY - 1) ||
        isSet(layer, tileX + 1, tileY) ||
        isSet(layer, tileX, tileY + 1) ||
        isSet(layer, tileX - 1, tileY)
      ) {
        return true;
      }
    }
  }

  return false;
}

function isSet(layer: Uint8Array, x: number, y: number): boolean {
  return inBounds(x, y) && layer[index(x, y)] === 1;
}

export function placeBuilding(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
): Building {
  const building: Building = {
    id: world.nextBuildingId++,
    definitionId: definition.id,
    x,
    y,
    level: definition.level, // úroveň je vlastnost definice, entita ji jen nese
    population: definition.population?.capacity ?? 0,
    jobs: definition.jobs?.capacity ?? 0,
    powered: false, // dořeší powerSystem v nejbližším tiku
    builtAtTick: world.tick,
    levelChangedAtTick: world.tick,
    abandoned: false,
  };

  world.buildings.set(building.id, building);

  const [width, depth] = definition.footprint;
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      world.layers.buildingId[index(x + dx, y + dy)] = building.id;
      markTileDirty(world, x + dx, y + dy);
    }
  }

  markBuildingDirty(world, building.id);
  markPowerNetworkDirty(world); // budova je vodič, síť se mění
  if (definition.service) markCoverageDirty(world);
  return building;
}
