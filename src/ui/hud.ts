import type { ZoneType } from '@/sim/layers';
import { ZONE } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { totalJobs, totalPopulation } from '@/sim/world';
import { button, el } from './dom';
import type { I18n } from './i18n';

/** 1 tik = 1 den, 30 dní = měsíc, 12 měsíců = rok (§5). */
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;

export interface HudCallbacks {
  onSpeed(index: number): void;
  onTaxChange(zone: ZoneType, delta: number): void;
  onQuickSave(): void;
  onQuickLoad(): void;
  onDownload(): void;
  onOpenFile(file: File): void;
  onTogglePowerOverlay(): void;
  onLanguageChange(language: string): void;
}

export interface HudState {
  speedIndex: number;
  powerOverlay: boolean;
  poweredBuildings: number;
  /** Už přeložená hláška o uložení či načtení. Prázdná = nic nezobrazovat. */
  message: string;
}

const TAX_ROWS: readonly { zone: ZoneType; labelKey: string; category: 'residential' | 'commercial' | 'industrial' }[] = [
  { zone: ZONE.residential, labelKey: 'ui.tool.zone.residential', category: 'residential' },
  { zone: ZONE.commercial, labelKey: 'ui.tool.zone.commercial', category: 'commercial' },
  { zone: ZONE.industrial, labelKey: 'ui.tool.zone.industrial', category: 'industrial' },
];

const DEMAND_ROWS: readonly { labelKey: string; category: 'residential' | 'commercial' | 'industrial' }[] = [
  { labelKey: 'ui.demand.residential', category: 'residential' },
  { labelKey: 'ui.demand.commercial', category: 'commercial' },
  { labelKey: 'ui.demand.industrial', category: 'industrial' },
];

/**
 * Herní HUD. Veškerý text jde přes `i18n.t()` — v tomhle souboru není ani jedno
 * uživatelsky viditelné slovo (§10).
 */
export class Hud {
  /** Sem `app.ts` pověsí paletu nástrojů. */
  readonly toolsSlot: HTMLElement;

  private readonly i18n: I18n;
  private readonly view: ReadonlyWorldView;
  private readonly speeds: readonly number[];
  private readonly callbacks: HudCallbacks;

  private readonly top: HTMLElement;
  private readonly panels: HTMLElement;

  private readonly values = new Map<string, HTMLElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private powerButton: HTMLButtonElement | null = null;
  private messageNode: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private lastState: HudState = {
    speedIndex: 1,
    powerOverlay: false,
    poweredBuildings: 0,
    message: '',
  };

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    view: ReadonlyWorldView,
    speeds: readonly number[],
    callbacks: HudCallbacks,
  ) {
    this.i18n = i18n;
    this.view = view;
    this.speeds = speeds;
    this.callbacks = callbacks;

    this.top = el('div', 'hud__top');
    const bottom = el('div', 'hud__bottom');
    this.toolsSlot = el('div', 'hud__tools');
    this.panels = el('div', 'hud__panels');

    bottom.append(this.toolsSlot, this.panels);
    parent.append(this.top, bottom);

    this.build();
    i18n.onChange(() => {
      this.build();
      this.update(this.lastState);
    });
  }

  update(state: HudState): void {
    this.lastState = state;

    const { economy, demand, tick, buildings } = this.view;

    this.setValue('funds', formatNumber(economy.funds));
    this.setValue('population', formatNumber(totalPopulation(buildings)));
    this.setValue('jobs', formatNumber(totalJobs(buildings)));
    this.setValue(
      'balance',
      `+${formatNumber(economy.lastIncome)} / −${formatNumber(economy.lastExpenses)}`,
    );
    this.setValue('date', this.i18n.t('ui.hud.date', dateParts(tick)));
    this.setValue('powered', `${state.poweredBuildings}/${buildings.size}`);

    for (const row of DEMAND_ROWS) {
      const value = demand[row.category];
      const bar = this.values.get(`demand-bar-${row.category}`);
      const label = this.values.get(`demand-value-${row.category}`);
      if (label) label.textContent = String(value);
      if (bar) {
        // Poptávka je v <−100, 100>; sloupec roste nahoru pro kladnou, dolů pro zápornou.
        bar.style.height = `${Math.min(100, Math.abs(value))}%`;
        bar.classList.toggle('is-negative', value < 0);
      }
    }

    for (const row of TAX_ROWS) {
      this.setValue(`tax-${row.category}`, `${economy.taxRates[row.category]} %`);
    }

    this.speedButtons.forEach((node, index) => {
      node.classList.toggle('is-active', index === state.speedIndex);
    });
    this.powerButton?.classList.toggle('is-active', state.powerOverlay);

    if (this.messageNode) {
      this.messageNode.textContent = state.message;
      this.messageNode.classList.toggle('is-empty', state.message === '');
    }
  }

  private setValue(key: string, text: string): void {
    const node = this.values.get(key);
    if (node) node.textContent = text;
  }

  private build(): void {
    this.top.replaceChildren();
    this.panels.replaceChildren();
    this.values.clear();
    this.speedButtons.length = 0;

    this.buildStats();
    this.buildDemand();
    this.buildSpeed();
    this.buildTaxes();
    this.buildSave();
    this.buildMisc();
  }

  private buildStats(): void {
    const group = el('div', 'stats');
    for (const [key, labelKey] of [
      ['funds', 'ui.hud.funds'],
      ['population', 'ui.hud.population'],
      ['jobs', 'ui.hud.jobs'],
      ['powered', 'ui.hud.powered'],
      ['balance', 'ui.hud.balance'],
      // Popisek a hodnota mají vlastní klíče: `ui.hud.date` je celá věta s
      // parametry, jako popisek by se vypsala i se zástupnými symboly.
      ['date', 'ui.hud.dateLabel'],
    ] as const) {
      const stat = el('div', 'stat');
      stat.appendChild(el('span', 'stat__label', this.i18n.t(labelKey)));
      const value = el('span', 'stat__value', '-');
      stat.appendChild(value);
      this.values.set(key, value);
      group.appendChild(stat);
    }
    this.top.appendChild(group);
  }

  private buildDemand(): void {
    const panel = el('div', 'demand');
    panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.hud.demand')));

    const bars = el('div', 'demand__bars');
    for (const row of DEMAND_ROWS) {
      const column = el('div', `demand__column demand__column--${row.category}`);
      const track = el('div', 'demand__track');
      const bar = el('div', 'demand__bar');
      track.appendChild(bar);

      const value = el('span', 'demand__value', '0');
      column.append(track, el('span', 'demand__label', this.i18n.t(row.labelKey)), value);
      bars.appendChild(column);

      this.values.set(`demand-bar-${row.category}`, bar);
      this.values.set(`demand-value-${row.category}`, value);
    }

    panel.appendChild(bars);
    this.top.appendChild(panel);
  }

  private buildSpeed(): void {
    const panel = el('div', 'panel');
    panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.speed.label')));

    const row = el('div', 'panel__row');
    this.speeds.forEach((speed, index) => {
      const label = speed === 0 ? this.i18n.t('ui.speed.pause') : this.i18n.t('ui.speed.value', { speed });
      const node = button('chip', () => this.callbacks.onSpeed(index));
      node.textContent = label;
      row.appendChild(node);
      this.speedButtons.push(node);
    });

    panel.appendChild(row);
    this.panels.appendChild(panel);
  }

  private buildTaxes(): void {
    const panel = el('div', 'panel');
    panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.tax.title')));

    for (const row of TAX_ROWS) {
      const line = el('div', 'panel__row');
      line.appendChild(el('span', 'panel__label', this.i18n.t(row.labelKey)));

      const minus = button('chip chip--tight', () => this.callbacks.onTaxChange(row.zone, -1));
      minus.textContent = '−';
      minus.title = this.i18n.t('ui.tax.decrease');

      const value = el('span', 'panel__value', '-');
      this.values.set(`tax-${row.category}`, value);

      const plus = button('chip chip--tight', () => this.callbacks.onTaxChange(row.zone, 1));
      plus.textContent = '+';
      plus.title = this.i18n.t('ui.tax.increase');

      line.append(minus, value, plus);
      panel.appendChild(line);
    }

    this.panels.appendChild(panel);
  }

  private buildSave(): void {
    const panel = el('div', 'panel');
    panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.save.title')));

    const row = el('div', 'panel__row');
    const quickSave = button('chip', () => this.callbacks.onQuickSave());
    quickSave.textContent = this.i18n.t('ui.save.quicksave');
    const quickLoad = button('chip', () => this.callbacks.onQuickLoad());
    quickLoad.textContent = this.i18n.t('ui.save.quickload');
    row.append(quickSave, quickLoad);

    const fileRow = el('div', 'panel__row');
    const download = button('chip', () => this.callbacks.onDownload());
    download.textContent = this.i18n.t('ui.save.download');

    const input = el('input', 'is-hidden');
    input.type = 'file';
    input.accept = '.city';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.callbacks.onOpenFile(file);
      input.value = '';
    });
    this.fileInput = input;

    const open = button('chip', () => this.fileInput?.click());
    open.textContent = this.i18n.t('ui.save.open');
    fileRow.append(download, open, input);

    const message = el('div', 'panel__message is-empty');
    this.messageNode = message;

    panel.append(row, fileRow, message);
    this.panels.appendChild(panel);
  }

  private buildMisc(): void {
    const panel = el('div', 'panel');

    const power = button('chip', () => this.callbacks.onTogglePowerOverlay());
    power.textContent = this.i18n.t('ui.overlay.power');
    this.powerButton = power;

    const languageRow = el('div', 'panel__row');
    languageRow.appendChild(el('span', 'panel__label', this.i18n.t('ui.language.label')));

    const select = el('select', 'select');
    for (const language of this.i18n.getLanguages()) {
      const option = el('option');
      option.value = language;
      option.textContent = language;
      option.selected = language === this.i18n.getLanguage();
      select.appendChild(option);
    }
    select.addEventListener('change', () => this.callbacks.onLanguageChange(select.value));
    languageRow.appendChild(select);

    panel.append(power, languageRow);
    this.panels.appendChild(panel);
  }
}

export function dateParts(tick: number): { year: number; month: number; day: number } {
  return {
    year: Math.floor(tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR)) + 1,
    month: (Math.floor(tick / DAYS_PER_MONTH) % MONTHS_PER_YEAR) + 1,
    day: (tick % DAYS_PER_MONTH) + 1,
  };
}

function formatNumber(value: number): string {
  // Oddělovač tisíců je úzká mezera — funguje v češtině i angličtině.
  return value.toLocaleString('cs-CZ').replace(/\s/g, ' ');
}
