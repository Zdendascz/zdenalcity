import type { Balance } from '@/content/balance';
import { checkFootprint, placeBuilding } from '../buildings';
import type { BuildingCatalogue } from '../catalogue';
import { coarseCellsOf, coarseIndex } from '../coarse';
import { isFlatTile } from '../heights';
import { index, ROAD, ZONE } from '../layers';
import { seedDefinitions } from '../levels';
import { categoryForZone, RCI_CATEGORIES } from '../rci';
import { checkRequirements, presentDefinitions } from '../requirements';
import type { RciCategory } from '../rci';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Růst zástavby (§9 zadání fáze 2).
 *
 * ```
 * skóre  = (cenaPůdy + 1) ^ EXPONENT × faktorSilnice × faktorDostupnostiPráce
 * pokusů = clamp(round(poptávka / POPTÁVKA_NA_POKUS × faktorDaně), 0, MAX_POKUSŮ)
 * ```
 *
 * Parcela se losuje **váženě podle skóre**, takže drahá půda u silnice se
 * zastaví dřív než bahno na kraji mapy. Poptávka není vypínač, ale rychlost:
 * poptávka 5 a 50 se konečně liší.
 *
 * Silnice se počítá **dosahem, ne sousedstvím**: parcela dvě dlaždice od
 * vozovky se zastaví, jen vzácněji. Dál než tři dlaždice z losu vypadne úplně —
 * tím se řeší slabina fáze 1, kde nedosažitelné dlaždice ředily los a
 * zpomalovaly růst i tam, kde stavět šlo.
 */

/** Jedna parcela v losu. `weight` nula znamená „vyřazena". */
interface Candidate {
  tile: number;
  weight: number;
}

export function createGrowthSystem(catalogue: BuildingCatalogue, balance: Balance): System {
  return {
    name: 'growth',
    interval: 12,
    offset: 2,
    run(world: WorldState) {
      grow(world, catalogue, balance);
    },
  };
}

function grow(world: WorldState, catalogue: BuildingCatalogue, balance: Balance): void {
  // Bankrot: dokud je město v minusu, nic nového nevyroste. Hráč musí zvednout
  // daně nebo něco zbourat.
  if (world.economy.funds < 0) return;

  // Kam až od silnice se staví, říká balanc — délka tabulky je dosah.
  const reach = roadReach(world, balance.growth.roadFactors.length - 1);
  // Dostupnost práce vstupuje dvakrát a záměrně:
  // - **po čtvrtích** do skóre parcely, takže dobře obsloužená čtvrť se
  //   zastaví dřív než ta na konci světa (§5),
  // - **celoměstsky** do počtu pokusů, protože rovnoměrný násobitel by se ve
  //   váženém losu vykrátil a město bez spojení by rostlo stejně rychle jako
  //   město s metrem. Stejný důvod jako u faktoru daně v T18.
  const access = jobAccessByCell(world, catalogue, balance.growth.minAccessFactor);
  const cityAccess = cityAccessFactor(world, catalogue, balance.growth.minAccessFactor);
  // Ať panel parcely ukazuje čísla, se kterými růst opravdu počítal.
  world.jobAccessCells = access;
  world.cityJobAccess = cityAccess;
  // Jednou za běh, ne u každého pokusu — seznam se během něj nemění tak, aby
  // to hráč poznal, a procházet všechny budovy dvanáctkrát je zbytečné.
  const present = presentDefinitions(world);

  // Pevné pořadí kategorií, ne pořadí nějaké mapy — jinak by determinismus
  // závisel na historii vkládání (P2).
  for (const category of RCI_CATEGORIES) {
    const attempts = attemptsFor(world, balance, category, cityAccess);
    if (attempts === 0) continue;

    const candidates = collectCandidates(world, balance, category, reach, access);
    let total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);

    for (let attempt = 0; attempt < attempts && total > 0; attempt++) {
      const picked = pick(candidates, world.rng.next() * total);
      if (!picked) break;

      // Parcela padá z losu bez ohledu na výsledek: buď se zastavěla, nebo se
      // ukázalo, že se na ni stavět nedá.
      total -= picked.weight;
      picked.weight = 0;

      tryBuild(world, catalogue, category, picked.tile, present);
    }
  }
}

/**
 * Kolik pokusů poptávka zaplatí.
 *
 * `faktorDaně` je tady, a ne ve skóre parcely: uvnitř kategorie je pro všechny
 * parcely stejný, takže by se ve váženém losu vykrátil a daň by na růst neměla
 * vliv. Zadání §9 přitom chce pravý opak — je to první skutečná vazba daní na
 * růst. **Doplněk zadání**, které vzorec dělí mezi skóre a počet pokusů.
 */
function attemptsFor(
  world: WorldState,
  balance: Balance,
  category: RciCategory,
  cityAccess: number,
): number {
  const demand = world.demand[category];
  if (demand <= 0) return 0;

  const { demandPerAttempt, maxAttempts, neutralTaxRate, taxRange } = balance.growth;
  const rate = world.economy.taxRates[category];
  const taxFactor = Math.max(0.2, Math.min(1.5, 1 - (rate - neutralTaxRate) / taxRange));

  const raw = (demand / demandPerAttempt) * taxFactor * cityAccess;

  // **Zlomek pokusu se nezaokrouhluje, ale losuje.** Původní `Math.round` dělal
  // z každé hodnoty pod 0,5 tvrdou nulu, takže město s poptávkou 26 a špatnou
  // dostupností práce (0,487 pokusu) stálo úplně — přesně to, co R6 zakazuje:
  // „roste pomalu, ne vůbec". Vyplavalo to při hraní ve fázi 3b, ne z testů.
  //
  // Takhle zůstane střední hodnota přesně `raw` a pomalý růst je opravdu
  // pomalý, ne žádný. Náhoda jde z `world.rng`, takže determinismus platí (P2).
  const whole = Math.floor(raw);
  const attempts = whole + (world.rng.next() < raw - whole ? 1 : 0);
  return Math.max(0, Math.min(maxAttempts, attempts));
}

/**
 * Volné zónované parcely dané kategorie i s váhou.
 *
 * K ceně půdy se přičítá jednička, aby čerstvá mapa vůbec začala růst — cena
 * půdy se do svého základu teprve rozjíždí a nulová váha by znamenala, že se
 * první měsíce nepostaví nic.
 */
function collectCandidates(
  world: WorldState,
  balance: Balance,
  category: RciCategory,
  reach: Uint8Array,
  access: Float32Array,
): Candidate[] {
  const { zone, buildingId, road } = world.layers;
  const candidates: Candidate[] = [];

  for (let tile = 0; tile < zone.length; tile++) {
    if (buildingId[tile] !== 0 || road[tile] !== 0) continue;
    if (categoryForZone(zone[tile] ?? ZONE.none) !== category) continue;

    const distance = reach[tile] ?? 255;
    const roadFactor = balance.growth.roadFactors[distance] ?? 0;
    if (roadFactor === 0) continue; // mimo dosah silnice se nestaví vůbec

    const x = tile % world.size;
    const y = (tile - x) / world.size;
    const cell = coarseIndex(x, y, world.size);
    const landValue = world.coarse.landValue[cell] ?? 0;
    // Na svahu se staví dráž, takže se tam staví méně ochotně. Není to zákaz:
    // zóna na kopci roste pomaleji, ne vůbec — stejná logika jako u dostupnosti
    // práce (R6). Do T41 to zákaz byl a půlka mapy se tím stala nezastavitelnou.
    const slopeFactor = isFlatTile(world.cornerHeight, x, y) ? 1 : balance.growth.slopeFactor;
    const weight =
      Math.pow(landValue + 1, balance.growth.exponent) *
      roadFactor *
      slopeFactor *
      (access[cell] ?? 1);
    if (weight > 0) candidates.push({ tile, weight });
  }

  return candidates;
}

/** Vážený los: vrátí parcelu, do jejíhož intervalu spadne `roll`. */
function pick(candidates: readonly Candidate[], roll: number): Candidate | undefined {
  let seen = 0;
  let last: Candidate | undefined;

  for (const candidate of candidates) {
    if (candidate.weight === 0) continue;
    seen += candidate.weight;
    if (roll < seen) return candidate;
    last = candidate;
  }

  // Zaokrouhlovací chyba u konce intervalu — vezmi poslední, co ještě hraje.
  return last;
}

/**
 * Vzdálenost každé dlaždice k nejbližší silnici, ořezaná na dosah růstu.
 *
 * Průchod do šířky ze všech silnic naráz: jeden průchod mapou místo prohledávání
 * okolí u každé z tisíců parcel.
 */
export function roadReach(world: WorldState, maxDistance: number): Uint8Array {
  const { road } = world.layers;
  const distance = new Uint8Array(road.length).fill(255);
  let frontier: number[] = [];

  for (let tile = 0; tile < road.length; tile++) {
    if ((road[tile] ?? ROAD.none) !== ROAD.none) {
      distance[tile] = 0;
      frontier.push(tile);
    }
  }

  for (let step = 1; step <= maxDistance && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const tile of frontier) {
      const x = tile % world.size;
      const y = (tile - x) / world.size;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) continue;
        const at = index(nx, ny, world.size);
        if (distance[at] !== 255) continue;
        distance[at] = step;
        next.push(at);
      }
    }
    frontier = next;
  }

  return distance;
}

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

function tryBuild(
  world: WorldState,
  catalogue: BuildingCatalogue,
  category: RciCategory,
  tile: number,
  present: ReadonlySet<string>,
): void {
  const x = tile % world.size;
  const y = (tile - x) / world.size;
  const zone = world.layers.zone[tile] ?? ZONE.none;

  // Na prázdné parcele vyroste vždycky ta nejmenší budova první úrovně. Vyšší
  // úrovně a větší půdorysy se dají jen povýšením (§8), jinak by se na volném
  // poli objevil rovnou věžák.
  const options = seedDefinitions(catalogue, category);
  if (options.length === 0) return;

  const definition = options[world.rng.int(options.length)];
  if (!definition) return;

  // Celý footprint musí ležet ve stejné zóně — dům nepřeteče do sousední čtvrti.
  // Sousedství se silnicí se **nekontroluje**: pro růst ho nahradil dosah, jinak
  // by parcela dvě dlaždice od vozovky nemohla vyrůst nikdy (§9).
  //
  // **Rovina se nekontroluje taky** (rozhodnutí autora, T41): dům ze zóny stojí
  // i na svahu, jen je to dražší, a to už je v jeho váze v losu. Renderer mu
  // dokreslí podezdívku. Ruční stavba se dál srovnává — u elektrárny nebo
  // kliniky se s podezdívkou počítat nedá.
  //
  // Důvod odmítnutí tady nikoho nezajímá: systém zkusí jiné místo příště.
  const fits = checkFootprint(world, definition, x, y, {
    requireZone: zone,
    skipRoadCheck: true,
    skipFlatCheck: true,
  });
  if (!fits.ok) return;
  // Prerekvizity definice (§7). Vanilla je nemá, ale mod je mít může.
  if (!checkRequirements(world, catalogue, definition, x, y, present).ok) return;

  placeBuilding(world, definition, x, y);
}

/**
 * Násobitel skóre podle dosažitelnosti práce, po buňkách hrubé mřížky (R6).
 *
 * **Moduluje, nevetuje.** Tvrdá brána by hru zamkla: na začátku nejsou žádná
 * pracovní místa, takže by dosažitelnost byla všude nulová, nic by nevyrostlo
 * a místa by nikdy nevznikla. Špatně obsloužená čtvrť proto roste pomalu, ne
 * vůbec.
 *
 * Prázdná čtvrť dostane jedničku — nová zástavba se netrestá za to, že v ní
 * zatím nikdo nebydlí. A dokud ve městě není ani jedno pracovní místo, platí
 * jednička všude; jinak by první dům neměl kam chodit a hra by se nerozjela.
 */
function jobAccessByCell(
  world: WorldState,
  catalogue: BuildingCatalogue,
  minFactor: number,
): Float32Array {
  const cells = coarseCellsOf(world.size);
  const factors = new Float32Array(cells).fill(1);

  let totalJobs = 0;
  for (const building of world.buildings.values()) {
    if (!building.abandoned) totalJobs += building.jobs;
  }
  if (totalJobs === 0) return factors;

  const sums = new Float32Array(cells);
  const counts = new Float32Array(cells);

  for (const building of world.buildings.values()) {
    if (building.abandoned || building.population === 0) continue;
    if (catalogue.get(building.definitionId)?.category !== 'residential') continue;

    const cell = coarseIndex(building.x, building.y, world.size);
    sums[cell] = (sums[cell] ?? 0) + (world.jobAccess.get(building.id) ?? 0);
    counts[cell] = (counts[cell] ?? 0) + 1;
  }

  const min = minFactor;
  for (let cell = 0; cell < factors.length; cell++) {
    const count = counts[cell] ?? 0;
    if (count === 0) continue; // prázdná čtvrť zůstává na jedničce
    const average = (sums[cell] ?? 0) / count;
    factors[cell] = min + (1 - min) * Math.max(0, Math.min(1, average));
  }

  return factors;
}

/**
 * Jak dobře se ve městě jako celku dostane do práce, převedené na násobitel
 * rychlosti růstu (R6).
 *
 * **Moduluje, nevetuje** — nejnižší hodnota je `minAccessFactor`, ne nula.
 * A dokud ve městě není ani jedno pracovní místo, je to jednička: jinak by se
 * hra zamkla hned na začátku, kdy dosažitelnost nutně nula je.
 */
function cityAccessFactor(
  world: WorldState,
  catalogue: BuildingCatalogue,
  minFactor: number,
): number {
  let jobs = 0;
  let sum = 0;
  let homes = 0;

  for (const building of world.buildings.values()) {
    if (building.abandoned) continue;
    jobs += building.jobs;
    if (building.population === 0) continue;
    if (catalogue.get(building.definitionId)?.category !== 'residential') continue;
    sum += world.jobAccess.get(building.id) ?? 0;
    homes++;
  }

  if (jobs === 0 || homes === 0) return 1;

  const average = Math.max(0, Math.min(1, sum / homes));
  return minFactor + (1 - minFactor) * average;
}
