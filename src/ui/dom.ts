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
  node.addEventListener('click', () => {
    // Bez odebrání fokusu by mezerník mačkal naposledy kliknuté tlačítko
    // místo toho, aby panoval mapou.
    node.blur();
    onClick();
  });
  return node;
}
