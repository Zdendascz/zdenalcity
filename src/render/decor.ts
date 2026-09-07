import type { Texture } from 'pixi.js';
import { tileCorners } from '@/sim/heights';

/**
 * Předmět, který stojí na terénu — strom nebo balvan.
 *
 * `anchor` je bod obrázku, který sedne na místo, kde se předmět dotýká země,
 * v pixelech obrázku. `scale` je nadvzorkování, se kterým ho vyrobil
 * `fit-sprites.py`.
 *
 * Kreslí se **mezi budovami**, ne v terénu. Nejdřív to bylo v terénním chunku,
 * protože se tím ušetřilo řazení hloubky, jenže pak se park nakreslil přes
 * stromy, které měly stát před ním — autor to nahlásil slovy „park přečuhuje
 * přes stromy, měl by být za nimi". Chunk se kreslí pod celou zástavbou, takže
 * z něj správné pořadí nejde dostat.
 */
export interface TerrainDecor {
  texture: Texture;
  anchor: readonly [number, number];
  scale: number;
}

/**
 * Kolik dlaždic předmět zabere. Odvozeno z šířky obrázku, ne z definice —
 * definici nemá, viz `DECOR` v `tools/fit-sprites.py`.
 */
export function decorTiles(decor: TerrainDecor): number {
  return Math.max(1, Math.round(decor.texture.width / (2 * 32 * decor.scale)));
}

/**
 * Jak často předmět stojí, podle toho, jak je široký.
 *
 * Strom je široký dvě dlaždice, takže na dvou třetinách dlaždic se stromy
 * překrývají v hradbu. Hustota se proto odvozuje z jeho vlastní šířky: jeden
 * na tolik dlaždic, kolik jich zabere. Nad dvě třetiny se nejde — z plné
 * hustoty by byla souvislá plocha bez mezer.
 */
export function decorDensity(decor: TerrainDecor): number {
  const tiles = decorTiles(decor);
  return Math.min(2 / 3, 1 / (tiles * tiles));
}

/**
 * Stojí na téhle dlaždici předmět, nebo je mezera?
 *
 * Bez mezer je z lesa **hradba**: pravidelná mřížka stejných korun, které se
 * navíc překrývají.
 */
export function decorHere(x: number, y: number, density: number): boolean {
  let h = Math.imul((x * 0x27d4eb2d) ^ (y * 0x165667b1), 0x9e3779b1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h % 1000) / 1000 < density;
}

/**
 * Která varianta předmětu padne na dlaždici.
 *
 * Vlastní míchačka, ať se neváže na mezery ani na posun — jinak by třeba
 * všechny smrky stály vlevo.
 */
export function decorPick(x: number, y: number): number {
  const h = Math.imul((x * 0x2545f491) ^ (y * 0x9e3779b1), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * O kolik se předmět posune od středu dlaždice, v dílech dlaždice.
 *
 * Kdyby všechny stromy stály přesně na středu, vyjde z toho mřížka. Drží se do
 * třetiny dlaždice od středu, aby strom nepřelezl k sousedovi víc, než musí.
 */
export function decorShift(x: number, y: number): [number, number] {
  let h = Math.imul((x * 0x85ebca6b) ^ (y * 0xc2b2ae35), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return [((h & 15) / 15 - 0.5) / 1.5, (((h >>> 8) & 15) / 15 - 0.5) / 1.5];
}

/**
 * Kterým směrem na obrazovce klesá země pod dlaždicí.
 *
 * `flat` je rovina, zbytek jsou čtyři hrany kosočtverce: `ur` vpravo nahoru,
 * `lr` vpravo dolů, `ll` vlevo dolů, `ul` vlevo nahoru. Přesně tak se jmenují
 * i obrázky suti kreslené do svahu (`docs/08-DLAZDICE.md`).
 *
 * Rohy dlaždice leží na obrazovce takhle: **nw nahoře, ne vpravo, sw vlevo,
 * se dole**. Směr klesání se proto určí tak, že se najde **nejnižší hrana** —
 * dvojice sousedních rohů s nejmenším součtem.
 *
 * Čtyři směry stačí. Dlaždice může klesat i k jednomu rohu, ale rozdíl mezi
 * „klesá k rohu" a „klesá k nejbližší hraně" je půl dlaždice; rozdíl mezi
 * plochou a nakloněnou hromadou je celá úroveň. Při shodě rozhoduje pevné
 * pořadí, aby výběr nezávisel na ničem, co se mezi snímky mění (P2).
 */
export type RubbleSlope = 'flat' | 'ur' | 'lr' | 'll' | 'ul';

export function rubbleSlope(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
): RubbleSlope {
  const [nw, ne, sw, se] = tileCorners(heights, x, y);
  if (nw === ne && ne === sw && sw === se) return 'flat';

  const edges: readonly [RubbleSlope, number][] = [
    ['ur', nw + ne],
    ['lr', ne + se],
    ['ll', sw + se],
    ['ul', nw + sw],
  ];

  let best: RubbleSlope = 'flat';
  let lowest = Number.POSITIVE_INFINITY;
  for (const [slope, sum] of edges) {
    if (sum >= lowest) continue;
    lowest = sum;
    best = slope;
  }
  return best;
}
