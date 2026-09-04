# Silnice jako obrázky

Zadání pro **dlaždice vozovky**. Nahrazuje `Silnice` v `08-DLAZDICE.md`, kde
se popisuje pokus, který padl, a proč.

Generuje `tools/generate-roads.py`, ladí `tools/fit-roads.py`. Výstup jde do
`content/vanilla/roads/`.

## Co bylo špatně a co se změnilo

Autor: „ty silnice jsou hrozné! přece dokážeš definovat co je okolo, tedy víš,
kam která silnice vede, jestli končí, pokračuje, nebo je křižovatka!"

Má pravdu, bitmasku sousedů počítá `roadMask` od začátku. Padly ale dva
předchozí pokusy a oba na něčem jiném:

1. **Kreslené polygony.** Vozovka se počítala z rohů dlaždice a vyplňovala
   barvou. Spoje sedí, ale je z toho šedá stuha bez obrubníku a bez čar.
2. **Šestnáct hotových dlaždic na typ.** Vyplňovaly se do chunku a chunk je
   jedna kreslicí dávka: do ní se vejde jen pár různých textur, zbytek karta
   zahodí. Se čtyřiašedesáti dlaždicemi byla na silnici tráva.

Teď se mění **obojí**:

- vozovka jde jako **sprite, ne jako výplň v chunku**. Sprity se dávkují po
  svém a strop na počet obrázků tam není — přesně tak už fungují budovy
  a stromy;
- generuje se **sedm tvarů na typ, ne šestnáct**. Zbytek vznikne překlopením.

## Sedm tvarů místo šestnácti

Dlaždice se dá překlopit vodorovně (v mřížce to znamená prohodit `x` a `y`)
a svisle (otočit obojí). Ty dva pohyby dávají čtyřprvkovou grupu a šestnáct
masek se v ní rozpadne na **sedm oběžných drah**:

| obrázek | maska | co z něj ještě vznikne |
|---|---|---|
| `ew` | rovinka | `ns` |
| `ne` | zatáčka | `sw` |
| `nw` | zatáčka | `es` |
| `new` | odbočka T | `nes`, `esw`, `nsw` |
| `nesw` | křižovatka | — |
| `w` | slepý konec | `n`, `e`, `s` |
| `0` | samota | — |

Není to úspora peněz, ale **záruka**. Rovinka na sever a rovinka na východ
jsou tentýž obrázek, takže se nemůžou rozejít v šířce ani v odstínu. Přesně
na tom padl minulý pokus: 42 z 64 dlaždic mělo vozovku jinde než ostatní.

## Proč sprite unese i svah

Silnice si při stavbě srovnává příčný spád (`planRoadGradeAround`), takže
**graded dlaždice je vždycky rovnoběžník**: u severojižní se srovná západní
a východní dvojice rohů, u východozápadní severní a jižní, a zatáčka
s křižovatkou se srovnají celé. Rovnoběžník je afinní obraz čtverce, takže na
něj sprite sedne přesně — stačí mu nastavit matici z rohů dlaždice. Kdyby byla
dlaždice zkroucená do sedla, afinní zobrazení by nestačilo; po srovnání ale
sedlo nevznikne.

## Které strany jsou které

Tohle stálo celou první sadu. Prompt mluví o **hranách obrázku**, protože
„sever" si generátor přeloží jako směr k vrcholu kosočtverce. Jenže já ty
hrany převedl na světové strany špatně. V izometrii platí:

| hrana obrázku | směr v mřížce |
|---|---|
| vpravo nahoře | **sever** (`x`, `y − 1`) |
| vpravo dole | **východ** (`x + 1`, `y`) |
| vlevo dole | **jih** (`x`, `y + 1`) |
| vlevo nahoře | **západ** (`x − 1`, `y`) |

Plyne to z `gridToScreen`: soused na severu má `x` beze změny a `y` o jedna
míň, což je na obrazovce **doprava a nahoru**. Obrázky z první sady byly
v pořádku, jen se jmenovaly podle jiných stran — měření to ukázalo jako
17 z 19 vadných dlaždic a stačilo je přejmenovat.

## Styl

Doslova takhle, přidává se ke každému promptu:

```
A single square tile of GROUND for an isometric game map, seen from directly
above at the isometric angle. Soft-shaded three-dimensional render, NOT
a cartoon and NOT a photograph: no black outlines, no cel shading, no visible
brush strokes, no film grain. Soft daylight from the upper left.

The place is a Czechoslovak town in the 1980s: asphalt with patches, cast
concrete kerbs, mown grass with clover.

The ground fills the frame as a DIAMOND whose four corners touch the middle of
each edge of the square image. Everything outside that diamond is fully
transparent. The four pointed corners of the diamond are always grass.

THE CARRIAGEWAY IS EXACTLY ONE THIRD OF THE EDGE WIDE and crosses the middle of
the edge it leaves through. Where the carriageway does not leave, the edge is
grass all the way. A concrete kerb runs along both sides of the carriageway.

There are no cars, no people, no trees, no buildings, no lamp posts and no road
markings.

NO TEXT, NO LETTERS, NO NUMBERS, NO SIGNAGE, NO WATERMARK.
```

**Proč „strany, ne světové strany".** První sada četla „vozovka odchází
k severu" jako směr **k vrcholu** kosočtverce místo **přes jeho stranu**,
takže z křižovatky bylo `X` místo `+`. Prompt proto pojmenovává hrany doslova
a připomíná, že špičaté rohy jsou tráva.

**Proč bez čar a bez lamp.** Cokoli, co má navazovat přes hranici dlaždice,
kreslí renderer. Generátor to nikdy netrefí a přerušená čára je vidět víc než
žádná.

## Ulice

| id | prompt |
|---|---|
| `street__ew` | A narrow asphalt street crossing the tile straight through, entering at the middle of the upper-left edge and leaving at the middle of the lower-right edge. Grass on both sides. |
| `street__nw` | Exactly the reference crossroads tile, but with only two carriageways left: the one leaving through the middle of the upper-right edge and the one leaving through the middle of the upper-left edge. They meet in the centre of the tile in a quarter-circle bend. The other two carriageways are gone and their place is plain grass. The two carriageways that remain are in EXACTLY the same place and EXACTLY the same width as in the reference. |
| `street__ne` | Exactly the reference crossroads tile, but with only two carriageways left: the one leaving through the middle of the upper-right edge and the one leaving through the middle of the lower-right edge. They meet in the centre of the tile in a quarter-circle bend. The other two carriageways are gone and their place is plain grass. The two carriageways that remain are in EXACTLY the same place and EXACTLY the same width as in the reference. |
| `street__new` | A narrow asphalt street crossing from the middle of the upper-left edge to the middle of the lower-right edge, with a third branch leaving at the middle of the upper-right edge: a T junction. Grass fills the rest. |
| `street__nesw` | A narrow asphalt crossroads: carriageways leave through the middle of all four edges and meet in the centre of the tile. Grass in the four pointed corners only. |
| `street__w` | A narrow asphalt street entering at the middle of the upper-left edge and ending in the middle of the tile in a rounded dead end. Grass fills the rest. |
| `street__0` | A small square of asphalt in the middle of the tile with a kerb all the way round, not touching any edge. Grass fills the rest. |

## Třída

| id | prompt |
|---|---|
| `avenue__ew` | A wide asphalt avenue crossing the tile straight through, entering at the middle of the upper-left edge and leaving at the middle of the lower-right edge, darker and smoother than a side street. Narrow grass verges on both sides. |
| `avenue__nw` | Exactly the reference crossroads tile, but with only two carriageways left: the one leaving through the middle of the upper-right edge and the one leaving through the middle of the upper-left edge. They meet in the centre of the tile in a quarter-circle bend. The other two carriageways are gone and their place is plain grass. The two carriageways that remain are in EXACTLY the same place and EXACTLY the same width as in the reference. |
| `avenue__ne` | Exactly the reference crossroads tile, but with only two carriageways left: the one leaving through the middle of the upper-right edge and the one leaving through the middle of the lower-right edge. They meet in the centre of the tile in a quarter-circle bend. The other two carriageways are gone and their place is plain grass. The two carriageways that remain are in EXACTLY the same place and EXACTLY the same width as in the reference. |
| `avenue__new` | A wide asphalt avenue crossing from the middle of the upper-left edge to the middle of the lower-right edge, with a third branch leaving at the middle of the upper-right edge: a T junction. Grass fills the rest. |
| `avenue__nesw` | A wide asphalt crossroads: carriageways leave through the middle of all four edges and meet in a large square junction in the centre. Grass in the four pointed corners only. |
| `avenue__w` | A wide asphalt avenue entering at the middle of the upper-left edge and ending in the middle of the tile in a rounded dead end. Grass fills the rest. |
| `avenue__0` | A square of dark asphalt in the middle of the tile with a kerb all the way round, not touching any edge. Grass fills the rest. |

## Dálnice

| id | prompt |
|---|---|
| `highway__ew` | A very wide fresh dark asphalt highway crossing the tile straight through, entering at the middle of the upper-left edge and leaving at the middle of the lower-right edge, with a low concrete crash barrier along both sides. Thin grass verges. |
| `highway__nw` | Exactly the reference crossroads tile, but with only two carriageways left: the one leaving through the middle of the upper-right edge and the one leaving through the middle of the upper-left edge. They meet in the centre of the tile in a quarter-circle bend. The other two carriageways are gone and their place is plain grass. The two carriageways that remain are in EXACTLY the same place and EXACTLY the same width as in the reference. |
| `highway__ne` | Exactly the reference crossroads tile, but with only two carriageways left: the one leaving through the middle of the upper-right edge and the one leaving through the middle of the lower-right edge. They meet in the centre of the tile in a quarter-circle bend. The other two carriageways are gone and their place is plain grass. The two carriageways that remain are in EXACTLY the same place and EXACTLY the same width as in the reference. |
| `highway__new` | A very wide fresh dark asphalt highway crossing from the middle of the upper-left edge to the middle of the lower-right edge, with a third carriageway leaving at the middle of the upper-right edge: a large junction. Grass fills the rest. |
| `highway__nesw` | A very wide fresh dark asphalt highway crossroads: carriageways leave through the middle of all four edges and meet in a large open junction in the centre. Grass in the four pointed corners only. |
| `highway__w` | A very wide fresh dark asphalt highway entering at the middle of the upper-left edge and ending in the middle of the tile in a blunt closed end with a concrete barrier across it. Grass fills the rest. |
| `highway__0` | A square of fresh dark asphalt in the middle of the tile with a concrete barrier all the way round, not touching any edge. Grass fills the rest. |
