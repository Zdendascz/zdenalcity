import type { Ledger } from '@/sim/ledger';
import { ledgerTotal } from '@/sim/ledger';
import { button, el } from './dom';
import { formatNumber } from './format';
import { sheetHeader } from './icons';
import type { I18n } from './i18n';

/**
 * Celoroční vyúčtování.
 *
 * Zadání autora: „vždy 1. 1. každého roku vyskočí celoroční vyúčtování: levý
 * sloupec příjmy, prostřední výdaje, pravý výsledek, dole souhrn. Kompletně
 * přehled za celý rok."
 *
 * Je to **okno přes obrazovku**, ne řádek v rohu, a je to záměr: měsíční
 * bilance v liště říká, jak si město vede zrovna teď, a hráč si na ni zvykne
 * jako na tapetu. Roční uzávěrka je jediná chvíle, kdy se dá říct „stavěl jsi
 * za polovinu příjmu" — a to stojí za jedno zastavení.
 *
 * Panel **nic nepočítá**: čísla jsou tak, jak je zapsala účetní kniha, a ta je
 * jediná cesta, kterou ve hře tečou peníze (`sim/ledger.ts`).
 */
export interface YearReportCallbacks {
  /** Zavřít a hrát dál. */
  onClose(): void;
}

export class YearReport {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly i18n: I18n;
  private readonly callbacks: YearReportCallbacks;
  /** Rok, který se právě ukazuje. Podruhé se týž výkaz neotevře. */
  private shown: number | null = null;

  constructor(mount: HTMLElement, i18n: I18n, callbacks: YearReportCallbacks) {
    this.i18n = i18n;
    this.callbacks = callbacks;

    this.root = el('div', 'dialog__backdrop year is-hidden');
    this.panel = el('div', 'dialog year__panel');
    this.root.appendChild(this.panel);
    mount.appendChild(this.root);
  }

  isVisible(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  /** Tlačítko „Zavřít". Dostane fokus, jakmile se okno otevře. */
  private dismiss: HTMLButtonElement | null = null;

  /** Který rok už hráč viděl. Po loadu se tím výkaz nezopakuje. */
  markSeen(year: number): void {
    this.shown = year;
  }

  /**
   * Ukáže uzávěrku, pokud je nová.
   *
   * Vrací `true`, když se okno **teď otevřelo** — volající podle toho pauzne
   * hru. Zavřený rok, který hráč už viděl, vrací `false` a nic nedělá.
   */
  show(ledger: Ledger, funds: number): boolean {
    if (this.shown === ledger.year) return false;
    this.shown = ledger.year;
    this.draw(ledger, funds);
    this.root.classList.remove('is-hidden');
    this.dismiss?.focus();
    return true;
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  private draw(ledger: Ledger, funds: number): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    this.panel.replaceChildren();

    this.panel.appendChild(
      sheetHeader(
        t('ui.year.title', { year: ledger.year }),
        t('ui.common.close'),
        () => this.close(),
        { heading: 'h1', titleClass: 'dialog__title' },
      ),
    );

    const income = ledgerTotal(ledger.income);
    const expenses = ledgerTotal(ledger.expenses);
    const result = income - expenses;

    // Tři sloupce vedle sebe, přesně jak si autor vyžádal: příjmy, výdaje,
    // výsledek. Prázdná strana dostane hlášku, ne prázdné místo.
    const columns = el('div', 'year__columns');
    columns.appendChild(this.column(t('ui.year.income'), ledger.income, income, 'is-income'));
    columns.appendChild(this.column(t('ui.year.expenses'), ledger.expenses, expenses, 'is-expense'));

    const summary = el('div', 'year__column year__column--result');
    summary.appendChild(el('h2', 'year__heading', t('ui.year.result')));
    const big = el(
      'p',
      result < 0 ? 'year__result is-negative' : 'year__result',
      result < 0
        ? t('ui.year.deficit', { amount: formatNumber(-result) })
        : t('ui.year.surplus', { amount: formatNumber(result) }),
    );
    summary.appendChild(big);
    summary.appendChild(el('p', 'year__funds', t('ui.year.funds', { funds: formatNumber(funds) })));
    columns.appendChild(summary);
    this.panel.appendChild(columns);

    const actions = el('div', 'year__actions');
    const ok = button('chip chip--primary', () => this.close());
    ok.textContent = t('ui.year.close');
    actions.appendChild(ok);
    this.panel.appendChild(actions);
    // Ať jde okno zavřít enterem bez sahání po myši — stejně jako u hlášení
    // katastrofy. Do teď nebylo zaostřené nic, takže kdo měl ruce na
    // klávesnici, musel sáhnout po myši (T-revize, nález 26).
    this.dismiss = ok;
  }

  /** Jeden sloupec: položky shora dolů, součet na patě. */
  private column(
    title: string,
    side: Record<string, number>,
    total: number,
    tone: string,
  ): HTMLElement {
    const t = (key: string) => this.i18n.t(key);
    const column = el('div', 'year__column');
    column.appendChild(el('h2', 'year__heading', title));

    const rows = Object.entries(side).sort(([, a], [, b]) => b - a);
    if (rows.length === 0) {
      column.appendChild(el('p', 'sheet__note', t('ui.year.empty')));
    }
    for (const [key, amount] of rows) {
      const row = el('div', 'year__row');
      row.appendChild(el('span', 'year__name', t(`ui.ledger.${key}`)));
      row.appendChild(el('span', `year__amount ${tone}`, formatNumber(amount)));
      column.appendChild(row);
    }

    const sum = el('div', 'year__row year__row--total');
    sum.appendChild(el('span', 'year__name', t('ui.year.total')));
    sum.appendChild(el('span', `year__amount ${tone}`, formatNumber(total)));
    column.appendChild(sum);
    return column;
  }

  /** Zavře okno i s tím, co po něm následuje. Volá tlačítko i Escape. */
  close(): void {
    this.hide();
    this.callbacks.onClose();
  }
}
