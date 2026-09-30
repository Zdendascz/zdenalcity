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
 *
 * **Typovaná pole, ne objekty** (T133). Výsledek je týž jako u původní verze
 * s poli polí a `filter`, jen bez alokací v nejvnitřnější smyčce: na 9 442
 * uzlech autorova města to bylo 20–24 ms a řadí se po každé změně sady
 * uzlů — tedy i při každém domě, který vyroste.
 */
export function depthOrder(boxes: ReadonlyMap<number, DepthBox>): number[] {
  const count = boxes.size;
  if (count === 0) return [];

  // Vstup do polí: id, rohy, výška. Pořadí podle `seedRank`, při rovnosti id.
  const entries = [...boxes.entries()].sort((a, b) => seedRank(a[1], b[1]) || a[0] - b[0]);
  const ids = new Float64Array(count);
  const x0 = new Float64Array(count);
  const y0 = new Float64Array(count);
  const x1 = new Float64Array(count);
  const y1 = new Float64Array(count);
  const from = new Float64Array(count);
  const to = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const [id, b] = entries[i]!;
    ids[i] = id;
    x0[i] = b.x;
    y0[i] = b.y;
    x1[i] = b.x + b.width;
    y1[i] = b.y + b.depth;
    from[i] = columnFrom(b);
    to[i] = columnTo(b);
  }

  // Hrany se **nehledají přes všechny dvojice**. Zametá se zleva doprava po
  // svislých pruzích obrazovky a porovnává se jen s tím, co je zrovna otevřené.
  // Bez toho to je kvadratické: naměřeno 33 ms na 2 500 budovách.
  //
  // Při rovnosti pruhu rozhoduje index, tedy `seedRank` — přesně jako
  // stabilní řazení v původní verzi.
  const sweep = new Int32Array(count);
  for (let i = 0; i < count; i++) sweep[i] = i;
  const sweepOrder = Array.from(sweep).sort((p, q) => from[p]! - from[q]! || p - q);

  // Hrany `a → b` („a před b") do dvou rostoucích polí; seznam sousedů
  // (CSR) se z nich postaví až potom.
  let edgeFrom = new Int32Array(Math.max(16, count * 8));
  let edgeTo = new Int32Array(edgeFrom.length);
  let edges = 0;
  const waiting = new Int32Array(count);
  const outDegree = new Int32Array(count);
  const active = new Int32Array(count);
  let activeCount = 0;

  const behind = (a: number, b: number): boolean => x1[a]! <= x0[b]! || y1[a]! <= y0[b]!;
  const addEdge = (a: number, b: number): void => {
    if (edges === edgeFrom.length) {
      const grownFrom = new Int32Array(edges * 2);
      grownFrom.set(edgeFrom);
      edgeFrom = grownFrom;
      const grownTo = new Int32Array(edges * 2);
      grownTo.set(edgeTo);
      edgeTo = grownTo;
    }
    edgeFrom[edges] = a;
    edgeTo[edges] = b;
    edges++;
    outDegree[a]! += 1;
    waiting[b]! += 1;
  };

  for (const i of sweepOrder) {
    const start = from[i]!;
    // Zavřít pruhy, které už skončily — na místě, bez nového pole.
    let kept = 0;
    for (let k = 0; k < activeCount; k++) {
      const j = active[k]!;
      if (to[j]! > start) active[kept++] = j;
    }
    activeCount = kept;

    for (let k = 0; k < activeCount; k++) {
      const j = active[k]!;
      // `mustDrawBefore` rozepsané: `a` před `b`, jen když neplatí i opak.
      const ij = behind(i, j);
      const ji = behind(j, i);
      if (ij && !ji) addEdge(i, j);
      else if (ji && !ij) addEdge(j, i);
    }
    active[activeCount++] = i;
  }

  // Seznam následníků po uzlech (CSR). Pořadí uvnitř seznamu na výsledek
  // nemá vliv — rozhoduje jen počet čekajících.
  const offset = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) offset[i + 1] = offset[i]! + outDegree[i]!;
  const fill = offset.slice(0, count);
  const next = new Int32Array(edges);
  for (let e = 0; e < edges; e++) next[fill[edgeFrom[e]!]!++] = edgeTo[e]!;

  // Nejnižší připravený uzel z haldy. Původní verze ho hledala lineárně od
  // poslední pozice a vychází totéž: nejnižší index s `waiting === 0`.
  const heap = new Int32Array(count);
  let heapSize = 0;
  const push = (value: number): void => {
    let at = heapSize++;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (heap[parent]! <= value) break;
      heap[at] = heap[parent]!;
      at = parent;
    }
    heap[at] = value;
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap[--heapSize]!;
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= heapSize) break;
      if (child + 1 < heapSize && heap[child + 1]! < heap[child]!) child++;
      if (heap[child]! >= last) break;
      heap[at] = heap[child]!;
      at = child;
    }
    heap[at] = last;
    return top;
  };
  for (let i = 0; i < count; i++) if (waiting[i] === 0) push(i);

  const order: number[] = [];
  const done = new Uint8Array(count);
  let scan = 0;
  while (order.length < count) {
    let pick = -1;
    while (heapSize > 0) {
      const candidate = pop();
      if (done[candidate] === 0) {
        pick = candidate;
        break;
      }
    }
    if (pick === -1) {
      // Zacyklení. Vezme se první nedokončený a jede se dál.
      while (scan < count && done[scan] === 1) scan++;
      if (scan >= count) break;
      pick = scan;
    }

    done[pick] = 1;
    order.push(ids[pick]!);
    for (let e = offset[pick]!; e < offset[pick + 1]!; e++) {
      const successor = next[e]!;
      if (waiting[successor]! > 0) {
        waiting[successor]! -= 1;
        if (waiting[successor] === 0 && done[successor] === 0) push(successor);
      }
    }
  }

  return order;
}
