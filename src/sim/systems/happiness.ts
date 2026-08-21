import type { Balance } from '@/content/balance';
import { COARSE_FACTOR, COARSE_SIZE } from '../coarse';
import { coarseCongestion } from '../diagnostics';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Spokojenost (§9 zadání fáze 3).
 *
 * Jediné číslo, které hráč sleduje průběžně; ostatní veličiny otevírá, teprve
 * když spokojenost klesá. Proto se skládá **ze všeho ostatního** — pokrytí
 * službami, cena půdy, znečištění, kriminalita, kolony, daně, nezaměstnanost.
 *
 * Dvě věci o ní platí a obě jsou důležité:
 *
 * - **Neukládá se** (R10). Je odvozená ze stavu, který se ukládá, takže by se
 *   v savu mohla rozejít se skutečností. Po načtení se do pár běhů dopočítá.
 * - **Nevstupuje do ceny půdy.** Cena půdy do spokojenosti ano, obráceně ne —
 *   jinak by vznikla kladná zpětná vazba (R2 z fáze 2 platí dál). Smyčka
 *   poptávka → růst → hustota → doprava → kolony → spokojenost je záporná,
 *   tedy stabilní.
 *
 * Vyhlazení proti skokům: hodnota se k surové jen přibližuje. Bez něj by
 * postavení jediného divadla přepsalo celou čtvrť v jednom tiku.
 */
const INTERVAL = 16;
const OFFSET = 13;

export function createHappinessSystem(balance: Balance): System {
  return {
    name: 'happiness',
    interval: INTERVAL,
    offset: OFFSET,
    run(world: WorldState) {
      const { happiness } = balance;
      const congestion = coarseCongestion(world, balance);

      // Daně a nezaměstnanost jsou celoměstské — dopadají na každou čtvrť
      // stejně, i na tu, kde není ani jeden nezaměstnaný.
      let population = 0;
      let jobs = 0;
      for (const building of world.buildings.values()) {
        if (building.abandoned) continue;
        population += building.population;
        jobs += building.jobs;
      }

      const workers = population * balance.demand.workerRatio;
      const unemployment =
        workers > 0 ? Math.max(0, Math.min(1, (workers - jobs) / workers)) : 0;

      const cityWide =
        world.economy.taxRates.residential * happiness.tax +
        unemployment * happiness.unemployment;

      for (let cell = 0; cell < world.happiness.length; cell++) {
        let raw = happiness.base - cityWide;

        for (const [serviceClass, weight] of Object.entries(happiness.weights)) {
          raw += (world.coverage.get(serviceClass)?.[cell] ?? 0) * weight;
        }

        raw += (world.coarse.landValue[cell] ?? 0) * happiness.landValue;
        raw -= (world.coarse.pollution[cell] ?? 0) * happiness.pollution;
        raw -= (world.coarse.crime[cell] ?? 0) * happiness.crime;
        raw -= (congestion[cell] ?? 0) * happiness.congestion;

        const previous = world.happiness[cell] ?? 0;
        const next = previous + (raw - previous) * happiness.smoothing;
        world.happiness[cell] = Math.max(0, Math.min(255, Math.round(next)));
      }

      world.dirty.coarseChanged = true;
    },
  };
}

/**
 * Co průměr potřebuje: budovy a vrstvu. Ne `WorldState` — počítá ho i HUD, a ten
 * drží jen `ReadonlyWorldView`. Jediný vzorec na obou stranách je důležitější
 * než přesný typ.
 */
export interface HappinessView {
  readonly buildings: ReadonlyMap<
    number,
    { readonly x: number; readonly y: number; readonly population: number; readonly abandoned: boolean }
  >;
  readonly happiness: Readonly<Uint8Array>;
}

/**
 * Průměrná spokojenost města, 0–255.
 *
 * Počítá se **jen z obydlených buněk**: prázdná polovina mapy nemá koho
 * potěšit ani naštvat, a kdyby se počítala, každé město by viselo kolem
 * základní hodnoty bez ohledu na to, jak se v něm žije.
 */
export function averageHappiness(world: HappinessView): number {
  const populated = new Set<number>();

  for (const building of world.buildings.values()) {
    if (building.abandoned || building.population === 0) continue;
    const cellX = Math.floor(building.x / COARSE_FACTOR);
    const cellY = Math.floor(building.y / COARSE_FACTOR);
    populated.add(cellY * COARSE_SIZE + cellX);
  }

  if (populated.size === 0) return 0;

  let sum = 0;
  for (const cell of populated) sum += world.happiness[cell] ?? 0;
  return sum / populated.size;
}

/**
 * Násobitel obytné poptávky podle spokojenosti (§9).
 *
 * **Moduluje, nevetuje** — stejná logika jako u dostupnosti práce (R6).
 * Nespokojené město roste pomaleji, ale roste; nulový násobitel by hru zamkl
 * v okamžiku, kdy je spokojenost nejnižší, tedy přesně když se hráč snaží
 * situaci otočit.
 *
 * Dokud ve městě nikdo nebydlí, je to jednička: začínající město nemá koho se
 * ptát a nesmí kvůli tomu stát.
 */
export function happinessDemandFactor(world: WorldState, balance: Balance): number {
  let inhabited = false;
  for (const building of world.buildings.values()) {
    if (!building.abandoned && building.population > 0) {
      inhabited = true;
      break;
    }
  }
  if (!inhabited) return 1;

  const { minDemandFactor } = balance.happiness;
  const average = averageHappiness(world) / 255;
  return minDemandFactor + (1 - minDemandFactor) * Math.max(0, Math.min(1, average));
}
