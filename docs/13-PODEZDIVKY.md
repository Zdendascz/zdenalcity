# Podezdívky

Zadání pro **materiál podezdívky** — stěny mezi rovným pozemkem budovy
a nerovným terénem pod ním. Kreslí ji `drawSkirt` v `buildingRenderer.ts`.

Generuje `tools/generate-tiles.py --spec docs/13-PODEZDIVKY.md`, ladí
`tools/fit-skirts.py`. Výstup jde do `content/vanilla/skirts/`.

## Proč

Podezdívka byla **jedna šedá barva** ve dvou odstínech, podle toho, jestli
stěna kouká doprava nebo doleva. Na svahu je jí přitom vidět víc než fasády
a na hustém sídlišti splývají sousední domy do jedné šedé plochy.

Autor k tomu přidal, že podezdívka nemusí být pro všechny stejná: **bydlení,
obchod a průmysl** ať mají každý svou. To dává smysl i mimo vzhled — panelák
stojí na jiné podezdívce než hala.

## Co se nesmí zopakovat

Tři chyby, které stály předchozí sady obrázků. Všechny se týkají i téhle:

1. **Široká proměnlivost patří sklonu, ne kresbě.** Přechod přes obrázek se
   při dláždění projeví jako šachovnice. U trávy to bylo 57 a vypadalo to jako
   deka; po opravě 6. Prompt proto zakazuje stín, vinětu i přechod jmenovitě —
   „no patches" samo nestačilo.
2. **Materiál se kreslí z dálky.** Jednotlivá cihla ani zrnko omítky vidět
   nebude; stěna je vysoká **jedna úroveň, tedy dva metry**, a na obrazovce
   pár pixelů.
3. **Varianty jsou totéž jinak, ne něco jiného.** Tři varianty se liší
   odstínem a hrubostí, ne motivem. Jinak by z každé třetí budovy koukal jiný
   dům.

## Jak se drží přes reloady

Varianta se losuje **z id budovy**, ne z `world.rng`: musí vyjít stejně po
načtení savu i po překreslení. Stejná míchačka jako u variant spritů
(`variantFor`), jen krmená jinak — kdyby se sdílela, měl by dům se světlým
spritem vždycky světlou podezdívku.

## Styl

Doslova takhle, přidává se ke každému promptu:

```
A flat square sample of a WALL material, seen straight on from the front, filling
the whole frame edge to edge. Soft-shaded three-dimensional render, NOT a cartoon
and NOT a photograph: no black outlines, no cel shading, no visible brush strokes,
no film grain.

The light is perfectly flat and even across the whole image: NO shadow, NO
vignette, NO darker corner, NO darker band, NO gradient from one side to the
other. Every part of the image is exactly as bright as every other part.

SCALE MATTERS MORE THAN DETAIL. This piece of wall is TWO METRES high and is
seen from across the street. Single bricks, single grains and hairline cracks
are FAR too small to see and must not be drawn. What is visible is the material
as one surface: its colour, its texture and broad gentle variation.

There is nothing on the wall: no window, no door, no pipe, no sign, no plant,
no ground and no sky. The material fills the frame completely.

NO TEXT, NO LETTERS, NO NUMBERS, NO SIGNAGE, NO WATERMARK.
```

## Bydlení

| | prompt |
|---|---|
| **a** | A rendered concrete plinth wall in warm grey, lightly roughcast, the same everywhere. |
| **b** | A rendered concrete plinth wall in a deeper warm grey, lightly roughcast, the same everywhere. |
| **c** | A rendered concrete plinth wall in a paler warm grey, lightly roughcast, the same everywhere. |

## Obchod

| | prompt |
|---|---|
| **a** | A plinth wall of small dark ceramic tiles in muted brown, laid in an even grid, the same everywhere. |
| **b** | A plinth wall of small ceramic tiles in muted grey-green, laid in an even grid, the same everywhere. |
| **c** | A plinth wall of small ceramic tiles in muted sand colour, laid in an even grid, the same everywhere. |

## Průmysl

| | prompt |
|---|---|
| **a** | A plinth wall of bare precast concrete panels in cool grey, the joints between panels only faintly visible, the same everywhere. |
| **b** | A plinth wall of bare precast concrete panels in a darker cool grey, the joints only faintly visible, the same everywhere. |
| **c** | A plinth wall of bare precast concrete panels in a paler cool grey with a faint aggregate finish, the same everywhere. |
