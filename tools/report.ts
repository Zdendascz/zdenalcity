/**
 * Vyhodnocení nasimulovaných partií.
 *
 *   npx vite build --ssr tools/report.ts --outDir tools/.build --logLevel error
 *   node tools/.build/report.js data/sim500
 *
 * Čte všechny `games-*.jsonl` ve složce a shrnuje je: kolik měst přežilo, jak
 * velká byla a co v tom hraje roli. **Po osách strategie**, protože právě to je
 * otázka: mění se hra podle toho, jak k ní hráč přistoupí?
 *
 * Osa se hodnotí tak, že se přes ni průměruje všechno ostatní. Není to izolace
 * jedné proměnné — na to je vzorek malý — ale ukazuje to, kde vůbec má cenu
 * hledat.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Row {
  strategy: Record<string, string>;
  seed: number;
  years: number;
  timeline: { year: number; population: number; funds: number }[];
  final: {
    population: number;
    funds: number;
    buildings: number;
    abandoned: number;
    happiness: number;
    zonedTiles: number;
    debt: number;
    lines: number;
    stops: number;
    riders: number;
    fares: number;
    grants: number;
  };
  disasters: Record<string, number>;
  rejected: Record<string, number>;
  seconds: number;
}

const dir = resolve(process.argv[2] ?? 'data/sim');
const rows: Row[] = [];
for (const name of readdirSync(dir)) {
  if (!name.startsWith('games-') || !name.endsWith('.jsonl')) continue;
  for (const line of readFileSync(resolve(dir, name), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    rows.push(JSON.parse(line) as Row);
  }
}

if (rows.length === 0) {
  process.stdout.write(`Ve složce ${dir} nejsou žádné partie.\n`);
  process.exit(0);
}

/** Město se počítá za živé, když v něm někdo bydlí a není v mínusu. */
const alive = (row: Row): boolean => row.final.population > 0 && row.final.funds > 0;
const peak = (row: Row): number =>
  row.timeline.reduce((best, sample) => Math.max(best, sample.population), 0);

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
};
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

const pad = (text: string, width: number): string => text.padEnd(width);
const num = (value: number, width: number): string => String(value).padStart(width);

process.stdout.write(`Partií: ${rows.length}, každá ${rows[0]?.years ?? 0} let\n`);
process.stdout.write(
  `Živých měst: ${rows.filter(alive).length} (${Math.round((rows.filter(alive).length / rows.length) * 100)} %)\n`,
);
process.stdout.write(
  `Obyvatel na konci: medián ${median(rows.map((r) => r.final.population))}, ` +
    `průměr ${mean(rows.map((r) => r.final.population))}, ` +
    `nejlepší ${Math.max(...rows.map((r) => r.final.population))}\n`,
);
process.stdout.write(
  `Vrchol partie: medián ${median(rows.map(peak))}, průměr ${mean(rows.map(peak))}\n`,
);
process.stdout.write(
  `Kasa na konci: medián ${median(rows.map((r) => Math.round(r.final.funds)))}\n`,
);
process.stdout.write(
  `Čas: ${mean(rows.map((r) => r.seconds))} s na partii, dohromady ` +
    `${Math.round(rows.reduce((a, r) => a + r.seconds, 0) / 60)} minut strojového času\n\n`,
);

// --- po osách strategie ----------------------------------------------------

const axes = Object.keys(rows[0]?.strategy ?? {});
for (const axis of axes) {
  const values = [...new Set(rows.map((row) => row.strategy[axis] ?? '?'))].sort();
  process.stdout.write(`${axis}:\n`);
  for (const value of values) {
    const group = rows.filter((row) => row.strategy[axis] === value);
    const living = group.filter(alive).length;
    process.stdout.write(
      `  ${pad(value, 12)} partií ${num(group.length, 4)}` +
        `  živých ${num(Math.round((living / group.length) * 100), 3)} %` +
        `  vrchol ${num(median(group.map(peak)), 5)}` +
        `  konec ${num(median(group.map((r) => r.final.population)), 5)}` +
        `  kasa ${num(median(group.map((r) => Math.round(r.final.funds))), 9)}` +
        `  spokojenost ${num(median(group.map((r) => r.final.happiness)), 4)}\n`,
    );
  }
  process.stdout.write('\n');
}

// --- mechaniky, které se v ose neprojeví -----------------------------------

const usedTransit = rows.filter((row) => row.final.stops > 0);
process.stdout.write(
  `MHD: linku mělo ${usedTransit.length} partií z ${rows.length}` +
    `, medián zastávek ${median(usedTransit.map((r) => r.final.stops))}` +
    `, odvezených ${median(usedTransit.map((r) => r.final.riders))} za měsíc` +
    `, jízdné ${median(usedTransit.map((r) => r.final.fares))}
`,
);
process.stdout.write(
  `Granty: medián ${median(rows.map((r) => r.final.grants))}` +
    `, dluh na konci: medián ${median(rows.map((r) => r.final.debt))}

`,
);

// --- pohromy a odmítnuté příkazy -------------------------------------------

const totals: Record<string, number> = {};
for (const row of rows) {
  for (const [kind, count] of Object.entries(row.disasters)) {
    totals[kind] = (totals[kind] ?? 0) + count;
  }
}
process.stdout.write('Pohromy na partii (průměr):\n');
for (const [kind, count] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`  ${pad(kind, 20)} ${(count / rows.length).toFixed(1)}\n`);
}

const refused: Record<string, number> = {};
for (const row of rows) {
  for (const [reason, count] of Object.entries(row.rejected)) {
    refused[reason] = (refused[reason] ?? 0) + count;
  }
}
process.stdout.write('\nOdmítnuté příkazy na partii (průměr, prvních osm):\n');
for (const [reason, count] of Object.entries(refused)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)) {
  process.stdout.write(`  ${pad(reason, 28)} ${(count / rows.length).toFixed(0)}\n`);
}
