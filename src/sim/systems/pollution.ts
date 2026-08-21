import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { COARSE_CELLS, coarseIndex } from '../coarse';
import { diffuse } from '../diffusion';
import { MAP_SIZE, TERRAIN } from '../layers';
import { coarseTerrainShare } from '../terrain';
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
      let sewageCapacity = 0;

      for (const building of world.buildings.values()) {
        // Opuštěná budova nevyrábí, netopí ani neodváží odpad — nekouří,
        // ale ani nic nezpracuje.
        if (building.abandoned) continue;
        population += building.population;

        const definition = catalogue.get(building.definitionId);
        if (!definition) continue;

        wasteCapacity += definition.waste?.capacity ?? 0;
        sewageCapacity += definition.sewage?.capacity ?? 0;

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

      // Kanalizace je **celoměstská kapacita**, ne druhá síť trubek (R9).
      // Nevyčištěná odpadní voda skončí v řece a v půdě, takže se — stejně
      // jako odpad — rozpustí do znečištění po celé mapě (§8 fáze 3).
      const generatedSewage = population * balance.sewage.perCitizen;
      const unhandledSewage = Math.max(0, generatedSewage - sewageCapacity);

      const cityWide =
        unhandledWaste * balance.waste.toPollution +
        unhandledSewage * balance.sewage.toPollution;
      if (cityWide > 0) {
        for (let cell = 0; cell < sources.length; cell++) {
          sources[cell] = (sources[cell] ?? 0) + cityWide;
        }
      }

      const { spread, decay, passes } = balance.diffusion;
      diffuse(world.coarse.pollution, sources, spread, decay, passes);

      // Les pohlcuje znečištění, dokud stojí (§2 fáze 3). Až za difuzí, aby
      // filtroval i to, co do buňky přiteče od sousedů — jinak by les chránil
      // jen před vlastní továrnou.
      const forest = coarseTerrainShare(world, TERRAIN.forest);
      const { forestAbsorption } = balance.map;
      if (forestAbsorption > 0) {
        for (let cell = 0; cell < world.coarse.pollution.length; cell++) {
          const share = forest[cell] ?? 0;
          if (share === 0) continue;
          const kept = 1 - share * forestAbsorption;
          world.coarse.pollution[cell] = Math.floor((world.coarse.pollution[cell] ?? 0) * kept);
        }
      }

      world.dirty.coarseChanged = true;
    },
  };
}
