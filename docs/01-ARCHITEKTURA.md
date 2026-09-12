# City Builder — Architektonická specifikace

**Verze dokumentu:** 1.0
**Status:** závazné. Odchylka od pravidel v sekci 2 vyžaduje explicitní souhlas autora projektu.

Tento dokument popisuje **co se staví a jaká pravidla platí**. Neobsahuje postup scaffoldingu — ten je v `02-BOOTSTRAP-CLAUDE-CODE.md`.

---

## 1. Cíl projektu

Izometrický city builder ve stylu SimCity 2000. Singleplayer, offline-first.

**Stack:** TypeScript + PixiJS 8 + Vite. UI v HTML/CSS. Desktop distribuce přes Electron (fáze 4), webová verze jako demo.

**Dlouhodobé požadavky, které ovlivňují architekturu už teď:**

- Prodej na Steamu, později případně GOG
- DLC jako samostatně distribuovaný obsah
- Mody (Steam Workshop) — data a assety, ne skripty
- Savy kompatibilní napříč verzemi hry po dobu let
- Lokalizace do libovolného počtu jazyků

**Co se explicitně neřeší:** multiplayer, mobilní platformy, konzole, vlastní backend.

---

## 2. Nepřekročitelná pravidla

Těchto sedm pravidel je důvodem existence tohoto dokumentu. Porušení kteréhokoli z nich je později neopravitelné bez přepisu.

### P1 — Simulace nezná renderer

Kód v `src/sim/` **nesmí** importovat PixiJS, DOM API, Electron, ani nic z `src/render/`, `src/ui/`, `src/platform/`.

Vynuceno ESLintem (`no-restricted-imports`), ne dobrou vůlí. Porušení = selhaný build.

Důvod: simulace musí být testovatelná bez prohlížeče, přenositelná do Web Workeru a nezávislá na volbě renderovací knihovny.

### P2 — Simulace je deterministická

Stejný seed + stejná posloupnost vstupů = bit-identický výsledek.

Zakázáno v `src/sim/`: `Math.random()`, `Date.now()`, `performance.now()`, `new Date()`, iterace nad `Object.keys()` bez explicitního seřazení.

Povoleno: instance `Rng` předaná do `WorldState`.

Důvod: reprodukovatelné bugy, testovatelnost, budoucí replay a možnost odesílat bug reporty jako seed + input log.

### P3 — Grid je v gridových souřadnicích

Simulace pracuje výhradně s `x, y` jako celými čísly. Izometrická projekce existuje **pouze** v rendereru a v pickingu.

Nikde v `src/sim/` se nesmí objevit `screenX`, `screenY`, `TILE_WIDTH` ani nic podobného.

### P4 — Mřížková data jsou typed arrays

Vrstvy nad mapou (terén, zóna, elektřina, znečištění, cena půdy…) jsou `Uint8Array` / `Uint16Array` / `Uint32Array` o velikosti `SIZE * SIZE`, jedna vrstva na atribut.

**Zakázáno:** `Tile[]` s objekty, `Map<string, Tile>`, `tiles[x][y]`.

Důvod: při 128×128 = 16 384 dlaždic a difuzních průchodech několikrát za tick je objektový model o řád pomalejší a generuje GC tlak. Toto je nejčastější chyba v hobby city builderech.

Výjimka: **entity** (budovy) jsou objekty. Rozlišovací kritérium — *„je toho hodně a je to číslo na souřadnici"* → vrstva. *„je toho málo a má to identitu a životní cyklus"* → entita.

### P5 — V kódu není ani jedna budova

Veškerý herní obsah je data. Kód umí „budovy obecně", ne „uhelnou elektrárnu".

Vanilla obsah se načítá **stejným mechanismem** jako DLC a mody. Žádná privilegovaná cesta pro základní hru.

Důvod: pokud má vanilla obsah zkratku, modding vždycky skončí jako občan druhé kategorie a přidání DLC bude refaktor.

### P6 — Identifikátory jsou stringy s namespace

Formát: `namespace:identifier`, např. `vanilla:coal_power_plant`, `zdendas_pack:castle`.

**V savu se nikdy neukládají číselné indexy definic.** Load order modů se změní a savy se rozbijí.

### P7 — Save má verzi od prvního dne

`formatVersion` je v savu od commitu č. 1, i když je hra prototyp. Migrace se píší jako čisté funkce `vN → vN+1` s fixture savem v repozitáři.

---

## 3. Souřadnice a projekce

### Konstanty

```ts
export const TILE_W = 64;        // šířka izometrického diamantu v px
export const TILE_H = 32;        // výška diamantu (poměr 2:1)
export const LEVEL_H = 16;       // px na jednu výškovou úroveň terénu
export const MAP_SIZE = 128;     // fáze 1: 128×128
```

### Index vrstvy

```ts
const idx = y * MAP_SIZE + x;
```

Všechny vrstvy používají tento identický výpočet. Helper `index(x, y)` v `src/sim/layers.ts`.

### Grid → obrazovka (renderer)

```ts
screenX = (x - y) * TILE_W / 2;
screenY = (x + y) * TILE_H / 2 - elevation * LEVEL_H;
```

Řazení pro kreslení: vzestupně podle `x + y` (back-to-front).

### Obrazovka → grid (picking, plochý terén)

```ts
const a = screenX / (TILE_W / 2);   // = x - y
const b = screenY / (TILE_H / 2);   // = x + y
const x = Math.floor((a + b) / 2);
const y = Math.floor((b - a) / 2);
```

**Fáze 1 je plochá mapa** (`elevation` všude 0). Inverze pak platí přesně. Až přibude převýšení, tato funkce přestane stačit a picking se musí dělat testováním od předu dozadu — proto je izolovaná v `src/render/picking.ts` a nikdo jiný ji nepočítá inline.

---

## 4. Datový model

### WorldState

```ts
interface WorldState {
  readonly size: number;          // MAP_SIZE
  readonly seed: number;
  tick: number;                   // monotónní počítadlo od začátku hry

  layers: Layers;
  buildings: Map<number, Building>;   // klíč = buildingId
  nextBuildingId: number;

  economy: EconomyState;
  demand: DemandState;
  rng: Rng;
}
```

### Vrstvy — fáze 1

| Vrstva | Typ | Rozsah | Popis |
|---|---|---|---|
| `terrain` | Uint8Array | 0–3 | 0 = tráva, 1 = voda, 2 = písek, 3 = skála |
| `elevation` | Uint8Array | 0–15 | fáze 1 vždy 0 |
| `zone` | Uint8Array | 0–3 | 0 = žádná, 1 = R, 2 = C, 3 = I |
| `road` | Uint8Array | 0/1 | fáze 1 boolean, bitmask sousedů se počítá v rendereru |
| `buildingId` | Uint32Array | 0 = prázdno | ID budovy okupující dlaždici. Od verze savu 12; do té doby Uint16Array, což byl strop na všechny budovy za celou dobu města, protože id se nevrací |
| `power` | Uint8Array | 0/1 | výsledek flood fillu |

### Vrstvy — fáze 2 (rezervováno, zatím nealokovat)

`pollution`, `landValue`, `crime`, `trafficLoad`, `populationDensity` — všechny `Uint8Array` 0–255.

### Building (entita)

```ts
interface Building {
  id: number;                 // runtime ID, do savu se ukládá také
  definitionId: string;       // "vanilla:residential_small" — P6
  x: number;                  // levý horní roh footprintu
  y: number;
  level: number;              // 1..n, vizuální i ekonomická úroveň
  population: number;         // agregát, ne jednotlivci
  jobs: number;
  powered: boolean;
  builtAtTick: number;
}
```

**Obyvatelé nejsou entity.** Budova má `population: 83`, ne 83 objektů. Toto je zásadní pro výkon a nikdy se to nemění.

---

## 5. Simulační smyčka

### Časování

```ts
const TICK_MS = 250;                    // 1 tick při rychlosti 1×
const SPEEDS = [0, 1, 2, 4, 8];         // pauza, 1×, 2×, 4×, 8×
const MAX_TICKS_PER_FRAME = 8;          // ochrana proti spirále smrti
```

1 tick = 1 herní den. 30 tiků = měsíc (rozpočtová událost).

Akumulátorový vzorec:

```ts
accumulator += deltaMs * speedMultiplier;
let ticksThisFrame = 0;
while (accumulator >= TICK_MS && ticksThisFrame < MAX_TICKS_PER_FRAME) {
  world.tick();
  accumulator -= TICK_MS;
  ticksThisFrame++;
}
if (ticksThisFrame === MAX_TICKS_PER_FRAME) accumulator = 0;  // zahoď skluz
```

Render běží nezávisle na 60 FPS.

### Rozvrstvení systémů

**Nesmí běžet všechny systémy každý tick.** Každý systém má interval a fázový offset, aby drahé systémy nespadly do stejného snímku:

| Systém | Interval | Offset | Poznámka |
|---|---|---|---|
| `powerSystem` | 1 | 0 | flood fill, jen při dirty flagu sítě |
| `demandSystem` | 4 | 1 | přepočet RCI poptávky |
| `growthSystem` | 12 | 2 | růst/úpadek budov |
| `economySystem` | 30 | 0 | měsíční rozpočet |
| `pollutionSystem` (f2) | 8 | 3 | difuze |
| `landValueSystem` (f2) | 16 | 5 | difuze |

```ts
function shouldRun(tick: number, interval: number, offset: number): boolean {
  return (tick - offset) % interval === 0;
}
```

### Rozhraní simulace

Simulace je za fasádou s **message-based API už teď**, i když běží na main threadu. Až se přesune do Web Workeru, nemění se volající kód:

```ts
interface SimHost {
  dispatch(cmd: Command): void;      // hráčské akce
  step(deltaMs: number): void;
  getSnapshot(): ReadonlyWorldView;  // pro renderer a UI
  consumeDirty(): DirtySet;
}

type Command =
  | { type: 'build_road'; x: number; y: number }
  | { type: 'bulldoze'; x: number; y: number }
  | { type: 'zone'; x: number; y: number; w: number; h: number; zone: ZoneType }
  | { type: 'place_building'; definitionId: string; x: number; y: number }
  | { type: 'set_tax_rate'; zone: ZoneType; rate: number }
  | { type: 'set_speed'; speed: number };
```

Všechny hráčské akce jdou přes `dispatch`. Nikdy se nemodifikuje `WorldState` z UI nebo rendereru přímo.

---

## 6. Kontrakt rendereru

### Dirty tracking

Renderer **nepřekresluje celou mapu každý snímek.** Simulace zaznamenává změny:

```ts
interface DirtySet {
  tiles: Set<number>;        // indexy změněných dlaždic
  buildings: Set<number>;    // ID změněných budov
  fullRedraw: boolean;       // load savu, změna mapy
}
```

Renderer volá `consumeDirty()` jednou za snímek a překresluje jen dotčené chunky.

### Chunkování

Terén se renderuje do `RenderTexture` po chuncích **16×16 dlaždic**. Změna jedné dlaždice invaliduje jeden chunk, ne celou mapu.

### Grafika ve fázi 1

Žádné sprity, žádné textury, žádný Blender. Vše kreslené procedurálně přes `Pixi.Graphics`:

> **Tohle přestalo platit ve dvou krocích, oba rozhodl autor.**
>
> Od T60 mají obrázky **ikony v rozhraní** (`content/vanilla/icons/`).
> Od T70 je dostávají i **budovy na mapě**, každá ve třech variantách, ze
> kterých se při stavbě jedna vylosuje a zůstane — viz `06-SPRITY-SLUZEB.md`.
>
> **Terén a silnice zůstávají procedurální**, a to je pořád záměr: kreslí se
> po chuncích do `RenderTexture` a sprity by z toho udělaly atlas, který se
> na svazích stejně neskládá.
>
> Obojí jde přes `ContentSource`, aby to mod směl přidat i přepsat (P5), a
> obojí má **zálohu** — chybějící obrázek vykreslí polygon, respektive kvádr.
> Mod, který obrázky nedodá, hru nezastaví.


- Terén: izometrický diamant vyplněný barvou podle `terrain`
- Silnice: tmavý diamant, auto-tiling přes bitmask sousedů (N=1, E=2, S=4, W=8)
- Budovy: kvádr ze tří polygonů — horní plocha 100 % jasu, levá stěna 70 %, pravá 50 %
- Zóny: barevný overlay s alfa (R modrá, C zelená, I žlutá)

Výška kvádru = `building.level * LEVEL_H`. Barva podle kategorie z definice. Tímto je grafika kompletně vyřešená do fáze 3 a nestojí ani hodinu práce navíc.

---

## 7. Content registry

### Struktura zdroje obsahu

```
content/
  vanilla/
    manifest.json
    buildings/
      residential_small.json
      commercial_small.json
      industrial_small.json
      coal_power_plant.json
    locale/
      cs.json
      en.json
```

### manifest.json

```json
{
  "id": "vanilla",
  "name": "Base Game",
  "version": "0.1.0",
  "gameVersion": ">=0.1.0",
  "dependencies": []
}
```

### Definice budovy

```json
{
  "id": "vanilla:coal_power_plant",
  "type": "building",
  "category": "utility",
  "name": "building.coal_power_plant.name",
  "description": "building.coal_power_plant.desc",
  "footprint": [4, 4],
  "construction": {
    "cost": 4000,
    "requiresRoad": true,
    "requiresPower": false,
    "allowedTerrain": [0, 2]
  },
  "economy": {
    "upkeep": 200
  },
  "power": {
    "production": 6000
  },
  "environment": {
    "pollution": 30
  },
  "graphics": {
    "color": "#5a5a62",
    "heightLevels": 2
  }
}
```

**Vnořené sekce podle domény**, ne plochý seznam vlastností. Za tři roky jich budou desítky a plochá struktura se stane nečitelnou.

Pole `name` a `description` jsou **lokalizační klíče**, nikdy text. Viz P5 a sekce 10.

### Registry

```ts
interface ContentRegistry {
  load(source: ContentSource): Promise<void>;   // vanilla, DLC i mod stejnou cestou
  get(id: string): Definition | undefined;
  getAll(type: string): Definition[];
  getLoadedSources(): SourceInfo[];             // do meta.json savu
}
```

Validace definic při načtení proti JSON schématu. Nevalidní definice = chyba s uvedením zdroje, ne tichý pád.

---

## 8. Save

### Kontejner

Skutečný ZIP (knihovna `fflate`, funguje v Node i prohlížeči):

```
save.city (zip)
├── meta.json        # nekomprimované, čitelné bez načtení hry
├── layers.bin       # konkatenované typed arrays
├── entities.json    # budovy
└── state.json       # ekonomika, poptávka, tick, stav RNG
```

### meta.json

```json
{
  "formatVersion": 1,
  "gameVersion": "0.1.0",
  "city": { "name": "Nový Brod", "seed": 483928492 },
  "createdAt": "2026-08-14T10:00:00Z",
  "modifiedAt": "2026-08-14T12:30:00Z",
  "playtimeSeconds": 9000,
  "content": {
    "sources": [
      { "id": "vanilla", "version": "0.1.0" },
      { "id": "zdendas:industry", "version": "1.2.0" }
    ]
  },
  "preview": { "population": 12400, "funds": 38200, "tick": 3600 }
}
```

`meta.json` musí jít přečíst **bez načtení zbytku savu** — seznam uložených her v menu se tím vykresluje okamžitě.

Při načtení savu, který vyžaduje chybějící content source, se hráči zobrazí varování se seznamem. Nikdy tichý pád ani tiché smazání budov.

### layers.bin

Konkatenace vrstev v pevném pořadí definovaném ve `save/format.ts`. Pořadí je součástí `formatVersion` — změna pořadí = nová verze + migrace.

### Migrace

```ts
type Migration = (save: SaveData) => SaveData;

const migrations: Record<number, Migration> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};

function migrate(save: SaveData): SaveData {
  while (save.meta.formatVersion < CURRENT_FORMAT_VERSION) {
    const m = migrations[save.meta.formatVersion];
    if (!m) throw new SaveMigrationError(save.meta.formatVersion);
    save = m(save);
  }
  return save;
}
```

**Ke každé vydané verzi se do `tests/fixtures/saves/` uloží skutečný save.** Test prochází všechny fixtury a ověřuje, že se načtou do aktuální verze. Na rozdíl od databázových migrací tu nejde nic rollbacknout — soubory jsou u hráčů.

---

## 9. Platform abstrakce

Steam se nikdy nevolá přímo z herního kódu.

```ts
interface Platform {
  readonly id: 'browser' | 'electron' | 'steam' | 'gog';
  readonly storage: SaveStorage;         // savy — jediná část, která dnes něco dělá
  readonly files: FileTransfer;          // stažení a otevření souboru

  getUserId(): Promise<string | null>;
  hasDlc(id: string): boolean;
  unlockAchievement(id: string): void;
  getSavePath(): string | null;          // null = platforma soubory nemá
  workshopAvailable(): boolean;
  listWorkshopMods(): Promise<ModInfo[]>;
}
```

Implementace: `BrowserPlatform`, později `ElectronPlatform`, `SteamPlatform`, `GogPlatform`.

Steam, DLC ani Workshop v prohlížeči nejsou a ty metody jsou zaslepené. Rozhraní ale existuje, aby se Steam později přilepil bez zásahu do herního kódu.

**Vynuceno ESLintem:** `src/ui/` a `src/render/` nesmějí sáhnout na `localStorage`, `sessionStorage` ani `indexedDB`. Dokud to hlídal jen tenhle dokument, sahalo `ui/` na úložiště přímo a abstrakce zůstala roky nenaplněná.

`SaveStorage` je **asynchronní**, i když prohlížečová implementace píše synchronně: každé skutečné úložiště — soubor na disku, Steam Cloud — asynchronní je, a předělávat kvůli tomu později všechna volající místa by byl přesně ten refaktor, kterému má vrstva předejít.

**V prohlížeči se ukládá do `localStorage`, ne do IndexedDB**, jak tvrdila dřívější verze tohohle odstavce. Ukládá se mimo jiné na `pagehide`, kde prohlížeč stránku zabalí dřív, než by se asynchronní zápis stihl dokončit — hráč by přišel o město právě ve chvíli, kdy zavírá kartu. Cena je kvóta kolem pěti megabajtů a base64, které save nafoukne o třetinu; až na to město naroste, je IndexedDB náhrada za jediný soubor.

---

## 10. Lokalizace

**Žádný uživatelsky viditelný text v kódu. Od prvního commitu.**

```ts
// ŠPATNĚ
button.textContent = 'Postavit silnici';

// SPRÁVNĚ
button.textContent = t('ui.build.road');
```

Formát: ploché JSON soubory `locale/cs.json`, `locale/en.json`. Klíče hierarchické tečkovou notací.

Mody a DLC přidávají vlastní locale soubory, které se slučují do stejného registru.

Fallback: chybějící klíč → anglická hodnota → samotný klíč (viditelně, aby chyběl-li překlad, bylo to vidět při testování).

---

## 11. Struktura projektu

**Jeden Vite projekt, ne monorepo.** Hranice se vynucují ESLintem, ne workspace konfigurací. Na monorepo se rozdělí, až to začne bolet — ne dřív.

```
citybuilder/
├── src/
│   ├── sim/                 # P1: žádný Pixi, DOM, Electron
│   │   ├── world.ts
│   │   ├── layers.ts
│   │   ├── rng.ts
│   │   ├── commands.ts
│   │   ├── simHost.ts
│   │   └── systems/
│   │       ├── power.ts
│   │       ├── zoning.ts
│   │       ├── growth.ts
│   │       ├── demand.ts
│   │       └── economy.ts
│   ├── content/
│   │   ├── registry.ts
│   │   ├── schema.ts
│   │   └── loader.ts
│   ├── save/
│   │   ├── format.ts
│   │   ├── serialize.ts
│   │   ├── deserialize.ts
│   │   └── migrations/
│   ├── render/
│   │   ├── app.ts
│   │   ├── camera.ts
│   │   ├── projection.ts
│   │   ├── picking.ts
│   │   ├── chunkRenderer.ts
│   │   ├── buildingRenderer.ts
│   │   └── palette.ts
│   ├── ui/
│   │   ├── hud.ts
│   │   ├── toolbar.ts
│   │   └── i18n.ts
│   ├── platform/
│   │   ├── types.ts
│   │   └── browser.ts
│   └── main.ts
├── content/vanilla/
├── tests/
│   ├── fixtures/saves/
│   └── golden/
├── docs/
│   ├── 01-ARCHITEKTURA.md
│   └── PROGRESS.md
└── ...konfigurace
```

---

## 12. Testovací strategie

| Typ | Co ověřuje | Kde |
|---|---|---|
| **Determinismus** | 2× stejný seed + stejné příkazy → identický hash vrstev | `tests/determinism.test.ts` |
| **Golden** | 1000 tiků z fixního seedu → snapshot hashe vrstev | `tests/golden/` |
| **Save round-trip** | serialize → deserialize → identický stav | `tests/save.test.ts` |
| **Migrace** | každá fixtura se načte do aktuální verze | `tests/migrations.test.ts` |
| **Content validace** | všechny vanilla definice projdou schématem | `tests/content.test.ts` |
| **Hranice** | ESLint neprojde při importu Pixi ze `sim/` | lint |

Golden testy budou při ladění simulace často „selhávat" záměrně — proto musí jít snapshot přegenerovat jedním příkazem (`npm run test:update-golden`), ale změna snapshotu musí být v diffu viditelná.

---

## 13. Akceptační kritéria fáze 1

Fáze 1 je hotová, když je průchozí a **zábavná** tato smyčka:

1. Hráč postaví silnici
2. Vedle silnice vyznačí obytnou zónu
3. Po několika tikách tam vyroste dům a přijdou obyvatelé
4. Obyvatelé potřebují práci → roste průmyslová poptávka
5. Hráč vyznačí průmyslovou zónu, vyroste továrna, vzniknou pracovní místa
6. Populace platí daně → přibývají peníze
7. Hráč postaví elektrárnu, rozvede proud, město roste dál
8. Save → reload → město je ve stejném stavu

Plus technická kritéria:

- 128×128 mapa při rychlosti 8× drží 60 FPS
- Determinismus test prochází
- Save round-trip test prochází
- Lint hranice prochází
- Žádný uživatelský text mimo locale soubory

**Dokud tato smyčka není zábavná, neřeší se Steam, DLC, mody, sprity, převýšení terénu ani nic z fáze 2+.**

---

## 14. Plán fází

> **Tahle tabulka je původní hrubý plán a se skutečností se rozešla.** Práce
> nakonec šla jinudy: převýšení terénu se udělalo ve fázi 3 místo 2, katastrofy
> a MHD si vyžádaly vlastní fázi 4, a distribuce se zatím neřešila vůbec.
> Co se doopravdy stalo, je v `docs/PROGRESS.md`; zadání jednotlivých fází
> v `03-FAZE-2.md`, `04-FAZE-3.md` a `05-FAZE-4.md`.

| Fáze | Původní plán | Jak to dopadlo |
|---|---|---|
| **1** | Smyčka výše. Plochá mapa, procedurální grafika, R/C/I, elektřina, daně, save. | hotovo podle plánu |
| **2** | Znečištění, cena půdy, doprava, kriminalita, hasiči/policie/školy, úrovně budov, demolice, převýšení terénu. | hotovo, jen **převýšení terénu** se přesunulo do fáze 3 |
| **3** | Content registry pro externí zdroje, mod loading, kompletní lokalizace, save migrace v ostrém provozu, sprity. | místo toho **převýšení terénu, voda, mosty, generátor map**; mody a sprity se odložily |
| **4** | Electron, Steamworks, Steam Cloud, achievementy, Workshop, GOG. | místo toho **velikosti map, patnáct katastrof, MHD, finance, save v8** |
| **5** | DLC, případný backend pro cross-platform savy, telemetrie. | **zadání neexistuje** — co dál, je otevřené rozhodnutí |

---

## 15. Otevřené otázky k rozhodnutí

Tyto body **nejsou** ve fázi 1 rozhodnuté a nemá se o nich spekulovat v kódu:

- Převýšení terénu: 16 rohových variant vs. plochá mapa natrvalo
- Dopravní model: vzorkování náhodných cest (Micropolis) vs. skutečný pathfinding
- Skriptovatelné mody: sandbox přes QuickJS/WASM, nebo nikdy
- Velikost mapy: 128×128 vs. volitelná až 512×512

Kód nesmí obsahovat polovičatou přípravu na žádnou z těchto variant. Rozhodne se, až budou data.
