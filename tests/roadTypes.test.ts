/**
 * @vitest-environment jsdom
 *
 * `@/render/roads` si přitáhne `chunkRenderer` a s ním Pixi, které při importu
 * sáhne na `navigator` (`isSafari`). Bez DOM se soubor vůbec nenačte. Pragma je
 * na jeden soubor, ne globální nastavení — simulační testy zůstávají ve `node`.
 */
import { describe, expect, it } from 'vitest';
import { createVanillaSource } from '@/content/loader';
import { ContentRegistry } from '@/content/registry';
import { checkFootprint } from '@/sim/buildings';
import { buildRoad, bulldoze, terraformCorner, zoneArea } from '@/sim/commands';
import { index, ROAD, TERRAIN, ZONE } from '@/sim/layers';
import { tileQuad } from '@/render/projection';
import { roadMask, roadPolygons } from '@/render/roads';
import { roadFitsTerrain } from '@/sim/roads';
import { ROAD_FAMILIES } from '@/render/roadRenderer';
import { ROAD_COLORS, ROAD_WIDTHS } from '@/render/palette';
import { computeBudget } from '@/sim/systems/economy';
import type { BuildingCatalogue } from '@/sim/catalogue';
import { createWorld } from '@/sim/world';
import { VANILLA_BALANCE } from './support/balance';
import { MAP_SIZE } from './support/grid';

const EMPTY: BuildingCatalogue = { get: () => undefined, byCategory: () => [] };


function world() {
  return createWorld(1, VANILLA_BALANCE.economy);
}

const [STREET, AVENUE, HIGHWAY] = VANILLA_BALANCE.traffic.roadTypes;

describe('typy silnic v balancu', () => {
  it('kapacita, cena i údržba rostou s typem (§4)', () => {
    expect(STREET && AVENUE && HIGHWAY).toBeTruthy();
    if (!STREET || !AVENUE || !HIGHWAY) return;

    for (const key of ['capacity', 'cost', 'upkeep'] as const) {
      expect(AVENUE[key], key).toBeGreaterThan(STREET[key]);
      expect(HIGHWAY[key], key).toBeGreaterThan(AVENUE[key]);
    }
  });

  it('pořadí v balancu odpovídá hodnotám ve vrstvě', () => {
    expect(VANILLA_BALANCE.traffic.roadTypes.map((road) => road.id)).toEqual([
      'street',
      'avenue',
      'highway',
    ]);
    expect(ROAD.street).toBe(1);
    expect(ROAD.highway).toBe(3);
  });
});

describe('stavba silnic', () => {
  it('stojí podle typu', () => {
    const w = world();
    const before = w.economy.funds;

    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(w.economy.funds).toBe(before - (STREET?.cost ?? 0));
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.street);
  });

  it('vylepšení na místě přepíše typ a účtuje plnou cenu nového (§4)', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    const afterStreet = w.economy.funds;

    expect(buildRoad(w, 10, 10, ROAD.avenue, VANILLA_BALANCE).ok).toBe(true);

    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.avenue);
    expect(w.economy.funds).toBe(afterStreet - (AVENUE?.cost ?? 0));
  });

  it('stejný typ na stejné místo je odmítnutí, ne další útrata', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.avenue, VANILLA_BALANCE);
    const funds = w.economy.funds;

    const again = buildRoad(w, 10, 10, ROAD.avenue, VANILLA_BALANCE);

    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toBe('error.roadExists');
    expect(w.economy.funds).toBe(funds);
  });

  it('snížit typ nejde — jen zbourat a postavit znovu', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.highway, VANILLA_BALANCE);

    const downgrade = buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    expect(downgrade.ok).toBe(false);
    expect(downgrade.ok === false && downgrade.reason).toBe(
      'error.roadDowngrade',
    );
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.highway);

    expect(bulldoze(w, 10, 10, VANILLA_BALANCE).ok).toBe(true);
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.none);
    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
  });

  it('bez peněz se nestaví', () => {
    const w = world();
    w.economy.funds = 0;

    const result = buildRoad(w, 10, 10, ROAD.highway, VANILLA_BALANCE);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('error.notEnoughFunds');
    expect(w.layers.road[index(10, 10, MAP_SIZE)]).toBe(ROAD.none);
  });

  it('na vodu se silnice bez břehu neklade', () => {
    const w = world();
    w.layers.terrain[index(10, 10, MAP_SIZE)] = TERRAIN.water;

    expect(buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(false);
  });

  it('les silnici nezastaví, jen ji prodraží o vykácení', () => {
    // Trasa přes remízek byla do T61 dvacet kliků buldozerem. Silnice si les
    // vyklidí sama a účet za to hráč uvidí na kase.
    const w = world();
    const tile = index(11, 10, MAP_SIZE);
    w.layers.terrain[tile] = TERRAIN.forest;
    const before = w.economy.funds;

    expect(buildRoad(w, 11, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    expect(w.layers.terrain[tile]).toBe(TERRAIN.grass);
    expect(before - w.economy.funds).toBe(
      (STREET?.cost ?? 0) + VANILLA_BALANCE.map.clearForestCost,
    );
  });

  it('skála a mokřad stojí každý svou sazbu', () => {
    // Sazby se liší schválně: odtěžit skálu je dražší než vykácet les, takže
    // se hráči vyplatí trasu vést kolem — ne proto, že by nesměl skrz.
    const w = world();
    w.layers.terrain[index(13, 10, MAP_SIZE)] = TERRAIN.rock;
    w.layers.terrain[index(15, 10, MAP_SIZE)] = TERRAIN.marsh;

    const beforeRock = w.economy.funds;
    expect(buildRoad(w, 13, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    const rockPaid = beforeRock - w.economy.funds;

    const beforeMarsh = w.economy.funds;
    expect(buildRoad(w, 15, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    const marshPaid = beforeMarsh - w.economy.funds;

    expect(rockPaid).toBe((STREET?.cost ?? 0) + VANILLA_BALANCE.map.clearRockCost);
    expect(marshPaid).toBe((STREET?.cost ?? 0) + VANILLA_BALANCE.map.fillMarshCost);
    expect(rockPaid).toBeGreaterThan(marshPaid);
  });

  it('na vyklizení musí hráč mít', () => {
    // Silnice sama by na kasu stačila, vyklizení už ne. Odmítnout se to musí
    // celé — jinak by hráč zaplatil silnici a les by zůstal.
    const w = world();
    const tile = index(17, 10, MAP_SIZE);
    w.layers.terrain[tile] = TERRAIN.rock;
    w.economy.funds = (STREET?.cost ?? 0) + VANILLA_BALANCE.map.clearRockCost - 1;

    expect(buildRoad(w, 17, 10, ROAD.street, VANILLA_BALANCE).ok).toBe(false);
    expect(w.layers.terrain[tile]).toBe(TERRAIN.rock);
  });
});

describe('údržba silnic v rozpočtu', () => {
  it('platí se každý měsíc podle typu', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    buildRoad(w, 11, 10, ROAD.avenue, VANILLA_BALANCE);
    buildRoad(w, 12, 10, ROAD.highway, VANILLA_BALANCE);

    const budget = computeBudget(w, EMPTY, VANILLA_BALANCE);

    expect(budget.roads.count).toBe(3);
    expect(budget.roads.upkeep).toBe(
      (STREET?.upkeep ?? 0) + (AVENUE?.upkeep ?? 0) + (HIGHWAY?.upkeep ?? 0),
    );
    expect(budget.expenses).toBe(budget.roads.upkeep);
  });

  it('bez silnic se nic neúčtuje', () => {
    expect(computeBudget(world(), EMPTY, VANILLA_BALANCE).roads).toEqual({ count: 0, upkeep: 0 });
  });
});

describe('vykreslení', () => {
  it('všechny typy se navzájem napojují (§4)', () => {
    const w = world();
    buildRoad(w, 10, 10, ROAD.street, VANILLA_BALANCE);
    buildRoad(w, 11, 10, ROAD.highway, VANILLA_BALANCE);

    // Bitmask se počítá z „je tam jakákoli silnice", ne ze shody typů.
    const isRoad = (x: number, y: number): boolean =>
      (w.layers.road[index(x, y, MAP_SIZE)] ?? ROAD.none) !== ROAD.none;

    expect(roadMask(isRoad, 10, 10)).toBe(2); // ROAD_E
    expect(roadMask(isRoad, 11, 10)).toBe(8); // ROAD_W
  });

  it('vyšší typ je širší a má vlastní barvu', () => {
    expect(ROAD_WIDTHS[ROAD.avenue]).toBeGreaterThan(ROAD_WIDTHS[ROAD.street] ?? 0);
    expect(ROAD_WIDTHS[ROAD.highway]).toBeGreaterThan(ROAD_WIDTHS[ROAD.avenue] ?? 0);
    expect(new Set(ROAD_COLORS.slice(1)).size).toBe(3);
  });

  it('stavět jde u každého typu vozovky, ne jen u ulice', async () => {
    // Nahlásil autor při hraní: u třídy ani dálnice nešlo postavit nic.
    // `touchesRoad` porovnávala vrstvu s jedničkou, jenže od T24 je 1 ulice,
    // 2 třída a 3 dálnice — takže všechno kromě ulice bylo pro budovy neviditelné.
    const content = new ContentRegistry();
    await content.load(createVanillaSource());
    // Klinika je budova, která silnici podle definice **vyžaduje** — na parku
    // by test neukázal nic, ten se obejde bez ní.
    const clinic = content.get('vanilla:clinic');
    expect(clinic?.construction.requiresRoad).toBe(true);
    if (!clinic) return;

    for (const [name, roadType] of [
      ['ulice', ROAD.street],
      ['třída', ROAD.avenue],
      ['dálnice', ROAD.highway],
    ] as const) {
      const world = createWorld(1, VANILLA_BALANCE.economy);
      world.economy.funds = 100000;
      expect(buildRoad(world, 20, 20, roadType, VANILLA_BALANCE).ok, name).toBe(true);

      expect(checkFootprint(world, clinic, 20, 21).ok, name).toBe(true);
    }
  });

  it('šířka mění geometrii vozovky, ne počet dílů', () => {
    const narrow = roadPolygons(tileQuad(0, 0, [0, 0, 0, 0]), 0, 0.5);
    const wide = roadPolygons(tileQuad(0, 0, [0, 0, 0, 0]), 0, 0.86);

    expect(narrow).toHaveLength(wide.length);
    expect(narrow[0]).not.toEqual(wide[0]);
  });

  it('materiál má každý typ silnice a obsah ho dodává', () => {
    // Tvar vozovky kreslí kód, obrázek dodá jen povrch. Kdyby přibyl typ
    // silnice a materiál se k němu nedoplnil, kreslila by se plochou barvou —
    // a to je přesně ten druh vady, které si nikdo nevšimne, protože záloha
    // vypadá jako záměr.
    //
    // Kontroluje se **cesta, kterou jde hra**, ne složka: obrázky se berou
    // přes bílou listinu v `loader.ts` a právě tam se na ně jednou zapomnělo.
    const tiles = createVanillaSource().tiles ?? {};
    for (const [name, roadType] of [
      ['ulice', ROAD.street],
      ['třída', ROAD.avenue],
      ['dálnice', ROAD.highway],
    ] as const) {
      const family = ROAD_FAMILIES[roadType];
      expect(family, name).toBeDefined();
      expect(
        Object.keys(tiles).some((key) => key.startsWith(`asphalt_${family}|`)),
        `${name}: obsah nedodává materiál asphalt_${family}`,
      ).toBe(true);
    }

    // Nula je „žádná silnice" a materiál mít nesmí, jinak by se sáhlo i na
    // prázdnou dlaždici.
    expect(ROAD_FAMILIES[ROAD.none]).toBeUndefined();
  });

  it('obsah dodává obrázek trosek', () => {
    // Stejná past jako u asfaltu: obrázek ležel ve složce, ale bílá listina
    // v `loader.ts` o něm nevěděla, takže se do hry nedostal. Kontroluje se
    // proto **cesta, kterou jde hra**, ne složka.
    const tiles = createVanillaSource().tiles ?? {};
    expect(
      Object.keys(tiles).some((key) => key.startsWith('rubble|')),
      'obsah nedodává obrázek trosek',
    ).toBe(true);
  });

  it('obsah dodává obrázky katastrof na ulici', () => {
    // Hromadná nehoda a nepokoje se odehrávají na silnici a mapa o nich do T92
    // mlčela. Sprity mají vlastní index, takže se hlídá zvlášť od dlaždic.
    const sprites = createVanillaSource().sprites ?? {};
    for (const id of ['riot_crowd', 'pileup_wreck']) {
      expect(
        Object.keys(sprites).some((key) => key.startsWith(`${id}|`)),
        `obsah nedodává ${id}`,
      ).toBe(true);
    }
  });

  it('šířka vozovky roste s typem a obruba se vejde do dlaždice', () => {
    // Přechod mezi typy se stane na hranici dlaždic: každá kreslí svou šířku.
    // Aby to dávalo smysl, musí šířky růst — a s obrubou se pořád vejít.
    expect(ROAD_WIDTHS[ROAD.avenue]).toBeGreaterThan(ROAD_WIDTHS[ROAD.street]!);
    expect(ROAD_WIDTHS[ROAD.highway]).toBeGreaterThan(ROAD_WIDTHS[ROAD.avenue]!);
    expect(ROAD_WIDTHS[ROAD.highway]).toBeLessThan(1);
  });
});

describe('terén pod vozovkou', () => {
  /** Rovný svět s jednou silnicí v ose. */
  function withRoad(cells: readonly [number, number][]): ReturnType<typeof createWorld> {
    const w = createWorld(1);
    for (const [x, y] of cells) {
      expect(buildRoad(w, x, y, ROAD.street, VANILLA_BALANCE).ok).toBe(true);
    }
    return w;
  }

  /** Zvedne jeden roh **bez kaskády**, ať se testuje přesně jeden tvar. */
  function raise(w: ReturnType<typeof createWorld>, cx: number, cy: number, by: number): void {
    const side = MAP_SIZE + 1;
    const corner = cy * side + cx;
    w.cornerHeight[corner] = (w.cornerHeight[corner] ?? 0) + by;
  }

  it('rovná dlaždice unese vozovku', () => {
    const w = withRoad([
      [10, 10],
      [10, 11],
      [10, 12],
    ]);
    for (let y = 10; y <= 12; y++) expect(roadFitsTerrain(w, 10, y)).toBe(true);
  });

  it('rovnoběžný svah unese vozovku taky — klopená vozovka je pořád rovina', () => {
    // Sklon se **netrestá**. Silnice smí stoupat i být klopená; nakreslí se
    // i projede. Kdyby se bral jako vada, po načtení savu by ze sítě zbyla
    // půlka — změřeno na fixturách.
    const w = withRoad([[10, 10]]);
    raise(w, 10, 11, 1);
    raise(w, 11, 11, 1);
    expect(roadFitsTerrain(w, 10, 10)).toBe(true);
  });

  it('sedlo vozovku neunese', () => {
    // Čtyři rohy, které neleží v jedné rovině. Čtyřúhelník se láme po
    // úhlopříčce a vozovka přes něj visí našikmo přes zlom — přesně ten
    // obrázek, který poslal autor.
    const w = withRoad([[10, 10]]);
    raise(w, 11, 11, 1);
    expect(roadFitsTerrain(w, 10, 10)).toBe(false);
  });

  it('prázdná dlaždice se neposuzuje', () => {
    const w = createWorld(1);
    raise(w, 11, 11, 1);
    expect(roadFitsTerrain(w, 10, 10)).toBe(true);
  });

  it('srovnávání pod zónou se silnici vyhne', () => {
    // Zóna umí couvnout: plocha se dělí na menší, dokud nepřestane vadit —
    // stejně jako se odjakživa dělí kolem budov. Silnice tím zůstane stát.
    const w = withRoad([
      [10, 10],
      [10, 11],
      [10, 12],
    ]);
    raise(w, 12, 11, 2);
    expect(zoneArea(w, 11, 10, 3, 3, ZONE.residential, VANILLA_BALANCE).ok).toBe(true);

    expect(w.roadTiles.size, 'zónování zbořilo silnici').toBe(3);
    for (let y = 10; y <= 12; y++) {
      expect(roadFitsTerrain(w, 10, y), `dlaždice 10, ${y}`).toBe(true);
    }
  });

  it('srovnávání rohu pod silnicí ji rozbije a nechá trosky', () => {
    // Kdo couvnout neumí — ruční terraform je adresný příkaz — tomu se silnice
    // rozbije. Autor to chtěl jednoznačně: nakloněná vozovka ne, rozbitá ano.
    const w = withRoad([
      [10, 10],
      [10, 11],
      [10, 12],
    ]);
    expect(terraformCorner(w, 10, 11, 1, VANILLA_BALANCE).ok).toBe(true);

    for (let y = 10; y <= 12; y++) {
      expect(roadFitsTerrain(w, 10, y), `dlaždice 10, ${y}`).toBe(true);
    }
    expect(w.roadTiles.size, 'nic se nerozbilo, test nic neměří').toBeLessThan(3);
    for (let y = 10; y <= 12; y++) {
      const tile = index(10, y, MAP_SIZE);
      if ((w.layers.road[tile] ?? ROAD.none) !== ROAD.none) continue;
      expect(w.rubble[tile], `po silnici 10, ${y} nezůstaly trosky`).toBe(1);
    }
  });
});
