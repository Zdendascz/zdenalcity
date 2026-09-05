# Diagnostické pohledy

Autor po odehrání napsal: „z těch pohledů znečištění, spokojenosti atd není
v podstatě co poznat… musí tam být dva pohledy: tepelná mapa se stavem od
zelené — skvělé až po rudou — strašné a pak dosahový pohled, kde budou bílé
hranice, kam třeba dosáhne policie… ať člověk ví, co má dělat."

Tenhle dokument popisuje, co z toho vzniklo a proč přesně takhle.

## Co bylo špatně

Do T90 kreslil `CoarseOverlay` **jednu barvu, jejíž sílu nesla průhlednost**.
Znečištění fialově, kriminalita červeně, spokojenost oranžově. Mělo to tři vady
naráz:

1. **Slabá hodnota vypadala jako žádná.** Čtvrť se znečištěním 60 z 255 byla
   sotva vidět a od čisté louky se nedala rozeznat.
2. **Nebylo poznat, který konec je dobrý.** Fialový závoj nad městem říká „něco
   tu je", ne „tady je zle a tam ne".
3. **Barva se mísila s terénem pod sebou**, takže tatáž hodnota vypadala jinak
   na trávě a jinak na písku.

## Tepelná mapa

Pět stupňů od rudé po zelenou (`HEAT_STOPS` v paletě), mezi nimi se interpoluje.
Neprůhlednost 0,78 — musí přebít terén, jinak se vrací vada číslo tři.

**Směr si určuje každý pohled sám.** Do overlaye se nedává hodnota, ale
`goodness`, tedy „jak dobře na tom čtvrť je" v rozsahu 0–1:

| pohled | goodness | proč |
|---|---|---|
| znečištění | `1 − v/255` | vysoká hodnota je zlá |
| kriminalita | `1 − v/255` | totéž |
| spokojenost | `v / HAPPINESS_CLEAN_AT` | 200 je čtvrť, se kterou není co řešit |
| cena půdy | `v / LAND_VALUE_GOOD` | 160 uživí zástavbu na nejvyšší úrovni |
| riziko | `1 − v/255` | vysoké riziko je zlé |

Cena půdy i spokojenost mají **vlastní strop, ne 255**. Na plnou stupnici by
byla mapa ceny půdy celá rudá i ve zdravém městě — reálné hodnoty se drží
hluboko pod maximem.

Kreslí se **jen tam, kde město je** (buňka s budovou nebo silnicí). Nula je
u většiny veličin ten nejlepší možný stav, takže by se jinak natřely zeleně
i lesy a hory a hráč by v tom čtvrť nenašel.

## Mapa dosahu

Pro pokrytí službami. Odpovídá na jinou otázku než tepelná mapa — ne „jak je na
tom čtvrť", ale „kam ta stanice dosáhne" — a ta otázka je o **hranici**, ne
o odstínu.

- **plocha**: modrý závoj, sytost roste s pokrytím. Začíná na `COVERAGE_MIN_ALPHA`,
  ne na nule: reálné pokrytí se drží kolem třetiny stupnice a čistě poměrný
  závoj byl sotva vidět.
- **vnější bílá čára**: konec dosahu. Kreslí se po hranách buněk mezi pokrytou
  a nepokrytou, ne obtahem každé buňky — obtah by udělal mřížku přes celou
  oblast.
- **vnitřní tenčí čára**: hranice dostatečného pokrytí (`COVERAGE_GOOD = 140`).
  Podle ní se pozná, kde stanice sotva dosahuje a kde doopravdy funguje.

## Legenda

Bez ní je barevná mapa hádanka, takže se kreslí vlevo nad lištou nástrojů, a to
**jen když je pohled zapnutý**. Konce stupnice se pojmenovávají podle veličiny
(„čisto"/„zamořeno", „bezcenná"/„drahá"), ne obecným „dobře"/„zle" — obecný
popisek hráči neřekne, na co se dívá.

## Riziko katastrof

Nový pohled. Autor: „co se týká nepřírodních katastrof, tak tam, kde hrozí
s vysokou mírou pravděpodobnosti, může být nějaké to varování."

Počítá `computeRiskMap` v `sim/disasters/riskMap.ts`. **Přírodní katastrofy se
do něj nepočítají** — zemětřesení ani tornádo nezávisí na tom, co hráč postavil,
takže varování před nimi by nenesla radu.

Skládá se **maximem přes druhy, ne součtem**: odpověď na „co mi tady hrozí" je
jedna konkrétní věc, kterou má hráč řešit. Součet by ve čtvrti se třemi drobnými
riziky ukázal poplach a ve čtvrti s jedním vážným klid.

Váhy jsou tytéž, podle kterých si vybírá místo plánovač — kdyby se rozešly, hráč
by hlídal jinou čtvrť, než na kterou katastrofa doopravdy padne:

| druh | co ho přitahuje |
|---|---|
| požár | hořlavost nejhořlavější dlaždice × (1 − hasiči) × (1 + kriminalita × 0,8) |
| nepokoje, válka gangů | kriminalita × (1 − policie) |
| stávka | nespokojenost **pod neutrálem**, umocněná |
| hromadná nehoda | zatížení nejvytíženější silnice × (1 − zdravotnictví) |
| průmyslová a chemická havárie | těžký provoz v buňce × (1 − hasiči) |
| epidemie | hustota obyvatel × (1 − zdravotnictví) |

**Dvě věci se cestou naměřily a opravily:**

- Hořlavost se nejdřív brala jako **průměr přes buňku** a bylo to špatně. Požár
  začíná na jedné dlaždici a plánovač si ji váží její vlastní hořlavostí; průměr
  ho zředil loukou okolo, takže zastavěná čtvrť bez hasičů vyšla níž než holá
  louka na riziko stávky. Bere se maximum.
- Nespokojenost se počítá **od neutrálu dolů**, ne z plné stupnice. Průměrná
  čtvrť není důvod ke stávce; jinak hlásila mapa 63 z 255 nad každým městem hned
  po založení.

Práh `RISK_WARNING = 150` je změřený na městě autora (7 446 obyvatel, 140
obydlených buněk): medián 89, horní kvartil 200, devátý decil 213, maximum 227.
Odděluje tedy zhruba nejhorší třetinu. Nejčastější hrozbou tam byl požár
(87 buněk), pak hromadná nehoda (40).

Nad prahem se v **kartě parcely** objeví věta „Pozor: v téhle čtvrti hrozí …".
Číslo se neukazuje: hráč nepotřebuje vědět, že riziko je 187, potřebuje vědět,
že tam chybí hasiči.

## Ikony běžících pohrom

Vedle hodin, jedna na každou právě běžící katastrofu. Souběh je normální stav —
hoří a zároveň se stávkuje — takže je to řada, ne jedna ikona.

Klik otevře **tutéž kartu, která přišla při vzniku**, a hru zastaví. Do T90
nebyla cesta zpátky: kdo hlášení zavřel, neměl jak zjistit, co se vlastně děje
ani kde.

Řada se přestavuje jen tehdy, když se změnila. Kdyby se překreslovala každý
snímek, tlačítko pod kurzorem by se každých šestnáct milisekund vyhodilo
a nešlo by na ně kliknout.

## Délka herního dne

Při rychlosti 1× trvá **sekundu**, ne čtvrt (`TICK_MS`). Autor: „letí to strašně
rychle, člověk nestíhá nic udělat." Herní rok tak zabere šest minut při 1×
a tři čtvrtě při 8×.

Mění to **jen tempo v reálném čase**, ne simulaci: systémy počítají na tiky,
takže město za tisíc dní vyjde stejně jako dřív a zlaté testy se nehnuly.

## Dosah služeb je v dlaždicích

Autor: „mám ve městě jednu nebo dvě hasičské stanice a dosah přes 3/4 mapy!!!!
to je strašně moc!"

Byl. `service.radius` z obsahu se bral **jako počet buněk hrubé mřížky**, a ta
má čtyři dlaždice na stranu — hodnota 10 tedy platila čtyřicet dlaždic daleko.
Velká zbrojnice se šestnácti pokryla mapu celou.

Čísla v obsahu zůstala; změnila se jednotka, ve které se čtou. `addCoverage` si
je teď dělí `COARSE_FACTOR`, takže „dosah 10" znamená deset dlaždic — tak, jak
to člověk při psaní definice myslí.

| budova | dřív | teď |
|---|---|---|
| hasičská zbrojnice | 40 dlaždic | 10 dlaždic |
| velká zbrojnice | 64 dlaždic | 16 dlaždic |
| policejní stanice | 48 dlaždic | 12 dlaždic |
| nemocnice | 64 dlaždic | 16 dlaždic |

Chytil to test kritéria 6 („podfinancovaní hasiči hoří déle"), který byl na
starý dosah postavený: les šest dlaždic od zbrojnic měl pokrytí 68 z 255 a
požár shořel na palivo za 31 tiků bez ohledu na financování. S lesem hned u
zbrojnic vychází 41 tiků proti 65 — rozdíl je zpátky, jen se odehrává na
menší ploše.

## Značky nad budovami služby

Autor u mapy dosahu dodal: „takhle já vůbec netuším, kde tu hasičskou stanici
mám." Mapa pokrytí ukazuje kruh, ale ne jeho střed.

Když je zapnutá mapa dosahu, nad každou budovou té třídy se objeví špendlík
s toutéž ikonou, jakou nese přepínač vrstvy. Kreslí se **nad budovami**, ne na
střeše: střešní symbol zapadne mezi domy stejné výšky a při oddálení zmizí.

Tepelné mapy značky nemají — ukazovaly by na budovu, která s tou veličinou
nemusí souviset.

## Odmítnutí říká proč

Autor u hlášky „Na tenhle terén se to postavit nedá" napsal: „pokud něco nejde,
měl by systém také říct proč".

Odmítnutí, která to teď nesou:

| dřív | teď |
|---|---|
| Na tenhle terén se to postavit nedá. | Nejde to — tady je skála. Povolený povrch: tráva, písek. |
| Musí sousedit se silnicí. | Musí sousedit se silnicí. Nejbližší je o 2 dlaždice dál. |
| (totéž, když silnice nikde není) | …a široko daleko žádná nevede. Dovez sem cestu. |
| Celý půdorys musí ležet ve stejné zóně. | …v jedné zóně: obytná zóna. Tady je nezónovaná půda. |
| Potřebuje připojení k proudu. | …Dotáhni sem silnici nebo vedení od elektrárny — po silnici teče proud taky. |
| Na tenhle terén… (na vodě) | Na vodu se stavět nedá. Nejdřív most nebo jiná parcela. |

Jména terénů a zón předává simulace jako **lokalizační klíče**, ne jako text
(§10). `I18n.t` je umí přeložit i po **čárkami odděleném seznamu** — bez toho by
seznam povolených povrchů znamenal tolik variant hlášky, kolik má hra povrchů.

Terén má na to vlastní sadu klíčů `ui.terrain.plain.*`. Karta parcely jméno
vypisuje samostatně („Tráva"), hláška ho vkládá doprostřed věty — a čeština si
tam žádá jiný tvar. Věty jsou proto schválně skládané tak, aby vystačily
s prvním pádem: „tady je skála", ne „na skálu".

Vzdálenost k silnici se hledá jen do šesti dlaždic od půdorysu. Dál už není co
poradit a průchod celou mapou při každém odmítnutém kliknutí by hru zdržoval.

## Obrázek trosek

Autor o ploché olivové výplni, která po zbouraném domě zbývala: „místo toho
hrůzného nesmyslu, co je teď". Vypadala jako zorané pole uprostřed města.

Suť je teď **materiál jako povrch terénu**: vyplní se jí polygon dlaždice
s maticí, otočený podle souřadnic, aby přes velké spáleniště nešel vidět pruh.
Barva zůstává **pod** obrázkem — když se textura nedokreslí, má tam zbýt suť,
ne díra.

Vlastní setter `setRubble`, ne položka v `setSurfaces`: trosky nejsou druh
terénu, jsou vrstva nad ním. Kdyby se vydávaly za terén, musela by se kvůli nim
rozšířit `TERRAIN` a save by nesl hodnotu, která do něj nepatří.

## Katastrofy na ulici mají obrázek

Hromadná nehoda a nepokoje se odehrávají na silnici a mapa o nich mlčela — hráč
viděl jen ikonu u hodin. Autor navrhl totéž co u trosek: „u nepokojů izometrický
obrázek protestujících na ulici".

Jsou to **vystřižené objekty s kotvou**, ne dlaždice: `riot_crowd` a
`pileup_wreck`, tři varianty na druh. Varianta se vybírá **podle id
katastrofy**, takže dvě nehody vedle sebe nevypadají jako jedna a při
překreslení se obrázek nemění.

Kreslí se **nad silnicí a pod domy**: dav stojí v ulici, ne na střeše, a
zároveň nemá zmizet za prvním barákem. Přiřazení druh → obrázek je tabulka
v `app.ts`, takže mod se svou katastrofou ji dostane nakreslenou zadarmo (P5).

Přírodní katastrofy sem nepatří: nemají jedno místo, mají plochu, a tu už
kreslí vlastní vrstvy.

## Dvojí akce jedním klikem

Autor: „velmi zhusta se mi stává, že při změně výšky povrchu jednou kliknu a
provedou se dvě akce".

Bylo to takhle: malování tažením se ptalo jen „je pod kurzorem jiná dlaždice než
minule". Jenže zvednutí rohu **posune terén o patro nahoru**, takže pod nehybnou
myší je najednou jiná dlaždice — a stačí nepatrné cuknutí při kliku, aby se
zvedlo dvakrát.

Podmínky jsou proto dvě: jiná dlaždice **a** skutečný posun ukazatele aspoň
o deset pixelů. Táhnutí štětcem to nezdrží — deset pixelů je zlomek dlaždice.

## Rovná se na dlaždici, kde tah začal

Autor: „srovnání terénu musí nezbytně fungovat tak, že terén se rovná dle
dlaždice, od níž začalo rovnání. Vezmu dlaždici a táhnu, okolní nižší se
zvednou, vyšší se sníží."

Do T92 si každá dlaždice počítala **vlastní průměr**, takže se svah po tahu jen
rozmazal — výsledek byl zase svah, jen mírnější. Výška se teď zapíše při stisku
z dlaždice pod kurzorem a drží se do puštění, takže celý tah dá jednu rovinu.
`planLevelArea` cílovou výšku uměl přijmout už dřív; chybělo ji tam dostat.

## Ceny

Rozhodnutí autora: bourání ×10, výstavba ×3, silnice a vodovod ×5.

| co | dřív | teď |
|---|---|---|
| ulice / třída / dálnice | 10 / 40 / 120 | 50 / 200 / 600 |
| most | 150 | 750 |
| trubka | 6 | 30 |
| vodárna, úpravna, čerpací stanice | ×1 | ×5 |
| ostatní budovy | ×1 | ×3 |
| úklid trosek | 25 | 250 |
| vykácení lesa / odtěžení skály / zavezení mokřadu | 12 / 60 / 40 | 120 / 600 / 400 |

**Startovní kapitál vyrostl taky, na 60 000.** Není to změkčení: uhelná
elektrárna sama stojí 24 000 z původních 20 000, takže by nešlo město vůbec
založit. Příjmy se nezvedly, takže trojnásobek dál kouše — jen ne hned v první
minutě.

Bourání budovy a silnice je pořád **zdarma** a desetinásobek na tom nic nemění;
zdražilo se všechno, co dnes za bourání něco stojí. Jestli má demolice domu
stát peníze, je to nová mechanika, ne změna čísla.

## Zpustlá zástavba, suť a velikost scén

Tři věci z jednoho kola připomínek.

**Scény katastrof byly moc velké.** Dav i hromadná nehoda měly půdorys dvě
dlaždice na dvě, takže se přes tři baráky roztáhly a vypadaly jako obří. Autor:
„zmenši to na velikost ulice, dodrž perspektivu". Jsou teď na jednu dlaždici
(`DECOR` ve `fit-sprites.py`) a doladěné podílem: dav 0,85 dlaždice, nehoda
0,95, protože náklaďák je delší než auto. Zmenšuje se **celý obrázek**, ne jen
jeho šířka — roztažením by se rozešla izometrie.

**Suť má obrázky, ne jen texturu.** Textura zůstala jako rozrytá zem; na ni se
posadí hromada `rubble_pile` (tři varianty, vybírá se ze souřadnic, takže se
při překreslení nepřeskládá). Autor předtím: „u těch rozbitých věcí místo té
textury udělej obrázky".

**Zpustlá budova není šedý kvádr.** Dostala obrázek podle **kategorie**:
`derelict_residential` (slum), `derelict_commercial` (mrtvá provozovna),
`derelict_industrial` (brownfield). Jeden na kategorii, ne jeden na každý
půdorys — renderer ho posadí doprostřed parcely a **zmenší**, když je parcela
menší. U ruiny stejně nikdo nepozná, jak velký dům tam stál, a devět obrázků
tak nahradí třicet. Kategorie bez záznamu (služby, elektrárny) zůstávají
u kvádru: opuštěná nemocnice je vzácnost.

Hromady suti nesou **záporná id posunutá o velikost mapy**, aby se nesrazila
s id stromů — obojí bydlí v téže mapě uzlů a řadí je totéž porovnání hloubky.

## Keš service workeru

Produkce nahlásila dvě věci:

1. `CACHE = 'zdenalcity-v1'` zůstávalo přes dvě nasazení, takže se stará keš
   neuklízela a nabalovala sprity ze všech verzí. Ručně číslovaná verze funguje
   jen do prvního zapomenutí, takže se **razítkuje při buildu**: plugin
   `stampServiceWorker` ve `vite.config.ts` nahradí v `dist/service-worker.js`
   zástupný text hashem commitu a datem. Ve vývoji zástupný text zůstane a
   nevadí — `vite dev` worker neregistruje.
2. `service-worker.js` chodí s `max-age=14400`. To je u workeru nejhorší možná
   hodnota: prohlížeč si nový vezme až za čtyři hodiny. V buildu je od té doby
   `public/.htaccess`, které workeru, `index.html` a manifestu nastaví
   `no-cache` a assetům s hashem naopak rok. Zabere jen s `AllowOverride
   FileInfo`; před Apachem si navíc TTL řídí Cloudflare sám a potřebuje vlastní
   Cache Rule. Postup na ověření je v `docs/DEPLOY.md`.

## Čtvercová síť

Autor: „tlačítko pro vypnutí a zapnutí čtvercové sítě. v podzemí bílé linky na
povrchu černé. Když v podzemí linky zapnu, musím zůstat v podzemí a naopak."

V izometrii není poznat, kde jedna dlaždice končí a druhá začíná, dokud na ni
nenajedeš myší — a na telefonu ani pak. Síť to řekne.

**Kopíruje terén**, není to mřížka přes obrazovku. Vede přes rohy dlaždic i s
jejich výškami, takže na svahu jde s kopcem. Rovná mřížka by lhala přesně tam,
kde je zarovnání nejtěžší.

Barva se řídí **pohledem, ne přepínačem**: na povrchu černá, pod zemí bílá.
Je to totéž rozhodnutí jako u bílé hranice mapy dosahu — linka musí mít kontrast
proti tomu, přes co leží.

Přepnutí sítě **pohledem nehne**. Není to nástroj, je to zobrazení, takže
`gridOverlay.ts` nikde nevolá `setView`. Opačný směr platí taky: přepnutí
pohledu síť nezhasne, jen jí změní barvu.

Leží **nad zemí a pod domy**, ze stejného důvodu jako vozovka: je to hranice
pozemku, ne kresba přes město. V podzemním pohledu jsou domy schované, takže
tam je vidět celá.

### Kdy se překresluje

Jen ze tří důvodů: změnil se terén, hráč odjel o blok jinam, nebo se změnilo
měřítko (šířka čáry se jím dělí, aby zůstala vlasová).

Změnu terénu hlásí **vlastní příznak** `DirtySet.heightsChanged`, ne `tiles`.
Zóna, silnice i vyrostlý dům špiní dlaždice, ale s výškami nehnou — a
překreslovat kvůli nim síť by znamenalo přestavět ji několikrát za sekundu
v každém živém městě. Nastavuje se na jediném místě, v `applyReshape`, kudy
jde každá změna terénu.

Posun se měří **po blocích osmi dlaždic**, jinak by se síť přestavovala každý
snímek tažení. Osm je velikost chunku — stejná úvaha, stejné číslo.

### Co to stojí

Kreslí se **lomené čáry po celých řadách**, ne úsečka na každou hranu: úseček je
stejně, ale cesta je jedna na řadu místo jedné na dlaždici. Při pohledu na celou
mapu je to 258 cest místo 33 tisíc.

Změřeno na mapě 128×128 (`node`, celý výřez, 50 běhů): sestavení geometrie
**0,26 ms** na 33 282 bodů; běžný výřez 32×32 dlaždic 0,008 ms. Tesselace
v Pixi změřená není — v prohlížeči se to při plném oddálení kreslí bez zadrhnutí
a mezní případ je jediný snímek po zapnutí, takže se strop podle měřítka
nezaváděl.

## Předměty na zemi: suť, stromy, scény katastrof

Všechny tři stojí na terénu a všechny tři si výšku braly po svém — a všechny
tři špatně. Autor to hlásil jako „zbořeniny v kopcích jsou úplně mimo".

| co | bralo | chyba |
|---|---|---|
| suť a stromy | zaokrouhlený průměr rohů dlaždice | až půl úrovně (8 px) ze zaokrouhlení a k tomu posun uvnitř dlaždice, pod kterým je jiná výška |
| scéna katastrofy | **nejvyšší** roh | až celá úroveň (16 px) nad zemí |

Správně je jedno pravidlo pro obojí: **výška terénu přesně v tom bodě, kde
předmět stojí**, tedy `groundHeightAt(fx, fy)`. Ta leží mezi nejnižším
a nejvyšším rohem sama od sebe, takže se nemusí vybírat, ke kterému se
přiklonit.

Předmět se uvnitř dlaždice posouvá až o třetinu (`decorShift`), takže na to
místo se musí ptát se stejným posunem, s jakým se pak kreslí.

## Obrázek požáru

Požár měl do T97 na mapě jen **oranžový nádech dlaždice**. Autor to nahlásil
slovy „ilustrace požáru není vůbec": u nepokojů a hromadné nehody obrázek je,
u ohně — nejčastější pohromy ze všech — nebyl.

`fire_blaze`, tři varianty, jeden objekt pro **domovní i lesní požár**. Plameny
a kouř vypadají stejně, ať hoří střecha nebo smrk, a dvě sady by se lišily jen
tím, co je pod nimi — a to obrázek stejně přinést nesmí, jinak by pod ním
zmizela zem.

Velikost je jedna dlaždice na 0,9 (`DECOR_SHARE`), ale **dvě patra vysoký**:
plamen jde vzhůru, ne do šíře, a nízký by nad hořící střechou nebyl vidět.
Zadání je v `docs/08-DLAZDICE.md`, oddíl „Katastrofy na ulici".
