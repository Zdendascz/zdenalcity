import type { CityAdvice } from '@/sim/advisor';
import { el } from './dom';
import { moneyParams } from './format';
import { sheetHeader } from './icons';
import type { I18n } from './i18n';
import { closeOtherSheets, registerSheet } from './sheets';

/**
 * Poradce starosty.
 *
 * Zadání autora: „klikneš a vyskočí dvě největší bolesti, které by měl řešit,
 * a jedna pochvala, co dělá dobře."
 *
 * Panel **nic nepočítá** — pořadí i naléhavost přijdou ze `sim/advisor.ts`,
 * tady se to jen vypisuje. Texty jsou ty z nápovědy (`ui.help.problem.<id>`),
 * takže poradce a nápověda nemůžou o téže věci tvrdit každý něco jiného.
 */
export class AdvisorPanel {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private visible = false;
  /** Otisk vypsané rady. Bez něj by se panel přestavoval každý snímek. */
  private drawn: string | null = null;

  constructor(parent: HTMLElement, i18n: I18n) {
    this.i18n = i18n;
    this.root = el('div', 'sheet sheet--advisor is-hidden');
    parent.appendChild(this.root);
    registerSheet(this);
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.classList.toggle('is-hidden', !this.visible);
    this.drawn = null;
    if (this.visible) closeOtherSheets(this);
    return this.visible;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('is-hidden');
    this.drawn = null;
  }

  update(advice: CityAdvice): void {
    if (!this.visible) return;

    /*
     * Otisk je **zaokrouhlená** naléhavost, ne přesná.
     *
     * Ta se hýbe každý tik o setiny a panel by se překresloval pořád dokola —
     * tlačítko pod kurzorem by zmizelo dřív, než by stihlo přijmout klik
     * (přesně tím trpěla tabulka rozpočtu). Setina naléhavosti navíc nic
     * neznamená: pořadí rad se z ní mění jednou za měsíce.
     */
    const signature = [
      advice.tooSmall ? 'small' : 'city',
      ...advice.problems.map((item) => `${item.id}:${Math.round(item.weight * 10)}`),
      `+${advice.praise?.id ?? '-'}`,
    ].join('|');
    if (signature === this.drawn) return;
    this.drawn = signature;

    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key, params);
    this.root.replaceChildren();

    this.root.appendChild(sheetHeader(t('ui.advisor.title'), t('ui.common.close'), () => this.toggle()));

    if (advice.tooSmall) {
      // **Moc malé město** není pochvala (T-revize, nález 28). Hráč se zónou,
      // ve které nic neroste, tu do teď četl „Město běží, jak má" — a přesně
      // v tu chvíli potřeboval vědět, co má být hotové, než vyroste první dům.
      this.root.appendChild(el('p', 'sheet__note', t('ui.advisor.tooSmall')));
    } else if (advice.problems.length === 0) {
      // Prázdný poradce je odpověď, ne chyba. Poradce, který vždycky něco
      // najde, se naučí hráč ignorovat.
      this.root.appendChild(el('p', 'sheet__note', t('ui.advisor.allGood')));
    } else {
      this.root.appendChild(el('h3', 'advisor__heading', t('ui.advisor.problems')));
    }

    for (const problem of advice.problems) {
      const card = el('section', 'advisor__item advisor__item--problem');
      card.appendChild(el('h4', 'advisor__name', t(`ui.help.problem.${problem.id}.title`)));

      // Doplňující čísla jsou nepovinná: chybějící klíč se nevypíše, místo
      // aby se v panelu objevil syrový `ui.advisor.detail.…`.
      const detailKey = `ui.advisor.detail.${problem.id}`;
      const detail = problem.detail ? t(detailKey, moneyParams(problem.detail)) : detailKey;
      if (detail !== detailKey) card.appendChild(el('p', 'advisor__detail', detail));

      card.appendChild(el('p', 'advisor__cause', t(`ui.help.problem.${problem.id}.cause`)));
      card.appendChild(el('p', 'advisor__fix', t(`ui.help.problem.${problem.id}.fix`)));
      this.root.appendChild(card);
    }

    if (advice.praise) {
      this.root.appendChild(el('h3', 'advisor__heading', t('ui.advisor.praiseTitle')));
      const card = el('section', 'advisor__item advisor__item--praise');
      card.appendChild(el('h4', 'advisor__name', t(`ui.advisor.praise.${advice.praise.id}.title`)));
      card.appendChild(
        el(
          'p',
          'advisor__cause',
          t(`ui.advisor.praise.${advice.praise.id}.text`, advice.praise.detail ?? {}),
        ),
      );
      this.root.appendChild(card);
    }
  }
}
