import { el } from './dom';

/**
 * Bublina s cenou, která vyskočí u kurzoru a sama zmizí.
 *
 * Hráč jinak nemá jak poznat, kolik ho klik stál — kasa v HUDu se změní, ale
 * o pár set pixelů jinde, než se dívá.
 */
export class CostPopup {
  private readonly parent: HTMLElement;

  constructor(parent: HTMLElement) {
    this.parent = parent;
  }

  show(viewX: number, viewY: number, text: string): void {
    const node = el('div', 'cost-popup', text);
    node.style.left = `${viewX}px`;
    node.style.top = `${viewY}px`;
    // Doběh animace je zároveň signál k úklidu — žádný časovač navíc.
    node.addEventListener('animationend', () => node.remove());
    this.parent.appendChild(node);
  }
}
