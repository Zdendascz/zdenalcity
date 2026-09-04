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
  /** Uloží snímek herní plochy jako PNG. */
  onScreenshot(): void;
  onQuickLoad(): void;
  onDownload(): void;
  onOpenFile(file: File): void;
  /** Vrstva se přepíná: druhé kliknutí na tutéž ji zhasne. */
  onToggleLayer(id: string): void;
  /** Pohled se nastavuje: povrch a podzemí jsou dva stavy, ne přepínač. */
  onSetView(id: string): void;
  onToggleBudget(): void;
  /** Půjčky a dluhopisy (§8 fáze 4). */
  onToggleFinance(): void;
  /** Linky MHD (§7 fáze 4). */
  onToggleTransit(): void;
  /** Zprůhlednit budovy, aby šlo vidět a klikat na to pod nimi. */
  onToggleGhost(): void;
  /**
   * Klik na ikonu běžící katastrofy u hodin.
   *
   * Otevře **tutéž kartu, která se ukázala při vzniku**. Autor si to vyžádal
   * a je to jediná cesta zpátky k té zprávě: kdo ji jednou zavřel, neměl jak
   * si přečíst, co se vlastně děje, ani kde.
   */
  onDisasterClick(kind: string, x: number, y: number): void;
  onToggleDecor(): void;
  onFundingChange(serviceClass: string, funding: number): void;
  onLanguageChange(language: string): void;
  /**
   * Ruční spuštění katastrofy z menu (§6 fáze 4).
   *
   * Nepodléhá ani hájení, ani přepínači z R18 — je to zároveň jediný rozumný
   * způsob, jak katastrofy ladit.
   */
  onArmDisaster(kind: string): void;
  /**
   * Zapnout či vypnout náhodné katastrofy **za běhu**.
   *
   * Do T69 to šlo jen při zakládání města, přestože save si stav poctivě nese
   * (T59) — hráč, kterého pohromy přestaly bavit uprostřed města, neměl co
   * dělat. Ruční spuštění z nabídky přepínač neřeší, to je věc ladění.
   */
  onToggleDisasters(): void;
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
  financeVisible: boolean;
  transitVisible: boolean;
  /** Spouští hra náhodné katastrofy? */
  disastersEnabled: boolean;
  /** Jsou budovy průhledné? */
  ghost: boolean;
  /** Kreslí se stromy a balvany? */
  decor: boolean;
  poweredBuildings: number;
  /** Kolik proudu město vyrábí a kolik ho potřebuje. */
  powerProduced: number;
  powerNeeded: number;
  /** Financování podle třídy služby, 0–1. */
  funding: ReadonlyMap<string, number>;
  /** Už přeložená hláška o uložení či načtení. Prázdná = nic nezobrazovat. */
  message: string;
}

/** Běžící pohroma tak, jak ji HUD potřebuje: ikona a místo, kam skočit. */
export interface HudDisaster {
  readonly id: number;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
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
  private financeButton: HTMLButtonElement | null = null;
  private transitButton: HTMLButtonElement | null = null;
  private disasterMenu: Menu | null = null;
  /** Se kterým stavem je nabídka katastrof postavená. `null` = ještě s žádným. */
  private disastersShown: boolean | null = null;
  private ghostButton: HTMLButtonElement | null = null;
  private decorButton: HTMLButtonElement | null = null;
  private messageNode: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private readonly views: readonly OverlayOption[];
  private readonly layers: readonly OverlayOption[];
  private readonly serviceClasses: readonly string[];
  /** Druhy katastrof, které umí registr spustit. Prázdné = menu se neukáže. */
  private readonly disasters: readonly string[];
  /** Ikony běžících pohrom u hodin. */
  private disasterBadges: HTMLElement | null = null;
  /** Podle čeho se pozná, že se řada ikon musí přestavět. */
  private badgeKey = '';
  private readonly fundingInputs = new Map<string, HTMLInputElement>();
  private lastState: HudState = {
    speedIndex: 1,
    layer: 'none',
    view: 'surface',
    budgetVisible: false,
    financeVisible: false,
    transitVisible: false,
    disastersEnabled: true,
    ghost: false,
    decor: true,
    poweredBuildings: 0,
    powerProduced: 0,
    powerNeeded: 0,
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
    disasters: readonly string[],
    callbacks: HudCallbacks,
  ) {
    this.i18n = i18n;
    this.view = view;
    this.speeds = speeds;
    this.views = views;
    this.layers = layers;
    this.serviceClasses = serviceClasses;
    this.disasters = disasters;
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

    const population = totalPopulation(buildings);

    this.setValue('funds', formatNumber(economy.funds));
    this.values.get('funds')?.classList.toggle('is-alarm', economy.funds < 0);
    this.setValue('population', formatNumber(population));
    this.setValue('jobs', formatNumber(totalJobs(buildings)));
    // Spokojenost se ukazuje v procentech, ne v 0–255: hráč nemá důvod vědět,
    // že vrstva je bajtová.
    //
    // A dokud ve městě nikdo nebydlí, není **co** měřit. Nula tam znamenala
    // „všichni jsou nešťastní" a hráč sháněl, čím ji zvednout, i když jediný
    // problém bylo, že se do města nikdo nenastěhoval.
    this.setValue(
      'happiness',
      population === 0 ? '–' : `${Math.round((averageHappiness(this.view) / 255) * 100)} %`,
    );
    this.setValue(
      'balance',
      `+${formatNumber(economy.lastIncome)} / −${formatNumber(economy.lastExpenses)}`,
    );
    this.setValue('date', this.i18n.t('ui.hud.date', dateParts(tick)));
    this.syncDisasters();
    // Zlomek sám o sobě neřekne, co s tím: „65/86" může znamenat chybějící
    // vedení i chybějící elektrárnu. Čísla vedle sebe to rozhodnou.
    this.setValue('powered', `${state.poweredBuildings}/${buildings.size}`);
    this.setValue('power', `${formatNumber(state.powerProduced)} / ${formatNumber(state.powerNeeded)}`);
    this.values
      .get('power')
      ?.classList.toggle('is-alarm', state.powerNeeded > state.powerProduced);

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
    this.layerMenu?.setSelected(state.layer);
    this.budgetButton?.classList.toggle('is-active', state.budgetVisible);
    this.financeButton?.classList.toggle('is-active', state.financeVisible);
    this.transitButton?.classList.toggle('is-active', state.transitVisible);
    this.ghostButton?.classList.toggle('is-active', state.ghost);
    // Aktivní je tlačítko, když jsou stromy **schované** — svítí to, co hráč
    // zapnul, ne výchozí stav.
    this.decorButton?.classList.toggle('is-active', !state.decor);

    // Text přepínače závisí na stavu, který HUD sám nedrží — přijde ve `state`.
    if (state.disastersEnabled !== this.disastersShown) {
      this.disastersShown = state.disastersEnabled;
      this.setDisasterItems(state.disastersEnabled);
    }

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

    // Rychlost patří **nahoru za datum**, ne dolů mezi ovládání: mění se
    // často a hráč ji hledá u času, ne u nástrojů. Rozhodnutí autora.
    // Statistiky a rychlost proto sedí v jednom shluku vlevo, poptávka vpravo.
    const left = el('div', 'hud__top-left');
    this.top.appendChild(left);
    this.buildStats(left);
    // Ikony běžících pohrom **hned za datem**: patří k času („jak dlouho to
    // ještě potrvá") a hráč je má vidět bez otevírání čehokoli. Rozhodnutí
    // autora poté, co si zavřel hlášení a neměl se jak vrátit k tomu, co se
    // vlastně děje.
    this.disasterBadges = el('div', 'hud__disasters');
    left.appendChild(this.disasterBadges);
    this.badgeKey = '';
    this.buildSpeed(left);
    this.buildDemand();

    this.buildViews();
    this.buildGhost();
    this.buildDecor();
    this.buildLayers();
    this.buildDisasters();
    this.buildTaxes();
    this.buildFunding();
    this.buildBudget();
    this.buildSave();
    this.buildLanguage();
    this.buildMessage();
  }

  /**
   * Srovná ikony běžících pohrom se skutečností.
   *
   * Přestavuje se **jen když se řada změnila**, ne každý snímek: jinak by se
   * tlačítko pod kurzorem každých šestnáct milisekund vyhodilo a nahradilo
   * novým, takže by nešlo kliknout.
   *
   * Souběh je normální stav, ne výjimka — hoří a zároveň stávkuje se běžně,
   * proto je to řada a ne jedna ikona.
   */
  private syncDisasters(): void {
    const badges = this.disasterBadges;
    if (!badges) return;

    const active = this.view.disasters.active.filter((disaster) => !disaster.finished);
    const key = active.map((disaster) => `${disaster.id}:${disaster.kind}`).join(',');
    if (key === this.badgeKey) return;
    this.badgeKey = key;

    badges.replaceChildren();
    for (const disaster of active) {
      const name = this.i18n.t(`ui.disaster.${disaster.kind}`);
      const node = button('hud__disaster', () =>
        this.callbacks.onDisasterClick(disaster.kind, disaster.x, disaster.y),
      );
      node.title = name;
      node.setAttribute('aria-label', name);
      node.appendChild(iconSvg(disaster.kind));
      badges.appendChild(node);
    }
  }

  private buildStats(parent: HTMLElement): void {
    const group = el('div', 'stats');
    for (const [key, labelKey] of [
      ['funds', 'ui.hud.funds'],
      ['population', 'ui.hud.population'],
      ['jobs', 'ui.hud.jobs'],
      ['happiness', 'ui.hud.happiness'],
      ['powered', 'ui.hud.powered'],
      ['power', 'ui.hud.power'],
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
    parent.appendChild(group);
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

  /**
   * Rychlost běhu času. Stojí **nahoře za datem**, ne dole mezi nástroji:
   * patří k času, se kterým se čte, a mění se ze všech ovládacích prvků
   * nejčastěji.
   */
  private buildSpeed(parent: HTMLElement): void {
    const group = el('div', 'segmented');
    this.speeds.forEach((speed, index) => {
      const label = speed === 0 ? this.i18n.t('ui.speed.pause') : this.i18n.t('ui.speed.value', { speed });
      const node = button('segmented__button segmented__button--icon', () =>
        this.callbacks.onSpeed(index),
      );
      // Pauza má vlastní ikonu, ostatní stupně se liší počtem šipek. Když
      // obrázek chybí, spadne to zpátky na text — rychlost musí jít přepnout
      // i bez grafiky.
      const icon = speed === 0 ? 'speed-pause' : `speed-${speed}`;
      const drawn = iconSvg(icon);
      if (drawn.tagName === 'IMG') node.appendChild(drawn);
      else node.textContent = label;
      node.title = `${this.i18n.t('ui.speed.label')}: ${label}`;
      node.setAttribute('aria-label', label);
      group.appendChild(node);
      this.speedButtons.push(node);
    });
    parent.appendChild(group);
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

  /**
   * Průhlednost budov. Sedí vedle pohledů, protože je to totéž zrnem: mění se
   * jím, co je vidět, ne co se ve městě děje.
   */
  private buildGhost(): void {
    const label = this.i18n.t('ui.view.ghost');
    const node = button('toolbar__button', () => this.callbacks.onToggleGhost());
    node.appendChild(iconSvg('view-ghost'));
    node.title = label;
    node.setAttribute('aria-label', label);
    this.ghostButton = node;
    this.controls.appendChild(node);
  }

  /**
   * Vypnutí stromů a balvanů. Vedle průhlednosti budov, protože je to totéž
   * zrnem: mění se jím, co je vidět, ne co se ve městě děje.
   */
  private buildDecor(): void {
    const label = this.i18n.t('ui.view.decor');
    const node = button('toolbar__button', () => this.callbacks.onToggleDecor());
    node.appendChild(iconSvg('view-decor'));
    node.title = label;
    node.setAttribute('aria-label', label);
    this.decorButton = node;
    this.controls.appendChild(node);
  }

  private buildLayers(): void {
    const menu = new Menu({
      icon: 'layers',
      label: this.i18n.t('ui.overlay.title'),
      lockIcon: true,
      neutralId: 'none',
    });
    menu.setItems([
      // „Žádná" je první položka, ne skrytý trik. Vypnout vrstvu druhým
      // kliknutím na tutéž položku sice jde, ale hráč to nemá jak uhodnout.
      {
        id: 'none',
        label: this.i18n.t('ui.overlay.none'),
        icon: 'layer-none',
        onSelect: () => this.callbacks.onToggleLayer('none'),
      },
      ...this.layers.map((layer) => ({
        id: layer.id,
        label: this.i18n.t(layer.labelKey),
        icon: layer.icon,
        onSelect: () => this.callbacks.onToggleLayer(layer.id),
      })),
    ]);
    this.layerMenu = menu;
    this.controls.appendChild(menu.root);
  }

  /**
   * Menu katastrof.
   *
   * Seznam si bere z registru, takže roste, jak přibývají pohromy (T48–T54).
   * **Prázdný registr znamená žádné tlačítko** — po T47 je kostra hotová, ale
   * spustit ještě není co a prázdná roletka by jen mátla.
   */
  private buildDisasters(): void {
    if (this.disasters.length === 0) return;

    const menu = new Menu({
      icon: 'disasters',
      label: this.i18n.t('ui.disaster.title'),
      lockIcon: true,
      className: 'popover--alarm',
    });
    this.disasterMenu = menu;
    this.setDisasterItems(this.lastState.disastersEnabled);
    this.controls.appendChild(menu.root);
  }

  /**
   * Položky nabídky katastrof: nahoře přepínač, pod ním ruční spuštění.
   *
   * Přepínač je **první**, protože je to jediná položka, kterou hráč zmáčkne
   * kvůli hraní — zbytek je ladicí nářadí. Text se mění podle stavu, takže se
   * seznam při přepnutí staví znovu; položek je patnáct, ne patnáct set.
   */
  private setDisasterItems(enabled: boolean): void {
    this.disasterMenu?.setItems([
      {
        id: 'toggle',
        label: this.i18n.t(enabled ? 'ui.disaster.turnOff' : 'ui.disaster.turnOn'),
        icon: 'disasters-toggle',
        onSelect: () => this.callbacks.onToggleDisasters(),
      },
      ...this.disasters.map((kind) => ({
        id: kind,
        label: this.i18n.t(`ui.disaster.${kind}`),
        icon: kind,
        onSelect: () => this.callbacks.onArmDisaster(kind),
      })),
    ]);
  }

  private buildTaxes(): void {
    const popover = new Popover({ icon: 'taxes', label: this.i18n.t('ui.tax.title') });
    popover.panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.tax.title')));

    for (const row of TAX_ROWS) {
      const line = el('div', 'panel__row');
      line.appendChild(el('span', 'panel__label', this.i18n.t(row.labelKey)));

      const minus = button('chip chip--tight', () => this.callbacks.onTaxChange(row.zone, -1));
      minus.appendChild(iconSvg('tax-decrease'));
      minus.title = this.i18n.t('ui.tax.decrease');

      const value = el('span', 'panel__value', '-');
      this.values.set(`tax-${row.category}`, value);

      const plus = button('chip chip--tight', () => this.callbacks.onTaxChange(row.zone, 1));
      plus.appendChild(iconSvg('tax-increase'));
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

    const popover = new Popover({ icon: 'funding', label: this.i18n.t('ui.funding.title') });
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
    this.budgetButton = this.panelButton('budget', 'ui.budget.toggle', () =>
      this.callbacks.onToggleBudget(),
    );
    this.financeButton = this.panelButton('loan-take', 'ui.finance.toggle', () =>
      this.callbacks.onToggleFinance(),
    );
    this.transitButton = this.panelButton('transit_stop', 'ui.transit.toggle', () =>
      this.callbacks.onToggleTransit(),
    );
  }

  /** Tlačítko, které jen otevírá a zavírá panel. */
  private panelButton(icon: string, labelKey: string, onClick: () => void): HTMLButtonElement {
    const label = this.i18n.t(labelKey);
    const node = button('toolbar__button', onClick);
    node.appendChild(iconSvg(icon));
    node.title = label;
    node.setAttribute('aria-label', label);
    this.controls.appendChild(node);
    return node;
  }

  private buildSave(): void {
    const popover = new Popover({ icon: 'save', label: this.i18n.t('ui.save.title') });
    popover.panel.appendChild(el('span', 'panel__title', this.i18n.t('ui.save.title')));

    const row = el('div', 'panel__row');
    const quickSave = button('chip', () => this.callbacks.onQuickSave());
    quickSave.append(iconSvg('quicksave'), this.i18n.t('ui.save.quicksave'));
    const quickLoad = button('chip', () => this.callbacks.onQuickLoad());
    quickLoad.append(iconSvg('quickload'), this.i18n.t('ui.save.quickload'));
    row.append(quickSave, quickLoad);

    const fileRow = el('div', 'panel__row');
    const download = button('chip', () => this.callbacks.onDownload());
    download.append(iconSvg('download'), this.i18n.t('ui.save.download'));

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
    open.append(iconSvg('open-file'), this.i18n.t('ui.save.open'));
    fileRow.append(download, open, input);

    // Snímek patří sem, protože je to taky „vem, co je na obrazovce, a dej mi
    // z toho soubor". Jen to není save, tak má vlastní řádek.
    const shotRow = el('div', 'panel__row');
    const shot = button('chip', () => this.callbacks.onScreenshot());
    shot.append(iconSvg('screenshot'), this.i18n.t('ui.save.screenshot'));
    shotRow.appendChild(shot);

    popover.panel.append(row, fileRow, shotRow);
    this.controls.appendChild(popover.root);
  }

  private buildLanguage(): void {
    const popover = new Popover({ icon: 'language', label: this.i18n.t('ui.language.label') });
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
