import { strToU8, zipSync } from 'fflate';
import { COARSE_CELLS, COARSE_SIZE } from '@/sim/coarse';
import type { CoarseLayers } from '@/sim/coarse';
import { MAP_SIZE } from '@/sim/layers';
import type { Layers } from '@/sim/layers';
import { totalPopulation } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import {
  CURRENT_FORMAT_VERSION,
  GAME_VERSION,
  SAVE_COARSE_LAYER_ORDER,
  SAVE_FILES,
  SAVE_LAYER_ORDER,
} from './format';
import type { SaveData, SaveSourceInfo } from './format';

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
  const cells = MAP_SIZE * MAP_SIZE;
  let byteLength = 0;
  for (const name of SAVE_LAYER_ORDER) {
    byteLength += cells * layers[name].BYTES_PER_ELEMENT;
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
    } else {
      for (const value of layer) {
        view.setUint16(offset, value, true);
        offset += 2;
      }
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Hrubé vrstvy do jednoho bufferu. Všechny jsou jednobajtové, takže endianita
 * nehraje roli — kdyby některá přestala být, je to nová verze formátu.
 */
export function packCoarseLayers(coarse: CoarseLayers): Uint8Array {
  const buffer = new Uint8Array(COARSE_CELLS * SAVE_COARSE_LAYER_ORDER.length);
  let offset = 0;
  for (const name of SAVE_COARSE_LAYER_ORDER) {
    buffer.set(coarse[name], offset);
    offset += COARSE_CELLS;
  }
  return buffer;
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
      grid: { size: MAP_SIZE, coarseSize: COARSE_SIZE },
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
      economy: { ...world.economy, taxRates: { ...world.economy.taxRates } },
      demand: { ...world.demand },
      trafficCursor: world.trafficCursor,
      // Setříděné klíče, ať je save bajtově stabilní.
      serviceFunding: Object.fromEntries(
        [...world.serviceFunding.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}

/**
 * Zabalí save do skutečného ZIPu.
 *
 * `meta.json` se ukládá **nekomprimovaně** (`level: 0`), aby se dal přečíst bez
 * dekomprese zbytku — seznam uložených her se tím vykreslí okamžitě (§8).
 */
export function packSave(save: SaveData): Uint8Array {
  return zipSync({
    [SAVE_FILES.meta]: [strToU8(JSON.stringify(save.meta, null, 2)), { level: 0 }],
    [SAVE_FILES.layers]: [save.layers, { level: 9 }],
    [SAVE_FILES.coarse]: [save.coarse, { level: 9 }],
    [SAVE_FILES.heights]: [save.heights, { level: 9 }],
    [SAVE_FILES.entities]: [strToU8(JSON.stringify(save.entities)), { level: 9 }],
    [SAVE_FILES.state]: [strToU8(JSON.stringify(save.state)), { level: 9 }],
  });
}

export function serializeSave(world: WorldState, options: SaveOptions): Uint8Array {
  return packSave(toSaveData(world, options));
}
