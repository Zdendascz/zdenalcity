import { describe, expect, it } from 'vitest';
import { dustCount, ghostPulse, motionRandom, popScale } from '@/render/effects';

describe('odezva na akce (T114)', () => {
  it('budova vyrůstá od menší výšky a končí přesně v plné velikosti', () => {
    const [, start] = popScale(0);
    expect(start).toBeLessThan(0.7);
    expect(popScale(1)).toEqual([1, 1]);
    // Po konci animace se nesmí nic dít — ani při přetečení času.
    expect(popScale(3)).toEqual([1, 1]);
  });

  it('výška přes plnou velikost překmitne a zase dosedne', () => {
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, popScale(t)[1]);
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.2);
  });

  it('šířka jde proti výšce, ale slaběji', () => {
    const [width, height] = popScale(0);
    expect(width).toBeGreaterThan(1);
    expect(width - 1).toBeLessThan(1 - height);
  });

  it('duch dýchá mezi mezemi', () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const alpha = ghostPulse(ms, 0.45, 0.75);
      expect(alpha).toBeGreaterThanOrEqual(0.45);
      expect(alpha).toBeLessThanOrEqual(0.75);
    }
  });

  it('prachu přibývá s plochou, ale má strop', () => {
    const small = dustCount({ x: 0, y: 0, width: 1, depth: 1, base: 0 });
    const large = dustCount({ x: 0, y: 0, width: 3, depth: 3, base: 0 });
    const huge = dustCount({ x: 0, y: 0, width: 8, depth: 8, base: 0 });
    expect(large).toBeGreaterThan(small);
    expect(huge).toBeLessThanOrEqual(26);
  });

  it('vlastní generátor je stejný pro stejné semínko a leží v 0–1', () => {
    const a = motionRandom(7);
    const b = motionRandom(7);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
