import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { fundingCost, fundingEffect } from '@/sim/funding';
import type { Balance } from '@/content/balance';

/**
 * Nadfinancování služeb (T113).
 *
 * Zadání autora je **dané poměry**, ne vzorcem: „financování ze 100 % na
 * 110 % má být 2× dražší než z 90 % na 100 % a ze 190 % na 200 % 20× dražší
 * než z 90 % na 100 %. Efekt bude nad 100 % poloviční, tedy při financování
 * na 110 % bude efekt jen 105 %, při 200 % financování 150 %."
 *
 * Testuje se přesně těch pět čísel. Vzorec se smí přepsat, poměry ne.
 */

async function balance(): Promise<Balance> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content.getBalance();
}

describe('financování služeb', () => {
  it('do sta procent se platí lineárně', async () => {
    const rules = await balance();
    expect(fundingCost(rules, 0)).toBe(0);
    expect(fundingCost(rules, 0.6)).toBeCloseTo(0.6, 10);
    expect(fundingCost(rules, 1)).toBeCloseTo(1, 10);
  });

  it('krok nad stem je dvakrát dražší, desátý dvacetkrát', async () => {
    const rules = await balance();
    const under = fundingCost(rules, 1) - fundingCost(rules, 0.9);
    const first = fundingCost(rules, 1.1) - fundingCost(rules, 1);
    const tenth = fundingCost(rules, 2) - fundingCost(rules, 1.9);

    expect(first / under).toBeCloseTo(2, 6);
    expect(tenth / under).toBeCloseTo(20, 6);
  });

  it('dvojnásobný rozpočet stojí dvanáctinásobek údržby', async () => {
    // Není to překvapení, je to důsledek těch poměrů — a stojí za to mít ho
    // napsané číslem, protože právě tohle hráč uvidí na účtu.
    const rules = await balance();
    expect(fundingCost(rules, 2)).toBeCloseTo(12, 6);
  });

  it('účinek roste nad stem poloviční rychlostí', async () => {
    const rules = await balance();
    expect(fundingEffect(rules, 0.6)).toBeCloseTo(0.6, 10);
    expect(fundingEffect(rules, 1)).toBeCloseTo(1, 10);
    expect(fundingEffect(rules, 1.1)).toBeCloseTo(1.05, 10);
    expect(fundingEffect(rules, 2)).toBeCloseTo(1.5, 10);
  });

  it('nadfinancování se vyplatí míň, než stojí — a to je ten smysl', async () => {
    // Kdyby účinek rostl rychleji než cena, byl by posuvník jen daň z lenosti:
    // kdo má peníze, přetáhne ho doprava a služby řešit nemusí.
    const rules = await balance();
    for (const level of [1.1, 1.25, 1.5, 1.75, 2]) {
      expect(fundingCost(rules, level)).toBeGreaterThan(fundingEffect(rules, level));
    }
  });
});
