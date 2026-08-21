/**
 * Centrální definice barev. Žádná barva se nesmí objevit natvrdo jinde v kódu —
 * jinak nepůjde měnit vzhled bez lovení konstant po celém rendereru.
 */

/**
 * Index = hodnota vrstvy `terrain`: tráva, voda, písek, skála, les, mokřad.
 * Les je tmavší a sytější než tráva, mokřad kalný — musí být na první pohled
 * poznat, kde se dá stavět a kde ne.
 */
export const TERRAIN_COLORS = [
  0x6b9b4a, 0x3a6ea5, 0xd6c48a, 0x8a8a8a, 0x3f6b34, 0x6d7a55,
] as const;

export const ZONE_COLORS = {
  residential: 0x4a90d9,
  commercial: 0x4ac97e,
  industrial: 0xd9c34a,
} as const;

/** Index = hodnota vrstvy `zone`; 0 = bez zóny, proto se nekreslí. */
export const ZONE_COLOR_BY_VALUE = [
  0,
  ZONE_COLORS.residential,
  ZONE_COLORS.commercial,
  ZONE_COLORS.industrial,
] as const;

export const ZONE_OVERLAY_ALPHA = 0.4;

/**
 * Overlay znečištění. Jedna barva, sílu nese průhlednost — ramp přes několik
 * barev by se pletl se zónami, které jsou taky barevné.
 */
export const POLLUTION_COLOR = 0x8c4a7a;
export const POLLUTION_MAX_ALPHA = 0.8;

/** Overlay ceny půdy. Zlatá se nepere se zónami ani s vozovkou. */
export const LAND_VALUE_COLOR = 0xf0c060;
export const LAND_VALUE_MAX_ALPHA = 0.75;

/** Overlay kriminality. */
export const CRIME_COLOR = 0xd94f4f;
export const CRIME_MAX_ALPHA = 0.8;

/**
 * Nespokojenost. Overlay maluje **problém, ne pochvalu** — stejně jako
 * znečištění a kriminalita. Spokojená čtvrť zůstane čistá, aby bylo vidět,
 * kde se to kazí.
 */
export const HAPPINESS_COLOR = 0xd98f3f;
export const HAPPINESS_MAX_ALPHA = 0.75;

/**
 * Od jaké spokojenosti overlay přestane malovat úplně.
 *
 * Není to 255: takovou hodnotu nemá ani vzorná čtvrť, takže by mapa byla
 * pořád celá oranžová a rozdíly by se v tom ztratily. Dvoustovka odpovídá
 * čtvrti, se kterou opravdu není co řešit — a rozdíl mezi 130 a 76, tedy mezi
 * „ujde to“ a „zle“, zabere většinu stupnice.
 */
export const HAPPINESS_CLEAN_AT = 200;

/**
 * Spokojenost → síla, kterou ji overlay maluje.
 *
 * Vlastní funkce, ne dva řádky v `app.ts`: první verze škálovala od 128 a
 * mapa vyšla skoro prázdná, protože reálné hodnoty se drží kolem stovky.
 * Vyšlo to najevo až měřením pixelů ve hře — s funkcí to chytne test.
 */
export function unhappinessValue(happiness: number): number {
  const above = HAPPINESS_CLEAN_AT - happiness;
  if (above <= 0) return 0;
  return Math.min(255, Math.round(above * (255 / HAPPINESS_CLEAN_AT)));
}

/**
 * Overlay dopravy: od volné zelené po ucpanou červenou. Škála má stupně, ne
 * plynulý přechod — hráč potřebuje poznat „tady už je zle", ne odhadovat odstín.
 */
export const TRAFFIC_COLORS = [0x4caf50, 0xa8c93a, 0xe0c33a, 0xe08b3a, 0xd9483a] as const;
export const TRAFFIC_MAX_ALPHA = 0.85;

/** Overlay pokrytí službami. */
export const COVERAGE_COLOR = 0x5fb6d9;
export const COVERAGE_MAX_ALPHA = 0.7;

/** Overlay elektřiny (klávesa P): vodič s proudem a vodič bez proudu. */
export const POWER_ON_COLOR = 0xf2d857;
export const POWER_OFF_COLOR = 0xd9483a;
export const POWER_OVERLAY_ALPHA = 0.55;

/** Stěny kvádru budovy: horní plocha 100 %, levá 70 %, pravá 50 % jasu (§6). */
export const WALL_LEFT_SHADE = 0.7;
export const WALL_RIGHT_SHADE = 0.5;

/** Vozovka. */
export const ROAD_COLORS = [0x000000, 0x44454d, 0x53555f, 0x646773] as const;

/** Šířka vozovky podle typu; podíl dlaždice, index = hodnota vrstvy `road`. */
export const ROAD_WIDTHS = [0, 0.5, 0.68, 0.86] as const;

/** Barva ulice. Starší kód a testy se odkazují na ni. */
export const ROAD_COLOR = ROAD_COLORS[1];

/**
 * Most je světlejší než vozovka na souši — na tmavé vodě by splynul, a hráč
 * musí poznat, kde silnice opouští břeh (§7 fáze 3).
 */
export const BRIDGE_COLOR = 0x8d8f99;

/**
 * Podzemní pohled (§8 fáze 3). Terén se ztlumí na desetinu jasu, aby se
 * potrubí nemuselo prát s barvami trávy a vody — pod zemí je stejně tma.
 */
/**
 * Podezdívka pod budovou na svahu. Kámen, ne barva domu — je to terénní úprava
 * a hráč má poznat, že dům nepovyrostl, jen se podezdil.
 */
export const FOUNDATION_COLOR = 0x8a8378;

export const UNDERGROUND_TERRAIN_SHADE = 0.35;

/**
 * Obrysy povrchu v podzemním pohledu.
 *
 * Bez nich byla pod zemí jen tmavá plocha a hráč neměl podle čeho vést
 * potrubí — nepoznal, kde má silnici, kde zónu a kde dům. Jsou schválně
 * **matné**: mají sloužit k orientaci, ne přebít trubky, kvůli kterým se
 * pod zem přepíná.
 */
export const UNDERGROUND_ROAD_COLOR = 0x000000;
export const UNDERGROUND_ROAD_ALPHA = 0.35;
export const UNDERGROUND_BUILDING_COLOR = 0xd8d8dc;
export const UNDERGROUND_BUILDING_ALPHA = 0.22;
export const UNDERGROUND_ZONE_ALPHA = 0.18;
/** Potrubí. Modrá jako voda, ale světlejší, ať je vidět na tmavém terénu. */
export const PIPE_COLOR = 0x67b6e8;
/** Šířka trubky jako podíl dlaždice. Užší než vozovka — je to trubka. */
export const PIPE_WIDTH = 0.24;
/** Nádech na dlaždicích, kam voda opravdu dotekla. */
export const WATER_SUPPLY_COLOR = 0x2f7fb8;
export const WATER_SUPPLY_ALPHA = 0.4;
/** Mantinel mostu. Kreslí se přes celou dlaždici, ať je konstrukce vidět. */
export const BRIDGE_RAIL_COLOR = 0xb4b7c2;

/** Pozadí mimo mapu. */
export const BACKGROUND_COLOR = 0x14161a;

/** Zvýraznění dlaždic pod kurzorem — u větších budov celý půdorys. */
export const HOVER_COLOR = 0xffffff;
export const HOVER_FILL_ALPHA = 0.18;
export const HOVER_LINE_ALPHA = 0.9;

/** Půdorys, kam se stavba nevejde. */
export const HOVER_BLOCKED_COLOR = 0xff6b52;

/**
 * Opuštěná budova. Šedý kvádr snížený na jednu úroveň (§8 zadání fáze 2) —
 * ruinu musí být poznat na první pohled, ne až z detailu.
 */
export const ABANDONED_COLOR = 0x6a6a6a;

/**
 * Ztmavení budovy, která bere proud a nedostává ho. Ke střeše k tomu přibude
 * blesk v `POWER_OFF_COLOR` — jinak hráč pozná temnou budovu jen z detailu.
 */
export const UNPOWERED_SHADE = 0.5;

/** Symbol na střeše budovy. Světlé budovy dostanou tmavý, ostatní tenhle. */
export const ICON_COLOR = 0xffffff;
export const ICON_ALPHA = 0.9;

/**
 * Vnímaný jas barvy v rozsahu 0–1. Používá se k rozhodnutí, jestli na budovu
 * patří světlý, nebo tmavý symbol — jinak by na bílé klinice zmizel.
 */
export function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Násobitel pro hranu dlaždice — jemné odsazení sousedních diamantů. */
export const TILE_EDGE_SHADE = 0.82;

/**
 * Vynásobí složky barvy faktorem. `factor < 1` ztmavuje, `> 1` zesvětluje.
 * Slouží i pro stěny kvádrů budov (100 / 70 / 50 % jasu) od T5.
 */
export function shade(color: number, factor: number): number {
  const r = clampChannel(((color >> 16) & 0xff) * factor);
  const g = clampChannel(((color >> 8) & 0xff) * factor);
  const b = clampChannel((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
