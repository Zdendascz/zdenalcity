/**
 * Mulberry32 se serializovatelným stavem (P2).
 *
 * `getState` / `fromState` jsou nutné, aby byl RNG součástí savu — bez nich by
 * načtená hra pokračovala jinou posloupností než ta uložená a determinismus by
 * platil jen do prvního loadu.
 *
 * Algoritmus se nesmí měnit: změna rozbije všechny existující savy i golden testy.
 * Hlídá to `tests/rng.test.ts` hardcoded snapshotem.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Rovnoměrné číslo v <0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Celé číslo v <0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  getState(): number {
    return this.state;
  }

  static fromState(state: number): Rng {
    const rng = new Rng(0);
    // Statická metoda vidí do privátního stavu vlastní třídy — žádný cast není potřeba.
    rng.state = state >>> 0;
    return rng;
  }
}
