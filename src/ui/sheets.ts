/**
 * Panely uprostřed obrazovky: karta parcely, rozpis čísla, rozpočet, poradce,
 * ekonomika, linky MHD.
 *
 * Otevřený smí být **jen jeden**. Do téhle opravy se vršily přes sebe — hráč
 * si nechal otevřenou kasu, klepl do mapy a karta parcely se položila přes ni.
 * Panel má 96% pozadí, takže spodní prosvítal a texty se slily.
 *
 * Seznam bydlí v modulu, ne v HUDu, ze stejného důvodu jako u roletek
 * (`popover.ts`): panel nemá znát ostatní panely, jen sebe.
 *
 * Okno pohromy ani roční uzávěrka sem **nepatří**. To nejsou panely, které si
 * hráč otevřel, ale zprávy, které musí vidět; zavřít je smí jen on sám.
 */
export interface Sheet {
  hide(): void;
}

const sheets = new Set<Sheet>();
let listening = false;

/** Zavře všechny panely kromě `keep`. Volá se při otevírání. */
export function closeOtherSheets(keep: Sheet | null): void {
  for (const sheet of [...sheets]) {
    if (sheet !== keep) sheet.hide();
  }
}

/**
 * Přihlásí panel do skupiny. Volá se v konstruktoru.
 *
 * Odhlašování není: panely žijí po celou dobu hry a vznikají jednou.
 */
export function registerSheet(sheet: Sheet): void {
  sheets.add(sheet);
  if (listening) return;
  listening = true;

  // Escape zavíral jen roletky, panely ne. Na počítači je to nejkratší cesta
  // ven; na telefonu ji zastupuje křížek v záhlaví panelu.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOtherSheets(null);
  });
}
