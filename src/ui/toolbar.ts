import { button, el } from './dom';
import { formatNumber } from './format';
import { iconSvg } from './icons';
import type { I18n } from './i18n';
import { Menu } from './popover';
import type { ToolOption } from './tools';

/**
 * Paleta nástrojů: jedna řada ikon, obsah až po kliknutí.
 *
 * Dřív tu stálo dvacet tlačítek s texty ve třech řadách a zabíraly třetinu
 * obrazovky. Nástroje se proto sdružují do **nabídek podle typu** — silnice,
 * terén, zóny, energie, voda, každá třída služeb zvlášť. Které nástroje spolu
 * souvisí, říká obsah (`menu` v definici), ne kód (P5).
 *
 * Nabídka s jedinou položkou se nerozbaluje — z buldozeru by roleta byla jen
 * kliknutí navíc.
 */
export class Toolbar {
  private readonly root: HTMLElement;
  private readonly i18n: I18n;
  private readonly tools: readonly ToolOption[];
  private readonly onSelect: (tool: ToolOption) => void;
  private readonly menus: Menu[] = [];
  private readonly singles = new Map<string, HTMLButtonElement>();
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
    this.reflect();
  }

  private reflect(): void {
    for (const menu of this.menus) {
      menu.setSelected(menu.has(this.activeId) ? this.activeId : null);
    }
    for (const [toolId, node] of this.singles) {
      node.classList.toggle('is-active', toolId === this.activeId);
    }
  }

  private build(): void {
    this.root.replaceChildren();
    this.menus.length = 0;
    this.singles.clear();

    for (const group of groupTools(this.tools)) {
      const label = this.i18n.t(group.key);
      const first = group.tools[0];
      if (!first) continue;

      if (group.tools.length === 1) {
        // Popisek je jméno **budovy**, ne nabídky: „Klinika" hráči řekne víc než
        // „Zdravotnictví", a když je v nabídce jediná, je to totéž místo.
        const only = this.i18n.t(first.labelKey);
        const node = button('toolbar__button', () => this.onSelect(first));
        node.title = this.hint(first) === '' ? only : `${only} · ${this.hint(first)}`;
        node.setAttribute('aria-label', only);
        node.appendChild(iconSvg(first.icon));
        this.root.appendChild(node);
        this.singles.set(first.id, node);
        continue;
      }

      const menu = new Menu({ icon: group.icon, label });
      menu.setItems(
        group.tools.map((tool) => ({
          id: tool.id,
          label: this.i18n.t(tool.labelKey),
          icon: tool.icon,
          hint: this.hint(tool),
          onSelect: () => this.onSelect(tool),
        })),
      );
      this.root.appendChild(menu.root);
      this.menus.push(menu);
    }

    this.reflect();
  }

  /** Napravo od jména: cena, a když ji nástroj nemá, aspoň klávesa. */
  private hint(tool: ToolOption): string {
    const parts: string[] = [];
    if (tool.cost !== undefined && tool.cost > 0) parts.push(formatNumber(tool.cost));
    if (tool.hotkey) parts.push(tool.hotkey.toUpperCase());
    return parts.join(' · ');
  }
}

interface ToolGroup {
  key: string;
  icon: string;
  tools: ToolOption[];
}

/** Seskupí nástroje podle `groupKey`, v pořadí prvního výskytu. */
export function groupTools(tools: readonly ToolOption[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  const byKey = new Map<string, ToolGroup>();

  for (const tool of tools) {
    let group = byKey.get(tool.groupKey);
    if (!group) {
      group = { key: tool.groupKey, icon: tool.groupIcon, tools: [] };
      byKey.set(tool.groupKey, group);
      groups.push(group);
    }
    group.tools.push(tool);
  }

  return groups;
}
