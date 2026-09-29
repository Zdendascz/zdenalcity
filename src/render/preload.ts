import { Assets } from 'pixi.js';
import type { ContentRegistry } from '@/content/registry';

/**
 * Přednačtení grafiky (T121).
 *
 * Budova se dřív načítala, až když se poprvé objevila na mapě: první čtvrť
 * vyrostla jako prázdná místa a obrázky naskakovaly po jednom. Teď se při
 * startu vezme **všechno, co obsah zná** — sprity budov, povrchy, díly pro
 * animace, podezdívky — a načte se dřív, než hra začne.
 *
 * **Na slabém zařízení se jen stahuje, nedekóduje.** Sprity mají po
 * dekódování kolem čtvrt gigabajtu a telefon s dvěma giga paměti by to
 * nemusel přežít. Stažené leží v mezipaměti prohlížeče a dekódují se, až je
 * hra poprvé potřebuje — síť už to nezdrží.
 */

/** Pod tolika GB paměti (`navigator.deviceMemory`) se jen stahuje. */
const DECODE_MIN_MEMORY_GB = 4;

export function imageUrls(content: ContentRegistry): string[] {
  return [...new Set(content.getImageUrls())].sort();
}

export async function preloadGraphics(
  urls: readonly string[],
  onProgress: (progress: number) => void,
): Promise<void> {
  if (urls.length === 0) {
    onProgress(1);
    return;
  }
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory < DECODE_MIN_MEMORY_GB) {
    let done = 0;
    await Promise.all(
      urls.map((url) =>
        fetch(url)
          .then((response) => response.blob())
          .catch(() => undefined)
          .finally(() => onProgress(++done / urls.length)),
      ),
    );
    return;
  }
  // Chybějící obrázek start nezastaví: Pixi by celou dávku odmítl, takže se
  // načítá po jednom a chyba se spolkne. Hra pak kreslí kvádr jako dřív (P5).
  let done = 0;
  await Promise.all(
    urls.map((url) =>
      Assets.load(url)
        .catch(() => undefined)
        .finally(() => onProgress(++done / urls.length)),
    ),
  );
}
