/**
 * Kdy se rozhraní přepne do úsporného režimu.
 *
 * Hru začali lidé hrát na mobilu a HUD, který na monitoru sedí, tam zabírá
 * půlku obrazovky: dvacet nástrojů ve třech řadách, osm statistik vedle sebe
 * a pět stupňů rychlosti. Na telefonu z toho zbyde škvíra na město.
 *
 * Úsporný režim proto nechá v liště **jen to, co hráč mačká pořád**, a zbytek
 * schová za jedno tlačítko. Co kam patří, rozhoduje `hud.ts` a `toolbar.ts`;
 * tenhle soubor jen říká, **kdy** se to má stát.
 *
 * Podmínka je dvojí schválně:
 *
 * - `pointer: coarse` je prst. Dotykové zařízení dostane úsporný HUD i na
 *   tabletu, kde by se lišta sice vešla, ale tlačítka by byla na prst malá.
 *   Notebook s dotykovou obrazovkou sem nespadá — ten hlásí `fine`, protože
 *   se rozhoduje podle **hlavního** ukazatele.
 * - Úzké okno dostane totéž bez ohledu na ukazatele. Lišta se v něm stejně
 *   zalamuje do tří řad, takže je to zlepšení i na počítači.
 */
export const COMPACT_QUERY = '(pointer: coarse), (width <= 900px)';

/** Bez `matchMedia` (jsdom v testech) se hraje v plné verzi. */
function query(): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(COMPACT_QUERY);
}

export function isCompact(): boolean {
  return query()?.matches ?? false;
}

/**
 * Hlásí změnu režimu.
 *
 * Otočení telefonu na šířku je právě takový případ: podmínka se nezmění (prst
 * je pořád prst), ale kdyby se měnila, HUD se musí přestavět, ne zůstat
 * v tom, co platilo při startu.
 */
export function watchCompact(onChange: (compact: boolean) => void): void {
  const media = query();
  if (!media) return;
  media.addEventListener('change', (event) => onChange(event.matches));
}
