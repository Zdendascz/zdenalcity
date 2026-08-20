import type { Definition } from '@/content/schema';
import { isFlatTile } from './heights';
import { inBounds, index, TERRAIN } from './layers';
import { OK, reject } from './result';
import type { CommandResult } from './result';
import {
  markBuildingDirty,
  markCoverageDirty,
  markPowerNetworkDirty,
  markTileDirty,
  markWaterNetworkDirty,
} from './world';
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
  /**
   * Vynechá kontrolu rovného půdorysu.
   *
   * Používá ji stavba, která si parcelu **předtím srovná** a nechce se ptát
   * dvakrát na totéž. Nikdo jiný ji nastavovat nemá.
   */
  skipFlatCheck?: boolean;
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

      // Budova stojí na rovině (§7 fáze 3). Na svahu by visela jedním rohem ve
      // vzduchu — a srovnat parcelu je nabídka, ne automatika, protože stojí
      // peníze a hráč to má vidět předem (§12 kritérium 14).
      if (!options.skipFlatCheck && !isFlatTile(world.cornerHeight, tileX, tileY)) {
        return reject('error.notFlat');
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
  // Bez vody pod pozemkem se nestaví (§8 fáze 3, kritérium 17). Stačí jedna
  // dlaždice půdorysu — stejné pravidlo, podle kterého má budova vodu.
  if (definition.construction.requiresWater === true && !hasWater(world, definition, x, y)) {
    return reject('error.needsWater');
  }
  // Vodárna musí stát u vody, ze které bere (§8 fáze 3).
  if (definition.construction.nearWater === true && !touchesWater(world, definition, x, y)) {
    return reject('error.needsShore');
  }

  return OK;
}

/** Je pod půdorysem voda z vodovodu? Potrubí musí být položené, ne jen vedle. */
export function hasWater(world: WorldState, definition: Definition, x: number, y: number): boolean {
  const [width, depth] = definition.footprint;
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (!inBounds(x + dx, y + dy)) continue;
      if (world.waterSupply[index(x + dx, y + dy)] === 1) return true;
    }
  }
  return false;
}

/** Sousedí footprint s vodní plochou? Vodárna z ní bere (§8 fáze 3). */
export function touchesWater(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
): boolean {
  const [width, depth] = definition.footprint;
  for (let dy = -1; dy <= depth; dy++) {
    for (let dx = -1; dx <= width; dx++) {
      const onEdge = dx === -1 || dy === -1 || dx === width || dy === depth;
      if (!onEdge) continue;
      const tx = x + dx;
      const ty = y + dy;
      if (!inBounds(tx, ty)) continue;
      if (world.layers.terrain[index(tx, ty)] === TERRAIN.water) return true;
    }
  }
  return false;
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

/**
 * Je na dlaždici hodnota, která znamená „ano"?
 *
 * **Nenulová, ne jednička.** Vrstva `power` je 0/1, ale `road` od T24 nese typ:
 * 1 ulice, 2 třída, 3 dálnice. Porovnání s jedničkou znamenalo, že budovy
 * uznávaly jen ulici a u třídy ani dálnice nešlo stavět — nahlásil autor při
 * hraní.
 */
function isSet(layer: Uint8Array, x: number, y: number): boolean {
  return inBounds(x, y) && (layer[index(x, y)] ?? 0) !== 0;
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
  markWaterNetworkDirty(world); // a mohla to být vodárna nebo čerpací stanice
  if (definition.service) markCoverageDirty(world);
  return building;
}
