import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import type { WorldState } from '../world';
import { createPowerSystem } from './power';
import { createDemandSystem } from './demand';
import { createGrowthSystem } from './growth';
import { createEconomySystem } from './economy';
import { createPollutionSystem } from './pollution';
import { createLandValueSystem } from './landValue';
import { createServiceSystem } from './services';
import { createCrimeSystem } from './crime';
import { createHealthSystem } from './health';
import { createTrafficSystem } from './traffic';
import { createLevelSystem } from './levels';

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
export function createDefaultSystems(catalogue: BuildingCatalogue, balance: Balance): System[] {
  // Pořadí podle tabulky v architektuře §5: systémy fáze 2 jsou za těmi z fáze 1.
  return [
    createPowerSystem(catalogue),
    // Pokrytí se musí přepočítat dřív, než z něj čte cena půdy a kriminalita.
    createServiceSystem(catalogue),
    createDemandSystem(catalogue, balance),
    createGrowthSystem(catalogue, balance),
    // Úrovně až za růstem: čerstvě postavená budova má na povýšení čekat
    // cooldown, ne ho dostat ve stejném tiku.
    createLevelSystem(catalogue, balance),
    createEconomySystem(catalogue, balance),
    // Doprava před cenou půdy: kolony do ní vstupují od T26.
    createTrafficSystem(catalogue, balance),
    createPollutionSystem(catalogue, balance),
    createCrimeSystem(balance),
    createHealthSystem(catalogue, balance),
    createLandValueSystem(balance),
  ];
}

export {
  createPowerSystem,
  createDemandSystem,
  createEconomySystem,
  createGrowthSystem,
  createPollutionSystem,
  createLandValueSystem,
  createServiceSystem,
  createCrimeSystem,
  createHealthSystem,
  createLevelSystem,
  createTrafficSystem,
};
export type { BuildingCatalogue };
