import type { Definition } from '@/content/schema';
import type { BuildingCatalogue } from './catalogue';
import { coarseIndex } from './coarse';
import { OK, reject } from './result';
import type { CommandResult } from './result';
import { coverageOf } from './world';
import type { WorldState } from './world';

/**
 * Prerekvizity budov (§7 zadání fáze 2).
 *
 * Dvě podmínky: minimální **pokrytí službou** v buňce, kde budova stojí, a
 * **existence jiné budovy** ve městě. Vanilla obsah 2a je nechává prázdné, ale
 * mechanismus vyhodnocují růst, povyšování i ruční stavba — až se hodnoty
 * doplní, je to změna JSONu, ne kódu (P5).
 *
 * Vrací se `CommandResult`, ne `boolean`: hráč, kterému klik nic neudělá, musí
 * vědět proč.
 */

/**
 * Definice, které ve městě opravdu stojí.
 *
 * Ruina se nepočítá — prázdná budova nic neposkytuje, takže jako podmínka
 * platit nemůže.
 */
export function presentDefinitions(world: WorldState): Set<string> {
  const present = new Set<string>();
  for (const building of world.buildings.values()) {
    if (!building.abandoned) present.add(building.definitionId);
  }
  return present;
}

/**
 * Splňuje místo `x, y` podmínky definice?
 *
 * `present` si volající předpočítá přes `presentDefinitions` — růst i povyšování
 * se ptají mnohokrát za běh a procházet kvůli tomu pokaždé všechny budovy by
 * bylo zbytečné.
 */
export function checkRequirements(
  world: WorldState,
  catalogue: BuildingCatalogue,
  definition: Definition,
  x: number,
  y: number,
  present: ReadonlySet<string>,
): CommandResult {
  const requirements = definition.requirements;
  if (!requirements) return OK;

  const cell = coarseIndex(x, y);
  for (const serviceClass of Object.keys(requirements.services).sort()) {
    const needed = requirements.services[serviceClass] ?? 0;
    const actual = coverageOf(world, serviceClass)?.[cell] ?? 0;
    if (actual < needed) {
      return reject('error.requiresService', { service: `ui.service.${serviceClass}`, needed });
    }
  }

  for (const required of requirements.buildings) {
    if (!present.has(required)) {
      // Jméno, ne id: hláška jde hráči. Klíč přeloží `I18n.t`, protože si
      // parametr, který je sám klíčem, přeloží. Neznámou definici (chybí mod)
      // vypíšeme aspoň syrově.
      return reject('error.requiresBuilding', { id: catalogue.get(required)?.name ?? required });
    }
  }

  return OK;
}
