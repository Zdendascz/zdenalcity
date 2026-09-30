/**
 * @vitest-environment jsdom
 *
 * Audit rozhraní (T135): věci, které se rozbily potichu a nikdo si jich
 * nevšiml, protože hra dál běžela.
 *
 * - ikony rychlosti se jmenovaly podle pořadí karty v archu, ne podle násobku,
 *   takže 4× ukazovala čtyři šipky a 8× žádný obrázek;
 * - v obsahu ležely ikony, které nic nepoužívá;
 * - překlad hledal klíče přes prototyp, takže město „constructor" se v nabídce
 *   „Pokračovat v …" vypsalo jako zdroják funkce.
 */
import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { SPEEDS } from '@/sim/simHost';
import { I18n } from '@/ui/i18n';

async function vanilla(): Promise<ContentRegistry> {
  const content = new ContentRegistry();
  await content.load(createVanillaSource());
  return content;
}

describe('ikony rychlosti', () => {
  it('každý násobek má obrázek pod svým jménem', async () => {
    const icons = (await vanilla()).getIcons();
    for (const speed of SPEEDS) {
      const name = speed === 0 ? 'speed-pause' : `speed-${speed}`;
      expect(icons[name], name).toBeDefined();
    }
  });

  it('obrázek pro neexistující rychlost v obsahu neleží', async () => {
    const icons = (await vanilla()).getIcons();
    expect(icons['speed-3']).toBeUndefined();
  });
});

describe('překlad a zděděné klíče', () => {
  const tables = {
    cs: { 'ui.home.resumeNamed': 'Pokračovat v {city}', 'ui.a.b': 'A', 'ui.list.join': ' a ' },
    en: { 'ui.home.resumeNamed': 'Continue {city}' },
  };

  it('has() nevidí klíče z prototypu', () => {
    const i18n = new I18n(tables, 'cs');
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(i18n.has(key), key).toBe(false);
      expect(i18n.t(key), key).toBe(key);
    }
  });

  it('město pojmenované jako vlastnost objektu se vypíše, jak se jmenuje', () => {
    const i18n = new I18n(tables, 'cs');
    for (const city of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect(i18n.t('ui.home.resumeNamed', { city })).toBe(`Pokračovat v ${city}`);
    }
  });

  it('jméno města se nepřekládá, ani když se jmenuje jako klíč bez tečky', () => {
    const i18n = new I18n({ cs: { 'ui.x.y': '{city}', ui: 'nesmí' } }, 'cs');
    expect(i18n.t('ui.x.y', { city: 'ui' })).toBe('ui');
  });

  it('klíč v parametru se pořád přeloží, i seznam klíčů', () => {
    const i18n = new I18n(tables, 'cs');
    expect(i18n.t('ui.home.resumeNamed', { city: 'ui.a.b' })).toBe('Pokračovat v A');
    expect(i18n.t('ui.home.resumeNamed', { city: 'ui.a.b,ui.a.b' })).toBe('Pokračovat v A a A');
  });

  it('neznámý jazyk jako vlastnost prototypu nespadne', () => {
    const i18n = new I18n(tables, 'constructor');
    expect(i18n.t('ui.home.resumeNamed', { city: 'X' })).toBe('Continue X');
  });

  it('jazyk stránky se řídí jazykem hry', () => {
    const i18n = new I18n(tables, 'en');
    expect(document.documentElement.lang).toBe('en');
    i18n.setLanguage('cs');
    expect(document.documentElement.lang).toBe('cs');
  });
});

describe('nepoužité ikony', () => {
  it('ikony bez tlačítka a bez funkce jsou pryč', async () => {
    const icons = (await vanilla()).getIcons();
    // `author` a `share` nahradily `home-author` a `home-share`; splátka úvěru
    // ve hře není.
    for (const name of ['author', 'share', 'loan-repay']) {
      expect(icons[name], name).toBeUndefined();
    }
  });
});
