import { el } from './dom';
import type { I18n } from './i18n';

/**
 * Legenda k zapnutému diagnostickému pohledu.
 *
 * Bez ní je barevná mapa hádanka. Autor to shrnul takhle: „z těch pohledů
 * znečištění, spokojenosti atd není v podstatě co poznat… ať člověk ví, co má
 * dělat." Samotná škála zelená–rudá tu otázku zodpoví jen tehdy, když je vedle
 * ní napsáno, který konec je který — a u mapy dosahu ještě, co znamená ta bílá
 * čára.
 *
 * Kreslí se **jen když je pohled zapnutý**. Trvale viditelná legenda by zabírala
 * roh obrazovky i ve chvíli, kdy se hráč dívá na město.
 */

/** Barvy stupnice. Musí sedět s `HEAT_STOPS` v paletě — proto se předávají. */
export interface LegendScale {
  stops: readonly number[];
  worstKey: string;
  bestKey: string;
}

export class Legend {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;

  constructor(parent: HTMLElement, i18n: I18n) {
    this.i18n = i18n;
    this.root = el('div', 'legend is-hidden');
    parent.appendChild(this.root);
  }

  hide(): void {
    this.root.classList.add('is-hidden');
    this.root.replaceChildren();
  }

  /** Tepelná mapa: pruh se stupnicí a popiskem obou konců. */
  showHeat(titleKey: string, scale: LegendScale): void {
    this.root.replaceChildren();
    this.root.classList.remove('is-hidden');
    this.root.appendChild(el('div', 'legend__title', this.i18n.t(titleKey)));

    const bar = el('div', 'legend__bar');
    // Přechod se skládá ze stejných barev jako mapa. Kdyby se napsal do CSS,
    // rozešel by se s ní při první změně palety.
    const stops = scale.stops.map(
      (color, i) => `${hex(color)} ${(i / (scale.stops.length - 1)) * 100}%`,
    );
    bar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    this.root.appendChild(bar);

    const ends = el('div', 'legend__ends');
    ends.appendChild(el('span', '', this.i18n.t(scale.worstKey)));
    ends.appendChild(el('span', '', this.i18n.t(scale.bestKey)));
    this.root.appendChild(ends);
  }

  /**
   * Pohled na elektřinu: dvě barvy a nic, co by je vysvětlilo.
   *
   * Do teď neměl legendu vůbec — tepelné mapy ji dostaly, protože mají
   * stupnici, jenže elektřina není stupnice, a tak vypadla. Autor to shrnul
   * takhle: „z toho přehledu elektřiny absolutně nic nepochopím a nevím, co to
   * ukazuje, co je dobře, co špatně." Podstatná je i ta třetí položka: co
   * není silnice ani budova, proud nevede a zůstává nebarevné.
   */
  showSwatches(titleKey: string, rows: readonly (readonly [string, string])[]): void {
    this.root.replaceChildren();
    this.root.classList.remove('is-hidden');
    this.root.appendChild(el('div', 'legend__title', this.i18n.t(titleKey)));

    for (const [modifier, key] of rows) {
      const row = el('div', 'legend__row');
      row.appendChild(el('span', `legend__swatch legend__swatch--${modifier}`, ''));
      row.appendChild(el('span', 'legend__label', this.i18n.t(key)));
      this.root.appendChild(row);
    }
  }

  /** Mapa dosahu: co znamená plocha a co obě bílé čáry. */
  showCoverage(titleKey: string): void {
    this.root.replaceChildren();
    this.root.classList.remove('is-hidden');
    this.root.appendChild(el('div', 'legend__title', this.i18n.t(titleKey)));

    for (const [modifier, key] of [
      ['area', 'ui.legend.coverage.area'],
      ['good', 'ui.legend.coverage.good'],
      ['edge', 'ui.legend.coverage.edge'],
    ] as const) {
      const row = el('div', 'legend__row');
      row.appendChild(el('span', `legend__swatch legend__swatch--${modifier}`, ''));
      row.appendChild(el('span', 'legend__label', this.i18n.t(key)));
      this.root.appendChild(row);
    }
  }
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
