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

/** Veličina, podle které se katastrofa škáluje nebo podmiňuje (§3 fáze 4). */
export type DisasterMetric =
  | 'none'
  | 'buildings'
  | 'population'
  | 'roadTiles'
  | 'coastTiles'
  | 'forestTiles'
  | 'flatShare'
  | 'industrialBuildings'
  | 'residentialBuildings'
  | 'heavyIndustry'
  | 'powerPlants'
  | 'riskySlopes';

const DISASTER_METRICS: readonly DisasterMetric[] = [
  'none',
  'buildings',
  'population',
  'roadTiles',
  'coastTiles',
  'forestTiles',
  'flatShare',
  'industrialBuildings',
  'residentialBuildings',
  'heavyIndustry',
  'powerPlants',
  'riskySlopes',
];

/**
 * Měřítkový faktor: `clamp(offset + tvar(metrika / dělitel), min, max)`.
 *
 * Jeden zápis pro všechny — katalog jim říká `sizeFactor`, `coastFactor`,
 * `forestFactor` nebo `slopeFactor`, ale počítají se stejně. Kdyby měl každý
 * vlastní tvar, byly by v kódu čtyři skoro stejné funkce.
 */
export interface ScaleBalance {
  metric: DisasterMetric;
  /** `sqrt` tlumí růst u velkých měst, `linear` ne. */
  curve: 'sqrt' | 'linear';
  divisor: number;
  offset: number;
  min: number;
  max: number;
}

/** Jeden sčítanec faktoru typu. */
export interface RiskTermBalance {
  /** Jméno ukazatele; `uncovered:fire` a spol. nesou třídu za dvojtečkou. */
  indicator: string;
  weight: number;
  /**
   * Když je zadané, počítá se **o kolik ukazatel chybí** pod tuhle hodnotu.
   * Používá to rezerva elektrické sítě: nad prahem nepřispívá nic, pod ním
   * roste strmě. Bez toho by ta strmost musela být v kódu.
   */
  below?: number;
}

/**
 * Jak katastrofa hoří (§4 fáze 4).
 *
 * Mají to jen dvě: požár a lesní požár. Sdílejí vrstvu i mechaniku, liší se
 * čísly — lesní hoří prudčeji, šíří se ochotněji a vzniká z jediného ohniska.
 */
export interface BurnBalance {
  /** Lesní varianta: hoří jinak a po vyhoření zbude tráva, ne trosky. */
  wildfire: boolean;
  /** Intenzita, se kterou dlaždice chytne. */
  ignitionIntensity: number;
  /** O kolik intenzita za ohňový tik povyroste. */
  intensityGrowth: number;
  /** Násobitel šance, že oheň přeskočí na souseda. */
  spreadChance: number;
  minIgnitions: number;
  maxIgnitions: number;
}

export interface DisasterBalance {
  baseMonthlyChance: number;
  maxMonthlyChance: number;
  /** Období hájení v tikách (R17). */
  cooldownTicks: number;
  /** Přírodní katastrofy mají faktor typu vždycky 1 — správa města na ně nemá vliv. */
  natural: boolean;
  concurrent: { metric: DisasterMetric; divisor: number; min: number; max: number };
  scale?: ScaleBalance;
  /** Rok má 360 tiků. `from > to` se čte jako okno přes Silvestra. */
  season?: { from: number; to: number; inFactor: number; outFactor: number };
  /** Bez čeho katastrofa nevznikne — pobřeží u povodně, les u lesního požáru. */
  require: readonly { metric: DisasterMetric; min: number }[];
  risk: readonly RiskTermBalance[];
  burn?: BurnBalance;
}

/**
 * Model ohně — společný požáru i lesnímu požáru (§4 fáze 4).
 *
 * Hořlavost a palivo se berou podle **obsahu dlaždice**, ne podle konkrétní
 * budovy (P5). `byClass` je výjimka pro třídy služeb, které se z kategorie
 * odvodit nedají: park hoří desetkrát hůř než hasičárna, i když obojí je
 * služba, a právě proto je z parku použitelná protipožární bariéra.
 */
export interface FireBalance {
  /** Ohňový tik běží nezávisle na plánovači katastrof. */
  tickInterval: number;
  /** Kolik intenzity ubyde samo, i bez hasičů. */
  suppressBase: number;
  /** Kolik navíc ubyde za každý bod `coverage[fire]`. */
  suppressPerCoverage: number;
  /** Znečištění z každé hořící dlaždice za ohňový tik. */
  pollutionPerTick: number;
  /** Srážka spokojenosti za každou zničenou budovu. */
  happinessPerLoss: number;
  happinessPenaltyTicks: number;
  /** Klíče: `forest`, `abandoned`, `industrial`, `residential`, `commercial`, `service`, `rubble`. */
  flammability: Readonly<Record<string, number>>;
  fuel: Readonly<Record<string, number>>;
  byClass: Readonly<Record<string, { flammability: number; fuel: number }>>;
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
  /**
   * Katastrofy (§3 fáze 4). Všech patnáct je **data**, ne kód (P5) — mechanika
   * každé z nich je vlastní, ale kdy a jak často udeří, se ladí odsud.
   */
  disasters: {
    /** Strop faktoru typu (R16). Společný všem, jinak by nerozpojoval smyčku. */
    maxRiskMultiplier: number;
    indicators: { uncoveredBelow: number; denseLevel: number; ageTicks: number };
    /**
     * Trosky (R15). Chovají se jako opuštěné budovy z fáze 2 — sráží cenu půdy
     * a živí kriminalitu — a stojí peníze, než je hráč uklidí.
     */
    rubble: { clearCost: number; crimeWeight: number; landValuePenalty: number };
    fire: FireBalance;
    types: Readonly<Record<string, DisasterBalance>>;
  };

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
    /**
     * Násobitel váhy parcely na svahu (rozhodnutí autora, T41).
     *
     * Dům ze zóny na svahu stojí dráž, takže se tam staví méně ochotně —
     * není to zákaz. Do T41 zákaz byl a na generované mapě tím byla necelá
     * polovina souše nezastavitelná.
     */
    slopeFactor: number;
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

  const disasters = section(issues, root, 'disasters');
  const disasterTypes = validateDisasters(issues, disasters);

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
    disasters: {
      maxRiskMultiplier: num(
        issues,
        disasters,
        'maxRiskMultiplier',
        'disasters.maxRiskMultiplier',
        1,
        100,
      ),
      indicators: {
        uncoveredBelow: num(
          issues,
          disasters ? asRecord(disasters['indicators']) : null,
          'uncoveredBelow',
          'disasters.indicators.uncoveredBelow',
          0,
          255,
        ),
        denseLevel: num(
          issues,
          disasters ? asRecord(disasters['indicators']) : null,
          'denseLevel',
          'disasters.indicators.denseLevel',
          1,
          5,
        ),
        ageTicks: num(
          issues,
          disasters ? asRecord(disasters['indicators']) : null,
          'ageTicks',
          'disasters.indicators.ageTicks',
          0,
          1000000,
        ),
      },
      rubble: {
        clearCost: num(
          issues,
          disasters ? asRecord(disasters['rubble']) : null,
          'clearCost',
          'disasters.rubble.clearCost',
          0,
          100000,
        ),
        crimeWeight: num(
          issues,
          disasters ? asRecord(disasters['rubble']) : null,
          'crimeWeight',
          'disasters.rubble.crimeWeight',
          0,
          100,
        ),
        landValuePenalty: num(
          issues,
          disasters ? asRecord(disasters['rubble']) : null,
          'landValuePenalty',
          'disasters.rubble.landValuePenalty',
          0,
          255,
        ),
      },
      fire: validateFire(issues, disasters),
      types: disasterTypes,
    },
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
      slopeFactor: num(issues, growth, 'slopeFactor', 'growth.slopeFactor', 0, 1),
    },
  };

  return { balance: issues.length > 0 ? null : balance, issues };
}

/**
 * Katastrofy z balancu.
 *
 * Kontroluje se **tvar, ne smysl**: že metrika existuje, že pravděpodobnost je
 * v rozsahu 0–1, že strop není pod základem. Jestli je 0,02 měsíčně málo nebo
 * moc, se pozná hraním, ne validací.
 *
 * Neznámá metrika je chyba, ne varování. Překlep v `buildigns` by jinak tiše
 * znamenal „škáluj podle nuly", tedy katastrofu, která nikdy nepřijde.
 */
function validateDisasters(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): Record<string, DisasterBalance> {
  const out: Record<string, DisasterBalance> = {};
  const rawTypes = disasters ? asRecord(disasters['types']) : null;
  if (!rawTypes) {
    if (disasters) issues.push({ field: 'disasters.types', message: 'chybí, nebo není objekt' });
    return out;
  }

  // Setříděné klíče, ať jsou hlášky ve stabilním pořadí.
  for (const kind of Object.keys(rawTypes).sort()) {
    const where = `disasters.types.${kind}`;
    const record = asRecord(rawTypes[kind]);
    if (!record) {
      issues.push({ field: where, message: 'musí být objekt' });
      continue;
    }

    const base = num(issues, record, 'baseMonthlyChance', `${where}.baseMonthlyChance`, 0, 1);
    const cap = num(issues, record, 'maxMonthlyChance', `${where}.maxMonthlyChance`, 0, 1);
    if (cap < base) {
      issues.push({ field: `${where}.maxMonthlyChance`, message: 'strop nesmí být pod základem' });
    }

    const natural = record['natural'];
    if (typeof natural !== 'boolean') {
      issues.push({ field: `${where}.natural`, message: 'musí být true nebo false' });
    }

    out[kind] = {
      baseMonthlyChance: base,
      maxMonthlyChance: cap,
      cooldownTicks: num(issues, record, 'cooldownTicks', `${where}.cooldownTicks`, 0, 100000),
      natural: natural === true,
      concurrent: validateConcurrent(issues, record, where),
      ...(record['scale'] === undefined
        ? {}
        : { scale: validateScale(issues, asRecord(record['scale']), `${where}.scale`) }),
      ...(record['season'] === undefined
        ? {}
        : { season: validateSeason(issues, asRecord(record['season']), `${where}.season`) }),
      require: validateRequire(issues, record['require'], `${where}.require`),
      risk: validateRisk(issues, record['risk'], `${where}.risk`, natural === true),
      ...(record['burn'] === undefined
        ? {}
        : { burn: validateBurn(issues, asRecord(record['burn']), `${where}.burn`) }),
    };
  }

  return out;
}

function metric(
  issues: ValidationIssue[],
  container: Record<string, unknown> | null,
  key: string,
  field: string,
): DisasterMetric {
  const value = container?.[key];
  if (typeof value !== 'string' || !DISASTER_METRICS.includes(value as DisasterMetric)) {
    issues.push({ field, message: `neznámá veličina; povolené: ${DISASTER_METRICS.join(', ')}` });
    return 'none';
  }
  return value as DisasterMetric;
}

function validateConcurrent(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
  where: string,
): DisasterBalance['concurrent'] {
  const raw = asRecord(record['concurrent']);
  if (!raw) {
    issues.push({ field: `${where}.concurrent`, message: 'chybí, nebo není objekt' });
    return { metric: 'none', divisor: 1, min: 1, max: 1 };
  }
  const min = num(issues, raw, 'min', `${where}.concurrent.min`, 1, 100);
  const max = num(issues, raw, 'max', `${where}.concurrent.max`, 1, 100);
  if (max < min) {
    issues.push({ field: `${where}.concurrent.max`, message: 'nesmí být pod min' });
  }
  return {
    metric: metric(issues, raw, 'metric', `${where}.concurrent.metric`),
    divisor: num(issues, raw, 'divisor', `${where}.concurrent.divisor`, 1, 1000000),
    min,
    max,
  };
}

function validateScale(
  issues: ValidationIssue[],
  raw: Record<string, unknown> | null,
  where: string,
): ScaleBalance {
  if (!raw) {
    issues.push({ field: where, message: 'musí být objekt' });
    return { metric: 'none', curve: 'linear', divisor: 1, offset: 0, min: 1, max: 1 };
  }
  const curve = raw['curve'];
  if (curve !== 'sqrt' && curve !== 'linear') {
    issues.push({ field: `${where}.curve`, message: "musí být 'sqrt' nebo 'linear'" });
  }
  return {
    metric: metric(issues, raw, 'metric', `${where}.metric`),
    curve: curve === 'sqrt' ? 'sqrt' : 'linear',
    divisor: num(issues, raw, 'divisor', `${where}.divisor`, 0.000001, 1000000),
    offset: num(issues, raw, 'offset', `${where}.offset`, -10, 10),
    min: num(issues, raw, 'min', `${where}.min`, 0, 100),
    max: num(issues, raw, 'max', `${where}.max`, 0, 100),
  };
}

function validateSeason(
  issues: ValidationIssue[],
  raw: Record<string, unknown> | null,
  where: string,
): NonNullable<DisasterBalance['season']> {
  if (!raw) {
    issues.push({ field: where, message: 'musí být objekt' });
    return { from: 0, to: 0, inFactor: 1, outFactor: 1 };
  }
  return {
    from: num(issues, raw, 'from', `${where}.from`, 0, 359),
    to: num(issues, raw, 'to', `${where}.to`, 0, 360),
    inFactor: num(issues, raw, 'inFactor', `${where}.inFactor`, 0, 20),
    outFactor: num(issues, raw, 'outFactor', `${where}.outFactor`, 0, 20),
  };
}

function validateRequire(
  issues: ValidationIssue[],
  raw: unknown,
  where: string,
): { metric: DisasterMetric; min: number }[] {
  if (!Array.isArray(raw)) {
    issues.push({ field: where, message: 'musí být pole (klidně prázdné)' });
    return [];
  }
  return raw.map((entry, i) => {
    const record = asRecord(entry);
    if (!record) {
      issues.push({ field: `${where}[${i}]`, message: 'musí být objekt' });
      return { metric: 'none' as DisasterMetric, min: 0 };
    }
    return {
      metric: metric(issues, record, 'metric', `${where}[${i}].metric`),
      min: num(issues, record, 'min', `${where}[${i}].min`, 0, 1000000),
    };
  });
}

function validateRisk(
  issues: ValidationIssue[],
  raw: unknown,
  where: string,
  natural: boolean,
): RiskTermBalance[] {
  if (!Array.isArray(raw)) {
    issues.push({ field: where, message: 'musí být pole (klidně prázdné)' });
    return [];
  }
  // Přírodní katastrofa se sčítanci rizika je zmatek, ne chyba obsahu: faktor
  // typu je u ní z definice 1, takže by je nikdo nikdy nepřečetl.
  if (natural && raw.length > 0) {
    issues.push({ field: where, message: 'přírodní katastrofa nemá faktor typu, seznam musí být prázdný' });
  }

  return raw.map((entry, i) => {
    const record = asRecord(entry);
    if (!record) {
      issues.push({ field: `${where}[${i}]`, message: 'musí být objekt' });
      return { indicator: '', weight: 0 };
    }
    const indicator = record['indicator'];
    if (typeof indicator !== 'string' || indicator.length === 0) {
      issues.push({ field: `${where}[${i}].indicator`, message: 'musí být neprázdný řetězec' });
    }
    return {
      indicator: typeof indicator === 'string' ? indicator : '',
      weight: num(issues, record, 'weight', `${where}[${i}].weight`, -100, 100),
      ...(record['below'] === undefined
        ? {}
        : { below: num(issues, record, 'below', `${where}[${i}].below`, 0, 1) }),
    };
  });
}

function validateBurn(
  issues: ValidationIssue[],
  raw: Record<string, unknown> | null,
  where: string,
): BurnBalance {
  if (!raw) {
    issues.push({ field: where, message: 'musí být objekt' });
    return {
      wildfire: false,
      ignitionIntensity: 100,
      intensityGrowth: 1,
      spreadChance: 0,
      minIgnitions: 1,
      maxIgnitions: 1,
    };
  }

  const min = num(issues, raw, 'minIgnitions', `${where}.minIgnitions`, 1, 100);
  const max = num(issues, raw, 'maxIgnitions', `${where}.maxIgnitions`, 1, 100);
  if (max < min) issues.push({ field: `${where}.maxIgnitions`, message: 'nesmí být pod min' });

  return {
    wildfire: raw['wildfire'] === true,
    ignitionIntensity: num(issues, raw, 'ignitionIntensity', `${where}.ignitionIntensity`, 1, 255),
    intensityGrowth: num(issues, raw, 'intensityGrowth', `${where}.intensityGrowth`, 0, 255),
    spreadChance: num(issues, raw, 'spreadChance', `${where}.spreadChance`, 0, 1),
    minIgnitions: min,
    maxIgnitions: max,
  };
}

/**
 * Model ohně.
 *
 * Hořlavost je pravděpodobnost, tedy 0–1. Palivo je počet ohňových tiků do
 * zničení — celé číslo, protože se odečítá po jedné. Kdyby některé chybělo,
 * příslušný obsah dlaždice by tiše nehořel vůbec; proto se kontroluje, že
 * jsou obě tabulky úplné.
 */
function validateFire(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): FireBalance {
  const raw = disasters ? asRecord(disasters['fire']) : null;
  const empty: FireBalance = {
    tickInterval: 2,
    suppressBase: 0,
    suppressPerCoverage: 0,
    pollutionPerTick: 0,
    happinessPerLoss: 0,
    happinessPenaltyTicks: 0,
    flammability: {},
    fuel: {},
    byClass: {},
  };
  if (!raw) {
    if (disasters) issues.push({ field: 'disasters.fire', message: 'chybí, nebo není objekt' });
    return empty;
  }

  const flammability: Record<string, number> = {};
  const fuel: Record<string, number> = {};
  const rawFlammability = asRecord(raw['flammability']);
  const rawFuel = asRecord(raw['fuel']);

  if (!rawFlammability) {
    issues.push({ field: 'disasters.fire.flammability', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawFlammability).sort()) {
      flammability[key] = num(
        issues,
        rawFlammability,
        key,
        `disasters.fire.flammability.${key}`,
        0,
        1,
      );
    }
  }

  if (!rawFuel) {
    issues.push({ field: 'disasters.fire.fuel', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawFuel).sort()) {
      fuel[key] = num(issues, rawFuel, key, `disasters.fire.fuel.${key}`, 1, 1000);
    }
  }

  // Obsah, který má hořlavost, ale ne palivo, by hořel donekonečna.
  for (const key of Object.keys(flammability)) {
    if (fuel[key] === undefined) {
      issues.push({ field: `disasters.fire.fuel.${key}`, message: 'chybí ke stejné hořlavosti' });
    }
  }

  const byClass: Record<string, { flammability: number; fuel: number }> = {};
  const rawByClass = asRecord(raw['byClass']) ?? {};
  for (const key of Object.keys(rawByClass).sort()) {
    const entry = asRecord(rawByClass[key]);
    if (!entry) {
      issues.push({ field: `disasters.fire.byClass.${key}`, message: 'musí být objekt' });
      continue;
    }
    byClass[key] = {
      flammability: num(
        issues,
        entry,
        'flammability',
        `disasters.fire.byClass.${key}.flammability`,
        0,
        1,
      ),
      fuel: num(issues, entry, 'fuel', `disasters.fire.byClass.${key}.fuel`, 1, 1000),
    };
  }

  return {
    tickInterval: num(issues, raw, 'tickInterval', 'disasters.fire.tickInterval', 1, 100),
    suppressBase: num(issues, raw, 'suppressBase', 'disasters.fire.suppressBase', 0, 255),
    suppressPerCoverage: num(
      issues,
      raw,
      'suppressPerCoverage',
      'disasters.fire.suppressPerCoverage',
      0,
      10,
    ),
    pollutionPerTick: num(issues, raw, 'pollutionPerTick', 'disasters.fire.pollutionPerTick', 0, 255),
    happinessPerLoss: num(issues, raw, 'happinessPerLoss', 'disasters.fire.happinessPerLoss', 0, 255),
    happinessPenaltyTicks: num(
      issues,
      raw,
      'happinessPenaltyTicks',
      'disasters.fire.happinessPenaltyTicks',
      0,
      100000,
    ),
    flammability,
    fuel,
    byClass,
  };
}
