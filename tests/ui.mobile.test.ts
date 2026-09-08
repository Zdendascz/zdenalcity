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
import type { HudCallbacks, HudState, ToolbarOverflow } from '@/ui/hud';
import type { LayoutMode } from '@/ui/layout';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { uiIconShape } from '@/ui/icons';
import type { ToolOption } from '@/ui/tools';
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

/** Callbacky, které si jen zapamatují, co jim kdo poslal. */
function callbacks(): HudCallbacks & { zoomed: number[]; speeds: number[]; views: string[] } {
  const zoomed: number[] = [];
  const speeds: number[] = [];
  const views: string[] = [];
  return {
    zoomed,
    speeds,
    views,
    onSpeed: (index) => void speeds.push(index),
    onTaxChange: () => {},
    onQuickSave: () => {},
    onScreenshot: () => {},
    onQuickLoad: () => {},
    onDownload: () => {},
    onOpenFile: () => {},
    onToggleLayer: () => {},
    onSetView: (id) => void views.push(id),
    onToggleBudget: () => {},
    onToggleAdvisor: () => {},
    onStatClick: () => {},
    onToggleFinance: () => {},
    onToggleTransit: () => {},
    onToggleGhost: () => {},
    onDisasterClick: () => {},
    onToggleDecor: () => {},
    onToggleGrid: () => {},
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
  demandTerms: [],
  speedIndex: 1,
  layer: 'none',
  view: 'surface',
  budgetVisible: false,
  advisorVisible: false,
  financeVisible: false,
  transitVisible: false,
  disastersEnabled: true,
  ghost: false,
  decor: true,
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

interface Built {
  root: HTMLElement;
  hud: Hud;
  calls: ReturnType<typeof callbacks>;
}

async function hudFor(mode: LayoutMode): Promise<Built> {
  const content = await vanilla();
  const i18n = await i18nFor(content);
  const world = createWorld(1, content.getBalance().economy) as unknown as ReadonlyWorldView;
  const root = document.createElement('div');
  root.className = 'hud';
  const calls = callbacks();
  const hud = new Hud(
    root,
    i18n,
    world,
    SPEEDS,
    createViewOptions(),
    createLayerOptions(content),
    serviceClassesOf(content),
    ['fire'],
    mode,
    calls,
  );
  hud.update(STATE);
  return { root, hud, calls };
}

/** Kolik tlačítek a roletek stojí v dané části lišty. */
function widgets(root: HTMLElement, selector: string): number {
  return root.querySelector(selector)?.childElementCount ?? 0;
}

/** Řada ovládání, která je vidět vždycky. */
const ROW = '.hud__row:not(.hud__row--drawer)';
/** To, co autor chtěl mít v jedné řadě s paletou — síť, uložení, trojtečka. */
const EXTRAS = '.hud__extras';
/** Schované nástroje a schované ovládání, každé ve své skupině. */
const DRAWER_TOOLS = '.hud__row--drawer > .hud__drawer-group:first-child';
const DRAWER_CONTROLS = '.hud__row--drawer > .hud__drawer-group:last-child';

function label(root: HTMLElement, text: string): HTMLButtonElement | null {
  return root.querySelector(`[aria-label="${text}"]`);
}

describe('úsporná lišta', () => {
  it('na telefonu je tlačítkem rovnou kasa s bilancí, ikonka grafu žádná', async () => {
    const { root } = await hudFor('compact');
    const trigger = root.querySelector('.popover--stats .popover__trigger');
    const labels = [...(trigger?.querySelectorAll('.stat__label') ?? [])].map((n) => n.textContent);

    expect(labels).toEqual(['Kasa', 'Měsíční bilance']);
    // Ikona v tlačítku nezůstala — statistiky ji nahradily celou.
    expect(trigger?.querySelector('.popover__icon')).toBeNull();
    // Ostatní se neztratily, jen se přestěhovaly.
    expect(root.querySelectorAll('.panel--stats .stat')).toHaveLength(9);
  });

  it('schované statistiky se pořád plní', async () => {
    // Nejsnazší způsob, jak to rozbít: `update()` sáhne na uzel, který při
    // stavbě lišty skončil jinde, a hráč kouká na pomlčku místo na datum.
    const { root, hud } = await hudFor('compact');
    hud.update({ ...STATE, poweredBuildings: 3 });

    const values = [...root.querySelectorAll('.panel--stats .stat__value')].map(
      (node) => node.textContent,
    );
    expect(values).toContain('Rok 1, měsíc 1, den 1');
    expect(values).toContain('3/0');
  });

  it('v plné verzi je všechno v jedné řadě a nic se neschovává', async () => {
    const { root } = await hudFor('full');

    expect(root.querySelectorAll('.stats .stat')).toHaveLength(11);
    expect(root.querySelector('.panel--stats')).toBeNull();
    expect(widgets(root, DRAWER_TOOLS)).toBe(0);
    expect(widgets(root, DRAWER_CONTROLS)).toBe(0);
    expect(widgets(root, EXTRAS)).toBe(0);
  });

  it('na telefonu zůstane nahoře lupa, pohled, průhlednost a stromy', async () => {
    const { root } = await hudFor('compact');
    expect(widgets(root, ROW)).toBe(4);
  });

  it('síť, uložení a trojtečka stojí v řadě s paletou, ne nad ní', async () => {
    // Doslovné zadání autora. Nahoře by z nich byla druhá řada tlačítek.
    const { root } = await hudFor('compact');

    expect(widgets(root, EXTRAS)).toBe(3);
    expect(root.querySelector(`${EXTRAS} [aria-label="Čtvercová síť"]`)).not.toBeNull();
    expect(root.querySelector(`${EXTRAS} [aria-label="Uložení"]`)).not.toBeNull();
    expect(root.querySelector(`${EXTRAS} [aria-label="Další"]`)).not.toBeNull();
  });

  it('trojtečka je jedna a otevírá nástroje i ovládání naráz', async () => {
    // Dvě trojtečky vedle sebe, každá s jiným obsahem, by hráč neměl jak
    // rozeznat — proto je vysunutá řada společná.
    const { root } = await hudFor('compact');
    const drawer = root.querySelector('.hud__row--drawer');
    expect(root.querySelectorAll('[aria-label="Další"]')).toHaveLength(1);

    expect(drawer?.classList.contains('is-hidden')).toBe(true);
    label(root, 'Další')?.click();
    expect(drawer?.classList.contains('is-hidden')).toBe(false);
    label(root, 'Další')?.click();
    expect(drawer?.classList.contains('is-hidden')).toBe(true);
  });

  it('povrch a podzemí je na telefonu jedno tlačítko', async () => {
    const { root, hud, calls } = await hudFor('compact');
    expect(label(root, 'Pohled na povrch')).toBeNull();

    const toggle = label(root, 'Pohled pod zem');
    toggle?.click();
    expect(calls.views).toEqual(['underground']);

    hud.update({ ...STATE, view: 'underground' });
    expect(toggle?.classList.contains('is-active')).toBe(true);

    // A zpátky: totéž tlačítko, opačný směr.
    toggle?.click();
    expect(calls.views).toEqual(['underground', 'surface']);
  });

  it('na počítači zůstávají povrch a podzemí dvě tlačítka', async () => {
    // Autor řekl, že PC verze je v pohodě — tak se jí nesahá.
    const { root } = await hudFor('full');
    expect(label(root, 'Pohled na povrch')).not.toBeNull();
    expect(label(root, 'Pohled pod zem')).not.toBeNull();
  });

  it('lupa je jen na telefonu — na počítači je kolečko', async () => {
    expect(label((await hudFor('compact')).root, 'Přiblížit')).not.toBeNull();
    expect(label((await hudFor('full')).root, 'Přiblížit')).toBeNull();
  });

  it('tlačítko lupy mění měřítko oběma směry', async () => {
    const { root, calls } = await hudFor('compact');
    label(root, 'Oddálit')?.click();
    label(root, 'Přiblížit')?.click();

    expect(calls.zoomed).toHaveLength(2);
    // Oddálení je převrácené přiblížení: dvě klepnutí vrátí měřítko, kde bylo.
    expect((calls.zoomed[0] ?? 0) * (calls.zoomed[1] ?? 0)).toBeCloseTo(1);
  });

  it('čtvercová síť je v liště na obojím — na telefonu i na počítači', async () => {
    // Autor si vyžádal doslova „na mobilu i na pc".
    for (const mode of ['compact', 'full'] as const) {
      const { root } = await hudFor(mode);
      const where = mode === 'compact' ? EXTRAS : ROW;
      expect(root.querySelector(`${where} [aria-label="Čtvercová síť"]`), mode).not.toBeNull();
    }
  });
});

describe('rychlost na telefonu', () => {
  /** Sjednocené tlačítko pauzy a běhu. */
  function playPause(root: HTMLElement): HTMLButtonElement | null {
    return root.querySelector('.hud__top-left .segmented__button');
  }

  it('pauza a běh jsou jedno tlačítko', async () => {
    const { root, hud, calls } = await hudFor('compact');
    const groups = root.querySelectorAll('.hud__top-left .segmented');

    expect(groups).toHaveLength(1);
    expect(groups[0]?.childElementCount).toBe(1);

    // Čas běží → tlačítko nabízí pauzu.
    const node = playPause(root);
    expect(node?.getAttribute('aria-label')).toBe('Pauza');
    node?.click();
    expect(calls.speeds).toEqual([0]);

    // V pauze nabízí návrat k běhu.
    hud.update({ ...STATE, speedIndex: 0 });
    expect(node?.getAttribute('aria-label')).toBe('1×');
  });

  it('odpauzování se vrátí na rychlost, na které čas běžel', async () => {
    const { root, hud, calls } = await hudFor('compact');

    hud.update({ ...STATE, speedIndex: 4 }); // 8×
    hud.update({ ...STATE, speedIndex: 0 });
    playPause(root)?.click();

    expect(calls.speeds).toEqual([4]);
  });

  it('zrychlení čeká pod trojtečkou vedle', async () => {
    const { root, hud } = await hudFor('compact');

    expect(root.querySelectorAll('.hud__top-left .menu .menu__item')).toHaveLength(
      SPEEDS.length - 2,
    );

    // Dokud běží pauza nebo 1×, je na tlačítku trojtečka a nesvítí. Popoverů
    // je nahoře víc (statistiky jsou taky jeden), tak se hledá ten s nabídkou.
    const trigger = [...root.querySelectorAll('.hud__top-left .popover')]
      .find((node) => node.querySelector('.menu'))
      ?.querySelector('.popover__trigger');
    expect(trigger?.classList.contains('is-active')).toBe(false);

    // Jakmile si hráč pustí něco rychlejšího, tlačítko se rozsvítí — jinak by
    // po zavření nebylo poznat, že čas letí.
    hud.update({ ...STATE, speedIndex: 4 });
    expect(trigger?.classList.contains('is-active')).toBe(true);
  });

  it('na počítači zůstává všech pět stupňů v liště', async () => {
    const { root } = await hudFor('full');
    expect(root.querySelectorAll('.hud__top-left .segmented__button')).toHaveLength(SPEEDS.length);
    expect(root.querySelector('.hud__top-left .menu')).toBeNull();
  });
});

describe('střední velikost', () => {
  /*
   * Mezi telefonem a širokým monitorem je okno na půl obrazovky, kde se plná
   * lišta zalomí do dvou řad nahoře i dole. Autor to nahlásil se snímkem okna
   * širokého 1044 pixelů.
   */
  it('schová nástroje a ovládání pod trojtečku, stejně jako telefon', async () => {
    const { root } = await hudFor('dense');
    expect(widgets(root, DRAWER_CONTROLS)).toBe(10);
    expect(label(root, 'Další')).not.toBeNull();
  });

  it('z jedenácti statistik nechá kasu s bilancí', async () => {
    // Osm statistik s velkými čísly je přes sedm set pixelů a odsune rychlost
    // na druhý řádek. Zbytek je klik daleko.
    const { root } = await hudFor('dense');
    const trigger = root.querySelector('.popover--stats .popover__trigger');
    expect([...(trigger?.querySelectorAll('.stat__label') ?? [])].map((n) => n.textContent)).toEqual(
      ['Kasa', 'Měsíční bilance'],
    );
    expect(root.querySelectorAll('.panel--stats .stat')).toHaveLength(9);
  });

  it('ale nechá si všechny rychlosti, oba pohledy a nedává lupu', async () => {
    // Na okně, kde se vejdou, není důvod je slučovat — to je věc telefonu.
    const { root } = await hudFor('dense');
    expect(root.querySelectorAll('.hud__top-left .segmented__button')).toHaveLength(SPEEDS.length);
    expect(label(root, 'Pohled na povrch')).not.toBeNull();
    expect(label(root, 'Pohled pod zem')).not.toBeNull();
    expect(label(root, 'Přiblížit')).toBeNull();
  });

  it('síť a uložení zůstávají v řadě ovládání, ne u palety', async () => {
    // Přesun k paletě je věc telefonu, kde jde o každý pixel.
    const { root } = await hudFor('dense');
    expect(widgets(root, EXTRAS)).toBe(0);
    expect(root.querySelector(`${ROW} [aria-label="Čtvercová síť"]`)).not.toBeNull();
  });
});

describe('přepínání režimu', () => {
  it('přestaví lištu, ne jen schová', async () => {
    // Otočení telefonu nebo zúžení okna. Kdyby se jen měnilo CSS, zůstala by
    // v liště tlačítka, která tam nepatří — přesouvá se strom, ne vzhled.
    const { root, hud } = await hudFor('full');
    expect(widgets(root, DRAWER_CONTROLS)).toBe(0);

    hud.setLayout('compact');
    // Vrstvy, katastrofy, daně, financování, poradce, rozpočet, půjčky, MHD,
    // nápověda, jazyk.
    expect(widgets(root, DRAWER_CONTROLS)).toBe(10);
    expect(root.classList.contains('hud--compact')).toBe(true);

    hud.setLayout('full');
    expect(widgets(root, DRAWER_CONTROLS)).toBe(0);
    expect(widgets(root, EXTRAS)).toBe(0);
    expect(root.classList.contains('hud--compact')).toBe(false);
  });

  it('hláška o uložení se přestavěním lišty nezdvojí', async () => {
    const { root, hud } = await hudFor('full');
    hud.setLayout('compact');
    hud.setLayout('full');
    expect(root.querySelectorAll('.hud__message')).toHaveLength(1);
  });
});

describe('úsporná paleta nástrojů', () => {
  /** Vysunutá řada tak, jak ji paletě podává HUD. */
  function overflow(): { slot: ToolbarOverflow; host: HTMLElement; closed: () => number } {
    const host = document.createElement('div');
    let closed = 0;
    return {
      slot: {
        host,
        close: () => {
          closed += 1;
        },
      },
      host,
      closed: () => closed,
    };
  }

  it('v liště zůstane pacička, silnice, terén, zóny a buldozer', async () => {
    const tools = createTools(await vanilla());
    const groups = groupTools(tools).map((group) => group.key);

    // Každá jmenovaná nabídka musí ve hře doopravdy existovat — překlep by
    // jinak jen tiše schoval nástroj, o kterém autor řekl, že má zůstat.
    for (const key of COMPACT_GROUPS) expect(groups, key).toContain(key);
    expect(COMPACT_GROUPS).toHaveLength(5);
  });

  it('schované nabídky jdou do řady, kterou drží HUD, a nic se cestou neztratí', async () => {
    const content = await vanilla();
    const tools = createTools(content);
    const parent = document.createElement('div');
    const over = overflow();
    new Toolbar(parent, await i18nFor(content), tools, 'pan', true, over.slot, () => {});

    // Paleta si **žádnou trojtečku nestaví** — je jedna a patří HUDu.
    expect(parent.querySelector('.toolbar')?.childElementCount).toBe(COMPACT_GROUPS.length);
    expect(over.host.childElementCount).toBe(groupTools(tools).length - COMPACT_GROUPS.length);
  });

  it('výběr nástroje ze schované řady ji zavře', async () => {
    // Kdo si vybral elektrárnu, chce vidět mapu a postavit ji — ne odklikávat
    // seznam, který mu na telefonu zabírá půlku obrazovky.
    const content = await vanilla();
    const parent = document.createElement('div');
    const picked: ToolOption[] = [];
    const over = overflow();
    new Toolbar(
      parent,
      await i18nFor(content),
      createTools(content),
      'pan',
      true,
      over.slot,
      (tool) => picked.push(tool),
    );

    over.host.querySelector<HTMLButtonElement>('.menu__item')?.click();

    expect(picked).toHaveLength(1);
    expect(over.closed()).toBe(1);
  });

  it('bez místa, kam schované pověsit, zůstane v liště všechno', async () => {
    // Radši zalomená lišta než nástroje, ke kterým nevede tlačítko.
    const content = await vanilla();
    const parent = document.createElement('div');
    new Toolbar(parent, await i18nFor(content), createTools(content), 'pan', true, null, () => {});

    expect(parent.querySelector('.toolbar')?.childElementCount).toBe(
      groupTools(createTools(content)).length,
    );
  });

  it('v plné verzi je v liště všechno', async () => {
    const content = await vanilla();
    const parent = document.createElement('div');
    const over = overflow();
    new Toolbar(
      parent,
      await i18nFor(content),
      createTools(content),
      'pan',
      false,
      over.slot,
      () => {},
    );

    expect(over.host.childElementCount).toBe(0);
    expect(parent.querySelectorAll('.toolbar > *')).toHaveLength(
      groupTools(createTools(content)).length,
    );
  });
});

describe('ikony a texty mobilní lišty', () => {
  it('každá nová ikona jde nakreslit', async () => {
    const content = await vanilla();
    const icons = content.getIcons();
    for (const name of ['zoom-in', 'zoom-out', 'more', 'reload', 'speed-8', 'view-grid']) {
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
      'ui.view.grid',
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
