import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from './catalogue';
import type { ReadonlyCoarseLayers } from './coarse';
import {
  buildPipe,
  buildRoad,
  bulldoze,
  levelArea,
  placeDefinition,
  removePipe,
  setServiceFunding,
  setTaxRate,
  terraformCorner,
  zoneArea,
} from './commands';
import type { Command } from './commands';
import type { ReadonlyLayers } from './layers';
import { OK, reject } from './result';
import type { CommandResult } from './result';
import type { System } from './systems';
import { createDirtySet, tickWorld } from './world';
import type { Building, DemandState, DirtySet, EconomyState, WorldState } from './world';

export const TICK_MS = 250; // 1 tick = 1 herní den při rychlosti 1×
export const SPEEDS = [0, 1, 2, 4, 8] as const; // pauza, 1×, 2×, 4×, 8×
export const MAX_TICKS_PER_FRAME = 8; // ochrana proti spirále smrti

/**
 * Kontrola exhaustivity switche v `dispatch`. Bez ní by nová varianta `Command`
 * tiše propadla a nikdo by si toho nevšiml — takhle je to chyba při typecheku.
 */
function assertNever(cmd: never): never {
  throw new Error(`Neznámý příkaz: ${JSON.stringify(cmd)}`);
}

/** Pohled pro renderer a UI. Nikdy kopie — kopírovat vrstvy každý snímek je zbytečné. */
export interface ReadonlyWorldView {
  readonly size: number;
  readonly seed: number;
  readonly tick: number;
  readonly layers: ReadonlyLayers;
  readonly coarse: ReadonlyCoarseLayers;
  readonly buildings: ReadonlyMap<number, Readonly<Building>>;
  readonly economy: Readonly<EconomyState>;
  readonly demand: Readonly<DemandState>;
  /** Zátěž silnic pro overlay dopravy. Odvozená, do savu nepatří (R10). */
  readonly trafficLoad: Readonly<Float32Array>;
  /** Patra v rozích — bez nich by renderer neuměl naklonit dlaždici (§7 fáze 3). */
  readonly cornerHeight: Readonly<Uint8Array>;
  /** Kam došla voda. Podzemní pohled ji kreslí, jinak se nikde nezobrazuje (§8). */
  readonly waterSupply: Readonly<Uint8Array>;
  /** Spokojenost na hrubé mřížce — hlavní číslo HUDu a vlastní overlay (§9). */
  readonly happiness: Readonly<Uint8Array>;
  /**
   * Intenzita ohně (§4 fáze 4). Není to diagnostická vrstva, kterou si hráč
   * zapíná — renderer ji kreslí vždycky, protože je to věc na okamžitou reakci.
   */
  readonly fire: Readonly<Uint8Array>;
  /** Trosky (R15). Renderer je kreslí vždycky — je to překážka, ne diagnostika. */
  readonly rubble: Readonly<Uint8Array>;
}

/**
 * Fasáda simulace s message-based API už teď, i když běží na main threadu.
 * Až se simulace přesune do Web Workeru, volající kód se nemění.
 */
export interface SimHost {
  /** Vrací výsledek — odmítnutý příkaz musí umět říct proč. */
  dispatch(cmd: Command): CommandResult;
  step(deltaMs: number): void;
  getSnapshot(): ReadonlyWorldView;
  consumeDirty(): DirtySet;
}

class MainThreadSimHost implements SimHost {
  private readonly world: WorldState;
  private readonly systems: readonly System[];
  private readonly catalogue: BuildingCatalogue;
  private accumulator = 0;
  private speedIndex = 1; // 1×

  /** Balanc drží ceny akcí, které nejsou stavbou budovy — třeba kácení lesa. */
  private readonly balance: Balance | undefined;

  constructor(
    world: WorldState,
    systems: readonly System[],
    catalogue: BuildingCatalogue,
    balance?: Balance,
  ) {
    this.world = world;
    this.systems = systems;
    this.catalogue = catalogue;
    this.balance = balance;
  }

  dispatch(cmd: Command): CommandResult {
    switch (cmd.type) {
      case 'set_speed': {
        // `speed` je index do SPEEDS (klávesy 0–4), ne násobitel.
        const speedIndex = Math.trunc(cmd.speed);
        if (speedIndex < 0 || speedIndex >= SPEEDS.length) {
          return reject('error.unknownSpeed', { speed: cmd.speed });
        }
        this.speedIndex = speedIndex;
        return OK;
      }
      case 'build_road':
        return buildRoad(this.world, cmd.x, cmd.y, cmd.roadType, this.balance);
      case 'bulldoze':
        return bulldoze(this.world, cmd.x, cmd.y, this.balance);
      case 'zone':
        return zoneArea(this.world, cmd.x, cmd.y, cmd.w, cmd.h, cmd.zone);
      case 'place_building':
        return placeDefinition(
          this.world,
          this.catalogue,
          cmd.definitionId,
          cmd.x,
          cmd.y,
          this.balance,
        );
      case 'set_tax_rate':
        return setTaxRate(this.world, cmd.zone, cmd.rate);
      case 'build_pipe':
        return buildPipe(this.world, cmd.x, cmd.y, this.balance);
      case 'remove_pipe':
        return removePipe(this.world, cmd.x, cmd.y);
      case 'terraform_corner':
        return terraformCorner(this.world, cmd.x, cmd.y, cmd.delta, this.balance);
      case 'level_area':
        return levelArea(this.world, cmd.x, cmd.y, cmd.w, cmd.h, this.balance, cmd.mode);
      case 'set_service_funding':
        return setServiceFunding(this.world, cmd.serviceClass, cmd.funding);
      default:
        return assertNever(cmd);
    }
  }

  step(deltaMs: number): void {
    // Nečíselná delta je jed: `accumulator` z ní zůstane NaN, porovnání s
    // TICK_MS je pak navždy false a hra se tiše zastaví, aniž by cokoli
    // spadlo. Radši spadneme hned a hlasitě u viníka.
    if (!Number.isFinite(deltaMs)) {
      throw new Error(`SimHost.step dostal nečíselnou deltu: ${String(deltaMs)}`);
    }

    // Záporná delta by akumulátor vracela zpět; rAF ji dodat nemá, ale kdyby ano,
    // je to chyba volajícího, ne důvod rozhodit časování.
    if (deltaMs <= 0) return;

    this.accumulator += deltaMs * (SPEEDS[this.speedIndex] ?? 0);

    let ticksThisFrame = 0;
    while (this.accumulator >= TICK_MS && ticksThisFrame < MAX_TICKS_PER_FRAME) {
      tickWorld(this.world, this.systems);
      this.accumulator -= TICK_MS;
      ticksThisFrame++;
    }
    if (ticksThisFrame === MAX_TICKS_PER_FRAME) {
      this.accumulator = 0; // zahoď skluz, jinak se hra utopí v dohánění
    }
  }

  getSnapshot(): ReadonlyWorldView {
    return this.world;
  }

  consumeDirty(): DirtySet {
    const dirty = this.world.dirty;
    this.world.dirty = createDirtySet();
    return dirty;
  }
}

/**
 * Svět, systémy i katalog se předávají zvenčí.
 *
 * Host svět **nevytváří** schválně: kdo ho vlastní, může ho dát i save vrstvě,
 * takže `sim/` nemusí znát formát savu. Prázdné pole systémů dá čistý svět bez
 * simulace, což využívají testy.
 */
export function createSimHost(
  world: WorldState,
  systems: readonly System[],
  catalogue: BuildingCatalogue,
  balance?: Balance,
): SimHost {
  return new MainThreadSimHost(world, systems, catalogue, balance);
}
