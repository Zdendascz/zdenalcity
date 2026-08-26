/**
 * @vitest-environment jsdom
 *
 * Pixi si při importu sáhne na `navigator` (`isSafari`), takže tenhle soubor
 * potřebuje DOM. Je to pragma pro jeden soubor, ne globální nastavení —
 * simulační testy tím zůstávají ve `node` a neplatí za jsdom časem.
 */
import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import {
  CHUNK_MARGIN,
  CHUNK_SIZE,
  ChunkRenderer,
  RING_BUDGET,
  viewportFor,
} from '@/render/chunkRenderer';
import { applyHeightChanges, createDirtySet, createWorld } from '@/sim/world';
import type { WorldState } from '@/sim/world';
import { cornerIndex, MAX_HEIGHT, tileCorners } from '@/sim/heights';
import { tileQuad, TILE_H, TILE_W } from '@/render/projection';

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

/**
 * Uvolňování chunků (R20 fáze 4).
 *
 * Do T44 se pekly všechny naráz. Na 512 × 512 to bylo 1024 chunků, první
 * snímek 1,6 s a halda 573 MB — naměřeno v prohlížeči, ne odhadnuto. Teď se
 * drží jen viditelné plus jeden prstenec za okrajem.
 *
 * **Co se od koho neptá:** testy si viditelnost počítají samy, z promítnutých
 * dlaždic a skutečných výšek — ne z obálek, které si drží renderer. První
 * verze těchhle testů brala meze od testovaného kódu, takže useknutá obálka
 * prošla; z jedenácti zanesených chyb jich devět přežilo.
 */
describe('uvolňování chunků', () => {
  const WHOLE_MAP: Viewport = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };

  it('čerstvý renderer nemá upečeno nic', () => {
    // Peče se až podle pohledu. Kdyby se peklo v konstruktoru, byl by celý
    // úkol k ničemu — právě to dělal starý kód.
    const renderer = new ChunkRenderer(createWorld(1, undefined, 128), new Container());
    expect(renderer.getChunkCount()).toBe((128 / CHUNK_SIZE) ** 2);
    expect(renderer.getBakedCount()).toBe(0);
    expect(renderer.getBakeCount()).toBe(0);
  });

  it('upeče jen zlomek velké mapy', () => {
    const world = createWorld(1, undefined, 512);
    const renderer = new ChunkRenderer(world, new Container());
    expect(renderer.getChunkCount()).toBe((512 / CHUNK_SIZE) ** 2);

    renderer.cull(viewportFor(0, 4000, 1, 1280, 720));

    expect(renderer.getBakedCount()).toBeGreaterThan(0);
    expect(renderer.getBakedCount()).toBeLessThan(renderer.getChunkCount() / 8);
  });

  it('nenechá díru v tom, na co je vidět', () => {
    const world = createWorld(1, undefined, 128);
    const renderer = new ChunkRenderer(world, new Container());

    // Projede se mapa napříč. Po každém kroku musí být upečený **každý**
    // chunk, ze kterého je na obrazovce byť jediná dlaždice.
    for (let step = 0; step < 10; step++) {
      const view = viewportFor(0, step * 12 * TILE_H, 1, 1280, 720);
      renderer.cull(view);

      const strict = viewportFor(0, step * 12 * TILE_H, 1, 1280, 720, 0);
      for (const chunkIndex of visibleChunks(world, strict)) {
        expect(bakedState(renderer, chunkIndex)).toEqual({ baked: true, stale: false });
      }
    }
  });

  it('kopec u spodní hrany se nesmí useknout', () => {
    // Zvednutá dlaždice se na obrazovce posune **nahoru**. Chunk, který by
    // podle placaté obálky ležel pod okrajem, tak může být vidět. Obálka
    // proto počítá s nejvyšším možným terénem — a tenhle test to hlídá.
    const world = createWorld(1, undefined, 128);
    raiseChunk(world, 3, 3);

    const renderer = new ChunkRenderer(world, new Container());
    // Pohled těsně nad kopcem: placatý chunk by do něj nezasáhl, zvednutý ano.
    const view: Viewport = { minX: -400, maxX: 400, minY: 3 * 2 * CHUNK_SIZE * (TILE_H / 2) - 260, maxY: 3 * 2 * CHUNK_SIZE * (TILE_H / 2) - 200 };
    renderer.cull(view);

    for (const chunkIndex of visibleChunks(world, view)) {
      expect(bakedState(renderer, chunkIndex).baked).toBe(true);
    }
  });

  it('okraj se počítá na všechny čtyři strany', () => {
    // Prstenec je široký jeden chunk, měřeno v projekci. Vodorovně i svisle:
    // izometrické chunky jsou kosočtverce, takže posun doprava odkrývá jiné
    // chunky než posun dolů a jedna strana bez okraje by problikávala.
    const raw = viewportFor(0, 0, 1, 1280, 720, 0);
    const padded = viewportFor(0, 0, 1, 1280, 720, 1);

    expect(raw.minX - padded.minX).toBe(CHUNK_SIZE * (TILE_W / 2));
    expect(padded.maxX - raw.maxX).toBe(CHUNK_SIZE * (TILE_W / 2));
    expect(raw.minY - padded.minY).toBe(CHUNK_SIZE * (TILE_H / 2));
    expect(padded.maxY - raw.maxY).toBe(CHUNK_SIZE * (TILE_H / 2));
  });

  it('dopeče i to, co je hned za okrajem', () => {
    // Bez prstence by se chunk pekl přesně v okamžiku, kdy do něj hráč najede,
    // a bylo by to vidět jako záblesk prázdna. Prstenec se plní po kouscích,
    // takže se `cull` volá tolikrát, kolikrát by ho zavolal běh hry.
    const world = createWorld(1, undefined, 256);
    const renderer = new ChunkRenderer(world, new Container());

    const view = viewportFor(0, 3000, 1, 1280, 720);
    settle(renderer, view);

    const onScreen = visibleChunks(world, view);
    const withRing = visibleChunks(world, viewportFor(0, 3000, 1, 1280, 720, CHUNK_MARGIN));

    const ringOnly = [...withRing].filter((chunkIndex) => !onScreen.has(chunkIndex));
    expect(ringOnly.length).toBeGreaterThan(0);
    for (const chunkIndex of ringOnly) {
      expect(bakedState(renderer, chunkIndex).baked).toBe(true);
    }
  });

  it('uvolní, co je za obzorem', () => {
    const world = createWorld(1, undefined, 256);
    const renderer = new ChunkRenderer(world, new Container());

    const before = viewportFor(0, 1000, 1, 1280, 720);
    settle(renderer, before);
    const wasBaked = [...visibleChunks(world, before)];
    expect(wasBaked.length).toBeGreaterThan(0);

    // Odjezd na druhý konec mapy. Co zůstalo za obzorem, musí zmizet —
    // jinak by se paměť s každým rozhlédnutím jen nabalovala.
    const after = viewportFor(0, 6000, 1, 1280, 720);
    settle(renderer, after);
    const stillNeeded = visibleChunks(world, viewportFor(0, 6000, 1, 1280, 720, CHUNK_MARGIN));

    const leftBehind = wasBaked.filter((chunkIndex) => !stillNeeded.has(chunkIndex));
    expect(leftBehind.length).toBeGreaterThan(0);
    for (const chunkIndex of leftBehind) {
      expect(bakedState(renderer, chunkIndex).baked).toBe(false);
    }
  });

  it('po přepnutí overlaye se viditelné upeče znovu', () => {
    const world = createWorld(1, undefined, 128);
    const renderer = new ChunkRenderer(world, new Container());

    renderer.cull(WHOLE_MAP);
    const before = renderer.getBakeCount();
    expect(before).toBe(renderer.getChunkCount());

    renderer.setOverlay('power');
    // Přepnutí jen zneplatní; upéct musí až `cull`.
    expect(renderer.getBakeCount()).toBe(before);

    // Od T60 se to **rozloží do snímků** — jinak by při plném oddálení na
    // 512 × 512 spadl snímek. Za dost snímků ale musí být přepečeno všechno.
    for (let i = 0; i < renderer.getChunkCount(); i++) renderer.cull(WHOLE_MAP, 0);
    expect(renderer.getBakeCount()).toBe(before * 2);
  });

  it('fullRedraw zneplatní všechno', () => {
    const world = createWorld(1, undefined, 128);
    const renderer = new ChunkRenderer(world, new Container());
    renderer.cull(WHOLE_MAP);
    const before = renderer.getBakeCount();

    const dirty = createDirtySet();
    dirty.fullRedraw = true;
    renderer.update(dirty);
    for (let i = 0; i < renderer.getChunkCount(); i++) renderer.cull(WHOLE_MAP, 0);

    expect(renderer.getBakeCount()).toBe(before * 2);
  });

  it('změna dlaždice překreslí právě jeden chunk', () => {
    const world = createWorld(1, undefined, 128);
    const renderer = new ChunkRenderer(world, new Container());
    renderer.cull(WHOLE_MAP);
    const before = renderer.getBakeCount();

    const dirty = createDirtySet();
    dirty.tiles.add(40 * 128 + 40);
    renderer.update(dirty);
    renderer.cull(WHOLE_MAP);

    expect(renderer.getBakeCount()).toBe(before + 1);
  });

  it('změna za okrajem se neztratí, jen počká', () => {
    const world = createWorld(1, undefined, 256);
    const renderer = new ChunkRenderer(world, new Container());

    const near = viewportFor(0, 0, 1, 1280, 720);
    renderer.cull(near);
    const before = renderer.getBakeCount();

    // Dlaždice na druhém konci mapy. Její chunk se teď překreslit nesmí —
    // není na něj vidět. Až se na něj hráč podívá, musí se upéct i s tou
    // změnou. (Celkové počítadlo poroste dál: prstenec se dopéká postupně.)
    const perAxis = 256 / CHUNK_SIZE;
    const farChunk = Math.floor(200 / CHUNK_SIZE) * perAxis + Math.floor(200 / CHUNK_SIZE);
    const dirty = createDirtySet();
    dirty.tiles.add(200 * 256 + 200);
    renderer.update(dirty);
    renderer.cull(near);
    expect(bakedState(renderer, farChunk)).toEqual({ baked: false, stale: true });
    expect(renderer.getBakeCount()).toBeLessThanOrEqual(before + RING_BUDGET);

    const far = viewportFor(0, (200 + 200) * (TILE_H / 2), 1, 1280, 720);
    renderer.cull(far);
    for (const chunkIndex of visibleChunks(world, far)) {
      expect(bakedState(renderer, chunkIndex).stale).toBe(false);
    }
  });
});

/**
 * Nechá renderer dojet do klidu.
 *
 * Prstenec se plní po `RING_BUDGET` chuncích za snímek, takže jediné zavolání
 * `cull` nestačí — hra ho volá každý snímek a test to musí dělat taky.
 */
function settle(renderer: ChunkRenderer, view: Viewport): void {
  let previous = -1;
  for (let frame = 0; frame < 200 && renderer.getBakeCount() !== previous; frame++) {
    previous = renderer.getBakeCount();
    renderer.cull(view);
  }
}

interface Viewport {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Chunky, ze kterých je do pohledu vidět aspoň jedna dlaždice.
 *
 * Počítá se z promítnutých dlaždic a **skutečných** výšek rohů, ne z obálek
 * rendereru — v tom je celý smysl: kdyby se ptalo testovaného kódu, useknutá
 * obálka by prošla.
 */
function visibleChunks(world: WorldState, view: Viewport): Set<number> {
  const perAxis = Math.ceil(world.size / CHUNK_SIZE);
  const hit = new Set<number>();

  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      const chunkIndex = Math.floor(y / CHUNK_SIZE) * perAxis + Math.floor(x / CHUNK_SIZE);
      if (hit.has(chunkIndex)) continue;

      const quad = tileQuad(x, y, tileCorners(world.cornerHeight, x, y));
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < quad.length; i += 2) {
        minX = Math.min(minX, quad[i] ?? 0);
        maxX = Math.max(maxX, quad[i] ?? 0);
        minY = Math.min(minY, quad[i + 1] ?? 0);
        maxY = Math.max(maxY, quad[i + 1] ?? 0);
      }

      if (minX <= view.maxX && maxX >= view.minX && minY <= view.maxY && maxY >= view.minY) {
        hit.add(chunkIndex);
      }
    }
  }

  return hit;
}

/** Zvedne celý chunk na nejvyšší patro, aby přesahoval nahoru. */
function raiseChunk(world: WorldState, cx: number, cy: number): void {
  const side = world.size + 1;
  const changes = new Map<number, number>();
  for (let y = cy * CHUNK_SIZE; y <= (cy + 1) * CHUNK_SIZE; y++) {
    for (let x = cx * CHUNK_SIZE; x <= (cx + 1) * CHUNK_SIZE; x++) {
      changes.set(cornerIndex(x, y, side), MAX_HEIGHT);
    }
  }
  applyHeightChanges(world, changes);
}

/** Stav chunku zevnitř. Díru v terénu nejde zvenčí poznat jinak než okem. */
describe('přepnutí vrstvy zapékané do chunků', () => {
  const WHOLE: Viewport = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };

  /**
   * Rozpočet nula: upeče se **právě jeden** zastaralý chunk za snímek.
   *
   * Test tím dostane deterministický krok místo hodinek. V ostrém provozu se
   * měří čas, protože chunk prázdného moře stojí setinu milisekundy a chunk
   * plný ulic dvě a půl — počet by jednou znamenal dvě milisekundy a jindy
   * dvě stě.
   */
  const KROK = 0;

  /** Mapa 512 × 512 se vším upečeným, tedy nejhorší případ plného oddálení. */
  function bakedMap(): ChunkRenderer {
    const renderer = new ChunkRenderer(createWorld(1, undefined, 512), new Container());
    renderer.cull(WHOLE);
    return renderer;
  }

  it('nepřepeče celou mapu v jednom snímku', () => {
    // Naměřeno: přepnutí naráz stálo při plném oddálení 52 až 90 ms, tedy
    // zahozený snímek. Rozpočet z toho dělá přebarvení místo bliknutí.
    const renderer = bakedMap();
    const before = renderer.getBakeCount();

    renderer.setOverlay('power');
    renderer.cull(WHOLE, KROK);

    const upeceno = renderer.getBakeCount() - before;
    expect(upeceno).toBe(1);
    expect(upeceno).toBeLessThan(renderer.getChunkCount());
  });

  it('aspoň jeden chunk se upeče vždycky', () => {
    // I s nulovým rozpočtem se musí něco pohnout. Jinak by se na mapě
    // s drahými chunky nezměnilo nikdy nic.
    const renderer = bakedMap();
    renderer.setOverlay('underground');

    for (let i = 0; i < 5; i++) {
      const before = renderer.getBakeCount();
      renderer.cull(WHOLE, KROK);
      expect(renderer.getBakeCount()).toBeGreaterThan(before);
    }
  });

  it('za dost snímků se přepeče všechno', () => {
    // Rozpočet smí práci odložit, ne zahodit. Kdyby chunk zůstal zastaralý
    // napořád, ukazovala by mapa navždycky starou vrstvu.
    const renderer = bakedMap();
    renderer.setOverlay('power');

    for (let i = 0; i < renderer.getChunkCount(); i++) renderer.cull(WHOLE, KROK);

    for (let i = 0; i < renderer.getChunkCount(); i++) {
      expect(bakedState(renderer, i), `chunk ${i}`).toEqual({ baked: true, stale: false });
    }
  });

  it('mezitím drží starý obrázek, ne díru', () => {
    // Zastaralý chunk zůstává **upečený**. Kdyby se místo odložení vyprázdnil,
    // byla by z přebarvení mapy díra a to je horší než bliknutí.
    const renderer = bakedMap();
    renderer.setOverlay('power');
    renderer.cull(WHOLE, KROK);

    for (let i = 0; i < renderer.getChunkCount(); i++) {
      expect(bakedState(renderer, i).baked, `chunk ${i}`).toBe(true);
    }
  });

  it('běžný zásah rozpočet neucítí', () => {
    // Po postavení silnice zastarají jednotky chunků a upečou se hned. Odložit
    // je by byla regrese, ne oprava — hráč má vidět, co postavil.
    const world = createWorld(1, undefined, 512);
    const renderer = new ChunkRenderer(world, new Container());
    renderer.cull(WHOLE);

    const dirty = createDirtySet();
    dirty.tiles.add(100 * world.size + 100);
    renderer.update(dirty);
    renderer.cull(WHOLE, KROK);

    expect(bakedState(renderer, chunkIndexOf(world, 100, 100))).toEqual({
      baked: true,
      stale: false,
    });
  });
});

/** Do kterého chunku spadá dlaždice. */
function chunkIndexOf(world: WorldState, x: number, y: number): number {
  const perAxis = Math.ceil(world.size / CHUNK_SIZE);
  return Math.floor(y / CHUNK_SIZE) * perAxis + Math.floor(x / CHUNK_SIZE);
}

function bakedState(renderer: ChunkRenderer, chunkIndex: number): { baked: boolean; stale: boolean } {
  const chunks = (renderer as unknown as { chunks: readonly { baked: boolean; stale: boolean }[] })
    .chunks;
  const chunk = chunks[chunkIndex];
  return { baked: chunk?.baked ?? false, stale: chunk?.stale ?? true };
}
