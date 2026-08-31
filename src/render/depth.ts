/**
 * Pořadí kreslení budov v izometrii (back-to-front).
 *
 * **Jedno číslo na budovu nestačí.** Dokud měly všechny stejný půdorys, dalo
 * se řadit podle `x + y`; s obdélníky různých velikostí to přestane platit
 * a nejde to zachránit ani jiným skalárem. Naměřený protipříklad z autorova
 * města: sídliště 5 × 5 na (29, 12) končí v ose x přesně tam, kde začíná
 * domek na (34, 14) — sídliště je tedy **za** ním a musí se kreslit dřív.
 * Jenže jeho přední roh je hlouběji (34 + 17 proti 35 + 15), takže každý
 * skalár odvozený z předního rohu je prohodí.
 *
 * Proto se staví **graf a topologicky se seřadí**. Do T72 tu byl komparátor
 * pro `Array.sort` s poznámkou, že zacyklení nenastane. Nastávalo hned:
 * dva domky na úhlopříčce, třeba (10, 11) a (11, 10), jsou podle `isBehind`
 * **každý za tím druhým** — první v ose x, druhý v ose y. Komparátor pak
 * tvrdil `a < b` i `b < a` a `Array.sort` z toho udělal libovolné pořadí.
 * V autorově městě z toho bylo **754 špatně nakreslených dvojic z 2130**,
 * které se na obrazovce překrývají. Nahlásil to slovy „v kopci není místo,
 * kde by to bylo správně".
 */
export interface DepthBox {
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Výška, na které budova stojí. Vyšší je dál od pozorovatele. */
  base: number;
}

/**
 * Leží `a` celé za `b` v ose x, nebo v ose y?
 *
 * Samo o sobě to **není** uspořádání: u dvojice na úhlopříčce vyjde pravda
 * oběma směry. Rozhoduje až `mustDrawBefore`.
 */
export function isBehind(a: DepthBox, b: DepthBox): boolean {
  return a.x + a.width <= b.x || a.y + a.depth <= b.y;
}

/**
 * Musí se `a` nakreslit dřív než `b`?
 *
 * Jen když je `a` za `b` a **zároveň neplatí opak**. Dvojice na úhlopříčce
 * splňuje obojí, ale tam na pořadí nezáleží: dotýkají se rohem a jedna druhou
 * nemůže překrýt. Tvrdit u nich cokoli byla přesně ta chyba, která rozhodila
 * řazení celého města.
 */
export function mustDrawBefore(a: DepthBox, b: DepthBox): boolean {
  return isBehind(a, b) && !isBehind(b, a);
}

/**
 * Svislý pruh obrazovky, ve kterém budova leží.
 *
 * Vodorovná poloha v izometrii závisí jen na `x − y`, ne na výšce, takže se dá
 * spočítat bez znalosti toho, jak je která budova vysoká. Dvě budovy, jejichž
 * pruhy se míjejí, se nemůžou překrýt — a tím pádem na jejich pořadí nezáleží.
 */
function columnFrom(b: DepthBox): number {
  return b.x - (b.y + b.depth);
}

function columnTo(b: DepthBox): number {
  return b.x + b.width - b.y;
}

/** Výchozí pořadí, ze kterého se vychází, a rozhodčí při rovnosti. */
function seedRank(a: DepthBox, b: DepthBox): number {
  const depthA = a.x + a.width + a.y + a.depth;
  const depthB = b.x + b.width + b.y + b.depth;
  if (depthA !== depthB) return depthA - depthB;
  // Vedle sebe v téže hloubce: níž položená je blíž pozorovateli.
  return b.base - a.base;
}

/**
 * Id budov v pořadí, v jakém se mají kreslit — od nejvzdálenější.
 *
 * Kahnův algoritmus. Z připravených uzlů se vždycky bere ten nejnižší podle
 * `seedRank`, takže výsledek nezávisí na pořadí ve vstupní mapě a stejné město
 * se kreslí pokaždé stejně.
 *
 * Kdyby se graf přesto zacyklil, zbytek se dobere v pořadí `seedRank`. Radši
 * o kousek horší pořadí než zamrzlé kreslení — a i tak by to znamenalo, že
 * `mustDrawBefore` má chybu, protože pro nepřekrývající se obdélníky cyklus
 * vzniknout nemá.
 */
export function depthOrder(boxes: ReadonlyMap<number, DepthBox>): number[] {
  const nodes = [...boxes.entries()].sort((a, b) => seedRank(a[1], b[1]) || a[0] - b[0]);
  const count = nodes.length;
  if (count === 0) return [];

  const after: number[][] = Array.from({ length: count }, () => []);
  const waiting = new Uint32Array(count);

  // Hrany se **nehledají přes všechny dvojice**. Zametá se zleva doprava po
  // svislých pruzích obrazovky a porovnává se jen s tím, co je zrovna otevřené.
  // Bez toho to je kvadratické: naměřeno 33 ms na 2 500 budovách, a přerovnává
  // se při každé změně sady budov, takže by to na velké mapě trhalo.
  const sweep = [...nodes.keys()].sort(
    (p, q) => columnFrom(nodes[p]![1]) - columnFrom(nodes[q]![1]),
  );
  let active: number[] = [];

  for (const i of sweep) {
    const a = nodes[i]![1];
    const from = columnFrom(a);
    // Zavřít pruhy, které už skončily. Zbytek se s `a` může potkat.
    if (active.length > 0) active = active.filter((k) => columnTo(nodes[k]![1]) > from);

    for (const j of active) {
      const b = nodes[j]![1];
      if (mustDrawBefore(a, b)) {
        after[i]!.push(j);
        waiting[j]! += 1;
      } else if (mustDrawBefore(b, a)) {
        after[j]!.push(i);
        waiting[i]! += 1;
      }
    }
    active.push(i);
  }

  const order: number[] = [];
  const done = new Uint8Array(count);
  let scan = 0;

  while (order.length < count) {
    // Nejnižší připravený uzel. Hledá se lineárně od poslední pozice —
    // hotové uzly se cestou přeskočí, takže se seznam projde jednou.
    let pick = -1;
    for (let i = scan; i < count; i++) {
      if (done[i] === 0 && waiting[i] === 0) {
        pick = i;
        break;
      }
    }
    if (pick === -1) {
      // Zacyklení. Vezme se první nedokončený a jede se dál.
      for (let i = scan; i < count; i++) {
        if (done[i] === 0) {
          pick = i;
          break;
        }
      }
      if (pick === -1) break;
    }

    done[pick] = 1;
    order.push(nodes[pick]![0]);
    for (const next of after[pick]!) {
      if (waiting[next]! > 0) waiting[next]! -= 1;
    }
    while (scan < count && done[scan] === 1) scan++;
  }

  return order;
}
