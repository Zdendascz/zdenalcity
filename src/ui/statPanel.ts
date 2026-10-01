import type { StatBreakdown } from '@/sim/statBreakdown';
import { el } from './dom';
import { formatMoney, formatNumber, moneyParams } from './format';
import { sheetHeader } from './icons';
import type { I18n } from './i18n';
import { closeOtherSheets, registerSheet } from './sheets';

/**
 * Údaje, které jsou peníze, a proto se píšou s měnou (T138). Obyvatelé,
 * práce ani proud „Kčs" nedostanou — to by byla lež v jednotkách.
 */
const MONEY_STATS: readonly string[] = ['funds', 'balance'];

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
    registerSheet(this);
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
    if (this.key !== null) closeOtherSheets(this);
  }

  close(): void {
    this.key = null;
    this.drawn = null;
    this.root.classList.add('is-hidden');
  }

  /** Jméno ze skupiny panelů (`ui/sheets.ts`). */
  hide(): void {
    this.close();
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

    this.root.appendChild(sheetHeader(t(`ui.hud.${key}`), t('ui.common.close'), () => this.close()));

    const columns = el('div', 'stat__columns');
    const amount = MONEY_STATS.includes(key) ? formatMoney : formatNumber;
    columns.appendChild(this.column(t('ui.stat.plus'), breakdown.plus, 'is-income', amount));
    columns.appendChild(this.column(t('ui.stat.minus'), breakdown.minus, 'is-expense', amount));
    this.root.appendChild(columns);

    const total = el('div', 'stat__total');
    total.appendChild(el('span', 'year__name', t('ui.stat.total')));
    total.appendChild(
      el(
        'span',
        breakdown.total < 0 ? 'year__amount is-negative' : 'year__amount',
        amount(breakdown.total),
      ),
    );
    this.root.appendChild(total);

    if (breakdown.note) {
      this.root.appendChild(
        el('p', 'sheet__note', t(breakdown.note.key, moneyParams(breakdown.note.params))),
      );
    }
  }

  private column(
    title: string,
    rows: StatBreakdown['plus'],
    tone: string,
    amount: (value: number) => string,
  ): HTMLElement {
    const t = (name: string) => this.i18n.t(name);
    const column = el('div', 'year__column');
    column.appendChild(el('h3', 'year__heading', title));
    if (rows.length === 0) column.appendChild(el('p', 'sheet__note', t('ui.stat.nothing')));

    for (const row of rows) {
      const line = el('div', 'year__row');
      line.appendChild(el('span', 'year__name', t(row.label)));
      line.appendChild(el('span', `year__amount ${tone}`, amount(row.value)));
      column.appendChild(line);
    }
    return column;
  }
}
