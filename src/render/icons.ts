/**
 * Symboly na střechách budov.
 *
 * Kreslí se **procedurálně z polygonů**, ne ze spritů — obrázky, textury ani
 * atlasy do projektu nepatří (architektura §6).
 *
 * Souřadnice jsou v jednotkovém čtverci 0–1 a renderer je promítne na horní
 * plochu kvádru, takže symbol sedí na budově libovolného půdorysu a sám se
 * naklopí do izometrie.
 *
 * Který symbol budova nese, určuje **obsah** (`graphics.icon`), ne kód — kód zná
 * jen sadu tvarů, ne budovy, které je používají (P5).
 */
export type IconShape = readonly (readonly [number, number])[][];

function circle(centerX: number, centerY: number, radius: number, points = 10): IconShape[0] {
  const shape: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    shape.push([centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius]);
  }
  return shape;
}

/** Kříž — zdravotnictví. */
const CROSS: IconShape = [
  [
    [0.4, 0.12],
    [0.6, 0.12],
    [0.6, 0.88],
    [0.4, 0.88],
  ],
  [
    [0.12, 0.4],
    [0.88, 0.4],
    [0.88, 0.6],
    [0.12, 0.6],
  ],
];

/** Štít — policie. */
const SHIELD: IconShape = [
  [
    [0.5, 0.08],
    [0.86, 0.26],
    [0.86, 0.58],
    [0.5, 0.92],
    [0.14, 0.58],
    [0.14, 0.26],
  ],
];

/** Plamen — hasiči. */
const FLAME: IconShape = [
  [
    [0.5, 0.08],
    [0.84, 0.9],
    [0.16, 0.9],
  ],
];

/** Dvě desky knihy — vzdělání. */
const BOOK: IconShape = [
  [
    [0.12, 0.22],
    [0.46, 0.22],
    [0.46, 0.82],
    [0.12, 0.82],
  ],
  [
    [0.54, 0.22],
    [0.88, 0.22],
    [0.88, 0.82],
    [0.54, 0.82],
  ],
];

/** Koruna stromu na kmeni — parky. */
const TREE: IconShape = [
  circle(0.5, 0.42, 0.3),
  [
    [0.44, 0.62],
    [0.56, 0.62],
    [0.56, 0.92],
    [0.44, 0.92],
  ],
];

/** Popelnice — odpady. */
const BIN: IconShape = [
  [
    [0.2, 0.14],
    [0.8, 0.14],
    [0.8, 0.28],
    [0.2, 0.28],
  ],
  [
    [0.26, 0.34],
    [0.74, 0.34],
    [0.64, 0.9],
    [0.36, 0.9],
  ],
];

/** Blesk — výroba elektřiny. */
const BOLT: IconShape = [
  [
    [0.62, 0.06],
    [0.26, 0.56],
    [0.46, 0.56],
    [0.36, 0.94],
    [0.74, 0.44],
    [0.52, 0.44],
  ],
];

/** Autobus zepředu — MHD. */
const BUS: IconShape = [
  [
    [0.16, 0.14],
    [0.84, 0.14],
    [0.84, 0.74],
    [0.16, 0.74],
  ],
  circle(0.3, 0.86, 0.1),
  circle(0.7, 0.86, 0.1),
];

/** Kapka — vodovod. */
const DROP: IconShape = [
  [
    [0.5, 0.08],
    [0.82, 0.55],
    [0.68, 0.86],
    [0.32, 0.86],
    [0.18, 0.55],
  ],
];

export const ICON_SHAPES: Readonly<Record<string, IconShape>> = {
  cross: CROSS,
  shield: SHIELD,
  flame: FLAME,
  book: BOOK,
  tree: TREE,
  bin: BIN,
  bolt: BOLT,
  bus: BUS,
  drop: DROP,
};

export function iconShape(name: string | undefined): IconShape | undefined {
  return name === undefined ? undefined : ICON_SHAPES[name];
}
