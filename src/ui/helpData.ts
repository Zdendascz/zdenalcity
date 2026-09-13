import type { BuildingDefinition } from '@/content/schema';
import { terrainNameKey } from '@/sim/layers';

/**
 * Podklad pro nápovědu: **co se dá o stavbě a o problému říct z dat**.
 *
 * Čistý modul bez DOM, protože jádro nápovědy je převod dat na věty, ne
 * kreslení. Díky tomu se dá testem ohlídat to, co se ohlídat má: že žádná
 * stavba nezůstane bez popisu a že každý popisek má překlad (§10).
 *
 * **Proč se to počítá z definic a nepíše ručně.** Autor si vyžádal, aby
 * nápověda uměla „každou budovu: co dělá, co žere, co přináší". Ručně psaný
 * seznam by zastaral první změnou balance a nikdo by si toho nevšiml — tenhle
 * se změní s daty. Text zůstává v locale, tady jsou jen klíče a čísla (P5).
 */

/** Jeden údaj: klíč popisku a hotová hodnota. */
export interface HelpFact {
  /** Lokalizační klíč popisku, např. `ui.help.fact.cost`. */
  key: string;
  /**
   * Hodnota už jako text. Čísla se formátují u volajícího, protože jazyk
   * rozhoduje o oddělovači tisíců.
   */
  value: string;
}

/** Co stavba potřebuje, co dává a co bere. Tři sloupce, ne jeden seznam. */
export interface BuildingFacts {
  needs: HelpFact[];
  gives: HelpFact[];
  takes: HelpFact[];
}

/** Překladač jmen: pro terén, třídy služeb a jména jiných staveb. */
export type Name = (key: string) => string;

function fact(key: string, value: string | number): HelpFact {
  return { key, value: typeof value === 'number' ? String(value) : value };
}

/**
 * Rozebere definici na tři sloupce údajů.
 *
 * Pořadí v každém sloupci je pevné a jde od toho, co hráč řeší nejčastěji:
 * u „potřebuje" je to silnice a sítě, u „dává" pokrytí a kapacita, u „bere"
 * peníze. Prázdný sloupec se nevrací jako `null` — vrací se prázdné pole a
 * rozhoduje se až při vykreslení.
 */
export function buildingFacts(definition: BuildingDefinition, name: Name): BuildingFacts {
  const needs: HelpFact[] = [];
  const gives: HelpFact[] = [];
  const takes: HelpFact[] = [];

  const [width, depth] = definition.footprint;
  needs.push(fact('ui.help.fact.footprint', `${width} × ${depth}`));

  if (definition.construction.requiresRoad) needs.push(fact('ui.help.fact.road', ''));
  if (definition.construction.requiresPower) needs.push(fact('ui.help.fact.power', ''));
  if (definition.construction.requiresWater === true) needs.push(fact('ui.help.fact.water', ''));
  if (definition.construction.nearWater === true) needs.push(fact('ui.help.fact.shore', ''));
  // Svah se hlásí jen tam, kde je to výjimka: většina staveb rovinu potřebuje,
  // a psát to u každé by ze seznamu udělalo šum.
  if (definition.construction.allowsSlope === true) needs.push(fact('ui.help.fact.slope', ''));

  needs.push(
    fact('ui.help.fact.terrain', definition.construction.allowedTerrain.map(nameOfTerrain).join(', ')),
  );

  for (const [serviceClass, level] of Object.entries(definition.requirements?.services ?? {})) {
    needs.push(fact('ui.help.fact.needsService', `${name(`ui.service.${serviceClass}`)} ${level}`));
  }
  for (const id of definition.requirements?.buildings ?? []) {
    needs.push(fact('ui.help.fact.needsBuilding', name(`building.${plain(id)}.name`)));
  }

  if ((definition.population?.capacity ?? 0) > 0) {
    gives.push(fact('ui.help.fact.homes', definition.population?.capacity ?? 0));
  }
  if ((definition.jobs?.capacity ?? 0) > 0) {
    gives.push(fact('ui.help.fact.jobs', definition.jobs?.capacity ?? 0));
  }
  if (definition.service) {
    gives.push(
      fact(
        'ui.help.fact.service',
        `${name(`ui.service.${definition.service.class}`)} — ${name('ui.help.fact.radius')} ` +
          `${definition.service.radius}, ${name('ui.help.fact.strength')} ${definition.service.strength}`,
      ),
    );
  }
  if ((definition.power?.production ?? 0) > 0) {
    gives.push(fact('ui.help.fact.powerOut', definition.power?.production ?? 0));
  }
  if ((definition.water?.production ?? 0) > 0) {
    gives.push(fact('ui.help.fact.waterOut', definition.water?.production ?? 0));
  }
  if ((definition.water?.range ?? 0) > 0) {
    gives.push(fact('ui.help.fact.waterRange', definition.water?.range ?? 0));
  }
  if ((definition.waste?.capacity ?? 0) > 0) {
    gives.push(fact('ui.help.fact.waste', definition.waste?.capacity ?? 0));
  }
  if ((definition.sewage?.capacity ?? 0) > 0) {
    gives.push(fact('ui.help.fact.sewage', definition.sewage?.capacity ?? 0));
  }
  if (definition.transit) {
    gives.push(fact('ui.help.fact.transit', name(`ui.transit.mode.${definition.transit.mode}`)));
  }

  takes.push(fact('ui.help.fact.cost', definition.construction.cost));
  takes.push(fact('ui.help.fact.upkeep', definition.economy.upkeep));
  if ((definition.power?.consumption ?? 0) > 0) {
    takes.push(fact('ui.help.fact.powerIn', definition.power?.consumption ?? 0));
  }
  if ((definition.water?.consumption ?? 0) > 0) {
    takes.push(fact('ui.help.fact.waterIn', definition.water?.consumption ?? 0));
  }
  if ((definition.environment?.pollution ?? 0) > 0) {
    takes.push(fact('ui.help.fact.pollution', definition.environment?.pollution ?? 0));
  }
  if (definition.nuisance) {
    takes.push(
      fact(
        'ui.help.fact.nuisance',
        // Jméno obtěže bere z rozboru parcely (`ui.parcel.term.*`), ne z nové
        // rodiny klíčů: je to totéž slovo a hráč ho už zná odtamtud.
        `${name(`ui.parcel.term.${definition.nuisance.class}`)} — ${name('ui.help.fact.radius')} ` +
          `${definition.nuisance.radius}, ${name('ui.help.fact.strength')} ${definition.nuisance.strength}`,
      ),
    );
  }

  return { needs, gives, takes };

  function nameOfTerrain(terrain: number): string {
    return name(terrainNameKey(terrain));
  }
}

/** `vanilla:water_works` → `water_works`. Locale klíče jmenují budovu bez namespace. */
function plain(id: string): string {
  const colon = id.indexOf(':');
  return colon < 0 ? id : id.slice(colon + 1);
}

/**
 * Problémy, na které hráč ve hře narazí, v pořadí „od nejčastějšího".
 *
 * Každý má v locale trojici `ui.help.problem.<id>.title`, `.cause` a `.fix` —
 * co to je, proč se to děje a co s tím. Autor to zadal přesně takhle: „každý
 * problém: co jej způsobuje, co jej řeší."
 *
 * Seznam **musí pokrýt všechny důvody, kterými hra zastaví růst parcely**
 * (`ui.parcel.blocked.*` z `sim/diagnostics.ts`) — hlídá to test, takže nová
 * překážka v kódu si vynutí i odstavec v nápovědě.
 */
export const HELP_PROBLEMS: readonly string[] = [
  'noZone',
  'noDemand',
  'tooFarFromRoad',
  'zoneTooSmall',
  'needsWater',
  'needsPower',
  'rubble',
  'bankrupt',
  'noDefinition',
  'notFlat',
  'terrain',
  'abandoned',
  'pollution',
  'crime',
  'traffic',
  'unhappy',
  'blackout',
  'noWaterReach',
  'waste',
  'growth',
  'fire',
  'services',
];

/**
 * Ke kterému odstavci nápovědy patří která hláška hry.
 *
 * Díky téhle tabulce vede cesta z rozboru parcely rovnou do nápovědy: hráč
 * čte „chybí voda" a nápověda mu na totéž slovo odpoví, co s tím. Klíč je
 * hláška hry, hodnota je id problému.
 */
export const PROBLEM_BY_REASON: Readonly<Record<string, string>> = {
  'ui.parcel.blocked.noZone': 'noZone',
  'ui.parcel.blocked.noDemand': 'noDemand',
  'ui.parcel.blocked.tooFarFromRoad': 'tooFarFromRoad',
  'ui.parcel.blocked.zoneTooSmall': 'zoneTooSmall',
  'ui.parcel.blocked.bankrupt': 'bankrupt',
  'ui.parcel.blocked.noDefinition': 'noDefinition',
  'error.rubbleInTheWay': 'rubble',
  'error.needsWater': 'needsWater',
  'error.needsPower': 'needsPower',
  'error.notFlat': 'notFlat',
  'error.terrainNotAllowed': 'terrain',
};
