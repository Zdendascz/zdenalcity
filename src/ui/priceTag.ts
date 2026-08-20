import { el } from './dom';

/**
 * Cenovka, která visí u kurzoru, dokud tam hráč míří.
 *
 * Na rozdíl od `CostPopup`, která ohlásí **zaplacenou** cenu po kliknutí, tahle
 * ukazuje cenu **předem**. Vzniklo to kvůli srovnávání parcely pod budovou:
 * stavba na svahu stojí víc než na rovině a hráč to má vidět dřív, než klikne
 * (§12 kritérium 14 zadání fáze 3). Zjistit to až z účtu je špatná zpráva
 * v nejhorší možnou chvíli.
 */
export class PriceTag {
  private readonly node: HTMLElement;
  private text = '';

  constructor(parent: HTMLElement) {
    this.node = el('div', 'price-tag');
    this.node.style.display = 'none';
    parent.appendChild(this.node);
  }

  show(viewX: number, viewY: number, text: string): void {
    // Přepisovat stejný text každý snímek by zbytečně budilo layout.
    if (text !== this.text) {
      this.node.textContent = text;
      this.text = text;
    }
    this.node.style.display = '';
    this.node.style.left = `${viewX}px`;
    this.node.style.top = `${viewY}px`;
  }

  hide(): void {
    this.node.style.display = 'none';
  }

  destroy(): void {
    this.node.remove();
  }
}
