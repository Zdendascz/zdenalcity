import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { coverageOf } from '../world';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Zdravotní péče (§6 zadání fáze 2, třída `health`).
 *
 * Bez pokrytí obyvatel v budovách **pomalu ubývá**, s pokrytím se zase vrací
 * ke kapacitě z definice. Je to jediná třída služby, která kromě ceny půdy
 * sahá i na entity — proto vlastní systém a ne řádek ve vzorci.
 *
 * Ubývá pomalu schválně: hráč má mít čas si problému všimnout dřív, než mu
 * čtvrť vymře.
 *
 * `unservedRatio` je podlaha poklesu. Bez ní by město bez kliniky vymřelo na
 * nulu, a protože na začátku hry žádná klinika nestojí, byl by to nevyhnutelný
 * konec. Odhalil to test savu, kterému po 600 ticích vyšla nulová populace.
 * Zdravotnictví je tak pobídka k růstu, ne past.
 *
 * Konstanty jdou z `balance.json` (§10).
 */
const INTERVAL = 16;
/**
 * Offset mimo cenu půdy (5), kriminalitu (11) i spokojenost (13).
 *
 * Třináctku uvolnil T39: spokojenost ji má v zadání fáze 3 a zdravotnictví
 * si ji vybralo jen jako první volné číslo. Smysl offsetů je, aby drahé
 * systémy nespadly do stejného tiku — dvě šestnáctky na jednom offsetu ten
 * smysl ruší.
 */
const OFFSET = 15;

export function createHealthSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'health',
    interval: INTERVAL,
    offset: OFFSET,
    run(world: WorldState) {
      const coverage = coverageOf(world, 'health');

      for (const building of world.buildings.values()) {
        if (building.abandoned) continue; // do ruiny se nikdo nenastěhuje
        const capacity = catalogue.get(building.definitionId)?.population?.capacity ?? 0;
        if (capacity === 0) continue;

        const covered =
          (coverage?.[coarseIndex(building.x, building.y, world.size)] ?? 0) >=
          balance.health.coverageThreshold;
        const floor = Math.ceil(capacity * balance.health.unservedRatio);

        const next = covered
          ? Math.min(capacity, building.population + balance.health.recoveryStep)
          : Math.max(floor, building.population - balance.health.declineStep);

        if (next === building.population) continue;
        // Bez `markBuildingDirty`: počet obyvatel na budově není vidět a
        // `dirty.buildings` čte jen renderer. Dřív tudy šlo ~670 domů každých
        // 16 tiků a s nimi přestavba silnic, lamp i vedení (T133).
        building.population = next;
      }
    },
  };
}
