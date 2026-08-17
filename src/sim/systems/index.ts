import type { WorldState } from '../world';
import { powerSystem } from './power';
import { demandSystem } from './demand';
import { growthSystem } from './growth';
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
 */
export const DEFAULT_SYSTEMS: readonly System[] = [
  powerSystem,
  demandSystem,
  growthSystem,
  economySystem,
];

export { powerSystem, demandSystem, growthSystem, economySystem };
