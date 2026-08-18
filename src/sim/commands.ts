import { inBounds, index, TERRAIN } from './layers';
import type { ZoneType } from './layers';
import { markTileDirty } from './world';
import type { WorldState } from './world';

/**
 * Všechny hráčské akce jdou přes `SimHost.dispatch`. `WorldState` se nikdy
 * nemodifikuje z UI ani z rendereru přímo.
 *
 * Union je kompletní podle architektury §5, ale obsluha se doplňuje po úkolech —
 * viz switch v `simHost.ts`. V T1 je implementován jen `set_speed`.
 */
export type Command =
  | { type: 'build_road'; x: number; y: number }
  | { type: 'bulldoze'; x: number; y: number }
  | { type: 'zone'; x: number; y: number; w: number; h: number; zone: ZoneType }
  | { type: 'place_building'; definitionId: string; x: number; y: number }
  | { type: 'set_tax_rate'; zone: ZoneType; rate: number }
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
export function buildRoad(world: WorldState, x: number, y: number): void {
  if (!inBounds(x, y)) return;

  const tile = index(x, y);
  if (world.layers.terrain[tile] === TERRAIN.water) return;
  if (world.layers.road[tile] === 1) return; // opakovaná stavba je no-op

  world.layers.road[tile] = 1;
  markRoadNeighbourhoodDirty(world, x, y);
}

/** Bourání prázdné dlaždice je no-op. Zóny a budovy přijdou na řadu v T5. */
export function bulldoze(world: WorldState, x: number, y: number): void {
  if (!inBounds(x, y)) return;

  const tile = index(x, y);
  if (world.layers.road[tile] === 0) return;

  world.layers.road[tile] = 0;
  markRoadNeighbourhoodDirty(world, x, y);
}
