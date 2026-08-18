import type { Balance } from '@/content/balance';
import { COARSE_SIZE, coarseIndex } from '../coarse';
import { coverageOf } from '../world';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Kriminalita (§5 zadání fáze 2). Interval 16, offset 11 — schválně jinde než
 * cena půdy, aby dvě difuzní vrstvy nespadly do stejného snímku.
 *
 * ```
 * surová = hustotaPopulace × VÁHA + nezaměstnanost × VÁHA
 *        + opuštěné × VÁHA − pokrytí[police] × VÁHA
 * crime  = lerp(crime, surová, VYHLAZENÍ)
 * ```
 *
 * **Kriminalita se neodvozuje od ceny půdy** (rozhodnutí R3 v zadání). Kdyby
 * nízká cena půdy plodila kriminalitu a kriminalita srážela cenu půdy, každá
 * čtvrť, která jednou klesne, už by se nikdy nezvedla.
 *
 * Opuštěné budovy do vzorce přibudou v T17, do té doby žádné neexistují.
 *
 * Konstanty jdou z `balance.json` (§10).
 */

/** Kolik z populace chodí do práce. Musí sedět s `demand.ts` — balanc fáze 1. */
const WORKER_RATIO = 0.5;

export function createCrimeSystem(balance: Balance): System {
  return {
    name: 'crime',
    interval: 16,
    offset: 11,
    run(world: WorldState) {
      const density = new Float32Array(COARSE_SIZE * COARSE_SIZE);
      let population = 0;
      let jobs = 0;

      // Hustota populace se počítá při stejném průchodu — vlastní vrstva
      // pro ni nevzniká.
      for (const building of world.buildings.values()) {
        population += building.population;
        jobs += building.jobs;
        if (building.population === 0) continue;

        const at = coarseIndex(building.x, building.y);
        density[at] = (density[at] ?? 0) + building.population;
      }

      // Jediný neprostorový vstup, a to schválně: město s masovou
      // nezaměstnaností má problém všude, ne jen v jedné čtvrti.
      const workers = population * WORKER_RATIO;
      const unemployment = workers > 0 ? Math.max(0, Math.min(1, (workers - jobs) / workers)) : 0;
      const unemploymentTerm = unemployment * balance.crime.unemployment;

      const police = coverageOf(world, 'police');
      const crime = world.coarse.crime;

      for (let cell = 0; cell < crime.length; cell++) {
        const raw =
          (density[cell] ?? 0) * balance.crime.population +
          unemploymentTerm -
          (police?.[cell] ?? 0) * balance.crime.police;

        const current = crime[cell] ?? 0;
        const delta = raw - current;
        const next = current + delta * balance.crime.smoothing;

        // Zaokrouhlení ve směru pohybu — stejný důvod jako u ceny půdy.
        const stepped = delta > 0 ? Math.ceil(next) : Math.floor(next);
        crime[cell] = Math.max(0, Math.min(255, stepped));
      }

      world.dirty.coarseChanged = true;
    },
  };
}
