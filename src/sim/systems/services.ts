import type { Balance } from '@/content/balance';
import type { BuildingCatalogue } from '../catalogue';
import { COARSE_FACTOR, coarseCellsOf, coarseIndex, coarseSizeOf } from '../coarse';
import { strongestModifier } from '../disasters/effects';
import { fundingEffect } from '../funding';
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
 * r    = radius * účinek(financování)
 * síla = strength * účinek(financování)
 * coverage[třída][c] += síla * (1 - d / r)     pro d ≤ r
 * ```
 *
 * Účinek se od financování liší jen nad stem procent, kde roste poloviční
 * rychlostí (`sim/funding.ts`). Pod stem je to totéž číslo.
 *
 * Běží každý tik, ale počítá jen při `coverageDirty` — po vzoru elektřiny.
 * Bez toho by se 1024 buněk krát počet stanic přepočítávalo čtyřikrát za sekundu
 * pro nic.
 */
export function createServiceSystem(catalogue: BuildingCatalogue, balance: Balance): System {
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

          // **Temná služba nepokrývá** (katalog 12, následky blackoutu).
          //
          // Obecné pravidlo, ne zvláštnost blackoutu: hasičárna bez proudu
          // nevyjede, ať je tma z výpadku nebo z toho, že hráč nepostavil dost
          // elektráren. Bez toho by blackout nedělal vůbec nic — a je to
          // zároveň důvod, proč během něj skokově roste riziko požáru i války
          // gangů.
          //
          // Obtěžování se to netýká: skládka smrdí i po tmě, a proto se ptáme
          // jen u `funded`, tedy u služeb.
          if (funded && !building.powered) continue;

          const funding = funded ? fundingEffect(balance, serviceFunding(world, source.class)) : 1;
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

/**
 * Rozprostře pokrytí kolem budovy.
 *
 * `radius` je **v dlaždicích**, protože tak se čte zadání („hasičárna dosáhne
 * deset dlaždic daleko"). Pole je ale na hrubé mřížce, takže se dělí
 * `COARSE_FACTOR`.
 *
 * Do T91 se poloměr bral **jako počet buněk** a to byla čtyřnásobná chyba:
 * hasičárna s hodnotou 10 dosáhla čtyřicet dlaždic, tedy přes půl mapy, a velká
 * s šestnácti pokryla celé město. Autor to nahlásil větou „mám jednu nebo dvě
 * hasičské stanice a dosah přes 3/4 mapy". Čísla v obsahu zůstala, změnila se
 * jednotka, ve které se čtou.
 */
function addCoverage(
  field: Float32Array,
  size: number,
  building: { x: number; y: number },
  footprint: readonly [number, number],
  radiusTiles: number,
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

  const radius = radiusTiles / COARSE_FACTOR;
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
 * Přepíše mapu pokrytí. Třídy, které ve městě zmizely, se **smažou** — kdyby
 * se jen přeskočily, po zbourání poslední stanice by pokrytí zůstalo viset.
 *
 * Smazat, ne vynulovat (audit T132): vynulovaná třída zůstávala v mapě jako
 * vrstva samých nul, kdežto po načtení savu, kde se pokrytí počítá znovu,
 * v mapě nebyla vůbec. Chátrání průměruje přes třídy v mapě
 * (`levels.ts`, `neglectPenalty`), takže stejné město chátralo jinak podle
 * toho, jestli se mezitím uložilo a načetlo.
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

  for (const serviceClass of [...world.coverage.keys()]) {
    if (!accumulated.has(serviceClass)) world.coverage.delete(serviceClass);
  }
}
