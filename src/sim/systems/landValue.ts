import type { Balance } from '@/content/balance';
import { COARSE_FACTOR, COARSE_SIZE, coarseInBounds } from '../coarse';
import { index, TERRAIN } from '../layers';
import type { WorldState } from '../world';
import type { System } from './index';

/**
 * Cena půdy (§4 zadání fáze 2). Běží každých 16 tiků, offset 5.
 *
 * ```
 * surová = ZÁKLAD + bonusVody − znečištění × VÁHA
 * cena   = lerp(cena, surová, VYHLAZENÍ)
 * ```
 *
 * Váhy tříd služeb pokrývají celou sadu ze zadání; službu, která ve městě
 * není, prostě není z čeho počítat.
 *
 * **Zástavba do vzorce nevstupuje** (rozhodnutí R2 v zadání). Kdyby vstupovala,
 * vznikla by utržená smyčka: vyšší úroveň → hustší zástavba → vyšší cena půdy
 * → vyšší úroveň.
 *
 * Vyhlazení existuje proto, aby cena půdy nereagovala skokem — jinak by hráč
 * postavil park a celá čtvrť by okamžitě přeskočila o dvě úrovně.
 *
 * Všechny konstanty i váhy jdou z `balance.json` (§10). Váhy tříd služeb jsou
 * otevřený seznam, protože třídy jsou obsah — mod si přidá vlastní.
 */
export function createLandValueSystem(balance: Balance): System {
  return {
    name: 'landValue',
    interval: 16,
    offset: 5,
    run(world: WorldState) {
      const water = waterProximity(world);
      const { landValue, pollution, crime } = world.coarse;

      const { base, smoothing, waterBonus, weights } = balance.landValue;

      // Jen třídy, které ve městě opravdu jsou a mají v balancu váhu.
      const services: [Uint8Array, number][] = [];
      for (const [serviceClass, coverage] of world.coverage) {
        const weight = weights[serviceClass];
        if (weight !== undefined) services.push([coverage, weight]);
      }

      for (let cell = 0; cell < landValue.length; cell++) {
        let services_ = 0;
        for (const [coverage, weight] of services) {
          services_ += (coverage[cell] ?? 0) * weight;
        }

        const raw =
          base +
          services_ +
          (water[cell] === 1 ? waterBonus : 0) -
          (pollution[cell] ?? 0) * (weights['pollution'] ?? 0) -
          (crime[cell] ?? 0) * (weights['crime'] ?? 0);

        const current = landValue[cell] ?? 0;
        const delta = raw - current;
        const next = current + delta * smoothing;

        // Zaokrouhluje se **ve směru pohybu**. Se symetrickým zaokrouhlením by
        // se hodnota zasekla krok před cílem: rozdíl menší než dvě jednotky
        // by se po vyhlazení zaokrouhlil zpátky na výchozí hodnotu.
        const stepped = delta > 0 ? Math.ceil(next) : Math.floor(next);
        landValue[cell] = Math.max(0, Math.min(255, stepped));
      }

      world.dirty.coarseChanged = true;
    },
  };
}

/**
 * Buňky, které obsahují vodu nebo s takovou sousedí.
 *
 * Počítá se při každém běhu z terénu, ne jednou při vzniku mapy: je to 1024
 * buněk jednou za 16 tiků a odpadá tím stav, který by se mohl rozejít s mapou.
 *
 * Je to jediný vstup ceny půdy, který nezávisí na hráči — mapa díky němu není
 * homogenní ještě než se cokoli postaví.
 */
function waterProximity(world: WorldState): Uint8Array {
  const size = COARSE_SIZE;
  const hasWater = new Uint8Array(size * size);

  for (let cellY = 0; cellY < size; cellY++) {
    for (let cellX = 0; cellX < size; cellX++) {
      let found = false;
      for (let dy = 0; dy < COARSE_FACTOR && !found; dy++) {
        for (let dx = 0; dx < COARSE_FACTOR; dx++) {
          const tile = index(cellX * COARSE_FACTOR + dx, cellY * COARSE_FACTOR + dy);
          if (world.layers.terrain[tile] === TERRAIN.water) {
            found = true;
            break;
          }
        }
      }
      if (found) hasWater[cellY * size + cellX] = 1;
    }
  }

  const nearWater = new Uint8Array(size * size);
  for (let cellY = 0; cellY < size; cellY++) {
    for (let cellX = 0; cellX < size; cellX++) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!coarseInBounds(cellX + dx, cellY + dy)) continue;
          if (hasWater[(cellY + dy) * size + (cellX + dx)] === 1) {
            near = true;
            break;
          }
        }
      }
      if (near) nearWater[cellY * size + cellX] = 1;
    }
  }

  return nearWater;
}
