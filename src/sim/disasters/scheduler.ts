import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import type { System } from '../systems/index';
import type { WorldState } from '../world';
import { clearModifiersOf, expireModifiers } from './effects';
import { restorePlants } from './blackout';
import { clearInfection } from './epidemic';
import { escalatesToRiot } from './riot';
import { computeIndicators } from './indicators';
import { DisasterRegistry } from './registry';
import type { DisasterContext } from './registry';
import {
  computeMetrics,
  concurrentLimit,
  meetsConditions,
  monthlyChance,
  typeFactor,
} from './risk';
import type { ActiveDisaster } from './state';

/**
 * Plánovač katastrof (§3 fáze 4).
 *
 * Dvě věci naráz a je to schválně:
 *
 * - **každý tik** posune běžící katastrofy a nechá vypršet dočasné postihy,
 * - **jednou za měsíc** (30 tiků, offset 7) hodí kostkou o nových.
 *
 * Rozdělit to na dva systémy by znamenalo, že pořadí mezi nimi je další věc,
 * na které závisí determinismus. Takhle je jasné, že se nejdřív dohraje to,
 * co běží, a teprve pak se losuje nové.
 */
const INTERVAL = 1;
const OFFSET = 0;
/** Jednou za herní měsíc. Proto jsou pravděpodobnosti v katalogu měsíční. */
const ROLL_INTERVAL = 30;
const ROLL_OFFSET = 7;

export function createDisasterSystem(
  catalogue: BuildingCatalogue,
  balance: Balance,
  registry: DisasterRegistry = new DisasterRegistry(),
): System {
  return {
    name: 'disasters',
    interval: INTERVAL,
    offset: OFFSET,
    run(world: WorldState) {
      advanceActive(world, catalogue, balance, registry);
      expireModifiers(world);

      if ((world.tick - ROLL_OFFSET) % ROLL_INTERVAL === 0) {
        rollForNew(world, catalogue, balance, registry);
      }
    },
  };
}

/** Posune běžící katastrofy a uklidí ty, které skončily. */
function advanceActive(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  registry: DisasterRegistry,
): void {
  const active = world.disasters.active;
  if (active.length === 0) return;

  /** Stávky, které právě skončily. Eskaluje se až po úklidu seznamu. */
  const escalating: ActiveDisaster[] = [];

  for (const entry of active) {
    if (entry.finished) continue;
    const disaster = registry.get(entry.kind);
    if (!disaster) {
      // Katastrofa ze savu, kterou tenhle obsah nezná. Radši ji ukončit než
      // nechat viset něco, co se nikdy neposune.
      entry.finished = true;
      continue;
    }
    disaster.tick(contextFor(world, catalogue, balance, entry.x, entry.y), entry);
    if (disaster.isFinished(world, entry)) entry.finished = true;
  }

  let write = 0;
  for (let read = 0; read < active.length; read++) {
    const entry = active[read];
    if (!entry) continue;
    if (!entry.finished) {
      active[write++] = entry;
      continue;
    }
    clearModifiersOf(world, entry.id);
    // Blackout a epidemie si drží stav mimo `modifiers` — odpojené elektrárny
    // a mapu nákazy. Bez tohohle by po nich zbyla elektrárna, která nikdy
    // nenaběhne, a nákaza, kterou nikdo nešíří ani neléčí.
    if (entry.kind === 'blackout') restorePlants(world);
    if (entry.kind === 'epidemic') clearInfection(world);

    const disaster = registry.get(entry.kind);
    // Povodeň a lesní požár se hájí od skončení, ne od vzniku.
    if (disaster?.cooldownFromEnd) world.disasters.lastOccurrence.set(entry.kind, world.tick);

    // Neřešená stávka může přerůst v nepokoje. Doba hájení se přitom ignoruje:
    // tohle není nová katastrofa z plánovače, tohle je následek té předchozí,
    // a je to hlavní cesta, kterou nepokoje vůbec vznikají.
    if (entry.kind === 'strike' && registry.get('riot')) {
      escalating.push(entry);
    }
  }
  active.length = write;

  for (const strike of escalating) {
    if (!escalatesToRiot(world, balance, strike)) continue;
    startDisaster(world, catalogue, balance, registry, 'riot', strike.x, strike.y);
  }
}

/**
 * Měsíční hod o nových katastrofách.
 *
 * Pořadí typů je **setříděné**, ne pořadí registrace: každý hod posune `rng`,
 * takže by jinak stačilo přeskládat importy a ze stejného seedu by vyšlo jiné
 * město (P2).
 */
function rollForNew(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  registry: DisasterRegistry,
): void {
  if (!world.disasters.enabled) return;
  if (registry.size === 0) return;

  const metrics = computeMetrics(world, catalogue);
  const indicators = computeIndicators(world, catalogue, balance, balance.disasters.indicators);
  // R16: v mínusu se riziko dál nezvyšuje. Strop se drží z poslední doby,
  // kdy bylo město v černých číslech — jinak se z podfinancování nedá vylézt.
  const solvent = world.economy.lastIncome - world.economy.lastExpenses >= 0;

  for (const kind of registry.kinds()) {
    const disaster = registry.get(kind);
    const settings = balance.disasters.types[kind];
    if (!disaster || !settings) continue;

    const last = world.disasters.lastOccurrence.get(kind);
    if (last !== undefined && world.tick - last < settings.cooldownTicks) continue;

    const running = world.disasters.active.filter((entry) => entry.kind === kind).length;
    if (running >= concurrentLimit(settings, metrics)) continue;

    if (!meetsConditions(settings, metrics)) continue;

    // Faktor typu je jediné, co roste ze špatné správy města — a jen na něj
    // se strop z R16 vztahuje. Když je rozpočet v černých číslech, strop se
    // posune na aktuální hodnotu; v mínusu zůstane, kde byl.
    const raw = typeFactor(settings, indicators, balance.disasters.maxRiskMultiplier);
    if (solvent) world.disasters.riskCeiling.set(kind, raw);
    const ceiling = solvent
      ? raw
      : (world.disasters.riskCeiling.get(kind) ?? balance.disasters.maxRiskMultiplier);

    const chance = monthlyChance(
      settings,
      metrics,
      indicators,
      world.tick,
      balance.disasters.maxRiskMultiplier,
      ceiling,
    );

    // Hází se **vždycky**, i když je šance nulová. Přeskočený hod by posunul
    // `rng` jinak a stejný seed by dal jiné město podle toho, co hráč postavil.
    if (world.rng.next() >= chance) continue;

    const origin = disaster.pickOrigin(world, catalogue, balance);
    if (!origin) continue;

    startDisaster(world, catalogue, balance, registry, kind, origin.x, origin.y);
  }
}

/**
 * Spustí katastrofu na daném místě.
 *
 * Vystaveno kvůli **menu katastrof**: to nepodléhá ani hájení, ani přepínači
 * z R18 (§6 fáze 4). Je to zároveň jediný rozumný způsob, jak je ladit.
 */
export function startDisaster(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  registry: DisasterRegistry,
  kind: string,
  x: number,
  y: number,
): ActiveDisaster | null {
  const disaster = registry.get(kind);
  if (!disaster) return null;

  const entry: ActiveDisaster = {
    id: world.disasters.nextId++,
    kind,
    startedAtTick: world.tick,
    x,
    y,
    state: {},
    finished: false,
  };

  world.disasters.active.push(entry);
  // Hájení se počítá od vzniku, u povodně a lesního požáru až od skončení.
  if (!disaster.cooldownFromEnd) world.disasters.lastOccurrence.set(kind, world.tick);

  disaster.start(contextFor(world, catalogue, balance, x, y), entry);
  if (disaster.isFinished(world, entry)) entry.finished = true;
  return entry;
}

function contextFor(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  x: number,
  y: number,
): DisasterContext {
  return { world, catalogue, balance, x, y };
}
