import { describe, expect, it } from 'vitest';
import { tickWorld } from '@/sim/world';
import {
  buildTestCity,
  cityFingerprint,
  citySystems,
  loadCityContent,
  reloadWorld,
} from './support/continuation';

/**
 * „Ulož, načti, hraj dál" musí dát **totéž město** jako hra bez přerušení
 * (audit T132, nálezy 1 a 2).
 *
 * Do T132 se načtené město vyvíjelo jinak: kandidáti růstu šli v pořadí,
 * v jakém hráč zónoval, kdežto po načtení v pořadí dlaždic; spokojenost se
 * vracela na neutrál, doprava na nulu a statistiky linek zmizely. Každá z těch
 * věcí sama stačila, aby se po pár měsících rozešly budovy.
 *
 * Ukládá se v tikách, které padají na různé fáze systémů: hned na začátku,
 * uprostřed, den před měsíční uzávěrkou a pozdě.
 */

const TOTAL_TICKS = 1600;
const CHECKPOINTS = [1, 500, 29 + 30 * 30, 1200];

describe('ulož, načti, hraj dál (T132)', () => {
  it(
    'načtené město se vyvíjí stejně jako město bez přerušení',
    { timeout: 300000 },
    async () => {
      const setup = await loadCityContent();

      const straight = buildTestCity(setup);
      const straightSystems = citySystems(setup);
      for (let tick = 1; tick <= TOTAL_TICKS; tick++) tickWorld(straight, straightSystems);
      const expected = cityFingerprint(straight);

      // Kdyby se město nepostavilo, porovnávaly by se dvě prázdné mapy.
      expect(straight.buildings.size).toBeGreaterThan(40);

      for (const at of CHECKPOINTS) {
        let world = buildTestCity(setup);
        let systems = citySystems(setup);
        for (let tick = 1; tick <= at; tick++) tickWorld(world, systems);
        world = reloadWorld(world);
        // Nové systémy, jako po startu hry: nic se nesmí držet v jejich closure.
        systems = citySystems(setup);
        for (let tick = at + 1; tick <= TOTAL_TICKS; tick++) tickWorld(world, systems);

        const got = cityFingerprint(world);
        for (const key of Object.keys(expected)) {
          expect(got[key], `uloženo v tiku ${at}, liší se ${key}`).toEqual(expected[key]);
        }
      }
    },
  );
});
