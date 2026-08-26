import { TERRAIN } from '@/sim/layers';

/**
 * Ruční validátor definic. Schéma je záměrně bez knihovny — projekt má mít
 * minimum závislostí a rozsah kontrol je malý.
 *
 * Validátor **sbírá všechny chyby**, ne jen první. Kdo ladí mod s deseti
 * překlepy, nechce deset kol opakovaného spuštění.
 */

export interface ValidationIssue {
  /** Cesta k poli uvnitř souboru, např. `construction.cost`. */
  field: string;
  message: string;
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  gameVersion: string;
  dependencies: readonly string[];
}

export interface BuildingDefinition {
  id: string;
  type: 'building';
  category: string;
  /**
   * Do které nabídky v liště budova patří. **Obsah, ne kód** (P5): kód jen
   * seskupuje podle téhle hodnoty a popisek bere z `ui.menu.<menu>`.
   *
   * Chybí u všeho, co hráč nestaví ručně — zóny si domy staví samy.
   */
  menu?: string;
  /** Lokalizační klíč, nikdy text (§10). */
  name: string;
  description: string;
  footprint: readonly [number, number];
  /**
   * Úroveň 1–5. Vlastnost **definice**, ne entity — entita nese jen `level`
   * a `definitionId` (§8 zadání fáze 2). Chybí-li, je to úroveň 1, protože
   * drtivá většina budov je bez žebříčku.
   */
  level: number;
  construction: {
    cost: number;
    requiresRoad: boolean;
    requiresPower: boolean;
    /**
     * Bez vody pod budovou nevyroste a chátrá (§8 fáze 3). Volitelné, aby ho
     * nemusela deklarovat každá budova — chybějící znamená „vodu nepotřebuje".
     */
    requiresWater?: boolean;
    /** Musí sousedit s vodní plochou — vodárna z ní bere (§8 fáze 3). */
    nearWater?: boolean;
    allowedTerrain: readonly number[];
  };
  economy: { upkeep: number };
  /** Kolik obyvatel budova pojme. Chybí u všeho, co se nebydlí. */
  population?: { capacity: number };
  /** Kolik pracovních míst budova dává. */
  jobs?: { capacity: number };
  /**
   * Služba: třída, dosah v buňkách hrubé mřížky a síla v centru.
   * Třídy jsou obsah, ne kód — mechanismus je obecný (§6 zadání fáze 2).
   */
  service?: { class: string; radius: number; strength: number };
  /**
   * Druhá, **záporná** stopa budovy v okolí — stejný mechanismus jako služba,
   * jen se počítá s tím, že váha její třídy v ceně půdy bude záporná.
   *
   * Existuje kvůli věznici (§6 fáze 2): je to policejní budova, takže sráží
   * kriminalitu jako každá jiná, ale zároveň nikdo nechce bydlet vedle ní.
   * Jednu třídu na budovu by obojí nezvládlo.
   *
   * Kód o žádné konkrétní třídě neví — jméno i váhu určuje obsah (P5).
   * Financování se na ni nevztahuje: úsporami na policii se sousedům výhled
   * na věznici nezlepší.
   */
  nuisance?: { class: string; radius: number; strength: number };
  /**
   * Zpracování odpadu. Nemá pokrytí ani dosah — jen kapacitu, která se sčítá
   * celoměstsky (§6 zadání fáze 2).
   */
  waste?: { capacity: number };
  /**
   * Co musí platit, aby budova mohla vzniknout (§7 zadání fáze 2).
   *
   * `services` je minimální pokrytí dané třídy v buňce budovy, `buildings`
   * seznam definic, které musí ve městě stát. Chybějící sekce znamená
   * „bez podmínek" — přesně to je stav vanilla obsahu 2a.
   */
  requirements?: {
    services: Readonly<Record<string, number>>;
    buildings: readonly string[];
  };
  power?: { production?: number; consumption?: number };
  /**
   * Vodovod (§8 fáze 3). `range` je dosah sítě v dlaždicích potrubí od téhle
   * budovy — čerpací stanice je zdroj s dosahem, ale bez vlastní výroby,
   * takže síť **prodlužuje**, nezakládá.
   */
  water?: { production?: number; consumption?: number; range?: number };
  /**
   * Kapacita čistírny odpadních vod (§8 fáze 3). Kanalizace se **nekreslí** —
   * je to celoměstská kapacita po vzoru odpadů (R9), ne druhá síť trubek.
   */
  sewage?: { capacity: number };
  /**
   * Zastávka MHD (§7 fáze 4). `mode` je **jméno z katalogu**, ne výčet v kódu:
   * mod si přidá vlastní mód a hra o něm nemusí vědět (P5).
   *
   * Budova se zastávkou se dá zařadit do linky téhož módu. Samotné pokrytí
   * dělá dál `service` — linka je nadstavba, ne náhrada.
   */
  transit?: { mode: string };
  environment?: { pollution?: number };
  graphics: {
    color: string;
    heightLevels: number;
    /** Jméno symbolu na střeše. Sadu tvarů zná renderer, výběr dělá obsah. */
    icon?: string;
  };
}

/**
 * Grant — jednorázová dotace za dosažený milník (§8 fáze 4).
 *
 * **Obsah, ne kód** (P5): mod si přidá vlastní milník a hra o něm nemusí vědět.
 * Kód zná jen jména veličin, na které se dá ptát — stejně jako u ukazatelů
 * rizika katastrof.
 *
 * Každý grant se přizná **jednou za hru**. Seznam přiznaných je v savu, jinak
 * by se po načtení rozdaly znovu a hráč by měl nekonečný zdroj peněz.
 */
export interface GrantDefinition {
  id: string;
  type: 'grant';
  name: string;
  description: string;
  /** Kolik se jednorázově vyplatí. */
  amount: number;
  condition: GrantCondition;
}

export interface GrantCondition {
  /** Jméno veličiny: `population`, `buildings`, `happiness`, `building`. */
  metric: string;
  /** Práh, od kterého se milník počítá za dosažený. */
  atLeast: number;
  /** U veličiny `building`: která budova musí stát. */
  definitionId?: string;
  /**
   * Jak dlouho musí podmínka platit **v kuse**.
   *
   * Bez toho by šel grant za spokojenost sebrat tím, že hráč na jeden tik
   * srazí daně na nulu. Chybí-li, stačí okamžik.
   */
  forTicks?: number;
}

/**
 * Definice budovy. **Zůstává jednotná**, i když typů obsahu je víc — sjednotit
 * ji s grantem do unie by znamenalo, že každé místo, které sáhne na `graphics`
 * nebo `footprint`, musí nejdřív dokazovat, o co jde. Grant je jiný druh věci
 * a registr ho vede zvlášť.
 */
export type Definition = BuildingDefinition;

/** Cokoli, co může být v souboru obsahu. Rozlišuje se podle `type`. */
export type AnyDefinition = BuildingDefinition | GrantDefinition;

/** `namespace` bez dvojtečky — viz `id` v manifestu. */
const NAMESPACE = /^[a-z][a-z0-9_]*$/;
/** `namespace:identifier` — P6. */
const DEFINITION_ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const LOCALE_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const TERRAIN_VALUES = new Set<number>(Object.values(TERRAIN));

/** Nejvyšší úroveň budovy (§8 zadání fáze 2). Kam až se dojde, řídí balanc. */
export const MAX_LEVEL = 5;

const GRANT_SECTIONS = ['id', 'type', 'name', 'description', 'amount', 'condition'];

const DEFINITION_SECTIONS = [
  'id',
  'type',
  'category',
  'menu',
  'name',
  'description',
  'footprint',
  'level',
  'construction',
  'economy',
  'population',
  'jobs',
  'service',
  'nuisance',
  'waste',
  'requirements',
  'power',
  'water',
  'sewage',
  'transit',
  'environment',
  'graphics',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requireRecord(
  issues: ValidationIssue[],
  container: Record<string, unknown>,
  key: string,
  field: string,
): Record<string, unknown> | null {
  const record = asRecord(container[key]);
  if (!record) {
    issues.push({ field, message: 'musí být objekt' });
    return null;
  }
  return record;
}

function requireString(
  issues: ValidationIssue[],
  container: Record<string, unknown>,
  key: string,
  field: string,
  pattern?: RegExp,
): string | null {
  const value = container[key];
  if (typeof value !== 'string' || value.length === 0) {
    issues.push({ field, message: 'musí být neprázdný řetězec' });
    return null;
  }
  if (pattern && !pattern.test(value)) {
    issues.push({ field, message: `nemá očekávaný tvar ${String(pattern)}` });
    return null;
  }
  return value;
}

function requireInt(
  issues: ValidationIssue[],
  container: Record<string, unknown>,
  key: string,
  field: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | null {
  const value = container[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    issues.push({ field, message: `musí být celé číslo v rozsahu ${min}–${max}` });
    return null;
  }
  return value;
}

function optionalInt(
  issues: ValidationIssue[],
  container: Record<string, unknown>,
  key: string,
  field: string,
  min: number,
  max?: number,
): number | undefined {
  if (container[key] === undefined) return undefined;
  return requireInt(issues, container, key, field, min, max) ?? undefined;
}

/** Volitelný příznak; chybějící znamená `false`, ne chybu. */
function optionalBoolean(
  issues: ValidationIssue[],
  container: Record<string, unknown>,
  key: string,
  field: string,
): boolean {
  const value = container[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    issues.push({ field, message: 'musí být true nebo false' });
    return false;
  }
  return value;
}

function requireBoolean(
  issues: ValidationIssue[],
  container: Record<string, unknown>,
  key: string,
  field: string,
): boolean | null {
  const value = container[key];
  if (typeof value !== 'boolean') {
    issues.push({ field, message: 'musí být true nebo false' });
    return null;
  }
  return value;
}

export function validateManifest(raw: unknown): {
  manifest: Manifest | null;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const record = asRecord(raw);
  if (!record) {
    return { manifest: null, issues: [{ field: '', message: 'manifest musí být objekt' }] };
  }

  const id = requireString(issues, record, 'id', 'id', NAMESPACE);
  const name = requireString(issues, record, 'name', 'name');
  const version = requireString(issues, record, 'version', 'version', VERSION);
  const gameVersion = requireString(issues, record, 'gameVersion', 'gameVersion');

  const rawDependencies = record['dependencies'];
  let dependencies: string[] | null = null;
  if (!Array.isArray(rawDependencies)) {
    issues.push({ field: 'dependencies', message: 'musí být pole (klidně prázdné)' });
  } else {
    dependencies = [];
    rawDependencies.forEach((entry, i) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        issues.push({ field: `dependencies[${i}]`, message: 'musí být neprázdný řetězec' });
      } else {
        dependencies?.push(entry);
      }
    });
  }

  if (issues.length > 0 || !id || !name || !version || !gameVersion || !dependencies) {
    return { manifest: null, issues };
  }
  return { manifest: { id, name, version, gameVersion, dependencies }, issues };
}

/**
 * `expectedNamespace` je `id` z manifestu zdroje. Definice musí patřit svému
 * zdroji — jinak by mod mohl nechtěně přepsat cizí obsah.
 */
export function validateDefinition(
  raw: unknown,
  expectedNamespace: string,
): { definition: AnyDefinition | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const record = asRecord(raw);
  if (!record) {
    return { definition: null, issues: [{ field: '', message: 'definice musí být objekt' }] };
  }

  // Typ se čte **první**: podle něj se liší i seznam povolených sekcí, takže
  // grant validovaný jako budova by hlásil samé překlepy.
  const type = record['type'];
  if (type !== 'building' && type !== 'grant') {
    return {
      definition: null,
      issues: [{ field: 'type', message: 'podporováno je "building" a "grant"' }],
    };
  }

  const sections = type === 'grant' ? GRANT_SECTIONS : DEFINITION_SECTIONS;
  for (const key of Object.keys(record).sort()) {
    if (!sections.includes(key)) {
      issues.push({ field: key, message: 'neznámá sekce — překlep?' });
    }
  }

  const id = requireString(issues, record, 'id', 'id', DEFINITION_ID);
  if (id && !id.startsWith(`${expectedNamespace}:`)) {
    issues.push({
      field: 'id',
      message: `musí začínat namespace zdroje "${expectedNamespace}:"`,
    });
  }

  if (type === 'grant') return validateGrant(issues, record, id);

  const category = requireString(issues, record, 'category', 'category', NAMESPACE);
  let menu: string | undefined;
  if (record['menu'] !== undefined) {
    menu = requireString(issues, record, 'menu', 'menu', NAMESPACE) ?? undefined;
  }
  const name = requireString(issues, record, 'name', 'name', LOCALE_KEY);
  const description = requireString(issues, record, 'description', 'description', LOCALE_KEY);

  const footprint = validateFootprint(issues, record['footprint']);
  const level = record['level'] === undefined ? 1 : requireInt(issues, record, 'level', 'level', 1, MAX_LEVEL);
  const construction = validateConstruction(issues, record);
  const economy = validateEconomy(issues, record);
  const graphics = validateGraphics(issues, record);
  const power = validatePower(issues, record);
  const water = validateWater(issues, record);
  const sewage = validateSewage(issues, record);
  const transit = validateTransit(issues, record);
  const environment = validateEnvironment(issues, record);
  const population = validateCapacity(issues, record, 'population');
  const jobs = validateCapacity(issues, record, 'jobs');
  const service = validateService(issues, record);
  const nuisance = validateService(issues, record, 'nuisance');
  const waste = validateWaste(issues, record);
  const requirements = validateRequirements(issues, record);

  if (
    issues.length > 0 ||
    !id ||
    !category ||
    !name ||
    !description ||
    !footprint ||
    level === null ||
    !construction ||
    !economy ||
    !graphics
  ) {
    return { definition: null, issues };
  }

  return {
    definition: {
      id,
      type: 'building',
      category,
      ...(menu === undefined ? {} : { menu }),
      name,
      description,
      footprint,
      level,
      construction,
      economy,
      ...(population ? { population } : {}),
      ...(jobs ? { jobs } : {}),
      ...(service ? { service } : {}),
      ...(nuisance ? { nuisance } : {}),
      ...(waste ? { waste } : {}),
      ...(requirements ? { requirements } : {}),
      ...(power ? { power } : {}),
      ...(water ? { water } : {}),
      ...(sewage ? { sewage } : {}),
      ...(transit ? { transit } : {}),
      ...(environment ? { environment } : {}),
      graphics,
    },
    issues,
  };
}

function validateFootprint(
  issues: ValidationIssue[],
  raw: unknown,
): readonly [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) {
    issues.push({ field: 'footprint', message: 'musí být pole [šířka, výška]' });
    return null;
  }
  const holder = { w: raw[0], h: raw[1] };
  const w = requireInt(issues, holder, 'w', 'footprint[0]', 1, 16);
  const h = requireInt(issues, holder, 'h', 'footprint[1]', 1, 16);
  return w !== null && h !== null ? [w, h] : null;
}

function validateConstruction(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['construction'] | null {
  const section = requireRecord(issues, record, 'construction', 'construction');
  if (!section) return null;

  const cost = requireInt(issues, section, 'cost', 'construction.cost', 0);
  const requiresRoad = requireBoolean(issues, section, 'requiresRoad', 'construction.requiresRoad');
  const requiresPower = requireBoolean(
    issues,
    section,
    'requiresPower',
    'construction.requiresPower',
  );

  const rawTerrain = section['allowedTerrain'];
  let allowedTerrain: number[] | null = null;
  if (!Array.isArray(rawTerrain) || rawTerrain.length === 0) {
    issues.push({
      field: 'construction.allowedTerrain',
      message: 'musí být neprázdné pole hodnot vrstvy terrain',
    });
  } else {
    allowedTerrain = [];
    rawTerrain.forEach((value, i) => {
      if (typeof value !== 'number' || !TERRAIN_VALUES.has(value)) {
        issues.push({
          field: `construction.allowedTerrain[${i}]`,
          message: 'není platná hodnota vrstvy terrain',
        });
      } else {
        allowedTerrain?.push(value);
      }
    });
  }

  if (cost === null || requiresRoad === null || requiresPower === null || !allowedTerrain) {
    return null;
  }
  const requiresWater = optionalBoolean(
    issues,
    section,
    'requiresWater',
    'construction.requiresWater',
  );
  const nearWater = optionalBoolean(issues, section, 'nearWater', 'construction.nearWater');

  return {
    cost,
    requiresRoad,
    requiresPower,
    ...(requiresWater ? { requiresWater } : {}),
    ...(nearWater ? { nearWater } : {}),
    allowedTerrain,
  };
}

function validateEconomy(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['economy'] | null {
  const section = requireRecord(issues, record, 'economy', 'economy');
  if (!section) return null;
  const upkeep = requireInt(issues, section, 'upkeep', 'economy.upkeep', 0);
  return upkeep === null ? null : { upkeep };
}

function validateGraphics(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['graphics'] | null {
  const section = requireRecord(issues, record, 'graphics', 'graphics');
  if (!section) return null;
  const color = requireString(issues, section, 'color', 'graphics.color', COLOR);
  const heightLevels = requireInt(issues, section, 'heightLevels', 'graphics.heightLevels', 1, 15);

  let icon: string | undefined;
  if (section['icon'] !== undefined) {
    icon = requireString(issues, section, 'icon', 'graphics.icon', NAMESPACE) ?? undefined;
  }

  if (color === null || heightLevels === null) return null;
  return icon === undefined ? { color, heightLevels } : { color, heightLevels, icon };
}

/** Sekce `population` a `jobs` mají stejný tvar `{ capacity }`. */
function validateCapacity(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
  key: 'population' | 'jobs',
): { capacity: number } | undefined {
  if (record[key] === undefined) return undefined;
  const section = requireRecord(issues, record, key, key);
  if (!section) return undefined;
  const capacity = requireInt(issues, section, 'capacity', `${key}.capacity`, 0, 65535);
  return capacity === null ? undefined : { capacity };
}

function validateService(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
  field: 'service' | 'nuisance' = 'service',
): BuildingDefinition['service'] {
  if (record[field] === undefined) return undefined;
  const section = requireRecord(issues, record, field, field);
  if (!section) return undefined;

  const serviceClass = requireString(issues, section, 'class', `${field}.class`, NAMESPACE);
  // Dosah je v buňkách hrubé mřížky, ta má 32 buněk na stranu.
  const radius = requireInt(issues, section, 'radius', `${field}.radius`, 1, 32);
  const strength = requireInt(issues, section, 'strength', `${field}.strength`, 1, 255);

  return serviceClass !== null && radius !== null && strength !== null
    ? { class: serviceClass, radius, strength }
    : undefined;
}

function validateWaste(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['waste'] {
  if (record['waste'] === undefined) return undefined;
  const section = requireRecord(issues, record, 'waste', 'waste');
  if (!section) return undefined;

  const capacity = requireInt(issues, section, 'capacity', 'waste.capacity', 1, 65535);
  return capacity === null ? undefined : { capacity };
}

/**
 * Prerekvizity (§7). Obě části jsou volitelné, ale co je uvedené, musí mít
 * správný tvar — jinak by se překlep ve třídě služby projevil jako budova,
 * která nikdy nevyroste, a nikdo by nevěděl proč.
 */
function validateRequirements(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['requirements'] {
  if (record['requirements'] === undefined) return undefined;
  const section = requireRecord(issues, record, 'requirements', 'requirements');
  if (!section) return undefined;

  const services: Record<string, number> = {};
  if (section['services'] !== undefined) {
    const raw = requireRecord(issues, section, 'services', 'requirements.services');
    for (const key of Object.keys(raw ?? {}).sort()) {
      if (!NAMESPACE.test(key)) {
        issues.push({ field: `requirements.services.${key}`, message: 'není platné jméno třídy' });
        continue;
      }
      const value = requireInt(issues, raw ?? {}, key, `requirements.services.${key}`, 0, 255);
      if (value !== null) services[key] = value;
    }
  }

  const buildings: string[] = [];
  if (section['buildings'] !== undefined) {
    const raw = section['buildings'];
    if (!Array.isArray(raw)) {
      issues.push({ field: 'requirements.buildings', message: 'musí být pole id definic' });
    } else {
      raw.forEach((entry, i) => {
        if (typeof entry !== 'string' || !DEFINITION_ID.test(entry)) {
          issues.push({
            field: `requirements.buildings[${i}]`,
            message: 'musí být id definice s namespace',
          });
        } else {
          buildings.push(entry);
        }
      });
    }
  }

  return { services, buildings };
}

function validatePower(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['power'] {
  if (record['power'] === undefined) return undefined;
  const section = requireRecord(issues, record, 'power', 'power');
  if (!section) return undefined;
  const production = optionalInt(issues, section, 'production', 'power.production', 0);
  const consumption = optionalInt(issues, section, 'consumption', 'power.consumption', 0);
  if (production === undefined && consumption === undefined) {
    issues.push({ field: 'power', message: 'musí mít production nebo consumption' });
  }
  return {
    ...(production !== undefined ? { production } : {}),
    ...(consumption !== undefined ? { consumption } : {}),
  };
}

function validateWater(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['water'] {
  if (record['water'] === undefined) return undefined;
  const section = requireRecord(issues, record, 'water', 'water');
  if (!section) return undefined;

  const production = optionalInt(issues, section, 'production', 'water.production', 0);
  const consumption = optionalInt(issues, section, 'consumption', 'water.consumption', 0);
  const range = optionalInt(issues, section, 'range', 'water.range', 0);

  if (production === undefined && consumption === undefined && range === undefined) {
    issues.push({ field: 'water', message: 'musí mít production, consumption nebo range' });
  }

  return {
    ...(production !== undefined ? { production } : {}),
    ...(consumption !== undefined ? { consumption } : {}),
    ...(range !== undefined ? { range } : {}),
  };
}

function validateSewage(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['sewage'] {
  if (record['sewage'] === undefined) return undefined;
  const section = requireRecord(issues, record, 'sewage', 'sewage');
  if (!section) return undefined;

  const capacity = requireInt(issues, section, 'capacity', 'sewage.capacity', 0);
  return capacity === null ? undefined : { capacity };
}

/**
 * Grant. Kontroluje se **tvar podmínky**, ne jméno veličiny.
 *
 * Neznámá veličina se pozná až za běhu, kdy se na ni nikdo neumí zeptat —
 * a to je záměr: mod si smí přidat vlastní veličinu a hra ji nesmí odmítnout
 * jen proto, že o ní neví. Chybějící `amount` nebo `atLeast` je ale překlep,
 * ne rozšíření, a tichý grant za nula korun nikdo neodhalí.
 */
function validateGrant(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
  id: string | null,
): { definition: AnyDefinition | null; issues: ValidationIssue[] } {
  const name = requireString(issues, record, 'name', 'name', LOCALE_KEY);
  const description = requireString(issues, record, 'description', 'description', LOCALE_KEY);
  const amount = requireInt(issues, record, 'amount', 'amount', 1);

  const section = requireRecord(issues, record, 'condition', 'condition');
  const metric = section
    ? requireString(issues, section, 'metric', 'condition.metric', NAMESPACE)
    : null;
  const atLeast = section
    ? requireInt(issues, section, 'atLeast', 'condition.atLeast', 0)
    : null;

  let definitionId: string | undefined;
  if (section && section['definitionId'] !== undefined) {
    definitionId =
      requireString(issues, section, 'definitionId', 'condition.definitionId', DEFINITION_ID) ??
      undefined;
  }

  let forTicks: number | undefined;
  if (section && section['forTicks'] !== undefined) {
    forTicks = requireInt(issues, section, 'forTicks', 'condition.forTicks', 1) ?? undefined;
  }

  if (issues.length > 0 || !id || !name || !description || amount === null || !metric || atLeast === null) {
    return { definition: null, issues };
  }

  return {
    definition: {
      id,
      type: 'grant',
      name,
      description,
      amount,
      condition: {
        metric,
        atLeast,
        ...(definitionId !== undefined ? { definitionId } : {}),
        ...(forTicks !== undefined ? { forTicks } : {}),
      },
    },
    issues,
  };
}

function validateTransit(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['transit'] {
  if (record['transit'] === undefined) return undefined;
  const section = requireRecord(issues, record, 'transit', 'transit');
  if (!section) return undefined;

  const mode = requireString(issues, section, 'mode', 'transit.mode');
  return mode === null ? undefined : { mode };
}

function validateEnvironment(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
): BuildingDefinition['environment'] {
  if (record['environment'] === undefined) return undefined;
  const section = requireRecord(issues, record, 'environment', 'environment');
  if (!section) return undefined;
  const pollution = optionalInt(issues, section, 'pollution', 'environment.pollution', 0, 255);
  return pollution !== undefined ? { pollution } : {};
}
