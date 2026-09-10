import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { inBounds, index, ROAD, TERRAIN } from '../layers';
import { roadFitsTerrain } from '../roads';
import { markTileDirty, removeBuilding } from '../world';
import type { WorldState } from '../world';
import { spawnRubble } from './rubble';
import { tilesOf } from './shapes';
import type { Shape, ShapeFilter } from './shapes';

/**
 * Ničení podle obsahu dlaždice — společné tornádu, zemětřesení i výbuchům
 * (R13 fáze 4).
 *
 * Každá z těch katastrof má vlastní tabulku: tornádo šanci na přežití,
 * zemětřesení zranitelnost, výbuchy odolnost. Čísla se liší, **klíč je
 * stejný** — druh toho, co na dlaždici stojí. Kdyby si každá katastrofa
 * zjišťovala obsah po svém, lišily by se v tom, jestli je opuštěný dům pořád
 * obytný a odkud se počítá vysoká zástavba, a hráč by z toho měl čtyři různá
 * pravidla místo jednoho. Práh vysoké zástavby je v datech
 * (`disasters.damage.highLevel`), ne tady (P5).
 */

/**
 * Druh obsahu dlaždice. Klíč do všech tabulek odolnosti.
 *
 * Obytná zástavba se dělí na nízkou a vysokou, protože panelák snese tornádo
 * i otřes líp než chalupa — a je to jediné místo ve hře, kde se hustota
 * vyplácí i jinak než ekonomicky.
 */
export type ContentKind =
  | 'forest'
  | 'abandoned'
  | 'residentialLow'
  | 'residentialHigh'
  | 'commercial'
  | 'industrial'
  | 'service'
  | 'utility'
  | 'road'
  | 'pipe'
  | 'rubble'
  | 'empty';

export function contentKindAt(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  tile: number,
): ContentKind {
  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId !== 0) {
    const building = world.buildings.get(buildingId);
    if (building) {
      if (building.abandoned) return 'abandoned';
      const category = catalogue.get(building.definitionId)?.category ?? 'service';
      if (category === 'residential') {
        return building.level >= balance.disasters.damage.highLevel
          ? 'residentialHigh'
          : 'residentialLow';
      }
      if (category === 'commercial') return 'commercial';
      if (category === 'industrial') return 'industrial';
      if (category === 'utility') return 'utility';
      return 'service';
    }
  }

  if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) return 'road';
  if ((world.rubble[tile] ?? 0) !== 0) return 'rubble';
  if ((world.layers.pipe[tile] ?? 0) !== 0) return 'pipe';
  if (world.layers.terrain[tile] === TERRAIN.forest) return 'forest';
  return 'empty';
}

/** Hodnota z tabulky podle obsahu. Chybějící klíč znamená „netýká se". */
export function lookup(
  table: Readonly<Record<string, number>>,
  kind: ContentKind,
  fallback = 0,
): number {
  return table[kind] ?? fallback;
}

/** Kolik toho katastrofa zničila. Slouží hlášení i srážce spokojenosti. */
export interface Losses {
  buildings: number;
  downgraded: number;
  infrastructure: number;
  /**
   * Kolik lidí bydlelo v tom, co spadlo.
   *
   * **Nejsou to mrtví**, je to základ, ze kterého se počítají: každá pohroma
   * si ho násobí svým podílem (`disasters.casualties`), protože ze zbořeného
   * domu se ven dostane jiná část lidí než z vyhořelého. Kdyby se převod dělal
   * tady, musela by `destroyTile` znát balanc i to, která pohroma ji volá —
   * a přitom je to jedno násobení u volajícího.
   */
  residents: number;
}

export function noLosses(): Losses {
  return { buildings: 0, downgraded: 0, infrastructure: 0, residents: 0 };
}

/**
 * Zničí, co na dlaždici stojí, a nechá trosky.
 *
 * Budova mizí **celá i s půdorysem**: dům s ustřelenou půlkou není poloviční
 * dům. Silnice a potrubí mizí samy za sebe — a právě proto jsou trosky vrstva
 * a ne stav budovy (R15).
 */
export function destroyTile(
  world: WorldState,
  catalogue: BuildingCatalogue,
  tile: number,
  losses: Losses,
): void {
  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId !== 0) {
    const building = world.buildings.get(buildingId);
    if (!building) return;
    const [width, depth] = catalogue.get(building.definitionId)?.footprint ?? [1, 1];

    for (let dy = 0; dy < depth; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const x = building.x + dx;
        const y = building.y + dy;
        if (x >= world.size || y >= world.size) continue;
        spawnRubble(world, index(x, y, world.size), building.definitionId);
      }
    }

    // Obyvatelé se sečtou **před** odstraněním: potom se už nikoho nezeptáš.
    const residents = building.population;
    if (removeBuilding(world, buildingId)) {
      losses.buildings++;
      losses.residents += residents;
    }
    return;
  }

  destroyInfrastructure(world, tile, losses);
}

/**
 * Zničí silnici a potrubí na dlaždici. Budovy se netýká.
 *
 * Vlastní funkce, protože o ni nestojí jen katastrofy: silnici umí podhrabat
 * i terén, který se pod ní pohnul (`collapseUnsupportedRoads`), a ta se má
 * rozpadnout přesně stejně — včetně trosek, které pak musí hráč uklidit.
 */
export function destroyInfrastructure(
  world: WorldState,
  tile: number,
  losses: Losses,
): void {
  const hadRoad = (world.layers.road[tile] ?? ROAD.none) !== ROAD.none;
  const hadPipe = (world.layers.pipe[tile] ?? 0) !== 0;
  if (!hadRoad && !hadPipe) return;

  if (hadRoad) {
    world.layers.road[tile] = ROAD.none;
    world.roadTiles.delete(tile);
    world.powerNetworkDirty = true;
  }
  if (hadPipe) {
    world.layers.pipe[tile] = 0;
    world.waterNetworkDirty = true;
  }
  spawnRubble(world, tile);
  markTileAt(world, tile);
  losses.infrastructure++;
}

/**
 * Rozbije silnice, kterým se pod nohama pohnul terén.
 *
 * Volá se **po každé změně výšek**, ne jen po sesuvu: roh drží čtyři dlaždice,
 * takže srovnání parcely vedle silnice jí nakloní vozovku úplně stejně jako
 * utržený svah. Do T89 taková silnice zůstala stát a kreslila se našikmo přes
 * zlom; autor to nahlásil obrázkem se slovy, že pokud k tomu dojde, musí být
 * rozbitá a nepoužitelná.
 *
 * Prochází se **jen okolí změněných rohů**, ne celá mapa — a i tam se ptáme
 * `roadFitsTerrain`, takže silnice, které se nic nestalo, zůstane stát.
 *
 * Bere `changes` jako plán, který se **už aplikoval**: kontroluje se stav po
 * změně, ne před ní.
 */
export function collapseUnsupportedRoads(
  world: WorldState,
  changes: ReadonlyMap<number, number>,
  losses: Losses,
): number {
  const side = world.size + 1;
  const doomed = new Set<number>();

  for (const corner of changes.keys()) {
    const cx = corner % side;
    const cy = (corner - cx) / side;
    for (const [dx, dy] of AROUND_CORNER) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, world.size)) continue;
      const tile = index(x, y, world.size);
      if ((world.layers.road[tile] ?? ROAD.none) === ROAD.none) continue;
      if (roadFitsTerrain(world, x, y)) continue;
      doomed.add(tile);
    }
  }

  // Setříděné, aby pořadí bourání nezáviselo na pořadí v mapě změn (P2).
  for (const tile of [...doomed].sort((a, b) => a - b)) {
    destroyInfrastructure(world, tile, losses);
  }
  return doomed.size;
}

/**
 * Projde **celou mapu** a rozbije silnice, které pod sebou nemají rovinu.
 *
 * Volá se po načtení savu. Města uložená dřív, než pravidlo existovalo, nesou
 * vozovky nakloněné přes zlom po dávném sesuvu — přesně ten obrázek, který
 * autor poslal. Nechat je stát by znamenalo, že se stejná chyba dá načíst
 * zpátky do hry, kde už být nemůže.
 *
 * Vrací počet rozbitých dlaždic, aby to volající uměl ohlásit.
 */
export function repairUnsupportedRoads(world: WorldState, losses: Losses): number {
  const doomed: number[] = [];
  for (const tile of world.roadTiles) {
    const x = tile % world.size;
    if (roadFitsTerrain(world, x, (tile - x) / world.size)) continue;
    doomed.push(tile);
  }

  // Setříděné, ať pořadí nezávisí na pořadí v množině (P2).
  for (const tile of doomed.sort((a, b) => a - b)) {
    destroyInfrastructure(world, tile, losses);
  }
  return doomed.length;
}

/** Dlaždice, které se dotýkají rohu. */
const AROUND_CORNER = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
] as const;

/**
 * Sníží budovu o úroveň. Vrací `true`, když se to povedlo.
 *
 * Zemětřesení nemusí dům srovnat se zemí — může ho jen nalomit. Je to
 * mírnější trest, který hráč pozná až na dani a kapacitě, a proto se hlásí
 * zvlášť.
 */
export function downgradeTile(
  world: WorldState,
  tile: number,
  losses: Losses,
): boolean {
  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId === 0) return false;
  const building = world.buildings.get(buildingId);
  if (!building || building.level <= 1) return false;

  building.level -= 1;
  building.levelChangedAtTick = world.tick;
  world.dirty.buildings.add(buildingId);
  losses.downgraded++;
  return true;
}

/**
 * Projde dlaždice tvaru a na každé hodí kostkou.
 *
 * `chanceAt` dostane dlaždici i její obsah a vrátí pravděpodobnost zničení.
 * Hází se **vždycky**, i když šance vyjde nulová: vynechaný hod by posunul
 * `rng` jinak podle toho, co má hráč postavené, a stejný seed by dal jiné
 * město (P2).
 *
 * Budovy se sbírají a ničí až po průchodu. Kdyby mizely průběžně, sousední
 * dlaždice téže budovy by se ptaly na obsah, který už neexistuje, a velký dům
 * by dostal tolik hodů, kolik má dlaždic.
 */
export function rollDamage(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  shape: Shape,
  chanceAt: (tile: number, kind: ContentKind) => number,
  losses: Losses,
  filter?: ShapeFilter,
): number[] {
  const hit: number[] = [];
  const seen = new Set<number>();

  for (const tile of tilesOf(world, shape, filter)) {
    const kind = contentKindAt(world, catalogue, balance, tile);
    const chance = chanceAt(tile, kind);
    const roll = world.rng.next();
    if (roll >= chance) continue;

    // Jedna budova, jeden zásah: víc dlaždic téhož domu ho nezničí víckrát.
    const buildingId = world.layers.buildingId[tile] ?? 0;
    if (buildingId !== 0) {
      if (seen.has(buildingId)) continue;
      seen.add(buildingId);
    }
    hit.push(tile);
  }

  for (const tile of hit) destroyTile(world, catalogue, tile, losses);
  return hit;
}

/**
 * Srážka spokojenosti za škody, celoměstsky.
 *
 * Vyhořelý nebo spadlý dům je zpráva pro celé město, ne jen pro jeho ulici —
 * proto prázdný seznam buněk. Tři katastrofy by jinak měly tři skoro stejné
 * kopie tohohle kousku.
 */
export function reportLosses(
  world: WorldState,
  balance: Balance,
  losses: Losses,
  perLoss: number,
  perDowngrade = 0,
): void {
  const amount = losses.buildings * perLoss + losses.downgraded * perDowngrade;
  if (amount <= 0) return;

  world.disasters.modifiers.push({
    kind: 'happinessPenalty',
    cells: [],
    amount,
    until: world.tick + balance.disasters.fire.happinessPenaltyTicks,
    source: 0,
  });
}

function markTileAt(world: WorldState, tile: number): void {
  const x = tile % world.size;
  markTileDirty(world, x, (tile - x) / world.size);
}
