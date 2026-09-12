/**
 * Mřížková data (P4). Jedna typed array na atribut, nikdy pole objektů.
 * Souřadnice jsou výhradně gridové (P3) — izometrie patří do `src/render/`.
 */

/**
 * Výchozí velikost mapy. **Skutečnou velikost nese `world.size`** (§2 fáze 4) —
 * tahle konstanta slouží jen jako výchozí volba v dialogu nové hry a v testech,
 * které na velikosti nezáleží.
 *
 * Do T42 to byla konstanta, se kterou počítal `index()`, `inBounds()` i alokace
 * každé vrstvy. Čím dřív se z ní stal běhový údaj, tím levněji: katastrofy
 * i linky MHD se opírají o souřadnice a přepisovat je podruhé by bylo dražší
 * než refaktor sám.
 */
export const DEFAULT_MAP_SIZE = 128;

/**
 * Velikosti, které hra nabízí. Pořadí je pořadí v dialogu.
 *
 * `COARSE_FACTOR` zůstává 4, takže hrubá mřížka roste s mapou (512 → 128×128).
 */
export const MAP_SIZES = [128, 192, 256, 512] as const;
export type MapSize = (typeof MAP_SIZES)[number];

/**
 * Hodnoty vrstvy `terrain`.
 *
 * Terén je **hratelný údaj, ne dekorace** (§2 zadání fáze 3): les se dá vykácet
 * a do té doby zvedá cenu půdy a pohlcuje znečištění, mokřad se dá zavézt až
 * s terraformingem, na skálu se bez srovnání nestaví.
 */
export const TERRAIN = {
  grass: 0,
  water: 1,
  sand: 2,
  rock: 3,
  forest: 4,
  marsh: 5,
} as const;
export type TerrainType = (typeof TERRAIN)[keyof typeof TERRAIN];

/**
 * Lokalizační klíč jména terénu podle jeho hodnoty.
 *
 * Bydlí tady, protože odmítnutí příkazu musí umět **říct, co je pod tím** —
 * „na tenhle terén se to postavit nedá" je odpověď, ze které hráč nepozná ani
 * co tam je, ani co by tam šlo. Klíče v `sim/` už jsou zvykem: `reject` jimi
 * vrací důvody a služby jimi hlásí své třídy.
 *
 * Jsou to **vlastní klíče `ui.terrain.plain.*`**, ne ty z karty parcely. Karta
 * jméno vypisuje samostatně („Tráva"), hláška ho vkládá doprostřed věty —
 * a čeština si tam žádá jiný tvar. Jedna sada by donutila skládat věty tak,
 * aby vyhovovaly obojímu, a nevyhověla by ani jednomu.
 */
export const TERRAIN_NAME_KEYS: readonly string[] = [
  'ui.terrain.plain.grass',
  'ui.terrain.plain.water',
  'ui.terrain.plain.sand',
  'ui.terrain.plain.rock',
  'ui.terrain.plain.forest',
  'ui.terrain.plain.marsh',
];

/** Jméno terénu pro hlášku. Neznámá hodnota nemá klíč a vrací se prázdno. */
export function terrainNameKey(terrain: number): string {
  return TERRAIN_NAME_KEYS[terrain] ?? '';
}

/**
 * Hodnoty vrstvy `road` (R11 zadání fáze 3).
 *
 * Do fáze 2 nesla vrstva jen 0/1. Typ silnice určuje kapacitu, cenu i údržbu —
 * konkrétní čísla jsou v `balance.traffic.roadTypes`, kód zná jen pořadí.
 */
export const ROAD = { none: 0, street: 1, avenue: 2, highway: 3 } as const;
export type RoadType = (typeof ROAD)[keyof typeof ROAD];

/** Hodnoty vrstvy `zone`. */
export const ZONE = { none: 0, residential: 1, commercial: 2, industrial: 3 } as const;
export type ZoneType = (typeof ZONE)[keyof typeof ZONE];

/**
 * Index dlaždice ve vrstvě. `size` je hrana mapy — bere se z `world.size`.
 *
 * Parametr je **povinný schválně**: s výchozí hodnotou by se dalo zapomenout
 * ho předat a mapa 512×512 by potichu četla po 128 dlaždicích. Takhle na každé
 * zapomenuté místo ukáže překladač.
 */
export function index(x: number, y: number, size: number): number {
  return y * size + x;
}

export function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

/**
 * Hrana mapy odvozená z **délky vrstvy**.
 *
 * Vrstva je čtverec `size × size`, takže se velikost dá spočítat z ní — a
 * nemůže se s daty rozejít. Používá to kód, který dostane jen pole a ne celý
 * svět: generátor mapy, difuze, načítání savu. Stejný trik jako
 * `cornerSideOf()` u mřížky rohů.
 */
export function sizeOfLayer(layer: { readonly length: number }): number {
  return Math.round(Math.sqrt(layer.length));
}

export interface Layers {
  terrain: Uint8Array;
  zone: Uint8Array;
  road: Uint8Array;
  /**
   * Id budovy na dlaždici, 0 = prázdno. **Čtyřbajtová** od verze savu 12.
   *
   * Do té doby byla dvoubajtová. Id se ale po zbourání nevrací (proč, viz
   * `placeBuilding`), takže město, ve kterém za celou dobu vzniklo přes 65 535
   * budov, zapsalo další id do vrstvy jako nulu: budova stála neviditelně na
   * „prázdné" dlaždici a save se už nenačetl. Na mapě 512 × 512 se tolik
   * jednodlaždicových domů navíc vejde i naráz.
   */
  buildingId: Uint32Array;
  power: Uint8Array;
  /**
   * Vodovodní potrubí, 0/1 (§8 fáze 3). Na rozdíl od elektřiny **budovy vodu
   * nevedou** — potrubí musí být pod nimi položené výslovně.
   */
  pipe: Uint8Array;
}

/** Pohled na vrstvy pro renderer a UI — čtení ano, zápis chyba při typecheku. */
export type ReadonlyLayers = { readonly [K in keyof Layers]: Readonly<Layers[K]> };

/**
 * Nejvyšší id, které se do vrstvy `buildingId` vejde. Nula je vyhrazená pro
 * prázdnou dlaždici, takže budovy mají id 1 až tohle číslo včetně.
 */
export const MAX_BUILDING_ID = 0xffffffff;

/**
 * Pevné pořadí vrstev pro `hashLayers`. Explicitní seznam místo `Object.keys()`,
 * protože P2 zakazuje iteraci nad neseřazenými klíči.
 */
export const LAYER_ORDER = [
  'terrain',
  'zone',
  'road',
  'buildingId',
  'power',
  'pipe',
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

export function createLayers(size: number): Layers {
  const cells = size * size;
  return {
    terrain: new Uint8Array(cells), // 0 = tráva
    zone: new Uint8Array(cells), // 0 = bez zóny
    road: new Uint8Array(cells), // 0/1
    buildingId: new Uint32Array(cells), // 0 = prázdná dlaždice
    power: new Uint8Array(cells),
    pipe: new Uint8Array(cells), // 0/1
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
      // Nad dva bajty se hashuje, **jen když tam něco je**. `buildingId` se ve
      // verzi savu 12 rozšířila z Uint16 na Uint32 a simulace se tím nezměnila
      // ani o bit — golden hashe to potvrzují tím, že zůstaly stejné. Kdyby se
      // hashovaly i nulové horní bajty, změnil by se každý z nich a nešlo by
      // poznat, jestli se s rozšířením nerozjelo i něco jiného.
      const bytes = width > 2 && value <= 0xffff ? 2 : width;
      for (let byte = 0; byte < bytes; byte++) {
        hash = hashByte(hash, (value >>> (byte * 8)) & 0xff);
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
