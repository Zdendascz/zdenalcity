import type { ZoneType } from '@/sim/layers';
import { ZONE } from '@/sim/layers';
import { EXPLAINED_STATS } from '@/sim/statBreakdown';
import { disasterProgress, tollOf } from '@/sim/disasters/state';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { averageHappiness } from '@/sim/systems/happiness';
import type { DemandBreakdown } from '@/sim/diagnostics';
import { totalJobs, totalPopulation } from '@/sim/world';
import { button, el } from './dom';
import { formatNumber } from './format';
import { iconSvg } from './icons';
import type { I18n } from './i18n';
import type { LayoutMode } from './layout';
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
  onToggleAdvisor(): void;
  /** Hráč klikl na číslo v liště a chce vědět, z čeho je. */
  onStatClick(key: string): void;
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
  onDisasterClick(kind: string, x: number, y: number, dead: number): void;
  onToggleDecor(): void;
  /**
   * Zapnout či vypnout čtvercovou síť po hranicích dlaždic.
   *
   * **Pohledem to nehýbe.** Autor si to vyžádal doslova: kdo si síť zapne pod
   * zemí, musí pod zemí zůstat. Barvu si síť řídí sama podle toho, nad čím
   * zrovna leží.
   */
  onToggleGrid(): void;
  /**
   * Otevře nápovědu.
   *
   * Musí být **i ve hře**, ne jen na domovské stránce: otázka „proč mi to
   * neroste" přijde uprostřed hraní a nikdo se kvůli ní nevrátí do menu.
   */
  onHelp(): void;
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
  /**
   * Přiblížení a oddálení tlačítky. Násobitel měřítka, jako u kolečka.
   *
   * Na telefonu není kolečko a hra nemá gesto — hráč se **neměl jak** dostat
   * blíž ani dál a díval se na město pořád z jedné výšky.
   */
  onZoom(factor: number): void;
  /**
   * Načíst novou verzi hry a **nechat rozehrané město**.
   *
   * Na mobilu drží starou verzi prohlížeč, ne hráč: index i service worker
   * mohou být z keše a nový build se do telefonu nedostane, dokud si hráč
   * neuklidí data stránky — čímž by přišel i o město. Tohle udělá obojí
   * v pořadí, ve kterém to o město nepřipraví.
   */
  onReload(): void;
}

/**
 * Kam si paleta nástrojů odloží schované nabídky a jak řadu zavře.
 *
 * Řadu vlastní HUD, ne paleta: je společná pro nástroje i ovládání a otevírá
 * ji jedna trojtečka.
 */
export interface ToolbarOverflow {
  readonly host: HTMLElement;
  close(): void;
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
  advisorVisible: boolean;
  financeVisible: boolean;
  transitVisible: boolean;
  /** Spouští hra náhodné katastrofy? */
  disastersEnabled: boolean;
  /** Jsou budovy průhledné? */
  ghost: boolean;
  /** Kreslí se stromy a balvany? */
  decor: boolean;
  /** Je zapnutá čtvercová síť? */
  grid: boolean;
  poweredBuildings: number;
  /** Kolik proudu město vyrábí a kolik ho potřebuje. */
  powerProduced: number;
  powerNeeded: number;
  /**
   * Odpad a kanalizace: kapacita zpracování proti tomu, co město vyrobí.
   *
   * Čte se stejně jako proud, protože to **stejně funguje**: co kapacita
   * nepobere, jde do znečištění — jenom ne kolem skládky, ale rovnoměrně po
   * celé mapě. Do teď to nebylo vidět nikde a autor právem hlásil, že
   * spalovna ani čistička „nemají žádný efekt".
   */
  wasteCapacity: number;
  wasteNeeded: number;
  sewageCapacity: number;
  sewageNeeded: number;
  /** Vodovod: kolik se načerpá a kolik město vypije. */
  waterCapacity: number;
  waterNeeded: number;
  /** Financování podle třídy služby. 1 = sto procent, víc je nadfinancování. */
  funding: ReadonlyMap<string, number>;
  /**
   * Z čeho vyšly sloupečky poptávky.
   *
   * Hráč hlásil, že „váhy se zdají chaotické". Nejsou — jen z jednoho čísla
   * není poznat, co ho udělalo. Sloupec to proto řekne po najetí myší.
   */
  demandTerms: readonly DemandBreakdown[];
  /** Už přeložená hláška o uložení či načtení. Prázdná = nic nezobrazovat. */
  message: string;
}

/**
 * Pravidla financování služeb tak, jak je potřebuje posuvník.
 *
 * Hodnoty počítá simulace (`sim/funding.ts`) z balancu — lišta si je nesmí
 * dopočítávat sama, jinak by ukazovala jinou cenu, než jaká se strhne.
 */
export interface FundingRules {
  /** Kam až smí posuvník. 1 = sto procent, 2 = dvojnásobek. */
  max: number;
  /** Jaký účinek dané financování doopravdy má. */
  effect(level: number): number;
  /** Kolikanásobek běžné údržby se za ně platí. */
  cost(level: number): number;
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

/**
 * Statistiky v pořadí, ve kterém stojí v liště.
 *
 * `primary` znamená „vidět i na telefonu". Autor vybral kasu a bilanci: obojí
 * se mění samo a obojí je důvod, proč hra skončí. Zbytek si hráč vyžádá.
 *
 * Pořadí je to původní, i když kasa a bilance v něm nesousedí — na počítači
 * lišta vypadá dobře tak, jak je, a přeskládat ji kvůli telefonu by znamenalo
 * spravit něco, co není rozbité.
 */
const STAT_ROWS: readonly { key: string; labelKey: string; primary?: true }[] = [
  { key: 'funds', labelKey: 'ui.hud.funds', primary: true },
  { key: 'population', labelKey: 'ui.hud.population' },
  { key: 'jobs', labelKey: 'ui.hud.jobs' },
  { key: 'happiness', labelKey: 'ui.hud.happiness' },
  { key: 'powered', labelKey: 'ui.hud.powered' },
  { key: 'power', labelKey: 'ui.hud.power' },
  { key: 'waste', labelKey: 'ui.hud.waste' },
  { key: 'sewage', labelKey: 'ui.hud.sewage' },
  { key: 'water', labelKey: 'ui.hud.water' },
  { key: 'balance', labelKey: 'ui.hud.balance', primary: true },
  // Popisek a hodnota mají vlastní klíče: `ui.hud.date` je celá věta s
  // parametry, jako popisek by se vypsala i se zástupnými symboly.
  { key: 'date', labelKey: 'ui.hud.dateLabel' },
];

/** O kolik se změní měřítko jedním klepnutím na lupu. */
const ZOOM_STEP = 1.25;

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
  /** Jak široké je rozhraní, viz `ui/layout.ts`. */
  private layout: LayoutMode;

  /**
   * Plný telefonní režim: sloučená tlačítka, lupa, síť a uložení v řadě
   * s paletou.
   */
  private get compact(): boolean {
    return this.layout === 'compact';
  }

  /**
   * Cokoli užšího než široký monitor. Schovává nástroje a ovládání pod
   * trojtečku a z osmi statistik nechá kasu s bilancí — jinak se lišta zalomí
   * do dvou řad nahoře i dole.
   */
  private get dense(): boolean {
    return this.layout !== 'full';
  }

  /**
   * Kam si `app.ts` pověsí grafickou paletu a co k ní na telefonu přibude.
   *
   * Autor si vyžádal, aby síť, uložení a trojtečka stály **v jedné řadě
   * s pacičkou a silnicí**, ne v řadě nad nimi. `barExtras` je ta část řady,
   * kterou plní HUD; paleta si plní `toolsSlot` vedle.
   */
  private readonly barExtras: HTMLElement;
  /**
   * Spodní řada. Na telefonu do ní spadne **všechno** ovládání, ne jen paleta:
   * teprve co se do ní nevejde, se přelije nahoru.
   */
  private readonly toolsRow: HTMLElement;

  /** Kořen HUDu. Nese třídu `hud--compact`, podle které se řídí CSS. */
  private readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly controls: HTMLElement;
  /** Řada, která je vidět vždycky. */
  private readonly controlRow: HTMLElement;
  /** Řada nad ní, kterou si hráč na telefonu vysouvá. */
  private readonly controlDrawer: HTMLElement;
  /** Část vysunuté řady, kam si paleta odkládá schované nabídky nástrojů. */
  private readonly toolDrawer: HTMLElement;
  /** Část vysunuté řady pro ovládání. */
  private readonly controlDrawerGroup: HTMLElement;

  private readonly values = new Map<string, HTMLElement>();
  private readonly speedButtons: HTMLButtonElement[] = [];
  /** Rychlejší stupně na telefonu. `null` v plné verzi — tam jsou v liště. */
  private speedMenu: Menu | null = null;
  /** Pauza a běh v jednom tlačítku. Jen na telefonu. */
  private playButton: HTMLButtonElement | null = null;
  /** Co je na tom tlačítku nakreslené. Prázdné = ještě nic. */
  private playShown = '';
  /**
   * Poslední rychlost, na které čas běžel.
   *
   * Sjednocené tlačítko pauzy musí vědět, **kam se vrátit**: kdo si pustil
   * čtyřikrát a dal pauzu, chce po odpauzování zase čtyřikrát, ne jedenkrát.
   */
  private lastRunning = 1;
  /** Povrch a podzemí v jednom tlačítku. Jen na telefonu. */
  private viewToggle: HTMLButtonElement | null = null;
  private readonly viewButtons = new Map<string, HTMLButtonElement>();
  private layerMenu: Menu | null = null;
  private budgetButton: HTMLButtonElement | null = null;
  private advisorButton: HTMLButtonElement | null = null;
  private financeButton: HTMLButtonElement | null = null;
  private transitButton: HTMLButtonElement | null = null;
  private disasterMenu: Menu | null = null;
  /** Se kterým stavem je nabídka katastrof postavená. `null` = ještě s žádným. */
  private disastersShown: boolean | null = null;
  private ghostButton: HTMLButtonElement | null = null;
  private decorButton: HTMLButtonElement | null = null;
  private gridButton: HTMLButtonElement | null = null;
  private messageNode: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private readonly views: readonly OverlayOption[];
  private readonly layers: readonly OverlayOption[];
  private readonly serviceClasses: readonly string[];
  private readonly fundingRules: FundingRules;
  /** Druhy katastrof, které umí registr spustit. Prázdné = menu se neukáže. */
  private readonly disasters: readonly string[];
  /** Ikony běžících pohrom u hodin. */
  private disasterBadges: HTMLElement | null = null;
  /** Odznaky podle id pohromy — odpočet se přepisuje, ne překresluje. */
  private readonly disasterNodes = new Map<number, HTMLElement>();
  /** Podle čeho se pozná, že se řada ikon musí přestavět. */
  private badgeKey = '';
  private readonly fundingInputs = new Map<string, HTMLInputElement>();
  private lastState: HudState = {
    speedIndex: 1,
    layer: 'none',
    view: 'surface',
    budgetVisible: false,
    advisorVisible: false,
    financeVisible: false,
    transitVisible: false,
    disastersEnabled: true,
    demandTerms: [],
    ghost: false,
    decor: true,
    grid: false,
    poweredBuildings: 0,
    powerProduced: 0,
    powerNeeded: 0,
    wasteCapacity: 0,
    wasteNeeded: 0,
    sewageCapacity: 0,
    sewageNeeded: 0,
    waterCapacity: 0,
    waterNeeded: 0,
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
    fundingRules: FundingRules,
    disasters: readonly string[],
    layout: LayoutMode,
    callbacks: HudCallbacks,
  ) {
    this.layout = layout;
    this.i18n = i18n;
    this.view = view;
    this.speeds = speeds;
    this.views = views;
    this.layers = layers;
    this.serviceClasses = serviceClasses;
    this.fundingRules = fundingRules;
    this.disasters = disasters;
    this.callbacks = callbacks;

    this.root = parent;
    this.top = el('div', 'hud__top');
    const bottom = el('div', 'hud__bottom');

    // Spodní řada: paleta nástrojů a hned za ní to, co k ní autor chtěl mít —
    // síť, uložení a trojtečka. Jeden řádek, ne dva nad sebou.
    this.toolsRow = el('div', 'hud__tools-row');
    this.toolsSlot = el('div', 'hud__tools');
    this.barExtras = el('div', 'hud__extras');
    this.toolsRow.append(this.toolsSlot, this.barExtras);

    this.controls = el('div', 'hud__controls');
    // Vysunutá řada je nad tou stálou: pod lištou už je jen okraj displeje.
    // Trojtečka je **jedna** a otevírá obojí — nástroje i ovládání. Dvě vedle
    // sebe, každá s jiným obsahem, by hráč neměl jak rozeznat.
    this.controlDrawer = el('div', 'hud__row hud__row--drawer is-hidden');
    this.toolDrawer = el('div', 'hud__drawer-group');
    this.controlDrawerGroup = el('div', 'hud__drawer-group');
    this.controlDrawer.append(this.toolDrawer, this.controlDrawerGroup);
    this.controlRow = el('div', 'hud__row');
    this.controls.append(this.controlDrawer, this.controlRow);

    bottom.append(this.toolsRow, this.controls);
    parent.append(this.top, bottom);

    this.build();
    i18n.onChange(() => {
      this.build();
      this.update(this.lastState);
    });
  }

  /**
   * Kam si paleta nástrojů odkládá to, co se do lišty nevešlo, a jak to zavře.
   *
   * Vysunutou řadu vlastní HUD, protože je společná: jsou v ní schované
   * nástroje **i** schované ovládání a otevírá je jedna trojtečka.
   */
  get overflow(): ToolbarOverflow {
    return {
      host: this.toolDrawer,
      close: () => this.controlDrawer.classList.add('is-hidden'),
    };
  }

  /**
   * Přepne mezi plnou a úspornou lištou.
   *
   * Volá se při otočení telefonu i při změně šířky okna. Přestavuje se celý
   * HUD, protože se mění, **kam** které tlačítko patří — a to není věc CSS.
   */
  setLayout(layout: LayoutMode): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.build();
    this.update(this.lastState);
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

    // Odpad a stoky. Pořadí je stejné jako u proudu — nejdřív co zvládneme,
    // pak co je potřeba — a červená znamená totéž: zbytek jde do vzduchu.
    for (const [key, capacity, needed] of [
      ['waste', state.wasteCapacity, state.wasteNeeded],
      ['sewage', state.sewageCapacity, state.sewageNeeded],
      ['water', state.waterCapacity, state.waterNeeded],
    ] as const) {
      this.setValue(key, `${formatNumber(capacity)} / ${formatNumber(needed)}`);
      this.values.get(key)?.classList.toggle('is-alarm', needed > capacity);
    }

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

      // Popisek se přepisuje při každé změně, protože se mění i čísla v něm.
      const column = this.values.get(`demand-column-${row.category}`);
      const breakdown = state.demandTerms.find((item) => item.category === row.category);
      if (column && breakdown) {
        const lines = breakdown.terms.map(
          (term) => `${this.i18n.t(term.key)}: ${term.value > 0 ? '+' : ''}${term.value}`,
        );
        column.title = [`${this.i18n.t(row.labelKey)}: ${value}`, ...lines].join('\n');
      }
    }

    for (const row of TAX_ROWS) {
      this.setValue(`tax-${row.category}`, `${economy.taxRates[row.category]} %`);
    }

    this.speedButtons.forEach((node, index) => {
      node.classList.toggle('is-active', index === state.speedIndex);
    });
    // Kam se vrátit po odpauzování. Pamatuje se **poslední běžící** rychlost,
    // ne ta výchozí.
    if (state.speedIndex > 0) this.lastRunning = state.speedIndex;
    this.reflectPlayPause();
    // Zrychlení, které v liště není: roletka se rozsvítí a vezme si jeho ikonu,
    // aby hráč po zavření poznal, že mu čas pořád letí.
    this.speedMenu?.setSelected(
      state.speedIndex >= Math.max(2, this.speedButtons.length) ? String(state.speedIndex) : null,
    );
    for (const [serviceClass, input] of this.fundingInputs) {
      const level = state.funding.get(serviceClass) ?? 1;
      const percent = Math.round(level * 100);
      // Posuvník se nepřepisuje, když s ním hráč zrovna hýbe.
      if (document.activeElement !== input) input.value = String(percent);
      this.setValue(`funding-${serviceClass}`, `${percent} %`);

      const note = this.values.get(`funding-note-${serviceClass}`);
      if (!note) continue;
      note.classList.toggle('is-hidden', level <= 1);
      if (level > 1) {
        note.textContent = this.i18n.t('ui.funding.over', {
          effect: Math.round(this.fundingRules.effect(level) * 100),
          // Desetinná čárka, ne tečka: `toFixed` píše po anglicku a v české
          // liště by to byl jediný takový údaj.
          cost: this.fundingRules.cost(level).toLocaleString('cs-CZ', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        });
      }
    }

    for (const [id, node] of this.viewButtons) {
      node.classList.toggle('is-active', id === state.view);
    }
    this.viewToggle?.classList.toggle('is-active', state.view === 'underground');
    this.layerMenu?.setSelected(state.layer);
    this.advisorButton?.classList.toggle('is-active', state.advisorVisible);
    this.budgetButton?.classList.toggle('is-active', state.budgetVisible);
    this.financeButton?.classList.toggle('is-active', state.financeVisible);
    this.transitButton?.classList.toggle('is-active', state.transitVisible);
    this.ghostButton?.classList.toggle('is-active', state.ghost);
    // Aktivní je tlačítko, když jsou stromy **schované** — svítí to, co hráč
    // zapnul, ne výchozí stav.
    this.decorButton?.classList.toggle('is-active', !state.decor);
    this.gridButton?.classList.toggle('is-active', state.grid);

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

  /**
   * Kam tlačítko patří.
   *
   * V plné verzi je všechno v jedné řadě. Na telefonu zůstávají v liště jen
   * pohled, průhlednost, stromy a lupa; síť, uložení a trojtečka jdou dolů
   * k paletě (zadání autora) a zbytek čeká ve vysunuté řadě.
   */
  private slot(primary: boolean): HTMLElement {
    return !this.dense || primary ? this.controlRow : this.controlDrawerGroup;
  }

  /** Na telefonu do řady s paletou, jinak mezi ostatní ovládání. */
  private barSlot(): HTMLElement {
    return this.compact ? this.barExtras : this.controlRow;
  }

  private build(): void {
    this.root.classList.toggle('hud--compact', this.compact);
    this.root.classList.toggle('hud--dense', this.dense);
    /*
     * Na telefonu je spodek lišty **jeden tok**, ne dvě oddělené řady: řada
     * s paletou se plní první a co se do ní nevejde, se přelije nahoru. Dvě
     * nezávislé řady po sobě nechávaly u pravého okraje díru, protože se každá
     * zalamovala sama za sebe. Hlásil to autor.
     *
     * Pořadí v DOMu je pořadí důležitosti: paleta, pak síť, uložení
     * a trojtečka, teprve pak lupa a pohledy.
     */
    (this.compact ? this.toolsRow : this.controls).appendChild(this.controlRow);
    this.top.replaceChildren();
    this.controlRow.replaceChildren();
    this.controlDrawerGroup.replaceChildren();
    this.barExtras.replaceChildren();
    this.controlDrawer.classList.add('is-hidden');
    this.values.clear();
    this.speedButtons.length = 0;
    this.speedMenu = null;
    this.playButton = null;
    this.viewToggle = null;
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
    this.disasterNodes.clear();
    this.buildSpeed(left);
    this.buildDemand();

    this.buildZoom();
    this.buildViews();
    this.buildGhost();
    this.buildDecor();
    this.buildGrid();
    this.buildLayers();
    this.buildDisasters();
    this.buildTaxes();
    this.buildFunding();
    this.buildBudget();
    this.buildSave();
    this.buildHelp();
    this.buildLanguage();
    this.buildMore();
    this.buildMessage();
  }

  /**
   * Přepínač vysunuté řady. Staví se **až nakonec**, aby stál v liště úplně
   * vpravo — tam, kde ho na telefonu chytí palec.
   */
  private buildMore(): void {
    if (!this.dense) return;
    const label = this.i18n.t('ui.toolbar.more');
    const node = button('toolbar__button', () => {
      this.controlDrawer.classList.toggle('is-hidden');
    });
    node.appendChild(iconSvg('more'));
    node.title = label;
    node.setAttribute('aria-label', label);
    this.barSlot().appendChild(node);
  }

  /**
   * Lupa. Jen na telefonu — na počítači je kolečko a dvě tlačítka navíc by
   * v liště jen překážela.
   */
  private buildZoom(): void {
    if (!this.compact) return;
    const group = el('div', 'segmented');
    for (const [icon, labelKey, factor] of [
      ['zoom-out', 'ui.zoom.out', 1 / ZOOM_STEP],
      ['zoom-in', 'ui.zoom.in', ZOOM_STEP],
    ] as const) {
      const label = this.i18n.t(labelKey);
      const node = button('segmented__button segmented__button--icon', () =>
        this.callbacks.onZoom(factor),
      );
      node.appendChild(iconSvg(icon));
      node.title = label;
      node.setAttribute('aria-label', label);
      group.appendChild(node);
    }
    this.controlRow.appendChild(group);
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
    if (key !== this.badgeKey) {
      this.badgeKey = key;
      this.disasterNodes.clear();
      badges.replaceChildren();
      for (const disaster of active) {
        const name = this.i18n.t(`ui.disaster.${disaster.kind}`);
        const node = button('hud__disaster', () =>
          this.callbacks.onDisasterClick(
            disaster.kind,
            disaster.x,
            disaster.y,
            tollOf(disaster),
          ),
        );
        node.setAttribute('aria-label', name);
        node.appendChild(iconSvg(disaster.kind));
        badges.appendChild(node);
        this.disasterNodes.set(disaster.id, node);
      }
    }

    /*
     * Odpočet do konce. Kreslí se jako **pozadí odznaku**, které se plní
     * zleva doprava — přidávat vedle ikony ještě proužek by z lišty udělalo
     * další tabulku.
     *
     * Přepisuje se každý snímek, ne jen při změně řady: je to jediná věc na
     * odznaku, která se hýbe. Pohromy bez hodin (oheň hoří, dokud je co,
     * povodeň opadá po svém) `null` a lišta u nich zůstane prázdná.
     */
    for (const disaster of active) {
      const node = this.disasterNodes.get(disaster.id);
      if (!node) continue;
      const done = disasterProgress(disaster);
      node.style.setProperty('--disaster-progress', done === null ? '0%' : `${Math.round(done * 100)}%`);
      const name = this.i18n.t(`ui.disaster.${disaster.kind}`);
      const head =
        done === null
          ? name
          : this.i18n.t('ui.disaster.progress', { name, percent: Math.round(done * 100) });

      // Oběti se lepí za odpočet, ne místo něj: hráč potřebuje obojí a
      // pohroma, která nikoho nezabila, o tom nemá co říkat.
      const dead = tollOf(disaster);
      node.title = dead > 0 ? `${head} · ${this.i18n.t('ui.disaster.toll', { dead })}` : head;
    }
  }

  /**
   * Statistiky.
   *
   * Na telefonu zůstane v liště kasa a bilance, ostatní se přestěhuje pod
   * ikonu grafu — s **týmiž** klíči, takže `update()` je plní stejně a
   * nemusí vědět, kde který údaj zrovna visí.
   */
  private buildStats(parent: HTMLElement): void {
    const group = el('div', 'stats');
    for (const row of STAT_ROWS) {
      if (this.dense && row.primary !== true) continue;
      group.appendChild(this.stat(row.key, row.labelKey));
    }

    if (!this.dense) {
      parent.appendChild(group);
      return;
    }

    // Na telefonu **není ikonka grafu**: tlačítkem je rovnou kasa s bilancí.
    // Vyžádal si to autor a je to úspora celého jednoho tlačítka v liště, kde
    // se počítá každé.
    const popover = new Popover({ icon: 'chart', label: this.i18n.t('ui.hud.moreStats'), className: 'popover--stats' });
    popover.trigger.replaceChildren(group);
    popover.panel.classList.add('panel--stats');
    for (const row of STAT_ROWS) {
      if (row.primary === true) continue;
      popover.panel.appendChild(this.stat(row.key, row.labelKey));
    }
    parent.appendChild(popover.root);
  }

  /**
   * Jeden údaj v liště.
   *
   * Údaj, který se dá rozepsat, je **tlačítko**. Autor: „u statistik by bylo
   * fajn, kdyby šlo každou z hodnot rozkliknout a naskočí tabulka, z čeho se
   * čísla skládají." Datum tlačítko není — z čeho by se skládalo.
   */
  private stat(key: string, labelKey: string): HTMLElement {
    const explainable = (EXPLAINED_STATS as readonly string[]).includes(key);
    const stat = explainable
      ? button('stat stat--button', () => this.callbacks.onStatClick(key))
      : el('div', 'stat');
    if (explainable) stat.title = this.i18n.t('ui.stat.explain');
    stat.appendChild(el('span', 'stat__label', this.i18n.t(labelKey)));
    const value = el('span', 'stat__value', '-');
    stat.appendChild(value);
    this.values.set(key, value);
    return stat;
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
      bars.appendChild(column);

      this.values.set(`demand-column-${row.category}`, column);
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
    if (this.compact) {
      this.buildPlayPause(parent);
      return;
    }

    const group = el('div', 'segmented');
    const inBar = this.speeds.length;

    this.speeds.forEach((speed, index) => {
      if (index >= inBar) return;
      const node = button('segmented__button segmented__button--icon', () =>
        this.callbacks.onSpeed(index),
      );
      const label = this.speedLabel(speed);
      // Pauza má vlastní ikonu, ostatní stupně se liší počtem šipek. Když
      // obrázek chybí, spadne to zpátky na text — rychlost musí jít přepnout
      // i bez grafiky.
      const drawn = iconSvg(speedIcon(speed));
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
   * Pauza a běh v jednom tlačítku, zrychlení pod trojtečkou vedle.
   *
   * Zadání autora. Dvě tlačítka na totéž jsou v liště, kde se počítá každé
   * místo, plýtvání: běží–neběží je jeden stav a jeden přepínač.
   *
   * Odpauzování se vrací **na tu rychlost, na které čas běžel**. Kdo si pustil
   * osmkrát a dal pauzu, chce po odpauzování zase osmkrát.
   */
  private buildPlayPause(parent: HTMLElement): void {
    const group = el('div', 'segmented');
    const node = button('segmented__button segmented__button--icon', () => {
      this.callbacks.onSpeed(this.lastState.speedIndex === 0 ? this.lastRunning : 0);
    });
    this.playButton = node;
    this.playShown = '';
    group.appendChild(node);
    parent.appendChild(group);

    // Trojtečka, dokud běží pauza nebo normální rychlost; jakmile si hráč
    // pustí něco rychlejšího, vezme si tlačítko jeho ikonu, aby po zavření
    // bylo poznat, že čas letí.
    const menu = new Menu({ icon: 'more', label: this.i18n.t('ui.speed.label') });
    menu.setItems(
      this.speeds.slice(2).map((speed, offset) => ({
        id: String(2 + offset),
        label: this.speedLabel(speed),
        icon: speedIcon(speed),
        onSelect: () => this.callbacks.onSpeed(2 + offset),
      })),
    );
    this.speedMenu = menu;
    parent.appendChild(menu.root);

    this.reflectPlayPause();
  }

  /**
   * Ikona i popisek přepínače podle toho, jestli čas zrovna běží.
   *
   * Sahá na obsah tlačítka, **jen když se něco změnilo**. Volá se každý snímek
   * a kdyby obrázek pokaždé vyhodilo a nahradilo novým, prst by mezi stiskem
   * a puštěním přišel o cíl a prohlížeč by `click` vůbec neposlal — na telefonu
   * pak tlačítko spuštění nereagovalo. Hlásil to autor.
   */
  private reflectPlayPause(): void {
    const node = this.playButton;
    if (!node) return;

    const paused = this.lastState.speedIndex === 0;
    // Na tlačítku je **to, co se stane po stisku**, ne to, co zrovna platí:
    // tak to má každý přehrávač a hráč to nemusí luštit.
    const label = paused
      ? this.speedLabel(this.speeds[this.lastRunning] ?? 1)
      : this.i18n.t('ui.speed.pause');
    const shown = `${paused ? 'play' : 'pause'}:${label}`;
    if (shown === this.playShown) return;
    this.playShown = shown;

    node.replaceChildren(iconSvg(paused ? 'speed-1' : 'speed-pause'));
    node.title = `${this.i18n.t('ui.speed.label')}: ${label}`;
    node.setAttribute('aria-label', label);
    node.classList.toggle('is-active', !paused);
  }

  private speedLabel(speed: number): string {
    return speed === 0 ? this.i18n.t('ui.speed.pause') : this.i18n.t('ui.speed.value', { speed });
  }

  /**
   * Povrch a podzemí. **Není to overlay**, je to jiný pohled na svět: mění se
   * v něm i to, co dělá stavební nástroj a buldozer (§8 fáze 3). Proto stojí
   * zvlášť a ne v seznamu diagnostických vrstev, kam to dřív bylo naskládané.
   */
  private buildViews(): void {
    if (this.compact) {
      // Jedno tlačítko místo dvou — zadání autora. Znamená vždycky „pohled
      // pod zem"; rozsvícené je, když se hráč pod zemí zrovna dívá.
      const label = this.i18n.t('ui.view.underground');
      const node = button('toolbar__button', () => {
        this.callbacks.onSetView(this.lastState.view === 'underground' ? 'surface' : 'underground');
      });
      node.appendChild(iconSvg('view-underground'));
      node.title = label;
      node.setAttribute('aria-label', label);
      this.viewToggle = node;
      this.controlRow.appendChild(node);
      return;
    }

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
    this.slot(true).appendChild(group);
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
    this.slot(true).appendChild(node);
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
    this.slot(true).appendChild(node);
  }

  /**
   * Čtvercová síť. Vedle průhlednosti a stromů, protože je to totéž zrnem —
   * a **zůstává v liště i na telefonu**: autor si vyžádal obojí.
   */
  private buildGrid(): void {
    const label = this.i18n.t('ui.view.grid');
    const node = button('toolbar__button', () => this.callbacks.onToggleGrid());
    node.appendChild(iconSvg('view-grid'));
    node.title = label;
    node.setAttribute('aria-label', label);
    this.gridButton = node;
    this.barSlot().appendChild(node);
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
    this.slot(false).appendChild(menu.root);
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
    this.slot(false).appendChild(menu.root);
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

    this.slot(false).appendChild(popover.root);
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
      const group = el('div', 'panel__group');
      const row = el('div', 'panel__row');
      row.appendChild(el('span', 'panel__label', this.i18n.t(`ui.service.${serviceClass}`)));

      const slider = el('input', 'slider');
      slider.type = 'range';
      slider.min = '0';
      // Nad sto procent se smí od T113. Krok je pořád po pěti procentech:
      // jemnější by u progresivní ceny znamenal, že se hráč trefuje myší do
      // rozdílu několika tisíc měsíčně.
      slider.max = String(Math.round(this.fundingRules.max * 100));
      slider.step = '5';
      slider.value = '100';
      slider.addEventListener('input', () => {
        this.callbacks.onFundingChange(serviceClass, Number(slider.value) / 100);
      });
      this.fundingInputs.set(serviceClass, slider);

      const value = el('span', 'panel__value', '100 %');
      this.values.set(`funding-${serviceClass}`, value);

      row.append(slider, value);
      group.appendChild(row);

      // Co nadfinancování dělá, se **píše pod posuvník**, ne skrývá do
      // bublinky. Hráč, který jde nad sto procent, má rovnou vidět obojí:
      // že účinek roste polovinou a cena násobkem.
      const note = el('span', 'panel__note is-hidden');
      this.values.set(`funding-note-${serviceClass}`, note);
      group.appendChild(note);

      popover.panel.appendChild(group);
    }

    this.slot(false).appendChild(popover.root);
  }

  private buildBudget(): void {
    // Poradce stojí **před** rozpočtem: je to první věc, kterou hráč otevře,
    // když neví, co dělat, a poslední, kterou hledá, když ví.
    this.advisorButton = this.panelButton('chat', 'ui.advisor.toggle', () =>
      this.callbacks.onToggleAdvisor(),
    );
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
    this.slot(false).appendChild(node);
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

    // Načtení nové verze **jen na telefonu**: na počítači si hráč zmáčkne
    // Ctrl+F5 a hotovo. Sedí to v uložení, protože je to hlavně uložení —
    // město se před obnovením odloží do prohlížeče a po něm se vrátí.
    if (this.compact) {
      const updateRow = el('div', 'panel__row');
      const update = button('chip', () => this.callbacks.onReload());
      update.append(iconSvg('reload'), this.i18n.t('ui.save.update'));
      update.title = this.i18n.t('ui.save.updateHint');
      updateRow.appendChild(update);
      popover.panel.appendChild(updateRow);
    }

    this.barSlot().appendChild(popover.root);
  }

  /** Nápověda. Poslední v řadě, hned u jazyka — obojí je o hře, ne o městě. */
  private buildHelp(): void {
    const label = this.i18n.t('ui.help.title');
    const node = button('toolbar__button', () => this.callbacks.onHelp());
    node.appendChild(iconSvg('help'));
    node.title = label;
    node.setAttribute('aria-label', label);
    this.slot(false).appendChild(node);
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

    this.slot(false).appendChild(popover.root);
  }

  /**
   * Hláška o uložení. Visí nad lištou, ne v panelu uložení — ten je teď
   * zavřený a hráč by se o výsledku nedozvěděl.
   */
  private buildMessage(): void {
    if (this.messageNode) return;
    const message = el('div', 'hud__message is-empty');
    this.messageNode = message;
    this.controls.appendChild(message);
  }
}

/** Jméno ikony ke stupni rychlosti. Pauza má vlastní, ostatní počet šipek. */
function speedIcon(speed: number): string {
  return speed === 0 ? 'speed-pause' : `speed-${speed}`;
}

export function dateParts(tick: number): { year: number; month: number; day: number } {
  return {
    year: Math.floor(tick / (DAYS_PER_MONTH * MONTHS_PER_YEAR)) + 1,
    month: (Math.floor(tick / DAYS_PER_MONTH) % MONTHS_PER_YEAR) + 1,
    day: (tick % DAYS_PER_MONTH) + 1,
  };
}
