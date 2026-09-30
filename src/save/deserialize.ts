import { Inflate, strFromU8 } from 'fflate';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { coarseCellsOf, coarseSizeOf } from '@/sim/coarse';
import { cornerCellsOf, MAX_HEIGHT } from '@/sim/heights';
import type { CoarseLayers } from '@/sim/coarse';
import type { Layers } from '@/sim/layers';
import { inBounds, MAP_SIZES, MAX_BUILDING_ID, ROAD, TERRAIN, WIRE, ZONE } from '@/sim/layers';
import { MAX_LEVEL } from '@/content/schema';
import { Rng } from '@/sim/rng';
import { RCI_CATEGORIES } from '@/sim/rci';
import type { Ledger } from '@/sim/ledger';
import { MAX_FUNDING } from '@/sim/funding';
import { MAX_LINE_VEHICLES } from '@/sim/transit';
import {
  MAX_TAX_RATE,
  MIN_TAX_RATE,
  rebuildTileIndex,
  resizeWorld,
} from '@/sim/world';
import type {
  Building,
  DemandState,
  EconomyState,
  WorldState,
} from '@/sim/world';
import {
  MAX_SAVE_FILE_BYTES,
  SAVE_COARSE_BYTES_PER_CELL,
  SAVE_COARSE_LAYER_ORDER,
  SAVE_DISASTER_LAYER_ORDER,
  SAVE_FILES,
  SAVE_LAYER_ORDER,
  SaveFormatError,
} from './format';
import type {
  SaveData,
  SaveDerivedState,
  SaveDisasterState,
  SaveEntities,
  SaveFinanceState,
  SaveMeta,
  SaveSourceInfo,
  SaveState,
  SaveTransitState,
} from './format';
import { noLosses, repairUnsupportedRoads } from '@/sim/disasters/damage';
import { countBurning } from '@/sim/disasters/fire';
import { disasterStateProblem, MODIFIER_KINDS } from '@/sim/disasters/state';
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
/**
 * Účetní kniha ze savu.
 *
 * Čte se **shovívavě**: záporné ani nečíselné položky se zahodí místo aby
 * shodily načtení, protože kniha je výkaz, ne pravidlo hry. Poškozená položka
 * pokazí jeden řádek vyúčtování; odmítnutý save pokazí celé město.
 */
function parseLedger(raw: unknown, tick: number): Ledger {
  const record = raw === undefined || raw === null ? null : asRecord(raw, 'state.economy.ledger');
  const fallbackYear = Math.floor(tick / 360) + 1;
  if (!record) return { year: fallbackYear, income: {}, expenses: {} };

  const side = (value: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (typeof value !== 'object' || value === null) return out;
    for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) out[key] = amount;
    }
    return out;
  };

  const year = record['year'];
  return {
    year: typeof year === 'number' && Number.isFinite(year) && year > 0 ? Math.floor(year) : fallbackYear,
    income: side(record['income']),
    expenses: side(record['expenses']),
  };
}

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
    // **Shovívavě**: `lostStops` přibylo ve v10 a starší save je nemá.
    // Parsuje se dřív než migrace, takže by na nich jinak spadl v1 až v9.
    lostStops:
      raw['lostStops'] === undefined
        ? []
        : asArray(raw['lostStops'], `${what}.lostStops`).map((entry, i) => {
            const pair = asArray(entry, `${what}.lostStops[${i}]`);
            const [tile, lost] = pair;
            if (typeof tile !== 'number' || !Number.isInteger(tile)) {
              fail(`${what}.lostStops[${i}][0] musí být dlaždice`);
            }
            return [tile, pairArray(lost, `${what}.lostStops[${i}][1]`)] as [
              number,
              [number, number][],
            ];
          }),
  };
}

/** Prázdný stav s pamětí — to, s čím se načítal save do verze 14. */
function emptyDerived(): SaveDerivedState {
  return {
    trafficLoad: [],
    jobAccess: [],
    lineStats: [],
    transitRelief: [],
    downgradeStreak: [],
    waterlessStreak: [],
    coverage: [],
    watered: [],
  };
}

/**
 * Stav s pamětí (verze 15). Tady se kontroluje **tvar**; meze proti velikosti
 * mapy a proti zdravému rozumu hlídá `checkSaveFits`.
 */
function parseDerived(raw: Record<string, unknown>): SaveDerivedState {
  const what = 'state.derived';
  return {
    trafficLoad: pairArray(raw['trafficLoad'], `${what}.trafficLoad`),
    jobAccess: pairArray(raw['jobAccess'], `${what}.jobAccess`),
    lineStats: asArray(raw['lineStats'], `${what}.lineStats`).map((value, i) => {
      const where = `${what}.lineStats[${i}]`;
      const [id, rawStats] = asArray(value, where);
      if (typeof id !== 'number' || !Number.isInteger(id)) fail(`${where}[0] musí být id linky`);
      const stats = asRecord(rawStats, `${where}[1]`);
      return [
        id,
        {
          demand: num(stats, 'demand', `${where}[1]`),
          capacity: num(stats, 'capacity', `${where}[1]`),
          transported: num(stats, 'transported', `${where}[1]`),
          income: num(stats, 'income', `${where}[1]`),
          upkeep: num(stats, 'upkeep', `${where}[1]`),
        },
      ];
    }),
    transitRelief: pairArray(raw['transitRelief'], `${what}.transitRelief`),
    downgradeStreak: pairArray(raw['downgradeStreak'], `${what}.downgradeStreak`),
    waterlessStreak: pairArray(raw['waterlessStreak'], `${what}.waterlessStreak`),
    coverage: asArray(raw['coverage'], `${what}.coverage`).map((value, i) => {
      const where = `${what}.coverage[${i}]`;
      const [serviceClass, cells] = asArray(value, where);
      if (typeof serviceClass !== 'string') fail(`${where}[0] musí být třída služby`);
      return [serviceClass, numberArray(cells, `${where}[1]`)];
    }),
    watered: numberArray(raw['watered'], `${what}.watered`),
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
    // `Number.isFinite`, ne jen `typeof`: JSON umí `1e400`, a to se přečte
    // jako nekonečno (audit T132).
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
      fail(`${what}[${i}] musí být dvojice čísel`);
    }
    return [a, b] as [number, number];
  });
}

/**
 * Velikost mapy ze savu smí být jen jedna ze čtyř, které hra zná.
 *
 * A hrubá mřížka k ní musí sedět: `coarseSize` se jinde nepoužívá, ale kdyby
 * lhal, znamenalo by to, že soubor psal někdo jiný než tahle hra.
 */
function checkGrid(grid: { size: number; coarseSize: number }): void {
  if (!(MAP_SIZES as readonly number[]).includes(grid.size)) {
    fail(`meta.grid.size je ${grid.size}; hra zná jen ${MAP_SIZES.join(', ')}`);
  }
  const expected = coarseSizeOf(grid.size);
  if (grid.coarseSize !== expected) {
    fail(`meta.grid.coarseSize je ${grid.coarseSize}, k mapě ${grid.size} patří ${expected}`);
  }
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
  //
  // **Velikost se hlídá tady, ne až u prvního čtení.** `meta.grid.size` jde
  // rovnou do `resizeWorld`, kde se z něj alokuje třináct polí o `size²`
  // prvcích — a to dřív, než kdokoli zjistí, že `layers.bin` na tu velikost
  // nesedí. Save s `size = 60000` by tedy nechtěl gigabajty a shodil kartu,
  // aniž by měl jedinou platnou dlaždici. Hra zná čtyři velikosti mapy a nic
  // jiného vzniknout nemůže, takže se bere jen z nich.
  let grid: SaveMeta['grid'];
  if (raw['grid'] !== undefined) {
    const rawGrid = asRecord(raw['grid'], 'meta.grid');
    grid = {
      size: int(rawGrid, 'size', 'meta.grid'),
      coarseSize: int(rawGrid, 'coarseSize', 'meta.grid'),
    };
    checkGrid(grid);
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
/** Od téhle verze nese save stav s pamětí (`state.derived`, audit T132). */
const DERIVED_VERSION = 15;

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
      // Mez je **tatáž konstanta, podle které se řídí posuvník** (`sim/funding.ts`).
      // Stála tu jednička: hra uložila služby na 150 %, pak je sama odmítla
      // načíst a hráč přišel o město při dalším startu.
      if (value < 0 || value > MAX_FUNDING) {
        fail(`state.serviceFunding.${key} je ${value}, čeká se rozsah 0–${MAX_FUNDING}`);
      }
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
      : { lines: [], nextLineId: 1, lostStops: [] },
    finance: hasPhaseFour
      ? parseFinance(asRecord(raw['finance'], 'state.finance'))
      : emptyFinance(),
    // Stav s pamětí nese až verze 15 (T132). Stejná úvaha jako u fáze 4:
    // u starších se nevyžaduje, u novějších chybějící sekce znamená vadný soubor.
    derived:
      formatVersion >= DERIVED_VERSION
        ? parseDerived(asRecord(raw['derived'], 'state.derived'))
        : emptyDerived(),
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
      // Účetní knihu nese verze 11. Starší save ji nemá a začne prázdnou
      // od roku, ve kterém se nachází — vymýšlet mu loňská čísla by znamenalo
      // ukázat výkaz, který se nikdy nestal.
      ledger: parseLedger(economyRaw['ledger'], int(raw, 'tick', 'state')),
      lastYear:
        economyRaw['lastYear'] === undefined || economyRaw['lastYear'] === null
          ? null
          : parseLedger(economyRaw['lastYear'], int(raw, 'tick', 'state')),
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
 * Očekávaná délka `coarse.bin`: tři jednobajtové vrstvy na hrubé mřížce a od
 * verze 15 za nimi spokojenost.
 *
 * `size` je hrana **mapy**, ne hrubé mřížky — od T42 ji nese `meta.grid.size`
 * a save z mapy 512 × 512 je jinak dlouhý než ze 128 × 128.
 */
export function expectedCoarseByteLength(size: number): number {
  return coarseCellsOf(size) * SAVE_COARSE_BYTES_PER_CELL;
}

/** Hrubé vrstvy a za nimi spokojenost (verze 15). */
export function unpackCoarseInto(
  bytes: Uint8Array,
  coarse: CoarseLayers,
  happiness: Uint8Array,
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
  happiness.set(bytes.subarray(offset, offset + cells));
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
  // Jen `buildingId` je vícebajtová — od verze 12 čtyři bajty, do té doby dva.
  // Kdyby se to změnilo, je to nová verze formátu.
  return cells * (SAVE_LAYER_ORDER.length + 3);
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
    } else if (layer.BYTES_PER_ELEMENT === 4) {
      for (let i = 0; i < cells; i++) {
        layer[i] = view.getUint32(offset, true);
        offset += 4;
      }
    } else {
      fail(`vrstva ${name} má ${layer.BYTES_PER_ELEMENT} B na dlaždici, save zná 1 a 4`);
    }
  }
}

/**
 * Kolik bajtů smí mít který soubor v archivu po rozbalení.
 *
 * ZIP se sám o sobě neomezuje: nuly se komprimují zhruba tisíc ku jedné, takže
 * čtyřmegabajtový soubor umí vyrobit čtyři gigabajty v paměti — a `unzipSync`
 * je rozbalí **všechny naráz**, dřív než se cokoli validuje. Na telefonu, kde
 * hra taky běží, stačí mnohem míň.
 *
 * Binární soubory mají přesně spočítaný strop pro největší mapu, kterou hra
 * zná. JSON strop spočítat nejde — počet budov nemá horní mez — tak má
 * velkorysý pevný, který pořád zastaví bombu o několik řádů dřív než paměť.
 */
const MAX_JSON_BYTES = 32 * 1024 * 1024;

function maxUnpackedBytes(name: string): number {
  const biggest = Math.max(...MAP_SIZES);
  const cells = biggest * biggest;
  switch (name) {
    case SAVE_FILES.meta:
      return 64 * 1024;
    case SAVE_FILES.layers:
      return expectedLayersByteLength(biggest);
    case SAVE_FILES.coarse:
      return expectedCoarseByteLength(biggest);
    case SAVE_FILES.heights:
      return expectedHeightsByteLength(biggest);
    case SAVE_FILES.disasters:
      return cells * SAVE_DISASTER_LAYER_ORDER.length;
    case SAVE_FILES.terraform:
      return cells * 2;
    default:
      return MAX_JSON_BYTES;
  }
}

/** Jména, která do savu patří. Cokoli jiného se přeskočí, ne rozbalí. */
const KNOWN_FILES: readonly string[] = Object.values(SAVE_FILES);

/**
 * Kolik položek smí mít archiv savu. Hra jich píše osm; zbytek je rezerva
 * pro soubory, které přibudou s dalšími verzemi formátu.
 */
const MAX_ZIP_ENTRIES = 16;

/**
 * Po kolika bajtech komprimovaných dat se rozbaluje. Deflate umí nafouknout
 * bajt nejvýš zhruba na tisíc, takže jeden krok přes strop přidá nanejvýš
 * pár megabajtů, než se rozbalování utne.
 */
const INFLATE_STEP = 4096;

/** Jedna položka ze seznamu na konci ZIPu, i s tím, kde leží její data. */
interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  originalSize: number;
  dataStart: number;
}

/**
 * Přečte ústřední adresář ZIPu. Nic nerozbaluje.
 *
 * Vlastní čtení, ne `unzipSync` (audit T132). Ten rozbalí **každou položku
 * adresáře**, a adresář smí na tentýž záznam ukazovat kolikrát chce: soubor
 * o 256 kB s tisícovkou odkazů na jeden `layers.bin` zamrazil kartu na
 * 4,8 s a čtyřmegabajtový by ji zamrazil na hodiny. A délku po rozbalení
 * bral z hlavičky jen jako první odhad — co hlavička zatajila, dorostlo.
 *
 * Tady se proto odmítne všechno, co hra sama nikdy nenapíše: víc než
 * `MAX_ZIP_ENTRIES` položek, jméno dvakrát, šifrování, ZIP64 a odkaz mimo
 * soubor.
 */
function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;
  const u16 = (at: number): number => view.getUint16(at, true);
  const u32 = (at: number): number => view.getUint32(at, true);
  const broken = (): never => fail('save není čitelný ZIP');

  // Konec ústředního adresáře: 22 bajtů a za nimi nanejvýš 65 535 bajtů
  // komentáře. Hledá se odzadu.
  let end = -1;
  for (let at = length - 22; at >= 0 && at >= length - 22 - 0xffff; at--) {
    if (u32(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) broken();

  const count = u16(end + 10);
  const directory = u32(end + 16);
  if (count === 0xffff || directory === 0xffffffff) fail('save nesmí být ZIP64');
  if (count > MAX_ZIP_ENTRIES) {
    fail(`archiv má ${count} položek, save hry má nejvýš ${MAX_ZIP_ENTRIES}`);
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let at = directory;
  for (let i = 0; i < count; i++) {
    if (at + 46 > length || u32(at) !== 0x02014b50) broken();
    const flags = u16(at + 8);
    if ((flags & 1) !== 0) fail('save nesmí být šifrovaný');
    const compression = u16(at + 10);
    const compressedSize = u32(at + 20);
    const originalSize = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const local = u32(at + 42);
    if (at + 46 + nameLength > length) broken();
    const name = strFromU8(bytes.subarray(at + 46, at + 46 + nameLength), true);
    at += 46 + nameLength + extraLength + commentLength;

    // Druhý záznam téhož jména je přesně ten trik s tisíci odkazy na jednu
    // bombu. Hra ho nenapíše nikdy, takže se nehledá, který z nich platí.
    if (names.has(name)) fail(`${name} je v archivu dvakrát`);
    names.add(name);

    if (local + 30 > length || u32(local) !== 0x04034b50) broken();
    const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
    if (dataStart + compressedSize > length) broken();

    entries.push({ name, compression, compressedSize, originalSize, dataStart });
  }
  return entries;
}

/**
 * Rozbalí jednu položku a **utne to**, jakmile výstup přeroste `limit`.
 *
 * Rozbaluje se po kouscích přes proudový `Inflate`, takže bomba se zastaví
 * po pár megabajtech, ne až když dojde paměť. Výsledek musí mít přesně
 * délku z hlavičky: hlavička, která lže, znamená soubor, který nepsala hra.
 */
function inflateEntry(bytes: Uint8Array, entry: ZipEntry, limit: number): Uint8Array {
  const { name, originalSize } = entry;
  if (originalSize > limit) {
    fail(`${name} má po rozbalení ${originalSize} B, povoleno je nejvýš ${limit} B`);
  }
  const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);

  if (entry.compression === 0) {
    if (entry.compressedSize !== originalSize) fail(`${name} má v hlavičce dvě různé délky`);
    return data.slice();
  }
  if (entry.compression !== 8) fail(`${name} je zkomprimovaný neznámou metodou`);
  // Deflate data nikdy o moc nezvětší; komprimovaná položka výrazně delší
  // než výsledek je jen balast, přes který by se procesor prokousával.
  if (entry.compressedSize > originalSize + 1024 + Math.ceil(originalSize / 1000)) {
    fail(`${name} je v komprimované podobě delší, než po rozbalení`);
  }

  const out = new Uint8Array(originalSize);
  let written = 0;
  let finished = false;
  const inflater = new Inflate((chunk, final) => {
    if (written + chunk.length > originalSize) {
      fail(`${name} se rozbaluje na víc než ${originalSize} B, které hlásí hlavička`);
    }
    out.set(chunk, written);
    written += chunk.length;
    if (final) finished = true;
  });
  try {
    for (let offset = 0; offset < data.length; offset += INFLATE_STEP) {
      const end = Math.min(data.length, offset + INFLATE_STEP);
      inflater.push(data.subarray(offset, end), end === data.length);
    }
    if (data.length === 0) inflater.push(new Uint8Array(0), true);
  } catch (error) {
    if (error instanceof SaveFormatError) throw error;
    fail(`${name} není čitelný deflate`);
  }
  if (!finished || written !== originalSize) {
    fail(`${name} má po rozbalení ${written} B, hlavička hlásí ${originalSize} B`);
  }
  return out;
}

/**
 * Rozbalí archiv a **do paměti pustí jen to, co má smysl**.
 *
 * Neznámé jméno se přeskočí bez rozbalení. Známé se rozbaluje jen do stropu
 * pro svůj druh a jen do délky, kterou samo hlásí (`inflateEntry`).
 */
function unzipGuarded(bytes: Uint8Array, wanted?: string): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_SAVE_FILE_BYTES) {
    fail(`soubor má ${bytes.byteLength} B, save hry má nejvýš ${MAX_SAVE_FILE_BYTES} B`);
  }
  if (bytes.byteLength < 22) fail('save není čitelný ZIP');

  const files: Record<string, Uint8Array> = {};
  for (const entry of readZipDirectory(bytes)) {
    const take = wanted === undefined ? KNOWN_FILES.includes(entry.name) : entry.name === wanted;
    if (!take) continue;
    files[entry.name] = inflateEntry(bytes, entry, maxUnpackedBytes(entry.name));
  }
  return files;
}

/** Rozbalí celý save z bajtů ZIPu. Migrace se pouští až nad výsledkem. */
export function unpackSave(bytes: Uint8Array): SaveData {
  const files = unzipGuarded(bytes);

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
  const files = unzipGuarded(bytes, SAVE_FILES.meta);
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
  /**
   * Kolik budov bere proud, ale ve městě není jediný úsek vedení (T129).
   * Typicky město z doby, kdy proud vedla silnice — po aktualizaci svítí jen
   * bloky přiléhající k elektrárně a hráč musí vedení natáhnout.
   */
  unwiredBuildings: number;
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

  // Vrstva potrubí je v `layers.bin` předposlední (za ní je od verze 13
  // vedení), takže stačí sáhnout na její místo — rozbalovat celý save kvůli
  // jednomu „je tam vůbec něco?“ ne.
  const cells = saveMapSize(save.meta) ** 2;
  const pipes = save.layers.subarray(save.layers.byteLength - 2 * cells, save.layers.byteLength - cells);
  const hasPipes = pipes.some((value) => value !== 0);
  const waterlessBuildings = hasPipes
    ? 0
    : save.entities.buildings.filter(
        (building) => catalogue.get(building.definitionId)?.construction.requiresWater === true,
      ).length;

  // Vedení je v `layers.bin` poslední vrstva (od verze 13).
  const wires = save.layers.subarray(save.layers.byteLength - cells);
  const hasWires = wires.some((value) => value !== 0);
  const unwiredBuildings = hasWires
    ? 0
    : save.entities.buildings.filter(
        (building) => (catalogue.get(building.definitionId)?.power?.consumption ?? 0) > 0,
      ).length;

  return { missingSources, missingDefinitions, waterlessBuildings, unwiredBuildings };
}

/** Číslo, které musí být celé a v mezích. Jinak je save poškozený. */
function inRange(value: number, low: number, high: number, what: string): void {
  if (!Number.isInteger(value) || value < low || value > high) {
    fail(`${what} je ${value}, čeká se celé číslo mezi ${low} a ${high}`);
  }
}

/**
 * Projde celý save **dřív, než se sáhne na svět**.
 *
 * Tohle je jádro opravy po auditu. `applySaveToWorld` zapisuje rovnou do
 * živého světa, a když někde uprostřed vyletí výjimka, volající sice ukáže
 * „načtení selhalo", ale rozehrané město už je přepsané tím, co bylo
 * v souboru — a nejbližší autosave to zafixuje. Cizí save s poškozeným
 * `coarse.bin` tak uměl město **smazat**, přestože se ani nenačetl.
 *
 * Kontroluje se proto všechno naráz a předem: délky binárních souborů proti
 * velikosti mapy a rozsahy hodnot, které by jinak vyrobily město s milionem
 * záporných obyvatel a hráč by to hlásil jako chybu hry.
 *
 * Pouští se **po migraci**, protože teprve ta doplní starším verzím soubory,
 * které tehdy neexistovaly.
 */
export function checkSaveFits(save: SaveData): void {
  const size = saveMapSize(save.meta);
  const grid = save.meta.grid;
  if (grid) checkGrid(grid);

  const cells = size * size;
  const lengths: [string, number, number][] = [
    [SAVE_FILES.layers, save.layers.byteLength, expectedLayersByteLength(size)],
    [SAVE_FILES.coarse, save.coarse.byteLength, expectedCoarseByteLength(size)],
    [SAVE_FILES.heights, save.heights.byteLength, expectedHeightsByteLength(size)],
    [SAVE_FILES.disasters, save.disasters.byteLength, cells * SAVE_DISASTER_LAYER_ORDER.length],
    [SAVE_FILES.terraform, save.terraform.byteLength, cells * 2],
  ];
  for (const [name, actual, expected] of lengths) {
    if (actual !== expected) {
      fail(`${name} má ${actual} B, k mapě ${size} × ${size} patří ${expected} B`);
    }
  }

  // Budovy. `id` se ukládá do vrstvy `buildingId` — nula znamená prázdnou
  // dlaždici a id nad `MAX_BUILDING_ID` by se do mapy nevešlo, budova by na ní
  // stála neviditelně. Vrstva je od verze 12 čtyřbajtová; starší save má id
  // pod 65 536 z principu, takže jedna mez platí pro všechny.
  const seen = new Set<number>();
  let highestId = 0;
  for (const building of save.entities.buildings) {
    const where = `entities.buildings[id=${building.id}]`;
    inRange(building.id, 1, MAX_BUILDING_ID, `${where}.id`);
    highestId = Math.max(highestId, building.id);
    if (seen.has(building.id)) fail(`${where}.id se v savu opakuje`);
    seen.add(building.id);
    inRange(building.x, 0, size - 1, `${where}.x`);
    inRange(building.y, 0, size - 1, `${where}.y`);
    inRange(building.level, 1, MAX_LEVEL, `${where}.level`);
    inRange(building.population, 0, 1e9, `${where}.population`);
    inRange(building.jobs, 0, 1e9, `${where}.jobs`);
    inRange(building.builtAtTick, 0, Number.MAX_SAFE_INTEGER, `${where}.builtAtTick`);
    inRange(building.levelChangedAtTick, 0, Number.MAX_SAFE_INTEGER, `${where}.levelChangedAtTick`);
  }
  // `nextBuildingId` smí být o jedna nad stropem — to je město, kterému čísla
  // došla, a takové se načíst musí. Nesmí ale ležet na žádném stojícím id ani
  // pod ním: další stavba by přepsala existující budovu v mapě entit, zatímco
  // její dlaždice by na mapě zůstaly.
  inRange(
    save.entities.nextBuildingId,
    highestId + 1,
    MAX_BUILDING_ID + 1,
    'entities.nextBuildingId',
  );

  // Linky. Zastávky se **nekontrolují na existující budovu** — zbořená
  // zastávka z linky sama vypadne při načtení (viz `applyTransitToWorld`),
  // stejně jako při zbourání za běhu.
  const lines = new Set<number>();
  for (const line of save.state.transit.lines) {
    const where = `state.transit.lines[id=${line.id}]`;
    inRange(line.id, 1, Number.MAX_SAFE_INTEGER, `${where}.id`);
    if (lines.has(line.id)) fail(`${where}.id se v savu opakuje`);
    lines.add(line.id);
    inRange(line.vehicles, 0, MAX_LINE_VEHICLES, `${where}.vehicles`);
    if (!Number.isFinite(line.fare) || line.fare < 0) fail(`${where}.fare nesmí být záporné`);
  }

  // Závazky. Záporná jistina městu při splátce **přidávala** peníze; sonda
  // z devíti milionů udělala bilion.
  for (const loan of save.state.finance.loans) {
    const where = `state.finance.loans[id=${loan.id}]`;
    inRange(loan.principal, 0, Number.MAX_SAFE_INTEGER, `${where}.principal`);
    inRange(loan.remaining, 0, Number.MAX_SAFE_INTEGER, `${where}.remaining`);
    inRange(loan.payment, 0, Number.MAX_SAFE_INTEGER, `${where}.payment`);
    inRange(loan.termMonths, 1, 1200, `${where}.termMonths`);
    inRange(loan.paidMonths, 0, loan.termMonths, `${where}.paidMonths`);
    if (!Number.isFinite(loan.rate) || loan.rate < 0 || loan.rate > 100) {
      fail(`${where}.rate je ${loan.rate}, čeká se procento mezi 0 a 100`);
    }
  }
  for (const bond of save.state.finance.bonds) {
    const where = `state.finance.bonds[id=${bond.id}]`;
    inRange(bond.offered, 0, Number.MAX_SAFE_INTEGER, `${where}.offered`);
    inRange(bond.subscribed, 0, bond.offered, `${where}.subscribed`);
    if (!Number.isFinite(bond.rate) || bond.rate < 0 || bond.rate > 100) {
      fail(`${where}.rate je ${bond.rate}, čeká se procento mezi 0 a 100`);
    }
  }

  // Sazby daně. Posuvník je drží v <0, 20> a mimo ten rozsah je ekonomika
  // nepopsaná — ne rozbitá, ale nikdo ji tam neměřil.
  for (const category of RCI_CATEGORIES) {
    inRange(
      save.state.economy.taxRates[category],
      MIN_TAX_RATE,
      MAX_TAX_RATE,
      `state.economy.taxRates.${category}`,
    );
  }

  checkDerivedFits(save, size);
  checkStateFits(save, size);
  checkLayerValuesFit(save, size);
}

/**
 * Meze stavu, které do T132 hlídal jen typ (audit T132, nález 14).
 *
 * Každé z těch čísel prošlo parserem jako „číslo" a pak dělalo něco, co hra
 * sama nikdy neudělá: nákaza 10³⁰⁰ přetekla do nekonečna, buňka postihu
 * 10¹² se hledala v poli o tisíci prvcích, záporný tik přetočil kalendář,
 * rating nad jedničku dával půjčky se záporným úrokem a jízdné 10³⁰⁸ udělalo
 * z kasy nekonečno, které se pak nedalo uložit.
 */
function checkStateFits(save: SaveData, size: number): void {
  const state = save.state;
  const cells = size * size;
  const coarseCells = coarseCellsOf(size);
  const MAX_MONEY = 1e15; // pod 2⁵³, aby sčítání v kase zůstalo přesné

  inRange(state.tick, 0, Number.MAX_SAFE_INTEGER, 'state.tick');
  inRange(state.trafficCursor, 0, MAX_BUILDING_ID, 'state.trafficCursor');

  const economy = state.economy;
  inRange(economy.funds, -MAX_MONEY, MAX_MONEY, 'state.economy.funds');
  inRange(economy.lastIncome, -MAX_MONEY, MAX_MONEY, 'state.economy.lastIncome');
  inRange(economy.lastExpenses, -MAX_MONEY, MAX_MONEY, 'state.economy.lastExpenses');
  inRange(economy.lastPopulation, 0, 1e12, 'state.economy.lastPopulation');
  inRealRange(economy.creditRating, 0, 1, 'state.economy.creditRating');
  for (const category of RCI_CATEGORIES) {
    inRealRange(state.demand[category], -1e6, 1e6, `state.demand.${category}`);
  }

  const disasters = state.disasters;
  const what = 'state.disasters';
  inRange(disasters.nextId, 1, Number.MAX_SAFE_INTEGER, `${what}.nextId`);
  disasters.active.forEach((entry, i) => {
    inRange(entry.id, 0, Number.MAX_SAFE_INTEGER, `${what}.active[${i}].id`);
    inRange(entry.startedAtTick, 0, Number.MAX_SAFE_INTEGER, `${what}.active[${i}].startedAtTick`);
    // Poloha a vlastní stav se neodmítají: taková pohroma se při načtení
    // jen ukončí (`applyDisastersToWorld`).
  });
  disasters.modifiers.forEach((modifier, i) => {
    const where = `${what}.modifiers[${i}]`;
    if (!(MODIFIER_KINDS as readonly string[]).includes(modifier.kind)) {
      fail(`${where}.kind ${modifier.kind} hra nezná`);
    }
    // `blockTile` nese dlaždice, ostatní buňky hrubé mřížky — mez je mapa.
    if (modifier.cells.length > cells) fail(`${where}.cells má víc prvků než mapa dlaždic`);
    modifier.cells.forEach((cell, j) => inRange(cell, 0, cells - 1, `${where}.cells[${j}]`));
    inRealRange(modifier.amount, -1e6, 1e6, `${where}.amount`);
    inRange(modifier.until, 0, Number.MAX_SAFE_INTEGER, `${where}.until`);
    inRange(modifier.source, 0, Number.MAX_SAFE_INTEGER, `${where}.source`);
  });
  for (const [kind, tick] of Object.entries(disasters.lastOccurrence)) {
    inRange(tick, 0, Number.MAX_SAFE_INTEGER, `${what}.lastOccurrence.${kind}`);
  }
  for (const [kind, ceiling] of Object.entries(disasters.riskCeiling)) {
    inRealRange(ceiling, 0, 1e6, `${what}.riskCeiling.${kind}`);
  }
  disasters.offlinePlants.forEach((id, i) =>
    inRange(id, 1, MAX_BUILDING_ID, `${what}.offlinePlants[${i}]`),
  );
  disasters.infection.forEach(([cell, level], i) => {
    inRange(cell, 0, coarseCells - 1, `${what}.infection[${i}][0]`);
    inRealRange(level, 0, 1, `${what}.infection[${i}][1]`);
  });
  disasters.rubbleOf.forEach(([tile, id], i) => {
    inRange(tile, 0, cells - 1, `${what}.rubbleOf[${i}][0]`);
    if (id.length > 256) fail(`${what}.rubbleOf[${i}][1] je příliš dlouhé id`);
  });

  const transit = state.transit;
  inRange(transit.nextLineId, 1, Number.MAX_SAFE_INTEGER, 'state.transit.nextLineId');
  for (const line of transit.lines) {
    // Jízdné se násobí cestujícími a jde do kasy. Nad milion za jízdu to
    // není tarif, ale pokus kasu přetéct.
    inRealRange(line.fare, 0, 1e6, `state.transit.lines[id=${line.id}].fare`);
    // Zastávky se na existenci nekontrolují — neznámá z linky při načtení
    // vypadne (`applyTransitToWorld`). Hlídá se jen délka.
    if (line.stops.length > 1000) fail(`state.transit.lines[id=${line.id}].stops je příliš dlouhé`);
  }
  transit.lostStops.forEach(([tile, lost], i) => {
    inRange(tile, 0, cells - 1, `state.transit.lostStops[${i}][0]`);
    lost.forEach(([lineId, index], j) => {
      inRange(lineId, 1, Number.MAX_SAFE_INTEGER, `state.transit.lostStops[${i}][1][${j}][0]`);
      inRange(index, 0, 1000, `state.transit.lostStops[${i}][1][${j}][1]`);
    });
  });

  const finance = state.finance;
  const loans = new Set<number>();
  for (const loan of finance.loans) {
    if (loans.has(loan.id)) fail(`state.finance.loans[id=${loan.id}].id se v savu opakuje`);
    loans.add(loan.id);
  }
  const bonds = new Set<number>();
  for (const bond of finance.bonds) {
    if (bonds.has(bond.id)) fail(`state.finance.bonds[id=${bond.id}].id se v savu opakuje`);
    bonds.add(bond.id);
  }
  finance.grantProgress.forEach(([id, ticks], i) =>
    inRange(ticks, 0, Number.MAX_SAFE_INTEGER, `state.finance.grantProgress[${i}] (${id})`),
  );
}

/**
 * Hodnoty ve vrstvách mapy (audit T132). Silnice 7 nebo vedení 200 by se
 * načetly, a pak by se četlo mimo tabulku cen a kapacit — silnice bez
 * kapacity, vedení bez stropu. Patra nad `MAX_HEIGHT` rozbijí kaskádu.
 */
function checkLayerValuesFit(save: SaveData, size: number): void {
  const cells = size * size;
  const limits: Partial<Record<(typeof SAVE_LAYER_ORDER)[number], number>> = {
    terrain: Math.max(...Object.values(TERRAIN)),
    zone: Math.max(...Object.values(ZONE)),
    road: Math.max(...Object.values(ROAD)),
    power: 1,
    pipe: 1,
    wire: Math.max(...Object.values(WIRE)),
  };

  let offset = 0;
  for (const name of SAVE_LAYER_ORDER) {
    const width = name === 'buildingId' ? 4 : 1;
    const limit = limits[name];
    if (limit !== undefined) {
      const layer = save.layers.subarray(offset, offset + cells);
      for (let tile = 0; tile < cells; tile++) {
        if ((layer[tile] ?? 0) > limit) {
          fail(`${SAVE_FILES.layers}: vrstva ${name} má na dlaždici ${tile} hodnotu ${layer[tile]}, nejvýš smí ${limit}`);
        }
      }
    }
    offset += cells * width;
  }

  for (let corner = 0; corner < save.heights.length; corner++) {
    if ((save.heights[corner] ?? 0) > MAX_HEIGHT) {
      fail(`${SAVE_FILES.heights}: roh ${corner} má patro ${save.heights[corner]}, nejvýš smí ${MAX_HEIGHT}`);
    }
  }

  // Oheň, povodeň a poškození smí celý bajt; příznak lesa a trosky jen 0/1.
  let disasterOffset = 0;
  for (const name of SAVE_DISASTER_LAYER_ORDER) {
    if (name === 'fireFlags' || name === 'rubble') {
      const layer = save.disasters.subarray(disasterOffset, disasterOffset + cells);
      for (let tile = 0; tile < cells; tile++) {
        if ((layer[tile] ?? 0) > 1) {
          fail(`${SAVE_FILES.disasters}: vrstva ${name} má na dlaždici ${tile} hodnotu ${layer[tile]}, nejvýš smí 1`);
        }
      }
    }
    disasterOffset += cells;
  }
}

/** Desetinné číslo v mezích. Nekonečno ani NaN neprojde. */
function inRealRange(value: number, low: number, high: number, what: string): void {
  if (!Number.isFinite(value) || value < low || value > high) {
    fail(`${what} je ${value}, čeká se číslo mezi ${low} a ${high}`);
  }
}

/**
 * Stav s pamětí (verze 15). Save sdílený na Discordu je cizí vstup, takže se
 * meze hlídají i tady: dlaždice mimo mapu by zapsala za konec vrstvy
 * a necelé jízdné by udělalo necelou kasu, kterou pak hra odmítne uložit.
 */
function checkDerivedFits(save: SaveData, size: number): void {
  const derived = save.state.derived;
  const cells = size * size;
  const coarseCells = coarseCellsOf(size);
  const what = 'state.derived';

  derived.trafficLoad.forEach(([tile, load], i) => {
    inRange(tile, 0, cells - 1, `${what}.trafficLoad[${i}][0]`);
    inRealRange(load, 0, 1e9, `${what}.trafficLoad[${i}][1]`);
  });
  derived.jobAccess.forEach(([id, access], i) => {
    inRange(id, 1, MAX_BUILDING_ID, `${what}.jobAccess[${i}][0]`);
    inRealRange(access, 0, 1, `${what}.jobAccess[${i}][1]`);
  });
  derived.lineStats.forEach(([id, stats], i) => {
    const where = `${what}.lineStats[${i}]`;
    inRange(id, 1, Number.MAX_SAFE_INTEGER, `${where}[0]`);
    inRealRange(stats.demand, 0, 1e12, `${where}.demand`);
    inRealRange(stats.capacity, 0, 1e12, `${where}.capacity`);
    inRealRange(stats.transported, 0, 1e12, `${where}.transported`);
    // Příjem a údržba jdou rovnou do kasy, a ta musí zůstat celá.
    inRange(stats.income, 0, 1e12, `${where}.income`);
    inRange(stats.upkeep, 0, 1e12, `${where}.upkeep`);
  });
  derived.transitRelief.forEach(([cell, relief], i) => {
    inRange(cell, 0, coarseCells - 1, `${what}.transitRelief[${i}][0]`);
    // Součet podílů nepřekročí jedničku jen v přesné aritmetice; v plovoucí
    // čárce může vyjít o zaokrouhlení výš.
    inRealRange(relief, 0, 1 + 1e-9, `${what}.transitRelief[${i}][1]`);
  });
  for (const key of ['downgradeStreak', 'waterlessStreak'] as const) {
    derived[key].forEach(([id, streak], i) => {
      inRange(id, 1, MAX_BUILDING_ID, `${what}.${key}[${i}][0]`);
      inRange(streak, 0, 1e6, `${what}.${key}[${i}][1]`);
    });
  }
  const classes = new Set<string>();
  derived.coverage.forEach(([serviceClass, values], i) => {
    const where = `${what}.coverage[${i}]`;
    if (classes.has(serviceClass)) fail(`${where}: třída ${serviceClass} se opakuje`);
    classes.add(serviceClass);
    if (values.length !== coarseCells) {
      fail(`${where} má ${values.length} buněk, k mapě ${size} × ${size} patří ${coarseCells}`);
    }
    values.forEach((value, cell) => inRange(value, 0, 255, `${where}[${cell}]`));
  });
  derived.watered.forEach((id, i) => inRange(id, 1, MAX_BUILDING_ID, `${what}.watered[${i}]`));
}

/**
 * Nasype save do **existujícího** světa.
 *
 * Nevytváří nový objekt schválně: renderer i UI drží `getSnapshot()` jako živý
 * pohled (T2), takže výměna objektu by jim nechala zastaralou referenci.
 */
export function applySaveToWorld(world: WorldState, save: SaveData): void {
  // **Nejdřív kontrola, teprve pak zápis.** Rozehrané město se nesmí přepsat
  // savem, který se stejně nenačte — viz `checkSaveFits`.
  checkSaveFits(save);

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
  // `lastPopulation` se bere **ze savu** (audit T132). Do T132 se tady
  // dopočítávala z budov u každého savu, takže první měsíční uzávěrka po
  // načtení měřila růst proti jinému číslu než hra bez přerušení. Savu
  // starší verze 6, který ji nenese, ji z budov dopočítá migrace.

  // Hrubé vrstvy nese formát verze 2. Starší save jimi projde s vynulovaným
  // `coarse.bin`, který mu doplnila migrace. Za nimi od verze 15 spokojenost;
  // starším ji migrace doplnila neutrální.
  unpackCoarseInto(save.coarse, world.coarse, world.happiness, size);
  // Patra nese verze 4; starším je migrace doplnila jako rovinu.
  unpackHeightsInto(save.heights, world.cornerHeight, size);

  // Odvozený a runtime stav předchozího města nesmí přetéct do načteného.
  // Pokrytí se **musí** označit za špinavé: bez toho by ho `serviceSystem`
  // nikdy nepřepočítal a všechny služby by po loadu přestaly fungovat —
  // žádný bonus k ceně půdy, žádné srážení kriminality, žádné zdravotnictví.
  //
  // Od verze 15 se ale nejdřív převezme pokrytí ze savu (T132): katastrofy,
  // oheň a povodeň z něj čtou v prvním tiku dřív, než se přepočítá. Přepočet
  // pak dá totéž, co by dala hra bez přerušení — pokrytí je čistá funkce města.
  world.coverage.clear();
  for (const [serviceClass, values] of save.state.derived.coverage) {
    world.coverage.set(serviceClass, Uint8Array.from(values));
  }
  world.coverageDirty = true;
  world.serviceFunding.clear();
  for (const [serviceClass, funding] of Object.entries(save.state.serviceFunding)) {
    world.serviceFunding.set(serviceClass, funding);
  }
  const derived = save.state.derived;
  // Počítadla chátrání jsou hystereze, tedy paměť — od verze 15 se ukládají
  // (T132). Starší save je nemá a začne od nuly, jako do té doby každý.
  world.downgradeStreak.clear();
  for (const [id, streak] of derived.downgradeStreak) {
    if (world.buildings.has(id)) world.downgradeStreak.set(id, streak);
  }

  // Zátěž silnic a dosažitelnost práce se **vyhlazují** přes mnoho běhů
  // vzorkování, takže se od verze 15 ukládají (T132). Co přijde odjinud než
  // ze savu, se vynuluje: z předchozího města nesmí přetéct nic.
  world.trafficLoad.fill(0);
  for (const [tile, load] of derived.trafficLoad) world.trafficLoad[tile] = load;
  world.jobAccess.clear();
  for (const [id, access] of derived.jobAccess) {
    if (world.buildings.has(id)) world.jobAccess.set(id, access);
  }
  // Násobitele dostupnosti jsou **výstup** růstu, ne paměť: růst je přepíše
  // dřív, než je kdokoli kromě panelu parcely použije.
  world.jobAccessCells = new Float32Array(coarseCellsOf(size)).fill(1);
  world.cityJobAccess = 1;
  world.trafficCursor = save.state.trafficCursor;

  // Voda je odvozená z potrubí a zdrojů, takže se musí **vynulovat**, ne
  // nechat přetéct, a v prvním tiku se přepočítá. Seznam zavodněných budov se
  // ale převezme ze savu (verze 15): epidemie a los katastrof se na něj ptají
  // ještě před vodovodem.
  world.waterSupply.fill(0);
  world.watered.clear();
  for (const id of save.state.derived.watered) {
    if (world.buildings.has(id)) world.watered.add(id);
  }
  world.waterlessStreak.clear();
  for (const [id, streak] of derived.waterlessStreak) {
    if (world.buildings.has(id)) world.waterlessStreak.set(id, streak);
  }
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

  // Pohroma, jejíž vlastní stav nedává smysl, se **ukončí**, ne načte (audit
  // T132): plánovač ji v prvním tiku uklidí i s postihy, jako by doběhla.
  // Celý save kvůli ní odmítat nemá cenu — hráč by přišel o město kvůli
  // jednomu požáru. Stav se zahodí, ať ho nečte ani rozhraní.
  world.disasters.active = raw.active.map((entry) => {
    const onMap = inBounds(entry.x, entry.y, size);
    const usable = onMap && disasterStateProblem(size, entry.state) === null;
    return {
      id: entry.id,
      kind: entry.kind,
      startedAtTick: entry.startedAtTick,
      x: onMap ? entry.x : 0,
      y: onMap ? entry.y : 0,
      state: usable ? { ...entry.state } : {},
      finished: entry.finished || !usable,
    };
  });

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
 * Koridor tramvají se označí za špinavý, aby se dopočítal hned — je to čistá
 * funkce linek a silnic.
 */
function applyTransitToWorld(world: WorldState, save: SaveData): void {
  // Zastávka, kterou svět nezná, z linky **vypadne**. Za běhu to dělá
  // `removeBuilding` při zbourání; v savu to je totéž — jen budova zmizela
  // dřív, než se stav uložil, nebo si se souborem někdo hrál.
  world.lines = save.state.transit.lines.map((line) => ({
    id: line.id,
    mode: line.mode,
    stops: line.stops.filter((stop) => world.buildings.has(stop)),
    vehicles: line.vehicles,
    paused: line.paused,
    fare: line.fare,
  }));
  world.nextLineId = save.state.transit.nextLineId;

  world.lostStops.clear();
  for (const [tile, lost] of save.state.transit.lostStops) {
    world.lostStops.set(
      tile,
      lost.map(([lineId, at]) => ({ lineId, index: at })),
    );
  }

  // Statistiky přepravy se počítají **jednou za měsíc** a do té doby z nich
  // čte rozpočet i doprava. Dopočítat je hned po načtení by znamenalo počítat
  // z jiného města, než ze kterého je spočítala hra bez přerušení — proto se
  // od verze 15 ukládají (T132). Linka, která ze savu nevzešla, statistiku
  // nedostane; zbytek vyřeší příští uzávěrka.
  const derived = save.state.derived;
  world.lineStats.clear();
  for (const [id, stats] of derived.lineStats) {
    if (world.lines.some((line) => line.id === id)) world.lineStats.set(id, { ...stats });
  }
  world.transitRelief.clear();
  for (const [cell, relief] of derived.transitRelief) world.transitRelief.set(cell, relief);
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
