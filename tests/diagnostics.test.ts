import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { buildRoad, zoneArea } from '@/sim/commands';
import { COARSE_CELLS, coarseIndex } from '@/sim/coarse';
import { explainLandValue, explainParcel, landValueContext } from '@/sim/diagnostics';
import { ZONE } from '@/sim/layers';
import { createDefaultSystems, createLandValueSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

/** Město se službami i špínou, aby měl rozpis co ukazovat. */
async function city(): Promise<{ world: WorldState; content: ContentRegistry }> {
  const content = await vanilla();
  const balance = content.getBalance();
  const world = createWorld(1, balance.economy);

  for (let x = 20; x <= 40; x++) buildRoad(world, x, 30);
  zoneArea(world, 21, 31, 19, 3, ZONE.residential);
  const park = content.get('vanilla:park_small');
  const factory = content.get('vanilla:industrial_small');
  if (park) placeBuilding(world, park, 22, 29);
  if (factory) {
    for (let x = 34; x <= 38; x++) placeBuilding(world, factory, x, 34);
  }

  const systems = createDefaultSystems(content, balance);
  for (let tick = 0; tick < 400; tick++) tickWorld(world, systems);
  return { world, content };
}

describe('rozpis ceny půdy', () => {
  it('součet sčítanců je přesně to, kam vrstva míří', async () => {
    // Kdyby si diagnostika počítala vlastní vzorec, ukazovala by hráči něco
    // jiného, než podle čeho se hraje. Proto ho sdílí se systémem — a tenhle
    // test hlídá, že se ta jedna cesta nerozdvojí.
    const { world, content } = await city();
    const balance = content.getBalance();

    const before = new Uint8Array(world.coarse.landValue);
    const targets = new Map<number, number>();
    // Kontext se počítá jednou za běh, ne pro každou buňku — stejně jako
    // v systému. Uvnitř smyčky by z toho byly čtyři průchody mapou krát 1024.
    const context = landValueContext(world, balance);
    for (let cell = 0; cell < COARSE_CELLS; cell++) {
      const explained = explainLandValue(world, balance, cell, context);
      expect(explained.terms.reduce((sum, term) => sum + term.amount, 0)).toBeCloseTo(explained.raw);
      expect(explained.current).toBe(before[cell]);
      targets.set(cell, explained.raw);
    }

    // Vrstva se k rozpisu smí jen blížit, nikdy se od něj vzdálit…
    const system = createLandValueSystem(balance);
    for (let i = 0; i <= system.offset + system.interval; i++) tickWorld(world, [system]);

    for (let cell = 0; cell < COARSE_CELLS; cell++) {
      const target = targets.get(cell) ?? 0;
      const from = before[cell] ?? 0;
      const to = world.coarse.landValue[cell] ?? 0;
      if (to === from) continue;
      expect(Math.sign(to - from), `buňka ${cell}`).toBe(Math.sign(target - from));
    }

    // …a když jí necháme čas, dojde přesně tam, kam rozpis ukazuje.
    for (let i = 0; i < system.interval * 40; i++) tickWorld(world, [system]);
    for (let cell = 0; cell < COARSE_CELLS; cell++) {
      const target = Math.max(0, Math.min(255, targets.get(cell) ?? 0));
      expect(world.coarse.landValue[cell] ?? 0, `buňka ${cell}`).toBeCloseTo(target, -0.5);
    }
  });

  it('pojmenuje, co cenu půdy sráží a co ji zvedá', async () => {
    const { world, content } = await city();
    const cell = coarseIndex(22, 31); // u parku
    const balance = content.getBalance();
    const explained = explainLandValue(world, balance, cell, landValueContext(world, balance));
    const by = new Map(explained.terms.map((term) => [term.source, term]));

    expect(by.get('base')?.amount).toBe(content.getBalance().landValue.base);
    expect(by.get('parks')?.amount).toBeGreaterThan(0);
    expect(by.get('pollution')?.amount ?? 0).toBeLessThanOrEqual(0);
  });
});

describe('rozbor parcely', () => {
  it('řekne, jak daleko je silnice a jestli tam vůbec něco vyroste', async () => {
    const { world, content } = await city();
    const balance = content.getBalance();

    const nearRoad = explainParcel(world, balance, 25, 31);
    expect(nearRoad.roadDistance).toBe(1);
    expect(nearRoad.roadFactor).toBe(1);

    // Parcela hluboko mimo dosah — tohle je ta odpověď na „proč mi tu nic neroste".
    const far = explainParcel(world, balance, 25, 60);
    expect(far.roadDistance).toBeNull();
    expect(far.roadFactor).toBe(0);
  });

  it('nese zónu, poptávku i práh další úrovně', async () => {
    const { world, content } = await city();
    world.demand.residential = content.getBalance().demand.limit;

    const parcel = explainParcel(world, content.getBalance(), 25, 31);

    expect(parcel.zone).toBe(ZONE.residential);
    expect(parcel.category).toBe('residential');
    expect(parcel.demand).toBe(content.getBalance().demand.limit);
    // Při plné poptávce je práh snížený o celou úlevu (§8).
    expect(parcel.levels.demandRelief).toBe(content.getBalance().levels.demandRelief);
  });

  it('mimo zónu poptávku nevymýšlí', async () => {
    const { world, content } = await city();
    const parcel = explainParcel(world, content.getBalance(), 5, 5);

    expect(parcel.category).toBeNull();
    expect(parcel.demand).toBeNull();
    expect(parcel.levels.demandRelief).toBe(0);
  });

  it('u stojící budovy ukazuje práh její další úrovně', async () => {
    const { world, content } = await city();
    const balance = content.getBalance();
    const house = content.get('vanilla:residential_medium'); // úroveň 2
    expect(house).toBeDefined();
    if (!house) return;

    placeBuilding(world, house, 26, 32);
    const parcel = explainParcel(world, balance, 26, 32);

    expect(parcel.levels.nextThreshold).toBe(balance.levels.thresholds[3]);
  });
});
