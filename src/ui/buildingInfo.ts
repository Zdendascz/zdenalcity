import type { Balance } from '@/content/balance';
import type { Definition } from '@/content/schema';
import type { ParcelExplanation } from '@/sim/diagnostics';
import { buildingMonthlyTax, buildingMonthlyUpkeep } from '@/sim/systems/economy';
import type { Building, WorldState } from '@/sim/world';
import { TERRAIN } from '@/sim/layers';
import { iconSvg } from './icons';
import { button, el } from './dom';
import { formatNumber, landValueTermKeys } from './format';
import { dateParts } from './hud';
import type { I18n } from './i18n';

/**
 * Jméno povrchu pro překlad a pro obrázek. Index je hodnota vrstvy `terrain`,
 * takže to musí sedět na `TERRAIN` v `sim/layers.ts` — na pořadí, ne na jméno
 * konstanty.
 */
const TERRAIN_KEYS: Readonly<Record<number, string>> = {
  [TERRAIN.grass]: 'grass',
  [TERRAIN.water]: 'water',
  [TERRAIN.sand]: 'sand',
  [TERRAIN.rock]: 'rock',
  [TERRAIN.forest]: 'forest',
  [TERRAIN.marsh]: 'marsh',
};

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

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    balance: Balance,
    tileImage: (terrain: number) => string | undefined = () => undefined,
  ) {
    this.i18n = i18n;
    this.balance = balance;
    this.tileImage = tileImage;
    this.root = el('div', 'sheet sheet--info is-hidden');
    parent.appendChild(this.root);
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
     * Soubor obrázku, kterým se budova zrovna kreslí. **Dočasné** — autor si
     * podle něj kontroluje vygenerované sprity ručně, protože se v terénu
     * chovají různě a od pohledu nejde poznat, která varianta padla.
     */
    spriteFile: string | null = null,
  ): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    this.root.replaceChildren();
    this.root.classList.remove('is-hidden');

    const title = building
      ? definition
        ? t(definition.name)
        : building.definitionId
      : t('ui.info.emptyParcel');

    const header = el('div', 'sheet__header');
    header.appendChild(el('h2', 'sheet__title', title));
    const close = button('chip chip--tight', () => this.hide());
    close.appendChild(iconSvg('close'));
    header.appendChild(close);
    this.root.append(header);

    // Diagnostika parcely je pod každou budovou i pod prázdným polem — to je
    // ta část, ze které se hráč dozví, **proč** se tu nic neděje (§12).
    if (!building) {
      this.appendParcel(parcel, blocker);
      return;
    }

    if (!definition) {
      // Budova z chybějícího modu — save ji drží, ale nevíme o ní nic (§8).
      this.root.appendChild(el('p', 'sheet__note', t('ui.info.unknownDefinition')));
      return;
    }

    this.root.appendChild(el('p', 'sheet__note', t(definition.description)));

    const rows: [string, string][] = [
      ['ui.info.position', `${building.x}, ${building.y}`],
      ['ui.info.footprint', `${definition.footprint[0]} × ${definition.footprint[1]}`],
      ['ui.info.level', String(building.level)],
      ['ui.info.built', t('ui.hud.date', dateParts(building.builtAtTick))],
      ['ui.info.cost', formatNumber(definition.construction.cost)],
    ];

    if (spriteFile !== null) rows.push(['ui.info.spriteFile', spriteFile]);

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

    const tax = buildingMonthlyTax(world, definition, building, this.balance);
    const upkeep = buildingMonthlyUpkeep(world, definition, building);
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
    this.root.appendChild(list);

    if (building.abandoned) {
      this.root.appendChild(el('p', 'sheet__warning', t('ui.info.abandonedWarning')));
    } else if (!building.powered && consumption > 0) {
      this.root.appendChild(el('p', 'sheet__warning', t('ui.info.noPowerWarning')));
    }

    // Čerpací stanice je **relé, ne zdroj**: sama vodu nevyrábí, jen prodlužuje
    // dosah sítě — a to jen tehdy, když k ní voda po potrubí doteče. Stanice
    // položená o jedinou dlaždici za hranicí dosahu nedělá vůbec nic a vypadá
    // úplně stejně jako fungující. Přesně na tom uvízlo město autora.
    if (isIdleRelay(world, definition, building)) {
      this.root.appendChild(el('p', 'sheet__warning', t('ui.info.dryRelayWarning')));
    }

    this.appendParcel(parcel, blocker);
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
  private appendSurface(terrain: number): void {
    const key = TERRAIN_KEYS[terrain];
    if (key === undefined) return;

    const row = el('div', 'sheet__surface');
    const url = this.tileImage(terrain);
    if (url !== undefined) {
      const tile = el('div', 'sheet__surface-tile');
      tile.style.backgroundImage = `url(${url})`;
      row.appendChild(tile);
    }
    row.appendChild(el('span', 'sheet__surface-name', this.i18n.t(`ui.terrain.${key}`)));
    this.root.appendChild(row);
  }

  /**
   * Rozpis parcely: cena půdy po sčítancích, dosah silnice a poptávka.
   *
   * Tohle je podle §12 jediná věc, která z fáze 2 dělá hru místo tabulky —
   * pět neviditelných veličin jinak hráč nemá jak přečíst.
   */
  private appendParcel(parcel: ParcelExplanation, blocker: string | null): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);

    this.root.appendChild(el('h3', 'sheet__subtitle', t('ui.parcel.title')));
    this.appendSurface(parcel.terrain);

    // Nejdřív odpověď na otázku, se kterou sem hráč přišel: proč se tu nestaví.
    // Teprve pod ní čísla, ze kterých se to dá odvodit.
    if (blocker !== null) {
      this.root.appendChild(el('p', 'sheet__warning', t(blocker)));
    }

    const rows: [string, string][] = [
      ['ui.info.position', `${parcel.x}, ${parcel.y}`],
      ['ui.overlay.landValue', `${parcel.landValue.current}`],
      ['ui.overlay.happiness', `${Math.round((parcel.happiness / 255) * 100)} %`],
    ];

    // Voda: druhá podmínka, bez které se nestaví, a na rozdíl od silnice není
    // na mapě vidět vůbec.
    rows.push([
      'ui.parcel.water',
      t(parcel.water ? 'ui.parcel.waterYes' : 'ui.parcel.waterNo'),
    ]);

    // Dosah silnice — nejčastější důvod, proč zóna zůstane prázdná.
    rows.push([
      'ui.parcel.road',
      parcel.roadDistance === null
        ? t('ui.parcel.roadTooFar')
        : t('ui.parcel.roadDistance', {
            distance: parcel.roadDistance,
            factor: Math.round(parcel.roadFactor * 100),
          }),
    ]);

    // Dostupnost práce: druhý nejčastější důvod, proč se čtvrť zadrhne. Čísla
    // ukazujeme vždycky, i když jsou to jedničky — jinak by hráč nevěděl, že
    // tahle brzda vůbec existuje.
    rows.push([
      'ui.parcel.jobAccess',
      t('ui.parcel.jobAccessFactors', {
        cell: Math.round(parcel.jobAccessFactor * 100),
        city: Math.round(parcel.cityJobAccessFactor * 100),
      }),
    ]);

    if (parcel.demand !== null) rows.push(['ui.hud.demand', formatNumber(parcel.demand)]);
    if (parcel.levels.nextThreshold !== null) {
      rows.push([
        'ui.parcel.nextLevel',
        formatNumber(Math.round(Math.max(0, parcel.levels.nextThreshold - parcel.levels.demandRelief))),
      ]);
    }

    const list = el('dl', 'sheet__list');
    for (const [labelKey, value] of rows) {
      list.appendChild(el('dt', undefined, t(labelKey)));
      list.appendChild(el('dd', undefined, value));
    }
    this.root.appendChild(list);

    // Rozpis ceny půdy: z čeho se to číslo skládá.
    const breakdown = el('dl', 'sheet__list sheet__list--breakdown');
    for (const term of parcel.landValue.terms) {
      const keys = landValueTermKeys(term.source);
      const label = t(keys.find((key) => this.i18n.has(key)) ?? (keys.at(-1) as string));

      breakdown.appendChild(el('dt', undefined, label));
      const amount = Math.round(term.amount);
      // Typografické znaménko, ať se rozpis nerozchází se zbytkem UI.
      breakdown.appendChild(
        el(
          'dd',
          amount < 0 ? 'is-negative' : undefined,
          `${amount < 0 ? '−' : '+'}${formatNumber(Math.abs(amount))}`,
        ),
      );
    }
    breakdown.appendChild(el('dt', 'sheet__total', t('ui.parcel.target')));
    breakdown.appendChild(el('dd', 'sheet__total', formatNumber(Math.round(parcel.landValue.raw))));
    this.root.appendChild(breakdown);
  }
}
