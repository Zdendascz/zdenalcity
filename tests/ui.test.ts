import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { createLayerOptions, createTools, createViewOptions } from '@/render/app';
import { I18n } from '@/ui/i18n';
import type { LocaleTables } from '@/ui/i18n';
import { uiIconShape } from '@/ui/icons';
import { groupTools } from '@/ui/toolbar';

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

describe('paleta nástrojů', () => {
  it('každý nástroj má ikonu, kterou umíme nakreslit', async () => {
    const tools = createTools(await vanilla());
    expect(tools.length).toBeGreaterThan(20);

    for (const tool of tools) {
      expect(uiIconShape(tool.icon), `chybí tvar ikony ${tool.icon} (${tool.id})`).toBeDefined();
      expect(uiIconShape(tool.groupIcon), `chybí tvar ${tool.groupIcon}`).toBeDefined();
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

    // Vodárna, čerpací stanice a čistírna patří k sobě; elektrárna jinam.
    expect(byKey.get('ui.menu.water')?.tools).toHaveLength(3);
    expect(byKey.get('ui.menu.power')?.tools).toHaveLength(1);
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
        expect(uiIconShape(option.icon), `${option.id}: ${option.icon}`).toBeDefined();
        expect(i18n.t(option.labelKey), `${language}: ${option.labelKey}`).not.toBe(
          option.labelKey,
        );
      }
    }
  });

  it('dosah služby nese týž symbol jako budova, která ji poskytuje', async () => {
    const content = await vanilla();
    const layers = createLayerOptions(content);

    const police = layers.find((layer) => layer.id === 'coverage:police');
    expect(police?.icon).toBe(content.get('vanilla:police_small')?.graphics.icon);
  });
});
