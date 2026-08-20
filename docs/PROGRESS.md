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

## Rozpracované
_(3a hotová. Dál fáze 3b: T29 a výš — převýšení terénu.)_

## Backlog
- [ ] T5 — zóny, růst budov, populace
- [ ] T6 — elektřina
- [ ] T7 — RCI poptávka, daně, rozpočet
- [ ] T8 — save/load, migrace, fixtury
- [ ] T9 — HUD, toolbar, i18n
- [ ] T10 — vyhodnocení zábavnosti smyčky (rozhodovací bod, ne technický úkol)

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
