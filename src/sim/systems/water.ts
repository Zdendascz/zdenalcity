import { parcelConducts } from '../conduct';
import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { strongestModifier } from '../disasters/effects';
import { index } from '../layers';
import { isFlooded } from '../disasters/flood';
import { markBuildingDirty, markNetworksDirty, markTileDirty } from '../world';
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
  // Předchozí stav si necháme, aby šlo označit **jen to, co se změnilo**.
  // Podzemní pohled pokrytí kreslí, takže bez toho by na obrazovce zůstala
  // stará voda, dokud hráč nesáhne na dlaždici jinak.
  const before = Uint8Array.from(supply);
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

    // Zamořená vodárna **nedodává** (katalog 15). Rozvod zůstane, jen do něj
    // nic neteče — a to je celá druhá polovina chemické havárie: budovy začnou
    // chátrat dva měsíce po ní, kdy už si na ni nikdo nevzpomene.
    if (produced > 0 && isContaminated(world, building.x, building.y)) continue;

    production += produced;
    sources.push({
      tiles: footprintTiles(
        world.size,
        building.x,
        building.y,
        definition.footprint,
      ),
      range,
      produces: produced > 0,
    });
  }

  // Bez jediné vodárny nemá co téct ani nejdelší potrubí.
  const pressure = production > 0 ? floodFill(world, sources, supply) : null;

  markChangedTiles(world, before, supply);
  markWateredBuildings(world, catalogue, ids, balance, production, pressure);
}

/** Je vodárna v zamořené buňce? */
function isContaminated(world: WorldState, x: number, y: number): boolean {
  if (world.disasters.modifiers.length === 0) return false;
  const cell = coarseIndex(x, y, world.size);
  return strongestModifier(world, 'contaminateWater', cell, 0, undefined, Math.max) > 0;
}

/** Označí dlaždice, kterým voda přibyla nebo zmizela. */
function markChangedTiles(world: WorldState, before: Uint8Array, after: Uint8Array): void {
  for (let tile = 0; tile < after.length; tile++) {
    if (before[tile] === after[tile]) continue;
    const x = tile % world.size;
    markTileDirty(world, x, (tile - x) / world.size);
  }
}

function footprintTiles(
  size: number,
  x: number,
  y: number,
  footprint: readonly [number, number],
): number[] {
  const tiles: number[] = [];
  for (let dy = 0; dy < footprint[1]; dy++) {
    for (let dx = 0; dx < footprint[0]; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < size && ty < size)
        tiles.push(index(tx, ty, size));
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
function floodFill(
  world: WorldState,
  sources: readonly Source[],
  supply: Uint8Array,
): Int32Array {
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

        const at = index(nx, ny, size);
        // Vodu vede potrubí a od T129 i souvislý blok zón a budov sám.
        // Blok dosah **nežere**: je to rozvod uvnitř parcel, hráč ho
        // nestavěl a nemá platit za to, že má velkou čtvrť. Dosah ubírá
        // jen potrubí, tedy spojky mezi bloky.
        const parcel = parcelConducts(world, at);
        if (pipe[at] !== 1 && !parcel) continue;
        // Zaplavené potrubí nevede vodu (§5 fáze 4).
        if (isFlooded(world, at)) continue;
        const left = parcel && pipe[at] !== 1 ? budget : budget - 1;
        if (left <= (remaining[at] ?? -1)) continue;

        remaining[at] = left;
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

  // Zbývající dosah je zároveň **tlak**: čím vyšší číslo, tím blíž ke zdroji.
  // Používá ho rozdělení kapacity — když voda nestačí na všechny, uschne
  // nejdřív konec sítě, ne náhodná budova uprostřed města.
  return remaining;
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
          // Ruina nevede proud ani vodu (T129).
          markNetworksDirty(world);
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
  balance: Balance,
  production: number,
  pressure: Int32Array | null,
): void {
  // Nejdřív kdo je na síti a s jakým tlakem, teprve pak kdo se vejde do
  // kapacity. Bez druhého kroku byla `water.production` jen vypínač.
  const connected: { id: number; demand: number; pressure: number }[] = [];

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;

    const definition = catalogue.get(building.definitionId);
    const footprint = definition?.footprint ?? [1, 1];
    const tiles = footprintTiles(world.size, building.x, building.y, footprint);
    if (!tiles.some((tile) => world.waterSupply[tile] === 1)) {
      if (world.watered.delete(id)) markBuildingDirty(world, id);
      continue;
    }

    // Tlak budovy je ten nejlepší pod jejím půdorysem — stačí, aby k ní
    // trubka vedla jedním rohem, takže se počítá stejně jako připojení.
    let best = -1;
    for (const tile of tiles) {
      const value = pressure?.[tile] ?? 0;
      if (value > best) best = value;
    }

    connected.push({
      id,
      demand:
        building.population * balance.water.perCitizen +
        building.jobs * balance.water.perWorker,
      pressure: best,
    });
  }

  /*
   * Rozdělení kapacity.
   *
   * Voda teče **od zdroje k okraji**, takže když jí není dost, uschne konec
   * sítě. Řadí se proto podle tlaku sestupně a při shodě podle `id`, aby
   * výsledek nezávisel na pořadí v mapě (P2). Vodárna sama vodu nespotřebuje
   * a nikdy nevyschne — jinak by se odpojila a s ní i celé město.
   */
  connected.sort((a, b) => (b.pressure - a.pressure) || (a.id - b.id));

  let used = 0;
  for (const entry of connected) {
    const definition = catalogue.get(world.buildings.get(entry.id)?.definitionId ?? '');
    const source = (definition?.water?.production ?? 0) > 0;
    if (!source) {
      used += entry.demand;
      if (used > production) {
        if (world.watered.delete(entry.id)) markBuildingDirty(world, entry.id);
        continue;
      }
    }
    if (!world.watered.has(entry.id)) {
      world.watered.add(entry.id);
      markBuildingDirty(world, entry.id);
    }
  }
}
