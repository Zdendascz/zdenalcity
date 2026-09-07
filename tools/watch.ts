/**
 * Jedna partie krok za krokem, a po každém roce otázka: co brání růstu?
 *
 *   npx vite build --ssr tools/watch.ts --outDir tools/.build --logLevel error
 *   node tools/.build/watch.js
 *
 * Ptá se **hry, ne mě**: `growthBlocker` je tatáž diagnostika, kterou vidí hráč
 * v rozboru parcely. Když městu něco chybí, řekne to sama a nemusím to hádat.
 *
 * Slouží k ladění simulovaného hráče, ne k měření hry. Jakmile město poroste
 * spolehlivě, přebírá práci `tools/simulate.ts`.
 */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { growthBlocker } from '@/sim/diagnostics';
import { lineProblems } from '@/sim/transit';
import { index, ZONE } from '@/sim/layers';
import { playGame, type Strategy } from './simulate';
import type { WorldState } from '@/sim/world';

const content = new ContentRegistry();
await content.load(createVanillaSource());
const balance = content.getBalance();

/** Průměr pole. */
function mean(values: Uint8Array | undefined): number {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Co brání růstu na vyznačených parcelách, seřazené podle četnosti. */
function blockers(world: WorldState): string {
  const counts: Record<string, number> = {};
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const tile = index(x, y, world.size);
      if ((world.layers.zone[tile] ?? ZONE.none) === ZONE.none) continue;
      const why = growthBlocker(world, content, balance, x, y) ?? 'v pořádku';
      counts[why] = (counts[why] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([why, count]) => `${why.replace(/^(ui\.parcel\.blocked|error)\./, '')}×${count}`)
    .join(' ');
}

const STRATEGY: Strategy = {
  ambition: 'střední',
  services: 'vyvážený',
  zoneMix: 'vyvážený',
  taxes: 'střední',
  finance: 'půjčky',
  transit: 'autobusy',
  funding: 'plné',
};

const YEARS = Number(process.argv[3] ?? 40);
const seeds = process.argv.includes('--seeds')
  ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  : [Number(process.argv[2] ?? 12345)];

for (const seed of seeds) {
  const result = playGame(content, STRATEGY, seed, seeds.length > 1 ? 100 : YEARS, (world, year) => {
    if (seeds.length > 1) return;
    if (year % 5 !== 0) return;
    const f = {
      obyv: 0,
      budov: world.buildings.size,
      kasa: Math.round(world.economy.funds),
    };
    let voda = 0;
    let vodaren = 0;
    let opustenych = 0;
    for (const b of world.buildings.values()) {
      f.obyv += b.population;
      if (b.abandoned) opustenych++;
      const d = content.get(b.definitionId);
      if ((d?.water?.production ?? 0) > 0) {
        vodaren++;
        if (!b.abandoned) voda += d?.water?.production ?? 0;
      }
    }
    process.stdout.write(
      `  rok ${String(year).padStart(3)}  obyv ${String(f.obyv).padStart(5)}` +
        `  budov ${String(f.budov).padStart(4)}  kasa ${String(f.kasa).padStart(9)}` +
        `  prijem ${String(Math.round(world.economy.lastIncome)).padStart(6)}` +
        `  vydaje ${String(Math.round(world.economy.lastExpenses)).padStart(6)}` +
        `  napajeno ${String([...world.buildings.values()].filter((b) => b.powered).length).padStart(4)}` +
        `  dane ${world.economy.taxRates.residential}%` +
        `  voda ${voda}/${vodaren}` +
        `  linky ${world.lines.length}/${world.lines.reduce((n, l) => n + l.stops.length, 0)}` +
        `  MHD ${world.lines
          .map(
            (l) =>
              `${l.stops.length}z/${l.vehicles}v/${lineProblems(world, content, balance, l).join('+') || 'ok'}` +
              (lineProblems(world, content, balance, l).includes('notAStop')
                ? `[${l.stops
                    .map((id) => {
                      const b = world.buildings.get(id);
                      return b ? (b.definitionId.replace('vanilla:', '') + (b.abandoned ? '!' : '')) : 'chybí';
                    })
                    .join(',')}]`
                : ''),
          )
          .join(' ') || '-'}` +
        `  opust ${opustenych}` +
        `  spokoj ${Math.round(mean(world.happiness))}` +
        `  sluzby ${[...world.coverage.entries()]
          .map(([k, v]) => `${k.slice(0, 3)}:${Math.round(mean(v))}`)
          .join(' ')}` +
        `  ${blockers(world)}\n`,
    );
  });

  const top = (rec: Record<string, number>): string =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k.replace(/^error\./, '')}×${v}`)
      .join(' ');
  process.stdout.write(`  prikazy: ${top(result.commands)}
`);
  process.stdout.write(`  odmitnuto: ${top(result.rejected)}
`);
  process.stdout.write(`  pohromy: ${top(result.disasters)}
`);
  process.stdout.write(`  odmitnuto podle prikazu: ${top(result.rejectedBy)}
`);

  const f = result.final;
  process.stdout.write(
    `seed ${seed}: obyvatel ${f.population}, budov ${f.buildings}, kasa ${f.funds}, ` +
      `voda ${f.waterProduced}, proud ${f.powerProduced}, zón ${f.zonedTiles}\n`,
  );
}
