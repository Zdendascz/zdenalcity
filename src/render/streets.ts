import { index, ROAD } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from './roads';

/**
 * Kde má silnice chodník (T122).
 *
 * Autor: „Pokud je vedle silnice budova 2. a vyšší úrovně, neměla by ležet na
 * trávě, ale okolí by třeba mohl být chodník oddělený pásem zeleně.“ Chodník
 * se proto kreslí na **té straně dlaždice silnice, za kterou stojí dům
 * úrovně 2 a víc**. Zpustlý dům chodník nedostane — kolem slumu se nikdo
 * o dlažbu nestará.
 *
 * Dálnice chodník nemá nikdy. Užívá to vozovka i lampy, takže je to na
 * jednom místě.
 */
export const SIDEWALK_MIN_LEVEL = 2;

const SIDES = [
  [ROAD_N, 0, -1],
  [ROAD_E, 1, 0],
  [ROAD_S, 0, 1],
  [ROAD_W, -1, 0],
] as const;

export function houseSides(world: ReadonlyWorldView, x: number, y: number): number {
  const size = world.size;
  const type = world.layers.road[index(x, y, size)] ?? ROAD.none;
  if (type === ROAD.none || type === ROAD.highway) return 0;
  let sides = 0;
  for (const [side, dx, dy] of SIDES) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const id = world.layers.buildingId[index(nx, ny, size)] ?? 0;
    if (id === 0) continue;
    const building = world.buildings.get(id);
    if (building && !building.abandoned && building.level >= SIDEWALK_MIN_LEVEL) sides |= side;
  }
  return sides;
}
