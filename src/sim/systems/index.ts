import type { WorldState } from '../world';
import { powerSystem } from './power';
import { demandSystem } from './demand';
import { createGrowthSystem } from './growth';
import type { BuildingCatalogue } from './growth';
import { economySystem } from './economy';

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
 * Růst potřebuje obsah, takže je registr systémů funkce, ne konstanta. Systém
 * si katalog uzavře do closure a `run(world)` zůstává beze změny.
 */
export function createDefaultSystems(catalogue: BuildingCatalogue): System[] {
  return [powerSystem, demandSystem, createGrowthSystem(catalogue), economySystem];
}

export { powerSystem, demandSystem, economySystem, createGrowthSystem };
export type { BuildingCatalogue };
