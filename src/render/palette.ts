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
