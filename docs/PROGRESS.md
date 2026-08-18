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

## Rozpracované
_(nic — T8 uzavřeno)_

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
- **Debug overlay má dvanáct řádků** a na malém okně zabírá půl obrazovky.
  Nahradí ho HUD v T9.
- **Elektřina zatím nemá herní důsledek, jen vizuální.** `building.powered` se
  správně počítá, ale nic se podle něj neděje. V T6 jsem čekal, že to vyřeší T7
  přes daně — nejde to, protože §13 řadí daně (krok 6) před elektrárnu (krok 7),
  takže město by nikdy nevydělalo první korunu. **Je to otázka na T10:** má být
  budova bez proudu bez daní, bez růstu, nebo má chátrat?
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
- **Sousedící domy 1×1 splývají v jeden hřeben.** Kvádr zabírá přesně svůj
  footprint, takže dvě budovy vedle sebe nemají mezi sebou mezeru a řada domů
  vypadá jako dlouhá hradba. V SimCity 2000 se bloky slévají podobně, takže to
  nemusí být vada — ale kdyby to vadilo, stačí kreslit kvádr o pár pixelů
  zmenšený proti footprintu. Je to jeden řádek v `buildingRenderer.ts` a čeká
  na rozhodnutí autora.
- **Chunkované `RenderTexture` stojí 128 MB VRAM.** Změřeno v běžícím rendereru,
  ne odhadnuto: 64 chunků × 1024×512 px × 4 B. Izometrické diamanty se do sebe
  zaklesávají, takže opsaný obdélník chunku je zhruba dvakrát větší než plocha,
  kterou dlaždice reálně pokryjí — polovina každé textury je průhledná.
  Architektura §6 chunkování do `RenderTexture` předepisuje, takže jsem to tak
  postavil, ale cena je vysoká. Možnosti, až to začne vadit: alokovat textury
  jen pro viditelné chunky, nebo svázat jejich rozlišení s maximálním zoomem.
  **Rozhodnutí patří autorovi.**
- Starý Node 20.11.1 zůstal nainstalovaný v `C:\Program Files\nodejs\`, jen už není
  v PATH. Reinstalace Node.js z MSI by ho tam vrátila a konflikt by se obnovil —
  příznaky a oprava v `docs/SETUP.md`.
- Během T1 se tenhle konflikt reálně projevil: session Claude Code běžela od doby
  před opravou PATH, měla ho tedy zděděný a `npm test` spadl na
  `node:util does not provide an export named 'styleText'` (vitest 4 vyžaduje
  Node ≥ 20.12). Registr je v pořádku, stačí **restart terminálu / Claude Code**.
  Jednorázová objížďka bez restartu:
  `$env:PATH = "C:\Users\Intel\scoop\apps\nodejs-lts\current;$env:PATH"`.
