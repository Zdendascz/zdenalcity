/** Kdo město stojí nejvíc. Ladicí nástroj k simulovanému hráči. */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { computeBudget } from '@/sim/systems/economy';
import { playGame, type Strategy } from './simulate';

const content = new ContentRegistry();
await content.load(createVanillaSource());
const balance = content.getBalance();

const STRATEGY: Strategy = {
  ambition: 'střední',
  services: 'vyvážený',
  zoneMix: 'vyvážený',
  taxes: 'střední',
  finance: 'půjčky',
  transit: 'autobusy',
  funding: 'plné',
};

const seed = Number(process.argv[2] ?? 10);
playGame(content, STRATEGY, seed, Number(process.argv[3] ?? 12), (world, year) => {
  if (year % 4 !== 0 || year === 0) return;
  const budget = computeBudget(world, content, balance);
  const rows = budget.lines
    .filter((line) => line.upkeep > 0 || line.income > 0)
    .sort((a, b) => b.upkeep - a.upkeep)
    .slice(0, 6)
    .map((l) => `${l.definitionId.replace('vanilla:', '')} ${l.count}× -${l.upkeep}/+${l.income}`);
  process.stdout.write(
    `rok ${year}: prijem ${Math.round(budget.income)} vydaje ${Math.round(budget.expenses)}` +
      `  silnice ${budget.roads.count}× -${budget.roads.upkeep}` +
      `  mhd -${budget.transit.upkeep}  dluh -${budget.debt.payment}\n    ${rows.join('  ')}\n`,
  );
});
