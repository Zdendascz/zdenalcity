import type { ValidationIssue } from './schema';

/**
 * Balanc fáze 2 (§10 zadání). **Žádná z těchhle konstant nesmí být v kódu** —
 * načítá se stejnou cestou jako definice budov, takže je mod smí přepsat.
 *
 * Chybějící sekce je chyba, ne tichý default: kdyby se dala vynechat, hráč by
 * z rozbitého modu dostal město, které se chová jinak, než balanc popisuje.
 */
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
  };

  /** Čte se od T18 (přepis růstu). */
  growth: {
    exponent: number;
    demandPerAttempt: number;
    maxAttempts: number;
    neutralTaxRate: number;
    taxRange: number;
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
  const diffusion = section(issues, root, 'diffusion');
  const landValue = section(issues, root, 'landValue');
  const crime = section(issues, root, 'crime');
  const waste = section(issues, root, 'waste');
  const health = section(issues, root, 'health');
  const levels = section(issues, root, 'levels');
  const growth = section(issues, root, 'growth');

  const weights: Record<string, number> = {};
  const rawWeights = landValue ? asRecord(landValue['weights']) : null;
  if (!rawWeights) {
    issues.push({ field: 'landValue.weights', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawWeights).sort()) {
      weights[key] = num(issues, rawWeights, key, `landValue.weights.${key}`, -10, 10);
    }
    for (const required of ['pollution', 'crime']) {
      if (weights[required] === undefined) {
        issues.push({ field: `landValue.weights.${required}`, message: 'chybí' });
      }
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
    },
    growth: {
      exponent: num(issues, growth, 'exponent', 'growth.exponent', 0, 10),
      demandPerAttempt: num(issues, growth, 'demandPerAttempt', 'growth.demandPerAttempt', 1, 1000),
      maxAttempts: num(issues, growth, 'maxAttempts', 'growth.maxAttempts', 1, 1000),
      neutralTaxRate: num(issues, growth, 'neutralTaxRate', 'growth.neutralTaxRate', 0, 100),
      taxRange: num(issues, growth, 'taxRange', 'growth.taxRange', 1, 100),
    },
  };

  return { balance: issues.length > 0 ? null : balance, issues };
}
