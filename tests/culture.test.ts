import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { placeBuilding } from '@/sim/buildings';
import { coarseIndex } from '@/sim/coarse';
import { createLandValueSystem, createServiceSystem } from '@/sim/systems';
import { createWorld, tickWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { MAP_SIZE } from './support/grid';
import { powerAll } from './support/power';

/**
 * Kultura a sounáležitost (§9 fáze 3, R12).
 *
 * Obě třídy stojí **nad mechanismem z T13**, takže tenhle soubor netestuje nový
 * kód — testuje, že žádný nebyl potřeba. Kdyby se kdekoli objevila zmínka o
 * konkrétní třídě v kódu, R12 padá a P5 s ním.
 */
async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

function run(world: WorldState, content: ContentRegistry, runs: number): void {
  powerAll(world);
  const systems = [createServiceSystem(content), createLandValueSystem(content.getBalance())];
  for (let tick = 0; tick < runs * 16 + 11; tick++) tickWorld(world, systems);
}

describe('nové třídy služeb', () => {
  it('vanilla nabízí kulturu i sounáležitost', async () => {
    const content = await vanilla();
    const byClass = new Map<string, string[]>();

    for (const definition of content.getAll('building')) {
      const serviceClass = definition.service?.class;
      if (!serviceClass) continue;
      byClass.set(serviceClass, [...(byClass.get(serviceClass) ?? []), definition.id]);
    }

    // Zadání jmenuje muzeum, divadlo, kino a výstavní síň; centrum a domov.
    expect(byClass.get('culture')).toHaveLength(4);
    expect(byClass.get('social')).toHaveLength(2);
  });

  it('divadlo pokrývá okolí stejně jako kterákoli jiná služba', async () => {
    const content = await vanilla();
    const theatre = content.get('vanilla:theatre');
    expect(theatre?.service?.class).toBe('culture');
    if (!theatre) return;

    const world = createWorld(1, content.getBalance().economy);
    placeBuilding(world, theatre, 64, 64);
    run(world, content, 2);

    const culture = world.coverage.get('culture');
    expect(culture?.[coarseIndex(64, 64, MAP_SIZE)] ?? 0).toBeGreaterThan(0);
    // A za dosahem nic — je to táž mechanika, ne globální bonus.
    expect(culture?.[coarseIndex(120, 120, MAP_SIZE)] ?? 0).toBe(0);
  });

  it('kultura i sounáležitost zvedají cenu půdy', async () => {
    const content = await vanilla();
    const value = async (id: string | null): Promise<number> => {
      const world = createWorld(1, content.getBalance().economy);
      if (id) {
        const definition = content.get(id);
        if (definition) placeBuilding(world, definition, 64, 64);
      }
      run(world, content, 40);
      return world.coarse.landValue[coarseIndex(64, 64, MAP_SIZE)] ?? 0;
    };

    const prazdno = await value(null);
    expect(await value('vanilla:museum')).toBeGreaterThan(prazdno);
    expect(await value('vanilla:community_centre')).toBeGreaterThan(prazdno);
  });

  it('muzeum táhne dál než výstavní síň', async () => {
    // Rozdíl mezi velkou a malou kulturou je v obsahu, ne v kódu.
    const content = await vanilla();
    const museum = content.get('vanilla:museum');
    const gallery = content.get('vanilla:gallery');
    if (!museum || !gallery) return;

    expect(museum.service?.radius).toBeGreaterThan(gallery.service?.radius ?? 0);
    expect(museum.construction.cost).toBeGreaterThan(gallery.construction.cost);
  });

  it('financování obou tříd jde nastavit jako u kterékoli jiné', async () => {
    const content = await vanilla();
    const theatre = content.get('vanilla:theatre');
    if (!theatre) return;

    const plné = createWorld(1, content.getBalance().economy);
    placeBuilding(plné, theatre, 64, 64);
    run(plné, content, 2);

    const půl = createWorld(1, content.getBalance().economy);
    placeBuilding(půl, theatre, 64, 64);
    půl.serviceFunding.set('culture', 0.5);
    run(půl, content, 2);

    expect(
      půl.coverage.get('culture')?.[coarseIndex(64, 64, MAP_SIZE)] ?? 0,
    ).toBeLessThan(
      plné.coverage.get('culture')?.[coarseIndex(64, 64, MAP_SIZE)] ?? 0,
    );
  });
});
