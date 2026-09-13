/**
 * Klíče, pod kterými se hledá popisek členu v rozpisu ceny půdy, v pořadí.
 *
 * Zdroj členu je řetězec z obsahu (třída služby, terén, veličina), takže
 * jediné, co brání tomu, aby v panelu svítil holý klíč, je test, který tenhle
 * seznam projde proti překladům. Proto je to funkce, a ne rozvětvený výraz
 * schovaný v UI.
 */
export function landValueTermKeys(source: string): readonly string[] {
  return [`ui.parcel.term.${source}`, `ui.service.${source}`, `ui.overlay.${source}`];
}

/**
 * Jazyková značka pro čísla. Přepisuje ji `I18n` z klíče `ui.locale.tag`.
 *
 * Byla natvrdo `cs-CZ` (T-revize, nález 23), takže anglicky hrající hráč viděl
 * ve **všech** panelech částky ve tvaru 1 234 567 místo 1,234,567 — a viděl je
 * v každém čísle, na které se podíval. Je to modul se stavem schválně:
 * formátování je zobrazení, jazyk je ve hře jeden a protáhnout ho stem
 * volajících by z něj udělalo parametr, na který se dá zapomenout.
 */
let numberLocale = 'cs-CZ';

export function setNumberLocale(tag: string): void {
  numberLocale = tag;
}

/** Oddělovač tisíců je úzká nezlomitelná mezera — čitelné v češtině i angličtině. */
export function formatNumber(value: number): string {
  return value.toLocaleString(numberLocale).replace(/\s/g, ' ');
}
