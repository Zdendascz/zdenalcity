/** Drobní pomocníci na stavbu DOMu. UI je plain HTML/CSS, žádný framework. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className);
  node.type = 'button';
  node.addEventListener('click', (event) => {
    // Bez odebrání fokusu by mezerník mačkal naposledy kliknuté tlačítko
    // místo toho, aby panoval mapou.
    //
    // Týká se to ale **jen myši** (T-revize, nález 25). Prohlížeč posílá
    // `click` i při aktivaci z klávesnice a ty dvě se rozliší snadno:
    // `detail` je počet kliknutí, u klávesnice tedy nula. Do teď fokus skákal
    // na začátek dokumentu i po Enteru, takže kdo procházel rozhraní Tabem,
    // otevřel panel a další Tab ho poslal zase na začátek — k obsahu toho
    // panelu se proklikával celým rozhraním dokola.
    if (event.detail > 0) node.blur();
    onClick();
  });
  return node;
}

/*
 * Zápis jen při změně.
 *
 * HUD se přepisuje každý snímek a dřív sypal do DOMu desítky `textContent`,
 * `title` a stylů se stejnou hodnotou. Přiřazení `textContent` zahodí a znovu
 * založí textový uzel i tehdy, když se text nezměnil, a prohlížeč pak každý
 * snímek přepočítával styl a rozvržení lišty. Čtení je levné, zápis ne.
 */

export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setTitle(node: HTMLElement, title: string): void {
  if (node.title !== title) node.title = title;
}

export function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** Jedna vlastnost inline stylu, jménem z CSS (`background-color`, ne camelCase). */
export function setStyle(node: HTMLElement, property: string, value: string): void {
  if (node.style.getPropertyValue(property) !== value) node.style.setProperty(property, value);
}

/**
 * Stav přepínače: třída pro oko, `aria-pressed` pro odečítačku.
 *
 * Do teď byl stav vidět jen jako rozsvícené tlačítko (`is-active`), takže
 * odečítačka hlásila „Mřížka, tlačítko" bez ohledu na to, jestli je zapnutá.
 */
export function setPressed(node: HTMLElement, pressed: boolean): void {
  node.classList.toggle('is-active', pressed);
  setAttr(node, 'aria-pressed', pressed ? 'true' : 'false');
}

/**
 * Adresa obrázku jako hodnota CSS `url("…")`.
 *
 * Bez uvozovek rozbila `url(…)` každá adresa se závorkou, mezerou nebo
 * uvozovkou — a adresy dodává obsah, tedy i mod. `CSS.escape` sem nepatří,
 * ten je na identifikátory; v řetězci stačí zdvojit zpětné lomítko
 * a uvozovku a konce řádků přepsat na escape.
 */
export function cssUrl(url: string): string {
  const quoted = url.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ').replace(/\r/g, '\\d ');
  return `url("${quoted}")`;
}

let nextId = 0;

/**
 * Označí okno, které překrývá hru, jako modální dialog.
 *
 * Bez toho odečítačka nevěděla, že se otevřelo okno, ani jak se jmenuje —
 * dialog nové hry, autoři, zvětšený obrázek i hlášení pohromy byly jen další
 * `div` na konci stránky. Jméno se bere z nadpisu okna (`aria-labelledby`),
 * takže se s jazykem přeloží samo.
 */
export function markDialog(
  node: HTMLElement,
  title: HTMLElement,
  role: 'dialog' | 'alertdialog' = 'dialog',
): void {
  if (title.id === '') title.id = `dialog-title-${++nextId}`;
  node.setAttribute('role', role);
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-labelledby', title.id);
}

/** Rozbaluje tlačítko panel? `aria-expanded` podle toho, jestli je otevřený. */
export function setExpanded(node: HTMLElement, expanded: boolean): void {
  setAttr(node, 'aria-expanded', expanded ? 'true' : 'false');
}
