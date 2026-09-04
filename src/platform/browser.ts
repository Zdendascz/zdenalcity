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
 * Úložiště v `localStorage`.
 *
 * **Ne IndexedDB, i když ji §9 zmiňuje** — a je to rozhodnutí, ne opomenutí.
 * Ukládá se mimo jiné na `pagehide`, kde prohlížeč stránku zabalí dřív, než by
 * se asynchronní zápis stihl dokončit; hráč by přišel o město právě ve chvíli,
 * kdy zavírá kartu. `localStorage` píše synchronně, takže tenhle případ
 * funguje.
 *
 * Cena je kvóta kolem pěti megabajtů a base64, které save nafoukne o třetinu.
 * Až na to město naroste, je IndexedDB náhrada za tenhle jeden soubor —
 * a právě proto je rozhraní asynchronní, přestože tady se nic nečeká.
 */
function createLocalStorage(): SaveStorage {
  return {
    read: (slot) =>
      Promise.resolve(
        (() => {
          try {
            const text = localStorage.getItem(KEYS[slot]);
            return text === null ? null : fromBase64(text);
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
            localStorage.setItem(KEYS[slot], toBase64(bytes));
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
      anchor.click();

      // Bez uvolnění by objekt držel v paměti až do zavření karty.
      URL.revokeObjectURL(url);
    },

    read: async (file) => new Uint8Array(await file.arrayBuffer()),
  };
}

export function createBrowserPlatform(): Platform {
  return {
    id: 'browser',
    storage: createLocalStorage(),
    files: createFileTransfer(),

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
