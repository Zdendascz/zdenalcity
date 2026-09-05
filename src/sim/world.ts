import { coarseCellsOf, createCoarseLayers } from './coarse';
import { createDisasterState } from './disasters/state';
import type { DisasterState } from './disasters/state';
import type { Bond, Loan } from './finance';
import type { LineStats, TransitLine } from './transit';
import { createCornerHeights } from './heights';
import type { CoarseLayers } from './coarse';
import { createLayers, DEFAULT_MAP_SIZE, inBounds, index, TERRAIN } from './layers';
import type { Layers } from './layers';
import type { RciCategory } from './rci';
import { Rng } from './rng';
import { shouldRun } from './systems';
import type { System } from './systems';

/**
 * Entita — na rozdíl od vrstev má identitu a životní cyklus (P4).
 * Obyvatelé entity nejsou: budova má `population: 83`, ne 83 objektů.
 */
export interface Building {
  id: number;
  definitionId: string; // 'vanilla:residential_small' — P6
  x: number; // levý horní roh footprintu
  y: number;
  /** Úroveň 1–5. Jaký půdorys a kapacitu k ní patří, říká definice (§8 fáze 2). */
  level: number;
  population: number;
  jobs: number;
  powered: boolean;
  builtAtTick: number;
  /**
   * Kdy budova naposledy změnila úroveň nebo půdorys.
   *
   * Cooldown proti blikání: bez něj by budova na hraně prahu skákala nahoru
   * a dolů každý běh systému úrovní.
   */
  levelChangedAtTick: number;
  /**
   * Opuštěná budova: stojí, ale nic nedělá. Nedaní, nestojí údržbu, nemá
   * obyvatele ani práci a přispívá do kriminality. **Sama nezmizí** — hráč ji
   * musí zbourat (§8 zadání fáze 2).
   */
  abandoned: boolean;
}

/**
 * Spokojenost čerstvě založeného města, 0–255.
 *
 * **Není to nula.** Nula znamená „tady se nedá žít“ a to o městě, kde ještě
 * nikdo nebydlí, neplatí — overlay by hned po založení hlásil katastrofu.
 * Stejnou hodnotu dostane vrstva i po načtení savu, protože se neukládá (R10).
 */
export const NEUTRAL_HAPPINESS = 128;

export const MIN_TAX_RATE = 0;
export const MAX_TAX_RATE = 20;

/**
 * Výchozí sazba a startovní kapitál, když se svět tvoří bez balancu.
 *
 * Slouží testům; hra vždycky předá `balance.economy`. Že se obojí neshoduje,
 * hlídá test — jinak by se tichý default rozešel s obsahem.
 */
export const DEFAULT_TAX_RATE = 7;
export const STARTING_FUNDS = 60000;

/** Ekonomické počáteční hodnoty světa. Bere se z `balance.economy`. */
export interface WorldEconomyDefaults {
  startingFunds: number;
  defaultTaxRate: number;
}

export interface EconomyState {
  funds: number;
  /** Daňová sazba v procentech pro každou zónovou kategorii. */
  taxRates: Record<RciCategory, number>;
  /** Bilance posledního měsíčního rozpočtu. Nulová, dokud první neproběhne. */
  lastIncome: number;
  lastExpenses: number;
  /**
   * Úvěrový rating, 0–1 (§8 fáze 4). Jednička je čistý štít.
   *
   * Není odvozený: je to **paměť**. Nesplacená splátka ho srazí, klid ho
   * pomalu léčí, a příští půjčka i emise dluhopisů se podle něj počítají.
   */
  creditRating: number;
  /**
   * Populace při poslední měsíční uzávěrce. Proti ní se měří růst, který
   * vstupuje do úspěšnosti emise dluhopisů.
   */
  lastPopulation: number;
}

/**
 * Poptávka po zónách. Kladná hodnota znamená „tady se chce stavět", záporná
 * „je toho už dost".
 */
export type DemandState = Record<RciCategory, number>;

/** Změny od posledního snímku. Renderer překresluje jen dotčené chunky. */
export interface DirtySet {
  tiles: Set<number>;
  buildings: Set<number>;
  fullRedraw: boolean;
  /**
   * Změnila se některá vrstva na hrubé mřížce?
   *
   * Vlastní příznak, ne 16 384 položek v `tiles`: difuze mění celou mapu naráz
   * a překreslit se to musí jen tehdy, když je zrovna zapnutý příslušný overlay.
   */
  coarseChanged: boolean;
  /**
   * Změnila se výška některého rohu terénu?
   *
   * Vlastní příznak vedle `tiles`, protože **tvar terénu se mění mnohem
   * vzácněji než dlaždice**. Zóna, silnice i vyrostlý dům špiní dlaždici, ale
   * s výškami nehnou — a překreslovat kvůli nim čtvercovou síť, která kopíruje
   * rohy, by znamenalo přestavět ji několikrát za sekundu v každém živém městě.
   */
  heightsChanged: boolean;
}

export function createDirtySet(): DirtySet {
  return {
    tiles: new Set(),
    buildings: new Set(),
    fullRedraw: false,
    coarseChanged: false,
    heightsChanged: false,
  };
}

export interface WorldState {
  readonly size: number;
  readonly seed: number;
  tick: number; // monotónní počítadlo od začátku hry

  layers: Layers;
  /** Difuzní vrstvy na hrubé mřížce 32×32 (fáze 2). */
  coarse: CoarseLayers;
  buildings: Map<number, Building>;
  nextBuildingId: number;

  economy: EconomyState;
  demand: DemandState;
  rng: Rng;

  /** Runtime-only, do savu nepatří — po loadu se stejně překresluje všechno. */
  dirty: DirtySet;

  /**
   * Pokrytí službami: klíč je třída, hodnota mřížka 32×32.
   *
   * **Neukládá se** — dá se spočítat z rozmístění budov a financování, takže by
   * se v savu mohlo rozejít se skutečností (§2 zadání fáze 2).
   */
  coverage: Map<string, Uint8Array>;

  /** Financování služeb v procentech (0–1) podle třídy. Chybějící klíč = plné. */
  serviceFunding: Map<string, number>;

  /** Změnilo se rozmístění služeb nebo jejich financování? */
  coverageDirty: boolean;

  /**
   * Zátěž na silnicích, plné rozlišení. **Neukládá se** (R10) — je odvozená
   * a po načtení savu se do pár tiků spočítá znovu.
   */
  trafficLoad: Float32Array;

  /**
   * Patra v rozích mřížky, 0–15 (§7 fáze 3). Mřížka je o jedna větší než mřížka
   * dlaždic — výška patří rohu, ne dlaždici, jinak by každý svah byl schod.
   * Pravidla i kaskádu drží `sim/heights.ts`.
   *
   * **Do savu půjde až ve verzi 4 (T34).** Do té doby si načtené město odnese
   * rovný terén; je to vědomý dluh, ne opomenutí.
   */
  cornerHeight: Uint8Array;

  /** Jak dobře se z budovy dostane do práce, 0–1. Klíč je id budovy. */
  jobAccess: Map<number, number>;

  /**
   * Poslední násobitele skóre za dostupnost práce po buňkách hrubé mřížky a
   * jeden celoměstský, kterým se škrtí rychlost růstu (R6).
   *
   * **Neukládá se** — je to výstup růstu, ne stav světa. Drží se tu jen proto,
   * aby panel parcely ukazoval přesně to číslo, se kterým růst opravdu počítal,
   * a hráč viděl, proč se čtvrť zadrhla. Než růst poprvé proběhne, jsou to
   * jedničky, tedy „nic to nebrzdí“.
   */
  jobAccessCells: Float32Array;
  cityJobAccess: number;

  /**
   * Kde skončilo vzorkování dopravy minule. **Do savu patří**: bez něj by se
   * po načtení vzorkovalo od začátku a determinismus by padl (§5 fáze 3).
   */
  trafficCursor: number;

  /**
   * Odkud se vzala mapa. **Do savu patří** (§10 fáze 3): ze seedu jde terén
   * kdykoli vygenerovat znovu, takže město zůstává reprodukovatelné i pro
   * nástroje mimo hru.
   *
   * `generated: false` znamená „mapa nevznikla generátorem" — ruční mapa,
   * testovací svět, nebo město ze savu, který generátor ještě nezažil.
   * Parametry generátoru se sem nepíšou: sedí v balancu, a ten je obsah, takže
   * ho save eviduje přes `meta.content.sources`.
   */
  map: { seed: number; generated: boolean };

  /**
   * Kolikrát po sobě vyšla budově cena půdy pod prahem její úrovně.
   *
   * **Neukládá se.** Je to jen hystereze proti kmitání na hranici prahu; po
   * načtení savu se počítá znovu, takže se snížení nanejvýš o pár vyhodnocení
   * odloží. Uložený stav by naopak musel držet krok s obsahem, který se mezi
   * savem a načtením mohl změnit.
   */
  downgradeStreak: Map<number, number>;

  /**
   * Změnila se od posledního přepočtu topologie elektrické sítě?
   * `powerSystem` běží každý tik, ale flood fill pouští jen při tomhle flagu (§5).
   * Runtime-only — po loadu se síť přepočítá znovu.
   */
  powerNetworkDirty: boolean;

  /**
   * Kam došla voda potrubím, 0/1 na dlaždici. **Neukládá se** — dá se spočítat
   * ze zdrojů a potrubí, takže uložená by se mohla rozejít se skutečností.
   */
  waterSupply: Uint8Array;
  /** Budovy, ke kterým voda došla. Odvozené, do savu nepatří. */
  watered: Set<number>;
  /**
   * Kolikrát po sobě byla budova bez vody. **Neukládá se** — po načtení savu
   * začne počítadlo znovu, což chátrání nanejvýš o pár vyhodnocení odloží.
   */
  waterlessStreak: Map<number, number>;
  /** Změnilo se potrubí nebo rozmístění vodáren? */
  waterNetworkDirty: boolean;

  /**
   * Spokojenost na hrubé mřížce, 0–255 (§9 fáze 3). **Neukládá se** (R10) —
   * je odvozená ze stavu, který se ukládá, takže by se v savu mohla rozejít
   * se skutečností.
   */
  happiness: Uint8Array;

  /**
   * Dlaždice, na kterých stojí silnice (R20 fáze 4).
   *
   * Do T45 si každý systém, který silnice potřeboval, prošel celou mapu.
   * Na 128 × 128 to bylo 16 384 porovnání a nikdo si toho nevšiml; na
   * 512 × 512 je jich 262 144 a spokojenost sama zabrala 8,9 ms na jeden běh —
   * půlku rozpočtu šedesáti snímků. Seznam se místo toho **udržuje** při zápisu
   * do vrstvy.
   *
   * **Neukládá se** — dá se kdykoli obnovit průchodem vrstvy (`rebuildTileIndex`)
   * a uložený by se s ní mohl rozejít. Přesně to dělá načtení savu.
   */
  roadTiles: Set<number>;

  /**
   * Dlaždice s nějakou zónou. Nefiltruje se tu, jestli je na nich volno —
   * to se pozná až při růstu a měnilo by se to každý tik.
   */
  zonedTiles: Set<number>;

  /**
   * Buňky hrubé mřížky, které mají vodu v sobě nebo vedle sebe.
   *
   * Počítá se z terénu, a ten se skoro nemění — přepočítávat to každých
   * šestnáct tiků průchodem 262 144 dlaždic je marnost. `null` znamená
   * „přepočítej", nastavuje ho `markTerrainChanged()`.
   */
  waterNear: Uint8Array | null;

  /**
   * Podíly terénu v buňkách hrubé mřížky, podle druhu terénu.
   *
   * Stejný důvod jako u `waterNear`: cena půdy si to počítala dvakrát za běh
   * (les a písek), pokaždé průchodem celé mapy. Prázdná mapa znamená
   * „přepočítej"; vyprazdňuje ji `markTerrainChanged()`.
   */
  terrainShares: Map<number, Float32Array>;

  /**
   * Katastrofy (§3 fáze 4): přepínač, hájení, běžící pohromy a dočasné postihy.
   * Vlastní stav si drží `disasters/state.ts`.
   */
  disasters: DisasterState;

  /**
   * Intenzita ohně na dlaždici, 0–255. Vlastní vrstvu má oheň jako jediný
   * kromě záplavy (R14) — obojí je proces na desítky tiků a musí se ukládat.
   */
  fire: Uint8Array;
  /**
   * Zbývající palivo hořící dlaždice v ohňových ticích.
   *
   * Oheň je **závod**: buď intenzita klesne na nulu dřív, než dojde palivo,
   * nebo budova shoří. Palivo se proto musí pamatovat — bez něj by hořelo
   * všechno stejně dlouho a hasiči by neměli co dohánět.
   */
  fuel: Uint8Array;
  /** 1 = lesní požár. Šíří se jinak a po vyhoření zbude tráva, ne trosky. */
  fireFlags: Uint8Array;
  /**
   * Zbývající doba zaplavení v ticích (§5 fáze 4).
   *
   * Ne hloubka — ta je ve `floodDepth`. Voda opadá po tiku a hasiči opadání
   * zrychlují, takže odpočet musí být **per dlaždici**: čtvrť u hasičárny
   * vyschne dřív než ta na druhém konci.
   */
  flood: Uint8Array;
  /**
   * O kolik pater je dlaždice pod hladinou.
   *
   * Vlastní vrstva, i když zadání jmenuje jen `flood` a `floodDamage`.
   * Poškození se počítá z hloubky **každý tik**, takže ji nestačí spočítat při
   * zaplavení a zapomenout. Odvodit ji zpětně z jedné hladiny by přestalo
   * platit v okamžiku, kdy zemětřesení spustí druhou záplavu jinde (T51).
   */
  floodDepth: Uint8Array;
  /**
   * Nasbírané poškození, 0–255. Při 255 je po budově.
   *
   * Škoda se **hromadí**, nepůsobí naráz — právě proto rychlé opadnutí
   * opravdu zachraňuje a hasiči do povodně mluví.
   */
  floodDamage: Uint8Array;
  /**
   * Trosky, 0/1 na dlaždici (R15).
   *
   * **Vrstva, ne stav budovy** — schválně: trosky zůstanou i tam, kde žádná
   * budova nestála, po zničené silnici nebo potrubí. Blokují stavbu, dokud je
   * hráč nezbourá, a mezitím se chovají jako ruiny z fáze 2: srážejí cenu
   * půdy a živí kriminalitu.
   */
  rubble: Uint8Array;

  /**
   * Co na dlaždici stálo, než ji katastrofa srovnala. Klíč = dlaždice,
   * hodnota = `definitionId`.
   *
   * **Řídká mapa, ne vrstva.** Trosky s pamětí jsou jen tam, kde stála budova;
   * po silnici ani potrubí se nic nepamatuje. Plná vrstva by navíc musela
   * ukládat čísla místo id, a do savu čísla definic nepatří (P6).
   *
   * Nahlásil autor: po vyhořelém městě se nedalo poznat, co kde bylo, takže
   * z obnovy bylo hádání. Zvlášť u služeb — nemocnice a hasičárna po sobě
   * nechají tutéž hromadu.
   */
  rubbleOf: Map<number, string>;

  /**
   * Kdy byla dlaždice naposledy upravena terénně (T54). Nula znamená nikdy.
   *
   * Používá to **jen sesuv půdy**: čerstvě přesypaná půda drží hůř, takže se
   * na ni sesuv chytá ochotněji. Je to jediné místo ve hře, kde záleží na tom,
   * **kdy** hráč terén upravil, ne jak.
   *
   * Uint16 přeteče po 65 536 ticích, tedy po 182 herních letech. Stáří se
   * proto počítá po kruhu a jediná daň za to je, že dlaždice upravená přesně
   * před 182 lety vypadá chvíli jako čerstvá. Zvedne to váhu jednoho místa
   * v losu; víc si za dvojnásobnou paměť kupovat nemá cenu.
   */
  terraformTick: Uint16Array;

  /**
   * Nakaženost po buňkách hrubé mřížky, 0–1 (T53).
   *
   * **Řídká mapa, ne vrstva.** Většina města je vždycky nenakažená; plná vrstva
   * by bylo pole nul o velikosti mapy, které se každý cyklus prochází celé.
   * Prázdná mapa znamená „nic se neděje" a stojí to nula.
   */
  infection: Map<number, number>;

  /** Linky MHD (§7 fáze 4). Prázdné pole je platný stav — město bez MHD. */
  lines: TransitLine[];
  nextLineId: number;
  /**
   * Kolik kapacity ukusuje kolejová doprava, po silničních dlaždicích.
   *
   * **Odvozené** z linek, udržované (R20): kolony se počítají z každé silniční
   * dlaždice a ptát se přitom pokaždé na všechny linky je součin dvou velkých
   * čísel. Po načtení savu se dopočítá.
   */
  tramTiles: Map<number, number>;
  transitDirty: boolean;
  /**
   * Co která linka za měsíc odveze a vydělá. **Odvozené** — po načtení savu se
   * dopočítá z linek a města.
   */
  lineStats: Map<number, LineStats>;
  /** Běžící půjčky (§8 fáze 4). Prázdné pole je zdravý stav. */
  loans: Loan[];
  nextLoanId: number;
  /** Id už přiznaných grantů. Do savu — jinak by se po loadu rozdaly znovu. */
  grantsAwarded: Set<string>;
  /**
   * Kolik tiků v kuse platí podmínka grantu, který ji ještě nesplnil dost dlouho.
   *
   * Přeruší-li se, počítadlo se maže. Bez toho by šel grant za spokojenost
   * sebrat tím, že hráč na jediný tik srazí daně na nulu.
   */
  grantProgress: Map<string, number>;
  /** Vydané dluhopisy (§8 fáze 4). */
  bonds: Bond[];
  nextBondId: number;
  /**
   * Do kterého tiku je zakázáno vydat další emisi.
   *
   * Nesplacená jistina není jen sražený rating — je to **několik let bez
   * přístupu na trh**. Kdo nezaplatil, tomu příště nikdo nepůjčí.
   */
  bondsBlockedUntil: number;
  /**
   * Kolik cest v buňce vezme MHD, 0–1. Odvozené z `lineStats`; drží se zvlášť,
   * protože se na to ptá doprava u každé budovy.
   */
  transitRelief: Map<number, number>;
}

/**
 * Nový svět o hraně `size`.
 *
 * Velikost je parametr, ne konstanta (T42): mapy 128–512 se liší jen tímhle
 * číslem a všechno ostatní — vrstvy, hrubá mřížka, rohy terénu — se z něj
 * odvodí. Výchozí hodnota je tu kvůli testům, hra ji vždycky předává z dialogu
 * nové hry.
 */
export function createWorld(
  seed: number,
  economy: WorldEconomyDefaults = {
    startingFunds: STARTING_FUNDS,
    defaultTaxRate: DEFAULT_TAX_RATE,
  },
  size: number = DEFAULT_MAP_SIZE,
): WorldState {
  const coarseCells = coarseCellsOf(size);
  return {
    size,
    seed: seed >>> 0,
    tick: 0,
    layers: createLayers(size),
    coarse: createCoarseLayers(size),
    buildings: new Map(),
    nextBuildingId: 1, // 0 ve vrstvě `buildingId` znamená prázdno
    economy: {
      funds: economy.startingFunds,
      taxRates: {
        residential: economy.defaultTaxRate,
        commercial: economy.defaultTaxRate,
        industrial: economy.defaultTaxRate,
      },
      creditRating: 1,
      lastPopulation: 0,
      lastIncome: 0,
      lastExpenses: 0,
    },
    demand: { residential: 0, commercial: 0, industrial: 0 },
    rng: new Rng(seed),
    // Čerstvý svět renderer ještě neviděl.
    dirty: {
      tiles: new Set(),
      buildings: new Set(),
      fullRedraw: true,
      coarseChanged: true,
      heightsChanged: true,
    },
    coverage: new Map(),
    serviceFunding: new Map(),
    coverageDirty: false,
    trafficLoad: new Float32Array(size * size),
    cornerHeight: createCornerHeights(size),
    jobAccess: new Map(),
    jobAccessCells: new Float32Array(coarseCells).fill(1),
    cityJobAccess: 1,
    trafficCursor: 0,
    map: { seed: seed >>> 0, generated: false },
    downgradeStreak: new Map(),
    powerNetworkDirty: false, // prázdná mapa nemá co propočítávat
    waterSupply: new Uint8Array(size * size),
    watered: new Set(),
    waterlessStreak: new Map(),
    waterNetworkDirty: false,
    happiness: new Uint8Array(coarseCells).fill(NEUTRAL_HAPPINESS),
    roadTiles: new Set(),
    zonedTiles: new Set(),
    waterNear: null,
    terrainShares: new Map(),
    disasters: createDisasterState(),
    fire: new Uint8Array(size * size),
    fuel: new Uint8Array(size * size),
    fireFlags: new Uint8Array(size * size),
    rubble: new Uint8Array(size * size),
    rubbleOf: new Map<number, string>(),
    terraformTick: new Uint16Array(size * size),
    infection: new Map(),
    lines: [],
    nextLineId: 1,
    tramTiles: new Map(),
    transitDirty: false,
    lineStats: new Map(),
    loans: [],
    nextLoanId: 1,
    grantsAwarded: new Set(),
    grantProgress: new Map(),
    bonds: [],
    nextBondId: 1,
    bondsBlockedUntil: 0,
    transitRelief: new Map(),
    flood: new Uint8Array(size * size),
    floodDepth: new Uint8Array(size * size),
    floodDamage: new Uint8Array(size * size),
  };
}

/**
 * Zapíše silnici a udrží seznam. **Jediná cesta, jak do vrstvy `road` psát.**
 *
 * Kdyby někdo zapsal do vrstvy přímo, seznam by se rozešel s mapou a růst by
 * si vymýšlel silnice, které nikdo nepostavil. Hlídá to test, který po dlouhém
 * běhu seznam přepočítá a porovná.
 */
export function setRoadTile(world: WorldState, tile: number, type: number): void {
  world.layers.road[tile] = type;
  if (type === 0) world.roadTiles.delete(tile);
  else world.roadTiles.add(tile);
}

/** Zapíše zónu a udrží seznam. Stejný důvod jako u `setRoadTile`. */
export function setZoneTile(world: WorldState, tile: number, zone: number): void {
  world.layers.zone[tile] = zone;
  if (zone === 0) world.zonedTiles.delete(tile);
  else world.zonedTiles.add(tile);
}

/** Terén se změnil — co se z něj počítá, se musí zahodit. */
export function markTerrainChanged(world: WorldState): void {
  world.waterNear = null;
  world.terrainShares.clear();
}

/**
 * Postaví seznamy znovu průchodem vrstev.
 *
 * Používá to načtení savu — seznamy se neukládají (R10), protože odvozený stav
 * v savu se dřív nebo později rozejde se skutečností. A používají to testy jako
 * orákulum: co vyjde odsud, musí sedět s tím, co se udržovalo cestou.
 */
export function rebuildTileIndex(world: WorldState): void {
  world.roadTiles.clear();
  world.zonedTiles.clear();
  world.waterNear = null;
  world.terrainShares.clear();

  const { road, zone } = world.layers;
  for (let tile = 0; tile < road.length; tile++) {
    if ((road[tile] ?? 0) !== 0) world.roadTiles.add(tile);
    if ((zone[tile] ?? 0) !== 0) world.zonedTiles.add(tile);
  }
}

/**
 * Přestaví svět na jinou velikost mapy.
 *
 * Používá to načítání savu: renderer i UI drží `getSnapshot()` jako živý pohled
 * (T2), takže se objekt světa nesmí vyměnit — musí se přealokovat vrstvy uvnitř
 * něj. Obsah se zahazuje, protože ho volající vzápětí přepíše ze savu; kdyby se
 * kus starého města přenesl, mísila by se dvě různá města.
 *
 * Když velikost sedí, nedělá nic: přealokovat 512 × 512 zbytečně by při každém
 * loadu stálo desítky megabajtů.
 */
export function resizeWorld(world: WorldState, size: number): void {
  if (world.size === size) return;

  // `size` je readonly, aby ho nikdo nepřepsal omylem. Load je stejná
  // legitimní výjimka jako u `seed` — ze světa se stává jiné město.
  (world as { size: number }).size = size;

  world.layers = createLayers(size);
  world.coarse = createCoarseLayers(size);
  world.cornerHeight = createCornerHeights(size);
  world.trafficLoad = new Float32Array(size * size);
  world.waterSupply = new Uint8Array(size * size);
  world.jobAccessCells = new Float32Array(coarseCellsOf(size)).fill(1);
  world.happiness = new Uint8Array(coarseCellsOf(size)).fill(NEUTRAL_HAPPINESS);
  // Seznamy patří ke starým vrstvám; nové jsou prázdné.
  world.roadTiles.clear();
  world.zonedTiles.clear();
  world.waterNear = null;
  world.terrainShares.clear();
  // Vrstvy katastrof patří ke staré mřížce. Běžící pohromy taky — jejich
  // souřadnice by v nové mapě ukazovaly někam jinam.
  world.fire = new Uint8Array(size * size);
  world.fuel = new Uint8Array(size * size);
  world.fireFlags = new Uint8Array(size * size);
  world.flood = new Uint8Array(size * size);
  world.floodDepth = new Uint8Array(size * size);
  world.floodDamage = new Uint8Array(size * size);
  world.rubble = new Uint8Array(size * size);
  world.rubbleOf.clear();
  world.terraformTick = new Uint16Array(size * size);
  world.disasters.active.length = 0;
  world.disasters.modifiers.length = 0;
  world.dirty.fullRedraw = true;
  world.dirty.coarseChanged = true;
}

/** Potrubí nebo vodárna se změnily — vodovod se musí přepočítat. */
export function markWaterNetworkDirty(world: WorldState): void {
  world.waterNetworkDirty = true;
}

/** Vodiče (silnice, budovy) se změnily — síť se musí přepočítat. */
export function markPowerNetworkDirty(world: WorldState): void {
  world.powerNetworkDirty = true;
}

/** Přibyla nebo zmizela služba, případně se změnilo financování. */
export function markCoverageDirty(world: WorldState): void {
  world.coverageDirty = true;
}

/**
 * Zapíše nové výšky rohů a označí, co se kvůli tomu musí překreslit (§7 fáze 3).
 *
 * Jeden roh drží **čtyři dlaždice** — ty kolem něj. Kdyby se označila jen jedna,
 * zůstal by na mapě viset zlom: sousední chunk by si dál kreslil starý tvar.
 *
 * Budovy na dotčených dlaždicích se hlásí zvlášť. Stojí na výšce základny,
 * takže se s terénem musí posunout, a `dirty.tiles` se jich netýká — kreslí je
 * jiný renderer.
 */
/**
 * Co potřebuje `reshapeBlocker` vědět o světě.
 *
 * Úmyslně užší než `WorldState`, aby se na to uměl zeptat i renderer, který má
 * po ruce jen `ReadonlyWorldView` — cenovka při tažení musí spočítat totéž co
 * příkaz, a kdyby k tomu potřebovala zapisovatelný svět, počítala by to jinde
 * a jinak.
 */
export interface ReshapeView {
  readonly size: number;
  readonly cornerHeight: Readonly<Uint8Array>;
  readonly layers: {
    readonly buildingId: Readonly<Uint16Array>;
    readonly terrain: Readonly<Uint8Array>;
    /** Silnice: srovnávání se jí musí vyhnout, aby ji nezkroutilo. */
    readonly road: Readonly<Uint8Array>;
  };
}

/** Dlaždice, které se dotýkají rohu. Roh drží čtyři, u kraje mapy míň. */
export function tilesAroundCorner(world: ReshapeView, corner: number): number[] {
  const cornerSize = world.size + 1;
  const cx = corner % cornerSize;
  const cy = (corner - cx) / cornerSize;

  const tiles: number[] = [];
  for (const [dx, dy] of [
    [-1, -1],
    [0, -1],
    [-1, 0],
    [0, 0],
  ] as const) {
    const x = cx + dx;
    const y = cy + dy;
    if (inBounds(x, y, world.size)) tiles.push(index(x, y, world.size));
  }
  return tiles;
}

/**
 * Smí se terén na tomhle plánu vůbec hnout? Vrací jméno překážky, jinak `null`.
 *
 * Roh drží čtyři dlaždice, takže srovnání pod jednou budovou hne i terénem pod
 * sousedy. Kdyby na některém stála stavba, spadla by do svahu, aniž by o to
 * kdokoli řekl — a **hladinu moře zvedat neumíme** vůbec.
 *
 * Bydlí to ve `world.ts`, protože se na to ptají dvě různá místa: hráčův příkaz
 * a růst zástavby. Dvě kopie téhož pravidla by se rozešly.
 */
export function reshapeBlocker(
  world: ReshapeView,
  changes: ReadonlyMap<number, number>,
): 'building' | 'water' | 'road' | null {
  for (const [corner, target] of changes) {
    const current = world.cornerHeight[corner] ?? 0;

    for (const tile of tilesAroundCorner(world, corner)) {
      if (world.layers.buildingId[tile] !== 0) return 'building';
      if (target > current && world.layers.terrain[tile] === TERRAIN.water) return 'water';
      // Silnice se **nesmí zkroutit**. Vozovka přes sedlo se láme po úhlopříčce
      // a kreslí se našikmo přes zlom — autor to nahlásil obrázkem. Kdo umí
      // couvnout (srovnávání pod zónou to umí, dělí plochu na menší), couvne;
      // kdo ne, tomu silnici rozbije `collapseUnsupportedRoads`.
      if (world.layers.road[tile] !== 0 && wouldTwist(world, changes, tile)) return 'road';
    }
  }

  return null;
}

/**
 * Nechal by plán dlaždici zkroucenou?
 *
 * Počítá se **z plánu, ne ze světa**: ptáme se na tvar po změně, a ta se ještě
 * nestala. Zkroucená je dlaždice, jejíž protilehlé rohy nemají stejný součet —
 * rovina ani rovnoběžný svah takový tvar nemají, sedlo ano.
 */
function wouldTwist(
  world: ReshapeView,
  changes: ReadonlyMap<number, number>,
  tile: number,
): boolean {
  const cornerSize = world.size + 1;
  const x = tile % world.size;
  const y = (tile - x) / world.size;
  const at = (cx: number, cy: number): number => {
    const corner = cy * cornerSize + cx;
    return changes.get(corner) ?? world.cornerHeight[corner] ?? 0;
  };
  return at(x, y) + at(x + 1, y + 1) !== at(x + 1, y) + at(x, y + 1);
}

export function applyHeightChanges(
  world: WorldState,
  changes: ReadonlyMap<number, number>,
): void {
  const cornerSize = world.size + 1;

  for (const [corner, height] of changes) {
    world.cornerHeight[corner] = height;

    const cx = corner % cornerSize;
    const cy = (corner - cx) / cornerSize;
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, world.size)) continue;

      const tile = index(x, y, world.size);
      world.dirty.tiles.add(tile);
      // Tudy jde **každá** změna terénu, takže je to jediné místo, kde se
      // příznak nastavuje.
      world.dirty.heightsChanged = true;
      // Čerstvě přesypaná půda drží hůř (T54). Zapisuje se **tady**, protože
      // tudy jde každá změna terénu — ruční i ta, kterou si udělá silnice
      // nebo zóna sama.
      world.terraformTick[tile] = world.tick & 0xffff;

      const buildingId = world.layers.buildingId[tile] ?? 0;
      if (buildingId !== 0) world.dirty.buildings.add(buildingId);
    }
  }
}

/** Financování třídy v rozsahu 0–1. Neznámá třída je plně financovaná. */
export function serviceFunding(world: WorldState, serviceClass: string): number {
  return world.serviceFunding.get(serviceClass) ?? 1;
}

export function coverageOf(world: WorldState, serviceClass: string): Uint8Array | undefined {
  return world.coverage.get(serviceClass);
}

export function markTileDirty(world: WorldState, x: number, y: number): void {
  if (inBounds(x, y, world.size)) {
    world.dirty.tiles.add(index(x, y, world.size));
  }
}

export function markBuildingDirty(world: WorldState, buildingId: number): void {
  world.dirty.buildings.add(buildingId);
}

/**
 * Odstraní budovu i její otisk ve vrstvě `buildingId`.
 *
 * Footprint se hledá průchodem celou vrstvou, protože entita svou velikost
 * nenese (architektura §4) a bez definice ji nelze odvodit. Bourání je akce
 * hráče, ne věc tiku, takže 16 384 porovnání nikoho nebolí.
 */
export function removeBuilding(world: WorldState, buildingId: number): boolean {
  if (!world.buildings.delete(buildingId)) return false;
  world.downgradeStreak.delete(buildingId);
  world.jobAccess.delete(buildingId);

  const layer = world.layers.buildingId;
  for (let tile = 0; tile < layer.length; tile++) {
    if (layer[tile] !== buildingId) continue;
    layer[tile] = 0;
    const x = tile % world.size;
    markTileDirty(world, x, (tile - x) / world.size);
  }

  markBuildingDirty(world, buildingId);
  markPowerNetworkDirty(world); // budova byla vodič i možný zdroj
  markWaterNetworkDirty(world);
  world.watered.delete(buildingId);
  world.waterlessStreak.delete(buildingId);
  // Zbouraná budova mohla být služba; přepočet je levný, rozlišovat se nevyplatí.
  markCoverageDirty(world);
  return true;
}

/**
 * Populace je agregát přes budovy — obyvatelé nejsou entity (§4).
 *
 * Bere rovnou mapu budov, aby funkce fungovala i nad `ReadonlyWorldView`,
 * ze kterého čte UI.
 */
export function totalPopulation(buildings: ReadonlyMap<number, Readonly<Building>>): number {
  let total = 0;
  for (const building of buildings.values()) {
    total += building.population;
  }
  return total;
}

export function totalJobs(buildings: ReadonlyMap<number, Readonly<Building>>): number {
  let total = 0;
  for (const building of buildings.values()) {
    total += building.jobs;
  }
  return total;
}

/**
 * Jeden herní den. `tick` se zvyšuje jako první, takže systémy vidí číslo tiku,
 * který právě probíhá, a po N voláních platí `world.tick === N`.
 */
export function tickWorld(world: WorldState, systems: readonly System[]): void {
  world.tick += 1;
  for (const system of systems) {
    if (shouldRun(world.tick, system.interval, system.offset)) {
      system.run(world);
    }
  }
}
