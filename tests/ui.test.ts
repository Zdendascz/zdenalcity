/**
 * @vitest-environment jsdom
 *
 * Pixi si při importu sáhne na `navigator` (`isSafari`), takže tenhle soubor
 * potřebuje DOM. Je to pragma pro jeden soubor, ne globální nastavení —
 * simulační testy tím zůstávají ve `node` a neplatí za jsdom časem.
 */
import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { createLayerOptions, createTools, createViewOptions } from '@/render/app';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { uiIconShape } from '@/ui/icons';
import { fromBase64, toBase64 } from '@/platform/browser';
import { groupTools } from '@/ui/toolbar';
import { DisasterAlert, nextToAnnounce } from '@/ui/disasterAlert';

/** Všechny druhy pohrom, které hra registruje. Sedlo by se sem sáhnout do
 * registru, jenže ten žije až v `app.ts` a ten potřebuje Pixi i canvas. */
const DISASTER_KINDS = [
  'fire', 'wildfire', 'flood', 'tornado', 'earthquake', 'explosion',
  'industrialAccident', 'pileup', 'strike', 'riot', 'gangWar', 'blackout',
  'epidemic', 'chemicalSpill', 'landslide',
] as const;

/**
 * Rozhraní.
 *
 * Testuje se to, co jde rozbít potichu: chybějící ikona vykreslí prázdné
 * tlačítko, chybějící překlad vypíše syrový klíč a přeházené pořadí rozsype
 * roletky. Nic z toho by hru neshodilo — a proto by si toho nikdo nevšiml.
 */
async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

async function tables(content: ContentRegistry): Promise<LocaleTables> {
  const out: Record<string, Record<string, string>> = {};
  for (const language of content.getLanguages()) out[language] = content.getLocaleTable(language);
  return out as LocaleTables;
}

/**
 * Ikona je nakreslitelná, když ji obsah dodal jako obrázek, nebo když na ni
 * existuje polygon. Obojí je platná cesta — obrázek má přednost, polygon je
 * záloha pro jména, ke kterým obsah nic nemá.
 */
function drawable(content: ContentRegistry, name: string): boolean {
  return content.getIcons()[name] !== undefined || uiIconShape(name) !== undefined;
}

describe('paleta nástrojů', () => {
  it('každý nástroj má ikonu, kterou umíme nakreslit', async () => {
    const content = await vanilla();
    const tools = createTools(content);
    expect(tools.length).toBeGreaterThan(20);

    for (const tool of tools) {
      expect(drawable(content, tool.icon), `nekreslitelná ikona ${tool.icon} (${tool.id})`).toBe(
        true,
      );
      expect(drawable(content, tool.groupIcon), `nekreslitelná ikona ${tool.groupIcon}`).toBe(true);
    }
  });

  it('každý popisek i název nabídky má překlad ve všech jazycích', async () => {
    const content = await vanilla();
    const tools = createTools(content);
    const locales = await tables(content);

    for (const language of content.getLanguages()) {
      const i18n = new I18n(locales, language);
      for (const tool of tools) {
        // `t()` vrací klíč, když překlad chybí — právě to hlídáme.
        expect(i18n.t(tool.labelKey), `${language}: ${tool.labelKey}`).not.toBe(tool.labelKey);
        expect(i18n.t(tool.groupKey), `${language}: ${tool.groupKey}`).not.toBe(tool.groupKey);
      }
    }
  });

  it('nástroje jedné nabídky jdou v seznamu za sebou', async () => {
    // Roletka se skládá z jednoho souvislého úseku. Kdyby se nabídka v seznamu
    // objevila dvakrát, hráč by měl v liště dvě „Kultury" a v každé půlku budov.
    const tools = createTools(await vanilla());
    const groups = groupTools(tools);
    const keys = groups.map((group) => group.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(tools.map((tool) => tool.groupKey)).toEqual(
      groups.flatMap((group) => group.tools.map(() => group.key)),
    );
  });

  it('budovy jsou rozdělené podle typu, ne naházené v jedné roletě', async () => {
    const groups = groupTools(createTools(await vanilla()));
    const byKey = new Map(groups.map((group) => [group.key, group]));

    // Vodárna, čerpací stanice, čistírna a potrubí patří k sobě; elektrárna jinam.
    expect(byKey.get('ui.menu.water')?.tools).toHaveLength(4);
    // Potrubí **musí** být v paletě jako samostatný nástroj. Dokud jím byla
    // přepnutá silnice, lišta hlásila „Ulice, 10" a účtovala šest.
    expect(byKey.get('ui.menu.water')?.tools.map((tool) => tool.action.kind)).toContain('pipe');
    // Uhelná, plynová, jaderná a větrná.
    expect(byKey.get('ui.menu.power')?.tools).toHaveLength(4);
    expect(byKey.get('ui.menu.culture')?.tools).toHaveLength(4);
    expect(byKey.get('ui.menu.waste')?.tools).toHaveLength(2);
    // Silnice mají vlastní roletu, ne společnou se stavbou.
    expect(byKey.get('ui.menu.road')?.tools).toHaveLength(3);
    // Buldozer je sám — roleta o jedné položce je jen kliknutí navíc.
    expect(byKey.get('ui.tool.bulldoze')?.tools).toHaveLength(1);
  });

  it('žádná roleta nemá víc položek, než se dá přehlédnout', async () => {
    // Smysl celé přestavby: rozbalený seznam se má dát přečíst na jeden pohled.
    for (const group of groupTools(createTools(await vanilla()))) {
      expect(group.tools.length, group.key).toBeLessThanOrEqual(6);
    }
  });

  it('každá ručně stavěná budova ví, do které nabídky patří', async () => {
    // Bez `menu` by spadla do nabídky podle kategorie, tedy do jednoho pytle
    // „Služby" s dvanácti dalšími. Fallback existuje pro mody, ne pro vanillu.
    const content = await vanilla();
    for (const definition of [...content.byCategory('utility'), ...content.byCategory('service')]) {
      expect(definition.menu, definition.id).toBeDefined();
    }
  });
});

describe('pohledy a vrstvy', () => {
  it('povrch a podzemí jsou pohledy, ne vrstvy', async () => {
    const views = createViewOptions();
    const layers = createLayerOptions(await vanilla());

    expect(views.map((view) => view.id)).toEqual(['surface', 'underground']);
    // Podzemí mění chování nástrojů, takže mezi diagnostické vrstvy nepatří —
    // do T41 tam bylo a přepínalo se s nimi navzájem.
    expect(layers.map((layer) => layer.id)).not.toContain('underground');
  });

  it('každá vrstva i pohled má ikonu a překlad', async () => {
    const content = await vanilla();
    const locales = await tables(content);
    const options = [...createViewOptions(), ...createLayerOptions(content)];

    for (const language of content.getLanguages()) {
      const i18n = new I18n(locales, language);
      for (const option of options) {
        expect(drawable(content, option.icon), `${option.id}: ${option.icon}`).toBe(true);
        expect(i18n.t(option.labelKey), `${language}: ${option.labelKey}`).not.toBe(
          option.labelKey,
        );
      }
    }
  });

  it('dosah služby má vlastní ikonu, když ji obsah dodal', async () => {
    const content = await vanilla();
    const layers = createLayerOptions(content);

    // Vrstva ukazuje dosah, ne budovu, tak má přednost kreslená `coverage-*`.
    const police = layers.find((layer) => layer.id === 'coverage:police');
    expect(police?.icon).toBe('coverage-police');
  });

  it('dosah třídy bez vlastní ikony spadne na symbol její budovy', async () => {
    const content = await vanilla();
    const layers = createLayerOptions(content);

    // `social` obrázek nemá — a nesmí kvůli tomu zůstat bez ikony, protože
    // třídu služby smí přinést i mod, který ke své vrstvě žádnou nenakreslí.
    const social = layers.find((layer) => layer.id === 'coverage:social');
    expect(content.getIcons()['coverage-social']).toBeUndefined();
    expect(social?.icon).toBe(content.get('vanilla:community_centre')?.graphics.icon);
  });
});

describe('automatické uložení', () => {
  it('base64 přežije i velký save', () => {
    // `String.fromCharCode(...bytes)` na desítkách tisíc bajtů přeteče
    // zásobník — proto se kóduje po blocích. Reálný save je zhruba tahle velký.
    const bytes = new Uint8Array(120_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256;

    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });

  it('prázdné pole projde taky', () => {
    expect(fromBase64(toBase64(new Uint8Array(0))).length).toBe(0);
  });
});

describe('hlášení o katastrofě', () => {
  const fire = { id: 1, kind: 'fire', x: 5, y: 5 };
  const flood = { id: 2, kind: 'flood', x: 9, y: 9 };

  it('ohlásí první neohlášenou pohromu', () => {
    expect(nextToAnnounce([fire, flood], new Set(), new Set())).toBe(fire);
  });

  it('už ohlášenou přeskočí', () => {
    // Bez tohohle by okno naskakovalo každý snímek, dokud pohroma běží.
    expect(nextToAnnounce([fire, flood], new Set([1]), new Set())).toBe(flood);
    expect(nextToAnnounce([fire], new Set([1]), new Set())).toBeNull();
  });

  it('ručně spuštěnou přeskočí', () => {
    // Hráč na ni klikl sám, ví o ní líp než hra.
    expect(nextToAnnounce([fire], new Set(), new Set([1]))).toBeNull();
  });

  it('druhá pohroma počká, ale neztratí se', () => {
    // Tohle je ta chyba, kvůli které tenhle test vznikl: kdyby se `announced`
    // plnilo dřív, než se okno otevře, přišel by hráč o zprávu, kterou nikdy
    // neviděl — přesně to ticho, kvůli kterému okno vzniklo.
    const announced = new Set<number>();

    const first = nextToAnnounce([fire, flood], announced, new Set());
    expect(first).toBe(fire);
    announced.add(first?.id ?? 0);

    const second = nextToAnnounce([fire, flood], announced, new Set());
    expect(second).toBe(flood);
  });

  it('každá pohroma má hlášku i tlačítka ve všech jazycích', async () => {
    // Jméno pohromy je jedna věc, popis toho, co s tím dělat, druhá. Katastrofa
    // bez popisu by hráči ukázala prázdné okno.
    const content = await vanilla();
    const locales = await tables(content);

    for (const language of content.getLanguages()) {
      const i18n = new I18n(locales, language);
      for (const key of ['ui.alert.title', 'ui.alert.show', 'ui.alert.ignore']) {
        expect(i18n.t(key), `${language}: ${key}`).not.toBe(key);
      }
      for (const kind of DISASTER_KINDS) {
        const key = `ui.alert.body.${kind}`;
        expect(i18n.t(key), `${language}: ${key}`).not.toBe(key);
      }
    }
  });
});

describe('okno hlášení', () => {
  async function alert(): Promise<{ node: HTMLElement; alert: DisasterAlert; shown: number[] }> {
    const content = await vanilla();
    const i18n = new I18n(await tables(content), 'cs');
    const node = document.createElement('div');
    const shown: number[] = [];
    return {
      node,
      shown,
      alert: new DisasterAlert(node, i18n, {
        onIgnore: () => {},
        onShow: (x, y) => shown.push(x, y),
      }),
    };
  }

  it('ukáže jméno pohromy i co s tím', async () => {
    const { node, alert: a } = await alert();
    expect(a.open('fire', 3, 4)).toBe(true);

    const text = node.textContent ?? '';
    expect(text).toContain('Požár');
    // Ne jen jméno — hráč potřebuje vědět, co s tím může dělat.
    expect(text.length).toBeGreaterThan(60);
    expect(a.isOpen).toBe(true);
  });

  it('druhé hlášení první nepřebije', async () => {
    // Kdyby přebilo, přišel by hráč o zprávu, kterou ještě nestihl přečíst —
    // a to je přesně to ticho, kvůli kterému okno vzniklo.
    const { node, alert: a } = await alert();
    expect(a.open('fire', 3, 4)).toBe(true);
    expect(a.open('flood', 9, 9)).toBe(false);
    expect(node.textContent ?? '').toContain('Požár');
  });

  it('po zavření se dá ohlásit další', async () => {
    const { alert: a } = await alert();
    a.open('fire', 3, 4);
    a.hide();
    expect(a.isOpen).toBe(false);
    expect(a.open('flood', 9, 9)).toBe(true);
  });

  it('ukázat pošle souřadnice pohromy, ne kurzoru', async () => {
    const { node, alert: a, shown } = await alert();
    a.open('tornado', 12, 34);
    node.querySelector<HTMLButtonElement>('.chip--primary')?.click();

    expect(shown).toEqual([12, 34]);
    expect(a.isOpen).toBe(false);
  });
});
