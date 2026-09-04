import type { Definition } from '@/content/schema';
import { isFlatTile } from './heights';
import { inBounds, index, ROAD, sizeOfLayer, TERRAIN, terrainNameKey, ZONE } from './layers';
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
      if (!inBounds(tileX, tileY, world.size)) {
        return reject('error.outOfBounds');
      }

      const tile = index(tileX, tileY, world.size);
      if (
        options.requireZone !== undefined &&
        world.layers.zone[tile] !== options.requireZone
      ) {
        // Řekne se **která zóna** je potřeba a co tam je teď. „Celý půdorys
        // musí ležet ve stejné zóně" hráči neporadí, kterým směrem to spravit.
        return reject('error.wrongZone', {
          needed: zoneNameKey(options.requireZone),
          found: zoneNameKey(world.layers.zone[tile] ?? ZONE.none),
        });
      }
      if (world.layers.road[tile] !== 0) {
        return reject('error.roadInTheWay');
      }
      // Trosky blokují stavbu, dokud je hráč neuklidí (R15). Je to jediný
      // důvod, proč po katastrofě není město hned zase stavitelné — a zároveň
      // to, co dělá z úklidu rozhodnutí, kam dát peníze dřív.
      if ((world.rubble[tile] ?? 0) !== 0) {
        return reject('error.rubbleInTheWay');
      }
      if (world.layers.buildingId[tile] !== 0) {
        // Vlastní klíč, ne `error.occupied`: u víceldlaždicové budovy je
        // podstatné, kolik místa potřebuje, a text s parametry by u jednoduché
        // silnice vypsal syrové zástupné symboly.
        return reject('error.occupiedFootprint', { width, depth });
      }
      // Voda se hlásí zvlášť od ostatních terénů: „na vodu se stavět nedá" je
      // úplná odpověď, kdežto u skály nebo lesa hráč potřebuje vědět, co ta
      // budova vlastně chce.
      if ((world.layers.terrain[tile] ?? 0) === TERRAIN.water) {
        return reject('error.water');
      }

      const terrain = world.layers.terrain[tile] ?? 0;
      if (!definition.construction.allowedTerrain.includes(terrain)) {
        // **Co tam je a co by tam šlo.** Samotné „na tenhle terén se to
        // postavit nedá" autor nahlásil jako nedostatečné: neřekne ani co je
        // pod tím, ani kam s tím jít místo toho.
        return reject('error.terrainNotAllowed', {
          terrain: terrainNameKey(terrain),
          allowed: definition.construction.allowedTerrain.map(terrainNameKey).join(','),
        });
      }

      // Budova stojí na rovině (§7 fáze 3). Na svahu by visela jedním rohem ve
      // vzduchu — a srovnat parcelu je nabídka, ne automatika, protože stojí
      // peníze a hráč to má vidět předem (§12 kritérium 14).
      //
      // Výjimku si říká **definice** sama přes `allowsSlope` (P5): park se do
      // kopce posadí, jak je, a nic se pod ním nerovná.
      if (
        !options.skipFlatCheck &&
        !definition.construction.allowsSlope &&
        !isFlatTile(world.cornerHeight, tileX, tileY)
      ) {
        return reject('error.notFlat');
      }
    }
  }

  if (
    definition.construction.requiresRoad &&
    !options.skipRoadCheck &&
    !touchesRoad(world, definition, x, y)
  ) {
    // Vzdálenost k nejbližší vozovce mění radu z „musí sousedit se silnicí" na
    // „posuň se o dvě dlaždice" — nebo „sem žádná nevede".
    const distance = roadDistance(world, definition, x, y);
    return distance === null
      ? reject('error.needsRoadFar')
      : reject('error.needsRoad', { distance });
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

/** Lokalizační klíč jména zóny. Prázdná zóna má vlastní jméno, ne prázdno. */
function zoneNameKey(zone: number): string {
  const names = ['ui.zone.none', 'ui.zone.residential', 'ui.zone.commercial', 'ui.zone.industrial'];
  return names[zone] ?? 'ui.zone.none';
}

/**
 * Kolik dlaždic chybí k nejbližší silnici. `null`, když v dosahu žádná není.
 *
 * Hledá se **do `ROAD_SEARCH` dlaždic od půdorysu**, ne po celé mapě: dál už
 * není co poradit a průchod mapou při každém odmítnutém kliknutí by hru
 * zdržoval. Měří se v krocích po mřížce, protože tak se i staví.
 */
function roadDistance(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
): number | null {
  const [width, depth] = definition.footprint;
  let best: number | null = null;

  for (let ty = y - ROAD_SEARCH; ty < y + depth + ROAD_SEARCH; ty++) {
    for (let tx = x - ROAD_SEARCH; tx < x + width + ROAD_SEARCH; tx++) {
      if (!inBounds(tx, ty, world.size)) continue;
      if ((world.layers.road[index(tx, ty, world.size)] ?? ROAD.none) === ROAD.none) continue;

      // Vzdálenost od okraje půdorysu, ne od jeho rohu.
      const dx = Math.max(0, x - tx, tx - (x + width - 1));
      const dy = Math.max(0, y - ty, ty - (y + depth - 1));
      const steps = Math.max(dx, dy);
      if (best === null || steps < best) best = steps;
    }
  }
  return best;
}

/** Jak daleko od půdorysu se ještě hledá silnice, když chybí. */
const ROAD_SEARCH = 6;

/** Je pod půdorysem voda z vodovodu? Potrubí musí být položené, ne jen vedle. */
export function hasWater(world: WorldState, definition: Definition, x: number, y: number): boolean {
  const [width, depth] = definition.footprint;
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (!inBounds(x + dx, y + dy, world.size)) continue;
      if (world.waterSupply[index(x + dx, y + dy, world.size)] === 1)
        return true;
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
      if (!inBounds(tx, ty, world.size)) continue;
      if (world.layers.terrain[index(tx, ty, world.size)] === TERRAIN.water)
        return true;
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
  const size = sizeOfLayer(layer);
  return inBounds(x, y, size) && (layer[index(x, y, size)] ?? 0) !== 0;
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
      world.layers.buildingId[index(x + dx, y + dy, world.size)] = building.id;
      markTileDirty(world, x + dx, y + dy);
    }
  }

  markBuildingDirty(world, building.id);
  markPowerNetworkDirty(world); // budova je vodič, síť se mění
  markWaterNetworkDirty(world); // a mohla to být vodárna nebo čerpací stanice
  if (definition.service) markCoverageDirty(world);
  return building;
}
