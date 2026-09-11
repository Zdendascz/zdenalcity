/**
 * Platform abstrakce (architektura §9).
 *
 * **Steam se nikdy nevolá přímo z herního kódu** a stejně tak `localStorage`,
 * `Blob` ani `File`. Herní kód si řekne o „ulož tohle město" a nezajímá ho,
 * jestli to skončí v prohlížeči, v souboru vedle .exe, nebo ve Steam Cloudu.
 *
 * Rozhraní §9 mluví o Steamu, DLC a Workshopu — to jsou zatím zaslepené metody,
 * přesně jak dokument předepisuje. Co je dnes **skutečně potřeba**, je
 * `storage` a `files`: tudy chodí savy. Do §9 to patří, protože `getSavePath()`
 * tam už tvrdí „null = browser, ukládá se do prohlížeče" — jen k tomu chybělo
 * rozhraní, kterým se to dělá.
 *
 * `src/sim/` sem nesmí (P1). Platforma je věc rozhraní a hostitele, ne
 * simulace — svět se ukládá tak, že ho někdo serializuje a předá sem.
 */

/** Mod ze Steam Workshopu. Tvar podle §9; nic ho zatím nevrací. */
export interface ModInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

/**
 * Sloty, do kterých se ukládá.
 *
 * Pojmenované, ne číslované: `'quick'` a `'autosave'` mají různý životní cyklus
 * a míchat je do jednoho pole by znamenalo pamatovat si, který index je který.
 *
 * `'corrupt'` je odkladiště: autosave, který se nepodařilo načíst, se sem
 * **přesune místo smazání**. Do T106 se mazal, což vypadá jako milosrdenství
 * — hráč se vždycky dostane do hry — jenže stejnou větví by prošla i regrese
 * v deserializeru po nasazení nové verze. Pak by o města přišli všichni naráz
 * a nikdo by neměl co poslat autorovi, protože důkaz se právě smazal.
 */
export type SaveSlot = 'autosave' | 'quick' | 'corrupt';

/**
 * Úložiště savů.
 *
 * **Asynchronní schválně**, i když dnešní implementace píše synchronně. Každé
 * skutečné úložiště — IndexedDB, soubor na disku, Steam Cloud — je asynchronní,
 * a předělávat kvůli tomu později všechna volající místa by byl přesně ten
 * refaktor, kterému má tahle vrstva předejít.
 *
 * Zápis pod tím **musí zůstat synchronní**, dokud se ukládá na `pagehide`:
 * prohlížeč stránku zabalí dřív, než by se asynchronní zápis stihl dokončit,
 * a hráč by o město přišel právě ve chvíli, kdy zavírá kartu.
 */
export interface SaveStorage {
  read(slot: SaveSlot): Promise<Uint8Array | null>;
  /** Vrací `false`, když se nepovedlo uložit. Nikdy nevyhazuje. */
  write(slot: SaveSlot, bytes: Uint8Array): Promise<boolean>;
  has(slot: SaveSlot): Promise<boolean>;
  remove(slot: SaveSlot): Promise<void>;
}

/** Předání souboru hráči a od hráče. */
export interface FileTransfer {
  /**
   * Nabídne bajty ke stažení pod daným jménem.
   *
   * `type` je MIME typ souboru. Výchozí je zip, protože tudy chodí hlavně
   * savy; snímek obrazovky si řekne o `image/png`, jinak by ho prohlížeč
   * uložil jako archiv a neotevřel.
   */
  save(bytes: Uint8Array, fileName: string, type?: string): void;
  /** Přečte, co hráč vybral. `File` sem dá rozhraní — výběr je věc UI. */
  read(file: File): Promise<Uint8Array>;
}

export interface Platform {
  readonly id: 'browser' | 'electron' | 'steam' | 'gog';
  readonly storage: SaveStorage;
  readonly files: FileTransfer;

  /**
   * Zahodí, co si hostitel schoval, a spustí hru znovu z nové verze.
   *
   * Vzniklo kvůli mobilu. Na telefonu drží starou verzi prohlížeč, ne hráč:
   * `index.html` může být z HTTP keše a service worker si nese svoji vlastní.
   * Hráč neměl jak novou verzi dostat, leda smazáním dat stránky — a tím by
   * přišel i o rozehrané město.
   *
   * **Rozehranou hru to nemaže.** Volající ji nejdřív uloží; tahle metoda
   * sahá jen na keš hostitele. Na platformě, která žádnou nemá (Electron),
   * je to prosté spuštění znovu.
   */
  reloadNewVersion(): Promise<void>;
  /**
   * Spustí hru znovu a **rovnou pokračuje v rozehraném městě** (autosave).
   *
   * Vzniklo kvůli načtení savu s jinou velikostí mapy. Renderer si velikost
   * bere při startu, takže načíst takový save za běhu kreslilo terén jen
   * z části. Start hry to umí správně: volající save uloží jako autosave
   * a nechá hru naběhnout znovu. Na rozdíl od `reloadNewVersion` nesahá na keš.
   */
  restartIntoAutosave(): void;
  /**
   * Vrátí `true` právě jednou: při tom spuštění, které vzniklo z
   * `reloadNewVersion` nebo `restartIntoAutosave`. Hra podle toho pozná, že má
   * rovnou pokračovat a nenutit hráče proklikat rozcestník kvůli něčemu, co si
   * vyžádal.
   */
  resumedAfterUpdate(): boolean;

  getUserId(): Promise<string | null>;
  hasDlc(id: string): boolean;
  unlockAchievement(id: string): void;
  /** Cesta ke složce savů. `null` znamená, že platforma soubory nemá. */
  getSavePath(): string | null;
  workshopAvailable(): boolean;
  listWorkshopMods(): Promise<ModInfo[]>;
}

export { createBrowserPlatform } from './browser';
