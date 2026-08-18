import type { ContentSource, RawFile } from './registry';

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

  let manifest: unknown = undefined;
  let balance: unknown = undefined;
  const definitions: RawFile[] = [];
  const locales: Record<string, unknown> = {};

  // Seřazeno, aby pořadí definic nezáviselo na pořadí, v jakém glob vrací klíče.
  for (const absolute of Object.keys(modules).sort()) {
    const path = relativePath(absolute);
    const data = modules[absolute];

    if (path === 'manifest.json') {
      manifest = data;
    } else if (path === 'balance.json') {
      balance = data;
    } else if (path.startsWith('buildings/')) {
      definitions.push({ path, data });
    } else if (path.startsWith('locale/')) {
      locales[path.slice('locale/'.length).replace(/\.json$/, '')] = data;
    }
  }

  return { label: SOURCE_ROOT.replace(/\/$/, ''), manifest, balance, definitions, locales };
}
