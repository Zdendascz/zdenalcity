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
import { afterEach, describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { SPEEDS } from '@/sim/simHost';
import { cssUrl, setPressed, setText } from '@/ui/dom';
import { formatDecimal1, formatNumber, formatPercent, setNumberLocale } from '@/ui/format';
import { I18n } from '@/ui/i18n';
import { showNewGameDialog } from '@/ui/newGameDialog';
import { Notifications } from '@/ui/notifications';
import { Popover } from '@/ui/popover';

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

describe('čísla a procenta podle jazyka', () => {
  afterEach(() => setNumberLocale('cs-CZ'));

  it('procenta: česky s mezerou, anglicky bez', () => {
    setNumberLocale('cs-CZ');
    expect(formatPercent(50)).toMatch(/^50\s%$/);
    setNumberLocale('en-US');
    expect(formatPercent(50)).toBe('50%');
  });

  it('přepnutí jazyka zahodí uložený formátovač', () => {
    setNumberLocale('cs-CZ');
    expect(formatDecimal1(1.5)).toBe('1,5');
    setNumberLocale('en-US');
    expect(formatDecimal1(1.5)).toBe('1.5');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('neplatná značka z překladu HUD neshodí', () => {
    setNumberLocale('tohle-neni-jazyk!');
    expect(formatNumber(12)).toBe('12');
  });
});

describe('zápis do DOMu jen při změně', () => {
  it('stejný text uzel nepřepíše', () => {
    const node = document.createElement('span');
    setText(node, 'a');
    const first = node.firstChild;
    setText(node, 'a');
    expect(node.firstChild).toBe(first);
    setText(node, 'b');
    expect(node.textContent).toBe('b');
  });

  it('adresa v CSS je v uvozovkách a escapovaná', () => {
    expect(cssUrl('a b(1).png')).toBe('url("a b(1).png")');
    expect(cssUrl('x"y\\z')).toBe('url("x\\"y\\\\z")');
  });
});

describe('přístupnost', () => {
  it('přepínač nese stav v aria-pressed', () => {
    const node = document.createElement('button');
    setPressed(node, true);
    expect(node.getAttribute('aria-pressed')).toBe('true');
    expect(node.classList.contains('is-active')).toBe(true);
    setPressed(node, false);
    expect(node.getAttribute('aria-pressed')).toBe('false');
  });

  it('roletka hlásí, jestli je otevřená', () => {
    const popover = new Popover({ icon: 'save', label: 'Uložit' });
    document.body.appendChild(popover.root);
    expect(popover.trigger.getAttribute('aria-expanded')).toBe('false');
    popover.show();
    expect(popover.trigger.getAttribute('aria-expanded')).toBe('true');
    popover.close();
    expect(popover.trigger.getAttribute('aria-expanded')).toBe('false');
    popover.root.remove();
  });

  it('hlášky jsou živá oblast', () => {
    const host = document.createElement('div');
    new Notifications(host).show('x');
    const root = host.firstElementChild;
    expect(root?.getAttribute('aria-live')).toBe('polite');
    expect(root?.getAttribute('role')).toBe('status');
  });

  it('dialog nové hry je modální a má jméno', async () => {
    const content = await vanilla();
    const tables: Record<string, Record<string, string>> = {};
    for (const lang of content.getLanguages()) tables[lang] = content.getLocaleTable(lang);
    const i18n = new I18n(tables, 'cs');
    const host = document.createElement('div');
    void showNewGameDialog(host, i18n, content.getBalance());
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    // Nadpis se hledá v hostiteli, ne v dokumentu: ten do stránky zavěšený není.
    const titleId = dialog?.getAttribute('aria-labelledby') ?? '';
    expect(host.querySelector(`#${titleId}`)?.textContent).toBe(i18n.t('ui.newGame.title'));
    // Tlačítka mají ikonu i text.
    const start = [...host.querySelectorAll('.dialog__actions button')].at(-1);
    expect(start?.querySelector('.icon')).not.toBeNull();
    expect(start?.textContent).toBe(i18n.t('ui.newGame.start'));
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
