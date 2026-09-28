import type { ContentSource, PartImage, RawFile, SpriteEffect, SpriteImage } from './registry';

/**
 * Složí `ContentSource` z vanilla obsahu v repozitáři.
 *
 * Vanilla se přibalí do buildu přes `import.meta.glob`, protože je součástí hry
 * a nemá smysl ji tahat po síti. DLC a mody dostanou vlastní implementaci
 * `ContentSource` (soubor na disku, ZIP, Workshop) — registr je nerozlišuje,
 * takže vanilla nemá žádnou privilegovanou cestu (P5).
 */

const SOURCE_ROOT = 'content/vanilla/';

function relativePath(absolute: string): string {
  const at = absolute.indexOf(SOURCE_ROOT);
  return at === -1 ? absolute : absolute.slice(at + SOURCE_ROOT.length);
}

export function createVanillaSource(): ContentSource {
  const modules = import.meta.glob('../../content/vanilla/**/*.json', {
    eager: true,
    import: 'default',
  });

  // Ikony jsou binární, takže se neimportují jako data, ale jako URL. Vite je
  // v produkci opatří otiskem a nakopíruje do buildu; za běhu je stáhne
  // prohlížeč sám, až se objeví v `<img>`.
  const iconFiles = import.meta.glob('../../content/vanilla/icons/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const icons: Record<string, string> = {};
  for (const absolute of Object.keys(iconFiles).sort()) {
    const name = relativePath(absolute).slice('icons/'.length).replace(/\.png$/, '');
    icons[name] = iconFiles[absolute] as string;
  }

  // Totéž pro sprity budov. Rozměry a kotvy k nim nese `sprites/index.json`,
  // který vyrábí `tools/fit-sprites.py` — bez něj jsou obrázky jen soubory
  // a renderer by nevěděl, kam je posadit.
  const spriteFiles = import.meta.glob('../../content/vanilla/sprites/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const spriteUrls: Record<string, string> = {};
  for (const absolute of Object.keys(spriteFiles).sort()) {
    const name = relativePath(absolute).slice('sprites/'.length).replace(/\.png$/, '');
    spriteUrls[name] = spriteFiles[absolute] as string;
  }

  // Povrchy. Jméno souboru je `<druh>__<varianta>.png` a klíč `<druh>|<varianta>`,
  // takže se rejstřík `tiles/index.json` k ničemu nepotřebuje: rozměr je vždycky
  // čtverec a kotva u dlaždice nedává smysl.
  //
  // Je to **bílá listina, ne co leží ve složce**: dlaždice silnic a potrubí na
  // tvar (`street__ns` a spol.) ve složce pořád jsou, ale nepoužívají se —
  // 42 ze 64 má vozovku jinde, než má, a hlavně by se jich tolik nevešlo do
  // jedné kreslicí dávky (`docs/08-DLAZDICE.md`). Asfalt je něco jiného: je to
  // **materiál**, jeden obrázek na typ silnice, a tvar vozovky se počítá.
  const SURFACES = new Set([
    'grass',
    'water',
    'sand',
    'rock',
    'forest',
    'marsh',
    'asphalt_street',
    'asphalt_avenue',
    'asphalt_highway',
    // Trosky nejsou terén, ale kreslí se stejně — jako výplň polygonu dlaždice.
    'rubble',
  ]);
  const tileFiles = import.meta.glob('../../content/vanilla/tiles/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const tiles: Record<string, string> = {};
  for (const absolute of Object.keys(tileFiles).sort()) {
    const name = relativePath(absolute).slice('tiles/'.length).replace(/\.png$/, '');
    const [terrain, variant] = name.split('__');
    if (terrain === undefined || variant === undefined || !SURFACES.has(terrain)) continue;
    tiles[`${terrain}|${variant}`] = tileFiles[absolute] as string;
  }

  // Dlaždice vozovky. Sedm tvarů na typ, zbytek vznikne překlopením
  // v rendereru — klíč je `rodina__tvar`, jak je pojmenoval `fit-roads.py`.
  const roadFiles = import.meta.glob('../../content/vanilla/roads/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const roads: Record<string, string> = {};
  for (const absolute of Object.keys(roadFiles).sort()) {
    const name = relativePath(absolute).slice('roads/'.length).replace(/\.png$/, '');
    roads[name] = roadFiles[absolute] as string;
  }

  // Díly pro animace (T116). Rozměry a kotvy nese `parts/index.json`, který
  // vyrábí `tools/fit-parts.py`.
  const partFiles = import.meta.glob('../../content/vanilla/parts/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const partUrls: Record<string, string> = {};
  for (const absolute of Object.keys(partFiles).sort()) {
    const name = relativePath(absolute).slice('parts/'.length).replace(/\.png$/, '');
    partUrls[name] = partFiles[absolute] as string;
  }

  // Materiály podezdívek. Klíč je `kategorie__varianta`.
  const skirtFiles = import.meta.glob('../../content/vanilla/skirts/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const skirts: Record<string, string> = {};
  for (const absolute of Object.keys(skirtFiles).sort()) {
    const name = relativePath(absolute).slice('skirts/'.length).replace(/\.png$/, '');
    skirts[name] = skirtFiles[absolute] as string;
  }

  let manifest: unknown = undefined;
  let spriteIndex: unknown = undefined;
  let spriteEffects: unknown = undefined;
  let partIndex: unknown = undefined;
  let balance: unknown = undefined;
  const definitions: RawFile[] = [];
  const locales: Record<string, unknown> = {};

  // Seřazeno, aby pořadí definic nezáviselo na pořadí, v jakém glob vrací klíče.
  for (const absolute of Object.keys(modules).sort()) {
    const path = relativePath(absolute);
    const data = modules[absolute];

    if (path === 'manifest.json') {
      manifest = data;
    } else if (path === 'sprites/index.json') {
      spriteIndex = data;
    } else if (path === 'sprites/effects.json') {
      spriteEffects = data;
    } else if (path === 'parts/index.json') {
      partIndex = data;
    } else if (path === 'balance.json') {
      balance = data;
    } else if (path.startsWith('buildings/') || path.startsWith('grants/')) {
      definitions.push({ path, data });
    } else if (path.startsWith('locale/')) {
      locales[path.slice('locale/'.length).replace(/\.json$/, '')] = data;
    }
  }

  return {
    label: SOURCE_ROOT.replace(/\/$/, ''),
    manifest,
    balance,
    definitions,
    locales,
    icons,
    sprites: buildSprites(spriteIndex, spriteUrls, spriteEffects),
    parts: buildParts(partIndex, partUrls),
    tiles,
    roads,
    skirts,
  };
}

/**
 * Spáruje záznamy z manifestu s URL obrázků.
 *
 * Záznam bez obrázku se **zahodí potichu**: manifest se generuje ze složky,
 * takže rozejít se může jen tak, že někdo obrázek smazal a skript nepustil —
 * a to nemá být důvod, proč hra nenaběhne.
 */
export function buildSprites(
  index: unknown,
  urls: Record<string, string>,
  effects?: unknown,
): Record<string, SpriteImage> {
  const effectsByKey = readEffects(effects);
  const out: Record<string, SpriteImage> = {};
  if (typeof index !== 'object' || index === null) return out;

  const { scale, sprites } = index as { scale?: unknown; sprites?: unknown };
  if (!Array.isArray(sprites) || typeof scale !== 'number' || scale <= 0) return out;

  for (const raw of sprites) {
    const entry = raw as Record<string, unknown>;
    const file = entry['file'];
    const building = entry['building'];
    const variant = entry['variant'];
    const anchor = entry['anchor'];
    if (typeof file !== 'string' || typeof building !== 'string' || typeof variant !== 'string') {
      continue;
    }
    const url = urls[file.replace(/\.png$/, '')];
    if (url === undefined) continue;
    if (!Array.isArray(anchor) || anchor.length !== 2) continue;
    if (typeof entry['width'] !== 'number' || typeof entry['height'] !== 'number') continue;

    const key = `${building}|${variant}`;
    const extra = effectsByKey.get(key);
    out[key] = {
      url,
      width: entry['width'],
      height: entry['height'],
      anchor: [Number(anchor[0]), Number(anchor[1])],
      scale,
      ...(extra === undefined ? {} : { effects: extra }),
    };
  }
  return out;
}

function pair(raw: unknown): [number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const a = Number(raw[0]);
  const b = Number(raw[1]);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined;
}

/**
 * Efekty z `sprites/effects.json`, klíčované `budova|varianta`.
 *
 * Soubor je vedle `index.json` a ne v něm, protože `index.json` celý přepisuje
 * `fit-sprites.py` — ruční body na komínech by při každém přeladění zmizely.
 * Vadný záznam se přeskočí potichu, stejně jako sprite bez obrázku: je to
 * vzhled, ne podmínka běhu.
 */
export function readEffects(raw: unknown): Map<string, SpriteEffect[]> {
  const out = new Map<string, SpriteEffect[]>();
  if (typeof raw !== 'object' || raw === null) return out;
  const table = (raw as { effects?: unknown }).effects;
  if (typeof table !== 'object' || table === null) return out;

  for (const [key, list] of Object.entries(table as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const effects: SpriteEffect[] = [];
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      const at = pair(entry['at']);
      if (typeof entry['type'] !== 'string' || at === undefined) continue;
      const axes = Array.isArray(entry['axes']) ? entry['axes'].map(pair) : undefined;
      const first = axes?.[0];
      const second = axes?.[1];
      const when = entry['when'];
      effects.push({
        type: entry['type'],
        at,
        ...(when === 'always' || when === 'powered' ? { when } : {}),
        ...(typeof entry['part'] === 'string' ? { part: entry['part'] } : {}),
        ...(axes?.length === 2 && first && second ? { axes: [first, second] as const } : {}),
        ...(typeof entry['rate'] === 'number' ? { rate: entry['rate'] } : {}),
        ...(typeof entry['color'] === 'string' ? { color: entry['color'] } : {}),
      });
    }
    if (effects.length > 0) out.set(key, effects);
  }
  return out;
}

/** Díly z `parts/index.json` spárované s URL obrázků. */
export function buildParts(
  index: unknown,
  urls: Record<string, string>,
): Record<string, PartImage> {
  const out: Record<string, PartImage> = {};
  if (typeof index !== 'object' || index === null) return out;
  const { scale, parts } = index as { scale?: unknown; parts?: unknown };
  if (typeof parts !== 'object' || parts === null || typeof scale !== 'number') return out;

  for (const [name, raw] of Object.entries(parts as Record<string, unknown>)) {
    const entry = raw as Record<string, unknown>;
    const url = urls[name];
    const anchor = pair(entry['anchor']);
    if (url === undefined || anchor === undefined) continue;
    if (typeof entry['width'] !== 'number' || typeof entry['height'] !== 'number') continue;
    out[name] = {
      url,
      width: entry['width'],
      height: entry['height'],
      anchor,
      scale,
      ...(typeof entry['radius'] === 'number' ? { radius: entry['radius'] } : {}),
    };
  }
  return out;
}
