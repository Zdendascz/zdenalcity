/**
 * @vitest-environment jsdom
 *
 * Platform vrstva sahá na `localStorage` a `Blob`, takže potřebuje DOM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserPlatform, fromBase64, toBase64 } from '@/platform/browser';

/**
 * Platform abstrakce (architektura §9, rozhodnutí autora).
 *
 * Testy jsou hlavně o dvou věcech, které se dají splést tiše: že se sloty
 * nepřepisují navzájem a že se plné úložiště ohlásí, místo aby hru shodilo.
 */

describe('úložiště savů', () => {
  beforeEach(() => localStorage.clear());

  it('co se uloží, to se přečte', async () => {
    const platform = createBrowserPlatform();
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);

    expect(await platform.storage.write('quick', bytes)).toBe(true);

    expect([...(await platform.storage.read('quick') ?? [])]).toEqual([...bytes]);
  });

  it('rychlý save a automatický se nepřepisují', async () => {
    // Nahlásil autor: rychlý save se dřív držel v proměnné a s obnovením
    // stránky mizel. Teď je v úložišti — ale nesmí přebít autosave, jinak by
    // hráč po F5 dostal město, které si neuložil.
    const platform = createBrowserPlatform();
    await platform.storage.write('autosave', new Uint8Array([1]));
    await platform.storage.write('quick', new Uint8Array([2]));

    expect([...(await platform.storage.read('autosave') ?? [])]).toEqual([1]);
    expect([...(await platform.storage.read('quick') ?? [])]).toEqual([2]);
  });

  it('rychlý save přežije nový běh hry', async () => {
    // Přesně ten případ z hlášení: uložit, obnovit stránku, načíst. Nová
    // instance platformy zastupuje nový běh.
    const bytes = new Uint8Array([9, 8, 7]);
    await createBrowserPlatform().storage.write('quick', bytes);

    const poObnoveni = createBrowserPlatform();

    expect(await poObnoveni.storage.has('quick')).toBe(true);
    expect([...(await poObnoveni.storage.read('quick') ?? [])]).toEqual([...bytes]);
  });

  it('prázdný slot vrátí null, ne výjimku', async () => {
    const platform = createBrowserPlatform();
    expect(await platform.storage.read('quick')).toBeNull();
    expect(await platform.storage.has('quick')).toBe(false);
  });

  it('smazání slot vyprázdní', async () => {
    const platform = createBrowserPlatform();
    await platform.storage.write('autosave', new Uint8Array([1]));

    await platform.storage.remove('autosave');

    expect(await platform.storage.has('autosave')).toBe(false);
  });

  it('poškozený záznam se chová jako žádný', async () => {
    // Ručně upravené úložiště nebo save z rozbité verze. Shodit kvůli němu hru
    // by znamenalo, že se hráč do hry vůbec nedostane.
    const platform = createBrowserPlatform();
    localStorage.setItem('citybuilder:quicksave', 'tohle rozhodně není base64!!');

    expect(await platform.storage.read('quick')).toBeNull();
  });

  it('plné úložiště se ohlásí, ne vyhodí', async () => {
    // Volající podle návratové hodnoty pozná, že se neuložilo, a řekne to
    // hráči. Výjimka by mu shodila rozehranou hru.
    const platform = createBrowserPlatform();
    // Přes prototyp, ne přes instanci: `localStorage` je v jsdomu proxy, která
    // zápis vlastní vlastnosti spolkne, a podvržená metoda by se nikdy nezavolala.
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    try {
      expect(await platform.storage.write('quick', new Uint8Array([1]))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('klíč automatického uložení se od minula nezměnil', async () => {
    // Kdyby se přejmenoval, přišel by každý hráč o rozehrané město tím, že si
    // stáhne novou verzi hry.
    await createBrowserPlatform().storage.write('autosave', new Uint8Array([1]));

    expect(localStorage.getItem('citybuilder:autosave')).not.toBeNull();
  });
});

describe('base64', () => {
  it('velké pole projde tam a zpátky', () => {
    // `String.fromCharCode(...bytes)` přeteče zásobník kolem sta tisíc prvků,
    // proto se kóduje po blocích.
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});

describe('zaslepené metody §9', () => {
  it('prohlížeč nezná hráče, DLC ani Workshop', async () => {
    // §9 je předepisuje, aby se Steam později přilepil bez zásahu do herního
    // kódu. Test drží tvar, ne chování.
    const platform = createBrowserPlatform();

    expect(platform.id).toBe('browser');
    expect(await platform.getUserId()).toBeNull();
    expect(platform.hasDlc('cokoli')).toBe(false);
    expect(platform.getSavePath()).toBeNull();
    expect(platform.workshopAvailable()).toBe(false);
    expect(await platform.listWorkshopMods()).toEqual([]);
  });
});
