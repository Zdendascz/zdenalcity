import type { Definition } from '@/content/schema';
import { inBounds, index, ZONE } from '../layers';
import { markBuildingDirty, markTileDirty } from '../world';
import type { Building, WorldState } from '../world';
import type { System } from './index';

/**
 * Co simulace potřebuje z obsahu. Úzké rozhraní místo celého registru, aby
 * `sim/` nezávisel na tom, jak se obsah načítá, a šel testovat s atrapou.
 */
export interface BuildingCatalogue {
  byCategory(category: string): readonly Definition[];
}

/** Kolik pokusů o stavbu proběhne za jeden běh systému. */
const ATTEMPTS_PER_RUN = 4;
/** Šance, že se pokus promění ve stavbu. Město tak neroste skokem. */
const GROWTH_CHANCE = 0.4;

/**
 * Zóna je vazba mezi mřížkou a kategorií obsahu. Konkrétní budovy v kódu
 * nejsou (P5) — kód zná jen kategorii, seznam budov dodá registr.
 */
function categoryForZone(zone: number): string | null {
  if (zone === ZONE.residential) return 'residential';
  if (zone === ZONE.commercial) return 'commercial';
  if (zone === ZONE.industrial) return 'industrial';
  return null;
}

export function createGrowthSystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'growth',
    interval: 12,
    offset: 2,
    run(world: WorldState) {
      grow(world, catalogue);
    },
  };
}

function grow(world: WorldState, catalogue: BuildingCatalogue): void {
  const candidates = collectCandidates(world);
  if (candidates.length === 0) return;

  for (let attempt = 0; attempt < ATTEMPTS_PER_RUN; attempt++) {
    // Obě čísla se táhnou vždycky, i když se nakonec nestaví. Kdyby se
    // čerpání RNG lišilo podle výsledku, determinismus by závisel na tom,
    // kolik pokusů náhodou selhalo.
    const roll = world.rng.next();
    const candidate = candidates[world.rng.int(candidates.length)];
    if (roll >= GROWTH_CHANCE || candidate === undefined) continue;

    tryBuild(world, catalogue, candidate);
  }
}

/** Volné dlaždice se zónou, v pevném pořadí indexů. */
function collectCandidates(world: WorldState): number[] {
  const { zone, buildingId, road } = world.layers;
  const candidates: number[] = [];

  for (let tile = 0; tile < zone.length; tile++) {
    if (zone[tile] !== ZONE.none && buildingId[tile] === 0 && road[tile] === 0) {
      candidates.push(tile);
    }
  }

  return candidates;
}

function tryBuild(world: WorldState, catalogue: BuildingCatalogue, tile: number): void {
  const x = tile % world.size;
  const y = (tile - x) / world.size;

  const zone = world.layers.zone[tile] ?? ZONE.none;
  const category = categoryForZone(zone);
  if (!category) return;

  const options = catalogue.byCategory(category);
  if (options.length === 0) return;

  const definition = options[world.rng.int(options.length)];
  if (!definition || !fits(world, definition, x, y, zone)) return;

  placeBuilding(world, definition, x, y);
}

function fits(
  world: WorldState,
  definition: Definition,
  x: number,
  y: number,
  zone: number,
): boolean {
  const [width, height] = definition.footprint;

  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (!inBounds(tileX, tileY)) return false;

      const tile = index(tileX, tileY);
      if (world.layers.zone[tile] !== zone) return false;
      if (world.layers.road[tile] !== 0) return false;
      if (world.layers.buildingId[tile] !== 0) return false;

      const terrain = world.layers.terrain[tile] ?? 0;
      if (!definition.construction.allowedTerrain.includes(terrain)) return false;
    }
  }

  // `requiresPower` se zatím neřeší — elektřina je T6 a do té doby by nic
  // nevyrostlo.
  return !definition.construction.requiresRoad || touchesRoad(world, x, y, width, height);
}

function touchesRoad(world: WorldState, x: number, y: number, width: number, height: number): boolean {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (
        isRoad(world, tileX, tileY - 1) ||
        isRoad(world, tileX + 1, tileY) ||
        isRoad(world, tileX, tileY + 1) ||
        isRoad(world, tileX - 1, tileY)
      ) {
        return true;
      }
    }
  }
  return false;
}

function isRoad(world: WorldState, x: number, y: number): boolean {
  return inBounds(x, y) && world.layers.road[index(x, y)] === 1;
}

function placeBuilding(world: WorldState, definition: Definition, x: number, y: number): void {
  const building: Building = {
    id: world.nextBuildingId++,
    definitionId: definition.id,
    x,
    y,
    level: 1, // úrovně budov jsou podle §14 až fáze 2
    population: definition.population?.capacity ?? 0,
    jobs: definition.jobs?.capacity ?? 0,
    powered: false, // T6
    builtAtTick: world.tick,
  };

  world.buildings.set(building.id, building);

  const [width, height] = definition.footprint;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      world.layers.buildingId[index(x + dx, y + dy)] = building.id;
      markTileDirty(world, x + dx, y + dy);
    }
  }

  markBuildingDirty(world, building.id);
}
