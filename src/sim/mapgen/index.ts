import type { Balance } from '@/content/balance';
import { index, inBounds, MAP_SIZE, TERRAIN } from '../layers';
import type { Layers } from '../layers';
import { Rng } from '../rng';
import { createNoiseField, fbm } from './noise';

/**
 * Generátor mapy (§2 zadání fáze 3).
 *
 * Žije pod P1: žádný renderer, žádný DOM, veškerá náhoda z `Rng` (P2). Stejný
 * seed proto dá vždycky identickou mapu — hlídá to golden test.
 *
 * Postup:
 * 1. výškové pole z fBm
 * 2. voda pod hladinou a **garance souvislé souše** (R7)
 * 3. písek kolem vody
 * 4. skála nad prahem
 * 5. les z druhé šumové vrstvy, jen na trávě
 * 6. mokřad v nížinách u vody
 *
 * Výškové pole se ve fázi 3a jen použije k rozmístění terénu a zahodí; ve 3b
 * se z něj stane `cornerHeight`.
 */

/** Měřítko šumu v dlaždicích. Menší číslo = drobnější členitost. */
const HEIGHT_SCALE = 28;
const FOREST_SCALE = 14;
/** Velikost mřížky náhodných hodnot, ze které se interpoluje. */
const FIELD_SIZE = 64;

export interface GeneratedMap {
  terrain: Uint8Array;
  /** Výškové pole 0–1. Ve 3a slouží jen ke generování, do světa se neukládá. */
  height: Float32Array;
}

export function generateTerrain(seed: number, balance: Balance): GeneratedMap {
  const rng = new Rng(seed);
  const { seaLevel, rockLevel, beachWidth, forestDensity, marshThreshold, octaves, roughness } =
    balance.map;

  const heightField = createNoiseField(rng, FIELD_SIZE);
  const forestField = createNoiseField(rng, FIELD_SIZE);

  const cells = MAP_SIZE * MAP_SIZE;
  const height = new Float32Array(cells);
  const terrain = new Uint8Array(cells);

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      height[index(x, y)] = fbm(heightField, x, y, octaves, roughness, HEIGHT_SCALE);
    }
  }

  // Prahy se berou jako **kvantily**, ne jako pevné hodnoty výšky. Normalizovaný
  // fBm má u každého seedu jiné rozpětí, takže pevná hladina dá jednou pevninu
  // bez moře a podruhé mapu z 87 % pod vodou — obojí se stalo při ladění.
  // Takhle `seaLevel = 0,3` vždycky znamená „třetina mapy je voda".
  const levels = quantiles(height, [seaLevel, rockLevel]);
  const seaHeight = levels[0] ?? 0;
  const rockHeight = levels[1] ?? 1;

  for (let tile = 0; tile < cells; tile++) {
    terrain[tile] = (height[tile] ?? 0) < seaHeight ? TERRAIN.water : TERRAIN.grass;
  }

  // Souš musí být souvislá, jinak by byla půlka mapy nedostupná (R7).
  connectLand(terrain, height, seaHeight);

  paintBeaches(terrain, beachWidth);

  for (let tile = 0; tile < cells; tile++) {
    if (terrain[tile] === TERRAIN.grass && (height[tile] ?? 0) > rockHeight) {
      terrain[tile] = TERRAIN.rock;
    }
  }

  paintMarshes(terrain, height, seaHeight, marshThreshold);

  // Les taky kvantilem, ne pevným prahem: `forestDensity = 0,35` má znamenat
  // „třetina trávy zaroste", ne „zaroste to, co náhodou přeleze 0,65" — což
  // při normalizovaném fBm vycházelo na šest procent.
  const grassTiles: number[] = [];
  const forestNoise = new Float32Array(cells);
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const tile = index(x, y);
      if (terrain[tile] !== TERRAIN.grass) continue;
      forestNoise[tile] = fbm(forestField, x, y, octaves, roughness, FOREST_SCALE);
      grassTiles.push(tile);
    }
  }

  const forestValues = Float32Array.from(grassTiles, (tile) => forestNoise[tile] ?? 0);
  const forestHeight = quantiles(forestValues, [1 - forestDensity])[0] ?? 1;
  for (const tile of grassTiles) {
    if ((forestNoise[tile] ?? 0) >= forestHeight) terrain[tile] = TERRAIN.forest;
  }

  return { terrain, height };
}

/** Zapíše vygenerovaný terén do vrstev světa. */
export function applyGeneratedMap(layers: Layers, map: GeneratedMap): void {
  layers.terrain.set(map.terrain);
}

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

function isLand(terrain: Uint8Array, tile: number): boolean {
  return terrain[tile] !== TERRAIN.water;
}

/** Zvedne dlaždici těsně nad hladinu. Písek na ni doplní pozdější krok. */
function raiseTile(
  terrain: Uint8Array,
  height: Float32Array,
  tile: number,
  seaHeight: number,
): void {
  terrain[tile] = TERRAIN.grass;
  height[tile] = seaHeight + 0.001;
}

/**
 * Hodnoty, pod kterými leží zadané podíly pole. Kvantily, ne pevné prahy.
 *
 * Všechny naráz z jednoho setřídění — generátor běží při každém přegenerování
 * náhledu v dialogu nové hry, takže tam nemá co dělat druhý sort přes 16 384
 * čísel.
 */
function quantiles(values: Float32Array, shares: readonly number[]): number[] {
  const sorted = Float32Array.from(values).sort();
  return shares.map((share) => {
    const at = Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))));
    return sorted[at] ?? 0;
  });
}

/** Očísluje souvislé plochy souše. Vrací pole indexů komponent a jejich velikosti. */
function landComponents(terrain: Uint8Array): { componentOf: Int32Array; sizes: number[] } {
  const componentOf = new Int32Array(terrain.length).fill(-1);
  const sizes: number[] = [];

  for (let start = 0; start < terrain.length; start++) {
    if (!isLand(terrain, start) || componentOf[start] !== -1) continue;

    const id = sizes.length;
    let size = 0;
    const stack = [start];
    componentOf[start] = id;

    while (stack.length > 0) {
      const tile = stack.pop();
      if (tile === undefined) break;
      size++;

      const x = tile % MAP_SIZE;
      const y = (tile - x) / MAP_SIZE;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const next = index(nx, ny);
        if (!isLand(terrain, next) || componentOf[next] !== -1) continue;
        componentOf[next] = id;
        stack.push(next);
      }
    }

    sizes.push(size);
  }

  return { componentOf, sizes };
}

/**
 * Spojí všechnu souš do jedné plochy (R7).
 *
 * Ostrovy se **nezaplavují** — to by hráče připravilo o plochu a u členitých
 * seedů zbylo z mapy pár procent souše. Místo toho se zvedne nad hladinu
 * nejkratší pás vody mezi ostrovem a pevninou, tedy vznikne šíje.
 *
 * Jeden průchod do šířky vodou od hlavní pevniny obslouží **všechny** ostrovy
 * naráz: jakmile narazí na cizí souš, zvedne cestu, kterou se tam dostal.
 * Opakované značkování komponent pro každý ostroj zvlášť dělalo z generování
 * desítky milisekund navíc.
 */
function connectLand(terrain: Uint8Array, height: Float32Array, seaHeight: number): void {
  // Rozšiřování šíjí umí samo odříznout pár dlaždic do nového ostrůvku, takže
  // se průchod opakuje, dokud nezbude jediná souš. Druhé kolo obvykle stačí;
  // strop je pojistka, ne očekávaný počet.
  for (let pass = 0; pass < 8; pass++) {
    if (connectPass(terrain, height, seaHeight)) return;
  }
}

/** Vrací `true`, když je souš už souvislá a není co spojovat. */
function connectPass(terrain: Uint8Array, height: Float32Array, seaHeight: number): boolean {
  const { componentOf, sizes } = landComponents(terrain);

  if (sizes.length === 0) {
    // Celá mapa pod vodou — zvedneme ji, prázdná mapa je horší než bez moře.
    terrain.fill(TERRAIN.grass);
    return true;
  }
  if (sizes.length === 1) return true;

  let largest = 0;
  for (let id = 1; id < sizes.length; id++) {
    if ((sizes[id] ?? 0) > (sizes[largest] ?? 0)) largest = id;
  }

  const cameFrom = new Int32Array(terrain.length).fill(-1);
  const seen = new Uint8Array(terrain.length);
  const bridged = new Uint8Array(sizes.length);
  bridged[largest] = 1;

  let frontier: number[] = [];
  for (let tile = 0; tile < terrain.length; tile++) {
    if (componentOf[tile] === largest) {
      seen[tile] = 1;
      frontier.push(tile);
    }
  }

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const tile of frontier) {
      const x = tile % MAP_SIZE;
      const y = (tile - x) / MAP_SIZE;

      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const at = index(nx, ny);
        if (seen[at] === 1) continue;

        seen[at] = 1;
        cameFrom[at] = tile;

        const component = componentOf[at] ?? -1;
        if (component >= 0) {
          // Cizí souš: zvedneme vodu, kterou jsme se sem dostali. Ostrovy,
          // které už spojené jsou, jen procházíme dál.
          if (bridged[component] === 0) {
            bridged[component] = 1;
            // Cesta se sleduje **až na hlavní pevninu**, ne k první souši.
            // Zastavit se na dlaždici, kterou zvedlo předchozí rozšíření,
            // znamenalo nedokončený most a ostrůvek navíc.
            let step = cameFrom[at] ?? -1;
            while (step >= 0 && componentOf[step] !== largest) {
              if (isLand(terrain, step)) {
                step = cameFrom[step] ?? -1;
                continue;
              }
              raiseTile(terrain, height, step, seaHeight);
              // Šíje široká jednu dlaždici vypadá jako čára narýsovaná
              // pravítkem. Rozšířením o sousedy z ní je kosa.
              const sx = step % MAP_SIZE;
              const sy = (step - sx) / MAP_SIZE;
              for (const [ox, oy] of NEIGHBOURS) {
                if (!inBounds(sx + ox, sy + oy)) continue;
                const side = index(sx + ox, sy + oy);
                if (!isLand(terrain, side)) raiseTile(terrain, height, side, seaHeight);
              }
              step = cameFrom[step] ?? -1;
            }
          }
        }

        next.push(at);
      }
    }
    frontier = next;
  }

  return false;
}

function paintBeaches(terrain: Uint8Array, beachWidth: number): void {
  if (beachWidth <= 0) return;

  const distance = new Uint8Array(terrain.length).fill(255);
  let frontier: number[] = [];
  for (let tile = 0; tile < terrain.length; tile++) {
    if (terrain[tile] === TERRAIN.water) {
      distance[tile] = 0;
      frontier.push(tile);
    }
  }

  for (let step = 1; step <= beachWidth && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const tile of frontier) {
      const x = tile % MAP_SIZE;
      const y = (tile - x) / MAP_SIZE;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const at = index(nx, ny);
        if (distance[at] !== 255 || terrain[at] !== TERRAIN.grass) continue;
        distance[at] = step;
        terrain[at] = TERRAIN.sand;
        next.push(at);
      }
    }
    frontier = next;
  }
}

/**
 * Mokřady: nízko položená místa poblíž vody, která vodou nejsou.
 *
 * Kreslí se **až za pískem**, takže vznikají za pobřežním pásem, ne místo něj.
 */
function paintMarshes(
  terrain: Uint8Array,
  height: Float32Array,
  seaLevel: number,
  marshThreshold: number,
): void {
  const limit = seaLevel + marshThreshold;

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const tile = index(x, y);
      if (terrain[tile] !== TERRAIN.grass) continue;
      if ((height[tile] ?? 0) > limit) continue;

      let nearWater = false;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const at = index(nx, ny);
        if (terrain[at] === TERRAIN.water || terrain[at] === TERRAIN.sand) {
          nearWater = true;
          break;
        }
      }

      if (nearWater) terrain[tile] = TERRAIN.marsh;
    }
  }
}
