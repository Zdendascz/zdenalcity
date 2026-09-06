import { applyCornerChanges, MAX_HEIGHT, planCornerHeight, planRoadGrade, tileCorners } from './heights';
import { index, inBounds, ROAD } from './layers';

/**
 * Co si rovnání ze světa bere. Úzké schválně: počítá se z něj i **náhled ceny**
 * a ten dostává jen výřez, ne celý stav světa.
 */
export interface RoadGradeView {
  readonly size: number;
  readonly layers: { readonly road: Readonly<Uint8Array> };
  readonly cornerHeight: Readonly<Uint8Array>;
}

/**
 * Bitmaska sousedních silnic. `N = 1, E = 2, S = 4, W = 8`.
 *
 * Bydlela v rendereru s poznámkou, že „simulace o tvaru napojení nic neví".
 * Od chvíle, kdy si silnice srovnává příčný spád, to vědět **musí**: aby se dal
 * zrušit sklon kolmý na směr jízdy, musí se ten směr znát. Je to počítání nad
 * mřížkou, ne nad izometrií, takže do `sim/` patří (P3 mluví o projekci).
 *
 * Renderer si ji odsud bere, aby se vozovka a terén nemohly rozejít — kdyby si
 * každý počítal svou, stačilo by změnit jednu z nich a silnice by se kreslila
 * jinak, než jak se srovnal terén pod ní.
 */
export const ROAD_N = 1;
export const ROAD_E = 2;
export const ROAD_S = 4;
export const ROAD_W = 8;

export type IsRoad = (x: number, y: number) => boolean;

export function roadMask(isRoad: IsRoad, x: number, y: number): number {
  let mask = 0;
  if (isRoad(x, y - 1)) mask |= ROAD_N;
  if (isRoad(x + 1, y)) mask |= ROAD_E;
  if (isRoad(x, y + 1)) mask |= ROAD_S;
  if (isRoad(x - 1, y)) mask |= ROAD_W;
  return mask;
}

/**
 * Srovnání příčného spádu pro nově stavěnou dlaždici **i pro její sousedy**.
 *
 * Sousedy to musí přepočítat taky: rovné silnici, ke které přibude odbočka,
 * se změní maska, z přímého úseku se stane zatáčka — a ta se musí srovnat celá.
 * Bez toho by se šejdrem vozovka objevila přesně na křižovatkách, tedy tam,
 * kde je nejvíc vidět.
 *
 * Počítá se na pracovní kopii, aby druhý soused viděl, co udělal první.
 * Vrací jen rohy, které se opravdu mění.
 */
export function planRoadGradeAround(
  world: RoadGradeView,
  x: number,
  y: number,
): Map<number, number> {
  const built = (nx: number, ny: number) =>
    (nx === x && ny === y) ||
    (inBounds(nx, ny, world.size) &&
      (world.layers.road[index(nx, ny, world.size)] ?? ROAD.none) !== ROAD.none);

  const working = Uint8Array.from(world.cornerHeight);
  const changes = new Map<number, number>();

  const tiles: [number, number][] = [[x, y]];
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    if (built(x + dx, y + dy) && inBounds(x + dx, y + dy, world.size)) {
      tiles.push([x + dx, y + dy]);
    }
  }

  for (const [tx, ty] of tiles) {
    const step = planRoadGrade(working, tx, ty, roadMask(built, tx, ty));
    applyCornerChanges(working, step);
    for (const [k, v] of step) changes.set(k, v);
  }

  for (const [k, v] of [...changes]) {
    if ((world.cornerHeight[k] ?? 0) === v) changes.delete(k);
  }
  return changes;
}

/**
 * Unese terén pod dlaždicí ještě vozovku?
 *
 * Ptá se na **zkroucení, ne na sklon**. Vozovka smí stoupat i klopit se —
 * dlaždice je pak nakloněná rovina a nakreslí se i projede bez potíží. Co
 * nejde, je **sedlo**: čtyři rohy, které neleží v jedné rovině. Takový
 * čtyřúhelník se láme po úhlopříčce a vozovka přes něj visí našikmo přes zlom.
 * Přesně tenhle obrázek poslal autor se slovy, že pokud k tomu dojde, silnice
 * musí být rozbitá a nepoužitelná.
 *
 * Poznávací znamení sedla je, že se **nerovnají součty protilehlých rohů**;
 * rovina i rovnoběžný svah je mají stejné. Totéž pravidlo vymáhá
 * `planRoadGrade`, když staví osamocenou dlaždici — jen z druhé strany.
 *
 * **Není to opak `planRoadGrade` celý, a schválně.** Rovnání jde dál a ruší
 * i příčný spád, jenže dělá to jen pro stavěnou dlaždici a její čtyři sousedy;
 * kaskáda přitom umí naklopit i silnici o dvě dlaždice dál, a ta se v každém
 * dosud odehraném městě běžně vyskytuje. Vymáhat tady celé rovnání by po
 * načtení savu rozbilo polovinu sítě — změřeno na fixturách: z 84 dlaždic by
 * jich zbylo 35. Kreslí se přitom správně. Rozbíjí se tedy jen to, co je
 * doopravdy nakreslené špatně.
 */
export function roadFitsTerrain(world: RoadGradeView, x: number, y: number): boolean {
  if (!inBounds(x, y, world.size)) return true;
  if ((world.layers.road[index(x, y, world.size)] ?? ROAD.none) === ROAD.none) return true;

  const [nw, ne, sw, se] = tileCorners(world.cornerHeight, x, y);
  return nw + se === ne + sw;
}

/**
 * Dorovná terén tak, aby žádná silnice nezůstala v sedle.
 *
 * Vezme plán změn výšek a **rozšíří ho** o rohy, které je potřeba dorovnat pod
 * vozovkou. Vrací nový plán; původní nemění.
 *
 * ## Proč to existuje
 *
 * Roh drží čtyři dlaždice, takže srovnání parcely vedle ulice nakloní i
 * vozovku. Do T101 se taková silnice **zbořila na suť** — a bylo to horší, než
 * to vypadá: příkaz vrátil `ok`, odhad ceny mlčel a hráč se to nedozvěděl.
 * Protože je silnice zároveň vodičem elektřiny, díra v ní odřízla čtvrť od
 * proudu, nenapájené domy přestaly platit daň a městu spadl příjem na nulu.
 * Změřeno na větrníku o jedné dlaždici postaveném vedle rovné ulice: dvě
 * dlaždice vozovky se rozpadly a proud se za ně už nedostal.
 *
 * Autor rozhodl: **zbourání silnice nesmí proběhnout, terén se má dorovnat.**
 *
 * ## Jak
 *
 * Hráčův záměr je nedotknutelný — rohy, které si vyžádal, se nepřepisují.
 * Dorovnává se **volnými rohy pod vozovkou**: u sedla se dopočítá hodnota,
 * která srovná součty protilehlých rohů, a nastaví se přes `planCornerHeight`,
 * takže se s ní veze i kaskáda držící invariant sousedních rohů. To může
 * naklonit další silnici, proto se postup opakuje, dokud se něco mění.
 *
 * Když se to nepovede (roh by vyjel z rozsahu, nebo jsou všechny čtyři rohy
 * hráčovy), zůstane dlaždice v seznamu vrácených **nespravitelných** a volající
 * si rozhodne — buď zásah odmítne, nebo ji nechá spadnout jako dřív. Sesuv
 * půdy tudy nechodí: tam se silnice bořit **má**, a je to rozhodnutí z T89.
 */
export function gradeForRoads(
  world: RoadGradeView,
  changes: ReadonlyMap<number, number>,
  pending: Iterable<number> = [],
  core?: Iterable<number>,
): { changes: Map<number, number>; unfixable: number[] } {
  const side = world.size + 1;
  const plan = new Map(changes);
  /*
   * Nedotknutelné jsou jen rohy, o které hráč **opravdu stojí** — parcela pod
   * stavbou, roh, na který klikl. Zbytek plánu je kaskáda, tedy důsledek, a
   * tou se hýbat smí.
   *
   * Bez tohohle rozdělení se dorovnání zbytečně často vzdávalo: kaskáda kolem
   * srovnané parcely 3×3 zamkla i rohy dvě dlaždice daleko a silnice mezi nimi
   * pak neměla čím povolit. Změřeno na simulovaných partiích — stavba u
   * silnice se odmítala tak často, že si hráč za jednu partii vysloužil
   * 20 718 hlášek „terén tu nejde srovnat".
   */
  const locked = new Set(core ?? changes.keys());
  const unfixable = new Set<number>();
  // Dlaždice, na kterých vozovka teprve bude. Bez nich by dorovnání souseda
  // naklonilo právě stavěnou silnici a ta by po položení spadla — změřeno na
  // pěti mapách, 309 z 598 ztracených dlaždic byla ta právě stavěná.
  const laying = new Set(pending);
  const isRoad = (x: number, y: number): boolean =>
    (world.layers.road[index(x, y, world.size)] ?? ROAD.none) !== ROAD.none ||
    laying.has(index(x, y, world.size));

  // Pracovní kopie výšek: kaskáda i kontrola sedla se ptají na stav po změně,
  // ne před ní, a plán se během dorovnávání ještě roste.
  const scratch = Uint8Array.from(world.cornerHeight);
  for (const [corner, height] of plan) scratch[corner] = height;

  const cornerAt = (cx: number, cy: number): number => scratch[cy * side + cx] ?? 0;

  /** Sedlo na dlaždici: nerovnají se součty protilehlých rohů. */
  const twist = (x: number, y: number): number =>
    cornerAt(x, y) + cornerAt(x + 1, y + 1) - (cornerAt(x + 1, y) + cornerAt(x, y + 1));

  /**
   * Bylo to sedlo **už před zásahem**?
   *
   * Takové dlaždice se nechávají být. Pocházejí ze starých savů a ze sesuvů,
   * kde se bořit má; kdyby je dorovnávání bralo na sebe, hráč by platil za
   * úklid cizí škody a jedno kliknutí u kraje města by roztáhlo kaskádu přes
   * půl mapy. Hlavně ale nesmí propadnout do `unfixable`: volající podle něj
   * bourá, a bouralo by se něco, co tenhle příkaz nerozbil. Změřeno na pěti
   * generovaných mapách — všech 111 případů, kdy stavba silnice zbořila jinou,
   * padalo právě na tohle.
   */
  const wasTwisted = (x: number, y: number): boolean => {
    // Dlaždice, na kterou se vozovka teprve pokládá, žádnou minulost nemá —
    // ta se dorovnat musí, i kdyby terén pod ní byl v sedle odjakživa.
    if (laying.has(index(x, y, world.size))) return false;
    const [a, b, c, d] = tileCorners(world.cornerHeight, x, y);
    return a + d !== b + c;
  };

  /**
   * Kolik silnic by po téhle kaskádě zůstalo v sedle.
   *
   * Počítá se jen kolem rohů, kterých se kaskáda dotkne — dál nic změnit
   * nemůže. Dlaždice, které byly rozbité už předtím, se nepočítají; jinak by
   * skóre vedlo dorovnávání za cizí škodou.
   */
  const twistsAfter = (cascade: ReadonlyMap<number, number>): number => {
    const at = (cx: number, cy: number): number =>
      cascade.get(cy * side + cx) ?? scratch[cy * side + cx] ?? 0;
    const seen = new Set<number>();
    let count = 0;
    for (const corner of cascade.keys()) {
      const cx = corner % side;
      const cy = (corner - cx) / side;
      for (const [dx, dy] of AROUND) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (!inBounds(tx, ty, world.size)) continue;
        if (!isRoad(tx, ty)) continue;
        const at2 = index(tx, ty, world.size);
        if (seen.has(at2)) continue;
        seen.add(at2);
        if (wasTwisted(tx, ty)) continue;
        if (at(tx, ty) + at(tx + 1, ty + 1) !== at(tx + 1, ty) + at(tx, ty + 1)) count++;
      }
    }
    return count;
  };

  // Kolem kterých rohů se hledá. Roste, jak dorovnávání zasahuje dál.
  let frontier = new Set(plan.keys());

  for (let pass = 0; pass < GRADE_PASSES && frontier.size > 0; pass++) {
    const tiles = new Set<number>();
    for (const corner of frontier) {
      const cx = corner % side;
      const cy = (corner - cx) / side;
      for (const [dx, dy] of AROUND) {
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(x, y, world.size)) continue;
        if (!isRoad(x, y)) continue;
        tiles.add(index(x, y, world.size));
      }
    }

    const next = new Set<number>();
    // Setříděné, ať pořadí nezávisí na pořadí v množině (P2).
    for (const tile of [...tiles].sort((a, b) => a - b)) {
      const x = tile % world.size;
      const y = (tile - x) / world.size;
      const off = twist(x, y);
      if (off === 0) continue;
      if (wasTwisted(x, y)) continue;

      // Čtyři rohy dlaždice a o kolik by se každý musel posunout, aby sedlo
      // zmizelo. Protilehlé dvojice táhnou opačným směrem.
      const candidates: [number, number, number][] = [
        [x, y, -off],
        [x + 1, y + 1, -off],
        [x + 1, y, off],
        [x, y + 1, off],
      ];

      // Vybírá se **nejtišší** ze čtyř možností, ne první, která projde. Roh
      // sdílejí čtyři dlaždice, takže špatná volba jen posune sedlo na souseda
      // a to na dalšího — vlna pak běží po celé ulici. Změřeno na pěti mapách:
      // s „ber první" jeden klik přepsal až 68 rohů a sedlo skončilo sedmnáct
      // dlaždic daleko, protože průchodů je konečně mnoho. Cena je čtyři
      // kaskády místo jedné; kaskády jsou krátké, tak se to vyplatí.
      let best: Map<number, number> | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const [cx, cy, delta] of candidates) {
        const corner = cy * side + cx;
        if (locked.has(corner)) continue;
        const target = cornerAt(cx, cy) + delta;
        if (target < 0 || target > MAX_HEIGHT) continue;

        const cascade = planCornerHeight(scratch, cx, cy, target);
        if (cascade.size === 0) continue;
        // Kolik silnic by tahle volba nechala v sedle. Nula znamená hotovo.
        const score = twistsAfter(cascade) * 1000 + cascade.size;
        if (score >= bestScore) continue;
        best = cascade;
        bestScore = score;
        if (score < 1000) break; // nic nerozbila, lepší už to nebude
      }

      if (best === null) {
        unfixable.add(tile);
        continue;
      }
      for (const [changed, height] of best) {
        scratch[changed] = height;
        plan.set(changed, height);
        next.add(changed);
      }
    }
    frontier = next;
  }

  // Co po posledním průchodu pořád stojí v sedle, se spravit nepodařilo.
  for (const corner of plan.keys()) {
    const cx = corner % side;
    const cy = (corner - cx) / side;
    for (const [dx, dy] of AROUND) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, world.size)) continue;
      if (!isRoad(x, y)) continue;
      if (twist(x, y) !== 0 && !wasTwisted(x, y)) unfixable.add(index(x, y, world.size));
    }
  }

  // Rohy, které se dorovnáním vrátily na původní výšku, do plánu nepatří —
  // platilo by se za ně a nic by se nezměnilo.
  for (const [corner, height] of [...plan]) {
    if (locked.has(corner)) continue;
    if ((world.cornerHeight[corner] ?? 0) === height) plan.delete(corner);
  }

  return { changes: plan, unfixable: [...unfixable].sort((a, b) => a - b) };
}

/** Kolikrát se dorovnání zopakuje, než to vzdá. Kaskáda bývá krátká. */
const GRADE_PASSES = 12;

/** Dlaždice, které se dotýkají rohu. */
const AROUND = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
] as const;
