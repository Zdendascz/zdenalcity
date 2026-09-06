/** Proč nerostou zóny: zeptá se hry její vlastní diagnostikou. */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { growthBlocker } from '@/sim/diagnostics';
import { index, ZONE } from '@/sim/layers';
import { playGame } from './simulate';

const content = new ContentRegistry();
await content.load(createVanillaSource());
const balance = content.getBalance();

const result = playGame(
  content,
  {
    ambition: 'střední',
    services: 'vyvážený',
    zoneMix: 'vyvážený',
    taxes: 'střední',
    finance: 'půjčky',
    transit: 'autobusy',
    funding: 'plné',
  },
  12345,
  20,
);

const world = result.world;
const reasons: Record<string, number> = {};
if (world) {
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const tile = index(x, y, world.size);
      if ((world.layers.zone[tile] ?? ZONE.none) === ZONE.none) continue;
      const why = growthBlocker(world, content, balance, x, y) ?? 'roste nebo stoji';
      reasons[why] = (reasons[why] ?? 0) + 1;
    }
  }
}

const works = content.get('vanilla:water_works');
const say = (label: string, value: unknown): void => {
  process.stdout.write(`${label} ${JSON.stringify(value)}\n`);
};

say('duvody u zon:', reasons);
say('prikazy:', result.commands);
say('odmitnuto:', result.rejected);
say('vodarna cena/pudorys:', [works?.construction.cost, works?.footprint]);
say('konec:', {
  obyvatel: result.final.population,
  budov: result.final.buildings,
  voda: result.final.waterProduced,
  zon: result.final.zonedTiles,
  kasa: result.final.funds,
});
