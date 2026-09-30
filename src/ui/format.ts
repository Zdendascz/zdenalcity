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
  if (tag === numberLocale) return;
  numberLocale = tag;
  formatters.clear();
}

/**
 * Formátovače podle druhu, pro aktuální jazyk.
 *
 * `toLocaleString` si při **každém** volání staví nový `Intl.NumberFormat`
 * a HUD jich volá desítky za snímek. Jazyk se mění jen přepnutím, takže při
 * něm se mezipaměť zahodí a jinak se formátovač postaví jednou.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(kind: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let found = formatters.get(kind);
  if (found === undefined) {
    try {
      found = new Intl.NumberFormat(numberLocale, options);
    } catch {
      // Neplatná značka z překladu modu nesmí shodit HUD; výchozí jazyk
      // prohlížeče je lepší než nic.
      found = new Intl.NumberFormat(undefined, options);
    }
    formatters.set(kind, found);
  }
  return found;
}

/** Úzká nezlomitelná mezera místo obyčejné i nezlomitelné. */
function narrowSpaces(text: string): string {
  return text.replace(/\s/g, ' ');
}

/**
 * Procenta podle jazyka: česky „50 %", anglicky „50%".
 *
 * Bere **celá procenta** (50), ne podíl (0,5) — tak je počítají všichni
 * volající. Mezera před znakem procenta byla dřív v kódu napevno, takže
 * anglická verze psala „50 %".
 */
export function formatPercent(percent: number): string {
  return narrowSpaces(
    formatter('percent', { style: 'percent', maximumFractionDigits: 0 }).format(percent / 100),
  );
}

/** Číslo s jedním desetinným místem, s desetinnou čárkou či tečkou podle jazyka. */
export function formatDecimal1(value: number): string {
  return narrowSpaces(
    formatter('decimal1', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value),
  );
}

/** Oddělovač tisíců je úzká nezlomitelná mezera — čitelné v češtině i angličtině. */
export function formatNumber(value: number): string {
  return narrowSpaces(formatter('number', {}).format(value));
}
