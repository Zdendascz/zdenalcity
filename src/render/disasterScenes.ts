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
