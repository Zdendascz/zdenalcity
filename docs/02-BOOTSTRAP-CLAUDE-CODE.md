# Bootstrap — zadání pro Claude Code

**Vstupní podmínka:** Přečti nejdřív `docs/01-ARCHITEKTURA.md`. Pravidla P1–P7 z jeho sekce 2 jsou závazná a v tomto dokumentu se na ně odkazuje zkratkou.

**Cíl tohoto zadání:** dostat projekt do stavu, kdy autor může spustit `npm run dev`, vidět izometrickou mapu, stavět na ní silnice, a `npm run check` mu ověří celý projekt. Žádná herní logika nad rámec silnic.

---

## 0. Pravidla spolupráce

**Ptej se, než nainstaluješ jakoukoli závislost, která není v seznamu v úkolu T0.** Projekt má mít minimum závislostí.

**Nepiš kód „do zásoby".** Žádné abstrakce pro věci, které ještě nejsou v zadání. Sekce 15 architektury vyjmenovává nerozhodnuté otázky — na ty se nesmí v kódu připravovat.

**Jeden úkol = jedna session.** Na konci každého úkolu aktualizuj `docs/PROGRESS.md` (formát níže) a skonči. Nepokračuj automaticky do dalšího úkolu.

**Když narazíš na rozpor mezi tímto dokumentem a architekturou, zastav se a zeptej.** Neřeš to vlastním úsudkem.

### Co v tomto projektu nedělat

Tyto věci **nepatří do fází 1–3** a nesmí se objevit v kódu ani v závislostech:

- Electron, Steamworks, jakákoli platformní integrace (kromě `BrowserPlatform` stubu)
- Sprity, textury, obrázky, atlasy — grafika je procedurální (architektura §6)
- Převýšení terénu — `elevation` vrstva existuje, ale je všude 0
- React, Vue, Svelte, jakýkoli UI framework — UI je plain TS + HTML + CSS
- Redux, Zustand, jakýkoli state manager — stav je `WorldState`
- Tailwind ani jiný CSS framework
- Monorepo, workspaces, více `package.json`
- Web Worker — `SimHost` má message-based API, ale běží na main threadu
- Multiplayer, síťování, backend

---

## 1. T0 — Toolchain a hranice

### Závislosti

```bash
npm create vite@latest . -- --template vanilla-ts
npm i pixi.js@^8 fflate
npm i -D vitest @vitest/ui eslint @eslint/js typescript-eslint
```

Nic dalšího bez dotazu.

### package.json — scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:update-golden": "vitest run -u",
    "lint": "eslint src tests",
    "typecheck": "tsc --noEmit",
    "check": "npm run lint && npm run typecheck && npm run test"
  }
}
```

### tsconfig.json

`strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `moduleResolution: bundler`.

Alias `@/*` → `src/*` v tsconfig i ve `vite.config.ts` (přes `resolve.alias`).

### eslint.config.js — vynucení P1 a P2

Toto je nejdůležitější soubor v úkolu T0. Flat config, ESLint 9:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // P1 — simulace nezná renderer
    files: ['src/sim/**/*.ts', 'src/save/**/*.ts', 'src/content/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['pixi.js', 'pixi.js/*'], message: 'P1: sim/save/content nesmí znát renderer.' },
          { group: ['electron', 'electron/*'], message: 'P1: platformní kód sem nepatří.' },
          { group: ['**/render/**', '**/ui/**', '**/platform/**'], message: 'P1: porušení směru závislostí.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'P1: žádné DOM API v simulaci.' },
        { name: 'document', message: 'P1: žádné DOM API v simulaci.' },
        { name: 'localStorage', message: 'P1: žádné DOM API v simulaci.' },
      ],
    },
  },
  {
    // P2 — determinismus
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'P2: použij world.rng.next().' },
        { object: 'Date', property: 'now', message: 'P2: čas je world.tick.' },
        { object: 'performance', property: 'now', message: 'P2: čas je world.tick.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: 'NewExpression[callee.name="Date"]', message: 'P2: čas je world.tick.' },
      ],
    },
  },
);
```

### Negativní test hranic

**Nestačí, že lint prochází — musí se ověřit, že opravdu chytá.**

Vytvoř `tests/boundaries.test.ts`, který programově spustí ESLint na dočasném souboru obsahujícím `import { Application } from 'pixi.js'` umístěném v `src/sim/`, a ověří, že vznikne chyba. Bez tohoto testu je celá ochrana P1 iluze — konfigurace se dá rozbít překlepem a nikdo si toho nevšimne.

### CLAUDE.md v kořeni repozitáře

Vytvoř `CLAUDE.md` (Claude Code ho čte automaticky) s kondenzovanými pravidly:

```markdown
# CLAUDE.md

Plná specifikace: `docs/01-ARCHITEKTURA.md`. Aktuální stav: `docs/PROGRESS.md`.

## Nepřekročitelná pravidla
- P1: `src/sim/` neimportuje Pixi, DOM, Electron, render/, ui/, platform/. Vynuceno ESLintem.
- P2: v `src/sim/` žádný Math.random / Date.now / performance.now. Jen `world.rng`.
- P3: simulace používá gridové souřadnice. Izometrie výhradně v `src/render/`.
- P4: mřížková data = typed arrays po vrstvách. Nikdy pole objektů.
- P5: žádná konkrétní budova v kódu. Obsah jsou JSON data.
- P6: ID definic jsou stringy s namespace (`vanilla:xyz`). Do savu nikdy čísla.
- P7: save má `formatVersion` a migrace jsou čisté funkce s fixturami.

## Před commitem
`npm run check` musí projít.

## Nedělat
Electron, Steam, sprity, převýšení terénu, React, state manager, monorepo, Web Worker.
Nové závislosti jen po odsouhlasení autorem.
```

### docs/PROGRESS.md

Vytvoř s tímto formátem a **aktualizuj ho na konci každé session**:

```markdown
# Progress

## Hotovo
- [x] T0 — toolchain, ESLint hranice, negativní test hranic

## Rozpracované
- [ ] T1 — jádro simulace
  - stav: ...
  - další krok: ...

## Backlog
- [ ] T2 — renderer
...

## Rozhodnutí učiněná během vývoje
| Datum | Rozhodnutí | Důvod |
|---|---|---|

## Známé problémy / technický dluh
- ...
```

### Akceptace T0

```bash
npm run check   # prochází
npm run dev     # spustí se, prázdná stránka
```

Plus: `tests/boundaries.test.ts` prochází a při ručním zakomentování pravidla v `eslint.config.js` selže.

---

## 2. T1 — Jádro simulace

Vše v `src/sim/`. Žádný renderer, žádné UI. Ověřuje se výhradně testy.

### rng.ts

Mulberry32 se serializovatelným stavem:

```ts
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  getState(): number { return this.state; }

  static fromState(state: number): Rng {
    const r = new Rng(0);
    (r as { state: number }).state = state >>> 0;
    return r;
  }
}
```

`getState`/`fromState` jsou nutné, aby byl RNG součástí savu — jinak by načtená hra nebyla deterministická.

### layers.ts

```ts
export const MAP_SIZE = 128;

export function index(x: number, y: number): number {
  return y * MAP_SIZE + x;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
}

export interface Layers {
  terrain: Uint8Array;
  elevation: Uint8Array;
  zone: Uint8Array;
  road: Uint8Array;
  buildingId: Uint16Array;
  power: Uint8Array;
}

export function createLayers(size: number): Layers { /* ... */ }
export function hashLayers(layers: Layers): string { /* FNV-1a přes všechny vrstvy */ }
```

`hashLayers` je základ golden testů — musí být deterministický a rychlý.

### world.ts, commands.ts, simHost.ts

Podle architektury §4 a §5. `SimHost` implementuje `dispatch` / `step` / `getSnapshot` / `consumeDirty`.

**`getSnapshot()` vrací read-only pohled**, ne kopii — kopírování 16 KB vrstev každý snímek je zbytečné. Typuj jako `ReadonlyWorldView` s `readonly` vrstvami a spoléhej na typový systém.

`step(deltaMs)` implementuje akumulátor z architektury §5 včetně `MAX_TICKS_PER_FRAME`.

### Systémy

Ve fázi T1 pouze prázdné registrace se správnými intervaly a offsety podle tabulky v architektuře §5. Systémy se plní v pozdějších úkolech. Registr systémů:

```ts
interface System {
  readonly name: string;
  readonly interval: number;
  readonly offset: number;
  run(world: WorldState): void;
}
```

### Testy T1

1. **Determinismus:** dva `WorldState` se stejným seedem, 1000 tiků, stejná posloupnost příkazů → identický `hashLayers` a identický `rng.getState()`
2. **RNG stabilita:** `new Rng(12345)`, prvních 10 hodnot → hardcoded snapshot (chytí neúmyslnou změnu algoritmu, která by rozbila všechny existující savy)
3. **Akumulátor:** `step(1000)` při rychlosti 1× → přesně 4 tiky; při rychlosti 8× → zastropováno na `MAX_TICKS_PER_FRAME`
4. **Fázování:** systém s `interval: 12, offset: 2` běží na ticích 2, 14, 26…

### Akceptace T1

`npm run check` prochází. Simulace tiká bez jakéhokoli rendereru.

---

## 3. T2 — Renderer a kamera

Vše v `src/render/`. Renderer čte `ReadonlyWorldView`, nikdy nezapisuje.

### projection.ts

Přesně vzorce z architektury §3. Konstanty `TILE_W = 64`, `TILE_H = 32`, `LEVEL_H = 16`.

Funkce `gridToScreen(x, y, elevation)` a `screenToGrid(sx, sy)`.

**Do `screenToGrid` napiš komentář**, že platí jen pro plochý terén a s převýšením se bude muset nahradit testováním od předu dozadu.

### camera.ts

Pan (drag prostředním nebo pravým tlačítkem, případně mezerník+levé), zoom kolečkem se zoomem k pozici kurzoru, nikoli ke středu obrazovky. Clamp zoomu na 0.25–4.

Kamera je čistý stav (`x`, `y`, `zoom`) + transformace. Neinteraguje se simulací.

### chunkRenderer.ts

Terén do `RenderTexture` po chuncích 16×16 dlaždic. Chunk se překresluje jen když je v `DirtySet`.

Dlaždice = izometrický diamant přes `Pixi.Graphics`, barva podle `terrain` a palety.

Kreslení uvnitř chunku vzestupně podle `x + y`.

### palette.ts

Centrální definice barev. Žádná barva zadaná natvrdo jinde v kódu.

```ts
export const TERRAIN_COLORS = [0x6b9b4a, 0x3a6ea5, 0xd6c48a, 0x8a8a8a] as const;
export const ZONE_COLORS = { residential: 0x4a90d9, commercial: 0x4ac97e, industrial: 0xd9c34a } as const;
export function shade(color: number, factor: number): number { /* ... */ }
```

### picking.ts + hover highlight

Kurzor nad mapou → zvýrazněný diamant na příslušné dlaždici. Souřadnice dlaždice vypiš do rohu obrazovky (debug overlay).

### Akceptace T2

`npm run dev` zobrazí 128×128 mapu trávy, jde po ní panovat a zoomovat, dlaždice pod kurzorem se zvýrazní a její souřadnice odpovídají skutečné pozici.

Výkonový check: **60 FPS při plném oddálení.** Když ne, zastav se a nahlas to — je to signál chyby v chunkování, ne důvod k optimalizaci na sílu.

---

## 4. T3 — Silnice, dirty tracking, herní smyčka

### Příkazy

`build_road` a `bulldoze` přes `SimHost.dispatch`. UI nikdy nesahá na `WorldState` přímo.

Validace v simulaci, ne v UI: nelze stavět na vodu, nelze stavět mimo mapu, bulldoze prázdné dlaždice je no-op.

### Auto-tiling

Bitmask sousedů: N = 1, E = 2, S = 4, W = 8, kde N je `(x, y-1)`. 16 variant kreslených procedurálně.

Bitmask se počítá **v rendereru**, ne v simulaci — simulace ví jen `road: 0|1` (P3).

### Dirty tracking

`build_road` označí změněnou dlaždici **a její čtyři sousedy** (jejich auto-tiling se mění) v `DirtySet`. Renderer překreslí jen dotčené chunky.

### Herní smyčka a rychlost

`requestAnimationFrame` → `simHost.step(delta)` → `renderer.update(snapshot, dirty)`.

Ovládání rychlosti klávesami 0–4 (pauza, 1×, 2×, 4×, 8×). Aktuální tick a rychlost v debug overlayi.

### Test

Golden test: z fixního seedu postav sekvenci silnic, 500 tiků, ověř `hashLayers` proti snapshotu.

### Akceptace T3

Kliknutím se staví silnice s korektním napojením na sousedy. Pravým tlačítkem (nebo klávesou) se bourá. Simulace tiká, rychlost jde měnit, mapa zůstává plynulá.

**Tímto je bootstrap hotový.** Autor má běžící vývojové prostředí, testovací harness a hratelnou kostru.

---

## 5. Backlog — každý bod samostatná session

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T4** | Content registry, JSON schéma, validace, vanilla definice budov | T1 |
| **T5** | Zóny, růst budov, agregovaná populace, vykreslení kvádrů | T3, T4 |
| **T6** | Elektřina — flood fill z elektráren, `power` vrstva, overlay | T5 |
| **T7** | RCI poptávka, daně, měsíční rozpočet, bankrot | T5 |
| **T8** | Save/load — ZIP kontejner, meta.json, migrace, fixtury | T7 |
| **T9** | HUD, toolbar, i18n, převod všech textů na klíče | T7 |
| **T10** | Vyhodnocení: je smyčka z architektury §13 zábavná? | T9 |

**T10 není technický úkol.** Je to rozhodovací bod — pokud smyčka není zábavná, fáze 2 se neotevírá a místo toho se ladí to, co existuje.

---

## 6. Kontrolní seznam před koncem každé session

- [ ] `npm run check` prochází
- [ ] `docs/PROGRESS.md` aktualizován (hotovo / rozpracované / další krok)
- [ ] Nová rozhodnutí zapsána do tabulky rozhodnutí v PROGRESS.md
- [ ] Žádná nová závislost bez odsouhlasení
- [ ] Žádný uživatelsky viditelný text mimo locale soubory (od T9)
- [ ] Nic z „Co nedělat" (sekce 0) se neobjevilo v kódu
