import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { coverageOf, markBuildingDirty } from '../world';
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
 * Konstanty se v T15 stěhují do `balance.json`.
 */
const INTERVAL = 16;
/** Offset mimo cenu půdy (5) i kriminalitu (11). */
const OFFSET = 13;

/** Pod tímhle pokrytím začnou lidé odcházet. */
const COVERAGE_THRESHOLD = 20;
/** Kolik obyvatel budova ztratí, respektive získá, za jeden běh. */
const DECLINE_STEP = 1;
const RECOVERY_STEP = 1;

/**
 * Kam až populace bez zdravotní péče klesne — polovina kapacity.
 *
 * Bez podlahy by město bez kliniky vymřelo na nulu, a protože na začátku hry
 * žádná klinika nestojí, byl by to nevyhnutelný konec. Odhalil to test savu,
 * kterému po 600 ticích vyšla nulová populace. Zdravotnictví je tak pobídka
 * k růstu, ne past.
 */
const UNSERVED_RATIO = 0.5;

export function createHealthSystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'health',
    interval: INTERVAL,
    offset: OFFSET,
    run(world: WorldState) {
      const coverage = coverageOf(world, 'health');

      for (const building of world.buildings.values()) {
        const capacity = catalogue.get(building.definitionId)?.population?.capacity ?? 0;
        if (capacity === 0) continue;

        const covered = (coverage?.[coarseIndex(building.x, building.y)] ?? 0) >= COVERAGE_THRESHOLD;
        const floor = Math.ceil(capacity * UNSERVED_RATIO);

        const next = covered
          ? Math.min(capacity, building.population + RECOVERY_STEP)
          : Math.max(floor, building.population - DECLINE_STEP);

        if (next === building.population) continue;
        building.population = next;
        markBuildingDirty(world, building.id);
      }
    },
  };
}
