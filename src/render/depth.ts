/**
 * Pořadí kreslení budov v izometrii (back-to-front).
 *
 * **Jedno číslo na budovu nestačí.** Dokud měly všechny stejný půdorys, dalo
 * se řadit podle `x + y`; s obdélníky různých velikostí to přestane platit
 * a nejde to zachránit ani jiným skalárem — protipříklady si odporují:
 *
 * - továrna 2 × 2 na (10, 10) proti obchodu na (11, 9): obchod je **za** ní,
 *   takže se musí kreslit dřív, a má **větší** x,
 * - dům na (10, 11) proti domu na (11, 10): první je za druhým, a má **menší** x.
 *
 * Jedno pravidlo pro obojí neexistuje, takže se porovnává **po dvojicích**.
 *
 * Pro dva půdorysy, které se nepřekrývají, platí jednoduchá věc: A je za B,
 * když A celé končí dřív, než B začíná — v ose x nebo v ose y. Přesně to dělá
 * `isBehind`. Zbývá případ, kdy ani jedno neplatí: to jsou budovy vedle sebe
 * v téže hloubce, a tam rozhoduje **výška základny sestupně** — ta na kopci
 * je od pozorovatele dál (§7 fáze 3).
 */
export interface DepthBox {
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Výška, na které budova stojí. Vyšší je dál od pozorovatele. */
  base: number;
}

/** Je `a` za `b`, tedy má se kreslit dřív? */
export function isBehind(a: DepthBox, b: DepthBox): boolean {
  return a.x + a.width <= b.x || a.y + a.depth <= b.y;
}

/**
 * Porovnání pro řazení. Záporné znamená „a se kreslí dřív".
 *
 * Není to úplné uspořádání — u tří budov do sebe zaklesnutých v kruhu by se
 * dalo sestavit zacyklení. U nepřekrývajících se obdélníků na mřížce je to
 * ale případ, který nenastane, a cena skutečného topologického třídění
 * (kvadratické v počtu budov, při každém růstu) se za to nevyplatí.
 */
export function compareDepth(a: DepthBox, b: DepthBox): number {
  if (isBehind(a, b)) return -1;
  if (isBehind(b, a)) return 1;
  // Vedle sebe v téže hloubce: níž položená je blíž pozorovateli.
  if (a.base !== b.base) return b.base - a.base;
  // Poslední záchrana, aby bylo pořadí stabilní i mezi dvěma stejnými.
  return a.x + a.y - (b.x + b.y);
}
