/**
 * Izometrická projekce. Existuje **výhradně tady a v pickingu** (P3) —
 * simulace zná jen gridové souřadnice a o obrazovce neví nic.
 */

export const TILE_W = 64; // šířka izometrického diamantu v px
export const TILE_H = 32; // výška diamantu (poměr 2:1)
export const LEVEL_H = 16; // px na jednu výškovou úroveň terénu

export interface Point {
  x: number;
  y: number;
}

/**
 * Vrací **horní vrchol** diamantu dlaždice, ne jeho střed. Zbylé tři vrcholy
 * jsou na (+W/2, +H/2), (0, +H) a (−W/2, +H/2) — viz `diamondPoints`.
 *
 * Souřadnice smí být lomené: `gridToScreen(x + 0.5, y)` je bod uprostřed
 * severní hrany. Toho využívá kreslení budov i symbolů.
 */
export function gridToScreen(x: number, y: number, elevation = 0): Point {
  return {
    x: (x - y) * (TILE_W / 2),
    y: (x + y) * (TILE_H / 2) - elevation * LEVEL_H,
  };
}

/**
 * Čtyřúhelník dlaždice ze **čtyř výšek jejích rohů** (§7 fáze 3).
 *
 * Tohle je ta změna, kvůli které přestal stačit pravidelný diamant: každý roh
 * se zvedne o svou vlastní výšku, takže dlaždice se nakloní. Sousední dlaždice
 * sdílí rohy, a protože se počítají ze stejných čísel, terén nikde nepraskne.
 *
 * Pořadí je sever → východ → jih → západ, tedy obvod dokola; `Graphics.poly`
 * nic jiného nepřijme.
 */
export function tileQuad(
  x: number,
  y: number,
  corners: readonly [number, number, number, number],
): number[] {
  return areaQuad(x, y, 1, 1, corners);
}

/**
 * Totéž pro obdélník `w × h` dlaždic — půdorys budovy nebo buňka hrubé mřížky.
 * Rohy jsou v pořadí severozápad, severovýchod, jihozápad, jihovýchod.
 */
export function areaQuad(
  x: number,
  y: number,
  w: number,
  h: number,
  corners: readonly [number, number, number, number],
): number[] {
  const [nw, ne, sw, se] = corners;
  const north = gridToScreen(x, y, nw);
  const east = gridToScreen(x + w, y, ne);
  const south = gridToScreen(x + w, y + h, se);
  const west = gridToScreen(x, y + h, sw);
  return [north.x, north.y, east.x, east.y, south.x, south.y, west.x, west.y];
}

/**
 * Tři rohy dlaždice, ze kterých se skládá matice pro obrázek povrchu.
 *
 * Vrací všechny čtyři rohy v pixelech po směru hodin: severozápadní,
 * severovýchodní, jihovýchodní, jihozápadní. Afinní zobrazení potřebuje jen
 * tři, ale který trojici vzít, rozhoduje **otočení** obrázku — proto se vrací
 * všechny. Čtvrtý roh se u nerovné dlaždice stejně nedá trefit, a právě proto
 * je obrázek na svahu jen přiblížení.
 *
 * Pořadí sedí na `fit-tiles.py`: v narovnaném čtverci je `(0,0)` severozápad,
 * `+u` míří na severovýchod a `+v` na jihozápad.
 */
export function surfaceCorners(
  x: number,
  y: number,
  corners: readonly [number, number, number, number],
): [[number, number], [number, number], [number, number], [number, number]] {
  const [nw, ne, sw, se] = corners;
  const a = gridToScreen(x, y, nw);
  const b = gridToScreen(x + 1, y, ne);
  const c = gridToScreen(x + 1, y + 1, se);
  const d = gridToScreen(x, y + 1, sw);
  return [
    [a.x, a.y],
    [b.x, b.y],
    [c.x, c.y],
    [d.x, d.y],
  ];
}

/**
 * O kolik ztmavit nebo zesvětlit dlaždici podle sklonu.
 *
 * Bez tohohle by se svah od roviny nedal rozeznat: obě plochy mají stejnou
 * barvu terénu a izometrie nemá perspektivu, která by tvar prozradila.
 * Světlo svítí od severozápadu, takže plochy nakloněné k pozorovateli
 * (na jih a na východ) jsou světlejší a odvrácené tmavší.
 *
 * Vrací násobitel kolem jedničky, ne barvu — mísení barev patří do palety.
 */
export function slopeLight(corners: readonly [number, number, number, number], strength = 0.14): number {
  const [nw, ne, sw, se] = corners;
  const southFall = (sw + se) / 2 - (nw + ne) / 2;
  const eastFall = (ne + se) / 2 - (nw + sw) / 2;
  // Průměr obou spádů, ať se úhlopříčný svah nepočítá dvakrát.
  return 1 + ((southFall + eastFall) / 2) * strength;
}

/**
 * Drobná odchylka jasu dlaždice, aby plocha nebyla jednolitá.
 *
 * Terén je šest plných barev a na velké louce to vypadá jako plast. Tohle mu
 * dá zrno, aniž by přibyl jediný obrázek: hodnota se počítá **ze souřadnic**,
 * takže je stejná při každém vykreslení, po načtení savu i mezi běhy. Do savu
 * nic nepřibývá a se simulací to nemá co dělat — je to čistě vzhled.
 *
 * Dvě oktávy schválně. Sama jemná by dala sůl a pepř, který při oddálení
 * splyne v šum; hrubá dělá **skvrny přes několik dlaždic**, tedy to, co na
 * louce nebo v lese doopravdy vidíš. Jemná je pak jen dolaďuje.
 *
 * Hrubá se **prokládá, ne schodí**. První verze brala hodnotu konstantní na
 * blok 4×4 (`x >> 2`) a na mapě z toho byly viditelné kostky — dlaždice uvnitř
 * bloku měly tutéž odchylku a na jeho hranici skočila. Bilineární proložení
 * mezi rohy bloku dá plynulé skvrny.
 *
 * Vrací násobek kolem jedničky, který se dá rovnou předat do `shade`.
 */
export function tileVariation(x: number, y: number, amount: number): number {
  if (amount <= 0) return 1;
  return 1 + (patchNoise(x, y, PATCH_TILES) * 0.72 + noiseAt(x, y) * 0.28) * amount;
}

/** Přes kolik dlaždic se skvrna rozprostře. */
const PATCH_TILES = 5;

/** Vyhlazení 3t² − 2t³ — bez něj jsou na hranicích bloků vidět hrany. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilineárně proložený šum: hodnoty v rozích bloku, mezi nimi plynulý přechod. */
function patchNoise(x: number, y: number, cell: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = ease(fx - x0);
  const ty = ease(fy - y0);

  const top = noiseAt(x0, y0) * (1 - tx) + noiseAt(x0 + 1, y0) * tx;
  const bottom = noiseAt(x0, y0 + 1) * (1 - tx) + noiseAt(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Pseudonáhodná hodnota −1 až 1 ze dvou souřadnic.
 *
 * Celočíselný hash, ne `Math.random`: musí vyjít pokaždé stejně, jinak by se
 * terén při každém zapečení chunku přebarvil. Konstanty jsou běžná směšovací
 * čísla; jde o rozprostření bitů, ne o kryptografii.
 */
function noiseAt(x: number, y: number): number {
  let h = (x | 0) * 0x1f1f1f1f;
  h = (h ^ ((y | 0) * 0x8da6b343)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}

/**
 * Obdélníková oblast mřížky `w × h` od `(x, y)` jako čtyřúhelník na zemi.
 * Pro 1×1 vyjde přesně diamant dlaždice.
 */
export function footprintQuad(x: number, y: number, w: number, h: number, base = 0): number[] {
  const back = gridToScreen(x, y, base);
  const right = gridToScreen(x + w, y, base);
  const front = gridToScreen(x + w, y + h, base);
  const left = gridToScreen(x, y + h, base);
  return [back.x, back.y, right.x, right.y, front.x, front.y, left.x, left.y];
}

export interface CuboidFaces {
  top: number[];
  left: number[];
  right: number[];
}

/**
 * Tři viditelné stěny kvádru budovy o půdorysu `w × h` dlaždic a výšce
 * `heightPx`. Zadní dvě stěny jsou vždy zakryté, takže se nekreslí.
 *
 * Půdorys je čtyřúhelník přes rohy mřížky (x, y) → (x+w, y) → (x+w, y+h) →
 * (x, y+h); pro 1×1 vyjde přesně diamant dlaždice.
 */
export function cuboidFaces(
  x: number,
  y: number,
  w: number,
  h: number,
  heightPx: number,
  base = 0,
): CuboidFaces {
  const back = gridToScreen(x, y, base);
  const right = gridToScreen(x + w, y, base);
  const front = gridToScreen(x + w, y + h, base);
  const left = gridToScreen(x, y + h, base);

  const lifted = (point: Point): [number, number] => [point.x, point.y - heightPx];
  const ground = (point: Point): [number, number] => [point.x, point.y];

  return {
    top: [...lifted(back), ...lifted(right), ...lifted(front), ...lifted(left)],
    right: [...lifted(right), ...lifted(front), ...ground(front), ...ground(right)],
    left: [...lifted(front), ...lifted(left), ...ground(left), ...ground(front)],
  };
}

/**
 * Stěny podezdívky, jejíž **spodní hrana kopíruje terén**.
 *
 * Rovný kvádr od nejnižšího rohu k nejvyššímu na svahu nestačí: jeho spodní
 * hrana je vodorovný diamant, kdežto země pod ní se svažuje. Podezdívka pak
 * budovu nedrží, ale protíná — a hráč nepozná, na které dlaždici stavba stojí.
 * Přesně to autor nahlásil.
 *
 * Horní hrana zůstává **rovná ve výšce `top`**: na ní stojí dům a ten rovný je.
 * Spodní se láme na každé hranici dlaždic, protože terén se tam taky láme;
 * rovná čára od rohu k rohu by přes dvě dlaždice zase někde uťala kopec.
 *
 * `groundAt(fx, fy)` vrací výšku terénu v libovolném bodě mřížky, tedy i mezi
 * rohy — půdorys je zasazený dovnitř dlaždice, takže na celé rohy nepadne.
 *
 * **Podezdívka jde jen dolů, nikdy nahoru.** Když terén na viditelné straně
 * stoupá nad podlahu, není co dozdívat — dům se do svahu zařezává. Bez
 * zastropení se polygon obrátil a vysázel šedou zeď přes svah a přes fasádu;
 * změřeno na dlaždici s podlahou ve výšce 2 a terénem 4, kde stěna vylezla
 * 32 px nad podlahu. Autor to hlásil jako „podezdívky bez textur" a jako
 * „baráky mimo pozici", protože ta zeď vypadá jako špatně posazený dům.
 */
export function skirtFaces(
  x: number,
  y: number,
  w: number,
  h: number,
  top: number,
  groundAt: (fx: number, fy: number) => number,
): { right: number[]; left: number[] } {
  const lift = (fx: number, fy: number): [number, number] => {
    const point = gridToScreen(fx, fy, top);
    return [point.x, point.y];
  };
  const drop = (fx: number, fy: number): [number, number] => {
    // Zastropeno podlahou: nad ni podezdivka nesmi, viz komentar u funkce.
    const point = gridToScreen(fx, fy, Math.min(top, groundAt(fx, fy)));
    return [point.x, point.y];
  };

  // Vidět jsou dvě stěny: východní (x + w) a jižní (y + h). Ostatní dvě jsou
  // odvrácené a kreslit je nemá smysl.
  const east = edgeSteps(y, y + h);
  const south = edgeSteps(x, x + w);

  return {
    right: [
      ...lift(x + w, y),
      ...lift(x + w, y + h),
      ...east.reverse().flatMap((fy) => drop(x + w, fy)),
    ],
    left: [
      ...lift(x + w, y + h),
      ...lift(x, y + h),
      ...south.flatMap((fx) => drop(fx, y + h)),
    ],
  };
}

/**
 * Body podél hrany: oba konce a každá hranice dlaždic mezi nimi.
 *
 * Bez těch mezilehlých by spodní hrana přes víc dlaždic vedla rovně a na
 * lomeném svahu by budovu buď podřízla, nebo nechala viset.
 */
function edgeSteps(from: number, to: number): number[] {
  const steps: number[] = [from];
  for (let edge = Math.ceil(from); edge < to; edge++) {
    if (edge > from) steps.push(edge);
  }
  steps.push(to);
  return steps;
}

/**
 * Čtyři vrcholy diamantu jako plochý seznam souřadnic pro `Graphics.poly`.
 * `originX/Y` je horní vrchol.
 */
export function diamondPoints(originX: number, originY: number): number[] {
  return [
    originX,
    originY,
    originX + TILE_W / 2,
    originY + TILE_H / 2,
    originX,
    originY + TILE_H,
    originX - TILE_W / 2,
    originY + TILE_H / 2,
  ];
}
