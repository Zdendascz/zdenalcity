import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { index, MAP_SIZE } from '../layers';
import { markBuildingDirty } from '../world';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Vodovod (§8 zadání fáze 3).
 *
 * Vypadá to jako elektřina, ale liší se ve třech věcech, a každá z nich je
 * záměr:
 *
 * 1. **Budovy vodu nevedou.** Elektřina teče přes silnice i budovy, voda jen
 *    potrubím. Kdo chce mít pod domem vodu, musí tam potrubí položit. Proto je
 *    to jiná mechanika, ne kopie s jiným jménem.
 * 2. **Síť má dosah.** Voda dojde jen `range` dlaždic od zdroje. Čerpací
 *    stanice je zdroj **bez vlastní výroby**: sama musí být na vodě a rozjíždí
 *    z místa, kde stojí, nový dosah. Tím se síť prodlužuje po skocích, místo
 *    aby jedna vodárna zásobila celou mapu.
 * 3. **Výsledek je runtime, ne vrstva.** `waterSupply` se po načtení savu
 *    spočítá znovu ze zdrojů a potrubí, takže se nemůže rozejít se skutečností.
 *
 * Běží každý tik, ale flood fill pouští jen při `waterNetworkDirty` — stejná
 * úspora jako u elektřiny.
 */
const INTERVAL = 1;
/** Offset 1, aby voda a elektřina nepočítaly flood fill ve stejném tiku. */
const OFFSET = 1;

export function createWaterSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'water',
    interval: INTERVAL,
    offset: OFFSET,
    run(world: WorldState) {
      if (!world.waterNetworkDirty) return;
      world.waterNetworkDirty = false;
      recompute(world, catalogue, balance);
    },
  };
}

interface Source {
  /** Dlaždice, ze kterých zdroj tlačí vodu do potrubí. */
  tiles: number[];
  range: number;
  /** Vyrábí vodu sám (vodárna), nebo jen prodlužuje dosah (čerpací stanice)? */
  produces: boolean;
}

function recompute(world: WorldState, catalogue: BuildingCatalogue, balance: Balance): void {
  const supply = world.waterSupply;
  supply.fill(0);

  // Pořadí podle id, ať je průchod deterministický bez ohledu na to, jak mapa
  // vznikla (P2).
  const ids = [...world.buildings.keys()].sort((a, b) => a - b);
  const sources: Source[] = [];
  let production = 0;

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building || building.abandoned) continue;

    const definition = catalogue.get(building.definitionId);
    const water = definition?.water;
    if (!definition || !water) continue;

    const produced = water.production ?? 0;
    const range = water.range ?? balance.water.defaultRange;
    if (produced <= 0 && range <= 0) continue;

    production += produced;
    sources.push({
      tiles: footprintTiles(building.x, building.y, definition.footprint),
      range,
      produces: produced > 0,
    });
  }

  // Bez jediné vodárny nemá co téct ani nejdelší potrubí.
  if (production > 0) floodFill(world, sources, supply);

  markWateredBuildings(world, catalogue, ids);
}

function footprintTiles(x: number, y: number, footprint: readonly [number, number]): number[] {
  const tiles: number[] = [];
  for (let dy = 0; dy < footprint[1]; dy++) {
    for (let dx = 0; dx < footprint[0]; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < MAP_SIZE && ty < MAP_SIZE) tiles.push(index(tx, ty));
    }
  }
  return tiles;
}

/**
 * Průchod potrubím do šířky, kde se počítá **zbývající dosah**.
 *
 * Dlaždice se smí navštívit znovu, když k ní přiteče voda s větší rezervou —
 * jinak by pořadí zdrojů rozhodovalo o tom, kam síť dosáhne, a výsledek by
 * závisel na tom, co hráč postavil dřív.
 */
function floodFill(world: WorldState, sources: readonly Source[], supply: Uint8Array): void {
  const { pipe } = world.layers;
  const size = world.size;
  const remaining = new Int32Array(pipe.length).fill(-1);
  let frontier: number[] = [];

  for (const source of sources) {
    if (!source.produces) continue; // stanice bez vody nic nerozjede
    for (const tile of source.tiles) {
      if (source.range > remaining[tile]!) {
        remaining[tile] = source.range;
        frontier.push(tile);
      }
    }
  }

  // Čerpací stanice se zapojí, jakmile k ní voda dorazí; proto se prohledávání
  // opakuje, dokud některá stanice přidává dosah.
  const relays = sources.filter((source) => !source.produces);
  const used = new Set<Source>();

  while (frontier.length > 0) {
    const next: number[] = [];

    for (const tile of frontier) {
      const budget = remaining[tile] ?? 0;
      if (budget <= 0) continue;

      const x = tile % size;
      const y = (tile - x) / size;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;

        const at = index(nx, ny);
        if (pipe[at] !== 1) continue;
        if (budget - 1 <= (remaining[at] ?? -1)) continue;

        remaining[at] = budget - 1;
        next.push(at);
      }
    }

    // Stanice, ke které voda dotekla, rozjede vlastní dosah.
    if (next.length === 0) {
      for (const relay of relays) {
        if (used.has(relay)) continue;
        if (!relay.tiles.some((tile) => (remaining[tile] ?? -1) >= 0)) continue;

        used.add(relay);
        for (const tile of relay.tiles) {
          if (relay.range > (remaining[tile] ?? -1)) {
            remaining[tile] = relay.range;
            next.push(tile);
          }
        }
      }
    }

    frontier = next;
  }

  for (let tile = 0; tile < supply.length; tile++) {
    // Zdrojová dlaždice bez potrubí vodu nikam nedá, ale sama ji má.
    if ((remaining[tile] ?? -1) >= 0) supply[tile] = 1;
  }
}

/**
 * Chátrání bez vody (§8 fáze 3).
 *
 * Běží řidčeji než rozvod — je to pomalý tlak, ne trest za jeden tik. Budova,
 * které voda chybí, ztrácí obyvatele; když je prázdná dost dlouho, zůstane po
 * ní ruina. **Jen budovy, které vodu podle definice potřebují**: elektrárna se
 * bez vodovodu obejde.
 */
const DECAY_INTERVAL = 16;
const DECAY_OFFSET = 7;

export function createWaterDecaySystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'waterDecay',
    interval: DECAY_INTERVAL,
    offset: DECAY_OFFSET,
    run(world: WorldState) {
      const { decayStep, abandonAfter } = balance.water;

      for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
        const building = world.buildings.get(id);
        if (!building || building.abandoned) continue;
        if (catalogue.get(building.definitionId)?.construction.requiresWater !== true) continue;

        if (world.watered.has(id)) {
          world.waterlessStreak.delete(id);
          continue;
        }

        const streak = (world.waterlessStreak.get(id) ?? 0) + 1;
        world.waterlessStreak.set(id, streak);

        if (building.population > 0) {
          building.population = Math.max(0, building.population - decayStep);
          markBuildingDirty(world, id);
        } else if (streak >= abandonAfter) {
          // Prázdný dům se po čase vzdá. Ruinu musí zbourat hráč (§8 fáze 2).
          building.abandoned = true;
          building.jobs = 0;
          world.waterlessStreak.delete(id);
          markBuildingDirty(world, id);
        }
      }
    },
  };
}

/**
 * Budova má vodu, když ji má **kterákoli dlaždice jejího půdorysu**.
 *
 * Zapisuje se do `world.watered`, ne do entity: je to odvozený stav, který se
 * po načtení savu spočítá znovu (R10 platí i tady).
 */
function markWateredBuildings(
  world: WorldState,
  catalogue: BuildingCatalogue,
  ids: readonly number[],
): void {
  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;

    const footprint = catalogue.get(building.definitionId)?.footprint ?? [1, 1];
    const watered = footprintTiles(building.x, building.y, footprint).some(
      (tile) => world.waterSupply[tile] === 1,
    );

    const had = world.watered.has(id);
    if (watered === had) continue;

    if (watered) world.watered.add(id);
    else world.watered.delete(id);
    markBuildingDirty(world, id);
  }
}
