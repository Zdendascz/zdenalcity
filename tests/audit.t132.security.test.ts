import { describe, expect, it } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import { applySaveToWorld, readSaveMeta, unpackSave } from '@/save/deserialize';
import { SAVE_FILES, SaveFormatError } from '@/save/format';
import type { SaveData } from '@/save/format';
import { migrate } from '@/save/migrations';
import { packSave, serializeSave, toSaveData } from '@/save/serialize';
import { verifySave } from '@/save/verify';
import { createBlackoutDisaster } from '@/sim/disasters/blackout';
import { createGangWarDisaster } from '@/sim/disasters/gangWar';
import { DisasterRegistry } from '@/sim/disasters/registry';
import type { Disaster } from '@/sim/disasters/registry';
import { createDisasterSystem } from '@/sim/disasters/scheduler';
import { disasterStateProblem } from '@/sim/disasters/state';
import { createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';

const NO_BUILDINGS = { get: () => undefined, byCategory: () => [] };

/**
 * Save je cizí vstup — sdílí se na Discordu (audit T132, nález 12).
 *
 * Tyhle testy staví ZIP **ručně**, bajt po bajtu, protože přesně tak by ho
 * postavil útočník: se seznamem položek, který na jeden záznam ukazuje
 * tisíckrát, nebo s hlavičkou, která o délce po rozbalení lže.
 */

interface Record_ {
  name: string;
  /** Data tak, jak leží v archivu (u deflate už zkomprimovaná). */
  data: Uint8Array;
  compression: 0 | 8;
  /** Délka po rozbalení, jak ji hlásí hlavička. Smí lhát. */
  originalSize: number;
}

/**
 * Poskládá ZIP. `directory` říká, na které záznamy ukazuje ústřední adresář
 * a v jakém pořadí — smí na jeden ukázat víckrát.
 */
function buildZip(records: Record_[], directory: number[] = records.map((_, i) => i)): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  for (const record of records) {
    const name = strToU8(record.name);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, record.compression, true);
    view.setUint32(18, record.data.length, true);
    view.setUint32(22, record.originalSize, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    offsets.push(offset);
    parts.push(header, record.data);
    offset += header.length + record.data.length;
  }

  const start = offset;
  for (const index of directory) {
    const record = records[index]!;
    const name = strToU8(record.name);
    const entry = new Uint8Array(46 + name.length);
    const view = new DataView(entry.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(10, record.compression, true);
    view.setUint32(20, record.data.length, true);
    view.setUint32(24, record.originalSize, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offsets[index]!, true);
    entry.set(name, 46);
    parts.push(entry);
    offset += entry.length;
  }

  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, directory.length, true);
  view.setUint16(10, directory.length, true);
  view.setUint32(12, offset - start, true);
  view.setUint32(16, start, true);
  parts.push(end);

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function deflated(name: string, content: Uint8Array): Record_ {
  return { name, data: deflateSync(content, { level: 1 }), compression: 8, originalSize: content.length };
}

/** Odmítne se to, a rychle. */
function expectFastRejection(bytes: Uint8Array, message: RegExp): void {
  const started = performance.now();
  expect(() => unpackSave(bytes)).toThrow(message);
  expect(performance.now() - started).toBeLessThan(200);
  // Stejně rychle i seznam uložených her, který čte jen meta.
  const metaStarted = performance.now();
  expect(() => readSaveMeta(bytes)).toThrow(SaveFormatError);
  expect(performance.now() - metaStarted).toBeLessThan(200);
}

describe('ZIP bomba (nález 12)', () => {
  it('tisíc odkazů na jeden záznam se odmítne dřív, než se cokoli rozbalí', () => {
    // Megabajt nul, zkomprimovaný na pár kilobajtů, tisíckrát v adresáři.
    // Do T132 se rozbalil tisíckrát.
    const bomb = deflated(SAVE_FILES.layers, new Uint8Array(1024 * 1024));
    const meta = deflated(SAVE_FILES.meta, strToU8('{}'));
    const bytes = buildZip([meta, bomb], [0, ...Array.from({ length: 1000 }, () => 1)]);
    expect(bytes.byteLength).toBeLessThan(256 * 1024);

    expectFastRejection(bytes, /položek/);
  });

  it('dva odkazy na totéž jméno se odmítnou i pod stropem počtu', () => {
    const bomb = deflated(SAVE_FILES.layers, new Uint8Array(1024 * 1024));
    const meta = deflated(SAVE_FILES.meta, strToU8('{}'));
    const bytes = buildZip([meta, bomb], [0, 1, 1]);

    expectFastRejection(bytes, /dvakrát/);
  });

  it('hlavička, která zatají délku, rozbalování utne', () => {
    // Osm megabajtů nul, ale hlavička tvrdí jen tolik, kolik mají
    // komprimovaná data — tím projde i kontrolou poměru. `unzipSync` bral
    // hlášenou délku jen jako počáteční velikost bufferu a zbytek nechal
    // dorůst, takže se rozbalilo všech osm megabajtů.
    const zeros = new Uint8Array(8 * 1024 * 1024);
    const state = deflated(SAVE_FILES.state, zeros);
    const meta = deflated(SAVE_FILES.meta, zeros);
    const bytes = buildZip([
      { ...meta, originalSize: meta.data.length },
      { ...state, originalSize: state.data.length },
    ]);

    expectFastRejection(bytes, /rozbaluje na víc než/);
  });

  it('i hlavička, která tvrdí málo, se odmítne před rozbalením', () => {
    const zeros = new Uint8Array(8 * 1024 * 1024);
    const bomb = { ...deflated(SAVE_FILES.state, zeros), originalSize: 100 };
    const meta = { ...deflated(SAVE_FILES.meta, zeros), originalSize: 100 };

    expectFastRejection(buildZip([meta, bomb]), /delší/);
  });

  it('komprimovaná data delší než výsledek se odmítnou', () => {
    const real = deflated(SAVE_FILES.meta, strToU8('{}'));
    const padded = new Uint8Array(real.data.length + 64 * 1024);
    padded.set(real.data);
    const bytes = buildZip([{ ...real, data: padded }]);

    expect(() => readSaveMeta(bytes)).toThrow(/delší/);
  });

  it('odkaz mimo soubor není ZIP', () => {
    const meta = deflated(SAVE_FILES.meta, strToU8('{}'));
    const bytes = buildZip([meta]);
    // Posune ukazatel na lokální hlavičku za konec souboru.
    const view = new DataView(bytes.buffer);
    const directory = view.getUint32(bytes.length - 22 + 16, true);
    view.setUint32(directory + 42, bytes.length + 10, true);

    expect(() => readSaveMeta(bytes)).toThrow(/ZIP/);
  });

  it('skutečný save pořád projde', () => {
    const bytes = serializeSave(createWorld(1), OPTIONS);
    expect(verifySave(bytes)).toBeNull();
    expect(() => applySaveToWorld(createWorld(2), migrate(unpackSave(bytes)))).not.toThrow();
  });
});

const OPTIONS = {
  cityName: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
  playtimeSeconds: 0,
  sources: [],
};

/** Save světa s jednou běžící pohromou daného stavu. */
function withDisaster(kind: string, state: Record<string, unknown>, x = 20, y = 20): Uint8Array {
  const world = createWorld(1);
  world.disasters.active.push({ id: 1, kind, startedAtTick: 0, x, y, state, finished: false });
  world.disasters.nextId = 2;
  return serializeSave(world, OPTIONS);
}

function loaded(bytes: Uint8Array): WorldState {
  const world = createWorld(2);
  applySaveToWorld(world, migrate(unpackSave(bytes)));
  return world;
}

function schedulerWith(...disasters: Disaster[]) {
  const registry = new DisasterRegistry();
  for (const disaster of disasters) registry.register(disaster);
  return createDisasterSystem(NO_BUILDINGS, VANILLA_BALANCE, registry);
}

describe('vlastní stav pohromy ze savu (nález 13)', () => {
  it('blackout s nesmyslným seznamem elektráren se ukončí, ne spadne každý tik', () => {
    // Přesně tenhle save prošel do T132 kontrolou a pak házel výjimku v každém
    // tiku — hra stála.
    const world = loaded(withDisaster('blackout', { offline: 5 }));
    expect(world.disasters.active[0]?.finished).toBe(true);
    expect(world.disasters.active[0]?.state).toEqual({});

    const system = schedulerWith(createBlackoutDisaster());
    world.tick = 1;
    expect(() => system.run(world)).not.toThrow();
    expect(world.disasters.active).toHaveLength(0);
  });

  it('válka gangů s obřím poloměrem se ukončí dřív, než protočí smyčku', () => {
    const started = performance.now();
    const world = loaded(withDisaster('gangWar', { radius: 1e9, cells: [] }));
    expect(world.disasters.active[0]?.finished).toBe(true);

    const system = schedulerWith(createGangWarDisaster());
    world.tick = 1;
    system.run(world);
    expect(world.disasters.active).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('buňky mimo mapu, vnořený objekt i pohroma mimo mapu se ukončí', () => {
    for (const bytes of [
      withDisaster('strike', { cells: [0, 1e12] }),
      withDisaster('flood', { front: [-1] }),
      withDisaster('riot', { nested: { a: 1 } }),
      withDisaster('fire', { lit: 3 }, 5000, 5000),
    ]) {
      expect(loaded(bytes).disasters.active[0]?.finished).toBe(true);
    }
  });

  it('platný stav se načte beze změny', () => {
    const state = { offline: [3, 4], calm: 2, age: 10, span: 40, recovering: false, dead: 0.4 };
    const world = loaded(withDisaster('blackout', state));
    expect(world.disasters.active[0]?.finished).toBe(false);
    expect(world.disasters.active[0]?.state).toEqual(state);
  });

  it('kontrola podle jména pole', () => {
    expect(disasterStateProblem(128, { radius: 12, cells: [0, 1023] })).toBeNull();
    expect(disasterStateProblem(128, { cells: [1024] })).not.toBeNull();
    expect(disasterStateProblem(128, { left: Number.NaN })).not.toBeNull();
    expect(disasterStateProblem(128, { reason: 'x'.repeat(300) })).not.toBeNull();
  });
});

/** Save světa, kterému se před zabalením upraví data. */
function patched(edit: (save: SaveData) => void): Uint8Array {
  const save = toSaveData(createWorld(1), OPTIONS);
  edit(save);
  return packSave(save);
}

describe('meze hodnot ze savu (nález 14)', () => {
  const cases: [string, (save: SaveData) => void, RegExp][] = [
    ['záporný tik', (s) => (s.state.tick = -5), /state\.tick/],
    ['kasa na hraně přesnosti', (s) => (s.state.economy.funds = Number.MAX_SAFE_INTEGER), /funds/],
    ['rating nad jedničku', (s) => (s.state.economy.creditRating = 1.5), /creditRating/],
    ['kurzor dopravy', (s) => (s.state.trafficCursor = 1e15), /trafficCursor/],
    [
      'nákaza',
      (s) => (s.state.disasters.infection = [[1e15, 1e300]]),
      /infection/,
    ],
    [
      'buňka postihu',
      (s) =>
        (s.state.disasters.modifiers = [
          { kind: 'spikeCrime', cells: [-5, 1e12], amount: 1, until: 10, source: 0 },
        ]),
      /cells/,
    ],
    [
      'síla postihu',
      (s) =>
        (s.state.disasters.modifiers = [
          { kind: 'spikeCrime', cells: [], amount: 1e308, until: 10, source: 0 },
        ]),
      /amount/,
    ],
    [
      'neznámý postih',
      (s) =>
        (s.state.disasters.modifiers = [{ kind: 'bomba', cells: [], amount: 1, until: 10, source: 0 }]),
      /bomba/,
    ],
    ['elektrárny blackoutu', (s) => (s.state.disasters.offlinePlants = [-3]), /offlinePlants/],
    ['trosky mimo mapu', (s) => (s.state.disasters.rubbleOf = [[1e9, 'vanilla:park_small']]), /rubbleOf/],
    [
      'jízdné',
      (s) =>
        (s.state.transit.lines = [
          { id: 1, mode: 'bus', stops: [], vehicles: 0, fare: 1e308, paused: false },
        ]),
      /fare/,
    ],
    ['ztracené zastávky', (s) => (s.state.transit.lostStops = [[-1, []]]), /lostStops/],
    ['postup grantu', (s) => (s.state.finance.grantProgress = [['vanilla:grant', -4]]), /grantProgress/],
    [
      'dvě půjčky s jedním id',
      (s) => {
        const loan = { id: 1, principal: 10, remaining: 10, rate: 5, payment: 1, termMonths: 12, paidMonths: 0 };
        s.state.finance.loans = [loan, { ...loan }];
      },
      /opakuje/,
    ],
    ['silnice typu 7', (s) => (s.layers[128 * 128 * 2] = 7), /vrstva road/],
    ['vedení typu 9', (s) => (s.layers[128 * 128 * 9] = 9), /vrstva wire/],
    ['terén 200', (s) => (s.layers[5] = 200), /vrstva terrain/],
    ['patro 16', (s) => (s.heights[3] = 16), /heights\.bin/],
    ['trosky 2', (s) => (s.disasters[128 * 128 * 6] = 2), /rubble/],
  ];

  for (const [name, edit, message] of cases) {
    it(`${name} se odmítne`, () => {
      const problem = verifySave(patched(edit));
      expect(problem).not.toBeNull();
      expect(problem?.message).toMatch(message);
    });
  }
});
