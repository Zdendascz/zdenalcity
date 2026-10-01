import type { Balance } from '@/content/balance';
import { coarseCellsOf, coarseIndex } from './coarse';
import { index, ROAD, TERRAIN, WIRE, ZONE } from './layers';
import { coarseTerrainShare } from './terrain';
import { floodPerCell } from './disasters/flood';
import { hasRubble, rubblePerCell } from './disasters/rubble';
import { categoryForZone } from './rci';
import type { RciCategory } from './rci';
import { checkFootprint } from './buildings';
import type { BuildingCatalogue } from './catalogue';
import { seedDefinitions } from './levels';
import { roadReach } from './systems/growth';
import { waterProximity } from './systems/landValue';
import { roadTilesInOrder } from './world';
import type { WorldState } from './world';
import { roadCapacityFactor } from './transit';
import { happinessDemandFactor } from './systems/happiness';
import { industrialBase, residentialBase } from './systems/demand';

/**
 * Diagnostika parcely (§12 zadání fáze 2).
 *
 * Fáze 2 přidala pět neviditelných veličin. Bez rozpisu vidí hráč jen to, že
 * mu město chátrá, a nedozví se proč — proto je tenhle soubor podle zadání
 * stejně důležitý jako simulace.
 *
 * Vrací **čísla, ne texty**: `sim/` nesmí znát řetězce (§10), překlad si udělá UI.
 */

/**
 * Vstupy ceny půdy, které se počítají pro celou mapu naráz.
 *
 * Systém i diagnostika si ho spočítají jednou a předají do každé buňky —
 * jinak by průchod terénem probíhal tisíckrát za běh.
 */
export interface LandValueContext {
  /** 1 = buňka sousedí s vodou. */
  water: Uint8Array;
  /** Podíl buňky pokrytý lesem, 0–1. */
  forest: Float32Array;
  sand: Float32Array;
  /** Průměrné vytížení silnic v buňce, 0 = volno, 1 = na kapacitě (§5 fáze 3). */
  congestion: Float32Array;
  /**
   * Třídy služeb, které do ceny půdy mluví: jméno, mapa pokrytí a váha.
   * Setříděné, aby rozpis v panelu neposkakoval podle pořadí v mapě.
   */
  services: [string, Readonly<Uint8Array>, number][];
  /** Kolik dlaždic trosek leží v buňce (R15). */
  rubble: Float32Array;
  /** Podíl buňky pod vodou, 0–1 (§5 fáze 4). */
  flood: Float32Array;
}

export function landValueContext(world: WorldState, balance: Balance): LandValueContext {
  // Pevné pořadí tříd, ať rozpis neposkakuje podle historie vkládání do mapy.
  // Počítá se **jednou za běh**, ne pro každou buňku: kopírovat a třídit klíče
  // šestnáctkrát tisíckrát bylo znát víc než celý zbytek vzorce.
  const services: [string, Readonly<Uint8Array>, number][] = [];
  for (const serviceClass of [...world.coverage.keys()].sort()) {
    const weight = balance.landValue.weights[serviceClass];
    const coverage = world.coverage.get(serviceClass);
    if (weight === undefined || !coverage) continue;
    services.push([serviceClass, coverage, weight]);
  }

  return {
    water: waterProximity(world),
    forest: coarseTerrainShare(world, TERRAIN.forest),
    sand: coarseTerrainShare(world, TERRAIN.sand),
    congestion: coarseCongestion(world, balance),
    services,
    rubble: rubblePerCell(world),
    flood: floodPerCell(world),
  };
}

/**
 * Vytížení silnic přenesené na hrubou mřížku.
 *
 * Průměruje se **přes silniční dlaždice v buňce**, ne přes všech šestnáct:
 * jedna ucpaná ulice uprostřed pole není „šestnáctina problému", ale problém.
 * Buňka bez silnice má nulu.
 */
export function coarseCongestion(
  world: WorldState,
  balance: Balance,
): Float32Array {
  const cells = coarseCellsOf(world.size);
  const total = new Float32Array(cells);
  const counts = new Float32Array(cells);

  // Kolony jsou vlastnost silnic, tak se prochází seznam silnic (R20 fáze 4).
  // Průchod celou mapou tady byl nejdražší kus spokojenosti: ta se počítá
  // z kolon a na 512 × 512 stála 8,9 ms na jeden běh. V pořadí dlaždic,
  // protože se sčítají desetinná čísla (T132, `roadTilesInOrder`).
  for (const tile of roadTilesInOrder(world)) {
    const roadType = world.layers.road[tile] ?? ROAD.none;
    if (roadType === ROAD.none) continue;

    // Kolej ukusuje z vozovky (§7 fáze 4). Tramvaj je jediná, která do
    // dopravního modelu zasahuje záporně — bez toho by nebyl důvod volit
    // autobus. Zbytek kapacity je nikdy nulový, mód má strop 0,9.
    const capacity =
      (balance.traffic.roadTypes[roadType - 1]?.capacity ?? 0) * roadCapacityFactor(world, tile);
    if (capacity <= 0) continue;

    const x = tile % world.size;
    const y = (tile - x) / world.size;
    const cell = coarseIndex(x, y, world.size);
    total[cell] = (total[cell] ?? 0) + Math.min(2, (world.trafficLoad[tile] ?? 0) / capacity);
    counts[cell] = (counts[cell] ?? 0) + 1;
  }

  for (let cell = 0; cell < total.length; cell++) {
    const count = counts[cell] ?? 0;
    total[cell] = count === 0 ? 0 : (total[cell] ?? 0) / count;
  }

  return total;
}

/** Jeden sčítanec ceny půdy. `amount` už je se znaménkem. */
export interface LandValueTerm {
  /** `base`, `water`, `pollution`, `crime`, nebo jméno třídy služby. */
  source: string;
  /** Vstupní hodnota — pokrytí, znečištění, kriminalita. */
  input: number;
  weight: number;
  amount: number;
}

export interface LandValueExplanation {
  terms: LandValueTerm[];
  /** Součet sčítanců, tedy hodnota, ke které se cena půdy blíží. */
  raw: number;
  /** Co ve vrstvě opravdu je; kvůli vyhlazení se k `raw` teprve dobírá. */
  current: number;
}

/**
 * Rozpad ceny půdy v jedné buňce.
 *
 * **Používá ho i `landValueSystem`**, aby existoval jediný vzorec. Kdyby si
 * diagnostika počítala vlastní, dřív nebo později by ukazovala něco jiného,
 * než podle čeho se hraje.
 */
export function explainLandValue(
  world: WorldState,
  balance: Balance,
  cell: number,
  context: LandValueContext,
): LandValueExplanation {
  const terms: LandValueTerm[] = [];
  return {
    terms,
    raw: landValueRaw(world, balance, cell, context, terms),
    current: world.coarse.landValue[cell] ?? 0,
  };
}

/**
 * Surová cena půdy v jedné buňce. **Jediný vzorec v celé hře.**
 *
 * `collect` je volitelný sběrač sčítanců pro panel parcely. Když je `null`,
 * nevznikne ani jeden objekt — a přesně tak to volá `landValueSystem`, který
 * tenhle výpočet dělá pro každou buňku hrubé mřížky. Dokud se sčítance
 * alokovaly vždycky, stálo šestnáct tisíc buněk velké mapy víc než všechno
 * ostatní dohromady.
 *
 * Rozdělit to na „rychlou" a „vysvětlující" verzi by znamenalo dva vzorce a
 * dřív nebo později dvě různá čísla — jedno pro hru, druhé pro hráče.
 */
export function landValueRaw(
  world: WorldState,
  balance: Balance,
  cell: number,
  context: LandValueContext,
  collect: LandValueTerm[] | null,
): number {
  const { base, waterBonus, weights } = balance.landValue;

  let raw = base;
  collect?.push({ source: 'base', input: 1, weight: base, amount: base });

  if (context.water[cell] === 1) {
    raw += waterBonus;
    collect?.push({ source: 'water', input: 1, weight: waterBonus, amount: waterBonus });
  }

  // Kolony cenu půdy srážejí (§5 fáze 3). Vzniká tím záporná zpětná vazba:
  // dražší půda → vyšší úrovně → hustší zástavba → víc dopravy → kolony →
  // levnější půda. Město se přestane zahušťovat, dokud hráč nezlepší dopravu.
  const congestion = context.congestion[cell] ?? 0;
  if (congestion > 0) {
    const weight = weights['congestion'] ?? 0;
    if (weight !== 0) {
      raw -= congestion * weight;
      collect?.push({
        source: 'congestion',
        input: congestion,
        weight,
        amount: -congestion * weight,
      });
    }
  }

  // Terén se do ceny půdy počítá podílem buňky, kterou zabírá. Les ji zvedá,
  // dokud stojí — vykácení je tím pádem volba, ne samozřejmost (§2).
  //
  // Rozepsané po jednom, ne smyčkou přes pole dvojic: takové pole by se
  // alokovalo pro **každou buňku** hrubé mřížky, a to je na velké mapě
  // šestnáct tisíc zbytečných polí při každém běhu ceny půdy.
  raw += addShare(collect, 'forest', context.forest[cell] ?? 0, weights['forest'] ?? 0);
  raw += addShare(collect, 'sand', context.sand[cell] ?? 0, weights['sand'] ?? 0);

  const services = context.services;
  for (let i = 0; i < services.length; i++) {
    const entry = services[i];
    if (!entry) continue;
    const input = entry[1][cell] ?? 0;
    if (input === 0) continue;
    raw += input * entry[2];
    collect?.push({
      source: entry[0],
      input,
      weight: entry[2],
      amount: input * entry[2],
    });
  }

  // Trosky srážejí cenu půdy stejně jako ruiny (R15). Sčítanec je vlastní, ne
  // schovaný v kriminalitě: hráč musí v rozpisu vidět, že mu čtvrť táhne dolů
  // neuklizená suť, jinak by nevěděl, co s tím.
  const rubble = context.rubble[cell] ?? 0;
  if (rubble > 0) {
    const perTile = balance.disasters.rubble.landValuePenalty / 16;
    const amount = Math.min(balance.disasters.rubble.landValuePenalty, rubble * perTile);
    raw -= amount;
    collect?.push({ source: 'rubble', input: rubble, weight: perTile, amount: -amount });
  }

  // Zaplavená čtvrť je neprodejná, dokud voda neopadne. Sčítanec je dočasný:
  // jakmile voda zmizí, cena se sama vrátí — na rozdíl od trosek, které musí
  // hráč uklidit.
  const flooded = context.flood[cell] ?? 0;
  if (flooded > 0) {
    const amount = flooded * balance.disasters.flood.landValuePenalty;
    raw -= amount;
    collect?.push({
      source: 'flood',
      input: flooded,
      weight: balance.disasters.flood.landValuePenalty,
      amount: -amount,
    });
  }

  raw -= addPenalty(collect, 'pollution', world.coarse.pollution[cell] ?? 0, weights['pollution'] ?? 0);
  raw -= addPenalty(collect, 'crime', world.coarse.crime[cell] ?? 0, weights['crime'] ?? 0);

  return raw;
}

/** Kladný sčítanec. Vrací příspěvek a případně ho zapíše do rozpisu. */
function addShare(
  collect: LandValueTerm[] | null,
  source: string,
  input: number,
  weight: number,
): number {
  if (input === 0 || weight === 0) return 0;
  collect?.push({ source, input, weight, amount: input * weight });
  return input * weight;
}

/** Záporný sčítanec. Vrací **kladnou** velikost srážky; volající ji odečte. */
function addPenalty(
  collect: LandValueTerm[] | null,
  source: string,
  input: number,
  weight: number,
): number {
  if (input === 0) return 0;
  collect?.push({ source, input, weight, amount: -input * weight });
  return input * weight;
}

/** Co hráči brání ve stavbě na téhle parcele, nebo co ji naopak žene nahoru. */
export interface ParcelExplanation {
  x: number;
  y: number;
  terrain: number;
  /**
   * Typ silnice **na téhle dlaždici**, ne u nejbližší. Nula znamená „tady
   * silnice není" a je to jiná informace než `roadDistance`.
   */
  road: number;
  zone: number;
  category: RciCategory | null;
  /** Vzdálenost k nejbližší silnici; `null` znamená „dál, než kam růst sahá". */
  roadDistance: number | null;
  /** Násobitel skóre podle té vzdálenosti. Nula = parcela z losu vypadne. */
  roadFactor: number;
  /**
   * Násobitel skóre za dostupnost práce v této čtvrti a celoměstský násobitel
   * rychlosti růstu (R6). Jedničky znamenají „nebrzdí to“.
   */
  jobAccessFactor: number;
  cityJobAccessFactor: number;
  /**
   * Je pod parcelou voda? Bez ní tu nevyroste **nic** (§8 fáze 3) a je to
   * nejčastější důvod, proč zóna zůstane prázdná i s dobrou silnicí, proudem
   * i poptávkou. Neviditelná podmínka, takže patří do panelu (§12).
   */
  water: boolean;
  /**
   * Dojde sem proud? Stejně neviditelná podmínka jako voda: blok bez vedení
   * nebo s přetíženou přípojkou vypadá na mapě úplně stejně (hlásil autor).
   */
  power: boolean;
  /**
   * Parcela proud **nevede**, protože na ní stojí opuštěná budova nebo suť
   * (T129). Hráč pak vidí vedení hned vedle a nechápe, proč tu proud není
   * (hlásil autor) — je potřeba mu říct, že musí zbourat.
   */
  powerBlockedByRuin: boolean;
  /** K síti připojená, ale proud nestačí — úzké hrdlo je jinde (T137). */
  powerStarved: boolean;
  /**
   * Vedení na dlaždici a jak je vytížené (T136): „ať člověk ví co a jak".
   * `null`, když tu vedení není.
   */
  wire: ParcelWire | null;
  pollution: number;
  crime: number;
  /** Spokojenost v této čtvrti, 0–255. Kdo ji nevidí, neví, co spravit (§12). */
  happiness: number;
  landValue: LandValueExplanation;
  /** Pokrytí všech tříd, které ve městě existují. */
  coverage: { serviceClass: string; value: number }[];
  /** Poptávka po kategorii zóny; `null` mimo zónu. */
  demand: number | null;
  /** Práh povýšení na další úroveň a úleva za poptávku (§8). */
  levels: { nextThreshold: number | null; demandRelief: number };
}

/**
 * Proč na téhle parcele nic nevyroste. `null` znamená „nic nebrání".
 *
 * Ptá se **týmiž funkcemi jako růst**, ne vlastní kopií podmínek — jinak by
 * panel časem začal tvrdit něco jiného, než co se doopravdy děje. Vrací rovnou
 * lokalizační klíč chyby, takže hráč čte tutéž větu jako při ruční stavbě.
 *
 * Vzniklo to po hraní: autor měl zónu u silnice, vodu i proud, kasu v plusu —
 * a nerostlo nic, protože parcela byla na svahu. Hra o tom mlčela a nedalo se
 * to nikde zjistit.
 */
export function growthBlocker(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  x: number,
  y: number,
): string | null {
  const tile = index(x, y, world.size);
  if (world.layers.buildingId[tile] !== 0) return null; // stojí tu budova
  if ((world.layers.road[tile] ?? 0) !== 0) return null; // vozovka, ne parcela

  const zone = world.layers.zone[tile] ?? ZONE.none;
  const category = categoryForZone(zone);
  if (category === null) return 'ui.parcel.blocked.noZone';

  // Trosky se hlásí hned za zónou, dřív než dosah silnice: hromada suti je
  // konkrétní věc, se kterou hráč umí něco udělat, kdežto rada „je to daleko
  // od silnice" by ho poslala stavět tam, kde stejně nic nevyroste.
  if (hasRubble(world, tile)) return 'error.rubbleInTheWay';

  // Bankrot zastaví růst v celém městě (§9 fáze 2).
  if (world.economy.funds < 0) return 'ui.parcel.blocked.bankrupt';
  if (world.demand[category] <= 0) return 'ui.parcel.blocked.noDemand';

  const reach = roadReach(world, balance.growth.roadFactors.length - 1);
  const distance = reach[tile] ?? 255;
  if ((balance.growth.roadFactors[distance] ?? 0) === 0) return 'ui.parcel.blocked.tooFarFromRoad';

  // Zbytek řeší tatáž kontrola, kterou pouští růst. Stačí, aby prošla jediná
  // z nejmenších budov kategorie — přesně tak si vybírá i on.
  const options = seedDefinitions(catalogue, category);
  if (options.length === 0) return 'ui.parcel.blocked.noDefinition';

  let first: string | null = null;
  for (const definition of options) {
    // Rovina se nekontroluje: dům ze zóny stojí i na svahu (T41), jen se tam
    // staví méně ochotně. Kdyby se tu kontrolovala, panel by hlásil překážku,
    // která žádná není.
    const result = checkFootprint(world, definition, x, y, {
      requireZone: zone,
      skipRoadCheck: true,
      skipFlatCheck: true,
    });
    if (result.ok) return null;
    // `error.wrongZone` by hráče poslal špatným směrem: zónu vyznačil správně,
    // jen je **mělčí, než co se do ní vejde**. Kontrola dostala `requireZone`
    // z téhle dlaždice, takže neshoda může být jedině na některé další dlaždici
    // půdorysu. Nahlásil to autor — `industrial_small` má 2×2 a v jednořadé
    // zóně nevyroste nikdy nic, přičemž hra o tom mlčela.
    first ??=
      result.reason === 'error.wrongZone' ? 'ui.parcel.blocked.zoneTooSmall' : result.reason;
  }
  return first;
}

/**
 * Jak daleko se parcela dostala, než ji něco zastavilo.
 *
 * Podmínky se kontrolují v pořadí a **poslední z nich je ta zajímavá**: parcela
 * bez zóny nebo bez silnice je ještě daleko, kdežto ta, které chybí jen rovina,
 * je krok od hotova. Když se má hráči hlásit jediná věta, musí to být o téhle.
 *
 * Nejčastější důvod je špatné měřítko: velká zóna daleko od silnice přehlasuje
 * pár parcel u vozovky, které skoro staví — a hráč dostane radu o něčem, co ho
 * netrápí.
 */
const BLOCKER_DEPTH: Readonly<Record<string, number>> = {
  'ui.parcel.blocked.noZone': 1,
  'ui.parcel.blocked.noDemand': 2,
  'ui.parcel.blocked.tooFarFromRoad': 3,
  'error.rubbleInTheWay': 4,
  'error.wrongZone': 4,
  'error.terrainNotAllowed': 5,
  'error.notFlat': 6,
  'error.needsWater': 7,
};

/**
 * Ze sady důvodů vybere ten, který stojí za nahlášení.
 *
 * Bankrot přebíjí všechno: zastavuje růst v celém městě, takže radit hráči, ať
 * někde srovná terén, by bylo k ničemu.
 */
export function worstBlocker(reasons: Iterable<string>): string | null {
  let worst: string | null = null;
  let depth = -1;

  for (const reason of reasons) {
    if (reason === 'ui.parcel.blocked.bankrupt') return reason;
    const value = BLOCKER_DEPTH[reason] ?? 4;
    if (value > depth) {
      depth = value;
      worst = reason;
    }
  }

  return worst;
}

export interface ParcelWire {
  /** `WIRE.low` nebo `WIRE.high`. */
  type: number;
  /** Kolik přes úsek teče (u přetíženého: kolik by teklo). */
  load: number;
  capacity: number;
  /** Došel sem proud? */
  live: boolean;
  overloaded: boolean;
}

function parcelWire(world: WorldState, balance: Balance, tile: number): ParcelWire | null {
  const type = world.layers.wire[tile] ?? WIRE.none;
  if (type === WIRE.none) return null;
  return {
    type,
    load: Math.round(world.wireLoad[tile] ?? 0),
    capacity: balance.power.wires[type - 1]?.capacity ?? 0,
    live: (world.wireLive[tile] ?? 0) === 1,
    overloaded: (world.wireOverloaded[tile] ?? 0) === 1,
  };
}

export function explainParcel(
  world: WorldState,
  balance: Balance,
  x: number,
  y: number,
): ParcelExplanation {
  const tile = index(x, y, world.size);
  const cell = coarseIndex(x, y, world.size);
  const zone = world.layers.zone[tile] ?? ZONE.none;
  const category = categoryForZone(zone);

  // Průchod mapou, ale děje se to na kliknutí hráče, ne v tiku.
  const building = world.buildings.get(world.layers.buildingId[tile] ?? 0);
  const level = building?.level ?? 0;

  const reach = roadReach(world, balance.growth.roadFactors.length - 1);
  const distance = reach[tile] ?? 255;
  const roadFactor = balance.growth.roadFactors[distance] ?? 0;

  const demand = category === null ? null : world.demand[category];
  const relief =
    demand === null
      ? 0
      : (Math.max(0, Math.min(demand, balance.demand.limit)) / balance.demand.limit) *
        balance.levels.demandRelief;

  return {
    x,
    y,
    terrain: world.layers.terrain[tile] ?? TERRAIN.grass,
    road: world.layers.road[tile] ?? 0,
    zone,
    category,
    roadDistance: roadFactor > 0 ? distance : null,
    roadFactor,
    jobAccessFactor: world.jobAccessCells[cell] ?? 1,
    cityJobAccessFactor: world.cityJobAccess,
    water: world.waterSupply[tile] === 1,
    power: world.layers.power[tile] === 1,
    wire: parcelWire(world, balance, tile),
    powerStarved: (world.powerStarved[tile] ?? 0) === 1,
    powerBlockedByRuin:
      (world.rubble[tile] ?? 0) !== 0 ||
      world.buildings.get(world.layers.buildingId[tile] ?? 0)?.abandoned === true,
    pollution: world.coarse.pollution[cell] ?? 0,
    crime: world.coarse.crime[cell] ?? 0,
    happiness: world.happiness[cell] ?? 0,
    landValue: explainLandValue(world, balance, cell, landValueContext(world, balance)),
    coverage: [...world.coverage.keys()]
      .sort()
      .map((serviceClass) => ({
        serviceClass,
        value: world.coverage.get(serviceClass)?.[cell] ?? 0,
      })),
    demand,
    // Práh té úrovně, na kterou se tu dá dostat: u stojící budovy další, na
    // prázdné parcele ten pro první povýšení.
    levels: {
      nextThreshold: balance.levels.thresholds[Math.max(1, level) + 1] ?? null,
      demandRelief: relief,
    },
  };
}

/**
 * Kam srovnat kameru, když se ohlásí katastrofa.
 *
 * Není to vždycky místo, kde vznikla. **Zemětřesení má epicentrum kdekoli, i
 * v pustině** — otřes se roznese po celé mapě, takže na epicentru není co
 * vidět. Hráč to nahlásil: „notifikace přijde, ale vždy mi to ukáže místo
 * zásahu mimo město."
 *
 * Pravidlo je proto **„ukaž, kde to bolí"**, a je jedno pro všechny druhy:
 *
 * 1. Když je u vzniku něco živého — dům, silnice, oheň nebo voda — je to místo
 *    správně. Hromadná nehoda na křižovatce i lesní požár v lese sem spadnou.
 * 2. Jinak se hledá **nejbližší škoda**: hořící nebo zaplavená dlaždice.
 * 3. A když ani ta není, ukáže se **těžiště města**. Tam se hráč stejně dívá.
 *
 * Prochází se celá mapa, ale jen jednou za ohlášení, ne každý tik.
 */
export function alertTarget(
  world: WorldState,
  x: number,
  y: number,
): { x: number; y: number } {
  if (somethingAt(world, x, y, ALERT_NEAR)) return { x, y };

  const damage = nearestDamage(world, x, y);
  if (damage) return damage;

  return cityCentre(world) ?? { x, y };
}

/** Jak daleko od vzniku se ještě hledá, jestli tam vůbec něco je. */
const ALERT_NEAR = 6;

/** Stojí, jezdí, hoří nebo teče v okolí té dlaždice něco? */
function somethingAt(world: WorldState, x: number, y: number, reach: number): boolean {
  const size = world.size;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
      const tile = index(tx, ty, size);
      if ((world.layers.buildingId[tile] ?? 0) !== 0) return true;
      if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) return true;
      if ((world.fire[tile] ?? 0) !== 0) return true;
      if ((world.flood[tile] ?? 0) !== 0) return true;
    }
  }
  return false;
}

/** Nejbližší hořící nebo zaplavená dlaždice. Měří se po čtvercích, ne úhlopříčně. */
function nearestDamage(
  world: WorldState,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const size = world.size;
  let best: { x: number; y: number } | null = null;
  let closest = Number.POSITIVE_INFINITY;

  for (let tile = 0; tile < world.fire.length; tile++) {
    if ((world.fire[tile] ?? 0) === 0 && (world.flood[tile] ?? 0) === 0) continue;
    const tx = tile % size;
    const ty = (tile - tx) / size;
    const distance = Math.max(Math.abs(tx - x), Math.abs(ty - y));
    if (distance >= closest) continue;
    closest = distance;
    best = { x: tx, y: ty };
  }
  return best;
}

/** Těžiště zástavby. Prázdné město ho nemá. */
function cityCentre(world: WorldState): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const building of world.buildings.values()) {
    sumX += building.x;
    sumY += building.y;
    count++;
  }
  if (count === 0) return null;
  return { x: Math.round(sumX / count), y: Math.round(sumY / count) };
}

/** Jeden sčítanec poptávky: čím je a kolik dělá. */
export interface DemandTerm {
  /** Lokalizační klíč popisku, např. `ui.demand.term.jobs`. */
  key: string;
  value: number;
}

/** Rozpad poptávky jedné zóny na to, z čeho vyšla. */
export interface DemandBreakdown {
  category: RciCategory;
  value: number;
  terms: DemandTerm[];
}

/**
 * Z čeho vyšly sloupečky O/K/P.
 *
 * Hráč to hlásil takhle: „váhy, co je kdy potřeba, se zdají chaotické… přijde
 * mi to víceméně náhodné." Náhodné to není — model je tři řádky (`demand.ts`)
 * a stojí na jediné myšlence, že **lidé chtějí práci a práce chce lidi**.
 * Jenže z jednoho čísla se to nepozná, a tak to hra musí říct sama.
 *
 * Počítá se **stejnými vzorci jako samotná poptávka**, ne odhadem: kdyby se
 * rozpad počítal zvlášť, rozešel by se s ní při první změně balancu.
 */
export function explainDemand(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): DemandBreakdown[] {
  const { workerRatio, commercePerCapita } = balance.demand;
  const baseResidential = residentialBase(balance, world.tick);
  const baseIndustrial = industrialBase(balance, world.tick);

  let population = 0;
  let jobs = 0;
  let commercialJobs = 0;
  for (const building of world.buildings.values()) {
    population += building.population;
    jobs += building.jobs;
    if (catalogue.get(building.definitionId)?.category === 'commercial') {
      commercialJobs += building.jobs;
    }
  }

  const workers = Math.round(population * workerRatio);
  const shoppers = Math.round(population * commercePerCapita);

  return [
    {
      category: 'residential',
      value: world.demand.residential,
      terms: [
        { key: 'ui.demand.term.base', value: baseResidential },
        { key: 'ui.demand.term.jobs', value: jobs },
        { key: 'ui.demand.term.workers', value: -workers },
        // Spokojenost násobí jen **kladnou** poptávku: přebytek bytů s náladou
        // nesouvisí. V procentech, ať se to dá přečíst.
        {
          key: 'ui.demand.term.happiness',
          value: Math.round(happinessDemandFactor(world, balance) * 100),
        },
      ],
    },
    {
      category: 'commercial',
      value: world.demand.commercial,
      terms: [
        { key: 'ui.demand.term.shoppers', value: shoppers },
        { key: 'ui.demand.term.shops', value: -commercialJobs },
      ],
    },
    {
      category: 'industrial',
      value: world.demand.industrial,
      terms: [
        { key: 'ui.demand.term.base', value: baseIndustrial },
        { key: 'ui.demand.term.workers', value: workers },
        { key: 'ui.demand.term.jobs', value: -jobs },
      ],
    },
  ];
}


/** Odpad a kanalizace města: kolik se toho vyrobí a kolik se toho zpracuje. */
export interface CityUtilities {
  wasteNeeded: number;
  wasteCapacity: number;
  sewageNeeded: number;
  sewageCapacity: number;
  waterNeeded: number;
  waterCapacity: number;
}

/**
 * Odpadové hospodářství v jednom čísle na každou stranu.
 *
 * Počítá **totéž, co `systems/pollution.ts`** — proto tu jsou obě strany
 * pohromadě: co kapacita nepobere, se rozlije do znečištění po celé mapě, a to
 * je zdaleka největší zdroj špíny ve městě. Do teď to nebylo vidět nikde, takže
 * spalovna i čistička vypadaly jako budovy bez účinku.
 *
 * Opuštěné budovy se přeskakují stejně jako tam: ruina neprodukuje odpad, ale
 * ani nic nezpracuje.
 */
export function cityUtilities(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
): CityUtilities {
  let citizens = 0;
  let wasteCapacity = 0;
  let sewageCapacity = 0;
  let waterCapacity = 0;
  let waterNeeded = 0;

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    citizens += building.population;
    const definition = catalogue.get(building.definitionId);
    if (!definition) continue;
    wasteCapacity += definition.waste?.capacity ?? 0;
    sewageCapacity += definition.sewage?.capacity ?? 0;
    // Vodárna sama vodu nespotřebuje, jen ji vyrábí — přesně jako v rozvodu.
    const produced = definition.water?.production ?? 0;
    waterCapacity += produced;
    if (produced === 0) {
      waterNeeded +=
        building.population * balance.water.perCitizen + building.jobs * balance.water.perWorker;
    }
  }
  return {
    wasteNeeded: Math.round(citizens * balance.waste.perCitizen),
    wasteCapacity,
    sewageNeeded: Math.round(citizens * balance.sewage.perCitizen),
    sewageCapacity,
    waterNeeded: Math.round(waterNeeded),
    waterCapacity,
  };
}
