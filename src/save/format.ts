import type { CoarseLayers } from '@/sim/coarse';
import type { Layers } from '@/sim/layers';
import type { Building, DemandState, EconomyState } from '@/sim/world';

/**
 * Formát savu a jeho verze (P7).
 *
 * `formatVersion` je v savu od prvního commitu, i když je hra prototyp. Změna
 * čehokoli v tomhle souboru — pořadí vrstev, tvaru sekcí, významu polí —
 * znamená novou verzi a migraci.
 */

export const CURRENT_FORMAT_VERSION = 4;

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
  'zone',
  'road',
  'buildingId',
  'power',
] as const satisfies readonly (keyof Layers)[];

/**
 * Pořadí hrubých vrstev v `coarse.bin` (verze 2). Vlastní seznam ze stejného
 * důvodu jako `SAVE_LAYER_ORDER` — kdyby se vzalo pořadí z `sim/coarse.ts`,
 * jeho změna by savy rozbila potichu.
 */
export const SAVE_COARSE_LAYER_ORDER = [
  'pollution',
  'landValue',
  'crime',
] as const satisfies readonly (keyof CoarseLayers)[];

export const SAVE_FILES = {
  meta: 'meta.json',
  layers: 'layers.bin',
  /** Hrubé vrstvy, od verze 2. */
  coarse: 'coarse.bin',
  /**
   * Patra v rozích, od verze 4. Vlastní soubor, ne přílepek k `layers.bin`:
   * mřížka rohů je o jedna větší než mřížka dlaždic, takže míchat je do
   * jednoho bufferu by znamenalo číst bajty podle toho, co je zrovna v kódu.
   */
  heights: 'heights.bin',
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
  /**
   * Rozměry mřížek. Do verze 1 byla velikost `layers.bin` implicitní; s hrubou
   * mřížkou to přestalo platit, takže si save nese, na co se ty bajty čtou.
   * Save verze 1 ji nemá — doplní ji migrace.
   */
  grid?: { size: number; coarseSize: number };
  /**
   * Odkud se vzala mapa (verze 3). Seed stačí k tomu, aby šel terén
   * vygenerovat znovu; parametry generátoru jsou v balancu, a ten je obsah —
   * eviduje ho `content.sources`.
   *
   * Starší save ji nemá: migrace ji doplní nulou a mapu prohlásí za ruční,
   * protože v době verze 2 žádný generátor neexistoval.
   */
  map?: { seed: number; generated: boolean };
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
  /** Financování tříd služeb, 0–1. Chybějící klíč znamená plné (verze 2). */
  serviceFunding: Readonly<Record<string, number>>;
  /**
   * Kde skončilo vzorkování dopravy (verze 3). Jediná věc z celé dopravy, která
   * do savu patří — zbytek je odvozený a po načtení se přepočítá (R10). Bez
   * kurzoru by se po loadu začalo vzorkovat od začátku a determinismus by padl.
   */
  trafficCursor: number;
}

export interface SaveData {
  meta: SaveMeta;
  /** Obsah `layers.bin` — konkatenace vrstev v `SAVE_LAYER_ORDER`. */
  layers: Uint8Array;
  /** Obsah `coarse.bin` — konkatenace vrstev v `SAVE_COARSE_LAYER_ORDER`. */
  coarse: Uint8Array;
  /** Obsah `heights.bin` — patra v rozích, po jednom bajtu (verze 4). */
  heights: Uint8Array;
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
