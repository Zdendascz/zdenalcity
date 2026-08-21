import type { ZoneType } from '@/sim/layers';
import { ZONE } from '@/sim/layers';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { averageHappiness } from '@/sim/systems/happiness';
import { totalJobs, totalPopulation } from '@/sim/world';
import { button, el } from './dom';
import { formatNumber } from './format';
import { iconSvg } from './icons';
import type { I18n } from './i18n';
import { Menu, Popover } from './popover';

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
  /** Vrstva se přepíná: druhé kliknutí na tutéž ji zhasne. */
  onToggleLayer(id: string): void;
  /** Pohled se nastavuje: povrch a podzemí jsou dva stavy, ne přepínač. */
  onSetView(id: string): void;
  onToggleBudget(): void;
  onFundingChange(serviceClass: string, funding: number): void;
  onLanguageChange(language: string): void;
}

/** Položka nabídky pohledů nebo vrstev. Popisek je lokalizační klíč. */
export interface OverlayOption {
  id: string;
  labelKey: string;
  icon: string;
}

export interface HudState {
  speedIndex: number;
  /** Id zapnuté diagnostické vrstvy, nebo `'none'`. */
  layer: string;
  /** `'surface'` nebo `'underground'`. */
  view: string;
  budgetVisible: boolean;
  poweredBuildings: number;
  /** Financování podle třídy služby, 0–1. */
  funding: ReadonlyMap<string, number>;
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
 * Herní HUD.
 *
 * Pravidlo celého rozhraní: **na obrazovce je vidět jen to, co hráč sleduje
 * průběžně** — kasa, obyvatelé, spokojenost, poptávka, rychlost. Všechno
 * ostatní čeká za ikonou. Daně, financování, uložení i rozpočet jsou věci,
 * ke kterým se hráč vrací jednou za čas, a nemají důvod trvale ukrajovat mapu.
 *
 * Veškerý text jde přes `i18n.t()` — v tomhle souboru není ani jedno
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
  private readonly controls: HTMLElement;

  private readonly values = new Map<string, HTMLElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly viewButtons = new Map<string, HTMLButtonElement>();
  private layerMenu: Menu | null = null;
  private budgetButton: HTMLButtonElement | null = null;
  private messageNode: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private readonly views: readonly OverlayOption[];
  private readonly layers: readonly OverlayOption[];
  private readonly serviceClasses: readonly string[];
  private readonly fundingInputs = new Map<string, HTMLInputElement>();
  private lastState: HudState = {
    speedIndex: 1,
    layer: 'none',
    view: 'surface',
    budgetVisible: false,
    poweredBuildings: 0,
    funding: new Map(),
    message: '',
  };

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    view: ReadonlyWorldView,
    speeds: readonly number[],
    views: readonly OverlayOption[],
    layers: readonly OverlayOption[],
    serviceClasses: readonly string[],
    callbacks: HudCallbacks,
  ) {
    this.i18n = i18n;
    this.view = view;
    this.speeds = speeds;
    this.views = views;
    this.layers = layers;
    this.serviceClasses = serviceClasses;
    this.callbacks = callbacks;

    this.top = el('div', 'hud__top');
    const bottom = el('div', 'hud__bottom');
    this.toolsSlot = el('div', 'hud__tools');
    this.controls = el('div', 'hud__controls');

    bottom.append(this.toolsSlot, this.controls);
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
    // Spokojenost se ukazuje v procentech, ne v 0–255: hráč nemá důvod vědět,
    // že vrstva je bajtová.
    this.setValue('happiness', `${Math.round((averageHappiness(this.view) / 255) * 100)} %`);
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
    for (const [serviceClass, input] of this.fundingInputs) {
      const percent = Math.round((state.funding.get(serviceClass) ?? 1) * 100);
      // Posuvník se nepřepisuje, když s ním hráč zrovna hýbe.
      if (document.activeElement !== input) input.value = String(percent);
      this.setValue(`funding-${serviceClass}`, `${percent} %`);
    }

    for (const [id, node] of this.viewButtons) {
      node.classList.toggle('is-active', id === state.view);
    }
    this.layerMenu?.setSelected(state.layer === 'none' ? null : state.layer);
    this.budgetButton?.classList.toggle('is-active', state.budgetVisible);

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
    this.controls.replaceChildren();
    this.values.clear();
    this.speedButtons.length = 0;
    this.viewButtons.clear();
    this.fundingInputs.clear();

    this.buildStats();
    this.buildDemand();

    this.buildSpeed();
    this.buildViews();
    this.buildLayers();
    this.buildTaxes();
    this.buildFunding();
    this.buildBudget();
    this.buildSave();
    this.buildLanguage();
    this.buildMessage();
  }

  private buildStats(): void {
    const group = el('div', 'stats');
    for (const [key, labelKey] of [
      ['funds', 'ui.hud.funds'],
      ['population', 'ui.hud.population'],
      ['jobs', 'ui.hud.jobs'],
      ['happiness', 'ui.hud.happiness'],
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

    const bars = el('div', 'demand__bars');
    for (const row of DEMAND_ROWS) {
      const column = el('div', `demand__column demand__column--${row.category}`);
      const track = el('div', 'demand__track');
      const bar = el('div', 'demand__bar');
      track.appendChild(bar);

      const value = el('span', 'demand__value', '0');
      column.append(track, el('span', 'demand__label', this.i18n.t(row.labelKey)), value);
      column.title = `${this.i18n.t('ui.hud.demand')}: ${this.i18n.t(row.labelKey)}`;
      bars.appendChild(column);

      this.values.set(`demand-bar-${row.category}`, bar);
      this.values.set(`demand-value-${row.category}`, value);
    }

    panel.appendChild(bars);
    this.top.appendChild(panel);
  }

  /** Rychlost je jediná věc z ovládání, která je pořád vidět — mění se často. */
  private buildSpeed(): void {
    const group = el('div', 'segmented');
    this.speeds.forEach((speed, index) => {
      const label = speed === 0 ? this.i18n.t('ui.speed.pause') : this.i18n.t('ui.speed.value', { speed });
      const node = button('segmented__button', () => this.callbacks.onSpeed(index));
      node.textContent = label;
      node.title = `${this.i18n.t('ui.speed.label')}: ${label}`;
      group.appendChild(node);
      this.speedButtons.push(node);
    });
    this.controls.appendChild(group);
  }

  /**
   * Povrch a podzemí. **Není to overlay**, je to jiný pohled na svět: mění se
   * v něm i to, co dělá stavební nástroj a buldozer (§8 fáze 3). Proto stojí
   * zvlášť a ne v seznamu diagnostických vrstev, kam to dřív bylo naskládané.
   */
  private buildViews(): void {
    const group = el('div', 'segmented');
    for (const view of this.views) {
      const label = this.i18n.t(view.labelKey);
      const node = button('segmented__button segmented__button--icon', () =>
        this.callbacks.onSetView(view.id),
      );
      node.appendChild(iconSvg(view.icon));
      node.title = label;
      node.setAttribute('aria-label', label);
      group.appendChild(node);
      this.viewButtons.set(view.id, node);
    }
    this.controls.appendChild(group);
  }

  private buildLayers(): void {
    const menu = new Menu({ icon: 'layers', label: this.i18n.t('ui.overlay.title') });
    menu.setItems(
      this.layers.map((layer) => ({
        id: layer.id,
        label: this.i18n.t(layer.labelKey),
        icon: layer.icon,
        onSelect: () => this.callbacks.onToggleLayer(layer.id),
      })),
    );
    this.layerMenu = menu;
    this.controls.appendChild(menu.root);
  }

  private buildTaxes(): void {
    const popover = new Popover({ icon: 'coins', label: this.i18n.t('ui.tax.title') });
    popover.panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.tax.title')));

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
      popover.panel.appendChild(line);
    }

    this.controls.appendChild(popover.root);
  }

  /**
   * Financování služeb. Posuvník mění dosah, sílu i údržbu naráz, takže hráč
   * na overlayi hned vidí, na čem šetří.
   */
  private buildFunding(): void {
    if (this.serviceClasses.length === 0) return;

    const popover = new Popover({ icon: 'sliders', label: this.i18n.t('ui.funding.title') });
    popover.panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.funding.title')));

    for (const serviceClass of this.serviceClasses) {
      const row = el('div', 'panel__row');
      row.appendChild(el('span', 'panel__label', this.i18n.t(`ui.service.${serviceClass}`)));

      const slider = el('input', 'slider');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.step = '5';
      slider.value = '100';
      slider.addEventListener('input', () => {
        this.callbacks.onFundingChange(serviceClass, Number(slider.value) / 100);
      });
      this.fundingInputs.set(serviceClass, slider);

      const value = el('span', 'panel__value', '100 %');
      this.values.set(`funding-${serviceClass}`, value);

      row.append(slider, value);
      popover.panel.appendChild(row);
    }

    this.controls.appendChild(popover.root);
  }

  private buildBudget(): void {
    const label = this.i18n.t('ui.budget.toggle');
    const node = button('toolbar__button', () => this.callbacks.onToggleBudget());
    node.appendChild(iconSvg('chart'));
    node.title = label;
    node.setAttribute('aria-label', label);
    this.budgetButton = node;
    this.controls.appendChild(node);
  }

  private buildSave(): void {
    const popover = new Popover({ icon: 'save', label: this.i18n.t('ui.save.title') });
    popover.panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.save.title')));

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

    popover.panel.append(row, fileRow);
    this.controls.appendChild(popover.root);
  }

  private buildLanguage(): void {
    const popover = new Popover({ icon: 'globe', label: this.i18n.t('ui.language.label') });
    popover.panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.language.label')));

    for (const language of this.i18n.getLanguages()) {
      const node = button('chip', () => this.callbacks.onLanguageChange(language));
      node.textContent = language;
      node.classList.toggle('is-active', language === this.i18n.getLanguage());
      popover.panel.appendChild(node);
    }

    this.controls.appendChild(popover.root);
  }

  /**
   * Hláška o uložení. Visí nad lištou, ne v panelu uložení — ten je teď
   * zavřený a hráč by se o výsledku nedozvěděl.
   */
  private buildMessage(): void {
    const message = el('div', 'hud__message is-empty');
    this.messageNode = message;
    this.controls.appendChild(message);
  }
}

export function dateParts(tick: number): { year: number; month: number; day: number } {
  return {
    year: Math.floor(tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR)) + 1,
    month: (Math.floor(tick / DAYS_PER_MONTH) % MONTHS_PER_YEAR) + 1,
    day: (tick % DAYS_PER_MONTH) + 1,
  };
}
