import type { Balance, BurnBalance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { index, ROAD, TERRAIN } from '../layers';
import type { System } from '../systems/index';
import { markTerrainChanged, markTileDirty, removeBuilding } from '../world';
import type { WorldState } from '../world';
import type { Disaster, DisasterContext } from './registry';
import { spawnRubble } from './rubble';
import { tilesOf } from './shapes';
import { addToll, blameFor } from './state';
import type { ActiveDisaster } from './state';

/**
 * Oheň (§4 fáze 4).
 *
 * Jediná katastrofa s plnohodnotným šířením, a proto ta, na které stojí
 * polovina ostatních — tornádo, zemětřesení, výbuch i nepokoje zakládají
 * ohniska právě sem.
 *
 * Každá hořící dlaždice nese **intenzitu** a **palivo** a je to závod:
 *
 * ```
 * palivo    -= 1
 * intenzita += přírůstek
 * intenzita -= základ + coverage[fire][buňka] × podíl
 *
 * intenzita <= 0 → uhašeno, budova přežila
 * palivo    <= 0 → zničena, trosky
 * ```
 *
 * Buď hasiči stihnou intenzitu srazit dřív, než dojde palivo, nebo dům shoří.
 * Zásah se neprojevuje příjezdem vozu, ale hodnotou `coverage[fire]` — a ta
 * u podfinancované stanice klesá (fáze 2 §6), takže hoří déle.
 *
 * **Silnice, voda, prázdná dlaždice a potrubí nehoří vůbec.** Z toho vzniká
 * hlavní aktivní mechanika: hráč prorazí buldozerem průsek a oheň zastaví.
 */

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** Co na dlaždici hoří a jak dlouho. Nula znamená „nehoří vůbec". */
export interface Flammable {
  flammability: number;
  fuel: number;
}

const NOTHING: Flammable = { flammability: 0, fuel: 0 };

/**
 * Hořlavost dlaždice podle toho, co na ní stojí.
 *
 * Rozhoduje **obsah, ne konkrétní budova** (P5): kategorie zástavby, ruina,
 * les, trosky. Výjimkou jsou třídy služeb v `byClass` — park hoří desetkrát
 * hůř než hasičárna, i když obojí je služba, a právě proto se z parku dá
 * udělat protipožární bariéra.
 *
 * Pořadí kontrol je pořadí přebíjení: silnice přebije všechno (průsek musí
 * fungovat i skrz les), voda a zaplavená dlaždice taky.
 */
export function flammableAt(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  tile: number,
): Flammable {
  const fire = balance.disasters.fire;

  // Silnice je protipožární linie. Kdyby hořela, průsek by nefungoval a hráč
  // by proti ohni neměl vůbec žádnou aktivní obranu.
  if ((world.layers.road[tile] ?? ROAD.none) !== ROAD.none) return NOTHING;
  if ((world.layers.pipe[tile] ?? 0) !== 0 && (world.layers.buildingId[tile] ?? 0) === 0) {
    return NOTHING;
  }

  const terrain = world.layers.terrain[tile] ?? TERRAIN.grass;
  if (terrain === TERRAIN.water) return NOTHING;
  // Zaplavená dlaždice nehoří, i kdyby na ní stál dřevěný dům.
  if ((world.flood?.[tile] ?? 0) > 0) return NOTHING;

  const buildingId = world.layers.buildingId[tile] ?? 0;
  if (buildingId !== 0) {
    const building = world.buildings.get(buildingId);
    if (building) {
      if (building.abandoned) return entry(fire, 'abandoned');
      const definition = catalogue.get(building.definitionId);
      const serviceClass = definition?.service?.class;
      if (serviceClass) {
        const override = fire.byClass[serviceClass];
        if (override) return override;
      }
      return entry(fire, definition?.category ?? 'service');
    }
  }

  if ((world.rubble[tile] ?? 0) !== 0) return entry(fire, 'rubble');
  if (terrain === TERRAIN.forest) return entry(fire, 'forest');

  // Tráva, písek, skála i mokřad: není co zapálit.
  return NOTHING;
}

function entry(fire: Balance['disasters']['fire'], key: string): Flammable {
  const flammability = fire.flammability[key];
  const fuel = fire.fuel[key];
  if (flammability === undefined || fuel === undefined) return NOTHING;
  return { flammability, fuel };
}

/**
 * Zapálí dlaždici, pokud je co zapálit. Vrací `true`, když chytla.
 *
 * Palivo se zapisuje **při zapálení**, ne při každém tiku: kdyby se bralo
 * z tabulky průběžně, přestavba budovy uprostřed požáru by mu palivo
 * doplnila a hořelo by donekonečna.
 */
export function igniteTile(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  tile: number,
  intensity: number,
  wildfire: boolean,
): boolean {
  if ((world.fire[tile] ?? 0) > 0) return false;

  const fuel = flammableAt(world, catalogue, balance, tile);
  if (fuel.flammability <= 0 || fuel.fuel <= 0) return false;

  world.fire[tile] = clampByte(intensity);
  world.fuel[tile] = Math.min(255, fuel.fuel);
  world.fireFlags[tile] = wildfire ? 1 : 0;
  markTileAt(world, tile);
  return true;
}

/** Uhasí dlaždici. Volá to buldozer i konec hoření. */
export function extinguishTile(world: WorldState, tile: number): void {
  if ((world.fire[tile] ?? 0) === 0 && (world.fuel[tile] ?? 0) === 0) return;
  world.fire[tile] = 0;
  world.fuel[tile] = 0;
  world.fireFlags[tile] = 0;
  markTileAt(world, tile);
}

/**
 * Ohňový tik. Běží každé dva tiky simulace, **nezávisle na plánovači**.
 *
 * Hořící dlaždice se procházejí vzestupně podle indexu a náhoda jde z
 * `world.rng` — jinak padá determinismus (P2). Pauza pauzuje i požár, protože
 * je to obyčejný systém.
 */
export function createFireSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'fire',
    interval: balance.disasters.fire.tickInterval,
    offset: 1,
    run(world: WorldState) {
      const fire = balance.disasters.fire;
      const layer = world.fire;

      // Seznam se vyrobí **předem**. Kdyby se procházela vrstva průběžně,
      // dlaždice zapálená v tomhle tiku by v něm rovnou i hořela a oheň by
      // se šířil několikanásobně rychleji směrem k rostoucím indexům.
      const burning: number[] = [];
      for (let tile = 0; tile < layer.length; tile++) {
        if ((layer[tile] ?? 0) > 0) burning.push(tile);
      }
      countBurning(world);
      if (burning.length === 0) return;

      const coverage = world.coverage.get('fire');
      const destroyed: number[] = [];
      const ignitions: { tile: number; intensity: number; wildfire: boolean }[] = [];

      for (const tile of burning) {
        const wildfire = (world.fireFlags[tile] ?? 0) === 1;
        const burn = burnSettings(balance, wildfire);
        const cell = cellOf(world, tile);

        const fuelLeft = (world.fuel[tile] ?? 0) - 1;
        world.fuel[tile] = Math.max(0, fuelLeft);

        const suppression = fire.suppressBase + (coverage?.[cell] ?? 0) * fire.suppressPerCoverage;
        const intensity = (layer[tile] ?? 0) + burn.intensityGrowth - suppression;

        // Znečištění vydechne každá hořící dlaždice, i ta, která zrovna hasne.
        world.coarse.pollution[cell] = clampByte(
          (world.coarse.pollution[cell] ?? 0) + fire.pollutionPerTick,
        );

        if (intensity <= 0) {
          extinguishTile(world, tile);
          continue;
        }

        if (fuelLeft <= 0) {
          destroyed.push(tile);
          continue;
        }

        layer[tile] = clampByte(intensity);
        markTileAt(world, tile);

        // Šíření se **sbírá** a zapaluje se až po průchodu, ze stejného důvodu
        // jako seznam nahoře.
        const x = tile % world.size;
        const y = (tile - x) / world.size;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
          const at = index(nx, ny, world.size);
          if ((layer[at] ?? 0) > 0) continue;

          const target = flammableAt(world, catalogue, balance, at);
          if (target.flammability <= 0) continue;

          const chance = (layer[tile] ?? 0) / 255 * target.flammability * burn.spreadChance;
          // Hází se i tam, kde šance vyjde nulová — vynechaný hod by posunul
          // `rng` jinak podle toho, co má hráč postavené (P2).
          if (world.rng.next() < chance) {
            ignitions.push({ tile: at, intensity: burn.ignitionIntensity, wildfire });
          }
        }
      }

      for (const spot of ignitions) {
        igniteTile(world, catalogue, balance, spot.tile, spot.intensity, spot.wildfire);
      }

      if (destroyed.length > 0) burnDown(world, catalogue, balance, destroyed);
      // Po zapálení i po dohoření se počty změnily; katastrofy z nich čtou,
      // jestli už je po nich.
      countBurning(world);
      world.dirty.coarseChanged = true;
    },
  };
}

/**
 * Dlaždice, kterým došlo palivo.
 *
 * Budova mizí **celá**, i když hořel jen její roh: dům s vyhořelým patrem
 * není poloviční dům. Zbytek jejího půdorysu se zároveň uhasí, aby po ní
 * nezůstal oheň hořící na prázdné parcele.
 */
function burnDown(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  tiles: readonly number[],
): void {
  const fire = balance.disasters.fire;
  const doomed = new Set<number>();
  let lost = 0;
  let residents = 0;

  for (const tile of tiles) {
    const buildingId = world.layers.buildingId[tile] ?? 0;
    if (buildingId !== 0) {
      doomed.add(buildingId);
      continue;
    }

    extinguishTile(world, tile);

    if (world.layers.terrain[tile] === TERRAIN.forest) {
      // Vyhořelý les se mění na trávu, ne na trosky, a sám se neobnovuje.
      // Je to trvalá ztráta bonusu ceny půdy i pohlcování znečištění.
      world.layers.terrain[tile] = TERRAIN.grass;
      markTerrainChanged(world);
      markTileAt(world, tile);
      continue;
    }

    // Dlaždice bez budovy, která není les, je hořící suť — a ta už trosky
    // nese. Nic dalšího tu vzniknout nemá: silnice ani potrubí nehoří, takže
    // trosky po nich nechávají až ničivé katastrofy z T51.
  }

  for (const id of [...doomed].sort((a, b) => a - b)) {
    const building = world.buildings.get(id);
    if (!building) continue;
    const definition = catalogue.get(building.definitionId);
    const [width, depth] = definition?.footprint ?? [1, 1];

    for (let dy = 0; dy < depth; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const x = building.x + dx;
        const y = building.y + dy;
        if (x >= world.size || y >= world.size) continue;
        const tile = index(x, y, world.size);
        extinguishTile(world, tile);
        spawnRubble(world, tile, building.definitionId);
      }
    }

    const inside = building.population;
    if (removeBuilding(world, id)) {
      lost++;
      residents += inside;
    }
  }

  /*
   * Oběti se připíšou **běžícímu požáru**, ne tomuhle systému.
   *
   * Hoří se mimo `advance`: systém projde plamen po plameni každý tik, takže
   * sám o sobě neví, čí požár to je. Vlastníkem je proto nejdéle běžící
   * pohroma druhu „požár" nebo „lesní požár" — a když žádná neběží (oheň
   * založený výbuchem, který už skončil), nepřipíšou se nikam.
   */
  if (residents > 0) {
    const owner = blameFor(world.disasters.active, ['fire', 'wildfire']);
    if (owner) addToll(owner, residents * balance.disasters.casualties.burn);
  }

  if (lost > 0 && fire.happinessPerLoss > 0) {
    // Celoměstsky, ne jen v okolí: vyhořelý dům je zpráva pro celé město.
    // Prázdný seznam buněk znamená „všude".
    world.disasters.modifiers.push({
      kind: 'happinessPenalty',
      cells: [],
      amount: fire.happinessPerLoss * lost,
      until: world.tick + fire.happinessPenaltyTicks,
      source: 0,
    });
  }
}

function burnSettings(balance: Balance, wildfire: boolean): BurnBalance {
  const kind = wildfire ? 'wildfire' : 'fire';
  const burn = balance.disasters.types[kind]?.burn;
  // Obsah bez `burn` u požáru je chyba validace, ne stav, se kterým se počítá.
  return burn ?? FALLBACK_BURN;
}

const FALLBACK_BURN: BurnBalance = {
  wildfire: false,
  ignitionIntensity: 100,
  intensityGrowth: 6,
  spreadChance: 0.5,
  minIgnitions: 1,
  maxIgnitions: 1,
};

/**
 * Požár jako katastrofa.
 *
 * Ohnisko se losuje váženě: `hořlavost × (1 − coverage[fire]/255) ×
 * (1 + crime/255 × 0,8)`. Nejpravděpodobněji hoří tam, kde je co zapálit,
 * nikdo to nehasí a už je to zanedbané — tedy přesně tam, kde to hráče má
 * upozornit, že něco zanedbal.
 */
export function createFireDisaster(): Disaster {
  return {
    kind: 'fire',
    pickOrigin: (world, catalogue, balance) => pickBurnable(world, catalogue, balance, false),
    start: (context, active) => startBurn(context, active, false),
    tick: () => {},
    isFinished: (world, active) => burnedOut(world, active, false),
  };
}

/**
 * Lesní požár.
 *
 * Vzniká **mimo město**, kde je les nejhustší, bez ohledu na hasiče. Hráč má
 * typicky deset až třicet tiků, než dorazí k první budově — a to je ta hlavní
 * mechanika: čas zareagovat. Vykácet pás lesa, nebo ho nechat dohořet, míří-li
 * pryč.
 *
 * Hájí se **od uhašení**, ne od vzniku: jinak by mohl začít druhý, zatímco
 * první ještě hoří.
 */
export function createWildfireDisaster(): Disaster {
  return {
    kind: 'wildfire',
    cooldownFromEnd: true,
    pickOrigin: (world, catalogue, balance) => pickBurnable(world, catalogue, balance, true),
    start: (context, active) => startBurn(context, active, true),
    tick: () => {},
    isFinished: (world, active) => burnedOut(world, active, true),
  };
}

/**
 * Katastrofa je hotová, jakmile dohoří.
 *
 * `tick()` je prázdný schválně — samotné hoření obstarává `fireSystem`, který
 * běží po svém. Katastrofa jen drží dlaždice, které založila, aby se poznalo,
 * kdy skončila; jinak by hájení běželo od okamžiku, kdy vyskočil první plamen.
 */
function startBurn(context: DisasterContext, active: ActiveDisaster, wildfire: boolean): void {
  const { world, catalogue, balance } = context;
  const burn = burnSettings(balance, wildfire);

  const count =
    burn.minIgnitions + world.rng.int(burn.maxIgnitions - burn.minIgnitions + 1);
  const lit: number[] = [];

  // První ohnisko je tam, kam ukázal plánovač nebo hráč; další se rozsypou
  // kolem něj, ať výbuch nebo blesk nezaloží tři požáry přes celou mapu.
  const origin = index(context.x, context.y, world.size);
  if (igniteTile(world, catalogue, balance, origin, burn.ignitionIntensity, wildfire)) {
    lit.push(origin);
  }

  const nearby = tilesOf(world, { kind: 'radius', x: context.x, y: context.y, radius: 3 });
  while (lit.length < count && nearby.length > 0) {
    const pick = nearby.splice(world.rng.int(nearby.length), 1)[0];
    if (pick === undefined) break;
    if (igniteTile(world, catalogue, balance, pick, burn.ignitionIntensity, wildfire)) {
      lit.push(pick);
    }
  }

  active.state['lit'] = lit.length;
  active.state['wildfire'] = wildfire;
  // Bez přepočtu by katastrofa skončila dřív, než ohňový systém poprvé
  // proběhne — počty by ještě byly nulové.
  countBurning(world);
}

/**
 * Přepočítá, kolik dlaždic hoří kterým způsobem.
 *
 * Je to **odvozený údaj**, ne stav: po načtení savu se dopočítá z vrstvy
 * `fire`. Katastrofy se z něj dozvídají, jestli po nich ještě něco hoří —
 * jinak by lesní požár, který se hájí od uhašení, skončil v okamžiku, kdy
 * vyskočil první plamen.
 */
export function countBurning(world: WorldState): void {
  let normal = 0;
  let wild = 0;
  for (let tile = 0; tile < world.fire.length; tile++) {
    if ((world.fire[tile] ?? 0) === 0) continue;
    if ((world.fireFlags[tile] ?? 0) === 1) wild++;
    else normal++;
  }
  world.disasters.burning = { normal, wildfire: wild };
}

/**
 * Katastrofa skončila, když po ní nic nehoří.
 *
 * Zapálila-li nulu dlaždic — třeba proto, že hráč spustil požár doprostřed
 * pole — je hotová hned. To je správně: nic se nestalo.
 */
function burnedOut(world: WorldState, active: ActiveDisaster, wildfire: boolean): boolean {
  if (((active.state['lit'] as number | undefined) ?? 0) === 0) return true;
  const burning = world.disasters.burning;
  return (wildfire ? burning.wildfire : burning.normal) === 0;
}

/**
 * Vážený los ohniska.
 *
 * Kandidáti se prochází celou mapou, ale je to **jednorázová akce při vzniku
 * katastrofy**, ne věc tiku — pár set tisíc porovnání jednou za měsíc nikoho
 * nebolí a udržovaný seznam „všeho hořlavého" by se rozcházel při každé
 * postavené i zbourané budově.
 */
function pickBurnable(
  world: WorldState,
  catalogue: BuildingCatalogue,
  balance: Balance,
  wildfire: boolean,
): { x: number; y: number } | null {
  const weights: number[] = [];
  const tiles: number[] = [];
  let total = 0;

  for (let tile = 0; tile < world.fire.length; tile++) {
    if ((world.fire[tile] ?? 0) > 0) continue;
    const fuel = flammableAt(world, catalogue, balance, tile);
    if (fuel.flammability <= 0) continue;

    let weight: number;
    if (wildfire) {
      // Lesní požár vzniká tam, kde je les souvislý — a hasiče neřeší.
      if (world.layers.terrain[tile] !== TERRAIN.forest) continue;
      weight = 1 + forestDensity(world, tile) * 0.8;
    } else {
      const cell = cellOf(world, tile);
      const covered = 1 - (world.coverage.get('fire')?.[cell] ?? 0) / 255;
      const crime = 1 + ((world.coarse.crime[cell] ?? 0) / 255) * 0.8;
      weight = fuel.flammability * covered * crime;
    }

    if (weight <= 0) continue;
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

/** Podíl lesa v okruhu tří dlaždic. Souvislý les hoří ochotněji než remízek. */
function forestDensity(world: WorldState, tile: number): number {
  const x = tile % world.size;
  const y = (tile - x) / world.size;
  let forest = 0;
  let total = 0;

  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
      total++;
      if (world.layers.terrain[index(nx, ny, world.size)] === TERRAIN.forest) forest++;
    }
  }

  return total === 0 ? 0 : forest / total;
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
