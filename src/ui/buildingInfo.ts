import type { Balance } from '@/content/balance';
import type { Definition } from '@/content/schema';
import type { ParcelExplanation } from '@/sim/diagnostics';
import { buildingMonthlyTax, buildingMonthlyUpkeep } from '@/sim/systems/economy';
import { downgradeGrace, LEVEL_INTERVAL } from '@/sim/systems/levels';
import { TICKS_PER_YEAR } from '@/sim/disasters/risk';
import type { Building, WorldState } from '@/sim/world';
import { ROAD, TERRAIN } from '@/sim/layers';
import { iconSvg, sheetHeader } from './icons';
import { cssUrl, el } from './dom';
import { formatNumber, formatPercent, landValueTermKeys } from './format';
import { dateParts } from './hud';
import type { I18n } from './i18n';
import { closeOtherSheets, registerSheet } from './sheets';

/**
 * Jméno povrchu pro překlad a pro obrázek. Index je hodnota vrstvy `terrain`,
 * takže to musí sedět na `TERRAIN` v `sim/layers.ts` — na pořadí, ne na jméno
 * konstanty.
 */
/**
 * Jméno typu silnice pro překlad. Index je hodnota vrstvy `road`.
 *
 * Ukazuje se **jen když na dlaždici silnice opravdu je**. Autor si stěžoval,
 * že u divně vypadající vozovky nepozná, jestli je vadný obrázek, nebo jen
 * jiný typ — bez tohohle řádku se to z panelu vyčíst nedalo.
 */
const ROAD_KEYS: Readonly<Record<number, string>> = {
  [ROAD.street]: 'street',
  [ROAD.avenue]: 'avenue',
  [ROAD.highway]: 'highway',
};

const TERRAIN_KEYS: Readonly<Record<number, string>> = {
  [TERRAIN.grass]: 'grass',
  [TERRAIN.water]: 'water',
  [TERRAIN.sand]: 'sand',
  [TERRAIN.rock]: 'rock',
  [TERRAIN.forest]: 'forest',
  [TERRAIN.marsh]: 'marsh',
};


/**
 * Hodnoty vrstev jsou bajty: 0 až 255. Platí pro cenu půdy, spokojenost
 * i pokrytí službami, takže se všechny tři dají ukázat stejným pruhem.
 */
const BYTE_MAX = 255;

/**
 * Ukazatel „hodně nebo málo".
 *
 * Číslo samo o sobě hráči nic neřekne — je 182 hodně? Pruh to odpoví dřív,
 * než stihne přečíst hodnotu, a barva k tomu přidá soud: červená pod třetinou,
 * jantarová do dvou třetin, zelená nad nimi. Rozhodnutí autora: „děláme hru,
 * ne informační systém města".
 *
 * Pruh se kreslí **jen tam, kde je známý strop**. U počtu obyvatel nebo u daní
 * žádný není a vymyslet si ho by znamenalo lhát.
 */
function meter(label: string, value: string, share: number): HTMLElement {
  const clamped = Math.max(0, Math.min(1, share));
  const row = el('div', 'gauge');
  row.appendChild(el('span', 'gauge__label', label));

  const track = el('div', 'gauge__track');
  const fill = el('div', `gauge__fill ${gradeOf(clamped)}`);
  fill.style.width = `${Math.round(clamped * 100)}%`;
  track.appendChild(fill);
  row.appendChild(track);

  // Hodnota, která je věta a ne číslo, patří na vlastní řádek: sloupec je
  // `auto`, takže „mimo dosah — tady nic nevyroste" zmáčkl popisek na nulu
  // a text přejel ukazatel.
  const text = el('span', 'gauge__value', value);
  if (value.length > LONG_VALUE_CHARS) text.classList.add('gauge__value--long');
  row.appendChild(text);
  return row;
}

/** Delší hodnota se vedle ukazatele nevejde. Měřeno na nejužším telefonu. */
const LONG_VALUE_CHARS = 12;

/** Slabé, střední, nebo dobré? Jedna hranice pro všechny pruhy. */
function gradeOf(share: number): string {
  if (share < 1 / 3) return 'is-low';
  if (share < 2 / 3) return 'is-mid';
  return 'is-high';
}

/**
 * Stojí tu čerpací stanice, ke které voda nedoteče?
 *
 * Relé pozná podle toho, že má dosah, ale žádnou výrobu. Vodárna sem nepatří —
 * ta si vodu bere z plochy vedle sebe, ne z potrubí.
 */
function isIdleRelay(
  world: WorldState,
  definition: Definition,
  building: Readonly<Building>,
): boolean {
  const water = definition.water;
  if (!water || (water.range ?? 0) <= 0 || (water.production ?? 0) > 0) return false;

  const [width, depth] = definition.footprint;
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const x = building.x + dx;
      const y = building.y + dy;
      if (x >= world.size || y >= world.size) continue;
      if (world.waterSupply[y * world.size + x] === 1) return false;
    }
  }
  return true;
}

/**
 * Detail budovy po kliknutí pravým tlačítkem.
 *
 * Ukazuje, co budova městu nese a co stojí, jak je na tom s proudem a odkdy
 * stojí. Až přibude znečištění nebo kriminalita, přidají se sem další řádky —
 * proto je výpis stavěný jako seznam dvojic, ne jako pevná šablona.
 */
export class BuildingInfo {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private readonly balance: Balance;
  /**
   * Obrázek povrchu podle hodnoty vrstvy `terrain`. Panel si ho **nehledá
   * sám**: o obsah se stará `ContentRegistry` a UI o něm nemá vědět nic víc
   * než tuhle jednu funkci (P5). Když obrázek chybí, vrátí `undefined`
   * a ukáže se jen jméno povrchu.
   */
  private readonly tileImage: (terrain: number) => string | undefined;
  /**
   * Kolik odpadu a odpadní vody město dělá **teď**.
   *
   * Panel si to nepočítá sám ze stejného důvodu jako obrázek povrchu: musel by
   * projít všechny budovy a znát katalog. Kapacita spalovny sama o sobě nic
   * neříká — teprve vedle městské potřeby je z ní odpověď „stačí to?".
   */
  private readonly utilities: () => {
    wasteNeeded: number;
    wasteCapacity: number;
    sewageNeeded: number;
    sewageCapacity: number;
    waterNeeded: number;
    waterCapacity: number;
  };

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    balance: Balance,
    tileImage: (terrain: number) => string | undefined = () => undefined,
    utilities: () => {
      wasteNeeded: number;
      wasteCapacity: number;
      sewageNeeded: number;
      sewageCapacity: number;
      waterNeeded: number;
      waterCapacity: number;
    } = () => ({
      wasteNeeded: 0,
      wasteCapacity: 0,
      sewageNeeded: 0,
      sewageCapacity: 0,
      waterNeeded: 0,
      waterCapacity: 0,
    }),
  ) {
    this.i18n = i18n;
    this.balance = balance;
    this.tileImage = tileImage;
    this.utilities = utilities;
    this.root = el('div', 'sheet sheet--info is-hidden');
    parent.appendChild(this.root);
    registerSheet(this);
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  show(
    world: WorldState,
    parcel: ParcelExplanation,
    building: Building | undefined,
    definition: Definition | undefined,
    /** Proč se na parcele nestaví — lokalizační klíč, nebo `null`. */
    blocker: string | null = null,
    /**
     * Obrázek, kterým se budova na mapě zrovna kreslí.
     *
     * Ukazuje se **jako obrázek, ne jako cesta k souboru**. Cesta tu chvíli
     * byla, aby si autor mohl ručně kontrolovat vygenerované varianty; svůj
     * účel splnila a v panelu nemá co dělat.
     */
    spriteUrl: string | null = null,
    /**
     * Co v téhle čtvrti hrozí, když je riziko vysoké. `null` = nic nad práh.
     *
     * Je to **varování, ne statistika**: autor si vyžádal, aby tam, kde hrozí
     * nepřírodní katastrofa s vysokou pravděpodobností, bylo vidět co. Číslo
     * se neukazuje — hráč nepotřebuje vědět, že riziko je 187, potřebuje vědět,
     * že tady chybí hasiči.
     */
    risk: string | null = null,
  ): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    // Otevřený smí být jen jeden panel (`ui/sheets.ts`): karta parcely se
    // jinak položila přes otevřenou kasu a texty se slily.
    closeOtherSheets(this);
    this.root.replaceChildren();
    this.root.classList.remove('is-hidden');

    const title = building
      ? definition
        ? t(definition.name)
        : building.definitionId
      : t('ui.info.emptyParcel');

    this.root.append(sheetHeader(title, t('ui.common.close'), () => this.hide()));

    // **Dva sloupce, ne nudle se scrollbarem.** Monitory jsou širokoúhlé
    // a panel byl svislý pruh, ve kterém se rolovalo i u malého domu.
    // Vlevo budova, vpravo parcela. Bez budovy zbude jeden sloupec.
    const columns = el('div', 'sheet__cols');
    const left = el('div', 'sheet__col');
    const right = el('div', 'sheet__col');
    this.root.appendChild(columns);

    // Diagnostika parcely je pod každou budovou i pod prázdným polem — to je
    // ta část, ze které se hráč dozví, **proč** se tu nic neděje (§12).
    if (!building) {
      this.root.classList.add('sheet--single');
      columns.appendChild(right);
      this.appendParcel(right, parcel, blocker, risk);
      return;
    }

    this.root.classList.remove('sheet--single');
    columns.append(left, right);

    if (!definition) {
      // Budova z chybějícího modu — save ji drží, ale nevíme o ní nic (§8).
      left.appendChild(el('p', 'sheet__note', t('ui.info.unknownDefinition')));
      this.appendParcel(right, parcel, blocker, risk);
      return;
    }

    // Obrázek budovy nahoře. Je to totéž, co hráč vidí na mapě, takže si
    // kartičku spojí s domem, na který klikl.
    if (spriteUrl !== null) {
      const shot = el('div', 'sheet__portrait');
      const image = el('img', 'sheet__portrait-image');
      image.src = spriteUrl;
      image.alt = '';
      // Chybějící obrázek nesmí rozbít panel — kreslí se kvádr a je to (P5).
      image.addEventListener('error', () => shot.remove());
      shot.appendChild(image);
      left.appendChild(shot);
    }

    left.appendChild(el('p', 'sheet__note', t(definition.description)));

    const rows: [string, string][] = [
      ['ui.info.position', `${building.x}, ${building.y}`],
      ['ui.info.footprint', `${definition.footprint[0]} × ${definition.footprint[1]}`],
      ['ui.info.level', String(building.level)],
      ['ui.info.built', t('ui.hud.date', dateParts(building.builtAtTick))],
      ['ui.info.cost', formatNumber(definition.construction.cost)],
    ];

    if (building.population > 0) rows.push(['ui.hud.population', formatNumber(building.population)]);
    if (building.jobs > 0) rows.push(['ui.hud.jobs', formatNumber(building.jobs)]);

    const production = definition.power?.production ?? 0;
    const consumption = definition.power?.consumption ?? 0;
    if (production > 0) rows.push(['ui.info.powerProduction', formatNumber(production)]);
    if (consumption > 0) rows.push(['ui.info.powerConsumption', formatNumber(consumption)]);
    rows.push([
      'ui.info.powered',
      building.powered ? t('ui.info.poweredYes') : t('ui.info.poweredNo'),
    ]);
    // Trafostanice: kolik přes ni teče proti tomu, co unese (T136).
    const transformer = world.transformerLoad.get(building.id);
    if (transformer) {
      rows.push([
        'ui.info.transformerLoad',
        transformer.overloaded
          ? t('ui.info.transformerOverloaded', {
              load: formatNumber(transformer.load),
              capacity: formatNumber(transformer.capacity),
            })
          : `${formatNumber(transformer.load)} / ${formatNumber(transformer.capacity)}`,
      ]);
    } else if ((definition.power?.transformer ?? 0) > 0) {
      rows.push(['ui.info.transformerLoad', `0 / ${formatNumber(definition.power?.transformer ?? 0)}`]);
    }

    // Co budova zpracuje. Bez tohohle řádku byla spalovna k nerozeznání od
    // kůlny: karta o ní neřekla vůbec nic a hráč neměl jak zjistit, jestli mu
    // kapacita stačí. Vedle čísla stojí, kolik toho město dělá — samotná
    // kapacita je bez měřítka k ničemu.
    const wasteCapacity = definition.waste?.capacity ?? 0;
    const sewageCapacity = definition.sewage?.capacity ?? 0;
    const waterProduction = definition.water?.production ?? 0;
    const waterRange = definition.water?.range ?? 0;
    const city = this.utilities();
    if (wasteCapacity > 0) {
      rows.push([
        'ui.info.wasteCapacity',
        `${formatNumber(wasteCapacity)} / ${formatNumber(city.wasteNeeded)}`,
      ]);
    }
    if (sewageCapacity > 0) {
      rows.push([
        'ui.info.sewageCapacity',
        `${formatNumber(sewageCapacity)} / ${formatNumber(city.sewageNeeded)}`,
      ]);
    }
    if (waterProduction > 0) {
      rows.push([
        'ui.info.waterProduction',
        `${formatNumber(waterProduction)} / ${formatNumber(city.waterNeeded)}`,
      ]);
    }
    if (waterRange > 0) rows.push(['ui.info.waterRange', formatNumber(waterRange)]);

    const tax = buildingMonthlyTax(world, definition, building, this.balance);
    const upkeep = buildingMonthlyUpkeep(world, this.balance, definition, building);
    rows.push(['ui.info.monthlyIncome', `+${formatNumber(tax)}`]);
    rows.push(['ui.info.monthlyUpkeep', `−${formatNumber(upkeep)}`]);
    rows.push(['ui.info.monthlyNet', formatNumber(tax - upkeep)]);

    if (definition.environment?.pollution) {
      rows.push(['ui.info.pollution', formatNumber(definition.environment.pollution)]);
    }

    // Prerekvizity ukazujeme, jen když nějaké jsou — vanilla obsah 2a je nemá,
    // ale mod ano a hráč musí vědět, na čem budova stojí (§7).
    const requirements = definition.requirements;
    if (requirements) {
      const parts = [
        ...Object.keys(requirements.services)
          .sort()
          .map((cls) => `${t(`ui.service.${cls}`)} ≥ ${requirements.services[cls] ?? 0}`),
        ...requirements.buildings,
      ];
      if (parts.length > 0) rows.push(['ui.info.requirements', parts.join(', ')]);
    }

    const list = el('dl', 'sheet__list');
    for (const [labelKey, value] of rows) {
      list.appendChild(el('dt', undefined, t(labelKey)));
      list.appendChild(el('dd', undefined, value));
    }
    left.appendChild(list);

    /*
     * Varování rovnou na kartě té budovy, které se to týká.
     *
     * Číslo „300 / 1240" je pravda, ale hráč nemá povinnost si ho přepočítat.
     * Autor se právem ptal: „a kde se dozvím, že není kapacita čištění?"
     * Tady, červeně, s tím, co s tím dělat.
     */
    const over: string[] = [];
    if (wasteCapacity > 0 && city.wasteNeeded > city.wasteCapacity) over.push('ui.info.wasteOver');
    if (sewageCapacity > 0 && city.sewageNeeded > city.sewageCapacity) {
      over.push('ui.info.sewageOver');
    }
    if (waterProduction > 0 && city.waterNeeded > city.waterCapacity) over.push('ui.info.waterOver');
    for (const key of over) {
      left.appendChild(
        el(
          'p',
          'sheet__warning',
          t(key, {
            capacity: formatNumber(
              key === 'ui.info.wasteOver'
                ? city.wasteCapacity
                : key === 'ui.info.sewageOver'
                  ? city.sewageCapacity
                  : city.waterCapacity,
            ),
            needed: formatNumber(
              key === 'ui.info.wasteOver'
                ? city.wasteNeeded
                : key === 'ui.info.sewageOver'
                  ? city.sewageNeeded
                  : city.waterNeeded,
            ),
          }),
        ),
      );
    }

    /*
     * Odpočet chátrání.
     *
     * Budova pod prahem nespadne hned — drží lhůtu, která roste s její
     * velikostí (`downgradeGrace`). Bez tohohle řádku o tom hráč neví vůbec
     * a povýšený dům mu prostě jednou zmizí. Tady vidí, že se něco děje,
     * a hlavně **kolik času má na nápravu**.
     */
    const waiting = world.downgradeStreak.get(building.id) ?? 0;
    if (waiting > 0) {
      const grace = downgradeGrace(this.balance, definition);
      const months = Math.max(
        1,
        Math.round(((grace - waiting) * LEVEL_INTERVAL * 12) / TICKS_PER_YEAR),
      );
      left.appendChild(
        el(
          'p',
          'sheet__warning',
          t(building.level > 1 ? 'ui.info.decayWarning' : 'ui.info.decayWarningLast', { months }),
        ),
      );
    }

    if (building.abandoned) {
      left.appendChild(el('p', 'sheet__warning', t('ui.info.abandonedWarning')));
    } else if (!building.powered && consumption > 0) {
      left.appendChild(el('p', 'sheet__warning', t('ui.info.noPowerWarning')));
    }

    // Čerpací stanice je **relé, ne zdroj**: sama vodu nevyrábí, jen prodlužuje
    // dosah sítě — a to jen tehdy, když k ní voda po potrubí doteče. Stanice
    // položená o jedinou dlaždici za hranicí dosahu nedělá vůbec nic a vypadá
    // úplně stejně jako fungující. Přesně na tom uvízlo město autora.
    if (isIdleRelay(world, definition, building)) {
      left.appendChild(el('p', 'sheet__warning', t('ui.info.dryRelayWarning')));
    }

    this.appendParcel(right, parcel, blocker, risk);
  }

  /**
   * Náhled povrchu: kosočtverec s texturou a jméno materiálu.
   *
   * Kosočtverec, ne čtverec — dlaždice je na mapě kosočtverec 2 : 1 a náhled
   * má ukazovat **tu parcelu**, ne obrázek, ze kterého se kreslí. Ořez dělá
   * `clip-path`, takže se nemusí vyrábět druhá sada obrázků.
   *
   * Bez obrázku zůstane jméno. Chybějící obrázek nesmí hru zastavit (P5).
   */
  private appendSurface(parent: HTMLElement, terrain: number): void {
    const key = TERRAIN_KEYS[terrain];
    if (key === undefined) return;

    const row = el('div', 'sheet__surface');
    const url = this.tileImage(terrain);
    if (url !== undefined) {
      const tile = el('div', 'sheet__surface-tile');
      tile.style.backgroundImage = cssUrl(url);
      row.appendChild(tile);
    }
    row.appendChild(el('span', 'sheet__surface-name', this.i18n.t(`ui.terrain.${key}`)));
    parent.appendChild(row);
  }

  /**
   * Rozpis parcely: cena půdy po sčítancích, dosah silnice a poptávka.
   *
   * Tohle je podle §12 jediná věc, která z fáze 2 dělá hru místo tabulky —
   * pět neviditelných veličin jinak hráč nemá jak přečíst.
   */
  private appendParcel(
    parent: HTMLElement,
    parcel: ParcelExplanation,
    blocker: string | null,
    risk: string | null,
  ): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);

    parent.appendChild(el('h3', 'sheet__subtitle', t('ui.parcel.title')));
    this.appendSurface(parent, parcel.terrain);

    const road = ROAD_KEYS[parcel.road];
    if (road !== undefined) {
      const row = el('div', 'sheet__surface');
      const badge = el('div', 'sheet__surface-tile sheet__surface-tile--road');
      row.append(badge, el('span', 'sheet__surface-name', t(`ui.road.${road}`)));
      parent.appendChild(row);
    }

    // Nejdřív odpověď na otázku, se kterou sem hráč přišel: proč se tu nestaví.
    // Teprve pod ní čísla, ze kterých se to dá odvodit.
    if (blocker !== null) {
      parent.appendChild(el('p', 'sheet__warning', t(blocker)));
    }

    // Hned za tím, co se **teprve stane**. Katastrofa se ohlásí, až uhodí;
    // tohle je jediné místo, kde jde přečíst, že se na ni čtvrť sama nachystala.
    if (risk !== null) {
      parent.appendChild(
        el('p', 'sheet__warning', t('ui.parcel.risk', { name: t(`ui.disaster.${risk}`) })),
      );
    }

    // **Co má strop, dostane pruh.** Cena půdy, spokojenost i dosah silnice
    // mají známé maximum, takže se dá ukázat, jestli je číslo dobré. Poloha
    // ani poptávka strop nemají a zůstávají textem.
    parent.appendChild(
      meter(
        t('ui.overlay.landValue'),
        String(parcel.landValue.current),
        parcel.landValue.current / BYTE_MAX,
      ),
    );
    parent.appendChild(
      meter(
        t('ui.overlay.happiness'),
        formatPercent(Math.round((parcel.happiness / BYTE_MAX) * 100)),
        parcel.happiness / BYTE_MAX,
      ),
    );

    // Dosah silnice — nejčastější důvod, proč zóna zůstane prázdná. Nula
    // znamená „parcela z losu vypadne", a to je vidět na prázdném pruhu.
    parent.appendChild(
      meter(
        t('ui.parcel.road'),
        parcel.roadDistance === null
          ? t('ui.parcel.roadTooFar')
          : t('ui.parcel.roadTiles', { distance: parcel.roadDistance }),
        parcel.roadDistance === null ? 0 : parcel.roadFactor,
      ),
    );

    // Dostupnost práce: druhá brzda, kterou hráč nevidí nikde jinde.
    parent.appendChild(
      meter(
        t('ui.parcel.jobAccess'),
        formatPercent(Math.round(parcel.jobAccessFactor * 100)),
        parcel.jobAccessFactor,
      ),
    );

    // Voda je **ano/ne**, ne stupnice. Pruh na dvě polohy by lhal o tom, že
    // existuje „skoro voda".
    const water = el('div', 'gauge gauge--flag');
    water.appendChild(el('span', 'gauge__label', t('ui.parcel.water')));
    water.appendChild(
      el(
        'span',
        `gauge__flag ${parcel.water ? 'is-high' : 'is-low'}`,
        t(parcel.water ? 'ui.parcel.waterYes' : 'ui.parcel.waterNo'),
      ),
    );
    parent.appendChild(water);

    // Elektřina stejně: ano/ne.
    const power = el('div', 'gauge gauge--flag');
    power.appendChild(el('span', 'gauge__label', t('ui.parcel.power')));
    power.appendChild(
      el(
        'span',
        `gauge__flag ${parcel.power ? 'is-high' : 'is-low'}`,
        t(parcel.power ? 'ui.parcel.powerYes' : parcel.powerBlockedByRuin ? 'ui.parcel.powerRuin' : 'ui.parcel.powerNo'),
      ),
    );
    parent.appendChild(power);

    // Vedení na dlaždici: typ a vytížení proti kapacitě (T136).
    const wire = parcel.wire;
    if (wire !== null) {
      const kind = t(wire.type === 2 ? 'ui.tool.wire.high' : 'ui.tool.wire.low');
      const state = wire.overloaded
        ? t('ui.parcel.wireOverloaded', { load: formatNumber(wire.load), capacity: formatNumber(wire.capacity) })
        : wire.live
          ? t('ui.parcel.wireLoad', { load: formatNumber(wire.load), capacity: formatNumber(wire.capacity) })
          : t('ui.parcel.wireDead', { capacity: formatNumber(wire.capacity) });
      parent.appendChild(
        meter(kind, state, wire.live ? Math.min(1, wire.load / Math.max(1, wire.capacity)) : 0),
      );
    }

    const rows: [string, string][] = [['ui.info.position', `${parcel.x}, ${parcel.y}`]];
    if (parcel.demand !== null) rows.push(['ui.hud.demand', formatNumber(parcel.demand)]);
    if (parcel.levels.nextThreshold !== null) {
      rows.push([
        'ui.parcel.nextLevel',
        formatNumber(
          Math.round(Math.max(0, parcel.levels.nextThreshold - parcel.levels.demandRelief)),
        ),
      ]);
    }

    const list = el('dl', 'sheet__list');
    for (const [labelKey, value] of rows) {
      list.appendChild(el('dt', undefined, t(labelKey)));
      list.appendChild(el('dd', undefined, value));
    }
    parent.appendChild(list);

    this.appendServices(parent, parcel);

    parent.appendChild(el('h3', 'sheet__subtitle', t('ui.parcel.landValueTitle')));

    // Rozpis ceny půdy: z čeho se to číslo skládá.
    const breakdown = el('dl', 'sheet__list sheet__list--breakdown');
    for (const term of parcel.landValue.terms) {
      const keys = landValueTermKeys(term.source);
      const label = t(keys.find((key) => this.i18n.has(key)) ?? (keys.at(-1) as string));

      breakdown.appendChild(el('dt', undefined, label));
      const amount = Math.round(term.amount);
      // **Plus jen tam, kde je to příplatek.** Základ není přírůstek proti
      // ničemu, je to výchozí hodnota, a „+40" u něj svádí číst ho jako bonus.
      // Ostatní sčítance příplatek jsou, takže znaménko nesou — záporné navíc
      // červeně, protože to je ta polovina, kterou hráč hledá.
      const base = term.source === 'base';
      const sign = base ? '' : amount < 0 ? '−' : '+';
      breakdown.appendChild(
        el(
          'dd',
          amount < 0 ? 'is-negative' : undefined,
          `${sign}${formatNumber(Math.abs(amount))}`,
        ),
      );
    }
    // Součet je **absolutní hodnota**, ne přírůstek, takže taky bez plus.
    const target = Math.round(parcel.landValue.raw);
    breakdown.appendChild(el('dt', 'sheet__total', t('ui.parcel.target')));
    breakdown.appendChild(
      el(
        'dd',
        target < 0 ? 'sheet__total is-negative' : 'sheet__total',
        formatNumber(target),
      ),
    );
    parent.appendChild(breakdown);
  }

  /**
   * Pokrytí službami: **ikona a pruh**, ne řádek tabulky.
   *
   * Hráč se ptá „mám tu dost škol?", ne „kolik je 137". Ikona je tatáž, jakou
   * má tlačítko v paletě a vrstva dosahu, takže se to spojí samo. Rozhodnutí
   * autora — „děláme hru, ne informační systém města".
   *
   * Třídy bez jediné budovy se **vynechávají**: nula u služby, kterou město
   * zatím nemá, není informace, jen šum.
   */
  private appendServices(parent: HTMLElement, parcel: ParcelExplanation): void {
    const present = parcel.coverage.filter((entry) => entry.value > 0);
    if (present.length === 0) return;

    parent.appendChild(
      el('h3', 'sheet__subtitle', this.i18n.t('ui.parcel.servicesTitle')),
    );

    const list = el('div', 'services');
    for (const entry of [...present].sort((a, b) => b.value - a.value)) {
      const row = el('div', 'services__row');
      const icon = iconSvg(`coverage-${entry.serviceClass}`);
      icon.classList.add('services__icon');
      row.appendChild(icon);

      const label = this.i18n.t(`ui.service.${entry.serviceClass}`);
      row.appendChild(el('span', 'services__label', label));

      const share = entry.value / BYTE_MAX;
      const track = el('div', 'gauge__track');
      const fill = el('div', `gauge__fill ${gradeOf(share)}`);
      fill.style.width = `${Math.round(share * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);

      row.appendChild(el('span', 'gauge__value', formatPercent(Math.round(share * 100))));
      list.appendChild(row);
    }
    parent.appendChild(list);
  }
}
