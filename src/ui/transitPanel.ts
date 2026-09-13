import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '@/sim/catalogue';
import type { Command } from '@/sim/commands';
import type { LineStats, TransitLine } from '@/sim/transit';
import { lineFault, lineProblems, lineRuns, modeOf, noStats } from '@/sim/transit';
import type { WorldState } from '@/sim/world';
import { button, el } from './dom';
import { formatNumber } from './format';
import { iconSvg, sheetHeader } from './icons';
import type { I18n } from './i18n';
import { closeOtherSheets, registerSheet } from './sheets';

/**
 * Linky MHD (§7 fáze 4).
 *
 * Simulace je uměla od T55, ale vedla k nim jen `dispatch` — rozpočet ukazoval
 * řádek *MHD* a hráč neměl jak založit linku. Tohle je ta chybějící cesta.
 *
 * **Zastávka se vybírá na mapě, ne ze seznamu.** Trasa se sice nekreslí (je to
 * abstrakce), ale která zastávka to je, hráč pozná podle toho, kde stojí —
 * ne podle pořadového čísla budovy. Tlačítko „přidat zastávku" proto předá
 * řízení mapě a čeká na klik.
 *
 * Panel se **přestavuje jen při změně**, ne každý snímek: tlačítka pod myší by
 * jinak mizela hráči pod kurzorem a nešlo by je zmáčknout.
 */

export interface TransitCallbacks {
  /** Hráč chce přidat zastávku — mapa má počkat na klik do linky `lineId`. */
  onPickStop(lineId: number): void;
  /** Panel se zavírá nebo se přidávání ruší. */
  onCancelPick(): void;
  /**
   * Hráč klikl na zastávku v seznamu — ukaž mu ji na mapě.
   *
   * Zastávky nemají jméno a hráč se ptal, „co ta čísla znamenají". Jsou to
   * souřadnice; tímhle se z nich stane místo, na které se dá podívat.
   */
  onShowStop(x: number, y: number): void;
}

export class TransitPanel {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private readonly dispatch: (command: Command) => void;
  private readonly callbacks: TransitCallbacks;
  private visible = false;

  /** Do které linky se zrovna vybírá zastávka. `null` = do žádné. */
  private picking: number | null = null;

  /** Otisk toho, co je vykreslené. Shodný otisk = není co přestavovat. */
  private drawn = '';

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    dispatch: (command: Command) => void,
    callbacks: TransitCallbacks,
  ) {
    this.i18n = i18n;
    this.dispatch = dispatch;
    this.callbacks = callbacks;

    this.root = el('div', 'sheet sheet--transit is-hidden');
    parent.appendChild(this.root);
    registerSheet(this);

    i18n.onChange(() => {
      this.drawn = '';
    });
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Do které linky se čeká na kliknutí. Čte `app.ts`, když hráč klikne. */
  pickingLine(): number | null {
    return this.picking;
  }

  /** Zastávka přidaná (nebo pokus selhal) — přebírání kliků končí. */
  stopPicked(): void {
    this.picking = null;
    this.callbacks.onCancelPick();
    this.drawn = '';
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.classList.toggle('is-hidden', !this.visible);
    // Zavřený panel nesmí dál polykat kliknutí do mapy.
    if (!this.visible && this.picking !== null) this.stopPicked();
    if (this.visible) closeOtherSheets(this);
    return this.visible;
  }

  /** Zavření zvenčí (`ui/sheets.ts`) musí zrušit i přebírání kliknutí. */
  hide(): void {
    if (this.visible) this.toggle();
  }

  update(
    world: WorldState,
    catalogue: BuildingCatalogue,
    balance: Balance,
  ): void {
    if (!this.visible) return;

    const signature = this.signature(world, catalogue, balance);
    if (signature === this.drawn) return;
    this.drawn = signature;
    this.build(world, catalogue, balance);
  }

  /**
   * Otisk stavu, ze kterého je panel nakreslený.
   *
   * Zahrnuje i statistiky a kasu: statistiky se přepočítají jednou měsíčně
   * a podle kasy se zamyká tlačítko „přidat vozidlo". Kdyby v otisku nebyly,
   * ukazoval by panel čísla z minulého měsíce a nabízel vozidlo, na které
   * město nemá.
   */
  private signature(world: WorldState, catalogue: BuildingCatalogue, balance: Balance): string {
    const parts = [String(world.economy.funds), this.picking === null ? '-' : String(this.picking)];
    for (const line of world.lines) {
      const stats = world.lineStats.get(line.id) ?? noStats();
      parts.push(
        [
          line.id,
          line.mode,
          line.stops.join('+'),
          line.vehicles,
          line.fare,
          stats.demand,
          stats.capacity,
          Math.round(stats.transported),
          stats.income,
          stats.upkeep,
          lineRuns(world, catalogue, balance, line) ? 'jede' : 'stojí',
        ].join(':'),
      );
    }
    return parts.join('|');
  }

  /* ------------------------------------------------------------- stavba -- */

  private build(world: WorldState, catalogue: BuildingCatalogue, balance: Balance): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    this.root.replaceChildren();

    this.root.appendChild(sheetHeader(t('ui.transit.title'), t('ui.common.close'), () => this.toggle()));

    // Módy jsou z katalogu, ne z výčtu v kódu (P5) — mod si přidá svůj a
    // tlačítko na něj se objeví samo.
    const create = el('div', 'panel__row');
    create.appendChild(el('span', 'panel__label', t('ui.transit.create')));
    for (const mode of Object.keys(balance.transit.modes).sort()) {
      const node = button('chip', () => this.dispatch({ type: 'create_line', mode }));
      node.appendChild(iconSvg('line-create'));
      node.appendChild(el('span', undefined, t(`ui.transit.mode.${mode}`)));
      create.appendChild(node);
    }
    this.root.appendChild(create);

    if (world.lines.length === 0) {
      this.root.appendChild(el('p', 'sheet__note', t('ui.transit.noLines')));
      return;
    }

    for (const line of world.lines) {
      this.root.appendChild(this.buildLine(world, catalogue, balance, line));
    }
  }

  private buildLine(
    world: WorldState,
    catalogue: BuildingCatalogue,
    balance: Balance,
    line: TransitLine,
  ): HTMLElement {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const mode = modeOf(balance, line.mode);
    const stats = world.lineStats.get(line.id) ?? noStats();
    const section = el('section', 'transit__line');

    /* --- hlavička --- */
    const head = el('div', 'transit__head');
    head.appendChild(
      el(
        'span',
        'transit__name',
        t('ui.transit.lineName', { id: line.id, mode: t(`ui.transit.mode.${line.mode}`) }),
      ),
    );
    const runs = lineRuns(world, catalogue, balance, line);
    // Odstavená linka není rozbitá — to jsou dva různé stavy a hráč musí
    // poznat, jestli si ji vypnul sám, nebo jí něco chybí.
    const state = line.paused ? 'ui.transit.paused' : runs ? 'ui.transit.running' : 'ui.transit.stopped';
    head.appendChild(
      el('span', runs ? 'transit__state' : 'transit__state is-negative', t(state)),
    );
    /*
     * **Jede / nejede** je přepínač, ne mazání.
     *
     * Hráč to popsal takhle: „jede spustí linku, nejede jen pozastaví, mimo
     * provoz úplně se po zvolení nejede odstraní." Do té doby se dala linka
     * jedině smazat i se zastávkami, které se pak musely naklikat znovu.
     */
    const pause = button('chip chip--tight', () =>
      this.dispatch({ type: 'set_line_paused', lineId: line.id, paused: !line.paused }),
    );
    pause.appendChild(iconSvg(line.paused ? 'speed-1' : 'speed-pause'));
    pause.title = t(line.paused ? 'ui.transit.resume' : 'ui.transit.pause');
    head.appendChild(pause);

    const remove = button('chip chip--tight', () =>
      this.dispatch({ type: 'delete_line', lineId: line.id }),
    );
    remove.appendChild(iconSvg('line-delete'));
    remove.title = t('ui.transit.delete');
    head.appendChild(remove);
    section.appendChild(head);

    /* --- zastávky --- */
    const stops = el('div', 'transit__stops');
    stops.appendChild(
      el('span', 'panel__label', t('ui.transit.stops', {
        count: line.stops.length,
        max: balance.transit.maxStops,
      })),
    );

    /*
     * Čip zastávky dělá **dvě různé věci a každou jiným tlačítkem**.
     *
     * Klik na jméno ukáže zastávku na mapě, křížek ji vyhodí z linky. Dřív
     * mazalo obojí a popisek byl holé „3. 64, 71" — hráč se ptal, co ta čísla
     * znamenají, a bál se na ně kliknout.
     *
     * Zbořená zastávka se v seznamu neobjeví: mizí z linky sama, hned jak
     * budova zmizí z města (`removeBuilding`).
     */
    const fault = lineFault(world, balance, line);
    const dark = new Set(fault?.kind === 'noPower' ? fault.stops : []);

    for (const [order, stopId] of line.stops.entries()) {
      const building = world.buildings.get(stopId);
      if (!building) continue;
      // Zastávka, kvůli které linka stojí, je vidět **v seznamu**, ne jen ve
      // větě pod ním: u dvanácti zastávek se jinak hledá podle souřadnic.
      const chip = el('span', dark.has(stopId) ? 'chip chip--stop is-fault' : 'chip chip--stop');

      const show = button('chip__label', () =>
        this.callbacks.onShowStop(building.x, building.y),
      );
      show.textContent = t('ui.transit.stopAt', {
        order: order + 1,
        x: building.x,
        y: building.y,
      });
      show.title = t('ui.transit.showStop');
      chip.appendChild(show);

      const drop = button('chip__drop', () =>
        this.dispatch({ type: 'remove_stop', lineId: line.id, buildingId: stopId }),
      );
      drop.appendChild(iconSvg('stop-remove'));
      drop.title = t('ui.transit.removeStop');
      chip.appendChild(drop);

      stops.appendChild(chip);
    }

    const picking = this.picking === line.id;
    const add = button(picking ? 'chip chip--primary' : 'chip', () => this.pick(line.id));
    add.appendChild(iconSvg('stop-add'));
    add.appendChild(el('span', undefined, t(picking ? 'ui.transit.picking' : 'ui.transit.addStop')));
    add.disabled = line.stops.length >= balance.transit.maxStops;
    stops.appendChild(add);
    section.appendChild(stops);

    /* --- vozidla a jízdné --- */
    const vehicleCost = mode?.vehicleCost ?? 0;
    section.appendChild(
      this.stepper(
        'vehicles',
        t('ui.transit.vehicles'),
        t('ui.transit.vehicleCount', { count: line.vehicles, cost: formatNumber(vehicleCost) }),
        () => this.dispatch({ type: 'set_vehicles', lineId: line.id, vehicles: line.vehicles - 1 }),
        () => this.dispatch({ type: 'set_vehicles', lineId: line.id, vehicles: line.vehicles + 1 }),
        line.vehicles <= 0,
        world.economy.funds < vehicleCost,
      ),
    );

    section.appendChild(
      this.stepper(
        'fare',
        t('ui.transit.fare'),
        formatNumber(line.fare),
        () => this.dispatch({ type: 'set_fare', lineId: line.id, fare: line.fare - 1 }),
        () => this.dispatch({ type: 'set_fare', lineId: line.id, fare: line.fare + 1 }),
        line.fare <= 0,
        // Nad limitem je ochota nulová a linka nikoho neveze — dál to nemá smysl.
        line.fare >= balance.transit.fareLimit,
      ),
    );

    /* --- co linka veze --- */
    section.appendChild(this.statsLine(stats));

    /* --- co je špatně --- */
    const problems = lineProblems(world, catalogue, balance, line);
    for (const problem of problems) {
      section.appendChild(
        el('p', 'sheet__warning', t(`ui.transit.problem.${problem}`, {
          min: balance.transit.minStops,
          max: balance.transit.maxStops,
        })),
      );
    }

    /*
     * Provozní důvod, proč linka stojí.
     *
     * Odstavená linka ho nemá — tu si hráč vypnul sám a hlásit mu to jako
     * závadu by bylo matoucí. U zbytku platí, že „stojí" bez důvodu je ta
     * nejhorší hláška ve hře: autor u metra napsal, že se zaboha nemá jak
     * dozvědět kde, jak a proč.
     */
    if (fault && !line.paused) {
      const where = fault.stops
        .map((stopId) => {
          const building = world.buildings.get(stopId);
          const order = line.stops.indexOf(stopId) + 1;
          return building
            ? t('ui.transit.stopAt', { order, x: building.x, y: building.y })
            : String(order);
        })
        .join(', ');
      section.appendChild(
        el('p', 'sheet__warning', t(`ui.transit.problem.${fault.kind}`, { stops: where })),
      );
    }
    return section;
  }

  /** Řádek `− hodnota +`. Krajní stavy zamykají tlačítko, ne hlášku. */
  private stepper(
    icon: string,
    label: string,
    value: string,
    onMinus: () => void,
    onPlus: () => void,
    minusOff: boolean,
    plusOff: boolean,
  ): HTMLElement {
    const row = el('div', 'panel__row');
    const name = el('span', 'panel__label');
    name.appendChild(iconSvg(icon));
    name.appendChild(el('span', undefined, label));
    row.appendChild(name);

    const minus = button('chip chip--tight', onMinus);
    minus.appendChild(el('span', undefined, '−'));
    minus.disabled = minusOff;

    const plus = button('chip chip--tight', onPlus);
    plus.appendChild(el('span', undefined, '+'));
    plus.disabled = plusOff;

    row.append(minus, el('span', 'panel__value', value), plus);
    return row;
  }

  private statsLine(stats: LineStats): HTMLElement {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const net = stats.income - stats.upkeep;
    return el(
      'p',
      net < 0 ? 'sheet__note is-negative' : 'sheet__note',
      t('ui.transit.stats', {
        transported: formatNumber(Math.round(stats.transported)),
        demand: formatNumber(Math.round(stats.demand)),
        capacity: formatNumber(stats.capacity),
        income: formatNumber(stats.income),
        upkeep: formatNumber(stats.upkeep),
      }),
    );
  }

  /** Zapne nebo vypne čekání na klik do mapy. Druhé kliknutí ho zruší. */
  private pick(lineId: number): void {
    if (this.picking === lineId) {
      this.picking = null;
      this.callbacks.onCancelPick();
    } else {
      this.picking = lineId;
      this.callbacks.onPickStop(lineId);
    }
    this.drawn = '';
  }
}
