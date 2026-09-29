import { validateBalance } from './balance';
import type { Balance } from './balance';
import { validateDefinition, validateManifest } from './schema';
import type { AnyDefinition, Definition, GrantDefinition, ValidationIssue } from './schema';

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
  /**
   * Obrázky ikon. Klíč = jméno bez přípony, hodnota = URL.
   *
   * Zdroj je mít nemusí — hra pak kreslí ikony z polygonů jako dřív. Jde tudy,
   * a ne přímým sáhnutím rozhraní do `content/`, aby mod mohl ikony dodat nebo
   * přepsat stejně jako budovu (P5).
   */
  readonly icons?: Readonly<Record<string, string>>;
  /**
   * Obrázky budov. Klíč = `<id budovy>|<varianta>`, tedy `vanilla:hospital|a`.
   *
   * Stejně jako ikony: zdroj je mít nemusí a hra pak kreslí kvádry jako dřív.
   */
  readonly sprites?: Readonly<Record<string, SpriteImage>>;
  /**
   * Obrázky povrchu. Klíč = `<druh terénu>|<varianta>`, tedy `grass|a`.
   *
   * Zdroj je mít nemusí — hra pak kreslí terén barvou jako dřív. Silnice ani
   * potrubí tudy zatím nejdou: jejich dlaždice sice existují, ale mají vadné
   * spoje, takže by vozovka na každém styku uskakovala (viz `docs/08-DLAZDICE.md`).
   */
  readonly tiles?: Readonly<Record<string, string>>;
  /**
   * Díly pro animace a silnice (T116): rotor větrníku, auta, chodci, lampa.
   * Klíč = jméno dílu. Zdroj je mít nemusí — co chybí, to se nekreslí.
   */
  readonly parts?: Readonly<Record<string, PartImage>>;
  /** Dlaždice vozovky pod klíčem `rodina__tvar`. */
  readonly roads?: Readonly<Record<string, string>>;
  /** Materiály podezdívek pod klíčem `kategorie__varianta`. */
  readonly skirts?: Readonly<Record<string, string>>;
  /**
   * Balanc. Zdroj ho mít nemusí; když ho má, musí být úplný a přepíše ten
   * dosavadní — tak mod přeladí hru bez zásahu do definic.
   */
  readonly balance?: unknown;
}

/**
 * Jeden obrázek budovy i s tím, kam ho posadit.
 *
 * `anchor` je bod **v pixelech obrázku**, který sedne na přední roh půdorysu.
 * Neleží nutně uprostřed spodní hrany — generátor kreslí podstavu často mírně
 * zkosenou, takže se poloha měří a zapisuje, místo aby se dopočítala.
 *
 * `scale` říká, kolikrát je obrázek větší než při zoomu 1.
 */
export interface SpriteImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly anchor: readonly [number, number];
  readonly scale: number;
  /**
   * Co z obrázku vychází: kouř z komína, točící se rotor, blikající světlo
   * (T116). Body jsou **v pixelech obrázku**, stejně jako `anchor`, takže
   * sedí na tuhle variantu a na žádnou jinou.
   */
  readonly effects?: readonly SpriteEffect[];
}

/**
 * Jeden efekt na obrázku budovy. Druh je string s namespace (P6), aby mod
 * mohl přidat vlastní; neznámý druh renderer přeskočí.
 */
export interface SpriteEffect {
  /** `vanilla:spin`, `vanilla:smoke`, `vanilla:blink`. */
  readonly type: string;
  /** Bod v pixelech obrázku. U rotoru náboj, u kouře ústí komína. */
  readonly at: readonly [number, number];
  /** Kdy běží. Výchozí `always`; `powered` jen s proudem. */
  readonly when?: 'always' | 'powered';
  /** Díl, který se kreslí (u `spin` rotor). */
  readonly part?: string;
  /**
   * Rovina rotoru: dva vektory v pixelech obrázku, kam se promítne jednotková
   * délka lopatky ve směru „vpravo“ a „nahoru“. Rotor kreslený šikmo je
   * elipsa, a tahle matice ji popisuje přesně (změřeno ze špiček lopatek).
   */
  readonly axes?: readonly [readonly [number, number], readonly [number, number]];
  /** Otáčky za sekundu u `spin`, hustota u `smoke`. */
  readonly rate?: number;
  /** Barva jako `#rrggbb` (světlo, kouř). */
  readonly color?: string;
}

/**
 * Díl pro animaci: obrázek s kotvou. `anchor` je bod, který sedne na místo
 * (u rotoru náboj, u auta střed podvozku), `radius` u rotoru délka lopatky
 * v pixelech obrázku.
 */
export interface PartImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly anchor: readonly [number, number];
  readonly scale: number;
  readonly radius?: number;
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
  private readonly grantDefs = new Map<string, GrantDefinition>();
  private readonly sources: SourceInfo[] = [];
  /** jazyk → klíč → text, slito přes všechny zdroje (§10). */
  private readonly locales = new Map<string, Map<string, string>>();
  /** jméno ikony → URL obrázku, slito přes všechny zdroje. */
  private readonly icons = new Map<string, string>();
  private readonly sprites = new Map<string, SpriteImage>();
  private readonly parts = new Map<string, PartImage>();
  private readonly tiles = new Map<string, string>();
  private readonly roads = new Map<string, string>();
  private readonly skirts = new Map<string, string>();
  private balance: Balance | null = null;

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

    let incomingBalance: Balance | null = null;
    if (source.balance !== undefined) {
      const result = validateBalance(source.balance);
      problems.push(...describe('balance.json', result.issues));
      incomingBalance = result.balance;
    }

    const incomingLocales = collectLocales(source, problems);
    const knownKeys = new Set<string>();
    for (const table of incomingLocales.values()) {
      for (const key of table.keys()) knownKeys.add(key);
    }

    const accepted = new Map<string, AnyDefinition>();

    for (const file of source.definitions) {
      const { definition, issues } = validateDefinition(file.data, manifest.id);
      problems.push(...describe(file.path, issues));
      if (!definition) continue;

      if (
        this.definitions.has(definition.id) ||
        this.grantDefs.has(definition.id) ||
        accepted.has(definition.id)
      ) {
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
      // Grant není budova a vede se zvlášť. Sjednotit obojí do jedné mapy by
      // znamenalo, že každé místo, které sáhne na `footprint`, musí nejdřív
      // dokazovat, že nemá v ruce dotaci.
      if (definition.type === 'grant') this.grantDefs.set(id, definition);
      else this.definitions.set(id, definition);
    }

    if (incomingBalance) this.balance = incomingBalance;

    // Ikony se přepisují stejně jako texty: pozdější zdroj smí cizí budově
    // vyměnit obrázek, aniž by sahal na její definici.
    for (const [name, url] of Object.entries(source.icons ?? {})) {
      this.icons.set(name, url);
    }

    // Sprity taky: mod smí cizí budově vyměnit obrázek i přidat další variantu,
    // aniž by sahal na její definici.
    for (const [key, sprite] of Object.entries(source.sprites ?? {})) {
      this.sprites.set(key, sprite);
    }
    for (const [key, part] of Object.entries(source.parts ?? {})) {
      this.parts.set(key, part);
    }

    // A povrchy. Mod smí přidat vlastní variantu trávy nebo přepsat vanilla.
    for (const [key, url] of Object.entries(source.roads ?? {})) {
      this.roads.set(key, url);
    }
    for (const [key, url] of Object.entries(source.skirts ?? {})) {
      this.skirts.set(key, url);
    }
    for (const [key, url] of Object.entries(source.tiles ?? {})) {
      this.tiles.set(key, url);
    }

    // Pozdější zdroj smí text přepsat — tak se překládají nebo přejmenovávají
    // cizí budovy, aniž by se sahalo na jejich definici.
    for (const [language, table] of incomingLocales) {
      const target = this.locales.get(language) ?? new Map<string, string>();
      for (const [key, text] of table) target.set(key, text);
      this.locales.set(language, target);
    }

    this.sources.push({ id: manifest.id, name: manifest.name, version: manifest.version });
  }

  /**
   * Balanc posledního zdroje, který ho dodal. Bez něj hra běžet nemůže —
   * tichý default by znamenal, že se hra chová jinak, než balanc popisuje.
   */
  getBalance(): Balance {
    if (!this.balance) {
      throw new ContentValidationError('balance', ['žádný načtený zdroj nedodal balance.json']);
    }
    return this.balance;
  }

  /** Jazyky, ke kterým existuje aspoň jeden text. Seřazené, ať je pořadí stabilní. */
  getLanguages(): string[] {
    return [...this.locales.keys()].sort();
  }

  /**
   * URL obrázků ikon. Prázdné, když je žádný zdroj nedodal — rozhraní si pak
   * poradí polygony.
   */
  /** Všechny dlaždice vozovky, které obsah dodal. Klíč je `rodina__tvar`. */
  getRoads(): Record<string, string> {
    return Object.fromEntries(this.roads);
  }

  /** Všechny materiály podezdívek. Klíč je `kategorie__varianta`. */
  getSkirts(): Record<string, string> {
    return Object.fromEntries(this.skirts);
  }

  getIcons(): Record<string, string> {
    return Object.fromEntries(this.icons);
  }

  /**
   * Obrázek budovy, nebo `undefined`. Bez něj renderer kreslí kvádr jako dřív —
   * chybějící obrázek je vzhled, ne podmínka běhu.
   */
  getSprite(definitionId: string, variant: string): SpriteImage | undefined {
    return this.sprites.get(`${definitionId}|${variant}`);
  }

  /**
   * Všechny obrázky, které hra na mapě kreslí (T121): sprity budov, povrchy,
   * díly, podezdívky. Podle toho se přednačítá při startu. Ikony rozhraní ne —
   * ty jsou malé a načte si je `<img>` sám.
   */
  getImageUrls(): string[] {
    return [
      ...[...this.sprites.values()].map((sprite) => sprite.url),
      ...[...this.parts.values()].map((part) => part.url),
      ...this.tiles.values(),
      ...this.skirts.values(),
    ];
  }

  /** Díl pro animaci, nebo `undefined`. Chybějící díl se nekreslí. */
  getPart(name: string): PartImage | undefined {
    return this.parts.get(name);
  }

  /** Jména všech dílů, seřazená. Přednačítání je stáhne předem. */
  getPartNames(): string[] {
    return [...this.parts.keys()].sort();
  }

  /** URL obrázku povrchu, nebo `undefined`, když ho obsah nedodal. */
  getTile(terrain: string, variant: string): string | undefined {
    return this.tiles.get(`${terrain}|${variant}`);
  }

  /** Varianty, ke kterým povrch obrázek má. Seřazené, ať je losování stabilní. */
  getTileVariants(terrain: string): string[] {
    const prefix = `${terrain}|`;
    return [...this.tiles.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  /**
   * Varianty, ke kterým budova obrázek má. Seřazené, ať je pořadí stabilní —
   * losovat se z nich bude přes `world.rng` a nesmí to záviset na pořadí,
   * v jakém glob vrátil soubory (P2).
   */
  getSpriteVariants(definitionId: string): string[] {
    const prefix = `${definitionId}|`;
    return [...this.sprites.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  getLocaleTable(language: string): Record<string, string> {
    return Object.fromEntries(this.locales.get(language) ?? []);
  }

  get(id: string): Definition | undefined {
    return this.definitions.get(id);
  }

  /** Pořadí je pořadí načtení — stabilní, takže se o něj smí opřít i simulace. */
  /**
   * Granty v pevném pořadí podle id.
   *
   * Pořadí je součást determinismu: přiznávají se v tomtéž tiku a každý přidá
   * peníze, takže na pořadí by jinak záleželo podle toho, jak glob vrátil
   * soubory (P2).
   */
  grants(): GrantDefinition[] {
    return [...this.grantDefs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getGrant(id: string): GrantDefinition | undefined {
    return this.grantDefs.get(id);
  }

  getAll(type: string): Definition[] {
    return [...this.definitions.values()].filter((definition) => definition.type === type);
  }

  /**
   * Budovy dané kategorie. Simulace si tudy sahá pro obsah, aniž by věděla,
   * jaké konkrétní budovy existují (P5).
   */
  byCategory(category: string): Definition[] {
    return this.getAll('building').filter((definition) => definition.category === category);
  }

  getLoadedSources(): SourceInfo[] {
    return this.sources.map((source) => ({ ...source }));
  }
}

function collectLocales(
  source: ContentSource,
  problems: string[],
): Map<string, Map<string, string>> {
  const locales = new Map<string, Map<string, string>>();

  for (const language of Object.keys(source.locales).sort()) {
    const table = source.locales[language];
    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      problems.push(`locale/${language}.json: musí být plochý objekt klíč → text`);
      continue;
    }

    const entries = new Map<string, string>();
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== 'string') {
        problems.push(`locale/${language}.json: ${key} — hodnota musí být řetězec`);
        continue;
      }
      entries.set(key, value);
    }
    locales.set(language, entries);
  }

  return locales;
}
