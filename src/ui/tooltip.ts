import { el } from './dom';

/**
 * Bublina s popisem u ikony (T138).
 *
 * Autor: „U každé ikonky musí být tooltip (ne title!!!) s popisem co to je
 * a k čemu to je. Tučný název oč jde a jedna až dvě věty k čemu to je."
 *
 * Proč ne `title`: prohlížeč ho ukáže až po vteřině, malým systémovým písmem,
 * bez formátování a **na dotyku nikdy**. Hráč, který neví, co znamená ikona
 * stožáru s křížkem, se to z `title` nedozvěděl ani na počítači včas, ani na
 * telefonu vůbec.
 *
 * Bublina je **jedna pro celé rozhraní** a stěhuje se k tomu, nad čím hráč
 * zrovna je. Dvě naráz by se překrývaly a jedna na tlačítko by znamenala sto
 * uzlů, které skoro nikdy nejsou vidět.
 *
 * Kdy se ukáže:
 * - myš: po `SHOW_DELAY_MS` nad tlačítkem. Kdo jede myší po liště a jedna
 *   bublina už svítí, dostane další **hned** — jinak by čekal u každé ikony
 *   znovu a lištu by nikdo nepřečetl celou;
 * - klávesnice: hned po přechodu Tabem na tlačítko;
 * - dotyk: po podržení `LONG_PRESS_MS`. Klepnutí, které po podržení přijde,
 *   se **zahodí** — kdo si chtěl přečíst, co tlačítko dělá, ho tím nechtěl
 *   zmáčknout.
 *
 * Kdy zmizí: odjezd myši, ztráta fokusu, Esc, kliknutí, a když tlačítko
 * zmizí z dokumentu (HUD se při změně jazyka i šířky okna staví znovu).
 */

/** Jak dlouho musí myš stát nad tlačítkem. Kratší bliká při přejezdu přes lištu. */
export const SHOW_DELAY_MS = 350;

/** Jak dlouho držet prst. Kratší se plete s obyčejným klepnutím. */
export const LONG_PRESS_MS = 450;

/** Jak dlouho po puštění prstu bublina ještě visí, aby šla dočíst. */
const TOUCH_LINGER_MS = 2500;

/** Jak dlouho po zmizení bubliny platí „lišta se čte", tedy bez čekání. */
const WARM_MS = 400;

/** Odstup od tlačítka a od okraje obrazovky. */
const GAP = 8;
const MARGIN = 8;

/** O kolik smí prst při podržení ujet, než to je tah a ne podržení. */
const LONG_PRESS_SLOP = 10;

export interface TooltipContent {
  /** Název tučně: o co jde. */
  title: string;
  /** Jedna až dvě věty: k čemu to je. */
  text?: string;
  /** Drobně pod tím: cena, klávesa, stav, rozpis. Smí mít víc řádků. */
  meta?: string;
}

/** Obsah rovnou, nebo funkce, která ho složí až při ukázání (stav, cena). */
export type TooltipSource = TooltipContent | (() => TooltipContent);

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipOptions {
  /**
   * Na kterou stranu přednostně. Bez toho nahoru u tlačítek v dolní půlce
   * obrazovky a dolů u horních — směrem do mapy, ne za okraj.
   */
  sides?: readonly TooltipSide[];
  /**
   * Ukázat i po podržení prstu. Vypíná se u tlačítek, která podržení už
   * používají sama (lupa při podržení přibližuje dál).
   */
  longPress?: boolean;
}

interface Entry {
  source: TooltipSource;
  options: TooltipOptions;
}

const entries = new WeakMap<HTMLElement, Entry>();

let bubble: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let showTimer = 0;
let lingerTimer = 0;
let watchTimer = 0;
let hiddenAt = -Infinity;
/** Kterému tlačítku se má zahodit nejbližší klepnutí (po podržení prstu). */
let swallowClick: HTMLElement | null = null;
/** Přišel poslední vstup z klávesnice? Jen tehdy ukazuje bublinu fokus. */
let keyboard = false;
let listening = false;

/** Stav pro testy: co bublina zrovna ukazuje. */
export function tooltipState(): { visible: boolean; anchor: HTMLElement | null; node: HTMLElement | null } {
  return { visible: anchor !== null, anchor, node: bubble };
}

/**
 * Přidá tlačítku bublinu, nebo jí vymění obsah.
 *
 * Volat se smí opakovaně — posluchače se přidají jen napoprvé. Tlačítka,
 * jejichž text se mění se stavem (katastrofy, pauza), si tak obsah jen
 * přepíšou.
 */
export function setTooltip(node: HTMLElement, source: TooltipSource, options: TooltipOptions = {}): void {
  // Systémová bublina by se ukázala vedle naší (a dřív). Autor ji nechce.
  node.removeAttribute('title');
  const known = entries.get(node);
  entries.set(node, { source, options });
  if (known) {
    if (anchor === node) render(node);
    return;
  }
  listen();

  node.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    schedule(node, Date.now() - hiddenAt < WARM_MS || anchor !== null ? 0 : SHOW_DELAY_MS);
  });
  node.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'touch') return;
    cancel();
    if (anchor === node) hide();
  });
  node.addEventListener('pointerdown', (event) => {
    cancel();
    if (event.pointerType !== 'touch') {
      // Kliknutí myší znamená „chci to použít", ne „chci číst".
      hide();
      return;
    }
    if (entries.get(node)?.options.longPress === false) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moved: PointerEvent): void => {
      if (Math.hypot(moved.clientX - startX, moved.clientY - startY) > LONG_PRESS_SLOP) cancel();
    };
    node.addEventListener('pointermove', move);
    const done = (): void => {
      node.removeEventListener('pointermove', move);
      cancel();
    };
    node.addEventListener('pointerup', done, { once: true });
    node.addEventListener('pointercancel', done, { once: true });
    showTimer = window.setTimeout(() => {
      showTimer = 0;
      show(node);
      swallowClick = node;
      // Bublina vydrží chvíli i po puštění, ať se dá dočíst.
      window.clearTimeout(lingerTimer);
      lingerTimer = window.setTimeout(() => {
        if (anchor === node) hide();
      }, LONG_PRESS_MS + TOUCH_LINGER_MS);
    }, LONG_PRESS_MS);
  });
  // Podržení prstu otevírá na telefonu kontextovou nabídku (a na obrázku
  // nabídku „uložit obrázek"). Po podržení, které ukázalo bublinu, nemá co dělat.
  node.addEventListener('contextmenu', (event) => {
    if (swallowClick === node) event.preventDefault();
  });
  node.addEventListener('focus', () => {
    if (keyboard) show(node);
  });
  node.addEventListener('blur', () => {
    if (anchor === node) hide();
  });
}

/** Schová bublinu. Volá se i zvenku, třeba při přestavbě lišty. */
export function hideTooltip(): void {
  cancel();
  hide();
}

/**
 * Obsah z lokalizace: název z `labelKey`, věta z `<labelKey>.hint`.
 *
 * Jedno schéma pro všechna tlačítka (T138), takže test projde klíče
 * nástrojů i lišty a nechybí-li nikde popis, pozná to bez kreslení. Chybějící
 * popis bublinu neshodí — zůstane jen tučný název, a to je pořád víc než
 * prázdné tlačítko (mod nemusí popisy dodat).
 */
export function describe(
  i18n: { t(key: string, params?: Readonly<Record<string, string | number>>): string; has(key: string): boolean },
  labelKey: string,
  more: { hintKey?: string; title?: string; meta?: string } = {},
): TooltipContent {
  const hintKey = more.hintKey ?? `${labelKey}.hint`;
  const content: TooltipContent = { title: more.title ?? i18n.t(labelKey) };
  if (i18n.has(hintKey)) content.text = i18n.t(hintKey);
  if (more.meta !== undefined && more.meta !== '') content.meta = more.meta;
  return content;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Kam bublinu postavit, aby byla celá na obrazovce.
 *
 * Zkouší strany v pořadí a vezme první, kam se vejde; podél tlačítka ji pak
 * posune zpátky do obrazovky. Když se nevejde nikam (telefon na výšku a dlouhý
 * text), zůstane na první straně a přimáčkne se k okraji — vidět celá je
 * důležitější než sedět přesně u tlačítka.
 *
 * Čistá funkce kvůli testu: v jsdom nic nemá rozměry.
 */
export function placeTooltip(
  box: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  sides: readonly TooltipSide[],
): { left: number; top: number; side: TooltipSide } {
  const clampX = (x: number): number =>
    Math.max(MARGIN, Math.min(x, viewport.width - MARGIN - size.width));
  const clampY = (y: number): number =>
    Math.max(MARGIN, Math.min(y, viewport.height - MARGIN - size.height));
  const centreX = (box.left + box.right) / 2 - size.width / 2;
  const centreY = (box.top + box.bottom) / 2 - size.height / 2;

  const candidates: Record<TooltipSide, { left: number; top: number; fits: boolean }> = {
    top: {
      left: clampX(centreX),
      top: box.top - GAP - size.height,
      fits: box.top - GAP - size.height >= MARGIN,
    },
    bottom: {
      left: clampX(centreX),
      top: box.bottom + GAP,
      fits: box.bottom + GAP + size.height <= viewport.height - MARGIN,
    },
    right: {
      left: box.right + GAP,
      top: clampY(centreY),
      fits: box.right + GAP + size.width <= viewport.width - MARGIN,
    },
    left: {
      left: box.left - GAP - size.width,
      top: clampY(centreY),
      fits: box.left - GAP - size.width >= MARGIN,
    },
  };

  const side = sides.find((candidate) => candidates[candidate].fits) ?? sides[0] ?? 'top';
  const chosen = candidates[side];
  return { left: clampX(chosen.left), top: clampY(chosen.top), side };
}

/* ------------------------------------------------------------ vnitřek --- */

function listen(): void {
  if (listening) return;
  listening = true;

  document.addEventListener(
    'keydown',
    (event) => {
      keyboard = true;
      if (event.key === 'Escape') hideTooltip();
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      keyboard = false;
      // Klepnutí jinam zavře bublinu, kterou nechalo podržení prstu.
      if (anchor !== null && !(event.target instanceof Node && anchor.contains(event.target))) {
        hideTooltip();
      }
    },
    true,
  );
  /*
   * Klepnutí po podržení se zahodí **na dokumentu ve fázi zachycení**, tedy
   * dřív, než se dostane k obsluze tlačítka. Na samotném tlačítku by záleželo
   * na pořadí, v jakém se posluchači přidali, a `button()` je přidává první.
   */
  document.addEventListener(
    'click',
    (event) => {
      const target = swallowClick;
      if (target === null) return;
      swallowClick = null;
      if (event.target instanceof Node && target.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener('resize', hideTooltip);
  // Rolování panelu posune tlačítko, ale bublinu ne.
  document.addEventListener('scroll', hideTooltip, true);
}

function schedule(node: HTMLElement, delay: number): void {
  cancel();
  if (delay <= 0) {
    show(node);
    return;
  }
  showTimer = window.setTimeout(() => {
    showTimer = 0;
    show(node);
  }, delay);
}

function cancel(): void {
  if (showTimer !== 0) window.clearTimeout(showTimer);
  showTimer = 0;
}

function ensureBubble(): HTMLElement {
  if (bubble && bubble.isConnected) return bubble;
  bubble = el('div', 'tooltip is-hidden');
  bubble.id = 'ui-tooltip';
  bubble.setAttribute('role', 'tooltip');
  document.body.appendChild(bubble);
  return bubble;
}

function render(node: HTMLElement): void {
  const entry = entries.get(node);
  const target = bubble;
  if (!entry || !target) return;
  const content = typeof entry.source === 'function' ? entry.source() : entry.source;

  target.replaceChildren(el('strong', 'tooltip__title', content.title));
  if (content.text) target.appendChild(el('span', 'tooltip__text', content.text));
  if (content.meta) target.appendChild(el('span', 'tooltip__meta', content.meta));
}

function show(node: HTMLElement): void {
  const entry = entries.get(node);
  if (!entry || !node.isConnected) return;
  if (anchor !== null && anchor !== node) anchor.removeAttribute('aria-describedby');

  const target = ensureBubble();
  anchor = node;
  render(node);
  target.classList.remove('is-hidden');
  // Odečítačka přečte popis k tlačítku, dokud bublina visí.
  node.setAttribute('aria-describedby', target.id);

  const box = node.getBoundingClientRect();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const lower = (box.top + box.bottom) / 2 > viewport.height / 2;
  const sides = entry.options.sides ?? (lower ? ['top', 'bottom', 'right', 'left'] : ['bottom', 'top', 'right', 'left']);
  const place = placeTooltip(box, { width: target.offsetWidth, height: target.offsetHeight }, viewport, sides);
  target.style.left = `${Math.round(place.left)}px`;
  target.style.top = `${Math.round(place.top)}px`;
  target.dataset.side = place.side;

  // Tlačítko, pod kterým bublina visí, může zmizet bez `pointerleave` — HUD
  // se při změně jazyka nebo šířky staví znovu. Bublina by pak visela nad
  // prázdnem, dokud by hráč nenajel jinam.
  window.clearInterval(watchTimer);
  watchTimer = window.setInterval(() => {
    if (anchor === null || !anchor.isConnected) hideTooltip();
  }, 250);
}

function hide(): void {
  window.clearInterval(watchTimer);
  watchTimer = 0;
  window.clearTimeout(lingerTimer);
  lingerTimer = 0;
  if (anchor === null) return;
  anchor.removeAttribute('aria-describedby');
  anchor = null;
  hiddenAt = Date.now();
  bubble?.classList.add('is-hidden');
}
