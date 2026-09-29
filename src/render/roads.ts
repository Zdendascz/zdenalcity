/**
 * Auto-tiling silnic.
 *
 * Bitmaska sousedů se **počítá v `sim/`** a renderer si ji odsud jen bere:
 * od chvíle, kdy si silnice srovnává příčný spád, ji potřebuje i simulace,
 * a dvě kopie by se mohly rozejít.
 *
 * N je `(x, y-1)`, tedy směr „nahoru vpravo" po projekci do izometrie.
 */
import { ROAD_E, ROAD_N, ROAD_S, ROAD_W } from '@/sim/roads';

export { ROAD_N, ROAD_E, ROAD_S, ROAD_W, roadMask } from '@/sim/roads';
export type { IsRoad } from '@/sim/roads';

/**
 * Jak velká část dlaždice připadá na vozovku napříč směrem jízdy.
 *
 * Zároveň je to **šířka vozovky**: širší pruh dá širší silnici, takže se tím
 * odlišují typy z §4 fáze 3, aniž by k tomu byla potřeba druhá geometrie.
 */
const CORE_SCALE = 0.5;

/**
 * Diamant dlaždice jako čtyři vrcholy v pořadí sever, východ, jih, západ —
 * přesně to, co vrací `tileQuad`.
 */
export type TileQuad = readonly number[];

/**
 * Bod uvnitř dlaždice v jejích vlastních souřadnicích.
 *
 * `u` běží po mřížce od rohu `(x, y)` k `(x+1, y)`, `v` od `(x, y)` k `(x, y+1)`.
 * Počítá se bilineárně ze čtyř rohů, takže vozovka jde **po ploše dlaždice**:
 * na svahu se zvedne s ní a od terénu se neodlepí.
 */
export function inside(quad: TileQuad, u: number, v: number): [number, number] {
  const nw: [number, number] = [quad[0] ?? 0, quad[1] ?? 0];
  const ne: [number, number] = [quad[2] ?? 0, quad[3] ?? 0];
  const se: [number, number] = [quad[4] ?? 0, quad[5] ?? 0];
  const sw: [number, number] = [quad[6] ?? 0, quad[7] ?? 0];

  const top = (1 - u) * nw[0] + u * ne[0];
  const bottom = (1 - u) * sw[0] + u * se[0];
  const topY = (1 - u) * nw[1] + u * ne[1];
  const bottomY = (1 - u) * sw[1] + u * se[1];
  return [(1 - v) * top + v * bottom, (1 - v) * topY + v * bottomY];
}

/**
 * Vozovka jedné dlaždice jako seznam polygonů: středový kus plus jedno rameno
 * na každou stranu, kam silnice pokračuje. Tím vznikne všech 16 variant
 * (slepý konec, rovinka, zatáčka, T, křižovatka) bez jediné hardcoded tabulky.
 *
 * **Rameno je pruh šířky vozovky, ne celá hrana.** Tohle tu bylo dlouho
 * špatně: rameno se kreslilo jako čtyřúhelník mezi zmenšeným jádrem a **plnou
 * hranou diamantu**, takže silnice zabírala celou dlaždici až na čtyři rohové
 * trojúhelníky a `width` řídil jen délku ramen. Na mapě z toho byly široké
 * šedé plochy, obrubník se schoval pod vozovku a autor se ptal, kam se
 * silnice poděly. Sousedé přitom navazují dál: pruh končí přesně na hraně
 * a soused začíná svým pruhem téže šířky ve stejném místě.
 *
 * Bere **skutečné vrcholy dlaždice**, ne počátek pravidelného diamantu. Na
 * svahu se totiž každý roh zvedne jinak a silnice počítaná z pravidelného tvaru
 * by se od terénu odlepila (§7 fáze 3).
 */
export function roadPolygons(
  quad: TileQuad,
  mask: number,
  width: number = CORE_SCALE,
  /**
   * Šířka každého ramene **na hraně dlaždice** v pořadí sever, východ, jih,
   * západ (T124). Když silnice navazuje na širší typ, rameno se k ní plynule
   * rozšíří — do teď se šířka na hranici dlaždic změnila skokem a obruba
   * udělala schod. Bez parametru má rameno po celé délce šířku vozovky.
   */
  edges?: readonly number[],
): number[][] {
  const clamp = (value: number): number => Math.max(0.02, Math.min(0.98, value)) / 2;
  const half = clamp(width);
  const lo = 0.5 - half;
  const hi = 0.5 + half;
  const edge = (side: number): [number, number] => {
    const h = clamp(edges?.[side] ?? width);
    return [0.5 - h, 0.5 + h];
  };

  const at = (u: number, v: number): [number, number] => inside(quad, u, v);
  const polygon = (
    corners: readonly (readonly [number, number])[],
  ): number[] => corners.flatMap(([u, v]) => at(u, v));

  const polygons: number[][] = [
    // Střed: čtverec šířky vozovky kolem středu dlaždice.
    polygon([
      [lo, lo],
      [hi, lo],
      [hi, hi],
      [lo, hi],
    ]),
  ];

  // Rameno vede od středového čtverce na hranu, kterou se jde k sousedovi.
  // Sever je `y - 1`, tedy `v = 0`; východ `x + 1`, tedy `u = 1`.
  if (mask & ROAD_N) {
    const [a, b] = edge(0);
    polygons.push(
      polygon([
        [a, 0],
        [b, 0],
        [hi, lo],
        [lo, lo],
      ]),
    );
  }
  if (mask & ROAD_E) {
    const [a, b] = edge(1);
    polygons.push(
      polygon([
        [hi, lo],
        [1, a],
        [1, b],
        [hi, hi],
      ]),
    );
  }
  if (mask & ROAD_S) {
    const [a, b] = edge(2);
    polygons.push(
      polygon([
        [lo, hi],
        [hi, hi],
        [b, 1],
        [a, 1],
      ]),
    );
  }
  if (mask & ROAD_W) {
    const [a, b] = edge(3);
    polygons.push(
      polygon([
        [0, a],
        [lo, lo],
        [lo, hi],
        [0, b],
      ]),
    );
  }

  return polygons;
}
