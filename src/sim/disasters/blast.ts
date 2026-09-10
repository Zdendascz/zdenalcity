import type { Balance, BlastKindBalance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { index } from '../layers';
import type { WorldState } from '../world';
import { lookup, noLosses, reportLosses, rollDamage } from './damage';
import { igniteTile } from './fire';
import type { Disaster, DisasterContext } from './registry';
import { tilesOf } from './shapes';
import { addToll } from './state';
import type { ActiveDisaster } from './state';

/**
 * Výbuch a průmyslová havárie (katalog 8 a 10).
 *
 * Jedna mechanika, dvě sady čísel. Rozdíl je záměrně malý a přesně tam, kde
 * hráč pozná, co se stalo: havárie **zboří víc** (0,85 proti 0,75, poloměr
 * 2–4 proti 1–3) a **kontaminuje**, výbuch **zapálí víc** (50 % proti 45 %)
 * a po sobě nenechá nic než trosky a oheň.
 *
 * Obojí je jednorázový zásah, ne proces — celá práce se odehraje v `start()`
 * a katastrofa hned končí. Co po nich zbude, dohořívá vlastním systémem.
 *
 * **Bez řetězení** (rozhodnutí autora): zasažená továrna nevybuchuje, jen hoří.
 * Řetězení by z jedné havárie udělalo konec města a hráč by neměl co zachránit.
 *
 * **Zničení se nefiltruje na zónu, jen vznik.** Výbuch na hranici poškodí
 * i domy vedle — jinak by hráč mohl beztrestně mísit zóny.
 */

function createBlast(kind: string, settings: (balance: Balance) => BlastKindBalance): Disaster {
  return {
    kind,
    pickOrigin: (world, catalogue) => pickTarget(world, catalogue, kind),
    start: (context, active) => detonate(context, active, settings(context.balance)),
    tick: () => {},
    isFinished: () => true,
  };
}

export function createExplosionDisaster(): Disaster {
  return createBlast('explosion', (balance) => balance.disasters.blast.explosion);
}

export function createIndustrialAccidentDisaster(): Disaster {
  return createBlast(
    'industrialAccident',
    (balance) => balance.disasters.blast.industrialAccident,
  );
}

function detonate(
  context: DisasterContext,
  active: ActiveDisaster,
  settings: BlastKindBalance,
): void {
  const { world, catalogue, balance } = context;
  const resistance = balance.disasters.blast.resistance;

  // Poloměr roste s úrovní budovy, ve které to bouchlo: velká továrna nadělá
  // víc škody než dílna.
  const level = levelAt(world, context.x, context.y);
  const radius = settings.radiusBase + Math.round(settings.radiusPerLevel * (level / 5));
  active.state['radius'] = radius;

  const losses = noLosses();
  const blast = { kind: 'radius' as const, x: context.x, y: context.y, radius };

  rollDamage(
    world,
    catalogue,
    balance,
    blast,
    (tile, content) => {
      const falloff = distanceFalloff(world, tile, context.x, context.y, radius);
      return (1 - falloff) * settings.destroyChance * (1 - lookup(resistance, content, 1));
    },
    losses,
  );

  // Zapaluje **dál, než boří**: okraj tlakové vlny dům nesloží, ale zapálí ho.
  const igniteRadius = radius * settings.igniteReach;
  for (const tile of tilesOf(world, { kind: 'radius', x: context.x, y: context.y, radius: igniteRadius })) {
    const falloff = distanceFalloff(world, tile, context.x, context.y, igniteRadius);
    if (world.rng.next() >= settings.igniteChance * (1 - falloff)) continue;
    igniteTile(world, catalogue, balance, tile, settings.igniteIntensity, false);
  }

  if (settings.pollution > 0) {
    // Kontaminace sahá dvakrát dál než tlaková vlna a je to jediný rozdíl,
    // kvůli kterému se havárie od výbuchu pozná i po týdnech.
    const cloud = { kind: 'radius' as const, x: context.x, y: context.y, radius: radius * 2 };
    const amount = (settings.pollution * level) / 5;
    for (const cell of cellsOf(world, cloud)) {
      world.coarse.pollution[cell] = Math.max(
        0,
        Math.min(255, (world.coarse.pollution[cell] ?? 0) + amount),
      );
    }
    world.dirty.coarseChanged = true;
  }

  reportLosses(world, balance, losses, settings.happinessPerLoss);
  addToll(active, losses.residents * balance.disasters.casualties.collapse);
}

/** Úroveň budovy na dlaždici; prázdná parcela se počítá jako jednička. */
function levelAt(world: WorldState, x: number, y: number): number {
  const buildingId = world.layers.buildingId[index(x, y, world.size)] ?? 0;
  if (buildingId === 0) return 1;
  return world.buildings.get(buildingId)?.level ?? 1;
}

/** 0 v epicentru, 1 na okraji dosahu. */
function distanceFalloff(
  world: WorldState,
  tile: number,
  x: number,
  y: number,
  radius: number,
): number {
  const tx = tile % world.size;
  const ty = (tile - tx) / world.size;
  if (radius <= 0) return 0;
  return Math.min(1, Math.hypot(tx - x, ty - y) / radius);
}

function cellsOf(world: WorldState, shape: Parameters<typeof tilesOf>[1]): number[] {
  const cells = new Set<number>();
  for (const tile of tilesOf(world, shape)) {
    const x = tile % world.size;
    cells.add(coarseIndex(x, (tile - x) / world.size, world.size));
  }
  return [...cells].sort((a, b) => a - b);
}

/**
 * Vážený los místa.
 *
 * Havárie si vybírá **jen průmysl**, výbuch cokoli zastavěného. Obojí váží
 * úrovní, nepokrytím hasiči a zanedbaností — takže bouchne nejspíš tam, kde
 * hráč nechal starou nekrytou továrnu stát, a je to zpráva, ne loterie.
 */
function pickTarget(
  world: WorldState,
  catalogue: BuildingCatalogue,
  kind: string,
): { x: number; y: number } | null {
  const industrialOnly = kind === 'industrialAccident';
  const coverage = world.coverage.get('fire');

  const ids = [...world.buildings.keys()].sort((a, b) => a - b);
  const targets: { x: number; y: number }[] = [];
  const weights: number[] = [];
  let total = 0;

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;
    const definition = catalogue.get(building.definitionId);
    if (industrialOnly && definition?.category !== 'industrial') continue;

    const cell = coarseIndex(building.x, building.y, world.size);
    const uncovered = 1 - (coverage?.[cell] ?? 0) / 255;
    const neglect = building.abandoned ? 1.8 : 1;
    const weight = building.level * uncovered * neglect;
    if (weight <= 0) continue;

    targets.push({ x: building.x, y: building.y });
    weights.push(weight);
    total += weight;
  }

  if (total <= 0) return null;

  let roll = world.rng.next() * total;
  for (let i = 0; i < targets.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return targets[i] ?? null;
  }
  return targets[targets.length - 1] ?? null;
}
