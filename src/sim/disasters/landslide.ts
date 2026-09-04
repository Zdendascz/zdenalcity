import {
  cornerIndex,
  cornerInBounds,
  cornerSideOf,
  MAX_HEIGHT,
  planCornerHeight,
  tileBaseHeight,
} from '../heights';
import { inBounds, index, TERRAIN } from '../layers';
import { applyHeightChanges } from '../world';
import type { WorldState } from '../world';
import { collapseUnsupportedRoads, destroyTile, noLosses, reportLosses } from './damage';
import type { Losses } from './damage';
import type { Disaster, DisasterContext } from './registry';

/**
 * Sesuv půdy (katalog 14).
 *
 * **Jediná katastrofa, která mění mapu.** Ostatní ničí, co na mapě stojí; tahle
 * přesune samotnou zem — horní rohy dráhy klesnou o patro, dolní o patro
 * stoupnou. Právě proto byla podmíněná fází 3b (R22): bez převýšení nemá co
 * přesouvat.
 *
 * Je **okamžitá**, ne postupná. Svah se buď utrhne, nebo ne; roztáhnout to do
 * dvaceti tiků by z toho udělalo pomalé tornádo, a to už ve hře je.
 *
 * Co spadne, se **nezapálí a nezamoří**. Sesuv je hlína, ne exploze; jeho cena
 * je v tom, že přeruší sítě vedené po spádnici a nechá po sobě terén, který
 * hráč musí srovnat, než tam postaví znovu.
 */

/** Čtyři směry, kterými se svah může utrhnout. Diagonály ne — dlaždice sousedí hranou. */
const DIRECTIONS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export function createLandslideDisaster(): Disaster {
  return {
    kind: 'landslide',

    pickOrigin: (world, _catalogue, balance) => {
      const slide = balance.disasters.landslide;
      const candidates: number[] = [];
      const weights: number[] = [];
      let total = 0;

      for (let y = 0; y < world.size; y++) {
        for (let x = 0; x < world.size; x++) {
          const tile = index(x, y, world.size);
          if (world.layers.terrain[tile] === TERRAIN.water) continue;
          // Musí být kam. Rovinu tím odfiltruje `steepestDescent` sám — a je to
          // jediná stráž schválně: dlaždice **na hraně srázu** je rovná, a
          // přitom je to přesně místo, kde se svah utrhne. Zvláštní kontrola na
          // vlastní sklon by ji vyloučila.
          if (steepestDescent(world, x, y) === null) continue;

          const built =
            (world.layers.buildingId[tile] ?? 0) !== 0 || (world.layers.road[tile] ?? 0) !== 0;
          const weight =
            1 +
            (built ? slide.builtWeight : 0) +
            (isFreshlyTerraformed(world, tile, slide.recentTerraformTicks)
              ? slide.freshTerraformWeight
              : 0);

          candidates.push(tile);
          weights.push(weight);
          total += weight;
        }
      }

      if (candidates.length === 0) return null;

      // Vážený los. `rng` je jediný zdroj náhody v simulaci (P2).
      let roll = world.rng.next() * total;
      for (let i = 0; i < candidates.length; i++) {
        roll -= weights[i] ?? 0;
        if (roll > 0) continue;
        const tile = candidates[i] ?? 0;
        const x = tile % world.size;
        return { x, y: (tile - x) / world.size };
      }

      const last = candidates[candidates.length - 1] ?? 0;
      const x = last % world.size;
      return { x, y: (last - x) / world.size };
    },

    start: (context) => {
      const { world, balance } = context;
      const slide = balance.disasters.landslide;

      const direction = steepestDescent(world, context.x, context.y);
      // Losování běží i tehdy, když se nic nestrhne. Vynechaný hod by posunul
      // `rng` jinak podle tvaru terénu a stejný seed by dal jiné město (P2).
      const length =
        slide.lengthMin + world.rng.int(slide.lengthMax - slide.lengthMin + 1);
      const width = slide.widthMin + world.rng.int(slide.widthMax - slide.widthMin + 1);
      if (!direction) return;

      const losses = noLosses();
      const path = pathTiles(world, context.x, context.y, direction, length, width);

      // Nejdřív se sesype, co na dráze stojí, a teprve pak se hne zem. Obráceně
      // by budova na okamžik stála na terénu, který pod ní už není.
      for (const tile of path) destroyTile(world, context.catalogue, tile, losses);

      const changes = planSlide(world, path, direction);
      applyHeightChanges(world, changes);

      // Co stálo na hraně, spadne taky. Kaskáda hne rohy i mimo dráhu a budova,
      // které se podhrabal roh, není o nic zachovalejší než ta v dráze.
      collapseAroundChanges(context, changes, path, losses);

      // Silnice se posuzuje **podle terénu, ne podle vzdálenosti**: sesuv jí
      // mohl nechat rovinu, po které se dá dál jezdit, a pak nemá důvod padat.
      // Když ne, rozbije se — stejným pravidlem jako po hráčově srovnávání.
      collapseUnsupportedRoads(world, changes, losses);

      reportLosses(world, balance, losses, slide.happinessPerLoss);
    },

    // Okamžitá: `start` udělá všechno a plánovač ji hned uklidí.
    tick: () => {},
    isFinished: () => true,
  };
}

/** Byla dlaždice upravená v posledních `withinTicks` ticích? */
export function isFreshlyTerraformed(
  world: WorldState,
  tile: number,
  withinTicks: number,
): boolean {
  const stamp = world.terraformTick[tile] ?? 0;
  if (stamp === 0) return false;
  // Po kruhu: razítko je `tick & 0xffff`, takže po 65 536 ticích přeteče.
  return (((world.tick & 0xffff) - stamp) & 0xffff) < withinTicks;
}

/**
 * Kam se svah utrhne. `null`, když je okolo rovina nebo voda.
 *
 * Bere se **nejstrmější klesání** ze čtyř sousedů. Při shodě rozhoduje pořadí
 * v `DIRECTIONS`, aby stejný seed dal stejný sesuv (P2).
 */
export function steepestDescent(
  world: WorldState,
  x: number,
  y: number,
): readonly [number, number] | null {
  const here = tileBaseHeight(world.cornerHeight, x, y);
  let best: readonly [number, number] | null = null;
  let bestDrop = 0;

  for (const [dx, dy] of DIRECTIONS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny, world.size)) continue;
    if (world.layers.terrain[index(nx, ny, world.size)] === TERRAIN.water) continue;

    const drop = here - tileBaseHeight(world.cornerHeight, nx, ny);
    if (drop > bestDrop) {
      bestDrop = drop;
      best = [dx, dy];
    }
  }

  return best;
}

/** Dlaždice v dráze sesuvu: `length` kroků po spádnici, `width` napříč. */
function pathTiles(
  world: WorldState,
  x: number,
  y: number,
  direction: readonly [number, number],
  length: number,
  width: number,
): number[] {
  const [dx, dy] = direction;
  // Kolmice ke spádnici. Otočení o devadesát stupňů, ne druhý los — dráha má
  // být pruh, ne mrak.
  const px = -dy;
  const py = dx;
  const half = Math.floor((width - 1) / 2);

  const tiles: number[] = [];
  const seen = new Set<number>();
  for (let step = 0; step < length; step++) {
    // U vody sesuv **končí**, nepřeskakuje ji. Hlína se sype do moře a dál už
    // nic nepokračuje; bez toho by se objevila na druhém břehu.
    const cx = x + dx * step;
    const cy = y + dy * step;
    if (!inBounds(cx, cy, world.size)) break;
    if (world.layers.terrain[index(cx, cy, world.size)] === TERRAIN.water) break;

    for (let offset = -half; offset <= width - 1 - half; offset++) {
      const tx = cx + px * offset;
      const ty = cy + py * offset;
      if (!inBounds(tx, ty, world.size)) continue;
      const tile = index(tx, ty, world.size);
      // Okraj dráhy smí do vody zasahovat, jen se nepočítá — sesuv široký tři
      // dlaždice nemá kvůli jedné mokré skončit celý.
      if (world.layers.terrain[tile] === TERRAIN.water) continue;
      if (seen.has(tile)) continue;
      seen.add(tile);
      tiles.push(tile);
    }
  }
  return tiles;
}

/**
 * Jak se po sesuvu přesype zem.
 *
 * Horní rohy dráhy klesnou o patro, dolní o patro stoupnou — materiál se
 * přesune, neztratí. Rohy se **sčítají přes celou dráhu**: roh, který je horní
 * pro jednu dlaždici a dolní pro její sousedku, vyjde na nulu, a to je správně
 * — hlína přes něj jen projela.
 *
 * Výsledek pak projde `planCornerHeight`, který dorovná sousední rohy do
 * jednoho patra. Kaskáda je součást jevu, ne úklid po něm: utržený svah strhne
 * i to nad sebou.
 */
function planSlide(
  world: WorldState,
  path: readonly number[],
  direction: readonly [number, number],
): Map<number, number> {
  const side = cornerSideOf(world.cornerHeight);
  const [dx, dy] = direction;
  const deltas = new Map<number, number>();

  const add = (cx: number, cy: number, delta: number): void => {
    if (!cornerInBounds(cx, cy, side)) return;
    // U břehu se **nepřisypává**. Hlína, která dojede k moři, do něj spadne
    // a je pryč; zvednout roh sdílený s vodní dlaždicí by naklonilo hladinu
    // a kaskáda by to nesla dál na druhý břeh.
    if (delta > 0 && touchesWater(world, cx, cy)) return;
    const corner = cornerIndex(cx, cy, side);
    deltas.set(corner, (deltas.get(corner) ?? 0) + delta);
  };

  for (const tile of path) {
    const x = tile % world.size;
    const y = (tile - x) / world.size;

    // Které rohy jsou „horní", určuje směr: hlína odchází z té strany, ze
    // které přišla.
    if (dx !== 0) {
      const upper = dx > 0 ? x : x + 1;
      const lower = dx > 0 ? x + 1 : x;
      add(upper, y, -1);
      add(upper, y + 1, -1);
      add(lower, y, 1);
      add(lower, y + 1, 1);
    } else {
      const upper = dy > 0 ? y : y + 1;
      const lower = dy > 0 ? y + 1 : y;
      add(x, upper, -1);
      add(x + 1, upper, -1);
      add(x, lower, 1);
      add(x + 1, lower, 1);
    }
  }

  const working = Uint8Array.from(world.cornerHeight);
  const changes = new Map<number, number>();
  // Setříděné, ať pořadí kaskád nezávisí na pořadí vkládání do mapy (P2).
  for (const corner of [...deltas.keys()].sort((a, b) => a - b)) {
    // Nulová změna se nepřeskakuje zvlášť: `planCornerHeight` vrátí prázdný
    // plán, když je cíl tam, kde roh už je. Druhá stráž na totéž by nešla
    // otestovat — a tím pádem ani udržet.
    const delta = deltas.get(corner) ?? 0;
    const cx = corner % side;
    const cy = (corner - cx) / side;
    const target = Math.max(0, Math.min(MAX_HEIGHT, (working[corner] ?? 0) + delta));
    const step = planCornerHeight(working, cx, cy, target);
    for (const [moved, height] of step) {
      working[moved] = height;
      changes.set(moved, height);
    }
  }

  return changes;
}

/** Dotýká se roh vodní dlaždice? */
function touchesWater(world: WorldState, cx: number, cy: number): boolean {
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ] as const) {
    const x = cx + dx;
    const y = cy + dy;
    if (!inBounds(x, y, world.size)) continue;
    if (world.layers.terrain[index(x, y, world.size)] === TERRAIN.water) return true;
  }
  return false;
}

/** Zboří, co stálo na rozích, kterými sesuv hnul mimo vlastní dráhu. */
function collapseAroundChanges(
  context: DisasterContext,
  changes: ReadonlyMap<number, number>,
  path: readonly number[],
  losses: Losses,
): void {
  const { world } = context;
  const side = cornerSideOf(world.cornerHeight);
  const inPath = new Set(path);
  const doomed = new Set<number>();

  for (const corner of changes.keys()) {
    const cx = corner % side;
    const cy = (corner - cx) / side;
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, world.size)) continue;
      const tile = index(x, y, world.size);
      if (inPath.has(tile)) continue;
      // **Jen budovy.** Silnici řeší `collapseUnsupportedRoads` podle toho,
      // jestli pod ní zbyla rovina — dům takovou možnost nemá, ten stojí na
      // rovině ze zákona a nakloněný roh mu podhrabe základy vždycky.
      if ((world.layers.buildingId[tile] ?? 0) === 0) continue;
      doomed.add(tile);
    }
  }

  // Setříděné, aby pořadí bourání nezáviselo na pořadí v mapě změn (P2).
  for (const tile of [...doomed].sort((a, b) => a - b)) {
    destroyTile(world, context.catalogue, tile, losses);
  }
}
