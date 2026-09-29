import { index } from './layers';
import type { WorldState } from './world';

/**
 * Co vede proud a vodu sám od sebe (T129, rozhodnutí autora).
 *
 * „Kanalizace i elektřina je automaticky pod každou parcelou, která obsahuje
 * zónu nebo budovu, hráč musí zajistit jen propojení a přívod." A: „Silnice
 * automaticky nic nevede." A: „Zchátralá či pobořená budova nevede nic."
 *
 * Parcela vede **v souvislém bloku**: sousední dlaždice zón a budov se spojí
 * samy, takže celý blok mezi ulicemi je jedna síť. Mezi bloky a k elektrárně
 * nebo vodárně musí vést vedení (`wire`) nebo potrubí (`pipe`).
 *
 * Tohle je **jediné** místo, kde se vodivost parcely rozhoduje — elektřina
 * i voda se ptají sem, aby se pravidla nemohla rozejít.
 */
export function parcelConducts(world: WorldState, tile: number): boolean {
  // Suť je pobořená parcela — nevede, ať na ní zůstala zóna nebo ne.
  if ((world.rubble[tile] ?? 0) !== 0) return false;
  const id = world.layers.buildingId[tile] ?? 0;
  if (id !== 0) {
    const building = world.buildings.get(id);
    return building !== undefined && !building.abandoned;
  }
  return (world.layers.zone[tile] ?? 0) !== 0;
}

/** Totéž podle souřadnic, s kontrolou okraje mapy. */
export function parcelConductsAt(world: WorldState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
  return parcelConducts(world, index(x, y, world.size));
}
