import { COARSE_CELLS, COARSE_SIZE } from '@/sim/coarse';
import { MAP_SIZE } from '@/sim/layers';
import { CURRENT_FORMAT_VERSION, SAVE_COARSE_LAYER_ORDER, SaveMigrationError } from '../format';
import type { SaveData } from '../format';

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
    grid: { size: MAP_SIZE, coarseSize: COARSE_SIZE },
  },
  coarse: new Uint8Array(COARSE_CELLS * SAVE_COARSE_LAYER_ORDER.length),
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

/** Klíč = verze, ze které se migruje. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
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
