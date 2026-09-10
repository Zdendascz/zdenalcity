import type { Balance } from '@/content/balance';
import { COARSE_FACTOR } from '../coarse';
import { strongestModifier } from '../disasters/effects';
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
        taxPenalty(balance, world.economy.taxRates.residential) +
        unemployment * happiness.unemployment;

      // Váhy i mapy pokrytí se rozbalí **jednou**, ne pro každou buňku, a to
      // do dvou souběžných polí. `Object.entries` uvnitř smyčky alokoval pole
      // pro každou ze 16 384 buněk velké mapy; procházet místo toho dvojice
      // přes `for…of` bylo o málo lepší, protože rozbalení dvojice je taky
      // alokace. Indexovaná smyčka nealokuje nic.
      const covers: Readonly<Uint8Array>[] = [];
      const coverWeights: number[] = [];
      for (const [serviceClass, weight] of Object.entries(happiness.weights)) {
        const coverage = world.coverage.get(serviceClass);
        // Třída, kterou město nemá, přispívá nulou — a nemusí se na ni ptát.
        if (!coverage || weight === 0) continue;
        covers.push(coverage);
        coverWeights.push(weight);
      }

      for (let cell = 0; cell < world.happiness.length; cell++) {
        let raw = happiness.base - cityWide;

        for (let i = 0; i < covers.length; i++) {
          raw += (covers[i]?.[cell] ?? 0) * (coverWeights[i] ?? 0);
        }

        raw += (world.coarse.landValue[cell] ?? 0) * happiness.landValue;
        raw -= (world.coarse.pollution[cell] ?? 0) * happiness.pollution;
        raw -= (world.coarse.crime[cell] ?? 0) * happiness.crime;
        raw -= (congestion[cell] ?? 0) * happiness.congestion;

        // Srážka z katastrof jde **do surové hodnoty**, ne až na výsledek:
        // spokojenost se k ní pak vyhlazuje jako ke všemu ostatnímu a po
        // skončení pohromy se stejně pozvolna vrací.
        raw -= strongestModifier(world, 'happinessPenalty', cell, 0, undefined, Math.max);

        const previous = world.happiness[cell] ?? 0;
        const next = previous + (raw - previous) * happiness.smoothing;
        world.happiness[cell] = Math.max(0, Math.min(255, Math.round(next)));
      }

      world.dirty.coarseChanged = true;
    },
  };
}

/**
 * O kolik daň sráží spokojenost.
 *
 * Do T113 to byla přímka: sazba krát koeficient. Autor si vyžádal, ať „vliv
 * vysokých daní zdvojnásobí, respektive ať tam je nějaká progrese — čím vyšší
 * daň, tím vyšší nespokojenost". Progrese je tady důležitější než ten
 * dvojnásobek: přímka dělá z každého procenta stejně velký hřích, takže mezi
 * osmi a devíti procenty je totéž rozhodování jako mezi osmnácti a
 * devatenácti. To je špatně — devatenáct procent má bolet nesrovnatelně víc.
 *
 * ```
 * srážka = sazba × tax + progrese × max(0, sazba − odkud)²
 * ```
 *
 * S vanilla čísly (2,5 / 7 / 0,3) je do sedmi procent všechno jako dřív,
 * u desíti je srážka o desetinu vyšší a u stropu, tedy u dvaceti procent,
 * přesně dvojnásobná. Tam ten „zdvojnásob" sedí a mezi tím se plynule
 * dojíždí.
 */
export function taxPenalty(balance: Balance, rate: number): number {
  const { tax, taxProgressionFrom, taxProgression } = balance.happiness;
  const over = Math.max(0, rate - taxProgressionFrom);
  return rate * tax + taxProgression * over * over;
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
  // Hrana hrubé mřížky z délky vrstvy — pohled na svět velikost mapy nenese
  // a odvodit ji jde jedním kořenem.
  const coarseSize = Math.round(Math.sqrt(world.happiness.length));
  const populated = new Set<number>();

  for (const building of world.buildings.values()) {
    if (building.abandoned || building.population === 0) continue;
    const cellX = Math.floor(building.x / COARSE_FACTOR);
    const cellY = Math.floor(building.y / COARSE_FACTOR);
    populated.add(cellY * coarseSize + cellX);
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
