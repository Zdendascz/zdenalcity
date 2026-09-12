import { strToU8, zipSync } from 'fflate';
import { coarseSizeOf } from '@/sim/coarse';
import type { CoarseLayers } from '@/sim/coarse';
import type { Layers } from '@/sim/layers';
import { totalPopulation } from '@/sim/world';
import type { Ledger } from '@/sim/ledger';
import type { WorldState } from '@/sim/world';
import {
  CURRENT_FORMAT_VERSION,
  GAME_VERSION,
  SAVE_COARSE_LAYER_ORDER,
  SAVE_DISASTER_LAYER_ORDER,
  SAVE_FILES,
  SAVE_LAYER_ORDER,
} from './format';
import type {
  SaveData,
  SaveDisasterState,
  SaveFinanceState,
  SaveSourceInfo,
  SaveTransitState,
} from './format';

export interface SaveOptions {
  cityName: string;
  /** Čas se předává zvenčí — `save/` tak zůstává čistá funkce a fixtury jdou přibít. */
  createdAt: string;
  modifiedAt: string;
  playtimeSeconds: number;
  /** Z `ContentRegistry.getLoadedSources()`. */
  sources: readonly SaveSourceInfo[];
}

/**
 * Vrstvy do jednoho bufferu, každá hodnota **explicitně little-endian**.
 *
 * Zápis přes `DataView` místo pohledu na buffer typed array je záměr: pohled by
 * převzal endianitu stroje a save z ARMu by se na jiné mašině načetl jako šum.
 */
export function packLayers(layers: Layers): Uint8Array {
  // Počet dlaždic se bere z vrstvy, ne z konstanty: od T42 má každý svět svou
  // velikost a save je musí unést všechny.
  let byteLength = 0;
  for (const name of SAVE_LAYER_ORDER) {
    byteLength += layers[name].length * layers[name].BYTES_PER_ELEMENT;
  }

  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  let offset = 0;

  for (const name of SAVE_LAYER_ORDER) {
    const layer = layers[name];
    if (layer.BYTES_PER_ELEMENT === 1) {
      for (const value of layer) {
        view.setUint8(offset, value);
        offset += 1;
      }
    } else if (layer.BYTES_PER_ELEMENT === 4) {
      // Jediná vícebajtová vrstva je `buildingId`, od verze 12 čtyřbajtová.
      for (const value of layer) {
        view.setUint32(offset, value, true);
        offset += 4;
      }
    } else {
      // Jiná šířka je nová verze formátu, ne něco, co se dá zapsat potichu.
      throw new Error(`vrstva ${name} má ${layer.BYTES_PER_ELEMENT} B na dlaždici, save zná 1 a 4`);
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Hrubé vrstvy do jednoho bufferu. Všechny jsou jednobajtové, takže endianita
 * nehraje roli — kdyby některá přestala být, je to nová verze formátu.
 */
export function packCoarseLayers(coarse: CoarseLayers): Uint8Array {
  const cells = coarse.pollution.length;
  const buffer = new Uint8Array(cells * SAVE_COARSE_LAYER_ORDER.length);
  let offset = 0;
  for (const name of SAVE_COARSE_LAYER_ORDER) {
    buffer.set(coarse[name], offset);
    offset += cells;
  }
  return buffer;
}

/**
 * Vrstvy katastrof do jednoho bufferu (verze 6).
 *
 * Všech sedm je jednobajtových. Ukládají se **vždycky**, i když je město celé
 * nedotčené — prázdný buffer se v ZIPu smrskne skoro na nic a podmíněný soubor
 * by znamenal, že se save čte jinak podle toho, co se ve městě zrovna dělo.
 */
/**
 * Tiky terénních úprav do bajtů, **little-endian**.
 *
 * Pořadí bajtů se píše ručně a ne přes `new Uint8Array(buffer)`, protože to
 * druhé závisí na endianitě stroje — save uložený na jednom by se na druhém
 * četl obráceně.
 */
export function packTerraform(world: WorldState): Uint8Array {
  const cells = world.size * world.size;
  const bytes = new Uint8Array(cells * 2);
  for (let tile = 0; tile < cells; tile++) {
    const value = world.terraformTick[tile] ?? 0;
    bytes[tile * 2] = value & 0xff;
    bytes[tile * 2 + 1] = (value >> 8) & 0xff;
  }
  return bytes;
}

export function packDisasterLayers(world: WorldState): Uint8Array {
  const cells = world.size * world.size;
  const buffer = new Uint8Array(cells * SAVE_DISASTER_LAYER_ORDER.length);
  let offset = 0;
  for (const name of SAVE_DISASTER_LAYER_ORDER) {
    buffer.set(world[name], offset);
    offset += cells;
  }
  return buffer;
}

/** Katastrofy do savu. Odvozené se vynechává — dopočítá se po načtení. */
function packDisasters(world: WorldState): SaveDisasterState {
  const state = world.disasters;
  return {
    enabled: state.enabled,
    // Setříděné klíče, ať je save bajtově stabilní.
    lastOccurrence: sortedRecord(state.lastOccurrence),
    active: state.active.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      startedAtTick: entry.startedAtTick,
      x: entry.x,
      y: entry.y,
      state: { ...entry.state },
      finished: entry.finished,
    })),
    modifiers: state.modifiers.map((modifier) => ({
      kind: modifier.kind,
      ...(modifier.serviceClass !== undefined ? { serviceClass: modifier.serviceClass } : {}),
      cells: [...modifier.cells],
      amount: modifier.amount,
      until: modifier.until,
      source: modifier.source,
    })),
    nextId: state.nextId,
    riskCeiling: sortedRecord(state.riskCeiling),
    offlinePlants: [...state.offlinePlants].sort((a, b) => a - b),
    infection: [...world.infection.entries()].sort(([a], [b]) => a - b),
    // Setříděné podle dlaždice, ať je save bajtově stabilní — `Map` si pamatuje
    // pořadí vkládání a to závisí na tom, v jakém pořadí co shořelo.
    rubbleOf: [...world.rubbleOf.entries()].sort(([a], [b]) => a - b),
  };
}

function packTransit(world: WorldState): SaveTransitState {
  return {
    lines: [...world.lines]
      .sort((a, b) => a.id - b.id)
      .map((line) => ({
        id: line.id,
        mode: line.mode,
        stops: [...line.stops],
        vehicles: line.vehicles,
        fare: line.fare,
        paused: line.paused,
      })),
    nextLineId: world.nextLineId,
    // Pořadí podle dlaždice, ať je save z téhož města vždycky stejný.
    lostStops: [...world.lostStops.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tile, lost]) => [
        tile,
        lost.map((entry) => [entry.lineId, entry.index] as [number, number]),
      ]),
  };
}

function packFinance(world: WorldState): SaveFinanceState {
  return {
    loans: [...world.loans].sort((a, b) => a.id - b.id).map((loan) => ({ ...loan })),
    nextLoanId: world.nextLoanId,
    bonds: [...world.bonds].sort((a, b) => a.id - b.id).map((bond) => ({ ...bond })),
    nextBondId: world.nextBondId,
    bondsBlockedUntil: world.bondsBlockedUntil,
    grantsAwarded: [...world.grantsAwarded].sort(),
    grantProgress: [...world.grantProgress.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}

/** Mapa na objekt se setříděnými klíči — save musí být bajtově stabilní. */
function copyLedger(ledger: Ledger): Ledger {
  const sorted = (side: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(side).sort()) out[key] = side[key] ?? 0;
    return out;
  };
  return { year: ledger.year, income: sorted(ledger.income), expenses: sorted(ledger.expenses) };
}

function sortedRecord(map: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function toSaveData(world: WorldState, options: SaveOptions): SaveData {
  return {
    meta: {
      formatVersion: CURRENT_FORMAT_VERSION,
      gameVersion: GAME_VERSION,
      city: { name: options.cityName, seed: world.seed },
      createdAt: options.createdAt,
      modifiedAt: options.modifiedAt,
      playtimeSeconds: options.playtimeSeconds,
      // Explicitní výběr polí, ne spread: `getLoadedSources()` vrací i `name`,
      // které do formátu nepatří a prosáklo by do savu.
      content: {
        sources: options.sources.map(({ id, version }) => ({ id, version })),
      },
      grid: { size: world.size, coarseSize: coarseSizeOf(world.size) },
      map: { ...world.map },
      preview: {
        population: totalPopulation(world.buildings),
        funds: world.economy.funds,
        tick: world.tick,
      },
    },
    layers: packLayers(world.layers),
    coarse: packCoarseLayers(world.coarse),
    // Patra jdou do savu tak, jak jsou: jeden bajt na roh, žádné pořadí vrstev.
    heights: Uint8Array.from(world.cornerHeight),
    terraform: packTerraform(world),
    disasters: packDisasterLayers(world),
    entities: {
      nextBuildingId: world.nextBuildingId,
      // Pořadí podle id, ať je save bajtově stabilní.
      buildings: [...world.buildings.values()]
        .sort((a, b) => a.id - b.id)
        .map((building) => ({ ...building })),
    },
    state: {
      tick: world.tick,
      rngState: world.rng.getState(),
      // Kniha se kopíruje **do hloubky a setříděně**: mělká kopie by nechala
      // v savu odkaz na živý objekt a nesetříděné klíče by dělaly z každého
      // uložení jiné bajty.
      economy: {
        ...world.economy,
        taxRates: { ...world.economy.taxRates },
        ledger: copyLedger(world.economy.ledger),
        lastYear: world.economy.lastYear ? copyLedger(world.economy.lastYear) : null,
      },
      demand: { ...world.demand },
      trafficCursor: world.trafficCursor,
      // Setříděné klíče, ať je save bajtově stabilní.
      serviceFunding: Object.fromEntries(
        [...world.serviceFunding.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      disasters: packDisasters(world),
      transit: packTransit(world),
      finance: packFinance(world),
    },
  };
}

/**
 * Zabalí save do skutečného ZIPu.
 *
 * `meta.json` se ukládá **nekomprimovaně** (`level: 0`), aby se dal přečíst bez
 * dekomprese zbytku — seznam uložených her se tím vykreslí okamžitě (§8).
 *
 * Čas v hlavičkách položek je `meta.modifiedAt`, ne systémový čas. ZIP si ho
 * ukládá u každého souboru, takže bez toho by dva savy téhož města vyšly
 * pokaždé jinak — a fixtura by se nedala vygenerovat znovu a porovnat s tou
 * v repozitáři. Vyplavalo to při psaní fixtury v5 (T40).
 */
export function packSave(save: SaveData): Uint8Array {
  const mtime = save.meta.modifiedAt;
  return zipSync({
    [SAVE_FILES.meta]: [strToU8(JSON.stringify(save.meta, null, 2)), { level: 0, mtime }],
    [SAVE_FILES.layers]: [save.layers, { level: 9, mtime }],
    [SAVE_FILES.coarse]: [save.coarse, { level: 9, mtime }],
    [SAVE_FILES.heights]: [save.heights, { level: 9, mtime }],
    [SAVE_FILES.disasters]: [save.disasters, { level: 9, mtime }],
    [SAVE_FILES.terraform]: [save.terraform, { level: 9, mtime }],
    [SAVE_FILES.entities]: [strToU8(JSON.stringify(save.entities)), { level: 9, mtime }],
    [SAVE_FILES.state]: [strToU8(JSON.stringify(save.state)), { level: 9, mtime }],
  });
}

export function serializeSave(world: WorldState, options: SaveOptions): Uint8Array {
  return packSave(toSaveData(world, options));
}
