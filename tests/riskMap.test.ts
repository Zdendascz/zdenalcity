import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { buildPipe, buildRoad, placeDefinition } from '@/sim/commands';
import { coarseCellsOf, coarseIndex } from '@/sim/coarse';
import { computeRiskMap, RISK_WARNING } from '@/sim/disasters/riskMap';
import { ROAD } from '@/sim/layers';
import { createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { assumeWatered } from './support/water';

/**
 * Mapa rizika nepřírodních katastrof (T90).
 *
 * Autor si vyžádal varování tam, „kde hrozí s vysokou mírou pravděpodobnosti".
 * Testuje se proto **směr, ne konkrétní čísla**: že postavená služba riziko
 * srazí a že prázdná krajina žádné nemá. Kdyby se pinovaly hodnoty, každé
 * doladění vah by test rozbilo, aniž by se cokoli pokazilo.
 */

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Zapíše pokrytí přímo, bez běhu systému služeb — testuje se mapa, ne služby. */
function cover(world: WorldState, serviceClass: string, value: number): void {
  const field = new Uint8Array(coarseCellsOf(world.size)).fill(value);
  world.coverage.set(serviceClass, field);
}

/**
 * Ulice s vodovodem a řadou domů kolem dlaždice (34, 31).
 *
 * Trubky tam jsou proto, že bez nich `placeDefinition` obytný dům odmítne
 * (`error.needsWater`) a v buňce by nestálo nic. Na tom padla první verze
 * těchhle testů — mapa vycházela na nulu a vypadalo to jako chyba v ní.
 */
function district(world: WorldState, content: ContentRegistry): void {
  for (let x = 30; x <= 40; x++) {
    expect(buildRoad(world, x, 30, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(buildPipe(world, x, 30, VANILLA_BALANCE).ok).toBe(true);
  }
  // Samotné potrubí nestačí: musí v něm **téct**. Vodárnu a rozvod by testy
  // rizika jen zanesly šumem, takže se použije stejný helper jako jinde.
  assumeWatered(world);
  for (let x = 31; x <= 39; x += 2) {
    const placed = placeDefinition(
      world,
      content,
      'vanilla:residential_small',
      x,
      31,
      VANILLA_BALANCE,
    );
    expect(placed.ok, `dům na ${x}, 31: ${placed.ok ? '' : placed.reason}`).toBe(true);
  }
}

describe('mapa rizika', () => {
  it('prázdná krajina nemá riziko žádné', async () => {
    const content = await vanilla();
    const world = createWorld(1);

    const risk = computeRiskMap(world, content, content.getBalance());
    expect([...risk.values].every((value) => value === 0)).toBe(true);
    expect(risk.kinds.every((kind) => kind === undefined)).toBe(true);
  });

  it('zastavěná čtvrť bez hasičů je ohrožená a hlásí požár', async () => {
    const content = await vanilla();
    const world = createWorld(1);

    district(world, content);

    const cell = coarseIndex(34, 31, world.size);
    const risk = computeRiskMap(world, content, content.getBalance());

    // Testuje se **kdo vede, ne o kolik**: prahy i váhy se budou ladit a test,
    // který si píše čísla, by pak padal, aniž by se cokoli pokazilo.
    expect(risk.kinds[cell]).toBe('fire');
    expect(risk.values[cell] ?? 0).toBeGreaterThan(0);
  });

  it('hasiči riziko srazí', async () => {
    const content = await vanilla();
    const world = createWorld(1);
    district(world, content);

    const cell = coarseIndex(34, 31, world.size);
    const before = computeRiskMap(world, content, content.getBalance()).values[cell] ?? 0;

    cover(world, 'fire', 255);
    const after = computeRiskMap(world, content, content.getBalance()).values[cell] ?? 0;

    expect(after).toBeLessThan(before);
  });

  it('kriminalita bez policie hlásí nepokoje', async () => {
    const content = await vanilla();
    const world = createWorld(1);
    district(world, content);

    const cell = coarseIndex(34, 31, world.size);
    // Čtvrť bez hasičů, ale s hořlavostí — a s kriminalitou na maximu.
    cover(world, 'fire', 255);
    world.coarse.crime[cell] = 255;

    const risk = computeRiskMap(world, content, content.getBalance());
    expect(risk.kinds[cell]).toBe('riot');

    // A policie ji srazí. Ne na nulu — kriminalita sama zůstane —, ale níž.
    const before = risk.values[cell] ?? 0;
    cover(world, 'police', 255);
    const after = computeRiskMap(world, content, content.getBalance()).values[cell] ?? 0;
    expect(after).toBeLessThan(before);
  });

  it('riziko se skládá maximem, ne součtem', async () => {
    // Tři drobná rizika vedle sebe nesmí vyjít jako poplach. Odpověď na „co mi
    // tady hrozí" je jedna věc, kterou má hráč řešit.
    const content = await vanilla();
    const world = createWorld(1);
    district(world, content);

    const cell = coarseIndex(34, 31, world.size);
    cover(world, 'fire', 200);
    cover(world, 'police', 200);
    cover(world, 'health', 200);
    world.coarse.crime[cell] = 60;

    const risk = computeRiskMap(world, content, content.getBalance());
    expect(risk.values[cell] ?? 0).toBeLessThan(RISK_WARNING);
  });
});
