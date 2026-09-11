import { createWorld } from '@/sim/world';
import { applySaveToWorld, readSaveMeta, saveMapSize, unpackSave } from './deserialize';
import type { SaveData } from './format';
import { migrate } from './migrations';

/**
 * Načte se tenhle save? Vrací výjimku, kterou by vyhodil start hry, nebo `null`.
 *
 * Hra uměla uložit město, které pak sama odmítla načíst. Posuvník financování
 * pustil služby až na 200 %, kontrola v loaderu brala jen 0–1 — a hráč přišel
 * o město při dalším spuštění: autosave se nenačetl, odložil se jako poškozený
 * a hra založila nové. Dvě meze pro jedno číslo se jednou rozejdou znovu, jen
 * jinde a u jiného čísla.
 *
 * Proto se save **před zápisem zkusí načíst stejnou cestou jako při startu**
 * (`render/app.ts`): rozbalit, migrovat, nasypat do světa a přečíst meta. Svět
 * je jednorázový, rozehraného města se to nedotkne.
 */
export function verifySave(bytes: Uint8Array): Error | null {
  try {
    applySaveToWorld(createWorld(1), migrate(unpackSave(bytes)));
    readSaveMeta(bytes);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** Jak dostat save do rozehrané hry. Viz `planInGameLoad`. */
export type InGameLoad =
  | { kind: 'invalid'; error: Error }
  | { kind: 'inPlace'; save: SaveData }
  | { kind: 'restart' };

/**
 * Jak načíst save do hry, která už běží.
 *
 * **Na místě jen se stejně velkou mapou.** Renderer si velikost mapy bere při
 * startu — chunky terénu i buňky spokojenosti — takže save 192 × 192 načtený
 * do hry na 128 × 128 dostal terén jen pro prvních 128 dlaždic. Hráč viděl
 * mapu bez města, žádnou hlášku, a hlásil, že se soubor nenačetl. Jiná
 * velikost proto jde přes nový start hry, který renderer postaví správně.
 */
export function planInGameLoad(bytes: Uint8Array, currentSize: number): InGameLoad {
  const error = verifySave(bytes);
  if (error) return { kind: 'invalid', error };

  const save = migrate(unpackSave(bytes));
  return saveMapSize(save.meta) === currentSize ? { kind: 'inPlace', save } : { kind: 'restart' };
}
