import { applyCornerChanges, planRoadGrade, tileCorners } from './heights';
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
