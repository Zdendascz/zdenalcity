import type { SaveEntities } from './format';

/**
 * Budovy v `entities.json` **po sloupcích** (verze 16, audit T134).
 *
 * Do verze 15 šla každá budova jako objekt a jména polí se opakovala 1 500×.
 * Deflate je sice najde, ale čísla různých polí prokládaná mezi sebou se
 * komprimují špatně. Po sloupcích leží vedle sebe čísla stejného druhu
 * a `id` s `builtAtTick`, které rostou, jdou jako rozdíly od předchozího.
 * Na savu autora (1 520 budov): 20,3 kB → 11,5 kB zkomprimovaného JSONu.
 *
 * `definitionId` zůstává **string s namespace** (P6) — žádná tabulka čísel.
 * Opakování jmen deflate zvládne sám.
 *
 * Tohle je jen kódování souboru. V paměti (`SaveData.entities`) jsou budovy
 * dál objekty a migrace o sloupcích nevědí.
 */

/** Od které verze formátu se budovy ukládají po sloupcích. */
export const ENTITY_COLUMNS_SINCE = 16;

/** Pořadí sloupců; nové pole se přidává na konec. */
const COLUMNS = [
  'id',
  'definitionId',
  'x',
  'y',
  'level',
  'population',
  'jobs',
  'powered',
  'builtAtTick',
  'levelChangedAtTick',
  'abandoned',
] as const;

/** Sloupce, které rostou s pořadím podle id, jdou jako rozdíly. */
const DELTA = new Set<string>(['id', 'builtAtTick']);
/** Pravdivostní sloupce jdou jako 0/1. */
const FLAGS = new Set<string>(['powered', 'abandoned']);

export interface EntityColumns {
  nextBuildingId: number;
  count: number;
  columns: Record<string, unknown[]>;
}

export function encodeEntityColumns(entities: SaveEntities): EntityColumns {
  const columns: Record<string, unknown[]> = {};
  for (const name of COLUMNS) {
    const values: unknown[] = [];
    let previous = 0;
    for (const building of entities.buildings) {
      const value = building[name];
      if (DELTA.has(name)) {
        values.push((value as number) - previous);
        previous = value as number;
      } else if (FLAGS.has(name)) {
        values.push(value ? 1 : 0);
      } else {
        values.push(value);
      }
    }
    columns[name] = values;
  }
  return { nextBuildingId: entities.nextBuildingId, count: entities.buildings.length, columns };
}

/**
 * Sloupce zpátky na řádky **bez validace hodnot** — tu dělá `parseEntities`
 * stejně jako u řádkového tvaru. Tady se hlídá jen tvar: počet, délky
 * sloupců. Save je cizí vstup: `count` z něj se nesmí použít k alokaci, dokud
 * nesedí s délkou skutečných polí.
 */
export function decodeEntityColumns(raw: Record<string, unknown>): unknown[] {
  const count = raw['count'];
  const columns = raw['columns'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new Error('entities.count musí být nezáporné celé číslo');
  }
  if (typeof columns !== 'object' || columns === null || Array.isArray(columns)) {
    throw new Error('entities.columns musí být objekt');
  }
  const table = columns as Record<string, unknown>;
  for (const name of COLUMNS) {
    const column = Object.hasOwn(table, name) ? table[name] : undefined;
    if (!Array.isArray(column) || column.length !== count) {
      throw new Error(`entities.columns.${name} musí být pole délky ${count}`);
    }
  }

  const rows: Record<string, unknown>[] = [];
  const running = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const row: Record<string, unknown> = {};
    for (const name of COLUMNS) {
      const value = (table[name] as unknown[])[i];
      if (DELTA.has(name) && typeof value === 'number') {
        const sum = (running.get(name) ?? 0) + value;
        running.set(name, sum);
        row[name] = sum;
      } else if (FLAGS.has(name) && (value === 0 || value === 1)) {
        row[name] = value === 1;
      } else {
        // Nečekaný tvar se předá dál, ať ho odmítne validace s přesnou hláškou.
        row[name] = value;
      }
    }
    rows.push(row);
  }
  return rows;
}
