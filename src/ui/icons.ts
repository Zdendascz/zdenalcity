import { ICON_SHAPES } from '@/render/icons';
import type { IconShape } from '@/render/icons';

/**
 * Ikony v uživatelském rozhraní.
 *
 * Kreslí se **ze stejných polygonů jako symboly na střechách** — jedna sada
 * tvarů pro celou hru. Tlačítko muzea tak nese přesně ten znak, který hráč
 * uvidí na střeše, jakmile ho postaví, a nikdo je nemůže rozladit.
 *
 * Tady se k nim přidávají tvary, které žádnou střechu nemají: nástroje,
 * pohledy a přepínače panelů. Obojí je jen seznam bodů v jednotkovém čtverci,
 * takže obrázky, fonty ani knihovna ikon do projektu nepřibývají
 * (architektura §6).
 */
type Shape = IconShape;

function circle(cx: number, cy: number, radius: number, points = 10): Shape[0] {
  const shape: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    shape.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return shape;
}

function bar(x0: number, y0: number, x1: number, y1: number): Shape[0] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Šipka vzhůru na podstavci — zvednout terén. */
const ARROW_UP: Shape = [
  [
    [0.5, 0.1],
    [0.84, 0.5],
    [0.16, 0.5],
  ],
  bar(0.36, 0.5, 0.64, 0.76),
  bar(0.12, 0.82, 0.88, 0.92),
];

/** Šipka dolů na podstavci — snížit terén. */
const ARROW_DOWN: Shape = [
  bar(0.36, 0.08, 0.64, 0.34),
  [
    [0.16, 0.34],
    [0.84, 0.34],
    [0.5, 0.74],
  ],
  bar(0.12, 0.82, 0.88, 0.92),
];

/** Zeď z kvádrů dorovnaná k horní úrovni — dozdít svah. */
const FILL: Shape = [
  bar(0.08, 0.26, 0.92, 0.36),
  bar(0.1, 0.42, 0.46, 0.56),
  bar(0.54, 0.42, 0.9, 0.56),
  bar(0.1, 0.62, 0.28, 0.76),
  bar(0.36, 0.62, 0.64, 0.76),
  bar(0.72, 0.62, 0.9, 0.76),
];

/** Rovina mezi dvěma značkami — srovnat terén. */
const LEVEL: Shape = [bar(0.1, 0.44, 0.9, 0.56), bar(0.16, 0.2, 0.28, 0.44), bar(0.72, 0.56, 0.84, 0.8)];

/** Radlice buldozeru. */
const BULLDOZE: Shape = [
  bar(0.14, 0.2, 0.32, 0.8),
  [
    [0.32, 0.3],
    [0.86, 0.44],
    [0.86, 0.58],
    [0.32, 0.72],
  ],
];

/**
 * Vozovka s přerušovanou čárou — ulice. Třída a dálnice přidávají pruhy, takže
 * je v liště poznat i podle šířky, ne jen podle popisku.
 */
function road(lanes: number): Shape {
  const shape: Shape[0][] = [bar(0.08, 0.3, 0.92, 0.7)];
  for (let i = 1; i <= lanes; i++) {
    const y = 0.3 + (0.4 / (lanes + 1)) * i;
    for (const x of [0.16, 0.44, 0.72]) shape.push(bar(x, y - 0.025, x + 0.16, y + 0.025));
  }
  return shape;
}

/** Kouř nad komínem — znečištění. */
const SMOKE: Shape = [
  bar(0.2, 0.62, 0.44, 0.94),
  circle(0.58, 0.34, 0.2),
  circle(0.82, 0.44, 0.14),
  circle(0.42, 0.24, 0.14),
];

/** Zóna: rámeček s výplní. Odlišuje ji barva tlačítka, ne tvar. */
const ZONE: Shape = [
  [
    [0.5, 0.12],
    [0.9, 0.5],
    [0.5, 0.88],
    [0.1, 0.5],
  ],
];

/** Oko — pohled na povrch. */
const EYE: Shape = [
  [
    [0.06, 0.5],
    [0.3, 0.24],
    [0.7, 0.24],
    [0.94, 0.5],
    [0.7, 0.76],
    [0.3, 0.76],
  ],
];

/** Trubka s přírubami — potrubí. */
const PIPE: Shape = [
  bar(0.06, 0.4, 0.94, 0.6),
  bar(0.2, 0.28, 0.32, 0.72),
  bar(0.68, 0.28, 0.8, 0.72),
];

/** Trubka pod povrchem — podzemní pohled. */
const UNDERGROUND: Shape = [bar(0.08, 0.2, 0.92, 0.3), bar(0.08, 0.52, 0.42, 0.64), bar(0.58, 0.52, 0.92, 0.64), bar(0.42, 0.52, 0.58, 0.9)];

/** Tři listy nad sebou — diagnostické vrstvy. */
const LAYERS: Shape = [
  [
    [0.5, 0.08],
    [0.94, 0.32],
    [0.5, 0.56],
    [0.06, 0.32],
  ],
  [
    [0.5, 0.62],
    [0.8, 0.46],
    [0.94, 0.54],
    [0.5, 0.78],
    [0.06, 0.54],
    [0.2, 0.46],
  ],
  [
    [0.5, 0.84],
    [0.8, 0.68],
    [0.94, 0.76],
    [0.5, 0.94],
    [0.06, 0.76],
    [0.2, 0.68],
  ],
];

/** Mince — daně. */
const COINS: Shape = [
  [
    [0.5, 0.1],
    [0.86, 0.26],
    [0.5, 0.42],
    [0.14, 0.26],
  ],
  [
    [0.14, 0.36],
    [0.5, 0.52],
    [0.86, 0.36],
    [0.86, 0.5],
    [0.5, 0.66],
    [0.14, 0.5],
  ],
  [
    [0.14, 0.6],
    [0.5, 0.76],
    [0.86, 0.6],
    [0.86, 0.74],
    [0.5, 0.9],
    [0.14, 0.74],
  ],
];

/** Dva posuvníky — financování služeb. */
const SLIDERS: Shape = [
  bar(0.08, 0.28, 0.92, 0.36),
  bar(0.28, 0.18, 0.4, 0.46),
  bar(0.08, 0.64, 0.92, 0.72),
  bar(0.6, 0.54, 0.72, 0.82),
];

/** Disketa — uložení. */
const SAVE: Shape = [
  [
    [0.12, 0.12],
    [0.76, 0.12],
    [0.88, 0.24],
    [0.88, 0.88],
    [0.12, 0.88],
  ],
  bar(0.3, 0.12, 0.62, 0.38),
  bar(0.26, 0.56, 0.74, 0.88),
];

/** Sloupcový graf — rozpočet. */
const CHART: Shape = [bar(0.12, 0.56, 0.32, 0.9), bar(0.4, 0.32, 0.6, 0.9), bar(0.68, 0.12, 0.88, 0.9)];

/** Zeměkoule s poledníkem — jazyk. */
const GLOBE: Shape = [
  [
    [0.5, 0.06],
    [0.72, 0.2],
    [0.8, 0.5],
    [0.72, 0.8],
    [0.5, 0.94],
    [0.28, 0.8],
    [0.2, 0.5],
    [0.28, 0.2],
  ],
  bar(0.06, 0.44, 0.94, 0.56),
];

/** Ozubené kolo bez zubů uprostřed — nastavení, když nic lepšího nesedí. */
const GEAR: Shape = [
  [
    [0.42, 0.06],
    [0.58, 0.06],
    [0.62, 0.24],
    [0.78, 0.32],
    [0.94, 0.24],
    [0.94, 0.42],
    [0.78, 0.5],
    [0.94, 0.58],
    [0.94, 0.76],
    [0.78, 0.68],
    [0.62, 0.76],
    [0.58, 0.94],
    [0.42, 0.94],
    [0.38, 0.76],
    [0.22, 0.68],
    [0.06, 0.76],
    [0.06, 0.58],
    [0.22, 0.5],
    [0.06, 0.42],
    [0.06, 0.24],
    [0.22, 0.32],
    [0.38, 0.24],
  ],
];

/**
 * Tvary jen pro rozhraní. Střešní symboly se sem nekopírují — `iconShape` sáhne
 * do sady rendereru, když tady jméno nenajde.
 */
const UI_SHAPES: Readonly<Record<string, Shape>> = {
  raise: ARROW_UP,
  lower: ARROW_DOWN,
  level: LEVEL,
  fill: FILL,
  bulldoze: BULLDOZE,
  street: road(0),
  avenue: road(1),
  highway: road(2),
  zone: ZONE,
  pipe: PIPE,
  smoke: SMOKE,
  surface: EYE,
  underground: UNDERGROUND,
  layers: LAYERS,
  coins: COINS,
  sliders: SLIDERS,
  save: SAVE,
  chart: CHART,
  globe: GLOBE,
  gear: GEAR,
};

export function uiIconShape(name: string): Shape | undefined {
  return UI_SHAPES[name] ?? ICON_SHAPES[name];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Ikona jako `<svg>`.
 *
 * Neznámé jméno vrátí **prázdnou ikonu**, ne výjimku: tlačítko si zaslouží
 * existovat i s chybějícím tvarem. Že žádné jméno nechybí, hlídá test —
 * potichu to tedy neprojde, jen to neshodí hru hráči pod rukama.
 */
export function iconSvg(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('aria-hidden', 'true');

  for (const polygon of uiIconShape(name) ?? []) {
    const node = document.createElementNS(SVG_NS, 'polygon');
    node.setAttribute('points', polygon.map(([x, y]) => `${x},${y}`).join(' '));
    svg.appendChild(node);
  }

  return svg;
}
