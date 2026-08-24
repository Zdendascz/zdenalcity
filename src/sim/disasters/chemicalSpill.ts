import type { ChemicalSpillBalance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { index, TERRAIN } from '../layers';
import type { WorldState } from '../world';
import { noLosses, reportLosses, rollDamage } from './damage';
import {
  CITY_WIDE,
  contaminateWater,
  happinessPenalty,
  landValuePenalty,
  populationLoss,
  pollutionBurst,
} from './effects';
import type { Disaster, DisasterContext } from './registry';
import type { ActiveDisaster } from './state';

/**
 * Chemická havárie (katalog 15).
 *
 * **Jediná katastrofa, kde je nejlepší reakce počkat a pak uklidit.** Hasit
 * není co — nehoří. Bourat během úniku nemá smysl, mrak stejně jde dál.
 *
 * Únik je **postupný**, ne jednorázový: intenzita rychle vyroste a pomalu
 * opadá. Zdroj je zhruba pětinásobek uhelné elektrárny, takže okolní buňky
 * vyjedou skoro na maximum znečištění.
 *
 * Skutečná cena se ale ukáže **až za rok**. Mrak srazí cenu půdy v celé části
 * města a spustí snižování úrovní i tam, kde se fyzicky nestalo nic — a to je
 * důvod, proč se těžký průmysl odděluje víc než u průmyslové havárie.
 *
 * **Kontaminace vody** je druhá polovina: vodárny v okruhu nedodávají po celou
 * dobu úniku a ještě dlouho po něm. Budovy začnou chátrat dva měsíce po havárii,
 * kdy už si na ni nikdo nevzpomene.
 */

export function createChemicalSpillDisaster(): Disaster {
  return {
    kind: 'chemicalSpill',
    pickOrigin: (world, catalogue, balance) =>
      pickPlant(world, catalogue, balance.disasters.chemicalSpill),
    start: (context, active) => begin(context, active),
    tick: (context, active) => advance(context, active),
    isFinished: (_world, active) =>
      ((active.state['age'] as number | undefined) ?? 0) >=
      ((active.state['span'] as number | undefined) ?? 0),
    cooldownFromEnd: true,
  };
}

function begin(context: DisasterContext, active: ActiveDisaster): void {
  const { world, catalogue, balance } = context;
  const spill = balance.disasters.chemicalSpill;

  const span = spill.durationMin + world.rng.int(spill.durationMax - spill.durationMin + 1);
  active.state['span'] = span;
  active.state['age'] = 0;
  active.state['lost'] = 0;

  // Zničení je minimální a **bez požárů**: chemikálie nehoří, rozlévá se.
  const losses = noLosses();
  rollDamage(
    world,
    catalogue,
    { kind: 'radius', x: context.x, y: context.y, radius: spill.blastRadius },
    (tile) =>
      tile === index(context.x, context.y, world.size)
        ? spill.sourceDestroyChance
        : spill.nearDestroyChance,
    losses,
  );
  reportLosses(world, balance, losses, spill.happinessPerLoss);

  // Cena půdy padá v širokém okolí a doznívá roky. Tohle je ta část účtu,
  // kterou hráč uvidí až dávno po tom, co uklidil trosky.
  //
  // Zapisuje se **bez vlastníka** (`source` zůstává nulový), takže ji plánovač
  // po skončení úniku neuklidí spolu se zbytkem. Únik trvá čtyřicet tiků, mrak
  // rok — a kdyby propad zmizel s poslední kapkou, celá pointa havárie by byla
  // pryč: hráč by uklidil trosky a bylo by po ní.
  landValuePenalty(
    world,
    { kind: 'radius', x: context.x, y: context.y, radius: spill.landValueRadius },
    spill.landValue,
    spill.landValueTicks,
  );
  happinessPenalty(world, CITY_WIDE, spill.happinessCity, spill.landValueTicks);
}

function advance(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const spill = balance.disasters.chemicalSpill;

  const age = ((active.state['age'] as number | undefined) ?? 0) + 1;
  const span = (active.state['span'] as number | undefined) ?? 1;
  active.state['age'] = age;

  const intensity = intensityAt(age / Math.max(1, span));
  active.state['intensity'] = intensity;

  // Mrak. Nejsilnější zdroj znečištění ve hře — proto se zapisuje rovnou do
  // vrstvy a nechá se rozfoukat, stejně jako kouř z výbuchu.
  pollutionBurst(
    world,
    { kind: 'radius', x: context.x, y: context.y, radius: spill.pollutionRadius },
    spill.pollution * intensity,
  );

  // Kontaminace vody jen tam, kde je voda: bez ní by havárie u dálnice odstavila
  // vodárnu na druhém konci města.
  if (hasWaterNear(world, context.x, context.y, spill.waterRadius)) {
    contaminateWater(
      world,
      { kind: 'radius', x: context.x, y: context.y, radius: spill.waterRadius },
      intensity,
      // Únik plus dozvuk: vodárny nenaskočí ve chvíli, kdy přestane kapat.
      // Bez vlastníka, ať to dozvuk přežije konec úniku — viz cena půdy.
      span - age + spill.waterAfterTicks,
    );
  }

  const lost = populationLoss(
    world,
    { kind: 'radius', x: context.x, y: context.y, radius: spill.populationRadius },
    spill.populationLoss * intensity,
  );
  active.state['lost'] = ((active.state['lost'] as number | undefined) ?? 0) + lost;

  happinessPenalty(
    world,
    { kind: 'radius', x: context.x, y: context.y, radius: spill.waterRadius },
    spill.happiness * intensity,
    spill.landValueTicks,
  );
}

/**
 * Rychlý nárůst, pomalý pokles.
 *
 * Nesymetrická křivka je záměr: hráč nemá čas zareagovat na začátku, ale má
 * spoustu času dívat se, jak to doznívá. Přesně tak se chová skutečný únik.
 */
function intensityAt(progress: number): number {
  if (progress <= 0.25) return progress / 0.25;
  return Math.max(0, 1 - (progress - 0.25) / 0.75);
}

function hasWaterNear(world: WorldState, x: number, y: number, radius: number): boolean {
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      if (Math.hypot(dx, dy) > radius) continue;
      if (world.layers.terrain[index(nx, ny, world.size)] === TERRAIN.water) return true;
    }
  }
  return false;
}

/**
 * Vážený los zdroje: úroveň × stáří × nepokrytí hasiči × zanedbanost.
 *
 * `stáří` je jediné místo ve hře, kde na věku budovy záleží samo o sobě —
 * a je to přímý argument pro obnovu starých provozů. Zbourat a postavit znovu
 * stáří vynuluje.
 *
 * Skládky a spalovny mají vlastní základní váhu, aby nebyly proti velkým
 * továrnám neviditelné.
 */
function pickPlant(
  world: WorldState,
  catalogue: BuildingCatalogue,
  spill: ChemicalSpillBalance,
): { x: number; y: number } | null {
  const coverage = world.coverage.get('fire');

  const targets: { x: number; y: number }[] = [];
  const weights: number[] = [];
  let total = 0;

  for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building) continue;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;

    const heavy = definition.category === 'industrial' && building.level >= spill.heavyLevel;
    const waste = definition.service?.class === 'waste';
    if (!heavy && !waste) continue;

    const cell = coarseIndex(building.x, building.y, world.size);
    const age = Math.min(1, (world.tick - building.builtAtTick) / spill.ageTicks);
    const uncovered = 1 - (coverage?.[cell] ?? 0) / 255;
    const neglect = building.abandoned ? spill.neglectFactor : 1;

    const base = waste ? spill.wasteWeight : building.level;
    const weight = base * (1 + age * spill.ageWeight) * uncovered * neglect;
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
