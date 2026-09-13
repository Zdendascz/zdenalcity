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
