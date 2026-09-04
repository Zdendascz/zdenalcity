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

export const FALLBACK_LANGUAGE = 'en';

export type LocaleTable = Readonly<Record<string, string>>;
export type LocaleTables = Readonly<Record<string, LocaleTable>>;

export type TranslateParams = Readonly<Record<string, string | number>>;

/** Nahradí `{jméno}` hodnotou. Neznámý zástupný symbol zůstane, ať je vidět. */
function interpolate(text: string, params?: TranslateParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
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
    for (const listener of this.listeners) listener();
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
    const text = this.tables[this.language]?.[key] ?? this.tables[FALLBACK_LANGUAGE]?.[key];
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
    if (this.has(value)) return this.t(value);

    const parts = value.split(LIST_SEPARATOR);
    if (parts.length < 2 || !parts.every((part) => this.has(part))) return value;
    return parts.map((part) => this.t(part)).join(this.t('ui.list.join'));
  }

  /** Existuje pro klíč překlad, nebo by `t()` vrátilo jen klíč? */
  has(key: string): boolean {
    return (
      this.tables[this.language]?.[key] !== undefined ||
      this.tables[FALLBACK_LANGUAGE]?.[key] !== undefined
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
