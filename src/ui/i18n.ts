/**
 * Lokalizace (§10). Žádný uživatelsky viditelný text není v kódu — všechno jde
 * přes `t()` a texty dodávají locale soubory obsahu, takže mody a DLC je můžou
 * doplňovat i přepisovat stejnou cestou jako vanilla.
 *
 * Fallback: aktuální jazyk → angličtina → **samotný klíč**. Chybějící překlad
 * má být při testování vidět, ne se tiše schovat za jiný text.
 */

/** Čím se v parametru oddělují klíče seznamu. */
const LIST_SEPARATOR = ',';

import { setNumberLocale } from './format';

export const FALLBACK_LANGUAGE = 'en';

export type LocaleTable = Readonly<Record<string, string>>;
export type LocaleTables = Readonly<Record<string, LocaleTable>>;

export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * Jak vypadá klíč: aspoň dvě tečkou oddělená slova (`ui.tool.bulldoze`).
 * Dvojtečka smí, aby prošly i klíče s ID modu (`building.mod:xyz.name`).
 *
 * Parametr hlášky se překládá jen tehdy, když tak vypadá. Jméno města je
 * obyčejný text a v tabulce se hledat nemá — dřív se hledalo, a tak se město
 * „toString" vypsalo jako zdroják funkce.
 */
const KEY_SHAPE = /^[\w:-]+(\.[\w:-]+)+$/;

/**
 * Vlastní hodnota objektu, nikdy zděděná.
 *
 * Tabulky jsou obyčejné objekty z JSON, takže `table['constructor']` vracelo
 * funkci z prototypu. Město pojmenované „constructor" se pak v „Pokračovat
 * v …" vypsalo jako `function Object() { [native code] }`.
 */
function own<T>(table: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Nahradí `{jméno}` hodnotou. Neznámý zástupný symbol zůstane, ať je vidět. */
function interpolate(text: string, params?: TranslateParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = own(params, name);
    return value === undefined ? whole : String(value);
  });
}

export class I18n {
  private readonly tables: LocaleTables;
  private language: string;
  private readonly listeners = new Set<() => void>();

  constructor(tables: LocaleTables, language: string) {
    this.tables = tables;
    this.language = language;
    this.applyLocale();
  }

  getLanguage(): string {
    return this.language;
  }

  getLanguages(): string[] {
    return Object.keys(this.tables).sort();
  }

  setLanguage(language: string): void {
    if (this.language === language) return;
    this.language = language;
    this.applyLocale();
    for (const listener of this.listeners) listener();
  }

  /**
   * Předá jazyk formátování čísel.
   *
   * Značka je **v překladu** (`ui.locale.tag`), ne v kódu: kdo přidá jazyk,
   * přidá k němu i to, jak se v něm píší tisíce, a nemusí kvůli tomu sahat
   * do hry. Bez klíče se použije kód jazyka, což pro `cs` i `en` dá rozumný
   * výsledek.
   */
  private applyLocale(): void {
    setNumberLocale(this.has('ui.locale.tag') ? this.t('ui.locale.tag') : this.language);
    // Jazyk stránky podle jazyka hry. V `index.html` je napevno `cs`, jenže
    // jazyk se vybírá z prohlížeče — anglickému hráči pak odečítačka četla
    // angličtinu českou výslovností a prohlížeč nabízel překlad z češtiny.
    if (typeof document !== 'undefined') document.documentElement.lang = this.language;
  }

  /** Zavolá se po přepnutí jazyka, aby si UI přepsalo popisky. */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /**
   * Parametr, který je sám lokalizačním klíčem, se přeloží.
   *
   * Simulace nesmí znát texty (§10), ale hlášku „potřebuje pokrytí policie"
   * skládá právě ona — jméno třídy služby tak předá jako klíč `ui.service.police`
   * a překlad se doplní tady. Kdo chce klíč vypsat doslova, ať ho nepojmenuje
   * jako existující klíč.
   *
   * **Čárkami oddělený seznam klíčů** se přeloží po kusech a spojí zpátky.
   * Vzniklo to kvůli odmítnutím, která mají říct nejen co nejde, ale i co by
   * šlo: „na skálu se to postavit nedá, chce trávu nebo písek". Seznam povolených
   * terénů zná simulace, jejich jména ne — a jeden parametr na každý terén by
   * znamenal tolik variant hlášky, kolik má hra povrchů.
   */
  t(key: string, params?: TranslateParams): string {
    const text = this.lookup(key);
    if (!params) return interpolate(text ?? key);

    const resolved: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(params)) {
      resolved[name] = typeof value === 'string' ? this.resolve(value) : value;
    }
    return interpolate(text ?? key, resolved);
  }

  /**
   * Hodnotu parametru přeloží, je-li to klíč nebo seznam klíčů. Jinak ji vrátí,
   * jak přišla — hlášky obsahují i obyčejný text, třeba jméno města.
   */
  private resolve(value: string): string {
    if (KEY_SHAPE.test(value)) return this.has(value) ? this.t(value) : value;

    const parts = value.split(LIST_SEPARATOR);
    if (parts.length < 2 || !parts.every((part) => KEY_SHAPE.test(part) && this.has(part))) {
      return value;
    }
    return parts.map((part) => this.t(part)).join(this.t('ui.list.join'));
  }

  /** Existuje pro klíč překlad, nebo by `t()` vrátilo jen klíč? */
  has(key: string): boolean {
    return this.lookup(key) !== undefined;
  }

  /** Překlad v aktuálním jazyce, jinak v angličtině. Jen vlastní klíče tabulek. */
  private lookup(key: string): string | undefined {
    return (
      own(own(this.tables, this.language), key) ?? own(own(this.tables, FALLBACK_LANGUAGE), key)
    );
  }
}

/**
 * Vybere jazyk, který hra opravdu umí. Bere v potaz i tvar `cs-CZ`.
 * Když nesedí nic, padá na angličtinu.
 */
export function pickLanguage(preferred: readonly string[], available: readonly string[]): string {
  for (const candidate of preferred) {
    const lower = candidate.toLowerCase();
    const exact = available.find((language) => language.toLowerCase() === lower);
    if (exact) return exact;

    const base = lower.split('-')[0];
    const partial = available.find((language) => language.toLowerCase() === base);
    if (partial) return partial;
  }
  return available.includes(FALLBACK_LANGUAGE) ? FALLBACK_LANGUAGE : (available[0] ?? FALLBACK_LANGUAGE);
}
