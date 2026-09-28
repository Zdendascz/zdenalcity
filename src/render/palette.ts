/**
 * Centrální definice barev. Žádná barva se nesmí objevit natvrdo jinde v kódu —
 * jinak nepůjde měnit vzhled bez lovení konstant po celém rendereru.
 */

/**
 * Index = hodnota vrstvy `terrain`: tráva, voda, písek, skála, les, mokřad.
 * Les je tmavší a sytější než tráva, mokřad kalný — musí být na první pohled
 * poznat, kde se dá stavět a kde ne.
 */
export const TERRAIN_COLORS = [
  0x6b9b4a, 0x3a6ea5, 0xd6c48a, 0x8a8a8a, 0x3f6b34, 0x6d7a55,
] as const;

/**
 * Jak silně se dlaždice odchýlí od barvy svého typu, podle typu.
 *
 * Není to jedno číslo pro všechno: **voda a skála skoro nevariují**, protože
 * na hladině vypadá zrno jako šum a skála má být hluchá plocha. Tráva, les
 * a mokřad snesou víc — a taky ho nejvíc potřebují, protože jich je na mapě
 * nejvíc a nejdřív se u nich pozná, že je to jedna barva.
 *
 * Hodnoty jsou **naměřené okem, ne odhadnuté**: první pokus měl trávu na
 * 0,075 a nebylo to na obrazovce vůbec poznat — sklon terénu sám dělá rozptyl
 * dvojnásobný, takže se v něm slabší variace ztratí. Teprve kolem dvou desetin
 * vzniknou skvrny, které vypadají jako louka a ne jako plast.
 *
 * Index = hodnota vrstvy `terrain`.
 */
export const TERRAIN_VARIATION = [
  0.18, 0.03, 0.12, 0.09, 0.2, 0.16,
] as const;

export const ZONE_COLORS = {
  residential: 0x4a90d9,
  commercial: 0x4ac97e,
  industrial: 0xd9c34a,
} as const;

/** Index = hodnota vrstvy `zone`; 0 = bez zóny, proto se nekreslí. */
export const ZONE_COLOR_BY_VALUE = [
  0,
  ZONE_COLORS.residential,
  ZONE_COLORS.commercial,
  ZONE_COLORS.industrial,
] as const;

/**
 * Zóna na povrchu je **plná barva**, ne závoj přes terén.
 *
 * Bývalo 0,4 a pod zónou prosvítala tráva. Rozhodnutí autora: „pod zónou není
 * potřeba ukazovat podklad". Zóna je plán, ne kus krajiny — a poloprůhledná
 * barva navíc mění odstín podle toho, co je pod ní, takže se stejná zóna na
 * trávě a na písku nečetla stejně.
 */
export const ZONE_OVERLAY_ALPHA = 1;

/**
 * Overlay znečištění. Jedna barva, sílu nese průhlednost — ramp přes několik
 * barev by se pletl se zónami, které jsou taky barevné.
 */
export const POLLUTION_COLOR = 0x8c4a7a;
export const POLLUTION_MAX_ALPHA = 0.8;

/** Overlay ceny půdy. Zlatá se nepere se zónami ani s vozovkou. */
export const LAND_VALUE_COLOR = 0xf0c060;

/**
 * Od jaké ceny půdy je čtvrť na tepelné mapě zelená.
 *
 * Není to 255. Cena půdy se ve zdravém městě drží hluboko pod stropem — na
 * parcelách referenčního města vycházela kolem stovky — takže na plnou stupnici
 * by byla mapa celá rudá a hráč by z ní nepoznal nic. Tahle hodnota odpovídá
 * parcele, která uživí zástavbu na nejvyšší úrovni.
 */
export const LAND_VALUE_GOOD = 160;
export const LAND_VALUE_MAX_ALPHA = 0.75;

/** Overlay kriminality. */
export const CRIME_COLOR = 0xd94f4f;
export const CRIME_MAX_ALPHA = 0.8;

/**
 * Nespokojenost. Overlay maluje **problém, ne pochvalu** — stejně jako
 * znečištění a kriminalita. Spokojená čtvrť zůstane čistá, aby bylo vidět,
 * kde se to kazí.
 */
export const HAPPINESS_COLOR = 0xd98f3f;
export const HAPPINESS_MAX_ALPHA = 0.75;

/**
 * Od jaké spokojenosti overlay přestane malovat úplně.
 *
 * Není to 255: takovou hodnotu nemá ani vzorná čtvrť, takže by mapa byla
 * pořád celá oranžová a rozdíly by se v tom ztratily. Dvoustovka odpovídá
 * čtvrti, se kterou opravdu není co řešit — a rozdíl mezi 130 a 76, tedy mezi
 * „ujde to“ a „zle“, zabere většinu stupnice.
 */
export const HAPPINESS_CLEAN_AT = 200;

/**
 * Overlay dopravy: od volné zelené po ucpanou červenou. Škála má stupně, ne
 * plynulý přechod — hráč potřebuje poznat „tady už je zle", ne odhadovat odstín.
 */
export const TRAFFIC_COLORS = [0x4caf50, 0xa8c93a, 0xe0c33a, 0xe08b3a, 0xd9483a] as const;
export const TRAFFIC_MAX_ALPHA = 0.85;

/**
 * Špendlík nad budovou služby, jejíž dosah se kreslí.
 *
 * Tmavý s bílým lemem, ne barevný podle třídy: barvu nese ikona uvnitř a
 * špendlík má být vidět nad zástavbou libovolné barvy.
 */
export const MARKER_FILL = 0x1a1d23;
export const MARKER_LINE = 0xffffff;

/**
 * Tepelná mapa diagnostických pohledů: zelená „skvělé" → rudá „strašné".
 *
 * Nahradila jednu barvu se sílou v průhlednosti. Ta měla vadu, kterou autor
 * shrnul jednou větou: „z těch pohledů znečištění, spokojenosti atd není
 * v podstatě co poznat". Fialový závoj přes město totiž říká jen „něco tu je" —
 * hráč z něj nepozná, jestli je hodnota zlá, nebo v pořádku, protože slabý
 * závoj vypadá stejně jako čistá dlaždice pod hustou zástavbou.
 *
 * Škála má **pět stupňů, ne plynulý přechod**. Hráč potřebuje poznat „tady už
 * je zle", ne odhadovat odstín; mezi stupni se interpoluje, aby nevznikly
 * schody přes celé čtvrti.
 *
 * Směr určuje každý pohled sám: u znečištění je vysoká hodnota zlá, u ceny půdy
 * dobrá. Proto se do `heatColor` nedává hodnota, ale **jak dobře na tom
 * dlaždice je**.
 */
export const HEAT_STOPS = [0xd9483a, 0xe08b3a, 0xe8d24a, 0x9fc63b, 0x3fa85c] as const;

/** Jak neprůhledná je tepelná mapa. Musí přebít terén, jinak se zase nic nepozná. */
export const HEAT_ALPHA = 0.78;

/**
 * Barva pro „jak dobře na tom je" v rozsahu 0 (strašné) až 1 (skvělé).
 *
 * Interpoluje se po složkách RGB. Není to perceptuálně správné míchání, zato je
 * to předvídatelné: mezi zelenou a žlutou nevznikne nic, co by tam nepatřilo,
 * a stupně jsou vybrané tak, aby šly rozeznat i vedle sebe.
 */
export function heatColor(goodness: number): number {
  const clamped = Math.max(0, Math.min(1, goodness));
  const scaled = clamped * (HEAT_STOPS.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(HEAT_STOPS.length - 1, low + 1);
  return mixColor(HEAT_STOPS[low] ?? 0, HEAT_STOPS[high] ?? 0, scaled - low);
}

/** Lineární míchání dvou barev po složkách. */
export function mixColor(from: number, to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const r = Math.round(((from >> 16) & 0xff) * (1 - t) + ((to >> 16) & 0xff) * t);
  const g = Math.round(((from >> 8) & 0xff) * (1 - t) + ((to >> 8) & 0xff) * t);
  const b = Math.round((from & 0xff) * (1 - t) + (to & 0xff) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Pokrytí službou. **Hranice dosahu je bílá čára**, ne jen sytější závoj.
 *
 * Autor chtěl vidět, „kam třeba dosáhne policie" — a to je otázka na hranici,
 * ne na odstín. Závoj uvnitř zůstává, aby šlo poznat i sílu pokrytí; čára říká,
 * kde to končí, a podle ní se staví další stanice.
 */
export const COVERAGE_EDGE_COLOR = 0xffffff;
export const COVERAGE_EDGE_WIDTH = 2;
/** Od jaké síly se pokrytí počítá za dostatečné. Uvnitř je druhá, tenčí hranice. */
export const COVERAGE_GOOD = 140;

/**
 * Overlay pokrytí službami.
 *
 * Sytost začíná na `COVERAGE_MIN_ALPHA`, ne na nule: reálné pokrytí se drží
 * kolem třetiny stupnice, takže čistě poměrný závoj byl na mapě sotva vidět.
 * Hráč se nejdřív ptá, **jestli** je dlaždice pokrytá, a teprve pak jak silně.
 */
export const COVERAGE_COLOR = 0x5fb6d9;
export const COVERAGE_MIN_ALPHA = 0.2;
export const COVERAGE_MAX_ALPHA = 0.62;

/** Overlay elektřiny (klávesa P): vodič s proudem a vodič bez proudu. */
export const POWER_ON_COLOR = 0xf2d857;
export const POWER_OFF_COLOR = 0xd9483a;
export const POWER_OVERLAY_ALPHA = 0.55;

/** Stěny kvádru budovy: horní plocha 100 %, levá 70 %, pravá 50 % jasu (§6). */
export const WALL_LEFT_SHADE = 0.7;
export const WALL_RIGHT_SHADE = 0.5;

/** Vozovka. */
export const ROAD_COLORS = [0x000000, 0x44454d, 0x53555f, 0x646773] as const;

/**
 * Šířka vozovky podle typu; podíl dlaždice, index = hodnota vrstvy `road`.
 *
 * Doopravdy šířka, ne délka ramen. Do T88 tahle čísla řídila jen to, jak moc
 * se zmenší středový kus, kdežto rameno leželo přes celou hranu dlaždice —
 * silnice pak byla široká jako dlaždice bez ohledu na typ a obrubník se pod ni
 * schoval. Po opravě `roadPolygons` je to pruh té šířky a zbytek dlaždice
 * zůstane travnatý, takže je poznat, kde silnice končí a kde začíná parcela.
 *
 * Zbývá místo na obrubník: k šířce se ještě přičte `KERB`, takže i dálnice
 * s 0,75 nechá kus dlaždice volný.
 */
export const ROAD_WIDTHS = [0, 0.38, 0.55, 0.75] as const;

/**
 * Obruba kolem vozovky. Světlejší než asfalt, ale ne bílá — je to beton.
 *
 * Kreslí ji renderer jako širší kopii tvaru pod vozovkou, ne obrázek: obrubník
 * musí navazovat přes hranici dlaždice a to generátor netrefí.
 */
export const KERB_COLOR = 0xa8a89e;

/** Barva ulice. Starší kód a testy se odkazují na ni. */
export const ROAD_COLOR = ROAD_COLORS[1];

/**
 * Most je světlejší než vozovka na souši — na tmavé vodě by splynul, a hráč
 * musí poznat, kde silnice opouští břeh (§7 fáze 3).
 */
export const BRIDGE_COLOR = 0x8d8f99;

/**
 * Podzemní pohled (§8 fáze 3). Terén se ztlumí na desetinu jasu, aby se
 * potrubí nemuselo prát s barvami trávy a vody — pod zemí je stejně tma.
 */
/**
 * Podezdívka pod budovou na svahu. Kámen, ne barva domu — je to terénní úprava
 * a hráč má poznat, že dům nepovyrostl, jen se podezdil.
 */
export const FOUNDATION_COLOR = 0x8a8378;

export const UNDERGROUND_TERRAIN_SHADE = 0.35;

/**
 * Obrysy povrchu v podzemním pohledu.
 *
 * Bez nich byla pod zemí jen tmavá plocha a hráč neměl podle čeho vést
 * potrubí — nepoznal, kde má silnici, kde zónu a kde dům. Jsou schválně
 * **matné**: mají sloužit k orientaci, ne přebít trubky, kvůli kterým se
 * pod zem přepíná.
 */
export const UNDERGROUND_ROAD_COLOR = 0x000000;
export const UNDERGROUND_ROAD_ALPHA = 0.35;
export const UNDERGROUND_BUILDING_COLOR = 0xd8d8dc;
export const UNDERGROUND_BUILDING_ALPHA = 0.22;
export const UNDERGROUND_ZONE_ALPHA = 0.18;
/** Potrubí. Modrá jako voda, ale světlejší, ať je vidět na tmavém terénu. */
/**
 * Trubka, ve které teče voda.
 *
 * Suchá má vlastní barvu, a je to důležitější, než se zdá: hráč natáhne
 * potrubí, ono nikam nedosáhne — protože je moc dlouhé nebo nevede ke zdroji —
 * a na obrazovce to vypadá úplně stejně jako fungující síť. Hlásil to autor.
 */
export const PIPE_COLOR = 0x67b6e8;
/**
 * Zaplavená dlaždice. Modrý závoj, jehož sytost roste s hloubkou — hráč musí
 * poznat, kde je po kotníky a kde po pás, protože podle toho se rozhoduje,
 * kterou čtvrť odepsat.
 */
export const FLOOD_COLOR = 0x2f6f9e;
export const FLOOD_MIN_ALPHA = 0.35;
export const FLOOD_MAX_ALPHA = 0.75;
/** Nad tuhle hloubku už se závoj nesytí — pár pater by jinak vyšlo neprůhledně. */
export const FLOOD_FULL_DEPTH = 3;

/**
 * Trosky. Šedivá suť, která musí být poznat od prázdné dlaždice — je to
 * překážka, ne kosmetika, a hráč na ni musí poslat buldozer.
 */
/**
 * Trosky po katastrofě.
 *
 * **Hnědá, ne šedá.** Šedý závoj přes dlaždici vypadal skoro stejně jako
 * asfalt: autor se ptal, kam se poděly silnice, a přitom koukal na sutinu
 * z tornáda. Rozvalený dům má být poznat od vozovky na první pohled, takže
 * je teď rezavě hnědý a méně krycí — pod ním prosvítá terén.
 */
export const RUBBLE_COLOR = 0x8a6a4a;
export const RUBBLE_ALPHA = 0.72;

/**
 * Značka na troskách po budově: symbol toho, co tu stálo, v barvě poplachu.
 *
 * Nahlásil autor: po vyhořelém městě se nedalo poznat, co kde bylo. Hromada po
 * nemocnici vypadala stejně jako hromada po hasičárně, takže z obnovy bylo
 * hádání — a přitom právě u služeb je rozdíl, kterou postavit dřív.
 */
export const RUBBLE_MARK_COLOR = 0xe86b6b;
export const RUBBLE_MARK_ALPHA = 0.95;

/**
 * Oheň. Škála od doutnání k plamenům — hráč musí na první pohled poznat, kde
 * hoří nejvíc, protože právě tam se rozhoduje, jestli dům shoří.
 */
export const FIRE_COLORS = [0xd94f2a, 0xe8732b, 0xf2a03a, 0xffd257] as const;
/** Nejnižší průhlednost plamene, aby bylo pořád vidět, co hoří. */
export const FIRE_MIN_ALPHA = 0.45;
export const FIRE_MAX_ALPHA = 0.9;

export const PIPE_DRY_COLOR = 0x7b7f86;
/** Šířka trubky jako podíl dlaždice. Užší než vozovka — je to trubka. */
export const PIPE_WIDTH = 0.24;
/** Nádech na dlaždicích, kam voda opravdu dotekla. */
export const WATER_SUPPLY_COLOR = 0x2f7fb8;
export const WATER_SUPPLY_ALPHA = 0.4;
/** Mantinel mostu. Kreslí se přes celou dlaždici, ať je konstrukce vidět. */
export const BRIDGE_RAIL_COLOR = 0xb4b7c2;

/** Pozadí mimo mapu. */
/**
 * Čtvercová síť po rozích dlaždic.
 *
 * Dvě barvy, protože pod zemí a nad zemí je pozadí opačné: na trávě a na
 * silnici je vidět černá, nad tmavým podzemním pohledem bílá. Vyžádal si to
 * autor a je to totéž rozhodnutí jako u bílé hranice mapy dosahu — linka musí
 * mít kontrast proti tomu, přes co leží, ne jednu barvu napořád.
 */
export const GRID_COLOR_SURFACE = 0x000000;
export const GRID_COLOR_UNDERGROUND = 0xffffff;
/**
 * Slabě schválně. Síť je pomůcka na zarovnání, ne kresba: v plné sytosti
 * překreslí terén a z města je milimetrový papír.
 */
export const GRID_ALPHA = 0.35;
/** Šířka v pixelech obrazovky. Dělí se měřítkem, aby při přiblížení netloustla. */
export const GRID_WIDTH = 1;

export const BACKGROUND_COLOR = 0x14161a;

/** Zvýraznění dlaždic pod kurzorem — u větších budov celý půdorys. */
export const HOVER_COLOR = 0xffffff;
export const HOVER_FILL_ALPHA = 0.18;
export const HOVER_LINE_ALPHA = 0.9;

/** Půdorys, kam se stavba nevejde. */
export const HOVER_BLOCKED_COLOR = 0xff6b52;

/**
 * Opuštěná budova. Šedý kvádr snížený na jednu úroveň (§8 zadání fáze 2) —
 * ruinu musí být poznat na první pohled, ne až z detailu.
 */
export const ABANDONED_COLOR = 0x6a6a6a;

/**
 * Prach při bourání (T114). Teplá šedá omítky a cihel, ne bílá — bílý obláček
 * se na zelené trávě čte jako kouř z požáru.
 */
export const DUST_COLOR = 0xb9ab96;

/**
 * Ztmavení budovy, která bere proud a nedostává ho. Ke střeše k tomu přibude
 * blesk v `POWER_OFF_COLOR` — jinak hráč pozná temnou budovu jen z detailu.
 */
export const UNPOWERED_SHADE = 0.5;

/** Symbol na střeše budovy. Světlé budovy dostanou tmavý, ostatní tenhle. */
export const ICON_COLOR = 0xffffff;
export const ICON_ALPHA = 0.9;

/**
 * Vnímaný jas barvy v rozsahu 0–1. Používá se k rozhodnutí, jestli na budovu
 * patří světlý, nebo tmavý symbol — jinak by na bílé klinice zmizel.
 */
export function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Násobitel pro hranu dlaždice — jemné odsazení sousedních diamantů. */
export const TILE_EDGE_SHADE = 0.82;

/**
 * Vynásobí složky barvy faktorem. `factor < 1` ztmavuje, `> 1` zesvětluje.
 * Slouží i pro stěny kvádrů budov (100 / 70 / 50 % jasu) od T5.
 */
export function shade(color: number, factor: number): number {
  const r = clampChannel(((color >> 16) & 0xff) * factor);
  const g = clampChannel(((color >> 8) & 0xff) * factor);
  const b = clampChannel((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
