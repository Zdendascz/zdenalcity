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

export const CURRENT_FORMAT_VERSION = 8;

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
  /**
   * Potrubí, od verze 5. Přidané **na konec**, takže migrace jen připíše
   * prázdnou vrstvu za stávající bajty — kdyby se vsunulo doprostřed, musel
   * by se `layers.bin` přeskládat jako u zrušené `elevation` ve verzi 4.
   */
  'pipe',
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

/**
 * Pořadí vrstev katastrof v `disasters.bin` (verze 6).
 *
 * Vlastní soubor, ne přílepek k `layers.bin`: sedm vrstev, které umí být celé
 * nulové po celou hru. Kdyby se přilepily doprostřed stávajícího bufferu,
 * musel by se při každé změně přeskládat — a hlavně by se rozbila migrace,
 * která dnes jen připisuje bajty na konec.
 *
 * **Ukládá se i probíhající pohroma** (rozhodnutí autora). Bez toho by si hráč
 * uložil, nechal město shořet a načetl zpátky.
 */
export const SAVE_DISASTER_LAYER_ORDER = [
  'fire',
  'fuel',
  'fireFlags',
  'flood',
  'floodDepth',
  'floodDamage',
  'rubble',
] as const;

export type SaveDisasterLayer = (typeof SAVE_DISASTER_LAYER_ORDER)[number];

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
  /** Vrstvy ohně, povodně a trosek, od verze 6. */
  disasters: 'disasters.bin',
  /**
   * Tik poslední terénní úpravy dlaždice, od verze 8. Vlastní soubor ze
   * stejného důvodu jako `heights.bin`: je **dvoubajtový**, kdežto vrstvy
   * v `disasters.bin` jsou po jednom, a míchat je do jednoho bufferu by
   * znamenalo číst bajty podle toho, co je zrovna v kódu.
   */
  terraform: 'terraform.bin',
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
  /** Katastrofy (verze 6). */
  disasters: SaveDisasterState;
  /** Linky MHD (verze 6). Statistiky se dopočítají, do savu nepatří. */
  transit: SaveTransitState;
  /** Závazky a rating (verze 6). */
  finance: SaveFinanceState;
}

/**
 * Katastrofy v savu (verze 6).
 *
 * Ukládá se **evidence, ne odvozené**: počet hořících dlaždic ani mapa kolejí
 * se nezapisují, po načtení se dopočítají z vrstev a linek.
 */
export interface SaveDisasterState {
  enabled: boolean;
  /** Tik posledního výskytu podle typu. Chybějící klíč znamená „nikdy". */
  lastOccurrence: Readonly<Record<string, number>>;
  active: SaveActiveDisaster[];
  modifiers: SaveModifier[];
  nextId: number;
  /** Nejvyšší dosažený faktor typu v době, kdy nebyl rozpočet v mínusu (R16). */
  riskCeiling: Readonly<Record<string, number>>;
  /** Elektrárny odpojené blackoutem. */
  offlinePlants: number[];
  /** Nakaženost po buňkách, řídce: `[buňka, 0..1]`. */
  infection: [number, number][];
  /**
   * Co na dlaždici stálo, než ji katastrofa srovnala (verze 7).
   *
   * Řídce jako `[dlaždice, definitionId]`. Ukládá se **id, ne číslo** (P6) —
   * a je to jediný důvod, proč to není další vrstva: vrstva by musela nést
   * čísla a ta by po přidání budovy do obsahu znamenala něco jiného.
   */
  rubbleOf: [number, string][];
}

export interface SaveActiveDisaster {
  id: number;
  kind: string;
  startedAtTick: number;
  x: number;
  y: number;
  /**
   * Vlastní stav katastrofy.
   *
   * Save o něm **nic neví** a je to záměr: tvar si určuje implementace pohromy
   * a nový mod si smí přidat vlastní. Ukládá se, jak přišel; kdo mu nerozumí,
   * ten katastrofu při načtení ukončí.
   */
  state: Record<string, unknown>;
  finished: boolean;
}

export interface SaveModifier {
  kind: string;
  serviceClass?: string;
  cells: number[];
  amount: number;
  until: number;
  source: number;
}

export interface SaveTransitState {
  lines: SaveTransitLine[];
  nextLineId: number;
}

export interface SaveTransitLine {
  id: number;
  mode: string;
  stops: number[];
  vehicles: number;
  fare: number;
}

export interface SaveFinanceState {
  loans: SaveLoan[];
  nextLoanId: number;
  bonds: SaveBond[];
  nextBondId: number;
  bondsBlockedUntil: number;
  /** Id přiznaných grantů. Bez nich by se po načtení rozdaly znovu. */
  grantsAwarded: string[];
  /** Rozpracované podmínky s `forTicks`: `[id grantu, tiky v kuse]`. */
  grantProgress: [string, number][];
}

export interface SaveLoan {
  id: number;
  principal: number;
  remaining: number;
  rate: number;
  payment: number;
  termMonths: number;
  paidMonths: number;
}

export interface SaveBond {
  id: number;
  offered: number;
  subscribed: number;
  rate: number;
  issuedAtTick: number;
  maturityTick: number;
  lastCouponTick: number;
  defaulted: boolean;
}

export interface SaveData {
  meta: SaveMeta;
  /** Obsah `layers.bin` — konkatenace vrstev v `SAVE_LAYER_ORDER`. */
  layers: Uint8Array;
  /** Obsah `coarse.bin` — konkatenace vrstev v `SAVE_COARSE_LAYER_ORDER`. */
  coarse: Uint8Array;
  /** Obsah `heights.bin` — patra v rozích, po jednom bajtu (verze 4). */
  heights: Uint8Array;
  /** Obsah `disasters.bin` — vrstvy v `SAVE_DISASTER_LAYER_ORDER` (verze 6). */
  disasters: Uint8Array;
  /** Obsah `terraform.bin` — tik úpravy dlaždice, dva bajty little-endian (verze 8). */
  terraform: Uint8Array;
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
