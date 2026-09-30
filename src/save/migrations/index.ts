import {
  CURRENT_FORMAT_VERSION,
  SAVE_COARSE_LAYER_ORDER,
  SaveMigrationError,
} from '../format';
import type { SaveData } from '../format';

/**
 * Hrana mapy, kterou znaly verze 1–5.
 *
 * Do T42 byla velikost pevná a každý starý save je přesně takhle velký. Číslo
 * je tu natvrdo ze stejného důvodu jako pořadí vrstev v `dropElevationLayer`:
 * **migrace popisuje minulost, ne současnost.** Kdyby četla dnešní
 * `DEFAULT_MAP_SIZE`, změnila by se, jakmile se výchozí velikost pohne — a
 * dvacet let staré savy by se přestaly dát načíst.
 */
const LEGACY_MAP_SIZE = 128;
const LEGACY_COARSE_SIZE = LEGACY_MAP_SIZE / 4;
const LEGACY_COARSE_CELLS = LEGACY_COARSE_SIZE * LEGACY_COARSE_SIZE;
const LEGACY_CORNER_CELLS = (LEGACY_MAP_SIZE + 1) * (LEGACY_MAP_SIZE + 1);

/**
 * Migrace savů.
 *
 * Každá je **čistá funkce** `vN → vN+1` (P7). Na rozdíl od databázových migrací
 * tu nejde nic rollbacknout — soubory jsou u hráčů, takže jediná cesta je
 * dopředu a ke každé vydané verzi patří fixtura v `tests/fixtures/saves/`.
 */
export type Migration = (save: SaveData) => SaveData;

/**
 * Verze 1 → 2 (§11 zadání fáze 2).
 *
 * Verze 2 přidala hrubé vrstvy, dvě pole entity a financování tříd. Starý save
 * o nich neví, takže:
 * - hrubé vrstvy se **vynulují** a systémy si je do pár tiků dopočítají,
 * - `abandoned = false` a `levelChangedAtTick = 0` — ve verzi 1 žádné ruiny
 *   nebyly a cooldown úrovní začne běžet od načtení,
 * - financování všech tříd 100 %, což je prázdná mapa (rozhodnutí autora —
 *   žádné ostré savy verze 1 neexistují),
 * - `meta.grid` se doplní podle rozměrů, se kterými verze 1 mlčky počítala.
 *
 * Po načtení se ještě jednou vynutí přepočet pokrytí, aby město nezačínalo
 * s nulovou cenou půdy; dělá to `applySaveToWorld` pro každý save.
 */
const migrateV1ToV2: Migration = (save) => ({
  ...save,
  meta: {
    ...save.meta,
    formatVersion: 2,
    grid: { size: LEGACY_MAP_SIZE, coarseSize: LEGACY_COARSE_SIZE },
  },
  coarse: new Uint8Array(LEGACY_COARSE_CELLS * SAVE_COARSE_LAYER_ORDER.length),
  entities: {
    ...save.entities,
    buildings: save.entities.buildings.map((building) => ({
      ...building,
      abandoned: false,
      levelChangedAtTick: 0,
    })),
  },
  state: { ...save.state, serviceFunding: {} },
});

/**
 * Verze 2 → 3 (§10 zadání fáze 3).
 *
 * Verze 3 přinesla typované silnice, nové terény, původ mapy a kurzor
 * vzorkování dopravy. Bajty vrstev se **nepřepisují ani jednou**, a je to tak
 * schválně:
 * - **silnice**: `ROAD.street` je 1, tedy přesně to, co v savu verze 2 znamenala
 *   jednička. Mapování „1 → ulice" ze zadání je tím pádem identita a jakékoli
 *   přepisování by bylo jen příležitost udělat chybu,
 * - **terén**: nové hodnoty (les, mokřad) se přidaly **za** stávající, takže
 *   0–3 znamenají pořád totéž.
 *
 * Doplňuje se jen to, co verze 2 neměla kde vzít:
 * - `meta.map` — seed nula a `generated: false`. V době verze 2 generátor
 *   neexistoval, každá mapa byla holá tráva. Tvářit se, že město vzniklo ze
 *   seedu, by byla lež: podle toho seedu by vyšel úplně jiný terén,
 * - `state.trafficCursor` — nula, tedy „vzorkuj od začátku".
 */
const migrateV2ToV3: Migration = (save) => ({
  ...save,
  meta: {
    ...save.meta,
    formatVersion: 3,
    map: { seed: 0, generated: false },
  },
  state: { ...save.state, trafficCursor: 0 },
});

/**
 * Verze 3 → 4 (§10 zadání fáze 3).
 *
 * Dvě změny naráz, obě z převýšení terénu:
 * - **přibyl `heights.bin`** — patra v rozích. Starý save je nemá odkud vzít,
 *   takže dostane **rovnou mapu**, všechny rohy na nule. Je to jediná poctivá
 *   volba: dopočítat patra ze seedu by šlo jen u map z generátoru a i tam by
 *   se rozešla s tím, co hráč mezitím postavil,
 * - **zmizela vrstva `elevation`.** Od T29 byla mrtvá — výšku nese
 *   `cornerHeight` — a tady se vystřihne i z bajtů. To je ta nepříjemná část:
 *   `layers.bin` se musí přeskládat, protože vrstvy jsou v něm za sebou a
 *   `elevation` byla druhá v pořadí.
 */
const migrateV3ToV4: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 4 },
  layers: dropElevationLayer(save.layers),
  heights: new Uint8Array(LEGACY_CORNER_CELLS),
});

/**
 * Vystřihne z `layers.bin` verze 3 druhou vrstvu v pořadí.
 *
 * Pořadí verze 3 bylo `terrain, elevation, zone, road, buildingId, power`,
 * kde všechny jsou jednobajtové kromě dvoubajtového `buildingId`. Číslo se
 * nedá odvodit z aktuálního `SAVE_LAYER_ORDER` — ten už `elevation` nezná —
 * takže je tu natvrdo, stejně jako v každé migraci: **popisuje minulost, ne
 * současnost.**
 */
function dropElevationLayer(layers: Uint8Array): Uint8Array {
  const cells = LEGACY_MAP_SIZE * LEGACY_MAP_SIZE;
  const expected = cells * 7; // 6 vrstev, z toho jedna dvoubajtová
  if (layers.byteLength !== expected) return layers; // cizí velikost mapy neřešíme

  const out = new Uint8Array(cells * 6);
  out.set(layers.subarray(0, cells), 0); // terrain
  out.set(layers.subarray(cells * 2), cells); // zone a všechno za ní
  return out;
}

/**
 * Verze 4 → 5 (§10 zadání fáze 3).
 *
 * Verze 5 přidala **potrubí**. Starý save žádné nemá a nemá ho odkud vzít,
 * takže dostane prázdnou síť: bajty `layers.bin` se jen prodlouží o jednu
 * jednobajtovou vrstvu nul na konci.
 *
 * Důsledek je nepříjemný a **je to záměr**: načtené město je rázem bez vody
 * a začne chátrat, dokud hráč potrubí nepoloží. Alternativou by bylo tiše
 * předstírat, že staré město vodovod má — tedy vyrobit síť, kterou hráč
 * nikdy nepostavil. Hráč se to musí dozvědět **hláškou při načtení**, ne až
 * úbytkem obyvatel; hlídá to `collectLoadWarnings`.
 */
const migrateV4ToV5: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 5 },
  layers: appendEmptyLayer(save.layers),
});

/**
 * Připíše na konec `layers.bin` jednu prázdnou jednobajtovou vrstvu.
 *
 * Délka verze 4 je tu natvrdo ze stejného důvodu jako u `dropElevationLayer`:
 * migrace **popisuje minulost, ne současnost**. Kdyby četla aktuální
 * `SAVE_LAYER_ORDER`, začala by se chovat jinak, jakmile přibude verze 6.
 */
function appendEmptyLayer(layers: Uint8Array): Uint8Array {
  const cells = LEGACY_MAP_SIZE * LEGACY_MAP_SIZE;
  const expected = cells * 6; // 5 vrstev, z toho `buildingId` dvoubajtová
  if (layers.byteLength !== expected) return layers; // cizí velikost mapy neřešíme

  const out = new Uint8Array(expected + cells);
  out.set(layers, 0);
  return out;
}

/**
 * Verze 5 → 6 (§9 zadání fáze 4).
 *
 * Verze 6 přinesla celou fázi 4: vrstvy katastrof, běžící pohromy, linky MHD
 * a finanční závazky. Starý save o nich neví, takže:
 *
 * - `disasters.bin` je **prázdný**, tedy nic nehoří, nic není zaplavené
 *   a nikde neleží trosky,
 * - katastrofy jsou **zapnuté** a nikdy se žádná nestala — hráč, který si
 *   uložil ve verzi 5, si je nemohl vypnout, takže výchozí stav je zapnuto,
 * - žádné linky ani závazky, rating na čistém štítu.
 *
 * `terraformTick` ze zadání tu **není**: patří k sesuvu půdy (T54), který se
 * neimplementoval. Přidávat do formátu vrstvu, kterou nikdo nezapisuje ani
 * nečte, by znamenalo verzi navíc, až se sesuv doopravdy udělá.
 */
const migrateV5ToV6: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 6 },
  // Velikost mapy zná `meta.grid` od verze 2; u starších ji doplnila migrace,
  // takže se na ni tady dá spolehnout.
  disasters: new Uint8Array(
    emptyDisasterBytes(save.meta.grid?.size ?? LEGACY_MAP_SIZE),
  ),
  state: {
    ...save.state,
    disasters: {
      enabled: true,
      lastOccurrence: {},
      active: [],
      modifiers: [],
      nextId: 1,
      riskCeiling: {},
      offlinePlants: [],
      infection: [],
      rubbleOf: [],
    },
    transit: { lines: [], nextLineId: 1, lostStops: [] },
    finance: {
      loans: [],
      nextLoanId: 1,
      bonds: [],
      nextBondId: 1,
      bondsBlockedUntil: 0,
      grantsAwarded: [],
      grantProgress: [],
    },
    // Populaci pro měření růstu nese až verze 6. Staršímu savu se dopočítá
    // z budov, ať načtené město nezačíná falešným skokem růstu proti nule.
    // Do T132 to dělalo `applySaveToWorld` u **každého** savu, a tím
    // přepisovalo i uloženou hodnotu verze 6 a výš — první měsíční uzávěrka
    // po načtení pak měřila růst proti jinému číslu než ve hře bez přerušení.
    economy: {
      ...save.state.economy,
      lastPopulation: save.entities.buildings.reduce(
        (sum, building) => sum + (building.abandoned ? 0 : building.population),
        0,
      ),
    },
  },
});

/**
 * Kolik bajtů zabere prázdný `disasters.bin`.
 *
 * Počet vrstev je tu **natvrdo**, ne z `SAVE_DISASTER_LAYER_ORDER`: migrace
 * popisuje minulost. Kdyby ve verzi 7 přibyla osmá vrstva, tahle migrace by
 * začala vyrábět buffer, který verze 6 neumí přečíst.
 */
function emptyDisasterBytes(size: number): number {
  const DISASTER_LAYERS_V6 = 7;
  return size * size * DISASTER_LAYERS_V6;
}

/**
 * Verze 6 → 7 (T64).
 *
 * Verze 7 přidala troskám paměť, co na nich stálo. Starý save ji nemá a mít
 * nemůže — ta informace v něm nikdy nebyla. Hromady z verze 6 proto zůstanou
 * **bezejmenné** a hráč u nich uvidí jen „trosky", ne „bývalá nemocnice".
 *
 * Domyslet by to nešlo: vrstva trosek ví, že tam něco leželo, ne co to bylo.
 * Hádat podle okolí by znamenalo napsat hráči do savu nemocnici, která tam
 * nikdy nestála.
 */
const migrateV6ToV7: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 7 },
  state: {
    ...save.state,
    disasters: { ...save.state.disasters, rubbleOf: [] },
  },
});

/**
 * Verze 7 → 8 (T54).
 *
 * Verze 8 přidala `terraform.bin` — tik poslední terénní úpravy dlaždice, pro
 * sesuv půdy. Starý save ho nemá a **doplní se nulami**, tedy „nikdy se tu
 * neupravovalo".
 *
 * Je to úmyslné podcenění, ne mezera: hráč, který si těsně před uložením
 * srovnal svah, dostane po načtení mírně nižší riziko sesuvu na tom místě.
 * Opačná volba — napsat všude aktuální tik — by mu z celého města udělala
 * čerstvě přesypanou půdu a sesuv by se do roka chytal všude.
 */
const migrateV7ToV8: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 8 },
  terraform: new Uint8Array(emptyTerraformBytes(save.meta.grid?.size ?? LEGACY_MAP_SIZE)),
});

/**
 * Kolik bajtů zabere prázdný `terraform.bin`.
 *
 * Dva bajty na dlaždici, natvrdo. Migrace popisuje minulost: kdyby se ve verzi
 * 9 vrstva rozšířila na čtyři bajty, tahle by začala vyrábět soubor, který
 * verze 8 neumí přečíst.
 */
function emptyTerraformBytes(size: number): number {
  const BYTES_PER_TILE_V8 = 2;
  return size * size * BYTES_PER_TILE_V8;
}

/**
 * v8 → v9: linky dostaly příznak **odstavení**.
 *
 * Starý save ho nemá a doplní se `false`, tedy „jede". Je to jediná možná
 * volba: linka, která do uložení vozila lidi, po načtení vozit nepřestane.
 */
const migrateV8ToV9: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 9 },
  state: {
    ...save.state,
    transit: {
      ...save.state.transit,
      lines: save.state.transit.lines.map((line) => ({ ...line, paused: false })),
    },
  },
});

/**
 * v9 → v10: paměť na zbořené zastávky (`lostStops`).
 *
 * Starý save ji nemá a mít nemůže — je to historie, ne odvozený stav. Prázdná
 * je správná odpověď: město načtené z v9 prostě nikde nečeká na obnovenou
 * zastávku.
 */
const migrateV9ToV10: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 10 },
  state: {
    ...save.state,
    transit: { ...save.state.transit, lostStops: [] },
  },
});

/**
 * Verze 11: účetní kniha (§12).
 *
 * Rozehraná partie o svých loňských číslech nic neví a **vymýšlet si je
 * nebude** — kniha začne prázdná od roku, ve kterém se save nachází, a první
 * vyúčtování přijde na konci toho roku. Falešný výkaz by byl horší než žádný.
 */
const migrateV10ToV11: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 11 },
  state: {
    ...save.state,
    economy: {
      ...save.state.economy,
      ledger: { year: Math.floor(save.state.tick / 360) + 1, income: {}, expenses: {} },
      lastYear: null,
    },
  },
});

/**
 * Verze 12: vrstva `buildingId` je čtyřbajtová.
 *
 * Id budovy se po zbourání nevrací, takže dvoubajtová vrstva byla strop na
 * všechny budovy, které ve městě **kdy** vznikly. Po 65 535 se další id zapsalo
 * jako nula a save se už nenačetl. Starý save pod stropem je z definice, takže
 * migrace čísla jen přepíše do širšího pole: dolní dva bajty zůstanou, horní
 * jsou nuly. Žádná budova se nepřečísluje.
 */
const migrateV11ToV12: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 12 },
  layers: widenBuildingIdLayer(save.layers, save.meta.grid?.size ?? LEGACY_MAP_SIZE),
});

/**
 * Přepíše `buildingId` v `layers.bin` verze 11 ze dvou bajtů na čtyři.
 *
 * Rozložení verze 11 je tu natvrdo — migrace popisuje minulost: `terrain`,
 * `zone`, `road` po bajtu, `buildingId` dva bajty, `power` a `pipe` po bajtu.
 */
function widenBuildingIdLayer(layers: Uint8Array, size: number): Uint8Array {
  const cells = size * size;
  const BYTES_PER_TILE_V11 = 7;
  if (layers.byteLength !== cells * BYTES_PER_TILE_V11) return layers; // délku ohlásí `checkSaveFits`

  const head = cells * 3; // terrain, zone, road
  const out = new Uint8Array(cells * (BYTES_PER_TILE_V11 + 2));
  out.set(layers.subarray(0, head), 0);
  // Little-endian: dolní bajty jdou na začátek čtveřice, horní zůstanou nulové.
  for (let i = 0; i < cells; i++) {
    out[head + i * 4] = layers[head + i * 2] ?? 0;
    out[head + i * 4 + 1] = layers[head + i * 2 + 1] ?? 0;
  }
  out.set(layers.subarray(head + cells * 2), head + cells * 4); // power, pipe
  return out;
}

/**
 * Verze 13: elektrické vedení (T129).
 *
 * Do verze 12 vedla proud silnice, od 13 nevede nic kromě bloků zón a budov
 * a vedení, které hráč natáhne. Migrace **nepokládá žádné vedení**
 * (rozhodnutí autora): první verze ho položila pod silnice a autor to
 * zamítl — „města zhasnou a musí se to dodělat". Hráč se o tom dozví
 * hláškou při načtení (`collectLoadWarnings`, `unwiredBuildings`).
 */
const migrateV12ToV13: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 13 },
  layers: appendEmptyWireLayer(save.layers, save.meta.grid?.size ?? LEGACY_MAP_SIZE),
});

/**
 * Připíše prázdnou vrstvu vedení. Rozložení verze 12 natvrdo: devět bajtů
 * na dlaždici (`buildingId` čtyřbajtová).
 */
function appendEmptyWireLayer(layers: Uint8Array, size: number): Uint8Array {
  const cells = size * size;
  const BYTES_PER_TILE_V12 = 9;
  if (layers.byteLength !== cells * BYTES_PER_TILE_V12) return layers; // délku ohlásí `checkSaveFits`
  const out = new Uint8Array(cells * (BYTES_PER_TILE_V12 + 1));
  out.set(layers, 0);
  return out;
}

/**
 * Verze 14: pryč s vedením pod silnicemi.
 *
 * Savy, které prošly první verzí migrace 12 → 13, mají vedení pod každou
 * silnicí nebo spojky po silnicích. Autor je zamítl, takže se smaže vedení,
 * které **vede podél silnice**. Rozložení verze 13 natvrdo: deset bajtů
 * na dlaždici, silnice je třetí vrstva, vedení poslední.
 *
 * Do T132 se mazalo vedení na **každé** dlaždici se silnicí. Jenže úsek
 * vedení přes ulici je jediný způsob, jak propojit dva bloky, a ten hráč
 * postavil sám — migrace mu tak rozpojila město. Rozlišuje se podle tvaru:
 * vygenerované vedení běží **po** silnici, takže má souseda, který je taky
 * silnice s vedením. Přechod přes ulici takového souseda nemá: po obou
 * stranách jsou parcely a podél ulice vedení nevede.
 *
 * Savy, které už verzí 14 prošly s původní migrací, přechody ztratily
 * a vrátit je nejde — v savu po nich nezůstala stopa.
 */
const migrateV13ToV14: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 14 },
  layers: clearWiresOnRoads(save.layers, save.meta.grid?.size ?? LEGACY_MAP_SIZE),
});

function clearWiresOnRoads(layers: Uint8Array, size: number): Uint8Array {
  const cells = size * size;
  const BYTES_PER_TILE_V13 = 10;
  if (layers.byteLength !== cells * BYTES_PER_TILE_V13) return layers;
  const out = layers.slice();
  const road = cells * 2;
  const wire = cells * 9;
  const wiredRoad = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    const at = y * size + x;
    return (layers[road + at] ?? 0) !== 0 && (layers[wire + at] ?? 0) !== 0;
  };
  // Rozhoduje se podle **původních** vrstev (`layers`), ne podle `out`:
  // jinak by na výsledku záleželo, v jakém pořadí se dlaždice mažou.
  for (let i = 0; i < cells; i++) {
    if (!wiredRoad(i % size, Math.floor(i / size))) continue;
    const x = i % size;
    const y = (i - x) / size;
    const alongRoad =
      wiredRoad(x + 1, y) || wiredRoad(x - 1, y) || wiredRoad(x, y + 1) || wiredRoad(x, y - 1);
    if (alongRoad) out[wire + i] = 0;
  }
  return out;
}

/**
 * Verze 15 (audit T132): stav s pamětí se ukládá.
 *
 * Starší save ho nemá, takže dostane přesně to, s čím se do verze 14
 * načítal: spokojenost neutrální, doprava, dosažitelnost práce, statistiky
 * linek a počítadla chátrání prázdné. Hráč tím o nic nepřijde — jen se jeho
 * načtené město ještě naposledy rozjede od „čistého" stavu.
 *
 * Délky natvrdo: tři hrubé vrstvy verze 14, neutrál 128 (`NEUTRAL_HAPPINESS`
 * v době verze 15). Migrace popisuje minulost.
 */
const migrateV14ToV15: Migration = (save) => ({
  ...save,
  meta: { ...save.meta, formatVersion: 15 },
  coarse: appendNeutralHappiness(save.coarse, save.meta.grid?.size ?? LEGACY_MAP_SIZE),
  state: {
    ...save.state,
    derived: {
      trafficLoad: [],
      jobAccess: [],
      lineStats: [],
      transitRelief: [],
      downgradeStreak: [],
      waterlessStreak: [],
      coverage: [],
      watered: [],
    },
  },
});

function appendNeutralHappiness(coarse: Uint8Array, size: number): Uint8Array {
  const COARSE_LAYERS_V14 = 3;
  const NEUTRAL_HAPPINESS_V15 = 128;
  const COARSE_FACTOR_V15 = 4; // hrubá buňka je 4 × 4 dlaždice
  const cells = Math.ceil(size / COARSE_FACTOR_V15) ** 2;
  if (coarse.byteLength !== cells * COARSE_LAYERS_V14) return coarse; // délku ohlásí `checkSaveFits`
  const out = new Uint8Array(cells * (COARSE_LAYERS_V14 + 1)).fill(NEUTRAL_HAPPINESS_V15);
  out.set(coarse, 0);
  return out;
}

/** Klíč = verze, ze které se migruje. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
  5: migrateV5ToV6,
  6: migrateV6ToV7,
  7: migrateV7ToV8,
  8: migrateV8ToV9,
  9: migrateV9ToV10,
  10: migrateV10ToV11,
  11: migrateV11ToV12,
  12: migrateV12ToV13,
  13: migrateV13ToV14,
  14: migrateV14ToV15,
};

/**
 * Postupně přežene save na aktuální verzi.
 *
 * `migrations` je parametr, aby se dala mechanika otestovat bez vymýšlení
 * falešné verze formátu.
 */
export function migrate(
  save: SaveData,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  targetVersion: number = CURRENT_FORMAT_VERSION,
): SaveData {
  if (save.meta.formatVersion > targetVersion) {
    throw new SaveMigrationError(save.meta.formatVersion);
  }

  let current = save;
  while (current.meta.formatVersion < targetVersion) {
    const migration = migrations[current.meta.formatVersion];
    if (!migration) throw new SaveMigrationError(current.meta.formatVersion);

    const next = migration(current);
    if (next.meta.formatVersion <= current.meta.formatVersion) {
      throw new SaveMigrationError(current.meta.formatVersion);
    }
    current = next;
  }

  return current;
}
