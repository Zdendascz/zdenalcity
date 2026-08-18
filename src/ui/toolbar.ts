import { button, el } from './dom';
import type { I18n } from './i18n';
import type { ToolOption } from './tools';

/** Paleta nástrojů. Skupiny i popisky jdou z lokalizace, pořadí ze seznamu. */
export class Toolbar {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private readonly tools: readonly ToolOption[];
  private readonly onSelect: (tool: ToolOption) => void;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private activeId: string;

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    tools: readonly ToolOption[],
    activeId: string,
    onSelect: (tool: ToolOption) => void,
  ) {
    this.i18n = i18n;
    this.tools = tools;
    this.onSelect = onSelect;
    this.activeId = activeId;

    this.root = el('div', 'toolbar');
    parent.appendChild(this.root);

    this.build();
    i18n.onChange(() => this.build());
  }

  setActive(id: string): void {
    this.activeId = id;
    for (const [toolId, node] of this.buttons) {
      node.classList.toggle('is-active', toolId === id);
    }
  }

  private build(): void {
    this.root.replaceChildren();
    this.buttons.clear();

    let currentGroup = '';
    let group: HTMLElement | null = null;

    for (const tool of this.tools) {
      if (tool.groupKey !== currentGroup) {
        currentGroup = tool.groupKey;
        group = el('div', 'toolbar__group');
        group.appendChild(el('span', 'toolbar__group-label', this.i18n.t(tool.groupKey)));
        this.root.appendChild(group);
      }

      const node = button('toolbar__button', () => this.onSelect(tool));
      node.appendChild(el('span', 'toolbar__label', this.i18n.t(tool.labelKey)));
      if (tool.hotkey) {
        node.appendChild(el('kbd', 'toolbar__hotkey', tool.hotkey.toUpperCase()));
      }
      node.classList.toggle('is-active', tool.id === this.activeId);

      group?.appendChild(node);
      this.buttons.set(tool.id, node);
    }
  }
}
