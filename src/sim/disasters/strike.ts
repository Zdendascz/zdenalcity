import { coarseIndex } from '../coarse';
import type { WorldState } from '../world';
import {
  CITY_WIDE,
  happinessPenalty,
  spikeCrime,
  spikeTraffic,
  suppressService,
  taxLoss,
} from './effects';
import { computeIndicators } from './indicators';
import type { Disaster, DisasterContext } from './registry';
import { dominantTerm } from './risk';
import { setClock } from './state';
import type { ActiveDisaster } from './state';
import {
  areaHappiness,
  cellsAround,
  densityOfCell,
  drain,
  happinessChange,
  localUnemployment,
  pickWeighted,
  populationPerCell,
  remainingOf,
  workPerCell,
} from './unrest';

/**
 * Stávka (katalog 6).
 *
 * Nic nezničí — **sebere peníze a čas**. Čtvrť v ní nedaní, zdravotnictví je na
 * půl plynu, kriminalita a kolony nahoře. Hráč nemá co hasit ani uklízet, má se
 * zamyslet nad tím, proč k ní došlo.
 *
 * Proto se hlásí **s hlavním důvodem**: která složka rizika byla nejvyšší.
 * Bez toho by to byl náhodný trest a hráč by z něj neměl jak se poučit.
 *
 * Ukončení je podmínkové: roste-li v oblasti spokojenost, ubývá dvakrát rychleji.
 * Reakce během stávky ji zkrátí zhruba na polovinu — a to je celá hra o ní.
 */

export function createStrikeDisaster(): Disaster {
  return {
    kind: 'strike',
    pickOrigin: (world, _catalogue, balance) => pickDistrict(world, balance.demand.workerRatio),
    start: (context, active) => begin(context, active),
    tick: (context, active) => advance(context, active),
    isFinished: (_world, active) => remainingOf(active) <= 0,
    cooldownFromEnd: true,
  };
}

function begin(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const strike = balance.disasters.strike;

  const duration =
    strike.durationMin + world.rng.int(strike.durationMax - strike.durationMin + 1);
  const radius = strike.radiusMin + world.rng.int(strike.radiusMax - strike.radiusMin + 1);
  const cells = cellsAround(world, context.x, context.y, radius);

  setClock(active, duration);
  active.state['radius'] = radius;
  active.state['cells'] = cells;
  active.state['reason'] = dominantReason(context);

  const startingHappiness = areaHappiness(world, cells);
  // Porovnání proti minulému tiku řídí zkracování; proti stavu při vzniku se
  // na konci ptá eskalace v nepokoje.
  active.state['happinessBefore'] = startingHappiness;
  active.state['happinessAtStart'] = startingHappiness;

  const shape = { kind: 'radius' as const, x: context.x, y: context.y, radius: radius * 4 };
  spikeCrime(world, shape, strike.crime, duration, active.id);
  spikeTraffic(world, shape, strike.traffic, duration, active.id);
  suppressService(world, 'health', shape, strike.healthFactor, duration, active.id);
  happinessPenalty(world, shape, strike.happiness, duration, active.id);
  // Stávkující čtvrť nedaní vůbec. Je to jediná přímá cena stávky a hráč ji
  // uvidí v rozpisu rozpočtu, ne jako skryté číslo.
  taxLoss(world, shape, 1, duration, active.id);

  // Srážka celému městu navíc: stávka je zpráva, ne lokální nepříjemnost.
  happinessPenalty(world, CITY_WIDE, strike.happinessCity, duration, active.id);
}

function advance(context: DisasterContext, active: ActiveDisaster): void {
  const { world } = context;
  const strike = context.balance.disasters.strike;
  const cells = (active.state['cells'] as number[] | undefined) ?? [];

  // Roste-li spokojenost, ubývá dvakrát rychleji. Hráč, který zareaguje,
  // zkrátí stávku zhruba na polovinu.
  const rising = happinessChange(world, active, cells) > 0;
  drain(active, rising ? strike.drainRising : strike.drainIdle);
}

/**
 * Vážený los čtvrti: hustota × kriminalita × nezaměstnanost v okolí.
 *
 * Stávka nevzniká náhodně, vzniká tam, kde na ni bylo zaděláno. Kdyby padala
 * kamkoli, byla by to daň z velikosti města a ne důsledek hráčových rozhodnutí.
 */
function pickDistrict(world: WorldState, workerRatio: number): { x: number; y: number } | null {
  const perCell = populationPerCell(world);
  const fullDensity = Math.max(1, [...perCell.values()].reduce((a, b) => Math.max(a, b), 0));
  const work = workPerCell(world);

  return pickWeighted(world, (building) => {
    const cell = coarseIndex(building.x, building.y, world.size);
    const density = densityOfCell(perCell, cell, fullDensity);
    if (density <= 0) return 0;
    const crime = (world.coarse.crime[cell] ?? 0) / 255;
    const unemployment = localUnemployment(world, work, building.x, building.y, 2, workerRatio);
    return density * (1 + crime) * (1 + unemployment);
  });
}

/**
 * Která složka rizika je nejvyšší. Jde do hlášení jako hlavní důvod.
 *
 * Počítá se **při vzniku a už se nemění** — hráč má vidět, proč stávka začala,
 * ne co je zrovna teď nejhorší. A počítá se **z týchž členů**, ze kterých riziko
 * stávku vygenerovalo; vlastní paralelní vzorec by se s ním časem rozešel.
 */
function dominantReason(context: DisasterContext): string | null {
  const { world, catalogue, balance } = context;
  const type = balance.disasters.types['strike'];
  if (!type) return null;

  const indicators = computeIndicators(world, catalogue, balance, balance.disasters.indicators);
  return dominantTerm(type, indicators);
}
