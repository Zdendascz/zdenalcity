import type { Balance } from '@/content/balance';
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

export function createDemandSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  const { workerRatio, baseResidential, commercePerCapita, limit } = balance.demand;
  const clampDemand = (value: number): number =>
    Math.max(-limit, Math.min(limit, Math.round(value)));

  return {
    name: 'demand',
    interval: 4,
    offset: 1,
    run(world: WorldState) {
      let population = 0;
      let jobs = 0;
      let commercialJobs = 0;

      for (const building of world.buildings.values()) {
        // Poptávka počítá s tím, co ve městě stojí, bez ohledu na proud.
        // Kdyby budova bez proudu poptávku nesytila, hráč by na místě jedné
        // nefunkční továrny stavěl další a další.
        population += building.population;
        jobs += building.jobs;
        if (catalogue.get(building.definitionId)?.category === 'commercial') {
          commercialJobs += building.jobs;
        }
      }

      const workers = population * workerRatio;

      world.demand.residential = clampDemand(baseResidential + (jobs - workers));
      world.demand.industrial = clampDemand(workers - jobs);
      world.demand.commercial = clampDemand(population * commercePerCapita - commercialJobs);
    },
  };
}
