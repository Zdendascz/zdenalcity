/**
 * Výškový model terénu (§7 zadání fáze 3).
 *
 * Výška sedí **v rozích, ne v dlaždicích**. Dlaždice `(x, y)` má rohy
 * `(x,y)`, `(x+1,y)`, `(x,y+1)` a `(x+1,y+1)`, takže mřížka rohů je o jedna
 * větší v obou směrech než mřížka dlaždic. Kdyby výška patřila dlaždici, každý
 * svah by byl schod a sousední dlaždice by se nikdy nedotýkaly.
 *
 * **Invariant: sousední rohy se smí lišit nejvýš o 1.** Vynucuje se kaskádou —
 * zvednutí rohu automaticky zvedne sousedy, kteří by jinak invariant porušili.
 * Bez něj by šlo vytvořit svislou stěnu, kterou by renderer neuměl nakreslit
 * a picking trefit.
 *
 * Invariant se schválně týká jen **kolmých** sousedů, ne úhlopříčných. Rohy
 * jedné dlaždice se tím pádem můžou lišit až o dva a vznikne „zkroucená"
 * dlaždice tvaru sedla. Zadání s ní počítá: silnice ji nepobere, ale existovat
 * smí, jinak by terén ztuhl do samých teras.
 */

/** Mřížka rohů je o jedna větší než mřížka dlaždic. */
/**
 * Mřížka rohů je o jedna větší než mřížka dlaždic (R8 fáze 3) — výška patří
 * rohu, ne dlaždici. `size` je hrana **mapy**.
 */
export function cornerSizeOf(size: number): number {
  return size + 1;
}

export function cornerCellsOf(size: number): number {
  const side = cornerSizeOf(size);
  return side * side;
}

/** Rozsah výšek 0–15 (R8). Víc by se do půlbajtu nevešlo, kdyby došlo na packing. */
export const MAX_HEIGHT = 15;

/**
 * Hrana mřížky rohů odvozená z **délky pole**.
 *
 * Pole tu mřížku definuje, takže hrana se z něj dá spočítat — a nemůže se s ní
 * rozejít, jak by se stalo, kdyby si ji každý volající nosil zvlášť. Ušetří to
 * navíc parametr v patnácti funkcích a stovkách volání.
 *
 * Odmocnina se pamatuje podle délky: v jednom běhu mají skoro vždy všechna
 * pole stejnou velikost. Je to čistá keš klíčovaná délkou, žádný skrytý stav —
 * determinismus (P2) tím netrpí.
 */
let cachedLength = -1;
let cachedSide = 0;

export function cornerSideOf(heights: Readonly<Uint8Array>): number {
  if (heights.length !== cachedLength) {
    cachedLength = heights.length;
    cachedSide = Math.round(Math.sqrt(heights.length));
  }
  return cachedSide;
}

/** Velikost mapy, ke které mřížka rohů patří. */
export function mapSizeOf(heights: Readonly<Uint8Array>): number {
  return cornerSideOf(heights) - 1;
}

export function cornerIndex(x: number, y: number, side: number): number {
  return y * side + x;
}

export function cornerInBounds(x: number, y: number, side: number): boolean {
  return x >= 0 && y >= 0 && x < side && y < side;
}

export function createCornerHeights(size: number): Uint8Array {
  return new Uint8Array(cornerCellsOf(size));
}

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** Rohy dlaždice v pořadí severozápad, severovýchod, jihozápad, jihovýchod. */
export function tileCorners(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
): [number, number, number, number] {
  const side = cornerSideOf(heights);
  return [
    heights[cornerIndex(x, y, side)] ?? 0,
    heights[cornerIndex(x + 1, y, side)] ?? 0,
    heights[cornerIndex(x, y + 1, side)] ?? 0,
    heights[cornerIndex(x + 1, y + 1, side)] ?? 0,
  ];
}

/** Rovná dlaždice má všechny čtyři rohy stejně vysoko. Na těch stojí budovy. */
export function isFlatTile(heights: Readonly<Uint8Array>, x: number, y: number): boolean {
  const [nw, ne, sw, se] = tileCorners(heights, x, y);
  return nw === ne && ne === sw && sw === se;
}

/**
 * Zkroucená dlaždice — čtyři rohy neleží v jedné rovině (sedlo).
 *
 * Rovinu poznáme z toho, že se součty úhlopříček rovnají. Nerovnají-li se,
 * dlaždice se nedá nakreslit jako plocha a silnice po ní nepovede (§7).
 */
export function isTwistedTile(heights: Readonly<Uint8Array>, x: number, y: number): boolean {
  const [nw, ne, sw, se] = tileCorners(heights, x, y);
  return nw + se !== ne + sw;
}

/** Nejnižší roh dlaždice. Základna, podle které se ve 3b řadí kreslení. */
export function tileBaseHeight(heights: Readonly<Uint8Array>, x: number, y: number): number {
  const [nw, ne, sw, se] = tileCorners(heights, x, y);
  return Math.min(nw, ne, sw, se);
}

/**
 * Nejnižší a nejvyšší roh pod obdélníkem `w × h` dlaždic.
 *
 * Renderer z toho staví podezdívku: budova stojí horní plochou na **nejvyšším**
 * rohu a zeď sahá k **nejnižšímu**, takže na svahu nikde nevisí ve vzduchu.
 */
export function areaHeightRange(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
  w: number,
  h: number,
): { min: number; max: number } {
  const side = cornerSideOf(heights);
  let min = MAX_HEIGHT;
  let max = 0;

  for (let cy = y; cy <= y + h; cy++) {
    for (let cx = x; cx <= x + w; cx++) {
      if (!cornerInBounds(cx, cy, side)) continue;
      const value = heights[cornerIndex(cx, cy, side)] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  return min > max ? { min: 0, max: 0 } : { min, max };
}

/**
 * Dvojice sousedních rohů, které porušují invariant.
 *
 * Vrací počet, ne `boolean`: při ladění generátoru je rozdíl mezi „jedna
 * dvojice" a „šest tisíc dvojic" ta nejcennější informace.
 */
export function countViolations(heights: Readonly<Uint8Array>): number {
  const side = cornerSideOf(heights);
  let violations = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const here = heights[cornerIndex(x, y, side)] ?? 0;
      // Stačí doprava a dolů, jinak by se každá dvojice počítala dvakrát.
      if (
        x + 1 < side &&
        Math.abs(here - (heights[cornerIndex(x + 1, y, side)] ?? 0)) > 1
      ) {
        violations++;
      }
      if (
        y + 1 < side &&
        Math.abs(here - (heights[cornerIndex(x, y + 1, side)] ?? 0)) > 1
      ) {
        violations++;
      }
    }
  }
  return violations;
}

/**
 * Spočítá, co se musí změnit, aby roh `x, y` skončil ve výšce `target` a
 * invariant zůstal celý.
 *
 * **Nic nemění** — vrací jen mapu `roh → nová výška`. Terraforming z T32 z ní
 * spočítá cenu **než** se hráče zeptá, a stejnou mapu pak použije k zápisu.
 * Kdyby se měnilo rovnou, nešlo by cenu ukázat předem (§12 kritérium 14).
 *
 * Kaskáda jde do šířky: zvednutý roh dotlačí souseda nejvýš na `výška − 1`,
 * ten svého souseda, a tak dál, dokud se vlna nezastaví o terén, který
 * invariant splňuje sám.
 */
export function planCornerHeight(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
  target: number,
): Map<number, number> {
  const side = cornerSideOf(heights);
  const changes = new Map<number, number>();
  if (!cornerInBounds(x, y, side)) return changes;

  const clamped = Math.max(0, Math.min(MAX_HEIGHT, Math.round(target)));
  const start = cornerIndex(x, y, side);
  if ((heights[start] ?? 0) === clamped) return changes;

  const heightAt = (corner: number): number => changes.get(corner) ?? heights[corner] ?? 0;

  changes.set(start, clamped);
  const queue = [start];

  while (queue.length > 0) {
    const corner = queue.shift();
    if (corner === undefined) break;

    const here = heightAt(corner);
    const cx = corner % side;
    const cy = (corner - cx) / side;

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!cornerInBounds(nx, ny, side)) continue;

      const neighbour = cornerIndex(nx, ny, side);
      const value = heightAt(neighbour);
      // Soused smí zůstat, jen když je v mezích jednoho patra.
      const wanted = value < here - 1 ? here - 1 : value > here + 1 ? here + 1 : value;
      if (wanted === value) continue;

      changes.set(neighbour, Math.max(0, Math.min(MAX_HEIGHT, wanted)));
      queue.push(neighbour);
    }
  }

  return changes;
}

/**
 * Plán srovnání obdélníku dlaždic do jedné výšky (§7 fáze 3).
 *
 * Skládá se z jednotlivých kaskád, protože ty se **navzájem ovlivňují**:
 * srovnání druhého rohu už musí vidět, co udělal ten první. Proto se počítá nad
 * pracovní kopií a vrací se sjednocení změn.
 *
 * Cílová výška je zaokrouhlený průměr rohů oblasti. Je to volba pro hráče
 * nejlevnější: srovnání na nejvyšší nebo nejnižší roh by hýbalo víc terénem
 * a stálo víc.
 */
export function planLevelArea(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
  width: number,
  depth: number,
  target?: number,
): Map<number, number> {
  const side = cornerSideOf(heights);
  const corners: number[] = [];
  for (let cy = y; cy <= y + depth; cy++) {
    for (let cx = x; cx <= x + width; cx++) {
      if (cornerInBounds(cx, cy, side)) corners.push(cornerIndex(cx, cy, side));
    }
  }

  const changes = new Map<number, number>();
  if (corners.length === 0) return changes;

  let level = target;
  if (level === undefined) {
    let sum = 0;
    for (const corner of corners) sum += heights[corner] ?? 0;
    level = Math.round(sum / corners.length);
  }

  const working = Uint8Array.from(heights);
  for (const corner of corners) {
    const cx = corner % side;
    const cy = (corner - cx) / side;
    const step = planCornerHeight(working, cx, cy, level);
    applyCornerChanges(working, step);
    for (const [at, value] of step) changes.set(at, value);
  }

  // Roh, který se vrátil na původní hodnotu, se do účtu počítat nemá.
  for (const [at, value] of [...changes]) {
    if ((heights[at] ?? 0) === value) changes.delete(at);
  }

  return changes;
}

/** Zapíše plán z `planCornerHeight`. Oddělené schválně — viz komentář tamtéž. */
export function applyCornerChanges(heights: Uint8Array, changes: ReadonlyMap<number, number>): void {
  for (const [corner, value] of changes) heights[corner] = value;
}

/**
 * Srovná výškové pole tak, aby invariant platil všude.
 *
 * Používá to generátor: šum ani koryto řeky se o sousedy nestarají, tak se
 * výsledek nakonec „nechá stéct" — každý roh se stlačí nejvýš na `soused + 1`.
 * Opakuje se, dokud se něco mění; kroky jsou zastropované, aby nešlo o
 * nekonečnou smyčku, kdyby se model někdy změnil.
 *
 * Vrací počet průchodů, což je jediné, co při ladění generátoru zajímá.
 */
export function relaxHeights(heights: Uint8Array, maxPasses = 64): number {
  const side = cornerSideOf(heights);
  for (let pass = 1; pass <= maxPasses; pass++) {
    let changed = false;

    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const corner = cornerIndex(x, y, side);
        const here = heights[corner] ?? 0;

        let lowest = MAX_HEIGHT;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!cornerInBounds(nx, ny, side)) continue;
          lowest = Math.min(lowest, heights[cornerIndex(nx, ny, side)] ?? 0);
        }

        if (here > lowest + 1) {
          heights[corner] = lowest + 1;
          changed = true;
        }
      }
    }

    if (!changed) return pass;
  }

  return maxPasses;
}

/**
 * Jak srovnat zkroucenou dlaždici, aby po ní šla vést vozovka.
 *
 * Zkroucená dlaždice je sedlo: `nw + se ≠ ne + sw`. Vozovka po ní nejde přejet
 * po rovině a nejde ji ani nakreslit, tak ji hráč musel do T61 srovnat ručně —
 * a protože se to muselo trefit na správný roh, končilo to většinou tím, že si
 * kolem kopce udělal okliku.
 *
 * Srovnává se **jedním rohem**. Pro každý ze čtyř existuje právě jedna výška,
 * při které rovnost platí, takže stačí spočítat všechny čtyři a vzít ten
 * nejlevnější plán. Hledat kombinace dvou rohů nemá smysl: vždycky stojí víc
 * a výsledek vypadá stejně.
 *
 * Vrací `null`, když to nejde — třeba když by roh musel nad `MAX_HEIGHT` nebo
 * když kaskáda sousedům dlaždici zkroutí znovu. Kaskáda drží mezi sousedními
 * rohy nejvýš jedno patro a přitom může sáhnout i na zbylé tři rohy téhle
 * dlaždice, takže se u každého plánu **ověřuje výsledek**, ne že vznikl.
 */
export function planUntwist(
  heights: Readonly<Uint8Array>,
  x: number,
  y: number,
): Map<number, number> | null {
  if (!isTwistedTile(heights, x, y)) return new Map();

  const side = cornerSideOf(heights);
  const [nw, ne, sw, se] = tileCorners(heights, x, y);

  // Pořadí je pevné, aby při shodné ceně vyšel pokaždé týž roh (P2).
  const candidates: [number, number, number, number][] = [
    [x, y, nw, ne + sw - se],
    [x + 1, y, ne, nw + se - sw],
    [x, y + 1, sw, nw + se - ne],
    [x + 1, y + 1, se, ne + sw - nw],
  ];

  let best: Map<number, number> | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [cx, cy, current, target] of candidates) {
    const changes = planCornerHeight(heights, cx, cy, target);
    if (changes.size === 0) continue;

    // Ověřuje se **výsledek**, ne cíl. Roh mimo rozsah `planCornerHeight` sám
    // ořízne a kaskáda může sáhnout i na zbylé tři rohy téhle dlaždice — obojí
    // vede k plánu, který vznikne, ale dlaždici nesrovná. Kontrolovat rozsah
    // zvlášť by byla druhá pojistka na totéž a ani jedna by pak nebyla vidět
    // v testu, protože by se navzájem kryly.
    if (!untwistsTile(heights, changes, x, y, side)) continue;

    // Levnější plán vyhrává; při shodě ten, který dozdívá. Odkopat roh je sice
    // stejně drahé, ale hráč staví silnici do kopce a čeká náspu, ne výkop.
    const score = changes.size * 2 + (target > current ? 0 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = changes;
    }
  }

  return best;
}

/** Ověří, že po provedení změn už dlaždice zkroucená není. */
function untwistsTile(
  heights: Readonly<Uint8Array>,
  changes: ReadonlyMap<number, number>,
  x: number,
  y: number,
  side: number,
): boolean {
  const at = (cx: number, cy: number): number => {
    const corner = cornerIndex(cx, cy, side);
    return changes.get(corner) ?? heights[corner] ?? 0;
  };
  return at(x, y) + at(x + 1, y + 1) === at(x + 1, y) + at(x, y + 1);
}
