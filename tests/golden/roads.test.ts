import { describe, expect, it } from 'vitest';
import { hashLayers, index, MAP_SIZE } from '@/sim/layers';
import { createSimHost } from '@/sim/simHost';

/**
 * Golden test silniční sítě.
 *
 * Hash je záměrně neprůhledný, proto je vedle něj i počet dlaždic se silnicí —
 * když se snapshot změní, tenhle údaj napoví, jestli šlo o změnu chování,
 * nebo jen o jiný způsob hashování.
 *
 * Přegenerování: `npm run test:update-golden`. Změna musí být vidět v diffu.
 */
describe('golden: silniční síť', () => {
  it('pevná sekvence příkazů a 500 tiků dá stabilní hash vrstev', () => {
    // Bez systémů: tenhle test hlídá silnice a příkazy, ne růst města.
    const host = createSimHost(483928492, []);

    for (let x = 20; x <= 40; x++) {
      host.dispatch({ type: 'build_road', x, y: 64 });
    }
    for (let y = 50; y <= 80; y++) {
      host.dispatch({ type: 'build_road', x: 30, y });
    }
    for (let i = 0; i < 6; i++) {
      host.dispatch({ type: 'bulldoze', x: 22 + i * 3, y: 64 });
    }

    // Neplatné příkazy musí projít bez efektu, ne spadnout.
    host.dispatch({ type: 'build_road', x: -1, y: 64 });
    host.dispatch({ type: 'build_road', x: 64, y: MAP_SIZE });
    host.dispatch({ type: 'bulldoze', x: 0, y: 0 });

    for (let i = 0; i < 500; i++) {
      host.step(250); // 250 ms při 1× = přesně jeden tik
    }

    const snapshot = host.getSnapshot();
    expect(snapshot.tick).toBe(500);

    let roadTiles = 0;
    for (const value of snapshot.layers.road) {
      if (value === 1) roadTiles++;
    }
    // 21 vodorovných + 31 svislých − 1 průsečík − 6 zbouraných
    expect(roadTiles).toBe(45);
    expect(snapshot.layers.road[index(30, 64)]).toBe(1);

    expect(hashLayers(snapshot.layers)).toMatchSnapshot();
  });
});
