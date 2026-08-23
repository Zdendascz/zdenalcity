import { coarseCellsOf, COARSE_FACTOR, coarseSizeOf } from './coarse';
import { index, TERRAIN } from './layers';
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
export function coarseTerrainShare(
  world: WorldState,
  terrain: number,
): Float32Array {
  // Výsledek závisí jen na terénu, a ten se skoro nemění. Bez keše to byl
  // průchod celou mapou pro každý druh terénu při každém běhu ceny půdy —
  // na 512 × 512 dvakrát 262 144 dlaždic každých šestnáct tiků (R20 fáze 4).
  const cached = world.terrainShares.get(terrain);
  if (cached) return cached;

  const size = world.size;
  const coarseSize = coarseSizeOf(size);
  const share = new Float32Array(coarseCellsOf(size));
  const perCell = COARSE_FACTOR * COARSE_FACTOR;

  for (let y = 0; y < size; y++) {
    const cellY = (y / COARSE_FACTOR) | 0;
    for (let x = 0; x < size; x++) {
      if (world.layers.terrain[index(x, y, size)] !== terrain) continue;
      const cell = cellY * coarseSize + ((x / COARSE_FACTOR) | 0);
      share[cell] = (share[cell] ?? 0) + 1 / perCell;
    }
  }

  world.terrainShares.set(terrain, share);
  return share;
}

/** Terény, na které se nedá stavět, dokud je hráč neupraví (§2). */
export function needsClearing(terrain: number): boolean {
  return terrain === TERRAIN.forest || terrain === TERRAIN.marsh || terrain === TERRAIN.rock;
}
