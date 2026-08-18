import { describe, expect, it } from 'vitest';
import { validateBalance } from '@/content/balance';
import type { Balance } from '@/content/balance';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry, ContentValidationError } from '@/content/registry';
import type { ContentSource } from '@/content/registry';
import { coarseIndex } from '@/sim/coarse';
import { index, TERRAIN } from '@/sim/layers';
import { createLandValueSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

const MANIFEST = {
  id: 'testmod',
  name: 'Test Mod',
  version: '1.0.0',
  gameVersion: '>=0.1.0',
  dependencies: [],
};

function sourceWith(balance: unknown): ContentSource {
  return { label: 'test', manifest: MANIFEST, definitions: [], locales: {}, balance };
}

/** Hluboká kopie vanilla balancu, aby se testy navzájem neovlivňovaly. */
function copyOfVanilla(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(VANILLA_BALANCE)) as Record<string, unknown>;
}

describe('vanilla balance.json', () => {
  it('se načte a nese hodnoty ze zadání', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const balance = content.getBalance();
    expect(balance.diffusion).toEqual({ spread: 0.4, decay: 0.94, passes: 2 });
    expect(balance.landValue.base).toBe(40);
    expect(balance.landValue.weights['pollution']).toBe(0.8);
    expect(balance.crime.police).toBe(0.9);
    expect(balance.levels.thresholds).toEqual([0, 0, 90, 130, 170, 210]);
    expect(balance.growth.maxAttempts).toBe(12);
  });

  it('nese i váhy tříd služeb, které jsou obsah', () => {
    for (const serviceClass of ['police', 'fire', 'health', 'education', 'parks']) {
      expect(VANILLA_BALANCE.landValue.weights[serviceClass], serviceClass).toBeGreaterThan(0);
    }
  });
});

describe('validace balancu', () => {
  it('chybějící sekce je chyba, ne tichý default', async () => {
    const broken = copyOfVanilla();
    delete broken['crime'];

    await expect(new ContentRegistry().load(sourceWith(broken))).rejects.toThrow(/crime/);
  });

  it('hodnota mimo rozsah je chyba s uvedením pole', () => {
    const broken = copyOfVanilla();
    (broken['diffusion'] as Record<string, unknown>)['decay'] = 5;

    const { balance, issues } = validateBalance(broken);

    expect(balance).toBeNull();
    expect(issues).toContainEqual({
      field: 'diffusion.decay',
      message: 'musí být číslo v rozsahu 0–1',
    });
  });

  it('váhy musí obsahovat znečištění i kriminalitu', () => {
    const broken = copyOfVanilla();
    const landValue = broken['landValue'] as Record<string, unknown>;
    const weights = { ...(landValue['weights'] as Record<string, number>) };
    delete weights['crime'];
    landValue['weights'] = weights;

    const { issues } = validateBalance(broken);
    expect(issues).toContainEqual({ field: 'landValue.weights.crime', message: 'chybí' });
  });

  it('prahy úrovní musí být neprázdné pole celých čísel', () => {
    const broken = copyOfVanilla();
    (broken['levels'] as Record<string, unknown>)['thresholds'] = [0, 'devadesát'];

    const { issues } = validateBalance(broken);
    expect(issues).toContainEqual({
      field: 'levels.thresholds[1]',
      message: 'musí být celé číslo 0–255',
    });
  });

  it('bez balancu registr rovnou řekne, že chybí', async () => {
    const content = new ContentRegistry();
    await content.load({ label: 'test', manifest: MANIFEST, definitions: [], locales: {} });

    expect(() => content.getBalance()).toThrow(ContentValidationError);
    expect(() => content.getBalance()).toThrow(/balance\.json/);
  });
});

describe('mod smí balanc přepsat', () => {
  it('pozdější zdroj s balancem vyhraje', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    expect(content.getBalance().landValue.base).toBe(40);

    const tweaked = copyOfVanilla();
    (tweaked['landValue'] as Record<string, unknown>)['base'] = 90;
    await content.load(sourceWith(tweaked));

    expect(content.getBalance().landValue.base).toBe(90);
  });

  it('zdroj bez balancu ten stávající nesmaže', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    await content.load({ label: 'test', manifest: MANIFEST, definitions: [], locales: {} });

    expect(content.getBalance().landValue.base).toBe(40);
  });
});

describe('balanc opravdu řídí simulaci', () => {
  /** Cena půdy po ustálení u vody a ve vnitrozemí. */
  function settle(balance: Balance): { uVody: number; vnitrozemi: number } {
    const world = createWorld(1);
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        world.layers.terrain[index(40 + dx, 40 + dy)] = TERRAIN.water;
      }
    }

    const system = createLandValueSystem(balance);
    for (let tick = 0; tick < 60 * 16 + 5; tick++) tickWorld(world, [system]);

    return {
      uVody: world.coarse.landValue[coarseIndex(40, 40)] ?? 0,
      vnitrozemi: world.coarse.landValue[coarseIndex(100, 100)] ?? 0,
    };
  }

  it('změna základu i bonusu vody se propíše do výsledku', () => {
    const vanilla = settle(VANILLA_BALANCE);
    expect(vanilla).toEqual({ uVody: 65, vnitrozemi: 40 });

    const tweaked: Balance = {
      ...VANILLA_BALANCE,
      landValue: { ...VANILLA_BALANCE.landValue, base: 100, waterBonus: 50 },
    };

    // Kdyby konstanty zůstaly v kódu, tenhle test by vrátil pořád 65 a 40.
    expect(settle(tweaked)).toEqual({ uVody: 150, vnitrozemi: 100 });
  });
});
