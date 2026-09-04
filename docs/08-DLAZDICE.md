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

SCALE MATTERS MORE THAN DETAIL. This piece of ground is EIGHT METRES across and
is seen from far above, the way a whole town is seen on a map. Individual grains
of sand, single pebbles, single blades of grass and single leaves are FAR too
small to see and must not be drawn. What is visible is the material as one
surface: its colour, its soft light, and broad gentle variation across metres.
Think of ground photographed from a tall building, not of a close-up sample.

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
| `marsh` | `park_small__b.png` | mokrá zem u kašny |

**Skála, les a voda vzor nemají**, a je to schválně. V parku není holá skála ani
zápoj korun shora a z kašny se dá opsat jen dlažba — první pokus přesně tak
dopadl, 0 ze 3 u všech tří. Bez vzoru se aspoň kreslí materiál, ne obkreslený
park. Rozhoduje o tom tabulka: povrch, který v ní není, se generuje z popisu.

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

**Odlesk je taky směr.** Voda dostala „fine ripples" a generátor k nim přidal
bílé hřebeny a jiskření na slunci. Odlesk míří vždycky stejným směrem, takže se
přes hranice dlaždic složil do pruhů — týž manšestr jako u trávy, jen na vodě.
Prompt proto vyjmenovává, co tam **nemá** být: vlny, bílé hřebeny, jiskření
a pěna.

**Široká proměnlivost patří sklonu, ne kresbě.** Tráva měla „faint broad
patches of lighter and darker green" a každá dlaždice si to flekování udělala
po svém — z mapy byl ubrus. Světlo svahu tu proměnlivost dodá samo a zadarmo,
takže obrázek má být **na celé ploše stejný**.

**A materiál se kreslí z dálky, ne zblízka.** Písek vyšel jako fotka zrnek
s rýhami po hrábích a vedle pískoviště v parku vypadal katastrofálně — autor to
nahlásil. Generátor totiž kreslí materiál, jako bys nad ním stál. Hlavička proto
říká, že dlaždice je **osm metrů široká** a že jednotlivé zrnko, kamínek ani
stéblo v ní vidět nejsou.

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
| **a** | Mown lawn seen from far above: one even green surface, the same everywhere, fine short texture and no patches. The light is perfectly flat and even across the whole image: NO shadow, NO vignette, NO darker corner, NO darker band, NO patch of a different green, NO mowing stripes. Every part of the image is exactly as bright as every other part. |
| **b** | Mown lawn seen from far above in a deeper green: one even surface, the same everywhere, fine short texture and no patches. The light is perfectly flat and even across the whole image: NO shadow, NO vignette, NO darker corner, NO darker band, NO patch of a different green, NO mowing stripes. Every part of the image is exactly as bright as every other part. |
| **c** | Mown lawn seen from far above in a lighter green: one even surface, the same everywhere, fine short texture and no patches. The light is perfectly flat and even across the whole image: NO shadow, NO vignette, NO darker corner, NO darker band, NO patch of a different green, NO mowing stripes. Every part of the image is exactly as bright as every other part. |

**„No patches" nestačilo.** První sada to v promptu měla a stejně přišel tmavší
pruh přes třetinu dlaždice — autor to nahlásil slovy „nebýt toho tmavšího fleku
přes třetinu trávy, tak i tráva by byla boží". Generátor totiž nekreslí flek,
ale **světlo**: stín, vinětu, přechod. Zakázat se proto musí ta světelná
proměnlivost jmenovitě, ne jen „skvrny". Stejné poučení jako u `asphalt_avenue`
— vyjmenovat, co tam nesmí být.

Písek a mokrou zem to **netrápí**, i když mají naměřený přechod taky vysoký:
autor je označil za dobré („písek je boží, hlína taky"), takže se nesahá.
Měřítko rozhoduje oko, ne číslo.

### `forest`

**Lesní půda, ne koruny.** Napoprvé to byl zápoj korun viděný shora a vyšly
z toho dvacet korun na dlaždici — jenže dlaždice je osm metrů a koruna
vzrostlého stromu je skoro celá. Stromy proto kreslí **objekt**, a povrch je
jen to, na čem stojí.

| | prompt |
|---|---|
| **a** | Forest floor seen from far above: grass and leaf litter in shade, one even surface, the same everywhere. |
| **b** | Forest floor seen from far above in deeper shade: dark grass and leaf litter, one even surface, the same everywhere. |
| **c** | Forest floor seen from far above: mossy ground with fallen leaves, one even surface, the same everywhere. |

### `rock`

| | prompt |
|---|---|
| **a** | Bare rocky ground seen from far above: grey stone, one even surface, the same everywhere. |
| **b** | Bare rocky ground seen from far above: darker grey stone, one even surface, the same everywhere. |
| **c** | Bare rocky ground seen from far above: pale grey stone, one even surface, the same everywhere. |

### `sand`

Písek jako v pískovišti, odkud je vzor.

| | prompt |
|---|---|
| **a** | Dry sand seen from far above: a smooth even surface, no grain, faint broad shading. |
| **b** | Damp sand seen from far above: a smooth even surface, darker, no grain, faint broad shading. |
| **c** | Pale dry sand seen from far above: a smooth even surface, no grain, very faint broad shading. |

### `marsh`

| | prompt |
|---|---|
| **a** | Boggy ground seen from far above: dark wet earth showing through an even cover of low sedge. |
| **b** | Wet boggy ground seen from far above: darker, with broad shallow pools among low sedge. |
| **c** | Damp peat under a dense even cover of low sedge, little standing water. |

### `water`

| | prompt |
|---|---|
| **a** | Open water seen from far above: one flat even blue-green surface, the same everywhere. No waves, no white crests, no sun glitter, no foam, no shore, no bottom. The light is perfectly flat and even across the whole image: NO shadow, NO vignette, NO darker corner, NO darker band, NO gradient from one side to the other. Every part of the image is exactly as bright as every other part. The surface carries a fine even mottling with no direction, like still water seen from a height. |
| **b** | Deep open water seen from far above: one flat even dark blue surface, the same everywhere. No waves, no white crests, no sun glitter, no foam, no shore, no bottom. The light is perfectly flat and even across the whole image: NO shadow, NO vignette, NO darker corner, NO darker band, NO gradient from one side to the other. Every part of the image is exactly as bright as every other part. The surface carries a fine even mottling with no direction, like still water seen from a height. |
| **c** | Open water seen from far above: one flat even lighter blue surface, the same everywhere. No waves, no white crests, no sun glitter, no foam, no shore, no bottom. The light is perfectly flat and even across the whole image: NO shadow, NO vignette, NO darker corner, NO darker band, NO gradient from one side to the other. Every part of the image is exactly as bright as every other part. The surface carries a fine even mottling with no direction, like still water seen from a height. |

**Voda je nejcitlivější povrch na mapě a je za tím jedno číslo.** Ořez okraje
spravil mřížku všude kromě ní — autor to popsal přesně: „na trávu a hlínu to
zabralo skvěle, ale na vodu vůbec". Rozhoduje poměr **širokého přechodu ke
kontrastu uvnitř dlaždice**:

| povrch | široký přechod | kontrast | poměr |
|---|---|---|---|
| tráva | 6 | 20,3 | 0,3 |
| mokřad | 33 | 25,1 | 1,3 |
| písek | 29 | 11,4 | 2,5 |
| voda | 10 | 3,7 | **2,7** |

Vodě stačí přechod 10, aby byla nejhorší z celé sady: nemá **žádnou vlastní
kresbu**, která by ho schovala. „Only a very faint fine texture" v prvním
promptu udělalo přesně to — hladkou plochu, na které je pak vidět každý
přechod, a otáčení po dlaždicích z něj udělá schod na každém spoji.

Prompt proto dělá dvě věci naráz: zakazuje přechod jmenovitě, jako u trávy,
a zároveň žádá **jemné nesměrové mramorování** místo „skoro nic". Vlny,
hřebeny a jiskření zůstávají zakázané — ty tu už jednou udělaly manšestr.

## Objekty na terénu

Les a skála **nejsou jen povrch**. Rozhodnutí autora: strom a balvan jsou
předměty, a ty generátor umí prokazatelně dobře — 228 spritů budov to ukázalo,
kdežto jako materiál skála i les napoprvé selhaly.

Kreslí se **navrch povrchu**, ne místo něj: pod lesem zůstane tráva, pod skálou
holá zem. Je to čistě věc rendereru — v simulaci žádná entita nepřibývá, takže
les o dvou tisících dlaždicích nestojí ani jeden objekt navíc v `world`.

Generují se sem, ale ukládají do `art/sprites/raw/`, protože je pak ladí
`fit-sprites.py` jako každý jiný předmět: měří se jim kotva, ne kosočtverec.

| id | půdorys | patra | co to je |
|---|---|---|---|
| `forest_clump` | 2 × 2 | 3 | jeden až dva vzrostlé stromy |
| `boulders` | 1 × 1 | 1 | balvany a kamení |

Strom má půdorys **2 × 2, i když stojí na jedné dlaždici**. Není to rozpor:
půdorys tu určuje jen to, jak velký obrázek se vyrobí. Vzrostlý strom je proti
osmimetrové dlaždici širší než ona a namačkat ho do její šířky znamená mít
v lese samé zakrslíky — autor to nahlásil slovy „stromy maličké, oproti těm
v parku".

Hlavička je jiná než u dlaždic a musí být **důrazná**. Napoprvé stálo v prvním
řádku „for an isometric game map" a generátor z toho udělal dlaždici i se
silnicemi kolem stromů — slovo „map" a „tile" ho k tomu svádí. Teď se v ní
o dlaždici ani o mapě nemluví a výčet toho, co tam nemá být, je dlouhý schválně:

```
A CUT-OUT OBJECT, alone on a fully transparent background.

THERE IS NO GROUND IN THIS IMAGE. No grass, no soil, no rock plate, no paving,
no road, no kerb, no plot, no tile, no square, no frame, no base, no border.
Only the objects themselves, cut out and floating free, with a small soft
shadow directly beneath them and nothing else.

Seen from a high angle, about thirty degrees above the horizon, the way things
are shown in an isometric game. Daylight from the upper left. Soft-shaded
three-dimensional render, NOT a cartoon and NOT a photograph: no black
outlines, no cel shading, no visible brush strokes. Colours natural but a touch
more saturated, so it reads at small size.

Central Europe, the 1980s. The objects together are about as wide as a small
house is long.

NO TEXT, NO LETTERS, NO NUMBERS, NO WATERMARK.
```

### `forest_clump`

| | prompt |
|---|---|
| **a** | ONE big mature linden tree, a full round crown and a thick trunk, filling the picture. |
| **b** | TWO tall birches side by side, slender white trunks, light open crowns, filling the picture. |
| **c** | ONE big spruce, a dark conical crown down to the ground, filling the picture. |

### `boulders`

| | prompt |
|---|---|
| **a** | ONE large grey granite boulder, taller than a man, weathered and lichen-spotted, filling the picture. |
| **b** | TWO grey boulders lying side by side, one split, filling the picture. |
| **c** | THREE rounded grey stones together, the biggest as tall as a man, filling the picture. |

## Katastrofy na ulici

Nepřírodní katastrofy se odehrávají **na silnici**: hromadná nehoda na
křižovatce, nepokoje a stávka v ulici. Do T92 o nich mapa mlčela — hráč viděl
jen ikonu u hodin a musel hádat kde. Autor navrhl to samé, co u trosek: „daly by
se taky vytvořit formou obrázku, jako třeba u nepokojů izometrický obrázek
protestujících na ulici".

Jsou to **předměty, ne dlaždice**: vystřižený objekt s kotvou, který se posadí
na místo, kde katastrofa vznikla. Stejná hlavička jako u stromů a balvanů —
obrázek nesmí přinést vlastní zem, jinak by pod ním zmizela vozovka.

Tři varianty na druh, aby dvě nehody vedle sebe nevypadaly jako jedna. Vybírá
se **podle id katastrofy**, takže se varianta při překreslení nemění.

### `riot_crowd`

| | prompt |
|---|---|
| **a** | A CROWD OF ABOUT TWENTY PEOPLE standing close together in a protest, arms raised, holding plain blank banners on wooden poles, winter coats and hats, filling the picture. |
| **b** | A CROWD OF ABOUT FIFTEEN PEOPLE in a protest around an overturned metal rubbish bin, a few holding plain blank placards, thin smoke drifting up, filling the picture. |
| **c** | TWO GROUPS FACING EACH OTHER: a crowd of protesters on one side and a short line of policemen with plain riot shields on the other, filling the picture. |

### `pileup_wreck`

| | prompt |
|---|---|
| **a** | THREE small 1980s cars crashed into one another, crumpled bonnets, one door hanging open, broken glass and debris scattered around them, filling the picture. |
| **b** | A BOX LORRY jack-knifed across the picture with two small 1980s cars crashed into its side, scattered debris, filling the picture. |
| **c** | TWO small 1980s cars after a head-on crash, one tipped onto its side, a third car stopped behind them, debris on the ground, filling the picture. |

## Silnice

**Šestnáct hotových dlaždic na typ se zahazuje.** Vygenerovaly se, změřily
a padly: 42 ze 64 má vozovku jinde, než má. Generátor pevné místo na hraně
netrefí a doladit se to slovy nedá — je to mez nástroje, ne promptu.

**A zapojit je ani nejde.** Autor je chtěl vidět v běhu, tak jsem je zapojil —
a rozbil tím kreslení: chunk je jedna dávka a do té se vejde jen pár různých
textur. Se šesti povrchy to prošlo, se čtyřiašedesáti dlaždicemi vozovky navrch
karta část výplní zahodila a část vzala z cizí textury, takže na silnici byla
tráva. Přitom **jsem ten strop sám změřil o den dřív**. Revertováno.

Nejde tedy jen o to, že jsou dlaždice vozovky nepřesné. Ani kdyby přesné byly,
šestnáct tvarů na typ se do jedné dávky nevejde — a tím padá celý ten přístup,
ne jen tahle sada.

Návrh je proto obrácený: **tvar vozovky se počítá, obrázek dodá jen povrch.**

### Proč to takhle vůbec jde

Půlka řešení už v kódu je. `roadPolygons` v `src/render/roads.ts` skládá vozovku
ze **středového kusu a ramen**, a všechny jejich vrcholy odvozuje z rohů
dlaždice. Sousední dlaždice tedy sdílejí tytéž rohy a **spoj sedí ze zásady**,
ne náhodou. Šířku dává `ROAD_WIDTHS` jako podíl dlaždice: ulice 0,5, třída 0,68,
dálnice 0,86.

Dneska se ty polygony vyplňují plochou barvou z `ROAD_COLORS`. Návrh je jediná
změna: **místo barvy textura**, přesně jak to od T72 dělá povrch terénu.

**Hotovo.** Tři materiály se vygenerovaly, změřily a jsou zapojené. Kolik
textur se do dávky vejde, už není odhad: `MAX_TEXTURE_IMAGE_UNITS` je na tomhle
stroji **16**, takže šest povrchů plus tři asfalty (devět) projde s rezervou —
a taky prošlo, bez jediné skvrny. Šestnáct tvarů na typ by bylo osmačtyřicet
textur, tedy trojnásobek stropu; sedí to na to, co se dřív jen pozorovalo
(s osmnácti skvrny byly, se šesti ne).

Jas změřený na hotových dlaždicích: ulice 121, třída 97, dálnice 64. Vychází
z toho, co prompty říkají — ulice je vyšlapaná a šedá, dálnice čerstvá a tmavá.

### Co se generuje

Ne šestnáct tvarů, ale **jeden materiál na typ vozovky**. Tři obrázky místo
osmačtyřiceti:

| id | prompt |
|---|---|
| `asphalt_street` | Worn asphalt seen from far above: one even grey surface, patched and cracked, the same everywhere. This is bare road surface only. There is NO kerb, NO pavement, NO footpath, NO grass, NO tree, NO bush, NO road marking and NO junction anywhere in the image: the asphalt reaches every edge. |
| `asphalt_avenue` | Darker asphalt seen from far above: one even surface, smoother, the same everywhere. This is bare road surface only. There is NO kerb, NO pavement, NO footpath, NO grass, NO tree, NO bush, NO road marking and NO junction anywhere in the image: the asphalt reaches every edge. |
| `asphalt_highway` | Fresh dark asphalt seen from far above: one even surface, the same everywhere. This is bare road surface only. There is NO kerb, NO pavement, NO footpath, NO grass, NO tree, NO bush, NO road marking and NO junction anywhere in the image: the asphalt reaches every edge. |

**Ta druhá věta tam být musí.** První pokus ji neměl a `asphalt_avenue` vyšla
jako **celá scéna ulice** — zatáčka s obrubníkem, chodníkem, keři a stromy.
„One even surface, the same everywhere" generátoru nestačí; slovo *asphalt* si
přeloží jako *silnice i s okolím*. Vyjmenovat, co tam nesmí být, funguje —
stejné poučení jako u vzorů z parku, kde se muselo zvlášť zakázat lavička
a strom.

Nešlo to přitom poznat, dokud se neopravilo mapování: při šestinásobném
opakování na dlaždici byla z té scény jen šedá kaše.

Platí pro ně totéž co pro povrchy: **z dálky, ne zblízka**, žádný směr, žádné
místo, které by šlo poznat. Jednotlivá spára ani kámen v dlaždici vidět nejsou.

### Co se kreslí, a ne generuje

Všechno, co musí lícovat. **Zatím nic z toho hotové není** — vozovka má materiál,
ale ještě ne obrubu ani čáry:

- **obrubník** — obtah kolem polygonu vozovky, ne kresba v obrázku,
- **vodicí čára** u třídy a dálnice — úsečka po ose ramene,
- **přechody a zebry**, pokud je někdy budeme chtít.

U obruby je jeden háček, na který se přijde až u kreslení: `roadPolygons` vrací
**jádro a ramena zvlášť**, takže obtáhnout každý polygon zvlášť by nakreslilo
čáru i po vnitřních spárách mezi jádrem a ramenem, tedy mřížku přes silnici.
Obrys musí vzniknout jen z **vnějších** hran.

Generovaný obrázek by je nikdy nenavázal přes hranici dlaždice; spočítaná
úsečka ano.

### Co z toho plyne pro repo

Osmačtyřicet silničních a šestnáct potrubních dlaždic v `content/vanilla/tiles/`
je k zahození, protože je nikdo nepoužije. Zůstane po nich zadání a měření
v tomhle dokumentu — ať je jasné, proč se ta cesta opustila.

## Potrubí

Kreslí se **pod zemí** a je vidět jen v podzemním pohledu, takže se nekreslí
povrch, ale výkop: potrubí v otevřené rýze na tmavém podloží. Tvary jsou tytéž
jako u silnic a skládají se stejně.

| id | popis |
|---|---|
| `pipe` | A buried water main in an open trench: a grey concrete pipe on a bed of gravel, dark earth around it. |

Věta o navazování je stejná, jen místo „carriageway" je „pipe".

## Trosky

Co zbude po zbouraném domě nebo po katastrofě. Do T92 to byla **plochá olivová
výplň** přes celou dlaždici a autor ji nazval „hrůzným nesmyslem" — vypadala
jako zorané pole uprostřed města, ne jako demolice.

Je to **materiál, ne tvar**: kreslí se do téhož polygonu dlaždice jako povrch
terénu, jen se vybere podle vrstvy `rubble`. Proto stačí jediný obrázek a proto
má stejnou hlavičku jako povrchy — musí navazovat na sousední dlaždici bez
viditelného švu.

| id | prompt |
|---|---|
| `rubble` | Demolition debris seen from far above: broken slabs of grey concrete and cracked asphalt lying in churned brown dirt, with scattered bricks, splintered timber and dust. One even surface, the same everywhere, evenly lit. There is NO building, NO standing wall, NO vehicle, NO machine, NO road marking, NO kerb, NO grass, NO tree and NO person anywhere in the image: the debris reaches every edge. |

Věta o tom, co v obrázku **nesmí** být, je tam ze stejného důvodu jako
u asfaltu: bez ní si generátor slovo *demolition* přeloží jako *scéna
demolice* — s bagrem, kusem stojící zdi a dělníkem v helmě. Vyjmenovat zákazy
funguje, „one even surface" samo nestačí.

## Zrnitost a mipmapy

Autor se zeptal, „proč je všechno tak zrnité". Nebyl to vzhled obrázků, ale
**vzorkování**: dlaždice má obrázek 256 px, na obrazovce je široká 64, takže
každý pixel bral jeden texel ze šestnácti a zbytek zahodil. Jemná kresba se tím
nerozmaže, ale rozsype na jiskření.

Změřeno na trávě jako směrodatná odchylka vysokých frekvencí:

| co | zrno |
|---|---|
| obrázek 256 px, jak je | 20,1 |
| zmenšený na 64 px bez filtru (co dělala karta) | 22,2 |
| zmenšený na 64 px s průměrováním (co dělá mipmapa) | 9,2 |
| vzor z parku, který autor chválil | 15,0 |

Podstatné je to druhé číslo: **zmenšením zrno neubylo, přibylo.** Bez mipmapy
se šum nezprůměruje, jen se přeloží na jinou frekvenci.

Vzor z parku má navíc jen 128 px na dlaždici, tedy **poloviční hustotu** proti
našim 256. Část rozdílu je tedy i v tom, že do stejného místa cpeme dvakrát víc
kresby, než kolik je jí vidět.

Zapíná se to v `src/render/textures.ts` a platí pro povrchy, materiály vozovky,
terénní objekty i budovy — jiskřilo to všude stejně.

## Proč byla na dlaždici mřížka

Autor to popsal slovy „vypadá to, jak by na jedné dlaždici bylo 6x6 textur“
— a bylo to přesně tak. Nešlo o zrnitost obrázků ani o mipmapy.

Pixi má u výplně texturou volbu `textureSpace` a její **výchozí hodnota je
`'local'`**. V tom režimu si `generateTextureMatrix` naši matici ještě
znormalizuje podle **obálky tvaru**, tedy podle obdélníku 64 × 32 kolem
dlaždice. Obrázek se tím zmenšil čtyřikrát na šířku a osmkrát na výšku
a Pixi ho nechalo opakovat, protože si u výplní `clamp-to-edge` přepíše
na `repeat`.

Matice byla přitom celou dobu správně — je psaná pro globální prostor a Pixi
si ji sama obrací (`copyFrom(style.matrix).invert()`). Chybělo jediné slovo:
`textureSpace: 'global'`.

Ověřeno tak, že se na trávu dočasně dal sprite parku: místo jednoho parku na
dlaždici jich tam bylo několik vedle sebe. Bez toho pokusu to nešlo poznat,
protože opakovaná tráva pořád vypadá jako tráva — a právě proto to tak dlouho
vydrželo. Stejná past jako u obrácené matice o dva týdny dřív.

**Důsledek pro dřívější měření.** Zrnitost, kterou jsem měřil a „opravil“
mipmapami, byla z velké části tohle. Mipmapy dávají smysl a zůstávají, ale
zásluhu za lepší vzhled má tenhle řádek, ne ony.

## Co zbývá: kostkovaný trávník

Když mapování sedí, vyleze najevo další vada, kterou opakování schovávalo:
**každá dlaždice má vlastní světlo přes celou plochu**, a protože se obrázek
po dlaždicích otáčí, sousedi na sebe nenavazují. Z mapy je kostkovaná deka.

Změřeno jako rozdíl nejsvětlejšího a nejtmavšího místa po silném rozostření,
tedy „široký přechod přes dlaždici“:

| dlaždice | široký přechod |
|---|---|
| `grass` | 57 |
| `sand` | 47 |
| `rock` | 32 |
| `marsh` | 33 |
| `forest` | 28 |
| `asphalt_street` | 27 |
| `asphalt_highway` | 22 |
| `water` | 10 |
| `asphalt_avenue` | 7 |

Zadání to přitom už říká — „široká proměnlivost patří sklonu, ne kresbě“
a „obrázek má být na celé ploše stejný“. Tráva a písek to nedodržely nejvíc
a jsou to zrovna ty dva povrchy, kterých je na mapě vidět nejvíc. Voda
a nová `asphalt_avenue` ukazují, že to generátor umí; je to tedy věc promptu,
ne meze nástroje.

## Mřížka na vodě: lem po obvodu dlaždice

Autor: „nejde nějak minimalizovat viditelnost té mřížky? kór na vodě je to
dost rušivé". Nebyla to čára v rendereru — ta se u texturované dlaždice
nekreslí. Byl to **měkký okraj samotné dlaždice**.

`diamond_corners` hledá rohy z obálky krytí, takže padnou přesně na
rozostřený okraj vygenerovaného kosočtverce. Narovnaný čtverec pak měl po
obvodu průsvitný a tmavší lem — a protože ho měla každá dlaždice, složily se
lemy přes celou mapu do sítě. Na vodě nejvíc, protože tam ji nemá co schovat.

Změřený profil od okraje dovnitř (krytí):

| px od okraje | voda | písek | dálnice |
|---|---|---|---|
| 0 | 242 | 160 | 129 |
| 2 | 252 | 251 | 163 |
| 8 | 253 | 252 | 249 |

Lem je tedy hluboký 2 px u vody a písku a 8 px u dálnice. `EDGE_TRIM = 0,05`
ořízne třináct pixelů z 256, tedy s rezervou, a výsledek se dokryje na 255.
Po opravě je krytí na okraji i uvnitř 255 u všech dlaždic a rozdíl jasu klesl
u dálnice z 43/65 na 62/66.

Materiálu se tím neubere nic: je to plocha bez místa, takže na pěti procentech
kraje nic není.
