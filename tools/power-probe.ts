/** Proč nic nesvítí. Ladicí nástroj k simulovanému hráči. */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { index } from '@/sim/layers';
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

playGame(content, STRATEGY, 12345, 12, (world, year) => {
  if (year % 4 !== 0) return;
  let plants = 0;
  let plantsOnGrid = 0;
  let powered = 0;
  const lines: string[] = [];
  for (const [id, b] of world.buildings) {
    const d = content.get(b.definitionId);
    if (b.powered) powered++;
    if ((d?.power?.production ?? 0) <= 0) continue;
    plants++;
    const tile = index(b.x, b.y, world.size);
    const onGrid = (world.layers.power[tile] ?? 0) === 1;
    if (onGrid) plantsOnGrid++;
    if (lines.length < 4) {
      lines.push(
        `${b.definitionId}@${b.x},${b.y} sit=${onGrid ? 'ano' : 'NE'} ` +
          `napajena=${b.powered ? 'ano' : 'NE'} offline=${world.disasters.offlinePlants.has(id)}`,
      );
    }
  }
  let poweredTiles = 0;
  for (const v of world.layers.power) if (v === 1) poweredTiles++;
  process.stdout.write(
    `rok ${year}: budov ${world.buildings.size} napajeno ${powered} ` +
      `elektraren ${plants} (na siti ${plantsOnGrid}) dlazdic pod proudem ${poweredTiles} ` +
      `silnic ${world.roadTiles.size} offline ${world.disasters.offlinePlants.size}\n`,
  );
  for (const l of lines) process.stdout.write(`    ${l}\n`);
});
