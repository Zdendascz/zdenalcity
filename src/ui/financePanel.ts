import type { Balance } from '@/content/balance';
import type { Command } from '@/sim/commands';
import {
  bondCap,
  issueFee,
  loanCap,
  loanRate,
  loanTerms,
  subscriptionRate,
} from '@/sim/finance';
import type { WorldState } from '@/sim/world';
import { button, el } from './dom';
import { formatNumber } from './format';
import { iconSvg } from './icons';
import type { I18n } from './i18n';
import { closeOtherSheets, registerSheet } from './sheets';

/**
 * Půjčky a dluhopisy (§8 fáze 4).
 *
 * Simulace obojí uměla od T57 a T58, ale nevedlo k ní tlačítko — rozpočtový
 * panel řádky *dluh* a *dluhopisy* zobrazoval a hráč viděl čísla, která neměl
 * jak ovlivnit. Tenhle panel je ta chybějící cesta.
 *
 * **Nic se tu nepočítá znovu.** Strop, sazba, splátka i odhad úpisu se berou
 * z `sim/finance.ts` — z týchž funkcí, které pak příkaz vykoná. Panel, který
 * si vzorec opíše, začne dřív nebo později nabízet jinou splátku, než jakou
 * město zaplatí.
 *
 * Formulář se **nepřestavuje při každém snímku**, jen se v něm obnovují čísla:
 * hráč do něj píše částku a znovupostavené `<input>` by mu ji sebralo pod
 * rukama i s kurzorem.
 */

/** Rok má 360 tiků (§5). Splatnost dluhopisu zadává hráč v letech. */
const YEAR = 360;

/** Kolik čeho nabídnout, když hráč otevře prázdný formulář. */
const DEFAULT_TERM_MONTHS = 60;
const DEFAULT_MATURITY_YEARS = 5;

export class FinancePanel {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private readonly dispatch: (command: Command) => void;
  private visible = false;

  /** Postaveno až při prvním otevření — panel bez formuláře nemá co obnovovat. */
  private form: FinanceForm | null = null;

  constructor(parent: HTMLElement, i18n: I18n, dispatch: (command: Command) => void) {
    this.i18n = i18n;
    this.dispatch = dispatch;

    this.root = el('div', 'sheet sheet--finance is-hidden');
    parent.appendChild(this.root);
    registerSheet(this);

    // Změna jazyka přestaví formulář: popisky jsou v něm zapsané natvrdo od
    // chvíle, kdy vznikl. Zadané částky se tím ztratí, a je to v pořádku —
    // jazyk hráč nepřepíná uprostřed sjednávání půjčky.
    i18n.onChange(() => {
      this.form = null;
      this.root.replaceChildren();
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.classList.toggle('is-hidden', !this.visible);
    if (this.visible) closeOtherSheets(this);
    return this.visible;
  }

  hide(): void {
    this.visible = false;
    this.root.classList.add('is-hidden');
  }

  update(world: WorldState, balance: Balance): void {
    if (!this.visible) return;
    if (!this.form) this.form = this.build();
    this.refresh(this.form, world, balance);
  }

  /* ------------------------------------------------------------- stavba -- */

  private build(): FinanceForm {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);

    const header = el('div', 'sheet__header');
    header.appendChild(el('h2', 'sheet__title', t('ui.finance.title')));
    const close = button('chip chip--tight', () => this.toggle());
    close.appendChild(iconSvg('close'));
    header.appendChild(close);
    this.root.appendChild(header);

    const form: FinanceForm = {
      loanAmount: numberInput(),
      loanTerm: numberInput(),
      loanRate: el('span', 'finance__value'),
      loanCap: el('span', 'finance__value'),
      loanPreview: el('p', 'sheet__note'),
      loanButton: button('chip chip--primary', () => this.takeLoan()),
      loanTable: el('div', 'finance__list'),

      bondAmount: numberInput(),
      bondRate: numberInput(),
      bondMaturity: numberInput(),
      bondCap: el('span', 'finance__value'),
      bondPreview: el('p', 'sheet__note'),
      bondButton: button('chip chip--primary', () => this.issueBond()),
      bondTable: el('div', 'finance__list'),
    };

    form.loanTerm.value = String(DEFAULT_TERM_MONTHS);
    form.bondMaturity.value = String(DEFAULT_MATURITY_YEARS);

    /* --- půjčka --- */
    const loans = el('section', 'finance__section');
    loans.appendChild(el('h3', 'finance__heading', t('ui.finance.loans')));
    loans.appendChild(row(t('ui.finance.cap'), form.loanCap));
    loans.appendChild(row(t('ui.finance.rate'), form.loanRate));
    loans.appendChild(field(t('ui.finance.amount'), form.loanAmount));
    loans.appendChild(field(t('ui.finance.term'), form.loanTerm));
    loans.appendChild(form.loanPreview);

    form.loanButton.appendChild(iconSvg('loan-take'));
    form.loanButton.appendChild(el('span', undefined, t('ui.finance.take')));
    loans.appendChild(form.loanButton);
    loans.appendChild(form.loanTable);
    this.root.appendChild(loans);

    /* --- dluhopisy --- */
    const bonds = el('section', 'finance__section');
    bonds.appendChild(el('h3', 'finance__heading', t('ui.finance.bonds')));
    bonds.appendChild(row(t('ui.finance.cap'), form.bondCap));
    bonds.appendChild(field(t('ui.finance.amount'), form.bondAmount));
    bonds.appendChild(field(t('ui.finance.coupon'), form.bondRate));
    bonds.appendChild(field(t('ui.finance.maturity'), form.bondMaturity));
    bonds.appendChild(form.bondPreview);

    form.bondButton.appendChild(iconSvg('bond-issue'));
    form.bondButton.appendChild(el('span', undefined, t('ui.finance.issue')));
    bonds.appendChild(form.bondButton);
    bonds.appendChild(form.bondTable);
    this.root.appendChild(bonds);

    return form;
  }

  /* ------------------------------------------------------------ obnova --- */

  private refresh(form: FinanceForm, world: WorldState, balance: Balance): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const finance = balance.finance;

    /* --- půjčka --- */
    const cap = loanCap(world, balance);
    const rate = loanRate(world, balance);
    form.loanCap.textContent = formatNumber(cap);
    form.loanRate.textContent = t('ui.finance.percent', { value: rate.toFixed(1) });
    form.loanAmount.max = String(cap);
    form.loanTerm.min = String(finance.minTermMonths);
    form.loanTerm.max = String(finance.maxTermMonths);

    const amount = Math.floor(Number(form.loanAmount.value));
    const term = Math.floor(Number(form.loanTerm.value));
    const loanOk =
      Number.isFinite(amount) &&
      amount > 0 &&
      amount <= cap &&
      Number.isFinite(term) &&
      term >= finance.minTermMonths &&
      term <= finance.maxTermMonths &&
      world.loans.length < finance.maxLoans;

    if (loanOk) {
      const terms = loanTerms(amount, rate, term);
      form.loanPreview.textContent = t('ui.finance.loanPreview', {
        payment: formatNumber(terms.payment),
        total: formatNumber(terms.total),
        interest: formatNumber(terms.total - amount),
      });
    } else if (world.loans.length >= finance.maxLoans) {
      form.loanPreview.textContent = t('ui.finance.tooManyLoans', { max: finance.maxLoans });
    } else {
      form.loanPreview.textContent = t('ui.finance.loanHint', {
        cap: formatNumber(cap),
        min: finance.minTermMonths,
        max: finance.maxTermMonths,
      });
    }
    form.loanButton.disabled = !loanOk;

    this.fillLoans(form.loanTable, world);

    /* --- dluhopisy --- */
    const bonds = finance.bonds;
    const bondLimit = bondCap(world, balance);
    form.bondCap.textContent = formatNumber(bondLimit);
    form.bondAmount.max = String(bondLimit);
    form.bondRate.max = String(bonds.maxRate);
    form.bondMaturity.min = String(Math.round(bonds.minMaturityTicks / YEAR));
    form.bondMaturity.max = String(Math.round(bonds.maxMaturityTicks / YEAR));

    const offered = Math.floor(Number(form.bondAmount.value));
    const coupon = Number(form.bondRate.value);
    const years = Math.floor(Number(form.bondMaturity.value));
    const maturity = years * YEAR;
    const fee = offered > 0 ? issueFee(balance, offered) : 0;
    const blocked = world.tick < world.bondsBlockedUntil;

    const bondOk =
      !blocked &&
      Number.isFinite(offered) &&
      offered > 0 &&
      offered <= bondLimit &&
      Number.isFinite(coupon) &&
      coupon >= 0 &&
      coupon <= bonds.maxRate &&
      Number.isInteger(maturity) &&
      maturity >= bonds.minMaturityTicks &&
      maturity <= bonds.maxMaturityTicks &&
      world.economy.funds >= fee;

    if (blocked) {
      form.bondPreview.textContent = t('ui.finance.bondsBlocked', {
        years: Math.max(1, Math.ceil((world.bondsBlockedUntil - world.tick) / YEAR)),
      });
    } else if (bondOk) {
      // Odhad, ne slib: kolik se upíše, závisí i na tom, jak se ve městě žije
      // a jestli roste — a to se mezi otevřením panelu a klikem může změnit.
      const share = subscriptionRate(world, balance, coupon);
      form.bondPreview.textContent = t('ui.finance.bondPreview', {
        share: Math.round(share * 100),
        expected: formatNumber(Math.floor(offered * share)),
        fee: formatNumber(fee),
        coupon: formatNumber(Math.round((offered * coupon) / 100)),
      });
    } else if (offered > 0 && world.economy.funds < fee) {
      form.bondPreview.textContent = t('ui.finance.cannotAffordFee', { fee: formatNumber(fee) });
    } else {
      form.bondPreview.textContent = t('ui.finance.bondHint', {
        cap: formatNumber(bondLimit),
        rate: bonds.maxRate,
        min: Math.round(bonds.minMaturityTicks / YEAR),
        max: Math.round(bonds.maxMaturityTicks / YEAR),
      });
    }
    form.bondButton.disabled = !bondOk;

    this.fillBonds(form.bondTable, world);
  }

  /** Sjednané půjčky. Splatit dřív nejde, takže tu není co mačkat. */
  private fillLoans(target: HTMLElement, world: WorldState): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    target.replaceChildren();
    if (world.loans.length === 0) {
      target.appendChild(el('p', 'sheet__note', t('ui.finance.noLoans')));
      return;
    }

    for (const loan of world.loans) {
      target.appendChild(
        el(
          'p',
          'finance__row',
          t('ui.finance.loanRow', {
            principal: formatNumber(loan.principal),
            remaining: formatNumber(loan.remaining),
            payment: formatNumber(loan.payment),
            paid: loan.paidMonths,
            term: loan.termMonths,
          }),
        ),
      );
    }
  }

  private fillBonds(target: HTMLElement, world: WorldState): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    target.replaceChildren();
    if (world.bonds.length === 0) {
      target.appendChild(el('p', 'sheet__note', t('ui.finance.noBonds')));
      return;
    }

    for (const bond of world.bonds) {
      const row = el(
        'p',
        bond.defaulted ? 'finance__row is-negative' : 'finance__row',
        t(bond.defaulted ? 'ui.finance.bondDefaulted' : 'ui.finance.bondRow', {
          subscribed: formatNumber(bond.subscribed),
          offered: formatNumber(bond.offered),
          rate: bond.rate,
          years: Math.max(0, Math.round((bond.maturityTick - world.tick) / YEAR)),
        }),
      );
      target.appendChild(row);
    }
  }

  /* --------------------------------------------------------- odesílání --- */

  private takeLoan(): void {
    const form = this.form;
    if (!form) return;
    this.dispatch({
      type: 'take_loan',
      amount: Math.floor(Number(form.loanAmount.value)),
      termMonths: Math.floor(Number(form.loanTerm.value)),
    });
    // Částka se vymaže, doba zůstane: druhá půjčka bude jiná, ale doba
    // splácení je hráčův zvyk, ne vlastnost jedné transakce.
    form.loanAmount.value = '';
  }

  private issueBond(): void {
    const form = this.form;
    if (!form) return;
    this.dispatch({
      type: 'issue_bond',
      amount: Math.floor(Number(form.bondAmount.value)),
      rate: Number(form.bondRate.value),
      maturityTicks: Math.floor(Number(form.bondMaturity.value)) * YEAR,
    });
    form.bondAmount.value = '';
  }
}

interface FinanceForm {
  loanAmount: HTMLInputElement;
  loanTerm: HTMLInputElement;
  loanRate: HTMLElement;
  loanCap: HTMLElement;
  loanPreview: HTMLElement;
  loanButton: HTMLButtonElement;
  loanTable: HTMLElement;

  bondAmount: HTMLInputElement;
  bondRate: HTMLInputElement;
  bondMaturity: HTMLInputElement;
  bondCap: HTMLElement;
  bondPreview: HTMLElement;
  bondButton: HTMLButtonElement;
  bondTable: HTMLElement;
}

function numberInput(): HTMLInputElement {
  const node = el('input', 'finance__input');
  node.type = 'number';
  node.min = '0';
  node.step = '1';
  return node;
}

function row(label: string, value: HTMLElement): HTMLElement {
  const node = el('div', 'panel__row');
  node.appendChild(el('span', 'panel__label', label));
  node.appendChild(value);
  return node;
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  const node = el('label', 'panel__row');
  node.appendChild(el('span', 'panel__label', label));
  node.appendChild(input);
  return node;
}
