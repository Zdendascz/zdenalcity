import { button, el } from './dom';

/** Prázdný řádek dělí odstavce v překladu. Text se píše jako text. */
const PARAGRAPH_BREAK = /\n{2,}/;

import { iconSvg } from './icons';
import type { I18n } from './i18n';

/**
 * Hlášení o katastrofě.
 *
 * Do T62 se běžící pohroma neohlásila **vůbec**: plánovač ji spustil, město
 * hořelo a hráč se to dozvěděl, až když se podíval na správné místo mapy.
 * Autor takhle přišel o město za dva herní roky a nedostal jedinou zprávu.
 *
 * Proto je to okno přes obrazovku a ne řádek v rohu. Katastrofa je jediná věc
 * ve hře, která **běží proti hráči a sama nepřestane**; zpráva, kterou jde
 * přehlédnout, je u ní k ničemu.
 *
 * Hra se se zobrazením **pauzne**. Není to laskavost, je to jediný způsob, jak
 * hráči dát čas přečíst si, co se děje, dřív než mu shoří další čtvrť — a hráč,
 * který si zrovna odskočil, se vrátí k pauze místo k ruině.
 */
export interface DisasterAlertCallbacks {
  /** Zavřít a hrát dál. */
  onIgnore(): void;
  /** Zavřít, srovnat kameru na místo a hrát dál. */
  onShow(x: number, y: number): void;
}

/** Co potřebuje `nextToAnnounce` vědět o běžící pohromě. */
export interface AnnounceableDisaster {
  readonly id: number;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Která z běžících pohrom se má ohlásit teď. `null`, když žádná.
 *
 * Vlastní funkce, aby šla otestovat bez DOM. Rozhoduje tři věci naráz a každá
 * se dá splést tiše:
 *
 * - **Už ohlášené se přeskočí.** Jinak by okno naskakovalo každý snímek.
 * - **Ručně spuštěné se přeskočí**, ale zapíšou se jako ohlášené — hráč na ně
 *   klikl sám a poučovat ho o nich nemá cenu.
 * - **Za jedno kolo jedna.** Druhá pohroma počká, až hráč to okno zavře, místo
 *   aby první zprávu přebila. Proto se `announced` doplňuje až venku, po tom,
 *   co se okno opravdu otevřelo.
 */
export function nextToAnnounce<T extends AnnounceableDisaster>(
  active: readonly T[],
  announced: ReadonlySet<number>,
  armedManually: Set<number>,
): T | null {
  for (const disaster of active) {
    if (announced.has(disaster.id)) continue;
    if (armedManually.has(disaster.id)) continue;
    return disaster;
  }
  return null;
}

export class DisasterAlert {
  private readonly root: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly story: HTMLElement;
  private readonly picture: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly ignore: HTMLButtonElement;
  private readonly show: HTMLButtonElement;
  private readonly i18n: I18n;
  private readonly callbacks: DisasterAlertCallbacks;
  private target: { x: number; y: number } | null = null;

  constructor(mount: HTMLElement, i18n: I18n, callbacks: DisasterAlertCallbacks) {
    this.i18n = i18n;
    this.callbacks = callbacks;

    this.root = el('div', 'dialog__backdrop alert is-hidden');
    const panel = el('div', 'dialog alert__panel');

    // **Karta, ne proužek.** Vlevo obrázek, vpravo povídání — velikostí jako
    // rozbor parcely. Rozhodnutí autora; hlášení má na starostu působit, ne
    // ho informovat. Kolik dlaždic hoří, si přečte na mapě.
    this.picture = el('div', 'alert__picture');
    this.image = el('img', 'alert__image');
    this.image.alt = '';
    // Chybějící obrázek nesmí zprávu zahodit: sloupec zmizí a zbude text.
    this.image.addEventListener('error', () => this.picture.classList.add('is-hidden'));
    this.picture.appendChild(this.image);

    const text = el('div', 'alert__text');

    const head = el('div', 'alert__head');
    this.icon = el('span', 'alert__icon');
    this.title = el('h1', 'dialog__title alert__title');
    head.append(this.icon, this.title);

    this.body = el('p', 'alert__body');
    this.story = el('div', 'alert__story');

    const actions = el('div', 'alert__actions');
    this.show = button('chip chip--primary', () => {
      const target = this.target;
      this.hide();
      if (target) this.callbacks.onShow(target.x, target.y);
    });
    this.ignore = button('chip', () => {
      this.hide();
      this.callbacks.onIgnore();
    });
    actions.append(this.show, this.ignore);

    text.append(head, this.body, this.story, actions);
    panel.append(this.picture, text);
    this.root.appendChild(panel);
    mount.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  /**
   * Ohlásí pohromu. Vrací `false`, když už jedno hlášení visí.
   *
   * Druhá katastrofa nesmí to první okno přebít — hráč by přišel o zprávu,
   * kterou ještě nestihl přečíst, a přesně tomu se tady předchází.
   */
  open(kind: string, x: number, y: number): boolean {
    if (this.isOpen) return false;

    this.target = { x, y };
    const name = this.i18n.t(`ui.disaster.${kind}`);

    this.icon.replaceChildren(iconSvg(kind));
    this.title.textContent = this.i18n.t('ui.alert.title', { name });
    this.body.textContent = this.i18n.t(`ui.alert.body.${kind}`);

    // Povídání je **jeden překlad s prázdnými řádky**, ne pole klíčů: text se
    // píše jako text a odstavce v něm jsou přirozená hranice.
    this.story.replaceChildren(
      ...this.i18n
        .t(`ui.alert.story.${kind}`)
        .split(PARAGRAPH_BREAK)
        .map((paragraph) => el('p', 'alert__paragraph', paragraph)),
    );

    this.picture.classList.remove('is-hidden');
    this.image.src = `events/${kind}.jpg`;

    this.show.textContent = this.i18n.t('ui.alert.show');
    this.ignore.textContent = this.i18n.t('ui.alert.ignore');

    this.root.classList.remove('is-hidden');
    // Ať jde okno zavřít mezerníkem nebo enterem bez sahání po myši.
    this.show.focus();
    return true;
  }

  hide(): void {
    this.root.classList.add('is-hidden');
    this.target = null;
  }
}
