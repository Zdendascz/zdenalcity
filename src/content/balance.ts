import { MAX_HEIGHT } from '@/sim/heights';
import type { ValidationIssue } from './schema';

/**
 * Balanc fáze 2 (§10 zadání). **Žádná z těchhle konstant nesmí být v kódu** —
 * načítá se stejnou cestou jako definice budov, takže je mod smí přepsat.
 *
 * Chybějící sekce je chyba, ne tichý default: kdyby se dala vynechat, hráč by
 * z rozbitého modu dostal město, které se chová jinak, než balanc popisuje.
 */
/** Jeden typ silnice. `id` slouží k lokalizačnímu klíči, ne k logice. */
export interface RoadTypeBalance {
  id: string;
  capacity: number;
  cost: number;
  upkeep: number;
}

export interface Balance {
  /**
   * Ekonomika. Původně konstanty fáze 1 v kódu — přesunuty sem, aby šel balanc
   * ladit bez zásahu do kódu.
   */
  economy: { taxableValuePerUnit: number; startingFunds: number; defaultTaxRate: number };

  demand: {
    workerRatio: number;
    baseResidential: number;
    commercePerCapita: number;
    limit: number;
  };

  /**
   * Generátor mapy (§2 zadání fáze 3). Prahy jsou na normalizovaném výškovém
   * poli 0–1, takže znamenají totéž bez ohledu na počet oktáv.
   */
  map: {
    /** Podíl mapy pod vodou, 0-1. Bere se jako kvantil vysky, ne pevna hladina. */
    seaLevel: number;
    /** Kvantil vysky, nad kterym je skala. */
    rockLevel: number;
    /** Šířka pískového pásu v dlaždicích. */
    beachWidth: number;
    /** Podíl trávy, který zaroste lesem, 0–1. */
    forestDensity: number;
    /** O kolik nad hladinou ještě vzniká mokřad. */
    marshThreshold: number;
    octaves: number;
    roughness: number;
    /** Jaky podil znecisteni pohlti buňka plna lesa, 0-1. */
    forestAbsorption: number;
    /** Cena za vykaceni jedne dlazdice lesa. */
    clearForestCost: number;
    /**
     * Nejmensi podil souse, ktery musi zustat v jednom kuse. Kdyz se to
     * nepovede, generator ubere vodu a zkusi to znovu (R7).
     */
    minLandShare: number;
    /** Nejvyšší patro, které generátor postaví. Strop modelu je 15 (R8). */
    maxHeight: number;
    /**
     * Zakřivení převodu šumu na patra. Nad jedničkou zůstává většina souše
     * nízko a kopce jsou vzácné; jednička dá rovnoměrné rozložení.
     */
    heightCurve: number;
    /**
     * Kolik řek generátor prokope. **Ve vanille zatím nula**: řeka rozdělí
     * souš na dva břehy a most přijde až v T33, takže dokud tam není, byla by
     * to jen nepřístupná polovina mapy.
     */
    rivers: number;
    /** Odkud řeka vyráží — nejmenší patro pramene. */
    riverSourceHeight: number;
    /**
     * Cena terraformingu **za jeden dotčený roh**, včetně kaskády. Zvednutí
     * u strmého svahu rozhýbe desítky rohů a hráč to má vidět na účtu (§7).
     */
    terraformCost: number;
    /** Odtěžení skály a zavezení mokřadu — od 3b jsou obojí řešitelné (§7). */
    clearRockCost: number;
    fillMarshCost: number;
  };

  /**
   * Doprava (§4 a §5 zadání fáze 3). `roadTypes` je pořadí typů silnic;
   * index + 1 je hodnota ve vrstvě `road`, takže přidat typ je změna JSONu.
   */
  traffic: {
    roadTypes: RoadTypeBalance[];
    /** Kolik náhodných cest se z budovy zkusí za jeden běh. */
    attempts: number;
    /** Nejvíc kroků jedné cesty, než to chodec vzdá. */
    maxSteps: number;
    /** Kolik budov se za běh zpracuje; zbytek přijde na řadu příště. */
    maxBuildingsPerRun: number;
    /** Vyhlazení dosažitelnosti práce, 0–1. */
    smoothing: number;
    /**
     * Jakou část dopravy sebere plné pokrytí MHD (§6 fáze 3). Jednička by
     * znamenala „obsloužená čtvrť po silnicích nejezdí vůbec", což nechceme —
     * MHD zátěž snižuje, neruší.
     */
    transitReduction: number;
    /** Cena jedné dlaždice mostu. Most je dražší než vozovka na souši (§7). */
    bridgeCost: number;
  };

  diffusion: { spread: number; decay: number; passes: number };

  landValue: {
    base: number;
    smoothing: number;
    waterBonus: number;
    /**
     * Váhy vstupů. `pollution` a `crime` jsou povinné, zbytek jsou třídy
     * služeb — a ty jsou obsah, takže seznam je otevřený.
     */
    weights: Readonly<Record<string, number>>;
  };

  crime: {
    smoothing: number;
    population: number;
    unemployment: number;
    abandoned: number;
    police: number;
  };

  waste: { perCitizen: number; toPollution: number };

  /**
   * Kanalizace (§8 fáze 3, R9). Stejný tvar jako odpady schválně: je to táž
   * mechanika — město něco vyrobí, kapacita to spolkne a zbytek se propíše
   * do znečištění.
   */
  sewage: { perCitizen: number; toPollution: number };

  /**
   * Spokojenost (§9 fáze 3). Váhy tříd služeb jsou otevřený seznam ze
   * stejného důvodu jako u ceny půdy — třídy jsou obsah, ne kód.
   */
  happiness: {
    /** Odkud se začíná, než se přičte a odečte všechno ostatní. */
    base: number;
    smoothing: number;
    landValue: number;
    pollution: number;
    crime: number;
    congestion: number;
    tax: number;
    unemployment: number;
    /**
     * Nejnižší násobitel obytné poptávky při nulové spokojenosti. **Není to
     * nula schválně**: nespokojené město má růst pomaleji, ne stát.
     */
    minDemandFactor: number;
    weights: Readonly<Record<string, number>>;
  };

  /** Vodovod (§8 fáze 3). */
  water: {
    /** Dosah sítě v dlaždicích potrubí, když ho definice neurčí sama. */
    defaultRange: number;
    /** Cena jedné dlaždice potrubí. */
    pipeCost: number;
    /**
     * O kolik obyvatel přijde budova bez vody za jedno vyhodnocení, a po kolika
     * vyhodnoceních se prázdná budova vzdá a zůstane po ní ruina.
     */
    decayStep: number;
    abandonAfter: number;
  };

  health: {
    coverageThreshold: number;
    declineStep: number;
    recoveryStep: number;
    unservedRatio: number;
  };

  /** Čte se od T16 (úrovně budov). */
  levels: {
    thresholds: number[];
    hysteresis: number;
    cooldown: number;
    downgradeConfirm: number;
    decayAge: number;
    decayCoverageThreshold: number;
    /**
     * O kolik klesne efektivní cena půdy staré budovy v nedostatečně obsloužené
     * buňce. Doplněk zadání — to chátrání věkem popisuje, ale výši neurčuje.
     */
    decayPenalty: number;
    /**
     * O kolik se sníží práh povýšení při **plné** poptávce; slabší poptávka
     * sníží úměrně méně. Města se zahušťují, když se lidé nemají kam nastěhovat.
     *
     * Doplněk zadání (rozhodnutí autora): §8 poptávku bere jen jako vypínač,
     * takže město s poptávkou 100 povyšovalo stejně jako město s poptávkou 1.
     *
     * Posouvá **oba** prahy, jinak by budovy v pásmu mezi nimi kmitaly.
     */
    demandRelief: number;
  };

  /** Čte se od T18 (přepis růstu). */
  growth: {
    exponent: number;
    demandPerAttempt: number;
    maxAttempts: number;
    neutralTaxRate: number;
    taxRange: number;
    /**
     * Násobitel skóre podle vzdálenosti k nejbližší silnici; index = vzdálenost
     * v dlaždicích. Délka pole určuje, jak daleko od vozovky se ještě staví —
     * za posledním prvkem parcela z losu vypadne úplně (§9).
     */
    roadFactors: number[];
    /**
     * Nejnižší násobitel skóre při nulové dosažitelnosti práce (R6). **Není to
     * nula schválně**: tvrdá brána by hru zamkla, protože na začátku nejsou
     * žádná pracovní místa, takže by nic nevyrostlo a místa by nikdy nevznikla.
     */
    minAccessFactor: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function section(
  issues: ValidationIssue[],
  root: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const value = asRecord(root[name]);
  if (!value) issues.push({ field: name, message: 'chybí, nebo není objekt' });
  return value;
}

/** Balanc pracuje s desetinnými čísly, takže vlastní kontrola místo `requireInt`. */
function num(
  issues: ValidationIssue[],
  container: Record<string, unknown> | null,
  key: string,
  field: string,
  min: number,
  max: number,
): number {
  if (!container) return 0;
  const value = container[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push({ field, message: `musí být číslo v rozsahu ${min}–${max}` });
    return 0;
  }
  return value;
}

export function validateBalance(raw: unknown): {
  balance: Balance | null;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const root = asRecord(raw);
  if (!root) {
    return { balance: null, issues: [{ field: '', message: 'balance musí být objekt' }] };
  }

  const economy = section(issues, root, 'economy');
  const demand = section(issues, root, 'demand');
  const map = section(issues, root, 'map');
  const traffic = section(issues, root, 'traffic');
  const diffusion = section(issues, root, 'diffusion');
  const landValue = section(issues, root, 'landValue');
  const crime = section(issues, root, 'crime');
  const waste = section(issues, root, 'waste');
  const sewage = section(issues, root, 'sewage');
  const happiness = section(issues, root, 'happiness');
  const water = section(issues, root, 'water');
  const health = section(issues, root, 'health');
  const levels = section(issues, root, 'levels');
  const growth = section(issues, root, 'growth');

  const weights: Record<string, number> = {};
  const rawWeights = landValue ? asRecord(landValue['weights']) : null;
  if (!rawWeights) {
    issues.push({ field: 'landValue.weights', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawWeights).sort()) {
      // Rozsah je široký schválně: váhy pokrytí násobí vstup 0–255, kdežto
      // váhy terénu podíl 0–1, takže musí být řádově větší.
      weights[key] = num(issues, rawWeights, key, `landValue.weights.${key}`, -100, 100);
    }
    for (const required of ['pollution', 'crime']) {
      if (weights[required] === undefined) {
        issues.push({ field: `landValue.weights.${required}`, message: 'chybí' });
      }
    }
  }

  const happinessWeights: Record<string, number> = {};
  const rawHappinessWeights = happiness ? asRecord(happiness['weights']) : null;
  if (!rawHappinessWeights) {
    issues.push({ field: 'happiness.weights', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawHappinessWeights).sort()) {
      happinessWeights[key] = num(
        issues,
        rawHappinessWeights,
        key,
        `happiness.weights.${key}`,
        -10,
        10,
      );
    }
  }

  const thresholds: number[] = [];
  const rawThresholds = levels?.['thresholds'];
  if (!Array.isArray(rawThresholds) || rawThresholds.length === 0) {
    issues.push({ field: 'levels.thresholds', message: 'musí být neprázdné pole' });
  } else {
    rawThresholds.forEach((value, i) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
        issues.push({ field: `levels.thresholds[${i}]`, message: 'musí být celé číslo 0–255' });
      } else {
        thresholds.push(value);
      }
    });
  }

  const roadFactors: number[] = [];
  const rawRoadFactors = growth?.['roadFactors'];
  if (!Array.isArray(rawRoadFactors) || rawRoadFactors.length < 2) {
    issues.push({
      field: 'growth.roadFactors',
      message: 'musí být pole aspoň o dvou prvcích (index = vzdálenost k silnici)',
    });
  } else {
    rawRoadFactors.forEach((value, i) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        issues.push({ field: `growth.roadFactors[${i}]`, message: 'musí být číslo v rozsahu 0–1' });
      } else {
        roadFactors.push(value);
      }
    });
  }

  const roadTypes: RoadTypeBalance[] = [];
  const rawRoadTypes = traffic?.['roadTypes'];
  if (!Array.isArray(rawRoadTypes) || rawRoadTypes.length === 0) {
    issues.push({ field: 'traffic.roadTypes', message: 'musí být neprázdné pole typů silnic' });
  } else {
    rawRoadTypes.forEach((entry, i) => {
      const where = `traffic.roadTypes[${i}]`;
      const record = asRecord(entry);
      if (!record) {
        issues.push({ field: where, message: 'musí být objekt' });
        return;
      }
      const id = record['id'];
      if (typeof id !== 'string' || id.length === 0) {
        issues.push({ field: `${where}.id`, message: 'musí být neprázdný řetězec' });
        return;
      }
      roadTypes.push({
        id,
        capacity: num(issues, record, 'capacity', `${where}.capacity`, 1, 10000),
        cost: num(issues, record, 'cost', `${where}.cost`, 0, 100000),
        upkeep: num(issues, record, 'upkeep', `${where}.upkeep`, 0, 100000),
      });
    });
  }

  const balance: Balance = {
    economy: {
      taxableValuePerUnit: num(
        issues,
        economy,
        'taxableValuePerUnit',
        'economy.taxableValuePerUnit',
        0,
        10000,
      ),
      startingFunds: num(issues, economy, 'startingFunds', 'economy.startingFunds', 0, 100000000),
      defaultTaxRate: num(issues, economy, 'defaultTaxRate', 'economy.defaultTaxRate', 0, 100),
    },
    demand: {
      workerRatio: num(issues, demand, 'workerRatio', 'demand.workerRatio', 0, 1),
      baseResidential: num(issues, demand, 'baseResidential', 'demand.baseResidential', 0, 1000),
      commercePerCapita: num(
        issues,
        demand,
        'commercePerCapita',
        'demand.commercePerCapita',
        0,
        100,
      ),
      limit: num(issues, demand, 'limit', 'demand.limit', 1, 1000),
    },
    map: {
      seaLevel: num(issues, map, 'seaLevel', 'map.seaLevel', 0, 1),
      rockLevel: num(issues, map, 'rockLevel', 'map.rockLevel', 0, 1),
      beachWidth: num(issues, map, 'beachWidth', 'map.beachWidth', 0, 32),
      forestDensity: num(issues, map, 'forestDensity', 'map.forestDensity', 0, 1),
      marshThreshold: num(issues, map, 'marshThreshold', 'map.marshThreshold', 0, 1),
      octaves: num(issues, map, 'octaves', 'map.octaves', 1, 8),
      roughness: num(issues, map, 'roughness', 'map.roughness', 0, 1),
      forestAbsorption: num(issues, map, 'forestAbsorption', 'map.forestAbsorption', 0, 1),
      clearForestCost: num(issues, map, 'clearForestCost', 'map.clearForestCost', 0, 100000),
      minLandShare: num(issues, map, 'minLandShare', 'map.minLandShare', 0, 1),
      maxHeight: num(issues, map, 'maxHeight', 'map.maxHeight', 0, MAX_HEIGHT),
      heightCurve: num(issues, map, 'heightCurve', 'map.heightCurve', 0.1, 8),
      rivers: num(issues, map, 'rivers', 'map.rivers', 0, 16),
      riverSourceHeight: num(issues, map, 'riverSourceHeight', 'map.riverSourceHeight', 0, MAX_HEIGHT),
      terraformCost: num(issues, map, 'terraformCost', 'map.terraformCost', 0, 100000),
      clearRockCost: num(issues, map, 'clearRockCost', 'map.clearRockCost', 0, 100000),
      fillMarshCost: num(issues, map, 'fillMarshCost', 'map.fillMarshCost', 0, 100000),
    },
    traffic: {
      roadTypes,
      attempts: num(issues, traffic, 'attempts', 'traffic.attempts', 1, 100),
      maxSteps: num(issues, traffic, 'maxSteps', 'traffic.maxSteps', 1, 1000),
      maxBuildingsPerRun: num(
        issues,
        traffic,
        'maxBuildingsPerRun',
        'traffic.maxBuildingsPerRun',
        1,
        100000,
      ),
      smoothing: num(issues, traffic, 'smoothing', 'traffic.smoothing', 0, 1),
      transitReduction: num(issues, traffic, 'transitReduction', 'traffic.transitReduction', 0, 1),
      bridgeCost: num(issues, traffic, 'bridgeCost', 'traffic.bridgeCost', 0, 100000),
    },
    diffusion: {
      spread: num(issues, diffusion, 'spread', 'diffusion.spread', 0, 1),
      decay: num(issues, diffusion, 'decay', 'diffusion.decay', 0, 1),
      passes: num(issues, diffusion, 'passes', 'diffusion.passes', 1, 8),
    },
    landValue: {
      base: num(issues, landValue, 'base', 'landValue.base', 0, 255),
      smoothing: num(issues, landValue, 'smoothing', 'landValue.smoothing', 0, 1),
      waterBonus: num(issues, landValue, 'waterBonus', 'landValue.waterBonus', 0, 255),
      weights,
    },
    crime: {
      smoothing: num(issues, crime, 'smoothing', 'crime.smoothing', 0, 1),
      population: num(issues, crime, 'population', 'crime.population', 0, 10),
      unemployment: num(issues, crime, 'unemployment', 'crime.unemployment', 0, 255),
      abandoned: num(issues, crime, 'abandoned', 'crime.abandoned', 0, 255),
      police: num(issues, crime, 'police', 'crime.police', 0, 10),
    },
    water: {
      defaultRange: num(issues, water, 'defaultRange', 'water.defaultRange', 1, 1000),
      pipeCost: num(issues, water, 'pipeCost', 'water.pipeCost', 0, 100000),
      decayStep: num(issues, water, 'decayStep', 'water.decayStep', 0, 1000),
      abandonAfter: num(issues, water, 'abandonAfter', 'water.abandonAfter', 1, 1000),
    },
    happiness: {
      base: num(issues, happiness, 'base', 'happiness.base', 0, 255),
      smoothing: num(issues, happiness, 'smoothing', 'happiness.smoothing', 0, 1),
      landValue: num(issues, happiness, 'landValue', 'happiness.landValue', 0, 100),
      pollution: num(issues, happiness, 'pollution', 'happiness.pollution', 0, 100),
      crime: num(issues, happiness, 'crime', 'happiness.crime', 0, 100),
      congestion: num(issues, happiness, 'congestion', 'happiness.congestion', 0, 1000),
      tax: num(issues, happiness, 'tax', 'happiness.tax', 0, 100),
      unemployment: num(issues, happiness, 'unemployment', 'happiness.unemployment', 0, 1000),
      minDemandFactor: num(issues, happiness, 'minDemandFactor', 'happiness.minDemandFactor', 0, 1),
      weights: happinessWeights,
    },
    sewage: {
      perCitizen: num(issues, sewage, 'perCitizen', 'sewage.perCitizen', 0, 100),
      toPollution: num(issues, sewage, 'toPollution', 'sewage.toPollution', 0, 100),
    },
    waste: {
      perCitizen: num(issues, waste, 'perCitizen', 'waste.perCitizen', 0, 100),
      toPollution: num(issues, waste, 'toPollution', 'waste.toPollution', 0, 100),
    },
    health: {
      coverageThreshold: num(issues, health, 'coverageThreshold', 'health.coverageThreshold', 0, 255),
      declineStep: num(issues, health, 'declineStep', 'health.declineStep', 0, 255),
      recoveryStep: num(issues, health, 'recoveryStep', 'health.recoveryStep', 0, 255),
      unservedRatio: num(issues, health, 'unservedRatio', 'health.unservedRatio', 0, 1),
    },
    levels: {
      thresholds,
      hysteresis: num(issues, levels, 'hysteresis', 'levels.hysteresis', 0, 255),
      cooldown: num(issues, levels, 'cooldown', 'levels.cooldown', 0, 100000),
      downgradeConfirm: num(issues, levels, 'downgradeConfirm', 'levels.downgradeConfirm', 1, 100),
      decayAge: num(issues, levels, 'decayAge', 'levels.decayAge', 0, 1000000),
      decayCoverageThreshold: num(
        issues,
        levels,
        'decayCoverageThreshold',
        'levels.decayCoverageThreshold',
        0,
        255,
      ),
      decayPenalty: num(issues, levels, 'decayPenalty', 'levels.decayPenalty', 0, 255),
      demandRelief: num(issues, levels, 'demandRelief', 'levels.demandRelief', 0, 255),
    },
    growth: {
      exponent: num(issues, growth, 'exponent', 'growth.exponent', 0, 10),
      demandPerAttempt: num(issues, growth, 'demandPerAttempt', 'growth.demandPerAttempt', 1, 1000),
      maxAttempts: num(issues, growth, 'maxAttempts', 'growth.maxAttempts', 1, 1000),
      neutralTaxRate: num(issues, growth, 'neutralTaxRate', 'growth.neutralTaxRate', 0, 100),
      taxRange: num(issues, growth, 'taxRange', 'growth.taxRange', 1, 100),
      roadFactors,
      minAccessFactor: num(issues, growth, 'minAccessFactor', 'growth.minAccessFactor', 0, 1),
    },
  };

  return { balance: issues.length > 0 ? null : balance, issues };
}
