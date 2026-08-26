import { index, TERRAIN } from '../layers';
import type { WorldState } from '../world';
import {
  contentKindAt,
  destroyTile,
  downgradeTile,
  lookup,
  noLosses,
  reportLosses,
} from './damage';
import type { Losses } from './damage';
import { igniteTile } from './fire';
import { floodTile } from './flood';
import type { Disaster, DisasterContext } from './registry';

/**
 * Zemětřesení (katalog 4).
 *
 * Nejvzácnější a nejtvrdší katastrofa v seznamu. Síla se losuje třetí mocninou
 * náhody, takže velká rána je opravdu vzácná — hráč si na ni nemůže zvyknout
 * a nemá cenu se na ni „připravit" jinak než rezervou v kase.
 *
 * Dělá tři věci naráz: **boří**, **snižuje úroveň** a **spouští druhotné
 * jevy** — požáry ze zničených budov a záplavy v pobřežním pásu. Právě ta
 * kombinace z něj dělá důvod, proč ve fázi 4 existují dluhopisy.
 *
 * Otřes zasáhne **celé město naráz**, ne okruh: útlum se počítá ze vzdálenosti
 * od epicentra, ale i druhý konec mapy dostane čtvrtinu. Proto se tu prochází
 * seznam budov, ne tvar.
 */

export function createEarthquakeDisaster(): Disaster {
  return {
    kind: 'earthquake',
    // Epicentrum smí být kdekoli, i v pustině — na tom nezáleží, protože
    // otřes se stejně roznese po celé mapě.
    pickOrigin: (world) => ({
      x: world.rng.int(world.size),
      y: world.rng.int(world.size),
    }),
    start: (context, active) => {
      const { world, balance } = context;
      const quake = balance.disasters.earthquake;

      const roll = world.rng.next();
      const magnitude = quake.magnitudeBase + quake.magnitudeSpan * roll * roll * roll;
      active.state['magnitude'] = magnitude;

      const count =
        quake.aftershocksMin +
        world.rng.int(quake.aftershocksMax - quake.aftershocksMin + 1);
      active.state['left'] = count;
      active.state['next'] = world.tick + nextDelay(world, context);

      shake(context, magnitude);
    },
    tick: (context, active) => {
      const { world, balance } = context;
      const quake = balance.disasters.earthquake;
      const left = (active.state['left'] as number | undefined) ?? 0;
      if (left <= 0) return;
      if (world.tick < ((active.state['next'] as number | undefined) ?? 0)) return;

      // Dotřesy slábnou geometricky. Nejsou to nové katastrofy — jsou to
      // doznívající rány téže, a proto je drží tahle instance.
      const magnitude =
        ((active.state['magnitude'] as number | undefined) ?? 0) * quake.aftershockDecay;
      active.state['magnitude'] = magnitude;
      active.state['left'] = left - 1;
      active.state['next'] = world.tick + nextDelay(world, context);

      shake(context, magnitude);
    },
    isFinished: (_world, active) => ((active.state['left'] as number | undefined) ?? 0) <= 0,
  };
}

function nextDelay(world: WorldState, context: DisasterContext): number {
  const quake = context.balance.disasters.earthquake;
  return (
    quake.aftershockDelayMin +
    world.rng.int(quake.aftershockDelayMax - quake.aftershockDelayMin + 1)
  );
}

/**
 * Jeden otřes.
 *
 * Budovy se procházejí **vzestupně podle id**, ne v pořadí mapy: každá dostane
 * právě jeden hod bez ohledu na to, kolik má dlaždic, a pořadí nezávisí na tom,
 * kdy se do `Map` vložila (P2).
 */
function shake(context: DisasterContext, magnitude: number): void {
  const { world, catalogue, balance } = context;
  const quake = balance.disasters.earthquake;
  const losses = noLosses();

  const ids = [...world.buildings.keys()].sort((a, b) => a - b);
  const destroyed: number[] = [];

  for (const id of ids) {
    const building = world.buildings.get(id);
    if (!building) continue;

    const tile = index(building.x, building.y, world.size);
    const kind = contentKindAt(world, catalogue, balance, tile);
    const hit = magnitude * falloff(world, quake, context, building.x, building.y) *
      lookup(quake.vulnerability, kind);

    if (world.rng.next() < hit) {
      destroyed.push(tile);
      continue;
    }
    // Nepovedlo se zbořit — zkusí se aspoň nalomit. Snížená budova je mírnější
    // trest, který hráč pozná na dani a kapacitě, ne na mapě.
    if (world.rng.next() < hit * quake.downgradeShare) downgradeTile(world, tile, losses);
  }

  for (const tile of destroyed) {
    destroyTileAndBurn(context, tile, magnitude, losses);
  }

  // Infrastruktura: silnice a potrubí dostanou vlastní hod, roztroušeně.
  shakeInfrastructure(context, magnitude, losses);
  floodCoast(context, magnitude);

  reportLosses(world, balance, losses, quake.happinessPerLoss, quake.happinessPerDowngrade);
}

function destroyTileAndBurn(
  context: DisasterContext,
  tile: number,
  magnitude: number,
  losses: Losses,
): void {
  const { world, catalogue, balance } = context;
  const quake = balance.disasters.earthquake;

  // `destroyTile` je společná operace z `damage.ts` — trosky i půdorys řeší ona.
  const before = losses.buildings;
  destroyTile(world, catalogue, tile, losses);
  if (losses.buildings === before) return;

  if (world.rng.next() < quake.fireChance * magnitude) {
    igniteTile(world, catalogue, balance, tile, quake.igniteIntensity, false);
  }
}

/**
 * Silnice a potrubí.
 *
 * Prochází se udržovaný seznam silnic a celá vrstva potrubí. Je to jednorázová
 * akce jednou za pár set tiků, takže se to vyplatí i na velké mapě.
 */
function shakeInfrastructure(
  context: DisasterContext,
  magnitude: number,
  losses: Losses,
): void {
  const { world, catalogue, balance } = context;
  const quake = balance.disasters.earthquake;

  const candidates: number[] = [...world.roadTiles].sort((a, b) => a - b);
  for (let tile = 0; tile < world.layers.pipe.length; tile++) {
    if ((world.layers.pipe[tile] ?? 0) !== 0 && (world.layers.road[tile] ?? 0) === 0) {
      candidates.push(tile);
    }
  }
  candidates.sort((a, b) => a - b);

  for (const tile of candidates) {
    const x = tile % world.size;
    const y = (tile - x) / world.size;
    const kind = contentKindAt(world, catalogue, balance, tile);
    const hit = magnitude * falloff(world, quake, context, x, y) * lookup(quake.vulnerability, kind);
    if (world.rng.next() >= hit) continue;
    destroyTile(world, catalogue, tile, losses);
  }
}

/**
 * Záplava v pobřežním pásu.
 *
 * Bez postupu vlny: zemětřesení vodu neposílá, jen ji vyšplíchne. Proto se
 * zaplaví rovnou pás u břehu a dál se to nešíří.
 */
function floodCoast(context: DisasterContext, magnitude: number): void {
  const { world, balance } = context;
  const quake = balance.disasters.earthquake;
  if (quake.floodBand <= 0) return;

  for (const tile of coastBand(world, quake.floodBand)) {
    if (world.rng.next() >= quake.floodChance * magnitude) continue;
    floodTile(world, tile, quake.floodDepth, quake.floodDuration);
  }
}

/**
 * Souš do `band` kroků od vody, vzestupně podle indexu.
 *
 * Průchod **od vody ven**, ne okno kolem každé dlaždice. Okno 7×7 na každou
 * ze 262 144 dlaždic velké mapy je dvanáct milionů porovnání za jeden otřes,
 * a otřesů je s dotřesy až osm. Takhle se prochází jen pobřeží a jeho okolí.
 */
function coastBand(world: WorldState, band: number): number[] {
  const seen = new Uint8Array(world.layers.terrain.length);
  let frontier: number[] = [];

  for (let tile = 0; tile < world.layers.terrain.length; tile++) {
    if (world.layers.terrain[tile] === TERRAIN.water) {
      seen[tile] = 1;
      frontier.push(tile);
    }
  }

  const land: number[] = [];
  for (let step = 0; step < band && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const tile of frontier) {
      const x = tile % world.size;
      const y = (tile - x) / world.size;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
        const at = index(nx, ny, world.size);
        if (seen[at] === 1) continue;
        seen[at] = 1;
        if (world.layers.terrain[at] === TERRAIN.water) continue;
        land.push(at);
        next.push(at);
      }
    }
    frontier = next;
  }

  // Pořadí je součást determinismu: hází se na každou dlaždici zvlášť (P2).
  return land.sort((a, b) => a - b);
}

/**
 * Útlum se vzdáleností od epicentra.
 *
 * Nikdy neklesne pod `falloffMin` — otřes se roznese po celém městě a druhý
 * konec mapy dostane pořád čtvrtinu. Zemětřesení není okruh, je to událost,
 * která se týká všech.
 */
function falloff(
  world: WorldState,
  quake: { falloffShare: number; falloffMin: number },
  context: DisasterContext,
  x: number,
  y: number,
): number {
  const distance = Math.hypot(x - context.x, y - context.y);
  const reach = world.size * quake.falloffShare;
  return Math.max(quake.falloffMin, Math.min(1, 1 - distance / Math.max(1, reach)));
}
