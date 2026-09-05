/**
 * Jak široké je rozhraní a co se do něj vejde.
 *
 * Tři stupně, ne dva. Hru začali lidé hrát na mobilu a HUD, který na monitoru
 * sedí, tam zabíral půlku obrazovky — jenže mezi telefonem a širokým monitorem
 * je ještě okno na půl obrazovky, kde se plná lišta **zalomí do dvou řad nahoře
 * i dole**. Autor to nahlásil se snímkem okna 1044 pixelů širokého: „vypadá to
 * kravsky na dva řádky nahoře i dole."
 *
 * | stupeň | kdy | co se stane |
 * |---|---|---|
 * | `full` | široké okno | všechno v liště, jak to bylo vždycky |
 * | `dense` | okno pod 1500 px | nástroje a ovládání se schovají pod trojtečku, z osmi statistik zbude kasa s bilancí |
 * | `compact` | prst nebo okno pod 900 px | k tomu ještě lupa a sloučená tlačítka, viz `docs/15-MOBIL.md` |
 *
 * Hranice 1500 není od oka: plná lišta má dole šestnáct nabídek nástrojů
 * a čtrnáct tlačítek ovládání, což i s mezerami dělá kolem 1500 pixelů. Pod tím
 * se zalomí, takže přesně tam má smysl začít schovávat.
 */
export type LayoutMode = 'full' | 'dense' | 'compact';

/**
 * Kdy se sáhne po úplně úsporné liště.
 *
 * Dvě podmínky, každá kvůli něčemu jinému:
 *
 * - `pointer: coarse` je prst. Dotykové zařízení dostane úspornou lištu i na
 *   tabletu, kde by se ta hustá sice vešla, ale tlačítka by byla na prst malá.
 *   Notebook s dotykovou obrazovkou sem **nespadá** — hlásí `fine`, protože se
 *   podmínka ptá na hlavní ukazatel, ne na to, co všechno zařízení umí.
 * - Úzké okno dostane totéž bez ohledu na ukazatel.
 */
export const COMPACT_QUERY = '(pointer: coarse), (width <= 900px)';

/** Kdy se začne schovávat pod trojtečku. Viz tabulka výš. */
export const DENSE_QUERY = '(width <= 1500px)';

/** Bez `matchMedia` (jsdom v testech) se hraje v plné verzi. */
function query(text: string): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(text);
}

export function layoutMode(): LayoutMode {
  if (query(COMPACT_QUERY)?.matches === true) return 'compact';
  if (query(DENSE_QUERY)?.matches === true) return 'dense';
  return 'full';
}

/**
 * Hlásí změnu stupně.
 *
 * Otočení telefonu i přetažení okna myší je právě takový případ: lišta se musí
 * přestavět, ne zůstat v tom, co platilo při startu. Hlásí se **jen skutečná
 * změna stupně** — přetažení okna o pixel spustí událost pokaždé, ale přestavět
 * HUD kvůli tomu není proč.
 */
export function watchLayout(onChange: (mode: LayoutMode) => void): void {
  let last = layoutMode();
  for (const text of [COMPACT_QUERY, DENSE_QUERY]) {
    query(text)?.addEventListener('change', () => {
      const mode = layoutMode();
      if (mode === last) return;
      last = mode;
      onChange(mode);
    });
  }
}
