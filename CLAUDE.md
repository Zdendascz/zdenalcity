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

## Prostředí
Projekt vyžaduje Node `^20.19.0 || >=22.12.0` (Vite 8), vynuceno přes `engines`.
Na vývojovém stroji běží Node 24 LTS ze scoopu. Pokud `node -v` někdy začne hlásit
v20, čti `docs/SETUP.md` — sekce o konfliktu dvou instalací.
