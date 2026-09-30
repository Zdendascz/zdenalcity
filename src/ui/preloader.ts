import { el } from './dom';
import { formatPercent } from './format';

/**
 * Ukazatel přednačítání grafiky (T121).
 *
 * Autor: „udělej přednačítání grafik, aby se všechny načetly při spuštění hry
 * s nějakým procentuálním loaderem a netahalo se to během hry". Grafika se
 * začne stahovat hned po startu, zatímco hráč stojí na rozcestníku — tam je
 * vidět jen tenký proužek dole. Když si vybere hru dřív, než je hotovo,
 * proužek se roztáhne přes obrazovku s procenty a hra počká.
 *
 * Jen zobrazuje. Co a jak se načítá, řeší `render/preload.ts`.
 */
export class Preloader {
  private readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;
  private readonly text: string;

  constructor(parent: HTMLElement, text: string) {
    this.text = text;
    this.root = el('div', 'preloader');
    this.root.setAttribute('role', 'progressbar');
    this.root.setAttribute('aria-valuemin', '0');
    this.root.setAttribute('aria-valuemax', '100');
    this.root.setAttribute('aria-label', text);
    const track = el('div', 'preloader__track');
    this.bar = el('div', 'preloader__bar');
    track.appendChild(this.bar);
    this.label = el('div', 'preloader__label', `${text} ${formatPercent(0)}`);
    this.root.append(this.label, track);
    parent.appendChild(this.root);
  }

  /** Podíl hotového, 0–1. */
  set(progress: number): void {
    const percent = Math.floor(Math.max(0, Math.min(1, progress)) * 100);
    this.bar.style.width = `${percent}%`;
    this.label.textContent = `${this.text} ${formatPercent(percent)}`;
    this.root.setAttribute('aria-valuenow', String(percent));
  }

  /** Roztáhne se přes obrazovku — hra na grafiku čeká. */
  block(): void {
    this.root.classList.add('is-blocking');
  }

  remove(): void {
    this.root.remove();
  }
}
