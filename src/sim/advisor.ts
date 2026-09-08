import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from './catalogue';
import { coarseCongestion, cityUtilities } from './diagnostics';
import { populationPerCell } from './disasters/unrest';
import type { WorldState } from './world';
import { averageHappiness } from './systems/happiness';

/**
 * Poradce starosty (§12).
 *
 * Zadání autora: „klikneš a vyskočí dvě největší bolesti, které by měl řešit,
 * a jedna pochvala, co dělá dobře."
 *
 * **Nevymýšlí si vlastní slovník.** Problémy jsou ta samá `id` jako v nápovědě
 * (`ui.help.problem.<id>.title`, `.cause`, `.fix`), takže poradce hráče pošle
 * do textu, který už existuje a který někdo napsal celý — co to je, proč se to
 * děje a co s tím. Přidat sem nový problém bez odstavce v nápovědě nejde;
 * hlídá to test.
 *
 * Vrací **čísla a klíče, ne věty** (§10). Naléhavost je 0–1 a počítá se ze
 * stejných veličin, ze kterých hra bere rozhodnutí — ne z paralelního odhadu,
 * který by se s nimi časem rozešel.
 */

/**
 * Co poradce umí vytknout. Každé id **musí mít odstavec v nápovědě** —
 * `ui.help.problem.<id>.title`, `.cause` a `.fix`. Hlídá to test, takže nový
 * druh rady si vynutí i text, kterým se vysvětlí.
 */
export const ADVISOR_PROBLEMS = [
  'bankrupt',
  'blackout',
  'needsPower',
  'needsWater',
  'pollution',
  'crime',
  'traffic',
  'unhappy',
  'services',
  'abandoned',
  'rubble',
  'fire',
] as const;

/** A za co umí pochválit. Texty má vlastní: `ui.advisor.praise.<id>.title`. */
export const ADVISOR_PRAISES = [
  'money',
  'power',
  'clean',
  'safe',
  'flowing',
  'happy',
  'services',
] as const;

export type AdvisorProblem = (typeof ADVISOR_PROBLEMS)[number];
export type AdvisorPraise = (typeof ADVISOR_PRAISES)[number];

/** Jedna rada: co, jak moc a s jakými čísly. */
export interface Advice {
  /** Id problému z nápovědy, nebo id pochvaly. */
  id: string;
  /** 0–1. U problémů naléhavost, u pochvaly jak moc se to povedlo. */
  weight: number;
  /**
   * Čísla do hlášky, když je čím doplnit — kolik budov je potmě, která služba
   * chybí. UI je vloží do `ui.advisor.detail.<id>`; chybějící detail se
   * prostě nevypíše.
   */
  detail?: Record<string, number | string>;
}

export interface CityAdvice {
  /** Nejvýš dvě, seřazené od nejnaléhavější. Prázdné = město nemá bolest. */
  problems: Advice[];
  /** Za co pochválit. `null`, dokud město nestojí za pochvalu. */
  praise: Advice | null;
}

/**
 * Pod tuhle naléhavost se nehlásí nic.
 *
 * Poradce, který vždycky něco najde, je k ničemu — hráč se naučí, že v něm
 * pořád svítí dvě položky, a přestane ho otevírat. Prázdný poradce je
 * platná odpověď a hra ji umí říct (`ui.advisor.allGood`).
 */
const NOISE = 0.18;

/** A tenhle práh musí pochvala přeskočit, aby nechválila průměr. */
const PRAISE_FLOOR = 0.6;

/** Kolik obyvatel musí město mít, než má smysl radit. */
const MIN_POPULATION = 20;

export function cityAdvice(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): CityAdvice {
  const problems: Advice[] = [];
  const praises: Advice[] = [];
  const add = (
    list: Advice[],
    id: AdvisorProblem | AdvisorPraise,
    weight: number,
    detail?: Advice['detail'],
  ): void => {
    if (weight > 0) list.push(detail ? { id, weight, detail } : { id, weight });
  };

  let population = 0;
  let buildings = 0;
  let dark = 0;
  let abandoned = 0;
  for (const building of world.buildings.values()) {
    population += building.population;
    if (building.abandoned) {
      abandoned++;
      continue;
    }
    buildings++;
    if (!building.powered) dark++;
  }

  // Prázdná placka nemá co řešit a rady o kriminalitě by na ní byly komické.
  if (population < MIN_POPULATION) return { problems: [], praise: null };

  /* --- peníze ------------------------------------------------------------ */
  const { funds, lastIncome, lastExpenses } = world.economy;
  if (funds < 0) {
    add(problems, 'bankrupt', 1, { funds: Math.round(funds) });
  } else {
    const loss = lastExpenses - lastIncome;
    // Ztrátový měsíc sám o sobě nic není — město po velké stavbě prodělává
    // běžně. Naléhavé je, když kasa nevydrží ani rok téhle ztráty.
    if (loss > 0) {
      const monthsLeft = funds / loss;
      add(problems, 'bankrupt', clamp(1 - monthsLeft / 12), { months: Math.floor(monthsLeft) });
    } else if (lastIncome > 0) {
      add(praises, 'money', clamp((lastIncome - lastExpenses) / lastIncome + 0.35));
    }
  }

  /* --- proud ------------------------------------------------------------- */
  const blackout = world.disasters.active.some(
    (entry) => !entry.finished && entry.kind === 'blackout',
  );
  if (blackout) {
    add(problems, 'blackout', 0.95, { plants: world.disasters.offlinePlants.size });
  }
  if (buildings > 0) {
    const share = dark / buildings;
    // Za blackoutu je tma důsledek, ne samostatná rada — hráč by dostal dvě
    // položky o jedné věci a přišel o tu druhou skutečnou.
    if (!blackout) add(problems, 'needsPower', clamp(share * 2), { dark });
    else if (share < 0.02) add(praises, 'power', 0.7);
  }

  /* --- sítě -------------------------------------------------------------- */
  const utilities = cityUtilities(world, catalogue, balance);
  add(
    problems,
    'needsWater',
    shortfall(utilities.waterNeeded, utilities.waterCapacity),
    { needed: utilities.waterNeeded, capacity: utilities.waterCapacity },
  );
  // Odpad i kanalizace končí ve stejném následku — co se nezpracuje, rozlije
  // se do znečištění po celé mapě — takže o nich mluví jeden odstavec.
  const dirt = Math.max(
    shortfall(utilities.wasteNeeded, utilities.wasteCapacity),
    shortfall(utilities.sewageNeeded, utilities.sewageCapacity),
  );

  /* --- čtvrti: vážené počtem lidí, ne plochou ---------------------------- */
  const perCell = populationPerCell(world);
  const congestion = coarseCongestion(world, balance);
  let weightSum = 0;
  let pollution = 0;
  let crime = 0;
  let traffic = 0;
  for (const [cell, people] of perCell) {
    if (people <= 0) continue;
    weightSum += people;
    pollution += ((world.coarse.pollution[cell] ?? 0) / 255) * people;
    crime += ((world.coarse.crime[cell] ?? 0) / 255) * people;
    traffic += Math.min(1, congestion[cell] ?? 0) * people;
  }
  if (weightSum > 0) {
    pollution /= weightSum;
    crime /= weightSum;
    traffic /= weightSum;
  }

  add(problems, 'pollution', Math.max(dirt, clamp((pollution - 0.15) * 2)), {
    percent: Math.round(pollution * 100),
  });
  add(problems, 'crime', clamp((crime - 0.1) * 2), { percent: Math.round(crime * 100) });
  add(problems, 'traffic', clamp((traffic - 0.4) * 2), { percent: Math.round(traffic * 100) });
  if (pollution < 0.08 && dirt === 0) add(praises, 'clean', clamp(1 - pollution * 4));
  if (crime < 0.08) add(praises, 'safe', clamp(1 - crime * 6));
  if (traffic < 0.35) add(praises, 'flowing', clamp(1 - traffic));

  /* --- spokojenost ------------------------------------------------------- */
  const happiness = averageHappiness(world) / 255;
  add(problems, 'unhappy', clamp((0.55 - happiness) * 3), {
    percent: Math.round(happiness * 100),
  });
  add(praises, 'happy', clamp((happiness - 0.55) * 2.5), { percent: Math.round(happiness * 100) });

  /* --- služby ------------------------------------------------------------ */
  let worstClass: string | null = null;
  let worstGap = 0;
  let bestCoverage = 1;
  for (const [serviceClass, coverage] of world.coverage) {
    let covered = 0;
    let people = 0;
    for (const [cell, count] of perCell) {
      if (count <= 0) continue;
      people += count;
      covered += ((coverage[cell] ?? 0) / 255) * count;
    }
    if (people <= 0) continue;
    const share = covered / people;
    bestCoverage = Math.min(bestCoverage, share);
    if (1 - share > worstGap) {
      worstGap = 1 - share;
      worstClass = serviceClass;
    }
  }
  if (worstClass !== null) {
    add(problems, 'services', clamp((worstGap - 0.35) * 1.6), {
      // Klíč, ne holé jméno třídy: UI si ho přeloží (`ui.service.police`).
      service: `ui.service.${worstClass}`,
      percent: Math.round((1 - worstGap) * 100),
    });
  }
  if (bestCoverage > 0.6) add(praises, 'services', clamp(bestCoverage));

  /* --- co po sobě město nechalo ------------------------------------------ */
  add(problems, 'abandoned', clamp((abandoned / Math.max(1, buildings)) * 4), { abandoned });

  let rubble = 0;
  for (let tile = 0; tile < world.rubble.length; tile++) if (world.rubble[tile] !== 0) rubble++;
  add(problems, 'rubble', clamp(rubble / Math.max(20, buildings)), { rubble });

  // Hoří? Počet drží svět, protože ho počítá požární systém — vlastní průchod
  // ohněm by tady byl třetí a při každém otevření poradce.
  const burning = world.disasters.burning.normal + world.disasters.burning.wildfire;
  if (burning > 0) add(problems, 'fire', 0.9, { tiles: burning });

  problems.sort((a, b) => b.weight - a.weight);
  praises.sort((a, b) => b.weight - a.weight);

  const best = praises[0];
  return {
    problems: problems.filter((advice) => advice.weight >= NOISE).slice(0, 2),
    praise: best && best.weight >= PRAISE_FLOOR ? best : null,
  };
}

/** O kolik chybí kapacita, 0–1. Nula znamená „stačí". */
function shortfall(needed: number, capacity: number): number {
  if (needed <= 0) return 0;
  return clamp((needed - capacity) / needed);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
