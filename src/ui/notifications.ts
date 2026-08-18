import { el } from './dom';

/**
 * Hlášení problémů.
 *
 * Hra nesmí mlčet — když klik nic neudělá nebo něco spadne, musí to být vidět.
 * Opakovaná stejná hláška se nehromadí, jen si přičte počet: malování silnice
 * přes vodu by jinak vysypalo padesát bublin.
 */

export type NoticeKind = 'info' | 'error';

const AUTO_DISMISS_MS = { info: 4000, error: 12000 } as const;
const MAX_VISIBLE = 6;

interface Notice {
  text: string;
  kind: NoticeKind;
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

  show(text: string, kind: NoticeKind = 'info'): void {
    const existing = this.notices.find((notice) => notice.text === text && notice.kind === kind);
    if (existing) {
      existing.count++;
      existing.countNode.textContent = `×${existing.count}`;
      existing.countNode.classList.remove('is-hidden');
      this.restartTimer(existing);
      return;
    }

    const node = el('div', `notice notice--${kind}`);
    node.appendChild(el('span', 'notice__text', text));
    const countNode = el('span', 'notice__count is-hidden', '');
    node.appendChild(countNode);

    const notice: Notice = { text, kind, count: 1, node, countNode, timer: 0 };
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
    notice.timer = globalThis.setTimeout(() => this.dismiss(notice), AUTO_DISMISS_MS[notice.kind]);
  }

  private dismiss(notice: Notice): void {
    const at = this.notices.indexOf(notice);
    if (at === -1) return;
    globalThis.clearTimeout(notice.timer);
    this.notices.splice(at, 1);
    notice.node.remove();
  }
}
