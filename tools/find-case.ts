/** Hledá malý terén, na kterém stavba silnice zboří sousední. Jednorázové. */
import { buildRoad } from '@/sim/commands';
import { ROAD } from '@/sim/layers';
import { createWorld } from '@/sim/world';

const SIZE = 64;
const side = SIZE + 1;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

for (let seed = 1; seed < 4000; seed++) {
  const random = rng(seed);
  const bumps: [number, number][] = [];
  for (let i = 0; i < 14; i++) {
    bumps.push([8 + Math.floor(random() * 12), 8 + Math.floor(random() * 12)]);
  }

  const w = createWorld(1, undefined, SIZE);
  for (const [cx, cy] of bumps) {
    const corner = cy * side + cx;
    w.cornerHeight[corner] = (w.cornerHeight[corner] ?? 0) + 1;
  }
  // Kaskádu neřešíme: jde o tvar terénu, ne o to, jak vznikl.

  let lost = 0;
  for (let x = 10; x <= 18; x++) {
    for (const y of [10, 12]) {
      const before = w.roadTiles.size;
      if (!buildRoad(w, x, y, ROAD.street).ok) continue;
      if (w.roadTiles.size !== before + 1) lost++;
    }
  }
  if (lost > 0) {
    process.stdout.write(`seed ${seed}: ztraceno ${lost}\n  bumps ${JSON.stringify(bumps)}\n`);
    break;
  }
}
