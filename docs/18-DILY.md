# Díly pro animace a silnice

Zadání pro **obrázky, které nejsou budovy**: pohyblivé kusy (lopatky
větrníku, auta, chodci, plameny) a drobnosti u silnic (lampa, dlažba
chodníku). Generuje `tools/generate-parts.py`, výstup jde do
`art/parts/raw/`, odtud je ořeže a zmenší `tools/fit-parts.py` do
`content/vanilla/parts/`.

Vzniklo 2026-09-29 pro `docs/17-ANIMACE.md`. Autor povolil 24 USD a skript si
útratu vede v `art/parts/spend.jsonl`.

## WebP

Hra načítá sprity, povrchy, díly i podezdívky jako **WebP** (T121,
`tools/make-webp.py`): 104 MB PNG → 20 MB. PNG zůstávají jako zdroj pro
nástroje a testy. **Po každém `fit-*.py` pusť `make-webp.py`**, jinak test
v `tests/roadDetails.test.ts` spadne na chybějícím WebP.

## Archy, ne jednotlivé obrázky

Auta a chodci jsou na mapě velcí pár pixelů. Každý zvlášť by stál stejně jako
celá budova. Kreslí se proto **arch**: jeden obrázek, na něm řada oddělených
předmětů s mezerami, a `fit-parts.py` je rozřeže podle průhlednosti
(souvislé oblasti). Pořadí na archu je smlouva: zleva doprava, shora dolů.

## Dva pohledy na vozidlo

Izometrie má čtyři směry jízdy, ale stačí **dva obrázky**. Auto jedoucí
doprava dolů, překlopené vodorovně, jede doleva dolů. Auto jedoucí doprava
nahoru se překlopí na doleva nahoru. Proto má každé vozidlo pohled
**zepředu** (jede k divákovi doprava dolů) a **zezadu** (jede od diváka
doprava nahoru).

## Hlavička

Připojuje se ke každému dílu, pokud neřekne `Hlavička: ne`.

```text
Isometric city-builder game asset, seen from the south-east at the classic
isometric angle, the same camera as the rest of the game.

Rendering style: a soft-shaded 3D render, not a drawing. Believable materials,
smooth gradients, gentle ambient occlusion. Bright, warm, even daylight;
sunlight from the left, so left-facing surfaces are brighter than
right-facing ones.

NOT cartoon, NOT cel-shaded. No dark outline around any object. No
photorealism, no film grain, no lens effects, no blur, no depth of field.

Subject period and place: Czechoslovakia in the 1980s.

Transparent background. No ground, no grass, no road and NO SHADOW under the
objects — only the objects themselves. No text, no letters, no numbers, no
logos, no flags, no watermark.
```

## Větrník bez lopatek

Věž zůstane obrázkem budovy a lopatky se točí jako samostatný sprite. Vychází
se z hotového obrázku, aby se věž nezměnila.

#### `wind_turbine__a_bare`
Plátno: 1024x1536
Kvalita: high
Vstup: art/sprites/raw/wind_turbine__a.png
Hlavička: ne

```text
Edit this image. Remove the three rotor blades completely, and nothing else.
Keep the tower, the nacelle with its round hub at the front, the plot, the
fence, the paths, the lighting, the camera and the exact position and size of
everything EXACTLY as they are. Where a blade covered something, show what is
behind it. The background stays transparent.
```

#### `wind_turbine__b_bare`
Plátno: 1024x1536
Kvalita: high
Vstup: art/sprites/raw/wind_turbine__b.png
Hlavička: ne

```text
Edit this image. Remove the three rotor blades completely, and nothing else.
Keep the lattice tower, the guy wires, the nacelle with its round hub at the
front, the plot, the lighting, the camera and the exact position and size of
everything EXACTLY as they are. Where a blade covered something, show what is
behind it. The background stays transparent.
```

#### `wind_turbine__c_bare`
Plátno: 1024x1536
Kvalita: high
Vstup: art/sprites/raw/wind_turbine__c.png
Hlavička: ne

```text
Edit this image. Remove the three rotor blades completely, and nothing else.
Keep the concrete tower, the nacelle with its round hub at the front, the
kiosk, the plot, the lighting, the camera and the exact position and size of
everything EXACTLY as they are. Where a blade covered something, show what is
behind it. The background stays transparent.
```

#### `rotor`
Plátno: 1024x1024
Kvalita: high
Hlavička: ne

```text
A wind turbine rotor seen EXACTLY FACE-ON, perpendicular to the camera: a small
round white hub in the exact centre of the image and three long slender white
blades radiating from it at exactly 120 degrees apart, one pointing straight
up. Each blade tapers to a narrow tip and has a short red band at the tip.
Soft-shaded 3D render, sunlight from the left, gentle gradient along each
blade. The blades reach almost to the edge of the image. Transparent
background, no tower, no nacelle, no shadow, no outline, no text.
```

## Vozidla

**Od T125 se vozidla negenerují.** Autor hlásil auta pod špatným úhlem
o 20–30°; změřeno 15–31° místo izometrických 26,6°, a to ani se šablonou
kvádrů (`tools/make-vehicle-templates.py`, generátor ji ignoroval), ani
s přísným zadáním. Zkosení to nespravilo: bok šel do osy, čelo ne.

Auta proto staví `tools/make-vehicles.py` jako 3D modely z kvádrů a promítá
je stejnou maticí jako mřížku hry — úhel sedí přesně ve všech směrech.
Původní obrázky z generátoru jsou v `art/parts/archive/`.

## Chodci

Hlavička budov lidi zakazuje. Tady jsou, ale **drobní a bez tváří**: na mapě
mají pár pixelů a jde o pohyb, ne o portrét.

#### `people_walk`
Plátno: 1536x1024
Kvalita: medium

```text
A sprite sheet of TWELVE separate small pedestrians in two rows of six, with
wide empty transparent gaps between them. Top row: six people walking towards
the viewer and to the RIGHT (along the axis from upper left to lower right).
Bottom row: six people walking away from the viewer and to the RIGHT (along
the axis from lower left to upper right). Everyday 1980s clothes: coats,
jackets, a headscarf, a shopping bag, a briefcase, a pram. Simple figures,
faces not detailed. All the same scale.
```

#### `people_sit`
Plátno: 1536x1024
Kvalita: medium

```text
A sprite sheet of EIGHT separate small people in two rows of four, with wide
empty transparent gaps between them. Everyone is SITTING on an invisible seat
(no bench is drawn), facing the viewer and slightly to the right. Everyday
1980s clothes: coats, jackets, a headscarf, a shopping bag on the lap, a
newspaper. Simple figures, faces not detailed. All the same scale.
```

## Oheň

#### `flames`
Plátno: 1536x1024
Kvalita: high
Hlavička: ne

```text
A sprite sheet of SIX separate tongues of fire in one row, with wide empty
transparent gaps between them. Each is a tall flickering flame, bright yellow
at the base turning orange and red towards a ragged tip, slightly different
shape each. Soft-shaded, luminous, no smoke, no outline, no ground, no shadow,
no text. Transparent background.
```

## U silnice

#### `street_lamp`
Plátno: 1024x1536
Kvalita: medium

```text
A single Czechoslovak street lamp of the 1980s standing on its own: a slender
grey concrete pole with a curved steel arm at the top reaching to the LEFT,
ending in a flat elongated lamp housing. Nothing else in the image. The lamp
fills the height of the image.
```

#### `sidewalk`
Plátno: 1024x1024
Kvalita: medium
Hlavička: ne

```text
A seamless square texture of a Czechoslovak pavement of the 1980s seen from
directly above: square grey concrete paving slabs about 30 cm wide laid in a
straight grid, slightly weathered, a few hairline cracks, a little moss in the
joints. Even soft daylight, no shadows, no perspective, fills the whole image
edge to edge. No text.
```
