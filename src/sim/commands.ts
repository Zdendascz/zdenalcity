import type { Balance } from '@/content/balance';
import { checkFootprint, placeBuilding } from './buildings';
import type { BuildingCatalogue } from './catalogue';
import {
  cornerInBounds,
  cornerIndex,
  cornerSideOf,
  MAX_HEIGHT,
  planCornerHeight,
  planFillArea,
  planLevelArea,
} from './heights';
import { MAX_FUNDING } from './funding';
import { inBounds, index, ROAD, TERRAIN, terrainNameKey, WIRE, ZONE } from './layers';
import type { ZoneType } from './layers';
import { earn, spend } from './ledger';
import { categoryForZone } from './rci';
import { gradeForRoads, planRoadGradeAround } from './roads';
import { checkRequirements, presentDefinitions } from './requirements';
import {
  bondCap,
  bondProblems,
  issueBond,
  issueFee,
  loanCap,
  loanProblems,
  takeLoan,
} from './finance';
import { needsClearing } from './terrain';
import { createLine, findLine, MAX_LINE_VEHICLES, modeOf, removeLine, stopMode } from './transit';
import { extinguishTile } from './disasters/fire';
import { collapseUnsupportedRoads, destroyInfrastructure, noLosses } from './disasters/damage';
import { clearRubble } from './disasters/rubble';
import { OK, reject } from './result';
import type { CommandResult } from './result';
import {
  applyHeightChanges,
  markWaterNetworkDirty,
  MAX_TAX_RATE,
  MIN_TAX_RATE,
  markCoverageDirty,
  markPowerNetworkDirty,
  markTerrainChanged,
  markTileDirty,
  removeBuilding,
  reshapeBlocker,
  setRoadTile,
  setZoneTile,
} from './world';
import type { ReshapeView, WorldState } from './world';

/**
 * Všechny hráčské akce jdou přes `SimHost.dispatch`. `WorldState` se nikdy
 * nemodifikuje z UI ani z rendereru přímo.
 *
 * Každá funkce vrací `CommandResult` — když příkaz neprojde, řekne proč.
 */
export type Command =
  | { type: 'build_road'; x: number; y: number; roadType?: number }
  | { type: 'bulldoze'; x: number; y: number }
  | { type: 'zone'; x: number; y: number; w: number; h: number; zone: ZoneType }
  | { type: 'place_building'; definitionId: string; x: number; y: number }
  | { type: 'set_tax_rate'; zone: ZoneType; rate: number }
  | { type: 'set_service_funding'; serviceClass: string; funding: number }
  | { type: 'build_pipe'; x: number; y: number }
  | { type: 'remove_pipe'; x: number; y: number }
  /** Elektrické vedení (T129): `wire` je `WIRE.low` nebo `WIRE.high`. */
  | { type: 'build_wire'; x: number; y: number; wire: number }
  | { type: 'remove_wire'; x: number; y: number }
  | { type: 'terraform_corner'; x: number; y: number; delta: number }
  /**
   * Vysazení lesa (rozhodnutí autora).
   *
   * Protějšek k vykácení: buldozer les mění na trávu, tenhle příkaz trávu na
   * les. Není to ozdoba — les **pohlcuje znečištění** (`systems/pollution.ts`,
   * `map.forestAbsorption`) a zvedá cenu půdy, takže je to jediná obrana proti
   * kouři, která nestojí údržbu. Zaplatí se jednou a dál jen roste.
   */
  | { type: 'plant_trees'; x: number; y: number }
  /**
   * `mode: 'fill'` dozdí plochu na **nejvyšší** roh místo srovnání na průměr.
   * Svah tak nezmizí odkopáním, ale zavezením — hráč si tím rovná terasu
   * v úrovni horní krajiny (rozhodnutí autora, T41).
   */
  | {
      type: 'level_area';
      x: number;
      y: number;
      w: number;
      h: number;
      mode?: 'average' | 'fill';
      /**
       * Na kterou výšku srovnat. Bez ní se bere průměr plochy.
       *
       * Slouží tažení štětcem: hráč vezme dlaždici a táhne, okolní se srovnají
       * **na ni**. Bez pevné výšky si každá dlaždice počítala vlastní průměr,
       * takže se svah po tahu jen rozmazal místo aby se srovnal — autor to
       * nahlásil slovy „terén se musí rovnat dle dlaždice, od níž začalo
       * rovnání".
       */
      height?: number;
    }
  | { type: 'set_speed'; speed: number }
  /**
   * Linky MHD (§7 fáze 4).
   *
   * Zastávka se do linky **přidává, ne kreslí** — trasa je abstrakce. Pořadí
   * zastávek je pořadí, ve kterém linka jede, takže `add_stop` přidává na
   * konec a `move_stop` je od toho, aby šlo změnit smyčku bez rozebrání celé
   * linky.
   */
  | { type: 'create_line'; mode: string }
  | { type: 'delete_line'; lineId: number }
  | { type: 'add_stop'; lineId: number; buildingId: number }
  | { type: 'remove_stop'; lineId: number; buildingId: number }
  | { type: 'set_vehicles'; lineId: number; vehicles: number }
  | { type: 'set_fare'; lineId: number; fare: number }
  /**
   * Odstavení linky, nebo její rozjezd.
   *
   * Vyžádal si to hráč: „jede spustí linku, nejede jen pozastaví, mimo provoz
   * úplně se po zvolení nejede odstraní." Do té doby se dala linka jedině
   * smazat — i se zastávkami, které se pak musely naklikat znovu.
   */
  | { type: 'set_line_paused'; lineId: number; paused: boolean }
  /**
   * Půjčka (§8 fáze 4).
   *
   * Splácet se nedá dřív: předčasné splacení by z půjčky udělalo bezúročný
   * přesun peněz v čase, protože úrok se počítá z doby, na kterou se sjednala.
   */
  | { type: 'take_loan'; amount: number; termMonths: number }
  /**
   * Emise dluhopisů (§8 fáze 4).
   *
   * Hráč zadá **částku, úrok a splatnost** — a hádá, kolik se z toho upíše.
   * Je to jediné místo ve hře, kde nabízí on.
   */
  | { type: 'issue_bond'; amount: number; rate: number; maturityTicks: number };

/** Má dlaždice aspoň jednoho silničního souseda? Odsud se staví mosty dál. */
function touchesRoad(
  world: { readonly size: number; readonly layers: { readonly road: Readonly<Uint8Array> } },
  x: number,
  y: number,
): boolean {
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    if (!inBounds(x + dx, y + dy, world.size)) continue;
    if (
      (world.layers.road[index(x + dx, y + dy, world.size)] ?? ROAD.none) !==
      ROAD.none
    )
      return true;
  }
  return false;
}

/**
 * Změna silnice mění auto-tiling i u čtyř sousedů, takže do `DirtySet` musí
 * i oni — jinak by zůstali vykreslení se starým napojením.
 */
function markRoadNeighbourhoodDirty(world: WorldState, x: number, y: number): void {
  markTileDirty(world, x, y);
  markTileDirty(world, x, y - 1);
  markTileDirty(world, x + 1, y);
  markTileDirty(world, x, y + 1);
  markTileDirty(world, x - 1, y);
}

/**
 * Validace patří sem, ne do UI (architektura §5) — jinak by ji obcházel každý
 * další vstup, který kdy vznikne.
 */
export function buildRoad(
  world: WorldState,
  x: number,
  y: number,
  type: number = ROAD.street,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');

  const tile = index(x, y, world.size);
  if (world.layers.buildingId[tile] !== 0) return reject('error.occupied');
  // Trosky blokují i silnici (R15) — právě proto rozbitá čtvrť po tornádu
  // není jen kulisa, ale opravdová překážka v dopravě.
  if ((world.rubble[tile] ?? 0) !== 0) return reject('error.rubbleInTheWay');

  // Vozovka na vodě je **most** (§7 fáze 3). Staví se jen z břehu dál, aby
  // hráč nemohl položit kus vozovky doprostřed moře.
  const overWater = world.layers.terrain[tile] === TERRAIN.water;
  if (overWater && !touchesRoad(world, x, y)) return reject('error.bridgeNeedsBank');

  const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;

  // Les, skála ani mokřad silnici nezastaví — jen ji prodraží o vyklizení.
  // Do T61 se stavba odmítla a hráč musel napřed ručně bagrovat každou
  // dlaždici zvlášť; trasa přes remízek tak byla dvacet kliků místo jednoho.
  const clearing = !overWater && needsClearing(terrain) ? clearingCost(balance, terrain) : 0;

  // Vozovka smí stoupat, ale **nesmí se klopit do strany**. Silnice vedená
  // napříč svahem jede rovně a přitom je nakloněná bokem — nahlásil to autor
  // slovy „silnice nemůže být šejdrem ve svahu".
  //
  // Srovnává se **automaticky při stavbě** (rozhodnutí autora) a připočte se
  // terraforming, jak to dělá Transport Tycoon. Rovná dlaždice z toho nevzejde
  // a ani nemůže: sousední dlaždice sdílejí rohy, takže dvě sousední rovné
  // musí být ve stejné výšce a celá síť by ležela v jedné rovině. Ruší se
  // proto jen **příčný spád** — viz `planRoadGrade`.
  let grade: ReadonlyMap<number, number> | null = null;
  if (!overWater) {
    // Spád pod novou dlaždicí, a k němu **dorovnání rohů pod sousedními
    // silnicemi** (T101). Rohy jsou sdílené, takže srovnání pod novou vozovkou
    // nakloní i tu vedle; do T101 se taková soused silnice bourala. Změřeno na
    // pěti generovaných mapách: ze 14 668 postavených dlaždic jich 598 zbořilo
    // jinou. Silnice přitom vede proud, takže každá díra odřízne kus města.
    const graded = gradeForRoads(world, planRoadGradeAround(world, x, y), [tile]);
    // Když se dorovnat nedá, stavba **neprojde**. Zbourat kvůli ní stojící
    // ulici nesmíme (rozhodnutí autora, T101) a nechat ji nakloněnou taky ne —
    // zbývá říct hráči, že sem vozovka nepatří. Změřeno na pěti generovaných
    // mapách: ze 14 631 pokusů takhle skončilo 92, tedy šest z tisíce.
    if (graded.unfixable.length > 0) return reject('error.terraformBreaksRoad');
    grade = graded.changes;
    // **Budova v cestě silnici nezastaví** (rozhodnutí autora): domy nad
    // silnicí se mají podezdít, ne bránit stavbě. Podezdívku jim renderer
    // dokreslí sám, protože kopíruje terén.
    //
    // Voda pořád ano — tam by se zvednutím rohu vytvořila souš pod hladinou.
    if (reshapeBlocker(world, grade) === 'water') return reject('error.terraformWater');
  }

  const current = world.layers.road[tile] ?? ROAD.none;
  if (current === type) return reject('error.roadExists');
  // Vylepšení na místě ano, snížení ne (§4). Kdo chce ulici zpátky, zbourá
  // a postaví — jinak by se dala třída „prodat" za rozdíl cen.
  if (current > type) return reject('error.roadDowngrade');

  const levelling = (grade?.size ?? 0) * (balance?.map.terraformCost ?? 0);
  const cost =
    (overWater
      ? (balance?.traffic.bridgeCost ?? 0)
      : (balance?.traffic.roadTypes[type - 1]?.cost ?? 0)) +
    clearing +
    levelling;
  if (world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }
  spend(world, 'roads', cost);

  // Nejdřív srovnat, pak vyklidit, pak položit. Obráceně by vozovka na chvíli
  // ležela na sedle a renderer by ji tak i nakreslil.
  if (grade && grade.size > 0) applyHeightChanges(world, grade);
  if (clearing > 0) {
    world.layers.terrain[tile] = TERRAIN.grass;
    markTerrainChanged(world);
  }

  setRoadTile(world, tile, type);
  markRoadNeighbourhoodDirty(world, x, y);

  // Pojistka na to, co dorovnat nešlo — roh na stropu výšek nebo dlaždice, jejíž
  // všechny čtyři rohy plán zamkl. Řeší se **až po položení**, ne přes
  // `reshapeTerrain`: `planRoadGradeAround` počítá spád podle masky, ve které
  // nová dlaždice už je, takže dřív by se ptalo na tvar, který ještě neplatí,
  // a odbočka by při stavbě zbořila ulici, do které se napojuje.
  if (grade && grade.size > 0) collapseUnsupportedRoads(world, grade, noLosses());
  // Silnice od T129 nic nevede, ale mohla přepsat zónu nebo suť pod sebou.
  markPowerNetworkDirty(world);
  markWaterNetworkDirty(world);
  return OK;
}

/**
 * Co stojí vyklizení dlaždice. Sazba je v datech podle terénu (P5) — vykácet
 * les je levnější než odtěžit skálu a hráč to má poznat i na účtu.
 */
function clearingCost(balance: Balance | undefined, terrain: number): number {
  if (terrain === TERRAIN.forest) return balance?.map.clearForestCost ?? 0;
  if (terrain === TERRAIN.rock) return balance?.map.clearRockCost ?? 0;
  return balance?.map.fillMarshCost ?? 0;
}

/**
 * Co `estimateRoad` opravdu potřebuje: terén, rohy a velikost mapy.
 *
 * Úmyslně užší než `WorldState`, aby cenu uměl spočítat i renderer, který má
 * po ruce jen `ReadonlyWorldView`. Kdyby se bral celý svět, musel by si UI
 * sáhnout na zapisovatelný stav jen kvůli tomu, aby ukázalo číslo.
 */
export interface RoadCostView {
  readonly size: number;
  readonly layers: {
    readonly terrain: Readonly<Uint8Array>;
    /** Rovnání potřebuje vědět, kudy silnice vede — bez sousedů nezná směr. */
    readonly road: Readonly<Uint8Array>;
    /** Odhad musí poznat obsazenou dlaždici: tam se nepostaví, takže stojí nulu. */
    readonly buildingId: Readonly<Uint32Array>;
  };
  readonly cornerHeight: Readonly<Uint8Array>;
  /** Trosky blokují silnici stejně jako budova. */
  readonly rubble: Readonly<Uint8Array>;
}

/** Z čeho se skládá cena jedné dlaždice vozovky. */
export interface RoadEstimate {
  /** Samotná vozovka, nebo most nad vodou. */
  road: number;
  /** Vykácení lesa, odtěžení skály, zavezení mokřadu. Nula na volné dlaždici. */
  clearing: number;
  /** Srovnání zkroucené dlaždice. Nula, když je rovná nebo v rovnoměrném svahu. */
  levelling: number;
  total: number;
}

/**
 * Co bude stát vozovka na téhle dlaždici. Nic nemění — jen počítá.
 *
 * Existuje kvůli náhledu ceny při tažení. Od T61 může být silnice na lese nebo
 * na sedle dražší než sazba za vozovku, a cenovka, která by ukazovala jen tu
 * sazbu, by hráči lhala — zaplatil by devadesát tam, kde viděl deset.
 *
 * U tažení přes víc dlaždic je to **odhad**, a to na obě strany. Srovnání jedné
 * dlaždice hne rohem, o který se dělí se sousedy, takže sousední dlaždice pak
 * může vyjít levněji. Naopak dlaždice, ze které se během tažení teprve stane
 * křižovatka, se odhaduje jako přímý úsek a ve skutečnosti se srovná celá.
 * Přesně sedí jednotlivá dlaždice — a ta se hráči ukazuje při kladení po jedné.
 */
export function estimateRoad(
  world: RoadCostView,
  x: number,
  y: number,
  type: number = ROAD.street,
  balance?: Balance,
): RoadEstimate {
  const empty = { road: 0, clearing: 0, levelling: 0, total: 0 };
  if (!inBounds(x, y, world.size)) return empty;

  const tile = index(x, y, world.size);
  const overWater = world.layers.terrain[tile] === TERRAIN.water;
  const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;

  // Dlaždice, na kterou příkaz stavět nebude, stojí **nulu** (T-revize,
  // nález 14). Cenovka nad tažením do teď sčítala i pole, kde už silnice je,
  // kde stojí budova nebo leží trosky, takže nad tahem svítilo jedno číslo
  // a stalo se jiné — a hráč u toho počítal peníze.
  const current = world.layers.road[tile] ?? ROAD.none;
  if ((world.layers.buildingId[tile] ?? 0) !== 0) return empty;
  if ((world.rubble[tile] ?? 0) !== 0) return empty;
  if (current >= type) return empty;
  if (overWater && !touchesRoad(world, x, y)) return empty;

  const road = overWater
    ? (balance?.traffic.bridgeCost ?? 0)
    : (balance?.traffic.roadTypes[type - 1]?.cost ?? 0);

  const clearing = !overWater && needsClearing(terrain) ? clearingCost(balance, terrain) : 0;

  // Dorovnání pod sousedními silnicemi je v ceně, ne překvapení na účtu —
  // odhad se proto ptá na týž plán jako `buildRoad` (T101).
  const levelling = overWater
    ? 0
    : gradeForRoads(world, planRoadGradeAround(world, x, y), [tile]).changes.size *
      (balance?.map.terraformCost ?? 0);

  return { road, clearing, levelling, total: road + clearing + levelling };
}

/**
 * Ruční stavba konkrétní budovy. Používá se na to, co nevyroste ze zóny —
 * typicky infrastruktura. Definici hledá v katalogu, takže v kódu není ani
 * jedna budova (P5).
 */
export interface PlacementEstimate {
  /** Cena samotné budovy. */
  building: number;
  /** Kolik navíc stojí srovnání parcely. Nula, když je rovná. */
  levelling: number;
  total: number;
  /** Rohy, které srovnání pohne. Prázdné, když se nic srovnávat nemusí. */
  changes: Map<number, number>;
  /** Rohy parcely samotné. Dorovnání pod silnicí je nesmí přepsat (T101). */
  core: Set<number>;
}

/**
 * Co bude stát postavení téhle budovy sem, **včetně srovnání parcely**.
 *
 * Nic nemění. Existuje kvůli §12 kritériu 14: srovnání pod budovou se má
 * nabídnout **s cenou předem**, ne až po zaplacení. UI si tohle zavolá při
 * najetí myší a hráč vidí, do čeho jde.
 */
export function estimatePlacement(
  world: WorldState,
  catalogue: BuildingCatalogue,
  definitionId: string,
  x: number,
  y: number,
  balance?: Balance,
): PlacementEstimate {
  const definition = catalogue.get(definitionId);
  if (!definition) {
    return { building: 0, levelling: 0, total: 0, changes: new Map(), core: new Set() };
  }

  const [width, depth] = definition.footprint;
  // Co snese svah, to se nesrovnává a nic za srovnání neplatí — park se do
  // kopce posadí, jak je (`allowsSlope`, P5).
  const wanted = definition.construction.allowsSlope
    ? new Map<number, number>()
    : planLevelling(world, x, y, width, depth);
  // Dorovnání terénu pod okolními silnicemi je **součást ceny**, ne překvapení
  // na účtu (§12 kritérium 14). Bez toho by hráč zaplatil za rohy, které v
  // odhadu neviděl — a do T101 se místo nich rovnou bořila vozovka.
  const core = coreCorners(world, x, y, width, depth);
  const changes = gradeForRoads(world, wanted, [], core).changes;
  const levelling = changes.size * (balance?.map.terraformCost ?? 0);
  const building = definition.construction.cost;

  return { building, levelling, total: building + levelling, changes, core };
}

/**
 * Srovnání, které projde i na břehu.
 *
 * Standardně se rovná na **průměr** rohů, protože to je nejlevnější. U vody to
 * ale nejde: průměr může zvednout roh sdílený s vodní dlaždicí a moře by se
 * naklonilo. V tom případě se rovná na **nejnižší roh** — pobřežní svah se
 * odkope, hladina zůstane, kde byla.
 *
 * Vyplavalo to při hraní: elektrárna u pobřeží se odmítala postavit s hláškou
 * „zvedat dno moře neumíme", i když stála celá na souši.
 */
/**
 * Rohy obdélníku dlaždic — to, co si hráč vyžádal.
 *
 * Kaskáda kolem toho je důsledek, ne přání, takže se s ní při dorovnávání
 * terénu pod silnicí smí hýbat (T101).
 */
function coreCorners(world: WorldState, x: number, y: number, w: number, h: number): Set<number> {
  const side = world.size + 1;
  const out = new Set<number>();
  for (let cy = y; cy <= y + h; cy++) {
    for (let cx = x; cx <= x + w; cx++) {
      if (cx < 0 || cy < 0 || cx >= side || cy >= side) continue;
      out.add(cy * side + cx);
    }
  }
  return out;
}

function planLevelling(
  world: WorldState,
  x: number,
  y: number,
  width: number,
  depth: number,
): Map<number, number> {
  const averaged = planLevelArea(world.cornerHeight, x, y, width, depth);
  if (checkTerraform(world, averaged).ok) return averaged;

  const side = cornerSideOf(world.cornerHeight);
  let lowest = MAX_HEIGHT;
  for (let cy = y; cy <= y + depth; cy++) {
    for (let cx = x; cx <= x + width; cx++) {
      if (!cornerInBounds(cx, cy, side)) continue;
      lowest = Math.min(
        lowest,
        world.cornerHeight[cornerIndex(cx, cy, side)] ?? 0,
      );
    }
  }

  return planLevelArea(world.cornerHeight, x, y, width, depth, lowest);
}

export function placeDefinition(
  world: WorldState,
  catalogue: BuildingCatalogue,
  definitionId: string,
  x: number,
  y: number,
  balance?: Balance,
): CommandResult {
  const definition = catalogue.get(definitionId);
  if (!definition) return reject('error.unknownDefinition', { id: definitionId });

  // Nerovná parcela se **srovná**, ne odmítne (§7 fáze 3). Cena srovnání se
  // připočte a UI ji přes `estimatePlacement` umí ukázat dřív, než hráč klikne.
  const plan = estimatePlacement(world, catalogue, definitionId, x, y, balance);

  // Zóna se nekontroluje: elektrárna smí stát i na nezónované půdě. Rovina se
  // nekontroluje taky — od toho je to srovnání o řádek níž.
  const fits = checkFootprint(world, definition, x, y, { skipFlatCheck: true });
  if (!fits.ok) return fits;

  // Prerekvizity platí i pro ruční stavbu, ne jen pro růst (§7).
  const met = checkRequirements(world, catalogue, definition, x, y, presentDefinitions(world));
  if (!met.ok) return met;

  if (plan.changes.size > 0) {
    const allowed = checkTerraform(world, plan.changes, plan.core);
    if (!allowed.ok) return allowed;
  }

  // Na co nejsou peníze, to se nepostaví. Na rozdíl od budov, které vyrostou
  // ze zóny samy, tuhle platí hráč.
  if (world.economy.funds < plan.total) {
    return reject('error.notEnoughFunds', { cost: plan.total, funds: world.economy.funds });
  }

  spend(world, 'build', plan.total);
  reshapeTerrain(world, plan.changes, plan.core);
  placeBuilding(world, definition, x, y);
  return OK;
}

/**
 * Vyznačí obdélník zónou. Dlaždice, na které to nejde (voda, silnice, budova),
 * se přeskočí — hráč nemá důvod řešit, že mu výběr zasahuje do řeky. Když
 * neprojde ani jedna, je to odmítnutí i s důvodem.
 *
 * `ZONE.none` zónu ruší.
 */
export function zoneArea(
  world: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
  zone: ZoneType,
  balance?: Balance,
): CommandResult {
  // Nejdřív se **jen sepíše**, co by se změnilo, a teprve pak se sahá na svět.
  // Srovnání terénu se od T68 platí a bez peněz se nezónuje; kdyby se značky
  // psaly průběžně, zůstala by po odmítnutí půlka čtvrti vyznačená.
  const toZone: number[] = [];
  let lastReason = 'error.zoneNoChange';
  // „Nic nového, ale nic nebrání" se musí odlišit od „ani jedna dlaždice
  // nešla" (T-revize, nález 16). Prodloužení už vyznačené čtvrti přes to,
  // co obytné je, jinak skončilo hláškou „Zóna se sem vyznačit nedá" —
  // přestože zóna tam byla a nic špatně nebylo.
  let alreadyZoned = 0;

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tileX = x + dx;
      const tileY = y + dy;
      if (!inBounds(tileX, tileY, world.size)) {
        lastReason = 'error.outOfBounds';
        continue;
      }

      const tile = index(tileX, tileY, world.size);
      if (world.layers.terrain[tile] === TERRAIN.water) {
        lastReason = 'error.water';
        continue;
      }
      if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) {
        lastReason = 'error.roadInTheWay';
        continue;
      }
      if (world.layers.buildingId[tile] !== 0) {
        lastReason = 'error.occupied';
        continue;
      }
      if (world.layers.zone[tile] === zone) {
        alreadyZoned++;
        continue;
      }

      toZone.push(tile);
    }
  }

  // Tichý úspěch: hráč táhl přes svou vlastní čtvrť a dostal, co chtěl.
  if (toZone.length === 0 && alreadyZoned > 0) return OK;
  if (toZone.length === 0) return reject(lastReason);

  // Srovnání se **účtuje** (rozhodnutí autora, T67) a hráč ho vidí na cenovce
  // při tažení. Zóna sama nic nestojí; platí se za terén pod ní.
  //
  // Bez peněz se **nezónuje vůbec** (rozhodnutí autora, T68) — stejně jako se
  // bez peněz nepostaví silnice. Rušení zóny je mazání značky, ne stavba, a
  // neplatí se za ně nic.
  // Bez balancu **neplatí strop**, ne „strop nula". Nula by srovnávání tiše
  // vypnula a volající bez pravidel by dostal jinou hru, ne levnější; totéž
  // pravidlo jako u ceny, kde chybějící balanc znamená zadarmo, ne zdarma nic.
  const changes =
    zone === ZONE.none
      ? new Map<number, number>()
      : planZoneLevelling(world, x, y, w, h, balance?.map.maxLevelledZoneTiles ?? Infinity);
  const cost = changes.size * (balance?.map.terraformCost ?? 0);
  if (world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }

  spend(world, 'zoning', cost);
  reshapeTerrain(world, changes);

  for (const tile of toZone) {
    const tileX = tile % world.size;
    setZoneTile(world, tile, zone);
    markTileDirty(world, tileX, (tile - tileX) / world.size);
  }

  return OK;
}

/**
 * Co je potřeba srovnat pod právě vyznačenou zónou (T66). Nic nemění.
 *
 * **Dělá se to při zónování, ne při růstu**, a je za tím geometrie. Sousední
 * dlaždice sdílejí rohy, takže dvě sousední rovné dlaždice musí být ve stejné
 * výšce; jakmile v okolí něco stojí, terén se nehne. Naměřeno na golden městě:
 * ze 61 pokusů srovnat parcelu pod rostoucím domem jich 59 zablokovala budova.
 * Ve chvíli zónování je plocha ještě prázdná a srovnat jde.
 *
 * Rovná se **na průměr**. Dozdění na nejvyšší roh jako u silnice (T61) neprošlo:
 * u pobřeží zvedá rohy sdílené s vodní dlaždicí a moře by se naklonilo.
 *
 * Když celá plocha neprojde, **rozpůlí se a zkouší po částech**. Typicky vadí
 * jedna řada u břehu a zbytek čtvrti srovnat jde; bez půlení by pobřežní čtvrť
 * zůstala na svahu celá kvůli jedné dlaždici.
 *
 * Velká plocha se **nesrovnává**: kdo táhne zónu přes celé údolí, nechce
 * náhorní plošinu.
 *
 * Počítá se nad **pracovní kopií výšek**, ne nad světem. Půlení totiž staví
 * druhou půlku na tom, co udělala první, a kdyby se přitom sahalo na svět,
 * nešlo by cenu spočítat předem — a cenovka by hráči lhala.
 */
export function planZoneLevelling(
  world: ReshapeView,
  x: number,
  y: number,
  w: number,
  h: number,
  maxTiles: number,
): Map<number, number> {
  const working = Uint8Array.from(world.cornerHeight);
  const changes = new Map<number, number>();
  collectZoneLevelling(world, working, changes, x, y, w, h, maxTiles);
  return changes;
}

function collectZoneLevelling(
  world: ReshapeView,
  working: Uint8Array,
  changes: Map<number, number>,
  x: number,
  y: number,
  w: number,
  h: number,
  maxTiles: number,
): void {
  if (w < 1 || h < 1 || w * h > maxTiles) return;

  const step = planLevelArea(working, x, y, w, h);
  if (step.size === 0) return;

  if (reshapeBlocker(world, step) === null) {
    for (const [corner, height] of step) {
      working[corner] = height;
      changes.set(corner, height);
    }
    return;
  }

  if (w === 1 && h === 1) return;
  if (w >= h) {
    const half = Math.floor(w / 2);
    collectZoneLevelling(world, working, changes, x, y, half, h, maxTiles);
    collectZoneLevelling(world, working, changes, x + half, y, w - half, h, maxTiles);
  } else {
    const half = Math.floor(h / 2);
    collectZoneLevelling(world, working, changes, x, y, w, half, maxTiles);
    collectZoneLevelling(world, working, changes, x, y + half, w, h - half, maxTiles);
  }
}

/**
 * Co bude stát vyznačení zóny. Nic nemění — jen počítá.
 *
 * Existuje kvůli cenovce při tažení, stejně jako `estimateRoad`. Zóna sama nic
 * nestojí; platí se **srovnání terénu pod ní** (rozhodnutí autora, T67).
 */
export function estimateZoning(
  world: ReshapeView,
  x: number,
  y: number,
  w: number,
  h: number,
  balance?: Balance,
): number {
  return (
    planZoneLevelling(world, x, y, w, h, balance?.map.maxLevelledZoneTiles ?? Infinity).size *
    (balance?.map.terraformCost ?? 0)
  );
}

/**
 * Boura vždycky to nejvrchnější: budovu, jinak silnici, jinak trosky, jinak
 * terén.
 *
 * **Zóny se nedotkne** (rozhodnutí autora, T62). Zóna je značka pod tím, co na
 * dlaždici stojí, a hráč, který bourá dům, chce skoro vždycky postavit jiný.
 * Do T62 stačilo kliknout podruhé a zóna byla pryč — což se dělo omylem při
 * probourávání průseku proti ohni. Na rušení zón je vlastní nástroj.
 */
export function bulldoze(
  world: WorldState,
  x: number,
  y: number,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');

  const tile = index(x, y, world.size);

  // Buldozer hasí. Je to **hlavní aktivní obrana proti ohni** (§4 fáze 4):
  // hráč prorazí průsek a oheň se nemá kudy šířit. Hasí se dřív, než se
  // cokoli zbourá, aby po zbourané budově nezůstal oheň na prázdné parcele.
  extinguishTile(world, tile);

  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId !== 0) {
    removeBuilding(world, buildingId);
    return OK;
  }

  if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) {
    setRoadTile(world, tile, ROAD.none);
    markRoadNeighbourhoodDirty(world, x, y);
    markPowerNetworkDirty(world);
    return OK;
  }

  // Trosky leží **na** parcele, zóna je jen značka pod nimi. Kdyby se mazala
  // zóna dřív, hráč by musel na hromadu suti kliknout dvakrát a poprvé by
  // navíc nepozorovaně přišel o zónu — nahlásilo se to při hraní.
  if ((world.rubble[tile] ?? 0) !== 0) {
    // Úklid trosek stojí peníze. Je to jediné, co po katastrofě hráč **musí**
    // zaplatit, aby mohl znovu stavět — a proto se to počítá do rozhodnutí,
    // kterou čtvrť obnovit dřív.
    const cost = balance?.disasters.rubble.clearCost ?? 0;
    if (world.economy.funds < cost) {
      return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
    }
    spend(world, 'bulldoze', cost);
    clearRubble(world, tile);
    markTileDirty(world, x, y);
    return OK;
  }

  // Elektrické vedení (T129) bourá buldozer stejně jako potrubí: až když na
  // dlaždici nic vyššího nestojí. Autorovi chybělo, jak dráty odstranit.
  if ((world.layers.wire[tile] ?? WIRE.none) !== WIRE.none) {
    world.layers.wire[tile] = WIRE.none;
    markTileDirty(world, x, y);
    markPowerNetworkDirty(world);
    return OK;
  }

  if (world.layers.pipe[tile] === 1) {
    world.layers.pipe[tile] = 0;
    markTileDirty(world, x, y);
    markWaterNetworkDirty(world);
    return OK;
  }

  // Vykácení lesa. Stojí peníze a je to **volba**: les do té doby zvedá cenu
  // půdy a pohlcuje znečištění, po vykácení zbude místo na stavbu (§2 fáze 3).
  if (world.layers.terrain[tile] === TERRAIN.forest) {
    const cost = balance?.map.clearForestCost ?? 0;
    if (world.economy.funds < cost) {
      return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
    }
    spend(world, 'terrain', cost);
    world.layers.terrain[tile] = TERRAIN.grass;
    markTerrainChanged(world);
    markTileDirty(world, x, y);
    return OK;
  }

  // Skálu jde odtěžit a mokřad zavézt — obojí za cenu terraformingu (§7 fáze 3).
  // Do fáze 3a to byly terény, se kterými hráč nemohl dělat vůbec nic.
  const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;
  if (terrain === TERRAIN.rock || terrain === TERRAIN.marsh) {
    const cost =
      terrain === TERRAIN.rock
        ? (balance?.map.clearRockCost ?? 0)
        : (balance?.map.fillMarshCost ?? 0);
    if (world.economy.funds < cost) {
      return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
    }
    spend(world, 'terrain', cost);
    world.layers.terrain[tile] = TERRAIN.grass;
    markTerrainChanged(world);
    markTileDirty(world, x, y);
    return OK;
  }

  return reject('error.nothingToBulldoze');
}

/**
 * Vysadí les na jedné dlaždici.
 *
 * **Opak vykácení**, se stejnými pravidly z druhé strany: sází se jen tam, kde
 * je volná tráva nebo písek. Co je zastavěné, zpevněné nebo pod sutí, se
 * nejdřív musí uklidit — les neroste přes silnici ani přes barák.
 *
 * Zóna je překážka schválně. Vyznačená parcela znamená „sem chci dům" a les by
 * na ní jen tiše zabránil růstu: hra by hlásila, že terén nedovolí stavbu, a
 * hráč by koukal, proč mu čtvrť nezarostla, když si ji sám zalesnil.
 *
 * Cena je v datech (`map.plantTreesCost`, P5). Kácení stojí 120, sázení 60 —
 * les se sází snáz, než se odklízí, a pás zeleně kolem továrny tak vyjde
 * levněji než jeho pozdější likvidace.
 */
export function plantTrees(
  world: WorldState,
  x: number,
  y: number,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');

  const tile = index(x, y, world.size);
  const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;
  if (terrain === TERRAIN.forest) return reject('error.forestExists');
  if (terrain !== TERRAIN.grass && terrain !== TERRAIN.sand) {
    return reject('error.terrainNotAllowed', {
      terrain: terrainNameKey(terrain),
      allowed: [TERRAIN.grass, TERRAIN.sand].map(terrainNameKey).join(','),
    });
  }

  if ((world.layers.buildingId[tile] ?? 0) !== 0) return reject('error.occupied');
  if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) return reject('error.roadInTheWay');
  if ((world.rubble[tile] ?? 0) !== 0) return reject('error.rubbleInTheWay');
  if ((world.layers.zone[tile] ?? ZONE.none) !== ZONE.none) return reject('error.zoneInTheWay');

  const cost = balance?.map.plantTreesCost ?? 0;
  if (world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }

  spend(world, 'terrain', cost);
  world.layers.terrain[tile] = TERRAIN.forest;
  markTerrainChanged(world);
  markTileDirty(world, x, y);
  return OK;
}

/**
 * Financování třídy služeb. Mění dosah, sílu i skutečnou údržbu naráz —
 * hráč musí vidět, na čem šetří.
 *
 * Horní mez je v balancu, protože od T113 se dá jít i **nad sto procent**:
 * nadfinancovat hasiče na dobu požáru je legitimní tah. Platí se za to
 * progresivně a účinek roste jen poloviční rychlostí (`sim/funding.ts`).
 */
export function setServiceFunding(
  world: WorldState,
  serviceClass: string,
  funding: number,
): CommandResult {
  if (!Number.isFinite(funding)) return reject('error.invalidFunding');

  world.serviceFunding.set(serviceClass, Math.max(0, Math.min(MAX_FUNDING, funding)));
  markCoverageDirty(world);
  return OK;
}

/** Sazba je v procentech a drží se v <0, 20>. Hodnota mimo rozsah se přiřízne. */
export function setTaxRate(world: WorldState, zone: ZoneType, rate: number): CommandResult {
  const category = categoryForZone(zone);
  if (!category) return reject('error.notAZone');

  world.economy.taxRates[category] = Math.max(
    MIN_TAX_RATE,
    Math.min(MAX_TAX_RATE, Math.round(rate)),
  );
  return OK;
}

/**
 * Položí potrubí (§8 fáze 3).
 *
 * Na rozdíl od silnice se **neplete s ničím jiným na dlaždici**: potrubí je pod
 * zemí, takže smí být pod budovou i pod vozovkou. Právě proto je vlastní vrstva
 * a ne další hodnota v `road`.
 */
export function buildPipe(
  world: WorldState,
  x: number,
  y: number,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');

  const tile = index(x, y, world.size);
  if (world.layers.terrain[tile] === TERRAIN.water)
    return reject('error.pipeOnWater');
  if (world.layers.pipe[tile] === 1) return reject('error.pipeExists');
  if ((world.rubble[tile] ?? 0) !== 0) return reject('error.rubbleInTheWay');

  const cost = balance?.water.pipeCost ?? 0;
  if (world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }

  spend(world, 'pipes', cost);
  world.layers.pipe[tile] = 1;
  markTileDirty(world, x, y);
  markWaterNetworkDirty(world);
  return OK;
}

/**
 * Odstraní potrubí, a **jen potrubí**.
 *
 * Buldozer bourá to nejvrchnější, takže by v podzemním pohledu sundal budovu
 * nebo silnici nad trubkou. Hráč, který kouká pod zem, ale míří na trubku.
 */
export function removePipe(
  world: WorldState,
  x: number,
  y: number,
): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');

  const tile = index(x, y, world.size);
  if (world.layers.pipe[tile] !== 1) return reject('error.noPipe');

  world.layers.pipe[tile] = 0;
  markTileDirty(world, x, y);
  markWaterNetworkDirty(world);
  return OK;
}

/**
 * Položí elektrické vedení (T129), nebo stávající přestaví na jiný typ.
 *
 * Vedení smí vést přes silnici i budovu, stejně jako potrubí — spojuje bloky
 * a do cesty mu stojí jen voda a suť. Přestavba stojí cenu nového typu;
 * stejný typ podruhé se odmítne.
 */
export function buildWire(
  world: WorldState,
  x: number,
  y: number,
  wire: number,
  balance?: Balance,
): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');
  if (wire !== WIRE.low && wire !== WIRE.high) return reject('error.unknownWire');

  const tile = index(x, y, world.size);
  if (world.layers.terrain[tile] === TERRAIN.water) return reject('error.wireOnWater');
  if (world.layers.wire[tile] === wire) return reject('error.wireExists');
  if ((world.rubble[tile] ?? 0) !== 0) return reject('error.rubbleInTheWay');

  const cost = balance?.power.wires[wire - 1]?.cost ?? 0;
  if (world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }

  spend(world, 'wires', cost);
  world.layers.wire[tile] = wire;
  markTileDirty(world, x, y);
  markPowerNetworkDirty(world);
  return OK;
}

/** Odstraní vedení, a jen vedení — stejná úvaha jako u `removePipe`. */
export function removeWire(world: WorldState, x: number, y: number): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');
  const tile = index(x, y, world.size);
  if ((world.layers.wire[tile] ?? WIRE.none) === WIRE.none) return reject('error.noWire');
  world.layers.wire[tile] = WIRE.none;
  markTileDirty(world, x, y);
  markPowerNetworkDirty(world);
  return OK;
}

/**
 * Terraforming (§7 zadání fáze 3).
 *
 * Dvě věci, které dělá kaskáda z T29, se tady potkávají s ekonomikou: plán se
 * spočítá **napřed** a teprve pak se ptá na peníze, takže cena jde ukázat dřív,
 * než hráč klikne (§12 kritérium 14). A účtuje se **celá kaskáda**, ne jeden
 * roh — zvednutí u strmého svahu rozhýbe desítky rohů a hráč to má vidět na
 * účtu (kritérium 13).
 */
export interface TerraformEstimate {
  /** Kolik rohů se změní včetně kaskády. */
  corners: number;
  cost: number;
  changes: Map<number, number>;
  /**
   * Rohy, o které hráč **opravdu stojí** — parcela pod stavbou, roh, na který
   * klikl. Dorovnání terénu pod silnicí je nesmí přepsat; zbytek plánu je
   * kaskáda a tou hýbat smí (T101).
   */
  core: Set<number>;
}

/**
 * Smí se terén na tomhle plánu hnout? Pravidlo je ve `world.ts`, protože se na
 * ně ptá i růst zástavby — tady se jen překládá na hlášku pro hráče.
 *
 * **Budova v cestě terén nezastaví** (rozhodnutí autora, stejné jako u silnic).
 * Dřív se to odmítalo hláškou „nejdřív ji zbourej", takže hráč nemohl srovnat
 * roh pod křivou silnicí, i když by mu stačilo podezdít dům vedle. Podezdívku
 * si budova dokreslí sama, protože renderer kopíruje terén, a `applyHeightChanges`
 * ji označí za změněnou, takže se překreslí hned.
 *
 * Voda pořád ano: zvednutý roh u hladiny by udělal souš pod vodou.
 */
/**
 * Změní terén a rozbije silnice, které pod sebou přišly o rovinu.
 *
 * Roh drží čtyři dlaždice, takže srovnání parcely vedle silnice nakloní i
 * vozovku. Do T89 tam taková silnice zůstala stát a kreslila se našikmo přes
 * zlom; autor to nahlásil obrázkem a chce to jednoznačně — rozbitou, ne
 * křivou. Platí to i pro hráčovo vlastní srovnávání, ne jen pro sesuv: nakloněná
 * vozovka je nakloněná bez ohledu na to, kdo za to může.
 *
 * Hlásí se to **troskami na dlaždici**, ne hláškou. Hláška by přišla uprostřed
 * tažení štětcem a hráč by ji překlikl; hromada suti zůstane, dokud ji neuklidí.
 */
function reshapeTerrain(
  world: WorldState,
  changes: ReadonlyMap<number, number>,
  core?: Set<number>,
): void {
  if (changes.size === 0) return;

  // Terén se dorovná tak, aby pod ním silnice obstály (T101). Plány z odhadů
  // už dorovnané jsou, tohle je pojistka pro cesty, které jdou mimo ně —
  // opakované dorovnání nic nemění, je to funkce téhož stavu.
  const graded = gradeForRoads(world, changes, [], core);
  applyHeightChanges(world, graded.changes);

  // Co dorovnat nešlo, se rozpadne jako dřív. Stává se to tam, kde by roh
  // vyjel z rozsahu výšek nebo kde jsou všechny čtyři rohy hráčovy — nechat
  // stát nakloněnou vozovku je horší než hromada suti, kterou je vidět.
  if (graded.unfixable.length > 0) {
    const losses = noLosses();
    for (const tile of graded.unfixable) destroyInfrastructure(world, tile, losses);
  }
}

function checkTerraform(
  world: WorldState,
  changes: ReadonlyMap<number, number>,
  core?: Set<number>,
): CommandResult {
  if (reshapeBlocker(world, changes) === 'water') return reject('error.terraformWater');
  // Silnice se kvůli srovnání terénu **nebourá** (rozhodnutí autora, T101).
  // Plán, který sem přišel z odhadu, je už dorovnaný, takže tohle chytá jen
  // zbytek: dlaždice, u kterých dorovnání narazilo na strop výšek nebo na
  // samé zamčené rohy. Radši odmítnout než tiše rozbít síť, po které jde proud.
  if (gradeForRoads(world, changes, [], core).unfixable.length > 0) {
    return reject('error.terraformBreaksRoad');
  }
  return OK;
}

/**
 * Zaokrouhlí plán terénu tak, aby pod ním silnice obstály, a spočítá cenu.
 *
 * Dorovnání je **součást plánu, ne úklid po něm**: kdyby se dělalo až při
 * provedení, hráč by za rohy navíc zaplatil, aniž by je viděl v ceně předem
 * (§12 kritérium 14). Takhle je v odhadu i v účtu totéž číslo.
 */
function estimate(
  world: WorldState,
  changes: Map<number, number>,
  balance?: Balance,
  core?: Set<number>,
): TerraformEstimate {
  const keep = core ?? new Set(changes.keys());
  const graded = gradeForRoads(world, changes, [], keep).changes;
  const perCorner = balance?.map.terraformCost ?? 0;
  return { corners: graded.size, cost: graded.size * perCorner, changes: graded, core: keep };
}

/** Kolik by stálo zvednutí nebo snížení rohu. Nic nemění — jen počítá. */
export function estimateCornerHeight(
  world: WorldState,
  x: number,
  y: number,
  delta: number,
  balance?: Balance,
): TerraformEstimate {
  const corner = cornerIndex(x, y, cornerSideOf(world.cornerHeight));
  const current = world.cornerHeight[corner] ?? 0;
  // Jádro je **ten jeden roh**, na který hráč klikl. Kaskáda kolem něj se smí
  // při dorovnávání pod silnicí posunout (T101).
  return estimate(
    world,
    planCornerHeight(world.cornerHeight, x, y, current + delta),
    balance,
    new Set([corner]),
  );
}

/** Jak se plocha srovnává: na průměr, nebo dozděním na nejvyšší roh. */
export type LevelMode = 'average' | 'fill';

/**
 * Dozdění: plocha se srovná na **nejvyšší** roh, ne na průměr.
 *
 * Rozdíl je v tom, co se svahem udělá: srovnání ho odkope, dozdění ho zaveze.
 * Hráč si tak může u kopce udělat terasu v úrovni horní krajiny, místo aby si
 * ji musel vysekat dolů (rozhodnutí autora, T41).
 */
function planFilling(
  world: WorldState,
  x: number,
  y: number,
  width: number,
  depth: number,
): Map<number, number> {
  return planFillArea(world.cornerHeight, x, y, width, depth);
}

/** Kolik by stálo srovnání oblasti. Nic nemění — jen počítá. */
export function estimateLevelArea(
  world: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
  balance?: Balance,
  mode: LevelMode = 'average',
  height?: number,
): TerraformEstimate {
  const changes =
    height !== undefined
      ? planLevelArea(world.cornerHeight, x, y, w, h, height)
      : mode === 'fill'
        ? planFilling(world, x, y, w, h)
        : planLevelling(world, x, y, w, h);
  return estimate(world, changes, balance, coreCorners(world, x, y, w, h));
}

function commit(world: WorldState, plan: TerraformEstimate): CommandResult {
  if (plan.corners === 0) return reject('error.terraformNoChange');

  const allowed = checkTerraform(world, plan.changes, plan.core);
  if (!allowed.ok) return allowed;

  if (world.economy.funds < plan.cost) {
    return reject('error.notEnoughFunds', { cost: plan.cost, funds: world.economy.funds });
  }
  spend(world, 'terrain', plan.cost);

  reshapeTerrain(world, plan.changes, plan.core);
  return OK;
}

/** Zvedne nebo sníží roh mřížky o `delta` pater, i s kaskádou a účtem. */
export function terraformCorner(
  world: WorldState,
  x: number,
  y: number,
  delta: number,
  balance?: Balance,
): CommandResult {
  if (!cornerInBounds(x, y, cornerSideOf(world.cornerHeight)))
    return reject('error.outOfBounds');
  return commit(world, estimateCornerHeight(world, x, y, delta, balance));
}

/** Srovná obdélník dlaždic do jedné výšky, i s kaskádou a účtem. */
export function levelArea(
  world: WorldState,
  x: number,
  y: number,
  w: number,
  h: number,
  balance?: Balance,
  mode: LevelMode = 'average',
  height?: number,
): CommandResult {
  if (!inBounds(x, y, world.size)) return reject('error.outOfBounds');
  return commit(world, estimateLevelArea(world, x, y, w, h, balance, mode, height));
}

/* ------------------------------------------------------------------ MHD -- */

/**
 * Založí linku daného módu.
 *
 * Zastávky se přidávají zvlášť: prázdná linka je platný stav, jen nejezdí.
 * Hráč tak může nejdřív založit linku a pak k ní sbírat zastávky, místo aby
 * musel mít celou trasu hotovou předem.
 *
 * Id nové linky se nevrací — `CommandResult` je společný tvar pro všechny
 * příkazy a rozšiřovat ho kvůli jednomu by znamenalo, že ostatní vracejí
 * pole, které nikdy nevyplní. Nová linka je poslední v `world.lines`.
 */
export function createTransitLine(
  world: WorldState,
  balance: Balance | undefined,
  mode: string,
): CommandResult {
  // Bez balancu není katalog módů, takže žádný mód není známý. `SimHost` se
  // dá postavit i bez obsahu (dělají to testy jádra) a linka je první příkaz,
  // který se bez něj neobejde.
  if (!balance || !modeOf(balance, mode)) return reject('error.unknownTransitMode', { mode });
  createLine(world, mode);
  return OK;
}

export function deleteTransitLine(world: WorldState, lineId: number): CommandResult {
  if (!removeLine(world, lineId)) return reject('error.unknownLine', { id: lineId });
  return OK;
}

/**
 * Přidá zastávku na konec linky.
 *
 * Kontroluje se **mód a duplicita**, ne vzdálenost: linka přes celé město je
 * hráčova věc, jen bude potřebovat víc vozidel. Zastávka jiného módu ale
 * nedává smysl vůbec — tramvaj po autobusové zastávce nepojede.
 */
export function addTransitStop(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance | undefined,
  lineId: number,
  buildingId: number,
): CommandResult {
  const line = findLine(world, lineId);
  if (!line) return reject('error.unknownLine', { id: lineId });
  if (!balance) return reject('error.unknownTransitMode', { mode: line.mode });
  if (line.stops.length >= balance.transit.maxStops) {
    return reject('error.tooManyStops', { max: balance.transit.maxStops });
  }
  if (line.stops.includes(buildingId)) return reject('error.stopAlreadyOnLine');

  const mode = stopMode(world, catalogue, buildingId);
  if (mode === null) return reject('error.notAStop');
  if (mode !== line.mode) return reject('error.wrongStopMode', { mode, expected: line.mode });

  line.stops.push(buildingId);
  world.transitDirty = true;
  return OK;
}

export function removeTransitStop(
  world: WorldState,
  lineId: number,
  buildingId: number,
): CommandResult {
  const line = findLine(world, lineId);
  if (!line) return reject('error.unknownLine', { id: lineId });

  const at = line.stops.indexOf(buildingId);
  if (at < 0) return reject('error.stopNotOnLine');
  line.stops.splice(at, 1);
  world.transitDirty = true;
  return OK;
}

/**
 * Nastaví počet vozidel. Rozdíl se **zaplatí, nebo vrátí**.
 *
 * Vrací se plná cena, ne část: vozidlo se dá přesunout na jinou linku a hráč
 * by jinak platil pokutu za to, že si to rozmyslel. Údržbu řeší rozpočet.
 */
export function setLineVehicles(
  world: WorldState,
  balance: Balance | undefined,
  lineId: number,
  vehicles: number,
): CommandResult {
  const line = findLine(world, lineId);
  if (!line) return reject('error.unknownLine', { id: lineId });
  if (!Number.isInteger(vehicles) || vehicles < 0 || vehicles > MAX_LINE_VEHICLES) {
    return reject('error.invalidVehicles', { vehicles });
  }

  const mode = balance ? modeOf(balance, line.mode) : undefined;
  if (!mode) return reject('error.unknownTransitMode', { mode: line.mode });

  const added = vehicles - line.vehicles;
  const cost = added * mode.vehicleCost;
  if (cost > 0 && world.economy.funds < cost) {
    return reject('error.notEnoughFunds', { cost, funds: world.economy.funds });
  }

  // Odebrané vozidlo se proplácí celé, takže cena může být záporná.
  if (cost >= 0) spend(world, 'vehicles', cost);
  else earn(world, 'refund', -cost);
  line.vehicles = vehicles;
  return OK;
}

/**
 * Odstaví linku, nebo ji zase rozjede.
 *
 * Odstavená stojí v depu: nikoho nevozí, nevydělá a **neplatí se za ni údržba
 * vozidel**. Zastávky, vozidla ani jízdné se neztratí, takže se rozjede jedním
 * kliknutím.
 */
export function setLinePaused(
  world: WorldState,
  lineId: number,
  paused: boolean,
): CommandResult {
  const line = findLine(world, lineId);
  if (!line) return reject('error.unknownLine', { id: lineId });
  if (line.paused === paused) return OK;
  line.paused = paused;
  world.transitDirty = true;
  return OK;
}

/** Nastaví jízdné. Účinek na využití a příjem přidává T56. */
export function setLineFare(world: WorldState, lineId: number, fare: number): CommandResult {
  const line = findLine(world, lineId);
  if (!line) return reject('error.unknownLine', { id: lineId });
  if (!Number.isFinite(fare) || fare < 0) return reject('error.invalidFare', { fare });

  line.fare = fare;
  return OK;
}

/* ---------------------------------------------------------------- půjčka -- */

/**
 * Sjedná půjčku. Peníze přijdou hned, splácí se od příštího měsíce.
 *
 * Odmítnutí říká **proč** — strop, počet, doba, nebo nesmyslná částka. Půjčka
 * je jediná cesta z mínusu a hráč, který ji nedostane, musí vědět, co s tím.
 */
export function requestLoan(
  world: WorldState,
  balance: Balance | undefined,
  amount: number,
  termMonths: number,
): CommandResult {
  if (!balance) return reject('error.noFinanceRules');

  const problems = loanProblems(world, balance, amount, termMonths);
  if (problems.includes('invalidAmount')) return reject('error.invalidAmount', { amount });
  if (problems.includes('invalidTerm')) {
    return reject('error.invalidTerm', {
      min: balance.finance.minTermMonths,
      max: balance.finance.maxTermMonths,
    });
  }
  if (problems.includes('tooMany')) {
    return reject('error.tooManyLoans', { max: balance.finance.maxLoans });
  }
  if (problems.includes('overCap')) {
    // Strop závisí na splatnosti, tak ji hláška říká: jinak by hráč viděl dvě
    // různá čísla pro tutéž půjčku a neměl by z čeho poznat, čím se liší.
    return reject('error.overLoanCap', {
      cap: loanCap(world, balance, termMonths),
      months: termMonths,
    });
  }

  return takeLoan(world, balance, amount, termMonths) ? OK : reject('error.invalidAmount', { amount });
}

/**
 * Vypíše emisi dluhopisů.
 *
 * Odmítnutí říká **proč**. Zvlášť u zablokované emise: hráč, který jednou
 * nezaplatil, musí vědět, do kdy má zavřeno — jinak by jen klikal a nechápal.
 */
export function issueBondCommand(
  world: WorldState,
  balance: Balance | undefined,
  amount: number,
  rate: number,
  maturityTicks: number,
): CommandResult {
  if (!balance) return reject('error.noFinanceRules');

  const problems = bondProblems(world, balance, amount, rate, maturityTicks);
  if (problems.includes('blocked')) {
    return reject('error.bondsBlocked', { until: world.bondsBlockedUntil });
  }
  if (problems.includes('invalidAmount')) {
    return reject('error.overBondCap', { cap: bondCap(world, balance) });
  }
  if (problems.includes('invalidRate')) {
    return reject('error.invalidRate', { max: balance.finance.bonds.maxRate });
  }
  if (problems.includes('invalidMaturity')) {
    return reject('error.invalidMaturity', {
      min: balance.finance.bonds.minMaturityTicks,
      max: balance.finance.bonds.maxMaturityTicks,
    });
  }
  if (problems.includes('cannotAffordFee')) {
    return reject('error.cannotAffordFee', { fee: issueFee(balance, amount) });
  }

  return issueBond(world, balance, amount, rate, maturityTicks) ? OK : reject('error.overBondCap', {
    cap: bondCap(world, balance),
  });
}
