import type { Definition } from '@/content/schema';
import { TAXABLE_VALUE_PER_UNIT } from '@/sim/systems/economy';
import type { Budget, BudgetLine } from '@/sim/systems/economy';
import { button, el } from './dom';
import { formatNumber } from './format';
import type { I18n } from './i18n';

/**
 * Ekonomická tabulka. Ukazuje, kolik co stojí postavit a provozovat, kolik
 * kterých budov stojí ve městě a co městu nesou.
 *
 * Ceny se berou z definic obsahu, čísla z rozpočtu, který počítá simulace —
 * tady se nic nedopočítává, aby se výpis nemohl rozejít se skutečností.
 */
export class BudgetPanel {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private readonly definitions: readonly Definition[];
  private visible = false;

  constructor(parent: HTMLElement, i18n: I18n, definitions: readonly Definition[]) {
    this.i18n = i18n;
    this.definitions = [...definitions].sort((a, b) => a.id.localeCompare(b.id));

    this.root = el('div', 'sheet is-hidden');
    parent.appendChild(this.root);
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.classList.toggle('is-hidden', !this.visible);
    return this.visible;
  }

  update(budget: Budget, funds: number): void {
    if (!this.visible) return;

    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const counts = new Map(budget.lines.map((line) => [line.definitionId, line]));

    this.root.replaceChildren();

    const header = el('div', 'sheet__header');
    header.appendChild(el('h2', 'sheet__title', t('ui.budget.title')));
    const close = button('chip chip--tight', () => this.toggle());
    close.textContent = '×';
    header.appendChild(close);
    this.root.appendChild(header);

    const table = el('table', 'sheet__table');
    const head = el('tr');
    for (const key of [
      'ui.budget.building',
      'ui.budget.cost',
      'ui.budget.count',
      'ui.budget.powered',
      'ui.budget.income',
      'ui.budget.upkeep',
      'ui.budget.net',
    ]) {
      head.appendChild(el('th', undefined, t(key)));
    }
    table.appendChild(head);

    for (const definition of this.definitions) {
      const line = counts.get(definition.id);
      const income = line?.income ?? 0;
      const upkeep = line?.upkeep ?? 0;

      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t(definition.name)));
      row.appendChild(el('td', undefined, formatNumber(definition.construction.cost)));
      row.appendChild(el('td', undefined, formatNumber(line?.count ?? 0)));
      row.appendChild(
        el('td', undefined, line ? `${line.poweredCount}/${line.count}` : '-'),
      );
      row.appendChild(el('td', undefined, income === 0 ? '-' : `+${formatNumber(income)}`));
      row.appendChild(el('td', undefined, upkeep === 0 ? '-' : `−${formatNumber(upkeep)}`));

      const net = income - upkeep;
      const netCell = el('td', net < 0 ? 'is-negative' : undefined, formatNumber(net));
      row.appendChild(netCell);
      table.appendChild(row);

      // Pod řádkem rozpis, ze kterého je vidět, odkud se čísla vzala.
      const breakdown = line ? this.describe(line) : '';
      if (breakdown) {
        const note = el('tr', 'sheet__breakdown');
        const cell = el('td', undefined, breakdown);
        cell.colSpan = 7;
        note.appendChild(cell);
        table.appendChild(note);
      }
    }

    const total = el('tr', 'sheet__total');
    total.appendChild(el('td', 'sheet__name', t('ui.budget.total')));
    total.appendChild(el('td'));
    total.appendChild(el('td'));
    total.appendChild(el('td'));
    total.appendChild(el('td', undefined, `+${formatNumber(budget.income)}`));
    total.appendChild(el('td', undefined, `−${formatNumber(budget.expenses)}`));
    const net = budget.income - budget.expenses;
    total.appendChild(el('td', net < 0 ? 'is-negative' : undefined, formatNumber(net)));
    table.appendChild(total);

    this.root.appendChild(table);
    this.root.appendChild(
      el('p', 'sheet__note', t('ui.budget.funds', { funds: formatNumber(funds) })),
    );
  }

  /** Slovní rozpis jednoho řádku: odkud se vzal příjem a odkud údržba. */
  private describe(line: BudgetLine): string {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const parts: string[] = [];

    if (line.taxUnitKey !== null && line.taxRate !== null) {
      parts.push(
        t('ui.budget.formula.tax', {
          base: formatNumber(line.taxBase),
          unit: t(line.taxUnitKey),
          value: TAXABLE_VALUE_PER_UNIT,
          rate: line.taxRate,
          income: formatNumber(line.income),
        }),
      );
    }

    if (line.upkeepCount > 0) {
      parts.push(
        t('ui.budget.formula.upkeep', {
          count: line.upkeepCount,
          each: formatNumber(line.upkeepEach),
          total: formatNumber(line.upkeep),
        }),
      );
    }

    // Nečinné jsou ty, které neplatí ani údržbu — u služeb je proud nezajímá,
    // takže se u nich hláška „mimo provoz" nesmí objevit.
    const idle = line.count - line.upkeepCount;
    if (idle > 0) parts.push(t('ui.budget.formula.idle', { count: idle }));

    return parts.join('  ·  ');
  }
}
