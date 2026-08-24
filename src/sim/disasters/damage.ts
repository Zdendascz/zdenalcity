import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { index, ROAD, TERRAIN } from '../layers';
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
 * obytný a jestli se úroveň počítá od tří nebo od čtyř, a hráč by z toho měl
 * čtyři různá pravidla místo jednoho.
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

/** Od téhle úrovně výš je zástavba „vysoká". Sdílí ji tornádo i zemětřesení. */
const HIGH_LEVEL = 3;

export function contentKindAt(
  world: WorldState,
  catalogue: BuildingCatalogue,
  tile: number,
): ContentKind {
  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId !== 0) {
    const building = world.buildings.get(buildingId);
    if (building) {
      if (building.abandoned) return 'abandoned';
      const category = catalogue.get(building.definitionId)?.category ?? 'service';
      if (category === 'residential') {
        return building.level >= HIGH_LEVEL ? 'residentialHigh' : 'residentialLow';
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
}

export function noLosses(): Losses {
  return { buildings: 0, downgraded: 0, infrastructure: 0 };
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
        spawnRubble(world, index(x, y, world.size));
      }
    }

    if (removeBuilding(world, buildingId)) losses.buildings++;
    return;
  }

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
  shape: Shape,
  chanceAt: (tile: number, kind: ContentKind) => number,
  losses: Losses,
  filter?: ShapeFilter,
): number[] {
  const hit: number[] = [];
  const seen = new Set<number>();

  for (const tile of tilesOf(world, shape, filter)) {
    const kind = contentKindAt(world, catalogue, tile);
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
