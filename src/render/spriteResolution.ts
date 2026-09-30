import { Assets } from 'pixi.js';
import type { Sprite, Texture } from 'pixi.js';
import { sampleSmooth } from './textures';

/**
 * Dvě velikosti obrázků budov (T134).
 *
 * Sprity jsou kreslené ve čtyřnásobku (`scale: 4`) a při výchozím zoomu se
 * zmenšují na čtvrtinu. V plné velikosti jich 285 zabralo po dekódování kolem
 * čtvrt gigabajtu paměti karty, přitom většinu času se z nich kreslí patnáctina
 * pixelů. Obsah proto nese i **poloviční** obrázek (`SpriteImage.half`,
 * soubor `<jméno>@0.5x.webp`) a hra kreslí ten; plnou velikost si dotáhne, až
 * hráč přiblíží nad `FULL_RESOLUTION_ZOOM`, a jen pro budovy, které jsou vidět.
 * Po oddálení se vrátí poloviny a plné textury se uvolní.
 *
 * **Poloviční textura má rozlišení 0,5**, takže je logicky stejně velká jako
 * plná: kotvy, rozměry a měřítko ze `sprites/index.json` platí beze změny
 * a renderer nemusí vědět, kterou má. Pixi to pozná z přípony `@0.5x`.
 *
 * Chybějící obrázek hru nezastaví: nepovede-li se polovina, zkusí se plný,
 * nepovede-li se ani ten, zůstane sprite prázdný a renderer kreslí jako dřív.
 */

/** Obrázek, jak ho zná renderer: plná adresa a případně poloviční. */
export interface ResolvableImage {
  readonly url: string;
  readonly half?: string;
}

/**
 * Nad tímhle zoomem se kreslí plná velikost. Poloviční obrázek má měřítko 2,
 * takže do zoomu 2 připadá na pixel obrazovky aspoň pixel obrázku.
 */
export const FULL_RESOLUTION_ZOOM = 2;

/**
 * Zpátky na polovinu až pod tímhle zoomem. Mezera mezi prahy brání tomu, aby
 * se při kolečku kolem dvojky textury stahovaly a uvolňovaly pořád dokola.
 */
const HALF_RESOLUTION_ZOOM = 1.8;

/** Jak často se nejvýš přepočítává, které budovy jsou vidět. */
const CHECK_MS = 250;

/** Kolik plných obrázků se stahuje naráz, aby přiblížení nezahltilo linku. */
const FULL_CONCURRENCY = 4;

/** O kolik se okno pro „je vidět" rozšíří, aby posun kamery nenarazil na polovinu. */
const VIEW_MARGIN = 0.25;

type Level = 'half' | 'full';

interface Binding {
  readonly image: ResolvableImage;
  /** Platí sprite ještě pro tenhle obrázek? Renderer ho mezitím mohl zahodit. */
  valid: () => boolean;
  /** Co sprite právě kreslí. */
  level: Level | null;
  /** Co se pro něj právě stahuje. Novější požadavek přebije starší. */
  pending: Level | null;
  /**
   * Poloviční obrázek, pokud ho obsah dodal a jde načíst. Po chybě se zahodí
   * a budova se kreslí plným obrázkem jako mod bez poloviny.
   */
  half: string | undefined;
}

/** Obdélník na obrazovce. `app.screen` mu vyhovuje. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const textures = new Map<string, Promise<Texture>>();

/**
 * Načte texturu jednou a připraví ji ke zmenšování (mipmapy). Chyba se
 * nepamatuje, aby šlo zkusit znovu.
 */
export function loadSpriteTexture(url: string): Promise<Texture> {
  let promise = textures.get(url);
  if (!promise) {
    promise = Assets.load<Texture>(url).then((texture) => {
      sampleSmooth(texture);
      return texture;
    });
    promise.catch(() => textures.delete(url));
    textures.set(url, promise);
  }
  return promise;
}

export class SpriteResolution {
  private readonly bound = new Map<Sprite, Binding>();
  /** Plné textury, které nahrál tenhle modul a smí je zase uvolnit. */
  private readonly ownFull = new Set<string>();
  private full = false;
  private lastCheck = -Infinity;
  private lastView = '';
  private dirty = false;
  private loadingFull = 0;
  private readonly queue: (() => void)[] = [];

  /** Přiblíženo nad práh — nové budovy rovnou dostanou plný obrázek. */
  get fullResolution(): boolean {
    return this.full;
  }

  /**
   * Přiřadí spritu obrázek. Volá se při každém překreslení budovy; když už
   * sprite tenhle obrázek má (nebo se pro něj stahuje), nedělá nic.
   */
  assign(sprite: Sprite, image: ResolvableImage, valid: () => boolean): void {
    const current = this.bound.get(sprite);
    if (current && current.image.url === image.url) {
      current.valid = valid;
      if (current.level !== null || current.pending !== null) return;
    }
    const binding: Binding = { image, valid, level: null, pending: null, half: image.half };
    this.bound.set(sprite, binding);
    this.dirty = true;
    // I při přiblížení se začíná polovinou: plnou dostanou jen budovy, které
    // jsou vidět, a to rozhodne nejbližší `update`.
    this.request(sprite, binding, image.half === undefined ? 'full' : 'half');
  }

  /**
   * Jednou za snímek. Levné, dokud se kamera nehne: seznam budov se prochází
   * jen po změně pohledu, a to nejvýš jednou za `CHECK_MS`.
   */
  update(zoom: number, camera: { x: number; y: number }, screen: ScreenRect, now: number): void {
    if (!this.full && zoom > FULL_RESOLUTION_ZOOM) {
      this.full = true;
      this.dirty = true;
    } else if (this.full && zoom < HALF_RESOLUTION_ZOOM) {
      this.full = false;
      this.backToHalf();
      return;
    }

    const view = `${zoom.toFixed(3)}|${Math.round(camera.x)}|${Math.round(camera.y)}|${screen.width}|${screen.height}`;
    if (view === this.lastView && !this.dirty) return;
    if (now - this.lastCheck < CHECK_MS) return;
    this.lastCheck = now;
    this.lastView = view;
    this.dirty = false;

    const marginX = screen.width * VIEW_MARGIN;
    const marginY = screen.height * VIEW_MARGIN;
    const left = screen.x - marginX;
    const top = screen.y - marginY;
    const right = screen.x + screen.width + marginX;
    const bottom = screen.y + screen.height + marginY;

    for (const [sprite, binding] of this.bound) {
      if (sprite.destroyed || !binding.valid()) {
        this.bound.delete(sprite);
        continue;
      }
      if (!this.full || binding.half === undefined) continue;
      if (binding.level === 'full' || binding.pending === 'full') continue;
      if (!sprite.visible || !sprite.parent) continue;
      const bounds = sprite.getBounds();
      if (bounds.maxX < left || bounds.minX > right || bounds.maxY < top || bounds.minY > bottom) {
        continue;
      }
      this.request(sprite, binding, 'full');
    }
  }

  /** Kolik spritů kreslí plný obrázek. Pro ladění a testy. */
  countFull(): number {
    let count = 0;
    for (const binding of this.bound.values()) if (binding.level === 'full') count++;
    return count;
  }

  private request(sprite: Sprite, binding: Binding, level: Level): void {
    binding.pending = level;
    const url = level === 'full' ? binding.image.url : (binding.half ?? binding.image.url);
    // Frontou jde jen přechod z poloviny na plný obrázek. Obrázek, ke kterému
    // obsah polovinu nedodal, je pro budovu jediný a čekat nemá na co.
    const throttled = level === 'full' && binding.half !== undefined;
    const start = () => {
      if (throttled && !Assets.cache.has(url)) this.ownFull.add(url);
      loadSpriteTexture(url)
        .then((texture) => this.apply(sprite, binding, level, texture))
        .catch(() => {
          if (binding.pending !== level) return;
          binding.pending = null;
          // Polovina chybí: kreslí se plný obrázek. Chybí plný: zůstane, co je.
          if (level === 'half' && binding.half !== undefined) {
            binding.half = undefined;
            this.request(sprite, binding, 'full');
          }
        })
        .finally(() => {
          if (!throttled) return;
          this.loadingFull--;
          this.queue.shift()?.();
        });
    };
    if (!throttled) {
      start();
      return;
    }
    // Plné obrázky po několika: přiblížení nad velké město by jinak spustilo
    // stovky stahování naráz a to, na co hráč kouká, by přišlo poslední.
    const run = () => {
      if (this.bound.get(sprite) !== binding || binding.pending !== 'full') {
        this.queue.shift()?.();
        return;
      }
      this.loadingFull++;
      start();
    };
    if (this.loadingFull < FULL_CONCURRENCY) run();
    else this.queue.push(run);
  }

  private apply(sprite: Sprite, binding: Binding, level: Level, texture: Texture): void {
    if (this.bound.get(sprite) !== binding || binding.pending !== level) return;
    binding.pending = null;
    if (sprite.destroyed || !binding.valid()) {
      this.bound.delete(sprite);
      return;
    }
    // Oddáleno dřív, než plný obrázek dorazil: nekreslí se a uvolní se.
    if (level === 'full' && !this.full && binding.half !== undefined) {
      this.releaseUnused();
      return;
    }
    sprite.texture = texture;
    binding.level = level;
  }

  /** Oddáleno: všem zpátky polovinu, pak uvolnit plné, které nikdo nekreslí. */
  private backToHalf(): void {
    this.queue.length = 0;
    const swaps: Promise<unknown>[] = [];
    for (const [sprite, binding] of this.bound) {
      if (sprite.destroyed || !binding.valid()) {
        this.bound.delete(sprite);
        continue;
      }
      const half = binding.half;
      if (half === undefined) continue;
      if (binding.level !== 'full' && binding.pending !== 'full') continue;
      binding.pending = 'half';
      swaps.push(
        loadSpriteTexture(half)
          .then((texture) => this.apply(sprite, binding, 'half', texture))
          .catch(() => {
            // Polovina chybí: sprite si nechá plný obrázek.
            if (binding.pending === 'half') binding.pending = null;
          }),
      );
    }
    void Promise.allSettled(swaps).then(() => this.releaseUnused());
  }

  /** Uvolní plné textury, které nahrál tenhle modul a žádný sprite je nekreslí. */
  private releaseUnused(): void {
    if (this.full) return;
    const inUse = new Set<string>();
    for (const binding of this.bound.values()) {
      if (binding.level === 'full' || binding.pending === 'full') inUse.add(binding.image.url);
    }
    for (const url of this.ownFull) {
      if (inUse.has(url)) continue;
      this.ownFull.delete(url);
      textures.delete(url);
      void Assets.unload(url).catch(() => undefined);
    }
  }
}

/** Jedna instance na hru: textury jsou sdílené přes `Assets` tak jako tak. */
export const spriteResolution = new SpriteResolution();

/**
 * Háček pro `BuildingRenderer.drawSprite`: místo `Assets.load(image.url)`
 * zavolá tohle a o velikost se nestará.
 */
export function assignSpriteTexture(
  sprite: Sprite,
  image: ResolvableImage,
  valid: () => boolean,
): void {
  spriteResolution.assign(sprite, image, valid);
}
