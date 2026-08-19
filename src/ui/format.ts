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

/** Oddělovač tisíců je úzká nezlomitelná mezera — čitelné v češtině i angličtině. */
export function formatNumber(value: number): string {
  return value.toLocaleString('cs-CZ').replace(/\s/g, ' ');
}
