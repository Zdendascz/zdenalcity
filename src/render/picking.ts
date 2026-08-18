import type { Camera } from './camera';
import { viewportToWorld } from './camera';
import type { Point } from './projection';
import { screenToGrid } from './projection';

/**
 * Dlaždice pod kurzorem, nebo `null` mimo mapu.
 *
 * Jediné místo, které kombinuje kameru s inverzní projekcí. Platí omezení
 * `screenToGrid` — plochý terén (fáze 1).
 */
export function pickTile(
  camera: Camera,
  viewX: number,
  viewY: number,
  viewWidth: number,
  viewHeight: number,
  mapSize: number,
): Point | null {
  const world = viewportToWorld(camera, viewX, viewY, viewWidth, viewHeight);
  const tile = screenToGrid(world.x, world.y);
  if (tile.x < 0 || tile.y < 0 || tile.x >= mapSize || tile.y >= mapSize) {
    return null;
  }
  return tile;
}
