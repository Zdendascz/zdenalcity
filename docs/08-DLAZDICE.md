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
  ve **středu strany** a je široká **polovinu strany**. Kdyby to každá dlaždice
  měla jinak, byly by na každém spoji schody. Prompt to říká, `fit-tiles.py` to
  změří a co nesedí, ohlásí.

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

## Povrchy

Tři varianty od každého, aby se sousední dlaždice neopakovaly. Losuje se stejně
jako u budov, podle souřadnic dlaždice.

### `grass`

| | prompt |
|---|---|
| **a** | Mown lawn grass, even and short, a few clover patches and two dandelions. |
| **b** | Rougher meadow grass with a bald patch of dry earth and a scatter of small stones. |
| **c** | Lawn grass with a shallow worn footpath crossing it diagonally, edges frayed into the turf. |

### `forest`

| | prompt |
|---|---|
| **a** | Dense deciduous canopy seen from above: linden and birch crowns touching, dark gaps between them. |
| **b** | Mixed woodland canopy, two spruces among broadleaf crowns, a sliver of forest floor visible at one edge. |
| **c** | Thinner woodland: four separate crowns with grass and leaf litter between them. |

### `rock`

| | prompt |
|---|---|
| **a** | Bare grey granite bedrock, weathered and cracked, with lichen in the fissures. |
| **b** | Broken rock: angular boulders and scree over pale stone, sparse dry grass in the gaps. |
| **c** | Rounded rock outcrop, smooth grey stone with a shallow ledge and moss on the north side. |

### `sand`

| | prompt |
|---|---|
| **a** | Fine river sand, rippled by wind, a few small pebbles. |
| **b** | Coarse sand with gravel, damp in patches, one piece of driftwood. |
| **c** | Dry pale sand with sparse tufts of marram grass. |

### `marsh`

| | prompt |
|---|---|
| **a** | Boggy ground: dark waterlogged peat, tussocks of sedge, two shallow pools reflecting the sky. |
| **b** | Reed bed in shallow water, dense stems, the water dark between them. |
| **c** | Wet meadow turning to bog, coarse grass with standing water in the hollows. |

### `water`

| | prompt |
|---|---|
| **a** | Calm fresh water, gentle ripples, the bottom faintly visible as a darker green. |
| **b** | Water with a light breeze on it: small waves catching the daylight. |
| **c** | Deeper water, darker and quieter, a few floating leaves. |

## Silnice

Šestnáct tvarů podle toho, kam vozovka pokračuje. Maska je `N = 1, E = 2,
S = 4, W = 8`, a **N je v izometrii směr doprava nahoru** — tak ji počítá
`src/sim/roads.ts`.

Tři typy vozovky se liší šířkou a povrchem, tvary jsou stejné. Prompt tvaru se
skládá z popisu typu a popisu tvaru, takže se tvary nepíšou třikrát.

### Typy

| id | popis |
|---|---|
| `street` | A narrow residential street: worn asphalt, granite kerbs, a strip of grass along each side. |
| `avenue` | A wide two-lane road: darker asphalt, a painted centre line worn thin, concrete kerbs and a paved verge. |
| `highway` | A four-lane trunk road: fresh dark asphalt, a crash barrier along both shoulders, gravel verge. |

### Tvary

| maska | id | prompt |
|---|---|---|
| 0 | `0` | An isolated square of carriageway with no connections, its edges finished with kerbs. |
| 1 | `n` | The carriageway ends here and leaves only towards the upper right; the other three sides are kerbed. |
| 2 | `e` | The carriageway ends here and leaves only towards the lower right; the other three sides are kerbed. |
| 3 | `ne` | A bend joining the upper-right edge to the lower-right edge. |
| 4 | `s` | The carriageway ends here and leaves only towards the lower left; the other three sides are kerbed. |
| 5 | `ns` | A straight run entering at the upper-right edge and leaving at the lower-left edge. |
| 6 | `es` | A bend joining the lower-right edge to the lower-left edge. |
| 7 | `nes` | A T junction: a straight run from the upper right to the lower left, with a branch to the lower right. |
| 8 | `w` | The carriageway ends here and leaves only towards the upper left; the other three sides are kerbed. |
| 9 | `nw` | A bend joining the upper-right edge to the upper-left edge. |
| 10 | `ew` | A straight run entering at the lower-right edge and leaving at the upper-left edge. |
| 11 | `new` | A T junction: a straight run from the lower right to the upper left, with a branch to the upper right. |
| 12 | `sw` | A bend joining the lower-left edge to the upper-left edge. |
| 13 | `nsw` | A T junction: a straight run from the upper right to the lower left, with a branch to the upper left. |
| 14 | `esw` | A T junction: a straight run from the lower right to the upper left, with a branch to the lower left. |
| 15 | `nesw` | A crossroads: carriageway leaving all four edges. |

Ke každému tvaru se přidá věta o navazování, kterou skript doplní sám:

```
Where the carriageway meets an edge of the diamond it must cross exactly at
the middle of that edge and be exactly half the length of the edge wide, so
that neighbouring tiles line up. Edges with no connection are closed off.
```

## Potrubí

Kreslí se **pod zemí** a je vidět jen v podzemním pohledu, takže se nekreslí
povrch, ale výkop: potrubí v otevřené rýze na tmavém podloží. Tvary jsou tytéž
jako u silnic a skládají se stejně.

| id | popis |
|---|---|
| `pipe` | A buried water main in an open trench: a grey concrete pipe on a bed of gravel, dark earth around it. |

Věta o navazování je stejná, jen místo „carriageway" je „pipe".
