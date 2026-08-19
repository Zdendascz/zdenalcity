import type { Balance } from '@/content/balance';
import { checkFootprint, placeBuilding } from '../buildings';
import type { BuildingCatalogue } from '../catalogue';
import { coarseIndex } from '../coarse';
import { index, MAP_SIZE, ZONE } from '../layers';
import { seedDefinitions } from '../levels';
import { categoryForZone, RCI_CATEGORIES } from '../rci';
import type { RciCategory } from '../rci';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Růst zástavby (§9 zadání fáze 2).
 *
 * ```
 * skóre  = (cenaPůdy + 1) ^ EXPONENT × faktorSilnice
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

  // Pevné pořadí kategorií, ne pořadí nějaké mapy — jinak by determinismus
  // závisel na historii vkládání (P2).
  for (const category of RCI_CATEGORIES) {
    const attempts = attemptsFor(world, balance, category);
    if (attempts === 0) continue;

    const candidates = collectCandidates(world, balance, category, reach);
    let total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);

    for (let attempt = 0; attempt < attempts && total > 0; attempt++) {
      const picked = pick(candidates, world.rng.next() * total);
      if (!picked) break;

      // Parcela padá z losu bez ohledu na výsledek: buď se zastavěla, nebo se
      // ukázalo, že se na ni stavět nedá.
      total -= picked.weight;
      picked.weight = 0;

      tryBuild(world, catalogue, category, picked.tile);
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
function attemptsFor(world: WorldState, balance: Balance, category: RciCategory): number {
  const demand = world.demand[category];
  if (demand <= 0) return 0;

  const { demandPerAttempt, maxAttempts, neutralTaxRate, taxRange } = balance.growth;
  const rate = world.economy.taxRates[category];
  const taxFactor = Math.max(0.2, Math.min(1.5, 1 - (rate - neutralTaxRate) / taxRange));

  const attempts = Math.round((demand / demandPerAttempt) * taxFactor);
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
): Candidate[] {
  const { zone, buildingId, road } = world.layers;
  const candidates: Candidate[] = [];

  for (let tile = 0; tile < zone.length; tile++) {
    if (buildingId[tile] !== 0 || road[tile] !== 0) continue;
    if (categoryForZone(zone[tile] ?? ZONE.none) !== category) continue;

    const distance = reach[tile] ?? 255;
    const roadFactor = balance.growth.roadFactors[distance] ?? 0;
    if (roadFactor === 0) continue; // mimo dosah silnice se nestaví vůbec

    const x = tile % MAP_SIZE;
    const landValue = world.coarse.landValue[coarseIndex(x, (tile - x) / MAP_SIZE)] ?? 0;
    const weight = Math.pow(landValue + 1, balance.growth.exponent) * roadFactor;
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
function roadReach(world: WorldState, maxDistance: number): Uint8Array {
  const { road } = world.layers;
  const distance = new Uint8Array(road.length).fill(255);
  let frontier: number[] = [];

  for (let tile = 0; tile < road.length; tile++) {
    if (road[tile] === 1) {
      distance[tile] = 0;
      frontier.push(tile);
    }
  }

  for (let step = 1; step <= maxDistance && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const tile of frontier) {
      const x = tile % MAP_SIZE;
      const y = (tile - x) / MAP_SIZE;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
        const at = index(nx, ny);
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
  // Důvod odmítnutí tady nikoho nezajímá: systém zkusí jiné místo příště.
  if (!checkFootprint(world, definition, x, y, { requireZone: zone, skipRoadCheck: true }).ok) {
    return;
  }

  placeBuilding(world, definition, x, y);
}
