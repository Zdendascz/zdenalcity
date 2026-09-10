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

/**
 * Hodiny katastrofy: kolik tiků potrvá a kolik jich zbývá.
 *
 * Ukládá se **dvojice**, ne jen zbytek. Bez celku se z „zbývá 40" nedá říct
 * nic — je to skoro konec, nebo teprve začátek? Lišta v HUD ukazuje přesně
 * tenhle podíl a autor si ji vyžádal větou „bylo by fajn, kdyby tam byl
 * nějaký odpočet, do kdy katastrofa skončí".
 *
 * Klíče jsou dva a schválně obecné: každá pohroma si stav drží po svém
 * (`registry.ts`), ale kdo chce lištu, musí umět tyhle dva. Kdo hodiny nemá
 * — oheň končí, až dohoří, povodeň, až voda opadne — lištu prostě nedostane.
 */
export function setClock(active: ActiveDisaster, duration: number): void {
  active.state['left'] = duration;
  active.state['span'] = duration;
}

/**
 * Kolik z katastrofy je za námi, 0–1. `null` znamená „nedá se říct".
 *
 * Bere obojí zápis, který se v pohromách vyskytuje: `left` + `span` u těch,
 * co odpočítávají, a `age` + `span` u těch, co počítají nahoru. Sjednocovat
 * je zpětně by znamenalo sáhnout do každé jedné a nic tím nezískat.
 */
export function disasterProgress(active: ActiveDisaster): number | null {
  const span = active.state['span'];
  if (typeof span !== 'number' || span <= 0) return null;

  const left = active.state['left'];
  if (typeof left === 'number') return clamp01(1 - left / span);

  const age = active.state['age'];
  if (typeof age === 'number') return clamp01(age / span);
  return null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Kolik lidí už pohroma stála. Zaokrouhluje se **až tady**, ne u každé škody.
 *
 * Autor: „při katastrofách dokážeme orientačně spočítat, kolik lidí při nich
 * umřelo? Bylo by fajn to dát do té informace o katastrofě. U déletrvajících,
 * jako je epidemie, může být odhad."
 *
 * Je to schválně **odhad, a tak se to i hlásí**. Přesně vzato ví hra jen
 * u epidemie a u havárií, kolik lidí ubylo; u zbořeného domu odhaduje podílem
 * (`disasters.casualties`), kolik se jich nedostalo ven. Číslo, které vypadá
 * na jednoho člověka přesně, by tvrdilo víc, než hra ví.
 *
 * Sčítá se **ve zlomcích** a zaokrouhluje se až při čtení: malý požár, který
 * pokaždé zabije 0,4 člověka, by jinak nezabil nikdy nikoho.
 */
export function addToll(active: ActiveDisaster, dead: number): void {
  if (!(dead > 0)) return;
  active.state['dead'] = ((active.state['dead'] as number | undefined) ?? 0) + dead;
}

/** Kolik obětí si pohroma zatím vyžádala, na celé lidi. */
export function tollOf(active: ActiveDisaster): number {
  const dead = active.state['dead'];
  return typeof dead === 'number' ? Math.round(dead) : 0;
}

/**
 * Která běžící pohroma může za škodu daného druhu.
 *
 * Oheň a voda se ve hře šíří **vlastními systémy**, ne uvnitř katastrofy:
 * hoří, dokud je co, a to je tik za tikem mimo `advance`. Aby se dalo říct
 * „tenhle požár stál dvanáct lidí", musí se ta škoda někomu přiřadit — a je
 * to ta pohroma daného druhu, která běží nejdéle.
 *
 * Když žádná neběží (například oheň založený výbuchem, který mezitím
 * skončil), vrací `null` a oběti se nikam nepřipíšou. Lepší než je připsat
 * tomu, kdo za ně nemůže.
 */
export function blameFor(
  active: readonly ActiveDisaster[],
  kinds: readonly string[],
): ActiveDisaster | null {
  let oldest: ActiveDisaster | null = null;
  for (const disaster of active) {
    if (disaster.finished || !kinds.includes(disaster.kind)) continue;
    if (oldest === null || disaster.startedAtTick < oldest.startedAtTick) oldest = disaster;
  }
  return oldest;
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
