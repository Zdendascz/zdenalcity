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
 * Difuzní konstanty tady zatím žijí v kódu. Do `balance.json` se stěhují v T15,
 * spolu s celým balancem fáze 2 — konstanty odpadu tam přibudou, v ukázkovém
 * `balance.json` v zadání totiž sekci `waste` nemají.
 */
const SPREAD = 0.4;
const DECAY = 0.94;
const PASSES = 2;

/** Kolik odpadu vyrobí jeden obyvatel za jeden běh systému. */
const WASTE_PER_CITIZEN = 0.1;
/** Kolik znečištění přidá do každé buňky jednotka nepokrytého odpadu. */
const WASTE_TO_POLLUTION = 0.02;

export function createPollutionSystem(catalogue: BuildingCatalogue): System {
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

      const generatedWaste = population * WASTE_PER_CITIZEN;
      const unhandledWaste = Math.max(0, generatedWaste - wasteCapacity);
      const cityWide = unhandledWaste * WASTE_TO_POLLUTION;
      if (cityWide > 0) {
        for (let cell = 0; cell < sources.length; cell++) {
          sources[cell] = (sources[cell] ?? 0) + cityWide;
        }
      }

      diffuse(world.coarse.pollution, sources, SPREAD, DECAY, PASSES);
      world.dirty.coarseChanged = true;
    },
  };
}
