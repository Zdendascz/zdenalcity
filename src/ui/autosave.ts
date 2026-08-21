/**
 * Automatické uložení do prohlížeče.
 *
 * Není to implementace `Platform` z architektury §9 — ta má smysl až
 * s Electronem ve fázi 4. Je to záplata na jednu konkrétní ránu: hráč zmáčkl
 * F5 a přišel o město. Rozehraná hra, která zmizí s obnovením stránky, není
 * hra, se kterou by šlo něco zkoušet.
 *
 * Ukládá se **týž ZIP jako do souboru**, jen zakódovaný do base64, protože
 * `localStorage` umí jen řetězce. Formát je tedy jeden jediný a migrace na něj
 * platí stejně jako na uložený soubor (P7).
 */
const KEY = 'citybuilder:autosave';

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
 * Uloží město. **Chybu spolkne**, ale vrátí `false`.
 *
 * `localStorage` umí odmítnout zápis, když je plný nebo když prohlížeč běží
 * v režimu bez úložiště. Shodit kvůli tomu hru by bylo horší než přijít
 * o automatické uložení — volající si o výsledek řekne, pokud ho zajímá.
 */
export function storeAutosave(bytes: Uint8Array): boolean {
  try {
    localStorage.setItem(KEY, toBase64(bytes));
    return true;
  } catch {
    return false;
  }
}

/** Vrátí uložené město, nebo `null`, když žádné není nebo je nečitelné. */
export function loadAutosave(): Uint8Array | null {
  try {
    const text = localStorage.getItem(KEY);
    return text === null ? null : fromBase64(text);
  } catch {
    return null;
  }
}

export function hasAutosave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Když nejde smazat, nedá se s tím nic dělat a hra běží dál.
  }
}
