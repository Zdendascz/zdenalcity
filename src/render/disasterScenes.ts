import { Container, Sprite } from 'pixi.js';
import { groundHeightAt } from '@/sim/heights';
import type { ReadonlyWorldView } from '@/sim/simHost';
import type { TerrainDecor } from './decor';
import { gridToScreen } from './projection';

/**
 * Obrázky katastrof, které se odehrávají **na ulici**.
 *
 * Do T92 o nich mapa mlčela: hráč viděl ikonu u hodin, ale kde se to děje,
 * musel hádat. Autor navrhl totéž, co u trosek — „daly by se taky vytvořit
 * formou obrázku, jako třeba u nepokojů izometrický obrázek protestujících
 * na ulici".
 *
 * Kreslí se **jen ty druhy, ke kterým obsah dodal obrázek**. Zemětřesení ani
 * povodeň sem nepatří: nemají jedno místo, mají plochu, a tu už kreslí vlastní
 * vrstvy.
 *
 * Vlastní kontejner nad silnicemi a pod budovami. Nahoře by dav zakryl dům,
 * před kterým stojí; dole by ho dům zakryl celý.
 */
export class DisasterScenes {
  private readonly world: ReadonlyWorldView;
  private readonly container = new Container();
  /** Uzly podle id katastrofy — přežijí překreslení, takže se neblikají. */
  private readonly nodes = new Map<number, Sprite>();
  /**
   * Pohromy, které se **hýbou** (tornádo): kde uzel je, kam jede a jak daleko
   * je mezi tím. Simulace posune tornádo jednou za tik, tady se ta cesta
   * rozloží do snímků (T120).
   */
  private readonly movers = new Map<number, { fromX: number; fromY: number; toX: number; toY: number; t: number; scale: number }>();
  private clock = 0;
  private dustClock = 0;
  /** Prach u paty tornáda. Dodá ho `Effects`. */
  onDust: ((x: number, y: number, base: number) => void) | null = null;
  private scenes: ReadonlyMap<string, TerrainDecor[]> = new Map();

  constructor(world: ReadonlyWorldView, parent: Container) {
    this.world = world;
    parent.addChild(this.container);
  }

  /** Obrázky podle druhu katastrofy. Chybějící druh se prostě nekreslí. */
  setScenes(scenes: ReadonlyMap<string, TerrainDecor[]>): void {
    this.scenes = scenes;
    this.clear();
    this.update();
  }

  /** Podzemní pohled se dívá pod ulici, takže tam scény jen překážejí. */
  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Srovná obrázky s běžícími katastrofami.
   *
   * Volá se každý snímek, ale **sahá jen na to, co se změnilo**: uzel existuje,
   * dokud katastrofa běží, a mizí, až skončí. Přestavovat celý seznam by
   * znamenalo vyhodit a znovu vytvořit sprite šedesátkrát za vteřinu.
   */
  update(): void {
    const alive = new Set<number>();

    for (const disaster of this.world.disasters.active) {
      if (disaster.finished) continue;
      const variants = this.scenes.get(disaster.kind);
      if (!variants || variants.length === 0) continue;
      alive.add(disaster.id);
      if (this.nodes.has(disaster.id)) continue;

      // Varianta podle **id katastrofy**, ne podle náhody: dvě nehody vedle
      // sebe tak nevypadají jako jedna, a při překreslení se obrázek nemění.
      const scene = variants[disaster.id % variants.length];
      if (!scene) continue;

      const node = new Sprite(scene.texture);
      node.anchor.set(scene.anchor[0] / scene.texture.width, scene.anchor[1] / scene.texture.height);
      node.scale.set(1 / scene.scale);

      /*
       * Kotva jde na **jižní roh dlaždice**, ne do jejího středu.
       *
       * Scéna není předmět, který na dlaždici stojí — je to obrázek, který
       * dlaždici **pokrývá**: tři vraky přes celou křižovatku, dav přes celou
       * ulici. Spodní hrana obrázku je proto přední cíp té plochy, ne její
       * střed. Posazená doprostřed vyšla celá plocha o půl dlaždice (šestnáct
       * pixelů) na sever a nehoda ležela vedle silnice — hlásil to autor.
       *
       * Je to totéž pravidlo jako u budov, které taky nesou vlastní pozemek:
       * `gridToScreen(x + šířka, y + hloubka)`. Strom ani balvan sem nespadají,
       * ty se země dotýkají v jednom bodě a patří do středu.
       *
       * Výška je terén v tom rohu. Nejvyšší roh tu byl proto, aby scéna na
       * svahu nezapadla do kopce, jenže tím se přehoupla na druhou stranu
       * a visela až celou úroveň nad zemí.
       */
      const point = gridToScreen(
        disaster.x + 1,
        disaster.y + 1,
        groundHeightAt(this.world.cornerHeight, disaster.x + 1, disaster.y + 1),
      );
      node.position.set(point.x, point.y);

      this.container.addChild(node);
      this.nodes.set(disaster.id, node);
    }

    for (const [id, node] of this.nodes) {
      if (alive.has(id)) continue;
      node.destroy();
      this.nodes.delete(id);
      this.movers.delete(id);
    }
  }

  /**
   * Pohne pohromami, které se pohybují (T120).
   *
   * Do teď stálo tornádo **tam, kde vzniklo**, i když simulace jeho osu
   * posouvala dlaždici po dlaždici přes město — obrázek se nehnul. Teď jede
   * za skutečnou polohou (`state.x/y`) a mezi tiky se poloha dopočítává, takže
   * jede plynule. Nálevka se kolébá a u paty víří prach.
   */
  animate(deltaMS: number, tickFraction: number, motion: boolean): void {
    this.clock += deltaMS;
    const t = this.clock / 1000;
    this.dustClock -= deltaMS;
    const dust = motion && this.dustClock <= 0;
    if (dust) this.dustClock = 160;

    for (const disaster of this.world.disasters.active) {
      if (disaster.finished) continue;
      const node = this.nodes.get(disaster.id);
      const x = disaster.state['x'];
      const y = disaster.state['y'];
      if (!node || typeof x !== 'number' || typeof y !== 'number') continue;

      let mover = this.movers.get(disaster.id);
      if (!mover) {
        // Pohybující se nálevka je o polovinu větší než nehybná scéna: stojí
        // uprostřed louky a musí být vidět přes půl obrazovky.
        mover = { fromX: x, fromY: y, toX: x, toY: y, t: 1, scale: node.scale.x * 1.5 };
        node.scale.y = mover.scale;
        this.movers.set(disaster.id, mover);
      }
      if (mover.toX !== x || mover.toY !== y) {
        // Nový cíl: vyjede se z místa, kde uzel právě je.
        const done = Math.min(1, mover.t);
        mover.fromX += (mover.toX - mover.fromX) * done;
        mover.fromY += (mover.toY - mover.fromY) * done;
        mover.toX = x;
        mover.toY = y;
        mover.t = 0;
      }
      mover.t = Math.min(1, mover.t + tickFraction);
      const gx = mover.fromX + (mover.toX - mover.fromX) * mover.t;
      const gy = mover.fromY + (mover.toY - mover.fromY) * mover.t;
      const base = groundHeightAt(this.world.cornerHeight, gx + 0.5, gy + 0.5);
      const point = gridToScreen(gx + 0.5, gy + 0.5, base);
      node.position.set(point.x, point.y);
      if (motion) {
        // Kolébání: vršek nálevky opisuje pomalý kruh, pata stojí.
        node.skew.x = 0.09 * Math.sin(t * 2.3 + disaster.id);
        node.scale.x = mover.scale * (1 + 0.05 * Math.sin(t * 7.1));
      }
      if (dust) this.onDust?.(gx + 0.5, gy + 0.5, base);
    }
  }

  private clear(): void {
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
