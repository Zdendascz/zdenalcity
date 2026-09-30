import { Assets } from 'pixi.js';
import type { ContentRegistry } from '@/content/registry';

/**
 * Přednačtení grafiky (T121, T134).
 *
 * Budova se dřív načítala, až když se poprvé objevila na mapě: první čtvrť
 * vyrostla jako prázdná místa a obrázky naskakovaly po jednom. T121 proto při
 * startu bralo **všechno, co obsah zná** — 285 spritů, 80 dílů, 22 povrchů,
 * 9 podezdívek, 19,6 MB ve 322 požadavcích — a hra na to čekala.
 *
 * T134 to dělí na dvě části:
 *
 * - **Na start** jen to, co ukáže první obrazovka: povrchy, podezdívky, díly
 *   a sprity budov, které jdou postavit v novém městě (zóny první úrovně,
 *   služby a technika po jedné variantě), vše v poloviční velikosti. Když se
 *   pokračuje v rozehraném městě, přibudou varianty, které v něm opravdu stojí
 *   (`preloadGraphics` podruhé, s `startupUrls` odečtenými).
 * - **Zbytek na pozadí** (`prefetchInBackground`): po jednom, s nízkou
 *   prioritou, a jen do HTTP keše. Dekóduje se, až ho hra poprvé potřebuje.
 *
 * **Na slabém zařízení se jen stahuje, nedekóduje.** Sprity mají po
 * dekódování desítky megabajtů a telefon s dvěma giga paměti by to nemusel
 * přežít. Stažené leží v mezipaměti prohlížeče a dekódují se, až je hra
 * poprvé potřebuje — síť už to nezdrží.
 *
 * Nic z toho nesmí start zastavit: chybějící obrázek se přeskočí a hra kreslí
 * kvádr jako dřív; visící požadavek utne `withTimeout`.
 */

/** Pod tolika GB paměti (`navigator.deviceMemory`) se jen stahuje. */
const DECODE_MIN_MEMORY_GB = 4;

/** Jak dlouho nejvýš hra čeká na grafiku, než začne bez ní. */
export const PRELOAD_TIMEOUT_MS = 20_000;

/** Kolik obrázků se na pozadí stahuje naráz. */
const BACKGROUND_CONCURRENCY = 2;

/** Úroveň zóny, do které se sprity berou hned na start. */
const STARTUP_ZONE_LEVEL = 1;

/** Kategorie, které rostou po úrovních. Ostatní staví hráč sám. */
const ZONE_CATEGORIES = new Set(['residential', 'commercial', 'industrial']);

export interface StartupOptions {
  /** Povrchy, které renderer terénu načítá (`grass`, `asphalt_street`, `rubble`…). */
  readonly surfaces: readonly string[];
  /** Kolik variant od povrchu renderer bere — viz `SURFACE_VARIANT_LIMIT`. */
  readonly surfaceVariants: number;
  /** Předměty na terénu (`forest_clump`…) a kolik variant od nich renderer bere. */
  readonly objects: readonly (readonly [id: string, variants: number])[];
}

/** Adresa obrázku spritu, který se kreslí při výchozím zoomu. */
function drawnUrl(sprite: { url: string; half?: string }): string {
  return sprite.half ?? sprite.url;
}

/**
 * Co potřebuje první obrazovka nového města. Seřazené a bez duplicit.
 *
 * Předměty na terénu (les, balvany) se berou **v plné velikosti**: renderer
 * je načítá sám a jejich pár textur se sdílí přes celou mapu.
 */
export function startupUrls(content: ContentRegistry, options: StartupOptions): string[] {
  const urls = new Set<string>();

  for (const surface of options.surfaces) {
    for (const variant of content.getTileVariants(surface).slice(0, options.surfaceVariants)) {
      const url = content.getTile(surface, variant);
      if (url !== undefined) urls.add(url);
    }
  }
  for (const url of Object.values(content.getSkirts())) urls.add(url);
  for (const name of content.getPartNames()) {
    const part = content.getPart(name);
    if (part !== undefined) urls.add(part.url);
  }
  for (const [id, limit] of options.objects) {
    for (const variant of content.getSpriteVariants(id).slice(0, limit)) {
      const sprite = content.getSprite(id, variant);
      if (sprite !== undefined) urls.add(sprite.url);
    }
  }

  // Budovy: zóny první úrovně všechny varianty (vyrostou jich hned desítky),
  // co staví hráč, po jedné — další varianta přijde z pozadí dřív, než ji
  // hráč postaví podruhé.
  for (const definition of content.getAll('building')) {
    const zone = ZONE_CATEGORIES.has(definition.category);
    if (zone && (definition.level ?? 1) > STARTUP_ZONE_LEVEL) continue;
    const variants = content.getSpriteVariants(definition.id);
    for (const variant of zone ? variants : variants.slice(0, 1)) {
      const sprite = content.getSprite(definition.id, variant);
      if (sprite !== undefined) urls.add(drawnUrl(sprite));
    }
  }

  return [...urls].sort();
}

/**
 * Co se stáhne na pozadí: sprity budov v poloviční velikosti, které start
 * nevzal. Povrchy, díly a podezdívky jdou celé už na start; další varianty
 * povrchů renderer nebere (`SURFACE_VARIANT_LIMIT`), takže by se stahovaly
 * zbytečně.
 */
export function backgroundUrls(content: ContentRegistry, ready: ReadonlySet<string>): string[] {
  const urls = new Set<string>();
  for (const key of content.getSpriteKeys()) {
    const split = key.lastIndexOf('|');
    const sprite = content.getSprite(key.slice(0, split), key.slice(split + 1));
    if (sprite !== undefined && !ready.has(drawnUrl(sprite))) urls.add(drawnUrl(sprite));
  }
  return [...urls].sort();
}

/** Adresa obrázku, který se pro sprite kreslí při výchozím zoomu. */
export function spriteUrlOf(sprite: { url: string; half?: string }): string {
  return drawnUrl(sprite);
}

function decodes(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory === undefined || memory >= DECODE_MIN_MEMORY_GB;
}

/**
 * Stáhne do HTTP keše a nic víc. Tělo se dočte a zahodí po kouscích — jako
 * `blob()` by zůstalo v paměti, dokud ho neuklidí sběrač. Chyba se spolkne.
 */
async function fetchOnly(url: string, priority: 'high' | 'low' | 'auto' = 'auto'): Promise<void> {
  try {
    const response = await fetch(url, { priority } as RequestInit);
    const reader = response.body?.getReader();
    if (!reader) return;
    while (!(await reader.read()).done) {
      // Jen dočíst: soubor tím skončí v keši prohlížeče.
    }
  } catch {
    // Nestažený obrázek si hra vezme, až ho bude kreslit.
  }
}

export async function preloadGraphics(
  urls: readonly string[],
  onProgress: (progress: number) => void,
): Promise<void> {
  if (urls.length === 0) {
    onProgress(1);
    return;
  }
  let done = 0;
  const step = () => onProgress(++done / urls.length);
  if (!decodes()) {
    await Promise.all(urls.map((url) => fetchOnly(url).finally(step)));
    return;
  }
  // Chybějící obrázek start nezastaví: Pixi by celou dávku odmítl, takže se
  // načítá po jednom a chyba se spolkne. Hra pak kreslí kvádr jako dřív (P5).
  // Poloviční sprity mají v adrese `@0.5x` a Pixi jim podle ní dá rozlišení
  // 0,5 — tatáž textura pak poslouží i rendereru budov.
  await Promise.all(
    urls.map((url) =>
      Assets.load(url)
        .catch(() => undefined)
        .finally(step),
    ),
  );
}

/**
 * Počká na příslib, ale nejvýš `ms`. Visící požadavek na obrázek tak nikdy
 * nezablokuje start hry — co nedorazí, dotáhne si renderer sám později.
 */
export function withTimeout(promise: Promise<unknown>, ms = PRELOAD_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise.then(() => undefined, () => undefined), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Stáhne zbytek grafiky na pozadí: po `BACKGROUND_CONCURRENCY`, s nízkou
 * prioritou a jen do HTTP keše. Když hráč šetří data (`saveData`), nestahuje
 * se nic navíc — obrázky si hra vezme, až je bude kreslit.
 *
 * Vrací funkci, která stahování zastaví.
 */
export function prefetchInBackground(urls: readonly string[]): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData === true || urls.length === 0) return () => {};
  const queue = [...urls];
  let stopped = false;
  const worker = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined && !stopped; url = queue.shift()) {
      await fetchOnly(url, 'low');
    }
  };
  for (let i = 0; i < BACKGROUND_CONCURRENCY; i++) void worker();
  return () => {
    stopped = true;
  };
}
