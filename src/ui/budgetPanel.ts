import type { Definition } from '@/content/schema';
import type { Budget, BudgetLine } from '@/sim/systems/economy';
import { iconSvg } from './icons';
import { button, el } from './dom';
import { formatNumber } from './format';
import type { I18n } from './i18n';
import { closeOtherSheets, registerSheet } from './sheets';

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
  /**
   * Otisk stavu, ze kterého je tabulka nakreslená.
   *
   * Bez něj se tabulka **přestavovala každý snímek** — `update` běží ve
   * smyčce vykreslování a začíná `replaceChildren()`. Tlačítko pod kurzorem
   * se tak každých šestnáct milisekund vyhodilo a nahradilo novým, takže se
   * na něj nedalo kliknout: myš stiskla jeden uzel a pustila jiný. Autor to
   * hlásil jako „u tabulky Ekonomický přehled nefunguje X".
   */
  private drawn: string | null = null;

  constructor(parent: HTMLElement, i18n: I18n, definitions: readonly Definition[]) {
    this.i18n = i18n;
    this.definitions = [...definitions].sort((a, b) => a.id.localeCompare(b.id));

    this.root = el('div', 'sheet is-hidden');
    parent.appendChild(this.root);
    registerSheet(this);
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.classList.toggle('is-hidden', !this.visible);
    // Zavřená tabulka zahodí otisk, ať se po otevření nakreslí z čerstvých
    // čísel, a ne z těch, u kterých se zavírala.
    this.drawn = null;
    if (this.visible) closeOtherSheets(this);
    return this.visible;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('is-hidden');
    this.drawn = null;
  }

  update(budget: Budget, funds: number): void {
    if (!this.visible) return;

    const signature = BudgetPanel.signature(budget, funds);
    if (signature === this.drawn) return;
    this.drawn = signature;

    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const counts = new Map(budget.lines.map((line) => [line.definitionId, line]));

    this.root.replaceChildren();

    const header = el('div', 'sheet__header');
    header.appendChild(el('h2', 'sheet__title', t('ui.budget.title')));
    const close = button('chip chip--tight', () => this.toggle());
    close.appendChild(iconSvg('close'));
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
      const breakdown = line ? this.describe(line, budget.valuePerUnit) : '';
      if (breakdown) {
        const note = el('tr', 'sheet__breakdown');
        const cell = el('td', undefined, breakdown);
        cell.colSpan = 7;
        note.appendChild(cell);
        table.appendChild(note);
      }
    }

    // Silnice nejsou budova, ale platí se každý měsíc — vlastní řádek.
    if (budget.roads.count > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.roads')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.roads.count)));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, '-'));
      row.appendChild(el('td', undefined, `−${formatNumber(budget.roads.upkeep)}`));
      row.appendChild(el('td', 'is-negative', formatNumber(-budget.roads.upkeep)));
      table.appendChild(row);
    }

    // MHD taky vlastní řádek: vozidlo není budova a jízdné není daň.
    if (budget.transit.lines > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.transit')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.transit.vehicles)));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, `+${formatNumber(budget.transit.income)}`));
      row.appendChild(el('td', undefined, `−${formatNumber(budget.transit.upkeep)}`));
      const net = budget.transit.income - budget.transit.upkeep;
      row.appendChild(el('td', net < 0 ? 'is-negative' : undefined, formatNumber(net)));
      table.appendChild(row);
    }

    // Splátky půjček. Nejsou údržba ničeho — je to cena za dřívější výpomoc.
    if (budget.debt.loans > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.debt')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.debt.loans)));
      row.appendChild(el('td', undefined, formatNumber(budget.debt.owed)));
      row.appendChild(el('td', undefined, '-'));
      row.appendChild(el('td', undefined, `−${formatNumber(budget.debt.payment)}`));
      row.appendChild(el('td', 'is-negative', formatNumber(-budget.debt.payment)));
      table.appendChild(row);
    }

    // Dluhopisy zvlášť od půjček: úrok se platí ročně a jistina naráz, takže
    // se to s měsíční splátkou nesčítá do jednoho čísla, které by nic neříkalo.
    if (budget.debt.bonds > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.bonds')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.debt.bonds)));
      row.appendChild(el('td', undefined, formatNumber(budget.debt.bondOwed)));
      row.appendChild(el('td', undefined, '-'));
      row.appendChild(el('td', undefined, `−${formatNumber(budget.debt.bondPayment)}`));
      row.appendChild(el('td', 'is-negative', formatNumber(-budget.debt.bondPayment)));
      table.appendChild(row);
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
  /** Čísla, na kterých tabulka stojí. Změní se jednou za měsíc, ne za snímek. */
  private static signature(budget: Budget, funds: number): string {
    const parts: (string | number)[] = [
      funds,
      budget.income,
      budget.expenses,
      budget.valuePerUnit,
      budget.roads.count,
      budget.roads.upkeep,
      budget.transit.lines,
      budget.transit.vehicles,
      budget.transit.income,
      budget.transit.upkeep,
      budget.debt.loans,
      budget.debt.owed,
      budget.debt.payment,
    ];
    for (const line of budget.lines) {
      parts.push(
        line.definitionId,
        line.count,
        line.poweredCount,
        line.income,
        line.upkeep,
        // I rozpis pod řádkem: bez toho by se zastavil na číslech, se kterými
        // se tabulka kreslila naposledy.
        line.taxBase,
        line.taxRate ?? '-',
        line.upkeepCount,
        line.upkeepEach,
      );
    }
    return parts.join('|');
  }

  private describe(line: BudgetLine, valuePerUnit: number): string {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const parts: string[] = [];

    if (line.taxUnitKey !== null && line.taxRate !== null) {
      parts.push(
        t('ui.budget.formula.tax', {
          base: formatNumber(line.taxBase),
          unit: t(line.taxUnitKey),
          value: valuePerUnit,
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
