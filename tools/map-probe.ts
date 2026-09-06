/** Má hráč kam postavit vodárnu? Ladicí nástroj. */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { index, TERRAIN } from '@/sim/layers';
import { applyGeneratedMap, generateTerrain } from '@/sim/mapgen';
import { createWorld } from '@/sim/world';

const content = new ContentRegistry();
await content.load(createVanillaSource());
const balance = content.getBalance();

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12345]) {
  const world = createWorld(seed, balance.economy);
  applyGeneratedMap(world, generateTerrain(seed, balance, world.size));
  const size = world.size;
  const half = Math.round(size / 2);

  let water = 0;
  let nearest = Number.POSITIVE_INFINITY;
  let spots3 = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (world.layers.terrain[index(x, y, size)] !== TERRAIN.water) continue;
      water++;
      nearest = Math.min(nearest, Math.max(Math.abs(x - half), Math.abs(y - half)));
    }
  }
  // Kolik míst 3×3 na souši se dotýká vody v okruhu 40 od středu.
  for (let dy = -40; dy <= 40; dy++) {
    for (let dx = -40; dx <= 40; dx++) {
      const x = half + dx;
      const y = half + dy;
      let land = true;
      for (let oy = 0; oy < 3 && land; oy++) {
        for (let ox = 0; ox < 3 && land; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          land =
            tx >= 0 &&
            ty >= 0 &&
            tx < size &&
            ty < size &&
            world.layers.terrain[index(tx, ty, size)] !== TERRAIN.water;
        }
      }
      if (!land) continue;
      let touches = false;
      for (let oy = -1; oy <= 3 && !touches; oy++) {
        for (let ox = -1; ox <= 3 && !touches; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
          if (world.layers.terrain[index(tx, ty, size)] === TERRAIN.water) touches = true;
        }
      }
      if (touches) spots3++;
    }
  }
  // Terén přesně ve středu: je tam vůbec souš?
  const middle = world.layers.terrain[index(half, half, size)] ?? 0;
  process.stdout.write(
    `seed ${String(seed).padStart(5)}: vody ${String(water).padStart(5)} dlazdic, ` +
      `nejblizsi ${nearest === Infinity ? '-' : nearest}, mist pro vodarnu do 40: ${spots3}, ` +
      `stred je ${middle === TERRAIN.water ? 'VODA' : 'souš'}\n`,
  );
}
