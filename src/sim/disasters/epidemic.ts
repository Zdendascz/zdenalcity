import type { EpidemicBalance } from '@/content/balance';
import { COARSE_FACTOR, coarseIndex, coarseSizeOf } from '../coarse';
import { index } from '../layers';
import type { Building, WorldState } from '../world';
import { CITY_WIDE, happinessPenalty, suppressService } from './effects';
import type { Disaster, DisasterContext } from './registry';
import { setClock } from './state';
import type { ActiveDisaster } from './state';
import { densityOfCell, populationPerCell } from './unrest';

/**
 * Epidemie (katalog 13).
 *
 * **Jediná katastrofa, kterou jde aktivně potlačit i po vzniku** — postavená
 * nemocnice do ohniska ji opravdu zastaví. Je to nejodměňovanější rychlá reakce
 * ve hře a celý její tvar tomu slouží: nákaza v buňce roste, dokud pokrytí
 * zdravotnictvím nepřekročí práh, a pak sama ustupuje.
 *
 * Nakaženost je **řídká mapa `buňka → 0..1`**, ne vrstva. Většina města je vždy
 * nenakažená; plná vrstva by byla pole nul o velikosti mapy, které se každý
 * cyklus prochází celé.
 *
 * Šíří se po sousedství **a skokem po dopravě**. Ten skok z ní dělá epidemii:
 * bez něj by se dala uzavřít jedním pásem a hráč by ji řešil geometrií, ne
 * službami.
 *
 * Úbytek obyvatel je **trvalý**. Budovy zůstanou stát a časem se zaplní zpátky
 * — dlouhá epidemie v husté čtvrti ale umí vzít desetinu města.
 */

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export function createEpidemicDisaster(): Disaster {
  return {
    kind: 'epidemic',
    pickOrigin: (world) => pickHotspot(world),
    start: (context, active) => begin(context, active),
    tick: (context, active) => advance(context, active),
    isFinished: (world, active) => {
      const left = (active.state['left'] as number | undefined) ?? 0;
      // Skončí, až **vyhasne**, ne až doběhne odpočet: dokud je někde nákaza,
      // epidemie trvá. Odpočet říká, kdy přestane růst a šířit se — od té
      // chvíle už jen dohasíná a konec je otázka pár cyklů.
      return left <= 0 && world.infection.size === 0;
    },
    cooldownFromEnd: true,
  };
}

function begin(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const epidemic = balance.disasters.epidemic;

  const duration =
    epidemic.durationMin + world.rng.int(epidemic.durationMax - epidemic.durationMin + 1);
  setClock(active, duration);
  active.state['lost'] = 0;

  const cell = coarseIndex(context.x, context.y, world.size);
  world.infection.set(cell, epidemic.seed);
  world.dirty.coarseChanged = true;
}

function advance(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const epidemic = balance.disasters.epidemic;

  const left = ((active.state['left'] as number | undefined) ?? 0) - 1;
  active.state['left'] = left;

  const age = world.tick - active.startedAtTick;
  if (age % epidemic.cycleTicks !== 0) return;

  const span = (active.state['span'] as number | undefined) ?? 1;

  // Po vypršení doby už epidemie **jen dohasíná**: nešíří se ani neroste,
  // zbývá čisté opadání.
  //
  // Bez toho by nákaza nikdy neskončila. Přenos mezi dvěma nakaženými sousedy
  // je řádově silnější než ústup, takže se shluk donekonečna dokrmuje sám —
  // a hráč bez zdravotnictví by koukal na hlášení, které nezmizí. Nemocnice
  // pořád rozhoduje o tom, jak zle a jak dlouho, jen už ne o tom, jestli vůbec.
  const fading = left <= 0;
  const wave = fading ? 0 : waveFactor(epidemic, 1 - left / Math.max(1, span));

  spread(world, epidemic, wave, fading);
  applyEffects(context, active, epidemic);
}

/**
 * Tři vlny intenzity za celé trvání.
 *
 * Rovná křivka by znamenala, že hráč reaguje jednou a je hotovo. Takhle přijde
 * druhá vlna zrovna ve chvíli, kdy si myslí, že to má za sebou.
 */
function waveFactor(epidemic: EpidemicBalance, progress: number): number {
  const phase = Math.sin(progress * Math.PI * epidemic.waves);
  return epidemic.waveBase + (1 - epidemic.waveBase) * Math.max(0, phase);
}

function spread(
  world: WorldState,
  epidemic: EpidemicBalance,
  wave: number,
  fading: boolean,
): void {
  const side = coarseSizeOf(world.size);
  const perCell = populationPerCell(world);
  const fullDensity = Math.max(1, [...perCell.values()].reduce((a, b) => Math.max(a, b), 0));
  const health = world.coverage.get('health');

  // Pořadí buněk je setříděné: `Map` si pamatuje pořadí vkládání a to závisí na
  // tom, kudy se nákaza šířila, takže by se save po načtení choval jinak (P2).
  const cells = [...world.infection.keys()].sort((a, b) => a - b);
  const added = new Map<number, number>();
  // Váhy pro skok po dopravě jednou za cyklus, ne při každém skoku zvlášť.
  const traffic = trafficWeights(world, perCell, fullDensity);

  for (const cell of cells) {
    if (fading) break; // dohasínající epidemie se už nešíří
    const level = world.infection.get(cell) ?? 0;
    if (level <= 0) continue;

    // --- šíření po sousedství ---------------------------------------------
    const cx = cell % side;
    const cy = (cell - cx) / side;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
      const neighbour = ny * side + nx;
      const density = densityOfCell(perCell, neighbour, fullDensity);
      if (density <= 0) continue;

      const covered = (health?.[neighbour] ?? 0) / 255;
      const transfer =
        level * epidemic.spread * density * (1 - covered * epidemic.coverageBlock);
      if (transfer <= 0) continue;
      added.set(neighbour, (added.get(neighbour) ?? 0) + transfer);
    }

    // --- skok po dopravě ---------------------------------------------------
    // Tohle dělá z nákazy epidemii: přeskočí přes celé město po hlavních tazích
    // a hráč ji nemůže uzavřít pásem parku.
    if (world.rng.next() < epidemic.jumpChance) {
      const target = pickByTraffic(world, traffic);
      if (target !== null) {
        added.set(target, (added.get(target) ?? 0) + level * epidemic.jumpShare);
      }
    }
  }

  for (const [cell, amount] of added) {
    world.infection.set(cell, Math.min(1, (world.infection.get(cell) ?? 0) + amount));
  }

  // --- růst a ústup ---------------------------------------------------------
  // Práh vyhasnutí: nad ním nákaza ustupuje, pod ním roste. Je to jediné číslo,
  // které hráč potřebuje znát — „pokrytí zdravotnictvím nad 65 všude".
  for (const cell of [...world.infection.keys()].sort((a, b) => a - b)) {
    const covered = (health?.[cell] ?? 0) / 255;
    const next =
      (world.infection.get(cell) ?? 0) +
      epidemic.growth * wave -
      (epidemic.decay + covered * epidemic.decayPerCoverage);

    if (next <= epidemic.extinction) world.infection.delete(cell);
    else world.infection.set(cell, Math.min(1, next));
  }

  world.dirty.coarseChanged = true;
}

function applyEffects(
  context: DisasterContext,
  active: ActiveDisaster,
  epidemic: EpidemicBalance,
): void {
  const { world } = context;
  const side = coarseSizeOf(world.size);
  // Obyvatelé po buňkách jedním průchodem. Ptát se na každou budovu zvlášť pro
  // každou nakaženou buňku je součin dvou velkých čísel.
  const residents = residentsPerCell(world);
  let worst = 0;
  let lost = 0;
  // Nedoplatek v lidech, přenášený mezi cykly i mezi domy. Drží se ve stavu
  // katastrofy, takže přežije save.
  let debt = (active.state['debt'] as number | undefined) ?? 0;

  // Setříděně, stejně jako v `spread`. Nedoplatek úmrtí se řetězí mezi buňkami,
  // takže na pořadí záleží — a pořadí `Map` je pořadí vkládání, tedy to, kudy
  // se nákaza náhodou šířila. Bez setřídění by se město po loadu chovalo jinak
  // než před uložením (P2).
  for (const cell of [...world.infection.keys()].sort((a, b) => a - b)) {
    const level = world.infection.get(cell) ?? 0;
    worst = Math.max(worst, level);

    // Úbytek obyvatel je **trvalý**. Budovy nemizí — prázdný dům se časem
    // zaplní zpátky, což je ta správná pomalá cesta zpátky do normálu.
    const cellX = cell % side;
    const cellY = (cell - cellX) / side;
    for (const building of residents.get(cell) ?? []) {
      if (building.population === 0) continue;
      // Zlomek se **přenáší**, nezaokrouhluje se pryč. `populace × 0,015` je
      // u malého domu desetina člověka; zaokrouhlením na nulu by epidemie
      // v malém městě nezabila nikdy nikoho a mechanika by tiše nefungovala.
      const owed = debt + building.population * level * epidemic.mortality;
      const gone = Math.min(building.population, Math.floor(owed));
      debt = owed - gone;
      building.population -= gone;
      lost += gone;
    }

    // Přetížení nemocnic: v nakažené buňce účinkuje pokrytí slabě. Je to
    // záměrná past — hráč potřebuje **rezervu**, ne přesně dostačující síť.
    const spot = {
      kind: 'radius' as const,
      x: cellX * COARSE_FACTOR,
      y: cellY * COARSE_FACTOR,
      radius: COARSE_FACTOR,
    };
    suppressService(world, 'health', spot, epidemic.overload, epidemic.cycleTicks, active.id);
    happinessPenalty(world, spot, epidemic.happiness * level, epidemic.cycleTicks, active.id);
  }

  active.state['lost'] = ((active.state['lost'] as number | undefined) ?? 0) + lost;
  active.state['worst'] = worst;
  active.state['debt'] = debt;

  if (worst > 0) {
    happinessPenalty(
      world,
      CITY_WIDE,
      epidemic.happinessCity * worst,
      epidemic.cycleTicks,
      active.id,
    );
  }
}

/**
 * Cíl skoku po dopravě: vážený los podle zátěže silnic v okolí buňky.
 *
 * Nákaza necestuje do prázdna — skočí tam, kam se jezdí, a to je zároveň
 * důvod, proč hustá síť bez zdravotnictví je horší než řídká.
 */
interface TrafficWeights {
  readonly cells: readonly number[];
  readonly weights: readonly number[];
  readonly total: number;
}

function trafficWeights(
  world: WorldState,
  perCell: ReadonlyMap<number, number>,
  fullDensity: number,
): TrafficWeights {
  const side = coarseSizeOf(world.size);
  const cells: number[] = [];
  const weights: number[] = [];
  let total = 0;

  for (const cell of [...perCell.keys()].sort((a, b) => a - b)) {
    const density = densityOfCell(perCell, cell, fullDensity);
    if (density <= 0) continue;

    const cellX = cell % side;
    const cellY = (cell - cellX) / side;

    let load = 0;
    for (let dy = 0; dy < COARSE_FACTOR; dy++) {
      for (let dx = 0; dx < COARSE_FACTOR; dx++) {
        const x = cellX * COARSE_FACTOR + dx;
        const y = cellY * COARSE_FACTOR + dy;
        if (x >= world.size || y >= world.size) continue;
        load += world.trafficLoad[index(x, y, world.size)] ?? 0;
      }
    }
    if (load <= 0) continue;

    cells.push(cell);
    weights.push(load * density);
    total += load * density;
  }

  return { cells, weights, total };
}

function pickByTraffic(world: WorldState, traffic: TrafficWeights): number | null {
  if (traffic.total <= 0) {
    // Hodit se musí i tak, aby `rng` běžel stejně bez ohledu na to, jestli
    // město už má provoz (P2).
    world.rng.next();
    return null;
  }

  let roll = world.rng.next() * traffic.total;
  for (let i = 0; i < traffic.cells.length; i++) {
    roll -= traffic.weights[i] ?? 0;
    if (roll <= 0) return traffic.cells[i] ?? null;
  }
  return traffic.cells[traffic.cells.length - 1] ?? null;
}

/** Obytné budovy po buňkách. Jeden průchod na cyklus. */
function residentsPerCell(world: WorldState): Map<number, Building[]> {
  const perCell = new Map<number, Building[]>();
  for (const building of world.buildings.values()) {
    if (building.population === 0) continue;
    const cell = coarseIndex(building.x, building.y, world.size);
    const list = perCell.get(cell);
    if (list) list.push(building);
    else perCell.set(cell, [building]);
  }
  return perCell;
}

/**
 * Ohnisko: hustota × nepokrytí × bez vody × znečištění.
 *
 * `bezVody` je nejsilnější vazba na vodovod v celém katalogu — čtvrť bez vody
 * je první, kde epidemie vypukne.
 */
function pickHotspot(world: WorldState): { x: number; y: number } | null {
  const perCell = populationPerCell(world);
  const fullDensity = Math.max(1, [...perCell.values()].reduce((a, b) => Math.max(a, b), 0));
  const health = world.coverage.get('health');

  const targets: { x: number; y: number }[] = [];
  const weights: number[] = [];
  let total = 0;

  for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building || building.population === 0) continue;

    const cell = coarseIndex(building.x, building.y, world.size);
    const density = densityOfCell(perCell, cell, fullDensity);
    const uncovered = 1 - (health?.[cell] ?? 0) / 255;
    const dry = world.watered.has(id) ? 0 : 1;
    const pollution = (world.coarse.pollution[cell] ?? 0) / 255;

    const weight = density * uncovered * (1 + dry * 0.6) * (1 + pollution * 0.4);
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

/** Nejvyšší nakaženost ve městě, 0–1. Do hlášení a do panelu. */
export function worstInfection(world: WorldState): number {
  let worst = 0;
  for (const level of world.infection.values()) worst = Math.max(worst, level);
  return worst;
}

/** Uklidí nákazu. Volá plánovač, až epidemie skončí. */
export function clearInfection(world: WorldState): void {
  if (world.infection.size === 0) return;
  world.infection.clear();
  world.dirty.coarseChanged = true;
}

/** Vystaveno kvůli testům a panelu: nakaženost v buňce, 0–1. */
export function infectionAt(world: WorldState, x: number, y: number): number {
  return world.infection.get(coarseIndex(x, y, world.size)) ?? 0;
}
