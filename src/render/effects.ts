import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { gridToScreen } from './projection';
import { DUST_COLOR } from './palette';

/**
 * Odezva na hráčovy akce (T114, `docs/17-ANIMACE.md`, vrstva 1).
 *
 * Všechno tady je **čistě kosmetické**. Simulace o animacích neví a animace
 * se simulace nikdy na nic neptají, jen kreslí to, co už se stalo. Proto
 * nesmí sáhnout na `world.rng`: jediné vytažené číslo by posunulo celý další
 * průběh hry a save by po načtení běžel jinak. Náhoda je tady vlastní
 * (`motionRandom`).
 */

/** Jak dlouho budova „vyrůstá", když se objeví nebo povýší. */
export const POP_MS = 420;

/** Jak nízko začíná. Nula by byla díra, ze které dům vyleze — to je moc. */
const POP_FROM = 0.55;

/**
 * Měřítko vyrůstající budovy v čase `t` (0–1). Vrací `[šířka, výška]`.
 *
 * Výška jde přes **překmit** (easeOutBack): dům vyroste kousek nad sebe
 * a dosedne. Šířka se chová obráceně a o čtvrtinu slabší, ať to vypadá jako
 * pružná hmota, ne jako roleta. Na konci je vždycky přesně `[1, 1]`.
 */
export function popScale(t: number): [number, number] {
  if (t >= 1) return [1, 1];
  const clamped = Math.max(0, t);
  const c1 = 1.7;
  const c3 = c1 + 1;
  const u = clamped - 1;
  const eased = 1 + c3 * u * u * u + c1 * u * u;
  const height = POP_FROM + (1 - POP_FROM) * eased;
  const width = 1 + (1 - height) * 0.25;
  return [width, height];
}

/** Průhlednost ducha umísťování: pomalé dýchání mezi dvěma mezemi. */
export const GHOST_PULSE_MS = 1400;
export function ghostPulse(elapsedMs: number, low: number, high: number): number {
  const phase = (elapsedMs % GHOST_PULSE_MS) / GHOST_PULSE_MS;
  const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  return low + (high - low) * wave;
}

/**
 * Malý generátor jen pro vzhled.
 *
 * `Math.random` by v `render/` fungoval taky, jenže tenhle jde nasadit na
 * pevné semínko v testu a hlavně **se nesplete se simulací**: kdo sem jednou
 * přenese `world.rng`, uvidí, že tu už generátor je.
 */
export function motionRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Půdorys, nad kterým se práší. Mřížkové souřadnice. */
export interface DustArea {
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Výška země v úrovních, ať se nepráší pod kopcem. */
  base: number;
}

/** Kolik obláčků se zvedne nad půdorysem. Roste s plochou, ale má strop. */
export function dustCount(area: DustArea): number {
  return Math.min(DUST_MAX_PER_PUFF, 5 + Math.round(area.width * area.depth * 2.5));
}

const DUST_MAX_PER_PUFF = 26;
/** Kolik obláčků smí žít naráz. Buldozer tažený přes blok by jich jinak nadělal stovky. */
const DUST_MAX_ALIVE = 240;
const DUST_MS = 900;
/** Poloměr obláčku v pixelech světa při zoomu 1. */
const DUST_RADIUS = 9;

interface Puff {
  sprite: Sprite;
  age: number;
  life: number;
  /** Rychlost stoupání v px/s a drift do strany. */
  rise: number;
  drift: number;
  grow: number;
  alpha: number;
}

/**
 * Prach při bourání.
 *
 * Obláček je jeden sdílený měkký kruh jako textura, takže i plný strop je
 * jedna kreslicí dávka. Sprity se drží v zásobě a znovu používají — bourání
 * je časté a nové uzly by zbytečně krmily sběr odpadu.
 */
export class Effects {
  private readonly container = new Container();
  private readonly texture: Texture;
  private readonly live: Puff[] = [];
  private readonly pool: Sprite[] = [];
  private readonly random = motionRandom(0x5eed);
  private enabled = true;

  constructor(parent: Container, renderer: Renderer) {
    this.texture = softCircle(renderer);
    // Nad budovami: prach stoupá **před** fasádou, ne za ní.
    this.container.zIndex = 900_000;
    parent.addChild(this.container);
  }

  /** Vypne animace. Rozběhnuté obláčky zmizí hned, ne až dohoří. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  dust(area: DustArea): void {
    if (!this.enabled) return;
    const count = dustCount(area);
    for (let i = 0; i < count && this.live.length < DUST_MAX_ALIVE; i++) {
      // Náhodný bod na půdorysu, trochu přetažený přes okraj — prach se
      // nezastaví na hranici parcely.
      const gx = area.x - 0.15 + this.random() * (area.width + 0.3);
      const gy = area.y - 0.15 + this.random() * (area.depth + 0.3);
      const at = gridToScreen(gx, gy, area.base);
      const sprite = this.pool.pop() ?? new Sprite(this.texture);
      sprite.anchor.set(0.5);
      sprite.tint = DUST_COLOR;
      sprite.position.set(at.x, at.y);
      const size = 0.6 + this.random() * 0.6;
      sprite.scale.set(size);
      sprite.alpha = 0;
      this.container.addChild(sprite);
      this.live.push({
        sprite,
        age: -this.random() * 160, // nevyrazí všechny v jednom snímku
        life: DUST_MS * (0.7 + this.random() * 0.6),
        rise: 14 + this.random() * 22,
        drift: (this.random() - 0.5) * 18,
        grow: size,
        alpha: 0.55 + this.random() * 0.3,
      });
    }
  }

  update(deltaMS: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const puff = this.live[i]!;
      puff.age += deltaMS;
      if (puff.age < 0) continue;
      const t = puff.age / puff.life;
      if (t >= 1) {
        this.release(i);
        continue;
      }
      const seconds = deltaMS / 1000;
      puff.sprite.y -= puff.rise * seconds * (1 - t);
      puff.sprite.x += puff.drift * seconds;
      puff.sprite.scale.set(puff.grow * (1 + t * 1.4));
      // Rychle naběhne, pomalu se rozplyne.
      puff.sprite.alpha = puff.alpha * Math.min(1, t * 6) * (1 - t) * (1 - t);
    }
  }

  private release(i: number): void {
    const puff = this.live[i]!;
    this.live[i] = this.live[this.live.length - 1]!;
    this.live.pop();
    puff.sprite.removeFromParent();
    this.pool.push(puff.sprite);
  }

  private clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.release(i);
  }

  destroy(): void {
    this.clear();
    for (const sprite of this.pool) sprite.destroy();
    this.container.destroy();
    this.texture.destroy(true);
  }
}

/** Měkký bílý kruh, který se barví přes `tint`. */
function softCircle(renderer: Renderer): Texture {
  const g = new Graphics();
  // Tři soustředné kruhy dají měkký okraj bez shaderu a bez obrázku.
  g.circle(0, 0, DUST_RADIUS).fill({ color: 0xffffff, alpha: 0.35 });
  g.circle(0, 0, DUST_RADIUS * 0.72).fill({ color: 0xffffff, alpha: 0.5 });
  g.circle(0, 0, DUST_RADIUS * 0.45).fill({ color: 0xffffff, alpha: 0.8 });
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return texture;
}
