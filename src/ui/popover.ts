import { button, el } from './dom';
import { iconSvg } from './icons';

/**
 * Tlačítko, které rozbalí panel.
 *
 * Celé rozhraní stojí na téhle jedné věci: v liště je vidět **jen ikona**
 * a obsah se objeví, až když ho hráč chce. Předtím zabíraly nástroje, overlaye
 * a všechny panely většinu obrazovky a ze hry byla vidět jen škvíra.
 *
 * Otevřený je vždycky nejvýš jeden panel. Dva zároveň by se překrývaly a hráč
 * by musel zavírat ručně; takhle mu stačí kliknout jinam.
 */
const open = new Set<Popover>();
let listening = false;

function closeOthers(keep: Popover | null): void {
  for (const popover of [...open]) {
    if (popover !== keep) popover.close();
  }
}

function startListening(): void {
  if (listening) return;
  listening = true;

  // `pointerdown` a ne `click`: kliknutí do mapy se zpracuje na stisknutí,
  // takže by se panel zavíral až po tom, co hráč nechtěně něco postavil.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return closeOthers(null);
    for (const popover of open) {
      if (popover.contains(target)) return;
    }
    closeOthers(null);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeOthers(null);
  });
}

export interface PopoverOptions {
  /** Jméno ikony na tlačítku. */
  icon: string;
  /** Už přeložený popisek do tooltipu a vedle ikony. */
  label: string;
  /** Ukázat popisek i v liště, ne jen v tooltipu. */
  showLabel?: boolean;
  /** Doplňková třída na kořen, kvůli barvám. */
  className?: string;
  /**
   * Nechat na tlačítku pořád tutéž ikonu.
   *
   * U nástrojů se ikona mění na to, co má hráč v ruce — to je smysl. U nabídky
   * vrstev to ale znamenalo, že se z tlačítka „Vrstvy" stal blesk a nebylo
   * poznat, že je to pořád ta nabídka. Hlásil to autor: zapnul elektřinu
   * a neměl jak ji vypnout.
   */
  lockIcon?: boolean;
  /**
   * Položka, která znamená „nic vybráno". Tlačítko se u ní nerozsvítí, ale
   * v seznamu je vidět jako zvolená.
   */
  neutralId?: string;
}

export class Popover {
  readonly root: HTMLElement;
  readonly panel: HTMLElement;
  /**
   * Tlačítko, které panel otevírá.
   *
   * Veřejné kvůli statistikám na telefonu: autor si vyžádal, aby **kasa
   * a bilance samy byly tím tlačítkem** místo ikonky grafu vedle nich. Volající
   * si obsah tlačítka přepíše; otevírání zůstává na Popoveru.
   */
  readonly trigger: HTMLButtonElement;
  private readonly iconSlot: HTMLElement;
  private isOpen = false;

  constructor(options: PopoverOptions) {
    startListening();

    this.root = el('div', `popover${options.className ? ` ${options.className}` : ''}`);
    this.trigger = button('popover__trigger', () => this.toggle());
    this.trigger.title = options.label;
    this.trigger.setAttribute('aria-label', options.label);

    this.iconSlot = el('span', 'popover__icon');
    this.iconSlot.appendChild(iconSvg(options.icon));
    this.trigger.appendChild(this.iconSlot);
    if (options.showLabel) {
      this.trigger.appendChild(el('span', 'popover__label', options.label));
    }

    this.panel = el('div', 'popover__panel is-hidden');
    this.root.append(this.trigger, this.panel);
  }

  /** Ikona na tlačítku — mění se podle toho, co má hráč zrovna v ruce. */
  setIcon(name: string): void {
    this.iconSlot.replaceChildren(iconSvg(name));
  }

  setActive(active: boolean): void {
    this.trigger.classList.toggle('is-active', active);
  }

  contains(node: Node): boolean {
    return this.root.contains(node);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.show();
  }

  show(): void {
    closeOthers(this);
    this.isOpen = true;
    open.add(this);
    this.panel.classList.remove('is-hidden');
    this.trigger.classList.add('is-open');
  }

  close(): void {
    this.isOpen = false;
    open.delete(this);
    this.panel.classList.add('is-hidden');
    this.trigger.classList.remove('is-open');
  }

  isVisible(): boolean {
    return this.isOpen;
  }
}

export interface MenuItem {
  id: string;
  /** Už přeložený text. */
  label: string;
  icon: string;
  /** Cena, klávesa — cokoli, co patří napravo. */
  hint?: string;
  onSelect(): void;
}

/**
 * Panel se seznamem položek — nabídka nástrojů.
 *
 * Vybraná položka se propíše do ikony na tlačítku, aby hráč i po zavření
 * viděl, co drží.
 */
export class Menu extends Popover {
  private readonly items = new Map<string, HTMLButtonElement>();
  private readonly icons = new Map<string, string>();
  private readonly defaultIcon: string;
  private readonly lockIcon: boolean;
  private readonly neutralId: string | undefined;

  constructor(options: PopoverOptions) {
    super(options);
    this.defaultIcon = options.icon;
    this.lockIcon = options.lockIcon ?? false;
    this.neutralId = options.neutralId;
    this.panel.classList.add('menu');
  }

  setItems(items: readonly MenuItem[]): void {
    this.panel.replaceChildren();
    this.items.clear();
    this.icons.clear();

    for (const item of items) {
      const node = button('menu__item', () => {
        item.onSelect();
        this.close();
      });
      node.appendChild(iconSvg(item.icon));
      node.appendChild(el('span', 'menu__label', item.label));
      if (item.hint !== undefined) node.appendChild(el('span', 'menu__hint', item.hint));

      this.panel.appendChild(node);
      this.items.set(item.id, node);
      this.icons.set(item.id, item.icon);
    }
  }

  /** `null` znamená „z téhle nabídky není vybráno nic". */
  setSelected(id: string | null): void {
    for (const [itemId, node] of this.items) {
      node.classList.toggle('is-active', itemId === id);
    }
    this.setActive(id !== null && id !== this.neutralId);
    if (this.lockIcon) return;
    this.setIcon((id === null ? undefined : this.icons.get(id)) ?? this.defaultIcon);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }
}
