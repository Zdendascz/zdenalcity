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
Electron, Steam, React, state manager, monorepo, Web Worker.

Sprity **budou** — rozhodnutí autora se dvakrát změnilo, tak pozor na pořadí:

- **T60:** ikony rozhraní jsou obrázky v `content/vanilla/icons/`. Jen tlačítka.
- **T70:** obrázky dostávají i **budovy na mapě**, každá ve třech variantách.
  Zadání a prompty jsou v `docs/06-SPRITY-SLUZEB.md`.
- **T72:** obrázek povrchu mají **všechny druhy terénu**, v `content/vanilla/tiles/`.
  Kreslí se jako výplň polygonu s maticí, ne přes mesh, takže chunkové pečení
  zůstalo. **Silnice mají materiál, ne tvar**: tvar vozovky se počítá z rohů
  dlaždice a obrázek dodá jen povrch, jeden na typ. Hotové dlaždice na každý
  tvar se zkoušely a zahodily — spoj sedí jen u 22 ze 64 a hlavně se jich tolik
  nevejde do jedné kreslicí dávky. **Potrubí zůstává procedurální.** Měření je
  v `docs/08-DLAZDICE.md`.

Vše jde přes `ContentSource`, aby to mod směl přidat i přepsat (P5). Chybějící
obrázek nesmí hru zastavit — kreslí se kvádr jako dřív.
Nové závislosti jen po odsouhlasení autorem.

## Prostředí
Projekt vyžaduje Node `^20.19.0 || >=22.12.0` (Vite 8), vynuceno přes `engines`.
Na vývojovém stroji běží Node 24 LTS ze scoopu. Pokud `node -v` někdy začne hlásit
v20, čti `docs/SETUP.md` — sekce o konfliktu dvou instalací.
