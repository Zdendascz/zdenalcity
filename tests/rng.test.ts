import { describe, expect, it } from 'vitest';
import { Rng } from '@/sim/rng';

/**
 * Stabilita RNG. Změna algoritmu by tiše rozbila všechny existující savy
 * i golden testy, proto je prvních deset hodnot přibité natvrdo.
 */
const FIRST_TEN_FROM_SEED_12345 = [
  0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
  0.5094283693470061, 0.34747186047025025, 0.07375754183158278, 0.7663964673411101,
  0.9968264393974096, 0.8250224851071835,
];

function take(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.next());
}

describe('Rng', () => {
  it('vrací stabilní posloupnost pro daný seed', () => {
    expect(take(new Rng(12345), 10)).toEqual(FIRST_TEN_FROM_SEED_12345);
  });

  it('stejný seed = stejná posloupnost', () => {
    expect(take(new Rng(7), 50)).toEqual(take(new Rng(7), 50));
  });

  it('různé seedy dávají různou posloupnost', () => {
    expect(take(new Rng(7), 50)).not.toEqual(take(new Rng(8), 50));
  });

  it('next() je v <0, 1)', () => {
    const rng = new Rng(999);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() je v <0, maxExclusive)', () => {
    const rng = new Rng(4242);
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it('fromState(getState()) pokračuje identicky — bez toho by save nebyl deterministický', () => {
    const original = new Rng(12345);
    take(original, 10);

    const restored = Rng.fromState(original.getState());

    expect(restored.getState()).toBe(original.getState());
    expect(take(restored, 20)).toEqual(take(original, 20));
  });

  it('seed se normalizuje na uint32', () => {
    expect(new Rng(-1).getState()).toBe(0xffffffff);
    expect(Rng.fromState(-1).getState()).toBe(0xffffffff);
  });
});
