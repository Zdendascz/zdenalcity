import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ChunkRenderer } from '@/render/chunkRenderer';
import { createWorld } from '@/sim/world';

/**
 * Pořadí uzlů ve světovém kontejneru.
 *
 * Nahlásil autor při hraní: „diamanty se nezobrazují, ani u zón, ani
 * u infrastruktury". Příčina byla, že T30 zapnul `sortableChildren` na
 * **světovém** kontejneru kvůli řazení chunků — a tím propadly pod terén
 * všechny uzly, které zIndex nemají. Rámeček pod kurzorem byl jedním z nich.
 *
 * Pixi se tu dá použít bez pláten a WebGL: `Container` a `Graphics` jsou jen
 * grafy uzlů, dokud je někdo nevykreslí.
 */
describe('vrstvení světového kontejneru', () => {
  it('chunky si řadí vlastní kontejner, ne ten světový', () => {
    const world = createWorld(1);
    const worldContainer = new Container();

    new ChunkRenderer(world, worldContainer);

    // Kdyby se řadil svět, propadne pod terén všechno bez zIndexu.
    expect(worldContainer.sortableChildren).toBe(false);
    expect(worldContainer.children).toHaveLength(1);
    expect(worldContainer.children[0]?.sortableChildren).toBe(true);
  });

  it('uzel přidaný po terénu zůstane nad ním', () => {
    const world = createWorld(1);
    const worldContainer = new Container();
    new ChunkRenderer(world, worldContainer);

    const hover = new Graphics();
    worldContainer.addChild(hover);

    // Poslední dítě se kreslí navrch — a nic ho nesmí přeřadit.
    expect(worldContainer.children.at(-1)).toBe(hover);
  });
});
