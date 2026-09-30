import { ICON_SHAPES } from '@/render/icons';
import type { IconShape } from '@/render/icons';
import { button, el } from './dom';

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

/** Dům jen z obrysu — průhledné budovy. */
const GHOST: Shape = [
  bar(0.12, 0.36, 0.88, 0.44),
  bar(0.12, 0.44, 0.2, 0.9),
  bar(0.8, 0.44, 0.88, 0.9),
  bar(0.12, 0.82, 0.88, 0.9),
  [
    [0.5, 0.1],
    [0.94, 0.36],
    [0.06, 0.36],
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
/**
 * Katastrofa: plamen. Jeden tvar pro celou nabídku — patnáct vlastních ikon
 * by z roletky udělalo hádanku a hráč stejně čte popisky.
 */
const DISASTER: Shape = [
  [
    [0.5, 0.06],
    [0.66, 0.3],
    [0.6, 0.44],
    [0.78, 0.4],
    [0.86, 0.62],
    [0.7, 0.9],
    [0.3, 0.9],
    [0.14, 0.62],
    [0.3, 0.3],
    [0.38, 0.5],
  ],
];

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

/** Lupa se stopkou. `sign` kreslí uvnitř plus, minus, nebo nic. */
function magnifier(sign: 1 | -1): Shape {
  const shape: Shape[0][] = [
    // Obruba jako mezikruží: vnější obvod tam, vnitřní zpátky.
    ring(0.42, 0.42, 0.26, 0.34),
    // Stopka od pravého dolního okraje ven.
    [
      [0.56, 0.66],
      [0.68, 0.54],
      [0.94, 0.8],
      [0.82, 0.92],
    ],
    bar(0.26, 0.38, 0.58, 0.46),
  ];
  if (sign === 1) shape.push(bar(0.38, 0.26, 0.46, 0.58));
  return shape;
}

/** Mezikruží jako jeden polygon: ven po vnějším obvodu, zpátky po vnitřním. */
function ring(cx: number, cy: number, inner: number, outer: number, points = 16): Shape[0] {
  const shape: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    shape.push([cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer]);
  }
  for (let i = points; i >= 0; i--) {
    const angle = (i / points) * Math.PI * 2;
    shape.push([cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner]);
  }
  return shape;
}

/**
 * Čtvercová síť — přepínač hranic dlaždic.
 *
 * Rovná mřížka, ne izometrická. Na osmnácti pixelech je kosočtverec k nerozeznání
 * od diamantu zóny; křížení svislých a vodorovných čar pozná každý.
 */
const GRID: Shape = (() => {
  const lines = [0.1, 0.36, 0.62, 0.88];
  const shape: Shape[0][] = [];
  for (const at of lines) {
    shape.push(bar(at - 0.035, 0.065, at + 0.035, 0.935));
    shape.push(bar(0.065, at - 0.035, 0.935, at + 0.035));
  }
  return shape;
})();

/** Tři tečky — „a další". Přepínač schované části lišty. */
const MORE: Shape = [circle(0.2, 0.5, 0.1), circle(0.5, 0.5, 0.1), circle(0.8, 0.5, 0.1)];

/**
 * Kruhová šipka — načíst novou verzi hry.
 *
 * Skoro celý kruh a hrot na konci. Mezera nahoře je schválně: uzavřený kruh
 * by na osmnácti pixelech vypadal jako kolečko, ne jako „znovu".
 */
const RELOAD: Shape = [
  arc(0.5, 0.54, 0.24, 0.34, -0.35, 1.35),
  [
    [0.46, 0.06],
    [0.86, 0.24],
    [0.5, 0.42],
  ],
];

/** Výseč mezikruží. Úhly jsou v otáčkách, ne v radiánech — čte se to líp. */
function arc(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number,
  points = 20,
): Shape[0] {
  const shape: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (from + ((to - from) * i) / points) * Math.PI * 2;
    shape.push([cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer]);
  }
  for (let i = points; i >= 0; i--) {
    const angle = (from + ((to - from) * i) / points) * Math.PI * 2;
    shape.push([cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner]);
  }
  return shape;
}

/**
 * Rychlost jako řada hrotů. Obsah k stupňům 1–4 dodává obrázky, tohle je
 * záloha pro ty ostatní — osmičku nikdo nenakreslil a prázdné tlačítko by
 * hráči neřeklo, co mačká.
 */
function chevrons(count: number): Shape {
  const width = 0.86 / count;
  const shape: Shape[0][] = [];
  for (let i = 0; i < count; i++) {
    const x = 0.07 + width * i;
    shape.push([
      [x, 0.16],
      [x + width * 0.88, 0.5],
      [x, 0.84],
    ]);
  }
  return shape;
}

/**
 * Tvary jen pro rozhraní. Střešní symboly se sem nekopírují — `iconShape` sáhne
 * do sady rendereru, když tady jméno nenajde.
 */
/**
 * Dlaň se vztyčeným palcem — posun po mapě a výběr v jednom.
 *
 * Kreslí se z polygonů jako ostatní nástroje, takže do projektu nepřibývá
 * obrázek. Až někdo nakreslí `content/vanilla/icons/hand.png`, hra si vezme
 * ten — `iconSvg` dává přednost obsahu a na tvary padá jen jako záloha.
 */
const HAND: Shape = [
  // Dlaň.
  [
    [0.32, 0.44],
    [0.68, 0.44],
    [0.72, 0.78],
    [0.5, 0.92],
    [0.28, 0.78],
  ],
  // Tři prsty vedle sebe.
  bar(0.36, 0.2, 0.44, 0.46),
  bar(0.46, 0.14, 0.54, 0.46),
  bar(0.56, 0.2, 0.64, 0.46),
  // Palec ven doleva.
  [
    [0.32, 0.46],
    [0.32, 0.62],
    [0.18, 0.56],
    [0.2, 0.44],
  ],
];

/**
 * Strom — přepínač terénních objektů.
 *
 * Kreslí se z polygonů jako ostatní nástroje, takže do projektu nepřibývá
 * obrázek. Až někdo nakreslí `content/vanilla/icons/view-decor.png`, hra si
 * vezme ten.
 */
const TREE_TOGGLE: Shape = [
  // Koruna ve třech patrech.
  [
    [0.5, 0.08],
    [0.76, 0.4],
    [0.24, 0.4],
  ],
  [
    [0.5, 0.26],
    [0.84, 0.62],
    [0.16, 0.62],
  ],
  // Kmen.
  bar(0.43, 0.62, 0.57, 0.86),
  // Země pod ním.
  bar(0.18, 0.86, 0.82, 0.92),
];

/**
 * Obláček s čarami za sebou — přepínač animací (T114). Čáry říkají „pohyb",
 * obláček je prach a kouř, které animace přidávají.
 */
const MOTION: Shape = [
  circle(0.64, 0.5, 0.24, 12),
  bar(0.08, 0.3, 0.36, 0.38),
  bar(0.02, 0.46, 0.34, 0.54),
  bar(0.08, 0.62, 0.36, 0.7),
];

const UI_SHAPES: Readonly<Record<string, Shape>> = {
  hand: HAND,
  'view-decor': TREE_TOGGLE,
  'view-motion': MOTION,
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
  ghost: GHOST,
  underground: UNDERGROUND,
  layers: LAYERS,
  disaster: DISASTER,
  coins: COINS,
  sliders: SLIDERS,
  save: SAVE,
  chart: CHART,
  globe: GLOBE,
  gear: GEAR,
  'view-grid': GRID,
  'zoom-in': magnifier(1),
  'zoom-out': magnifier(-1),
  // Terč: „vrať kameru nad město". Kruh a čtyři rysky se čtou i na 24 bodech.
  'focus-city': [
    ring(0.5, 0.5, 0.2, 0.3),
    bar(0.46, 0.06, 0.54, 0.2),
    bar(0.46, 0.8, 0.54, 0.94),
    bar(0.06, 0.46, 0.2, 0.54),
    bar(0.8, 0.46, 0.94, 0.54),
  ],
  more: MORE,
  reload: RELOAD,
  'speed-pause': [bar(0.24, 0.12, 0.44, 0.88), bar(0.56, 0.12, 0.76, 0.88)],
  'speed-1': chevrons(1),
  'speed-2': chevrons(2),
  'speed-4': chevrons(3),
  'speed-8': chevrons(4),
};

export function uiIconShape(name: string): Shape | undefined {
  return UI_SHAPES[name] ?? ICON_SHAPES[name];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Obrázky ikon z obsahu. Naplní se jednou při startu, viz `setIconImages`.
 *
 * Drží se v modulu, a ne v parametrech: `iconSvg` volají tři různá místa, která
 * by jinak musela protahovat registr obsahu skrz Popover, Menu i Toolbar jen
 * proto, aby se dostal až sem.
 */
let images: Readonly<Record<string, string>> = {};

/**
 * Předá rozhraní obrázky ikon z obsahu. Volá se jednou po načtení obsahu.
 *
 * Bez nich hra funguje dál — kreslí polygony jako předtím. Obrázek je vylepšení
 * vzhledu, ne podmínka běhu, a mod, který žádný nedodá, nesmí hru zastavit.
 */
export function setIconImages(urls: Readonly<Record<string, string>>): void {
  images = urls;
}

/**
 * Ikona jako `<img>`, když ji obsah dodal, jinak jako `<svg>` z polygonů.
 *
 * Neznámé jméno vrátí **prázdnou ikonu**, ne výjimku: tlačítko si zaslouží
 * existovat i s chybějícím tvarem. Že žádné jméno nechybí, hlídá test —
 * potichu to tedy neprojde, jen to neshodí hru hráči pod rukama.
 */
export function iconSvg(name: string): Element {
  const url = images[name];
  if (url !== undefined) {
    const node = document.createElement('img');
    node.className = 'icon icon--image';
    node.src = url;
    node.alt = '';
    // Ikona popisuje tlačítko, které svůj popisek už má — dvakrát ho číst
    // odečítačce nemá cenu.
    node.setAttribute('aria-hidden', 'true');
    node.draggable = false;
    return node;
  }

  return polygonIcon(name);
}

/** Ikona kreslená z polygonů. Záloha pro jména, ke kterým obsah obrázek nemá. */
export function polygonIcon(name: string): SVGSVGElement {
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

/**
 * Záhlaví panelu: nadpis vlevo, křížek vpravo.
 *
 * Bylo to sedmkrát opsané a **pokaždé bez popisku** (T-revize, nález 22).
 * Ikona je pro odečítačku schválně skrytá, takže tlačítko nemělo přístupné
 * jméno vůbec: odečítačka ohlásila „tlačítko" a nic víc — a je to jediné
 * tlačítko v záhlaví, takže hráč neměl jak zjistit, že tudy vede cesta ven.
 * Jedna funkce navíc znamená, že se sedm míst už nemůže rozejít.
 *
 * `heading` je `h2` všude kromě modálních oken, kde je nadpis dokumentu.
 */
export function sheetHeader(
  title: string,
  closeLabel: string,
  onClose: () => void,
  options: { heading?: 'h1' | 'h2'; titleClass?: string } = {},
): HTMLElement {
  const header = el('div', 'sheet__header');
  header.appendChild(el(options.heading ?? 'h2', options.titleClass ?? 'sheet__title', title));

  const close = button('chip chip--tight', onClose);
  close.appendChild(iconSvg('close'));
  close.title = closeLabel;
  close.setAttribute('aria-label', closeLabel);
  header.appendChild(close);
  return header;
}
