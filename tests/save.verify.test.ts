import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { applySaveToWorld, readSaveMeta, unpackSave } from '@/save/deserialize';
import { SAVE_FILES, SaveFormatError } from '@/save/format';
import { migrate } from '@/save/migrations';
import { serializeSave } from '@/save/serialize';
import type { SaveOptions } from '@/save/serialize';
import { planInGameLoad, verifySave } from '@/save/verify';
import { buildRoad, setServiceFunding, setTaxRate } from '@/sim/commands';
import { MAX_FUNDING } from '@/sim/funding';
import { ZONE } from '@/sim/layers';
import { createWorld, MAX_TAX_RATE, MIN_TAX_RATE, totalPopulation } from '@/sim/world';
import type { WorldState } from '@/sim/world';

/**
 * Hra nesmí uložit město, které sama nenačte.
 *
 * Stalo se to: posuvník financování pustil služby na 150 %, loader bral jen
 * 0–1 a hráč přišel o město při dalším startu. `verifySave` je pojistka, která
 * běží před každým zápisem. Tady se hlídá, že rozchod mezí opravdu chytí a že
 * všechno, co ovládání dovolí, projde.
 */

const OPTIONS: SaveOptions = {
  cityName: 'Nový Brod',
  createdAt: '2026-09-11T10:00:00.000Z',
  modifiedAt: '2026-09-11T12:00:00.000Z',
  playtimeSeconds: 600,
  sources: [{ id: 'vanilla', version: '0.1.0' }],
};

/** Třídy služeb ve vanille — přesně ty, které nesl save hráče. */
const SERVICE_CLASSES = ['culture', 'education', 'fire', 'health', 'parks', 'police', 'social', 'transit'];

/**
 * Savy od hráčů, které se kdysi nenačetly. Base64 ze stejného důvodu jako
 * fixtury verzí (`migrations.test.ts`): testy nemají typy pro `fs`.
 */
const regressions = import.meta.glob('./fixtures/regressions/*.base64', {
  eager: true,
  import: 'default',
  query: '?raw',
});

function decode(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function smallCity(): WorldState {
  const world = createWorld(20260911);
  for (let x = 10; x <= 30; x++) buildRoad(world, x, 20);
  return world;
}

describe('pojistka před uložením', () => {
  it('běžné město projde', () => {
    expect(verifySave(serializeSave(smallCity(), OPTIONS))).toBeNull();
  });

  it('projde všechno, co posuvníky dovolí', () => {
    const world = smallCity();
    for (const serviceClass of SERVICE_CLASSES) setServiceFunding(world, serviceClass, MAX_FUNDING);
    for (const zone of [ZONE.residential, ZONE.commercial, ZONE.industrial]) {
      setTaxRate(world, zone, MAX_TAX_RATE);
    }
    expect(verifySave(serializeSave(world, OPTIONS))).toBeNull();

    for (const serviceClass of SERVICE_CLASSES) setServiceFunding(world, serviceClass, 0);
    for (const zone of [ZONE.residential, ZONE.commercial, ZONE.industrial]) {
      setTaxRate(world, zone, MIN_TAX_RATE);
    }
    expect(verifySave(serializeSave(world, OPTIONS))).toBeNull();
  });

  it('chytí save, který by se při startu nenačetl', () => {
    const files = unzipSync(serializeSave(smallCity(), OPTIONS));
    const state = JSON.parse(strFromU8(files[SAVE_FILES.state] as Uint8Array)) as {
      serviceFunding: Record<string, number>;
    };
    state.serviceFunding['police'] = MAX_FUNDING + 1;
    files[SAVE_FILES.state] = strToU8(JSON.stringify(state));

    const problem = verifySave(zipSync(files));
    expect(problem).toBeInstanceOf(SaveFormatError);
    expect(problem?.message).toContain('state.serviceFunding.police');
  });
});

describe('načtení do rozehrané hry', () => {
  // Save hráče je na mapě 192 × 192. Hráč ho otevřel ve hře na 128 × 128 a viděl
  // mapu bez města: renderer si velikost bere při startu.
  const overfunded = (): Uint8Array => {
    const entry = Object.entries(regressions).find(([path]) => path.includes('overfunded-services'));
    if (!entry) throw new Error('chybí fixtura overfunded-services');
    return decode(entry[1] as string);
  };

  it('se stejnou velikostí mapy se načte na místě', () => {
    const plan = planInGameLoad(overfunded(), 192);
    expect(plan.kind).toBe('inPlace');
    if (plan.kind === 'inPlace') expect(plan.save.meta.grid?.size).toBe(192);
  });

  it('s jinou velikostí mapy jde přes nový start', () => {
    expect(planInGameLoad(overfunded(), 128).kind).toBe('restart');
  });

  it('save, který by se nenačetl, neprojde vůbec — ani přes nový start', () => {
    const files = unzipSync(serializeSave(smallCity(), OPTIONS));
    const state = JSON.parse(strFromU8(files[SAVE_FILES.state] as Uint8Array)) as {
      serviceFunding: Record<string, number>;
    };
    state.serviceFunding['fire'] = -1;
    files[SAVE_FILES.state] = strToU8(JSON.stringify(state));

    const plan = planInGameLoad(zipSync(files), 192);
    expect(plan.kind).toBe('invalid');
  });
});

describe('savy, které se kdysi nenačetly', () => {
  it('existuje aspoň jeden', () => {
    expect(Object.keys(regressions).length).toBeGreaterThan(0);
  });

  for (const [path, raw] of Object.entries(regressions)) {
    const name = path.split('/').pop() ?? path;

    it(`${name} se načte celý`, () => {
      const bytes = decode(raw as string);
      expect(verifySave(bytes)).toBeNull();

      const meta = readSaveMeta(bytes);
      const world = createWorld(1);
      applySaveToWorld(world, migrate(unpackSave(bytes)));

      expect(world.tick).toBe(meta.preview.tick);
      expect(totalPopulation(world.buildings)).toBe(meta.preview.population);
      expect(world.economy.funds).toBe(meta.preview.funds);
    });
  }

  it('město se službami na 150 % si financování ponechá', () => {
    const entry = Object.entries(regressions).find(([path]) => path.includes('overfunded-services'));
    expect(entry).toBeDefined();
    if (!entry) return;

    const world = createWorld(1);
    applySaveToWorld(world, migrate(unpackSave(decode(entry[1] as string))));

    for (const serviceClass of SERVICE_CLASSES) {
      expect(world.serviceFunding.get(serviceClass)).toBe(1.5);
    }
  });
});
