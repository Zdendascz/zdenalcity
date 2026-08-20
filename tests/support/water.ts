import type { WorldState } from '@/sim/world';

/**
 * Zavodní celé město naráz.
 *
 * Od T35 nevyroste budova bez vody pod pozemkem (§8 fáze 3). Testy, které
 * zkoumají něco jiného — elektřinu, mosty, save — by kvůli tomu musely stavět
 * vodárnu a rozvádět potrubí, což by je zaneslo šumem. Tenhle helper místo toho
 * řekne „město vodovod má" a jde dál.
 *
 * Vodovod samotný testuje `water.test.ts`, a ten si nic takového nedovolí.
 */
export function assumeWatered(world: WorldState): void {
  world.waterSupply.fill(1);
  for (const id of world.buildings.keys()) world.watered.add(id);
}
