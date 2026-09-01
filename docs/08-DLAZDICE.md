# Dlaždice: povrchy, silnice, potrubí

Zadání pro obrázky **země**, ne budov. Budovy mají `06-SPRITY-SLUZEB.md`
a `07-SPRITY-ZONY.md` a řídí se jinými pravidly: budova je samostatný předmět,
kdežto dlaždice musí navazovat na sousedy.

Generuje `tools/generate-tiles.py`, který prompty čte **odsud**, ne z tabulky
v sobě. Kdyby si je opsal, rozešly by se s dokumentem při první úpravě.

## Co se změnilo proti CLAUDE.md

`CLAUDE.md` do teď říkalo „terén a silnice zůstávají procedurální". **Autor to
změnil** zadáním „dogeneruj grafiku pro povrchy, silnice a potrubí". Až budou
obrázky zapojené, patří to do `CLAUDE.md` přepsat.

## Tvar dlaždice

Jedna dlaždice je kosočtverec **2 : 1**, v obrázku 512 × 256 po ořezu.
Generuje se na čtverci 1024 × 1024 a `tools/fit-tiles.py` z něj kosočtverec
vyřízne a zmáčkne na správný poměr — stejná cesta, jakou jdou budovy.

Nároží kosočtverce leží na středech stran čtverce: nahoře, vpravo, dole, vlevo.

## Navazování

Tohle je celý rozdíl proti budovám a taky největší riziko celého zadání.

- **Povrchy** navazovat nemusí přesně. Tráva, skála a les jsou organické, takže
  přechod mezi dvěma dlaždicemi nikdo nepozná. Proto se u nich nic nevynucuje.
- **Silnice a potrubí navazovat musí.** Vozovka vstupuje do dlaždice přesně
  ve **středu strany** kosočtverce a její šířku předepisuje typ. Kdyby to každá
  dlaždice měla jinak, byly by na každém spoji schody. Prompt to říká,
  `fit-tiles.py` to změří a co nesedí, ohlásí.

**Strany, ne světové strany.** První dávka řekla „vozovka odchází k severu",
a generátor si to přeložil jako směr **k vrcholu** kosočtverce místo **přes
jeho stranu**. Křižovatka pak vyšla jako `X` místo `+` a slepé konce mířily
jinam, než měly. Prompt proto pojmenovává strany doslova („upper-right side")
a zvlášť říká, že čtyři špičaté rohy jsou vždycky tráva.

**Šířka se měří proti sobě, ne proti zadání.** Pro spoj není podstatné, jak je
vozovka široká, ale jestli je na obou stranách stejná. `fit-tiles.py` proto
srovnává s **mediánem rodiny**, ne s pevným číslem — jinak by zahodil obrázky,
které na sebe sedí.

## Styl

Stejná hlavička jako u budov, jen bez věty o budově. Doslova takhle:

```
A single piece of GROUND for an isometric game map. THERE IS NO BUILDING in
this image: no house, no block of flats, no shed, no wall, no fence, no vehicle
and no person. Nothing stands up from the ground except what the description
below names. This is the ground itself, nothing else.

Isometric 2:1 projection, top-down-at-30-degrees view, soft daylight from the
upper left, subtle contact shadows. Soft-shaded three-dimensional render, NOT
a cartoon and NOT a photograph: no black outlines, no cel shading, no visible
brush strokes, no lens blur, no film grain. Colours are natural but a touch
more saturated than reality, so the tile reads at small size.

The place is central Europe, the materials those of a Czechoslovak town in the
1980s: cast concrete, asphalt with patches, granite kerbs, mown grass with
clover, birch and linden.

The ground fills the frame as a DIAMOND whose four corners touch the middle of
each edge of the square image. Everything outside that diamond is fully
transparent — no background, no vignette, no shadow outside the diamond. The
ground is seen from directly above at the isometric angle and its surface is
flat; do not draw its side walls or thickness.

NO TEXT, NO LETTERS, NO NUMBERS, NO SIGNAGE, NO WATERMARK.
```

## Vzory

Povrch se generuje **s referenčním obrázkem**, ne jen z popisu. Rozhodnutí
autora, a má dobrý důvod: tráva a písek, které v parkových spritech vyšly, jsou
přesně to, co má být na zemi — stejné měřítko, stejné světlo, stejný styl. Popsat
to slovy podruhé znamená vymýšlet, co už existuje.

| povrch | vzor | co se z něj bere |
|---|---|---|
| `grass` | `park_small__a.png` | trávník pod stromem |
| `sand` | `park_small__c.png` | písek z pískoviště |
| `rock` | `park_small__a.png` | kamenné obruby a dlažba |
| `forest` | `city_park__a.png` | koruny stromů shora |
| `marsh` | `park_small__b.png` | voda a mokrá dlažba u kašny |
| `water` | `park_small__b.png` | hladina kašny |

Vzory jsou **hotové sprity z `content/vanilla/sprites/`**, ne zvláštní soubory:
kdyby se vedle nich vedla druhá sada, rozešly by se.

Ke každému promptu se vzorem se přidá ještě tahle věta, jinak se vzor
překreslí i s lavičkou a stromem:

```
The reference image shows this material in a real place. Copy ONLY its ground
material, its colour and its light. Do NOT copy anything that stands on it or
around it: no tree, no bench, no fence, no lamp, no kerb, no path, no paving,
no toy, no fountain. The result is that bare material alone, edge to edge.
```

## Povrchy

Tři varianty od každého, aby se sousední dlaždice neopakovaly. Losuje se stejně
jako u budov, podle souřadnic dlaždice.

**Varianta je totéž jinak, ne něco jiného.** První pokus dal trávě plešinu
s kameny a vyšlapanou pěšinu — jenže při třech variantách by ta plešina byla na
každé třetí dlaždici a z mapy by byl leopard. Varianty se proto liší jen
odstínem, hustotou a drobnostmi; nic, co by šlo poznat jako **místo**.

**Ale nesmí se psát „the same".** Druhý pokus popsal variantu b jako „the same
lawn, a shade deeper" — a protože se generuje **s referenčním obrázkem**, model
to přečetl jako „nech to být" a vrátil skoro nezměněný park i s prolézačkami.
Každá varianta se proto popisuje **celou větou od začátku**, i když se od
sousední liší jen odstínem.

**Co vzor umí a co ne — změřeno na hotové sadě.** Reference pomůže jen tam, kde
ten materiál ve zdrojovém spritu opravdu je:

| povrch | výsledek |
|---|---|
| `grass` | 3 ze 3 použitelné — v parku trávník je |
| `sand` | 1 ze 3; `a` opsalo i betonový rám pískoviště, `b` vyšlo jako zorané pole |
| `rock` | 0 ze 3 — v parku není holá skála, jen dlažba, a tu to opsalo i se spárami |
| `forest` | 0 ze 3 — park viděný z izometrie nemá zápoj korun shora, vyšla tráva |
| `marsh` | 2 ze 3, `c` vyšla jako tráva |
| `water` | 0 ze 3 — z kašny to vzalo dlažbu s kruhem, ne hladinu |

Skála a les takhle nepůjdou nikdy: ten materiál nemá odkud vzít. **Patří to
k autorovu nápadu udělat z nich objekty** — strom a balvan jsou předměty, a ty
generátor umí.

### `grass`

Trávník jako v parku pod stromem, odkud je vzor. Žádná cesta, žádná plešina.

| | prompt |
|---|---|
| **a** | Even mown lawn, uniform all over, a few clover leaves. |
| **b** | Even mown lawn in a deeper green, dense and uniform all over. |
| **c** | Even mown lawn in a lighter, drier green, uniform all over, a few tiny daisies. |

### `forest`

Souvislý zápoj korun shora. Jednotlivý strom sem nepatří — od toho je objekt.

| | prompt |
|---|---|
| **a** | Continuous deciduous canopy from above, crowns touching, dark gaps between them. |
| **b** | Continuous deciduous canopy from above in a deeper green, crowns packed tight. |
| **c** | Continuous deciduous canopy from above in a lighter green, crowns touching. |

### `rock`

| | prompt |
|---|---|
| **a** | Bare grey granite, weathered and evenly cracked all over. |
| **b** | Bare grey granite, darker and damp, evenly cracked all over. |
| **c** | Bare pale granite, dry and evenly cracked all over, with fine lichen. |

### `sand`

Písek jako v pískovišti, odkud je vzor.

| | prompt |
|---|---|
| **a** | Clean fine sand, evenly raked, uniform all over. |
| **b** | Clean fine sand, damp and darker, evenly raked, uniform all over. |
| **c** | Clean pale sand, dry and evenly raked, uniform all over, a scatter of tiny pebbles. |

### `marsh`

| | prompt |
|---|---|
| **a** | Waterlogged ground: dark peat under a even cover of low sedge. |
| **b** | Waterlogged dark peat under an even cover of low sedge, wetter and darker. |
| **c** | Damp peat under a dense even cover of low sedge, little standing water. |

### `water`

| | prompt |
|---|---|
| **a** | Calm fresh water with fine even ripples all over. |
| **b** | Deep calm fresh water, darker, with fine even ripples all over. |
| **c** | Shallow calm fresh water, lighter, with very fine even ripples all over. |

## Silnice

Šestnáct tvarů podle toho, kam vozovka pokračuje. Maska je `N = 1, E = 2,
S = 4, W = 8`, a **N je v izometrii směr doprava nahoru** — tak ji počítá
`src/sim/roads.ts`.

Tři typy vozovky se liší šířkou a povrchem, tvary jsou stejné. Prompt tvaru se
skládá z popisu typu a popisu tvaru, takže se tvary nepíšou třikrát.

### Typy

| id | popis |
|---|---|
| `street` | A narrow residential street: worn asphalt, granite kerbs, a strip of grass along each side. The carriageway with its kerbs is ONE QUARTER of the length of the side it crosses. |
| `avenue` | A wide two-lane road: darker asphalt, a painted centre line worn thin, concrete kerbs and a paved verge. The carriageway with its kerbs is ONE THIRD of the length of the side it crosses. |
| `highway` | A four-lane trunk road: fresh dark asphalt, a crash barrier along both shoulders, gravel verge. The carriageway with its shoulders is ONE HALF of the length of the side it crosses. |

### Tvary

| maska | id | prompt |
|---|---|---|
| 0 | `0` | A short stub of carriageway that touches no side of the diamond at all; grass all around it. |
| 1 | `n` | The carriageway crosses the UPPER-RIGHT side of the diamond and ends inside the tile in a turning head. It touches no other side. |
| 2 | `e` | The carriageway crosses the LOWER-RIGHT side of the diamond and ends inside the tile in a turning head. It touches no other side. |
| 3 | `ne` | The carriageway runs between the UPPER-RIGHT side and the LOWER-RIGHT side of the diamond, and touches no other side. |
| 4 | `s` | The carriageway crosses the LOWER-LEFT side of the diamond and ends inside the tile in a turning head. It touches no other side. |
| 5 | `ns` | The carriageway runs between the UPPER-RIGHT side and the LOWER-LEFT side of the diamond, and touches no other side. |
| 6 | `es` | The carriageway runs between the LOWER-RIGHT side and the LOWER-LEFT side of the diamond, and touches no other side. |
| 7 | `nes` | A T junction: the carriageway crosses the UPPER-RIGHT side, the LOWER-RIGHT side and the LOWER-LEFT side of the diamond, and touches no other side. |
| 8 | `w` | The carriageway crosses the UPPER-LEFT side of the diamond and ends inside the tile in a turning head. It touches no other side. |
| 9 | `nw` | The carriageway runs between the UPPER-RIGHT side and the UPPER-LEFT side of the diamond, and touches no other side. |
| 10 | `ew` | The carriageway runs between the LOWER-RIGHT side and the UPPER-LEFT side of the diamond, and touches no other side. |
| 11 | `new` | A T junction: the carriageway crosses the UPPER-RIGHT side, the LOWER-RIGHT side and the UPPER-LEFT side of the diamond, and touches no other side. |
| 12 | `sw` | The carriageway runs between the LOWER-LEFT side and the UPPER-LEFT side of the diamond, and touches no other side. |
| 13 | `nsw` | A T junction: the carriageway crosses the UPPER-RIGHT side, the LOWER-LEFT side and the UPPER-LEFT side of the diamond, and touches no other side. |
| 14 | `esw` | A T junction: the carriageway crosses the LOWER-RIGHT side, the LOWER-LEFT side and the UPPER-LEFT side of the diamond, and touches no other side. |
| 15 | `nesw` | A crossroads: the carriageway crosses all four SIDES of the diamond — upper-right, lower-right, lower-left and upper-left. It does NOT run to the four pointed corners of the diamond; those corners are grass. |

Ke každému tvaru se přidá věta o navazování, kterou skript doplní sám:

```
The diamond has four SIDES (upper-right, lower-right, lower-left, upper-left)
and four pointed CORNERS (top, right, bottom, left). Roads leave through the
SIDES, never through the corners: the four pointed corners are always grass.

Where the carriageway crosses a side it must cross exactly at the MIDDLE of
that side, at a right angle to it, and keep the width given above along the
whole crossing, so that neighbouring tiles line up. Sides with no connection
are closed off with a kerb.
```

## Potrubí

Kreslí se **pod zemí** a je vidět jen v podzemním pohledu, takže se nekreslí
povrch, ale výkop: potrubí v otevřené rýze na tmavém podloží. Tvary jsou tytéž
jako u silnic a skládají se stejně.

| id | popis |
|---|---|
| `pipe` | A buried water main in an open trench: a grey concrete pipe on a bed of gravel, dark earth around it. |

Věta o navazování je stejná, jen místo „carriageway" je „pipe".
