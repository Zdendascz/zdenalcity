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

## Rozpracované
_(nic — T1 uzavřeno)_

## Backlog
- [ ] T2 — renderer a kamera
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
| 2026-08-14 | `systems/zoning.ts` nevznikl | Strom v architektuře §11 ho zmiňuje, ale v tabulce systémů §5 nemá řádek — zónování je příkaz, ne tikající systém. Vznikne v T5, pokud se ukáže, že ho potřebuje. |

## Známé problémy / technický dluh

- `vite.config.ts` je mimo `tsc --noEmit` (viz tabulka rozhodnutí).
- Starý Node 20.11.1 zůstal nainstalovaný v `C:\Program Files\nodejs\`, jen už není
  v PATH. Reinstalace Node.js z MSI by ho tam vrátila a konflikt by se obnovil —
  příznaky a oprava v `docs/SETUP.md`.
- Během T1 se tenhle konflikt reálně projevil: session Claude Code běžela od doby
  před opravou PATH, měla ho tedy zděděný a `npm test` spadl na
  `node:util does not provide an export named 'styleText'` (vitest 4 vyžaduje
  Node ≥ 20.12). Registr je v pořádku, stačí **restart terminálu / Claude Code**.
  Jednorázová objížďka bez restartu:
  `$env:PATH = "C:\Users\Intel\scoop\apps\nodejs-lts\current;$env:PATH"`.
