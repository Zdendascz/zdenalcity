# Progress

## Hotovo
- [x] T0 — toolchain, ESLint hranice, negativní test hranic

Ověřeno:
- `npm run check` prochází (lint + typecheck + 8 testů)
- `npm run dev` naběhne, servíruje prázdnou stránku (HTTP 200 na `/` i `/src/main.ts`)
- `tests/boundaries.test.ts` prochází a při zakomentování `no-restricted-imports`
  v `eslint.config.js` skutečně selže (ověřeno experimentálně, ne odhadem)
- alias `@/*` funguje ve Vite i ve Vitestu

- [x] T1 — jádro simulace (`rng.ts`, `layers.ts`, `world.ts`, `commands.ts`, `simHost.ts`, registr systémů)

Vzniklo:
- `src/sim/rng.ts` — Mulberry32 s `getState`/`fromState`
- `src/sim/layers.ts` — `MAP_SIZE`, `index`, `inBounds`, `createLayers`, `hashLayers` (FNV-1a),
  `ReadonlyLayers`, hodnoty vrstev `TERRAIN` / `ZONE`
- `src/sim/world.ts` — `WorldState`, `Building`, `DirtySet`, `createWorld`, `tickWorld`, značkovače dirty
- `src/sim/commands.ts` — `Command` union podle architektury §5 (typy, bez obsluhy)
- `src/sim/simHost.ts` — `SimHost` (`dispatch`/`step`/`getSnapshot`/`consumeDirty`), akumulátor, rychlosti
- `src/sim/systems/` — registr `System` + `shouldRun`, čtyři prázdné registrace (power, demand, growth, economy)

Ověřeno (`npm run check`, 5 souborů / 40 testů):
- determinismus: 2× stejný seed, 1000 tiků → identický `hashLayers` i `rng.getState()`;
  kontrolní případ s jiným seedem dává jiný výsledek
- determinismus přes `SimHost`: stejná posloupnost `set_speed` + `step` → identické vrstvy
- RNG stabilita: prvních 10 hodnot ze seedu 12345 proti hardcoded snapshotu
- akumulátor: `step(1000)` při 1× = přesně 4 tiky, přenos zbytku, pauza netiká,
  8× zastropováno na `MAX_TICKS_PER_FRAME`, po zastropování se skluz zahodí
- fázování: systém `interval: 12, offset: 2` běží na ticích 2, 14, 26
- `ReadonlyWorldView` je vynucen typovým systémem — zápis do `snapshot.layers` je
  chyba při typecheku, hlídáno přes `@ts-expect-error` v `tests/simHost.test.ts`
- `hashLayers` reaguje na změnu jediné dlaždice, rozliší vrstvu, v níž změna nastala,
  a nezahazuje horní bajt `Uint16` vrstvy

Ověřeno experimentálně, že testy skutečně chytají (stejný postup jako u T0):
- `shouldRun` zbavený offsetu → test fázování selže (`[12, 24]` místo `[2, 14, 26]`)
- přidání nové varianty do `Command` → `npm run typecheck` selže na `assertNever`
  v `dispatch` (TS2345), takže nový příkaz nejde tiše přehlédnout
- změna konstanty v `Rng.next()` → selže jen test stability RNG. Determinismus test
  projde dál, protože porovnává dva běhy téhož algoritmu — proto ten hardcoded
  snapshot existuje, samotný determinismus změnu algoritmu nezachytí.

- [x] T2 — renderer a kamera

Vzniklo:
- `src/render/projection.ts` — `TILE_W/H`, `LEVEL_H`, `gridToScreen`, `screenToGrid`, `diamondPoints`
- `src/render/camera.ts` — čistý stav (`x`, `y`, `zoom`), `pan`, `zoomAt`, clamp 0.25–4
- `src/render/picking.ts` — `pickTile`, jediné místo spojující kameru s inverzní projekcí
- `src/render/chunkRenderer.ts` — terén po chuncích 16×16 do `RenderTexture`, překreslení jen podle `DirtySet`
- `src/render/palette.ts` — `TERRAIN_COLORS`, `ZONE_COLORS`, `shade`
- `src/render/debugOverlay.ts`, `src/render/app.ts`, `src/style.css`, napojení v `src/main.ts`

Ověřeno (`npm run check`, 6 souborů / 56 testů) a měřením v běžícím dev serveru:
- `screenToGrid` je přesná inverze `gridToScreen` pro všechny testované dlaždice
- zoom drží bod pod kurzorem na místě (jednotkově i end-to-end přes `wheel` událost:
  bod (60, 2088) zůstal identický při změně 1,00× → 1,15×)
- `pan` posouvá o stejný počet světových jednotek nezávisle na zoomu; tažení pravým
  tlačítkem o 100/50 px při zoomu 1,15× posunulo kameru přesně o −86,96/−43,48
- hover picking: kurzor na (700, 400) → overlay hlásí `tile 66, 64`, což odpovídá
  nezávisle dopočítané dlaždici
- terén se skutečně kreslí: plocha má `#6b9b4a` (= `TERRAIN_COLORS[0]`), hrana
  `#587f3d` (= `shade` téže barvy)
- **výkon při plném oddálení (zoom 0,25): medián 0 ms, maximum 0,1 ms na snímek.**
  60 FPS s velkou rezervou, 64 chunků = 64 sprity

- [x] T3 — silnice, dirty tracking, herní smyčka

Vzniklo:
- `src/sim/commands.ts` — `buildRoad` / `bulldoze` včetně validace (mimo mapu, voda,
  opakovaná stavba, bourání prázdné dlaždice) a značkování 4 sousedů do `DirtySet`
- `src/render/roads.ts` — bitmask sousedů (N=1, E=2, S=4, W=8) a geometrie vozovky;
  16 variant vzniká skládáním středového kusu a ramen, ne tabulkou
- `src/render/chunkRenderer.ts` — kreslení silnic nad terénem
- `src/render/app.ts` — herní smyčka (`step` → `consumeDirty` → překreslení),
  stavba levým tlačítkem, bourání pravým, rychlost klávesami 0–4
- `tests/golden/roads.test.ts` — golden test se snapshotem hashe vrstev

Ověřeno (`npm run check`, 8 souborů / 74 testů) a měřením v běžícím rendereru:
- osamocená silnice se vykreslí jako slepý konec (jen středový kus): střed dlaždice
  má `#44454d`, všechna čtyři ramena zůstala travnatá
- po přistavění severního souseda se **objevilo severní rameno** a ostatní tři
  zůstaly travnaté — auto-tiling i překreslení sousední dlaždice fungují
- totéž **přes hranici chunku**: dlaždice (15, 64) je v chunku 0, (16, 64) v chunku 1;
  východní rameno naskočilo po přistavění souseda a po zbourání zase zmizelo
- pauza (klávesa 0) tik skutečně zastaví — 144 → 144 přes dva snímky
- golden test: 45 dlaždic se silnicí (21 vodorovných + 31 svislých − 1 průsečík
  − 6 zbouraných), 500 tiků, hash proti snapshotu

- [x] T4 — content registry, JSON schéma, vanilla definice

Vzniklo:
- `content/vanilla/` — `manifest.json`, čtyři definice budov, `locale/cs.json` a `en.json`
- `src/content/schema.ts` — ruční validátor definic i manifestu, sbírá všechny chyby najednou
- `src/content/registry.ts` — `ContentRegistry`, `ContentSource`, `ContentValidationError`
- `src/content/loader.ts` — složí vanilla zdroj z repozitáře přes `import.meta.glob`
- napojeno do `app.ts`: obsah se načítá dřív, než vznikne plátno

Ověřeno (`npm run check`, 9 souborů / 91 testů) a v běžící hře:
- všechny čtyři vanilla definice projdou schématem a zaregistrují se
- `getLoadedSources()` vrací `vanilla 0.1.0` — přesně to, co půjde do `meta.json` savu
- žádná definice nemá text natvrdo, `name` i `description` jsou lokalizační klíče
- nevalidní zdroj v prohlížeči skončil `ContentValidationError` se **jménem zdroje,
  souboru i pole** a vypsal všech šest problémů najednou:
  neznámá sekce (překlep `construcion`), cizí namespace v `id`, chybějící
  `construction`, záporný `upkeep`, barva mimo tvar a `heightLevels` mimo rozsah
- po neúspěšném načtení zůstal registr **úplně prázdný** — žádné poloviční načtení

- [x] T5 — zóny, růst budov, populace, vykreslení kvádrů

Vzniklo:
- `src/sim/commands.ts` — `zoneArea` (obdélník, přeskakuje vodu/silnici/budovu)
  a rozšířené `bulldoze`: boura budovu, jinak silnici, jinak zónu
- `src/sim/systems/growth.ts` — růstový systém a rozhraní `BuildingCatalogue`
- `src/sim/world.ts` — `removeBuilding`, `totalPopulation`, `totalJobs`
- `src/content/` — sekce `population` a `jobs` ve schématu, `byCategory` v registru,
  kapacity dopsané do všech čtyř vanilla definic
- `src/render/buildingRenderer.ts` — kvádry ze tří stěn, řazení podle `x + y`
- `src/render/projection.ts` — `cuboidFaces`
- `src/render/chunkRenderer.ts` — zónový overlay s alfou
- `src/render/app.ts` — nástroje na klávesách Q/R/C/I, malování tažením

Ověřeno (`npm run check`, 10 souborů / 111 testů) a v běžící hře:
- **akceptační smyčka §13 kroky 1–3 prošla**: silnice → obytná zóna vedle ní →
  z 0 budov vyrostlo za 320 tiků **34 domů a 272 obyvatel** (34 × 8), první
  v tiku 218, tedy přesně na fázi růstového systému (interval 12, offset 2)
- barvy stěn kvádru odpovídají §6 na hexu přesně: horní plocha `#8fb4dd` (100 %),
  levá `#647e9b` (70 %), pravá `#485a6f` (50 %)
- řazení podle `x + y` funguje: u domu se sousedem vpravo je pravá stěna zakrytá
  sousedovou horní plochou, u domu na okraji řady je vidět
- zónový overlay dá nad trávou `#5e9783`, což je přesně 60 % trávy + 40 % modré
- bez silnice nevyroste nic (`requiresRoad`), v průmyslové zóně nevyroste dům
- bourání odstraní budovu i její otisk ve `buildingId`, ale **zónu nechá**
- determinismus: stejný seed dá identické město i stav RNG, jiný seed jiné

- [x] T6 — elektřina

Vzniklo:
- `src/sim/systems/power.ts` — flood fill z elektráren po vodičích a rozdělení kapacity
- `src/sim/catalogue.ts` — `BuildingCatalogue` (rozšířeno o `get`) na jednom místě
- `src/sim/buildings.ts` — `footprintFits`, `touchesRoad`, `touchesPower`, `placeBuilding`
  sdílené růstem i ruční stavbou
- `src/sim/commands.ts` — `placeDefinition`, tedy příkaz `place_building`
- `src/sim/world.ts` — `powerNetworkDirty` a `markPowerNetworkDirty`
- `src/render/chunkRenderer.ts` — overlay elektřiny (klávesa P)
- `src/render/app.ts` — nástroj infrastruktury (klávesa U, cykluje obsahem)

Ověřeno (`npm run check`, 11 souborů / 124 testů) a v běžící hře:
- **akceptační smyčka §13 krok 7 prošla**: 11 domů u silnice mělo 0 pod proudem,
  po postavení uhelné elektrárny je pod proudem všech 12 budov
- proud se šíří po silnici na druhý konec, ale **prázdná dlaždice proud nevede**
  a odpojený ostrov silnice zůstal na 0
- přerušení silnice bulldozerem odřízne zbytek sítě od proudu
- kapacita se dělí: elektrárna 50, dům 20 → utáhne dva domy, třetí zůstane bez
  proudu; přednost má nižší `id`, tedy starší budova
- flag sítě: stavba silnice ho zapne, přepočet zhasne, zónování se ho netýká
- overlay: bez něj jsou napojená i odpojená silnice stejně tmavé `#44454d`,
  s ním je napojená `#a49653` a odpojená `#964643`; tráva zůstává netknutá,
  protože barvit prázdnou dlaždici by tvrdilo „chybí tu vedení"

- [x] T7 — RCI poptávka, daně, rozpočet, bankrot

Vzniklo:
- `src/sim/rci.ts` — tři zónové kategorie, `categoryForZone`, `isRciCategory`
- `src/sim/systems/demand.ts` — RCI poptávka
- `src/sim/systems/economy.ts` — měsíční rozpočet (30 tiků)
- `src/sim/systems/growth.ts` — růst podmíněný poptávkou a nezápornou kasou
- `src/sim/world.ts` — daňové sazby, bilance posledního měsíce, startovní kapitál
- `src/sim/commands.ts` — `setTaxRate`, `placeDefinition` odečítá cenu
- `src/render/app.ts` — kasa, bilance, RCI a sazby v overlayi; klávesy `,` a `.`

Ověřeno (`npm run check`, 12 souborů / 141 testů) a v běžící hře — **celá smyčka
§13 kroky 1–6 se uzavřela a sama se pohání**:

| stav | budov | lidí | práce | RCI | kasa | měsíc |
|---|---|---|---|---|---|---|
| start | 0 | 0 | 0 | 20 / 0 / 0 | 20 000 | — |
| po obytné zóně | 6 | 48 | 0 | −4 / 10 / **24** | 21 128 | +132 / −60 |
| po průmyslové zóně | 24 | 144 | 72 | **20** / 29 / 0 | 31 652 | +600 / −330 |
| později | 26 | 152 | 84 | 28 / 30 / −8 | 50 234 | +656 / −365 |

- obyvatelé bez práce vyrobili průmyslovou poptávku 24 (krok 4) a obytná spadla
  do minusu, takže se přestalo stavět — přesně ta zpětná vazba, o kterou jde
- po vyznačení průmyslu vyrostly továrny, poptávka po průmyslu spadla na nulu
  a obytná se vrátila do plusu, načež populace vyskočila z 48 na 152 (kroky 5–6)
- daně plynou každý měsíc, kasa roste z 20 000 na 50 234
- klávesy `,` a `.` mění sazbu vybrané zóny: 7/7/7 → 9/7/6

- [x] T8 — save/load, ZIP kontejner, migrace, fixtury

Vzniklo:
- `src/save/format.ts` — `formatVersion`, pořadí vrstev, typy, chybové třídy
- `src/save/serialize.ts` — `packLayers`, `toSaveData`, `packSave` (ZIP přes fflate)
- `src/save/deserialize.ts` — validace, `unpackSave`, `readSaveMeta`,
  `collectLoadWarnings`, `applySaveToWorld`
- `src/save/migrations/index.ts` — `migrate` jako čistá funkce s řetězem verzí
- `tests/fixtures/saves/v1.city.base64` — skutečný save verze 1
- `src/render/app.ts` — F5 uloží, F9 načte

Ověřeno (`npm run check`, 14 souborů / 166 testů) a v běžící hře — **§13 krok 8**:

| stav | tick | budov | lidí | kasa | RNG | součet vrstev |
|---|---|---|---|---|---|---|
| před uložením | 1274 | 33 | 200 | 19 481 | 2600649587 | `4f0d38f7` |
| po rozbourání města | 2074 | 7 | 0 | 21 182 | 2660345281 | `45a691bc` |
| **po načtení** | **1274** | **33** | **200** | **19 481** | **2600649587** | **`4f0d38f7`** |

- obnova je bitově identická včetně stavu RNG, takže hra po loadu pokračuje
  stejně jako by nebyla vypnutá; hlídá to i test, který po round-tripu odtiká
  120 tiků v obou světech a porovná hash
- `meta.json` je v ZIPu nekomprimovaná — test to ověřuje tím, že hledá surový
  text `"formatVersion": 1` přímo v bajtech archivu
- `readSaveMeta` přečte metadata bez rozbalení vrstev a entit
- hodnota `buildingId` 4242 přežije round-trip, takže endianita je vyřešená
- rozbité savy: nesmyslné bajty, chybějící soubor, `layers.bin` špatné délky,
  chybějící pole v entitě i `rngState` mimo uint32 → všechno `SaveFormatError`
  s uvedením místa, nikdy tichý pád
- chybějící mod: hlásí zdroj i definici a **budovu nesmaže**, jen se nevykreslí
- fixtura v1 se načte do aktuální verze a její vrstvy sedí proti snapshotu

- [x] T9 — HUD, toolbar, i18n, převod textů na klíče

Vzniklo:
- `src/ui/i18n.ts` — `t()`, fallback jazyk → angličtina → klíč, výběr jazyka
- `src/ui/hud.ts` — kasa, populace, práce, bilance, datum, poptávka, rychlost,
  daně, uložení, přepínač jazyka a overlaye
- `src/ui/toolbar.ts`, `src/ui/tools.ts` — paleta nástrojů se skupinami
- `src/ui/saveFile.ts` — uložení do souboru a načtení ze souboru
- `src/ui/dom.ts` — pár pomocníků, žádný framework
- `src/content/registry.ts` — locale tabulky se slévají přes zdroje a registr
  je vydává; `getLanguages()`, `getLocaleTable()`
- `content/vanilla/locale/{cs,en}.json` — doplněno 40 klíčů `ui.*`
- `src/style.css` — celý HUD

Ověřeno (`npm run check`, 15 souborů / 181 testů) a v běžící hře:
- **v žádném souboru UI není uživatelsky viditelný text** — všechno jde přes
  `t()` a texty dodává obsah, takže je mod může doplnit i přepsat
- tlačítko infrastruktury se jmenuje **„Uhelná elektrárna"**, protože popisek
  je `name` z definice — v kódu není jméno ani jedné budovy (P5)
- přepnutí jazyka přepsalo úplně všechno: `Kasa → Funds`, `Silnice → Road`,
  `Obytná zóna → Residential zone`
- tlačítka fungují: nástroj se označí jako aktivní, daň 7 → 8 %, pauza zastaví
  tik (1404 → 1404), rychlost 4× se označí, overlay elektřiny se propíše
  do rendereru
- uložení hlásí `Saved (1.8 kB)`, načtení `Loaded`
- chybějící překlad padá na angličtinu, úplně chybějící klíč se vypíše sám,
  aby byl při testování vidět

- [x] Zásahy po T9 na žádost autora (šest bodů)

1. **Odchylka od §6 u výšky kvádru schválena autorem** — `level × heightLevels × LEVEL_H` platí.
2. **128 MB VRAM vyřešeno.** `RenderTexture` nahrazena retained `Graphics`;
   chunkování i dirty tracking zůstávají. Změřeno v běžící hře: žádné textury,
   render při plném oddálení **0,1 ms medián / 0,2 ms maximum** (dřív 0 / 0,1 ms).
   Za desetinu milisekundy na snímek se ušetřilo prakticky celých 128 MB.
3. **Elektřina má herní důsledek.** Spotřeba podle velikosti: dům 100,
   obchod 150, továrna 300 proti výrobě 6 000 — jedna elektrárna uživí
   60 domů, ale jen 20 továren. **Budova bez proudu nejede: nedaní a ani
   nefiguruje ve výdajích.** Ověřeno v běžící hře: město o 49 budovách a
   296 obyvatelích mělo bez elektrárny bilanci +0/−0, po první elektrárně
   svítilo **43 z 50** budov s bilancí +1032/−755, po druhé **51 z 51**
   s bilancí +1222/−1070.
4. **Budovy se vizuálně oddělily** — kvádr je o 0,12 dlaždice menší než půdorys,
   takže řada domů už není jeden souvislý hřeben.
5. **Opraveno panování mezerníkem.** Rozbilo se to v T9: po kliknutí na tlačítko
   HUDu mu zůstal fokus, takže mezerník spadl do větve, která HUD ignoruje.
   Tlačítka teď po kliknutí fokus vrací a mezerník se řeší před kontrolou HUDu.
   Ověřeno: tažení o 50/40 px při zoomu 0,25 posune kameru o −200/−160,
   bez mezerníku o nic.
6. **Bublina s cenou** vyskočí u kurzoru a do 1,4 s zmizí. Ověřeno: klik na
   elektrárnu ukázal `−4 000` na pozici kurzoru a kasa šla z 20 000 na 16 000.

- [x] Hlášení problémů, ekonomický přehled, detail budovy

- **Projekt je na GitLabu** — `zdendascz/citybuilder`, jedenáct commitů.
- **Opravena hlášená vizuální chyba s pořadím budov.** Hloubka se řídila
  počátkem půdorysu (`x + y`), takže dvoudlaždicová továrna na (54, 61) měla
  index 115, ale jednodlaždicový obchod na (56, 61) 117 — a kreslil se přes ni,
  přestože stojí za ní. Nově rozhoduje **přední roh** půdorysu; obě budovy mají
  119, protože leží na stejné diagonále.
- **Levnější provoz elektrárny** (údržba 200 → 60). Změřeno: s jednou elektrárnou
  čistě 390/měsíc, se dvěma 399 — druhá se poprvé vyplatí. Dřív to bylo 277 a 152.
- **Simulace už nemlčí.** Každý příkaz vrací `CommandResult`; odmítnutí nese
  lokalizační klíč důvodu a UI ho vypíše. Ověřeno v běžící hře: klik silnicí na
  obsazenou dlaždici vypsal „Dlaždice je obsazená", tři kliky za sebou se slily
  do jedné bubliny s `×3`. Výjimky v běhu i mimo něj chytá globální handler
  a vypisuje je stejnou cestou.
- **Ekonomický přehled** na klávesu `B` nebo tlačítko. Ukazuje cenu, počet,
  kolik jich je pod proudem, příjem, údržbu a čistý výnos po budovách plus
  celkový součet. Čísla počítá `computeBudget` v simulaci — ta samá funkce,
  ze které žije měsíční rozpočet, aby se výpis nemohl rozejít se skutečností.
- **Pod každým řádkem je rozpis, z čeho se číslo skládá**: `daň: 264 obyvatel
  × 40 × 7 % = 739 · údržba: 33 × 10 = 330 · 2 mimo provoz (bez proudu)`.
  Ověřeno v běžící hře, že sedí do jedničky včetně součtů.
- **Detail budovy pravým tlačítkem**: pozice, půdorys, datum postavení, cena,
  populace, práce, výroba a spotřeba elektřiny, připojení, daně a údržba za
  měsíc, znečištění. Bourání se tím přesunulo výhradně na nástroj (`X`).

- [x] T11 — hrubá mřížka, difuze, znečištění, overlay (fáze 2)

Vzniklo:
- `src/sim/coarse.ts` — mřížka 32×32, `coarseIndex`, `CoarseLayers`, `hashCoarseLayers`
- `src/sim/diffusion.ts` — difuzní jádro podle §3 zadání fáze 2
- `src/sim/systems/pollution.ts` — zdroje z budov a z nepokrytého odpadu, interval 8/offset 3
- `src/render/coarseOverlay.ts` — overlay hrubých vrstev jako vlastní lehká vrstva
- `DirtySet.coarseChanged`, overlay jako režim (`none` / `power` / `pollution`), klávesa `O`

Ověřeno (`npm run check`, 16 souborů / 213 testů) a v běžící hře:
- **akceptační kritérium §13.1 splněno**: u průmyslu 153, o 8 dlaždic dál 27,
  o 20 dlaždic 6, u kraje mapy 1 — klesá se vzdáleností a u kraje mizí
- maximum 167, tedy pod 255 i po 400 tikách
- odpad bez skládek zamoří město rovnoměrně: i roh mapy má nenulovou hodnotu
- zdroj sedí na **předním rohu** půdorysu, ověřeno budovou přesahující hranici buňky
- bez zdroje znečištění úplně odezní
- difuze je deterministická — dva běhy stejného seedu dají identický hash hrubých vrstev
- **výkon: medián snímku 16,7 ms, p95 19,9 ms, 60 FPS při 8× včetně difuze**

- [x] T12 — cena půdy, bonus vody, vyhlazení, overlay (fáze 2)

Vzniklo:
- `src/sim/systems/landValue.ts` — vzorec podle §4, interval 16 / offset 5
- vrstva `landValue` na hrubé mřížce, overlay na klávese `L`
- `CoarseOverlay` umí víc vrstev, každou s vlastní barvou

Ověřeno (`npm run check`, 17 souborů / 223 testů) a v běžící hře:
- **akceptační kritérium §13.2 splněno**: obytná zóna u průmyslu má cenu půdy **0**,
  vzdálená zóna **14**, nedotčený roh mapy **40** (základ)
- cena půdy roste postupně, ne skokem — po prvním běhu je pod základem
- u vody vyjde 65 (základ 40 + bonus 25), bonus dostane i buňka s vodou samotnou
- těžké znečištění ji srazí na nulu, ale ne pod ni; nepřeteče 255
- overlaye se přepínají a vždy svítí nejvýš jeden; překreslení 0,6 ms

- [x] T13 — služby, pokrytí, kriminalita (fáze 2)

Vzniklo:
- `src/sim/systems/services.ts` — obecný mechanismus pokrytí, běží při `coverageDirty`
- `src/sim/systems/crime.ts` — kriminalita podle §5, interval 16 / offset 11
- `src/sim/systems/landValue.ts` — do vzorce přibylo pokrytí a kriminalita
- `content/vanilla/buildings/police_small.json`, sekce `service` ve schématu
- vrstva `crime`, overlaye kriminality (`K`) a dosahu policie
- `world.coverage`, `world.serviceFunding`, `coverageDirty`

Ověřeno (`npm run check`, 18 souborů / 239 testů) a v běžící hře na městě o 72 obyvatelích:

| | kriminalita | cena půdy | pokrytí policií |
|---|---|---|---|
| bez policie | 40 | 12 | 0 |
| s policejní stanicí | **0** | **45** | 35 |
| daleko od stanice | 25 | — | 10 |

**Akceptační kritérium §13.4** (podfinancování) ověřeno přímo na stavu:

| financování | u stanice | střed | okraj | kriminalita | cena půdy |
|---|---|---|---|---|---|
| 100 % | 55 | 35 | 10 | 0 | 45 |
| 30 % | 13 | 0 | 0 | 29 | 18 |

- pokrytí je nejsilnější u stanice a se vzdáleností klesá, za dosahem je nula
- dvě stanice vedle sebe pokrývají víc než jedna
- po zbourání stanice pokrytí zmizí; bez `coverageDirty` se nepřepočítává
- policejní stanice cenu půdy zvedne, kriminalita ji srazí
- celá sestava je deterministická

- [x] T14 — zbývající třídy služeb, financování, zapojení do rozpočtu (fáze 2)

Vzniklo:
- šest definic: hasičská zbrojnice, klinika, škola, park, skládka, spalovna
- sekce `waste` ve schématu — kapacita bez pokrytí a bez dosahu
- `src/sim/systems/health.ts` — bez zdravotní péče obyvatel v budovách ubývá
- příkaz `set_service_funding`, posuvník na třídu v HUDu
- `buildingMonthlyUpkeep` škáluje údržbu financováním

Ověřeno (`npm run check`, 18 souborů / 241 testů) a v běžící hře:
- **akceptační kritérium §13.3 splněno**: po postavení parku a kliniky vyskočila
  cena půdy z **1 na 56** a populace se ze 40 vrátila na 96
- financování 50 % srazilo výdaje na služby ze **140 na 70**
- skládka je levnější, pobere míň odpadu a znečišťuje víc než spalovna
- pokus postavit skládku mimo silnici skončil hláškou „musí sousedit se silnicí"

- [x] Náhled půdorysu pod kurzorem (na žádost autora)

Zvýraznění pod kurzorem kreslí **celý půdorys**, ne jen jednu dlaždici — u budovy
4×4 jinak nebylo poznat, kam se vlastně položí. Rámeček navíc **zčervená, když
se stavba nevejde**, a ptá se na to stejné funkce jako příkaz (`checkFootprint`),
takže nemůže tvrdit něco jiného, než co se po kliknutí stane.

Ověřeno v běžící hře čtením pixelů: volné místo dá `#85ad6a` (tráva + bílá 18 %),
místo překrývající policejní stanici `#85934b` (tráva + červená). U nástroje
silnice zůstává zvýrazněná jedna dlaždice, u elektrárny šestnáct.

- [x] T15 — `balance.json`, schéma, validace (fáze 2)

Vzniklo:
- `content/vanilla/balance.json` — všechny konstanty fáze 2 podle §10 zadání
- `src/content/balance.ts` — typy a validace, desetinná čísla s rozsahy
- `ContentRegistry.getBalance()`, `ContentSource.balance`
- difuze, cena půdy, kriminalita a zdravotnictví berou konstanty odtud

Ověřeno (`npm run check`, 19 souborů / 251 testů) a v běžící hře:
- **v kódu nezůstala ani jedna konstanta fáze 2** — hlídá to test, který spustí
  cenu půdy s upraveným balancem (základ 100, bonus vody 50) a čeká 150 a 100
  místo vanilla 65 a 40; kdyby konstanty zůstaly v kódu, vyšlo by pořád 65 a 40
- chybějící sekce je chyba, ne tichý default; hodnota mimo rozsah hlásí pole
- váhy musí obsahovat znečištění i kriminalitu, zbytek jsou třídy služeb a ty
  jsou otevřený seznam, protože třídy jsou obsah
- mod s vlastním balancem ten stávající přepíše, mod bez něj ho nesmaže
- bez balancu registr rovnou řekne, že chybí

Sekce `levels` a `growth` se validují, ale zatím je nikdo nečte — patří k T16
a T18. Jsou v souboru proto, že je tak zadání §10 definuje.

- [x] Symboly na střechách budov (na žádost autora)

Služby a infrastruktura se v mapě pletly, protože se lišily jen barvou. Každá
teď nese symbol na střeše: kříž, štít, plamen, kniha, strom, popelnice, blesk.

- kreslí se **procedurálně z polygonů**, ne ze spritů (§6)
- souřadnice jsou v jednotkovém čtverci a promítají se přes `gridToScreen`,
  takže symbol sedí na půdorysu jakékoli velikosti a sám se naklopí do izometrie
- který symbol budova nese, určuje obsah (`graphics.icon`); kód zná jen sadu tvarů
- na světlé budově je symbol tmavý, jinak bílý — jinak by na bílé klinice zmizel

Ověřeno čtením pixelů: klinika má na střeše `#66686a` proti vlastní `#dfe4ea`,
park `#edf5ee` proti `#4a9b5a`.

- [x] Přeladění ekonomiky (na žádost autora)

Při 7 % daně město neufinancovalo ani jednu službu. Poměr daň/údržba byl 2,2×
u domu, **1,1× u obchodu** a 1,3× u dílny — sto budov vydělalo 260 měsíčně
proti 1080 za údržbu služeb.

- daňová jednotka 40 → 70, údržba: dům 10 → 6, obchod 15 → 8, dílna 25 → 14;
  poměry jsou teď 6,5× / 3,7× / 4,2×
- konstanty fáze 1 se přestěhovaly do `balance.json`: sekce `economy`
  (`taxableValuePerUnit`, `startingFunds`, `defaultTaxRate`) a `demand`
  (`workerRatio`, `baseResidential`, `commercePerCapita`, `limit`)
- `TAXABLE_VALUE_PER_UNIT` v kódu zanikl; `computeBudget` nese daňovou jednotku
  v `Budget.valuePerUnit`, aby ji rozpis v UI nemusel znát odjinud
- kriminalita si podíl pracujících bere ze stejné hodnoty jako poptávka —
  jedna konstanta v balancu místo dvou v kódu
- `STARTING_FUNDS` a `DEFAULT_TAX_RATE` zůstávají jako záloha pro testy a hlídá
  je test proti `balance.json`, aby se nerozešly s obsahem
- testy ekonomiky běží na pevné testovací jednotce 40, ne na vanilla čísle —
  přeladění balancu nemá rozbíjet testy vzorců

Ověřeno ve hře: město se 168 obyvateli, policií, hasiči, klinikou, školou,
parkem a dvěma elektrárnami má +215 měsíčně a jmění roste. Nový test „každá RCI
budova utáhne aspoň dvojnásobek své údržby" na staré údržbě obchodu padá (1,93×).

- [x] T16 — úrovně 1–5, rozšiřování a slučování, vanilla žebříček (fáze 2)

Vzniklo:
- `src/sim/levels.ts` — vyhledání definice podle trojice (kategorie, půdorys,
  úroveň), plán rozšíření a výměna definice pod entitou
- `src/sim/systems/levels.ts` — systém 20/9, který vyhodnocuje podmínky povýšení
- `level` v definici (výchozí 1, rozsah 1–5) a `levelChangedAtTick` na entitě
- 18 nových vanilla definic: sedm na každou zónovou kategorii

Jak to funguje:
- **šířka má přednost před výškou** (zadání autora): budova nejdřív zkusí
  rozšíření do směrů `+x, +y, −x, −y` v pevném pořadí, teprve pak patro
- rozšíření drží úroveň a mění jen půdorys; pohltit smí jen souseda **stejné
  kategorie s nižší úrovní** nebo prázdnou zónovanou parcelu (R1)
- povýšení chce naráz: cenu půdy nad prahem `thresholds[L+1]`, kladnou poptávku
  po kategorii a uplynulý cooldown od poslední změny
- entita si po povýšení drží `id` i `builtAtTick` — pro město je to pořád ten
  samý dům. Populace a místa se nesčítají, určuje je nová definice (§8)
- chybějící kombinace v katalogu není chyba, jen nedostupná cesta (R5) — vanilla
  třeba nemá půdorys 1×2, takže se roste do šířky, ne do hloubky
- růst staví jen **nejmenší definici první úrovně**; bez toho by na volné
  parcele rovnou vyrostl věžák. Kód přitom žádnou velikost nezná, plyne to
  z obsahu (P5)

Vanilla žebříček na kategorii: 1×1 L1 → 2×1 L1 → 2×1 L2 → 2×2 L2 → 2×2 L3,
plus 1×1 L2 a L3 pro sevřené parcely, kde se do šířky růst nedá. Cesta je
navržená tak, aby se dvoupatrová řadovka **měla kam rozšířit** — jinak by
k pohlcení souseda nikdy nedošlo.

Ověřeno ve hře: čtvrť se třemi parky a policií drží cenu půdy 109–135 a domky
se samy povýšily na `residential_row` a `residential_terrace`. Práh úrovně 3
(130) zatím většina buněk nedosáhne, což je záměr — vyšší patra si hráč musí
zasloužit službami.

Testy: `tests/levels.test.ts` (23), z toho §13 krok 5 nad vanilla obsahem —
dvoupatrová řada pohltí dva čerstvé domky a stojí na čtyřech parcelách.
Že testy koušou, ověřeno záměrným rozbitím: obrácené pořadí směrů shodí čtyři
testy, vypnutá kontrola úrovně souseda dva.

Save v1 `levelChangedAtTick` nenese — podle §11 se při migraci nuluje a ukládat
ho začne formát v2 v T20. Round-trip test to pojmenovává, ať se ztráta nerozšíří
tiše na další pole.

- [x] T17 — snížení úrovně, chátrání, opuštěné budovy (fáze 2)

Vzniklo:
- snížení a opuštění v `src/sim/levels.ts`, vyhodnocení v `systems/levels.ts`
- `abandoned` na entitě a `downgradeStreak` ve světě (runtime, do savu nepatří)
- `levels.decayPenalty` v balancu — **doplněk zadání**, které chátrání věkem
  popisuje, ale výši penalizace neurčuje

Jak to funguje:
- budova klesne, když cena půdy spadne pod `thresholds[L] − hysteresis`, a to
  **třikrát po sobě**. Jednorázový výkyv ji shodit nesmí
- snížení hledá definici pro `L−1` se stejným půdorysem; když není, vezme
  největší menší a uvolněné dlaždice vrátí jako prázdné zónované parcely
- pod úrovní 1 je opuštění. Ruina **stojí dál**: nedaní, nestojí údržbu, nemá
  obyvatele ani práci, nekouří, nebere proud — ale zvedá kriminalitu a přes ni
  sráží cenu půdy v okolí. Zbourat ji musí hráč
- rostoucí soused ji **nepohltí**. Kdyby ji uklidil, přestala by být problémem
- chátrání věkem se počítá jen při podfinancování: budova starší než `decayAge`
  v buňce, kde je průměrné pokrytí pod prahem, dostane penalizaci k efektivní
  ceně půdy. Plně obsloužená budova nechátrá nikdy
- opuštěná budova sráží cenu půdy **přes kriminalitu**, ne vlastním kanálem —
  ten by znamenal čtvrtou hrubou vrstvu a ta se do savu podle §11 nevejde

Opravena i výška budov: kreslila se jako `úroveň × heightLevels`, takže by
věžák úrovně 3 měl patnáct pater. Výšku určuje definice, úroveň už je v ní.

Ověřeno ve hře (§13 kroky 6 a 7): čtvrť s parky, policií a klinikou vyrostla na
`residential_terrace` při ceně půdy 118–149. Po zbourání služeb a čtyřech
skládkách u silnice spadla cena půdy na nulu, budovy klesly zpátky na
`residential_row` a po překročení věku chátrání jich 21 zůstalo stát jako ruiny:
populace 0, příjem 0, kriminalita v místě 90 proti nule předtím. Renderer je
kreslí `#6a6a6a` s pravidelnými stěnami 70 % a 50 %, buldozer je odstraní.

Testy: 35 v `tests/levels.test.ts`. Že koušou, ověřeno rozbitím: bez penalizace
za zanedbanost padnou dva, bez potvrzování snížení jeden, bez vynechání ruiny
v rozpočtu jeden.

- [x] T18 — přepis růstu: skóre parcely, dosah silnice, daň, poptávka jako
  rychlost (fáze 2)

Růst z fáze 1 losoval rovnoměrně ze všech volných zónovaných dlaždic, poptávku
bral jako vypínač a silnici jako přímé sousedství. Všechny tři se změnily:

```
skóre  = (cenaPůdy + 1) ^ EXPONENT × faktorSilnice
pokusů = clamp(round(poptávka / POPTÁVKA_NA_POKUS × faktorDaně), 0, MAX_POKUSŮ)
```

- parcela se losuje **váženě podle skóre** — drahá půda u silnice se zastaví
  dřív než bahno na kraji mapy
- silnice se počítá **dosahem, ne sousedstvím**: 1,0 / 0,6 / 0,3 podle
  vzdálenosti, dál než tři dlaždice parcela z losu vypadne úplně. Vzdálenosti
  počítá jeden průchod do šířky ze všech silnic naráz, ne prohledávání okolí
  u každé z tisíců parcel
- růst proto **nekontroluje** `requiresRoad` z definice; ruční stavba hráče ho
  dodržuje dál. Bez toho by parcela dvě dlaždice od vozovky nemohla vyrůst nikdy
- poptávka je rychlost, ne vypínač: poptávka 5 a 50 se konečně liší
- pokusy se počítají **po kategoriích** v pevném pořadí, ne globálně — průmysl
  se svou poptávkou nesmí čerpat pokusy obytné zóně
- k ceně půdy se přičítá jednička, jinak by čerstvá mapa s nulovou cenou půdy
  první měsíce nepostavila vůbec nic

**Doplněk zadání:** faktor daně je v počtu pokusů, ne ve skóre parcely. Uvnitř
kategorie je pro všechny parcely stejný, takže by se ve váženém losu vykrátil
a daň by na růst neměla žádný vliv — přesně naopak, než co §9 chce.

Ověřeno ve hře (§13 krok 8): jediná silnice s šestiřadou zónou pod ní zastavěla
řady ve vzdálenosti 1, 2 a 3 v poměru 26 / 21 / 13 budov, čtvrtá a další řada
zůstaly prázdné. Tím padá i stará výtka z fáze 1, že dál od silnice nevzniká nic.
Systém stojí 0,3 ms na běh, tedy jednou za 12 tiků.

Testy: 25 v `tests/growth.test.ts`, včetně §13 kroku 9 (18 % daň měřitelně
zpomalí růst). Že koušou, ověřeno rozbitím: bez faktoru daně padnou dva testy,
bez omezení dosahu dva, bez vah v losu jeden.

- [x] Oprava: load savu zabíjel všechny služby (nahlásil autor)

Autor hlásil, že mu při plné poptávce nerostou domy, a poslal uložené město.
Diagnostika nad jeho savem odhalila chybu v `applySaveToWorld`: nastavovala
`powerNetworkDirty`, ale **ne `coverageDirty`**. `serviceSystem` počítá jen při
tom příznaku, takže načtené město zůstalo bez pokrytí — dokud hráč nepostavil
další stanici, neplatil žádný bonus k ceně půdy, nesrážela se kriminalita a
nefungovalo zdravotnictví.

Ve městě autora to dělalo rozdíl mezi cenou půdy 0 a mediánem 27, kriminalitou
106 a 0, příjmem 2017 a 3486 za měsíc.

Do načteného světa navíc přetékal stav toho předchozího: pokrytí, financování
tříd, hrubé vrstvy ceny půdy a kriminality (nulovalo se jen znečištění) a
počítadlo snížení úrovně. Load je teď čistí všechny.

Kryjí to dva testy v `tests/save.test.ts`; ověřeno rozbitím, že koušou.

- [x] Poptávka snižuje práh povýšení + sloučení parcel se vyplatí (rozhodl autor)

Dvě změny na žádost autora, obojí zapsané do balancu, ne do kódu:

**Sloučení parcel.** Řadovka dávala přesně tolik, co dva domky — budovy se
sloučily a městu to nepřineslo ani jednoho obyvatele. Kapacita 2×1 na první
úrovni je teď o čtvrtinu vyšší než dvě samostatné parcely (bydlení 16 → 20,
obchod 12 → 15, průmysl 24 → 30). Hlídá to test v `economy.test.ts`.

**Úleva za poptávku** (`levels.demandRelief`, doplněk §8): při plné poptávce
klesá práh povýšení o 25, při slabší úměrně méně. Zadání bere poptávku jen jako
vypínač, takže město s poptávkou 100 povyšovalo stejně jako město s poptávkou 1.

Dvě věci se ukázaly až při simulaci uloženého města autora:

- úleva musí posunout **oba** prahy. Když se odečítala jen od horního, pásmo
  mezi nimi se převrátilo: dům povýšil při 65, spadl pod 75 a tak pořád dokola.
- ani to nestačilo. Povýšení přidá obyvatele, hustota zvedá kriminalitu a ta
  sráží cenu půdy zpátky pod práh — smyčka širší než tehdejší hystereze 15.
  **Hystereze je proto 35**, tedy širší než ten výkyv. Alternativa (zeslabit
  váhu hustoty v kriminalitě z 0,6 na 0,3) kmitání zastaví taky, ale mění model
  kriminality a oslabuje policii, tak jsem sáhl po hysterezi.
- opuštění budov na tom viselo: spodní práh úrovně 1 byl `0 − hystereze`, takže
  širší hystereze opuštění úplně vypnula. Pod první úrovní se hystereze ani
  úleva neuplatňují — s ruinou není co kmitat. Kryje to test s hysterezí 200.

Na městě autora (znečištění pod domy 242 z 255): 2498 → 2670 obyvatel, 25 domů
na úrovni 2, a stav se drží — žádné kmitání.

- [x] Oprava: overlay znečištění byl všude stejný (nahlásil autor)

Autor hlásil, že znečištění je stejné u elektrárny i v parku. Bylo — celá
zastavěná plocha seděla na stropě 255, takže overlay nerozlišoval nic.

Dvě příčiny, obojí špatně zvolená čísla v obsahu, ne chyba mechaniky:

1. **Kapacity odpadu byly směšně malé.** Skládka pobrala odpad za 200 lidí,
   takže město o třech tisících jich potřebovalo patnáct. Nepokrytý odpad se
   podle §6 rozpouští **celoměstsky do každé buňky**, takže vyrobil rovnou
   podlahu ~100 znečištění přes celou mapu — i tam, kde nic nestojí. Přesně to
   autor viděl. Skládka teď pobere 120 (1200 obyvatel), spalovna 400.
2. **Hodnoty zdrojů nepočítaly s tím, že se difuze načítá.** Stálý zdroj se
   ustálí zhruba na 2,5násobku své hodnoty, a v souvisle znečištěné čtvrti až
   na patnáctinásobku. Čísla byla vybraná, jako by vrstva ukazovala přímo
   hodnotu ze zdroje, takže každá hustší čtvrť usekla o strop. Všechny zdroje
   jsou na 0,35násobku (elektrárna 30 → 10, dílna 20 → 7, skládka 60 → 21).
3. Bydlení nespíní vůbec — jeho stopa jde přes odpad, který obyvatelé vyrobí.
   Jinak se hustá čtvrť otrávila sama a zahušťování ztratilo smysl.

Řez městem po opravě (bydlení s parky vlevo, průmysl a elektrárna vpravo):

```
x        22   26   30   34   38   42   46   50   54   58
zneč.     0    0    0    4   14   49   41   39   37   31
cena     70   70   72   61   44   40   23   20   26   28
```

Na uloženém městě autora: 2670 → 6526 obyvatel, cena půdy pod domy z mediánu
22 na 103, znečištění u průmyslu 252 proti 85 u bydlení. 273 domů se dostalo na
třetí úroveň.

Hlídají to dva testy v `tests/pollution.test.ts`: čtvrť bez průmyslu musí
zůstat pod čtvrtinou znečištění průmyslové, a jedna skládka musí pobrat odpad
aspoň tisícovky lidí.

- [x] Temná budova je poznat na mapě (nahlásil autor)

Že budova nemá proud, se hráč dozvěděl jen z detailu, jednu po druhé — overlay
elektřiny barví dlaždice, ne budovy, a pod budovou ho není vidět.

Budova, která proud **bere a nedostává**, se teď kreslí na poloviční jas a nese
na střeše červený blesk. Je to stav entity, ne definice, takže si ho renderer
skládá až při kreslení, stejně jako u ruiny.

Ověřeno ve hře čtením instrukcí rendereru: temný dům `#485a6f` + blesk
`#d9483a`, připojený `#8fb4dd` bez symbolu.

Vyplavalo přitom najevo, co model elektřiny znamená v praxi: proud vede po
silnicích **a po budovách**, takže dům uprostřed bloku bez souvislé řady sousedů
zůstane temný, i když silnice vede o dvě dlaždice dál. Teď je to vidět.

- [x] T19 — prerekvizity (fáze 2)

Vzniklo:
- sekce `requirements` ve schématu: `services` (minimální pokrytí třídy v buňce
  budovy) a `buildings` (definice, která musí ve městě stát)
- `src/sim/requirements.ts` — vyhodnocení, vrací `CommandResult`, ne `boolean`,
  aby hráč věděl, **co** chybí

Vyhodnocuje se na všech třech místech, kde budova vzniká:
- **růst** — parcela se nezastaví, dokud podmínka neplatí
- **povýšení** — kontroluje se definice **kandidáta**, ne té současné (§8)
- **ruční stavba** — odmítnutí i s důvodem, a hlavně **před** stržením peněz

Seznam postavených definic se počítá jednou za běh systému, ne u každého
pokusu. Ruina se za postavenou budovu nepočítá — prázdná budova nic neposkytuje.

`I18n.t` nově přeloží i **parametr, který je sám lokalizačním klíčem**. Bez
toho by hláška o chybějící službě musela nést buď anglické id třídy, nebo by
simulace musela znát texty. Hláška o chybějící budově díky tomu ukazuje její
jméno, ne `vanilla:school`.

Vanilla obsah 2a **žádnou podmínku nemá** (rozhodnutí autora v §7) a hlídá to
test. Mechanismus je tedy hotový a čeká na hodnoty: §6 počítá s tím, že
vzdělání bude bránou k vyšším úrovním obchodu a průmyslu — je to změna JSONu.

Testy: 11 v `tests/requirements.test.ts`. Že koušou, ověřeno rozbitím: bez
kontroly podmínek padne sedm, bez kontroly při povyšování jeden.

- [x] T20 — save verze 2, migrace, fixtury (fáze 2)

Formát verze 2 doplnil to, co fáze 2 přinesla a save dosud zahazoval:

- **`coarse.bin`** — hrubé vrstvy (znečištění, cena půdy, kriminalita) v pořadí
  `SAVE_COARSE_LAYER_ORDER`. Vlastní soubor, ne přílepek k `layers.bin`: jsou
  na jiné mřížce a míchat je do jednoho bufferu by znamenalo číst bajty podle
  toho, co je zrovna v kódu
- **`meta.grid`** — `{ size, coarseSize }`. Do verze 1 byla velikost `layers.bin`
  implicitní; s druhou mřížkou to přestalo platit
- `abandoned` a `levelChangedAtTick` na entitě
- `state.serviceFunding` — nastavení posuvníků financování

**Migrace v1 → v2** podle §11: hrubé vrstvy se vynulují, `abandoned = false`,
`levelChangedAtTick = 0`, financování všech tříd 100 % (prázdná mapa), `grid`
se doplní podle rozměrů, se kterými verze 1 mlčky počítala. Pokrytí se po
načtení přepočítá vždycky — je odvozené a do savu nepatří.

Fixtura `v2.city.base64` vznikla vedle `v1.city.base64`. Testy nad nimi teď
kromě načtení ověřují i to, že se ve hře dá pokračovat (populace nespadne na
nulu a cena půdy se dopočítá), a hlídá se, že **ke každé vydané verzi formátu
fixtura existuje** — příště na ni nepůjde zapomenout.

Round-trip ověřen v běžící hře: quicksave a quickload vrátily město na tik 411
se stejnou populací, stejným stavem RNG a hlavně se **znečištěním 24, cenou
půdy 43 a financováním parků 0,4** — přesně ty tři věci, které verze 1
zahazovala. Pokrytí se po loadu dopočítalo (parky 36).

Že testy koušou, ověřeno rozbitím: bez ukládání hrubých vrstev padne round-trip,
bez nulování v migraci tři testy fixtury v1, bez financování jeden.

- [x] T21 — UI: overlaye, financování, diagnostika parcely (fáze 2)

Přepínač overlayů a panel financování stály z T14; T21 je doplnil a přidal to
podstatné — **rozbor parcely**. Podle §12 je to jediná věc, která z fáze 2 dělá
hru místo tabulky: pět neviditelných veličin hráč jinak nemá jak přečíst.

Pravé tlačítko teď otevře detail **jakékoli** dlaždice, s budovou i bez ní:

```
Rozbor parcely
Pozice                24, 33
Cena půdy             60
Silnice               3 dlaždice, skóre × 30 %
Poptávka              2
Potřeba na vyšší úroveň  90
Základ                +40
Parky                 +36
Znečištění             −1
Kriminalita           −15
Cena půdy směřuje k   60
```

- `src/sim/diagnostics.ts` vrací **čísla, ne texty** — `sim/` nesmí znát řetězce
- **vzorec ceny půdy je jeden**: `explainLandValue` používá diagnostika i
  `landValueSystem`. Kdyby si každý počítal svůj, ukazoval by panel něco jiného,
  než podle čeho se hraje. Hlídá to test přes všech 1024 buněk — součet sčítanců
  musí sedět a vrstva k němu musí dojít
- řádek „Silnice" odpovídá na nejčastější otázku hráče: parcela mimo dosah
  hlásí **„mimo dosah — tady nic nevyroste"**
- práh další úrovně už je snížený o úlevu za poptávku, takže je to číslo,
  se kterým jde porovnat cena půdy vedle
- overlay dostala každá třída služeb, ne jen policie; seznam jde z obsahu, takže
  mod se svou třídou dostane přepínač zadarmo

Ověřeno v běžící hře skutečným kliknutím: panel u parku ukazuje `Parky +36`,
u skládky `Znečištění −8`, na parcele za dosahem silnice hlášku o dosahu.
Přepínačů je devět, posuvníků financování pět.

Testy: 6 v `tests/diagnostics.test.ts`. Že koušou, ověřeno rozbitím: bez
znečištění v rozpisu padnou dva testy ceny půdy, bez ořezu dosahu jeden.

**Tím je fáze 2 hotová** — T11 až T21 uzavřeny.

- [x] T22 — generátor mapy, šest typů terénu (fáze 3a)

Zadání fáze 3 leží v `docs/04-FAZE-3.md`. Rozhodnutí R6–R12 beru jako
odsouhlasená tím, že autor předal zadání se slovy „pusť se do práce".

Vzniklo:
- `src/sim/mapgen/` pod P1 — žádný renderer, veškerá náhoda z `Rng` (P2)
- hodnotový šum a fBm vlastní, ne z knihovny: je to třicet řádků a determinismus
  musí být náš
- terén rozšířen ze čtyř hodnot na šest (les, mokřad) i s barvami v paletě
- sekce `map` v `balance.json`, mapa se generuje ze seedu při startu hry

**Prahy jsou kvantily, ne pevné hodnoty.** Normalizovaný fBm má u každého seedu
jiné rozpětí, takže pevná hladina dala jednou pevninu bez moře a podruhé mapu
z 87 % pod vodou — obojí se stalo při ladění. Teď `seaLevel = 0,28` vždycky
znamená „28 % mapy je voda" a `forestDensity = 0,35` „třetina trávy zaroste"
(předtím z toho vycházelo šest procent).

**Souvislá souš (R7)** se nedělá zaplavením ostrovů, ale zvednutím nejkratšího
pásu vody mezi ostrovem a pevninou — hráč tak nepřijde o plochu. Dvě věci, které
to stály:
- šíje široká jednu dlaždici vypadala jako čára narýsovaná pravítkem, takže se
  rozšiřuje o sousedy
- cesta se musí sledovat **až na hlavní pevninu**, ne k první souši. Zastavit se
  na dlaždici zvednuté předchozím rozšířením znamenalo nedokončený most a nový
  ostrůvek — invariant padal na pětině seedů

Testy: 7 v `tests/mapgen.test.ts`, mimo jiné souvislost souše na 200 seedech
a golden hash mapy. Generování jedné mapy trvá ~25 ms, takže přegenerování
náhledu v dialogu nové hry (T23) bude okamžité.

- [x] Dodělávka T22 — terén něco dělá

Šest typů terénu by bez efektů byla dekorace, a zadání §2 výslovně říká opak.

- **les** zvedá cenu půdy (váha 18 na podíl buňky) a **pohlcuje polovinu
  znečištění**, dokud stojí. Pohlcení se počítá až za difuzí, aby filtrovalo
  i to, co přiteče od sousedů — jinak by les chránil jen před vlastní továrnou
- **písek** cenu půdy mírně sráží
- **vykácení** stojí peníze a je to volba: buldozer na lese sebere 12 a uvolní
  místo (akceptační kritérium 3a č. 4)
- mokřad ani skálu buldozer nespraví — to je terraforming ve 3b

Podíly terénu se počítají na hrubou mřížku jednou za běh systému a předávají
do vzorce ceny půdy; diagnostika parcely je dostane stejnou cestou, takže
rozpis pořád sedí s tím, podle čeho se hraje.

Rozsah vah ceny půdy jsem povolil na ±100: váhy pokrytí násobí vstup 0–255,
kdežto váhy terénu podíl 0–1, takže musí být řádově větší.

- [x] T23 — dialog nové hry (fáze 3a)

Hra začíná dialogem: jméno města, seed (náhodný, ručně přepsatelný), **náhled
mapy** a tlačítko „jiná mapa". Teprve po potvrzení vzniká svět — a tím padá
i dluh z fáze 1, že se město dá pojmenovat jen v kódu.

- náhled je prostý bitmapový render vrstvy terénu, ne izometrický: jde o tvar
  pevniny, ne o obrázek města
- `Math.random` v dialogu neporušuje P2 — ta zakazuje náhodu **v simulaci**,
  ne ve výběru seedu, se kterým se hra teprve rozjede
- pod náhledem je podíl souše a čas generování; při ~12–37 ms je přegenerování
  okamžité, takže načítací proužek nemá co dělat

Ověřeno v běžící hře skutečnými kliky: „jiná mapa" změní seed i náhled, ručně
zapsaný seed 12345 se projeví a po „Založit město" má svět `seed === 12345`
a 28 % vody.

**Otevřené:** načíst uložené město jde až zevnitř hry, takže hráč musí nejdřív
projít dialogem. Patří to k němu, ale zadání to nezmiňuje — doplním, až bude
jasné, jestli má vzniknout i seznam uložených her.

- [x] Oprava: hřebeny přes moře (nahlásil autor)

Spojování ostrovů šíjemi bylo špatně. Na členitých mapách jich vznikly desítky
a vypadaly jako hřebeny narýsované přes celé moře — autor to poznal na první
pohled a měl pravdu.

Šíje jsem zrušil úplně. Ostrovy se **zaplaví**, protože měření ukázalo, že
medián mapy má stejně **99 % souše v jednom kuse**; topí se tedy pár ostrůvků,
které se nedaly zastavět. Kdyby to znamenalo ztrátu větší než `minLandShare`
(3 %), generátor **ubere vodu a zkusí to znovu** — méně vody znamená míň
ostrovů. Až pět pokusů.

Výsledek na 80 seedech: voda medián 28 % (přesně nastavená hodnota), p25 23 %,
v nejhorším případě 12 %. Souvislost souše drží dál na 200 seedech a přibyl
test, že snižování hladiny nesmí moře vysušit — jinak by bonus ceny půdy u vody
neměl kde platit.

- [x] T24 — typy silnic (fáze 3a)

Vrstva `road` přestala být 0/1 a nese typ (R11): ulice, třída, dálnice. Čísla
jsou v `balance.traffic.roadTypes`, kód zná jen pořadí — přidat čtvrtý typ je
změna JSONu a jednoho lokalizačního klíče, včetně tlačítka v liště.

| typ | kapacita | cena | údržba |
|---|---|---|---|
| ulice | 60 | 10 | 1 |
| třída | 180 | 40 | 3 |
| dálnice | 480 | 120 | 8 |

- **silnice nově stojí peníze** a mají údržbu; v ekonomické tabulce mají vlastní
  řádek, protože to nejsou budovy a hráč jich má tisíce
- **vylepšení na místě** ano, snížení ne (§4) — jinak by šlo třídu „prodat"
  za rozdíl cen. Kdo chce zpátky ulici, zbourá a postaví
- **auto-tiling napříč typy**: bitmask se počítá z „je tam jakákoli silnice",
  šířku a barvu určuje typ vlastní dlaždice. Vyšší typ je širší a světlejší
- kapacita se zatím nikde nepoužívá — čeká na dopravní model v T25

Ověřeno v běžící hře: ceny 10 / 40 / 120 sedí, vylepšení ulice na dálnici
projde, snížení skončí hláškou `error.roadDowngrade`, v liště jsou tři
tlačítka z balancu a renderer kreslí všechny tři barvy vozovek.

Testy: 13 v `tests/roadTypes.test.ts`. Že koušou, ověřeno rozbitím: povolené
snížení shodí jeden test, silnice zdarma tři, nezapočtená údržba jeden.

- [x] T25 — dopravní model (fáze 3a)

Vzorkování náhodných cest po vzoru Micropolisu: z domu vyrazí pár chodců, ti se
toulají po silnicích a počítá se, kolik jich narazí na práci. Vzniká z toho
`trafficLoad` (kudy se chodilo) a `jobAccess` (podíl úspěšných cest, vyhlazený).

- systém 8/4, vzorkuje `maxBuildingsPerRun` budov za běh a kruh drží
  `world.trafficCursor` — **ten jediný z dopravy patří do savu** (R10), jinak
  by se po načtení začalo od začátku a determinismus by padl
- chodec se **nevrací, odkud přišel**; bez toho se procházka zacyklí na místě
- overlay dopravy je v plném rozlišení, ne na hrubé mřížce: smysl je ukázat
  konkrétní ucpaný úsek. Barva jde po stupních od zelené po červenou

**Dvě věci vyplavaly až při zkoušce ve hře**, ne z testů:

1. **Polovina domů měla dosažitelnost práce nula napořád** (17 z 32). Doprava
   chtěla silnici hned vedle domu, ale růst je staví až tři dlaždice od vozovky
   (§9 fáze 2). Chodec teď vyráží z nejbližší silnice **v dosahu růstu**, takže
   si obě pravidla neodporují. Po opravě 32 z 32.
2. **Overlay svítil celý červeně.** Zátěž nesla jednotku „populace × počet
   vzorkovacích cest", takže neodpovídala kapacitám. Váha se teď dělí počtem
   pokusů a kapacita silnice znamená „kolika obyvatelům odsud stačí".

Ověřeno ve hře i akceptační kritérium 3a č. 5, které patří až k T26: povýšení
páteřní ulice na třídu srazilo vytížení z **1,18 na 0,36** a overlay zezelenal.

Testy: 14 v `tests/traffic.test.ts` včetně determinismu a kurzoru vzorkování.
Že koušou, ověřeno rozbitím: bez pravidla o vracení jeden, bez posunu kurzoru
jeden, bez nulování zátěže jeden.

- [x] T26 — kolony do ceny půdy, dostupnost práce do růstu (fáze 3a)

Doprava se konečně vrací do smyčky: ucpané ulice srážejí cenu půdy a špatná
dostupnost práce brzdí růst.

- **kolony**: `coarseCongestion` zprůměruje `zátěž / kapacita` přes silniční
  dlaždice buňky, stropem 2 (víc než dvojnásobek kapacity už je prostě „stojí
  to"). Do ceny půdy vstupuje záporně s vahou 22. Vzniká záporná zpětná vazba:
  dražší půda → vyšší úrovně → hustší zástavba → víc dopravy → kolony →
  levnější půda. Zahušťování se samo zastaví, dokud hráč nezlepší dopravu
- **dostupnost práce vstupuje dvakrát, a je to úmysl:**
  - **po čtvrtích** do skóre parcely — dobře obsloužená čtvrť se zaplní dřív
  - **celoměstsky** do počtu pokusů o stavbu — protože rovnoměrný násobitel by
    se ve váženém losu vykrátil a město bez spojení by rostlo stejně rychle
    jako město s metrem. Přesně ta past, do které spadl faktor daně v T18;
    tady ji odhalilo až mutační testování, kdy dvě rozbití kódu prošla testy
- **`minAccessFactor` 0,15 moduluje, nevetuje** — nejnižší hodnota není nula,
  takže se čtvrť zpomalí, ale nezasekne. K tomu pojistka z R6: dokud město nemá
  ani jedno pracovní místo, je faktor 1 pro všechny, jinak by se hra zamkla
  hned na začátku, kdy dosažitelnost nutně nula je

**Panel parcely ukazuje obě čísla vždycky**, i když jsou to jedničky — jinak
by hráč ani netušil, že tahle brzda existuje. Zobrazuje přesně ta čísla, se
kterými růst opravdu počítal (`world.jobAccessCells`, `world.cityJobAccess`;
odvozené, do savu nepatří).

Při ověřování ve hře vypadly dvě věci mimo zadání, obojí opraveno:

1. **Simulace se dala natrvalo zabít jedním `NaN`.** Stačilo, aby `step()`
   dostal nečíselnou deltu, akumulátor zůstal `NaN`, žádné porovnání s `TICK_MS`
   už neprošlo a hra se tiše zastavila — bez chyby, bez varování, jen zamrzlé
   hodiny. Teď to spadne hned a nahlas u viníka.
2. **V rozpisu ceny půdy svítily holé klíče.** Popisek se skládá za běhu ze
   jména váhy, takže test na literální klíče `t('…')` ho neviděl — chyběly
   kolony, les i písek (les od T24). Nový test projde všechny váhy z balancu
   proti oběma jazykům, takže další přidaná veličina se neprozradí až v UI.

Ověřeno v běžící hře: nacpané ulice srazily cenu půdy z 40 na −4 (člen kolon
−44 při dvojnásobku kapacity), panel ukazuje „Kolony −8" a řádek dostupnosti
práce. Město s nedosažitelnou prací spadlo na obě podlahy 0,15 a rostlo dál —
zastavila ho až záporná poptávka po bydlení, tedy RCI, ne dostupnost.

Testy: 7 v `tests/congestion.test.ts`, 1 v `tests/simHost.test.ts`, 1
v `tests/i18n.test.ts`. Že koušou, ověřeno rozbitím: vynechaný člen kolon
shodí jeden, zrušená pojistka proti uzamčení jeden, nulová podlaha jeden,
dostupnost mimo počet pokusů dva, chybějící pojistka proti `NaN` jeden,
smazaný překlad jeden.

- [x] T27 — MHD: třída `transit`, zastávky, vozovna jako prerekvizita (fáze 3a)

MHD je ve 3a **obyčejná třída služby** nad mechanismem z T13 (rozhodnutí autora
— linky s vozidly jsou pozdější fáze). Nový kód je jedna funkce v dopravním
modelu, zbytek je obsah.

- **zastávka** (`vanilla:transit_stop`, 150 / 30 za měsíc) — třída `transit`,
  poloměr 3 buňky, síla 110. Váha budovy v dopravním modelu se násobí
  `1 − pokrytí × transitReduction`, kde `transitReduction` je 0,6
- **vozovna** (`vanilla:transit_depot`, 3×3, 900 / 150) — **nepokrývá nic**,
  je to čistá prerekvizita zastávky. První ostré použití mechanismu z T19,
  který byl doteď implementovaný, ale nevyužitý
- **ubírá se zátěž, ne dosažitelnost práce.** Kdyby zastávka zvedala i
  `jobAccess`, byla by to zkratka, jak rozjet růst úplně bez silnic — a takový
  model tahle hra nemá. MHD přesouvá lidi z aut, nic nezkracuje
- **plné pokrytí sebere 60 %, ne všechno**; i s dokonalou MHD něco po silnicích
  jezdí dál

Lišta, overlay „Dosah MHD" i posuvník financování vznikly samy z obsahu (P5) —
kód se kvůli nové třídě služby nezměnil ani řádkem.

Ověřeno v běžící hře na městě se 49 budovami: zastávka bez vozovny skončí
hláškou „Nejdřív musí ve městě stát Vozovna MHD.", po postavení vozovny a tří
zastávek klesla zátěž na páteřní ulici z **1994 na 1312 (0,66×)**. Tím jsou
splněná akceptační kritéria 3a č. 8 a 9.

Mimochodem se ukázalo, že **neznámý `graphics.icon` se tiše ignoroval** —
budova prostě vyjela bez symbolu a nic nikde nezahlásilo. Přibyl tvar `bus`
a test, který projde všechny ikony z obsahu proti sadě tvarů v rendereru.

Testy: 6 v `tests/transit.test.ts`, 1 v `tests/render.test.ts`; tři starší
testy, které vyjmenovávaly vanilla obsah, se rozšířily — mezi nimi ten, který
tvrdil, že nic nic nepodmiňuje. Že koušou, ověřeno rozbitím: vypnutý násobitel
shodí dva, MHD bez stropu jeden, MHD do dosažitelnosti práce jeden, zastávka
bez prerekvizity tři, chybějící tvar autobusu jeden.

- [x] T28 — save verze 3, migrace, fixtura (fáze 3a hotová)

Formát savu povýšil na 3. Přibylo jen to, co fáze 3a opravdu přinesla:

- **`meta.map`** — `{ seed, generated }`. Ze seedu jde terén kdykoli
  vygenerovat znovu; parametry generátoru se sem nepíšou, protože sedí
  v balancu, a ten save eviduje přes `content.sources`
- **`state.trafficCursor`** — jediná věc z celé dopravy, která do savu patří
  (R10). Bez něj by se po načtení vzorkovalo od začátku a determinismus by padl

**Vrstvy se nepřepisují ani jednou, a je to schválně.** Zadání předepisuje
mapování „road 1 → ulice", jenže `ROAD.street` **je** 1, takže je to identita;
přepisovat bajty by byla jen příležitost udělat chybu. Nové terény (les,
mokřad) se přidaly za stávající hodnoty, takže 0–3 znamenají pořád totéž. Aby
to tak zůstalo, hlídá čísla obou výčtů vlastní test.

**Migrace v2 → v3** doplní `map: { seed: 0, generated: false }` a nulový kurzor.
Seed schválně nula, ne `city.seed`: v době verze 2 generátor neexistoval a každá
mapa byla holá tráva — tvrdit, že vznikla z toho seedu, by byla lež, protože
podle něj by dnes vyšel úplně jiný terén.

Při psaní se našla **stará díra ze stejné rodiny jako pokrytí v T20**:
`applySaveToWorld` nemazal zátěž silnic ani dosažitelnost práce, takže se
odvozená doprava předchozího města přelila do načteného — jiné silnice, jiná
id budov. Teď se obojí nuluje, kurzor se bere ze savu.

Fixtura `v3.city.base64` je skutečný save z běžící hry: mapa z generátoru,
všechny tři typy vozovky, elektrárna, park, vozovna i zastávka MHD, financování
parků 0,75.

Ověřeno v běžící hře: s pauzou vyšly tik, stav RNG i kasa po quickloadu na
bit stejně, kurzor se vrátil na uloženou sedmičku a zátěž s dosažitelností byly
vyčištěné. A hlavně — **skutečný save hráče z Downloads** (`mesto (8).city`,
verze 1, 638 budov, 6666 obyvatel) prošel migrací v1 → v2 → v3 a hraje se dál:
populace beze změny, žádné ruiny, cena půdy 219. Tím je splněné akceptační
kritérium 3a č. 10 a **fáze 3a je hotová**.

Testy: 3 v `tests/save.test.ts`, 3 v `tests/migrations.test.ts` plus fixtura
v3, kterou automaticky prochází všech pět testů nad fixturami. Že koušou,
ověřeno rozbitím: chybějící migrace shodí pět, lživý původ mapy jeden,
neuložený kurzor jeden, neuložený původ mapy jeden, nevyčištěná doprava jeden.

- [x] T29 — `cornerHeight`, invariant rohů, patra z generátoru, řeky (fáze 3b)

Terén dostal výšku. Zatím jen v simulaci — renderer ji začne kreslit v T30,
takže mapa vypadá pořád placatě, ale data pod ní už členitá jsou.

- **výška patří rohu, ne dlaždici.** Mřížka rohů je 129×129 proti 128×128
  dlaždicím. Kdyby výška patřila dlaždici, každý svah by byl schod a sousední
  dlaždice by se nikdy nedotýkaly
- **invariant: sousední rohy se liší nejvýš o 1.** Vynucuje ho kaskáda —
  zvednutí rohu si vytáhne sousedy s sebou. Bez toho by šlo postavit svislou
  stěnu, kterou renderer neumí nakreslit a picking trefit
- **jen kolmí sousedé, ne úhlopříční.** Rohy jedné dlaždice se tím pádem smí
  lišit o dva a vzniká „zkroucená" dlaždice tvaru sedla. Zadání s ní počítá
  (silnice ji nepobere), a bez té volnosti by terén ztuhl do samých teras
- **plán a zápis jsou oddělené.** `planCornerHeight` vrátí mapu `roh → výška`
  a **nic nemění**; teprve `applyCornerChanges` zapisuje. Terraforming z T32
  z toho spočítá cenu **než** se hráče zeptá — akceptační kritérium 14 chce
  cenu předem, a to by se zpětně dolepovalo špatně

Generátor patra vzorkuje **přímo v rozích** (fBm umí libovolné souřadnice,
takže se nic neprůměruje), rohy vody srazí na nulu a zbytek srovná
`relaxHeights`. Škáluje se od hladiny, ne od nuly, takže „patro 0" znamená
u moře bez ohledu na to, kde u daného seedu hladina vyšla. Vrchol se bere jako
kvantil 0,995 — jediná špička šumu by jinak stlačila celou souš do prvního
patra.

**Řeky jsou hotové, ale ve vanille vypnuté** (`map.rivers: 0`). Je to vědomé:
řeka rozdělí souš na dva břehy a most přijde až v T33, takže do té doby by z ní
byla jen nepřístupná polovina mapy. Testy si je zapínají vlastním balancem, což
je přesně to, k čemu je P5 dobré. Až budou mosty, je to změna jednoho čísla
v JSONu.

Ověřeno v běžící hře: mapa 129×129 rohů, **nula porušení invariantu**, patra
0–10 s rozumným rozložením (42 % rohů u moře, deset pater nahoře), voda všude
na nule a 43 % dlaždic je svah. Zvednutí rohu uprostřed mapy na patnáct
rozhýbalo **320 rohů** a invariant zůstal celý.

Testy: 12 v `tests/heights.test.ts`, 7 v `tests/mapgen.test.ts` včetně
invariantu na 200 seedech. Že koušou, ověřeno rozbitím: kaskáda bez šíření
shodí pět, `relaxHeights` bez práce tři, špatně poznané sedlo jeden,
nenulované rohy vody jeden, ignorovaný `maxHeight` jeden, nekopané řeky dva.
Ten test na vodu byl napoprvé slabý — ptal se na nejnižší roh, takže mu
uniklo, že hladina může být nakloněná; teď kontroluje nejvyšší.

- [x] T30 — renderer svahů, re-bake chunků, řazení podle výšky (fáze 3b)

Terén z T29 je konečně vidět. Dlaždice se přestala kreslit jako pravidelný
diamant a je z ní **čtyřúhelník ze čtyř promítnutých rohů**. Sousedi sdílí rohy
a počítají se ze stejných čísel, takže terén nikde nepraskne — hlídá to test.

- **stínování podle sklonu.** Bez něj by svah vypadal jako rovina: izometrie
  nemá perspektivu, která by tvar prozradila, a barva terénu je stejná. Světlo
  svítí od severozápadu, přivrácené plochy jsou světlejší, odvrácené tmavší.
  Plošina ve třetím patře **není svah**, takže se nestínuje
- **vozovka jde po ploše dlaždice.** `roadPolygons` bere skutečné vrcholy
  místo počátku diamantu, jinak by se na svahu od terénu odlepila. Střed se
  počítá jako průměr rohů, takže geometrie sedí i na zkroucené dlaždici
- **budovy sedí na výšce základny** (nejnižší roh) a s terénem se posunou
- **řazení**: při shodné hloubce rozhoduje výška základny sestupně (§7). Dvě
  budovy ve stejné hloubce, jedna na kopci a druhá pod ním, se v izometrii
  překrývají a ta výš stojící je dál od pozorovatele

**Chunky dostaly `zIndex` podle `cx + cy`.** Na ploché mapě to bylo jedno,
protože diamanty do sebe zapadají bez přesahu a pořadí vzniku (po řádcích)
nikoho netrápilo. S převýšením kopec přesahuje do sousedního chunku a ten se
kreslil přes něj.

**Re-bake**: `applyHeightChanges` zapíše nové výšky a označí, co se musí
překreslit. Jeden roh drží **čtyři dlaždice**; kdyby se označila jen jedna,
zůstal by na mapě viset zlom. Budovy na dotčených dlaždicích se hlásí zvlášť —
kreslí je jiný renderer, který `dirty.tiles` nečte.

Ověřeno v běžící hře **po pixelech**, protože panel prohlížeče byl schovaný a
snímek obrazovky nešel pořídit. Přes `renderer.extract` vyšla stejná tráva na
rovině jako RGB(107, 155, 74) a na jižním svahu (100, 144, 69) — poměr jasu
0,93, přesně to, co předepisuje `slopeLight`. Zvednutí jednoho rohu o dvě patra
rozhýbalo pět rohů, označilo dvanáct dlaždic a po překreslení **jenom jich**
se barva změnila na (92, 133, 64).

Testy: 6 nových v `tests/render.test.ts`, 3 v `tests/heights.test.ts`. Že
koušou, ověřeno rozbitím: dlaždice bez výšek rohů shodí dva, nestínovaný svah
jeden, budova bez základny jeden, označení jediné dlaždice jeden, nehlášené
budovy jeden. **Pořadí chunků test nemá** — je to jedna vlastnost objektu Pixi
a testy Pixi nespouští; ověřeno jen ve hře.

- [x] T31 — picking od předu dozadu, konec `screenToGrid` (fáze 3b)

Klikání na terén se přepsalo od základu. `screenToGrid` byla inverze projekce,
jenže ta je jednoznačná jen na placce: jakmile má každý roh vlastní výšku, jeden
bod na obrazovce může patřit několika dlaždicím nad sebou a inverze nemá co
vracet. Zadání proto předepisuje **nahrazení, ne opravu**.

Nový postup jde po dlaždicích **od nejbližší dozadu** a ptá se, jestli kurzor
leží uvnitř promítnutého čtyřúhelníku. První zásah vyhrává, takže výsledek je
z definice ta dlaždice, kterou hráč vidí.

- **netestuje se celá mapa.** Zvednutá dlaždice se posune nahoru o patro na
  výškovou úroveň, a protože `LEVEL_H` je půlka `TILE_H`, je to zároveň posun
  o jedna v součtu `x + y`. Kandidáti tak leží v úzkém pásu; rozdíl `x − y`
  výška nemění vůbec. Vyjde z toho ~40 testů na klik místo 16 384
- **ray casting, ne test na konvexní tvar.** Zkroucená dlaždice se promítne
  jako nekonvexní čtyřúhelník a hráč na ni musí umět kliknout jako na každou
  jinou
- **`screenToGrid` je pryč ze `src/`.** Nechat ji tam by byla past — na svahu
  vrací špatnou dlaždici a nic by na to neupozornilo. Vzorec zůstal jen
  v testu, jako doklad, že nová cesta řeší něco, co ta stará neuměla
- rámeček pod kurzorem se taky posadil na výšku terénu

Ověřeno na skutečné vygenerované mapě: **625 vzorků po celé mapě, 621 trefilo
přesně tu dlaždici, ze které vzorek pocházel.** Stará inverze by na těch samých
bodech minula ve 267 případech ze 625, tedy ve 43 %.

Zbylé čtyři případy stály za rozbor a **nejsou to chyby**: bod uprostřed zadní
dlaždice v nich vůbec neleží uvnitř jejího čtyřúhelníku, zato leží v tom
předním. Terén tam stoupá k pozorovateli, takže přední dlaždice tu zadní
opravdu zakrývá — picking vrátil to, co je vidět. Chybný byl předpoklad mé
sondy, ne kód. Na ten případ je teď vlastní test.

Testy: 6 nových v `tests/render.test.ts`. Že koušou, ověřeno rozbitím: hledání
odzadu dopředu shodí jeden, výška vynechaná z pásu kandidátů dva, test na
obálku místo ray castingu pět, chybějící kontrola hranic mapy jeden.

- [x] T32 — terraforming: nástroje, kaskáda, ceny (fáze 3b)

Hráč konečně smí sáhnout na terén. Tři nástroje v liště — zvednout roh (E),
snížit roh (D), srovnat dlaždici (F) — nad kaskádou z T29.

- **odhad a provedení jsou oddělené.** `estimateCornerHeight` a
  `estimateLevelArea` spočítají, kolik rohů se hne a co to stojí, a **nic
  nemění**. Teprve pak se sahá na kasu. Kvůli tomu byl plán oddělený od zápisu
  už v T29 — bez toho by nešlo ukázat cenu dřív, než hráč klikne
- **účtuje se celá kaskáda** (§12 kritérium 13), ne roh, na který se kliklo.
  Zvednutí u strmého svahu rozhýbe desítky rohů a hráč to má vidět na účtu
- **cena počítá rohy, ne patra.** Vyšlo z toho pravidlo, které jsem nečekal a
  které je vlastně dobré: **zvednout o čtyři patra naráz je levnější než
  čtyřikrát o jedno**, protože kdo zvedá po jednom, platí každý prstenec
  kaskády znovu. Původní test tvrdil něco jiného a byl špatně
- **pod budovou se terén nehne ani nahoru, ani dolů.** Zadání zakazuje
  snižování; zvedání zakazuju taky, protože budova stojí na rovině a nakloněný
  terén pod ní by ji zavěsil do vzduchu. Srovnat parcelu jde **před** stavbou,
  a to je T33
- **budova zasažená až kaskádou zastaví celou operaci.** Provést půlku kaskády
  by porušilo invariant
- **dno moře se nezvedá**, ale u vody se smí snižovat — jinak by nešel srovnat
  ani břeh. Silnice se hýbat smí, invariant drží svah v mezích sám
- srovnání jde na **zaokrouhlený průměr** rohů oblasti. Je to pro hráče
  nejlevnější varianta; srovnání na nejvyšší nebo nejnižší roh hýbe víc terénem
- terraforming míří na **nejbližší roh ke kurzoru**, ne pevně na severozápadní.
  Jinak by klik na pravou půlku dlaždice zvedl roh na opačné straně

Ověřeno v běžící hře: odhad slíbil 14 rohů za 112, příkaz strhl přesně 112 a
roh šel z prvního patra do čtvrtého bez jediného porušení invariantu. Srovnání
oblasti 3×3 udělalo z devíti nakloněných dlaždic devět rovných za 96. Pokus
zvednout terén pod budovou skončil hláškou, stejně jako pokus zvednout dno u
pobřeží. A po pixelech: dlaždice šla z rovné (107, 155, 74) na svah
(94, 137, 65) po překreslení 39 označených dlaždic.

Testy: 15 v `tests/terraform.test.ts`. Že koušou, ověřeno rozbitím: cena za
jediný roh shodí tři, budova bez zákazu dva, povolené zvedání dna jeden,
placení za nulovou práci dva, srovnání ignorující předchozí kaskády jeden.

**Náhled ceny na hover zatím není** — funkce na to jsou hotové a otestované,
ale do UI je zapojí až T33, kde na tom stojí akceptační kritérium 14.

- [x] T33 — pravidla na svazích, srovnání pod budovou, mosty, skála a mokřad (3b)

Nejširší úkol 3b. Terén přestal být kulisa a začal být překážka, se kterou se
dá něco dělat.

- **budovy chtějí rovinu.** `checkFootprint` svah odmítne, ale ruční stavba ho
  **srovná a postaví** — o to hráči jde. Odmítnutí je pro růst, nabídka pro
  hráče
- **cena předem** (§12 kritérium 14): `estimatePlacement` vrátí cenu budovy
  i srovnání zvlášť a nic nemění. Nová cenovka u kurzoru ukazuje třeba
  „4 128 (z toho 128 za srovnání)", takže se hráč nedozví o svahu až z účtu
- **silnice snese rovnoměrný svah, sedlo ne.** Zkroucenou dlaždici nejde
  přejet po rovině ani nakreslit jako vozovku
- **most** je vozovka na vodě s vlastní cenou (150 proti 10 za ulici). Staví se
  **jen z břehu dál**, aby nešlo položit kus vozovky doprostřed moře. Zbourání
  nechá vodu vodou
- **skálu jde odtěžit (60) a mokřad zavézt (40)** obyčejným buldozerem. Do 3a
  to byly terény, se kterými hráč nemohl dělat vůbec nic

**Dvě chyby, které vyplavaly až hraním, ne z testů:**

1. **Elektrárna celá na souši se odmítala postavit u pobřeží** s hláškou
   „zvedat dno moře neumíme". Srovnání totiž míří na průměr rohů a ten u břehu
   zvedne roh sdílený s vodou — moře by se naklonilo. Teď se u vody rovná na
   **nejnižší roh**: pobřežní svah se odkope, hladina zůstane.
2. **Město s poptávkou 26 stálo úplně a měsíce se nehnulo.** Ukázalo se, že to
   není T33, ale díra z T26: počet pokusů o stavbu vyšel na `0,487` a
   `Math.round` z toho udělal **nulu**. To přímo popírá R6 („roste pomalu, ne
   vůbec"). Zlomek pokusu se teď **losuje** z `world.rng` místo zaokrouhlování,
   takže střední hodnota sedí a pomalý růst je pomalý, ne žádný.

Ověřeno v běžící hře: elektrárna na nerovné parcele u pobřeží — odhad 4 000 +
120 za srovnání, strženo přesně 4 120. Most přes úžinu stál 150 podle balancu,
pod ním zůstala voda a silnice na něm drží. Po opravě zamrznutí město ožilo
(8 → 17 budov). A když růst zase zastavil, mělo to důvod, ne chybu: z 60
obytných parcel bylo 11 zastavěných, **28 les a 21 svah** — volná použitelná
ani jedna. Přesně tak to má vypadat, hráč musí kácet a srovnávat.

Testy: 12 v `tests/slopeRules.test.ts`, 1 v `tests/congestion.test.ts`, dva
starší testy se přepsaly, protože T33 vědomě mění jejich pravidla (silnice na
vodě, skála a mokřad). Že koušou, ověřeno rozbitím: budova na svahu shodí
jeden, neúčtované srovnání jeden, povolené sedlo pod silnicí jeden, most
uprostřed moře tři, most za cenu ulice jeden, skála zdarma jeden, návrat
`Math.round` u pokusů jeden.

- [x] T34 — save verze 4, migrace, fixtura (fáze 3b hotová)

Save se dorovnal s tím, co hra od T29 umí.

- **přibyl `heights.bin`** — patra v rozích, jeden bajt na roh. Vlastní soubor
  ze stejného důvodu jako `coarse.bin`: mřížka rohů je o jedna větší než mřížka
  dlaždic, takže míchat je do jednoho bufferu by znamenalo číst bajty podle
  toho, co je zrovna v kódu
- **zmizela vrstva `elevation`.** Od T29 byla mrtvá a od téhle verze je pryč
  i z bajtů. `layers.bin` se tím zkrátil z 114 688 na 98 304 B

**Migrace v3 → v4** dá staré mapě **rovinu**, všechny rohy na nule. Dopočítat
patra ze seedu by šlo jen u map z generátoru — a i tam by se rozešla s tím, co
hráč mezitím postavil. A hlavně musí **vystřihnout `elevation` z bufferu**: to
je nejnebezpečnější místo celé migrace, protože vrstvy leží za sebou a špatný
posun by z terénu udělal zóny, aniž by cokoli spadlo. Vlastní test proto
kontroluje, že terén zůstal na začátku beze změny a zbytek se posunul přesně
o jednu vrstvu.

Fixtura `v4.city.base64` je opět skutečný save: generovaná mapa s patry 0–10,
všechny tři typy vozovky, elektrárna, park, financování parků 0,75.

**Poznámka k tomu, jak vznikla.** Napoprvé jsem ji přenášel z prohlížeče ručně
po dvou kusech base64 a **transkripce se poškodila** — ZIP šel otevřít, ale
`entities.json` uvnitř byl rozbitý. Podruhé ji vyrobil kód: dočasný test ji
postavil v Node stejnými funkcemi a zapsal přes snapshot, odkud se jen
zkopírovala. Ručně přepisovat devět kilobajtů base64 je hloupost, kterou už
neopakuju.

Ověřeno v běžící hře: quicksave, vynulování všech pater, quickload — a patra
se vrátila přesně (součet 25 890, jedenáct různých hodnot, nula porušení
invariantu), stejně jako tik, stav RNG i kasa. A **skutečný save hráče**
(`mesto (8).city`, verze 1, 638 budov, 6 666 obyvatel) prošel migrací
v1 → v2 → v3 → v4 a hraje se dál: populace beze změny, žádné ruiny, cena půdy
219, terén rovina bez porušení invariantu.

Testy: 2 v `tests/save.test.ts`, 3 v `tests/migrations.test.ts` plus fixtura,
kterou automaticky prochází všech pět testů nad fixturami. Snapshoty hashů
vrstev se přepsaly — zrušená vrstva mění hash, což je vědomý důsledek, ne
překvapení. Že testy koušou, ověřeno rozbitím: chybějící migrace shodí čtyři,
nevystřižená vrstva čtyři, posun o špatný počet vrstev čtyři, neuložená patra
jeden, nenačtená patra dva.

**Fáze 3b je hotová** (T29–T34). Zbývá 3c: sítě a spokojenost.

- [x] T35 — potrubí, vodní síť, vodárna a čerpací stanice, chátrání bez vody (3c)

Začátek fáze 3c. Voda vypadá jako elektřina, ale **není to kopie s jiným
jménem** — liší se ve třech věcech a každá je záměr:

1. **Budovy vodu nevedou.** Elektřina teče přes silnice i budovy, voda jen
   potrubím. Kdo chce mít pod domem vodu, musí tam potrubí položit.
2. **Síť má dosah.** Voda dojde 24 dlaždic od vodárny. **Čerpací stanice** je
   zdroj bez vlastní výroby: sama musí být napojená a odtud rozjíždí nový
   dosah, takže síť prodlužuje po skocích. Odpojená stanice nedá vodu nikam —
   to je pravidlo, které odhalil až mutační test.
3. **Výsledek je runtime, ne vrstva.** `waterSupply` se po načtení spočítá
   znovu ze zdrojů a potrubí, takže se nemůže rozejít se skutečností.

- **`pipe` je nová vrstva** v plném rozlišení. Potrubí je pod zemí, takže smí
  ležet pod silnicí i pod budovou — právě proto je vlastní vrstva, ne další
  hodnota v `road`
- **vodárna musí stát u vody** (`construction.nearWater`), **čerpací stanice**
  ne — ta jen prodlužuje
- **bez vody se nestaví a chátrá** (kritérium 17): parcela bez vody stavbu
  odmítne, dům bez vody ztrácí obyvatele a po dvanácti vyhodnoceních prázdný
  zůstane ruinou. Týká se jen toho, co vodu podle definice potřebuje —
  elektrárna se obejde

**Vanilla obsah tím dostal ostrou bránu:** všech 21 obytných, komerčních
a průmyslových budov má `requiresWater: true`. Nové město tedy neroste, dokud
hráč nepostaví vodárnu a nenatáhne potrubí. Je to přesně to, co §8 chce, ale je
to velká změna hratelnosti — pět starších testů kvůli ní spadlo, protože
zkoumají jinou mechaniku. Dostaly helper `assumeWatered`, který řekne „město
vodovod má" a jde dál; vodovod samotný testuje `water.test.ts`, a ten si nic
takového nedovolí.

Ověřeno v běžící hře: zóna u pobřeží **6 400 tiků nevyrostla ani jednou budovu**.
Po postavení vodárny a natažení potrubí (63 zavodněných dlaždic) se růst rozjel
na 18 budov a **žádná z nich nebyla bez vody**. Cestou jsem si sám názorně
předvedl, proč potrubí musí být souvislé: první rozvod vedl řadou, která je pod
vodárnou mořem, takže se nenapojil a voda zůstala jen v jejím půdorysu.

Testy: 15 v `tests/water.test.ts`. Že koušou, ověřeno rozbitím: voda mimo
potrubí shodí tři, zrušený dosah dva, stanice jako samostatný zdroj jeden,
stanice bez prodloužení jeden, stavba bez vody jeden, vodárna bez břehu jeden.

- [x] T36 — podzemní pohled, kladení potrubí (fáze 3c)

Vodovod z T35 přestal být neviditelný a hráč se k němu konečně dostane.

- **podzemní pohled** je přepínač vedle overlayů, protože se tak i chová:
  vždycky nejvýš jeden. Terén ztmavne na 35 %, budovy zmizí úplně (hráč se
  dívá **pod** ně) a místo nich se kreslí potrubí a pokrytí vodou
- **trubky používají geometrii vozovky, jen užší.** Auto-tiling tím vyjde
  zadarmo a napojení vypadá jako napojení, ne jako řada čtverečků
- **stavební nástroj v tomhle režimu klade potrubí** místo silnice a **buldozer
  bourá trubky** místo toho, co stojí nad nimi. To druhé je vlastní příkaz
  `remove_pipe`: obyčejný buldozer bourá to nejvrchnější, takže by hráči
  mířícímu na trubku sundal dům
- **změna pokrytí vodou označí dotčené dlaždice** k překreslení. Bez toho by
  v podzemním pohledu zůstala na obrazovce stará voda, dokud by hráč nesáhl na
  dlaždici jinak. Označuje se **jen to, co se změnilo** — mutační test ukázal,
  že to původní znění netestovalo, protože se přepočet vůbec nespustil

Ověřeno v běžící hře po pixelech: nad zemí jsou obě dlaždice stejná tráva
RGB(107, 155, 74), pod zemí je trubka **(103, 182, 232)** a sousední dlaždice
bez ní ztlumená tráva **(37, 54, 26)** — přesně 35 % původního jasu. Klik
stavebním nástrojem v podzemním pohledu položil trubku a **silnici nechal**,
buldozer trubku sundal a **silnici nad ní nechal stát**. Tím je splněné
akceptační kritérium 3c č. 18.

Testy: 4 v `tests/water.test.ts`. Že koušou, ověřeno rozbitím: neoznačené
změny pokrytí shodí jeden, označování všeho jeden, buldozer sahající i na
silnici jeden.

- [x] Opravy po hlášení autora (mezi T36 a T37)

Tři hlášené příznaky, dvě příčiny — a ani jednu z nich testy nechytily.

**1. Rámeček pod kurzorem zmizel** (hlášeno jako „diamanty se nezobrazují, ani
u zón, ani u infrastruktury" a „nezobrazuje se vyznačení polí, která stavba
zabere" — je to jedna a tatáž grafika). **Regrese z T30**: kvůli řazení chunků
podle `cx + cy` jsem zapnul `sortableChildren` na **světovém** kontejneru, čímž
propadly pod terén všechny uzly, které zIndex nemají. Rámeček byl jedním z nich
a kreslil se pod mapou.

Oprava: chunky si řadí **vlastní kontejner**, světový zůstává v pořadí vkládání.
Tím past mizí i pro cokoli, co se do světa přidá později.

**2. U třídy a dálnice nešlo stavět.** `touchesRoad` porovnávala vrstvu
s jedničkou, jenže od T24 je 1 ulice, 2 třída a 3 dálnice — takže všechno
kromě ulice bylo pro budovy neviditelné. Sdílená pomocná funkce `isSet` teď
znamená „nenulová", ne „jednička". Růst, doprava ani diagnostika tuhle chybu
neměly, ptaly se správně; ostrá byla jen ruční stavba.

**Poučení:** obě chyby prošly kolem 494 testů. U řazení proto, že Pixi se
v testech nespouštělo vůbec — ukázalo se, že `Container` a `Graphics` jsou jen
grafy uzlů a v Node běží bez plátna, takže `tests/renderLayers.test.ts` teď
vrstvení hlídá. U silnic proto, že testy typů vozovky zkoumaly jen kreslení,
ne to, jestli se u nich dá stavět.

Testy: 2 v `tests/renderLayers.test.ts`, 1 v `tests/roadTypes.test.ts`. Že
koušou, ověřeno rozbitím: řazení světového kontejneru shodí jeden, chunky
přidané napřímo do rodiče jeden, návrat porovnání s jedničkou jeden.

- [x] T37 — kanalizace jako kapacita, čistírna (fáze 3c)

Kanalizace **není druhá síť trubek** (R9), ale celoměstská kapacita přesně po
vzoru odpadů z fáze 2: populace vyrobí splašky, čistírna část spolkne a zbytek
se přičte do zdrojového bufferu znečištění po celé mapě. Druhá kreslená síť by
znamenala další nástroj, další podzemní pohled a další flood fill za velmi
malou hloubku navíc.

- **`sewage: { capacity }`** na definici, **`sewage: { perCitizen, toPollution }`**
  v balancu. Stejný tvar jako odpady schválně — je to táž mechanika
- **čistírna** (`vanilla:water_treatment`, 1 200 / 160 za měsíc, kapacita 300)
  musí stát u vody, protože někam to vypouštět musí, a **sama trochu kouří**
- opuštěná čistírna nečistí, stejně jako opuštěná skládka nezpracovává odpad

Ověřeno v běžící hře oběma směry. Město o 600 obyvatelích vyrobí 84 jednotek
splašků; bez čistírny je znečištění **3 081** v součtu přes mapu a i v rohu
vzdáleném přes sto dlaždic od nejbližšího domu svítí **2**. Po postavení jediné
čistírny — schválně na opačném konci mapy — spadl součet na **7** a roh na
**nulu**. To je akceptační kritérium 3c č. 19.

**Poznámka k jedné mutaci.** `Math.max(0, …)` na nevyčištěném zbytku je
**nadbytečný**: o kus níž stojí `if (cityWide > 0)`, takže záporný přebytek se
nikdy neuplatní. Mutace ho odstranila a žádný test nespadl — a nemohl, jsou to
ekvivalentní varianty. Nechal jsem ho tam, protože říká úmysl u toho členu
samotného, a doplnil test, který chytí odstranění **obou** pojistek naráz:
velká čistírna nesmí celoměstsky **ubírat** znečištění, jinak by čistila vzduch
nad továrnami na druhém konci mapy.

Ten test jsem musel dvakrát opravit, oba důvody stojí za zapamatování: měřená
buňka byla nasycená na 255, takže odečet neměl kde být vidět, a v čistém městě
se záporný člen ztratil v ořezu na nule. Teď se měří **součet přes celou mapu**
ve městě plném chemiček.

Testy: 6 v `tests/sewage.test.ts`. Že koušou, ověřeno rozbitím: kanalizace
mimo znečištění shodí dva, nezapočtená kapacita čistírny dva, obě pojistky
naráz dva.

- [x] T38 — třídy `culture` a `social` (fáze 3c)

Nejlevnější úkol celé fáze, a je to dobrá zpráva: **žádný nový kód** (R12).
Obě třídy stojí nad mechanismem pokrytí z T13, takže přibyl jen obsah.

- **`culture`** — muzeum (1 400, dosah 9), divadlo (900), kino (600) a výstavní
  síň (300, dosah 4). Rozdíl mezi velkou a malou kulturou je v číslech
  v JSONu, ne v kódu
- **`social`** — společenské centrum (700) a domov pro seniory (1 100)
- obě dostaly **váhu v ceně půdy** (0,45 a 0,35), takže se hned projeví; do
  spokojenosti vstoupí v T39

Jediné, co si vyžádalo řádky v `src/`, jsou **symboly na střechy**: sloup,
masky, filmový pás, rám, dvě postavy a srdce. Sada tvarů je render-side a
obsah do ní jen ukazuje jménem — kdyby chyběl, hlásí to test z T27.

Ověřeno v běžící hře: šest nových tlačítek v liště, dva nové overlaye („Dosah
kultury", „Dosah sounáležitosti") i dva posuvníky financování **vznikly samy
z obsahu**, bez zásahu do kódu. Muzeum dalo v místě pokrytí 80, šedesát
dlaždic daleko nulu, a cena půdy pod ním šla z 0 na **76**.

Testy: 5 v `tests/culture.test.ts`. Netestují nový kód — testují, že žádný
nebyl potřeba. Že koušou, ověřeno rozbitím: divadlo bez třídy služby shodí tři,
kultura bez váhy v ceně půdy jeden a s ní i test popisků z T26.

- [x] T39 — spokojenost (fáze 3c)

Poslední odvozená veličina fáze 3 a jediná, kterou hráč sleduje průběžně: skládá
se ze **všeho ostatního** — pokrytí službami, cena půdy, znečištění, kriminalita,
kolony, daně, nezaměstnanost.

- vrstva `world.happiness` na hrubé mřížce, **runtime-only** (R10). Neukládá se
  ani do v4, ani do v5 — je odvozená ze stavu, který uložený je
- systém `happiness` každých 16 tiků, offset 13, **úplně poslední** v pořadí:
  čte výstupy všech ostatních
- **zdravotnictví uhnulo z offsetu 13 na 15.** Třináctku si vybralo jen jako
  první volnou; smysl offsetů je, aby dvě šestnáctky nespadly do jednoho tiku
- obytná poptávka se násobí průměrnou spokojeností, **jen když je kladná**.
  Záporná znamená „bytů je dost" a s náladou nesouvisí — kdyby se násobila,
  nespokojené město by hlásilo menší přebytek, tedy přesný opak skutečnosti
- podlaha násobitele **0,3, ne 0** (R6): nespokojené město roste pomaleji, ne
  vůbec. Nula by hru zamkla přesně ve chvíli, kdy se hráč snaží situaci otočit
- **spokojenost nevstupuje do ceny půdy.** Cena půdy do ní ano, obráceně ne —
  jinak by vznikla kladná zpětná vazba (R2)
- nové město i načtený save začínají na **128, ne na nule**: nula znamená „tady
  se nedá žít" a to o městě, kde ještě nikdo nebydlí, neplatí
- průměr se počítá **jen z obydlených buněk** — prázdná polovina mapy nemá koho
  potěšit ani naštvat a stáhla by každé město k základní hodnotě

Ověřeno v běžící hře (mapa je skoro celá skála a les, takže město stálo na
srovnané a vykácené ploše s vodárnou u břehu a potrubím podél silnic):
24 obyvatel, 28 míst, průměr **109 → v HUDu „Spokojenost 43 %"**. Daň 20 %
srazila průměr na **76** a obytnou poptávku z 22 na 18; daň 2 % zvedla průměr
na **120** a poptávku na 23 — přesně tak, jak vychází vzorec (36 × 0,51 = 18,
36 × 0,63 = 23).

**Overlay se poprvé kreslil skoro naprázdno** a chytlo to až měření pixelů:
maloval jen to, co je pod 128, jenže reálné hodnoty se drží kolem stovky.
Po přeškálování (čistá čtvrť od 200 výš) je gradient monotónní — změřený
průměrný červený kanál 97 → 102 → 129 → 159 → 186 pro spokojenost
255 → 190 → 128 → 60 → 0. Vzorec proto **není dva řádky v `app.ts`**, ale
funkce `unhappinessValue` s testem. Overlay maluje **problém, ne pochvalu**,
stejně jako znečištění a kriminalita.

Testy: 16 v `tests/happiness.test.ts`, 3 v `tests/render.test.ts`. Mutační
ověření: deset mutantů, **prvních pět přežilo** — testy měřily vazby přes cenu
půdy místo přímo (kriminalita, pokrytí), test vyhlazení šel splnit i bez
vyhlazení, průměr přes všechny buňky prošel, protože i park má obyvatele…
tedy nemá, ale testovací dům jich měl osm ještě před růstem. Po přepsání
(vstupy nastavené rukou, jen systém spokojenosti, žádné jiné) chytá všech deset.

- [x] T40 — save v5, migrace, fixtura (fáze 3c)

Poslední technický úkol fáze 3. Do savu přibyla vrstva `pipe` a tím se splatil
dluh z T35: uložené město dosud přišlo o vodovod a začalo chátrat.

- `pipe` je v `SAVE_LAYER_ORDER` **na konci**, takže migrace jen připíše
  prázdnou vrstvu za stávající bajty. Kdyby se vsunula doprostřed, musel by se
  `layers.bin` přeskládat jako u zrušené `elevation` ve verzi 4
- migrace v4 → v5 **nevymýšlí síť**, kterou hráč nepostavil. Načtené staré město
  je bez vody a začne chátrat — přesně jak §10 předepisuje
- …a **dozví se to hláškou**, ne až úbytkem obyvatel. Podmínka je schválně na
  datech, ne na verzi savu: „ani jedna trubka a budovy, které vodu potřebují“ je
  stejně marná situace, ať se do ní město dostalo jakkoli
- `applySaveToWorld` navíc **nuluje vodní stav** — supply, seznam zavodněných
  i počítadlo sucha. Byl to stejný únik jako u dopravy v T28: zavodněné budovy
  minulého města mají jiná id a načtenému městu by se strhávalo za sucho, které
  se stalo jinde

**Save nebyl bajtově stabilní** a přišlo se na to až při psaní fixtury: ZIP si
u každé položky ukládá čas a fflate tam dával systémový. Dva savy téhož města
tak vyšly pokaždé jinak a fixtura se nedala vygenerovat znovu a porovnat.
Teď se bere `meta.modifiedAt`.

Fixtura `v5.city.base64` je skutečné odehrané město (seed 1, 4 000 tiků):
12 budov, 78 obyvatel, 41 trubek, vodárna u břehu, park a policie, financování
policie 80 %. Vygenerovalo ji dočasné `tests/_fixturegen.test.ts`, které se po
vygenerování smazalo — v repozitáři zůstal jen výsledek.

Ověřeno v běžící hře:
- 20 trubek → uložit → smazat → načíst → **zase 20**, a síť označená
  k přepočtu
- fixtura v4 nahraná do hry přes tlačítko „Načíst ze souboru“: 16 budov,
  52 obyvatel, **0 trubek** a notifikace „Načtené město nemá vodovod: 14 budov
  začne bez vody chátrat.“ Po 2 000 krocích **52 → 26 obyvatel** a jedna ruina,
  takže hláška nelže

Testy: 33 v `save.test.ts` (+3), 32 v `migrations.test.ts` (+3). Mutační
ověření: deset mutantů, **dva přežili** — reset vodního stavu se testoval proti
čerstvému světu, kde jsou ty hodnoty nulové tak jako tak, a bajtovou stabilitu
prošel i systémový čas, protože dvě uložení ve stejné vteřině vyjdou stejně.
Po opravě (minulé město dostane vodovod; datum se čte přímo z DOS hlavičky ZIPu)
chytá všech deset.

- [x] Přestavba rozhraní (po hlášení autora, mezi T40 a T41)

Hlášení znělo, že GUI zabírá většinu obrazovky — a bylo to tak: dvacet tlačítek
s texty ve třech řadách, k tomu čtyři trvale rozbalené panely a řada osmnácti
overlayů. Z mapy zbýval pruh.

Pravidlo, podle kterého je to přestavěné: **trvale je vidět jen to, co hráč
sleduje průběžně** — kasa, obyvatelé, spokojenost, poptávka, rychlost. Všechno
ostatní čeká za ikonou.

- **nástroje v roletách podle typu** — silnice, terén, zóny a pak jedna nabídka
  na každou třídu služeb i druh infrastruktury. Zařazení nese **obsah** (nové
  pole `menu` v definici), ne kód, takže mod se svou třídou dostane vlastní
  roletu bez řádku navíc (P5)
- **roleta s jedinou položkou se nerozbaluje.** Z buldozeru by byla jen
  kliknutí navíc; popisek takového tlačítka je jméno budovy, ne nabídky
- **pohled zvlášť od vrstev.** Povrch a podzemí mění i to, co dělá stavební
  nástroj a buldozer (§8 fáze 3) — sdílet jeden slot s diagnostickými vrstvami
  znamenalo, že zapnutí pokrytí policie hráči pod rukama přepnulo kladení
  potrubí zpět na silnice. Teď jsou to dva nezávislé stavy
- **daně, financování, uložení, rozpočet a jazyk** jsou roletky u pravého
  okraje. Otevřený je vždycky nejvýš jeden panel a klik do mapy ho zavře
- **ikony** se kreslí ze **stejných polygonů jako symboly na střechách** —
  jedna sada tvarů pro celou hru, žádné obrázky ani knihovna ikon
  (architektura §6). Tlačítko muzea tak nese přesně ten znak, který bude mít
  na střeše, a dosah služby v nabídce vrstev taky
- **potrubí má vlastní nástroj** v nabídce Vodovod, vedle vodárny. Do téhle
  opravy ho kladl nástroj silnice, když byl zapnutý podzemní pohled — lišta
  u toho ale dál hlásila „Ulice, 10" a účtovala šest. Rozhraní lhalo a hráč
  neměl jak poznat, že se vodovod vůbec staví; ptal se na to autor, ne test.
  Nástroj si navíc pohled přepne sám: potrubí pod zem, silnice a budovy zpátky
  na povrch. Buldozer zůstává výjimkou, protože pod zemí i nad ní dává smysl
- **vrstvu jde vypnout položkou „Žádná vrstva"**, ne jen druhým kliknutím na
  tutéž. A tlačítko nabídky si drží svou ikonu: když se z „Vrstev" stal blesk,
  nebylo poznat, že je to pořád ta nabídka. Autor zapnul elektřinu a neměl jak
  ji vypnout. U nástrojů se ikona mění dál — tam je to smysl, protože ukazuje,
  co má hráč v ruce
- **spokojenost prázdného města je „–", ne 0 %.** Nula tam znamenala „všichni
  jsou nešťastní" a autor sháněl, čím ji zvednout, i když jediný problém byl,
  že se do města nikdo nenastěhoval. Není co měřit, tak se nic neměří
- **bankrot je vidět a slyšet.** Záporná kasa zastaví veškerý růst (§9 fáze 2)
  a hra o tom mlčela — město se prostě přestalo hýbat. Teď je kasa červená
  a při přechodu do mínusu vyskočí hláška
- **terraforming ukazuje roh, ne čtverec.** Zvedání a snižování hýbe rohem;
  rámeček kolem celé dlaždice ukazoval čtyři naráz a hráč netušil, který se
  pohne. Srovnání pracuje s plochou, takže tam čtverec zůstal

Změřeno v běžící hře na okně 1280×720: rozhraní zabírá **8,7 % plochy**
(předtím prakticky vše kromě horní třetiny). Lišta nástrojů má 578×40 px
a 15 tlačítek místo dvaceti popsaných ve třech řadách. Ověřeno i chování:
výběr z rolety zavře panel a propíše se do ikony tlačítka, podzemní pohled
a vrstva kriminality drží zapnuté **současně**, a značka u kurzoru měří
15×15 px u zvedání proti 68×36 u srovnání a silnice.

Testy: 9 v `tests/ui.test.ts`. Hlídají to, co by se rozbilo potichu —
chybějící ikona vykreslí prázdné tlačítko, chybějící překlad syrový klíč
a přeházené pořadí rozsype rolety.

- [x] Ovládání a čitelnost po hraní (hlášení autora)

Pět věcí, na které autor narazil při hraní, ne v testech.

- **šipky posouvají mapu.** Drží se, ne ťuká: opakování klávesy má v systému
  vlastní prodlevu a mapa by škubala. Rychlost je konstantní **na obrazovce**,
  ne ve světě — jinak by při oddálení létala a při přiblížení se nehnula
- **obnovení stránky město nesmaže.** Ukládá se do `localStorage` při odchodu
  ze stránky i při přepnutí panelu; dialog nové hry pak nabídne „Pokračovat".
  Je to týž ZIP jako do souboru, jen v base64, takže migrace platí stejně (P7).
  Nečitelný autosave se zahodí a hra začne nové město — spadnout na startu
  kvůli poškozenému úložišti by znamenalo, že se hráč do hry nedostane vůbec
- **rámeček u kurzoru kopíruje dlaždici, ne čtverec pod ní.** Byl to jeden
  plochý kosočtverec v jedné výšce, takže na svahu ležel vedle místa, kam hráč
  mířil. Teď se kreslí z **jejích čtyř rohů**, a u víc dlaždic každá zvlášť —
  u budovy 4×4 je tak vidět, které parcely zabere
- **pod zemí je vidět povrch.** Silnice, zóny i půdorysy budov se kreslí matně
  jako obrysy. Předtím tam byla jen tmavá plocha a hráč neměl podle čeho vést
  potrubí — hlásil to autor obrázkem prázdné obrazovky
- **zóna bez vody to konečně řekne.** Panel parcely má řádek „Voda: ano/ne"
  a když má město zóny a ani jedna z nich není zavodněná, vyskočí hláška.
  Do teď se hráč dozvěděl jen to, že mu nic neroste: silnice vedla, proud byl,
  poptávka byla kladná — a nic. Nejtišší způsob, jak se hra zasekne

- [x] „Proč tu nic neroste" (hlášení autora)

Autor třikrát po sobě narazil na město, které se přestalo hýbat, a pokaždé
z jiného důvodu: bankrot, zóna bez vody, a nakonec **svah**. Růst vyžaduje
rovinu (§7 fáze 3) a sám nic nesrovná — a na generované mapě je rovných jen
**48 % dlaždic souše** (změřeno). Zóna na kopci tedy nevyroste nikdy a hra
o tom mlčela.

Odpověď není další jednotlivá hláška, ale jedno místo, které tu otázku umí
zodpovědět:

- **`growthBlocker(world, catalogue, balance, x, y)`** vrací lokalizační klíč
  první podmínky, o kterou se parcela zarazí, nebo `null`. Ptá se **týmiž
  funkcemi jako růst** — `roadReach`, `seedDefinitions`, `checkFootprint` —
  takže panel nemůže tvrdit něco jiného, než co se doopravdy děje
- **panel parcely** ho ukazuje jako první věc pod nadpisem, ještě před čísly
- **hláška** se objeví, když ani jedna volná zónovaná parcela ze vzorku nejde
  zastavět. Hlásí se **ta překážka, která drží parcely nejblíž hotova**, ne
  nejčastější: velká zóna daleko od silnice by jinak přehlasovala pár parcel
  u vozovky, kterým chybí jen rovina. Bankrot přebíjí všechno, protože zastaví
  růst v celém městě
- přibyl i řádek **„Voda: ano/ne"**, protože je to jediná podmínka, která
  na mapě není vidět vůbec

Ověřeno v běžící hře: zóna u silnice bez potrubí ohlásila „Bez vodovodu se tu
stavět nedá", panel parcely totéž jako varování nahoře.

Testy: 8 v `tests/diagnostics.test.ts`. Mutační ověření: čtyři mutanti
(vynechaná kontrola půdorysu, bankrotu, dosahu silnice a zóny), všichni chyceni.

- [x] Na svahu se staví (rozhodnutí autora)

Zákaz stavby na svahu byl v zadání fáze 3 (§7, T33) a ukázal se jako chyba:
na generované mapě je rovných jen **48 % dlaždic souše**, takže polovina mapy
byla nezastavitelná a hráč neměl jak přijít na proč. Autor rozhodl, že zóny
musí jít stavět na svahu. Platí od teď:

- **zóna na svahu vyroste.** Růst už rovinu nekontroluje. Není to zadarmo:
  svažitá parcela má v losu váhu `growth.slopeFactor` (0,7), takže se tam
  staví **méně ochotně** — zóna na kopci roste pomaleji, ne vůbec, stejně jako
  u dostupnosti práce (R6)
- **„o 30 % dražší" je v losu, ne na účtu.** Domy ze zóny hráč neplatí, takže
  peněžní přirážka by neměla kam sáhnout; v herních důsledcích je menší váha
  totéž — na svahu se staví později a méně
- **ruční stavby se dál srovnávají.** Elektrárna ani klinika se s podezdívkou
  nepočítají a cenu srovnání hráč vidí předem, takže tam se nic nemění
- **renderer kreslí podezdívku.** Budova stojí horní plochou na nejvyšším rohu
  půdorysu a zeď sahá k nejnižšímu, aby na kopci nevisela rohem ve vzduchu.
  Podezdívka je kamenná, ne v barvě domu — má být poznat, že je to terénní
  úprava, a ne že dům povyrostl
- **nový nástroj „Dozdít svah" (G).** Srovnání odkope na průměr, dozdění zaveze
  na **nejvyšší** roh: u kopce tak vznikne terasa nahoře místo jámy dole

Ověřeno v běžící hře: dvě svažité parcely (rohy 0/1/0/1 a 1/2/1/2) vyrostly
v domy, jejich grafika má o dva polygony víc než dům na rovině (podezdívka),
a dozdění změnilo [2,2,1,2] na [2,2,2,2] za 8 a [2,3,2,2] na [3,3,3,3] za 24.

Testy: 2 v `tests/growth.test.ts`, upravený rozbor parcely. Panel parcely už
svah jako překážku nehlásí — protože žádná není.

- [x] Suchou trubku jde poznat od zavodněné (hlášení autora)

Potrubí se kreslilo pořád stejně modře, ať v něm voda byla, nebo ne. Síť, která
nikam nedosáhla — protože je moc dlouhá nebo nevede ke zdroji — vypadala úplně
stejně jako funkční. **Suchá trubka je teď šedá, zavodněná modrá.**

Ověřeno v běžící hře: deset trubek bez zdroje se vykreslilo jen šedě, po
zavodnění poloviny se objevily obě barvy.

Při té příležitosti změřeno a potvrzeno: **voda existuje výhradně v dlaždicích,
pod kterými je trubka** (`vodaMimoTrubku = 0`). Je to podle §8 fáze 3 záměr —
odlišuje to vodovod od elektřiny — ale v praxi to znamená, že pod každou
parcelou musí být trubka. Autor na to narazil: potrubí u zóny mělo, ale ne
**pod** ní, a hra hlásila „bez vodovodu se tu stavět nedá". Hláška nelhala,
jen se dá snadno přečíst jako „vodovod tu vůbec není". Jestli má potrubí
zavodňovat i sousední dlaždice, je rozhodnutí o designu — patří k T41.

- [x] Čerpací stanice, ke které voda nedoteče, to řekne (rozbor savu autora)

Autor poslal rozehrané město s otázkou, jestli je v pořádku. Bylo — až na jednu
věc, kterou hra nijak nedávala najevo:

- 312 obyvatel, 61 budov, kasa 41 280, poptávka po průmyslu **+32**
- 26 volných průmyslových parcel, **všechny s potrubím pod sebou**
- a přesto na nich nic nerostlo, protože z těch 159 trubek bylo **104 mokrých
  a 55 suchých** — dosah sítě končil přesně před průmyslem
- příčina: **čerpací stanice na (39,13) stála o jedinou dlaždici za hranicí
  dosahu.** Relé se zapojí, jen když k němu voda po potrubí doteče; tahle
  stanice tam jen stála a nedělala nic. Druhá stanice (55,16) na vodě stála
  a fungovala
- ověřeno přesunem: stanice o dlaždici na sever, na (39,12), a mokrých trubek
  je **149 místo 104**, vodu má 24 z 26 průmyslových parcel

Stanice bez vody vypadala úplně stejně jako funkční. Panel budovy proto nově
varuje: „K téhle čerpací stanici voda nedoteče, takže síť neprodlužuje."
Ověřeno na tomtéž savu — suchá stanice varování má, funkční ne.

- [x] Proud je vidět v číslech, ne jen jako zlomek (rozbor savu autora)

Autor poslal město se dvěma elektrárnami a dvaceti tmavými budovami s otázkou,
jak je možné, že dvě elektrárny zvládnou jen 65 budov. Změřeno v jeho savu:

- výroba **12 000** (2 × 6 000), spotřeba **17 720**, schodek **−5 720**
- 65 budov pod proudem (11 880), 20 bez proudu — 15 průmyslových a 5 komerčních
- **všech 20 je na síti**, takže nechybí vedení, ale kapacita. Město prostě
  přerostlo své dvě elektrárny; třetí (6 000) by na 18 000 stačila

Chyba to nebyla, ale hra to neuměla říct: „Pod proudem 65/86" se dá číst
i jako přerušené vedení, což je úplně jiná oprava. HUD proto nově ukazuje
řádek **„Proud 12 000 / 17 720"**, při schodku červeně, a při přechodu do
nedostatku vyskočí hláška s oběma čísly. Ověřeno na tomtéž savu.

- [x] Elektrárna: nový balanc (rozhodnutí autora)

Autor poslal město, kde dvanáct elektráren zabíralo skoro tolik místa jako
zbytek města — a pořád nestačily. Změřeno v jeho savu: 12 elektráren,
72 000 výroby, 208 spotřebitelů, **průměrná spotřeba 272 na budovu**, tedy
**22 budov na elektrárnu**. Odhad autora („21") seděl.

Nové hodnoty podle jeho zadání:

| | dřív | teď |
|---|---|---|
| výroba | 6 000 | **24 000** |
| cena | 4 000 | **6 000** |
| údržba | 60 | **240** |

24 000 je přesně **80 průmyslových budov** (300 každá), tedy nejtěžšího
běžného odběratele; průměrné budovy z jeho města uživí 88.

Jeho město se spotřebou 56 500 tím spadne z **10 elektráren na 3**, ze 160
dlaždic na 48.

Údržba je 240, ne 120: při zdvojnásobení by proud na jednotku **zlevnil**
(5 místo 10 za 1 000), protože dvojnásobná údržba nevyrovná čtyřnásobný výkon.
Autor si vyžádal, ať provoz zůstane na původní úrovni, tedy 10 za 1 000 —
a stavba ať zlevní, což je jediné, co se tím opravdu mění (250 místo 667).

Pozor na zrnitost: tři velké elektrárny vyrobí 72 000, tedy o 15 500 víc, než
město spotřebuje, takže reálná měsíční údržba vyjde 720 místo dřívějších 600.
Za jednotku proudu je to stejné, za město o něco dražší — velké bloky se hůř
trefují do potřeby.

Testy na cenu elektrárny si ji teď berou **z obsahu**, ne z čísla v testu:
balanc se ladí a test o tom nemá padat.

- [x] Doplnění zadání: věznice, řeky, úrovně, velké služby, vzdělání, testy

Po průchodu zadávací dokumentací proti kódu si autor vyžádal doplnit šest
chybějících bodů.

**Věznice a záporná stopa v okolí** (§6 fáze 2). Jedna budova nemohla být
zároveň policejní službou a nepříjemným sousedem, protože třída je jedna.
Přibyla proto volitelná sekce `nuisance` — **týž mechanismus jako služba**,
jen se nefinancuje, protože škrty na policii sousedům výhled na věznici
nezlepší. Kód o žádné třídě neví: věznice hlásí `police` do pokrytí
a `prison` do obtěžování, a `landValue.weights.prison = −0,55` udělá zbytek.
Záporné váhy schéma umělo už dřív, jen je nikdo nepoužil.

**Řeky** (R7). Vanilla je má zapnuté (`map.rivers: 2`), protože mosty jsou
hotové od T33. Dvě věci si to vyžádalo:

- **koryto klesá rovnou na nulu**, ne po schodech. Sousední dlaždice sdílejí
  rohy, takže klesající řeka by potřebovala společný roh zároveň ve třech
  i ve dvou. Voda by se naklonila a vypadala jako vodopád ve vzduchu
- **odříznuté ostrůvky se zaplaví.** Koryto umí utnout pár dlaždic od pevniny;
  most se tam nevyplatí a hráč o nich neví. Pod 24 dlaždic jdou pod vodu,
  větší kusy zůstanou — přes řeku vede most

Test souvislosti souše proto nově počítá s tím, že se úzká voda dá překlenout;
vedle něj je druhý, který mapu **bez řek** kontroluje bez jediného mostu, aby
mosty nezakrývaly chybu generátoru.

**Úrovně 4 a 5 a půdorysy 3×2 a 3×3.** Mechanismus je uměl od T16, ale obsah
končil na třetí úrovni a 2×2, takže prahy 170 a 210 byly mrtvá čísla. Přibylo
18 definic — šest na kategorii — a žebříček teď vede od domku 1×1 až po
panorama 3×3 s 396 obyvateli. Kapacity i ceny navazují na řadu, která
v obsahu už byla.

**Velké varianty služeb** (§6 fáze 2): policejní ředitelství, velká zbrojnice,
nemocnice, střední škola, vysoká škola, velký park.

**Vzdělání jako brána** vyšších úrovní obchodu a průmyslu — podle zadání
„nejzajímavější vazba fáze 2". Úroveň 4 chce pokrytí 40, úroveň 5 sedmdesát.
Obytná zástavba podmínku nemá: lidé se stěhují za bydlením, ne za školou.

**Testy.** Golden test běžel 500 tiků **bez systémů**, takže hlídal silnice
a příkazy, ne růst. Přibyl golden nad **celým městem**: 1000 tiků plné sestavy
na generované mapě, snapshot hashů plus čitelná čísla (56 budov, 180 obyvatel,
96 míst). Místo pro město se v něm **hledá**, nesází natvrdo — generátor se
ladí a souřadnice, které dnes padnou na louku, můžou zítra padnout do jezera.
Druhý nový test plní kritérium fáze 3: **5000 tiků včetně dopravy a generátoru**
dvakrát za sebou, porovnává vrstvy, hrubé vrstvy, stav RNG, kurzor dopravy
i seznam budov.

- [x] Tažení myší, průhledné budovy, kontextová nabídka (zadání autora)

**Zóny, silnice a potrubí se kreslí tažením** a použijí se **až při puštění**.
Do teď se malovalo volnou rukou po dlaždicích: u zóny to znamenalo klikat
dvacetkrát, u silnice z toho vznikaly schody, jak kurzor uhýbal. Teď se táhne
obdélník (zóny) nebo lomená čára (silnice, potrubí) — nejdřív po ose x, pak po
y, protože úhlopříčka v izometrii vypadá jako schodiště a napojení silnic z ní
je na nic.

- náhled kreslí **každou dotčenou dlaždici podle jejích rohů**, takže je vidět
  přesně, kam až tažení sahá
- u kurzoru se ukazuje **cena celého tažení**, ne jedné dlaždice
- zóna jde do simulace **jedním příkazem**; silnice a potrubí po dlaždicích,
  ale hlásí se jen první odmítnutí — dvacet stejných hlášek za jedno tažení by
  hráč nepřečetl
- buldozer a terén zůstávají na okamžité odezvě, tam ji hráč čeká
- tažení, které opustí plátno, se zahodí

**Přepínač průhledných budov** vedle pohledů. Ve vyrostlém městě zakryje blok
3×3 celou křižovatku a silnici pod ním nejde trefit. Skrýt budovy úplně by
znamenalo nevědět, kam se smí stavět, takže se jen zprůhlední na 35 %.

**Kontextová nabídka prohlížeče je zablokovaná na celém dokumentu**, ne jen nad
plátnem. Nabídka vyskočená nad HUDem překrývá hru stejně jako nad mapou.

Ověřeno v běžící hře: tažení zóny přes 6×3 vyznačilo 15 polí (zbytek terén
nepustil) a během tažení nezměnilo ani jedno; silnice a potrubí totéž;
průhlednost přepíná krytí 1 ↔ 0,35; `contextmenu` nad HUDem je zrušené.

- [x] T42 — velikost mapy jako běhový údaj

`MAP_SIZE` byla zadrátovaná konstanta v `index()`, `inBounds()` a v alokaci
každé vrstvy. Teď ji nese `world.size` a předává se do `index(x, y, size)`.
Parametr je **povinný schválně**: s výchozí hodnotou by šlo zapomenout ho
předat a mapa 512×512 by potichu četla po 128 dlaždicích.

Kde velikost předat nejde, odvozuje se z délky pole — `sizeOfLayer()`,
`cornerSideOf()`, difuze. Pole tu mřížku definuje, takže se s ní nemůže
rozejít, a ušetří to parametr ve stovkách volání.

Save si velikost nese v `meta.grid.size` (pole tam je od verze 2, jen se dosud
ignorovalo). Načtení jinak velkého města přestaví svět **zevnitř** přes
`resizeWorld()` — objekt se vyměnit nesmí, renderer i UI na něj drží živý
pohled. Migrace verzí 1–5 mají 128 natvrdo: popisují minulost, ne současnost.

Ověřeno: `tests/mapSize.test.ts`, 20 případů na hranách 64, 128 a 192 —
alokace, generátor, růst města u vzdáleného rohu, kolečko uložit → načíst.
Mutační test 10 z 10.

- [x] T43 — výběr velikosti mapy v dialogu nové hry

Čtyři pevné volby (128, 192, 256, 512), u největší varování. Náhled přešel
z `fillRect` na `ImageData`: u 16 384 dlaždic byl rozdíl jedno, u 262 144 by
to byla čtvrt milionu volání při každém přepnutí. Náhled 512×512 se vygeneruje
za 377 ms, což na kliknutí stačí bez odkládání do pozadí.

Dialog se netestuje — je to DOM a jsdom není závislost. Testuje se, co za
tlačítky stojí: všechny čtyři velikosti a hratelný poměr souše a vody.

- [x] T44 — uvolňování chunků

Do teď se pekly všechny chunky naráz. Naměřeno na 512×512: 1024 chunků, první
snímek 1,6 s, halda 573 MB, nejhorší snímek 179 ms.

`update()` teď jen **značí** a nekreslí. Peče se v `cull()`, který dostane
obdélník obrazovky a upeče, co do něj zasahuje, plus prstenec jednoho chunku
za okrajem. Co je za obzorem, zahodí geometrii; uzel `Graphics` zůstává,
protože na něm stojí pořadí kreslení přes `zIndex`.

Obálka chunku počítá s **nejvyšším možným terénem**, ne se skutečným — kopec
se dá kdykoli vztyčit a přepočítávat obálky při každém hrábnutí do terénu by
stálo víc než ten kus obrazovky navíc. Chyba tím padá na správnou stranu.

Prstenec má rozpočet dvou chunků na snímek; viditelné chunky rozpočtu
nepodléhají, odložit je znamená díru v mapě.

Naměřeno po úpravě (512×512, plynulé posouvání): zoom 1,0 medián 0,7 ms /
p95 6,0 ms / 28 chunků; zoom 0,25 medián 1,1 ms / p95 5,5 ms / 112 chunků.
První snímek 84 ms, halda 116 MB.

První verze testů brala meze od testovaného kódu — z jedenácti zanesených
chyb jich devět přežilo. Po přepsání (viditelnost se počítá z promítnutých
dlaždic) 13 z 13. V běžící hře 2550 kontrol napříč mapou, nula děr.

- [x] T45 — celoplošné průchody nahrazeny udržovanými seznamy

Naměřeno na 512×512, jeden běh systému: spokojenost 8,89 ms, cena půdy
5,04 ms, rozpočet 4,30 ms, růst 1,65 ms.

Svět nese `roadTiles` a `zonedTiles`, které se udržují při zápisu. Do vrstev
`road` a `zone` se smí psát **jen** přes `setRoadTile` / `setZoneTile` — kdo
zapíše přímo, rozejde seznam s mapou a nic nespadne, jen město přestane růst
tam, o čem hra neví. Seznamy se neukládají (R10) a po načtení savu se postaví
znovu z vrstev.

Ukázalo se, že větší část času nebyly průchody, ale **alokace na každou buňku
hrubé mřížky**: `Object.entries` ve smyčce spokojenosti, `[...keys()].sort()`
v ceně půdy (16 384 setřídění na běh) a pole dvojic uvnitř vzorce. Podíly lesa
a písku se navíc počítaly dvěma průchody mapou při každém běhu; teď se kešují
u světa a zahazuje je `markTerrainChanged()`.

Vzorec ceny půdy zůstal **jediný**. `landValueRaw` bere volitelný sběrač
sčítanců: panel parcely si o rozpis řekne, systém ne a nealokuje nic.

Po úpravě: spokojenost 0,30 ms (30×), cena půdy 0,60 ms (8×), růst 0,10 ms
(16×), rozpočet pod prahem měření. Znečištění zůstalo na 2,00 ms — je to
difuze na hrubé mřížce, kterou zadání povoluje. Celý tik: medián 0 ms,
p95 0,1 ms. Golden snapshot beze změny.

Mutační test 15 z 15. Čtyři existující testy braly silnice zápisem do vrstvy —
přesně ta chyba, kterou nový invariant hlídá.

**T46 (Web Worker) se nedělá.** Zadání ho podmiňuje měřením a to říká, že
simulace není úzké hrdlo: 0,49 ms na tik na největší mapě.

- [x] T47 — kostra katastrof: model rizika, plánovač, `effects.ts`, menu

Patnáct katastrof má patnáct různých mechanik, ale kdy udeří, počítá jeden
vzorec: `min(základ × měřítko × sezóna × faktorTypu, strop typu)`. Prostý
součin schválně — když hráč hlásí, že mu hoří pořád, dá se to rozebrat na
čtyři čísla a jedno z nich opravit.

Všech patnáct je v `balance.json` jako **data** (P5). Formule z katalogu se
zapisují jednotně: měřítko jako `clamp(offset + tvar(metrika/dělitel))`,
podmínky vzniku jako seznam `{metrika, min}`. Validace odmítne neznámou
veličinu — překlep v `buildigns` by jinak tiše znamenal katastrofu, která
nikdy nepřijde.

`src/sim/disasters/`: `shapes.ts` (bod, kruh, pás, globální vzorkování),
`effects.ts` (třináct společných operací z R13), `indicators.ts` (dvacet
ukazatelů, všechny 0–1), `risk.ts`, `scheduler.ts`, `registry.ts`.

Dočasné postihy se **neuplatňují v effects.ts**. Zapíšou se do světa a přečte
si je systém, který tu veličinu vlastní — kdyby je katastrofa psala rovnou do
vrstvy, první běh systému by je přepsal. Postihy se neskládají: dvě stávky
nepotlačí hasiče na čtvrtinu, platí ta horší.

Mutační test 28 z 29; poslední přeživší odhalil mrtvý kód (`tiles.sort()` ve
tvarech — každá větev generuje vzestupně už sama) a šel pryč.

- [x] T48 — oheň: vrstvy, šíření, hašení, průseky, lesní varianta

Jediná katastrofa s plnohodnotným šířením, a proto ta, na které stojí polovina
zbytku katalogu. Vrstvy `fire`, `fuel`, `fireFlags`; ohňový tik každé dva tiky,
nezávisle na plánovači.

Každá hořící dlaždice je **závod**: palivo ubývá o jedna, intenzita roste o
přírůstek a klesá o `základ + coverage[fire] × podíl`. Buď hasiči stihnou
intenzitu srazit dřív, než dojde palivo, nebo dům shoří. Ověřeno: plné pokrytí
dům zachrání, pokrytí 40 ne — přidá čtyři body hašení proti šesti přírůstku.

Hořlavost a palivo se berou podle **obsahu dlaždice**, ne podle konkrétní
budovy (P5). `byClass` je výjimka pro třídy služeb: park hoří desetkrát hůř
než hasičárna, i když obojí je služba — a právě proto je z parku bariéra.

Silnice, voda, potrubí ani prázdná dlaždice nehoří, takže **průsek funguje**.
Buldozer navíc hasí. Je to hráčova jediná aktivní obrana.

Lesní varianta: 130/+9/×0,7, jedno ohnisko, vzniká v souvislém lese bez ohledu
na hasiče, po vyhoření zbude **tráva**. Hájí se od uhašení, ne od vzniku.

Mutační test 26 z 26; první běh chytil jen 18. Vážený los ohniska se ověřoval
jen tím, že požár vznikne na něčem hořlavém — což platí i při rovnoměrném
losu. Teď dvě stě losů porovnává krytou a nekrytou půlku ulice.

- [x] T50 — trosky: vrstva, blokování stavby, efekty, úklid

**Vrstva, ne stav budovy** (R15) — trosky zůstanou i tam, kde žádná budova
nestála. Blokují stavbu budovy, silnice i potrubí; z toho plyne jediná věc,
kterou po katastrofě hráč musí zaplatit, a tím i rozhodnutí, kterou čtvrť
obnovit dřív.

Srážejí cenu půdy **vlastním sčítancem**, ne jen oklikou přes kriminalitu:
hráč to musí vidět v rozpisu parcely. Panel je hlásí dřív než vzdálenost od
silnice — rada „je to daleko od silnice" by ho poslala stavět cestu tam, kde
stejně nic nevyroste.

Mutační test 14 z 14; z prvních deseti chycených vyplynulo, že dva testy
měřily vedle (cena půdy se ověřovala přes celé město, kde ji srazí i
kriminalita) a dva kusy kódu byly mrtvé.

- [x] T49 — povodeň: postup vlny, poškození, opadání

Tři fáze a každá je jiné rozhodnutí. **Postup**: vlna jde od břehu dovnitř, ale
jen tam, kam dosáhne hladina — vyvýšený břeh zůstane suchý a hráz o jedinou
úroveň zastaví vlnu úplně. **Stání**: poškození se hromadí, takže rychlé
opadnutí opravdu zachraňuje. **Opadání**: odpočet po dlaždicích, který hasiči
zrychlují — čtvrť u hasičárny vyschne dřív než ta na druhém konci města.

Zaplavená dlaždice nevede proud ani vodu a je neprůjezdná. Přerušené sítě bolí
víc než pár zbořených domů, a to je záměr: hráč po povodni neopravuje domy,
opravuje město.

Vznik se váží **délkou pobřeží v okolí děleno pevninou v okolí**, ne podílem
vody. Zátoka má na málo pevniny hodně břehu, rovná pláž ne — povodeň tak chodí
tam, kam by chodila doopravdy, a `bayWeight: 4` z toho dělá 1,29× vyšší
pravděpodobnost na dlaždici v zátoce.

Tři metriky před ní byly špatně a stálo to nejvíc času z celé fáze: podíl vody
v okně byl slabý, počet vodních sousedů taky, a délka pobřeží dělená celým
oknem byla **horší než nic** — voda v okně jmenovatel nafoukne, takže zátoka
vyšla hůř než pláž.

Mutační test 21 z 21. Poprvé přežil mutant „žádné vážení" — a chyba byla v mém
testovacím orákulu, ne v kódu: počítalo sousedy bez kontroly hranic, takže
`index(-1, y)` spadlo na konec předchozího řádku a napočítalo 21 pobřežních
dlaždic na opačné straně mapy. Druhá oprava byla v tom, co test měří: podíl
zátahů na celkovém počtu je k ničemu, když zátoka tvoří polovinu pobřeží.
Měří se pravděpodobnost **na dlaždici**.

- [x] T51 — ničivé: tornádo, zemětřesení, výbuch, průmyslová havárie

Čtyři katastrofy, jedna společná vrstva `damage.ts`. `rollDamage` dostane tvar
a funkci „jaká je tady šance", zbytek — obsah dlaždice, celý půdorys budovy,
trosky po ní, srovnání seznamů silnic — je společný. Bez toho by čtyři soubory
čtyřikrát zapomněly odstranit budovu ze `zonedTiles`.

Hází se **na budovu, ne na dlaždici**: velká továrna 3×3 by jinak dostala devět
hodů a nepřežila by nikdy. Hází se ale **vždy**, i při nulové šanci, aby `rng`
běžel stejně nezávisle na obsahu mapy (P2).

**Tornádo** se pohybuje v čase: vzniká na okraji, míří do vnitrozemí, každý tik
se stočí o pár stupňů. Síla jde 0,4 → 1,0 → 0,3 podle uplynulé části života.
Proti zásahu obrana neexistuje a je to záměr — bránit se dá jen tomu, co přijde
po něm, a následné požáry nadělají víc škody než tornádo samo.

**Zemětřesení** losuje sílu jako `základ + rozpětí × rng³`. Třetí mocnina je
tam schválně: velká rána musí být vzácná, jinak si na ni hráč zvykne a finanční
rezerva ztratí smysl. Umí **nalomit**, ne jen bořit — snížená budova je mírnější
trest, který hráč pozná na dani a kapacitě, ne na mapě. Dotřesy slábnou o 0,45
a u pobřeží zaplaví pás do tří dlaždic.

**Výbuch a havárie** jsou jedna mechanika a dvě sady čísel. Rozdíl je přesně
tam, kde ho hráč pozná: havárie boří víc (0,85 proti 0,75) a kontaminuje,
výbuch zapaluje víc (50 % proti 45 %). Obojí zapaluje **dál, než boří** — okraj
tlakové vlny dům nesloží, ale zapálí ho. **Neřetězí se** (rozhodnutí autora):
zasažená továrna hoří, nevybuchuje. Řetězení by z jedné havárie udělalo konec
města a hráč by neměl co zachraňovat.

Místo výbuchu se váží úrovní, nepokrytím hasiči a zanedbaností. Bouchne tedy
nejspíš tam, kde hráč nechal starou nekrytou továrnu stát — je to zpráva, ne
loterie.

Pobřežní pás zemětřesení se počítá **průchodem od vody ven**, ne oknem kolem
každé dlaždice. Okno 7×7 na 262 144 dlaždic velké mapy je dvanáct milionů
porovnání na jeden otřes a otřesů je až osm.

Validace `contentTable()` vyžaduje všech dvanáct druhů obsahu, protože chybějící
klíč tiše znamená nulu. Hned to našlo chybějící `abandoned` v `tornado.survival`
— ruiny by tornádo neumělo srovnat se zemí.

Mutační test 26 z 26; první běh chytil 15. Tornádo bylo přitom testované jen na
„něco spadlo“, což platí i pro tornádo s konstantní silou, letící po pravítku,
vznikající pořád na západě a zapalující všechno, přes co přejede. Křivka síly
a útlum od osy pásu se přes zásah do města spolehlivě změřit nedají, takže jsou
teď vystavené a testované přímo; zbytek se ověřuje chováním.

- [x] T52 — sociální: stávka, nepokoje, válka gangů, hromadná nehoda

Žádná z nich neboří město. Berou **peníze a čas** — a všechny čtyři jde zkrátit
tím, že hráč zareaguje. Odsud plyne celý jejich tvar: ukončení je podmínkové,
ne odpočet. Kdyby to byl pevný čas, nebylo by co hrát, jen co odčekat.

Přibyla operace `taxLoss`. Stávkující čtvrť nedaní vůbec, nepokoje seberou
60 %, válka gangů 50 %. Odečítá se od **základu**, ne od výsledku: sazba se
nemění, mění se to, z čeho se počítá, takže rozpis rozpočtu pořád odpovídá
skutečnosti a hráč vidí, kam se poděl příjem.

Celoměstský postih má **prázdný seznam buněk**, ne vyjmenované čtyři tisíce.
`strongestModifier` se ptá `cells.includes(cell)`; vyjmenovaný seznam by
znamenal lineární prohlídku při každém dotazu každého systému. Kvůli tomu
vznikl tvar `CITY_WIDE` vedle běžných tvarů z `shapes.ts`.

**Hromadná nehoda** nezničí ani jednu budovu. Celá váha je v blokaci dlaždice —
nehoda na jediné spojnici odřízne čtvrť od práce, což bolí víc než skok
v kolonách. Odsud i obrana: okružní síť, ne širší silnice. Zdravotnické pokrytí
zkrátí trvání z deseti tiků na čtyři a potlačení hasičů z ní dělá násobič všeho
ostatního.

**Stávka** se hlásí s hlavním důvodem a je to **týž výpočet**, jaký použilo
riziko — `dominantTerm` čte přímo členy z katalogu. Původně jsem to počítal
zvlášť; dvě paralelní verze téhož vzorce se dřív nebo později rozejdou a hráči
by hlášení tvrdilo něco jiného, než podle čeho stávka vznikla.

**Nepokoje** jsou celoměstské, ale síla je lokální podle kriminality. Mapa síly
se během trvání **nepřepočítává**: nepokoje kriminalitu zvyšují, takže by jinak
posilovaly samy sebe a nikdy neskončily. Hlavní cesta vzniku není plánovač, ale
eskalace ze stávky — tím se ze stávky stává varování, ne jen nepříjemnost.

**Válka gangů** je jediná pohroma, které se nedá zbavit penězi. `crimeFloor`
drží kriminalitu nad hodnotou bez ohledu na to, kolik policie do čtvrti přijde;
policie zkracuje trvání, nesráží číslo. Bez zásahu přes třináct měsíců,
s pokrytím a rostoucí spokojeností necelé dva.

Validace navíc hlídá, že se **reakce vyplácí** — že `drainRising` je opravdu
vyšší než `drainIdle`. Kdyby to někdo v datech obrátil, hráč by katastrofu
prodlužoval tím, že se snaží, a nikdo by na to nepřišel: obojí je jen číslo.

Dvě věci našly testy, ne čtení kódu. Válka gangů si počáteční spokojenost
nastavovala na nulu, takže první tik viděl celou spokojenost čtvrti jako
„hráč zabral" a zkrátil válku pětadvacetkrát. A `localUnemployment` procházel
všechny budovy uvnitř průchodu všemi budovami — na dvou tisících budov čtyři
miliony iterací za jediný los. Obojí teď stojí na předpočítaných buňkách.

- [x] T53 — síťové a zdravotní: blackout, epidemie, chemická havárie

Tři katastrofy, které **nerozbijí nic na mapě** a přesto bolí nejvíc.

**Temná služba nepokrývá.** Tohle bylo potřeba udělat dřív než blackout samotný,
protože bez toho blackout nedělá vůbec nic. Je to obecné pravidlo, ne zvláštnost
výpadku: hasičárna bez proudu nevyjede, ať je tma z blackoutu nebo z toho, že
hráč nepostavil dost elektráren. Obtěžování se to netýká — skládka smrdí i po tmě.

Změna má dosah do fází 2 a 3: opravovalo se kvůli ní patnáct testů. Všechny
stavěly službu ve světě bez elektrárny a měřily něco jiného než elektřinu, takže
dostaly `powerAll()` z `tests/support/power.ts` nebo skutečnou elektrárnu.

Při tom vyplavala díra, která tam byla už předtím: **změna proudu nepřepočítala
pokrytí**. Blackout by zhasnul hasičárnu a mapa pokrytí by o tom nevěděla až do
příští stavby — hráč by na mapě viděl dosah, který neexistuje.

**Blackout** je kaskáda, která se zastaví sama. Odpojí se elektrárna vážená
kapacitou, každý druhý tik se přepočítá zatížení; nad 1,15 padne další, pod 0,95
se po třech klidných cyklech začnou vracet. Odpojené elektrárny drží
`disasters.offlinePlants`, ne příznak na budově — jinak by výpadek přežil konec
blackoutu a hráč by měl elektrárnu, která nikdy nenaběhne.

**Epidemie** je jediná katastrofa, kterou jde potlačit i po vzniku. Nakaženost je
**řídká mapa `buňka → 0..1`**, ne vrstva: většina města je vždycky nenakažená.
Šíří se do sousedství a **skokem po dopravě** — ten skok z ní dělá epidemii,
protože bez něj by se dala uzavřít pásem parku a hráč by ji řešil geometrií
místo služeb.

**Chemická havárie** je jediná, kde je nejlepší reakce počkat a pak uklidit.
Nehoří, jen se rozlévá. Skutečná cena přijde až za rok: mrak srazí cenu půdy
v celé části města na 360 tiků a spustí snižování úrovní i tam, kde se fyzicky
nestalo nic. Zamořená vodárna nedodává vodu ještě 60 tiků po úniku.

Validace hlídá dvě věci, které by jinak byly tiché: že prahy blackoutu **nekmitají**
(zotavení musí být pod přetížením) a že epidemii **zastaví plné zdravotnictví**
(růst musí být nižší než ústup). Kdyby to někdo v datech obrátil, epidemie by se
nedala zastavit ničím — a přitom je to jediná, jejíž celý smysl je v tom, že to jde.

Mutační test 31 z 31; první běh chytil 17. Blackout byl testovaný nejhůř —
vanilla má jedinou elektrárnu s výkonem 24 000, takže ji testovací město nikdy
nepřetíží a kaskádu nešlo vyzkoušet vůbec. Musely na ni vzniknout vlastní
definice s malým výkonem; jsou tam kvůli **poměru**, ne kvůli číslům.

Čtyři chyby, které nenašlo čtení kódu:

1. `populace × 0,015` je u malého domu desetina člověka, takže se zaokrouhlovalo
   na nulu a epidemie v malém městě nezabila nikdy nikoho. Zlomek se teď přenáší
   mezi cykly i mezi domy. *(našel test)*
2. `applyEffects` procházel nákazu v pořadí vkládání do `Map`, tedy podle toho,
   kudy se náhodou šířila. Přenášený zlomek úmrtí se tím řetězil jinak a město by
   se po loadu chovalo jinak než před uložením. *(našel mutační test)*
3. Když padly **všechny** elektrárny, výroba byla nula, zatížení nekonečno — a
   podmínka zotavení už nikdy neplatila. Město s jedinou elektrárnou zůstalo
   tmavé napořád. Blackout, ze kterého není cesty ven, není katastrofa, ale konec
   hry. *(našlo hraní)*
4. Plánovač po skončení havárie uklidil i **propad ceny půdy**, který má doznívat
   rok. Únik trvá čtyřicet tiků, mrak rok; hráč by uklidil trosky a bylo by po ní.
   Dozvuk se teď zapisuje bez vlastníka. *(našlo hraní)*

A jedna věc, která se ukázala až při hraní a je to rozhodnutí, ne oprava:
bez zdravotnictví se nakažený shluk **donekonečna dokrmoval sám** — přenos mezi
dvěma nakaženými sousedy je řádově silnější než ústup. Po vypršení doby teď
epidemie jen dohasíná: nešíří se ani neroste. Nemocnice pořád rozhoduje o tom,
jak zle a jak dlouho, jen už ne o tom, jestli vůbec.

- [x] T55 — linky MHD: datový model, výběr zastávek, tři módy, tramvaj v dopravě

Rozšiřuje třídu `transit` z fáze 3, kde zastávka nedělala nic než pokrytí.
Linka je **nadstavba, ne náhrada**: zastávka pokrývá dál sama o sobě.

**Mód je obsah, ne kód.** Rozdíl mezi autobusem, tramvají a metrem je
v `balance.json` — kapacita vozidla, cena, údržba, kolik silnice ukrojí
a jestli potřebuje proud. V kódu není jediný `if` na jméno módu, takže si mod
může přidat vlastní a hra o něm nemusí vědět (P5).

Jediná tramvaj má nenulový `roadShare`, a **to je jediný důvod, proč vůbec
volit autobus**. Kdyby ukusovaly všechny nebo žádná, byla by volba módu jen
otázka rozpočtu.

**Trasa se nekreslí** (rozhodnutí autora). Kudy linka jede, se dopočítá jako
úsečka mezi sousedními zastávkami a slouží to jedinému účelu — aby tramvaj
měla čemu ubrat kapacitu. Není to hledání cesty schválně: kdyby se hledala
skutečná trasa, hráč by čekal, že po ní tramvaj i pojede, a ona nikam nejede.

Koridor se hledá **v pásu kolem úsečky, ne přímo na ní**. Zastávka stojí vedle
silnice, ne na ní, takže spojnice dvou zastávek nemusí protnout vozovku vůbec.
Vyzkoušené: linka podél ulice dala nula dlaždic, protože zastávky ležely o řadu
vedle.

Které silnice ukusuje kolej, drží `world.tramTiles` jako udržovaný seznam (R20)
— kolony se počítají z každé silniční dlaždice a ptát se přitom pokaždé na
všechny linky je součin dvou velkých čísel. Přepočítává se jen při změně,
stejně jako elektřina nebo pokrytí.

Kapacitu ubírá **kolej, ne provoz**: platí to i za blackoutu, kdy tramvaje
stojí. Koleje z vozovky nezmizí tím, že po nich nikdo nejede.

Zbouraná zastávka z linky **nezmizí sama** — smazat ji musí příkaz. Tiché mizení
by hráči rozpadlo linku a on by nevěděl proč; systémy si ale s chybějící
zastávkou poradí.

Jízdné a kapacita se zatím jen ukládají. Co s nimi, přidává T56.

Mutační test 31 z 31; první běh chytil 24. Šest přeživších mělo společnou
příčinu: **příkazy nepovolenou linku nepustí**, takže se validace v modelu
nikdy neuplatnila. Do rozbitého stavu se ale dá dostat jinudy — savem ze starší
verze, savem z modu, obsahem, kde zastávka změnila mód — a model si na to musí
umět odpovědět sám. Testy proto linku rozbíjejí přímo ve stavu, mimo příkaz.

- [x] T56 — jízdné, kapacita, poptávka, účinek na dopravu, provozní náklady

**Zastávka sama o sobě nikoho nikam nedopraví.** Do T55 ubíralo dopravu pouhé
pokrytí zastávkou; teď rozhoduje `přepraveno / poptávka`. Linka s jedním
autobusem a tisíci obyvateli v dosahu je gesto, ne doprava — a to je smysl:
hráč nesmí uklidit kolony tím, že poseje město zastávkami.

Je to změna proti fázi 3 a stálo to dva testy, které měřily starý model.

**Lidé jsou společný a konečný fond.** Linky se o ně dělí v pořadí podle id,
každá si vezme, co unese, další bere jen ze zbytku. Bez toho by šlo postavit
deset stejných linek přes jednu čtvrť a každá by vozila — a vydělávala — na
týchž lidech. Plyne z toho i to, co má hráč poznat: **druhá linka přes tutéž
čtvrť pomůže, až když je ta první plná.** Přidat vozidla je většinou lepší než
přidat linku.

Odebírá se **poměrně ze všech obsluhovaných buněk**, ne postupně od první.
Jinak by čtvrť u první zastávky měla plnou obsluhu a ta u poslední žádnou,
přestože jsou na téže lince.

**Jízdné má optimum.** Ochota platit klesá lineárně do nuly na `fareLimit`,
příjem je `přepraveno × jízdné` — součin je parabola s vrcholem v polovině
limitu. Zdarma nevydělá nic, na limitu taky ne, a mezi tím je maximum, které
jde najít. Jízdné je rozhodnutí, ne posuvník s jedním správným koncem.

Přepočítává se **jednou za herní měsíc**, ne každý tik. Kapacita v katalogu je
měsíční a poptávka se mění pomalu; projít pro každou linku všechny obsluhované
buňky čtyřikrát za sekundu by byla nejdražší věc v celé simulaci.

Jízdné i údržba vozidel mají v rozpočtu **vlastní řádek**, vedle silnic —
vozidlo není budova a jízdné není daň, takže do rozpisu po definicích nepatří
ani jedno. Hráč musí vidět, kam peníze tečou.

Údržba se platí i za linku, která nejezdí. Vozidlo v garáži taky stojí peníze.

- [x] T57 — půjčky, granty, úvěrový rating

Tři věci, které spolu drží, a všechny tři jsou o tom samém: **co se stane, když
peníze dojdou.**

**Půjčka je jediná cesta z mínusu.** Bankrot je v téhle hře měkký, takže bez
úvěru se město po zemětřesení jen pomalu rozpadá a hráč nemá čím zasáhnout.
Tím se zavírá otevřená otázka „z bankrotu není cesta zpátky" ze seznamu níž.

Strop se odvozuje od **příjmu, ne od kasy**: půjčka má být přemostěním, ne
způsobem, jak si koupit město, které se neuživí. Kasa o splatitelnosti neříká
nic. Už půjčené se od stropu odečítá, takže druhá půjčka je menší než první.

Úrok je **jednoduchý, ne složený** — vrátí se `jistina × (1 + sazba × roky)`,
rozdělené na stejné splátky. Anuita by byla přesnější, ale hráč by z ní neuměl
v hlavě odhadnout, kolik ho to bude stát, a tohle je hra, ne hypoteční
kalkulačka.

**Rating je paměť.** Nesplacená splátka se neodpouští ani nehromadí do skoku:
dluh zůstane, měsíc se nepočítá jako splacený a rating klesne. Příští půjčka je
pak dražší, a to je jediný trest, který za nesplácení existuje. Léčí se
**pomaleji, než padá** — jinak by stačilo pár měsíců v černých číslech
a nesplácení by nic nestálo. Hlídá to validace.

**Granty jsou obsah** v `content/vanilla/grants/`, ne kód (P5). Přibyl druhý typ
definice, `grant`, a registr ho vede **zvlášť od budov**: sjednotit obojí do
jedné unie by znamenalo, že každé místo, které sáhne na `footprint`, musí
nejdřív dokazovat, že nemá v ruce dotaci. Zkoušel jsem to a rozbilo to 479 míst.

Podmínka s `forTicks` musí platit **v kuse**. Bez toho by šel grant za
spokojenost sebrat tím, že hráč na jediný tik srazí daně na nulu, vybere si
odměnu a hned je vrátí zpátky. Neznámá veličina grant nepřizná, ale nespadne —
mod si smí přidat vlastní milník a hra ho nesmí odmítnout jen proto, že o něm
neví.

Splátky mají v rozpočtu vlastní řádek. Nejsou údržba ničeho — je to cena za to,
že si město kdysi vypomohlo.

Rating a půjčky **ještě nejsou v savu**: nese je až formát v6 (T59). Načtené
město se do té doby probouzí s čistým štítem, což je milosrdnější než nula
a hlavně to nepředstírá, že si formát pamatuje něco, co v něm není.

- [x] T58 — dluhopisy: emise, úpis, výplata úroků, splatnost

**Jediný nástroj ve hře, kde hráč licituje.** U půjčky je sazba dána; tady ji
nabízí sám a hádá, kolik lidí to koupí. Úspěšnost se skládá z pěti věcí a každá
je rozhodnutí, které udělal dřív: kolik nabídl nad referenční sazbu, jak se ve
městě žije, jestli roste, kolik je v něm kriminality a kolik už dluží.

**Poplatek se platí z celé nabídky, dostane se jen upsané** (R19). Bez toho by
bylo optimální vypisovat nesmyslně velké emise s minimálním úrokem: co se
upíše, je zisk, a co ne, nic nestojí. Takhle je nadsazená nabídka draho
zaplacený omyl.

Neupsaná část **propadá**. Nezůstane viset jako nabídka, kterou by někdo mohl
koupit později — emise je jednorázová událost, ne trh.

Úrok se vyplácí **ročně**, jistina jednorázově ve splatnosti. Zmeškaný kupón se
**nehromadí do skoku**: termín se posune i tak, jinak by po letech přišel účet,
kterým se město dorazí samo.

**Nesplacená jistina je jiná liga než zmeškaný kupón.** Sráží rating výrazně
a na několik let zavře přístup na trh — kdo nezaplatil, tomu příště nikdo
nepůjčí. Validace hlídá, že to bolí víc než zmeškaná splátka; kdyby ne, byla by
emise, kterou hráč nezaplatí, levnější než ta, kterou splácí poctivě.

Klesající město se **netrestá dvakrát**: záporný růst se ořízne na nulu. Pokles
už trestá spokojenost a kriminalita, a dvojí trest za totéž by z dluhopisů
udělal past, ze které se padající město nedostane.

Populace, proti které se měří růst, se po načtení savu **dopočítá z budov**,
místo aby se ukládala. Načtené město tak startuje s nulovým růstem, ne
s falešným skokem proti nule.

Dluhopisy mají v rozpočtu vlastní řádek vedle půjček. Kupón se platí ročně, ale
v měsíčním rozpisu se ukazuje dvanáctina — hráč si má umět srovnat, co ho to
stojí měsíčně.

- [x] T59 — save verze 6, migrace, fixtura

**Ukládá se i probíhající pohroma** (rozhodnutí autora). Jinak by si hráč
uložil, nechal město shořet a načetl zpátky — a katastrofy by přestaly být
rozhodnutím, jak zareagovat, a staly by se otázkou, kdy stisknout načíst.

Sedm vrstev katastrof — oheň, palivo, příznaky ohně, povodeň, hloubka,
poškození, trosky — jde do **vlastního souboru** `disasters.bin`. Ne přílepkem
k `layers.bin`: jsou to vrstvy, které umí být celé nulové po celou hru, a kdyby
se přilepily doprostřed, musel by se buffer při každé změně přeskládat.
V ZIPu se prázdný soubor smrskne skoro na nic.

Do `state.json` přibyly tři sekce: **katastrofy** (přepínač, hájení, běžící
pohromy s vlastním stavem, dočasné postihy, odpojené elektrárny, nakaženost),
**linky** a **finance** (půjčky, dluhopisy, rating, přiznané granty).

**Vlastní stav pohromy se ukládá, jak přišel.** Save o něm nic neví a je to
záměr: tvar si určuje implementace a mod si smí přidat vlastní. Kdo mu po
načtení nerozumí, ten katastrofu ukončí — dělá to plánovač.

**Odvozené se neukládá.** Počet hořících dlaždic, mapa kolejí ani statistiky
linek do savu nepatří; dopočítají se. Jinak by stačil jeden ručně upravený save
k tomu, aby si hra myslela, že hoří něco, co nehoří.

Poškozený `disasters.bin` je **chyba, ne důvod k dopočtu**: tichý fallback by
z rozbitého souboru udělal město, ve kterém náhodně hoří.

Migrace v5 → v6 dá starému savu prázdné vrstvy, zapnuté katastrofy, žádné linky
ani závazky a rating na čistém štítu. Počet vrstev je v ní **natvrdo**, ne
z `SAVE_DISASTER_LAYER_ORDER` — migrace popisuje minulost, ne současnost. Kdyby
ve verzi 7 přibyla osmá vrstva, začala by tahle migrace vyrábět buffer, který
verze 6 neumí přečíst.

`terraformTick` ze zadání **není**: patří k sesuvu půdy (T54), který se
neimplementoval. Přidávat do formátu vrstvu, kterou nikdo nezapisuje ani nečte,
by znamenalo verzi navíc, až se sesuv doopravdy udělá.

Fixtura `v6.city.base64` je skutečné odehrané město: 60 budov, 192 obyvatel,
**hořící dlaždice a běžící požár**, autobusová linka se třemi vozy, půjčka
i dluhopis. Vygenerovalo ji dočasné `tests/_fixturegen.test.ts`, které se po
vygenerování smazalo — v repozitáři zůstal jen výsledek, stejně jako u v5.

Vyplavalo při tom, že `applySaveToWorld` dostával v testu save zastavený na
verzi 5. Kontrakt je, že se do světa dává **zmigrovaný** save; teď to test
respektuje a `disasters.bin` se vyžaduje.

- [x] T60 — vyhodnocení fáze 4

Dvacet pět kritérií z §11. Většinu z nich pokrývaly testy jednotlivých úkolů;
šest ne — ta byla průřezová, tvrdila něco o tom, že spolu věci drží, a takové
tvrzení nemá kde vzniknout, když každý úkol testuje jen sebe. Dostala vlastní
sadu `tests/phase4.test.ts`: determinismus po 5000 tikách se **všemi čtrnácti**
katastrofami, linkou a půjčkou najednou (22), blackout jako zesilovač rizika
požáru (11), podfinancované hasičárny (6), dozvuk chemické havárie (15),
vypnuté katastrofy přes save (4) a všechny čtyři velikosti mapy (1).

Kritérium 6 stálo za čtyři pokusy a je poučné, proč. První verze měřila dobu
hoření v zástavbě — jenže dům shoří a tím oheň skončí, takže test měřil
životnost domu, ne práci hasičů. Druhá měřila les, který byl tak malý, že oheň
došlo palivo dřív, než na něm záleželo financování. Třetí měla les tak velký,
že přerostl dosah jedné stanice, a rozdíl mezi plným a nulovým rozpočtem se
utopil v tom, že většina lesa nebyla pokrytá tak jako tak. Sondovací test
nakonec ukázal skutečný vztah: při pokrytí 0 hoří 163 tiků a shoří 50 dlaždic,
při 40 to je 41 tiků a 7 dlaždic, při 255 pak 23 tiků a 4 dlaždice. Finální
test blanketuje menší les třemi stanicemi a tvrdí obojí — delší hoření
**i** větší spáleniště.

### Co audit našel

**Kritérium 24 — konstanta balancu v kódu.** `damage.ts` si držel
`HIGH_LEVEL = 3`, práh, od kterého je obytná zástavba pro účely škod „vysoká".
Sdílelo ho tornádo, zemětřesení i výbuchy — a přitom v datech už seděl
`disasters.indicators.denseLevel` na čtyřech, tedy jiné číslo pro velmi
podobnou myšlenku. Práh je teď v datech jako `disasters.damage.highLevel`
a `contentKindAt` i `rollDamage` dostaly `balance`.

Schválně **nesloučený** s `denseLevel`: ten říká, odkud je čtvrť hustá pro
výpočet rizika, tenhle odkud je dům pevný. Že mají obě čísla stejný typ, z nich
nedělá totéž. Sloučení by změnilo, co tornádo srovná se zemí, a to je rozhodnutí
o ladění, ne o úklidu kódu — leží teď v datech vedle sebe a je vidět.

**Kritérium 25 — text mimo locale.** Kontrola našla něco jiného, než hledala:
`ui.disaster.pileup`, `strike`, `riot`, `gangWar`, `blackout`, `epidemic`
a `chemicalSpill` byly v `cs.json` i `en.json` **dvakrát**. Vzniklo to při T52
a T53, kdy každý úkol vložil svou skupinu na vlastní místo. `JSON.parse`
duplicitní klíč mlčky přepíše posledním, takže hra fungovala, žádný test
nespadl a v souboru to bylo vidět jen tomu, kdo se dívá.

Kontrola proto sahá na **syrový text**, ne na rozparsovaný objekt — přes
`import.meta.glob` s `?raw`, aby si nevyžádala `@types/node`. Druhý nový test
hlídá, že každá registrovaná katastrofa má jméno v obou jazycích: jména se
skládají za běhu jako `ui.disaster.${kind}`, takže kontrola literálních klíčů
v `i18n.test.ts` je míjela a nová katastrofa se mohla hráči ohlásit syrovým
klíčem.

Zůstává známé omezení: duplicitu hlídá **test, ne hra**. Vanilla obsah se
parsuje ve Vite při buildu a runtime už syrový text nemá. Až se ve fázi 5
načtou mody ze ZIPu, bude se `ContentSource` muset zeptat na text sám.

### Co se nezměřilo

**Kritérium 2 — 512×512 při 60 FPS: neověřeno v téhle relaci.** Panel prohlížeče
nekompozituje, `requestAnimationFrame` neběží vůbec (nula snímků za pět sekund),
takže žádné číslo, které bych naměřil, by nebylo o snímkování. Chce to jeden
ruční pohled.

Co změřit šlo, změřeno bylo: **1,59 ms na tik** na prázdné mapě 512×512.
Proti 0,49 ms z T45 je to trojnásobek — plánovač katastrof, riziko, linky
a finance přibyly a platí se za ně. Při třech ticích za sekundu je to 4,8 ms
práce na sekundu; do rozpočtu snímku se tik vejde s velkou rezervou i tehdy,
když padne přesně do něj. Simulace tedy pořád není úzké hrdlo a **T46 zůstává
odepsaný** ze stejného důvodu jako v T45.

### Zbytek

Kritéria 3, 5, 7–10, 12–14, 16–21 a 23 drží sady jednotlivých úkolů; golden
testy prochází beze změny. Mutační test nových míst 3 ze 3.

Celkem 972 testů.

### Co fáze 4 nedodělala v rozhraní

Sedm příkazů z 4c nemá **žádné tlačítko** a jde k nim jen přes `dispatch`:
`take_loan`, `issue_bond`, `create_line`, `delete_line`, `add_stop`,
`remove_stop`, `set_vehicles`, `set_fare`. Rozpočtový panel přitom řádky
*dluh*, *dluhopisy* a *MHD* už zobrazuje — hráč vidí čísla, která nemá jak
ovlivnit. Chybí i přepínač katastrof za běhu; dá se jen při zakládání města,
i když save si stav poctivě nese (T59).

Zadání fáze 4 tahle tlačítka nikde nepředepisuje a akceptační kritéria je
netestují — kritéria 16 až 20 mluví o chování linek a závazků, ne o tom, kudy
se k nim hráč dostane. Testy je proto volají přímo. Není to tedy nesplněné
kritérium, ale díra mezi tím, co simulace umí, a co jde odehrát.

Při soupisu se ukázalo i to, že tři zóny sdílejí jednu ikonu `zone`, čtyři
dopravní stavby jednu `bus` a **všech čtrnáct katastrof jednu `disaster`** —
v roletce se rozlišují pouze textem.

- [x] Kreslené ikony v rozhraní

**Rozhodnutí autora, které mění dosavadní pravidlo.** Architektura §6 i zadání
fáze 4 §12 říkaly „žádné sprity". Po T60 to platí jen pro **svět** — terén,
silnice a budovy na mapě zůstávají procedurální kvádry. Tlačítka nesou kreslené
obrázky.

Sto pět ikon přišlo v šesti arších po kartách. Rozřezal je skript v scratchpadu:
karty se hledají jako souvislé světlejší oblasti, ne pevnou mřížkou, protože
každý arch má jiný počet sloupců i rozteče.

Odříznout popisek pod ikonou dalo víc práce než všechno ostatní. Mezera mezi
nimi neexistuje — měkký stín ji přemostí. Podle velikosti útvaru to taky nejde,
protože stín s textem splyne v jeden. Rozhodla nakonec **barva a tloušťka
tahu**: popisek je jasná šedá tenkým písmem, ikony jsou barevné a jejich stín
tmavý, a co ze šedé zbude po erozi, je zeď budovy, ne písmeno. Čtyři karty ze
sta pěti to nerozsoudilo a mají v skriptu jmenovitý řez.

Průhlednost se klíčuje proti výplni karty, počítané **pro každou kartu zvlášť**.
Jedna společná hodnota pro celý arch nechávala na některých ikonách viditelný
obdélník: karty se o pár jednotek liší a při klíčování se to pozná.

Ikony jdou do hry přes `ContentSource`, ne přímým sáhnutím rozhraní do
`content/` — mod je smí přidat i přepsat stejně jako budovu nebo text (P5).
`iconSvg` vrátí `<img>`, když obsah obrázek má, jinak kreslí polygon jako dřív.
Zůstat u polygonů je **platná cesta, ne selhání**: mod, který žádný obrázek
nedodá, nesmí hru zastavit.

`graphics.icon` se schválně nepřejmenovalo. Řídí zároveň symbol na střeše ve 3D
a ten je z polygonů — kdyby se z něj stalo jméno obrázku, zmizely by symboly
z domů ve městě. Paleta si jméno obrázku odvozuje z **id budovy**
(`vanilla:hospital` → `hospital`) a na `graphics.icon` spadne, když obrázek
chybí.

Co se tím rozlišilo: tři zóny měly jeden kosočtverec, čtyři dopravní stavby
jeden autobus a **všech čtrnáct katastrof jednu ikonu** — v roletce se daly
rozeznat jen textem. Teď má každá svou. Rychlost taky poprvé má ikony místo
holého textu.

Testy, které hlídaly „každé jméno ikony má polygon", tvrdí nově „ikona je
nakreslitelná" — obrázkem, nebo tvarem. Přibyl test, že každá registrovaná
katastrofa má vlastní obrázek, a test, že třída služby bez vlastní ikony
(`social`, `transit`) spadne na symbol své budovy místo aby zůstala prázdná.

Tlačítka vyrostla z 30 na 38 px: na menším se z izometrického domku stane
skvrna. 105 obrázků je 2,9 MB, build vyrostl na 3,7 MB.

**Prosvětlení.** Archy jsou kreslené na tmavé pozadí a v HUD, který je taky
tmavý, podstavce a stíny ikon zanikly. Zesvětlit všechno stejně nepomůže — to
jen vybělí, co už vidět bylo. Skript proto zvedne gammu na 0,75 (střední tóny
víc než světla), podloží černý bod na 45, aby v ikoně neexistovala úplná čerň,
a dožene sytost na 1,25, protože podložení barvy vždycky trochu vysedí.
Kontrolní míra: průměrný jas buldozeru je 129 proti panelu s 22.

Společná gamma ale nestačila. Archy mají ikony různě exponované a rozdíl byl
velký — blackout měl průměrný jas 67, kdežto *stáhnout do souboru* 172, takže
na liště vedle sebe jedna svítila a druhá byla skvrna. Skript proto počítá
gammu **pro každou ikonu zvlášť**, aby všechny skončily kolem 152. Jen
prosvětluje, nikdy netmaví: už světlá ikona je v pořádku a stahovat ji dolů by
jen ubralo kontrast proti panelu. Rozptyl spadl ze 67–172 na 139–172.

Zkoušel se ještě **obrys kolem siluety**, klasický trik na ikonu v tmavém UI.
Nefunguje tu: klíčování průhlednosti nechává na ikonách drobné vnitřní hrany
a obrys je obtáhne všechny, takže z izometrického domku je roztřepená nálepka.
Měkká záře místo obrysu zase dělá mlhu a ubírá detail. Zůstalo jen dorovnání.

Tlačítka nakonec 46×44 px a ikona v nich 35 — o pět víc, než co stačilo na
vzhled, protože se na ně taky musí trefit myš.

Ověřeno ve hře: 104 obrázků v DOM, žádný rozbitý, dva polygonové zbytky —
dosah sounáležitosti a dosah MHD, tedy přesně ty dvě třídy, ke kterým obrázek
není. 974 testů.

- [x] T61 — silnice si poradí s lesem i se sedlem

**Není ze zadání fáze.** Je to UX požadavek autora po dohrání fáze 4; číslo
navazuje na T60, aby se na něj dalo odkazovat.

Silnice do té doby odmítala dvě věci, které hráč ve skutečnosti řešit nechtěl.
Na lese, skále a v mokřadu hlásila „na tenhle terén se to postavit nedá",
takže trasa přes remízek byla dvacet kliků buldozerem a teprve pak dvacet
kliků silnicí. Na **zkroucené dlaždici** — sedle, kde `nw + se ≠ ne + sw` —
hlásila `error.roadTwisted` a hráč musel uhodnout, který ze čtyř rohů má
srovnat. Většinou to skončilo oklikou kolem kopce.

Nově si vozovka obojí vyřídí sama a **připočte cenu**. Sazby jsou v datech
a už tam byly: vykácet les 12, zavézt mokřad 40, odtěžit skálu 60. Rozdíl mezi
nimi je celý smysl — přes skálu se dá jet, jen se to nevyplatí, a to je jiná
věc než zákaz.

Sedlo se **dozdí na nejvyšší roh** (rozhodnutí autora). Nejdřív to fungovalo
jinak: pro každý ze čtyř rohů existuje právě jedna výška, při které rovnost
platí, tak se počítaly všechny čtyři a brala se nejlevnější. Vycházelo to
levněji a bylo to nahlášené jako chyba — z dlaždice se stal **osamocený špičák
mezi sousedy** a svah po tažení vypadal jako schodiště poskládané z jehel.
Ověřeno v číslech: dlaždice s rohy 1, 1, 2, 1 dostala jeden roh na 2 a zbytek
nechala být.

Dozdění nechá terasu, která k okolnímu kopci sedí, a **nikdy nekope** — hráč
staví násep, ne výkop. Na stejném svahu vyjde po tažení nula jehel a žádný roh
na mapě neklesne. Stojí to víc rohů, a je to tak správně.

Vedlejší efekt je, že se to celé **zjednodušilo**. Rovná dlaždice má všechny
čtyři rohy stejně, takže rovnost platí sama sebou a dozdít jde každé sedlo:
`planUntwist` už nevrací „nedá se to" a `error.roadTwisted` zmizelo i z locale
souborů. Odmítnout smí jen `checkTerraform`, a to kvůli budově nebo vodě
v cestě, ne kvůli tvaru terénu.

Zmizelo i ověřování výsledku. U hledání nejlevnějšího rohu bylo potřeba —
`planCornerHeight` cíl mimo rozsah ořízne a jeho kaskáda umí sáhnout i zpátky
na rohy téže dlaždice. U dozdění je to mrtvý kód, protože rovná dlaždice
zkroucená být nemůže, a mutační test to ukázal: kontrolu nešlo zabít. Zaručuje
to teď test, který tvrdí, že srovnaná dlaždice má **čtyři stejné rohy**.

Náhled ceny při tažení počítá `estimateRoad`. Kdyby zůstal na sazbě za vozovku,
hráč by viděl deset a zaplatil devadesát. Test drží obě cesty u sebe: co ukáže
cenovka, to se strhne z kasy. U tažení přes víc dlaždic je to odhad — srovnání
jedné dlaždice hne rohem, o který se dělí se sousedy, takže sousední sedlo může
zmizet samo a skutečná cena bývá **nižší, nikdy vyšší**.

Golden snapshot se posunul a je to důkaz, že to funguje: v řadě, kudy vede
hlavní ulice, jsou na tom seedu **tři zkroucené dlaždice**. Dřív v ní zůstaly
díry, teď je souvislá, a město vyroste na 192 obyvatel místo 180.

Ověřeno ve hře: les 10 + 12, skála 10 + 60, mokřad 10 + 40, sedla srovnaná
na terasy, nula jehel a nikde se nekopalo. Mutační test 5 z 5. 985 testů.

- [x] T62 — katastrofa se ohlásí a hru zastaví

**Nahlásil autor a je to nejhorší chyba, jakou fáze 4 měla.** Načetl uloženou
pozici, odehrál dva herní roky a přišel o město. Hra mu neřekla ani slovo.

Příčina byla trapná: rozhraní se na `world.disasters.active` **vůbec nedívalo**.
Hlásila se jen katastrofa spuštěná ručně z menu — tedy ta jediná, o které hráč
už stejně ví, protože na ni právě klikl. Ta, kterou pošle plánovač, běžela
potichu.

Nově je to **okno přes obrazovku**, ne řádek v rohu. Katastrofa je jediná věc
ve hře, která běží proti hráči a sama nepřestane; zpráva, kterou jde
přehlédnout, je u ní k ničemu. Okno nese jméno pohromy, její kreslenou ikonu
a **větu o tom, co se s tím dá dělat** — u požáru že ho zastaví silnice, voda
nebo průsek, u epidemie že ji zastaví jen pokrytí zdravotnictvím.

**Hra se se zobrazením pauzne.** Není to laskavost, je to jediný způsob, jak dát
hráči čas si to přečíst dřív, než mu shoří další čtvrť — a hráč, který si zrovna
odskočil, se vrátí k pauze místo k ruině. Po „Ukázat" se rychlost **nevrací
sama**: hráč právě dostal na obrazovku hořící čtvrť a rozjet hru je jeho
rozhodnutí.

Při psaní se ukázala druhá tichá ztráta, tentokrát moje: `announced` se plnilo
dřív, než se okno otevřelo. Pohroma, která přišla přes už otevřené okno, by se
označila za ohlášenou a hráč by se o ní **nedozvěděl nikdy**. Rozhodování je
proto ve vlastní funkci `nextToAnnounce`, otestované bez DOM, a `announced` se
doplňuje až po tom, co se okno opravdu otevřelo.

Mutační test 6 z 9. Tři přeživší jsou řádky uvnitř `createApp` — že se
`announceDisasters` volá a že se volá `setSpeed(0)`. Test se tam bez Pixi
a canvasu nedostane; ověřeno ručně ve hře, kde svět při otevřeném okně
nepřetikal ani jednou.

- [x] T63 — dva buldozery

**Rozhodnutí autora.** Buldozer se **zóny nedotkne**. Do T63 stačilo kliknout
podruhé a zóna byla pryč, což se dělo omylem právě při probourávání průseku
proti ohni — hráč hasil a přitom mazal čtvrť pod sebou.

Zóna je značka pod tím, co na dlaždici stojí, a kdo bourá dům, chce skoro
vždycky postavit jiný. Buldozer proto boura budovu, silnici, trosky a terén,
a když na dlaždici zbyla jen zóna, **odmítne to** hláškou „není co bourat".

Rušit zóny umí vlastní nástroj. Není to druhý buldozer, ale **zóna s hodnotou
„žádná"** — `zoneArea` ji uměla celou dobu, jen k ní nevedlo tlačítko. Dostane
tím tažení přes obdélník zadarmo, což je přesně to, co hráč u rušení zón chce;
buldozer maže po jedné.

Ikonu `zone-clear` archy nemají. Skládá ji `tools/derive-icons.py` z odbarvené
zóny a červeného křížku — odbarvené schválně, ať se to nečte jako „pryč
s obytnou zónou", ale „pryč se zónováním". Je to **náhražka**: až přibude
kreslená ikona toho jména, stačí ji do složky hodit a skript už nepouštět.

- [x] T64 — trosky si pamatují, co na nich stálo (save v7)

**Nahlásil autor:** po vyhořelém městě se nedalo poznat, co kde bylo. Hromada
po nemocnici vypadá stejně jako hromada po hasičárně, takže z obnovy bylo
hádání — a přitom právě u služeb je celý rozdíl v tom, kterou postavit dřív.

Trosky proto nesou `definitionId` toho, co je způsobilo. Je to **řídká mapa,
ne vrstva**: paměť má smysl jen tam, kde stála budova, a vrstva by musela nést
čísla místo id, což do savu nepatří (P6). Zapisují ji všechna tři místa, kde
budovy padají — škody, oheň i povodeň.

Silnice a potrubí id nedostávají schválně. Hromada po silnici vypadá jako
hromada a hráč silnici najde podle sousedů; záznam u každé z nich by jen
nafukoval save.

Na mapě to nese **symbol té budovy v barvě poplachu**, ten samý, který nosila
na střeše. Kreslí se jen na **levý horní roh** bloku: nemocnice po sobě nechá
devět hromad a devět křížků by z toho udělalo mřížku, ze které se nepozná,
jestli padla jedna velká budova nebo devět malých. Roh se pozná tím, že soused
nahoře ani vlevo nenese totéž id — žádný extra stav to nepotřebuje. Dva stejné
domy vedle sebe splynou v jeden blok a je to cena za to, že se nikde nevede,
kde budova začínala.

Úklid trosek maže i paměť. Prázdná parcela se nesmí pořád hlásit jako bývalá
klinika.

Save je **verze 7**. Migrace v6 → v7 nemá co doplnit a nedoplňuje: ta informace
v savu verze 6 nikdy nebyla, takže staré hromady zůstanou bezejmenné. Hádat je
podle okolí by znamenalo napsat hráči do města nemocnici, která tam nikdy
nestála. Fixtura `v7.city.base64` je odehrané město s devíti dlaždicemi trosek
po nemocnici a běžícím požárem.

Mutační test 10 z 10. Poslední přeživší byl poučný: stráž „mám vůbec co
značit" nešlo zabít, protože u prázdné mapy vyšlo `undefined === undefined`
stejně jako se stráží. Chytil ji až případ, kdy sousedé id nesou a prostřední
dlaždice ne — tam by bez stráže dostala značku prázdná parcela.

1010 testů.

- [x] T65 — podezdívka kopíruje svah

**Nahlásil autor:** na kopci nebylo poznat, na které dlaždici budova stojí.

Podezdívka se kreslila jako **rovný kvádr** od nejnižšího rohu půdorysu
k nejvyššímu. Jeho spodní hrana je vodorovný diamant, jenže země pod ní se
svažuje — takže podezdívka budovu nedržela, ale protínala. Rámeček pod kurzorem
je přitom zkosený podle terénu správně, a ty dva tvary vedle sebe si
protiřečily.

Nově má podezdívka **rovnou horní hranu a spodní podle terénu**. Nahoře na ní
stojí dům a ten rovný je; dole se láme na každé hranici dlaždic, protože se tam
láme i terén. Rovná čára od rohu k rohu by u víc než jedné dlaždice na lomeném
svahu budovu buď podřízla, nebo ji nechala viset.

Výška se čte `groundHeightAt` a **interpoluje se bilineárně**. Půdorys je
zasazený o 0,12 dlaždice dovnitř, takže na celé rohy nepadne; zaokrouhlení na
nejbližší roh by nechalo spodní hranu skákat po patrech místo aby kopírovala
svah.

Na rovné parcele vyjde přesně totéž co dřív — hlídá to test, aby oprava svahu
nerozhodila každou budovu ve městě.

Mutační test 5 z 5. Dva přeživší byly poučné a oba stejného druhu: testy
zkoušely svah jen podél jedné osy a okraj mapy jen daleko za hranou. Chybělo
tedy pokrytí svislé interpolace a případu `x = -1`, který se v indexu
`y * side + x` promění na **poslední roh předchozího řádku** — platný index
z úplně jiného místa mapy, ze kterého by u západního okraje vyrostl kopec
opsaný z východního.

1019 testů.

- [x] T66 — zóna se při vyznačení srovná

**Rozhodnutí autora** navazující na T65: dům ze zóny na kopci má stát na rovině,
ne na podezdívce jako na chůdách.

Srovnávat se to dá **jen při zónování**, ne až když dům roste, a je za tím
geometrie, ne lenost. Sousední dlaždice **sdílejí rohy**, takže dvě sousední
rovné dlaždice musí být ve stejné výšce; jakmile v okolí něco stojí, terén se
nehne. Naměřeno na golden městě: ze 61 pokusů srovnat parcelu pod rostoucím
domem jich **59 zablokovala budova** a rovných domů přibyly tři. Ve chvíli
zónování je plocha ještě prázdná a jde to.

Cesta k tomu byla přes tři slepé uličky a všechny stály za změření:

| varianta | budov | obyvatel | domů na svahu |
|---|---|---|---|
| beze změny | 61 | 192 | 29 |
| srovnat parcelu při růstu | 61 | 192 | 26 |
| dozdít zónu na nejvyšší roh | 61 | 192 | 29 |
| srovnat zónu, u vody na nejnižší roh | 33 | 104 | 4 |
| **srovnat zónu a při blokaci ji půlit** | **61** | **192** | **3** |

Dozdění na nejvyšší roh jako u silnice (T61) neprošlo vůbec: u pobřeží zvedá
rohy sdílené s vodní dlaždicí a **zvedat dno moře neumíme**, takže to
zablokovalo všechny tři zóny golden města. Srovnání na nejnižší roh u vody zase
odkopalo pobřežní čtvrť až k hladině a růst se tím zpomalil na čtvrtinu — město
došlo na stejný počet budov, ale trvalo mu to 4000 tiků místo 1000.

Vyhrálo **půlení**: plocha se zkusí srovnat celá, a když to neprojde, rozdělí se
na půlky a zkouší se po částech. Typicky vadí jedna řada u břehu a zbytek
čtvrti srovnat jde. Bez toho by pobřežní čtvrť zůstala na svahu celá kvůli
jedné dlaždici.

Velká plocha se **nesrovnává** (strop 64 dlaždic): kdo táhne zónu přes celé
údolí, nechce náhorní plošinu. Rušení zóny terénem nehýbe — je to mazání
značky, ne stavba. A srovnání **není podmínkou** zónování: když nejde, zóna se
stejně vyznačí a domy dostanou podezdívku jako dřív.

~~**Zadarmo.**~~ Rozhodnuto opačně hned v T67 — účtuje se, ale s cenovkou.

Vedlejší úklid: pravidlo „smí se sem sáhnout terénem?" bydlelo jako soukromá
funkce v `commands.ts` a potřebovala ho i tahle změna. Je teď ve `world.ts` jako
`reshapeBlocker` a `commands.ts` ho jen překládá na hlášku pro hráče — dvě kopie
téhož pravidla by se dřív nebo později rozešly.

Ověřeno ve hře: vyznačení zóny 5×5 na kopci srovnalo 9 nerovných dlaždic z 25
na nulu. Mutační test 5 z 5. 1024 testů.

- [x] T67 — srovnání zóny se účtuje a má cenovku

**Rozhodnutí autora**, opačné než v T66. Srovnání terénu pod zónou se platí
a hráč cenu vidí při tažení, stejně jako u silnice.

Podmínka byla jasná: cenovka nesmí lhát. Plánování se proto vytáhlo do čisté
funkce `planZoneLevelling` a počítá se nad **pracovní kopií výšek**, ne nad
světem. Půlení plochy totiž staví druhou půlku na tom, co udělala první — kdyby
se přitom sahalo na svět, nešlo by cenu spočítat předem, aniž by se terén
mezitím hnul. Cenovku i účet drží u sebe test: co ukáže `estimateZoning`, to
strhne `zoneArea`.

`reshapeBlocker` dostal užší tvar světa (`ReshapeView`). Renderer má po ruce jen
`ReadonlyWorldView` a musí spočítat totéž co příkaz; kdyby k tomu potřeboval
zapisovatelný svět, počítal by to jinde a jinak — a přesně tak vznikají cenovky,
které lžou.

~~**Na co nejsou peníze, to se nesrovná — ale zóna se vyznačí.**~~ Rozhodnuto
opačně hned v T68: bez peněz se nezónuje, jako se bez peněz nestaví silnice.

Rušení zóny se neúčtuje a terénem nehýbe.

Ověřeno ve hře: zóna 5×5 na kopci ukázala 80, strhla 80 a srovnala všech devět
nerovných dlaždic. Mutační test 4 ze 4. 1029 testů.

- [x] T68 — bez peněz se nezónuje

**Rozhodnutí autora**, opačné než v T67. Když na srovnání terénu nejsou peníze,
zónování se odmítne celé — přesně jako u silnice. Dřív se zóna vyznačila a jen
se nesrovnala, takže cenovka ukázala číslo, které se pak nestrhlo.

Vyžádalo si to **přepis `zoneArea` na dva průchody**. Značky se dřív psaly
rovnou v cyklu a odmítnutí přišlo až po něm; teď se nejdřív jen sepíše, co by se
změnilo, pak se plánuje a platí, a značky se píšou až po zaplacení. Bez toho by
po odmítnutí zůstala vyznačená ta část čtvrti, kam se pisatel stihl dostat —
a hráč by ji musel hledat a mazat.

Prázdné tažení se dál odmítá **svým vlastním důvodem** (voda, silnice, obsazeno),
ne nedostatkem peněz: hráč, který táhne zónu přes řeku, má slyšet o řece.

Rušení zóny se neodmítá nikdy. Je to mazání značky, ne stavba, a hráč bez kasy
by se jinak nezbavil ani zóny, kterou si omylem vyznačil.

Ověřeno ve hře: na kopci s cenou 88 a kasou 87 přišlo `error.notEnoughFunds`
a **ani jedna z 25 dlaždic nezůstala vyznačená**. Mutační test 4 ze 4.
1031 testů.

- [x] T54 — sesuv půdy, save verze 8

**Poslední z patnácti.** Byl podmíněný fází 3b (R22): bez převýšení nemá co
přesouvat. Fáze 3b je dávno hotová, takže podmínka padla — riziko i katalogový
záznam byly připravené už z T47, chyběla jen mechanika.

Sesuv je **jediná katastrofa, která mění mapu**. Ostatní ničí, co na ní stojí;
tahle přesune samotnou zem: horní rohy dráhy klesnou o patro, dolní o patro
stoupnou. Rohy se sčítají přes celou dráhu, takže roh, který je horní pro jednu
dlaždici a dolní pro její sousedku, vyjde na nulu — hlína přes něj jen projela.

Výsledek pak projde `planCornerHeight`, který dorovná sousední rohy do jednoho
patra. **Kaskáda je součást jevu, ne úklid po něm**: utržený svah strhne i to
nad sebou, a co stálo na rozích, kterými pohnula, spadne taky.

Je **okamžitý**, ne postupný. Roztáhnout ho do dvaceti tiků by z něj udělalo
pomalé tornádo, a to už ve hře je. Nezapaluje a nezamořuje — sesuv je hlína,
ne exploze; jeho cena je v tom, že přeruší sítě vedené po spádnici.

Voda si vyžádala tři pravidla, každé jinak:

- **Dráha u vody končí.** Kdyby ji přeskočila, objevil by se sesuv na druhém
  břehu.
- **U břehu se nepřisypává.** Zvednout roh sdílený s vodní dlaždicí by naklonilo
  hladinu a kaskáda by to nesla dál.
- **Okraj dráhy vodu nebere.** Naměřeno: bez toho se břeh vedle dráhy propadne
  o tři patra místo o jedno.

Nová vrstva `terraformTick` si pamatuje, kdy se dlaždice naposledy upravila —
čerstvě přesypaná půda drží hůř, takže se na ni sesuv chytá ochotněji. Zapisuje
se v `applyHeightChanges`, protože tudy jde **každá** změna terénu: ruční
i ta, kterou si udělá silnice nebo zóna sama.

Uint16 přeteče po 65 536 ticích, tedy po 182 herních letech, a stáří se proto
počítá po kruhu. Jediná daň je, že dlaždice upravená přesně před 182 lety
vypadá chvíli jako čerstvá — zvedne to váhu jednoho místa v losu a víc si za
dvojnásobnou paměť kupovat nemá cenu.

Save je **verze 8** s novým souborem `terraform.bin`. Vlastní soubor ze stejného
důvodu jako `heights.bin`: vrstva je **dvoubajtová**, kdežto ty v `disasters.bin`
jsou po jednom. Bajty se skládají ručně, ne přes `new Uint8Array(buffer)` —
to druhé závisí na endianitě stroje a save z jednoho by se na druhém četl
obráceně. Migrace v7 → v8 doplní nuly, tedy „nikdy se tu neupravovalo";
napsat všude aktuální tik by z celého města udělalo čerstvě přesypanou půdu.

Mutační test 12 z 12, ale dostat se tam trvalo. Dvě stráže byly **nadbytečné**
a šly pryč: vlastní kontrola sklonu (rovinu odfiltruje `steepestDescent` sám —
a dlaždice na hraně srázu je rovná, přitom je to přesně místo, kde se svah
utrhne) a přeskočení nulové změny (`planCornerHeight` vrátí prázdný plán sám).
Dva testy zase nedosáhly do své větve: jeden zkoušel přetečení hodin číslem,
u kterého vyšel prostý odečet stejně jako výpočet po kruhu, druhý zkoušel okraj
dráhy se seedem, který dává **šířku jedna** — dráha pak žádné okraje nemá.

Ověřeno ve hře: sesuv na svahu snížil tři rohy, zvedl šest, nenechal jediné
porušení invariantu a nezaložil žádný oheň. Registr hlásí **patnáct katastrof**.

1057 testů.

- [x] Kritérium 2 ověřeno — 512×512 při plném oddálení

Poslední otevřené akceptační kritérium fáze 4 (§11 bod 2). Měřilo se na
**zabydlené mapě 512×512**: 214 budov, 3 948 dlaždic silnic, tik 23 959, kamera
na `MIN_ZOOM`, takže je vidět celá mapa naráz — 1 024 chunků plus budovy, dohromady
1 243 vykreslovaných uzlů.

| stav | medián | p95 | maximum |
|---|---|---|---|
| pauza | 1,3 ms | 2,2 ms | 3,3 ms |
| rychlost 1× | 1,6 ms | 2,3 ms | 5,3 ms |
| rychlost 8× | 1,3 ms | 3,1 ms | 13,2 ms |

Rozpočet snímku při 60 FPS je 16,7 ms. **Kritérium drží**, a to i na osminásobné
rychlosti, kde nejhorší snímek — ten, na který padne tik simulace zároveň
s pečením chunku — spotřebuje 13,2 ms.

**Co měření nepokrývá.** Panel prohlížeče v téhle relaci nekompozituje,
`requestAnimationFrame` neběží, takže se neměřilo snímkování obrazovky, ale
**čas procesoru na snímek** — smyčka se poháněla ručně přes `app.ticker.update`.
Zahrnuje to tik simulace, přepočet chunků i sestavení kreslicích příkazů; chybí
jen samotné odeslání na GPU a čekání na vsync. U izometrického rendereru
s pečenými chunky je procesor to úzké hrdlo a GPU dostává ke kreslení tisícovku
texturovaných čtyřúhelníků, což je pro cokoli z posledních patnácti let nic.

### Co měření našlo

**Úplné zneplatnění stojí 250 ms v jednom snímku.** Celá mapa se upeče znovu.
Nastane při načtení města a po vygenerování mapy — tedy jednou, na místě, kde
hráč stejně čeká.

**Přepnutí diagnostické vrstvy stojí 52 až 90 ms**, protože `setOverlay`
zneplatní všechny chunky a při plném oddálení jsou vidět všechny. Při běžném
přiblížení je to 11 ms. Není to zadrhnutí, je to **jeden zahozený snímek** —
blikne to. Rozložit pečení do několika snímků by to odstranilo; není to
v kritériu a nechávám to jako nález, ne jako opravu.


## Rozpracované

**Fáze 4 je hotová.** 4a (T42–T45; T46 odpadl podle měření), 4b i 4c
(T47–T60) a nakonec T54 — **patnáct katastrof z patnácti**, MHD, finance,
save v8.

Akceptační kritérium 2 (512×512 při 60 FPS) je **ověřené** — viz měření níž.

Mimo kritéria zůstává **bez rozhraní celá 4c** — půjčky, dluhopisy a linky MHD
jdou jen přes `dispatch`. Viz vyhodnocení T60.

_(T41 — vyhodnocení fáze 3 — zůstává otevřené. Je to rozhodovací bod pro
autora, ne technický úkol.)_

## Backlog

_(Seznam zbývajících úkolů je v sekci **Rozpracované** výš. Tahle sekce byla
z doby fáze 1 a nesla úkoly T5–T10, které jsou dávno hotové — nechávat je tu
znamenalo tvrdit, že elektřina ani save neexistují.)_

Mimo zadání fází, otevřené k rozhodnutí:

- **`src/platform/`** — abstrakce nad úložištěm a soubory. Architektura §9 ji
  předepisuje, žádný úkol ji nezadává. Dokud neexistuje, sahá `ui/` na
  `localStorage` a `File` přímo.
- **Kopec před budovou ji nezakryje** — viz Známé problémy.
- ~~**Z bankrotu není cesta zpátky**~~ — vyřešeno v T57. Půjčka se odvozuje od
  příjmu, takže město s nulovou kasou, ale živým rozpočtem si na obnovu půjčí.

## Rozhodnutí učiněná během vývoje

| Datum | Rozhodnutí | Důvod |
|---|---|---|
| 2026-08-14 | Projekt v `D:\Projekty\citybuilder` | Vedle ostatních projektů autora. `C:\Users\Intel\Documents` je přesměrováno do OneDrive — `node_modules` by se synchronizovaly. D: má 344 GB volných. |
| 2026-08-14 | Node 24.19.0 LTS nainstalován přes scoop | Vite 8 vyžaduje `^20.19.0 \|\| >=22.12.0`, systémový Node 20.11.1 nestačí. scoop nevyžaduje admin a nemaže stávající instalaci. Odsouhlaseno autorem. |
| 2026-08-14 | Vite 8, TypeScript 6, ESLint 10, Vitest 4 | Aktuální verze v době scaffoldingu. Zadání T0 fixuje major verzi jen u `pixi.js@^8`. Vzájemná kompatibilita ověřena přes peerDependencies. |
| 2026-08-14 | `target: ES2022` místo šablonového `es2023` | Zadání T0 to určuje explicitně. |
| 2026-08-14 | `tsconfig.json` má `include: ["src", "tests"]`; `vite.config.ts` se netypecheckuje | `vite.config.ts` používá `import.meta.dirname`, jehož typy dodává `@types/node`. To není v seznamu závislostí T0, takže se nepřidalo. Cena: `npm run typecheck` nepokrývá konfigurační soubor. |
| 2026-08-14 | Ze systémového PATH odstraněn záznam `C:\Program Files\nodejs\` | Stínil scoop instalaci Node 24 a `npm run dev` by padal na kontrole `engines`. Odstraněn jen PATH záznam, ne instalace — reverzibilní. Provedl autor elevovaným shellem. |
| 2026-08-14 | `tests/boundaries.test.ts` má 8 případů místo jednoho | Zadání žádá jen import Pixi v `src/sim/`. Doplněny import z `render/`, DOM globály, `Math.random`, `Date.now`, `new Date` a **dva kontrolní případy mimo `sim/`** — bez nich by test procházel i při pravidle, které zakazuje všechno všude. |
| 2026-08-14 | Tik je funkce `tickWorld(world, systems)`, ne metoda `world.tick()` | Pseudokód architektury §5 píše `world.tick()`, ale `WorldState` má zároveň pole `tick: number` — nešlo by mít obojí. `WorldState` navíc zůstává čistá serializovatelná data, což ocení T8 (save). |
| 2026-08-14 | `WorldState` má navíc pole `dirty: DirtySet` | Architektura §4 ho nevyjmenovává, ale `System.run(world)` (§5) nemá jiný kanál, kterým by změnu ohlásil rendereru. Runtime-only — do savu nepatří, po loadu se stejně kreslí všechno. |
| 2026-08-14 | `Command` union je kompletní podle §5, ale implementován jen `set_speed` | Ostatní příkazy patří do T3/T5/T7. Větve ve switchi existují prázdné s uvedením úkolu, takže je typový systém nedovolí přehlédnout a zároveň nevzniká logika „do zásoby". |
| 2026-08-14 | `set_speed.speed` je index do `SPEEDS` (0–4), ne násobitel | T3 mapuje rychlost na klávesy 0–4. Kdyby to byl násobitel, existovaly by dvě reprezentace téhož. Hodnota mimo rozsah se ignoruje — hlásit ji zatím není komu. |
| 2026-08-14 | `world.tick` se inkrementuje **před** během systémů | Systém tak vidí číslo právě probíhajícího tiku a po N voláních platí `world.tick === N`. Fázování z §5 (`interval 12, offset 2` → tiky 2, 14, 26) tím sedí. |
| 2026-08-14 | Determinismus test registruje vlastní testovací systém | Ostré systémy jsou v T1 prázdné, takže test se samotnými `DEFAULT_SYSTEMS` by porovnával dvě netknuté mapy a prošel by i s úplně rozbitým RNG. Testovací systém mapu přepisuje přes `world.rng`. |
| 2026-08-14 | `hashLayers` hashuje i jména vrstev a rozkládá bajty ručně | Jméno v hashi znamená, že přejmenování nebo přeházení pořadí vrstev změní hash (žádoucí signál v golden testech). Ruční rozklad podle `BYTES_PER_ELEMENT` místo pohledu na buffer drží hash nezávislý na endianitě stroje. |
| 2026-08-18 | **Difuze ořezává dolů, ne zaokrouhluje** | Se zaokrouhlováním je hodnota 1 pevným bodem — `round(1 × 0,94)` je zase 1 — takže by mapa navždy zůstala pokrytá slabým znečištěním bez zdroje. Odhalil to test „bez zdroje odezní". Cena: velmi slabé znečištění zmizí úplně místo aby se drželo na jedničce, což je spíš žádoucí. |
| 2026-08-18 | **Overlay hrubých vrstev je vlastní vrstva, ne součást chunků** | Znečištění je konstantní přes blok 4×4, ale zapečené do chunků se kreslilo po dlaždicích — šestnáctkrát víc polygonů za stejný obrázek. Změřeno: překreslení po každé difuzi stálo **33,3 ms**, tedy dva zahozené snímky každých 250 ms při 8×. Jako samostatná vrstva s jedním čtyřúhelníkem na buňku to stojí **0,9 ms**. Elektřina zůstává v chuncích, protože je to veličina po dlaždicích. |
| 2026-08-18 | Difuzní a odpadové konstanty zatím žijí v kódu | Zadání je chce v `balance.json`, ale ten je úkol T15. Do té doby jsou v `pollution.ts` v jednom bloku s poznámkou. Konstanty odpadu jsem musel zvolit sám — ukázkový `balance.json` v zadání sekci `waste` nemá, takže v T15 přibude. |
| 2026-08-18 | Load savu verze 1 vynuluje hrubé vrstvy | Save v1 je nenese a systémy si je do pár tiků dopočítají. Ukládat je začne formát verze 2 v T20. |
| 2026-08-18 | **Populace bez zdravotní péče klesá jen na polovinu kapacity, ne na nulu** | Zadání říká „bez pokrytí populace v budovách pomalu klesá", ale bez podlahy město bez kliniky vymřelo úplně — a protože na začátku hry žádná klinika nestojí, byl by to nevyhnutelný konec. Odhalil to test savu, kterému po 600 ticích vyšla nulová populace. Zdravotnictví je tak pobídka k růstu, ne past. **Doplněk zadání, ke schválení.** |
| 2026-08-18 | Odpad má vlastní sekci `waste` s kapacitou, ne `service` s dosahem | Podle §6 odpady pokrytí nemají — kapacita se sčítá celoměstsky. Skládka je levná, pobere málo a silně znečišťuje své okolí; spalovna je drahá, pobere trojnásobek a znečišťuje méně. Prostorový kompromis bez nové vrstvy. |
| 2026-08-18 | Rozpis údržby ukazuje **skutečnou** částku za kus, ne tu z definice | U služeb ji škáluje financování, takže rozpis tvrdil „1 × 120 = 60". Odhalilo se to až na obrazovce, ne v testu. Stejnou opravou zmizela i hláška „mimo provoz (bez proudu)" u služeb, kterých se proud netýká. |
| 2026-08-18 | **Hloubka budovy se řídí předním rohem půdorysu, ne počátkem** | Podle `x + y` se jednodlaždicový obchod dostal před dvoudlaždicovou továrnu, která sahá o dvě dlaždice dál dopředu. Autor to nahlásil ze screenshotu. Nově `(x + w) + (y + h)`. |
| 2026-08-18 | **Příkazy vracejí `CommandResult`, ne `void`** | Hra nesmí mlčet: klik, který nic neudělá, musí říct proč. Důvod je lokalizační klíč, takže v `sim/` pořád není ani jedno uživatelsky viditelné slovo (§10). Růstový systém důvody ignoruje — zkusí příště jiné místo. |
| 2026-08-18 | Stejné hlášky se v bublinách nehromadí, jen si přičtou počet | Malování silnice přes vodu by jinak vysypalo padesát bublin přes celou obrazovku. |
| 2026-08-18 | `error.occupied` rozděleno na dva klíče | Jeden klíč sloužil silnici (bez parametrů) i půdorysu budovy (s `{width} × {depth}`), takže se hráči u silnice vypsaly složené závorky. Odhalilo se to až v běžící hře, ne v testech — proto teď existuje test, který hlídá, že se hláška se zástupným symbolem nikdy neodmítá bez parametrů. |
| 2026-08-18 | Detail budovy je na pravém tlačítku, bourání jen na nástroji | T3 dalo bourání na pravé tlačítko, ale autor si vyžádal na něm info o budově. Bourání zůstává jako nástroj pod `X` a v paletě. |
| 2026-08-18 | **Daň se zaokrouhluje jednou za řádek rozpočtu, ne u každé budovy** | Vyplynulo z požadavku ukázat rozpis: při zaokrouhlování po budovách vycházelo třem domům 66, ale rozpis by tvrdil `24 × 40 × 7 % = 67`. Buď rozpis lže, nebo se zaokrouhluje jinak — vybráno druhé. Cena: podíl jedné budovy v jejím detailu se od řádku může lišit o jednotky, což je v komentáři funkce napsané. |
| 2026-08-18 | `BudgetLine` nese i vstupy, nejen výsledky | Základ daně, sazba, údržba za kus a počet platících budov. UI si tak nic nedopočítává a rozpis nemůže tvrdit něco jiného než sloupec vedle. |
| 2026-08-18 | Rozpočet i tabulka počítají jednou funkcí `computeBudget` | Kdyby si UI daně dopočítávalo samo, výpis a skutečnost by se dřív nebo později rozešly. |
| 2026-08-18 | **Chunk je retained `Graphics`, ne `RenderTexture`** — odchylka od §6 | Izometrické diamanty se zaklesávají, takže opsaný obdélník chunku měl 1024×512 px a 64 chunků zabralo 128 MB VRAM, z toho polovina průhledné plochy. `Graphics` se do GPU nahraje jednou a mezi překreslením se jen vykresluje, takže výkonový důvod chunkování platí dál — změřeno 0,1 ms na snímek při plném oddálení. Chunkování ani dirty tracking se neruší, mění se jen nosič. |
| 2026-08-18 | **Budova bez proudu nedaní, ale ani nestojí údržbu** | První pokus nechal temným budovám údržbu. V běžící hře se ukázalo, že to vytváří past bez východiska: město bez elektrárny mělo nulový příjem a nenulové výdaje, spadlo z 20 000 na −33 325 a pak už na elektrárnu nikdy nevydělalo. Temná budova je proto mimo provoz úplně. |
| 2026-08-18 | Poptávku sytí i budovy bez proudu | Kdyby nefunkční továrna poptávku po průmyslu nesnižovala, hráč by vedle ní stavěl další a další, všechny stejně temné. Poptávka počítá s tím, co ve městě stojí; proud rozhoduje o penězích, ne o urbanismu. |
| 2026-08-18 | Kvádr budovy je o 0,12 dlaždice menší než půdorys | Bez odsazení splynuly sousedící domy 1×1 v jeden hřeben a nešlo poznat, kde končí jedna budova. Nula vrátí původní chování. |
| 2026-08-18 | Cena bubliny se čte z rozdílu v kase, ne z definice | Bublina tak vyskočí u čehokoli, co kdy začne stát peníze, aniž by se do UI muselo sahat. Dnes stojí peníze jen ruční stavba; silnice a zóny jsou zdarma. |
| 2026-08-18 | Tlačítka HUDu po kliknutí vracejí fokus | Jinak mezerník mačkal naposledy kliknuté tlačítko místo panování mapou. Mezerník se navíc vyhodnocuje před kontrolou, jestli událost přišla z HUDu. |
| 2026-08-18 | **Texty UI jsou v locale souborech obsahu, ne v samostatných souborech hry** | §10 říká, že mody a DLC přidávají vlastní locale soubory, které se slévají do stejného registru. Kdyby měla hra vlastní kanál pro `ui.*` klíče, existovaly by dvě cesty k témuž a mod by nemohl přepsat text hry. Takhle je cesta jedna a pozdější zdroj smí text přepsat. |
| 2026-08-18 | Popisek nástroje infrastruktury je `name` z definice | Tlačítko tak pojmenuje obsah, ne kód. Přidání budovy do JSONu rovnou přidá tlačítko s překladem, bez zásahu do UI. |
| 2026-08-18 | Chybějící klíč se vypíše jako sám sebe | §10 to vyžaduje a je to záměr: prázdný text nebo tichý fallback na jiný jazyk by se v testování přehlédl, `ui.hud.funds` uprostřed panelu ne. |
| 2026-08-18 | Ladicí výpis zůstal, ale skrytý pod F3 a mimo lokalizaci | Je to vývojářský nástroj, ne herní UI — `fps`, `tick`, `zoom`. Kdyby šel přes `t()`, mísily by se v locale souborech texty pro hráče s texty pro vývojáře. |
| 2026-08-18 | Ukládání do souboru je dvě funkce nad DOM API, ne implementace `Platform` z §9 | `Platform` má smysl s Electronem a Steamem, tedy fáze 4. Vyrobit ho teď by znamenalo rozhraní s metodami na achievementy a Workshop, které nikdo nevolá — přesně ten kód do zásoby, který zadání zakazuje. |
| 2026-08-18 | Popisek a hodnota data mají oddělené klíče | `ui.hud.date` je celá věta s parametry; jako popisek se vypsala i se zástupnými symboly (`rok {year}, měsíc {month}`). Odhalil to až první screenshot HUDu. Popisek je proto `ui.hud.dateLabel`. |
| 2026-08-18 | **`createSimHost` bere svět zvenčí, ne seed** | Save potřebuje zapisovatelný `WorldState`. Kdyby ho vlastnil host, musel by mít metody `save`/`load` a `sim/` by tím začal záviset na formátu savu — obrácený směr, než jaký architektura chce. Teď svět vlastní `app.ts`, dá ho hostovi i save vrstvě a `sim/` o savech neví. |
| 2026-08-18 | Load **mutuje existující svět**, nevytváří nový | Renderer i UI drží `getSnapshot()` jako živý pohled (rozhodnutí z T2), takže výměna objektu by jim nechala zastaralou referenci a mapa by po loadu zamrzla. Vrstvy se přepíšou na místě, mapa budov se vyprázdní a naplní. |
| 2026-08-18 | `seed` se při loadu přepisuje přes cílený cast | `readonly seed` v §4 je pojistka proti nechtěnému přepsání za běhu. Load je ta jediná legitimní výjimka — ze světa se stává jiné město — a je označená komentářem přímo na místě. |
| 2026-08-18 | Čas se do savu předává zvenčí | `createdAt`, `modifiedAt` a `playtimeSeconds` jsou parametry, ne `Date.now()` uvnitř. Save vrstva tak zůstává čistá funkce a fixtury mají přibité hodnoty. |
| 2026-08-18 | Vrstvy se zapisují explicitně little-endian přes `DataView` | Pohled na buffer typed array by převzal endianitu stroje a save z ARMu by se jinde načetl jako šum. Ověřeno testem s `buildingId = 4242`. |
| 2026-08-18 | `SAVE_LAYER_ORDER` je vlastní seznam, ne `LAYER_ORDER` ze `sim/layers.ts` | Hashovací pořadí se smí kdykoli změnit, formát savu ne — kdyby save sdílel jedno pole s hashováním, jedna nevinná úprava by rozbila savy potichu. Test hlídá, že oba seznamy pokrývají stejnou sadu vrstev, takže nová vrstva nemůže v savu chybět. |
| 2026-08-18 | Fixtura savu je base64, ne binárka | Testy nemají typy pro `fs` (`@types/node` není mezi závislostmi a nechtěl jsem přidávat závislost bez odsouhlasení). Base64 se načte přes `import.meta.glob` s `?raw` a dekóduje `atob`. |
| 2026-08-18 | Migrace se testují falešným řetězem | `formatVersion` je 1 a nic staršího neexistuje, takže skutečná migrace by byla vymyšlená. `migrate` proto bere seznam migrací jako parametr a test mu podstrčí řetěz 1→2→3. Ověřuje se i to, že migrace, která verzi nezvýší, skončí chybou místo nekonečné smyčky. |
| 2026-08-18 | Rychlý save drží jen v paměti | Soubory a IndexedDB jsou podle §9 věc platform vrstvy, která patří do fáze 4. F5/F9 stačí na to, aby šel round-trip ověřit v běžící hře. |
| 2026-08-18 | Poptávka stojí na jedné myšlence: lidé chtějí práci a práce chce lidi | Obytná poptávka = základ + (místa − pracující), průmyslová = (pracující − místa), komerční = (lidé × koeficient − obchody). Z toho vyjde celá smyčka §13 sama, bez tabulek a bez zvláštních případů. Základ u obytné musí být kladný, jinak by na prázdné mapě nebyla poptávka po ničem a nic by nikdy nevyrostlo. |
| 2026-08-18 | Růst je podmíněný kladnou poptávkou | Tohle je ta vazba, kvůli které §13 funguje: průmyslová zóna zůstane prázdná, dokud nejsou lidé bez práce. Bez ní by se stavělo všude naráz a kroky 4–5 by neměly smysl. |
| 2026-08-18 | Bankrot = záporná kasa zastaví růst; žádný nový stav | Důsledek se dá odvodit z `funds < 0`, takže není potřeba flag, který by se musel ukládat a udržovat konzistentní. Hráč to vyřeší zvýšením daní nebo bouráním. |
| 2026-08-18 | Daň se počítá z populace u obytných budov a z pracovních míst u ostatních | Je to jediný údaj, který budova opravdu drží. Infrastruktura se nedaní (nemá ani populaci, ani smysl ji danit), ale svou údržbu platí — proto je elektrárna trvalá zátěž rozpočtu. |
| 2026-08-18 | **Elektřina do rozpočtu nezasahuje — koriguje to, co jsem psal u T6** | U T6 jsem tvrdil, že v T7 přestane budova bez proudu platit daně. Při psaní T7 se ukázalo, že to §13 neumožňuje: daně jsou krok 6, elektrárna krok 7, takže kdyby daně vyžadovaly proud, město by nikdy nevydělalo první korunu. `powered` tak zůstává jen vizuální a jeho herní důsledek je otázka pro T10. |
| 2026-08-18 | Startovní kapitál 20 000, sazba 7 % v rozsahu 0–20, hodnota jednotky 40 | Provizorní balanc, ne výsledek ladění. Vybráno tak, aby vyšla elektrárna za 4 000 a aby malé město bylo mírně v plusu. Ladit se to má v T10. |
| 2026-08-18 | Cenu platí jen ruční stavba, růst ze zóny je zdarma | Odpovídá SimCity: hráč platí infrastrukturu, ne domy, které si postaví lidé. Silnice zatím taky nic nestojí — nejsou to definice obsahu, takže by cena musela být konstanta v kódu. |
| 2026-08-18 | Sazby se mění klávesami `,` a `.` u vybrané zóny | Provizorní ovládání, aby šlo T7 vyzkoušet. Skutečný panel s posuvníky je T9. |
| 2026-08-18 | **Vodičem je silnice a budova, samostatné elektrické vedení nevzniklo** | Architektura §4 vrstvu pro vedení nemá a §6 ho mezi kreslenými prvky nezmiňuje — přidat ho by znamenalo novou vrstvu, nový nástroj a nové auto-tiling pravidlo, tedy práci mimo zadání T6. Proud tak teče po silnicích, což je model, který stačí na smyčku §13. |
| 2026-08-18 | Kapacita se rozdává vzestupně podle `id` | Musí to být deterministické (P2) a „starší budovy mají přednost" je pravidlo, které jde hráči vysvětlit. Alternativa podle vzdálenosti od elektrárny by byla dražší a stejně arbitrární. |
| 2026-08-18 | `requiresPower` teď kód respektuje a vanilla R/C/I ho má `false` | V T5 kód ten flag ignoroval, takže data tvrdila něco, co se nedělo. Teď rozhoduje obsah: §13 chce, aby město rostlo dřív než elektrárna (krok 3 je dům, krok 7 elektrárna), takže R/C/I proud k vyrůstání nepotřebují. Kdo chce růst podmíněný proudem, přepne jeden údaj v JSONu, ne v kódu. |
| 2026-08-18 | `place_building` implementován v T6, i když ho zadání nezmiňuje | Elektrárna je kategorie `utility` a ze zóny nevyroste — bez ručního příkazu by ji nešlo postavit a T6 by nebylo jak ověřit. |
| 2026-08-18 | `createSimHost` bere katalog obsahu | `place_building` musí validovat proti definici a validace patří do simulace (§5), ne do UI. Katalog už předtím potřebovaly dva systémy, takže je to jen dotažení téhož. |
| 2026-08-18 | Nástroj infrastruktury je řízen obsahem, ne jménem budovy | Klávesa U vybírá z `byCategory('utility')` a opakovaný stisk cykluje. V rendereru tak není jméno ani jedné budovy (P5). Skutečný toolbar přijde v T9. |
| 2026-08-18 | Overlay elektřiny se zapéká do chunků | Přepnutí překreslí všech 64 chunků, ale je to reakce na stisk klávesy, ne věc snímku — a znovu se tím využije existující dirty mechanika místo nové vrstvy grafiky. |
| 2026-08-18 | **Výška kvádru je `level × heightLevels × LEVEL_H`, ne `level × LEVEL_H`** | §6 uvádí `building.level * LEVEL_H`, ale úrovně budov jsou podle §14 až fáze 2, takže `level` je zatím vždy 1 — všechno by bylo 16 px vysoké a `graphics.heightLevels` z §7 by nemělo žádný efekt. Elektrárna s `heightLevels: 2` by byla stejně vysoká jako domek. Pro `level = 1` se vzorec redukuje na `heightLevels × LEVEL_H`. **Odchylka od §6 — ke schválení.** |
| 2026-08-18 | Registr systémů je funkce `createDefaultSystems(catalogue)`, ne konstanta | Růst potřebuje obsah, ale `System.run(world)` má pevnou signaturu z T1. Systém si katalog uzavře do closure, takže se nemusel rozšiřovat ani `WorldState`, ani rozhraní systému. Vedlejší efekt: `createSimHost` teď systémy vyžaduje explicitně, což je lepší než tichý default. |
| 2026-08-18 | Simulace čte obsah přes úzké `BuildingCatalogue`, ne přes celý registr | `sim/` tak nezávisí na tom, jak se obsah načítá, a testy mu podstrčí atrapu o třech řádcích. `ContentRegistry` rozhraní splňuje strukturálně, bez deklarace `implements`. |
| 2026-08-18 | Budovy se nezapékají do chunků | Přesahují dlaždici do výšky i do stran a na hranici chunku by se ořezávaly. Každá je vlastní `Graphics` v kontejneru nad terénem, řazená podle `x + y`. |
| 2026-08-18 | Úroveň budov zůstává 1 a stavba nic nekostuje | Úrovně jsou podle §14 fáze 2, rozpočet je T7. Do té doby by odečítání peněz nemělo z čeho brát. |
| 2026-08-18 | `requiresPower` se při růstu ignoruje | Elektřina je T6 a vrstva `power` je zatím všude 0 — kdyby se podmínka respektovala, nevyrostlo by nic a smyčka §13 by nešla ověřit. |
| 2026-08-18 | Obyvatelé přicházejí s domem naráz | Postupné zabydlování je hezčí, ale zadání T5 chce agregovanou populaci, ne animaci. Budova vzniká s `population` = kapacita z definice. |
| 2026-08-18 | Malování tažením (nahrazuje rozhodnutí z T3) | V T3 jsem nechal stavbu na klik, protože to zadání T3 říká. U zón je to ale nepoužitelné — vyznačit čtvrť po jedné dlaždici nikdo nechce. Tažení teď platí pro silnice, zóny i bourání. |
| 2026-08-18 | Bourání budovy nechává zónu | Stejné chování jako v SimCity: na uvolněné parcele může vyrůst něco nového. Kdo chce zónu zrušit, klikne podruhé. |
| 2026-08-18 | `removeBuilding` hledá footprint průchodem celou vrstvou | Entita svou velikost nenese (§4) a bez definice ji nelze odvodit. Bourání je akce hráče, ne věc tiku, takže 16 384 porovnání nikoho nebolí. Kdyby to začalo vadit, přidá se footprint do entity. |
| 2026-08-18 | **`id` v manifestu je prostý namespace bez dvojtečky** (`vanilla`, ne `zdendas:industry`) | Architektura si odporuje: §7 má v příkladu `"id": "vanilla"`, §8 uvádí mezi zdroji savu `"id": "zdendas:industry"`. Definice mají podle P6 tvar `namespace:identifier`, takže manifest s dvojtečkou by dal `zdendas:industry:castle` — dvě dvojtečky a rozbitý tvar P6. Autor rozhodl použít výhodnější variantu a držet se jí. Každá definice musí začínat `<manifest.id>:`. |
| 2026-08-18 | Schéma je ruční validátor, ne knihovna | Nová závislost jde jen po odsouhlasení a `schema.ts` je v architektuře §11 stejně určený. Rozsah kontrol je malý, takže se to vejde do jednoho souboru bez ajv a spol. |
| 2026-08-18 | `ContentSource` jsou čistá data, čtení souborů je mimo registr | Registr tak nezávisí na tom, jestli obsah přišel z buildu, z disku, ze ZIPu modu nebo z Workshopu. Vanilla používá `import.meta.glob`, ale žádnou privilegovanou cestu nemá (P5) — jen jinou implementaci téhož rozhraní. |
| 2026-08-18 | Načtení zdroje je všechno, nebo nic | Částečně načtený mod je horší než nenačtený: chyba by vyplavala až po hodině hraní, když hráč sáhne po chybějící budově. Registr proto při jakémkoli problému nezaregistruje ani validní sourozence. |
| 2026-08-18 | Neznámá sekce v definici je chyba | Překlep typu `construcion` by se jinak tiše ignoroval a budova by se chovala divně bez zjevné příčiny. Cena: DLC nesmí přidat sekci, kterou starší verze hry nezná. |
| 2026-08-18 | `category` je volný řetězec, ne výčet | Výčet kategorií v kódu by byl obsah v kódu (P5). Validuje se jen tvar, ne konkrétní hodnoty. |
| 2026-08-18 | Lokalizační klíč musí mít překlad aspoň v jednom jazyce zdroje | §10 říká, že chybějící překlad padá na angličtinu a pak na samotný klíč — takže chybějící čeština chyba není. Klíč bez jediného překladu ale skoro jistě znamená překlep, a ten se vyplatí chytit hned. |
| 2026-08-18 | `locale/cs.json` a `en.json` vznikly, i když i18n je až T9 | Bez nich by lokalizační klíče v definicích neukazovaly nikam a validace klíčů by neměla co kontrolovat. Jde o data, ne o kód do zásoby — T9 je jen napojí na `t()`. |
| 2026-08-18 | Duplicitní `id` je chyba, ne přepis | Přepisování obsahu mezi mody patří k fázi 3. Do té doby je hlasitá chyba lepší než tiché vítězství posledního načteného. |
| 2026-08-18 | **Pravé tlačítko bourá, panuje se prostředním nebo mezerníkem + levým** | T2 dalo panování i na pravé tlačítko, ale T3 přiřazuje pravému tlačítku bourání. Panování zůstalo na prostředním a na mezerníku s levým, jak zadání T2 také připouští. |
| 2026-08-18 | Silnice se staví klikem, ne tažením | Zadání T3 mluví o kliknutí. Malování tažením je v city builderech obvyklé, ale je to funkce navíc, kterou zadání nechce — snadno se doplní později. |
| 2026-08-18 | 16 variant silnic se skládá, nedeklaruje | Středový kus plus jedno rameno na každý připojený směr dá všech 16 kombinací bez tabulky, kterou by šlo překlepnout. Ramena sahají až na hranu diamantu, takže sousedé navazují bez mezery. |
| 2026-08-18 | Bourání v T3 odstraňuje jen silnici | Zóny a budovy zatím neexistují. Až vzniknou v T5, `bulldoze` se rozšíří. |
| 2026-08-18 | Rychlost si `app.ts` zrcadlí ve vlastní proměnné | `SimHost` rychlost nevystavuje a jeho rozhraní je dané architekturou §5. Kvůli jednomu řádku v ladicím výpisu nemá smysl přidávat pátou metodu — UI ví, jakou rychlost samo odeslalo. |
| 2026-08-18 | **Dlaždice mají tenkou hranu ve ztmavené barvě terénu** | Architektura §6 mluví jen o „diamantu vyplněném barvou". Jenže mapa je ve fázi 1 celá tráva, takže bez hran je to jednolitá zelená plocha, na které nejde poznat mřížka ani to, že panování funguje. Barva jde z palety (`TILE_EDGE_SHADE`), ne natvrdo. **Odchylka od §6 — ke schválení.** |
| 2026-08-18 | `RenderTexture` chunky mají `resolution: 1` natvrdo | Výchozí rozlišení se řídí `devicePixelRatio`; na HiDPI displeji by textury byly 4× větší, tedy 512 MB. Cena: při zoomu 4× na HiDPI bude terén lehce měkčí. |
| 2026-08-18 | `gridToScreen` vrací **horní vrchol** diamantu, ne jeho střed | Picking i kreslení chunků na té konvenci závisí, takže je zapsaná v komentáři funkce a ověřená testem. Střed dlaždice = vrchol + `TILE_H / 2`. |
| 2026-08-18 | Kamera nemá vlastní DOM listenery | Zadání T2 chce kameru jako čistý stav. Myš a klávesnici obsluhuje `app.ts` a volá do kamery jen `pan` / `zoomAt`. Díky tomu je celá kamera testovatelná bez prohlížeče. |
| 2026-08-18 | Ve vývojovém buildu je `globalThis.__city` | Bez něj nešlo renderer ověřit jinak než okem — v neviditelné záložce prohlížeč nespouští `requestAnimationFrame`, takže se nevykreslí nic. Přes tenhle handle jde vynutit snímek a změřit ho. Zabaleno v `import.meta.env.DEV`, v produkci se odstraní. |
| 2026-08-18 | `buildingRenderer.ts` nevznikl | Je ve stromu architektury §11, ale budovy přijdou až v T5. Prázdný soubor by byl kód do zásoby. |
| 2026-08-14 | `systems/zoning.ts` nevznikl | Strom v architektuře §11 ho zmiňuje, ale v tabulce systémů §5 nemá řádek — zónování je příkaz, ne tikající systém. Vznikne v T5, pokud se ukáže, že ho potřebuje. |

## Známé problémy / technický dluh

- **Katalog katastrof si u blackoutu odporuje.** Vzorec `max(0; 0,25 −
  rezerva) × 24` říká, že blackout je na stropu rizika už při rezervě pod
  ~21 %. Próza vedle něj tvrdí mírnější náběh („15 % → 1,24"), což odpovídá
  koeficientu ~2,4; žádný koeficient nedá zároveň obě čísla z prózy. Kód se
  řídí **vzorcem**, protože ten je normativní. Rozhodnutí patří autorovi — je
  to jedno číslo v `balance.json`.
- **Katastrofy se neukládají.** `world.disasters`, vrstvy `fire`, `fuel`,
  `fireFlags` a `rubble` jsou runtime stav; formát savu je pořád verze 5.
  Patří to do T59 (save v6) a do té doby se rozehraná pohroma načtením savu
  ztratí.
- **Vrstva `flood` neexistuje.** `floodArea()` v `effects.ts` je proto prázdná
  operace, která vrací nulu. Přidává ji T49; ostatní katastrofy na ni už
  odkazují, aby volání existovalo a nemuselo se čekat s prázdným `TODO`.
- **Past na jméno souboru `locale.py`.** Pomocný skript v adresáři, ze kterého
  se pouští Python, může zastínit modul ze standardní knihovny — Python dává
  adresář skriptu na začátek cesty k modulům. Konkrétně `locale.py` se
  importuje z `subprocess` a při každém spuštění jakéhokoli skriptu odtud se
  spustil a přepsal `content/vanilla/locale/*.json`. Projevilo se to jako
  „záhadně přeformátované locale soubory" a chvíli se to hledalo. Pomocné
  skripty nepojmenovávat jako moduly stdlib.

- **Z bankrotu není cesta zpátky.** Daně platí jen obyvatelé a pracovní místa
  v zónách; služby a infrastruktura nevydělávají nic. Město, které utratí vše
  na elektrárnu, vodárnu a kliniku dřív, než mu vyroste první dům, má příjem
  nula, údržbu pár set měsíčně a růst zastavený kvůli mínusu — a **nemá jak se
  z toho dostat**, protože bourání údržbu snižuje, ale peníze nepřidá. Narazil
  na to autor při hraní: kasa −1 066, nula obyvatel, 58 míst, bilance +0/−536.
  Hláška o bankrotu na to teď aspoň upozorní, ale řešení je rozhodnutí o
  designu — nabízí se vypnout službám údržbu, když na ně nejsou peníze
  (přestanou fungovat, ale nezadluží), nebo půjčka. Patří to k T41.

- **Kopec před budovou ji nezakryje.** Renderer kreslí nejdřív celý terén a pak
  všechny budovy, takže budova je vždycky nad terénem. Správně by se muselo
  řadit po dlaždicích dohromady s budovami, což by zrušilo smysl chunkování.
  Ve hře to jde vidět jen na strmém svahu s budovou hned za ním.
- **Overlay hrubé mřížky kopíruje terén jen po blocích 4×4.** Uvnitř bloku může
  terén stoupat jinak než rovina mezi jeho rohy. Šestnáctkrát víc polygonů za
  stejnou informaci nestojí za to — právě kvůli tomu ten overlay vznikl.
- `vite.config.ts` je mimo `tsc --noEmit` (viz tabulka rozhodnutí).
- **Save není bajtově reprodukovatelný, jen obsahově.** fflate zapisuje do ZIPu
  čas modifikace, takže dva savy z téhož stavu se liší v několika bajtech
  hlavičky. Obsah (`meta.json`, `layers.bin`, entity, stav) je stabilní, takže
  round-trip i fixtury fungují. Kdyby bylo potřeba bajtově identické savy —
  třeba na porovnávání v testech — fflate umí `mtime` předat.
- **`GAME_VERSION` v `save/format.ts` duplikuje `version` z `package.json`.**
  Hlídá to test, který obojí porovná, takže rozejít se to nemůže potichu.
  Načítat package.json v runtime kódu by ale bylo čistší.
- **Rychlý save se ztrácí s obnovením stránky.** Drží v proměnné, ne v IndexedDB.
  Skutečná persistence je platform vrstva (§9) a patří do fáze 4.
- **HUD při šířce okna kolem 280 px zabírá skoro celou plochu.** Panely se sice
  zalamují a nic nepřeteče, ale mapa pod nimi skoro není vidět. Na běžném okně
  (1100 px a víc) je to v pořádku. Kdyby měla hra běžet i v malém okně, chce to
  kompaktní režim — panely na ikony a poptávku jen jako tři proužky.
- **Město se dá pojmenovat jen v kódu.** Save ukládá `cityName: 'quicksave'`,
  protože dialog nové hry neexistuje. Formát na jméno připravený je.
- **Druhá elektrárna se dnes finančně nevyplatí.** Změřeno: s jednou byla
  bilance +1032/−755 (čistých 277), se dvěma +1222/−1070 (čistých 152).
  Rozsvícené budovy začnou platit údržbu a elektrárna má svých 200, takže
  se dosvícení zbytku města prodělá. Je to balanc, tedy věc T10 — nabízí se
  buď levnější provoz elektrárny, nebo vyšší daňový výnos.
- **Zóna musí být tak hluboká jako footprint budovy, a hráč to nepozná.**
  `industrial_small` má footprint 2×2, takže v jednořadé zóně nevyroste nic —
  narazil jsem na to sám při ověřování T7 a chvíli hledal chybu v kódu, která
  tam nebyla. Hra o tom mlčí. Nabízí se ukázat při zónování obrys toho, co se
  tam vejde, nebo nechat vyrůst menší budovu. Patří to k T9 nebo T10.
- **`requiresPower` a `power.consumption` se překrývají.** `requiresPower` říká
  „bez proudu nevyrostu", `consumption > 0` říká „beru proud". Zatím to jsou dva
  nezávislé údaje a nic nebrání nesmyslné kombinaci (vyžaduje proud, ale nic
  nespotřebovává). Až bude jasné, jak se má chovat budova bez proudu, jeden
  z nich pravděpodobně zmizí.
- **Konstanty fáze 1 zůstávají v kódu.** `balance.json` je podle zadání balanc
  fáze 2, takže hodnota daňové jednotky, startovní kapitál, váhy poptávky
  a podíl pracujících jsou pořád v `demand.ts`, `economy.ts` a `world.ts`.
  Podíl pracujících navíc existuje na dvou místech — v `demand.ts` a v `crime.ts`,
  kde musí sedět. Sjednotit by to chtělo, až se bude ladit balanc fáze 1.
- **Kriminalita zatím nepočítá s opuštěnými budovami** — ty vznikají až v T17.
- **Na mapě není ani kapka vody, takže bonus vody nemá kde platit.** Zadání
  fáze 2 s ním počítá jako s jediným vstupem nezávislým na hráči, „aby mapa
  nebyla homogenní ještě než hráč cokoli postaví" — jenže fáze 1 žádný generátor
  terénu nepostavila a mapa je stoprocentně tráva. Mechanismus je hotový
  a otestovaný (test si vodu do mapy dokreslí), ale ve hře se neprojeví.
  **Generátor mapy není v žádném úkolu fáze 2** — rozhodnutí patří autorovi.
- **Cena půdy dnes nepřekročí 65** (základ 40 + bonus vody 25), a bez vody 40.
  Prahy úrovní budov začínají na 90, takže dokud služby nezačnou do vzorce
  přispívat (T13–T14), nic se nepovýší. Pořadí úkolů to řeší — T16 přijde až
  po nich — ale **při T13 se nesmí zapomenout přidat pokrytí do vzorce ceny půdy**.
- **Co dnes rozhoduje o vzniku budovy** (odpověď na dotaz autora, podklad pro fázi 2):
  nezáporná kasa → systém běží 1× za 12 tiků a udělá 4 pokusy → každý pokus má
  40% šanci → náhodná volná zónovaná dlaždice, rovnoměrně → poptávka kategorie
  musí být kladná → náhodná definice z kategorie → půdorys volný, povolený terén,
  sousedící silnice. **Nic jiného vliv nemá.** Z toho plynou tři slabiny:
  - **Poptávka je vypínač, ne váha.** Poptávka 1 a 100 stavějí stejně rychle.
  - **Daně na růst nemají vliv vůbec.** Chybí vazba „vysoké daně odrazují".
  - **Silnice se vyhodnocuje jako přímé sousedství**, ne dosah. Dlaždice o dvě
    pole dál je nedosažitelná napořád, a co hůř: takové dlaždice pořád padají
    do losu, takže velká zóna daleko od silnic zpomaluje růst i tam, kde stavět jde.
- **Zóna mělčí než půdorys budovy pořád mlčí.** Rámeček řeší ruční stavbu, ale
  u zóny hráč nevidí, že se do ní zvolená budova nikdy nevejde. Zbývá z původní
  dvojice problémů.
- Starý Node 20.11.1 zůstal nainstalovaný v `C:\Program Files\nodejs\`, jen už není
  v PATH. Reinstalace Node.js z MSI by ho tam vrátila a konflikt by se obnovil —
  příznaky a oprava v `docs/SETUP.md`.
- Během T1 se tenhle konflikt reálně projevil: session Claude Code běžela od doby
  před opravou PATH, měla ho tedy zděděný a `npm test` spadl na
  `node:util does not provide an export named 'styleText'` (vitest 4 vyžaduje
  Node ≥ 20.12). Registr je v pořádku, stačí **restart terminálu / Claude Code**.
  Jednorázová objížďka bez restartu:
  `$env:PATH = "C:\Users\Intel\scoop\apps\nodejs-lts\current;$env:PATH"`.
