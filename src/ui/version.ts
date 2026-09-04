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
  if (elapsed < DAY) return t('ui.version.hours', { count: Math.floor(elapsed / HOUR) });

  const days = Math.floor(elapsed / DAY);
  if (days < 14) return t('ui.version.days', { count: days });
  if (days < 60) return t('ui.version.weeks', { count: Math.floor(days / 7) });
  if (days < 730) return t('ui.version.months', { count: Math.floor(days / 30) });
  return t('ui.version.years', { count: Math.floor(days / 365) });
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
