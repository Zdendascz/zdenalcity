import type { BuildingCatalogue } from '../catalogue';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * RCI poptávka.
 *
 * Model je záměrně jednoduchý a stojí na jedné myšlence: **lidé chtějí práci
 * a práce chce lidi.** Z toho vyjde celá smyčka §13 sama.
 *
 * - obytná: kladná, dokud je kam chodit do práce (plus základ, aby vůbec začalo)
 * - průmyslová: kladná, když je víc pracujících než míst
 * - komerční: kladná, když je víc lidí než obchodů
 *
 * Čísla jsou provizorní balanc, ne výsledek ladění — na to je T10.
 */

/** Kolik z populace chodí do práce. */
const WORKER_RATIO = 0.5;
/** Bez základu by na prázdné mapě nebyla poptávka po ničem a nic by nevyrostlo. */
const BASE_RESIDENTIAL_DEMAND = 20;
/** Kolik pracovních míst v obchodech si vyžádá jeden obyvatel. */
const COMMERCE_PER_CAPITA = 0.2;
/** Poptávka se drží v <−100, 100>, aby čísla nerostla do nesmyslů. */
const DEMAND_LIMIT = 100;

function clampDemand(value: number): number {
  return Math.max(-DEMAND_LIMIT, Math.min(DEMAND_LIMIT, Math.round(value)));
}

export function createDemandSystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'demand',
    interval: 4,
    offset: 1,
    run(world: WorldState) {
      let population = 0;
      let jobs = 0;
      let commercialJobs = 0;

      for (const building of world.buildings.values()) {
        population += building.population;
        jobs += building.jobs;
        if (catalogue.get(building.definitionId)?.category === 'commercial') {
          commercialJobs += building.jobs;
        }
      }

      const workers = population * WORKER_RATIO;

      world.demand.residential = clampDemand(BASE_RESIDENTIAL_DEMAND + (jobs - workers));
      world.demand.industrial = clampDemand(workers - jobs);
      world.demand.commercial = clampDemand(population * COMMERCE_PER_CAPITA - commercialJobs);
    },
  };
}
