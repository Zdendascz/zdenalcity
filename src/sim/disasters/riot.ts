import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { COARSE_FACTOR, coarseIndex, coarseSizeOf } from '../coarse';
import { index } from '../layers';
import type { WorldState } from '../world';
import {
  CITY_WIDE,
  happinessPenalty,
  spikeCrime,
  spikeTraffic,
  suppressService,
  taxLoss
} from './effects';
import { flammableAt, igniteTile } from './fire';
import type { Disaster, DisasterContext } from './registry';
import { setClock } from './state';
import type { ActiveDisaster } from './state';
import { areaCoverage, areaHappiness, drain, happinessChange, remainingOf } from './unrest';

/**
 * Občanské nepokoje (katalog 7).
 *
 * **Celoměstská katastrofa s lokální silou.** Postihy platí všude, ale jejich
 * velikost se řídí mapou kriminality — čtvrť s čistým rejstříkem odnese málo,
 * ta nejhorší skoro všechno. Proto nemá `cells`, ale globální tvar a vlastní
 * mapu síly.
 *
 * **Mapa síly se během trvání nepřepočítává.** Nepokoje kriminalitu zvyšují;
 * kdyby z ní zároveň brala vlastní sílu, posilovaly by samy sebe a nikdy by
 * neskončily. Je to pojistka proti utržené smyčce, ne optimalizace.
 *
 * Hlavní cesta vzniku není plánovač, ale **eskalace ze stávky**: neřešená
 * stávka může přerůst v nepokoje a doba hájení se přitom ignoruje. Tím se ze
 * stávky stává varování, ne jen nepříjemnost.
 */

export function createRiotDisaster(): Disaster {
  return {
    kind: 'riot',
    pickOrigin: (world) => pickWorstCell(world),
    start: (context, active) => begin(context, active),
    tick: (context, active) => advance(context, active),
    isFinished: (_world, active) => remainingOf(active) <= 0,
    cooldownFromEnd: true,
  };
}

function begin(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const riot = balance.disasters.riot;

  const duration = riot.durationMin + world.rng.int(riot.durationMax - riot.durationMin + 1);
  setClock(active, duration);
  active.state['happinessBefore'] = areaHappiness(world, []);

  // Síla podle kriminality v epicentru; zmrazí se na celé trvání.
  const strength = localStrength(world, riot, context.x, context.y);
  active.state['strength'] = strength;

  const global = CITY_WIDE;
  spikeCrime(world, global, riot.crime * strength, duration, active.id);
  spikeTraffic(world, global, 1 + riot.traffic * strength, duration, active.id);
  suppressService(world, 'health', global, riot.healthFactor, duration, active.id);
  suppressService(world, 'education', global, riot.educationFactor, duration, active.id);
  happinessPenalty(world, global, riot.happiness * strength, duration, active.id);
  taxLoss(world, global, riot.taxLoss, duration, active.id);
}

function advance(context: DisasterContext, active: ActiveDisaster): void {
  const { world, catalogue, balance } = context;
  const riot = balance.disasters.riot;

  const rising = happinessChange(world, active, []) > 0;
  const policed = areaCoverage(world, 'police', []) > riot.policeCalm;

  // Tři rychlosti, ne dvě: policie sama nestačí a spokojenost sama taky ne.
  // Nejrychleji ubývá tomu, kdo udělal obojí.
  const speed = rising && policed ? riot.drainBoth : rising ? riot.drainRising : riot.drainIdle;
  drain(active, speed);

  // Zapalování po dávkách, ne každý tik: shluky ohnisek dají hráči šanci
  // hasit, rozprostřený jeden požár za tik by hořel všude a nikde.
  const age = world.tick - active.startedAtTick;
  if (age % riot.igniteEvery !== 0) return;

  const strength = (active.state['strength'] as number | undefined) ?? 0;
  const count = 1 + Math.floor(riot.igniteMax * strength);
  // Do stavu, ne jen do lokální proměnné: hlášení říká hráči, kolik ohnisek
  // právě vzniklo, a je to zároveň jediné, na čem jde zvenčí poznat, že se
  // síla opravdu nepřepočítává.
  active.state['batch'] = count;

  for (let i = 0; i < count; i++) {
    const tile = pickTarget(world, catalogue, balance);
    if (tile === null) continue;
    igniteTile(world, catalogue, balance, tile, riot.igniteIntensity, false);
  }
}

/** 0,3 až 1,0 podle kriminality v buňce. Nikdy nula — i klidná čtvrť něco odnese. */
function localStrength(
  world: WorldState,
  riot: Balance['disasters']['riot'],
  x: number,
  y: number,
): number {
  const cell = coarseIndex(x, y, world.size);
  const crime = (world.coarse.crime[cell] ?? 0) / 255;
  return riot.strengthBase + (1 - riot.strengthBase) * crime;
}

/**
 * Kam zapálit: kriminalita × hořlavost × nepokrytí hasiči.
 *
 * Právě tenhle součin dělá z hasičského pokrytí to, co rozhoduje, jestli po
 * nepokojích zbude vzpomínka nebo vypálená čtvrť.
 */
function pickTarget(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): number | null {
  const coverage = world.coverage.get('fire');
  const ids = [...world.buildings.keys()].sort((a, b) => a - b);

  const tiles: number[] = [];
  const weights: number[] = [];
  let total = 0;

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;
    const tile = index(building.x, building.y, world.size);
    const flammable = flammableAt(world, catalogue, balance, tile);
    if (flammable.flammability <= 0 || flammable.fuel <= 0) continue;

    const cell = coarseIndex(building.x, building.y, world.size);
    const crime = (world.coarse.crime[cell] ?? 0) / 255;
    const uncovered = 1 - (coverage?.[cell] ?? 0) / 255;
    const weight = crime * flammable.flammability * uncovered;
    if (weight <= 0) continue;

    tiles.push(tile);
    weights.push(weight);
    total += weight;
  }

  if (total <= 0) return null;

  let roll = world.rng.next() * total;
  for (let i = 0; i < tiles.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return tiles[i] ?? null;
  }
  return tiles[tiles.length - 1] ?? null;
}

/** Nejhorší buňka podle kriminality. Nepokoje vznikají tam, kde to vře nejvíc. */
function pickWorstCell(world: WorldState): { x: number; y: number } | null {
  const side = coarseSizeOf(world.size);
  let best = -1;
  let bestCrime = -1;

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    const cell = coarseIndex(building.x, building.y, world.size);
    const crime = world.coarse.crime[cell] ?? 0;
    // Při shodě vyhrává nižší index buňky: bez toho by pořadí `Map` rozhodovalo
    // o místě a save by po načtení vybral jinak (P2).
    if (crime > bestCrime || (crime === bestCrime && cell < best)) {
      best = cell;
      bestCrime = crime;
    }
  }

  if (best < 0) return null;
  const cellX = best % side;
  const cellY = (best - cellX) / side;
  return {
    x: cellX * COARSE_FACTOR + (COARSE_FACTOR >> 1),
    y: cellY * COARSE_FACTOR + (COARSE_FACTOR >> 1),
  };
}

/**
 * Má neřešená stávka přerůst v nepokoje?
 *
 * Volá se při skončení stávky. Podmínky jsou tři a všechny musí platit: v
 * oblasti klesla spokojenost, kriminalita je nad prahem, a padne hod vážený
 * nespokojeností. Doba hájení se ignoruje — tohle není nová katastrofa
 * z plánovače, tohle je následek té předchozí.
 */
export function escalatesToRiot(
  world: WorldState,
  balance: Balance,
  strike: ActiveDisaster,
): boolean {
  const riot = balance.disasters.riot;
  const cells = (strike.state['cells'] as number[] | undefined) ?? [];

  const happinessNow = areaHappiness(world, cells);
  const happinessAtStart = (strike.state['happinessAtStart'] as number | undefined) ?? happinessNow;
  if (happinessNow >= happinessAtStart) {
    // I tak se musí hodit, aby `rng` běžel stejně bez ohledu na to, jak se
    // stávka vyvinula (P2).
    world.rng.next();
    return false;
  }

  let crime = 0;
  for (const cell of cells) crime = Math.max(crime, world.coarse.crime[cell] ?? 0);
  if (crime <= riot.escalationCrime) {
    world.rng.next();
    return false;
  }

  const unhappiness = 1 - happinessNow / 255;
  return world.rng.next() < riot.escalationChance * unhappiness;
}
