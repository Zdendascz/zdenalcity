import { coarseIndex } from '../coarse';
import { index } from '../layers';
import type { WorldState } from '../world';
import { noLosses, reportLosses } from './damage';
import { destroyTile } from './damage';
import {
  CITY_WIDE,
  crimeFloor,
  happinessPenalty,
  landValuePenalty,
  suppressService,
  taxLoss
} from './effects';
import type { Disaster, DisasterContext } from './registry';
import { setClock } from './state';
import type { ActiveDisaster } from './state';
import {
  areaCoverage,
  areaEmployment,
  areaHappiness,
  cellsAround,
  densityOfCell,
  drain,
  happinessChange,
  pickWeighted,
  populationPerCell,
  remainingOf,
  workPerCell,
} from './unrest';

/**
 * Válka gangů (katalog 9).
 *
 * Nejdelší katastrofa v seznamu a jediná, které se hráč **nezbaví penězi**.
 * `crimeFloor` drží kriminalitu nad hodnotou bez ohledu na to, kolik policie
 * do čtvrti nasype — policie zkracuje trvání, nesráží číslo.
 *
 * Bez zásahu ubývá 0,3 za tik, tedy přes třináct měsíců. S plným pokrytím
 * a rostoucí spokojeností až 2,5 za tik, necelé dva měsíce. **Hráč, který nic
 * neudělá, se toho prakticky nezbaví** — a to je celý smysl: je to jediná
 * pohroma, která trestá dlouhodobé zanedbání, ne jeden špatný tik.
 *
 * Skutečná škoda nejsou ty dvě až čtyři zbořené budovy. Je to **degradace**:
 * šest měsíců potlačeného vzdělání a spokojenosti znamená pokles o úroveň
 * a část čtvrti opuštěnou. Účet přijde až rok poté.
 */

export function createGangWarDisaster(): Disaster {
  return {
    kind: 'gangWar',
    pickOrigin: (world) => pickWorstDistrict(world),
    start: (context, active) => begin(context, active),
    tick: (context, active) => advance(context, active),
    isFinished: (_world, active) => remainingOf(active) <= 0,
    cooldownFromEnd: true,
  };
}

function begin(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const war = balance.disasters.gangWar;

  const duration = war.durationMin + world.rng.int(war.durationMax - war.durationMin + 1);
  const radius = war.radiusMin + world.rng.int(war.radiusMax - war.radiusMin + 1);

  setClock(active, duration);
  active.state['radius'] = radius;
  active.state['destroyed'] = 0;

  applyGrip(context, active, duration);

  // Až po `applyGrip`, protože teprve ten zná buňky oblasti. Nula by znamenala,
  // že první tik uvidí skok o celou spokojenost čtvrti jako „hráč zabral"
  // a válka by skončila dřív, než začala.
  active.state['happinessBefore'] = areaHappiness(
    world,
    (active.state['cells'] as number[] | undefined) ?? [],
  );
}

/**
 * Zavede postihy na oblast dané poloměrem.
 *
 * Volá se znovu při každém rozšíření: staré postihy doběhnou samy a nové platí
 * na větší území. Přepisovat je nejde — jsou to záznamy s odpočtem, ne stav.
 */
function applyGrip(context: DisasterContext, active: ActiveDisaster, duration: number): void {
  const { world, balance } = context;
  const war = balance.disasters.gangWar;
  const radius = (active.state['radius'] as number | undefined) ?? war.radiusMin;

  const shape = { kind: 'radius' as const, x: context.x, y: context.y, radius: radius * 4 };
  active.state['cells'] = cellsAround(world, context.x, context.y, radius);

  crimeFloor(world, shape, war.crimeFloor, duration, active.id);
  happinessPenalty(world, shape, war.happiness, duration, active.id);
  suppressService(world, 'education', shape, war.educationFactor, duration, active.id);
  suppressService(world, 'health', shape, war.healthFactor, duration, active.id);
  landValuePenalty(world, shape, war.landValue, duration, active.id);
  taxLoss(world, shape, war.taxLoss, duration, active.id);

  happinessPenalty(world, CITY_WIDE, war.happinessCity, duration, active.id);
}

function advance(context: DisasterContext, active: ActiveDisaster): void {
  const { world, catalogue, balance } = context;
  const war = balance.disasters.gangWar;
  const cells = (active.state['cells'] as number[] | undefined) ?? [];

  const change = happinessChange(world, active, cells);
  const police = areaCoverage(world, 'police', cells);
  const age = world.tick - active.startedAtTick;

  // Rozšiřování: bez policie a s klesající spokojeností si gang bere další
  // ulici. Pokrytí nad prahem to zastaví — je to první věc, která zabere.
  if (age > 0 && age % war.spreadEvery === 0) {
    const radius = (active.state['radius'] as number | undefined) ?? war.radiusMin;
    if (police < war.spreadStop && change < 0 && radius < war.radiusMax2) {
      active.state['radius'] = radius + 1;
      applyGrip(context, active, Math.max(1, Math.ceil(remainingOf(active))));
    }
  }

  // Ukončení je podmínkové, ne časové: součet tlaku, kterým město tlačí zpátky.
  const pressure =
    (police / 255) * war.pressurePolice +
    Math.max(0, change) * war.pressureHappiness +
    areaEmployment(workPerCell(world), cells, balance.demand.workerRatio) *
      war.pressureEmployment;
  drain(active, war.drainBase + pressure * war.pressureScale);

  // Ojedinělé ničení: jedna budova za čas, a ani ta ne vždycky. Válka gangů
  // město nesrovná se zemí, ona ho vyhladoví.
  if (age === 0 || age % war.destroyEvery !== 0) return;
  const target = pickInArea(world, cells);
  if (target === null) return;
  if (world.rng.next() >= war.destroyChance) return;

  const losses = noLosses();
  destroyTile(world, catalogue, target, losses);
  active.state['destroyed'] = ((active.state['destroyed'] as number | undefined) ?? 0) + 1;
  reportLosses(world, balance, losses, war.happinessPerLoss);
}

/** Náhodná budova v oblasti. Vzestupně podle id, ať save nerozhodne za nás. */
function pickInArea(world: WorldState, cells: readonly number[]): number | null {
  const inArea = new Set(cells);
  const tiles: number[] = [];

  for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building) continue;
    if (!inArea.has(coarseIndex(building.x, building.y, world.size))) continue;
    tiles.push(index(building.x, building.y, world.size));
  }

  if (tiles.length === 0) {
    // Hodit se musí i tak: bez toho by `rng` běžel jinak podle toho, jestli
    // v oblasti něco zbylo (P2).
    world.rng.next();
    return null;
  }
  return tiles[world.rng.int(tiles.length)] ?? null;
}

/**
 * Vážený los čtvrti: `(kriminalita/255)³ × hustota × nepokrytí policií`.
 *
 * Třetí mocnina soustředí výběr téměř výhradně do nejhorší čtvrti — a to je
 * záměr. Hráči stačí nemít jednu extrémní čtvrť a válka gangů ho nepotká; kdyby
 * byla váha lineární, byla by to daň z velikosti města.
 */
function pickWorstDistrict(world: WorldState): { x: number; y: number } | null {
  const perCell = populationPerCell(world);
  const fullDensity = Math.max(1, [...perCell.values()].reduce((a, b) => Math.max(a, b), 0));
  const coverage = world.coverage.get('police');

  return pickWeighted(world, (building) => {
    const cell = coarseIndex(building.x, building.y, world.size);
    const crime = (world.coarse.crime[cell] ?? 0) / 255;
    const density = densityOfCell(perCell, cell, fullDensity);
    const uncovered = 1 - (coverage?.[cell] ?? 0) / 255;
    return crime * crime * crime * density * uncovered;
  });
}
