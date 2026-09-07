/** Jak vypadají hrubé vrstvy: znečištění, kriminalita, cena půdy. */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { COARSE_FACTOR, coarseSizeOf } from '@/sim/coarse';
import { playGame, type Strategy } from './simulate';
import type { WorldState } from '@/sim/world';

const content = new ContentRegistry();
await content.load(createVanillaSource());

const STRATEGY: Strategy = {
  ambition: 'střední',
  services: 'vyvážený',
  zoneMix: 'vyvážený',
  taxes: 'střední',
  finance: 'půjčky',
  transit: 'autobusy',
  funding: 'plné',
};

function stats(world: WorldState, values: Uint8Array, cells: Set<number>): string {
  let all = 0;
  let inside = 0;
  let peak = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    all += v;
    if (v > peak) peak = v;
    if (cells.has(i)) inside += v;
  }
  return `celá mapa ${Math.round(all / values.length)}, město ${
    cells.size === 0 ? 0 : Math.round(inside / cells.size)
  }, vrchol ${peak}`;
}

playGame(content, STRATEGY, Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 30), (world, year) => {
  if (year % 10 !== 0 || year === 0) return;
  const coarse = coarseSizeOf(world.size);
  const cells = new Set<number>();
  for (const b of world.buildings.values()) {
    cells.add(Math.floor(b.y / COARSE_FACTOR) * coarse + Math.floor(b.x / COARSE_FACTOR));
  }
  let pop = 0;
  let waste = 0;
  let sewage = 0;
  for (const b of world.buildings.values()) {
    if (b.abandoned) continue;
    pop += b.population;
    const def = content.get(b.definitionId);
    waste += def?.waste?.capacity ?? 0;
    sewage += def?.sewage?.capacity ?? 0;
  }
  const bal = content.getBalance();
  process.stdout.write(
    `rok ${year} (${world.buildings.size} budov, ${cells.size} buněk, ${pop} obyvatel)
` +
      `  odpad ${waste}/${Math.round(pop * bal.waste.perCitizen)}  kanalizace ${sewage}/${Math.round(pop * bal.sewage.perCitizen)}
` +
      `  znečištění: ${stats(world, world.coarse.pollution, cells)}\n` +
      `  kriminalita: ${stats(world, world.coarse.crime, cells)}\n` +
      `  cena půdy:  ${stats(world, world.coarse.landValue, cells)}\n`,
  );
});
