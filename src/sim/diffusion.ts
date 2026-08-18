import { COARSE_SIZE } from './coarse';

/**
 * Difuze na hrubé mřížce (§3 zadání fáze 2).
 *
 * Jeden průchod pro každou buňku:
 * ```
 * sousedé = součet 8 sousedů z předchozího průchodu
 * nová    = zdroj + předchozí * (1 - spread) + sousedé * spread / 8
 * nová   *= decay
 * ```
 *
 * **Okraj mapy pohlcuje** — buňka mimo mřížku se počítá jako nula, takže se
 * u kraje nic nehromadí.
 *
 * Konvergence: bez zdroje hodnota exponenciálně klesá, protože `decay < 1`.
 * Se stálým zdrojem se ustálí zhruba na `zdroj / (1 - decay)`; podle toho se
 * volí hodnoty `pollution` v definicích, aby se vešly pod 255.
 */
export function diffuse(
  current: Uint8Array,
  sources: Float32Array,
  spread: number,
  decay: number,
  passes: number,
): void {
  const size = COARSE_SIZE;
  let previous = Float32Array.from(current);
  let next = new Float32Array(current.length);

  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const at = y * size + x;

        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue; // okraj pohlcuje
            neighbours += previous[ny * size + nx] ?? 0;
          }
        }

        const value =
          (sources[at] ?? 0) + (previous[at] ?? 0) * (1 - spread) + (neighbours * spread) / 8;
        next[at] = value * decay;
      }
    }

    const swap = previous;
    previous = next;
    next = swap;
  }

  for (let i = 0; i < current.length; i++) {
    // Ořezává se dolů, ne zaokrouhluje. Se zaokrouhlováním je hodnota 1 pevným
    // bodem — `round(1 * 0.94)` je zase 1 — a mapa by navždy zůstala pokrytá
    // slabým fantomovým znečištěním, které nemá zdroj.
    current[i] = Math.max(0, Math.min(255, Math.floor(previous[i] ?? 0)));
  }
}
