/** Jak je město opravdu pokryté službami. Ladicí nástroj k hráči. */
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

/** Buňky, ve kterých město opravdu stojí. */
function builtCells(world: WorldState): number[] {
  const coarse = coarseSizeOf(world.size);
  const seen = new Set<number>();
  for (const b of world.buildings.values()) {
    seen.add(Math.floor(b.y / COARSE_FACTOR) * coarse + Math.floor(b.x / COARSE_FACTOR));
  }
  return [...seen];
}

playGame(content, STRATEGY, Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 40), (world, year) => {
  if (year % 10 !== 0) return;
  const cells = builtCells(world);
  const parts: string[] = [];
  for (const [name, values] of world.coverage) {
    let sum = 0;
    for (const cell of cells) sum += values[cell] ?? 0;
    parts.push(`${name.slice(0, 4)}:${cells.length === 0 ? 0 : Math.round(sum / cells.length)}`);
  }
  const services = [...world.buildings.values()].filter(
    (b) => content.get(b.definitionId)?.service !== undefined,
  ).length;
  process.stdout.write(
    `rok ${String(year).padStart(3)}  budov ${String(world.buildings.size).padStart(4)}` +
      `  z toho sluzeb ${String(services).padStart(3)}  bunek ${String(cells.length).padStart(4)}` +
      `  pokryti ${parts.join(' ')}\n`,
  );
});
