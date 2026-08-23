import type { Balance } from '@/content/balance';
import { COARSE_FACTOR, coarseInBounds, coarseSizeOf } from '../coarse';
import { strongestModifier } from '../disasters/effects';
import { landValueContext, landValueRaw } from '../diagnostics';
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
      // Vodu i podíly terénu spočítáme jednou za běh, ne pro každou buňku.
      const context = landValueContext(world, balance);
      const { landValue } = world.coarse;
      const { smoothing } = balance.landValue;

      for (let cell = 0; cell < landValue.length; cell++) {
        // Vzorec je jeden a sdílí ho diagnostika parcely (§12) — jinak by hráči
        // ukazovala rozpis, podle kterého se ve skutečnosti nehraje. `null`
        // znamená „sčítance nesbírej"; panel si o ně řekne, systém ne.
        const raw =
          landValueRaw(world, balance, cell, context, null) -
          strongestModifier(world, 'landValuePenalty', cell, 0, undefined, Math.max);
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
export function waterProximity(world: WorldState): Uint8Array {
  // Terén se skoro nemění, výsledek proto přežije mezi běhy. Bez keše to byl
  // průchod 262 144 dlaždicemi každých šestnáct tiků — 5 ms na velké mapě jen
  // za to, aby se zjistilo, že řeka teče tam co minule (R20 fáze 4).
  //
  // Keš sedí **na světě**, ne v modulu: dva světy vedle sebe (a testy jich
  // dělají spoustu) by si ji jinak přepsaly. Zahazuje ji `markTerrainChanged`.
  const cached = world.waterNear;
  if (cached) return cached;

  const size = world.size;
  const coarse = coarseSizeOf(size);
  const hasWater = new Uint8Array(coarse * coarse);

  for (let cellY = 0; cellY < coarse; cellY++) {
    for (let cellX = 0; cellX < coarse; cellX++) {
      let found = false;
      for (let dy = 0; dy < COARSE_FACTOR && !found; dy++) {
        for (let dx = 0; dx < COARSE_FACTOR; dx++) {
          const tileX = cellX * COARSE_FACTOR + dx;
          const tileY = cellY * COARSE_FACTOR + dy;
          // U mapy, jejíž hrana není násobkem čtyř, kraj poslední buňky přesahuje.
          if (tileX >= size || tileY >= size) continue;
          if (
            world.layers.terrain[index(tileX, tileY, size)] === TERRAIN.water
          ) {
            found = true;
            break;
          }
        }
      }
      if (found) hasWater[cellY * coarse + cellX] = 1;
    }
  }

  const nearWater = new Uint8Array(coarse * coarse);
  for (let cellY = 0; cellY < coarse; cellY++) {
    for (let cellX = 0; cellX < coarse; cellX++) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!coarseInBounds(cellX + dx, cellY + dy, coarse)) continue;
          if (hasWater[(cellY + dy) * coarse + (cellX + dx)] === 1) {
            near = true;
            break;
          }
        }
      }
      if (near) nearWater[cellY * coarse + cellX] = 1;
    }
  }

  world.waterNear = nearWater;
  return nearWater;
}
