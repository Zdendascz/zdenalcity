import { Assets, Container, Sprite, Texture } from 'pixi.js';
import type { ReadonlyWorldView } from '@/sim/simHost';
import { areaHeightRange } from '@/sim/heights';
import type { AppearanceLookup } from './buildingRenderer';
import { gridToScreen } from './projection';
import { sampleSmooth } from './textures';
import { ghostPulse } from './effects';

/**
 * Průhledná budova, která se teprve pokládá (T113).
 *
 * Na dotykovém displeji **kryje prst přesně to místo, na které se míří**.
 * Do teď se budova stavěla hned při doteku, takže hráč viděl výsledek, až
 * když zvedl ruku — a když se netrefil, měl už postaveno. Autor to nahlásil
 * slovy „silnice a zóny fungují dobře, ale budovy jsou špatně… v okamžiku
 * doteku se objeví částečně průhledná budova, která má být umístěna, a spolu
 * s ní se bíle vysvítí oblast".
 *
 * Bílá oblast je rámeček, který kreslí `app.ts` už dávno. Tohle je ta druhá
 * půlka: sám dům, poloprůhledný, přesně tam a v té velikosti, v jaké se
 * postaví — čte se stejný obrázek a stejná kotva jako v `BuildingRenderer`.
 *
 * Když definice obrázek nemá, nekreslí se nic a zůstane rámeček. Kvádr jako
 * náhrada by lhal o tvaru a hráč by pak byl překvapený dvakrát.
 */
const GHOST_ALPHA = 0.6;
/**
 * Meze dýchání (T114). Náhled pomalu pulzuje, ať se na hemžícím se městě
 * pozná, co je stavba a co návrh. Průměr zůstává u `GHOST_ALPHA`.
 */
const PULSE_LOW = 0.45;
const PULSE_HIGH = 0.75;

/** Nádech pro místo, kam se stavět nedá. Rámeček zčervená stejně. */
const BLOCKED_TINT = 0xff9a9a;

export class PlacementGhost {
  private readonly world: ReadonlyWorldView;
  private readonly appearance: AppearanceLookup;
  private readonly sprite: Sprite;
  /** Obrázek, který v spritu právě je. Ať se textura nenačítá každý snímek. */
  private loaded: string | null = null;
  private elapsed = 0;
  private motion = true;

  constructor(world: ReadonlyWorldView, parent: Container, appearance: AppearanceLookup) {
    this.world = world;
    this.appearance = appearance;
    this.sprite = new Sprite(Texture.EMPTY);
    this.sprite.alpha = GHOST_ALPHA;
    this.sprite.visible = false;
    // Nad vším ostatním. Světový kontejner řadí podle `zIndex` (kvůli budovám)
    // a náhled, který se schová za dům, je k ničemu právě tam, kde je potřeba.
    this.sprite.zIndex = 1_000_000;
    parent.addChild(this.sprite);
  }

  /** Vypne dýchání; náhled zůstane na pevné průhlednosti. */
  setMotion(motion: boolean): void {
    this.motion = motion;
    if (!motion) this.sprite.alpha = GHOST_ALPHA;
  }

  animate(deltaMS: number): void {
    if (!this.motion || !this.sprite.visible) return;
    this.elapsed += deltaMS;
    this.sprite.alpha = ghostPulse(this.elapsed, PULSE_LOW, PULSE_HIGH);
  }

  hide(): void {
    this.sprite.visible = false;
  }

  /**
   * Postaví náhled na dlaždici. `blocked` říká, že se sem stavět nedá.
   *
   * Kotva i měřítko se počítají **z manifestu**, ne z textury: ta se dotahuje
   * na pozadí a z nenačtené by vyšla nula, takže by dům skočil do rohu.
   */
  show(definitionId: string, x: number, y: number, blocked: boolean): void {
    const appearance = this.appearance(definitionId, 0);
    const image = appearance?.sprite;
    if (!appearance || !image) {
      this.hide();
      return;
    }

    const [width, depth] = appearance.footprint;
    const sprite = this.sprite;
    sprite.visible = true;
    sprite.tint = blocked ? BLOCKED_TINT : 0xffffff;
    sprite.anchor.set(image.anchor[0] / image.width, image.anchor[1] / image.height);
    sprite.scale.set(1 / image.scale);

    // Podlaha na **nejvyšším rohu parcely**, přesně jako u postavené budovy —
    // jinak by náhled seděl jinde než dům, který z něj vznikne.
    const { max } = areaHeightRange(this.world.cornerHeight, x, y, width, depth);
    const front = gridToScreen(x + width, y + depth, max);
    sprite.position.set(front.x, front.y);

    if (this.loaded !== image.url) {
      this.loaded = image.url;
      void Assets.load(image.url).then((texture: Texture) => {
        // Než se textura donačetla, mohl hráč přepnout nástroj.
        if (this.loaded !== image.url) return;
        sampleSmooth(texture);
        sprite.texture = texture;
      });
    }
  }
}
