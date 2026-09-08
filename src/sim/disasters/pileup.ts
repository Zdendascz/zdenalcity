import { coarseIndex } from '../coarse';
import { ROAD } from '../layers';
import type { WorldState } from '../world';
import {
  blockTile,
  happinessPenalty,
  populationLoss,
  spikeTraffic,
  suppressService,
} from './effects';
import type { Disaster, DisasterContext } from './registry';
import { setClock } from './state';
import type { ActiveDisaster } from './state';
import { cellsAround, remainingOf } from './unrest';

/**
 * Hromadná nehoda (katalog 5).
 *
 * **Nezničí ani jednu budovu — a přesto je to jedna z nejotravnějších pohrom.**
 * Hlavní účinek je blokace dlaždice: doprava tudy neprojede. Nehoda na jediné
 * spojnici odřízne celou čtvrť od práce, což bolí víc než skok v kolonách.
 * Odsud plyne i obrana — okružní a redundantní síť, ne širší silnice.
 *
 * Škáluje se **délkou silniční sítě**, ne počtem budov: je to daň z dopravy.
 *
 * Trvání se krátí zdravotnickým pokrytím, a to výrazně — pokrytá čtvrť si
 * odbude čtyři tiky, nepokrytá deset.
 *
 * Zároveň je to **násobič ostatních katastrof**: potlačení hasičů v okruhu
 * znamená, že požár, který vypukne během nehody, hoří déle.
 */

export function createPileupDisaster(): Disaster {
  return {
    kind: 'pileup',
    pickOrigin: (world) => pickBusyRoad(world),
    start: (context, active) => begin(context, active),
    tick: (_context, active) => {
      drainTick(active);
    },
    isFinished: (_world, active) => remainingOf(active) <= 0,
  };
}

function begin(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const pileup = balance.disasters.pileup;

  // Trvání podle zdravotnického pokrytí: 4 tiky v pokryté čtvrti, 10 v nepokryté.
  const cell = coarseIndex(context.x, context.y, world.size);
  const health = (world.coverage.get('health')?.[cell] ?? 0) / 255;
  const duration = pileup.durationBase + Math.round(pileup.durationSpan * (1 - health));

  setClock(active, duration);
  active.state['tile'] = coarseIndex(context.x, context.y, world.size);

  const tile = context.y * world.size + context.x;
  active.state['blocked'] = tile;

  // Blokace je to podstatné. Kolony kolem jsou jen kulisa k ní.
  blockTile(world, tile, duration, active.id);
  spikeTraffic(
    world,
    { kind: 'radius', x: context.x, y: context.y, radius: pileup.jamRadius },
    pileup.jamFactor,
    duration,
    active.id,
  );

  const area = { kind: 'radius' as const, x: context.x, y: context.y, radius: pileup.reach };
  suppressService(world, 'health', area, pileup.healthFactor, duration, active.id);
  suppressService(world, 'fire', area, pileup.fireFactor, duration, active.id);
  happinessPenalty(world, area, pileup.happiness, duration, active.id);

  // Ztráta obyvatel z okolních domů. Budovy zůstanou stát — nehoda nikoho
  // nevystěhuje, jen ubude lidí a dům se časem zaplní zpátky.
  const lost = populationLoss(world, area, pileup.populationLoss);
  active.state['lost'] = lost;
  active.state['cells'] = cellsAround(world, context.x, context.y, pileup.reach);
}

function drainTick(active: ActiveDisaster): void {
  active.state['left'] = remainingOf(active) - 1;
}

/**
 * Vážený los místa: dopravní zátěž × kapacita silnice.
 *
 * Nehoda se stane tam, kde se jezdí — na vytížené třídě, ne na slepé ulici za
 * městem. Kdyby padala rovnoměrně, hráč by ji nikdy nespojil s tím, že si
 * postavil jednu přetíženou spojnici.
 */
function pickBusyRoad(world: WorldState): { x: number; y: number } | null {
  const tiles: number[] = [];
  const weights: number[] = [];
  let total = 0;

  // Prochází se seznam silnic, ne celá mapa (R20).
  for (const tile of [...world.roadTiles].sort((a, b) => a - b)) {
    const road = world.layers.road[tile] ?? ROAD.none;
    if (road === ROAD.none) continue;
    const load = world.trafficLoad[tile] ?? 0;
    // Výkonový filtr, ne pravidlo: dlaždice s nulovou zátěží má nulovou váhu,
    // takže by se stejně nevylosovala. Bez něj by ale seznam nesl každou
    // silnici ve městě, a těch jsou na velké mapě tisíce.
    if (load <= 0) continue;
    // Kapacitní faktor: na třídě a dálnici je víc aut na jednu dlaždici.
    const weight = load * road;
    tiles.push(tile);
    weights.push(weight);
    total += weight;
  }

  if (total <= 0) return null;

  let roll = world.rng.next() * total;
  let picked = tiles[tiles.length - 1] ?? 0;
  for (let i = 0; i < tiles.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) {
      picked = tiles[i] ?? 0;
      break;
    }
  }

  const x = picked % world.size;
  return { x, y: (picked - x) / world.size };
}

/** Vystaveno kvůli hlášení: blokace se hlásí jen na vytížené dlaždici. */
export function worthReporting(world: WorldState, tile: number, threshold: number): boolean {
  return (world.trafficLoad[tile] ?? 0) >= threshold;
}
