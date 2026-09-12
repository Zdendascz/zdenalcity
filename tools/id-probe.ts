/**
 * Jak rychle roste `nextBuildingId` proti počtu budov, které ve městě stojí.
 *
 *   npx vite build --ssr tools/id-probe.ts --outDir tools/.build --logLevel error
 *   node tools/.build/id-probe.js --years 100 --seed 12345 --ambition velké
 *
 * Id budovy se po zbourání nevrací, takže `nextBuildingId − 1` je počet budov,
 * které ve městě **kdy** vznikly — každá přestavba po katastrofě, každý zbořený
 * opuštěný dům a každá parcela, na které to vyrostlo znovu. Povýšení úrovně id
 * nespotřebuje: entita zůstává, jen dostane jinou definici (`levels.ts`).
 *
 * Nástroj vznikl kvůli stropu dvoubajtové vrstvy `buildingId` (65 535, do verze
 * savu 11). Hráč musí sáhnout na město stejně jako člověk, takže se měří
 * simulovaným hráčem z `simulate.ts`, ne umělým bouráním.
 */
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { playGame, type Strategy } from './simulate';

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const years = Number(arg('years', '100'));
const seed = Number(arg('seed', '12345'));
const ambition = arg('ambition', 'velké') as Strategy['ambition'];

const content = new ContentRegistry();
await content.load(createVanillaSource());

const strategy: Strategy = {
  ambition,
  services: 'vyvážený',
  zoneMix: 'vyvážený',
  taxes: 'střední',
  finance: 'půjčky',
  transit: 'autobusy',
  funding: 'plné',
};

interface Row {
  year: number;
  living: number;
  allocated: number;
}

const rows: Row[] = [];
const result = playGame(content, strategy, seed, years, (world, year) => {
  rows.push({ year, living: world.buildings.size, allocated: world.nextBuildingId - 1 });
});
const end = result.world;
if (!end) throw new Error('playGame nevrátil svět');
rows.push({ year: years, living: end.buildings.size, allocated: end.nextBuildingId - 1 });

const OLD_CEILING = 0xffff;
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

out(`seed ${seed}, ambice ${ambition}, ${years} let, ${result.seconds} s`);
out('rok  stojí  vzniklo  vzniklo/stojí  nových za 10 let');
let previous: Row | undefined;
for (const row of rows) {
  if (row.year % 10 !== 0) continue;
  const ratio = row.living === 0 ? '—' : (row.allocated / row.living).toFixed(2);
  const recent = previous ? row.allocated - previous.allocated : row.allocated;
  out(
    `${String(row.year).padStart(3)}  ${String(row.living).padStart(5)}  ` +
      `${String(row.allocated).padStart(7)}  ${ratio.padStart(13)}  ${String(recent).padStart(16)}`,
  );
  previous = row;
}

// Tempo z posledních dvaceti let: začátek partie je výstavba na zelené louce
// a o tom, jestli město někdy narazí na strop, rozhoduje ustálené tempo.
const last = rows[rows.length - 1] ?? { year: 0, living: 0, allocated: 0 };
const from = rows.find((row) => row.year === Math.max(0, years - 20)) ?? rows[0] ?? last;
const span = Math.max(1, last.year - from.year);
const perYear = (last.allocated - from.allocated) / span;
const peak = Math.max(...rows.map((row) => row.living));
const yearsToCeiling =
  perYear > 0 ? Math.round((OLD_CEILING - last.allocated) / perYear) : Number.POSITIVE_INFINITY;

out(
  `\nšpička stojících ${peak}, vzniklo celkem ${last.allocated}, ` +
    `tempo posledních ${span} let ${perYear.toFixed(1)} za rok, ` +
    `k 65 535 by zbývalo ${yearsToCeiling} let`,
);
out(
  JSON.stringify({
    seed,
    ambition,
    years,
    peak,
    living: last.living,
    allocated: last.allocated,
    perYear: Math.round(perYear * 10) / 10,
    yearsToCeiling,
    disasters: result.disasters,
  }),
);
