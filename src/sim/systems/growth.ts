import { footprintFits, placeBuilding } from '../buildings';
import type { BuildingCatalogue } from '../catalogue';
import { ZONE } from '../layers';
import type { WorldState } from '../world';
import type { System } from './index';

/** Kolik pokusů o stavbu proběhne za jeden běh systému. */
const ATTEMPTS_PER_RUN = 4;
/** Šance, že se pokus promění ve stavbu. Město tak neroste skokem. */
const GROWTH_CHANCE = 0.4;

/**
 * Zóna je vazba mezi mřížkou a kategorií obsahu. Konkrétní budovy v kódu
 * nejsou (P5) — kód zná jen kategorii, seznam budov dodá registr.
 */
function categoryForZone(zone: number): string | null {
  if (zone === ZONE.residential) return 'residential';
  if (zone === ZONE.commercial) return 'commercial';
  if (zone === ZONE.industrial) return 'industrial';
  return null;
}

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

  const options = catalogue.byCategory(category);
  if (options.length === 0) return;

  const definition = options[world.rng.int(options.length)];
  if (!definition) return;

  // Celý footprint musí ležet ve stejné zóně — dům nepřeteče do sousední čtvrti.
  if (!footprintFits(world, definition, x, y, { requireZone: zone })) return;

  placeBuilding(world, definition, x, y);
}
