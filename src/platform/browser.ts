import type { FileTransfer, ModInfo, Platform, SaveSlot, SaveStorage } from './index';

/**
 * Platforma pro prohlížeč (architektura §9).
 *
 * Steam, DLC ani Workshop tu nejsou a zaslepené metody vracejí prázdno — přesně
 * jak §9 předepisuje. Skutečná práce je v `storage` a `files`.
 */

const PREFIX = 'citybuilder:';

/**
 * Kde který slot bydlí.
 *
 * Klíč automatického uložení zůstává `citybuilder:autosave`, jaký byl —
 * kdyby se přejmenoval, přišel by každý hráč o rozehrané město tím, že si
 * stáhne novou verzi.
 */
const KEYS: Readonly<Record<SaveSlot, string>> = {
  autosave: `${PREFIX}autosave`,
  quick: `${PREFIX}quicksave`,
  /** Odložený nečitelný autosave, aby ho šlo poslat autorovi (T106). */
  corrupt: `${PREFIX}corrupt`,
};

/** Do base64 po blocích — `String.fromCharCode(...bytes)` přeteče zásobník. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const block = 0x8000;
  for (let start = 0; start < bytes.length; start += block) {
    binary += String.fromCharCode(...bytes.subarray(start, start + block));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Hustý zápis bajtů do řetězce pro `localStorage` (T134).
 *
 * Kvóta `localStorage` se počítá **ve znacích**, ne v bajtech (kolem pěti
 * milionů na doménu), a base64 nese ve znaku jen 6 bitů — save tak nafoukl
 * o třetinu a tři sloty velkého města se do kvóty nevešly. Tady nese znak
 * **15 bitů**, 2,5× víc než base64: bajt savu stojí 0,53 znaku místo 1,33.
 *
 * Znaky leží v rozsahu U+0100 až U+80FF: žádné řídicí znaky ani nula a hlavně
 * **žádné surogáty** (U+D800–DFFF). Osamělý surogát není platné UTF-16
 * a prohlížeč ho při ukládání smí nahradit otazníkem — save by byl
 * nečitelný. Tenhle rozsah je platný vždy.
 *
 * Tvar: `\u0001` (base64 ho nikdy neobsahuje, takže staré záznamy se poznají),
 * délka v bajtech v šestatřicítkové soustavě, dvojtečka, data.
 */
const PACKED_MARK = '\u0001';
const PACKED_BITS = 15;
const PACKED_BASE = 0x100;

export function packBytes(bytes: Uint8Array): string {
  const codes = new Uint16Array(Math.ceil((bytes.length * 8) / PACKED_BITS));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    if (bits >= PACKED_BITS) {
      bits -= PACKED_BITS;
      codes[at++] = PACKED_BASE + ((buffer >>> bits) & 0x7fff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) codes[at] = PACKED_BASE + ((buffer << (PACKED_BITS - bits)) & 0x7fff);

  let text = `${PACKED_MARK}${bytes.length.toString(36)}:`;
  const block = 0x8000;
  for (let start = 0; start < codes.length; start += block) {
    text += String.fromCharCode(...codes.subarray(start, start + block));
  }
  return text;
}

export function unpackBytes(text: string): Uint8Array {
  const colon = text.indexOf(':');
  const length = Number.parseInt(text.slice(PACKED_MARK.length, colon), 36);
  if (colon < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw new Error('poškozený záznam');
  }
  const bytes = new Uint8Array(length);
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = colon + 1; i < text.length && at < length; i++) {
    const value = text.charCodeAt(i) - PACKED_BASE;
    if (value < 0 || value > 0x7fff) throw new Error('poškozený záznam');
    buffer = (buffer << PACKED_BITS) | value;
    bits += PACKED_BITS;
    while (bits >= 8 && at < length) {
      bits -= 8;
      bytes[at++] = (buffer >>> bits) & 0xff;
    }
    buffer &= (1 << bits) - 1;
  }
  if (at !== length) throw new Error('poškozený záznam');
  return bytes;
}

/** Přečte záznam v obou tvarech: nový hustý i starý base64 (do T134). */
export function decodeStored(text: string): Uint8Array {
  return text.startsWith(PACKED_MARK) ? unpackBytes(text) : fromBase64(text);
}

/**
 * Úložiště v `localStorage`.
 *
 * **Ne IndexedDB, i když ji §9 zmiňuje** — a je to rozhodnutí, ne opomenutí.
 * Ukládá se mimo jiné na `pagehide`, kde prohlížeč stránku zabalí dřív, než by
 * se asynchronní zápis stihl dokončit; hráč by přišel o město právě ve chvíli,
 * kdy zavírá kartu. `localStorage` píše synchronně, takže tenhle případ
 * funguje.
 *
 * Cena je kvóta kolem pěti milionů znaků. Do T134 se ukládalo v base64, které
 * save nafouklo o třetinu; teď v `packBytes` s 15 bity na znak. Až město
 * naroste i přes to, je IndexedDB náhrada za tenhle jeden soubor — a právě
 * proto je rozhraní asynchronní, přestože tady se nic nečeká.
 */
function createLocalStorage(): SaveStorage {
  return {
    read: (slot) =>
      Promise.resolve(
        (() => {
          try {
            const text = localStorage.getItem(KEYS[slot]);
            return text === null ? null : decodeStored(text);
          } catch {
            // Poškozený nebo nečitelný záznam je totéž co žádný. Shodit kvůli
            // němu hru by hráči nepomohlo — nový save ho přepíše.
            return null;
          }
        })(),
      ),

    write: (slot, bytes) =>
      Promise.resolve(
        (() => {
          try {
            localStorage.setItem(KEYS[slot], packBytes(bytes));
            return true;
          } catch {
            // Plné úložiště nebo režim bez něj. Volající se doví, že se to
            // nepovedlo; shodit hru by bylo horší než přijít o jedno uložení.
            return false;
          }
        })(),
      ),

    has: (slot) =>
      Promise.resolve(
        (() => {
          try {
            return localStorage.getItem(KEYS[slot]) !== null;
          } catch {
            return false;
          }
        })(),
      ),

    remove: (slot) => {
      try {
        localStorage.removeItem(KEYS[slot]);
      } catch {
        // Když nejde smazat, nedá se s tím nic dělat a hra běží dál.
      }
      return Promise.resolve();
    },
  };
}

function createFileTransfer(): FileTransfer {
  return {
    save: (bytes, fileName, type = 'application/zip') => {
      const blob = new Blob([bytes as unknown as BlobPart], { type });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      // Odkaz musí být **v dokumentu** a adresa se smí uvolnit až **potom**
      // (T-revize, nález 34). Stahování je asynchronní: prohlížeč, který si
      // blob nevyzvedne v tomtéž kroku, našel adresu už zneplatněnou a
      // stahování zrušil bez jediné chyby — hráč klikl na „Stáhnout město",
      // v liště se objevilo „Uloženo, 214,3 kB" a soubor nikde.
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      // Minuta je s rezervou dost i na velké město a pomalý disk; bez uvolnění
      // by objekt držel v paměti až do zavření karty.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },

    read: async (file) => new Uint8Array(await file.arrayBuffer()),
  };
}

/**
 * Klíč, kterým si spuštění po aktualizaci řekne, že má rovnou pokračovat.
 *
 * `sessionStorage`, ne `localStorage`: platí pro **tuhle jednu kartu a tohle
 * jedno obnovení**. V `localStorage` by přežil i to, že hráč hru mezitím
 * zavřel a za týden ji otevřel znovu — a rozcestník by mu zmizel bez důvodu.
 */
const UPDATE_FLAG = `${PREFIX}updating`;

/**
 * Uklidí, co si prohlížeč schoval, a načte stránku znovu.
 *
 * Pořadí je celý vtip:
 *
 * 1. Keš service workeru. Drží v sobě `index.html` z minula, takže dokud
 *    zůstane, dostane hráč po obnovení zase tu starou verzi.
 * 2. Sám worker. Nový build si zaregistruje vlastní; ten starý by do té doby
 *    dál obsluhoval každý požadavek.
 * 3. Teprve pak obnovení stránky. Prohlížeč u něj hlavní dokument ověřuje na
 *    serveru, takže i `max-age` na `index.html` dostane odpověď „změnilo se".
 *
 * Nepovedený úklid se **nehlásí jako chyba**: obnovit stránku má cenu tak jako
 * tak a hráč nemá co dělat s tím, že prohlížeč nepustil ke `caches`.
 */
async function reloadNewVersion(): Promise<void> {
  try {
    sessionStorage.setItem(UPDATE_FLAG, '1');
  } catch {
    // Bez příznaku se jen ukáže rozcestník. Město je uložené tak jako tak.
  }

  try {
    if ('caches' in globalThis) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
      const workers = await navigator.serviceWorker.getRegistrations();
      await Promise.all(workers.map((worker) => worker.unregister()));
    }
  } catch {
    // Viz výš: obnovení stránky má smysl i tak.
  }

  location.reload();
}

/** Viz `Platform.restartIntoAutosave`. Příznak je týž jako po aktualizaci. */
function restartIntoAutosave(): void {
  try {
    sessionStorage.setItem(UPDATE_FLAG, '1');
  } catch {
    // Bez příznaku se ukáže rozcestník a město čeká pod „Pokračovat".
  }
  location.reload();
}

/** Příznak se čte **a hned maže** — platí pro jedno spuštění, ne pro kartu. */
function resumedAfterUpdate(): boolean {
  try {
    const flag = sessionStorage.getItem(UPDATE_FLAG) !== null;
    sessionStorage.removeItem(UPDATE_FLAG);
    return flag;
  } catch {
    return false;
  }
}

export function createBrowserPlatform(): Platform {
  return {
    id: 'browser',
    storage: createLocalStorage(),
    files: createFileTransfer(),
    reloadNewVersion,
    restartIntoAutosave,
    resumedAfterUpdate,
    preferences: {
      // Prohlížeč s vypnutým úložištěm hodí výjimku i při čtení; jazyk pak
      // prostě začne podle prohlížeče.
      get: (key) => {
        try {
          return window.localStorage.getItem(`zdenalcity.pref.${key}`);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          window.localStorage.setItem(`zdenalcity.pref.${key}`, value);
        } catch {
          // Plné nebo vypnuté úložiště: nastavení platí jen do zavření.
        }
      },
    },

    // Zaslepené podle §9. Prohlížeč nezná hráče, DLC ani Workshop; až přijde
    // Electron nebo Steam, přibude vedle tohohle souboru další implementace
    // a herní kód se nezmění.
    getUserId: () => Promise.resolve(null),
    hasDlc: () => false,
    unlockAchievement: () => {},
    getSavePath: () => null,
    workshopAvailable: () => false,
    listWorkshopMods: (): Promise<ModInfo[]> => Promise.resolve([]),
  };
}
