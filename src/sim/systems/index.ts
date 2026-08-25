import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import type { WorldState } from '../world';
import { createPowerSystem } from './power';
import { createWaterDecaySystem, createWaterSystem } from './water';
import { createDemandSystem } from './demand';
import { createGrowthSystem } from './growth';
import { createEconomySystem } from './economy';
import { createPollutionSystem } from './pollution';
import { createLandValueSystem } from './landValue';
import { createServiceSystem } from './services';
import { createCrimeSystem } from './crime';
import { createHappinessSystem } from './happiness';
import { createHealthSystem } from './health';
import { createTrafficSystem } from './traffic';
import { createLevelSystem } from './levels';
import { createDisasterSystem } from '../disasters/scheduler';
import { createFireSystem } from '../disasters/fire';
import { createFloodSystem } from '../disasters/flood';
import { DisasterRegistry } from '../disasters/registry';
import { createTransitSystem } from './transit';

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
export function createDefaultSystems(
  catalogue: BuildingCatalogue,
  balance: Balance,
  disasters: DisasterRegistry = new DisasterRegistry(),
): System[] {
  // Pořadí podle tabulky v architektuře §5: systémy fáze 2 jsou za těmi z fáze 1.
  return [
    // Katastrofy jako první: co udeřilo v minulém tiku, se má propsat dřív,
    // než na to zareaguje elektřina, voda a všechno ostatní. Plánovač zároveň
    // nechává vypršet dočasné postihy, které si ostatní systémy vzápětí čtou.
    createDisasterSystem(catalogue, balance, disasters),
    // Oheň má **vlastní tik** (§4 fáze 4) a s plánovačem nesouvisí: hoří dál,
    // i když se zrovna nelosuje. Hned za plánovačem, ať to, co v tomhle tiku
    // vzniklo, začne hořet ještě v něm.
    createFireSystem(catalogue, balance),
    // Záplava před elektřinou a vodou: zaplavená dlaždice je nevede, takže se
    // to musí propsat dřív, než obě sítě proběhnou.
    createFloodSystem(catalogue, balance),
    createPowerSystem(catalogue),
    // Voda hned za elektřinou: růst i chátrání z ní čtou ve stejném tiku.
    createWaterSystem(catalogue, balance),
    // Pokrytí se musí přepočítat dřív, než z něj čte cena půdy a kriminalita.
    createServiceSystem(catalogue),
    createDemandSystem(catalogue, balance),
    createGrowthSystem(catalogue, balance),
    // Úrovně až za růstem: čerstvě postavená budova má na povýšení čekat
    // cooldown, ne ho dostat ve stejném tiku.
    createLevelSystem(catalogue, balance),
    createEconomySystem(catalogue, balance),
    // Linky před dopravou: kolony si čtou, kolik kapacity silnici zbylo po
    // kolejích, a přepočet až za nimi by se projevil o osm tiků později.
    createTransitSystem(catalogue, balance),
    // Doprava před cenou půdy: kolony do ní vstupují od T26.
    createTrafficSystem(catalogue, balance),
    createPollutionSystem(catalogue, balance),
    createCrimeSystem(balance),
    createHealthSystem(catalogue, balance),
    createWaterDecaySystem(catalogue, balance),
    createLandValueSystem(balance),
    // Spokojenost je poslední: čte úplně všechno ostatní, takže musí běžet
    // až za tím, co ji tvoří.
    createHappinessSystem(balance),
  ];
}

export {
  createTransitSystem,
  createPowerSystem,
  createWaterSystem,
  createWaterDecaySystem,
  createDemandSystem,
  createEconomySystem,
  createGrowthSystem,
  createPollutionSystem,
  createLandValueSystem,
  createServiceSystem,
  createCrimeSystem,
  createHappinessSystem,
  createHealthSystem,
  createLevelSystem,
  createTrafficSystem,
};
export type { BuildingCatalogue };
