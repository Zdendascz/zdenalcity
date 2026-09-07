import { strFromU8, unzipSync } from 'fflate';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { coarseCellsOf } from '@/sim/coarse';
import { cornerCellsOf } from '@/sim/heights';
import type { CoarseLayers } from '@/sim/coarse';
import type { Layers } from '@/sim/layers';
import { Rng } from '@/sim/rng';
import { RCI_CATEGORIES } from '@/sim/rci';
import { NEUTRAL_HAPPINESS, rebuildTileIndex, resizeWorld } from '@/sim/world';
import type {
  Building,
  DemandState,
  EconomyState,
  WorldState,
} from '@/sim/world';
import {
  SAVE_COARSE_LAYER_ORDER,
  SAVE_DISASTER_LAYER_ORDER,
  SAVE_FILES,
  SAVE_LAYER_ORDER,
  SaveFormatError,
} from './format';
import type {
  SaveData,
  SaveDisasterState,
  SaveEntities,
  SaveFinanceState,
  SaveMeta,
  SaveSourceInfo,
  SaveState,
  SaveTransitState,
} from './format';
import { rememberPopulation } from '@/sim/finance';
import { noLosses, repairUnsupportedRoads } from '@/sim/disasters/damage';
import { countBurning } from '@/sim/disasters/fire';
import type { Modifier } from '@/sim/disasters/state';

function fail(message: string): never {
  throw new SaveFormatError(message);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${what} musí být objekt`);
  }
  return value as Record<string, unknown>;
}

function num(container: Record<string, unknown>, key: string, what: string): number {
  const value = container[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${what}.${key} musí být číslo`);
  }
  return value;
}

function int(container: Record<string, unknown>, key: string, what: string): number {
  const value = num(container, key, what);
  if (!Number.isInteger(value)) fail(`${what}.${key} musí být celé číslo`);
  return value;
}

function str(container: Record<string, unknown>, key: string, what: string): string {
  const value = container[key];
  if (typeof value !== 'string') fail(`${what}.${key} musí být řetězec`);
  return value;
}

function bool(container: Record<string, unknown>, key: string, what: string): boolean {
  const value = container[key];
  if (typeof value !== 'boolean') fail(`${what}.${key} musí být true nebo false`);
  return value;
}

function parseJson(bytes: Uint8Array | undefined, what: string): Record<string, unknown> {
  if (!bytes) fail(`v savu chybí ${what}`);
  try {
    return asRecord(JSON.parse(strFromU8(bytes)), what);
  } catch (error) {
    if (error instanceof SaveFormatError) throw error;
    fail(`${what} není platný JSON`);
  }
}


/**
 * Katastrofy ze savu (verze 6).
 *
 * Vlastní stav pohromy se **nekontroluje**: jeho tvar si určuje implementace
 * a mod si smí přidat vlastní. Bere se, jak přišel — kdo mu nerozumí, ten
 * katastrofu při načtení ukončí (dělá to plánovač).
 */
function parseDisasters(raw: Record<string, unknown>): SaveDisasterState {
  const what = 'state.disasters';
  const active = asArray(raw['active'], `${what}.active`).map((value, i) => {
    const entry = asRecord(value, `${what}.active[${i}]`);
    return {
      id: int(entry, 'id', `${what}.active[${i}]`),
      kind: str(entry, 'kind', `${what}.active[${i}]`),
      startedAtTick: int(entry, 'startedAtTick', `${what}.active[${i}]`),
      x: int(entry, 'x', `${what}.active[${i}]`),
      y: int(entry, 'y', `${what}.active[${i}]`),
      state: asRecord(entry['state'], `${what}.active[${i}].state`),
      finished: bool(entry, 'finished', `${what}.active[${i}]`),
    };
  });

  const modifiers = asArray(raw['modifiers'], `${what}.modifiers`).map((value, i) => {
    const entry = asRecord(value, `${what}.modifiers[${i}]`);
    const serviceClass = entry['serviceClass'];
    if (serviceClass !== undefined && typeof serviceClass !== 'string') {
      fail(`${what}.modifiers[${i}].serviceClass musí být řetězec`);
    }
    return {
      kind: str(entry, 'kind', `${what}.modifiers[${i}]`),
      ...(serviceClass !== undefined ? { serviceClass } : {}),
      cells: numberArray(entry['cells'], `${what}.modifiers[${i}].cells`),
      amount: num(entry, 'amount', `${what}.modifiers[${i}]`),
      until: int(entry, 'until', `${what}.modifiers[${i}]`),
      source: int(entry, 'source', `${what}.modifiers[${i}]`),
    };
  });

  return {
    enabled: bool(raw, 'enabled', what),
    lastOccurrence: numberRecord(raw['lastOccurrence'], `${what}.lastOccurrence`),
    active,
    modifiers,
    nextId: int(raw, 'nextId', what),
    riskCeiling: numberRecord(raw['riskCeiling'], `${what}.riskCeiling`),
    offlinePlants: numberArray(raw['offlinePlants'], `${what}.offlinePlants`),
    infection: pairArray(raw['infection'], `${what}.infection`),
    // Verze 7. Starší save paměť trosek nemá a je to v pořádku — hromady po
    // něm zůstanou bezejmenné, ne že by se hra odmítla načíst.
    rubbleOf:
      raw['rubbleOf'] === undefined
        ? []
        : tileIdPairs(raw['rubbleOf'], `${what}.rubbleOf`),
  };
}

function parseTransit(raw: Record<string, unknown>): SaveTransitState {
  const what = 'state.transit';
  return {
    lines: asArray(raw['lines'], `${what}.lines`).map((value, i) => {
      const line = asRecord(value, `${what}.lines[${i}]`);
      return {
        id: int(line, 'id', `${what}.lines[${i}]`),
        mode: str(line, 'mode', `${what}.lines[${i}]`),
        stops: numberArray(line['stops'], `${what}.lines[${i}].stops`),
        vehicles: int(line, 'vehicles', `${what}.lines[${i}]`),
        fare: num(line, 'fare', `${what}.lines[${i}]`),
        // **Shovívavě**: `paused` přibylo ve v9 a starší save ho nemá.
        // Parsuje se dřív než migrace, takže by na něm jinak spadl v1 až v8.
        paused: line['paused'] === undefined ? false : bool(line, 'paused', `${what}.lines[${i}]`),
      };
    }),
    nextLineId: int(raw, 'nextLineId', what),
  };
}

function parseFinance(raw: Record<string, unknown>): SaveFinanceState {
  const what = 'state.finance';
  return {
    loans: asArray(raw['loans'], `${what}.loans`).map((value, i) => {
      const loan = asRecord(value, `${what}.loans[${i}]`);
      const where = `${what}.loans[${i}]`;
      return {
        id: int(loan, 'id', where),
        principal: int(loan, 'principal', where),
        remaining: int(loan, 'remaining', where),
        rate: num(loan, 'rate', where),
        payment: int(loan, 'payment', where),
        termMonths: int(loan, 'termMonths', where),
        paidMonths: int(loan, 'paidMonths', where),
      };
    }),
    nextLoanId: int(raw, 'nextLoanId', what),
    bonds: asArray(raw['bonds'], `${what}.bonds`).map((value, i) => {
      const bond = asRecord(value, `${what}.bonds[${i}]`);
      const where = `${what}.bonds[${i}]`;
      return {
        id: int(bond, 'id', where),
        offered: int(bond, 'offered', where),
        subscribed: int(bond, 'subscribed', where),
        rate: num(bond, 'rate', where),
        issuedAtTick: int(bond, 'issuedAtTick', where),
        maturityTick: int(bond, 'maturityTick', where),
        lastCouponTick: int(bond, 'lastCouponTick', where),
        defaulted: bool(bond, 'defaulted', where),
      };
    }),
    nextBondId: int(raw, 'nextBondId', what),
    bondsBlockedUntil: int(raw, 'bondsBlockedUntil', what),
    grantsAwarded: asArray(raw['grantsAwarded'], `${what}.grantsAwarded`).map((value, i) => {
      if (typeof value !== 'string') fail(`${what}.grantsAwarded[${i}] musí být řetězec`);
      return value;
    }),
    grantProgress: asArray(raw['grantProgress'], `${what}.grantProgress`).map((value, i) => {
      const pair = asArray(value, `${what}.grantProgress[${i}]`);
      const [id, ticks] = pair;
      if (typeof id !== 'string' || typeof ticks !== 'number' || !Number.isInteger(ticks)) {
        fail(`${what}.grantProgress[${i}] musí být [řetězec, celé číslo]`);
      }
      return [id, ticks] as [string, number];
    }),
  };
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} musí být pole`);
  return value;
}

function numberArray(value: unknown, what: string): number[] {
  return asArray(value, what).map((item, i) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      fail(`${what}[${i}] musí být číslo`);
    }
    return item;
  });
}

function numberRecord(value: unknown, what: string): Record<string, number> {
  const record = asRecord(value, what);
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      fail(`${what}.${key} musí být číslo`);
    }
    out[key] = item;
  }
  return out;
}

/** Řídká mapa `dlaždice → id definice`. Id je řetězec (P6), ne číslo. */
function tileIdPairs(value: unknown, what: string): [number, string][] {
  return asArray(value, what).map((item, i) => {
    const pair = asArray(item, `${what}[${i}]`);
    const [tile, id] = pair;
    if (typeof tile !== 'number' || typeof id !== 'string') {
      fail(`${what}[${i}] musí být [dlaždice, id definice]`);
    }
    return [tile, id] as [number, string];
  });
}

function pairArray(value: unknown, what: string): [number, number][] {
  return asArray(value, what).map((item, i) => {
    const pair = asArray(item, `${what}[${i}]`);
    const [a, b] = pair;
    if (typeof a !== 'number' || typeof b !== 'number') {
      fail(`${what}[${i}] musí být dvojice čísel`);
    }
    return [a, b] as [number, number];
  });
}

export function parseMeta(raw: Record<string, unknown>): SaveMeta {
  const city = asRecord(raw['city'], 'meta.city');
  const content = asRecord(raw['content'], 'meta.content');
  const preview = asRecord(raw['preview'], 'meta.preview');

  const rawSources = content['sources'];
  if (!Array.isArray(rawSources)) fail('meta.content.sources musí být pole');

  const sources: SaveSourceInfo[] = rawSources.map((entry, i) => {
    const source = asRecord(entry, `meta.content.sources[${i}]`);
    return {
      id: str(source, 'id', `meta.content.sources[${i}]`),
      version: str(source, 'version', `meta.content.sources[${i}]`),
    };
  });

  // Rozměry mřížek nese až verze 2; ve verzi 1 je doplní migrace.
  let grid: SaveMeta['grid'];
  if (raw['grid'] !== undefined) {
    const rawGrid = asRecord(raw['grid'], 'meta.grid');
    grid = {
      size: int(rawGrid, 'size', 'meta.grid'),
      coarseSize: int(rawGrid, 'coarseSize', 'meta.grid'),
    };
  }

  // Původ mapy nese až verze 3; ve starším savu ho doplní migrace.
  let map: SaveMeta['map'];
  if (raw['map'] !== undefined) {
    const rawMap = asRecord(raw['map'], 'meta.map');
    map = {
      seed: int(rawMap, 'seed', 'meta.map'),
      generated: bool(rawMap, 'generated', 'meta.map'),
    };
  }

  return {
    formatVersion: int(raw, 'formatVersion', 'meta'),
    ...(grid ? { grid } : {}),
    ...(map ? { map } : {}),
    gameVersion: str(raw, 'gameVersion', 'meta'),
    city: { name: str(city, 'name', 'meta.city'), seed: int(city, 'seed', 'meta.city') },
    createdAt: str(raw, 'createdAt', 'meta'),
    modifiedAt: str(raw, 'modifiedAt', 'meta'),
    playtimeSeconds: num(raw, 'playtimeSeconds', 'meta'),
    content: { sources },
    preview: {
      population: int(preview, 'population', 'meta.preview'),
      funds: int(preview, 'funds', 'meta.preview'),
      tick: int(preview, 'tick', 'meta.preview'),
    },
  };
}

function parseEntities(raw: Record<string, unknown>): SaveEntities {
  const rawBuildings = raw['buildings'];
  if (!Array.isArray(rawBuildings)) fail('entities.buildings musí být pole');

  const buildings: Building[] = rawBuildings.map((entry, i) => {
    const where = `entities.buildings[${i}]`;
    const building = asRecord(entry, where);
    return {
      id: int(building, 'id', where),
      // P6: v savu je vždycky string s namespace, nikdy číselný index definice.
      definitionId: str(building, 'definitionId', where),
      x: int(building, 'x', where),
      y: int(building, 'y', where),
      level: int(building, 'level', where),
      population: int(building, 'population', where),
      jobs: int(building, 'jobs', where),
      powered: bool(building, 'powered', where),
      builtAtTick: int(building, 'builtAtTick', where),
      // Verze 1 tahle pole nenese. Hodnoty pro starý save nastavuje **migrace**
      // (§11), tady je jen zástupná výplň, aby šel formát parsovat do jednoho
      // tvaru v paměti.
      levelChangedAtTick: building['levelChangedAtTick'] === undefined
        ? 0
        : int(building, 'levelChangedAtTick', where),
      abandoned: building['abandoned'] === undefined ? false : bool(building, 'abandoned', where),
    };
  });

  return { nextBuildingId: int(raw, 'nextBuildingId', 'entities'), buildings };
}

/** Prázdné katastrofy pro save, který je ještě nenese. */
function emptyDisasters(): SaveDisasterState {
  return {
    enabled: true,
    lastOccurrence: {},
    active: [],
    modifiers: [],
    nextId: 1,
    riskCeiling: {},
    offlinePlants: [],
    infection: [],
    rubbleOf: [],
  };
}

function emptyFinance(): SaveFinanceState {
  return {
    loans: [],
    nextLoanId: 1,
    bonds: [],
    nextBondId: 1,
    bondsBlockedUntil: 0,
    grantsAwarded: [],
    grantProgress: [],
  };
}

/**
 * Od téhle verze nese save celou fázi 4. Předává se z `meta`, protože stav
 * sám o sobě neví, jak je starý.
 */
const PHASE_FOUR_VERSION = 6;

function parseState(
  raw: Record<string, unknown>,
  formatVersion: number = PHASE_FOUR_VERSION,
): SaveState {
  const hasPhaseFour = formatVersion >= PHASE_FOUR_VERSION;
  const economyRaw = asRecord(raw['economy'], 'state.economy');
  const taxRatesRaw = asRecord(economyRaw['taxRates'], 'state.economy.taxRates');
  const demandRaw = asRecord(raw['demand'], 'state.demand');

  const taxRates = {} as EconomyState['taxRates'];
  const demand = {} as DemandState;
  for (const category of RCI_CATEGORIES) {
    taxRates[category] = int(taxRatesRaw, category, 'state.economy.taxRates');
    demand[category] = num(demandRaw, category, 'state.demand');
  }

  const rngState = int(raw, 'rngState', 'state');
  if (rngState < 0 || rngState > 0xffffffff) fail('state.rngState musí být uint32');

  // Financování tříd nese až verze 2; prázdná mapa znamená všem 100 %.
  const serviceFunding: Record<string, number> = {};
  if (raw['serviceFunding'] !== undefined) {
    const rawFunding = asRecord(raw['serviceFunding'], 'state.serviceFunding');
    for (const key of Object.keys(rawFunding).sort()) {
      const value = num(rawFunding, key, 'state.serviceFunding');
      if (value < 0 || value > 1) fail(`state.serviceFunding.${key} musí být v rozsahu 0–1`);
      serviceFunding[key] = value;
    }
  }

  // Kurzor vzorkování dopravy nese až verze 3; staršímu savu ho doplní migrace.
  const trafficCursor = raw['trafficCursor'] === undefined ? 0 : int(raw, 'trafficCursor', 'state');
  if (trafficCursor < 0) fail('state.trafficCursor nesmí být záporný');

  return {
    serviceFunding,
    trafficCursor,
    tick: int(raw, 'tick', 'state'),
    rngState,
    // Katastrofy, linky a finance nese až verze 6. Starší save je nemá a
    // doplní mu je migrace — proto se u něj **nevyžadují**. U verze 6 a výš ale
    // ano: chybějící sekce je poškozený soubor, ne starý formát, a tiše ho
    // načíst jako prázdný by znamenalo, že hráč přijde o linky a dluhy, aniž
    // by se dozvěděl proč.
    disasters: hasPhaseFour
      ? parseDisasters(asRecord(raw['disasters'], 'state.disasters'))
      : emptyDisasters(),
    transit: hasPhaseFour
      ? parseTransit(asRecord(raw['transit'], 'state.transit'))
      : { lines: [], nextLineId: 1 },
    finance: hasPhaseFour
      ? parseFinance(asRecord(raw['finance'], 'state.finance'))
      : emptyFinance(),
    economy: {
      funds: int(economyRaw, 'funds', 'state.economy'),
      taxRates,
      lastIncome: int(economyRaw, 'lastIncome', 'state.economy'),
      lastExpenses: int(economyRaw, 'lastExpenses', 'state.economy'),
      // Rating nese až verze 6. Starší save ho nemá a probouzí se s čistým
      // štítem — což je milosrdnější než nula a hlavně to nepředstírá, že si
      // formát pamatuje něco, co v něm není.
      creditRating:
        economyRaw['creditRating'] === undefined
          ? 1
          : num(economyRaw, 'creditRating', 'state.economy'),
      // Populace pro měření růstu je odvozená z budov — `applySaveToWorld` ji
      // stejně dopočítá, tohle je jen aby prošel round-trip stavu.
      lastPopulation:
        economyRaw['lastPopulation'] === undefined
          ? 0
          : int(economyRaw, 'lastPopulation', 'state.economy'),
    },
    demand,
  };
}

/**
 * Hrana mapy, na kterou je save uložený.
 *
 * `meta.grid` je v typu volitelné, protože verze 1 ho neměla — jenže tam se
 * dostane až po migraci, která ho vždycky doplní. Kdyby chybělo tady, je to
 * chyba migrací, ne vada savu, a mlčky dosadit 128 by znamenalo číst cizí mapu
 * jako by byla naše.
 */
export function saveMapSize(meta: SaveMeta): number {
  const size = meta.grid?.size;
  if (size === undefined)
    fail('v savu chybí meta.grid.size — save neprošel migrací');
  return size;
}

/**
 * Očekávaná délka `coarse.bin`: tři jednobajtové vrstvy na hrubé mřížce.
 *
 * `size` je hrana **mapy**, ne hrubé mřížky — od T42 ji nese `meta.grid.size`
 * a save z mapy 512 × 512 je jinak dlouhý než ze 128 × 128.
 */
export function expectedCoarseByteLength(size: number): number {
  return coarseCellsOf(size) * SAVE_COARSE_LAYER_ORDER.length;
}

export function unpackCoarseInto(
  bytes: Uint8Array,
  coarse: CoarseLayers,
  size: number,
): void {
  const cells = coarseCellsOf(size);
  if (bytes.byteLength !== expectedCoarseByteLength(size)) {
    fail(
      `coarse.bin má ${bytes.byteLength} B, čekalo se ${expectedCoarseByteLength(size)} B — jiná velikost hrubé mřížky nebo jiná sada vrstev`,
    );
  }

  let offset = 0;
  for (const name of SAVE_COARSE_LAYER_ORDER) {
    coarse[name].set(bytes.subarray(offset, offset + cells));
    offset += cells;
  }
}

/** Očekávaná délka `heights.bin`: jeden bajt na roh mřížky. */
export function expectedHeightsByteLength(size: number): number {
  return cornerCellsOf(size);
}

export function unpackHeightsInto(
  bytes: Uint8Array,
  heights: Uint8Array,
  size: number,
): void {
  if (bytes.byteLength !== expectedHeightsByteLength(size)) {
    fail(
      `heights.bin má ${bytes.byteLength} B, čekalo se ${expectedHeightsByteLength(size)} B — jiná velikost mapy`,
    );
  }
  heights.set(bytes);
}

/** Očekávaná délka `layers.bin` pro aktuální formát a mapu o hraně `size`. */
export function expectedLayersByteLength(size: number): number {
  const cells = size * size;
  // Jen `buildingId` je dvoubajtová; kdyby se to změnilo, je to nová verze formátu.
  return cells * (SAVE_LAYER_ORDER.length + 1);
}

export function unpackLayersInto(
  bytes: Uint8Array,
  layers: Layers,
  size: number,
): void {
  if (bytes.byteLength !== expectedLayersByteLength(size)) {
    fail(
      `layers.bin má ${bytes.byteLength} B, čekalo se ${expectedLayersByteLength(size)} B — jiná velikost mapy nebo jiná sada vrstev`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cells = size * size;
  let offset = 0;

  for (const name of SAVE_LAYER_ORDER) {
    const layer = layers[name];
    if (layer.BYTES_PER_ELEMENT === 1) {
      for (let i = 0; i < cells; i++) {
        layer[i] = view.getUint8(offset);
        offset += 1;
      }
    } else {
      for (let i = 0; i < cells; i++) {
        layer[i] = view.getUint16(offset, true);
        offset += 2;
      }
    }
  }
}

/** Rozbalí celý save z bajtů ZIPu. Migrace se pouští až nad výsledkem. */
export function unpackSave(bytes: Uint8Array): SaveData {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    fail('save není čitelný ZIP');
  }

  const layers = files[SAVE_FILES.layers];
  if (!layers) fail(`v savu chybí ${SAVE_FILES.layers}`);

  // `coarse.bin` má až verze 2, `heights.bin` až verze 4. U starších jsou
  // prázdné a naplní je migrace.
  const coarse = files[SAVE_FILES.coarse] ?? new Uint8Array(0);
  const heights = files[SAVE_FILES.heights] ?? new Uint8Array(0);
  // `disasters.bin` má až verze 6; u starších je prázdný a naplní ho migrace.
  const disasters = files[SAVE_FILES.disasters] ?? new Uint8Array(0);
  // `terraform.bin` až verze 8. Totéž.
  const terraform = files[SAVE_FILES.terraform] ?? new Uint8Array(0);

  const meta = parseMeta(parseJson(files[SAVE_FILES.meta], SAVE_FILES.meta));

  return {
    meta,
    layers,
    coarse,
    heights,
    disasters,
    terraform,
    entities: parseEntities(parseJson(files[SAVE_FILES.entities], SAVE_FILES.entities)),
    state: parseState(
      parseJson(files[SAVE_FILES.state], SAVE_FILES.state),
      meta.formatVersion,
    ),
  };
}

/**
 * Přečte jen `meta.json`, bez rozbalování vrstev a entit. Tohle je důvod, proč
 * je meta v ZIPu nekomprimovaná — seznam uložených her se vykreslí okamžitě.
 */
export function readSaveMeta(bytes: Uint8Array): SaveMeta {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name === SAVE_FILES.meta });
  } catch {
    fail('save není čitelný ZIP');
  }
  return parseMeta(parseJson(files[SAVE_FILES.meta], SAVE_FILES.meta));
}

export interface LoadWarnings {
  /** Zdroje obsahu, které save vyžaduje, ale nejsou načtené. */
  missingSources: SaveSourceInfo[];
  /** Definice, na které se odkazují budovy v savu, ale registr je nezná. */
  missingDefinitions: string[];
  /**
   * Kolik budov ve městě vodu potřebuje, ale síť je prázdná (§10, verze 5).
   *
   * Typicky save z verze 4, kterému migrace potrubí nedoplnila — takové město
   * začne po načtení chátrat a hráč to musí vědět **hned**, ne až mu ubudou
   * obyvatelé. Podmínka je ale schválně na datech, ne na verzi: město bez
   * jediné trubky je stejně tak marné, ať se do téhle situace dostalo
   * jakkoli.
   */
  waterlessBuildings: number;
}

/**
 * Hráč musí vědět, že mu ve městě chybí mod. Budovy se **nikdy nemažou** —
 * jen se nevykreslí, dokud se zdroj nedoplní (§8).
 */
export function collectLoadWarnings(
  save: SaveData,
  catalogue: BuildingCatalogue,
  loadedSources: readonly SaveSourceInfo[],
): LoadWarnings {
  const loaded = new Set(loadedSources.map((source) => source.id));
  const missingSources = save.meta.content.sources.filter((source) => !loaded.has(source.id));

  const missingDefinitions = [
    ...new Set(
      save.entities.buildings
        .map((building) => building.definitionId)
        .filter((id) => catalogue.get(id) === undefined),
    ),
  ].sort();

  // Vrstva potrubí je v `layers.bin` poslední, takže stačí sáhnout na její
  // konec — rozbalovat celý save kvůli jednomu „je tam vůbec něco?“ ne.
  const cells = saveMapSize(save.meta) ** 2;
  const pipes = save.layers.subarray(save.layers.byteLength - cells);
  const hasPipes = pipes.some((value) => value !== 0);
  const waterlessBuildings = hasPipes
    ? 0
    : save.entities.buildings.filter(
        (building) => catalogue.get(building.definitionId)?.construction.requiresWater === true,
      ).length;

  return { missingSources, missingDefinitions, waterlessBuildings };
}

/**
 * Nasype save do **existujícího** světa.
 *
 * Nevytváří nový objekt schválně: renderer i UI drží `getSnapshot()` jako živý
 * pohled (T2), takže výměna objektu by jim nechala zastaralou referenci.
 */
export function applySaveToWorld(world: WorldState, save: SaveData): void {
  // Velikost mapy nese save (T42). Přestavba musí být **první**: všechno pod
  // ní zapisuje do vrstev, které tím teprve vzniknou ve správné délce.
  const size = saveMapSize(save.meta);
  resizeWorld(world, size);

  unpackLayersInto(save.layers, world.layers, size);
  // Seznamy silnic a zón se neukládají (R10) — postaví se z načtených vrstev.
  rebuildTileIndex(world);

  // `seed` je readonly, aby ho nikdo nepřepsal omylem. Load je ta jediná
  // legitimní výjimka — ze světa se stává jiné město.
  (world as { seed: number }).seed = save.meta.city.seed;

  world.tick = save.state.tick;
  world.rng = Rng.fromState(save.state.rngState);
  world.economy = {
    ...save.state.economy,
    taxRates: { ...save.state.economy.taxRates },
  };
  world.demand = { ...save.state.demand };

  world.buildings.clear();
  for (const building of save.entities.buildings) {
    world.buildings.set(building.id, { ...building });
  }
  world.nextBuildingId = save.entities.nextBuildingId;
  // Populace pro měření růstu je **odvozená** z budov, které save nese —
  // dopočítá se, místo aby se ukládala. Načtené město tak startuje s nulovým
  // růstem, ne s falešným skokem proti nule.
  rememberPopulation(world);

  // Hrubé vrstvy nese formát verze 2. Starší save jimi projde s vynulovaným
  // `coarse.bin`, který mu doplnila migrace.
  unpackCoarseInto(save.coarse, world.coarse, size);
  // Patra nese verze 4; starším je migrace doplnila jako rovinu.
  unpackHeightsInto(save.heights, world.cornerHeight, size);

  // Odvozený a runtime stav předchozího města nesmí přetéct do načteného.
  // Pokrytí se **musí** označit za špinavé: bez toho by ho `serviceSystem`
  // nikdy nepřepočítal a všechny služby by po loadu přestaly fungovat —
  // žádný bonus k ceně půdy, žádné srážení kriminality, žádné zdravotnictví.
  world.coverage.clear();
  world.coverageDirty = true;
  world.serviceFunding.clear();
  for (const [serviceClass, funding] of Object.entries(save.state.serviceFunding)) {
    world.serviceFunding.set(serviceClass, funding);
  }
  world.downgradeStreak.clear();

  // Doprava se neukládá (R10) — a právě proto se musí **vynulovat**. Zátěž ani
  // dosažitelnost práce z předchozího města nesmí přetéct do načteného: silnice
  // jsou jinde, budovy mají jiná id a chvíli by hra počítala s dopravou, která
  // v tomhle městě nikdy nebyla. Kurzor je jediné, co se přenáší ze savu.
  world.trafficLoad.fill(0);
  world.jobAccess.clear();
  world.jobAccessCells = new Float32Array(coarseCellsOf(size)).fill(1);
  world.cityJobAccess = 1;
  world.trafficCursor = save.state.trafficCursor;

  // Spokojenost se taky neukládá (R10). Nulou začít nesmí — načtené město
  // by na první pohled vypadalo jako zoufalé — proto výchozí neutrál.
  world.happiness.fill(NEUTRAL_HAPPINESS);

  // Voda je odvozená z potrubí a zdrojů, takže se stejně jako doprava musí
  // **vynulovat**, ne nechat přetéct: zavodněné budovy minulého města mají
  // jiná id a počítadlo chátrání by načtenému městu strhlo obyvatele za
  // sucho, které se stalo někde jinde.
  world.waterSupply.fill(0);
  world.watered.clear();
  world.waterlessStreak.clear();
  world.waterNetworkDirty = true;

  // Původ mapy: co save neví, bereme jako ruční mapu (migrace to doplňuje stejně).
  world.map = save.meta.map
    ? { ...save.meta.map }
    : { seed: save.meta.city.seed, generated: false };

  applyDisastersToWorld(world, save, size);
  applyTransitToWorld(world, save);
  applyFinanceToWorld(world, save);

  // Silnice, kterým pod nohama zmizela rovina, se **rozbijí i po loadu**.
  // Města uložená dřív, než to pravidlo existovalo, nesou vozovky nakloněné
  // přes zlom po dávném sesuvu — autor takový obrázek poslal a je to zjevná
  // vada, ne historie, kterou by mělo cenu zachovat. Trosky po nich zůstanou,
  // takže je hráč najde a může postavit znovu.
  repairUnsupportedRoads(world, noLosses());

  // Po loadu se kreslí všechno a síť se přepočítá znovu.
  world.dirty = {
    tiles: new Set(),
    buildings: new Set(),
    fullRedraw: true,
    coarseChanged: true,
    heightsChanged: true,
  };
  world.powerNetworkDirty = true;
}

/**
 * Katastrofy do světa (verze 6).
 *
 * **Ukládá se i probíhající pohroma** (rozhodnutí autora), takže načtené město
 * hoří dál. Odvozené se ale nepřebírá: počet hořících dlaždic se dopočítá
 * z vrstvy, protože jinak by stačil jeden ručně upravený save k tomu, aby si
 * hra myslela, že hoří něco, co nehoří.
 */
function applyDisastersToWorld(world: WorldState, save: SaveData, size: number): void {
  unpackDisasterLayersInto(save.disasters, world, size);
  unpackTerraformInto(save.terraform, world, size);

  const raw = save.state.disasters;
  world.disasters.enabled = raw.enabled;
  world.disasters.nextId = raw.nextId;

  world.disasters.lastOccurrence.clear();
  for (const [kind, tick] of Object.entries(raw.lastOccurrence)) {
    world.disasters.lastOccurrence.set(kind, tick);
  }

  world.disasters.riskCeiling.clear();
  for (const [kind, ceiling] of Object.entries(raw.riskCeiling)) {
    world.disasters.riskCeiling.set(kind, ceiling);
  }

  world.disasters.active = raw.active.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    startedAtTick: entry.startedAtTick,
    x: entry.x,
    y: entry.y,
    state: { ...entry.state },
    finished: entry.finished,
  }));

  world.disasters.modifiers = raw.modifiers.map((modifier) => ({
    kind: modifier.kind as Modifier['kind'],
    ...(modifier.serviceClass !== undefined ? { serviceClass: modifier.serviceClass } : {}),
    cells: [...modifier.cells],
    amount: modifier.amount,
    until: modifier.until,
    source: modifier.source,
  }));

  world.disasters.offlinePlants = new Set(raw.offlinePlants);

  world.infection.clear();
  for (const [cell, level] of raw.infection) world.infection.set(cell, level);

  world.rubbleOf.clear();
  for (const [tile, definitionId] of raw.rubbleOf) world.rubbleOf.set(tile, definitionId);

  // Počítadlo hořících dlaždic je odvozené — spočítá se z vrstvy, ne ze savu.
  countBurning(world);
}

/**
 * Linky do světa (verze 6).
 *
 * Statistiky přepravy se **nepřebírají**: jsou odvozené z linek a města
 * a přepočítají se při první měsíční uzávěrce. Koridor tramvají se označí za
 * špinavý, aby se dopočítal hned.
 */
function applyTransitToWorld(world: WorldState, save: SaveData): void {
  world.lines = save.state.transit.lines.map((line) => ({
    id: line.id,
    mode: line.mode,
    stops: [...line.stops],
    vehicles: line.vehicles,
    paused: line.paused,
    fare: line.fare,
  }));
  world.nextLineId = save.state.transit.nextLineId;

  world.lineStats.clear();
  world.transitRelief.clear();
  world.tramTiles.clear();
  world.transitDirty = true;
}

function applyFinanceToWorld(world: WorldState, save: SaveData): void {
  const raw = save.state.finance;
  world.loans = raw.loans.map((loan) => ({ ...loan }));
  world.nextLoanId = raw.nextLoanId;
  world.bonds = raw.bonds.map((bond) => ({ ...bond }));
  world.nextBondId = raw.nextBondId;
  world.bondsBlockedUntil = raw.bondsBlockedUntil;

  world.grantsAwarded = new Set(raw.grantsAwarded);
  world.grantProgress.clear();
  for (const [id, ticks] of raw.grantProgress) world.grantProgress.set(id, ticks);
}

/**
 * Rozbalí `disasters.bin` do vrstev světa (verze 6).
 *
 * Buffer jiné délky, než jakou má mapa, je **chyba, ne důvod k dopočtu**:
 * tichý fallback by z poškozeného savu udělal město, ve kterém náhodně hoří.
 */
/**
 * Tiky terénních úprav ze savu. Čte se **little-endian**, jak se zapsalo.
 *
 * Jiná délka je chyba, ne důvod k dopočtu: z poškozeného souboru by se stalo
 * město, ve kterém sesuv padá na místa, kde nikdo nic neupravoval.
 */
function unpackTerraformInto(bytes: Uint8Array, world: WorldState, size: number): void {
  const cells = size * size;
  if (bytes.byteLength !== cells * 2) {
    fail(`${SAVE_FILES.terraform} má ${bytes.byteLength} bajtů, čeká se ${cells * 2}`);
  }

  for (let tile = 0; tile < cells; tile++) {
    world.terraformTick[tile] = (bytes[tile * 2] ?? 0) | ((bytes[tile * 2 + 1] ?? 0) << 8);
  }
}

function unpackDisasterLayersInto(bytes: Uint8Array, world: WorldState, size: number): void {
  const cells = size * size;
  const expected = cells * SAVE_DISASTER_LAYER_ORDER.length;
  if (bytes.byteLength !== expected) {
    fail(`${SAVE_FILES.disasters} má ${bytes.byteLength} bajtů, čeká se ${expected}`);
  }

  let offset = 0;
  for (const name of SAVE_DISASTER_LAYER_ORDER) {
    world[name].set(bytes.subarray(offset, offset + cells));
    offset += cells;
  }
}
