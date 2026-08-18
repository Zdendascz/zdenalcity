/**
 * Centrální definice barev. Žádná barva se nesmí objevit natvrdo jinde v kódu —
 * jinak nepůjde měnit vzhled bez lovení konstant po celém rendereru.
 */

/** Index = hodnota vrstvy `terrain` (0 tráva, 1 voda, 2 písek, 3 skála). */
export const TERRAIN_COLORS = [0x6b9b4a, 0x3a6ea5, 0xd6c48a, 0x8a8a8a] as const;

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

/** Overlay elektřiny (klávesa P): vodič s proudem a vodič bez proudu. */
export const POWER_ON_COLOR = 0xf2d857;
export const POWER_OFF_COLOR = 0xd9483a;
export const POWER_OVERLAY_ALPHA = 0.55;

/** Stěny kvádru budovy: horní plocha 100 %, levá 70 %, pravá 50 % jasu (§6). */
export const WALL_LEFT_SHADE = 0.7;
export const WALL_RIGHT_SHADE = 0.5;

/** Vozovka. */
export const ROAD_COLOR = 0x44454d;

/** Pozadí mimo mapu. */
export const BACKGROUND_COLOR = 0x14161a;

/** Zvýraznění dlaždice pod kurzorem. */
export const HOVER_COLOR = 0xffffff;
export const HOVER_FILL_ALPHA = 0.18;
export const HOVER_LINE_ALPHA = 0.9;

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
