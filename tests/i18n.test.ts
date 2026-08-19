import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { landValueTermKeys } from '@/ui/format';
import { dateParts } from '@/ui/hud';
import { FALLBACK_LANGUAGE, I18n, pickLanguage } from '@/ui/i18n';

const TABLES = {
  en: { 'ui.tool.road': 'Road', 'ui.only.en': 'English only', 'ui.hi': 'Hello {name}' },
  cs: { 'ui.tool.road': 'Silnice', 'ui.hi': 'Ahoj {name}' },
};

describe('překlad', () => {
  it('vrátí text v aktuálním jazyce', () => {
    expect(new I18n(TABLES, 'cs').t('ui.tool.road')).toBe('Silnice');
    expect(new I18n(TABLES, 'en').t('ui.tool.road')).toBe('Road');
  });

  it('chybějící překlad padá na angličtinu (§10)', () => {
    expect(new I18n(TABLES, 'cs').t('ui.only.en')).toBe('English only');
  });

  it('úplně chybějící klíč vrátí sám sebe, aby byl vidět', () => {
    expect(new I18n(TABLES, 'cs').t('ui.neexistuje')).toBe('ui.neexistuje');
    expect(new I18n(TABLES, 'cs').has('ui.neexistuje')).toBe(false);
  });

  it('doplní parametry do zástupných symbolů', () => {
    expect(new I18n(TABLES, 'cs').t('ui.hi', { name: 'Zdeňku' })).toBe('Ahoj Zdeňku');
  });

  it('nezadaný parametr nechá symbol viditelný', () => {
    expect(new I18n(TABLES, 'cs').t('ui.hi')).toBe('Ahoj {name}');
  });

  it('přepnutí jazyka ohlásí posluchačům', () => {
    const i18n = new I18n(TABLES, 'en');
    let notified = 0;
    i18n.onChange(() => notified++);

    i18n.setLanguage('cs');
    expect(i18n.t('ui.tool.road')).toBe('Silnice');
    expect(notified).toBe(1);

    i18n.setLanguage('cs'); // stejný jazyk už nehlásí
    expect(notified).toBe(1);
  });
});

describe('výběr jazyka', () => {
  it('vezme přesnou shodu', () => {
    expect(pickLanguage(['cs'], ['cs', 'en'])).toBe('cs');
  });

  it('rozumí tvaru cs-CZ', () => {
    expect(pickLanguage(['cs-CZ'], ['cs', 'en'])).toBe('cs');
  });

  it('projde preference po pořadí', () => {
    expect(pickLanguage(['de', 'sk-SK', 'cs'], ['cs', 'en'])).toBe('cs');
  });

  it('když nesedí nic, padá na angličtinu', () => {
    expect(pickLanguage(['de'], ['cs', 'en'])).toBe(FALLBACK_LANGUAGE);
  });
});

describe('locale soubory vanilla obsahu', () => {
  it('registr vydá tabulky pro čeština i angličtinu', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    expect(content.getLanguages()).toEqual(['cs', 'en']);
    expect(content.getLocaleTable('cs')['ui.tool.road']).toBe('Silnice');
  });

  it('čeština a angličtina mají stejnou sadu klíčů', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    const cs = Object.keys(content.getLocaleTable('cs')).sort();
    const en = Object.keys(content.getLocaleTable('en')).sort();

    expect(cs).toEqual(en);
  });

  it('žádný text není prázdný', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());

    for (const language of content.getLanguages()) {
      for (const [key, text] of Object.entries(content.getLocaleTable(language))) {
        expect(text.trim(), `${language}:${key}`).not.toBe('');
      }
    }
  });

  it('pozdější zdroj smí text přepsat', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    await content.load({
      label: 'test',
      manifest: {
        id: 'preklad',
        name: 'Překlad',
        version: '1.0.0',
        gameVersion: '>=0.1.0',
        dependencies: [],
      },
      definitions: [],
      locales: { cs: { 'ui.tool.road': 'Cesta' } },
    });

    expect(content.getLocaleTable('cs')['ui.tool.road']).toBe('Cesta');
  });
});

describe('žádná hláška nesmí skončit jako syrový klíč', () => {
  /**
   * Projde zdrojáky, vytáhne z nich literální lokalizační klíče a ověří, že
   * pro každý existuje text v obou jazycích. Bez toho by chyba, kterou nikdo
   * netestuje, vyskočila hráči jako `error.needsRoad`.
   */
  const sources = import.meta.glob('../src/**/*.ts', {
    eager: true,
    import: 'default',
    query: '?raw',
  });

  function collectKeys(pattern: RegExp): string[] {
    const keys = new Set<string>();
    for (const raw of Object.values(sources)) {
      for (const match of String(raw).matchAll(pattern)) {
        const key = match[1];
        if (key) keys.add(key);
      }
    }
    return [...keys].sort();
  }

  it('všechny důvody odmítnutí mají překlad', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const cs = content.getLocaleTable('cs');
    const en = content.getLocaleTable('en');

    const reasons = collectKeys(/reject\(\s*'([\w.]+)'/g);
    expect(reasons.length).toBeGreaterThan(8);

    for (const key of reasons) {
      expect(cs[key], `chybí česky: ${key}`).toBeDefined();
      expect(en[key], `chybí anglicky: ${key}`).toBeDefined();
    }
  });

  it('hláška se zástupným symbolem se nesmí odmítat bez parametrů', async () => {
    // Přesně tahle chyba se stala: `error.occupied` hlásila silnice bez parametrů,
    // ale text obsahoval {width} × {depth}, takže se hráči vypsaly složené závorky.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const en = content.getLocaleTable('en');

    const bezParametru = new Set<string>();
    for (const raw of Object.values(sources)) {
      for (const match of String(raw).matchAll(/reject\(\s*'([\w.]+)'(\s*,)?/g)) {
        if (match[1] && !match[2]) bezParametru.add(match[1]);
      }
    }

    for (const key of bezParametru) {
      expect(en[key] ?? '', `${key} se odmítá bez parametrů`).not.toMatch(/\{\w+\}/);
    }
  });

  it('všechny literální klíče předané do t() mají překlad', async () => {
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const cs = content.getLocaleTable('cs');
    const en = content.getLocaleTable('en');

    const used = collectKeys(/\bt\(\s*'((?:ui|error)\.[\w.]+)'/g);
    expect(used.length).toBeGreaterThan(20);

    for (const key of used) {
      expect(cs[key], `chybí česky: ${key}`).toBeDefined();
      expect(en[key], `chybí anglicky: ${key}`).toBeDefined();
    }
  });
});

describe('popisky v rozpisu ceny půdy', () => {
  it('každý možný člen má popisek v obou jazycích', async () => {
    // Zdroje členů se skládají za běhu z názvů vah, takže je test na literální
    // klíče nevidí. Bez tohohle testu svítí v panelu holé „ui.overlay.xyz“ —
    // což se u kolon i u lesa opravdu stalo.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    const tables = { cs: content.getLocaleTable('cs'), en: content.getLocaleTable('en') };

    const sources = ['base', 'water', ...Object.keys(content.getBalance().landValue.weights)];
    expect(sources).toContain('congestion');

    for (const [language, table] of Object.entries(tables)) {
      for (const source of sources) {
        const found = landValueTermKeys(source).some((key) => table[key] !== undefined);
        expect(found, `${language}: žádný popisek pro člen „${source}“`).toBe(true);
      }
    }
  });
});

describe('herní datum', () => {
  it('tik je den, 30 dní měsíc, 12 měsíců rok', () => {
    expect(dateParts(0)).toEqual({ year: 1, month: 1, day: 1 });
    expect(dateParts(29)).toEqual({ year: 1, month: 1, day: 30 });
    expect(dateParts(30)).toEqual({ year: 1, month: 2, day: 1 });
    expect(dateParts(359)).toEqual({ year: 1, month: 12, day: 30 });
    expect(dateParts(360)).toEqual({ year: 2, month: 1, day: 1 });
  });
});
