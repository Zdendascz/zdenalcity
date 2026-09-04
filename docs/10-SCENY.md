# Scény z ulice

Zadání pro **propagační obrázky z úrovně očí** — pohled do ulice, průčelí domu,
zastávka. Nejsou to sprity ani dlaždice a do hry se nedostanou: slouží na web
a do příspěvků.

Generuje `tools/generate-scenes.py`, který prompty čte odsud. Výstup jde do
`art/scenes/`.

## Proč vůbec

Snímky ze hry ukazují město **shora a z dálky**, protože tak se hra hraje.
Autor k nim chtěl ještě něco jiného: „jako že stojíš přímo před tím barákem
a vlastním pohledem se na něj díváš, nebo pohled do ulice a tam podél ní domy
ze hry".

Z izometrie to vyrobit nejde — kamera hry je pevná a sprity jsou malované na
jeden úhel. Scény se proto **kreslí zvlášť**, a je to poctivé, dokud se tváří
jako obrázek ke hře, ne jako snímek ze hry. Do řady „Ze hry" na domovské
stránce nepatří; mají vlastní řadu.

## Styl

Doslova takhle, přidává se ke každému promptu:

```
A wide cinematic photograph-like render at eye level, standing on the ground
and looking straight ahead, NOT from above and NOT isometric. Soft daylight
from the upper left, gentle contact shadows, clear air. Soft-shaded
three-dimensional render, NOT a cartoon and NOT a photograph: no black
outlines, no cel shading, no visible brush strokes, no lens flare, no film
grain. Colours are natural but a touch more saturated than reality.

The place is a Czechoslovak town in the 1980s: precast concrete panel blocks
with pebbledash and coloured panels, cast concrete kerbs, asphalt with patches,
mown grass with clover, birch and linden, small family houses with red clay
roof tiles.

The street is calm and lived-in but EMPTY: no people, no faces, no crowds.

NO TEXT, NO LETTERS, NO NUMBERS, NO SIGNAGE, NO WATERMARK.
```

**Proč bez lidí.** Postavy by musely mít tvář a tu generátor kreslí pokaždé
jinak; prázdná ulice navíc sedí ke hře, kde se lidé nekreslí vůbec.

**Proč „NOT isometric".** První pokus to slovo neměl a vrátil totéž co dlaždice
— pohled shora. Úhel se musí říct dvakrát a jasně.

## Scény

| id | prompt |
|---|---|
| `ulice` | Looking down a residential street: four-storey precast concrete panel blocks in cream and pale blue stand along both sides, a row of linden trees between the pavement and the road, parked cars from the era at the kerb, the street running away to the horizon. |
| `prucelu` | Standing directly in front of the entrance of a four-storey panel block: the doorway with a concrete canopy, letterboxes, a strip of mown grass with a low hedge, two birches beside the path, the facade filling most of the frame. |
| `namesti` | A small town square: a concrete fountain in the middle, low shops with glazed fronts along one side, a church tower behind the roofs, benches and linden trees, block paving underfoot. |
| `zastavka` | A bus stop shelter of concrete and glass beside a wide street, a tram track curving past it, panel blocks behind a screen of trees, a low kerb and a strip of grass. |
| `sidliste` | A gap between two panel blocks seen from the ground: a playground with a sandpit and a climbing frame, drying racks, a footpath curving between mown lawns, tall blocks framing the sky. |
| `prumysl` | The edge of an industrial area at the end of a street: brick and concrete halls with saw-tooth roofs, a chimney behind them, a fence of concrete panels, weeds along the kerb. |
