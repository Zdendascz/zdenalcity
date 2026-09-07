/**
 * Rychlý přehled: kolik partií přežije a kdy umírají.
 *
 *   npx vite build --ssr tools/survey.ts --outDir tools/.build --logLevel error
 *   node tools/.build/survey.js [pocet seedu] [let]
 *
 * Slouží k ladění simulovaného hráče. Měření hry dělá `tools/simulate.ts`.
 */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
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

const games = Number(process.argv[2] ?? 10);
const years = Number(process.argv[3] ?? 100);

let alive = 0;
let peakSum = 0;
let finalSum = 0;
for (let seed = 1; seed <= games; seed++) {
  const result = playGame(content, STRATEGY, seed, years);
  let peak = 0;
  let peakYear = 0;
  for (const sample of result.timeline) {
    if (sample.population <= peak) continue;
    peak = sample.population;
    peakYear = sample.year;
  }
  const living = result.final.population > 0 && result.final.funds > 0;
  if (living) alive++;
  peakSum += peak;
  finalSum += result.final.population;
  process.stdout.write(
    `seed ${String(seed).padStart(3)}: vrchol ${String(peak).padStart(5)} v roce ${String(peakYear).padStart(3)}` +
      `, konec ${String(result.final.population).padStart(5)} obyvatel, kasa ${String(Math.round(result.final.funds)).padStart(9)}` +
      `, ${living ? 'ŽIJE' : 'mrtvé'}\n`,
  );
}
process.stdout.write(
  `\nživých ${alive} z ${games} (${Math.round((alive / games) * 100)} %), ` +
    `průměrný vrchol ${Math.round(peakSum / games)}, průměrný konec ${Math.round(finalSum / games)}\n`,
);
