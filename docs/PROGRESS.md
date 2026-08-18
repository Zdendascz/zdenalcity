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

## Rozpracované
_(nic — T2 uzavřeno)_

## Backlog
- [ ] T3 — silnice, dirty tracking, herní smyčka
- [ ] T4 — content registry, JSON schéma, vanilla definice
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
| 2026-08-18 | **Dlaždice mají tenkou hranu ve ztmavené barvě terénu** | Architektura §6 mluví jen o „diamantu vyplněném barvou". Jenže mapa je ve fázi 1 celá tráva, takže bez hran je to jednolitá zelená plocha, na které nejde poznat mřížka ani to, že panování funguje. Barva jde z palety (`TILE_EDGE_SHADE`), ne natvrdo. **Odchylka od §6 — ke schválení.** |
| 2026-08-18 | `RenderTexture` chunky mají `resolution: 1` natvrdo | Výchozí rozlišení se řídí `devicePixelRatio`; na HiDPI displeji by textury byly 4× větší, tedy 512 MB. Cena: při zoomu 4× na HiDPI bude terén lehce měkčí. |
| 2026-08-18 | `gridToScreen` vrací **horní vrchol** diamantu, ne jeho střed | Picking i kreslení chunků na té konvenci závisí, takže je zapsaná v komentáři funkce a ověřená testem. Střed dlaždice = vrchol + `TILE_H / 2`. |
| 2026-08-18 | Kamera nemá vlastní DOM listenery | Zadání T2 chce kameru jako čistý stav. Myš a klávesnici obsluhuje `app.ts` a volá do kamery jen `pan` / `zoomAt`. Díky tomu je celá kamera testovatelná bez prohlížeče. |
| 2026-08-18 | Ve vývojovém buildu je `globalThis.__city` | Bez něj nešlo renderer ověřit jinak než okem — v neviditelné záložce prohlížeč nespouští `requestAnimationFrame`, takže se nevykreslí nic. Přes tenhle handle jde vynutit snímek a změřit ho. Zabaleno v `import.meta.env.DEV`, v produkci se odstraní. |
| 2026-08-18 | `buildingRenderer.ts` nevznikl | Je ve stromu architektury §11, ale budovy přijdou až v T5. Prázdný soubor by byl kód do zásoby. |
| 2026-08-14 | `systems/zoning.ts` nevznikl | Strom v architektuře §11 ho zmiňuje, ale v tabulce systémů §5 nemá řádek — zónování je příkaz, ne tikající systém. Vznikne v T5, pokud se ukáže, že ho potřebuje. |

## Známé problémy / technický dluh

- `vite.config.ts` je mimo `tsc --noEmit` (viz tabulka rozhodnutí).
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
