import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { COARSE_FACTOR, coarseIndex, coarseSizeOf } from '../coarse';
import { tileBaseHeight } from '../heights';
import { index, TERRAIN } from '../layers';
import type { System } from '../systems/index';
import { markNetworksDirty, markTileDirty, removeBuilding } from '../world';
import type { WorldState } from '../world';
import type { Disaster, DisasterContext } from './registry';
import { ownedTiles } from '../buildings';
import { destroyInfrastructure, noLosses } from './damage';
import { spawnRubble } from './rubble';
import { addToll, blameFor } from './state';
import type { ActiveDisaster } from './state';

/**
 * Povodeň (§5 fáze 4).
 *
 * Tři fáze a všechny tři něco znamenají:
 *
 * 1. **postup** — vlna se šíří od břehu do vnitrozemí, ale jen tam, kam
 *    dosáhne hladina. Vyvýšený břeh zůstane suchý, a to je přímá odměna za
 *    investici do převýšení: hráz o jednu úroveň vlnu zastaví úplně.
 * 2. **stání** — voda drží a poškození se **hromadí**. Nepůsobí naráz, takže
 *    rychlé opadnutí opravdu zachraňuje.
 * 3. **opadání** — odpočet na každé dlaždici, který hasiči zrychlují. Čtvrť
 *    u hasičárny vyschne dřív než ta na druhém konci města.
 *
 * Zaplavená dlaždice **nevede proud ani vodu a je neprůjezdná**. Z toho plyne
 * druhá půlka škody: přerušené sítě bolí víc než pár zbořených domů.
 */

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/**
 * Je dlaždice pod vodou? Ptá se na to elektřina, vodovod i doprava.
 *
 * Elektřina a vodovod se ale přepočítávají **jen při změně sítě**, takže
 * každý přechod mezi suchou a zaplavenou dlaždicí je musí označit za špinavé
 * (`floodTile`, `drainTile`; audit T132). Do té doby zaplavená čtvrť svítila,
 * dokud hráč náhodou nesáhl na vedení, a po opadnutí zase zůstala potmě.
 */
export function isFlooded(world: WorldState, tile: number): boolean {
  return (world.flood[tile] ?? 0) > 0;
}

/**
 * Zaplaví dlaždici na danou dobu a hloubku. Vrací `true`, když se něco změnilo.
 *
 * Hlubší voda přebije mělčí a delší dobu delší — dvě vlny přes totéž místo se
 * nesčítají, platí ta horší. Sčítání by z každého zemětřesení udělalo potopu,
 * ze které se město nevzpamatuje.
 */
export function floodTile(
  world: WorldState,
  tile: number,
  depth: number,
  duration: number,
): boolean {
  const newDepth = Math.max(0, Math.min(255, Math.round(depth)));
  const newDuration = Math.max(0, Math.min(255, Math.round(duration)));
  if (newDepth <= 0 || newDuration <= 0) return false;

  const changed =
    newDepth > (world.floodDepth[tile] ?? 0) || newDuration > (world.flood[tile] ?? 0);
  if (!changed) return false;

  const wasDry = (world.flood[tile] ?? 0) === 0;
  world.floodDepth[tile] = Math.max(world.floodDepth[tile] ?? 0, newDepth);
  world.flood[tile] = Math.max(world.flood[tile] ?? 0, newDuration);
  markTileAt(world, tile);
  if (wasDry) markNetworksDirty(world);
  return true;
}

/**
 * Podíl každé buňky hrubé mřížky, který je pod vodou.
 *
 * Cena půdy žije na hrubé mřížce, voda na plné. Průchod se dělá **jednou za
 * běh** a výsledek se předá dál — kdyby si ho počítala každá buňka sama, byl
 * by z toho průchod čtvrt milionem dlaždic pro každou z šestnácti tisíc.
 */
export function floodPerCell(world: WorldState): Float32Array {
  const coarse = coarseSizeOf(world.size);
  const counts = new Float32Array(coarse * coarse);

  for (let tile = 0; tile < world.flood.length; tile++) {
    if ((world.flood[tile] ?? 0) === 0) continue;
    const cell = cellOf(world, tile);
    counts[cell] = (counts[cell] ?? 0) + 1 / (COARSE_FACTOR * COARSE_FACTOR);
  }

  return counts;
}

/** Voda opadla. Poškození zůstává — sesbírané škody se odpuštěním vody nemažou. */
export function drainTile(world: WorldState, tile: number): void {
  if ((world.flood[tile] ?? 0) === 0 && (world.floodDepth[tile] ?? 0) === 0) return;
  const wasWet = (world.flood[tile] ?? 0) > 0;
  world.flood[tile] = 0;
  world.floodDepth[tile] = 0;
  markTileAt(world, tile);
  if (wasWet) markNetworksDirty(world);
}

/**
 * Systém záplavy. Běží každý tik — voda opadá plynule, ne po skocích.
 *
 * Dlaždice se procházejí vzestupně podle indexu; náhoda se tu nepoužívá vůbec,
 * takže determinismus (P2) drží sám od sebe.
 */
export function createFloodSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'flood',
    interval: 1,
    offset: 0,
    run(world: WorldState) {
      const flood = balance.disasters.flood;
      const coverage = world.coverage.get('fire');
      const destroyed: number[] = [];
      let wet = 0;

      for (let tile = 0; tile < world.flood.length; tile++) {
        const left = world.flood[tile] ?? 0;
        if (left === 0) continue;
        wet++;

        const depth = world.floodDepth[tile] ?? 0;
        const cell = cellOf(world, tile);

        // Kontaminace: stojatá voda ve městě není čistá.
        world.coarse.pollution[cell] = clampByte(
          (world.coarse.pollution[cell] ?? 0) + flood.pollutionPerTick,
        );

        // Škoda se hromadí. Hloubka 1 znamená zhruba třináct tiků do zničení,
        // hloubka 3 čtyři — mělká voda v ulici se dá přečkat, hluboká ne.
        const damage = (world.floodDamage[tile] ?? 0) + depth * flood.damagePerDepth;
        if (damage >= 255) {
          world.floodDamage[tile] = 255;
          destroyed.push(tile);
        } else {
          world.floodDamage[tile] = clampByte(damage);
        }

        // Opadání zrychlují hasiči. Je to jediné místo, kde se pokrytí hasiči
        // vyplatí i tam, kde nikdy nehořelo.
        // Zaokrouhluje se **před** porovnáním s nulou. Do T132 se zbytek
        // 0,4 zapsal jako nula mimo `drainTile`: dlaždice oschla, ale hloubka
        // na ní zůstala a elektřina ani vodovod se o tom nedozvěděly.
        const drain = 1 + (coverage?.[cell] ?? 0) * flood.drainPerCoverage;
        const remaining = clampByte(left - drain);
        if (remaining <= 0) drainTile(world, tile);
        else world.flood[tile] = remaining;
      }

      if (destroyed.length > 0) washAway(world, catalogue, balance, destroyed);
      if (wet > 0) world.dirty.coarseChanged = true;
    },
  };
}

/**
 * Dlaždice, které voda dobila.
 *
 * Budova mizí celá i s půdorysem, stejně jako u ohně. Zaplavená silnice a
 * potrubí zmizí taky — a po všem zůstanou trosky, takže obnova stojí peníze
 * i čas.
 */
function washAway(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  tiles: readonly number[],
): void {
  const doomed = new Set<number>();
  let lost = 0;
  let residents = 0;

  for (const tile of tiles) {
    const buildingId = world.layers.buildingId[tile] ?? 0;
    if (buildingId !== 0) {
      doomed.add(buildingId);
      continue;
    }

    // Infrastruktura bez budovy: vozovka, potrubí i vedení. Právě tohle je ten
    // důvod, proč jsou trosky vrstva a ne stav budovy (R15). Stejná cesta jako
    // u ostatních katastrof, ať voda neumí něco, co oheň ne (T132).
    destroyInfrastructure(world, tile, noLosses());
  }

  for (const id of [...doomed].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building) continue;
    // Trosky jen tam, kde budova opravdu stojí (T132, `ownedTiles`).
    const footprint = catalogue.get(building.definitionId)?.footprint ?? [1, 1];
    for (const owned of ownedTiles(world, building, footprint)) {
      spawnRubble(world, owned, building.definitionId);
    }

    const inside = building.population;
    if (removeBuilding(world, id)) {
      lost++;
      residents += inside;
    }
  }

  // Utopení se připíše běžící povodni; stejný důvod jako u požáru.
  if (residents > 0) {
    const owner = blameFor(world.disasters.active, ['flood']);
    if (owner) addToll(owner, residents * balance.disasters.casualties.flood);
  }

  const penalty = balance.disasters.flood.happinessPerLoss;
  if (lost > 0 && penalty > 0) {
    world.disasters.modifiers.push({
      kind: 'happinessPenalty',
      cells: [],
      amount: penalty * lost,
      until: world.tick + balance.disasters.fire.happinessPenaltyTicks,
      source: 0,
    });
  }
}

/**
 * Povodeň jako katastrofa.
 *
 * Vzniká na pobřeží a **hájí se od opadnutí**, ne od vzniku: trvá desítky
 * tiků a další vlna by jinak mohla přijít, zatímco ta první ještě stojí.
 */
export function createFloodDisaster(): Disaster {
  return {
    kind: 'flood',
    cooldownFromEnd: true,
    pickOrigin: (world, _catalogue, balance) => pickCoast(world, balance),
    start: (context, active) => startFlood(context, active),
    tick: (context, active) => advanceFlood(context, active),
    isFinished: (world, active) => {
      if (((active.state['wet'] as number | undefined) ?? 0) === 0) return true;
      for (let tile = 0; tile < world.flood.length; tile++) {
        if ((world.flood[tile] ?? 0) > 0) return false;
      }
      return true;
    },
  };
}

function startFlood(context: DisasterContext, active: ActiveDisaster): void {
  const { world, balance } = context;
  const flood = balance.disasters.flood;
  const origin = index(context.x, context.y, world.size);

  // Hladina se odvozuje od břehu, kde vlna vznikla. Dlaždice pod ní se zaplaví
  // do hloubky rozdílu, dlaždice nad ní zůstane suchá — a hráz o jedno patro
  // je tím pádem trvalá obrana, ne sázka.
  const level = tileBaseHeight(world.cornerHeight, context.x, context.y) + flood.waterRise;
  const reach = flood.reachMin + world.rng.int(flood.reachMax - flood.reachMin + 1);
  const advance =
    flood.advanceTicksMin + world.rng.int(flood.advanceTicksMax - flood.advanceTicksMin + 1);
  const duration =
    flood.durationMin + world.rng.int(flood.durationMax - flood.durationMin + 1);

  active.state['level'] = level;
  active.state['reach'] = reach;
  active.state['advance'] = advance;
  active.state['duration'] = duration;
  active.state['front'] = [origin];
  active.state['wet'] = 0;
  active.state['spread'] = 0;

  soak(world, active, [origin], level, duration);
}

/**
 * Jeden krok vlny.
 *
 * Postupuje se **po prstencích**: čelo vlny se v jednom tiku rozlije na
 * sousedy a ti se stanou novým čelem. Bez toho by se voda ve stejném tiku
 * rozlila přes celou mapu a hráč by neměl co sledovat.
 */
function advanceFlood(context: DisasterContext, active: ActiveDisaster): void {
  const { world } = context;
  const spread = (active.state['spread'] as number | undefined) ?? 0;
  const advance = (active.state['advance'] as number | undefined) ?? 0;
  const reach = (active.state['reach'] as number | undefined) ?? 0;
  if (spread >= advance || spread >= reach) return;

  const level = (active.state['level'] as number | undefined) ?? 0;
  const duration = (active.state['duration'] as number | undefined) ?? 0;
  const front = (active.state['front'] as number[] | undefined) ?? [];
  const next: number[] = [];

  for (const tile of front) {
    const x = tile % world.size;
    const y = (tile - x) / world.size;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      const at = index(nx, ny, world.size);
      if (isFlooded(world, at)) continue;
      next.push(at);
    }
  }

  active.state['spread'] = spread + 1;
  active.state['front'] = soak(world, active, next, level, duration);
}

/**
 * Zaplaví, co je pod hladinou. Vrací dlaždice, které opravdu zvlhly.
 *
 * Voda přes vlastní vodní plochu neteče — moře už tam je. A dlaždice, jejíž
 * terén sahá k hladině nebo nad ni, zůstane suchá; z toho plyne celá obrana
 * převýšením.
 */
function soak(
  world: WorldState,
  active: ActiveDisaster,
  tiles: readonly number[],
  level: number,
  duration: number,
): number[] {
  const soaked: number[] = [];
  for (const tile of tiles) {
    if (world.layers.terrain[tile] === TERRAIN.water) continue;

    const x = tile % world.size;
    const height = tileBaseHeight(world.cornerHeight, x, (tile - x) / world.size);
    const depth = level - height;
    if (depth <= 0) continue;

    if (floodTile(world, tile, depth, duration)) soaked.push(tile);
  }

  active.state['wet'] = ((active.state['wet'] as number | undefined) ?? 0) + soaked.length;
  return soaked;
}

/**
 * Vážený los ohniska přes pobřežní dlaždice.
 *
 * Váha roste s **délkou souvislého pobřeží v okolí**: zálivy a ústí jsou
 * zranitelnější než rovný břeh, protože se do nich voda nahrne ze tří stran.
 * Rovnoměrný los by z povodně udělal loterii bez místa, které si o ni říká.
 */
function pickCoast(world: WorldState, balance: Balance): { x: number; y: number } | null {
  const tiles: number[] = [];
  const weights: number[] = [];
  let total = 0;

  for (let tile = 0; tile < world.flood.length; tile++) {
    if (world.layers.terrain[tile] === TERRAIN.water) continue;
    if (isFlooded(world, tile)) continue;

    const x = tile % world.size;
    const y = (tile - x) / world.size;
    if (!touchesWater(world, x, y)) continue;

    const weight = 1 + coastAround(world, x, y) * balance.disasters.flood.bayWeight;
    tiles.push(tile);
    weights.push(weight);
    total += weight;
  }

  if (total <= 0) return null;

  let roll = world.rng.next() * total;
  for (let i = 0; i < tiles.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll > 0) continue;
    const tile = tiles[i] ?? 0;
    const x = tile % world.size;
    return { x, y: (tile - x) / world.size };
  }

  const last = tiles[tiles.length - 1] ?? 0;
  const x = last % world.size;
  return { x, y: (last - x) / world.size };
}

function touchesWater(world: WorldState, x: number, y: number): boolean {
  return waterSides(world, x, y) > 0;
}

/**
 * Kolik ze souše v okolí je pobřeží, 0–1.
 *
 * Zadání mluví o **délce souvislého pobřeží v okolí**: u rovné pláže vede
 * oknem jedna linie, v ústí zálivu tři. Dvě jednodušší míry to neodliší —
 * podíl vody v okně i počet vodních stran se mezi zálivem a pláží liší sotva
 * o desetinu, protože i v zálivu má většina břehových dlaždic jediného
 * vodního souseda.
 *
 * Dělí se **souší, ne celým oknem**. Okno v zálivu je z velké části voda a
 * ta by podíl naředila přesně tam, kde má vyjít nejvyšší.
 */
function coastAround(world: WorldState, x: number, y: number): number {
  let coast = 0;
  let land = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      if (world.layers.terrain[index(nx, ny, world.size)] === TERRAIN.water) continue;
      land++;
      if (touchesWater(world, nx, ny)) coast++;
    }
  }
  return land === 0 ? 0 : coast / land;
}

function waterSides(world: WorldState, x: number, y: number): number {
  let sides = 0;
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
    if (world.layers.terrain[index(nx, ny, world.size)] === TERRAIN.water) sides++;
  }
  return sides;
}

function cellOf(world: WorldState, tile: number): number {
  const x = tile % world.size;
  return coarseIndex(x, (tile - x) / world.size, world.size);
}

function markTileAt(world: WorldState, tile: number): void {
  const x = tile % world.size;
  markTileDirty(world, x, (tile - x) / world.size);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
