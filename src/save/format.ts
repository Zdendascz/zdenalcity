import type { Layers } from '@/sim/layers';
import type { Building, DemandState, EconomyState } from '@/sim/world';

/**
 * Formát savu a jeho verze (P7).
 *
 * `formatVersion` je v savu od prvního commitu, i když je hra prototyp. Změna
 * čehokoli v tomhle souboru — pořadí vrstev, tvaru sekcí, významu polí —
 * znamená novou verzi a migraci.
 */

export const CURRENT_FORMAT_VERSION = 1;

/** Musí odpovídat `version` v package.json; hlídá to test. */
export const GAME_VERSION = '0.1.0';

/**
 * Pořadí vrstev v `layers.bin`. **Je součástí `formatVersion`** — přeházení
 * nebo doplnění vrstvy je nová verze plus migrace.
 *
 * Schválně je to vlastní seznam, ne `LAYER_ORDER` ze `sim/layers.ts`: ten slouží
 * k hashování a kdyby se změnil, savy by se rozbily potichu.
 */
export const SAVE_LAYER_ORDER = [
  'terrain',
  'elevation',
  'zone',
  'road',
  'buildingId',
  'power',
] as const satisfies readonly (keyof Layers)[];

export const SAVE_FILES = {
  meta: 'meta.json',
  layers: 'layers.bin',
  entities: 'entities.json',
  state: 'state.json',
} as const;

export interface SaveSourceInfo {
  id: string;
  version: string;
}

export interface SaveMeta {
  formatVersion: number;
  gameVersion: string;
  city: { name: string; seed: number };
  createdAt: string;
  modifiedAt: string;
  playtimeSeconds: number;
  content: { sources: SaveSourceInfo[] };
  /** Aby šel seznam uložených her vykreslit bez načtení zbytku savu. */
  preview: { population: number; funds: number; tick: number };
}

export interface SaveEntities {
  nextBuildingId: number;
  buildings: Building[];
}

export interface SaveState {
  tick: number;
  /** Stav RNG, bez něj by načtená hra nebyla deterministická (P2). */
  rngState: number;
  economy: EconomyState;
  demand: DemandState;
}

export interface SaveData {
  meta: SaveMeta;
  /** Obsah `layers.bin` — konkatenace vrstev v `SAVE_LAYER_ORDER`. */
  layers: Uint8Array;
  entities: SaveEntities;
  state: SaveState;
}

/** Nečitelný nebo nesmyslný save. Nikdy tichý pád. */
export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

/** Save z budoucí verze hry, kterou tahle verze neumí. */
export class SaveMigrationError extends Error {
  readonly formatVersion: number;

  constructor(formatVersion: number) {
    super(
      `Save má formatVersion ${formatVersion}, ale tahle verze hry umí nejvýš ${CURRENT_FORMAT_VERSION}. Chybí migrace, nebo je save z novější hry.`,
    );
    this.name = 'SaveMigrationError';
    this.formatVersion = formatVersion;
  }
}
