import type { Balance } from '@/content/balance';
import { COARSE_CELLS, coarseIndex } from './coarse';
import { index, MAP_SIZE, ROAD, TERRAIN, ZONE } from './layers';
import { coarseTerrainShare } from './terrain';
import { categoryForZone } from './rci';
import type { RciCategory } from './rci';
import { checkFootprint } from './buildings';
import type { BuildingCatalogue } from './catalogue';
import { seedDefinitions } from './levels';
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

/**
 * Vstupy ceny půdy, které se počítají pro celou mapu naráz.
 *
 * Systém i diagnostika si ho spočítají jednou a předají do každé buňky —
 * jinak by průchod terénem probíhal tisíckrát za běh.
 */
export interface LandValueContext {
  /** 1 = buňka sousedí s vodou. */
  water: Uint8Array;
  /** Podíl buňky pokrytý lesem, 0–1. */
  forest: Float32Array;
  sand: Float32Array;
  /** Průměrné vytížení silnic v buňce, 0 = volno, 1 = na kapacitě (§5 fáze 3). */
  congestion: Float32Array;
}

export function landValueContext(world: WorldState, balance: Balance): LandValueContext {
  return {
    water: waterProximity(world),
    forest: coarseTerrainShare(world, TERRAIN.forest),
    sand: coarseTerrainShare(world, TERRAIN.sand),
    congestion: coarseCongestion(world, balance),
  };
}

/**
 * Vytížení silnic přenesené na hrubou mřížku.
 *
 * Průměruje se **přes silniční dlaždice v buňce**, ne přes všech šestnáct:
 * jedna ucpaná ulice uprostřed pole není „šestnáctina problému", ale problém.
 * Buňka bez silnice má nulu.
 */
export function coarseCongestion(world: WorldState, balance: Balance): Float32Array {
  const total = new Float32Array(COARSE_CELLS);
  const counts = new Float32Array(COARSE_CELLS);

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const tile = index(x, y);
      const roadType = world.layers.road[tile] ?? ROAD.none;
      if (roadType === ROAD.none) continue;

      const capacity = balance.traffic.roadTypes[roadType - 1]?.capacity ?? 0;
      if (capacity <= 0) continue;

      const cell = coarseIndex(x, y);
      total[cell] = (total[cell] ?? 0) + Math.min(2, (world.trafficLoad[tile] ?? 0) / capacity);
      counts[cell] = (counts[cell] ?? 0) + 1;
    }
  }

  for (let cell = 0; cell < total.length; cell++) {
    const count = counts[cell] ?? 0;
    total[cell] = count === 0 ? 0 : (total[cell] ?? 0) / count;
  }

  return total;
}

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
  context: LandValueContext,
): LandValueExplanation {
  const { base, waterBonus, weights } = balance.landValue;
  const terms: LandValueTerm[] = [{ source: 'base', input: 1, weight: base, amount: base }];

  if (context.water[cell] === 1) {
    terms.push({ source: 'water', input: 1, weight: waterBonus, amount: waterBonus });
  }

  // Kolony cenu půdy srážejí (§5 fáze 3). Vzniká tím záporná zpětná vazba:
  // dražší půda → vyšší úrovně → hustší zástavba → víc dopravy → kolony →
  // levnější půda. Město se přestane zahušťovat, dokud hráč nezlepší dopravu.
  const congestion = context.congestion[cell] ?? 0;
  if (congestion > 0) {
    const weight = weights['congestion'] ?? 0;
    if (weight !== 0) {
      terms.push({
        source: 'congestion',
        input: congestion,
        weight,
        amount: -congestion * weight,
      });
    }
  }

  // Terén se do ceny půdy počítá podílem buňky, kterou zabírá. Les ji zvedá,
  // dokud stojí — vykácení je tím pádem volba, ne samozřejmost (§2).
  for (const [source, shares] of [
    ['forest', context.forest],
    ['sand', context.sand],
  ] as const) {
    const input = shares[cell] ?? 0;
    const weight = weights[source] ?? 0;
    if (input === 0 || weight === 0) continue;
    terms.push({ source, input, weight, amount: input * weight });
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
  /**
   * Násobitel skóre za dostupnost práce v této čtvrti a celoměstský násobitel
   * rychlosti růstu (R6). Jedničky znamenají „nebrzdí to“.
   */
  jobAccessFactor: number;
  cityJobAccessFactor: number;
  /**
   * Je pod parcelou voda? Bez ní tu nevyroste **nic** (§8 fáze 3) a je to
   * nejčastější důvod, proč zóna zůstane prázdná i s dobrou silnicí, proudem
   * i poptávkou. Neviditelná podmínka, takže patří do panelu (§12).
   */
  water: boolean;
  pollution: number;
  crime: number;
  /** Spokojenost v této čtvrti, 0–255. Kdo ji nevidí, neví, co spravit (§12). */
  happiness: number;
  landValue: LandValueExplanation;
  /** Pokrytí všech tříd, které ve městě existují. */
  coverage: { serviceClass: string; value: number }[];
  /** Poptávka po kategorii zóny; `null` mimo zónu. */
  demand: number | null;
  /** Práh povýšení na další úroveň a úleva za poptávku (§8). */
  levels: { nextThreshold: number | null; demandRelief: number };
}

/**
 * Proč na téhle parcele nic nevyroste. `null` znamená „nic nebrání".
 *
 * Ptá se **týmiž funkcemi jako růst**, ne vlastní kopií podmínek — jinak by
 * panel časem začal tvrdit něco jiného, než co se doopravdy děje. Vrací rovnou
 * lokalizační klíč chyby, takže hráč čte tutéž větu jako při ruční stavbě.
 *
 * Vzniklo to po hraní: autor měl zónu u silnice, vodu i proud, kasu v plusu —
 * a nerostlo nic, protože parcela byla na svahu. Hra o tom mlčela a nedalo se
 * to nikde zjistit.
 */
export function growthBlocker(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  x: number,
  y: number,
): string | null {
  const tile = index(x, y);
  if (world.layers.buildingId[tile] !== 0) return null; // stojí tu budova
  if ((world.layers.road[tile] ?? 0) !== 0) return null; // vozovka, ne parcela

  const zone = world.layers.zone[tile] ?? ZONE.none;
  const category = categoryForZone(zone);
  if (category === null) return 'ui.parcel.blocked.noZone';

  // Bankrot zastaví růst v celém městě (§9 fáze 2).
  if (world.economy.funds < 0) return 'ui.parcel.blocked.bankrupt';
  if (world.demand[category] <= 0) return 'ui.parcel.blocked.noDemand';

  const reach = roadReach(world, balance.growth.roadFactors.length - 1);
  const distance = reach[tile] ?? 255;
  if ((balance.growth.roadFactors[distance] ?? 0) === 0) return 'ui.parcel.blocked.tooFarFromRoad';

  // Zbytek řeší tatáž kontrola, kterou pouští růst. Stačí, aby prošla jediná
  // z nejmenších budov kategorie — přesně tak si vybírá i on.
  const options = seedDefinitions(catalogue, category);
  if (options.length === 0) return 'ui.parcel.blocked.noDefinition';

  let first: string | null = null;
  for (const definition of options) {
    const result = checkFootprint(world, definition, x, y, {
      requireZone: zone,
      skipRoadCheck: true,
    });
    if (result.ok) return null;
    first ??= result.reason;
  }
  return first;
}

/**
 * Jak daleko se parcela dostala, než ji něco zastavilo.
 *
 * Podmínky se kontrolují v pořadí a **poslední z nich je ta zajímavá**: parcela
 * bez zóny nebo bez silnice je ještě daleko, kdežto ta, které chybí jen rovina,
 * je krok od hotova. Když se má hráči hlásit jediná věta, musí to být o téhle.
 *
 * Nejčastější důvod je špatné měřítko: velká zóna daleko od silnice přehlasuje
 * pár parcel u vozovky, které skoro staví — a hráč dostane radu o něčem, co ho
 * netrápí.
 */
const BLOCKER_DEPTH: Readonly<Record<string, number>> = {
  'ui.parcel.blocked.noZone': 1,
  'ui.parcel.blocked.noDemand': 2,
  'ui.parcel.blocked.tooFarFromRoad': 3,
  'error.wrongZone': 4,
  'error.terrainNotAllowed': 5,
  'error.notFlat': 6,
  'error.needsWater': 7,
};

/**
 * Ze sady důvodů vybere ten, který stojí za nahlášení.
 *
 * Bankrot přebíjí všechno: zastavuje růst v celém městě, takže radit hráči, ať
 * někde srovná terén, by bylo k ničemu.
 */
export function worstBlocker(reasons: Iterable<string>): string | null {
  let worst: string | null = null;
  let depth = -1;

  for (const reason of reasons) {
    if (reason === 'ui.parcel.blocked.bankrupt') return reason;
    const value = BLOCKER_DEPTH[reason] ?? 4;
    if (value > depth) {
      depth = value;
      worst = reason;
    }
  }

  return worst;
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

  // Průchod mapou, ale děje se to na kliknutí hráče, ne v tiku.
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
    jobAccessFactor: world.jobAccessCells[cell] ?? 1,
    cityJobAccessFactor: world.cityJobAccess,
    water: world.waterSupply[tile] === 1,
    pollution: world.coarse.pollution[cell] ?? 0,
    crime: world.coarse.crime[cell] ?? 0,
    happiness: world.happiness[cell] ?? 0,
    landValue: explainLandValue(world, balance, cell, landValueContext(world, balance)),
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
