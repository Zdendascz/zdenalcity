/**
 * @vitest-environment jsdom
 *
 * Bubliny u ikon, ikony v lištách a měna (T138).
 *
 * Autor: „U každé ikonky musí být tooltip (ne title!!!) s popisem co to je
 * a k čemu to je." A: „A měna, všude doplníš Kčs." Obojí se rozbíjí potichu —
 * nový nástroj bez popisu, nová částka bez měny, nové tlačítko s `title` —
 * a nikdo si toho nevšimne, dokud na to hráč nenajede myší.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { SPEEDS } from '@/sim/simHost';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { MAX_FUNDING, fundingCost, fundingEffect } from '@/sim/funding';
import { createWorld } from '@/sim/world';
import { createLayerOptions, createTools, createViewOptions, serviceClassesOf } from '@/render/app';
import { button } from '@/ui/dom';
import { formatMoney, formatNumber, moneyParams } from '@/ui/format';
import { Hud } from '@/ui/hud';
import type { HudCallbacks, HudState } from '@/ui/hud';
import type { LayoutMode } from '@/ui/layout';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { setIconImages, uiIconShape } from '@/ui/icons';
import { groupTools, Toolbar } from '@/ui/toolbar';
import {
  LONG_PRESS_MS,
  SHOW_DELAY_MS,
  describe as describeTip,
  hideTooltip,
  placeTooltip,
  setTooltip,
  tooltipState,
} from '@/ui/tooltip';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

function tablesOf(content: ContentRegistry): LocaleTables {
  const out: Record<string, Record<string, string>> = {};
  for (const lang of content.getLanguages()) out[lang] = content.getLocaleTable(lang);
  return out as LocaleTables;
}

/* jsdom nezná `PointerEvent`; myš i prst se tu poznají podle `pointerType`. */
function pointer(type: string, pointerType: string, init: { x?: number; y?: number } = {}): Event {
  const event = new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', cancelable: true, clientX: init.x ?? 0, clientY: init.y ?? 0 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

describe('kam bublina sedne', () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 60 };

  it('nad tlačítkem, když je nahoře místo', () => {
    const place = placeTooltip({ left: 380, top: 500, right: 420, bottom: 540 }, size, viewport, ['top', 'bottom']);
    expect(place.side).toBe('top');
    expect(place.top + size.height).toBeLessThanOrEqual(500);
    // Vodorovně na střed tlačítka.
    expect(place.left).toBe(300);
  });

  it('u horního okraje se překlopí dolů', () => {
    const place = placeTooltip({ left: 380, top: 10, right: 420, bottom: 50 }, size, viewport, ['top', 'bottom']);
    expect(place.side).toBe('bottom');
    expect(place.top).toBeGreaterThanOrEqual(50);
  });

  it('u kraje obrazovky se přimáčkne dovnitř, nevyleze ven', () => {
    const left = placeTooltip({ left: 0, top: 500, right: 40, bottom: 540 }, size, viewport, ['top']);
    expect(left.left).toBeGreaterThanOrEqual(8);
    const right = placeTooltip({ left: 760, top: 500, right: 800, bottom: 540 }, size, viewport, ['top']);
    expect(right.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it('položka nabídky u pravého okraje dostane bublinu vlevo', () => {
    const place = placeTooltip({ left: 600, top: 300, right: 790, bottom: 330 }, size, viewport, ['right', 'left']);
    expect(place.side).toBe('left');
    expect(place.left + size.width).toBeLessThanOrEqual(600);
  });
});

describe('bublina u tlačítka', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });
  afterEach(() => {
    hideTooltip();
    vi.useRealTimers();
  });

  function host(onClick = (): void => {}): HTMLButtonElement {
    const node = button('toolbar__button', onClick);
    node.title = 'starý title';
    document.body.appendChild(node);
    setTooltip(node, { title: 'Bourání', text: 'Zbourá budovu.', meta: 'klávesa X' });
    return node;
  }

  it('nahradí `title` a ukáže se po najetí myší až po prodlevě', () => {
    const node = host();
    expect(node.hasAttribute('title')).toBe(false);

    node.dispatchEvent(pointer('pointerenter', 'mouse'));
    expect(tooltipState().visible).toBe(false);
    vi.advanceTimersByTime(SHOW_DELAY_MS);

    const state = tooltipState();
    expect(state.visible).toBe(true);
    expect(state.node?.querySelector('.tooltip__title')?.textContent).toBe('Bourání');
    expect(state.node?.querySelector('.tooltip__title')?.tagName).toBe('STRONG');
    expect(state.node?.querySelector('.tooltip__text')?.textContent).toBe('Zbourá budovu.');
    expect(state.node?.querySelector('.tooltip__meta')?.textContent).toBe('klávesa X');
    expect(state.node?.getAttribute('role')).toBe('tooltip');
    expect(node.getAttribute('aria-describedby')).toBe(state.node?.id);

    node.dispatchEvent(pointer('pointerleave', 'mouse'));
    expect(tooltipState().visible).toBe(false);
    expect(node.hasAttribute('aria-describedby')).toBe(false);
  });

  it('Esc a kliknutí ji schovají', () => {
    const node = host();
    node.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tooltipState().visible).toBe(false);

    node.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    node.dispatchEvent(pointer('pointerdown', 'mouse'));
    expect(tooltipState().visible).toBe(false);
  });

  it('z klávesnice se ukáže hned při fokusu a zmizí při jeho ztrátě', () => {
    const node = host();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    node.focus();
    expect(tooltipState().anchor).toBe(node);
    node.blur();
    expect(tooltipState().visible).toBe(false);
  });

  it('na dotyku po podržení, a klepnutí, které po něm přijde, tlačítko nezmáčkne', () => {
    let clicks = 0;
    const node = host(() => clicks++);
    node.dispatchEvent(pointer('pointerdown', 'touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(tooltipState().anchor).toBe(node);
    node.dispatchEvent(pointer('pointerup', 'touch'));
    node.click();
    expect(clicks).toBe(0);

    // Obyčejné klepnutí bez podržení tlačítko zmáčkne.
    hideTooltip();
    node.dispatchEvent(pointer('pointerdown', 'touch'));
    vi.advanceTimersByTime(LONG_PRESS_MS / 3);
    node.dispatchEvent(pointer('pointerup', 'touch'));
    node.click();
    expect(clicks).toBe(1);
    expect(tooltipState().visible).toBe(false);
  });

  it('obsah z funkce se skládá až při ukázání', () => {
    const node = host();
    let state = 'zapnuté';
    setTooltip(node, () => ({ title: 'Katastrofy', meta: state }));
    state = 'vypnuté';
    node.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tooltipState().node?.querySelector('.tooltip__meta')?.textContent).toBe('vypnuté');
  });

  it('popis z lokalizace: chybějící `.hint` nechá aspoň název', () => {
    const i18n = new I18n({ cs: { 'ui.a.b': 'Název', 'ui.a.b.hint': 'Věta.', 'ui.c.d': 'Jen název' } }, 'cs');
    expect(describeTip(i18n, 'ui.a.b')).toEqual({ title: 'Název', text: 'Věta.' });
    expect(describeTip(i18n, 'ui.c.d', { meta: 'cena' })).toEqual({ title: 'Jen název', meta: 'cena' });
  });
});

describe('měna', () => {
  it('částka má Kčs za nezlomitelnou mezerou, v obou jazycích', async () => {
    const content = await vanilla();
    const tables = tablesOf(content);

    const cs = new I18n(tables, 'cs');
    expect(formatMoney(12345)).toBe(`${formatNumber(12345)}\u00a0Kčs`);
    expect(formatMoney(12345)).toMatch(/^12\s345\u00a0Kčs$/);

    cs.setLanguage('en');
    expect(formatMoney(12345)).toBe('12,345\u00a0Kčs');
    cs.setLanguage('cs');
  });

  it('peníze v hláškách simulace dostanou měnu, ostatní čísla ne', () => {
    expect(moneyParams({ cost: 500, funds: 20, capacity: 40000, count: 3, name: 'x' })).toEqual({
      cost: formatMoney(500),
      funds: formatMoney(20),
      capacity: 40000,
      count: 3,
      name: 'x',
    });
    expect(moneyParams(undefined)).toBeUndefined();
  });

  it('žádná šablona nepíše Kčs sama — měnu dodává jen `formatMoney`', async () => {
    const content = await vanilla();
    for (const language of content.getLanguages()) {
      for (const [key, text] of Object.entries(content.getLocaleTable(language))) {
        if (key === 'ui.currency' || key.endsWith('.amount')) continue;
        // Měna v šabloně vedle parametru by se s `formatMoney` zdvojila.
        expect(text, `${language}: ${key}`).not.toMatch(/\}\s*Kčs/);
      }
    }
  });
});

describe('každá ikona má popis', () => {
  it('každý nástroj má popis v obou jazycích', async () => {
    const content = await vanilla();
    const tables = tablesOf(content);
    for (const tool of createTools(content)) {
      expect(tool.hintKey, tool.id).toBeDefined();
      for (const language of Object.keys(tables)) {
        expect(tables[language]?.[tool.hintKey ?? ''], `${language}: ${tool.id} → ${tool.hintKey}`).toBeTruthy();
      }
    }
  });

  it('každá nabídka nástrojů má popis v obou jazycích', async () => {
    const content = await vanilla();
    const tables = tablesOf(content);
    for (const group of groupTools(createTools(content))) {
      if (group.tools.length < 2) continue;
      for (const language of Object.keys(tables)) {
        expect(tables[language]?.[`${group.key}.hint`], `${language}: ${group.key}.hint`).toBeTruthy();
      }
    }
  });

  it('každá vrstva a pohled mají popis', async () => {
    const content = await vanilla();
    const tables = tablesOf(content);
    for (const option of [...createViewOptions(), ...createLayerOptions(content)]) {
      const key = option.hintKey ?? `${option.labelKey}.hint`;
      for (const language of Object.keys(tables)) {
        expect(tables[language]?.[key], `${language}: ${key}`).toBeTruthy();
      }
    }
  });

  it('cena v bublině nástroje je s měnou, u silnic za dlaždici', async () => {
    vi.useFakeTimers();
    const content = await vanilla();
    const i18n = new I18n(tablesOf(content), 'cs');
    const tools = createTools(content);
    const parent = document.createElement('div');
    document.body.replaceChildren(parent);
    new Toolbar(parent, i18n, tools, 'pan', false, null, () => {});

    // Nabídka silnic: najetí na položku s ulicí.
    const street = tools.find((tool) => tool.id === 'road:street');
    const item = [...parent.querySelectorAll<HTMLElement>('.menu__item')].find(
      (node) => node.querySelector('.menu__label')?.textContent === i18n.t('ui.tool.road.street'),
    );
    expect(item).toBeDefined();
    item?.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    const meta = tooltipState().node?.querySelector('.tooltip__meta')?.textContent ?? '';
    expect(meta).toContain(i18n.t('ui.tooltip.pricePerTile', { price: formatMoney(street?.cost ?? 0) }));
    expect(tooltipState().node?.querySelector('.tooltip__text')?.textContent).toBe(
      i18n.t('ui.tool.road.street.hint'),
    );
    // A v řádku nabídky je cena taky s měnou.
    expect(item?.querySelector('.menu__hint')?.textContent).toContain('Kčs');
    hideTooltip();
    vi.useRealTimers();
  });
});

describe('ikony nástrojů', () => {
  it('odstranění vedení nevypadá jako buldozer', async () => {
    const tools = createTools(await vanilla());
    const remove = tools.find((tool) => tool.id === 'wire:remove');
    const bulldoze = tools.find((tool) => tool.id === 'bulldoze');
    expect(remove?.icon).toBe('wire-remove');
    expect(remove?.icon).not.toBe(bulldoze?.icon);
    // Záloha, dokud obsah nedodá obrázek, je jiný tvar než radlice.
    expect(uiIconShape('wire-remove')).toBeDefined();
    expect(uiIconShape('wire-remove')).not.toEqual(uiIconShape('bulldoze'));
  });

  it('zapnuté a vypnuté katastrofy mají každé svou ikonu', () => {
    expect(uiIconShape('disasters-on')).toBeDefined();
    expect(uiIconShape('disasters-off')).toBeDefined();
    expect(uiIconShape('disasters-on')).not.toEqual(uiIconShape('disasters-off'));
  });
});

/* ------------------------------------------------------------ HUD --- */

function callbacks(): HudCallbacks {
  const noop = (): void => {};
  return {
    onSpeed: noop,
    onTaxChange: noop,
    onQuickSave: noop,
    onScreenshot: noop,
    onQuickLoad: noop,
    onDownload: noop,
    onOpenFile: noop,
    onToggleLayer: noop,
    onSetView: noop,
    onToggleBudget: noop,
    onToggleAdvisor: noop,
    onStatClick: noop,
    onToggleFinance: noop,
    onToggleTransit: noop,
    onToggleGhost: noop,
    onDisasterClick: noop,
    onToggleDecor: noop,
    onToggleMotion: noop,
    onToggleGrid: noop,
    onHelp: noop,
    onFundingChange: noop,
    onLanguageChange: noop,
    onArmDisaster: noop,
    onToggleDisasters: noop,
    onZoom: noop,
    onFocusCity: noop,
    onReload: noop,
  };
}

const STATE: HudState = {
  autosaveMinutesAgo: null,
  speedIndex: 1,
  layer: 'none',
  view: 'surface',
  budgetVisible: false,
  advisorVisible: false,
  financeVisible: false,
  transitVisible: false,
  disastersEnabled: true,
  demandTerms: [],
  ghost: false,
  decor: true,
  motion: true,
  grid: false,
  poweredBuildings: 0,
  powerProduced: 0,
  powerNeeded: 0,
  wasteCapacity: 0,
  wasteNeeded: 0,
  sewageCapacity: 0,
  sewageNeeded: 0,
  waterCapacity: 0,
  waterNeeded: 0,
  funding: new Map(),
  message: '',
};

async function hudFor(mode: LayoutMode): Promise<{ root: HTMLElement; hud: Hud; i18n: I18n }> {
  const content = await vanilla();
  const i18n = new I18n(tablesOf(content), 'cs');
  const world = createWorld(1, content.getBalance().economy) as unknown as ReadonlyWorldView;
  const root = document.createElement('div');
  root.className = 'hud';
  document.body.replaceChildren(root);
  const hud = new Hud(
    root,
    i18n,
    world,
    SPEEDS,
    createViewOptions(),
    createLayerOptions(content),
    serviceClassesOf(content),
    {
      max: MAX_FUNDING,
      effect: (level) => fundingEffect(content.getBalance(), level),
      cost: (level) => fundingCost(content.getBalance(), level),
    },
    ['fire'],
    mode,
    callbacks(),
  );
  hud.update(STATE);
  new Toolbar(hud.toolsSlot, i18n, createTools(content), 'pan', mode !== 'full', hud.overflow, () => {});
  return { root, hud, i18n };
}

describe('HUD bez `title`', () => {
  for (const mode of ['full', 'compact'] as const) {
    it(`${mode}: žádné tlačítko nemá systémový title, každé s ikonou má jméno`, async () => {
      const { root } = await hudFor(mode);
      expect([...root.querySelectorAll('[title]')].map((node) => node.outerHTML.slice(0, 80))).toEqual([]);
      for (const node of root.querySelectorAll('button')) {
        if (node.querySelector('.icon') === null || node.closest('.popover--stats')) continue;
        const name = node.getAttribute('aria-label') ?? node.textContent ?? '';
        expect(name.trim(), node.outerHTML.slice(0, 120)).not.toBe('');
      }
    });
  }

  it('kasa je v Kčs, bilance má měnu jednou', async () => {
    const { root } = await hudFor('full');
    const values = [...root.querySelectorAll('.stat__value')].map((node) => node.textContent ?? '');
    expect(values.some((text) => /^\d[\d\s]*\u00a0Kčs$/.test(text))).toBe(true);
    const balance = values.find((text) => text.startsWith('+'));
    expect(balance?.match(/Kčs/g)).toHaveLength(1);
  });

  it('bublina katastrof řekne, jestli jsou zapnuté, a ikona přepínače se mění se stavem', async () => {
    vi.useFakeTimers();
    setIconImages({ 'disasters-on': 'on.png', 'disasters-off': 'off.png' });
    const { root, hud, i18n } = await hudFor('full');
    const toggleIcon = (): string | null =>
      root.querySelector('.popover--alarm .menu__item img')?.getAttribute('src') ?? null;
    expect(toggleIcon()).toBe('on.png');
    const trigger = root.querySelector<HTMLElement>(
      `.popover--alarm .popover__trigger[aria-label="${i18n.t('ui.disaster.title')}"]`,
    );
    expect(trigger).not.toBeNull();
    trigger?.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tooltipState().node?.textContent).toContain(i18n.t('ui.disaster.stateOn'));
    hideTooltip();

    hud.update({ ...STATE, disastersEnabled: false });
    trigger?.dispatchEvent(pointer('pointerenter', 'mouse'));
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tooltipState().node?.textContent).toContain(i18n.t('ui.disaster.stateOff'));
    expect(toggleIcon()).toBe('off.png');
    hideTooltip();
    setIconImages({});
    vi.useRealTimers();
  });
});
