import { button, el, setPressed } from './dom';
import { formatNumber } from './format';
import { iconSvg } from './icons';
import type { ToolbarOverflow } from './hud';
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
 *
 * Do úzkého okna se ani těch šestnáct roletek nevejde (viz `layout.ts`):
 * v liště pak zůstane jen `COMPACT_GROUPS` a zbytek čeká ve vysouvací řadě.
 *
 * Tu řadu **vlastní HUD**, ne paleta: je společná pro schované nástroje
 * i schované ovládání a otevírá je jedna trojtečka. Paleta o ní ví jen tolik,
 * kam si své nabídky pověsit a jak ji po výběru zavřít (`ToolbarOverflow`).
 */
export class Toolbar {
  readonly root: HTMLElement;

  private readonly i18n: I18n;
  private readonly tools: readonly ToolOption[];
  private readonly onSelect: (tool: ToolOption) => void;
  private readonly menus: Menu[] = [];
  private readonly singles = new Map<string, HTMLButtonElement>();
  private readonly bar: HTMLElement;
  private readonly overflow: ToolbarOverflow | null;
  private activeId: string;
  /** Schovávat nabídky do vysunuté řady? Viz `ui/layout.ts`. */
  private dense: boolean;

  constructor(
    parent: HTMLElement,
    i18n: I18n,
    tools: readonly ToolOption[],
    activeId: string,
    dense: boolean,
    overflow: ToolbarOverflow | null,
    onSelect: (tool: ToolOption) => void,
  ) {
    this.i18n = i18n;
    this.tools = tools;
    this.onSelect = onSelect;
    this.activeId = activeId;
    this.dense = dense;
    this.overflow = overflow;

    this.root = el('div', 'toolbar');
    this.bar = this.root;
    parent.appendChild(this.root);

    this.build();
    i18n.onChange(() => this.build());
  }

  setActive(id: string): void {
    this.activeId = id;
    this.reflect();
  }

  setDense(dense: boolean): void {
    if (dense === this.dense) return;
    this.dense = dense;
    this.build();
  }

  private reflect(): void {
    for (const menu of this.menus) {
      menu.setSelected(menu.has(this.activeId) ? this.activeId : null);
    }
    for (const [toolId, node] of this.singles) {
      setPressed(node, toolId === this.activeId);
    }

    // Vybraný nástroj ze **schované** řady si přebírá trojtečka: jinak by
    // v liště nesvítilo nic a hráč by nevěděl, co drží (T-revize, nález 17).
    const host = this.overflow?.host;
    const active = this.tools.find((tool) => tool.id === this.activeId);
    const hidden =
      host !== undefined &&
      active !== undefined &&
      host.contains(this.nodeOf(active.id));
    this.overflow?.setActive(
      hidden && active ? { icon: active.icon, label: this.i18n.t(active.labelKey) } : null,
    );
  }

  /** Uzel, ve kterém nástroj bydlí — vlastní tlačítko, nebo jeho nabídka. */
  private nodeOf(toolId: string): HTMLElement | null {
    const single = this.singles.get(toolId);
    if (single) return single;
    return this.menus.find((menu) => menu.has(toolId))?.root ?? null;
  }

  private inBar(tool: ToolOption): boolean {
    return COMPACT_GROUPS.includes(tool.groupKey);
  }

  private build(): void {
    this.bar.replaceChildren();
    this.overflow?.host.replaceChildren();
    this.menus.length = 0;
    this.singles.clear();

    for (const group of groupTools(this.tools)) {
      const first = group.tools[0];
      if (!first) continue;
      // Bez místa, kam schované pověsit, zůstane v liště všechno. Radši
      // zalomená lišta než nástroje, ke kterým nevede tlačítko.
      const hidden = this.dense && !this.inBar(first) && this.overflow !== null;
      this.buildGroup(group, hidden ? (this.overflow?.host ?? this.bar) : this.bar);
    }

    this.reflect();
  }

  private buildGroup(group: ToolGroup, parent: HTMLElement): void {
    const first = group.tools[0];
    if (!first) return;

    if (group.tools.length === 1) {
      // Popisek je jméno **budovy**, ne nabídky: „Klinika" hráči řekne víc než
      // „Zdravotnictví", a když je v nabídce jediná, je to totéž místo.
      const only = this.i18n.t(first.labelKey);
      const node = button('toolbar__button', () => this.pick(first));
      node.title = this.hint(first) === '' ? only : `${only} · ${this.hint(first)}`;
      node.setAttribute('aria-label', only);
      node.appendChild(iconSvg(first.icon));
      parent.appendChild(node);
      this.singles.set(first.id, node);
      return;
    }

    const menu = new Menu({ icon: group.icon, label: this.i18n.t(group.key) });
    menu.setItems(
      group.tools.map((tool) => ({
        id: tool.id,
        label: this.i18n.t(tool.labelKey),
        icon: tool.icon,
        hint: this.hint(tool),
        onSelect: () => this.pick(tool),
      })),
    );
    parent.appendChild(menu.root);
    this.menus.push(menu);
  }

  /**
   * Vybraný nástroj zavře vysunutou řadu.
   *
   * Kdo si vybral elektrárnu, chce vidět mapu a postavit ji — ne odklikávat
   * seznam, který mu na telefonu zabírá půlku obrazovky.
   */
  private pick(tool: ToolOption): void {
    this.overflow?.close();
    this.onSelect(tool);
  }

  /** Napravo od jména: cena, a když ji nástroj nemá, aspoň klávesa. */
  private hint(tool: ToolOption): string {
    const parts: string[] = [];
    if (tool.cost !== undefined && tool.cost > 0) parts.push(formatNumber(tool.cost));
    if (tool.hotkey) parts.push(tool.hotkey.toUpperCase());
    return parts.join(' · ');
  }
}

/**
 * Které nabídky zůstanou v liště i na telefonu.
 *
 * Zadání autora: „pacička, silnice, povrch, zóny a buldozer zůstane, ostatní
 * toggle nabídka". Je to zároveň všechno, čím se staví město **před** tím, než
 * má vůbec cenu řešit služby — kdo zakládá město, sáhne po silnici a zóně
 * padesátkrát, a po muzeu jednou.
 */
export const COMPACT_GROUPS: readonly string[] = [
  'ui.menu.pan',
  'ui.menu.road',
  'ui.menu.terrain',
  'ui.menu.zone',
  'ui.tool.bulldoze',
];

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
