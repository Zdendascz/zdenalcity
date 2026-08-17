/**
 * Mřížková data (P4). Jedna typed array na atribut, nikdy pole objektů.
 * Souřadnice jsou výhradně gridové (P3) — izometrie patří do `src/render/`.
 */

export const MAP_SIZE = 128;

/** Hodnoty vrstvy `terrain`. */
export const TERRAIN = { grass: 0, water: 1, sand: 2, rock: 3 } as const;
export type TerrainType = (typeof TERRAIN)[keyof typeof TERRAIN];

/** Hodnoty vrstvy `zone`. */
export const ZONE = { none: 0, residential: 1, commercial: 2, industrial: 3 } as const;
export type ZoneType = (typeof ZONE)[keyof typeof ZONE];

export function index(x: number, y: number): number {
  return y * MAP_SIZE + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
}

export interface Layers {
  terrain: Uint8Array;
  elevation: Uint8Array;
  zone: Uint8Array;
  road: Uint8Array;
  buildingId: Uint16Array;
  power: Uint8Array;
}

/** Pohled na vrstvy pro renderer a UI — čtení ano, zápis chyba při typecheku. */
export type ReadonlyLayers = { readonly [K in keyof Layers]: Readonly<Layers[K]> };

/**
 * Pevné pořadí vrstev pro `hashLayers`. Explicitní seznam místo `Object.keys()`,
 * protože P2 zakazuje iteraci nad neseřazenými klíči.
 */
export const LAYER_ORDER = [
  'terrain',
  'elevation',
  'zone',
  'road',
  'buildingId',
  'power',
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

export function createLayers(size: number): Layers {
  const cells = size * size;
  return {
    terrain: new Uint8Array(cells), // 0 = tráva
    elevation: new Uint8Array(cells), // fáze 1: všude 0
    zone: new Uint8Array(cells), // 0 = bez zóny
    road: new Uint8Array(cells), // 0/1
    buildingId: new Uint16Array(cells), // 0 = prázdná dlaždice
    power: new Uint8Array(cells), // 0/1
  };
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME);
}

/**
 * FNV-1a přes všechny vrstvy. Základ golden a determinismus testů, takže musí být
 * deterministický a rychlý.
 *
 * Do hashe vstupuje i jméno vrstvy — přejmenování nebo přeházení pořadí vrstev
 * tím pádem hash změní, což je při ladění simulace žádoucí signál.
 *
 * Bajty se rozkládají ručně podle `BYTES_PER_ELEMENT`, ne přes pohled na buffer —
 * jinak by výsledek závisel na endianitě stroje.
 */
export function hashLayers(layers: ReadonlyLayers): string {
  let hash = FNV_OFFSET_BASIS;
  for (const name of LAYER_ORDER) {
    for (let i = 0; i < name.length; i++) {
      hash = hashByte(hash, name.charCodeAt(i));
    }
    const layer = layers[name];
    const width = layer.BYTES_PER_ELEMENT;
    for (const value of layer) {
      for (let byte = 0; byte < width; byte++) {
        hash = hashByte(hash, (value >>> (byte * 8)) & 0xff);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
