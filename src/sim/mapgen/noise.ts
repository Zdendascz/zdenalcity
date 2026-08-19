import type { Rng } from '../rng';

/**
 * Hodnotový šum a fBm pro generátor mapy (§2 zadání fáze 3).
 *
 * Vlastní implementace místo knihovny: je to třicet řádků, projekt drží počet
 * závislostí na minimu a hlavně musí být determinismus **náš** — mřížka se
 * plní z `Rng`, takže stejný seed dá vždycky stejnou mapu (P2).
 *
 * Hodnotový šum, ne Perlin: pro rozmístění terénu je rozdíl neznatelný a
 * interpolace mřížky náhodných čísel je o řád snazší na pochopení.
 */

/** Mřížka náhodných hodnot 0–1, ze které se interpoluje. */
export interface NoiseField {
  readonly size: number;
  readonly values: Float32Array;
}

export function createNoiseField(rng: Rng, size: number): NoiseField {
  const values = new Float32Array(size * size);
  for (let i = 0; i < values.length; i++) values[i] = rng.next();
  return { size, values };
}

/** Hladký přechod 3t² − 2t³ — bez něj jsou na hranách buněk vidět kosočtverce. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function at(field: NoiseField, x: number, y: number): number {
  // Mřížka se opakuje, takže se šum nikdy nezeptá mimo pole.
  const wrappedX = ((x % field.size) + field.size) % field.size;
  const wrappedY = ((y % field.size) + field.size) % field.size;
  return field.values[wrappedY * field.size + wrappedX] ?? 0;
}

/** Bilineárně interpolovaná hodnota v libovolném bodě mřížky. */
export function sampleNoise(field: NoiseField, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);

  const top = at(field, x0, y0) * (1 - tx) + at(field, x0 + 1, y0) * tx;
  const bottom = at(field, x0, y0 + 1) * (1 - tx) + at(field, x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Fraktální šum: součet oktáv o rostoucí frekvenci a klesající amplitudě.
 *
 * `roughness` je poměr amplitud sousedních oktáv. Nízká hodnota dá hladké
 * pahorky, vysoká rozdrobené pobřeží. Výsledek je normalizovaný na 0–1, aby
 * prahy v balancu znamenaly totéž bez ohledu na počet oktáv.
 */
export function fbm(
  field: NoiseField,
  x: number,
  y: number,
  octaves: number,
  roughness: number,
  scale: number,
): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1 / scale;
  let maximum = 0;

  for (let octave = 0; octave < octaves; octave++) {
    total += sampleNoise(field, x * frequency, y * frequency) * amplitude;
    maximum += amplitude;
    amplitude *= roughness;
    frequency *= 2;
  }

  return maximum === 0 ? 0 : total / maximum;
}
