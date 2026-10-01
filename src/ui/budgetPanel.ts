import type { Definition } from '@/content/schema';
import type { Budget, BudgetLine } from '@/sim/systems/economy';
import { sheetHeader } from './icons';
import { el } from './dom';
import { formatMoney, formatNumber } from './format';
import type { I18n } from './i18n';
import { closeOtherSheets, registerSheet } from './sheets';

/** Kategorie, které vyrostou ze zóny samy. Hráč je nestaví ani nevybírá. */
const ZONE_CATEGORIES: readonly string[] = ['residential', 'commercial', 'industrial'];

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

    this.root.appendChild(sheetHeader(t('ui.budget.title'), t('ui.common.close'), () => this.toggle()));

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

    /*
     * Vypisují se **jen postavené druhy** (T-revize, nález 21).
     *
     * Panel dostával celý katalog, takže „Ekonomika" v začínajícím městě byla
     * tabulka o dvaasedmdesáti řádcích, z nichž devětašedesát mělo samé nuly —
     * a devětatřicet z nich byly zónové varianty, které hráč sám nikdy nestaví.
     * Co město nemá, se sečte do jedné věty pod tabulkou.
     */
    /*
     * A **zónové varianty se slévají do tří řádků** (nález 21).
     *
     * Devětatřicet ze dvaasedmdesáti definic jsou stupně obytné, obchodní a
     * průmyslové zástavby. Hráč je nestaví ani nevybírá — vyrostou samy podle
     * ceny půdy — takže mu jednotlivé řádky neříkají nic, co by mohl použít.
     * Co ho zajímá, je součet za zónu, a ten je tady.
     */
    const zoned = new Map<string, { count: number; income: number; upkeep: number }>();

    let shown = 0;
    for (const definition of this.definitions) {
      const line = counts.get(definition.id);
      if (!line || line.count === 0) continue;
      shown++;

      if (ZONE_CATEGORIES.includes(definition.category)) {
        const sum = zoned.get(definition.category) ?? { count: 0, income: 0, upkeep: 0 };
        sum.count += line.count;
        sum.income += line.income;
        sum.upkeep += line.upkeep;
        zoned.set(definition.category, sum);
        continue;
      }

      const income = line.income;
      const upkeep = line.upkeep;

      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t(definition.name)));
      row.appendChild(el('td', undefined, formatMoney(definition.construction.cost)));
      row.appendChild(el('td', undefined, formatNumber(line.count)));
      row.appendChild(el('td', undefined, `${line.poweredCount}/${line.count}`));
      row.appendChild(el('td', undefined, income === 0 ? '-' : `+${formatMoney(income)}`));
      row.appendChild(el('td', undefined, upkeep === 0 ? '-' : `−${formatMoney(upkeep)}`));

      const net = income - upkeep;
      const netCell = el('td', net < 0 ? 'is-negative' : undefined, formatMoney(net));
      row.appendChild(netCell);
      table.appendChild(row);

      // Pod řádkem rozpis, ze kterého je vidět, odkud se čísla vzala.
      const breakdown = this.describe(line, budget.valuePerUnit);
      if (breakdown) {
        const note = el('tr', 'sheet__breakdown');
        const cell = el('td', undefined, breakdown);
        cell.colSpan = 7;
        note.appendChild(cell);
        table.appendChild(note);
      }
    }

    for (const category of ZONE_CATEGORIES) {
      const sum = zoned.get(category);
      if (!sum) continue;
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t(`ui.budget.zone.${category}`)));
      // Cena za kus u slitého řádku neexistuje: každý stupeň stojí jinak.
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(sum.count)));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, sum.income === 0 ? '-' : `+${formatMoney(sum.income)}`));
      row.appendChild(el('td', undefined, sum.upkeep === 0 ? '-' : `−${formatMoney(sum.upkeep)}`));
      const net = sum.income - sum.upkeep;
      row.appendChild(el('td', net < 0 ? 'is-negative' : undefined, formatMoney(net)));
      table.appendChild(row);
    }

    // Silnice nejsou budova, ale platí se každý měsíc — vlastní řádek.
    if (budget.roads.count > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.roads')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.roads.count)));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, '-'));
      row.appendChild(el('td', undefined, `−${formatMoney(budget.roads.upkeep)}`));
      row.appendChild(el('td', 'is-negative', formatMoney(-budget.roads.upkeep)));
      table.appendChild(row);
    }

    // Vedení taky (T136): vysoké napětí je v údržbě znát.
    if (budget.wires.count > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.wires')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.wires.count)));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, '-'));
      row.appendChild(el('td', undefined, `−${formatMoney(budget.wires.upkeep)}`));
      row.appendChild(el('td', 'is-negative', formatMoney(-budget.wires.upkeep)));
      table.appendChild(row);
    }

    // MHD taky vlastní řádek: vozidlo není budova a jízdné není daň.
    if (budget.transit.lines > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.transit')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.transit.vehicles)));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, `+${formatMoney(budget.transit.income)}`));
      row.appendChild(el('td', undefined, `−${formatMoney(budget.transit.upkeep)}`));
      const net = budget.transit.income - budget.transit.upkeep;
      row.appendChild(el('td', net < 0 ? 'is-negative' : undefined, formatMoney(net)));
      table.appendChild(row);
    }

    // Splátky půjček. Nejsou údržba ničeho — je to cena za dřívější výpomoc.
    if (budget.debt.loans > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.debt')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.debt.loans)));
      // Čtvrtá buňka je „Pod proudem" a dluh do ní nepatří (T-revize, nález 7).
      // Zbytek dluhu se vypisuje samostatným řádkem pod tabulkou: je to jedno
      // z nejdůležitějších čísel a sedmisloupcová tabulka postavená na
      // budovách není tvar, do kterého se vejde.
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, '-'));
      row.appendChild(el('td', undefined, `−${formatMoney(budget.debt.payment)}`));
      row.appendChild(el('td', 'is-negative', formatMoney(-budget.debt.payment)));
      table.appendChild(row);
    }

    // Dluhopisy zvlášť od půjček: úrok se platí ročně a jistina naráz, takže
    // se to s měsíční splátkou nesčítá do jednoho čísla, které by nic neříkalo.
    if (budget.debt.bonds > 0) {
      const row = el('tr');
      row.appendChild(el('td', 'sheet__name', t('ui.budget.bonds')));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, formatNumber(budget.debt.bonds)));
      row.appendChild(el('td'));
      row.appendChild(el('td', undefined, '-'));
      row.appendChild(el('td', undefined, `−${formatMoney(budget.debt.bondPayment)}`));
      row.appendChild(el('td', 'is-negative', formatMoney(-budget.debt.bondPayment)));
      table.appendChild(row);
    }

    const total = el('tr', 'sheet__total');
    total.appendChild(el('td', 'sheet__name', t('ui.budget.total')));
    total.appendChild(el('td'));
    total.appendChild(el('td'));
    total.appendChild(el('td'));
    total.appendChild(el('td', undefined, `+${formatMoney(budget.income)}`));
    total.appendChild(el('td', undefined, `−${formatMoney(budget.expenses)}`));
    const net = budget.income - budget.expenses;
    total.appendChild(el('td', net < 0 ? 'is-negative' : undefined, formatMoney(net)));
    table.appendChild(total);

    this.root.appendChild(table);

    const owed = budget.debt.owed + budget.debt.bondOwed;
    if (owed > 0) {
      this.root.appendChild(
        el('p', 'sheet__note', t('ui.budget.owed', { owed: formatMoney(owed) })),
      );
    }

    // Kolik druhů staveb město nemá. Tabulka vypisuje **jen postavené**
    // (nález 21) a tenhle řádek říká, že katalog je delší.
    if (this.definitions.length > shown) {
      this.root.appendChild(
        el(
          'p',
          'sheet__note',
          t('ui.budget.notBuilt', { count: this.definitions.length - shown }),
        ),
      );
    }

    this.root.appendChild(
      el('p', 'sheet__note', t('ui.budget.funds', { funds: formatMoney(funds) })),
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
      budget.wires.count,
      budget.wires.upkeep,
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
          value: formatMoney(line.valuePerUnit || valuePerUnit),
          rate: line.taxRate,
          income: formatMoney(line.income),
        }),
      );
    }

    if (line.upkeepCount > 0) {
      parts.push(
        t('ui.budget.formula.upkeep', {
          count: line.upkeepCount,
          each: formatMoney(line.upkeepEach),
          total: formatMoney(line.upkeep),
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
