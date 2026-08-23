import type { BuildingCatalogue } from '../catalogue';
import { coarseCellsOf, coarseIndex, coarseSizeOf } from '../coarse';
import { strongestModifier } from '../disasters/effects';
import { serviceFunding } from '../world';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Pokrytí službami (§6 zadání fáze 2).
 *
 * Mechanismus je obecný — třída, dosah a síla jsou obsah, kód nezná ani jednu
 * konkrétní službu (P5). Příspěvky se sčítají a ořezávají na 255, takže dvě
 * stanice vedle sebe jsou lepší než jedna, ale se snižujícím se přínosem.
 *
 * ```
 * r    = radius * financování
 * síla = strength * financování
 * coverage[třída][c] += síla * (1 - d / r)     pro d ≤ r
 * ```
 *
 * Běží každý tik, ale počítá jen při `coverageDirty` — po vzoru elektřiny.
 * Bez toho by se 1024 buněk krát počet stanic přepočítávalo čtyřikrát za sekundu
 * pro nic.
 */
export function createServiceSystem(catalogue: BuildingCatalogue): System {
  return {
    name: 'services',
    interval: 1,
    offset: 0,
    run(world: WorldState) {
      if (!world.coverageDirty) return;
      world.coverageDirty = false;

      const accumulated = new Map<string, Float32Array>();

      // Pořadí budov je vzestupně podle id — deterministické (P2).
      for (const id of [...world.buildings.keys()].sort((a, b) => a - b)) {
        const building = world.buildings.get(id);
        const definition = building && catalogue.get(building.definitionId);
        if (!building || !definition) continue;

        // Služba i obtěžování jsou tentýž mechanismus; liší se jen tím, že na
        // obtěžování se financování nevztahuje — škrty na policii sousedům
        // věznice z okolí neodstraní.
        for (const [source, funded] of [
          [definition.service, true],
          [definition.nuisance, false],
        ] as const) {
          if (!source) continue;

          const funding = funded ? serviceFunding(world, source.class) : 1;
          const radius = source.radius * funding;
          const strength = source.strength * funding;
          if (radius <= 0 || strength <= 0) continue;

          let field = accumulated.get(source.class);
          if (!field) {
            field = new Float32Array(coarseCellsOf(world.size));
            accumulated.set(source.class, field);
          }

          addCoverage(
            field,
            world.size,
            building,
            definition.footprint,
            radius,
            strength,
          );
        }
      }

      writeCoverage(world, accumulated);
      // Cena půdy i kriminalita z pokrytí čtou, takže se mění i pohled na mapu.
      world.dirty.coarseChanged = true;
    },
  };
}

function addCoverage(
  field: Float32Array,
  size: number,
  building: { x: number; y: number },
  footprint: readonly [number, number],
  radius: number,
  strength: number,
): void {
  const coarseSize = coarseSizeOf(size);
  const [width, depth] = footprint;
  const centerTileX = Math.min(building.x + (width - 1) / 2, size - 1);
  const centerTileY = Math.min(building.y + (depth - 1) / 2, size - 1);
  const origin = coarseIndex(
    Math.floor(centerTileX),
    Math.floor(centerTileY),
    size,
  );
  const originX = origin % coarseSize;
  const originY = (origin - originX) / coarseSize;

  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const cellX = originX + dx;
      const cellY = originY + dy;
      if (cellX < 0 || cellY < 0 || cellX >= coarseSize || cellY >= coarseSize)
        continue;

      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;

      const at = cellY * coarseSize + cellX;
      field[at] = (field[at] ?? 0) + strength * (1 - distance / radius);
    }
  }
}

/**
 * Přepíše mapu pokrytí. Třídy, které ve městě zmizely, se vynulují — kdyby se
 * jen přeskočily, po zbourání poslední stanice by pokrytí zůstalo viset.
 */
function writeCoverage(world: WorldState, accumulated: Map<string, Float32Array>): void {
  for (const [serviceClass, field] of accumulated) {
    let target = world.coverage.get(serviceClass);
    if (!target) {
      target = new Uint8Array(coarseCellsOf(world.size));
      world.coverage.set(serviceClass, target);
    }
    for (let cell = 0; cell < target.length; cell++) {
      // Potlačení z katastrof se uplatní **až tady**, po přepočtu. Kdyby ho
      // zapsala katastrofa rovnou do vrstvy, první běh tohohle systému by ho
      // přepsal a hráč by si stávky ani nevšiml.
      const factor = strongestModifier(world, 'suppressService', cell, 1, serviceClass);
      target[cell] = Math.max(0, Math.min(255, Math.round((field[cell] ?? 0) * factor)));
    }
  }

  for (const [serviceClass, target] of world.coverage) {
    if (!accumulated.has(serviceClass)) target.fill(0);
  }
}
