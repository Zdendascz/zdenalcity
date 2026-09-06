/** Kam došla voda a kam potrubí. Ladicí nástroj k simulovanému hráči. */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { index, ZONE } from '@/sim/layers';
import { playGame, type Strategy } from './simulate';

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

const SEED = Number(process.argv[2] ?? 12345);
playGame(content, STRATEGY, SEED, Number(process.argv[3] ?? 20), (world, year) => {
  if (year % 5 !== 0) return;
  let works = 0;
  let pumps = 0;
  let waterProd = 0;
  for (const b of world.buildings.values()) {
    const d = content.get(b.definitionId);
    if ((d?.water?.production ?? 0) > 0) {
      works++;
      if (!b.abandoned) waterProd += d?.water?.production ?? 0;
    } else if ((d?.water?.range ?? 0) > 0) pumps++;
  }
  let zoned = 0;
  let zonedPiped = 0;
  let zonedWatered = 0;
  let pipes = 0;
  let watered = 0;
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const tile = index(x, y, world.size);
      const pipe = (world.layers.pipe[tile] ?? 0) !== 0;
      const water = (world.waterSupply[tile] ?? 0) !== 0;
      if (pipe) pipes++;
      if (water) watered++;
      if ((world.layers.zone[tile] ?? ZONE.none) === ZONE.none) continue;
      zoned++;
      if (pipe) zonedPiped++;
      if (water) zonedWatered++;
    }
  }
  process.stdout.write(
    `rok ${String(year).padStart(3)}  zon ${zoned} (s trubkou ${zonedPiped}, s vodou ${zonedWatered})` +
      `  trubek ${pipes}  dlazdic s vodou ${watered}  silnic ${world.roadTiles.size}` +
      `  kasa ${Math.round(world.economy.funds)}\n`,
  );
});
