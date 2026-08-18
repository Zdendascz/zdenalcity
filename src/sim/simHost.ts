import type { BuildingCatalogue } from './catalogue';
import { buildRoad, bulldoze, placeDefinition, zoneArea } from './commands';
import type { Command } from './commands';
import type { ReadonlyLayers } from './layers';
import type { System } from './systems';
import { createDirtySet, createWorld, tickWorld } from './world';
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
  readonly buildings: ReadonlyMap<number, Readonly<Building>>;
  readonly economy: Readonly<EconomyState>;
  readonly demand: Readonly<DemandState>;
}

/**
 * Fasáda simulace s message-based API už teď, i když běží na main threadu.
 * Až se simulace přesune do Web Workeru, volající kód se nemění.
 */
export interface SimHost {
  dispatch(cmd: Command): void;
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

  constructor(world: WorldState, systems: readonly System[], catalogue: BuildingCatalogue) {
    this.world = world;
    this.systems = systems;
    this.catalogue = catalogue;
  }

  dispatch(cmd: Command): void {
    switch (cmd.type) {
      case 'set_speed': {
        // `speed` je index do SPEEDS (klávesy 0–4), ne násobitel.
        const speedIndex = Math.trunc(cmd.speed);
        if (speedIndex >= 0 && speedIndex < SPEEDS.length) {
          this.speedIndex = speedIndex;
        }
        break;
      }
      case 'build_road':
        buildRoad(this.world, cmd.x, cmd.y);
        break;
      case 'bulldoze':
        bulldoze(this.world, cmd.x, cmd.y);
        break;
      case 'zone':
        zoneArea(this.world, cmd.x, cmd.y, cmd.w, cmd.h, cmd.zone);
        break;
      case 'place_building':
        placeDefinition(this.world, this.catalogue, cmd.definitionId, cmd.x, cmd.y);
        break;
      case 'set_tax_rate':
        break; // T7
      default:
        assertNever(cmd);
    }
  }

  step(deltaMs: number): void {
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
 * Systémy i katalog se předávají zvenčí — `sim/` obsah sám nesestaví. Katalog
 * potřebují elektřina, růst a příkaz `place_building`. Prázdné pole systémů dá
 * čistý svět bez simulace, což využívají testy.
 */
export function createSimHost(
  seed: number,
  systems: readonly System[],
  catalogue: BuildingCatalogue,
): SimHost {
  return new MainThreadSimHost(createWorld(seed), systems, catalogue);
}
