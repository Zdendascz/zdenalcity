import { strFromU8, unzipSync } from 'fflate';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { MAP_SIZE } from '@/sim/layers';
import type { Layers } from '@/sim/layers';
import { Rng } from '@/sim/rng';
import { RCI_CATEGORIES } from '@/sim/rci';
import type { Building, DemandState, EconomyState, WorldState } from '@/sim/world';
import { SAVE_FILES, SAVE_LAYER_ORDER, SaveFormatError } from './format';
import type { SaveData, SaveEntities, SaveMeta, SaveSourceInfo, SaveState } from './format';

function fail(message: string): never {
  throw new SaveFormatError(message);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${what} musí být objekt`);
  }
  return value as Record<string, unknown>;
}

function num(container: Record<string, unknown>, key: string, what: string): number {
  const value = container[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${what}.${key} musí být číslo`);
  }
  return value;
}

function int(container: Record<string, unknown>, key: string, what: string): number {
  const value = num(container, key, what);
  if (!Number.isInteger(value)) fail(`${what}.${key} musí být celé číslo`);
  return value;
}

function str(container: Record<string, unknown>, key: string, what: string): string {
  const value = container[key];
  if (typeof value !== 'string') fail(`${what}.${key} musí být řetězec`);
  return value;
}

function bool(container: Record<string, unknown>, key: string, what: string): boolean {
  const value = container[key];
  if (typeof value !== 'boolean') fail(`${what}.${key} musí být true nebo false`);
  return value;
}

function parseJson(bytes: Uint8Array | undefined, what: string): Record<string, unknown> {
  if (!bytes) fail(`v savu chybí ${what}`);
  try {
    return asRecord(JSON.parse(strFromU8(bytes)), what);
  } catch (error) {
    if (error instanceof SaveFormatError) throw error;
    fail(`${what} není platný JSON`);
  }
}

export function parseMeta(raw: Record<string, unknown>): SaveMeta {
  const city = asRecord(raw['city'], 'meta.city');
  const content = asRecord(raw['content'], 'meta.content');
  const preview = asRecord(raw['preview'], 'meta.preview');

  const rawSources = content['sources'];
  if (!Array.isArray(rawSources)) fail('meta.content.sources musí být pole');

  const sources: SaveSourceInfo[] = rawSources.map((entry, i) => {
    const source = asRecord(entry, `meta.content.sources[${i}]`);
    return {
      id: str(source, 'id', `meta.content.sources[${i}]`),
      version: str(source, 'version', `meta.content.sources[${i}]`),
    };
  });

  return {
    formatVersion: int(raw, 'formatVersion', 'meta'),
    gameVersion: str(raw, 'gameVersion', 'meta'),
    city: { name: str(city, 'name', 'meta.city'), seed: int(city, 'seed', 'meta.city') },
    createdAt: str(raw, 'createdAt', 'meta'),
    modifiedAt: str(raw, 'modifiedAt', 'meta'),
    playtimeSeconds: num(raw, 'playtimeSeconds', 'meta'),
    content: { sources },
    preview: {
      population: int(preview, 'population', 'meta.preview'),
      funds: int(preview, 'funds', 'meta.preview'),
      tick: int(preview, 'tick', 'meta.preview'),
    },
  };
}

function parseEntities(raw: Record<string, unknown>): SaveEntities {
  const rawBuildings = raw['buildings'];
  if (!Array.isArray(rawBuildings)) fail('entities.buildings musí být pole');

  const buildings: Building[] = rawBuildings.map((entry, i) => {
    const where = `entities.buildings[${i}]`;
    const building = asRecord(entry, where);
    return {
      id: int(building, 'id', where),
      // P6: v savu je vždycky string s namespace, nikdy číselný index definice.
      definitionId: str(building, 'definitionId', where),
      x: int(building, 'x', where),
      y: int(building, 'y', where),
      level: int(building, 'level', where),
      population: int(building, 'population', where),
      jobs: int(building, 'jobs', where),
      powered: bool(building, 'powered', where),
      builtAtTick: int(building, 'builtAtTick', where),
      // Save v1 tahle pole nenese; podle §11 zadání fáze 2 se při migraci
      // nulují. Ukládat je začne formát verze 2 v T20.
      levelChangedAtTick: 0,
      abandoned: false,
    };
  });

  return { nextBuildingId: int(raw, 'nextBuildingId', 'entities'), buildings };
}

function parseState(raw: Record<string, unknown>): SaveState {
  const economyRaw = asRecord(raw['economy'], 'state.economy');
  const taxRatesRaw = asRecord(economyRaw['taxRates'], 'state.economy.taxRates');
  const demandRaw = asRecord(raw['demand'], 'state.demand');

  const taxRates = {} as EconomyState['taxRates'];
  const demand = {} as DemandState;
  for (const category of RCI_CATEGORIES) {
    taxRates[category] = int(taxRatesRaw, category, 'state.economy.taxRates');
    demand[category] = num(demandRaw, category, 'state.demand');
  }

  const rngState = int(raw, 'rngState', 'state');
  if (rngState < 0 || rngState > 0xffffffff) fail('state.rngState musí být uint32');

  return {
    tick: int(raw, 'tick', 'state'),
    rngState,
    economy: {
      funds: int(economyRaw, 'funds', 'state.economy'),
      taxRates,
      lastIncome: int(economyRaw, 'lastIncome', 'state.economy'),
      lastExpenses: int(economyRaw, 'lastExpenses', 'state.economy'),
    },
    demand,
  };
}

/** Očekávaná délka `layers.bin` pro aktuální formát. */
export function expectedLayersByteLength(): number {
  const cells = MAP_SIZE * MAP_SIZE;
  // Jen `buildingId` je dvoubajtová; kdyby se to změnilo, je to nová verze formátu.
  return cells * (SAVE_LAYER_ORDER.length + 1);
}

export function unpackLayersInto(bytes: Uint8Array, layers: Layers): void {
  if (bytes.byteLength !== expectedLayersByteLength()) {
    fail(
      `layers.bin má ${bytes.byteLength} B, čekalo se ${expectedLayersByteLength()} B — jiná velikost mapy nebo jiná sada vrstev`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cells = MAP_SIZE * MAP_SIZE;
  let offset = 0;

  for (const name of SAVE_LAYER_ORDER) {
    const layer = layers[name];
    if (layer.BYTES_PER_ELEMENT === 1) {
      for (let i = 0; i < cells; i++) {
        layer[i] = view.getUint8(offset);
        offset += 1;
      }
    } else {
      for (let i = 0; i < cells; i++) {
        layer[i] = view.getUint16(offset, true);
        offset += 2;
      }
    }
  }
}

/** Rozbalí celý save z bajtů ZIPu. Migrace se pouští až nad výsledkem. */
export function unpackSave(bytes: Uint8Array): SaveData {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    fail('save není čitelný ZIP');
  }

  const layers = files[SAVE_FILES.layers];
  if (!layers) fail(`v savu chybí ${SAVE_FILES.layers}`);

  return {
    meta: parseMeta(parseJson(files[SAVE_FILES.meta], SAVE_FILES.meta)),
    layers,
    entities: parseEntities(parseJson(files[SAVE_FILES.entities], SAVE_FILES.entities)),
    state: parseState(parseJson(files[SAVE_FILES.state], SAVE_FILES.state)),
  };
}

/**
 * Přečte jen `meta.json`, bez rozbalování vrstev a entit. Tohle je důvod, proč
 * je meta v ZIPu nekomprimovaná — seznam uložených her se vykreslí okamžitě.
 */
export function readSaveMeta(bytes: Uint8Array): SaveMeta {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name === SAVE_FILES.meta });
  } catch {
    fail('save není čitelný ZIP');
  }
  return parseMeta(parseJson(files[SAVE_FILES.meta], SAVE_FILES.meta));
}

export interface LoadWarnings {
  /** Zdroje obsahu, které save vyžaduje, ale nejsou načtené. */
  missingSources: SaveSourceInfo[];
  /** Definice, na které se odkazují budovy v savu, ale registr je nezná. */
  missingDefinitions: string[];
}

/**
 * Hráč musí vědět, že mu ve městě chybí mod. Budovy se **nikdy nemažou** —
 * jen se nevykreslí, dokud se zdroj nedoplní (§8).
 */
export function collectLoadWarnings(
  save: SaveData,
  catalogue: BuildingCatalogue,
  loadedSources: readonly SaveSourceInfo[],
): LoadWarnings {
  const loaded = new Set(loadedSources.map((source) => source.id));
  const missingSources = save.meta.content.sources.filter((source) => !loaded.has(source.id));

  const missingDefinitions = [
    ...new Set(
      save.entities.buildings
        .map((building) => building.definitionId)
        .filter((id) => catalogue.get(id) === undefined),
    ),
  ].sort();

  return { missingSources, missingDefinitions };
}

/**
 * Nasype save do **existujícího** světa.
 *
 * Nevytváří nový objekt schválně: renderer i UI drží `getSnapshot()` jako živý
 * pohled (T2), takže výměna objektu by jim nechala zastaralou referenci.
 */
export function applySaveToWorld(world: WorldState, save: SaveData): void {
  unpackLayersInto(save.layers, world.layers);

  // `seed` je readonly, aby ho nikdo nepřepsal omylem. Load je ta jediná
  // legitimní výjimka — ze světa se stává jiné město.
  (world as { seed: number }).seed = save.meta.city.seed;

  world.tick = save.state.tick;
  world.rng = Rng.fromState(save.state.rngState);
  world.economy = {
    ...save.state.economy,
    taxRates: { ...save.state.economy.taxRates },
  };
  world.demand = { ...save.state.demand };

  world.buildings.clear();
  for (const building of save.entities.buildings) {
    world.buildings.set(building.id, { ...building });
  }
  world.nextBuildingId = save.entities.nextBuildingId;

  // Difuzní vrstvy save verze 1 nenese. Vynulují se a systémy si je dopočítají —
  // ukládat je začne až formát verze 2 (T20).
  world.coarse.pollution.fill(0);
  world.coarse.landValue.fill(0);
  world.coarse.crime.fill(0);

  // Odvozený a runtime stav předchozího města nesmí přetéct do načteného.
  // Pokrytí se **musí** označit za špinavé: bez toho by ho `serviceSystem`
  // nikdy nepřepočítal a všechny služby by po loadu přestaly fungovat —
  // žádný bonus k ceně půdy, žádné srážení kriminality, žádné zdravotnictví.
  world.coverage.clear();
  world.coverageDirty = true;
  // Financování tříd save verze 1 nenese; podle §11 zadání fáze 2 se všem
  // třídám nastavuje 100 %, což je prázdná mapa.
  world.serviceFunding.clear();
  world.downgradeStreak.clear();

  // Po loadu se kreslí všechno a síť se přepočítá znovu.
  world.dirty = { tiles: new Set(), buildings: new Set(), fullRedraw: true, coarseChanged: true };
  world.powerNetworkDirty = true;
}
