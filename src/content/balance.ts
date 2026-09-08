import { MAX_HEIGHT } from '@/sim/heights';
import type { ValidationIssue } from './schema';

/**
 * Balanc fáze 2 (§10 zadání). **Žádná z těchhle konstant nesmí být v kódu** —
 * načítá se stejnou cestou jako definice budov, takže je mod smí přepsat.
 *
 * Chybějící sekce je chyba, ne tichý default: kdyby se dala vynechat, hráč by
 * z rozbitého modu dostal město, které se chová jinak, než balanc popisuje.
 */
/** Jeden typ silnice. `id` slouží k lokalizačnímu klíči, ne k logice. */
export interface RoadTypeBalance {
  id: string;
  capacity: number;
  cost: number;
  upkeep: number;
}

/** Veličina, podle které se katastrofa škáluje nebo podmiňuje (§3 fáze 4). */
export type DisasterMetric =
  | 'none'
  | 'buildings'
  | 'population'
  | 'roadTiles'
  | 'coastTiles'
  | 'forestTiles'
  | 'flatShare'
  | 'industrialBuildings'
  | 'residentialBuildings'
  | 'heavyIndustry'
  | 'powerPlants'
  | 'riskySlopes';

const DISASTER_METRICS: readonly DisasterMetric[] = [
  'none',
  'buildings',
  'population',
  'roadTiles',
  'coastTiles',
  'forestTiles',
  'flatShare',
  'industrialBuildings',
  'residentialBuildings',
  'heavyIndustry',
  'powerPlants',
  'riskySlopes',
];

/**
 * Měřítkový faktor: `clamp(offset + tvar(metrika / dělitel), min, max)`.
 *
 * Jeden zápis pro všechny — katalog jim říká `sizeFactor`, `coastFactor`,
 * `forestFactor` nebo `slopeFactor`, ale počítají se stejně. Kdyby měl každý
 * vlastní tvar, byly by v kódu čtyři skoro stejné funkce.
 */
export interface ScaleBalance {
  metric: DisasterMetric;
  /** `sqrt` tlumí růst u velkých měst, `linear` ne. */
  curve: 'sqrt' | 'linear';
  divisor: number;
  offset: number;
  min: number;
  max: number;
}

/** Jeden sčítanec faktoru typu. */
export interface RiskTermBalance {
  /** Jméno ukazatele; `uncovered:fire` a spol. nesou třídu za dvojtečkou. */
  indicator: string;
  weight: number;
  /**
   * Když je zadané, počítá se **o kolik ukazatel chybí** pod tuhle hodnotu.
   * Používá to rezerva elektrické sítě: nad prahem nepřispívá nic, pod ním
   * roste strmě. Bez toho by ta strmost musela být v kódu.
   */
  below?: number;
}

/**
 * Jak katastrofa hoří (§4 fáze 4).
 *
 * Mají to jen dvě: požár a lesní požár. Sdílejí vrstvu i mechaniku, liší se
 * čísly — lesní hoří prudčeji, šíří se ochotněji a vzniká z jediného ohniska.
 */
export interface BurnBalance {
  /** Lesní varianta: hoří jinak a po vyhoření zbude tráva, ne trosky. */
  wildfire: boolean;
  /** Intenzita, se kterou dlaždice chytne. */
  ignitionIntensity: number;
  /** O kolik intenzita za ohňový tik povyroste. */
  intensityGrowth: number;
  /** Násobitel šance, že oheň přeskočí na souseda. */
  spreadChance: number;
  minIgnitions: number;
  maxIgnitions: number;
}

/**
 * Povodeň (§5 fáze 4).
 *
 * Tři fáze: vlna postoupí, chvíli stojí a pak opadá. Škoda se **hromadí**, ne
 * působí naráz — právě proto rychlé opadnutí opravdu zachraňuje a hasiči,
 * kteří ho zrychlují, mají do povodně co mluvit.
 */
export interface FloodBalance {
  /**
   * O kolik pater nad terén u břehu voda stoupne.
   *
   * Jednička je tu schválně: hráz o **jednu úroveň** pak vlnu zastaví úplně,
   * což zadání označuje za platné trvalé řešení. Vyšší číslo by z terraformingu
   * udělalo sázku, ne obranu.
   */
  waterRise: number;
  /**
   * Oč je sevřenější břeh pravděpodobnějším ohniskem.
   *
   * Váha dlaždice je `1 + počet vodních sousedů × bayWeight`. Rovný břeh má
   * jednoho vodního souseda, ústí zálivu tři — rozdíl je tím pádem dvojnásobek,
   * ne pár procent. Podíl vody v okolí, který se nabízel jako první, se mezi
   * zálivem a rovným břehem liší sotva o desetinu a hráč by to nikdy nepoznal.
   */
  bayWeight: number;
  /** Jak daleko od břehu vlna dosáhne, v dlaždicích. */
  reachMin: number;
  reachMax: number;
  /** Kolik tiků vlna postupuje, než se zastaví. */
  advanceTicksMin: number;
  advanceTicksMax: number;
  /** Jak dlouho voda stojí, než opadne. */
  durationMin: number;
  durationMax: number;
  /** O kolik rychleji opadá voda za každý bod `coverage[fire]`. */
  drainPerCoverage: number;
  /** Přírůstek poškození 0–255 za tik a za jedno patro hloubky. */
  damagePerDepth: number;
  pollutionPerTick: number;
  landValuePenalty: number;
  happinessPerLoss: number;
}

/** Tabulka podle druhu obsahu dlaždice. Klíče viz `ContentKind`. */
export type ContentTable = Readonly<Record<string, number>>;

/**
 * Tornádo (§6 fáze 4, katalog 3).
 *
 * Proti zásahu samotnému obrana neexistuje a je to záměr autora — tornádo
 * nemá předpověď dráhy. Bránit se dá jen tomu, co přijde po něm: hasičské
 * pokrytí tlumí druhou vlnu a **následné požáry způsobí víc škody než tornádo
 * samo**.
 */
export interface TornadoBalance {
  /** Dlaždic za tik. */
  speed: number;
  lifetimeMin: number;
  lifetimeMax: number;
  widthMin: number;
  widthMax: number;
  /** O kolik stupňů se dráha smí stočit za tik. */
  turnDegrees: number;
  igniteChance: number;
  igniteIntensity: number;
  happinessPerLoss: number;
  /** Šance, že obsah dlaždice přímý zásah přežije. */
  survival: ContentTable;
}

/**
 * Zemětřesení (katalog 4).
 *
 * `magnitude = base + span × rng()³` — třetí mocnina dává silný sklon
 * k nízkým hodnotám, takže velká rána je vzácná a hráč si na ni nemůže
 * zvyknout.
 */
export interface EarthquakeBalance {
  magnitudeBase: number;
  magnitudeSpan: number;
  /** Podíl hrany mapy, na kterém síla klesne k `falloffMin`. */
  falloffShare: number;
  falloffMin: number;
  /** Nepovedl-li se zásah, tímhle podílem se zkouší aspoň snížení úrovně. */
  downgradeShare: number;
  aftershocksMin: number;
  aftershocksMax: number;
  aftershockDelayMin: number;
  aftershockDelayMax: number;
  aftershockDecay: number;
  fireChance: number;
  floodChance: number;
  floodBand: number;
  floodDepth: number;
  floodDuration: number;
  igniteIntensity: number;
  happinessPerLoss: number;
  happinessPerDowngrade: number;
  vulnerability: ContentTable;
}

/** Společné pro výbuch a průmyslovou havárii — liší se jen čísly. */
export interface BlastKindBalance {
  radiusBase: number;
  radiusPerLevel: number;
  destroyChance: number;
  /** Násobek poloměru, do kterého to ještě zapaluje. */
  igniteReach: number;
  igniteChance: number;
  igniteIntensity: number;
  /** Nula znamená „bez kontaminace" — tím se výbuch od havárie liší. */
  pollution: number;
  happinessPerLoss: number;
}

export interface BlastBalance {
  /** Odolnost obsahu proti tlakové vlně. Sdílí ji obě varianty. */
  resistance: ContentTable;
  explosion: BlastKindBalance;
  industrialAccident: BlastKindBalance;
}

/**
 * Hromadná nehoda (katalog 5).
 *
 * Nezničí žádnou budovu; celá váha je v blokaci dlaždice a v tom, že po dobu
 * nehody hůř fungují hasiči — je to násobič ostatních katastrof.
 */
export interface PileupBalance {
  /** Trvání v pokryté čtvrti. Nepokrytá si připočte `durationSpan`. */
  durationBase: number;
  durationSpan: number;
  /** Dosah potlačených služeb a srážky spokojenosti, v dlaždicích. */
  reach: number;
  jamRadius: number;
  jamFactor: number;
  healthFactor: number;
  fireFactor: number;
  happiness: number;
  /** Podíl obyvatel, o který přijdou okolní domy. Budovy zůstanou stát. */
  populationLoss: number;
  /** Pod touhle zátěží se blokace nehlásí — ucpaná slepá ulice není zpráva. */
  reportLoad: number;
}

/** Stávka (katalog 6). Nic nezničí, jen sebere peníze a čas. */
export interface StrikeBalance {
  durationMin: number;
  durationMax: number;
  radiusMin: number;
  radiusMax: number;
  /** Úbytek za tik, když se nic nelepší. */
  drainIdle: number;
  /** Úbytek za tik, když spokojenost v oblasti roste. */
  drainRising: number;
  crime: number;
  traffic: number;
  healthFactor: number;
  happiness: number;
  happinessCity: number;
}

/** Občanské nepokoje (katalog 7). Celoměstské, ale síla je lokální. */
export interface RiotBalance {
  durationMin: number;
  durationMax: number;
  drainIdle: number;
  drainRising: number;
  /** Úbytek, když roste spokojenost **a** je pokrytá policie. */
  drainBoth: number;
  policeCalm: number;
  /** Nejnižší možná lokální síla. Nikdy nula — i klidná čtvrť něco odnese. */
  strengthBase: number;
  crime: number;
  traffic: number;
  healthFactor: number;
  educationFactor: number;
  happiness: number;
  taxLoss: number;
  igniteEvery: number;
  igniteMax: number;
  igniteIntensity: number;
  /** Kriminalita, nad kterou může stávka přerůst v nepokoje. */
  escalationCrime: number;
  escalationChance: number;
}

/** Válka gangů (katalog 9). Nejdelší v katalogu a nedá se přeplatit. */
export interface GangWarBalance {
  durationMin: number;
  durationMax: number;
  radiusMin: number;
  radiusMax: number;
  /** Strop po rozšiřování. Větší než `radiusMax`, který platí při vzniku. */
  radiusMax2: number;
  spreadEvery: number;
  /** Pokrytí policií, nad kterým se válka přestane rozšiřovat. */
  spreadStop: number;
  /** Úbytek za tik bez jakéhokoli zásahu. */
  drainBase: number;
  pressurePolice: number;
  pressureHappiness: number;
  pressureEmployment: number;
  pressureScale: number;
  crimeFloor: number;
  happiness: number;
  happinessCity: number;
  educationFactor: number;
  healthFactor: number;
  landValue: number;
  taxLoss: number;
  destroyEvery: number;
  destroyChance: number;
  happinessPerLoss: number;
}

/**
 * Blackout (katalog 12). Kaskáda, která se zastaví sama.
 *
 * Prahy jsou dva a musí být `recoveryRatio < overloadRatio`, jinak by síť
 * kmitala mezi odpojováním a připojováním donekonečna.
 */
export interface BlackoutBalance {
  cascadeEvery: number;
  /**
   * Nejdéle takhle dlouho, ať se stane cokoli.
   *
   * Bez stropu je blackout **past bez východu** a změřilo ho to na simulované
   * partii: dvě elektrárny šly dolů ve čtvrtém roce a čtyřicet let se
   * nevrátily. Zatížení se totiž počítá proti spotřebě **celého** města, i toho
   * potmě — vrácená elektrárna ho sama neunese, hned padne zpátky a klid se
   * počítá znovu od nuly. Město mezitím nemá proud, nenapájený dům neplatí daň,
   * příjem je nula a půjčka se odvozuje od příjmu (T57), takže se nedá ani
   * půjčit. Přesně o tomhle stavu píše komentář v `blackout.ts`: katastrofa,
   * ze které není cesty ven, není katastrofa, ale konec hry.
   *
   * Strop to nedělá neškodným — město s tenkou rezervou dostane další výpadek
   * hned, jak doběhne doba hájení. Jen mu nechá šanci ho přežít.
   */
  maxTicks: number;
  /** Nad tímhle zatížením padne další elektrárna. */
  overloadRatio: number;
  /** Pod tímhle se začne počítat klid. */
  recoveryRatio: number;
  calmCycles: number;
  /** Do tolika tiků si výpadku nikdo nevšimne. */
  noticeTicks: number;
  happinessPerTick: number;
  happinessMax: number;
  penaltyTicks: number;
}

/** Epidemie (katalog 13). Jediná katastrofa, kterou jde potlačit i po vzniku. */
export interface EpidemicBalance {
  durationMin: number;
  durationMax: number;
  /** Jak často se přepočítává šíření. */
  cycleTicks: number;
  /** Nakaženost v ohnisku při vypuknutí. */
  seed: number;
  waves: number;
  waveBase: number;
  spread: number;
  /** Jak moc pokrytí zdravotnictvím brzdí přenos, 0–1. */
  coverageBlock: number;
  jumpChance: number;
  jumpShare: number;
  growth: number;
  decay: number;
  decayPerCoverage: number;
  /** Pod touhle hodnotou buňka vyhasne. */
  extinction: number;
  mortality: number;
  /** Přetížení: pokrytí v nakažené buňce účinkuje jen na tolik. */
  overload: number;
  happiness: number;
  happinessCity: number;
}

/** Chemická havárie (katalog 15). Nejsilnější zdroj znečištění ve hře. */
/**
 * Sesuv půdy (katalog 14). Jediná katastrofa, která **mění mapu** — ostatní
 * ničí jen to, co na ní stojí.
 */
export interface LandslideBalance {
  /** Délka dráhy po spádnici, v dlaždicích. */
  lengthMin: number;
  lengthMax: number;
  /** Šířka dráhy napříč spádnicí. */
  widthMin: number;
  widthMax: number;
  happinessPerLoss: number;
  /** Jak dlouho po terénní úpravě se půda počítá za čerstvou. */
  recentTerraformTicks: number;
  /** O kolik se v losu místa zvedne váha dlaždice se zástavbou. */
  builtWeight: number;
  /** A o kolik dlaždice čerstvě upravené. */
  freshTerraformWeight: number;
}

export interface ChemicalSpillBalance {
  durationMin: number;
  durationMax: number;
  blastRadius: number;
  sourceDestroyChance: number;
  nearDestroyChance: number;
  pollutionRadius: number;
  pollution: number;
  waterRadius: number;
  /** Jak dlouho po úniku ještě vodárny nedodávají. */
  waterAfterTicks: number;
  populationRadius: number;
  populationLoss: number;
  landValueRadius: number;
  landValue: number;
  /** Cena půdy doznívá roky — proto se měří v tikách, ne v desítkách. */
  landValueTicks: number;
  happiness: number;
  happinessCity: number;
  happinessPerLoss: number;
  /** Od téhle úrovně výš je průmysl „těžký". */
  heavyLevel: number;
  ageTicks: number;
  ageWeight: number;
  /** Vlastní váha skládek a spaloven, aby nebyly proti továrnám neviditelné. */
  wasteWeight: number;
  neglectFactor: number;
}

/**
 * Jeden mód MHD (§7 fáze 4).
 *
 * Vlastnosti jsou **obsah, ne kód**: mod si přidá vlastní mód a hra o něm
 * nemusí vědět. Rozdíl mezi autobusem a tramvají je tady, ne v `if`.
 */
/**
 * Dluhopisy (§8 fáze 4).
 *
 * Váhy určují, **za co si město koupí důvěru**: za nabídnutý úrok, za to, jak
 * se v něm žije, a za to, že roste. Proti tomu stojí kriminalita a to, kolik
 * už dluží. Jediný nástroj ve hře, kde hráč licituje.
 */
export interface BondBalance {
  /** Kolikanásobek měsíčního příjmu smí město nabídnout dohromady. */
  incomeMultiple: number;
  /** Podíl z **celé nabídky**, který se platí za vydání (R19). */
  feeRate: number;
  /** Sazba, při které se nabídka nepřeplácí ani nepodhodnocuje. */
  referenceRate: number;
  maxRate: number;
  minMaturityTicks: number;
  maxMaturityTicks: number;
  /** Kolik se upíše i bez jediného lákadla. */
  base: number;
  rateWeight: number;
  happinessWeight: number;
  growthWeight: number;
  crimeWeight: number;
  debtWeight: number;
  /** O kolik klesne rating za nesplacenou jistinu. */
  defaultPenalty: number;
  /** Na jak dlouho se po nesplacení zavře přístup na trh. */
  blockTicks: number;
}

export interface TransitModeBalance {
  /** Kolik lidí odveze jedno vozidlo za měsíc. */
  capacity: number;
  vehicleCost: number;
  vehicleUpkeep: number;
  /**
   * Kolik kapacity silnice ukrojí kolej, 0–1.
   *
   * Nenulová jen u tramvaje, a je to jediné, co ji dělá horší volbou než
   * autobus — bez toho by nebyl důvod autobus vůbec postavit.
   */
  roadShare: number;
  /** Elektrická trakce: linka nejezdí, když zastávka nemá proud. */
  needsPower: boolean;
}

export interface DisasterBalance {
  baseMonthlyChance: number;
  maxMonthlyChance: number;
  /** Období hájení v tikách (R17). */
  cooldownTicks: number;
  /** Přírodní katastrofy mají faktor typu vždycky 1 — správa města na ně nemá vliv. */
  natural: boolean;
  concurrent: { metric: DisasterMetric; divisor: number; min: number; max: number };
  scale?: ScaleBalance;
  /** Rok má 360 tiků. `from > to` se čte jako okno přes Silvestra. */
  season?: { from: number; to: number; inFactor: number; outFactor: number };
  /** Bez čeho katastrofa nevznikne — pobřeží u povodně, les u lesního požáru. */
  require: readonly { metric: DisasterMetric; min: number }[];
  /**
   * Kdy katastrofa **nevznikne vůbec**, i kdyby ostatní podmínky seděly.
   *
   * Doplněk k `risk`, který umí riziko jen zvyšovat. Blackout to potřebuje:
   * jeho základní šance je čtyři procenta měsíčně a rezerva sítě ji nesnižuje,
   * takže i město s dvojnásobkem výroby dostávalo výpadek každé dva roky.
   * Autor se ptal přesně tak: „pokud mám dvojnásobnou rezervu, jak je možný
   * ten blackout?" Síť s rezervou prostě nepadá.
   *
   * **Pozor na význam čísla.** `powerReserve` je podíl **nevyužité kapacity**,
   * ne násobek spotřeby: 0,35 znamená „kapacita je aspoň jedenapůlnásobek
   * toho, co jede". První odhad 0,5 (dvojnásobek) chytal podle měření na
   * 18 594 partiích jen 37 % odehraných let, takže blackout padal dál jednou
   * za čtyři roky; 0,35 pokrývá 85 % let.
   */
  unless?: readonly { indicator: string; above: number }[];
  risk: readonly RiskTermBalance[];
  burn?: BurnBalance;
}

/**
 * Model ohně — společný požáru i lesnímu požáru (§4 fáze 4).
 *
 * Hořlavost a palivo se berou podle **obsahu dlaždice**, ne podle konkrétní
 * budovy (P5). `byClass` je výjimka pro třídy služeb, které se z kategorie
 * odvodit nedají: park hoří desetkrát hůř než hasičárna, i když obojí je
 * služba, a právě proto je z parku použitelná protipožární bariéra.
 */
export interface FireBalance {
  /** Ohňový tik běží nezávisle na plánovači katastrof. */
  tickInterval: number;
  /** Kolik intenzity ubyde samo, i bez hasičů. */
  suppressBase: number;
  /** Kolik navíc ubyde za každý bod `coverage[fire]`. */
  suppressPerCoverage: number;
  /** Znečištění z každé hořící dlaždice za ohňový tik. */
  pollutionPerTick: number;
  /** Srážka spokojenosti za každou zničenou budovu. */
  happinessPerLoss: number;
  happinessPenaltyTicks: number;
  /** Klíče: `forest`, `abandoned`, `industrial`, `residential`, `commercial`, `service`, `rubble`. */
  flammability: Readonly<Record<string, number>>;
  fuel: Readonly<Record<string, number>>;
  byClass: Readonly<Record<string, { flammability: number; fuel: number }>>;
}

/**
 * Slábnoucí náskok poptávky po jedné zóně.
 *
 * Prvních `holdYears` let drží na `start`, pak ubývá po `perYear` za rok,
 * dokud nedosedne na `floor`. Náskok je **startér, ne trvalý palec na váze**:
 * rozjede město z nuly obyvatel a nuly prací, ale zralé město už si má řídit
 * vlastní bilance práce, ne konstanta.
 */
export interface DemandBase {
  start: number;
  holdYears: number;
  perYear: number;
  floor: number;
}

export interface Balance {
  /**
   * Ekonomika. Původně konstanty fáze 1 v kódu — přesunuty sem, aby šel balanc
   * ladit bez zásahu do kódu.
   */
  economy: { taxableValuePerUnit: number; startingFunds: number; defaultTaxRate: number };

  demand: {
    workerRatio: number;
    /**
     * Náskok obytné poptávky, který **s časem slábne**.
     *
     * Konstantní dvacítka znamenala, že hra celou partii tlačí stavět bydlení:
     * obytná je `základ + (práce − pracující)`, takže v rovnováze vyšla přesně
     * na základ, ať město dělalo cokoli.
     */
    baseResidential: DemandBase;
    /**
     * Totéž pro průmysl — a je to **oprava měřením doloženého vychýlení**.
     *
     * Průmyslová poptávka byla `pracující − práce`, tedy bez základu, a s tím
     * byla po roce 20 kladná jen v pětině vzorků: hra o průmysl skoro nikdy
     * nestála. Pokus spravit to obsahem (poloviční počet prací na dlaždici,
     * T109) sice zvedl podíl kladné poptávky na 23 %, ale sebral městu práci
     * — přežití spadlo z 69 % na 60 % a města byla v šedesátém roce čtyřikrát
     * menší. Vráceno; místo toho dostal průmysl **vlastní náskok**, který
     * poptávku zvedne přímo, aniž by z ekonomiky ubyl jediný úvazek.
     *
     * Menší než obytný, protože průmysl je odvozený: práce chce lidi, a ti se
     * musí nejdřív někam nastěhovat.
     */
    baseIndustrial: DemandBase;
    commercePerCapita: number;
    limit: number;
  };

  /**
   * Generátor mapy (§2 zadání fáze 3). Prahy jsou na normalizovaném výškovém
   * poli 0–1, takže znamenají totéž bez ohledu na počet oktáv.
   */
  map: {
    /** Podíl mapy pod vodou, 0-1. Bere se jako kvantil vysky, ne pevna hladina. */
    seaLevel: number;
    /** Kvantil vysky, nad kterym je skala. */
    rockLevel: number;
    /** Šířka pískového pásu v dlaždicích. */
    beachWidth: number;
    /** Podíl trávy, který zaroste lesem, 0–1. */
    forestDensity: number;
    /** O kolik nad hladinou ještě vzniká mokřad. */
    marshThreshold: number;
    octaves: number;
    roughness: number;
    /**
     * Měřítko výškového šumu v dlaždicích. Menší číslo = drobnější členitost,
     * větší = rozlehlé pevniny s mírnými přechody.
     */
    heightScale: number;
    /** Totéž pro les. Menší číslo dělá roztroušené háje, větší souvislé bory. */
    forestScale: number;
    /**
     * Pod tolik dlaždic je ostrůvek k ničemu a zaplaví se. Vzniká, když koryto
     * řeky ukrojí kus břehu — hráč by na něj neměl jak.
     */
    scrapIslandTiles: number;
    /** Jaky podil znecisteni pohlti buňka plna lesa, 0-1. */
    forestAbsorption: number;
    /** Cena za vykaceni jedne dlazdice lesa. */
    clearForestCost: number;
    /**
     * Cena za vysazení lesa na jedné dlaždici.
     *
     * Levnější než vykácení schválně: les je jediná obrana proti znečištění,
     * která nemá údržbu, a má se vyplatit zasadit ho dřív, než továrna zakouří
     * čtvrť.
     */
    plantTreesCost: number;
    /**
     * Nad kolik dlaždic se vyznačená zóna už automaticky nesrovnává. Kdo táhne
     * zónu přes celé údolí, nechce náhorní plošinu.
     */
    maxLevelledZoneTiles: number;
    /**
     * Nejmensi podil souse, ktery musi zustat v jednom kuse. Kdyz se to
     * nepovede, generator ubere vodu a zkusi to znovu (R7).
     */
    minLandShare: number;
    /** Nejvyšší patro, které generátor postaví. Strop modelu je 15 (R8). */
    maxHeight: number;
    /**
     * Zakřivení převodu šumu na patra. Nad jedničkou zůstává většina souše
     * nízko a kopce jsou vzácné; jednička dá rovnoměrné rozložení.
     */
    heightCurve: number;
    /**
     * Kolik řek generátor prokope. **Ve vanille zatím nula**: řeka rozdělí
     * souš na dva břehy a most přijde až v T33, takže dokud tam není, byla by
     * to jen nepřístupná polovina mapy.
     */
    rivers: number;
    /** Odkud řeka vyráží — nejmenší patro pramene. */
    riverSourceHeight: number;
    /**
     * Cena terraformingu **za jeden dotčený roh**, včetně kaskády. Zvednutí
     * u strmého svahu rozhýbe desítky rohů a hráč to má vidět na účtu (§7).
     */
    terraformCost: number;
    /** Odtěžení skály a zavezení mokřadu — od 3b jsou obojí řešitelné (§7). */
    clearRockCost: number;
    fillMarshCost: number;
  };

  /**
   * Doprava (§4 a §5 zadání fáze 3). `roadTypes` je pořadí typů silnic;
   * index + 1 je hodnota ve vrstvě `road`, takže přidat typ je změna JSONu.
   */
  traffic: {
    roadTypes: RoadTypeBalance[];
    /** Kolik náhodných cest se z budovy zkusí za jeden běh. */
    attempts: number;
    /** Nejvíc kroků jedné cesty, než to chodec vzdá. */
    maxSteps: number;
    /** Kolik budov se za běh zpracuje; zbytek přijde na řadu příště. */
    maxBuildingsPerRun: number;
    /** Vyhlazení dosažitelnosti práce, 0–1. */
    smoothing: number;
    /**
     * Jakou část dopravy sebere plné pokrytí MHD (§6 fáze 3). Jednička by
     * znamenala „obsloužená čtvrť po silnicích nejezdí vůbec", což nechceme —
     * MHD zátěž snižuje, neruší.
     */
    transitReduction: number;
    /** Cena jedné dlaždice mostu. Most je dražší než vozovka na souši (§7). */
    bridgeCost: number;
  };

  diffusion: { spread: number; decay: number; passes: number };

  landValue: {
    base: number;
    smoothing: number;
    waterBonus: number;
    /**
     * Váhy vstupů. `pollution` a `crime` jsou povinné, zbytek jsou třídy
     * služeb — a ty jsou obsah, takže seznam je otevřený.
     */
    weights: Readonly<Record<string, number>>;
  };

  crime: {
    smoothing: number;
    population: number;
    unemployment: number;
    abandoned: number;
    police: number;
  };

  waste: { perCitizen: number; toPollution: number };

  /**
   * Kanalizace (§8 fáze 3, R9). Stejný tvar jako odpady schválně: je to táž
   * mechanika — město něco vyrobí, kapacita to spolkne a zbytek se propíše
   * do znečištění.
   */
  sewage: { perCitizen: number; toPollution: number };

  /**
   * Spokojenost (§9 fáze 3). Váhy tříd služeb jsou otevřený seznam ze
   * stejného důvodu jako u ceny půdy — třídy jsou obsah, ne kód.
   */
  happiness: {
    /** Odkud se začíná, než se přičte a odečte všechno ostatní. */
    base: number;
    smoothing: number;
    landValue: number;
    pollution: number;
    crime: number;
    congestion: number;
    tax: number;
    unemployment: number;
    /**
     * Nejnižší násobitel obytné poptávky při nulové spokojenosti. **Není to
     * nula schválně**: nespokojené město má růst pomaleji, ne stát.
     */
    minDemandFactor: number;
    weights: Readonly<Record<string, number>>;
  };

  /** Vodovod (§8 fáze 3). */
  water: {
    /** Dosah sítě v dlaždicích potrubí, když ho definice neurčí sama. */
    defaultRange: number;
    /** Cena jedné dlaždice potrubí. */
    pipeCost: number;
    /**
     * O kolik obyvatel přijde budova bez vody za jedno vyhodnocení, a po kolika
     * vyhodnoceních se prázdná budova vzdá a zůstane po ní ruina.
     */
    decayStep: number;
    abandonAfter: number;
    /**
     * Kolik vody spotřebuje jeden obyvatel a jedno pracovní místo.
     *
     * Do T107 se `water.production` používalo **jen jako vypínač**: stačila
     * jedna vodárna a pár čerpacích stanic a voda byla všude, takže větší
     * vodárna neměla důvod existovat. Autor to nahlásil přesně tak. Teď je
     * výroba strop: co se za něj nevejde, zůstane na konci sítě suché.
     */
    perCitizen: number;
    perWorker: number;
  };

  health: {
    coverageThreshold: number;
    declineStep: number;
    recoveryStep: number;
    unservedRatio: number;
  };

  /** Čte se od T16 (úrovně budov). */
  levels: {
    thresholds: number[];
    hysteresis: number;
    cooldown: number;
    /**
     * Kolik vyhodnocení po sobě musí být budova pod prahem, než klesne.
     *
     * Je to **lhůta z důvěry**, ne potvrzení měření: budova, které spadla cena
     * půdy, drží ještě nějakou dobu v očekávání, že to hráč spraví — postaví
     * park, dotáhne služby, uklidí trosky. Jedno vyhodnocení je 20 tiků, rok
     * má 360, takže devět vyhodnocení je zhruba půl roku.
     */
    downgradeConfirm: number;
    /**
     * O kolik je lhůta delší u velkých budov.
     *
     * Rozhodnutí autora: „malý domek zchátrá pětkrát rychleji než největší
     * budova". Velký dům se staví dlouho, stojí majlant a jeho zánik je pro
     * čtvrť pohroma — má mít odpovídající setrvačnost. Násobek se počítá
     * z **plochy půdorysu**: `1 + (dlaždice − 1) × perTile`, shora omezený.
     * U vanilla obsahu jde plocha od 1 (1 × 1) do 9 (3 × 3), takže s `perTile`
     * 0,5 vyjde přesně pětinásobek.
     */
    sizePatience: { perTile: number; max: number };
    decayAge: number;
    decayCoverageThreshold: number;
    /**
     * O kolik klesne efektivní cena půdy staré budovy v nedostatečně obsloužené
     * buňce. Doplněk zadání — to chátrání věkem popisuje, ale výši neurčuje.
     */
    decayPenalty: number;
    /**
     * O kolik se sníží práh povýšení při **plné** poptávce; slabší poptávka
     * sníží úměrně méně. Města se zahušťují, když se lidé nemají kam nastěhovat.
     *
     * Doplněk zadání (rozhodnutí autora): §8 poptávku bere jen jako vypínač,
     * takže město s poptávkou 100 povyšovalo stejně jako město s poptávkou 1.
     *
     * Posouvá **oba** prahy, jinak by budovy v pásmu mezi nimi kmitaly.
     */
    demandRelief: number;
  };

  /** Čte se od T18 (přepis růstu). */
  /**
   * Katastrofy (§3 fáze 4). Všech patnáct je **data**, ne kód (P5) — mechanika
   * každé z nich je vlastní, ale kdy a jak často udeří, se ladí odsud.
   */
  disasters: {
    /** Strop faktoru typu (R16). Společný všem, jinak by nerozpojoval smyčku. */
    maxRiskMultiplier: number;
    indicators: { uncoveredBelow: number; denseLevel: number; ageTicks: number };
    /**
     * Od téhle úrovně výš je zástavba pro účely škod „vysoká" — panelák snese
     * tornádo i otřes líp než chalupa. Sdílí ji tornádo, zemětřesení i výbuchy,
     * aby se nelišily v tom, jestli se počítá od tří nebo od čtyř.
     *
     * Není to `indicators.denseLevel`: ten říká, odkud je čtvrť hustá pro
     * výpočet rizika, tohle říká, odkud je dům pevný. Můžou se lišit.
     */
    damage: { highLevel: number };
    /**
     * Trosky (R15). Chovají se jako opuštěné budovy z fáze 2 — sráží cenu půdy
     * a živí kriminalitu — a stojí peníze, než je hráč uklidí.
     */
    rubble: { clearCost: number; crimeWeight: number; landValuePenalty: number };
    fire: FireBalance;
    flood: FloodBalance;
    tornado: TornadoBalance;
    earthquake: EarthquakeBalance;
    blast: BlastBalance;
    pileup: PileupBalance;
    strike: StrikeBalance;
    riot: RiotBalance;
    gangWar: GangWarBalance;
    blackout: BlackoutBalance;
    epidemic: EpidemicBalance;
    chemicalSpill: ChemicalSpillBalance;
    landslide: LandslideBalance;
    types: Readonly<Record<string, DisasterBalance>>;
  };

  /**
   * Půjčky a rating (§8 fáze 4).
   *
   * Strop se odvozuje od **příjmu, ne od kasy**: půjčka má být přemostěním,
   * ne způsobem, jak si koupit město, které se neuživí.
   */
  finance: {
    /** Kolikanásobek měsíčního příjmu si smí město půjčit dohromady. */
    loanIncomeMultiple: number;
    maxLoans: number;
    minTermMonths: number;
    maxTermMonths: number;
    /** Roční úrok v procentech při čistém ratingu. */
    baseRate: number;
    /** O kolik procent výš si půjčí město s ratingem na nule. */
    ratePenalty: number;
    /** O kolik klesne rating za jednu nesplacenou splátku. */
    missedPenalty: number;
    /** O kolik se rating měsíčně léčí, když se splácí. */
    ratingRecovery: number;
    bonds: BondBalance;
  };

  transit: {
    minStops: number;
    maxStops: number;
    /**
     * Jízdné, při kterém přestane jezdit úplně každý.
     *
     * Ochota platit klesá lineárně do nuly, příjem je `přepraveno × jízdné` —
     * součin je parabola s vrcholem v **polovině limitu**. Optimum se dá najít
     * a to je smysl: jízdné je rozhodnutí, ne posuvník s jedním správným koncem.
     */
    fareLimit: number;
    modes: Readonly<Record<string, TransitModeBalance>>;
  };

  growth: {
    exponent: number;
    demandPerAttempt: number;
    maxAttempts: number;
    neutralTaxRate: number;
    taxRange: number;
    /**
     * Násobitel skóre podle vzdálenosti k nejbližší silnici; index = vzdálenost
     * v dlaždicích. Délka pole určuje, jak daleko od vozovky se ještě staví —
     * za posledním prvkem parcela z losu vypadne úplně (§9).
     */
    roadFactors: number[];
    /**
     * Nejnižší násobitel skóre při nulové dosažitelnosti práce (R6). **Není to
     * nula schválně**: tvrdá brána by hru zamkla, protože na začátku nejsou
     * žádná pracovní místa, takže by nic nevyrostlo a místa by nikdy nevznikla.
     */
    minAccessFactor: number;
    /**
     * Násobitel váhy parcely na svahu (rozhodnutí autora, T41).
     *
     * Dům ze zóny na svahu stojí dráž, takže se tam staví méně ochotně —
     * není to zákaz. Do T41 zákaz byl a na generované mapě tím byla necelá
     * polovina souše nezastavitelná.
     */
    slopeFactor: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function section(
  issues: ValidationIssue[],
  root: Record<string, unknown>,
  name: string,
): Record<string, unknown> | null {
  const value = asRecord(root[name]);
  if (!value) issues.push({ field: name, message: 'chybí, nebo není objekt' });
  return value;
}

/** Balanc pracuje s desetinnými čísly, takže vlastní kontrola místo `requireInt`. */
function num(
  issues: ValidationIssue[],
  container: Record<string, unknown> | null,
  key: string,
  field: string,
  min: number,
  max: number,
): number {
  if (!container) return 0;
  const value = container[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push({ field, message: `musí být číslo v rozsahu ${min}–${max}` });
    return 0;
  }
  return value;
}

export function validateBalance(raw: unknown): {
  balance: Balance | null;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const root = asRecord(raw);
  if (!root) {
    return { balance: null, issues: [{ field: '', message: 'balance musí být objekt' }] };
  }

  const economy = section(issues, root, 'economy');
  const demand = section(issues, root, 'demand');
  const map = section(issues, root, 'map');
  const traffic = section(issues, root, 'traffic');
  const diffusion = section(issues, root, 'diffusion');
  const landValue = section(issues, root, 'landValue');
  const crime = section(issues, root, 'crime');
  const waste = section(issues, root, 'waste');
  const sewage = section(issues, root, 'sewage');
  const happiness = section(issues, root, 'happiness');
  const water = section(issues, root, 'water');
  const health = section(issues, root, 'health');
  const levels = section(issues, root, 'levels');
  const growth = section(issues, root, 'growth');

  const weights: Record<string, number> = {};
  const rawWeights = landValue ? asRecord(landValue['weights']) : null;
  if (!rawWeights) {
    issues.push({ field: 'landValue.weights', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawWeights).sort()) {
      // Rozsah je široký schválně: váhy pokrytí násobí vstup 0–255, kdežto
      // váhy terénu podíl 0–1, takže musí být řádově větší.
      weights[key] = num(issues, rawWeights, key, `landValue.weights.${key}`, -100, 100);
    }
    for (const required of ['pollution', 'crime']) {
      if (weights[required] === undefined) {
        issues.push({ field: `landValue.weights.${required}`, message: 'chybí' });
      }
    }
  }

  const happinessWeights: Record<string, number> = {};
  const rawHappinessWeights = happiness ? asRecord(happiness['weights']) : null;
  if (!rawHappinessWeights) {
    issues.push({ field: 'happiness.weights', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawHappinessWeights).sort()) {
      happinessWeights[key] = num(
        issues,
        rawHappinessWeights,
        key,
        `happiness.weights.${key}`,
        -10,
        10,
      );
    }
  }

  const thresholds: number[] = [];
  const rawThresholds = levels?.['thresholds'];
  if (!Array.isArray(rawThresholds) || rawThresholds.length === 0) {
    issues.push({ field: 'levels.thresholds', message: 'musí být neprázdné pole' });
  } else {
    rawThresholds.forEach((value, i) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
        issues.push({ field: `levels.thresholds[${i}]`, message: 'musí být celé číslo 0–255' });
      } else {
        thresholds.push(value);
      }
    });
  }

  const roadFactors: number[] = [];
  const rawRoadFactors = growth?.['roadFactors'];
  if (!Array.isArray(rawRoadFactors) || rawRoadFactors.length < 2) {
    issues.push({
      field: 'growth.roadFactors',
      message: 'musí být pole aspoň o dvou prvcích (index = vzdálenost k silnici)',
    });
  } else {
    rawRoadFactors.forEach((value, i) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        issues.push({ field: `growth.roadFactors[${i}]`, message: 'musí být číslo v rozsahu 0–1' });
      } else {
        roadFactors.push(value);
      }
    });
  }

  const disasters = section(issues, root, 'disasters');
  const disasterTypes = validateDisasters(issues, disasters);

  const roadTypes: RoadTypeBalance[] = [];
  const rawRoadTypes = traffic?.['roadTypes'];
  if (!Array.isArray(rawRoadTypes) || rawRoadTypes.length === 0) {
    issues.push({ field: 'traffic.roadTypes', message: 'musí být neprázdné pole typů silnic' });
  } else {
    rawRoadTypes.forEach((entry, i) => {
      const where = `traffic.roadTypes[${i}]`;
      const record = asRecord(entry);
      if (!record) {
        issues.push({ field: where, message: 'musí být objekt' });
        return;
      }
      const id = record['id'];
      if (typeof id !== 'string' || id.length === 0) {
        issues.push({ field: `${where}.id`, message: 'musí být neprázdný řetězec' });
        return;
      }
      roadTypes.push({
        id,
        capacity: num(issues, record, 'capacity', `${where}.capacity`, 1, 10000),
        cost: num(issues, record, 'cost', `${where}.cost`, 0, 100000),
        upkeep: num(issues, record, 'upkeep', `${where}.upkeep`, 0, 100000),
      });
    });
  }

  const balance: Balance = {
    disasters: {
      maxRiskMultiplier: num(
        issues,
        disasters,
        'maxRiskMultiplier',
        'disasters.maxRiskMultiplier',
        1,
        100,
      ),
      indicators: {
        uncoveredBelow: num(
          issues,
          disasters ? asRecord(disasters['indicators']) : null,
          'uncoveredBelow',
          'disasters.indicators.uncoveredBelow',
          0,
          255,
        ),
        denseLevel: num(
          issues,
          disasters ? asRecord(disasters['indicators']) : null,
          'denseLevel',
          'disasters.indicators.denseLevel',
          1,
          5,
        ),
        ageTicks: num(
          issues,
          disasters ? asRecord(disasters['indicators']) : null,
          'ageTicks',
          'disasters.indicators.ageTicks',
          0,
          1000000,
        ),
      },
      damage: {
        highLevel: num(
          issues,
          disasters ? asRecord(disasters['damage']) : null,
          'highLevel',
          'disasters.damage.highLevel',
          1,
          5,
        ),
      },
      rubble: {
        clearCost: num(
          issues,
          disasters ? asRecord(disasters['rubble']) : null,
          'clearCost',
          'disasters.rubble.clearCost',
          0,
          100000,
        ),
        crimeWeight: num(
          issues,
          disasters ? asRecord(disasters['rubble']) : null,
          'crimeWeight',
          'disasters.rubble.crimeWeight',
          0,
          100,
        ),
        landValuePenalty: num(
          issues,
          disasters ? asRecord(disasters['rubble']) : null,
          'landValuePenalty',
          'disasters.rubble.landValuePenalty',
          0,
          255,
        ),
      },
      fire: validateFire(issues, disasters),
      flood: validateFlood(issues, disasters),
      tornado: validateTornado(issues, disasters),
      earthquake: validateEarthquake(issues, disasters),
      blast: validateBlast(issues, disasters),
      pileup: validatePileup(issues, disasters),
      strike: validateStrike(issues, disasters),
      riot: validateRiot(issues, disasters),
      gangWar: validateGangWar(issues, disasters),
      blackout: validateBlackout(issues, disasters),
      epidemic: validateEpidemic(issues, disasters),
      chemicalSpill: validateChemicalSpill(issues, disasters),
      landslide: validateLandslide(issues, disasters),
      types: disasterTypes,
    },
    economy: {
      taxableValuePerUnit: num(
        issues,
        economy,
        'taxableValuePerUnit',
        'economy.taxableValuePerUnit',
        0,
        10000,
      ),
      startingFunds: num(issues, economy, 'startingFunds', 'economy.startingFunds', 0, 100000000),
      defaultTaxRate: num(issues, economy, 'defaultTaxRate', 'economy.defaultTaxRate', 0, 100),
    },
    demand: {
      workerRatio: num(issues, demand, 'workerRatio', 'demand.workerRatio', 0, 1),
      baseResidential: validateDemandBase(
        issues,
        asRecord(demand?.['baseResidential']),
        'demand.baseResidential',
      ),
      baseIndustrial: validateDemandBase(
        issues,
        asRecord(demand?.['baseIndustrial']),
        'demand.baseIndustrial',
      ),
      commercePerCapita: num(
        issues,
        demand,
        'commercePerCapita',
        'demand.commercePerCapita',
        0,
        100,
      ),
      limit: num(issues, demand, 'limit', 'demand.limit', 1, 1000),
    },
    map: {
      seaLevel: num(issues, map, 'seaLevel', 'map.seaLevel', 0, 1),
      rockLevel: num(issues, map, 'rockLevel', 'map.rockLevel', 0, 1),
      beachWidth: num(issues, map, 'beachWidth', 'map.beachWidth', 0, 32),
      forestDensity: num(issues, map, 'forestDensity', 'map.forestDensity', 0, 1),
      marshThreshold: num(issues, map, 'marshThreshold', 'map.marshThreshold', 0, 1),
      octaves: num(issues, map, 'octaves', 'map.octaves', 1, 8),
      roughness: num(issues, map, 'roughness', 'map.roughness', 0, 1),
      heightScale: num(issues, map, 'heightScale', 'map.heightScale', 1, 256),
      forestScale: num(issues, map, 'forestScale', 'map.forestScale', 1, 256),
      scrapIslandTiles: num(issues, map, 'scrapIslandTiles', 'map.scrapIslandTiles', 0, 4096),
      forestAbsorption: num(issues, map, 'forestAbsorption', 'map.forestAbsorption', 0, 1),
      clearForestCost: num(issues, map, 'clearForestCost', 'map.clearForestCost', 0, 100000),
      plantTreesCost: num(issues, map, 'plantTreesCost', 'map.plantTreesCost', 0, 100000),
      maxLevelledZoneTiles: num(
        issues,
        map,
        'maxLevelledZoneTiles',
        'map.maxLevelledZoneTiles',
        0,
        100000,
      ),
      minLandShare: num(issues, map, 'minLandShare', 'map.minLandShare', 0, 1),
      maxHeight: num(issues, map, 'maxHeight', 'map.maxHeight', 0, MAX_HEIGHT),
      heightCurve: num(issues, map, 'heightCurve', 'map.heightCurve', 0.1, 8),
      rivers: num(issues, map, 'rivers', 'map.rivers', 0, 16),
      riverSourceHeight: num(issues, map, 'riverSourceHeight', 'map.riverSourceHeight', 0, MAX_HEIGHT),
      terraformCost: num(issues, map, 'terraformCost', 'map.terraformCost', 0, 100000),
      clearRockCost: num(issues, map, 'clearRockCost', 'map.clearRockCost', 0, 100000),
      fillMarshCost: num(issues, map, 'fillMarshCost', 'map.fillMarshCost', 0, 100000),
    },
    traffic: {
      roadTypes,
      attempts: num(issues, traffic, 'attempts', 'traffic.attempts', 1, 100),
      maxSteps: num(issues, traffic, 'maxSteps', 'traffic.maxSteps', 1, 1000),
      maxBuildingsPerRun: num(
        issues,
        traffic,
        'maxBuildingsPerRun',
        'traffic.maxBuildingsPerRun',
        1,
        100000,
      ),
      smoothing: num(issues, traffic, 'smoothing', 'traffic.smoothing', 0, 1),
      transitReduction: num(issues, traffic, 'transitReduction', 'traffic.transitReduction', 0, 1),
      bridgeCost: num(issues, traffic, 'bridgeCost', 'traffic.bridgeCost', 0, 100000),
    },
    diffusion: {
      spread: num(issues, diffusion, 'spread', 'diffusion.spread', 0, 1),
      decay: num(issues, diffusion, 'decay', 'diffusion.decay', 0, 1),
      passes: num(issues, diffusion, 'passes', 'diffusion.passes', 1, 8),
    },
    landValue: {
      base: num(issues, landValue, 'base', 'landValue.base', 0, 255),
      smoothing: num(issues, landValue, 'smoothing', 'landValue.smoothing', 0, 1),
      waterBonus: num(issues, landValue, 'waterBonus', 'landValue.waterBonus', 0, 255),
      weights,
    },
    crime: {
      smoothing: num(issues, crime, 'smoothing', 'crime.smoothing', 0, 1),
      population: num(issues, crime, 'population', 'crime.population', 0, 10),
      unemployment: num(issues, crime, 'unemployment', 'crime.unemployment', 0, 255),
      abandoned: num(issues, crime, 'abandoned', 'crime.abandoned', 0, 255),
      police: num(issues, crime, 'police', 'crime.police', 0, 10),
    },
    water: {
      defaultRange: num(issues, water, 'defaultRange', 'water.defaultRange', 1, 1000),
      pipeCost: num(issues, water, 'pipeCost', 'water.pipeCost', 0, 100000),
      decayStep: num(issues, water, 'decayStep', 'water.decayStep', 0, 1000),
      abandonAfter: num(issues, water, 'abandonAfter', 'water.abandonAfter', 1, 1000),
      perCitizen: num(issues, water, 'perCitizen', 'water.perCitizen', 0, 100),
      perWorker: num(issues, water, 'perWorker', 'water.perWorker', 0, 100),
    },
    happiness: {
      base: num(issues, happiness, 'base', 'happiness.base', 0, 255),
      smoothing: num(issues, happiness, 'smoothing', 'happiness.smoothing', 0, 1),
      landValue: num(issues, happiness, 'landValue', 'happiness.landValue', 0, 100),
      pollution: num(issues, happiness, 'pollution', 'happiness.pollution', 0, 100),
      crime: num(issues, happiness, 'crime', 'happiness.crime', 0, 100),
      congestion: num(issues, happiness, 'congestion', 'happiness.congestion', 0, 1000),
      tax: num(issues, happiness, 'tax', 'happiness.tax', 0, 100),
      unemployment: num(issues, happiness, 'unemployment', 'happiness.unemployment', 0, 1000),
      minDemandFactor: num(issues, happiness, 'minDemandFactor', 'happiness.minDemandFactor', 0, 1),
      weights: happinessWeights,
    },
    sewage: {
      perCitizen: num(issues, sewage, 'perCitizen', 'sewage.perCitizen', 0, 100),
      toPollution: num(issues, sewage, 'toPollution', 'sewage.toPollution', 0, 100),
    },
    waste: {
      perCitizen: num(issues, waste, 'perCitizen', 'waste.perCitizen', 0, 100),
      toPollution: num(issues, waste, 'toPollution', 'waste.toPollution', 0, 100),
    },
    health: {
      coverageThreshold: num(issues, health, 'coverageThreshold', 'health.coverageThreshold', 0, 255),
      declineStep: num(issues, health, 'declineStep', 'health.declineStep', 0, 255),
      recoveryStep: num(issues, health, 'recoveryStep', 'health.recoveryStep', 0, 255),
      unservedRatio: num(issues, health, 'unservedRatio', 'health.unservedRatio', 0, 1),
    },
    levels: {
      thresholds,
      hysteresis: num(issues, levels, 'hysteresis', 'levels.hysteresis', 0, 255),
      cooldown: num(issues, levels, 'cooldown', 'levels.cooldown', 0, 100000),
      downgradeConfirm: num(issues, levels, 'downgradeConfirm', 'levels.downgradeConfirm', 1, 100),
      sizePatience: {
        perTile: num(
          issues,
          asRecord(levels?.['sizePatience']),
          'perTile',
          'levels.sizePatience.perTile',
          0,
          10,
        ),
        max: num(
          issues,
          asRecord(levels?.['sizePatience']),
          'max',
          'levels.sizePatience.max',
          1,
          100,
        ),
      },
      decayAge: num(issues, levels, 'decayAge', 'levels.decayAge', 0, 1000000),
      decayCoverageThreshold: num(
        issues,
        levels,
        'decayCoverageThreshold',
        'levels.decayCoverageThreshold',
        0,
        255,
      ),
      decayPenalty: num(issues, levels, 'decayPenalty', 'levels.decayPenalty', 0, 255),
      demandRelief: num(issues, levels, 'demandRelief', 'levels.demandRelief', 0, 255),
    },
    finance: validateFinance(issues, root),
    transit: validateTransit(issues, root),

    growth: {
      exponent: num(issues, growth, 'exponent', 'growth.exponent', 0, 10),
      demandPerAttempt: num(issues, growth, 'demandPerAttempt', 'growth.demandPerAttempt', 1, 1000),
      maxAttempts: num(issues, growth, 'maxAttempts', 'growth.maxAttempts', 1, 1000),
      neutralTaxRate: num(issues, growth, 'neutralTaxRate', 'growth.neutralTaxRate', 0, 100),
      taxRange: num(issues, growth, 'taxRange', 'growth.taxRange', 1, 100),
      roadFactors,
      minAccessFactor: num(issues, growth, 'minAccessFactor', 'growth.minAccessFactor', 0, 1),
      slopeFactor: num(issues, growth, 'slopeFactor', 'growth.slopeFactor', 0, 1),
    },
  };

  return { balance: issues.length > 0 ? null : balance, issues };
}

/**
 * Katastrofy z balancu.
 *
 * Kontroluje se **tvar, ne smysl**: že metrika existuje, že pravděpodobnost je
 * v rozsahu 0–1, že strop není pod základem. Jestli je 0,02 měsíčně málo nebo
 * moc, se pozná hraním, ne validací.
 *
 * Neznámá metrika je chyba, ne varování. Překlep v `buildigns` by jinak tiše
 * znamenal „škáluj podle nuly", tedy katastrofu, která nikdy nepřijde.
 */
function validateDisasters(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): Record<string, DisasterBalance> {
  const out: Record<string, DisasterBalance> = {};
  const rawTypes = disasters ? asRecord(disasters['types']) : null;
  if (!rawTypes) {
    if (disasters) issues.push({ field: 'disasters.types', message: 'chybí, nebo není objekt' });
    return out;
  }

  // Setříděné klíče, ať jsou hlášky ve stabilním pořadí.
  for (const kind of Object.keys(rawTypes).sort()) {
    const where = `disasters.types.${kind}`;
    const record = asRecord(rawTypes[kind]);
    if (!record) {
      issues.push({ field: where, message: 'musí být objekt' });
      continue;
    }

    const base = num(issues, record, 'baseMonthlyChance', `${where}.baseMonthlyChance`, 0, 1);
    const cap = num(issues, record, 'maxMonthlyChance', `${where}.maxMonthlyChance`, 0, 1);
    if (cap < base) {
      issues.push({ field: `${where}.maxMonthlyChance`, message: 'strop nesmí být pod základem' });
    }

    const natural = record['natural'];
    if (typeof natural !== 'boolean') {
      issues.push({ field: `${where}.natural`, message: 'musí být true nebo false' });
    }

    out[kind] = {
      baseMonthlyChance: base,
      maxMonthlyChance: cap,
      cooldownTicks: num(issues, record, 'cooldownTicks', `${where}.cooldownTicks`, 0, 100000),
      natural: natural === true,
      concurrent: validateConcurrent(issues, record, where),
      ...(record['scale'] === undefined
        ? {}
        : { scale: validateScale(issues, asRecord(record['scale']), `${where}.scale`) }),
      ...(record['season'] === undefined
        ? {}
        : { season: validateSeason(issues, asRecord(record['season']), `${where}.season`) }),
      require: validateRequire(issues, record['require'], `${where}.require`),
      ...(record['unless'] === undefined
        ? {}
        : { unless: validateUnless(issues, record['unless'], `${where}.unless`) }),
      risk: validateRisk(issues, record['risk'], `${where}.risk`, natural === true),
      ...(record['burn'] === undefined
        ? {}
        : { burn: validateBurn(issues, asRecord(record['burn']), `${where}.burn`) }),
    };
  }

  return out;
}

function metric(
  issues: ValidationIssue[],
  container: Record<string, unknown> | null,
  key: string,
  field: string,
): DisasterMetric {
  const value = container?.[key];
  if (typeof value !== 'string' || !DISASTER_METRICS.includes(value as DisasterMetric)) {
    issues.push({ field, message: `neznámá veličina; povolené: ${DISASTER_METRICS.join(', ')}` });
    return 'none';
  }
  return value as DisasterMetric;
}

function validateConcurrent(
  issues: ValidationIssue[],
  record: Record<string, unknown>,
  where: string,
): DisasterBalance['concurrent'] {
  const raw = asRecord(record['concurrent']);
  if (!raw) {
    issues.push({ field: `${where}.concurrent`, message: 'chybí, nebo není objekt' });
    return { metric: 'none', divisor: 1, min: 1, max: 1 };
  }
  const min = num(issues, raw, 'min', `${where}.concurrent.min`, 1, 100);
  const max = num(issues, raw, 'max', `${where}.concurrent.max`, 1, 100);
  if (max < min) {
    issues.push({ field: `${where}.concurrent.max`, message: 'nesmí být pod min' });
  }
  return {
    metric: metric(issues, raw, 'metric', `${where}.concurrent.metric`),
    divisor: num(issues, raw, 'divisor', `${where}.concurrent.divisor`, 1, 1000000),
    min,
    max,
  };
}

function validateScale(
  issues: ValidationIssue[],
  raw: Record<string, unknown> | null,
  where: string,
): ScaleBalance {
  if (!raw) {
    issues.push({ field: where, message: 'musí být objekt' });
    return { metric: 'none', curve: 'linear', divisor: 1, offset: 0, min: 1, max: 1 };
  }
  const curve = raw['curve'];
  if (curve !== 'sqrt' && curve !== 'linear') {
    issues.push({ field: `${where}.curve`, message: "musí být 'sqrt' nebo 'linear'" });
  }
  return {
    metric: metric(issues, raw, 'metric', `${where}.metric`),
    curve: curve === 'sqrt' ? 'sqrt' : 'linear',
    divisor: num(issues, raw, 'divisor', `${where}.divisor`, 0.000001, 1000000),
    offset: num(issues, raw, 'offset', `${where}.offset`, -10, 10),
    min: num(issues, raw, 'min', `${where}.min`, 0, 100),
    max: num(issues, raw, 'max', `${where}.max`, 0, 100),
  };
}

function validateSeason(
  issues: ValidationIssue[],
  raw: Record<string, unknown> | null,
  where: string,
): NonNullable<DisasterBalance['season']> {
  if (!raw) {
    issues.push({ field: where, message: 'musí být objekt' });
    return { from: 0, to: 0, inFactor: 1, outFactor: 1 };
  }
  return {
    from: num(issues, raw, 'from', `${where}.from`, 0, 359),
    to: num(issues, raw, 'to', `${where}.to`, 0, 360),
    inFactor: num(issues, raw, 'inFactor', `${where}.inFactor`, 0, 20),
    outFactor: num(issues, raw, 'outFactor', `${where}.outFactor`, 0, 20),
  };
}

function validateRequire(
  issues: ValidationIssue[],
  raw: unknown,
  where: string,
): { metric: DisasterMetric; min: number }[] {
  if (!Array.isArray(raw)) {
    issues.push({ field: where, message: 'musí být pole (klidně prázdné)' });
    return [];
  }
  return raw.map((entry, i) => {
    const record = asRecord(entry);
    if (!record) {
      issues.push({ field: `${where}[${i}]`, message: 'musí být objekt' });
      return { metric: 'none' as DisasterMetric, min: 0 };
    }
    return {
      metric: metric(issues, record, 'metric', `${where}[${i}].metric`),
      min: num(issues, record, 'min', `${where}[${i}].min`, 0, 1000000),
    };
  });
}

/** Jméno ukazatele. Seznam je otevřený (mod si smí přidat vlastní), tvar ne. */
function indicatorName(issues: ValidationIssue[], raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    issues.push({ field, message: 'musí být neprázdný řetězec' });
    return 'none';
  }
  return raw;
}

/** Slábnoucí náskok poptávky. Čtyři čísla, všechna v datech (P5). */
function validateDemandBase(
  issues: ValidationIssue[],
  raw: Record<string, unknown> | null,
  where: string,
): DemandBase {
  if (!raw) {
    issues.push({ field: where, message: 'musí být objekt' });
    return { start: 0, holdYears: 0, perYear: 0, floor: 0 };
  }
  const start = num(issues, raw, 'start', `${where}.start`, 0, 1000);
  const floor = num(issues, raw, 'floor', `${where}.floor`, 0, 1000);
  if (floor > start) {
    issues.push({ field: `${where}.floor`, message: 'nesmí být větší než start' });
  }
  return {
    start,
    holdYears: num(issues, raw, 'holdYears', `${where}.holdYears`, 0, 1000),
    perYear: num(issues, raw, 'perYear', `${where}.perYear`, 0, 1000),
    floor,
  };
}

function validateUnless(
  issues: ValidationIssue[],
  raw: unknown,
  where: string,
): { indicator: string; above: number }[] {
  if (!Array.isArray(raw)) {
    issues.push({ field: where, message: 'musí být pole' });
    return [];
  }
  return raw.map((entry, i) => {
    const record = asRecord(entry);
    if (!record) {
      issues.push({ field: `${where}[${i}]`, message: 'musí být objekt' });
      return { indicator: 'none', above: 0 };
    }
    return {
      indicator: indicatorName(issues, record['indicator'], `${where}[${i}].indicator`),
      above: num(issues, record, 'above', `${where}[${i}].above`, -1000000, 1000000),
    };
  });
}

function validateRisk(
  issues: ValidationIssue[],
  raw: unknown,
  where: string,
  natural: boolean,
): RiskTermBalance[] {
  if (!Array.isArray(raw)) {
    issues.push({ field: where, message: 'musí být pole (klidně prázdné)' });
    return [];
  }
  // Přírodní katastrofa se sčítanci rizika je zmatek, ne chyba obsahu: faktor
  // typu je u ní z definice 1, takže by je nikdo nikdy nepřečetl.
  if (natural && raw.length > 0) {
    issues.push({ field: where, message: 'přírodní katastrofa nemá faktor typu, seznam musí být prázdný' });
  }

  return raw.map((entry, i) => {
    const record = asRecord(entry);
    if (!record) {
      issues.push({ field: `${where}[${i}]`, message: 'musí být objekt' });
      return { indicator: '', weight: 0 };
    }
    const indicator = record['indicator'];
    if (typeof indicator !== 'string' || indicator.length === 0) {
      issues.push({ field: `${where}[${i}].indicator`, message: 'musí být neprázdný řetězec' });
    }
    return {
      indicator: typeof indicator === 'string' ? indicator : '',
      weight: num(issues, record, 'weight', `${where}[${i}].weight`, -100, 100),
      ...(record['below'] === undefined
        ? {}
        : { below: num(issues, record, 'below', `${where}[${i}].below`, 0, 1) }),
    };
  });
}

function validateBurn(
  issues: ValidationIssue[],
  raw: Record<string, unknown> | null,
  where: string,
): BurnBalance {
  if (!raw) {
    issues.push({ field: where, message: 'musí být objekt' });
    return {
      wildfire: false,
      ignitionIntensity: 100,
      intensityGrowth: 1,
      spreadChance: 0,
      minIgnitions: 1,
      maxIgnitions: 1,
    };
  }

  const min = num(issues, raw, 'minIgnitions', `${where}.minIgnitions`, 1, 100);
  const max = num(issues, raw, 'maxIgnitions', `${where}.maxIgnitions`, 1, 100);
  if (max < min) issues.push({ field: `${where}.maxIgnitions`, message: 'nesmí být pod min' });

  return {
    wildfire: raw['wildfire'] === true,
    ignitionIntensity: num(issues, raw, 'ignitionIntensity', `${where}.ignitionIntensity`, 1, 255),
    intensityGrowth: num(issues, raw, 'intensityGrowth', `${where}.intensityGrowth`, 0, 255),
    spreadChance: num(issues, raw, 'spreadChance', `${where}.spreadChance`, 0, 1),
    minIgnitions: min,
    maxIgnitions: max,
  };
}

/**
 * Model ohně.
 *
 * Hořlavost je pravděpodobnost, tedy 0–1. Palivo je počet ohňových tiků do
 * zničení — celé číslo, protože se odečítá po jedné. Kdyby některé chybělo,
 * příslušný obsah dlaždice by tiše nehořel vůbec; proto se kontroluje, že
 * jsou obě tabulky úplné.
 */
function validateFire(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): FireBalance {
  const raw = disasters ? asRecord(disasters['fire']) : null;
  const empty: FireBalance = {
    tickInterval: 2,
    suppressBase: 0,
    suppressPerCoverage: 0,
    pollutionPerTick: 0,
    happinessPerLoss: 0,
    happinessPenaltyTicks: 0,
    flammability: {},
    fuel: {},
    byClass: {},
  };
  if (!raw) {
    if (disasters) issues.push({ field: 'disasters.fire', message: 'chybí, nebo není objekt' });
    return empty;
  }

  const flammability: Record<string, number> = {};
  const fuel: Record<string, number> = {};
  const rawFlammability = asRecord(raw['flammability']);
  const rawFuel = asRecord(raw['fuel']);

  if (!rawFlammability) {
    issues.push({ field: 'disasters.fire.flammability', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawFlammability).sort()) {
      flammability[key] = num(
        issues,
        rawFlammability,
        key,
        `disasters.fire.flammability.${key}`,
        0,
        1,
      );
    }
  }

  if (!rawFuel) {
    issues.push({ field: 'disasters.fire.fuel', message: 'chybí, nebo není objekt' });
  } else {
    for (const key of Object.keys(rawFuel).sort()) {
      fuel[key] = num(issues, rawFuel, key, `disasters.fire.fuel.${key}`, 1, 1000);
    }
  }

  // Obsah, který má hořlavost, ale ne palivo, by hořel donekonečna.
  for (const key of Object.keys(flammability)) {
    if (fuel[key] === undefined) {
      issues.push({ field: `disasters.fire.fuel.${key}`, message: 'chybí ke stejné hořlavosti' });
    }
  }

  const byClass: Record<string, { flammability: number; fuel: number }> = {};
  const rawByClass = asRecord(raw['byClass']) ?? {};
  for (const key of Object.keys(rawByClass).sort()) {
    const entry = asRecord(rawByClass[key]);
    if (!entry) {
      issues.push({ field: `disasters.fire.byClass.${key}`, message: 'musí být objekt' });
      continue;
    }
    byClass[key] = {
      flammability: num(
        issues,
        entry,
        'flammability',
        `disasters.fire.byClass.${key}.flammability`,
        0,
        1,
      ),
      fuel: num(issues, entry, 'fuel', `disasters.fire.byClass.${key}.fuel`, 1, 1000),
    };
  }

  return {
    tickInterval: num(issues, raw, 'tickInterval', 'disasters.fire.tickInterval', 1, 100),
    suppressBase: num(issues, raw, 'suppressBase', 'disasters.fire.suppressBase', 0, 255),
    suppressPerCoverage: num(
      issues,
      raw,
      'suppressPerCoverage',
      'disasters.fire.suppressPerCoverage',
      0,
      10,
    ),
    pollutionPerTick: num(issues, raw, 'pollutionPerTick', 'disasters.fire.pollutionPerTick', 0, 255),
    happinessPerLoss: num(issues, raw, 'happinessPerLoss', 'disasters.fire.happinessPerLoss', 0, 255),
    happinessPenaltyTicks: num(
      issues,
      raw,
      'happinessPenaltyTicks',
      'disasters.fire.happinessPenaltyTicks',
      0,
      100000,
    ),
    flammability,
    fuel,
    byClass,
  };
}

/**
 * Povodeň z balancu.
 *
 * Kontroluje se **tvar a pořadí mezí**: `min` nad `max` by znamenalo prázdný
 * rozsah a `rng.int()` na záporné šířce vrátí nulu — vlna by se nikdy
 * nepohnula a nic by to nehlásilo.
 */
function validateFlood(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): FloodBalance {
  const raw = disasters ? asRecord(disasters['flood']) : null;
  if (!raw) {
    if (disasters) issues.push({ field: 'disasters.flood', message: 'chybí, nebo není objekt' });
    return {
      waterRise: 1,
      bayWeight: 0,
      reachMin: 1,
      reachMax: 1,
      advanceTicksMin: 1,
      advanceTicksMax: 1,
      durationMin: 1,
      durationMax: 1,
      drainPerCoverage: 0,
      damagePerDepth: 0,
      pollutionPerTick: 0,
      landValuePenalty: 0,
      happinessPerLoss: 0,
    };
  }

  const range = (minKey: string, maxKey: string, lo: number, hi: number): [number, number] => {
    const min = num(issues, raw, minKey, `disasters.flood.${minKey}`, lo, hi);
    const max = num(issues, raw, maxKey, `disasters.flood.${maxKey}`, lo, hi);
    if (max < min) {
      issues.push({ field: `disasters.flood.${maxKey}`, message: 'nesmí být pod min' });
    }
    return [min, max];
  };

  const [reachMin, reachMax] = range('reachMin', 'reachMax', 1, 100);
  const [advanceMin, advanceMax] = range('advanceTicksMin', 'advanceTicksMax', 1, 1000);
  const [durationMin, durationMax] = range('durationMin', 'durationMax', 1, 1000);

  return {
    waterRise: num(issues, raw, 'waterRise', 'disasters.flood.waterRise', 1, 15),
    bayWeight: num(issues, raw, 'bayWeight', 'disasters.flood.bayWeight', 0, 100),
    reachMin,
    reachMax,
    advanceTicksMin: advanceMin,
    advanceTicksMax: advanceMax,
    durationMin,
    durationMax,
    drainPerCoverage: num(
      issues,
      raw,
      'drainPerCoverage',
      'disasters.flood.drainPerCoverage',
      0,
      10,
    ),
    damagePerDepth: num(issues, raw, 'damagePerDepth', 'disasters.flood.damagePerDepth', 0, 255),
    pollutionPerTick: num(
      issues,
      raw,
      'pollutionPerTick',
      'disasters.flood.pollutionPerTick',
      0,
      255,
    ),
    landValuePenalty: num(
      issues,
      raw,
      'landValuePenalty',
      'disasters.flood.landValuePenalty',
      0,
      255,
    ),
    happinessPerLoss: num(
      issues,
      raw,
      'happinessPerLoss',
      'disasters.flood.happinessPerLoss',
      0,
      255,
    ),
  };
}

/** Klíče, které musí každá tabulka obsahu nést. Chybějící se tiše chová jako nula. */
const CONTENT_KINDS = [
  'forest',
  'abandoned',
  'residentialLow',
  'residentialHigh',
  'commercial',
  'industrial',
  'service',
  'utility',
  'road',
  'pipe',
  'rubble',
  'empty',
] as const;

/**
 * Tabulka podle obsahu dlaždice.
 *
 * Kontroluje se **úplnost**: chybějící klíč se v kódu chová jako nula, což
 * u odolnosti znamená „zničí se vždycky" a u zranitelnosti „nikdy". Obojí je
 * tichá chyba, kterou by hráč objevil až tím, že mu tornádo nechává stát
 * zrovna továrny.
 */
function contentTable(
  issues: ValidationIssue[],
  container: Record<string, unknown> | null,
  key: string,
  where: string,
  max: number,
): ContentTable {
  const raw = container ? asRecord(container[key]) : null;
  if (!raw) {
    if (container) issues.push({ field: where, message: 'chybí, nebo není objekt' });
    return {};
  }

  const table: Record<string, number> = {};
  for (const name of Object.keys(raw).sort()) {
    table[name] = num(issues, raw, name, `${where}.${name}`, 0, max);
  }
  for (const required of CONTENT_KINDS) {
    if (table[required] === undefined) {
      issues.push({ field: `${where}.${required}`, message: 'chybí' });
    }
  }
  return table;
}

function validateTornado(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): TornadoBalance {
  const raw = disasters ? asRecord(disasters['tornado']) : null;
  if (!raw && disasters) {
    issues.push({ field: 'disasters.tornado', message: 'chybí, nebo není objekt' });
  }
  const where = 'disasters.tornado';

  const lifetimeMin = num(issues, raw, 'lifetimeMin', `${where}.lifetimeMin`, 1, 1000);
  const lifetimeMax = num(issues, raw, 'lifetimeMax', `${where}.lifetimeMax`, 1, 1000);
  if (lifetimeMax < lifetimeMin) {
    issues.push({ field: `${where}.lifetimeMax`, message: 'nesmí být pod min' });
  }
  const widthMin = num(issues, raw, 'widthMin', `${where}.widthMin`, 1, 100);
  const widthMax = num(issues, raw, 'widthMax', `${where}.widthMax`, 1, 100);
  if (widthMax < widthMin) {
    issues.push({ field: `${where}.widthMax`, message: 'nesmí být pod min' });
  }

  return {
    speed: num(issues, raw, 'speed', `${where}.speed`, 0.1, 100),
    lifetimeMin,
    lifetimeMax,
    widthMin,
    widthMax,
    turnDegrees: num(issues, raw, 'turnDegrees', `${where}.turnDegrees`, 0, 180),
    igniteChance: num(issues, raw, 'igniteChance', `${where}.igniteChance`, 0, 1),
    igniteIntensity: num(issues, raw, 'igniteIntensity', `${where}.igniteIntensity`, 1, 255),
    happinessPerLoss: num(issues, raw, 'happinessPerLoss', `${where}.happinessPerLoss`, 0, 255),
    survival: contentTable(issues, raw, 'survival', `${where}.survival`, 1),
  };
}

function validateEarthquake(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): EarthquakeBalance {
  const raw = disasters ? asRecord(disasters['earthquake']) : null;
  if (!raw && disasters) {
    issues.push({ field: 'disasters.earthquake', message: 'chybí, nebo není objekt' });
  }
  const where = 'disasters.earthquake';

  return {
    magnitudeBase: num(issues, raw, 'magnitudeBase', `${where}.magnitudeBase`, 0, 1),
    magnitudeSpan: num(issues, raw, 'magnitudeSpan', `${where}.magnitudeSpan`, 0, 1),
    falloffShare: num(issues, raw, 'falloffShare', `${where}.falloffShare`, 0.01, 10),
    falloffMin: num(issues, raw, 'falloffMin', `${where}.falloffMin`, 0, 1),
    downgradeShare: num(issues, raw, 'downgradeShare', `${where}.downgradeShare`, 0, 10),
    aftershocksMin: num(issues, raw, 'aftershocksMin', `${where}.aftershocksMin`, 0, 100),
    aftershocksMax: num(issues, raw, 'aftershocksMax', `${where}.aftershocksMax`, 0, 100),
    aftershockDelayMin: num(issues, raw, 'aftershockDelayMin', `${where}.aftershockDelayMin`, 1, 1000),
    aftershockDelayMax: num(issues, raw, 'aftershockDelayMax', `${where}.aftershockDelayMax`, 1, 1000),
    aftershockDecay: num(issues, raw, 'aftershockDecay', `${where}.aftershockDecay`, 0, 1),
    fireChance: num(issues, raw, 'fireChance', `${where}.fireChance`, 0, 1),
    floodChance: num(issues, raw, 'floodChance', `${where}.floodChance`, 0, 1),
    floodBand: num(issues, raw, 'floodBand', `${where}.floodBand`, 0, 100),
    floodDepth: num(issues, raw, 'floodDepth', `${where}.floodDepth`, 0, 255),
    floodDuration: num(issues, raw, 'floodDuration', `${where}.floodDuration`, 0, 255),
    igniteIntensity: num(issues, raw, 'igniteIntensity', `${where}.igniteIntensity`, 1, 255),
    happinessPerLoss: num(issues, raw, 'happinessPerLoss', `${where}.happinessPerLoss`, 0, 255),
    happinessPerDowngrade: num(
      issues,
      raw,
      'happinessPerDowngrade',
      `${where}.happinessPerDowngrade`,
      0,
      255,
    ),
    vulnerability: contentTable(issues, raw, 'vulnerability', `${where}.vulnerability`, 10),
  };
}

function blastKind(
  issues: ValidationIssue[],
  container: Record<string, unknown> | null,
  key: string,
  where: string,
): BlastKindBalance {
  const raw = container ? asRecord(container[key]) : null;
  if (!raw && container) issues.push({ field: where, message: 'chybí, nebo není objekt' });

  return {
    radiusBase: num(issues, raw, 'radiusBase', `${where}.radiusBase`, 0, 100),
    radiusPerLevel: num(issues, raw, 'radiusPerLevel', `${where}.radiusPerLevel`, 0, 100),
    destroyChance: num(issues, raw, 'destroyChance', `${where}.destroyChance`, 0, 1),
    igniteReach: num(issues, raw, 'igniteReach', `${where}.igniteReach`, 0, 10),
    igniteChance: num(issues, raw, 'igniteChance', `${where}.igniteChance`, 0, 1),
    igniteIntensity: num(issues, raw, 'igniteIntensity', `${where}.igniteIntensity`, 1, 255),
    pollution: num(issues, raw, 'pollution', `${where}.pollution`, 0, 255),
    happinessPerLoss: num(issues, raw, 'happinessPerLoss', `${where}.happinessPerLoss`, 0, 255),
  };
}

/**
 * Sociální katastrofy (T52).
 *
 * Všechny čtyři sdílejí jednu myšlenku: hráč je umí zkrátit tím, že zareaguje.
 * Proto mají `drain*` místo pevného trvání — a proto se tady kontroluje, že
 * `drainRising` je opravdu vyšší než `drainIdle`. Kdyby nebyl, reakce by
 * katastrofu prodlužovala a celá mechanika by mlčky přestala dávat smysl.
 */
function validatePileup(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): PileupBalance {
  const raw = disasterSection(issues, disasters, 'pileup');
  return {
    durationBase: num(issues, raw, 'durationBase', 'disasters.pileup.durationBase', 1, 200),
    durationSpan: num(issues, raw, 'durationSpan', 'disasters.pileup.durationSpan', 0, 200),
    reach: num(issues, raw, 'reach', 'disasters.pileup.reach', 0, 64),
    jamRadius: num(issues, raw, 'jamRadius', 'disasters.pileup.jamRadius', 0, 64),
    jamFactor: num(issues, raw, 'jamFactor', 'disasters.pileup.jamFactor', 1, 100),
    healthFactor: num(issues, raw, 'healthFactor', 'disasters.pileup.healthFactor', 0, 1),
    fireFactor: num(issues, raw, 'fireFactor', 'disasters.pileup.fireFactor', 0, 1),
    happiness: num(issues, raw, 'happiness', 'disasters.pileup.happiness', 0, 255),
    populationLoss: num(issues, raw, 'populationLoss', 'disasters.pileup.populationLoss', 0, 1),
    reportLoad: num(issues, raw, 'reportLoad', 'disasters.pileup.reportLoad', 0, 1000),
  };
}

function validateStrike(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): StrikeBalance {
  const raw = disasterSection(issues, disasters, 'strike');
  const value: StrikeBalance = {
    durationMin: num(issues, raw, 'durationMin', 'disasters.strike.durationMin', 1, 1000),
    durationMax: num(issues, raw, 'durationMax', 'disasters.strike.durationMax', 1, 1000),
    radiusMin: num(issues, raw, 'radiusMin', 'disasters.strike.radiusMin', 0, 64),
    radiusMax: num(issues, raw, 'radiusMax', 'disasters.strike.radiusMax', 0, 64),
    drainIdle: num(issues, raw, 'drainIdle', 'disasters.strike.drainIdle', 0.01, 100),
    drainRising: num(issues, raw, 'drainRising', 'disasters.strike.drainRising', 0.01, 100),
    crime: num(issues, raw, 'crime', 'disasters.strike.crime', 0, 255),
    traffic: num(issues, raw, 'traffic', 'disasters.strike.traffic', 1, 100),
    healthFactor: num(issues, raw, 'healthFactor', 'disasters.strike.healthFactor', 0, 1),
    happiness: num(issues, raw, 'happiness', 'disasters.strike.happiness', 0, 255),
    happinessCity: num(issues, raw, 'happinessCity', 'disasters.strike.happinessCity', 0, 255),
  };
  reactionPays(issues, 'disasters.strike', value.drainIdle, value.drainRising);
  return value;
}

function validateRiot(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): RiotBalance {
  const raw = disasterSection(issues, disasters, 'riot');
  const value: RiotBalance = {
    durationMin: num(issues, raw, 'durationMin', 'disasters.riot.durationMin', 1, 1000),
    durationMax: num(issues, raw, 'durationMax', 'disasters.riot.durationMax', 1, 1000),
    drainIdle: num(issues, raw, 'drainIdle', 'disasters.riot.drainIdle', 0.01, 100),
    drainRising: num(issues, raw, 'drainRising', 'disasters.riot.drainRising', 0.01, 100),
    drainBoth: num(issues, raw, 'drainBoth', 'disasters.riot.drainBoth', 0.01, 100),
    policeCalm: num(issues, raw, 'policeCalm', 'disasters.riot.policeCalm', 0, 255),
    strengthBase: num(issues, raw, 'strengthBase', 'disasters.riot.strengthBase', 0, 1),
    crime: num(issues, raw, 'crime', 'disasters.riot.crime', 0, 255),
    traffic: num(issues, raw, 'traffic', 'disasters.riot.traffic', 0, 100),
    healthFactor: num(issues, raw, 'healthFactor', 'disasters.riot.healthFactor', 0, 1),
    educationFactor: num(issues, raw, 'educationFactor', 'disasters.riot.educationFactor', 0, 1),
    happiness: num(issues, raw, 'happiness', 'disasters.riot.happiness', 0, 255),
    taxLoss: num(issues, raw, 'taxLoss', 'disasters.riot.taxLoss', 0, 1),
    igniteEvery: num(issues, raw, 'igniteEvery', 'disasters.riot.igniteEvery', 1, 100),
    igniteMax: num(issues, raw, 'igniteMax', 'disasters.riot.igniteMax', 0, 50),
    igniteIntensity: num(issues, raw, 'igniteIntensity', 'disasters.riot.igniteIntensity', 1, 255),
    escalationCrime: num(issues, raw, 'escalationCrime', 'disasters.riot.escalationCrime', 0, 255),
    escalationChance: num(issues, raw, 'escalationChance', 'disasters.riot.escalationChance', 0, 1),
  };
  reactionPays(issues, 'disasters.riot', value.drainIdle, value.drainRising);
  reactionPays(issues, 'disasters.riot', value.drainRising, value.drainBoth);
  return value;
}

function validateGangWar(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): GangWarBalance {
  const raw = disasterSection(issues, disasters, 'gangWar');
  return {
    durationMin: num(issues, raw, 'durationMin', 'disasters.gangWar.durationMin', 1, 2000),
    durationMax: num(issues, raw, 'durationMax', 'disasters.gangWar.durationMax', 1, 2000),
    radiusMin: num(issues, raw, 'radiusMin', 'disasters.gangWar.radiusMin', 0, 64),
    radiusMax: num(issues, raw, 'radiusMax', 'disasters.gangWar.radiusMax', 0, 64),
    radiusMax2: num(issues, raw, 'radiusMax2', 'disasters.gangWar.radiusMax2', 0, 64),
    spreadEvery: num(issues, raw, 'spreadEvery', 'disasters.gangWar.spreadEvery', 1, 500),
    spreadStop: num(issues, raw, 'spreadStop', 'disasters.gangWar.spreadStop', 0, 255),
    drainBase: num(issues, raw, 'drainBase', 'disasters.gangWar.drainBase', 0.01, 100),
    pressurePolice: num(issues, raw, 'pressurePolice', 'disasters.gangWar.pressurePolice', 0, 10),
    pressureHappiness: num(
      issues,
      raw,
      'pressureHappiness',
      'disasters.gangWar.pressureHappiness',
      0,
      10,
    ),
    pressureEmployment: num(
      issues,
      raw,
      'pressureEmployment',
      'disasters.gangWar.pressureEmployment',
      0,
      10,
    ),
    pressureScale: num(issues, raw, 'pressureScale', 'disasters.gangWar.pressureScale', 0, 100),
    crimeFloor: num(issues, raw, 'crimeFloor', 'disasters.gangWar.crimeFloor', 0, 255),
    happiness: num(issues, raw, 'happiness', 'disasters.gangWar.happiness', 0, 255),
    happinessCity: num(issues, raw, 'happinessCity', 'disasters.gangWar.happinessCity', 0, 255),
    educationFactor: num(issues, raw, 'educationFactor', 'disasters.gangWar.educationFactor', 0, 1),
    healthFactor: num(issues, raw, 'healthFactor', 'disasters.gangWar.healthFactor', 0, 1),
    landValue: num(issues, raw, 'landValue', 'disasters.gangWar.landValue', 0, 255),
    taxLoss: num(issues, raw, 'taxLoss', 'disasters.gangWar.taxLoss', 0, 1),
    destroyEvery: num(issues, raw, 'destroyEvery', 'disasters.gangWar.destroyEvery', 1, 500),
    destroyChance: num(issues, raw, 'destroyChance', 'disasters.gangWar.destroyChance', 0, 1),
    happinessPerLoss: num(
      issues,
      raw,
      'happinessPerLoss',
      'disasters.gangWar.happinessPerLoss',
      0,
      255,
    ),
  };
}

/** Sekce v `disasters`. Chybějící se hlásí jednou, ne u každého klíče zvlášť. */
function disasterSection(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const raw = disasters ? asRecord(disasters[key]) : null;
  if (!raw && disasters) {
    issues.push({ field: `disasters.${key}`, message: 'chybí, nebo není objekt' });
  }
  return raw;
}

/**
 * Reakce se musí vyplatit. `faster` je úbytek při zásahu, `slower` bez něj.
 *
 * Kdyby to bylo obráceně, hráč by katastrofu prodlužoval tím, že se snaží —
 * a nikdo by na to nepřišel, protože obojí je jen číslo v datech.
 */
function reactionPays(
  issues: ValidationIssue[],
  field: string,
  slower: number,
  faster: number,
): void {
  if (faster > slower) return;
  issues.push({
    field,
    message: `reakce musí katastrofu zkracovat: ${faster} není víc než ${slower}`,
  });
}

/** Pravdivostní hodnota z balancu. Chybějící se hlásí, nedosazuje. */
function flag(
  issues: ValidationIssue[],
  container: Record<string, unknown> | null,
  key: string,
  field: string,
): boolean {
  if (!container) return false;
  const value = container[key];
  if (typeof value !== 'boolean') {
    issues.push({ field, message: 'musí být true nebo false' });
    return false;
  }
  return value;
}

/**
 * Módy MHD.
 *
 * Nekontroluje se, že existují zrovna `bus`, `tram` a `metro` — módy jsou
 * obsah. Kontroluje se **tvar**: bez toho by mód s chybějící kapacitou tiše
 * odvezl nula lidí a hráč by hledal chybu v počtu vozidel.
 */
/**
 * Půjčky a rating.
 *
 * Hlídá se jedna věc navíc: **uzdravování ratingu musí být pomalejší než
 * pád**. Kdyby bylo rychlejší, stačilo by pár měsíců v černých číslech
 * a nesplácení by nic nestálo — a rating je jediný trest, který za něj hra má.
 */
function validateBonds(
  issues: ValidationIssue[],
  finance: Record<string, unknown> | null,
): BondBalance {
  const raw = finance ? asRecord(finance['bonds']) : null;
  if (finance && !raw) {
    issues.push({ field: 'finance.bonds', message: 'chybí, nebo není objekt' });
  }

  const where = 'finance.bonds';
  return {
    incomeMultiple: num(issues, raw, 'incomeMultiple', `${where}.incomeMultiple`, 0, 1000),
    feeRate: num(issues, raw, 'feeRate', `${where}.feeRate`, 0, 1),
    referenceRate: num(issues, raw, 'referenceRate', `${where}.referenceRate`, 0, 100),
    maxRate: num(issues, raw, 'maxRate', `${where}.maxRate`, 0, 100),
    minMaturityTicks: num(issues, raw, 'minMaturityTicks', `${where}.minMaturityTicks`, 1, 100000),
    maxMaturityTicks: num(issues, raw, 'maxMaturityTicks', `${where}.maxMaturityTicks`, 1, 100000),
    base: num(issues, raw, 'base', `${where}.base`, 0, 1),
    rateWeight: num(issues, raw, 'rateWeight', `${where}.rateWeight`, 0, 10),
    happinessWeight: num(issues, raw, 'happinessWeight', `${where}.happinessWeight`, 0, 10),
    growthWeight: num(issues, raw, 'growthWeight', `${where}.growthWeight`, 0, 10),
    crimeWeight: num(issues, raw, 'crimeWeight', `${where}.crimeWeight`, 0, 10),
    debtWeight: num(issues, raw, 'debtWeight', `${where}.debtWeight`, 0, 10),
    defaultPenalty: num(issues, raw, 'defaultPenalty', `${where}.defaultPenalty`, 0, 1),
    blockTicks: num(issues, raw, 'blockTicks', `${where}.blockTicks`, 0, 100000),
  };
}

function validateFinance(
  issues: ValidationIssue[],
  root: Record<string, unknown>,
): Balance['finance'] {
  const raw = section(issues, root, 'finance');
  const value: Balance['finance'] = {
    loanIncomeMultiple: num(
      issues,
      raw,
      'loanIncomeMultiple',
      'finance.loanIncomeMultiple',
      0,
      1000,
    ),
    maxLoans: num(issues, raw, 'maxLoans', 'finance.maxLoans', 1, 100),
    minTermMonths: num(issues, raw, 'minTermMonths', 'finance.minTermMonths', 1, 1000),
    maxTermMonths: num(issues, raw, 'maxTermMonths', 'finance.maxTermMonths', 1, 1000),
    baseRate: num(issues, raw, 'baseRate', 'finance.baseRate', 0, 100),
    ratePenalty: num(issues, raw, 'ratePenalty', 'finance.ratePenalty', 0, 100),
    missedPenalty: num(issues, raw, 'missedPenalty', 'finance.missedPenalty', 0, 1),
    ratingRecovery: num(issues, raw, 'ratingRecovery', 'finance.ratingRecovery', 0, 1),
    bonds: validateBonds(issues, raw),
  };

  if (raw && value.maxTermMonths < value.minTermMonths) {
    issues.push({
      field: 'finance',
      message: `nejdelší doba nesmí být kratší než nejkratší: ${value.maxTermMonths} < ${value.minTermMonths}`,
    });
  }
  if (raw && value.bonds.maxMaturityTicks < value.bonds.minMaturityTicks) {
    issues.push({
      field: 'finance.bonds',
      message: `nejdelší splatnost nesmí být kratší než nejkratší: ${value.bonds.maxMaturityTicks} < ${value.bonds.minMaturityTicks}`,
    });
  }
  // Nesplacená jistina musí bolet víc než zmeškaná splátka. Kdyby ne, byla by
  // emise, kterou hráč nezaplatí, levnější než ta, kterou splácí poctivě.
  if (raw && value.bonds.defaultPenalty <= value.missedPenalty) {
    issues.push({
      field: 'finance.bonds',
      message: `nesplacená jistina musí bolet víc než zmeškaná splátka: ${value.bonds.defaultPenalty} není víc než ${value.missedPenalty}`,
    });
  }
  if (raw && value.ratingRecovery >= value.missedPenalty) {
    issues.push({
      field: 'finance',
      message: `rating se musí léčit pomaleji, než padá: ${value.ratingRecovery} není míň než ${value.missedPenalty}`,
    });
  }
  return value;
}

function validateTransit(
  issues: ValidationIssue[],
  root: Record<string, unknown>,
): Balance['transit'] {
  const raw = section(issues, root, 'transit');
  const modes: Record<string, TransitModeBalance> = {};

  const rawModes = raw ? asRecord(raw['modes']) : null;
  if (raw && !rawModes) {
    issues.push({ field: 'transit.modes', message: 'chybí, nebo není objekt' });
  }

  for (const [name, value] of Object.entries(rawModes ?? {})) {
    const where = `transit.modes.${name}`;
    const mode = asRecord(value);
    if (!mode) {
      issues.push({ field: where, message: 'musí být objekt' });
      continue;
    }

    modes[name] = {
      capacity: num(issues, mode, 'capacity', `${where}.capacity`, 1, 100000),
      vehicleCost: num(issues, mode, 'vehicleCost', `${where}.vehicleCost`, 0, 1000000),
      vehicleUpkeep: num(issues, mode, 'vehicleUpkeep', `${where}.vehicleUpkeep`, 0, 100000),
      roadShare: num(issues, mode, 'roadShare', `${where}.roadShare`, 0, 0.9),
      needsPower: flag(issues, mode, 'needsPower', `${where}.needsPower`),
    };
  }

  if (raw && Object.keys(modes).length === 0) {
    issues.push({ field: 'transit.modes', message: 'aspoň jeden mód' });
  }

  const minStops = num(issues, raw, 'minStops', 'transit.minStops', 2, 100);
  const maxStops = num(issues, raw, 'maxStops', 'transit.maxStops', 2, 100);
  // Linka musí mít aspoň dvě zastávky, aby vůbec někam vedla, a strop nesmí
  // být pod dnem — jinak by nešla založit žádná.
  if (raw && maxStops < minStops) {
    issues.push({
      field: 'transit',
      message: `strop zastávek nesmí být pod dnem: ${maxStops} < ${minStops}`,
    });
  }

  return {
    minStops,
    maxStops,
    fareLimit: num(issues, raw, 'fareLimit', 'transit.fareLimit', 1, 100000),
    modes,
  };
}

function validateBlackout(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): BlackoutBalance {
  const raw = disasterSection(issues, disasters, 'blackout');
  const value: BlackoutBalance = {
    cascadeEvery: num(issues, raw, 'cascadeEvery', 'disasters.blackout.cascadeEvery', 1, 100),
    maxTicks: num(issues, raw, 'maxTicks', 'disasters.blackout.maxTicks', 1, 10000),
    overloadRatio: num(issues, raw, 'overloadRatio', 'disasters.blackout.overloadRatio', 1, 10),
    recoveryRatio: num(issues, raw, 'recoveryRatio', 'disasters.blackout.recoveryRatio', 0, 10),
    calmCycles: num(issues, raw, 'calmCycles', 'disasters.blackout.calmCycles', 1, 100),
    noticeTicks: num(issues, raw, 'noticeTicks', 'disasters.blackout.noticeTicks', 0, 500),
    happinessPerTick: num(
      issues,
      raw,
      'happinessPerTick',
      'disasters.blackout.happinessPerTick',
      0,
      255,
    ),
    happinessMax: num(issues, raw, 'happinessMax', 'disasters.blackout.happinessMax', 0, 255),
    penaltyTicks: num(issues, raw, 'penaltyTicks', 'disasters.blackout.penaltyTicks', 1, 2000),
  };

  // Bez odstupu prahů by síť kmitala: odpojí, hned připojí, hned zas odpojí.
  if (raw && value.recoveryRatio >= value.overloadRatio) {
    issues.push({
      field: 'disasters.blackout',
      message: `práh zotavení musí být pod prahem přetížení: ${value.recoveryRatio} není míň než ${value.overloadRatio}`,
    });
  }
  return value;
}

function validateEpidemic(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): EpidemicBalance {
  const raw = disasterSection(issues, disasters, 'epidemic');
  const value: EpidemicBalance = {
    durationMin: num(issues, raw, 'durationMin', 'disasters.epidemic.durationMin', 1, 2000),
    durationMax: num(issues, raw, 'durationMax', 'disasters.epidemic.durationMax', 1, 2000),
    cycleTicks: num(issues, raw, 'cycleTicks', 'disasters.epidemic.cycleTicks', 1, 100),
    seed: num(issues, raw, 'seed', 'disasters.epidemic.seed', 0, 1),
    waves: num(issues, raw, 'waves', 'disasters.epidemic.waves', 1, 10),
    waveBase: num(issues, raw, 'waveBase', 'disasters.epidemic.waveBase', 0, 1),
    spread: num(issues, raw, 'spread', 'disasters.epidemic.spread', 0, 1),
    coverageBlock: num(issues, raw, 'coverageBlock', 'disasters.epidemic.coverageBlock', 0, 1),
    jumpChance: num(issues, raw, 'jumpChance', 'disasters.epidemic.jumpChance', 0, 1),
    jumpShare: num(issues, raw, 'jumpShare', 'disasters.epidemic.jumpShare', 0, 1),
    growth: num(issues, raw, 'growth', 'disasters.epidemic.growth', 0, 1),
    decay: num(issues, raw, 'decay', 'disasters.epidemic.decay', 0, 1),
    decayPerCoverage: num(
      issues,
      raw,
      'decayPerCoverage',
      'disasters.epidemic.decayPerCoverage',
      0,
      1,
    ),
    extinction: num(issues, raw, 'extinction', 'disasters.epidemic.extinction', 0, 1),
    mortality: num(issues, raw, 'mortality', 'disasters.epidemic.mortality', 0, 1),
    overload: num(issues, raw, 'overload', 'disasters.epidemic.overload', 0, 1),
    happiness: num(issues, raw, 'happiness', 'disasters.epidemic.happiness', 0, 255),
    happinessCity: num(issues, raw, 'happinessCity', 'disasters.epidemic.happinessCity', 0, 255),
  };

  // Musí existovat pokrytí, při kterém nákaza ustupuje. Kdyby růst přebil i
  // plné zdravotnictví, epidemie by se nedala zastavit ničím — a přitom je to
  // jediná katastrofa, jejíž celý smysl je v tom, že zastavit jde.
  if (raw && value.growth >= value.decay + value.decayPerCoverage) {
    issues.push({
      field: 'disasters.epidemic',
      message: `plné zdravotnictví musí nákazu srazit: růst ${value.growth} není míň než ústup ${value.decay + value.decayPerCoverage}`,
    });
  }
  return value;
}

function validateLandslide(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): LandslideBalance {
  const raw = disasterSection(issues, disasters, 'landslide');
  return {
    lengthMin: num(issues, raw, 'lengthMin', 'disasters.landslide.lengthMin', 1, 64),
    lengthMax: num(issues, raw, 'lengthMax', 'disasters.landslide.lengthMax', 1, 64),
    widthMin: num(issues, raw, 'widthMin', 'disasters.landslide.widthMin', 1, 16),
    widthMax: num(issues, raw, 'widthMax', 'disasters.landslide.widthMax', 1, 16),
    happinessPerLoss: num(
      issues,
      raw,
      'happinessPerLoss',
      'disasters.landslide.happinessPerLoss',
      0,
      100,
    ),
    recentTerraformTicks: num(
      issues,
      raw,
      'recentTerraformTicks',
      'disasters.landslide.recentTerraformTicks',
      0,
      65535,
    ),
    builtWeight: num(issues, raw, 'builtWeight', 'disasters.landslide.builtWeight', 0, 10),
    freshTerraformWeight: num(
      issues,
      raw,
      'freshTerraformWeight',
      'disasters.landslide.freshTerraformWeight',
      0,
      10,
    ),
  };
}

function validateChemicalSpill(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): ChemicalSpillBalance {
  const raw = disasterSection(issues, disasters, 'chemicalSpill');
  return {
    durationMin: num(issues, raw, 'durationMin', 'disasters.chemicalSpill.durationMin', 1, 500),
    durationMax: num(issues, raw, 'durationMax', 'disasters.chemicalSpill.durationMax', 1, 500),
    blastRadius: num(issues, raw, 'blastRadius', 'disasters.chemicalSpill.blastRadius', 0, 64),
    sourceDestroyChance: num(
      issues,
      raw,
      'sourceDestroyChance',
      'disasters.chemicalSpill.sourceDestroyChance',
      0,
      1,
    ),
    nearDestroyChance: num(
      issues,
      raw,
      'nearDestroyChance',
      'disasters.chemicalSpill.nearDestroyChance',
      0,
      1,
    ),
    pollutionRadius: num(
      issues,
      raw,
      'pollutionRadius',
      'disasters.chemicalSpill.pollutionRadius',
      0,
      64,
    ),
    pollution: num(issues, raw, 'pollution', 'disasters.chemicalSpill.pollution', 0, 255),
    waterRadius: num(issues, raw, 'waterRadius', 'disasters.chemicalSpill.waterRadius', 0, 64),
    waterAfterTicks: num(
      issues,
      raw,
      'waterAfterTicks',
      'disasters.chemicalSpill.waterAfterTicks',
      0,
      2000,
    ),
    populationRadius: num(
      issues,
      raw,
      'populationRadius',
      'disasters.chemicalSpill.populationRadius',
      0,
      64,
    ),
    populationLoss: num(
      issues,
      raw,
      'populationLoss',
      'disasters.chemicalSpill.populationLoss',
      0,
      1,
    ),
    landValueRadius: num(
      issues,
      raw,
      'landValueRadius',
      'disasters.chemicalSpill.landValueRadius',
      0,
      64,
    ),
    landValue: num(issues, raw, 'landValue', 'disasters.chemicalSpill.landValue', 0, 255),
    landValueTicks: num(
      issues,
      raw,
      'landValueTicks',
      'disasters.chemicalSpill.landValueTicks',
      1,
      10000,
    ),
    happiness: num(issues, raw, 'happiness', 'disasters.chemicalSpill.happiness', 0, 255),
    happinessCity: num(
      issues,
      raw,
      'happinessCity',
      'disasters.chemicalSpill.happinessCity',
      0,
      255,
    ),
    happinessPerLoss: num(
      issues,
      raw,
      'happinessPerLoss',
      'disasters.chemicalSpill.happinessPerLoss',
      0,
      255,
    ),
    heavyLevel: num(issues, raw, 'heavyLevel', 'disasters.chemicalSpill.heavyLevel', 1, 5),
    ageTicks: num(issues, raw, 'ageTicks', 'disasters.chemicalSpill.ageTicks', 1, 100000),
    ageWeight: num(issues, raw, 'ageWeight', 'disasters.chemicalSpill.ageWeight', 0, 10),
    wasteWeight: num(issues, raw, 'wasteWeight', 'disasters.chemicalSpill.wasteWeight', 0, 100),
    neglectFactor: num(
      issues,
      raw,
      'neglectFactor',
      'disasters.chemicalSpill.neglectFactor',
      0,
      10,
    ),
  };
}

function validateBlast(
  issues: ValidationIssue[],
  disasters: Record<string, unknown> | null,
): BlastBalance {
  const raw = disasters ? asRecord(disasters['blast']) : null;
  if (!raw && disasters) {
    issues.push({ field: 'disasters.blast', message: 'chybí, nebo není objekt' });
  }

  return {
    resistance: contentTable(issues, raw, 'resistance', 'disasters.blast.resistance', 1),
    explosion: blastKind(issues, raw, 'explosion', 'disasters.blast.explosion'),
    industrialAccident: blastKind(
      issues,
      raw,
      'industrialAccident',
      'disasters.blast.industrialAccident',
    ),
  };
}
