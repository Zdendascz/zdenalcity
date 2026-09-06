/**
 * Měření: **boří stavba silnice sousední silnici?**
 *
 *   npx vite build --ssr tools/probe2.ts --outDir tools/.build --logLevel error
 *   node tools/.build/probe2.js
 *
 * Projede kus generované mapy a na každou volnou dlaždici zkusí položit ulici.
 * Po každé stavbě spočítá, kolik dlaždic sítě ubylo. Ubýt nemá žádná.
 */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildRoad } from '@/sim/commands';
import { ROAD } from '@/sim/layers';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { createWorld } from '@/sim/world';

const content = new ContentRegistry();
await content.load(createVanillaSource());
const balance = content.getBalance();

let built = 0;
let lost = 0;
let events = 0;
for (const seed of [1, 2, 3, 4, 5]) {
  const world = createWorld(seed, balance.economy, 128);
  applyGeneratedMap(world, generateTerrain(seed, balance, world.size));
  world.economy.funds = 100_000_000;

  for (let y = 20; y < 100; y += 2) {
    for (let x = 20; x < 100; x++) {
      const before = world.roadTiles.size;
      if (!buildRoad(world, x, y, ROAD.street, balance).ok) continue;
      built++;
      const after = world.roadTiles.size;
      if (after < before + 1) {
        lost += before + 1 - after;
        events++;
      }
    }
  }
}
process.stdout.write(`postaveno ${built}, ztraceno ${lost} dlazdic v ${events} pripadech\n`);
