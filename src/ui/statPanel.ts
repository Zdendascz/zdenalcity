import type { StatBreakdown } from '@/sim/statBreakdown';
import { button, el } from './dom';
import { formatNumber } from './format';
import { iconSvg } from './icons';
import type { I18n } from './i18n';

/**
 * Z čeho je číslo v liště.
 *
 * Zadání autora: „jeden sloupec plus, druhý mínus, na konci souhrn." Je to
 * tentýž tvar jako roční vyúčtování a schválně — hráč se ho naučí jednou.
 *
 * Panel **nic nepočítá**, čísla přijdou ze `sim/statBreakdown.ts`. Kreslí se
 * jen při změně: `update` běží ve smyčce vykreslování a přestavovat tabulku
 * šedesátkrát za vteřinu znamená, že se na její tlačítka nedá kliknout.
 */
export class StatPanel {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private key: string | null = null;
  private drawn: string | null = null;

  constructor(parent: HTMLElement, i18n: I18n) {
    this.i18n = i18n;
    this.root = el('div', 'sheet sheet--stat is-hidden');
    parent.appendChild(this.root);
  }

  /** Který údaj je otevřený, nebo `null`. */
  openKey(): string | null {
    return this.key;
  }

  /** Otevře údaj, nebo ho zavře, když už otevřený je. */
  toggle(key: string): void {
    this.key = this.key === key ? null : key;
    this.drawn = null;
    this.root.classList.toggle('is-hidden', this.key === null);
  }

  close(): void {
    this.key = null;
    this.drawn = null;
    this.root.classList.add('is-hidden');
  }

  update(breakdown: StatBreakdown): void {
    const key = this.key;
    if (key === null) return;

    const signature = [
      key,
      breakdown.total,
      ...breakdown.plus.map((row) => `${row.label}:${row.value}`),
      '|',
      ...breakdown.minus.map((row) => `${row.label}:${row.value}`),
    ].join(',');
    if (signature === this.drawn) return;
    this.drawn = signature;

    const t = (name: string, params?: Record<string, string | number>) => this.i18n.t(name, params);
    this.root.replaceChildren();

    const header = el('div', 'sheet__header');
    header.appendChild(el('h2', 'sheet__title', t(`ui.hud.${key}`)));
    const close = button('chip chip--tight', () => this.close());
    close.appendChild(iconSvg('close'));
    header.appendChild(close);
    this.root.appendChild(header);

    const columns = el('div', 'stat__columns');
    columns.appendChild(this.column(t('ui.stat.plus'), breakdown.plus, 'is-income'));
    columns.appendChild(this.column(t('ui.stat.minus'), breakdown.minus, 'is-expense'));
    this.root.appendChild(columns);

    const total = el('div', 'stat__total');
    total.appendChild(el('span', 'year__name', t('ui.stat.total')));
    total.appendChild(
      el(
        'span',
        breakdown.total < 0 ? 'year__amount is-negative' : 'year__amount',
        formatNumber(breakdown.total),
      ),
    );
    this.root.appendChild(total);

    if (breakdown.note) {
      this.root.appendChild(
        el('p', 'sheet__note', t(breakdown.note.key, breakdown.note.params)),
      );
    }
  }

  private column(title: string, rows: StatBreakdown['plus'], tone: string): HTMLElement {
    const t = (name: string) => this.i18n.t(name);
    const column = el('div', 'year__column');
    column.appendChild(el('h3', 'year__heading', title));
    if (rows.length === 0) column.appendChild(el('p', 'sheet__note', t('ui.stat.nothing')));

    for (const row of rows) {
      const line = el('div', 'year__row');
      line.appendChild(el('span', 'year__name', t(row.label)));
      line.appendChild(el('span', `year__amount ${tone}`, formatNumber(row.value)));
      column.appendChild(line);
    }
    return column;
  }
}
