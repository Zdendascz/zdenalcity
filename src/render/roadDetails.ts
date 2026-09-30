import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from './roads';

/**
 * Podrobnosti vozovky (T122): vodorovné značení, chodník se zeleným pásem,
 * kruhový objezd a most.
 *
 * Autor: „Jsou to české silnice, měly by tam být pruhy, krajnice i středové.
 * Dálnice je 4proudová." Značení se **počítá**, ne kreslí do obrázku —
 * přesně z toho důvodu, ze kterého se počítá tvar vozovky (`roads.ts`): čára
 * musí navazovat přes hranici dlaždice a to generátor nikdy netrefí. Tady
 * navazuje sama, protože obě dlaždice kladou čáru na stejné `u` či `v`
 * a přerušovaná čára má vzor svázaný s hranou dlaždice, ne s jejím středem.
 *
 * Všechno je v souřadnicích dlaždice `(u, v) ∈ [0, 1]²` — `u` po mřížce
 * v ose x (východ), `v` v ose y (jih). Na obrazovku to promítne `projectUV`
 * přes skutečné rohy dlaždice, takže značení jde po svahu s vozovkou.
 */

export type UV = readonly [number, number];

/** Co se kreslí. Barvy a pořadí vrstev řeší renderer. */
export type DetailKind =
  | 'line'
  | 'zebra'
  | 'sidewalk'
  | 'verge'
  | 'island'
  | 'islandKerb'
  | 'roundabout'
  | 'railing'
  | 'girder'
  | 'shadow'
  | 'pillar';

export interface DetailPolygon {
  readonly kind: DetailKind;
  readonly points: readonly UV[];
  /** Zvednutí nad plochu dlaždice v px (zábradlí), nebo pokles (bočnice, pilíř). */
  readonly lift?: number;
}

/** Tloušťka čáry v podílu dlaždice. Hrana dlaždice má ~36 px, čára ~0,6 px při 1×. */
const LINE = 0.018;
/** Přerušovaná čára: délka čárky a mezery. Čtyři čárky na dlaždici. */
const DASH = 0.13;
const GAP = 0.12;
/** Jak daleko od obrubníku leží krajnice. */
const EDGE_INSET = 0.03;

/** Šířka chodníku a zeleného pásu u domu, v podílu dlaždice. */
export const SIDEWALK = 0.13;
export const VERGE = 0.05;

const rect = (u0: number, v0: number, u1: number, v1: number): UV[] => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1],
];

/** Úsečka ve směru `v` (sever–jih) na pozici `u`, od `from` do `to`. */
function lineV(u: number, from: number, to: number, width = LINE): UV[] {
  return rect(u - width / 2, Math.min(from, to), u + width / 2, Math.max(from, to));
}

/** Obecná úsečka mezi dvěma body — šikmá krajnice rozšiřujícího se ramene. */
function segment(from: UV, to: UV, width = LINE): UV[] {
  const du = to[0] - from[0];
  const dv = to[1] - from[1];
  const length = Math.hypot(du, dv) || 1;
  const nu = (-dv / length) * (width / 2);
  const nv = (du / length) * (width / 2);
  return [
    [from[0] + nu, from[1] + nv],
    [to[0] + nu, to[1] + nv],
    [to[0] - nu, to[1] - nv],
    [from[0] - nu, from[1] - nv],
  ];
}

/** Úsečka ve směru `u` (západ–východ) na pozici `v`. */
function lineU(v: number, from: number, to: number, width = LINE): UV[] {
  return rect(Math.min(from, to), v - width / 2, Math.max(from, to), v + width / 2);
}

/**
 * Čárky mezi `from` a `to`. Vzor začíná na **hraně dlaždice** (0), ne na
 * `from`, takže dvě dlaždice za sebou pokračují v témže rytmu.
 */
function dashes(from: number, to: number): [number, number][] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: [number, number][] = [];
  for (let start = GAP / 2; start < 1; start += DASH + GAP) {
    const a = Math.max(lo, start);
    const b = Math.min(hi, start + DASH);
    if (b - a > 0.01) out.push([a, b]);
  }
  return out;
}

export interface MarkingOptions {
  /** Šířka vozovky (ROAD_WIDTHS). */
  readonly width: number;
  /** Počet jízdních pruhů: ulice a třída 2, dálnice 4. */
  readonly lanes: 2 | 4;
  /** Krajnice — ulice je nemá, třída a dálnice ano. */
  readonly edges: boolean;
  /** Přechod pro chodce na ramenech, která vedou do křižovatky. */
  readonly zebraArms?: number;
  /** Šířka ramen na hraně dlaždice (S, V, J, Z), když se k sousedovi rozšiřují. */
  readonly armEdges?: readonly number[];
}

const ARMS = [ROAD_N, ROAD_E, ROAD_S, ROAD_W] as const;

/**
 * Vodorovné značení jedné dlaždice.
 *
 * - **Rovinka a zatáčka**: středová čára vede přes střed dlaždice, takže
 *   v zatáčce udělá roh; krajnice jdou kolem.
 * - **Křižovatka** (tři a víc ramen): uvnitř křižovatky se nekreslí nic,
 *   čáry končí na jejím okraji — tak to na české křižovatce vypadá.
 * - **Dálnice**: dvojitá plná uprostřed a přerušovaná mezi pruhy téhož směru.
 */
export function roadMarkings(mask: number, options: MarkingOptions): UV[][] {
  const half = options.width / 2;
  const lo = 0.5 - half;
  const hi = 0.5 + half;
  const arms = ARMS.filter((arm) => mask & arm);
  const junction = arms.length >= 3;
  const out: UV[][] = [];

  // Kam až rameno sahá do dlaždice: u křižovatky jen po okraj středu,
  // jinak do středu dlaždice.
  const reach = junction ? { N: lo, E: hi, S: hi, W: lo } : { N: 0.5, E: 0.5, S: 0.5, W: 0.5 };

  const centre = (arm: number, offset: number, dashed: boolean, width = LINE): void => {
    const [from, to] =
      arm === ROAD_N ? [0, reach.N] : arm === ROAD_S ? [reach.S, 1] : arm === ROAD_W ? [0, reach.W] : [reach.E, 1];
    const pieces = dashed ? dashes(from, to) : [[from, to] as [number, number]];
    for (const [a, b] of pieces) {
      if (arm === ROAD_N || arm === ROAD_S) out.push(lineV(0.5 + offset, a, b, width));
      else out.push(lineU(0.5 + offset, a, b, width));
    }
  };

  for (const arm of arms) {
    if (options.lanes === 4) {
      // Dvojitá plná uprostřed, přerušovaná mezi pruhy.
      centre(arm, -LINE * 1.2, false);
      centre(arm, LINE * 1.2, false);
      centre(arm, -half / 2, true);
      centre(arm, half / 2, true);
    } else {
      centre(arm, 0, true);
    }
  }
  // Zatáčka a rovinka: čára se musí potkat ve středu i tam, kde se ramena
  // nestýkají přímo (zatáčka). Malý čtvereček zakryje roh.
  if (!junction && arms.length === 2 && options.lanes === 2) {
    const straight = mask === (ROAD_N | ROAD_S) || mask === (ROAD_E | ROAD_W);
    if (!straight) out.push(rect(0.5 - LINE / 2, 0.5 - LINE / 2, 0.5 + LINE / 2, 0.5 + LINE / 2));
  }

  if (options.edges) {
    const a = lo + EDGE_INSET;
    const b = hi - EDGE_INSET;
    // Krajnice podél ramen. Když se rameno k širšímu sousedovi rozšiřuje
    // (`armEdges`), jde krajnice šikmo s ním — jinak by na hranici typů
    // udělala schod.
    const outer = (side: number): [number, number] => {
      const h = (options.armEdges?.[side] ?? options.width) / 2;
      return [0.5 - h + EDGE_INSET, 0.5 + h - EDGE_INSET];
    };
    for (const arm of arms) {
      const inner = junction ? (arm === ROAD_N || arm === ROAD_W ? lo : hi) : arm === ROAD_N || arm === ROAD_W ? a : b;
      if (arm === ROAD_N) {
        const [ea, eb] = outer(0);
        out.push(segment([a, inner], [ea, 0]), segment([b, inner], [eb, 0]));
      }
      if (arm === ROAD_E) {
        const [ea, eb] = outer(1);
        out.push(segment([inner, a], [1, ea]), segment([inner, b], [1, eb]));
      }
      if (arm === ROAD_S) {
        const [ea, eb] = outer(2);
        out.push(segment([a, inner], [ea, 1]), segment([b, inner], [eb, 1]));
      }
      if (arm === ROAD_W) {
        const [ea, eb] = outer(3);
        out.push(segment([inner, a], [0, ea]), segment([inner, b], [0, eb]));
      }
    }
    // A kolem středu tam, kam žádné rameno nevede.
    if (!junction) {
      if (!(mask & ROAD_N)) out.push(lineU(a, a, b));
      if (!(mask & ROAD_S)) out.push(lineU(b, a, b));
      if (!(mask & ROAD_W)) out.push(lineV(a, a, b));
      if (!(mask & ROAD_E)) out.push(lineV(b, a, b));
    }
  }

  // Přechod pro chodce: pruhy napříč ramenem, těsně před křižovatkou.
  for (const arm of ARMS) {
    if (!((options.zebraArms ?? 0) & arm) || !(mask & arm)) continue;
    const stripes = Math.max(3, Math.round(options.width / 0.06));
    const step = (hi - lo) / stripes;
    for (let i = 0; i < stripes; i++) {
      const s0 = lo + step * (i + 0.2);
      const s1 = lo + step * (i + 0.8);
      if (arm === ROAD_N) out.push(rect(s0, lo - 0.1, s1, lo - 0.03));
      if (arm === ROAD_S) out.push(rect(s0, hi + 0.03, s1, hi + 0.1));
      if (arm === ROAD_W) out.push(rect(lo - 0.1, s0, lo - 0.03, s1));
      if (arm === ROAD_E) out.push(rect(hi + 0.03, s0, hi + 0.1, s1));
    }
  }
  return out;
}

/**
 * Chodník a zelený pás na stranách dlaždice, kde stojí dům (`sides` je maska
 * stran jako u silnic). Pás je u obrubníku, chodník u domu — tak se u nás
 * stavělo od šedesátých let.
 *
 * Strana, kam vede rameno silnice, chodník nemá: tam je vozovka.
 */
export function sidewalks(mask: number, sides: number, width: number, kerb: number): DetailPolygon[] {
  const out: DetailPolygon[] = [];
  const clear = 0.5 - (width + kerb) / 2;
  // Mezi obrubníkem a chodníkem musí zbýt aspoň kousek na pás.
  if (clear < SIDEWALK + 0.02) return out;
  const verge = Math.min(VERGE, clear - SIDEWALK);
  for (const side of ARMS) {
    if (!(sides & side) || mask & side) continue;
    const s = SIDEWALK;
    const g = s + verge;
    if (side === ROAD_N) {
      out.push({ kind: 'sidewalk', points: rect(0, 0, 1, s) }, { kind: 'verge', points: rect(0, s, 1, g) });
    } else if (side === ROAD_S) {
      out.push({ kind: 'sidewalk', points: rect(0, 1 - s, 1, 1) }, { kind: 'verge', points: rect(0, 1 - g, 1, 1 - s) });
    } else if (side === ROAD_W) {
      out.push({ kind: 'sidewalk', points: rect(0, 0, s, 1) }, { kind: 'verge', points: rect(s, 0, g, 1) });
    } else {
      out.push({ kind: 'sidewalk', points: rect(1 - s, 0, 1, 1) }, { kind: 'verge', points: rect(1 - g, 0, 1 - s, 1) });
    }
  }
  // Tam, kde rameno protíná chodník, se chodník přeruší — jinak by vedl
  // přes vozovku. Ořízne se na obdélníky mimo pás ramene.
  return out.flatMap((polygon) => cutByArms(polygon, mask, width + kerb));
}

/** Rozdělí obdélník chodníku tak, aby nevedl přes rameno silnice. */
function cutByArms(polygon: DetailPolygon, mask: number, road: number): DetailPolygon[] {
  const [a, , c] = polygon.points;
  if (a === undefined || c === undefined) return [polygon];
  const [u0, v0] = a;
  const [u1, v1] = c;
  const lo = 0.5 - road / 2;
  const hi = 0.5 + road / 2;
  const alongU = u1 - u0 > v1 - v0;
  // Rameno napříč pásem: pás podél u (sever/jih) protínají ramena N/S jen
  // tehdy, když pás leží u té hrany — to už vyloučil `sidewalks`. Zbývá, že
  // pás podél u protne rameno W/E? Ne, ta vedou po u. Protínají ho N/S.
  const crossing = alongU ? (v0 < 0.5 ? mask & ROAD_N : mask & ROAD_S) : u0 < 0.5 ? mask & ROAD_W : mask & ROAD_E;
  if (!crossing) return [polygon];
  if (alongU) {
    return [
      { ...polygon, points: rect(u0, v0, lo, v1) },
      { ...polygon, points: rect(hi, v0, u1, v1) },
    ];
  }
  return [
    { ...polygon, points: rect(u0, v0, u1, lo) },
    { ...polygon, points: rect(u0, hi, u1, v1) },
  ];
}

/** Kruh v souřadnicích dlaždice. */
function circle(radius: number, segments = 28): UV[] {
  const out: UV[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    out.push([0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius]);
  }
  return out;
}

/** Vnější poloměr kruhového objezdu a ostrůvku. */
export const ROUNDABOUT_OUTER = 0.44;
export const ROUNDABOUT_ISLAND = 0.19;

/**
 * Kruhový objezd na křižovatce dvou tříd (T122).
 *
 * Autor: „u křížení silnice 2. úrovně by třeba mohl občas být kruháč." Je to
 * jen vzhled — simulace ho nezná, save se nemění. „Občas“ rozhoduje hash
 * souřadnic, takže stejná křižovatka je kruháčem pořád, i po načtení.
 */
export function roundabout(): DetailPolygon[] {
  return [
    { kind: 'roundabout', points: circle(ROUNDABOUT_OUTER) },
    { kind: 'islandKerb', points: circle(ROUNDABOUT_OUTER + 0.035) },
    { kind: 'islandKerb', points: circle(ROUNDABOUT_ISLAND + 0.03) },
    { kind: 'island', points: circle(ROUNDABOUT_ISLAND) },
  ];
}

/** Je na téhle křižovatce kruháč? Jen vzhled, ze souřadnic — ne z `world.rng`. */
export function hasRoundabout(x: number, y: number): boolean {
  const hash = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  return ((hash >>> 0) % 5) < 2;
}

/**
 * Most přes vodu (T122): zábradlí na krajích vozovky, bočnice pod ní
 * na stranách k divákovi, stín na vodě a pilíř pod středem.
 *
 * Autor chtěl, aby most „skutečně vypadal jako most". Na souši leží silnice
 * na zemi; nad vodou ji od hladiny odliší právě tloušťka desky a stín.
 */
export function bridgeParts(mask: number, width: number): DetailPolygon[] {
  const half = width / 2 + 0.04;
  const lo = 0.5 - half;
  const hi = 0.5 + half;
  const out: DetailPolygon[] = [];

  // Stín: deska posunutá po světle (světlo zleva, stín doprava dolů).
  const deck: UV[][] = [rect(lo, lo, hi, hi)];
  if (mask & ROAD_N) deck.push(rect(lo, 0, hi, lo));
  if (mask & ROAD_S) deck.push(rect(lo, hi, hi, 1));
  if (mask & ROAD_W) deck.push(rect(0, lo, lo, hi));
  if (mask & ROAD_E) deck.push(rect(hi, lo, 1, hi));
  for (const piece of deck) {
    out.push({ kind: 'shadow', points: piece.map(([u, v]) => [u + 0.1, v + 0.05] as UV) });
  }

  // Pilíř pod středem.
  out.push({ kind: 'pillar', points: rect(0.44, 0.44, 0.56, 0.56), lift: -10 });

  // Bočnice: pás pod hranou desky na stranách, které vidí kamera (jih
  // a východ). Kreslí se jako plocha svěšená dolů o `lift` px.
  const along = (side: number): UV[][] => {
    const pieces: UV[][] = [];
    if (side === ROAD_S) {
      pieces.push([[lo, hi], [hi, hi]]);
      if (mask & ROAD_W) pieces.push([[0, hi], [lo, hi]]);
      if (mask & ROAD_E) pieces.push([[hi, hi], [1, hi]]);
    } else if (side === ROAD_E) {
      pieces.push([[hi, lo], [hi, hi]]);
      if (mask & ROAD_N) pieces.push([[hi, 0], [hi, lo]]);
      if (mask & ROAD_S) pieces.push([[hi, hi], [hi, 1]]);
    }
    return pieces;
  };
  for (const side of [ROAD_S, ROAD_E]) {
    for (const edge of along(side)) out.push({ kind: 'girder', points: edge, lift: -5 });
  }

  // Zábradlí: na okrajích desky tam, kam nevede rameno, a podél ramen.
  const rail = (points: UV[]): void => {
    out.push({ kind: 'railing', points, lift: 4 });
  };
  // Pro každou stranu: rameno → dvě podélná zábradlí, jinak jedno napříč.
  const sides: [number, UV[], UV[], UV[]][] = [
    [ROAD_N, [[lo, 0], [lo, lo]], [[hi, 0], [hi, lo]], [[lo, lo], [hi, lo]]],
    [ROAD_S, [[lo, hi], [lo, 1]], [[hi, hi], [hi, 1]], [[lo, hi], [hi, hi]]],
    [ROAD_W, [[0, lo], [lo, lo]], [[0, hi], [lo, hi]], [[lo, lo], [lo, hi]]],
    [ROAD_E, [[hi, lo], [1, lo]], [[hi, hi], [1, hi]], [[hi, lo], [hi, hi]]],
  ];
  for (const [side, first, second, across] of sides) {
    if (mask & side) {
      rail(first);
      rail(second);
    } else {
      rail(across);
    }
  }
  return out;
}
