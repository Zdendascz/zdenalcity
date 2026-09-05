/**
 * Značka sestavení pro úvodní obrazovku.
 *
 * Doplňuje ji Vite přes `define` (viz `vite.config.ts`), takže v hotovém
 * buildu je to pevný řetězec a za běhu se nic nezjišťuje.
 */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;

/** Krátký hash commitu, ze kterého build vznikl. Pomlčka, když git chyběl. */
export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : '—';

/** Čas sestavení v ISO. Ve vývoji je to čas spuštění dev serveru. */
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();

/**
 * Je to vývojový běh, ne hotový build?
 *
 * Rozdíl není kosmetický. `define` vyhodnotí Vite **jednou, při startu dev
 * serveru**, kdežto samotný kód se pak přenačítá při každé úpravě. Hash i čas
 * tak zůstanou viset na commitu, který byl v gitu ve chvíli, kdy server
 * naběhl — a hráč čte „verze stará dvě hodiny" nad kódem, který vznikl před
 * minutou. Autor to nahlásil tím, že měl na lokále starší verzi než
 * na produkci, ačkoli lokál byl napřed.
 *
 * V hotovém buildu je to naopak přesné: build a commit vzniknou v jeden okamžik.
 */
export const IS_DEV: boolean = import.meta.env.DEV;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Jak je verze stará, slovy.
 *
 * Samotné datum odpovědi nedá — „4. 9. 2026" člověk nepřečte jako „týden".
 * Proto se vypisuje **obojí**: datum pro pořádek a stáří pro rozhodnutí,
 * jestli má hráč sáhnout po novější verzi.
 *
 * Zaokrouhluje se dolů a hrubě: přesnost na hodiny by u roku staré verze
 * nikomu nepomohla.
 */
export function buildAge(
  t: (key: string, params?: Record<string, string | number>) => string,
  now: number = Date.now(),
): string {
  const built = Date.parse(BUILD_TIME);
  if (Number.isNaN(built)) return '';

  // Záporný rozdíl znamená posunuté hodiny ve stroji hráče, ne budoucí build.
  // Vypsat „za tři dny" by vypadalo jako chyba, tak se to bere jako čerstvé.
  const elapsed = Math.max(0, now - built);

  if (elapsed < HOUR) return t('ui.version.justNow');
  if (elapsed < DAY) return plural(t, 'hours', Math.floor(elapsed / HOUR));

  const days = Math.floor(elapsed / DAY);
  if (days < 14) return plural(t, 'days', days);
  if (days < 60) return plural(t, 'weeks', Math.floor(days / 7));
  if (days < 730) return plural(t, 'months', Math.floor(days / 30));
  return plural(t, 'years', Math.floor(days / 365));
}

/**
 * Český tvar podle počtu.
 *
 * Čeština má tři: **jeden** rok, **dva až čtyři** roky, **pět a víc** let.
 * Jediný klíč s `{count}` dá „před 1 lety" a to je vidět na první pohled.
 *
 * Tvar `.few` mají **oba jazyky**, i když ho angličtina nepotřebuje. Záloha
 * v `I18n` je totiž angličtina, takže chybějící anglický klíč nemá kam
 * spadnout a vypsal by se jako holé `ui.version.years.few`. Dva stejné řádky
 * jsou levnější než výjimka v kódu.
 */
function plural(
  t: (key: string, params?: Record<string, string | number>) => string,
  unit: string,
  count: number,
): string {
  const form = count === 1 ? 'one' : count < 5 ? 'few' : 'many';
  return t(`ui.version.${unit}.${form}`, { count });
}

/** Datum sestavení podle jazyka hráče, bez času. */
export function buildDate(language: string): string {
  const built = new Date(BUILD_TIME);
  if (Number.isNaN(built.getTime())) return '';
  return built.toLocaleDateString(language === 'cs' ? 'cs-CZ' : 'en-GB', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}
