/** Oddělovač tisíců je úzká nezlomitelná mezera — čitelné v češtině i angličtině. */
export function formatNumber(value: number): string {
  return value.toLocaleString('cs-CZ').replace(/\s/g, ' ');
}
