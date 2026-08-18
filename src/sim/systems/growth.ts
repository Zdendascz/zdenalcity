import { checkFootprint, placeBuilding } from '../buildings';
import type { BuildingCatalogue } from '../catalogue';
import { ZONE } from '../layers';
import { seedDefinitions } from '../levels';
import { categoryForZone } from '../rci';
import type { WorldState } from '../world';
import type { System } from './index';

/** Kolik pokusů o stavbu proběhne za jeden běh systému. */
const ATTEMPTS_PER_RUN = 4;
/** Šance, že se pokus promění ve stavbu. Město tak neroste skokem. */
const GROWTH_CHANCE = 0.4;

export function createGrowthSystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'growth',
    interval: 12,
    offset: 2,
    run(world: WorldState) {
      grow(world, catalogue);
    },
  };
}

function grow(world: WorldState, catalogue: BuildingCatalogue): void {
  // Bankrot: dokud je město v minusu, nic nového nevyroste. Jediný důsledek
  // záporného rozpočtu ve fázi 1 — hráč musí zvednout daně nebo něco zbourat.
  if (world.economy.funds < 0) return;

  const candidates = collectCandidates(world);
  if (candidates.length === 0) return;

  for (let attempt = 0; attempt < ATTEMPTS_PER_RUN; attempt++) {
    // Obě čísla se táhnou vždycky, i když se nakonec nestaví. Kdyby se
    // čerpání RNG lišilo podle výsledku, determinismus by závisel na tom,
    // kolik pokusů náhodou selhalo.
    const roll = world.rng.next();
    const candidate = candidates[world.rng.int(candidates.length)];
    if (roll >= GROWTH_CHANCE || candidate === undefined) continue;

    tryBuild(world, catalogue, candidate);
  }
}

/** Volné dlaždice se zónou, v pevném pořadí indexů. */
function collectCandidates(world: WorldState): number[] {
  const { zone, buildingId, road } = world.layers;
  const candidates: number[] = [];

  for (let tile = 0; tile < zone.length; tile++) {
    if (zone[tile] !== ZONE.none && buildingId[tile] === 0 && road[tile] === 0) {
      candidates.push(tile);
    }
  }

  return candidates;
}

function tryBuild(world: WorldState, catalogue: BuildingCatalogue, tile: number): void {
  const x = tile % world.size;
  const y = (tile - x) / world.size;

  const zone = world.layers.zone[tile] ?? ZONE.none;
  const category = categoryForZone(zone);
  if (!category) return;

  // Bez poptávky se nestaví. Tohle je ta vazba, kvůli které §13 funguje:
  // průmyslová zóna zůstane prázdná, dokud nejsou lidé, kteří chtějí práci.
  if (world.demand[category] <= 0) return;

  // Na prázdné parcele vyroste vždycky ta nejmenší budova první úrovně. Vyšší
  // úrovně a větší půdorysy se dají jen povýšením (§8), jinak by se na volném
  // poli objevil rovnou věžák.
  const options = seedDefinitions(catalogue, category);
  if (options.length === 0) return;

  const definition = options[world.rng.int(options.length)];
  if (!definition) return;

  // Celý footprint musí ležet ve stejné zóně — dům nepřeteče do sousední čtvrti.
  // Důvod odmítnutí tady nikoho nezajímá: systém zkusí jiné místo příště.
  if (!checkFootprint(world, definition, x, y, { requireZone: zone }).ok) return;

  placeBuilding(world, definition, x, y);
}
