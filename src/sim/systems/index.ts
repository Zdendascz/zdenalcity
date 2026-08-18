import type { BuildingCatalogue } from '../catalogue';
import type { WorldState } from '../world';
import { createPowerSystem } from './power';
import { createDemandSystem } from './demand';
import { createGrowthSystem } from './growth';
import { createEconomySystem } from './economy';

export interface System {
  readonly name: string;
  readonly interval: number;
  readonly offset: number;
  run(world: WorldState): void;
}

/**
 * Rozvrstvení podle architektury §5 — drahé systémy nesmí spadnout do stejného
 * tiku, proto interval + fázový offset.
 */
export function shouldRun(tick: number, interval: number, offset: number): boolean {
  return (tick - offset) % interval === 0;
}

/**
 * Pořadí registrace je pořadí vyhodnocení v rámci tiku a je součástí
 * determinismu — přeházení změní golden hashe.
 *
 * Všechny systémy potřebují obsah, takže je registr funkce, ne konstanta.
 * Systém si katalog uzavře do closure a `run(world)` zůstává beze změny.
 */
export function createDefaultSystems(catalogue: BuildingCatalogue): System[] {
  return [
    createPowerSystem(catalogue),
    createDemandSystem(catalogue),
    createGrowthSystem(catalogue),
    createEconomySystem(catalogue),
  ];
}

export { createPowerSystem, createDemandSystem, createEconomySystem, createGrowthSystem };
export type { BuildingCatalogue };
