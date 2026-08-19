import type { Balance } from '@/content/balance';
import { coarseIndex } from './coarse';
import { index, TERRAIN, ZONE } from './layers';
import { categoryForZone } from './rci';
import type { RciCategory } from './rci';
import { roadReach } from './systems/growth';
import { waterProximity } from './systems/landValue';
import type { WorldState } from './world';

/**
 * Diagnostika parcely (§12 zadání fáze 2).
 *
 * Fáze 2 přidala pět neviditelných veličin. Bez rozpisu vidí hráč jen to, že
 * mu město chátrá, a nedozví se proč — proto je tenhle soubor podle zadání
 * stejně důležitý jako simulace.
 *
 * Vrací **čísla, ne texty**: `sim/` nesmí znát řetězce (§10), překlad si udělá UI.
 */

/** Jeden sčítanec ceny půdy. `amount` už je se znaménkem. */
export interface LandValueTerm {
  /** `base`, `water`, `pollution`, `crime`, nebo jméno třídy služby. */
  source: string;
  /** Vstupní hodnota — pokrytí, znečištění, kriminalita. */
  input: number;
  weight: number;
  amount: number;
}

export interface LandValueExplanation {
  terms: LandValueTerm[];
  /** Součet sčítanců, tedy hodnota, ke které se cena půdy blíží. */
  raw: number;
  /** Co ve vrstvě opravdu je; kvůli vyhlazení se k `raw` teprve dobírá. */
  current: number;
}

/**
 * Rozpad ceny půdy v jedné buňce.
 *
 * **Používá ho i `landValueSystem`**, aby existoval jediný vzorec. Kdyby si
 * diagnostika počítala vlastní, dřív nebo později by ukazovala něco jiného,
 * než podle čeho se hraje.
 */
export function explainLandValue(
  world: WorldState,
  balance: Balance,
  cell: number,
  nearWater: boolean,
): LandValueExplanation {
  const { base, waterBonus, weights } = balance.landValue;
  const terms: LandValueTerm[] = [{ source: 'base', input: 1, weight: base, amount: base }];

  if (nearWater) {
    terms.push({ source: 'water', input: 1, weight: waterBonus, amount: waterBonus });
  }

  // Pevné pořadí tříd, ať rozpis neposkakuje podle historie vkládání do mapy.
  for (const serviceClass of [...world.coverage.keys()].sort()) {
    const weight = weights[serviceClass];
    if (weight === undefined) continue;
    const input = world.coverage.get(serviceClass)?.[cell] ?? 0;
    if (input === 0) continue;
    terms.push({ source: serviceClass, input, weight, amount: input * weight });
  }

  for (const [source, layer] of [
    ['pollution', world.coarse.pollution],
    ['crime', world.coarse.crime],
  ] as const) {
    const input = layer[cell] ?? 0;
    if (input === 0) continue;
    const weight = weights[source] ?? 0;
    terms.push({ source, input, weight, amount: -input * weight });
  }

  return {
    terms,
    raw: terms.reduce((sum, term) => sum + term.amount, 0),
    current: world.coarse.landValue[cell] ?? 0,
  };
}

/** Co hráči brání ve stavbě na téhle parcele, nebo co ji naopak žene nahoru. */
export interface ParcelExplanation {
  x: number;
  y: number;
  terrain: number;
  zone: number;
  category: RciCategory | null;
  /** Vzdálenost k nejbližší silnici; `null` znamená „dál, než kam růst sahá". */
  roadDistance: number | null;
  /** Násobitel skóre podle té vzdálenosti. Nula = parcela z losu vypadne. */
  roadFactor: number;
  pollution: number;
  crime: number;
  landValue: LandValueExplanation;
  /** Pokrytí všech tříd, které ve městě existují. */
  coverage: { serviceClass: string; value: number }[];
  /** Poptávka po kategorii zóny; `null` mimo zónu. */
  demand: number | null;
  /** Práh povýšení na další úroveň a úleva za poptávku (§8). */
  levels: { nextThreshold: number | null; demandRelief: number };
}

export function explainParcel(
  world: WorldState,
  balance: Balance,
  x: number,
  y: number,
): ParcelExplanation {
  const tile = index(x, y);
  const cell = coarseIndex(x, y);
  const zone = world.layers.zone[tile] ?? ZONE.none;
  const category = categoryForZone(zone);

  // Obojí je průchod mapou, ale děje se to na kliknutí hráče, ne v tiku.
  const nearWater = waterProximity(world)[cell] === 1;
  const building = world.buildings.get(world.layers.buildingId[tile] ?? 0);
  const level = building?.level ?? 0;

  const reach = roadReach(world, balance.growth.roadFactors.length - 1);
  const distance = reach[tile] ?? 255;
  const roadFactor = balance.growth.roadFactors[distance] ?? 0;

  const demand = category === null ? null : world.demand[category];
  const relief =
    demand === null
      ? 0
      : (Math.max(0, Math.min(demand, balance.demand.limit)) / balance.demand.limit) *
        balance.levels.demandRelief;

  return {
    x,
    y,
    terrain: world.layers.terrain[tile] ?? TERRAIN.grass,
    zone,
    category,
    roadDistance: roadFactor > 0 ? distance : null,
    roadFactor,
    pollution: world.coarse.pollution[cell] ?? 0,
    crime: world.coarse.crime[cell] ?? 0,
    landValue: explainLandValue(world, balance, cell, nearWater),
    coverage: [...world.coverage.keys()]
      .sort()
      .map((serviceClass) => ({
        serviceClass,
        value: world.coverage.get(serviceClass)?.[cell] ?? 0,
      })),
    demand,
    // Práh té úrovně, na kterou se tu dá dostat: u stojící budovy další, na
    // prázdné parcele ten pro první povýšení.
    levels: {
      nextThreshold: balance.levels.thresholds[Math.max(1, level) + 1] ?? null,
      demandRelief: relief,
    },
  };
}
