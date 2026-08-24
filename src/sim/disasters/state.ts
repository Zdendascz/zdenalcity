/**
 * Stav katastrof ve světě (§3 a §9 fáze 4).
 *
 * Sedí v `WorldState`, ne v modulu: dva světy vedle sebe si nesmí přepsat
 * hájení ani seznam běžících pohrom, a testy jich dělají spoustu.
 *
 * Do savu jde všechno kromě odvozených hodnot; formát verze 6 je T59.
 */

/** Dočasný postih s odpočtem — potlačená služba, kolony navíc, srážka spokojenosti. */
export interface Modifier {
  /**
   * Co postih dělá. Systémy se na něj ptají podle tohohle klíče, takže
   * přidat nový druh znamená přidat i místo, kde se uplatní.
   */
  readonly kind:
    | 'suppressService'
    | 'spikeTraffic'
    | 'spikeCrime'
    | 'crimeFloor'
    | 'happinessPenalty'
    | 'landValuePenalty'
    | 'contaminateWater'
    | 'blockTile'
    | 'taxLoss';
  /** Třída služby u `suppressService`, jinak prázdné. */
  readonly serviceClass?: string;
  /**
   * Buňky hrubé mřížky, kterých se postih týká.
   *
   * Prázdné pole znamená **celé město** — blackout ani stávka nemají střed.
   * Pro `blockTile` je to naopak seznam dlaždic v plném rozlišení.
   */
  readonly cells: readonly number[];
  /** Násobitel nebo přičítaná hodnota; význam podle `kind`. */
  readonly amount: number;
  /** Tik, ve kterém postih končí. Porovnává se s `world.tick`. */
  readonly until: number;
  /** Katastrofa, která ho zavedla. Pro rušení při jejím skončení. */
  readonly source: number;
}

/** Běžící katastrofa. Vlastní stav si drží implementace, tohle je evidence. */
export interface ActiveDisaster {
  readonly id: number;
  readonly kind: string;
  readonly startedAtTick: number;
  /** Kde vznikla. Slouží hlášení a skoku kamerou. */
  readonly x: number;
  readonly y: number;
  /** Vlastní stav katastrofy. Tvar si určuje její implementace. */
  state: Record<string, unknown>;
  finished: boolean;
}

export interface DisasterState {
  /**
   * Smí katastrofy vůbec nastat? (R18)
   *
   * Vypnutí se týká **jen plánovače**. Ruční spuštění z menu jde pořád —
   * jinak by hráč, který si katastrofy vypnul, neměl jak si je vyzkoušet.
   */
  enabled: boolean;

  /**
   * Tik posledního výskytu podle typu (R17).
   *
   * Zapisuje se při **vzniku**, u povodně a lesního požáru až při skončení —
   * u obou to poznamenává katalog. Chybějící klíč znamená „ještě nikdy".
   */
  lastOccurrence: Map<string, number>;

  active: ActiveDisaster[];
  modifiers: Modifier[];
  nextId: number;

  /**
   * Nejvyšší faktor typu, ke kterému se každá katastrofa dostala **v době,
   * kdy rozpočet nebyl v mínusu** (R16).
   *
   * Podfinancování → katastrofy → škody → nižší daně → větší podfinancování je
   * kladná zpětná vazba a s měkkým bankrotem by z ní město nevylezlo. Když je
   * měsíční bilance záporná, riziko se dál nezvyšuje: platí tenhle strop.
   */
  riskCeiling: Map<string, number>;

  /**
   * Kolik dlaždic právě hoří, zvlášť běžným a zvlášť lesním požárem.
   *
   * **Odvozené** — po načtení savu se dopočítá z vrstvy `fire`. Drží se tu
   * proto, že se na to ptá každý tik každá běžící pohroma, a projít kvůli
   * tomu 262 144 dlaždic velké mapy by bylo dražší než celý zbytek plánovače.
   */
  burning: { normal: number; wildfire: number };

  /**
   * Elektrárny odpojené blackoutem.
   *
   * Sedí v evidenci katastrof, ne na budově: je to **dočasný stav sítě**, ne
   * vlastnost elektrárny. Kdyby to byl příznak na budově, přežil by konec
   * blackoutu a hráč by měl elektrárnu, která nikdy nenaběhne, aniž by věděl
   * proč. Takhle stačí seznam vyprázdnit.
   */
  offlinePlants: Set<number>;
}

export function createDisasterState(enabled = true): DisasterState {
  return {
    enabled,
    lastOccurrence: new Map(),
    active: [],
    modifiers: [],
    nextId: 1,
    riskCeiling: new Map(),
    burning: { normal: 0, wildfire: 0 },
    offlinePlants: new Set(),
  };
}
