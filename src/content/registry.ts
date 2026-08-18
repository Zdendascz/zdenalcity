import { validateDefinition, validateManifest } from './schema';
import type { Definition, ValidationIssue } from './schema';

/** Jeden soubor zdroje. `path` slouží jen k tomu, aby chyba uměla říct kde. */
export interface RawFile {
  readonly path: string;
  readonly data: unknown;
}

/**
 * Zdroj obsahu. Vanilla, DLC i mod jdou **stejnou cestou** (P5) — liší se jen
 * tím, kdo soubory přečte. Čtení samotné sem schválně nepatří, aby registr
 * nezávisel na tom, jestli běží v prohlížeči, v Node, nebo nad ZIPem modu.
 */
export interface ContentSource {
  /** Popis pro chybové hlášky, např. `content/vanilla`. */
  readonly label: string;
  readonly manifest: unknown;
  readonly definitions: readonly RawFile[];
  /** Klíč = kód jazyka (`cs`, `en`). Hodnota = plochý objekt klíč → text. */
  readonly locales: Readonly<Record<string, unknown>>;
}

export interface SourceInfo {
  id: string;
  name: string;
  version: string;
}

/** Nevalidní obsah je chyba s uvedením zdroje, nikdy tichý pád (§7). */
export class ContentValidationError extends Error {
  readonly problems: readonly string[];

  constructor(label: string, problems: readonly string[]) {
    super(`Nevalidní obsah ve zdroji ${label}:\n- ${problems.join('\n- ')}`);
    this.name = 'ContentValidationError';
    this.problems = problems;
  }
}

function describe(file: string, issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => `${file}: ${issue.field || '(kořen)'} — ${issue.message}`);
}

export class ContentRegistry {
  private readonly definitions = new Map<string, Definition>();
  private readonly sources: SourceInfo[] = [];

  /**
   * Načte zdroj. Buď projde celý, nebo se nezaregistruje nic — částečně
   * načtený mod je horší než žádný, protože chyba vypluje až za hodinu hraní.
   */
  async load(source: ContentSource): Promise<void> {
    const problems: string[] = [];

    const { manifest, issues: manifestIssues } = validateManifest(source.manifest);
    problems.push(...describe('manifest.json', manifestIssues));

    if (!manifest) {
      throw new ContentValidationError(source.label, problems);
    }

    if (this.sources.some((existing) => existing.id === manifest.id)) {
      throw new ContentValidationError(source.label, [
        `manifest.json: id — zdroj "${manifest.id}" už je načtený`,
      ]);
    }

    const knownKeys = collectLocaleKeys(source, problems);
    const accepted = new Map<string, Definition>();

    for (const file of source.definitions) {
      const { definition, issues } = validateDefinition(file.data, manifest.id);
      problems.push(...describe(file.path, issues));
      if (!definition) continue;

      if (this.definitions.has(definition.id) || accepted.has(definition.id)) {
        problems.push(`${file.path}: id — "${definition.id}" je už definované`);
        continue;
      }

      for (const key of [definition.name, definition.description]) {
        if (!knownKeys.has(key)) {
          problems.push(`${file.path}: lokalizační klíč "${key}" nemá překlad v žádném jazyce`);
        }
      }

      accepted.set(definition.id, definition);
    }

    if (problems.length > 0) {
      throw new ContentValidationError(source.label, problems);
    }

    for (const [id, definition] of accepted) {
      this.definitions.set(id, definition);
    }
    this.sources.push({ id: manifest.id, name: manifest.name, version: manifest.version });
  }

  get(id: string): Definition | undefined {
    return this.definitions.get(id);
  }

  /** Pořadí je pořadí načtení — stabilní, takže se o něj smí opřít i simulace. */
  getAll(type: string): Definition[] {
    return [...this.definitions.values()].filter((definition) => definition.type === type);
  }

  getLoadedSources(): SourceInfo[] {
    return this.sources.map((source) => ({ ...source }));
  }
}

function collectLocaleKeys(source: ContentSource, problems: string[]): Set<string> {
  const keys = new Set<string>();

  for (const language of Object.keys(source.locales).sort()) {
    const table = source.locales[language];
    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      problems.push(`locale/${language}.json: musí být plochý objekt klíč → text`);
      continue;
    }
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== 'string') {
        problems.push(`locale/${language}.json: ${key} — hodnota musí být řetězec`);
        continue;
      }
      keys.add(key);
    }
  }

  return keys;
}
