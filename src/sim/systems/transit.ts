import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { computeLineStats, rebuildTramTiles } from '../transit';
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
/** Jednou za herní měsíc, o tik dřív než rozpočet — ten si z toho čte. */
const STATS_INTERVAL = 30;
const STATS_OFFSET = 29;

export function createTransitSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'transit',
    interval: 1,
    offset: 0,
    run(world: WorldState) {
      if (world.transitDirty) rebuildTramTiles(world, catalogue, balance);

      // Přeprava se přepočítává **jednou za měsíc**, ne každý tik. Kapacita
      // v katalogu je měsíční a poptávka se mění pomalu — projít pro každou
      // linku všechny obsluhované buňky čtyřikrát za sekundu by byla nejdražší
      // věc v celé simulaci a hráč by z toho neměl nic.
      if ((world.tick - STATS_OFFSET) % STATS_INTERVAL === 0) {
        computeLineStats(world, catalogue, balance);
      }
    },
  };
}
