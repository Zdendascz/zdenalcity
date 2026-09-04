import { el } from './dom';

/**
 * Hlášení chyb.
 *
 * Hra nesmí mlčet — když něco spadne nebo hráč naráží na pravidlo, musí to být
 * vidět. Opakovaná stejná hláška se nehromadí, jen si přičte počet: malování
 * silnice přes vodu by jinak vysypalo padesát bublin.
 *
 * **Provozní hlášky sem nepatří.** Dřív se ukazovalo každé odmítnutí příkazu,
 * takže tažení silnice přes už postavenou ulici vysypalo „Silnice už tady je"
 * doprostřed obrazovky. Autor to nahlásil a má pravdu: že klik na obsazenou
 * dlaždici nic neudělá, je vidět z toho, že se nic nestalo. Co která hláška je,
 * rozhoduje `ROUTINE` — je to rozhodnutí o rozhraní, ne o pravidlech, takže
 * bydlí tady a ne v `sim/`.
 *
 * Kreslí se **u pravého okraje**, ne uprostřed: uprostřed sedí kamera, karta
 * parcely i okno pohromy a hláška je všem třem přes obraz.
 */

/**
 * Odmítnutí, která se **nehlásí**: hráč se jimi trefil vedle, nic se nerozbilo.
 *
 * Poznají se podle toho, že vzniknou při běžném tažení štětcem přes město —
 * silnice už tam je, dlaždice je obsazená, mimo mapu. Všechno ostatní, včetně
 * „nemáte dost peněz" a „chybí voda", je odpověď na otázku, kterou si hráč
 * doopravdy položil, a ta se ukázat musí.
 */
export const ROUTINE_REASONS: ReadonlySet<string> = new Set([
  'error.roadExists',
  'error.pipeExists',
  'error.roadInTheWay',
  'error.rubbleInTheWay',
  'error.occupied',
  'error.occupiedFootprint',
  'error.outOfBounds',
  'error.nothingToBulldoze',
  'error.terraformNoChange',
  'error.notAZone',
  'error.notAStop',
  'error.stopAlreadyOnLine',
  'error.stopNotOnLine',
]);

/** Je tohle odmítnutí jen provozní šum? */
export function isRoutine(reason: string): boolean {
  return ROUTINE_REASONS.has(reason);
}

const AUTO_DISMISS_MS = 12000;
const MAX_VISIBLE = 6;

interface Notice {
  text: string;
  count: number;
  node: HTMLElement;
  countNode: HTMLElement;
  timer: number;
}

export class Notifications {
  private readonly root: HTMLElement;
  private readonly notices: Notice[] = [];

  constructor(parent: HTMLElement) {
    this.root = el('div', 'notifications');
    parent.appendChild(this.root);
  }

  show(text: string): void {
    const existing = this.notices.find((notice) => notice.text === text);
    if (existing) {
      existing.count++;
      existing.countNode.textContent = `×${existing.count}`;
      existing.countNode.classList.remove('is-hidden');
      this.restartTimer(existing);
      return;
    }

    const node = el('div', 'notice');
    node.appendChild(el('span', 'notice__text', text));
    const countNode = el('span', 'notice__count is-hidden', '');
    node.appendChild(countNode);

    const notice: Notice = { text, count: 1, node, countNode, timer: 0 };
    node.addEventListener('click', () => this.dismiss(notice));

    this.root.appendChild(node);
    this.notices.push(notice);
    this.restartTimer(notice);

    while (this.notices.length > MAX_VISIBLE) {
      const oldest = this.notices[0];
      if (oldest) this.dismiss(oldest);
      else break;
    }
  }

  private restartTimer(notice: Notice): void {
    globalThis.clearTimeout(notice.timer);
    notice.timer = globalThis.setTimeout(() => this.dismiss(notice), AUTO_DISMISS_MS);
  }

  private dismiss(notice: Notice): void {
    const at = this.notices.indexOf(notice);
    if (at === -1) return;
    globalThis.clearTimeout(notice.timer);
    this.notices.splice(at, 1);
    notice.node.remove();
  }
}
