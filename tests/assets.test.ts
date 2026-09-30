import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Datový objem a načítání (T134).
 *
 * Hlídá tři věci, které se dají rozbít potichu: že do buildu jdou jen obrázky,
 * které hra opravdu kreslí, že start stahuje jen první obrazovku a že plné
 * sprity přijdou jen při přiblížení a po oddálení se zase uvolní.
 */

const loaded: string[] = [];
const unloaded: string[] = [];
const cached = new Set<string>();

vi.mock('pixi.js', () => ({
  Assets: {
    load: vi.fn((url: string) => {
      loaded.push(url);
      cached.add(url);
      if (url.includes('chybi')) return Promise.reject(new Error('404'));
      return Promise.resolve({
        label: url,
        source: { addressMode: '', autoGenerateMipmaps: false, updateMipmaps: () => {} },
      });
    }),
    unload: vi.fn((url: string) => {
      unloaded.push(url);
      cached.delete(url);
      return Promise.resolve();
    }),
    cache: { has: (url: string) => cached.has(url) },
  },
}));

const { createVanillaSource } = await import('@/content/loader');
const { ContentRegistry } = await import('@/content/registry');
const { backgroundUrls, startupUrls, withTimeout } = await import('@/render/preload');
const { SpriteResolution } = await import('@/render/spriteResolution');

async function vanilla() {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

describe('co jde do buildu', () => {
  it('ke každé ikoně v PNG je WebP a hra bere jen WebP', () => {
    const pngs = Object.keys(import.meta.glob('../content/vanilla/icons/*.png'));
    const webps = new Set(Object.keys(import.meta.glob('../content/vanilla/icons/*.webp')));
    const missing = pngs.filter((png) => !webps.has(png.replace(/\.png$/, '.webp')));
    expect(missing, 'pusť python tools/make-webp.py').toEqual([]);

    const icons = Object.values(createVanillaSource().icons ?? {});
    expect(icons.length).toBe(pngs.length);
    expect(icons.every((url) => url.endsWith('.webp'))).toBe(true);
  });

  it('každý sprite budovy má poloviční obrázek', () => {
    const sprites = Object.values(createVanillaSource().sprites ?? {});
    expect(sprites.length).toBeGreaterThan(0);
    for (const sprite of sprites) {
      expect(sprite.half, sprite.url).toMatch(/@0\.5x\.webp$/);
      expect(sprite.url).not.toMatch(/@0\.5x/);
    }
  });

  it('tvarové dlaždice silnic a potrubí se do buildu nedostanou', () => {
    // Glob s filtrem až za sebou by je do buildu vydal i tak (T134).
    const tiles = Object.keys(createVanillaSource().tiles ?? {});
    expect(tiles.length).toBeGreaterThan(0);
    for (const key of tiles) {
      expect(key).toMatch(/^(grass|water|sand|rock|forest|marsh|asphalt_(street|avenue|highway)|rubble)\|/);
    }
  });
});

describe('přednačtení při startu', () => {
  const options = {
    surfaces: ['grass', 'water', 'sand', 'rock', 'forest', 'marsh', 'asphalt_street', 'rubble'],
    surfaceVariants: 1,
    objects: [['forest_clump', 2]] as const,
  };

  it('bere první obrazovku, ne všechno', async () => {
    const content = await vanilla();
    const startup = startupUrls(content, options);
    const rest = backgroundUrls(content, new Set(startup));

    expect(startup.length).toBeGreaterThan(0);
    // Víc než polovina spritů čeká na pozadí a nic se nestahuje dvakrát.
    expect(rest.length).toBeGreaterThan(content.getSpriteKeys().length / 2);
    expect(rest.filter((url) => startup.includes(url))).toEqual([]);
    expect(rest.every((url) => url.includes('@0.5x'))).toBe(true);
    // Povrch jedna varianta, díly a podezdívky všechny.
    expect(startup).toContain(content.getTile('grass', 'a'));
    expect(startup).not.toContain(content.getTile('grass', 'b'));
    for (const name of content.getPartNames()) expect(startup).toContain(content.getPart(name)?.url);
    for (const url of Object.values(content.getSkirts())) expect(startup).toContain(url);
  });

  it('zóny vyšších úrovní čekají na pozadí, první úroveň ne', async () => {
    const content = await vanilla();
    const startup = new Set(startupUrls(content, options));
    for (const definition of content.getAll('building')) {
      if (!['residential', 'commercial', 'industrial'].includes(definition.category)) continue;
      for (const variant of content.getSpriteVariants(definition.id)) {
        const sprite = content.getSprite(definition.id, variant);
        if (sprite === undefined) continue;
        const expected = (definition.level ?? 1) <= 1;
        expect(startup.has(sprite.half ?? sprite.url), definition.id).toBe(expected);
      }
    }
  });

  it('visící požadavek start nezablokuje', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const waiting = withTimeout(new Promise(() => {}), 20_000).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(19_999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dvě velikosti spritů', () => {
  interface FakeSprite {
    destroyed: boolean;
    visible: boolean;
    parent: object | null;
    texture: { label?: string };
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    getBounds(): { minX: number; minY: number; maxX: number; maxY: number };
  }

  function sprite(x: number): FakeSprite {
    const out: FakeSprite = {
      destroyed: false,
      visible: true,
      parent: {},
      texture: {},
      bounds: { minX: x, minY: 0, maxX: x + 50, maxY: 50 },
      getBounds: () => out.bounds,
    };
    return out;
  }

  const screen = { x: 0, y: 0, width: 800, height: 600 };
  const image = (name: string) => ({ url: `/${name}.webp`, half: `/${name}@0.5x.webp` });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    loaded.length = 0;
    unloaded.length = 0;
    cached.clear();
  });

  it('výchozí zoom kreslí polovinu, přiblížení plný obrázek jen u toho, co je vidět', async () => {
    const resolution = new SpriteResolution();
    const near = sprite(100);
    const far = sprite(5000);
    resolution.assign(near as never, image('a'), () => true);
    resolution.assign(far as never, image('b'), () => true);
    await flush();
    expect(near.texture.label).toBe('/a@0.5x.webp');
    expect(far.texture.label).toBe('/b@0.5x.webp');

    resolution.update(1, { x: 0, y: 0 }, screen, 0);
    await flush();
    expect(loaded).not.toContain('/a.webp');

    resolution.update(3, { x: 0, y: 0 }, screen, 1000);
    await flush();
    expect(near.texture.label).toBe('/a.webp');
    expect(far.texture.label).toBe('/b@0.5x.webp');
    expect(loaded).not.toContain('/b.webp');
    expect(resolution.countFull()).toBe(1);
  });

  it('po oddálení se vrátí polovina a plná textura se uvolní', async () => {
    const resolution = new SpriteResolution();
    const near = sprite(100);
    resolution.assign(near as never, image('c'), () => true);
    await flush();
    resolution.update(3, { x: 0, y: 0 }, screen, 0);
    await flush();
    expect(near.texture.label).toBe('/c.webp');

    // Těsně pod prahem se ještě nic nemění, ať kolečko kolem dvojky necuká.
    resolution.update(1.9, { x: 0, y: 0 }, screen, 1000);
    await flush();
    expect(near.texture.label).toBe('/c.webp');

    resolution.update(1, { x: 0, y: 0 }, screen, 2000);
    await flush();
    await flush();
    expect(near.texture.label).toBe('/c@0.5x.webp');
    expect(unloaded).toEqual(['/c.webp']);
  });

  it('chybějící polovina spadne na plný obrázek, chybějící obojí nic neshodí', async () => {
    const resolution = new SpriteResolution();
    const one = sprite(0);
    resolution.assign(one as never, { url: '/d.webp', half: '/chybi@0.5x.webp' }, () => true);
    await flush();
    await flush();
    expect(one.texture.label).toBe('/d.webp');

    const none = sprite(0);
    resolution.assign(none as never, { url: '/chybi.webp', half: '/chybi2@0.5x.webp' }, () => true);
    await flush();
    await flush();
    expect(none.texture.label).toBeUndefined();
  });

  it('obrázek bez poloviny (mod) se kreslí rovnou plný', async () => {
    const resolution = new SpriteResolution();
    const one = sprite(0);
    resolution.assign(one as never, { url: '/mod.webp' }, () => true);
    await flush();
    expect(one.texture.label).toBe('/mod.webp');
  });
});
