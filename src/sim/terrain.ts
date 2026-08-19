import { COARSE_CELLS, COARSE_FACTOR, COARSE_SIZE } from './coarse';
import { index, MAP_SIZE, TERRAIN } from './layers';
import type { WorldState } from './world';

/**
 * Terén jako hratelný údaj (§2 zadání fáze 3).
 *
 * Cena půdy i znečištění žijí na hrubé mřížce, terén na plné. Tenhle soubor
 * ten rozdíl překlenuje: spočítá, jaký **podíl** buňky zabírá který terén.
 *
 * Počítá se jednou za běh systému a předává dál. Kdyby si to každá buňka
 * počítala sama, byl by z toho průchod 16 384 dlaždicemi pro každou z 1024
 * buněk.
 */
export function coarseTerrainShare(world: WorldState, terrain: number): Float32Array {
  const share = new Float32Array(COARSE_CELLS);
  const perCell = COARSE_FACTOR * COARSE_FACTOR;

  for (let y = 0; y < MAP_SIZE; y++) {
    const cellY = (y / COARSE_FACTOR) | 0;
    for (let x = 0; x < MAP_SIZE; x++) {
      if (world.layers.terrain[index(x, y)] !== terrain) continue;
      const cell = cellY * COARSE_SIZE + ((x / COARSE_FACTOR) | 0);
      share[cell] = (share[cell] ?? 0) + 1 / perCell;
    }
  }

  return share;
}

/** Terény, na které se nedá stavět, dokud je hráč neupraví (§2). */
export function needsClearing(terrain: number): boolean {
  return terrain === TERRAIN.forest || terrain === TERRAIN.marsh || terrain === TERRAIN.rock;
}
