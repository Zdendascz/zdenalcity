import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { rebuildTramTiles } from '../transit';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Udržuje odvozený stav linek (§7 fáze 4).
 *
 * Zatím jediná odvozená věc jsou **koleje ve vozovce**: které silnice ukusuje
 * tramvaj a o kolik. Přepočítává se jen při změně, stejně jako elektřina nebo
 * pokrytí — trasa se mění, když hráč sáhne na linku, ne každý tik.
 *
 * Běží **před dopravou**: kolony si z toho čtou zbylou kapacitu, a kdyby se
 * přepočet stihl až po nich, hráč by o změně věděl až za osm tiků.
 *
 * Zbouraná zastávka linku nemění sama od sebe, ale koridor ano — proto se
 * značka nastavuje i při bourání budov.
 */
export function createTransitSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'transit',
    interval: 1,
    offset: 0,
    run(world: WorldState) {
      if (!world.transitDirty) return;
      rebuildTramTiles(world, catalogue, balance);
    },
  };
}
