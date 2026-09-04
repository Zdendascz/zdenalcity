# Obrázky katastrof

Zadání pro **dramatické obrázky do hlášení o katastrofě**. Nejsou to sprity ani
dlaždice a na mapu se nedostanou: kreslí se do karty, kterou hráč dostane, když
něco udeří.

Generuje `tools/generate-scenes.py` (stejný nástroj, jiný dokument — spouští se
s `--spec docs/11-UDALOSTI.md`). Výstup jde do `art/events/`.

## Proč

Hlášení bylo do T84 proužek s větou a dvěma tlačítky. Autor chtěl kartu
velikosti rozboru parcely: **vlevo obrázek, vpravo povídání**. A hlavně —
„je to povídání pro starostu", ne výpis metrik. Kolik dlaždic hoří, si hráč
přečte na mapě; z karty má mít pocit, že se něco stalo.

Obrázek je proto **dramatický a hraný**. Ne infografika.

## Styl

Doslova takhle, přidává se ke každému promptu:

```
A dramatic wide scene at eye level, standing on the ground and looking at the
event, NOT from above and NOT isometric. Soft-shaded three-dimensional render,
NOT a cartoon and NOT a photograph: no black outlines, no cel shading, no
visible brush strokes, no lens flare, no film grain. Strong directional light
and deep shadows; the mood is tense.

The place is a Czechoslovak town in the 1980s: precast concrete panel blocks
with pebbledash and coloured panels, cast concrete kerbs, asphalt with patches,
mown grass with clover, birch and linden, small family houses with red clay
roof tiles.

There are NO people and NO faces anywhere in the image, not even in the
distance: show the event and what it did to the place, never a person.

NO TEXT, NO LETTERS, NO NUMBERS, NO SIGNAGE, NO WATERMARK.
```

**Proč zase bez lidí.** Nejde jen o kreslení tváří. Katastrofa s lidmi uvnitř
je obrázek neštěstí, ne události ve hře, a to je hranice, za kterou tahle hra
nechce. Škoda se ukazuje na místě, ne na obětech.

## Scény

| id | prompt |
|---|---|
| `fire` | A block of flats with flames breaking out of two windows on an upper floor, thick dark smoke rolling along the facade, a fire engine at the kerb with its ladder raised, orange light on the wet asphalt. |
| `wildfire` | A pine wood on a slope burning at its edge, a wall of flame and smoke behind the first trees, ash drifting over the grass, the roofs of the nearest houses just below the fire. |
| `flood` | A flooded street where brown water reaches the ground-floor windows, a bus stop shelter standing in the water, tree tops and a lamp post rising out of it, sandbags in a broken line along a wall. |
| `tornado` | A dark funnel cloud coming down onto the edge of town, a roof torn open, sheet metal and branches in the air, the sky green-grey behind it. |
| `earthquake` | A street after a quake: a long crack across the asphalt, a facade with a collapsed balcony, bricks and glass on the pavement, a lamp post leaning over the road. |
| `explosion` | A gas explosion at a block of flats: the ground floor blown open, a wall gone, fire inside the gap, debris across the pavement and a column of smoke. |
| `industrialAccident` | A works hall with its roof torn open and a chimney leaning, steam and smoke pouring out, twisted pipework and a burst tank in the yard behind a concrete fence. |
| `pileup` | A multiple crash on a wide road: several cars from the era crumpled into each other across both lanes, glass and parts scattered, a lorry jack-knifed behind them. |
| `strike` | A tram depot standing idle: gates chained shut, trams parked in a row and dark inside, placards leaning against the fence, litter blowing across the empty yard. |
| `riot` | A street after a riot: overturned bins burning, broken shop windows boarded with planks, a bus stop shelter with its glass gone, smoke hanging under the street lamps. |
| `gangWar` | A back street at dusk: a burnt-out car, bullet holes in a shop shutter, graffiti over the wall of a panel block, glass across the pavement. |
| `blackout` | A whole quarter of panel blocks completely dark under a deep blue evening sky, not one window lit, the only light a pair of car headlights on the road below. |
| `epidemic` | A hospital entrance with a queue of ambulances outside, a white field tent on the lawn beside it, barriers and tape across the path, lights burning in every window. |
| `chemicalSpill` | An overturned tanker beside a works fence, a pale spill spreading across the road and down into a drain, warning barriers around it, a yellowish haze in the air. |
| `landslide` | A hillside that has slid onto a road: a tongue of mud and rock across both lanes, a fallen tree, a crash barrier bent flat, a house at the top of the slope with its garden torn away. |
