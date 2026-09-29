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

## T88: rameno je pruh, ne celá hrana

Po přechodu na počítaný tvar zůstala v `roadPolygons` chyba, kvůli které vypadaly
silnice pořád stejně špatně — a nebylo to obrázky.

Rameno se skládalo jako čtyřúhelník mezi zmenšeným středovým kusem a **plnou
hranou diamantu**. Parametr `width` tím pádem neřídil šířku vozovky, ale jen to,
jak daleko od středu rameno začíná, tedy jeho **délku**. Důsledky:

- silnice zabírala celou dlaždici až na čtyři rohové trojúhelníky, takže mezi
  domy nezbyl kousek trávy a nešlo poznat, kde vozovka končí;
- obrubník se kreslí jako **širší** kopie tvaru pod vozovkou — jenže „širší“
  znamenalo „s kratšími rameny“, takže ho vozovka celý zakryla a nebyl vidět
  nikdy;
- ulice, třída a dálnice vypadaly stejně, protože všechny tři sahaly na hranu.

Nová verze počítá v souřadnicích dlaždice `(u, v) ∈ [0,1]²` a promítá je
bilineárně přes čtyři rohy `tileQuad`. Při šířce `w` a `h = w/2`:

| kus | rozsah |
|---|---|
| střed | `[0,5−h, 0,5+h] × [0,5−h, 0,5+h]` |
| rameno N | `[0,5−h, 0,5+h] × [0, 0,5]` |
| rameno E | `[0,5, 1] × [0,5−h, 0,5+h]` |
| rameno S | `[0,5−h, 0,5+h] × [0,5, 1]` |
| rameno W | `[0, 0,5] × [0,5−h, 0,5+h]` |

Spoj drží dál: obě sousední dlaždice počítají z týchž sdílených rohů, takže pruh
jedné končí přesně tam, kde druhé začíná — hlídá to test „sousedé navazují bez
mezery“. A protože každá dlaždice kreslí **svou** šířku, přechod ulice → třída →
dálnice se stane přesně na hranici mezi nimi, bez jediné přechodové dlaždice.

Šířky se tím pádem musely přeškálovat, protože do té doby znamenaly něco jiného:

| typ | dřív (délka ramen) | teď (šířka vozovky) |
|---|---|---|
| ulice | 0,50 | 0,38 |
| třída | 0,68 | 0,55 |
| dálnice | 0,86 | 0,75 |

K šířce se ještě přičte `KERB = 0,08` na obrubník, takže i dálnice nechá kus
dlaždice volný.

**Poznámka ke schodišťovým trasám.** Když dvě rovnoběžné silnice vedou vedle
sebe schodovitě (drag přes dvě osy), zůstanou mezi nimi kosočtverce trávy
uzavřené asfaltem kolem dokola. Není to chyba geometrie — je to poctivý výsledek
dvou lomených tras vedle sebe. Kdyby to mělo vadit, řeší se to zaoblením zatáček,
ne šířkou.

## T89: silnice v sedle se rozbije

Autor poslal obrázek silnice, která po sesuvu zůstala stát **našikmo přes
zlom**, a napsal: „pokud k tomu dojde, musí být rozbitá, nepoužitelná".

### Co je vada

Ne sklon. Vozovka smí stoupat i být klopená — dlaždice je pak nakloněná rovina
a nakreslí se i projede. Vadné je **sedlo**: čtyři rohy, které neleží v jedné
rovině. Takový čtyřúhelník se láme po úhlopříčce a vozovka přes něj visí přes
zlom. Pozná se podle toho, že se nerovnají součty protilehlých rohů
(`nw + se ≠ ne + sw`); rovina ani rovnoběžný svah takový tvar nemají.

Predikát je `roadFitsTerrain` v `sim/roads.ts`.

**První pokus byl přísnější a byl špatně.** Ptal se na totéž, co vymáhá
`planRoadGrade` při stavbě, tedy i na příčný spád. Jenže rovnání běží jen pro
stavěnou dlaždici a její čtyři sousedy, kdežto kaskáda umí naklopit i silnici
o dvě dlaždice dál — a taková se v každém odehraném městě běžně vyskytuje, byť
se kreslí správně. Změřeno na fixturách savů: z 84 dlaždic sítě by po načtení
zbylo 35. Proto se hlídá jen zkroucení.

### Kdo couvne a komu se to rozbije

| kdo hne terénem | co se stane |
|---|---|
| srovnání pod zónou | **couvne** — `reshapeBlocker` vrátí `road` a plocha se dělí na menší, stejně jako kolem budov |
| stavba silnice | srovná si spád a **dorovná** rohy pod sousedními silnicemi; co dorovnat nejde, se odmítne (T101) |
| stavba budovy, ruční terraform | **dorovná** taky; co dorovnat nejde, se odmítne (T101) |
| sesuv půdy | rozbije |
| načtení savu | `repairUnsupportedRoads` projde mapu a rozbije, co je v sedle |

Rozbitá silnice zmizí z vrstvy a **nechá trosky**, takže hráč pozná, kde vedla,
a musí je uklidit, než postaví znovu. Hlásí se to tou hromadou, ne hláškou:
hláška by přišla uprostřed tažení štětcem a hráč by ji překlikl.

### Co to udělalo s referenčním městem

Sesuv v savu autora měl na svědomí **11 dlaždic ze 448**. Fixtury savů ztratily
dohromady 9 dlaždic, a jen jedna z osmi jich měla vůbec nějakou. Referenční
město ve zlatém testu přišlo o **jednu z pětadvaceti** — od `placeDefinition`.
Zbytek posunu v jeho číslech je tím, že se srovnávání pod zónami silnicím
vyhýbá, takže se pod městem přestal přesypávat terén; podrobně v komentáři
u `tests/golden/city.test.ts`.

## T101: pod silnicí se terén dorovná, nebourá se

Řádek „stavba budovy, ruční terraform → silnice se rozbije" platil rok a byl
špatně. Autor to viděl v hraní a rozhodl jednoznačně: **zbourání silnice nesmí
proběhnout, musí se upravit terén pod silnicí tak, aby bylo vše v pořádku.**

### Proč to bylo horší, než to vypadalo

Silnice byla do T129 **vodič elektřiny** (od T129 vede proud jen vedení a bloky zón a budov). Díra v ní odřízne čtvrť od elektrárny,
nenapájené domy neplatí daň a městu spadne příjem na nulu. Příkaz přitom vrátil
`ok` a odhad ceny mlčel — hráč se to nedozvěděl a hledal chybu v rozpočtu.

Změřeno (`tools/probe.ts`): větrník o jedné dlaždici postavený vedle rovné
ulice rozbil **dvě** dlaždice vozovky a proud se za ně už nedostal. A není to
okrajový jev — `tools/probe2.ts` na pěti generovaných mapách napočítal, že
**598 z 14 668** postavených dlaždic silnice zbořilo jinou. Čtyři procenta.

### Jak se dorovnává

`gradeForRoads` v `sim/roads.ts` vezme plán změn výšek a **rozšíří ho** o rohy,
které je potřeba dorovnat pod vozovkou. Hráčův záměr je nedotknutelný — rohy,
které si vyžádal, se nepřepisují; hýbe se jen volnými.

Ze čtyř rohů sedla se vybírá **nejtišší** volba, ne první, která projde. Roh
sdílejí čtyři dlaždice, takže špatná volba sedlo jen posune na souseda a to na
dalšího — vlna pak běží po celé ulici. Změřeno: s „ber první" přepsal jeden klik
až 68 rohů a sedlo skončilo sedmnáct dlaždic daleko. Skóre je proto počet
silnic, které by volba nechala v sedle; nula znamená hotovo.

Dlaždice, které byly v sedle **už před zásahem** (staré savy, sesuvy), se
nechávají být. Jinak by hráč platil za úklid cizí škody a jedno kliknutí u kraje
města by roztáhlo kaskádu přes půl mapy.

### Dorovnání je v ceně, ne překvapení na účtu

`estimatePlacement`, `estimateLevelArea` i odhad silnice se ptají na **týž**
plán jako samotný příkaz, takže v odhadu i v účtu stojí totéž číslo (§12
kritérium 14). Zlatý test to zaplatil: kasa 31 686 → 30 787, hashe vrstev jiné,
ale **budov 32, obyvatel 58, práce 50 beze změny** — dorovnání uklidilo terén
a do růstu nesáhlo.

### Co když to nejde

Roh na stropu výšek, nebo dlaždice, jejíž všechny čtyři rohy patří hráčovu
plánu. Pak se příkaz **odmítne** hláškou `error.terraformBreaksRoad`. Odmítnout
je jediná zbývající možnost: nakloněnou vozovku nechat nelze (kreslí se přes
zlom) a zbourat ji nesmíme.

Změřeno na týchž pěti mapách: po opravě je ztracených dlaždic **nula** a
odmítnutých staveb 287 ze 14 668, tedy dvě procenta — a to na hustém rastru
přes hory, který je horší než cokoli, co hráč postaví.

Sesuv půdy tudy nechodí. Tam se silnice bořit **má** a je to rozhodnutí z T89.
