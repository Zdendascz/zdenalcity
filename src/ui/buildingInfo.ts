import type { Balance } from '@/content/balance';
import type { Definition } from '@/content/schema';
import { buildingMonthlyTax, buildingMonthlyUpkeep } from '@/sim/systems/economy';
import type { Building, WorldState } from '@/sim/world';
import { button, el } from './dom';
import { formatNumber } from './format';
import { dateParts } from './hud';
import type { I18n } from './i18n';

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

  constructor(parent: HTMLElement, i18n: I18n, balance: Balance) {
    this.i18n = i18n;
    this.balance = balance;
    this.root = el('div', 'sheet sheet--info is-hidden');
    parent.appendChild(this.root);
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  show(world: WorldState, building: Building, definition: Definition | undefined): void {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    this.root.replaceChildren();
    this.root.classList.remove('is-hidden');

    const header = el('div', 'sheet__header');
    header.appendChild(el('h2', 'sheet__title', definition ? t(definition.name) : building.definitionId));
    const close = button('chip chip--tight', () => this.hide());
    close.textContent = '×';
    header.appendChild(close);
    this.root.append(header);

    if (!definition) {
      // Budova z chybějícího modu — save ji drží, ale nevíme o ní nic (§8).
      this.root.appendChild(el('p', 'sheet__note', t('ui.info.unknownDefinition')));
      return;
    }

    this.root.appendChild(el('p', 'sheet__note', t(definition.description)));

    const rows: [string, string][] = [
      ['ui.info.position', `${building.x}, ${building.y}`],
      ['ui.info.footprint', `${definition.footprint[0]} × ${definition.footprint[1]}`],
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

    const tax = buildingMonthlyTax(world, definition, building, this.balance);
    const upkeep = buildingMonthlyUpkeep(world, definition, building);
    rows.push(['ui.info.monthlyIncome', `+${formatNumber(tax)}`]);
    rows.push(['ui.info.monthlyUpkeep', `−${formatNumber(upkeep)}`]);
    rows.push(['ui.info.monthlyNet', formatNumber(tax - upkeep)]);

    if (definition.environment?.pollution) {
      rows.push(['ui.info.pollution', formatNumber(definition.environment.pollution)]);
    }

    const list = el('dl', 'sheet__list');
    for (const [labelKey, value] of rows) {
      list.appendChild(el('dt', undefined, t(labelKey)));
      list.appendChild(el('dd', undefined, value));
    }
    this.root.appendChild(list);

    if (!building.powered && consumption > 0) {
      this.root.appendChild(el('p', 'sheet__warning', t('ui.info.noPowerWarning')));
    }
  }
}
