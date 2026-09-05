/**
 * @vitest-environment jsdom
 *
 * Úsporná lišta pro telefon.
 *
 * Hru začali lidé hrát na mobilu a HUD, který na monitoru sedí, tam zabíral
 * půlku obrazovky. Testuje se to, co jde rozbít potichu: tlačítko, které se
 * přestěhuje **do schované řady a už se odtamtud nevrátí**, statistika, kterou
 * `update()` přestane plnit, protože se přesunula jinam, a chybějící překlad
 * u ovládání, které na počítači nikdo neuvidí.
 */
import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { SPEEDS } from '@/sim/simHost';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { createWorld } from '@/sim/world';
import { createLayerOptions, createTools, createViewOptions, serviceClassesOf } from '@/render/app';
import { Hud } from '@/ui/hud';
import type { HudCallbacks, HudState } from '@/ui/hud';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { uiIconShape } from '@/ui/icons';
import { COMPACT_GROUPS, groupTools, Toolbar } from '@/ui/toolbar';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

async function i18nFor(content: ContentRegistry, language = 'cs'): Promise<I18n> {
  const out: Record<string, Record<string, string>> = {};
  for (const lang of content.getLanguages()) out[lang] = content.getLocaleTable(lang);
  return new I18n(out as LocaleTables, language);
}

/** Callbacky, které si jen zapamatují, že je někdo zavolal. */
function callbacks(): HudCallbacks & { zoomed: number[] } {
  const zoomed: number[] = [];
  return {
    zoomed,
    onSpeed: () => {},
    onTaxChange: () => {},
    onQuickSave: () => {},
    onScreenshot: () => {},
    onQuickLoad: () => {},
    onDownload: () => {},
    onOpenFile: () => {},
    onToggleLayer: () => {},
    onSetView: () => {},
    onToggleBudget: () => {},
    onToggleFinance: () => {},
    onToggleTransit: () => {},
    onToggleGhost: () => {},
    onDisasterClick: () => {},
    onToggleDecor: () => {},
    onHelp: () => {},
    onFundingChange: () => {},
    onLanguageChange: () => {},
    onArmDisaster: () => {},
    onToggleDisasters: () => {},
    onZoom: (factor) => void zoomed.push(factor),
    onReload: () => {},
  };
}

const STATE: HudState = {
  speedIndex: 1,
  layer: 'none',
  view: 'surface',
  budgetVisible: false,
  financeVisible: false,
  transitVisible: false,
  disastersEnabled: true,
  ghost: false,
  decor: true,
  poweredBuildings: 0,
  powerProduced: 0,
  powerNeeded: 0,
  funding: new Map(),
  message: '',
};

async function hudFor(compact: boolean): Promise<{ root: HTMLElement; hud: Hud }> {
  const content = await vanilla();
  const i18n = await i18nFor(content);
  const world = createWorld(1, content.getBalance().economy) as unknown as ReadonlyWorldView;
  const root = document.createElement('div');
  root.className = 'hud';
  const hud = new Hud(
    root,
    i18n,
    world,
    SPEEDS,
    createViewOptions(),
    createLayerOptions(content),
    serviceClassesOf(content),
    ['fire'],
    compact,
    callbacks(),
  );
  hud.update(STATE);
  return { root, hud };
}

/** Kolik tlačítek a roletek stojí v dané části lišty. */
function widgets(root: HTMLElement, selector: string): number {
  const row = root.querySelector(selector);
  return row === null ? 0 : row.childElementCount;
}

describe('úsporná lišta', () => {
  it('na telefonu zůstane v liště kasa a bilance, zbytek pod ikonou', async () => {
    const { root } = await hudFor(true);
    const labels = [...root.querySelectorAll('.stats .stat__label')].map((node) => node.textContent);

    expect(labels).toEqual(['Kasa', 'Měsíční bilance']);
    // Ostatní se neztratily — jen se přestěhovaly.
    expect(root.querySelectorAll('.panel--stats .stat')).toHaveLength(6);
  });

  it('schované statistiky se pořád plní', async () => {
    // Nejsnazší způsob, jak to rozbít: `update()` sáhne na uzel, který při
    // stavbě lišty skončil jinde, a hráč kouká na pomlčku místo na datum.
    const { root, hud } = await hudFor(true);
    hud.update({ ...STATE, poweredBuildings: 3 });

    const values = [...root.querySelectorAll('.panel--stats .stat__value')].map(
      (node) => node.textContent,
    );
    expect(values).toContain('Rok 1, měsíc 1, den 1');
    expect(values).toContain('3/0');
  });

  it('v plné verzi je všechno v jedné řadě a nic se neschovává', async () => {
    const { root } = await hudFor(false);

    expect(root.querySelectorAll('.stats .stat')).toHaveLength(8);
    expect(root.querySelector('.panel--stats')).toBeNull();
    // Vysunutá řada existuje, ale je prázdná — v plné verzi není co schovávat.
    expect(widgets(root, '.hud__row--drawer')).toBe(0);
    expect(root.querySelector('.hud')).toBeNull();
  });

  it('na telefonu zůstanou v liště jen pohledy, průhlednost, stromy, uložení a lupa', async () => {
    const { root } = await hudFor(true);

    // Lupa, pohledy, průhlednost, stromy, uložení a přepínač vysunuté řady.
    expect(widgets(root, '.hud__row:not(.hud__row--drawer)')).toBe(6);
    // Vrstvy, katastrofy, daně, financování, rozpočet, půjčky, MHD, nápověda, jazyk.
    expect(widgets(root, '.hud__row--drawer')).toBe(9);
  });

  it('lupa je jen na telefonu — na počítači je kolečko', async () => {
    expect((await hudFor(true)).root.querySelector('[aria-label="Přiblížit"]')).not.toBeNull();
    expect((await hudFor(false)).root.querySelector('[aria-label="Přiblížit"]')).toBeNull();
  });

  it('tlačítko lupy mění měřítko oběma směry', async () => {
    const content = await vanilla();
    const i18n = await i18nFor(content);
    const world = createWorld(1, content.getBalance().economy) as unknown as ReadonlyWorldView;
    const root = document.createElement('div');
    const calls = callbacks();
    new Hud(root, i18n, world, SPEEDS, createViewOptions(), createLayerOptions(content), [], [], true, calls);

    for (const label of ['Oddálit', 'Přiblížit']) {
      root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click();
    }
    expect(calls.zoomed).toHaveLength(2);
    // Oddálení je převrácené přiblížení: dvě klepnutí vrátí měřítko, kde bylo.
    expect((calls.zoomed[0] ?? 0) * (calls.zoomed[1] ?? 0)).toBeCloseTo(1);
  });

  it('rychlost nechá v liště pauzu a normální běh, zrychlení dá do roletky', async () => {
    const { root } = await hudFor(true);
    const speed = root.querySelector('.hud__top-left .segmented');

    expect(speed?.childElementCount).toBe(2);
    // Zbylé tři stupně (2×, 4×, 8×) čekají v nabídce vedle.
    expect(root.querySelectorAll('.hud__top-left .menu .menu__item')).toHaveLength(SPEEDS.length - 2);
  });

  it('přepnutí režimu za běhu přestaví lištu, ne jen schová', async () => {
    // Otočení telefonu nebo zúžení okna. Kdyby se jen měnilo CSS, zůstala by
    // v liště tlačítka, která tam nepatří — přesouvá se strom, ne vzhled.
    const { root, hud } = await hudFor(false);
    expect(widgets(root, '.hud__row--drawer')).toBe(0);

    hud.setCompact(true);
    expect(widgets(root, '.hud__row--drawer')).toBe(9);
    expect(root.classList.contains('hud--compact')).toBe(true);

    hud.setCompact(false);
    expect(widgets(root, '.hud__row--drawer')).toBe(0);
    expect(root.classList.contains('hud--compact')).toBe(false);
  });

  it('hláška o uložení se přestavěním lišty nezdvojí', async () => {
    const { root, hud } = await hudFor(false);
    hud.setCompact(true);
    hud.setCompact(false);
    expect(root.querySelectorAll('.hud__message')).toHaveLength(1);
  });
});

describe('úsporná paleta nástrojů', () => {
  it('v liště zůstane pacička, silnice, terén, zóny a buldozer', async () => {
    const tools = createTools(await vanilla());
    const groups = groupTools(tools).map((group) => group.key);

    // Každá jmenovaná nabídka musí ve hře doopravdy existovat — překlep by
    // jinak jen tiše schoval nástroj, o kterém autor řekl, že má zůstat.
    for (const key of COMPACT_GROUPS) expect(groups, key).toContain(key);
    expect(COMPACT_GROUPS).toHaveLength(5);
  });

  it('schované nabídky jdou vysunout a nic se cestou neztratí', async () => {
    const content = await vanilla();
    const i18n = await i18nFor(content);
    const tools = createTools(content);
    const parent = document.createElement('div');
    new Toolbar(parent, i18n, tools, 'pan', true, () => {});

    const bar = parent.querySelector('.toolbar:not(.toolbar--drawer)');
    const drawer = parent.querySelector('.toolbar--drawer');
    const groups = groupTools(tools).length;

    // Pět nabídek v liště plus přepínač; zbytek ve vysunuté řadě.
    expect(bar?.childElementCount).toBe(COMPACT_GROUPS.length + 1);
    expect(drawer?.childElementCount).toBe(groups - COMPACT_GROUPS.length);
    expect(drawer?.classList.contains('is-hidden')).toBe(true);
  });

  it('výběr nástroje ze schované řady ji zavře', async () => {
    // Kdo si vybral elektrárnu, chce vidět mapu a postavit ji — ne odklikávat
    // seznam, který mu na telefonu zabírá půlku obrazovky.
    const content = await vanilla();
    const i18n = await i18nFor(content);
    const parent = document.createElement('div');
    const picked: string[] = [];
    new Toolbar(parent, i18n, createTools(content), 'pan', true, (tool) => picked.push(tool.id));

    const drawer = parent.querySelector('.toolbar--drawer');
    drawer?.classList.remove('is-hidden');
    parent.querySelector<HTMLButtonElement>('.toolbar--drawer .menu__item')?.click();

    expect(picked).toHaveLength(1);
    expect(drawer?.classList.contains('is-hidden')).toBe(true);
  });

  it('nástroj ze schované řady je poznat i po jejím zavření', async () => {
    const content = await vanilla();
    const i18n = await i18nFor(content);
    const parent = document.createElement('div');
    const toolbar = new Toolbar(parent, i18n, createTools(content), 'pan', true, () => {});
    const more = parent.querySelector('.toolbar > .toolbar__button:last-child');

    expect(more?.classList.contains('is-active')).toBe(false);
    toolbar.setActive('pipe');
    expect(more?.classList.contains('is-active')).toBe(true);
  });

  it('v plné verzi žádná schovaná řada není', async () => {
    const content = await vanilla();
    const parent = document.createElement('div');
    new Toolbar(parent, await i18nFor(content), createTools(content), 'pan', false, () => {});

    expect(parent.querySelector('.toolbar--drawer')?.childElementCount).toBe(0);
    expect(parent.querySelectorAll('.toolbar__button, .popover')).toHaveLength(
      groupTools(createTools(content)).length,
    );
  });
});

describe('ikony a texty mobilní lišty', () => {
  it('každá nová ikona jde nakreslit', async () => {
    const content = await vanilla();
    const icons = content.getIcons();
    for (const name of ['zoom-in', 'zoom-out', 'more', 'reload', 'speed-8']) {
      expect(icons[name] !== undefined || uiIconShape(name) !== undefined, name).toBe(true);
    }
  });

  it('každý nový text má překlad ve všech jazycích', async () => {
    const content = await vanilla();
    const keys = [
      'ui.toolbar.more',
      'ui.hud.moreStats',
      'ui.zoom.in',
      'ui.zoom.out',
      'ui.save.update',
      'ui.save.updateHint',
      'ui.save.updating',
    ];

    for (const language of content.getLanguages()) {
      const i18n = await i18nFor(content, language);
      // `t()` vrací klíč, když překlad chybí — právě to hlídáme.
      for (const key of keys) expect(i18n.t(key), `${language}: ${key}`).not.toBe(key);
    }
  });
});
