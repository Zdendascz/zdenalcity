import { button, el } from './dom';
import type { I18n } from './i18n';

/**
 * Nabídka „Zpět" po nevratném tahu.
 *
 * Prstem se buldozer i zóna trefí vedle mnohem snáz než myší a omyl stojí
 * peníze. Do teď se nedalo vrátit nic: hráč zboural dům, který postavil před
 * hodinou, a zbylo mu jen postavit nový — jiný, mladší a bez obyvatel.
 *
 * Je to **hláška s tlačítkem, ne trvalá historie**: nabídka platí pět sekund
 * a drží jediný krok. Kdo si vrácení nevšimne, o nic dalšího nepřijde, a hra
 * si nemusí pamatovat celé sezení.
 */
export class UndoBar {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly i18n: I18n;
  private readonly onUndo: (snapshot: Uint8Array) => void;
  private snapshot: Uint8Array | null = null;
  private timer = 0;
  /** Jak dlouho nabídka stojí. Parametr kvůli testům, ne kvůli nastavení. */
  private readonly lifetimeMs: number;

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    onUndo: (snapshot: Uint8Array) => void,
    lifetimeMs = 5000,
  ) {
    this.i18n = i18n;
    this.onUndo = onUndo;
    this.lifetimeMs = lifetimeMs;

    this.root = el('div', 'undo is-hidden');
    this.text = el('span', 'undo__text');
    const action = button('chip chip--primary', () => this.undo());
    action.textContent = i18n.t('ui.undo.button');
    this.root.append(this.text, action);
    parent.appendChild(this.root);
  }

  /**
   * Ukáže nabídku k danému snímku. Další tah tu předchozí **přepíše**: vracet
   * se dá jen poslední krok a dva „Zpět" vedle sebe by hráč nerozeznal.
   */
  show(labelKey: string, snapshot: Uint8Array): void {
    this.snapshot = snapshot;
    this.text.textContent = this.i18n.t(labelKey);
    this.root.classList.remove('is-hidden');

    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), this.lifetimeMs);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.snapshot = null;
    this.root.classList.add('is-hidden');
  }

  isVisible(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  private undo(): void {
    const snapshot = this.snapshot;
    this.hide();
    if (snapshot) this.onUndo(snapshot);
  }
}
