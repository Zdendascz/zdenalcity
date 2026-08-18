import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { COARSE_CELLS, coarseIndex } from '../coarse';
import { diffuse } from '../diffusion';
import { MAP_SIZE } from '../layers';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Znečištění (§3 a §6 zadání fáze 2).
 *
 * Zdroje jsou dva:
 * 1. **Budovy** — každá přičte svou hodnotu `environment.pollution` do buňky,
 *    ve které leží její přední roh.
 * 2. **Odpad** — populace ho vyrábí, skládky a spalovny mají kapacitu a
 *    nepokrytý zbytek jde do vzduchu **celoměstsky**, tedy rovnoměrně do každé
 *    buňky. Skládka je levná a sama silně znečišťuje své okolí, spalovna je
 *    drahá a znečišťuje méně — čistý prostorový kompromis bez nové vrstvy.
 *
 * Všechny konstanty jdou z `balance.json` (§10) — v kódu není ani jedna.
 */
export function createPollutionSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'pollution',
    interval: 8,
    offset: 3,
    run(world: WorldState) {
      // Buffer se alokuje uvnitř: systém tak nedrží stav mezi světy a dva
      // souběžné světy si nemůžou přepsat zdroje.
      const sources = new Float32Array(COARSE_CELLS);
      let population = 0;
      let wasteCapacity = 0;

      for (const building of world.buildings.values()) {
        population += building.population;

        const definition = catalogue.get(building.definitionId);
        if (!definition) continue;

        wasteCapacity += definition.waste?.capacity ?? 0;

        const emitted = definition.environment?.pollution ?? 0;
        if (emitted <= 0) continue;

        const [width, depth] = definition.footprint;
        const cornerX = Math.min(building.x + width - 1, MAP_SIZE - 1);
        const cornerY = Math.min(building.y + depth - 1, MAP_SIZE - 1);
        const at = coarseIndex(cornerX, cornerY);
        sources[at] = (sources[at] ?? 0) + emitted;
      }

      const generatedWaste = population * balance.waste.perCitizen;
      const unhandledWaste = Math.max(0, generatedWaste - wasteCapacity);
      const cityWide = unhandledWaste * balance.waste.toPollution;
      if (cityWide > 0) {
        for (let cell = 0; cell < sources.length; cell++) {
          sources[cell] = (sources[cell] ?? 0) + cityWide;
        }
      }

      const { spread, decay, passes } = balance.diffusion;
      diffuse(world.coarse.pollution, sources, spread, decay, passes);
      world.dirty.coarseChanged = true;
    },
  };
}
