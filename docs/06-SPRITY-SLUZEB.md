# Sprity budov služeb

**Status:** zadání pro tvorbu obrázků. Rozhodl autor.

Tenhle dokument popisuje **28 budov mimo zóny** — služby a inženýrské stavby —
každou ve **třech variantách**, plus **dvanáct ruin** (tři na každý rozměr
půdorysu). Zástavba v zónách přijde samostatně, tady není.

Výchozí sada je **Československo osmdesátých let** (rozhodnutí autora). Tři
varianty jedné budovy jsou **tři různí architekti téže doby**, ne tři různé
epochy — aby všechny nemocnice nevypadaly stejně, ne aby město vypadalo jako
skanzen.

---

## 1. Co se tímhle mění

Architektura §6 i `CLAUDE.md` dosud říkaly „žádné sprity ve světě: terén,
silnice ani budovy na mapě zůstávají procedurální". **Pro budovy to od teď
neplatí** (rozhodl autor). Terén a silnice procedurální zůstávají.

### Co z toho plyne pro simulaci

Varianta se losuje jednou při vzniku budovy a **musí se uložit do savu**:

- **P2 — determinismus.** Losuje se z `world.rng`, ne z `Math.random`. Jinak
  by dva běhy téhož seedu daly jiné město a golden testy by se rozsypaly.
- **P7 — verze savu.** Varianta je nový údaj entity, takže přibude
  `formatVersion` a migrace. Starý save variantu nemá; migrace ji musí
  dolosovat, nebo se rozhodnout pro nultou.
- **P6 — identifikátory.** Ukládá se **jméno varianty** (`a`, `b`, `c`), ne
  index do pole. Mod smí varianty přidat i přejmenovat.
- **P5 — obsah, ne kód.** Kolik variant budova má, říká obsah. Tři jsou
  dnešní rozhodnutí, ne konstanta v kódu; budova s jedinou variantou musí
  fungovat stejně jako budova s pěti.

Totéž platí pro **variantu ruiny** — losuje se při vzniku suti a musí přežít
uložení, jinak by se trosky s každým načtením přeskládaly.

Chybějící obrázek **nesmí hru zastavit** — vykreslí se procedurální kvádr jako
dosud, stejně jako to dělá `iconSvg` u ikon.

### Skiny

Registr klíčuje obrázky jako `vanilla:hospital|a` a **pozdější zdroj dřívější
přepíše**, takže skin je prostě `ContentSource`, který nenese definice, jen
obrázky. Mechanismus je hotový a otestovaný; chybí k němu načítání zdroje za
běhu (fáze 5) a přepínač.

**Varianta `a`/`b`/`c` je smlouva, ne jméno.** Do savu jde jméno varianty, skin
ne — takže když jiný skin pojmenuje varianty jinak, načtené město o obrázky
přijde a spadne na kvádry. Každý skin má vyplnit všechny tři sloty.

**Skin není nástroj na lokalizaci** (rozhodnutí autora). Text zapečený v PNG je
text mimo locale soubory, což §10 zakazuje, a lokalizovat by šlo jen celou
sadou obrázků na jazyk. Proto v obrázcích **nejsou žádná písmena** — cedule
ano, nápis ne.

*Nic z toho není v téhle dávce hotové. Tenhle dokument je zadání pro obrázky.*

---

## 2. Geometrie — proč zrovna tyhle rozměry

Odvozeno z rendereru (`src/render/projection.ts`), ne odhadnuto.

Projekce je **2:1** — dlaždice je 64 × 32 px, jedno patro 16 px. Pro čtvercový
půdorys `n × n` platí při zoomu 1:

```
šířka spritu   = 64 · n
výška podstavy = 32 · n
výška těla     = 16 · heightLevels
výška celkem   = 32 · n + 16 · heightLevels
```

Hra umí přiblížit až **4×**, takže se kreslí ve **čtyřnásobku** a zmenšuje se.
Všechny budovy mimo zóny mají **čtvercový půdorys**, takže spodní vrchol
podstavy má ležet uprostřed šířky. *Má* — skutečnou polohu skript změří, viz
níž.

| půdorys | pater | šířka | výška |
|---|---|---|---|
| 1 × 1 | 1 | 256 | 192 |
| 2 × 2 | 1 | 512 | 320 |
| 2 × 2 | 2 | 512 | 384 |
| 3 × 3 | 1 | 768 | 448 |
| 3 × 3 | 2 | 768 | 512 |
| 3 × 3 | 3 | 768 | 576 |
| 4 × 4 | 2 | 1024 | 640 |

**Do promptu tyhle rozměry nepatří.** Generátory je stejně netrefí a čtvercové
plátno umí líp. Kresli **1024 × 1024** a zbytek dopočítá skript, který obrázek
ořízne a zmenší na správnou šířku. Výšku pak jen **hlásí** a nepřekresluje:
když vyjde jiná, než tabulka čeká, je to informace o tom, že je stavba vyšší
nebo nižší, ne chyba k opravě násilím.

### Světlo

Renderer stínuje stěny pevně: **levá stěna je světlejší** (0,7), **pravá
tmavší** (0,5), střecha nejsvětlejší. Světlo tedy jde **zleva**. Když to
obrázek poruší, budova se od silnic a terénu kolem odlepí.

---

## 3. Styl: Československo, osmdesátá léta

**Rozhodnutí autora.** Výchozí sada je jedno město v jedné době. Ne přehlídka
epoch — to by z města udělalo skanzen.

### Co se mezi variantami liší

Tři varianty jedné budovy jsou **tři různí architekti, ne tři různé doby**.
Liší se tím, čím se lišily doopravdy:

| | čím se liší |
|---|---|
| **hmota** | monoblok · pavilony spojené krčkem · atypika s vystupujícím objemem |
| **materiál** | panelová soustava · zděná cihla s omítkou · monolitický beton |
| **plášť** | břízolit · keramický obklad · boletické panely · sklobeton |
| **střecha** | plochá s atikou (většina) · sedlová (drobné stavby) · pilová (haly) |

Nemocnice tedy nesmí být třikrát tatáž nemocnice s jinou barvou. Má to být
monoblok, pavilonový areál a atypika.

**Osmdesátá léta jsou doba, kdy se hraje, ne rok, kdy se stavělo.** Město roku
1989 je plné budov z roku 1912 — pavilonová nemocnice, secesní škola, cihlová
vodárna. Starší stavby do sady patří; co tam nepatří, je stavba **novější**,
tedy prosklené fasády, zámková dlažba a fotovoltaika.

### Co zůstává stejné

Paleta a stavební slovník. Ploché střechy s atikou, ocelové rámy oken,
betonové květináče, terasová dlažba, stožáry bez vlajek, mozaika nebo reliéf na
slepé stěně. Auta jen když je budova potřebuje: Škoda 105, Avia, Karosa, Tatra
613 u úřadu, tramvaj T3.

### Barvy: dobové tvary, sytější odstíny

Skutečná paleta té doby je tlumená — panelová šeď, okr, břízolitová béž.
Ve hře se ale na budovu díváš přes dva centimetry a musíš na první pohled
poznat hasiče od polikliniky.

Držíme proto **tvary dobově a barvy o stupeň sytější, než jaká realita byla**
(rozhodnutí autora). Každá třída služeb si nese svůj akcent — ten dnes nese
procedurální kvádr a se sprity by se ztratil:

| třída | akcent |
|---|---|
| zdravotnictví | bílá a světle modrá |
| bezpečnost | tmavě modrá a šedá |
| hasiči | červená |
| vzdělání | okr a cihlová |
| kultura | vínová, měď, mozaika |
| sociální | teplá béžová a zelená |
| parky | zeleň |
| odpady | šedá a rez |
| doprava | modrá a krémová |
| energie a voda | ocelová šedá a cihla |

**Politickou symboliku obrázky nenesou.** Rudá hvězda, srp a kladivo ani hesla
na fasádě — to je rozhodnutí o vyznění hry a nemá vzniknout tím, že to
generátor přidá sám. Stožáry bez vlajek ano.

---

## 4. Společná hlavička promptu

Tuhle část **připoj ke každé variantě**. K tomu vždycky přilož svůj referenční
design — ten nese styl, text nese obsah.

```
Isometric city-builder building asset, seen from the south-east.

Rendering style: a soft-shaded 3D render, not a drawing. Believable materials
— rough render, brick, concrete, painted steel, glass with a faint warm
interior glow. Smooth gradients across surfaces and gentle ambient occlusion
where forms meet. Bright, warm, even daylight.

NOT cartoon, NOT cel-shaded, NOT toon-shaded. No dark outline or contour line
around any object or edge. No flat single-colour fills, no posterisation, no
comic look. Equally, no photorealism, no film grain, no vignette, no colour
grading, no lens effects, no bloom.

The plot is populated, not bare: low hedges and shrubs in concrete planters,
a bench, handrails at the steps, a lamp, paving laid in a visible pattern.

Subject period and place: Czechoslovakia in the 1980s. Late-socialist public
architecture — flat roofs with parapets, steel window frames, panel or
rendered facades, concrete planters, terrazzo paving. Colours are slightly
more saturated than reality, but the forms stay period-correct.

The building stands on its own square plot. The plot is a perfect isometric
diamond with four SHARP corners — not rounded, not a square, not a rectangle —
and those four corners touch the edges of the image. Nothing except the roof
may stick out past it, and nothing may be cut off.

Lighting is fixed: sunlight from the left. The left-facing wall is clearly
brighter than the right-facing wall; the roof is the brightest surface.

Shadows are short and soft. NO CAST SHADOW MAY CROSS THE EDGE OF THE PLOT —
the area outside the diamond is completely empty. No shadow from masts, poles
or trees reaching past the paving.

Transparent background, no terrain, no grass or road outside the plot, no
people, no political symbols, no flags, no logos, no watermark.

NO TEXT ANYWHERE. Signs, boards and panels must be blank — a sign that reads
as a sign without any lettering on it.

Clean hard edges, no blur, no depth of field, no vignette.

Square canvas, 1024 × 1024.
```

### Proč „žádný text"

Nápis zapečený v obrázku je **text mimo locale soubory**, což §10 zakazuje —
a lokalizovat ho by znamenalo celou sadu obrázků na každý jazyk. Prázdná
tabule nad vchodem se čte jako cedule a nemluví žádným jazykem.

Generátor to porušuje i tak: tvoje první škola má na štítě „SCHOOL". Proto je
ten zákaz v promptu **na vlastním řádku a verzálkami** — modely poslední větu
odstavce přeskakují častěji než samostatný pokyn.

### Průhledné pozadí je lepší než klíčované

ChatGPT ho umí a skript to pozná sám: ověřeno na prvních obrázcích, rohy na
nule, půlka plátna průhledná. Sklo a měkké hrany tím zůstanou celé.

Když generátor průhlednost neumí, poslední řádek se nahradí za:

```
Flat magenta background (#FF00FF).
```

Skript to odklíčuje a otře fialový lem. Pozná to podle **rohů**, ne podle
podílu průhledných pixelů — budova s prosklenou halou by jinak vypadala jako
už odklíčovaná, i když kolem sebe má plnou magentu. Proto se ta barva nesmí
objevit v žádné variantě.

Proč „rohy podstavy se dotýkají okrajů": skript zmenšuje podle **šířky
ořezu**. Když budova plátno nevyplní, vyjde v mapě příliš velká.

### Projekci neřeš, skript ji srovná

ChatGPT kreslí klasickou izometrii kolem **1,6 : 1**, hra jede **2 : 1**.
Naměřeno na prvních třech obrázcích: 1,57, 1,60 a 1,60.

Nevadí to. Obě projekce jsou paralelní promítání se stejným otočením kolem
svislé osy a liší se jen sklonem pohledu — a ten je na obrazovce prosté svislé
zmáčknutí. Skript podstavu **změří** a srovná; po opravě vyšly 2,00, 2,00
a 2,07. Není to deformace, ale převod mezi projekcemi.

Do promptu se proto 2:1 psát nemusí a lepší je nepsat: generátor by se o to
pokoušel a rozházel by proporce budovy.

### Kotva se měří, ne předpokládá

U čtvercového půdorysu má spodní vrchol podstavy ležet uprostřed šířky.
Generátor ale kreslí podstavu často mírně zkosenou — u první školy byl vrchol
**36 px vedle středu**. Skript ho proto změří a zapíše do `index.json`; kdyby
se počítal ze středu, seděla by budova na dlaždici vedle.

### Výška

Skript hlásí, o kolik je stavba vyšší, než čeká `heightLevels` z definice.
Není to chyba obrázku — je to informace, že se představa simulace rozchází
s tím, jak stavba vypadá. Buď se `heightLevels` upraví, nebo se to nechá být
a kvádrová záloha bude nižší než sprite.

---

## 5. Postup

**Pracuje se po budovách** (rozhodnutí autora). Vygeneruješ tři varianty jedné
budovy, nahrneš je do `art/sprites/raw/` tak, jak je vrátil generátor, a řekneš
která to je. Není to jen pohodlí: `police_small` od `police_large` ani `cinema`
od `theatre` nikdo z obrázku nepozná, a hádat by znamenalo tichou záměnu.

### 1. Pojmenovat

```bash
python tools/name-sprites.py hospital
```

Skript vezme soubory, které ještě jméno nemají, **seřadí je podle času vzniku**
a přiřadí `a`, `b`, `c`. Řadí se podle času, ne podle abecedy — generátor dává
do jména české datum (`ChatGPT Image 30. 8. 2026 00_00_20.png`) a abecedně by
`30. 8.` předběhlo `3. 9.`.

Nesouhlasí-li počet, **neudělá nic** a vypíše, co našel: přejmenovat první tři
ze čtyř by tiše složilo špatnou sadu. Existující soubor nepřepíše. `--check`
ukáže plán, aniž by na něco sáhl.

### 2. Naladit

```bash
python tools/fit-sprites.py
```

Skript vezme, co v `raw/` najde, odklíčuje pozadí, srovná projekci, ořízne,
zmenší na správnou šířku a uloží do `content/vanilla/sprites/`. Rozměry si
bere **z definic budov**, ne z tabulky v sobě — když se půdorys změní, sprity
se přepočítají samy. Vypíše, co udělal, a co ještě chybí.

Odklíčuje pozadí, srovná projekci, ořízne, zmenší na správnou šířku a uloží do
`content/vanilla/sprites/`. Rozměry si bere **z definic budov**, ne z tabulky
v sobě. Vypíše, co udělal, a co ještě chybí.

```bash
python tools/fit-sprites.py --check
```

### Jména

```
art/sprites/raw/hospital__a.png
art/sprites/raw/ruin_3x3__b.png
```

Dvojité podtržítko schválně — v `id` jsou podtržítka jednoduchá.

---

## 6. Budovy

Kurzívou je role budovy ve hře — to, co má být na obrázku poznat na první
pohled. Prompt varianty se **připojuje k hlavičce** ze sekce 4.

---

### Zdravotnictví

#### `clinic` — Poliklinika · 2 × 2, 1 patro

*Malá péče pro čtvrť. Nízká, přívětivá, ne nemocniční.*

| | prompt |
|---|---|
| **a** | A small single-storey district polyclinic, standard prefab design: pale grey concrete panels with a horizontal band of steel-framed windows, flat gravel roof with a low parapet, a concrete canopy on two thin columns over the double door, a wheelchair ramp and two concrete planters. |
| **b** | A brick-built neighbourhood health centre with rough ochre render: tall narrow windows in a regular rhythm, a shallow flat roof, a recessed entrance with a terrazzo step, a glass-block panel lighting the stair, low clipped hedge along the plot. |
| **c** | An individually designed clinic pavilion in exposed concrete: two staggered low volumes, one clad in pale blue opaque glazed panels, a small abstract ceramic mosaic on the blank end wall, a covered walkway linking the volumes. |

#### `hospital` — Nemocnice · 3 × 3, 3 patra

*Největší zdravotnická stavba ve městě, pokryje celé město.*

| | prompt |
|---|---|
| **a** | A late-socialist hospital monoblock: a wide slab of white and pale blue prefab panels, continuous ribbon windows on every floor, a flat roof with a rooftop plant enclosure, a projecting single-storey entrance wing with a wide canopy, an ambulance bay marked on the paving. |
| **b** | A pavilion hospital complex: three low brick wings with rendered ochre walls and pitched tile roofs, joined by glazed covered walkways, mature trees between the wings, a separate boiler house with a red-and-white banded chimney. |
| **c** | An individually designed hospital: a monolithic concrete slab raised on a recessed glazed ground floor, a projecting cylindrical stair tower clad in glass blocks, deep window reveals casting hard shadows, a large abstract relief across the blank gable. |

---

### Bezpečnost

#### `police_small` — Oddělení VB · 2 × 2, 1 patro

*Základní stanice. Srozumitelná, ne reprezentativní.*

| | prompt |
|---|---|
| **a** | A small district police station in a standard prefab block: grey panels, barred ground-floor windows, a flat roof, a plain concrete canopy over the door, a single blue lamp beside it, a fenced parking bay with a small period sedan. |
| **b** | A police post in a rendered brick corner building: mustard-ochre render, a rusticated concrete plinth, steel-framed windows with bars, a flagpole without a flag, a paved forecourt with concrete bollards. |
| **c** | A purpose-built police station in exposed concrete: a low horizontal volume with a deep recessed entrance, dark blue opaque glazed panels between windows, a slim antenna mast on the roof, a covered vehicle bay. |

#### `police_large` — Krajská správa VB · 2 × 2, 2 patra

*Nadřazený úřad. Musí být poznat, že je to víc než stanice.*

| | prompt |
|---|---|
| **a** | An administrative headquarters in prefab panels: two storeys of regular square windows in pale stone-faced panels, a projecting entrance slab on columns, three flagpoles without flags, a wide paved forecourt with concrete planters. |
| **b** | A brick administrative building with ochre render and a stone plinth: tall windows in a strict grid, a heavy cornice, wide stone steps to a double door, a lamp on each side, a low wall enclosing the plot. |
| **c** | An individually designed headquarters: a monolithic concrete frame with dark blue opaque glazed infill panels, a cantilevered entrance canopy, a rooftop communications mast with dishes, a sunken forecourt with steps. |

#### `prison` — Věznice · 3 × 3, 2 patra

*Srazí kriminalitu v celém městě a cenu půdy všude, kam je na ni vidět.*

| | prompt |
|---|---|
| **a** | A prefab prison block: a long slab of grey panels with narrow slit windows, a flat roof, a double perimeter fence with barbed wire, floodlight masts at the corners, an empty concrete exercise yard. |
| **b** | An older brick prison with rendered walls: a heavy masonry perimeter wall, two square corner watchtowers with flat caps, a massive steel vehicle gate, a bare gravel yard visible over the wall. |
| **c** | A purpose-built prison in exposed concrete: low staggered wings around an inner yard, a smooth continuous perimeter wall with no handholds, camera poles at intervals, a single vehicle sally port with a striped barrier. |

---

### Hasiči

#### `fire_station` — Požární zbrojnice · 2 × 2, 1 patro

*Základní zbrojnice. Vrata a věž jsou poznávací znamení.*

| | prompt |
|---|---|
| **a** | A standard-design fire station: a rendered single-storey hall with two red steel folding doors, a flat roof, a slender square hose-drying tower with open window slots, a concrete apron with painted lines, a red fire engine of the period. |
| **b** | A brick village fire station with ochre render: two timber engine doors painted red, a pitched tile roof with a small gable, a taller hose tower with a pointed cap, a bell under the gable, a paved apron. |
| **c** | An individually designed fire station in exposed concrete: three red doors under one continuous cantilevered canopy, a glass-block stair tower, a red band along the parapet, a clean apron with a drainage channel. |

#### `fire_station_large` — Velká požární zbrojnice · 2 × 2, 2 patra

*Dosáhne tam, kam malá ne. Větší a členitější než `fire_station`.*

| | prompt |
|---|---|
| **a** | A large prefab fire station: four red doors along a wide apparatus hall, a two-storey crew block above in pale panels with ribbon windows, a separate square training tower, a large marked apron with two fire engines. |
| **b** | A brick fire station with a courtyard: four arched engine openings with red doors, a two-storey crew wing with tall windows and ochre render, a tall hose-drying tower with a clock face, a paved courtyard behind. |
| **c** | An individually designed fire station: a fully glazed apparatus bay with steel mullions showing the trucks inside, a cantilevered crew wing clad in red opaque panels, a training tower with open floors and a ladder. |

---

### Vzdělání

#### `school` — Základní škola · 3 × 3, 1 patro

*Nízká a rozlehlá — zabírá celý pozemek, ale netyčí se.*

| | prompt |
|---|---|
| **a** | A standard-design pavilion school: two low prefab classroom pavilions with flat roofs and continuous window bands, joined by a covered walkway, pale panels with ochre window frames, an asphalt yard with painted court lines and a climbing frame. |
| **b** | A brick school with ochre render: a symmetrical single-storey range with tall multi-pane classroom windows, a shallow hipped tile roof, a central entrance with a stone surround and a blank sign board above it, a fenced playground with mature trees. |
| **c** | An individually designed school in exposed concrete: three staggered low wings around a small courtyard, glass-block panels lighting the corridors, a large abstract sgraffito panel on the blank end wall, a sunken play area with concrete steps. |

#### `high_school` — Střední průmyslová škola · 2 × 2, 2 patra

*Vyšší vzdělání. Reprezentativnější než základní škola.*

| | prompt |
|---|---|
| **a** | A standard-design secondary school: two storeys of prefab panels with continuous ribbon windows, a flat roof with a parapet, a projecting flat entrance canopy, a bicycle shelter, concrete planters along the front. |
| **b** | A brick secondary school with ochre render and a stone plinth: two storeys of tall steel-framed windows in a strict rhythm, a shallow cornice, a broad stepped entrance, a blank sign board over the door, clipped hedges. |
| **c** | An individually designed technical school: an exposed concrete frame with dark green opaque glazed infill panels, a double-height glazed entrance hall, a large abstract mosaic across the blank gable, an external concrete stair. |

#### `university` — Vysoká škola · 3 × 3, 3 patra

*Nejvyšší vzdělání ve městě. Nejvýraznější vzdělávací stavba.*

| | prompt |
|---|---|
| **a** | A university faculty in prefab panels: a tall slab with continuous ribbon windows, a flat roof with a plant enclosure, a lower glazed lecture wing at the base, a wide paved forecourt with concrete planters and flagpoles without flags. |
| **b** | A brick university building with rendered ochre walls: a three-storey range around a courtyard, tall arched ground-floor openings, a stone plinth and cornice, a low tower over the entrance, mature trees in the courtyard. |
| **c** | An individually designed faculty in brutalist exposed concrete: two cantilevered lecture-hall volumes projecting from the main slab, board-marked concrete surfaces, deep-set windows, an open concrete stair, a raised plaza. |

---

### Kultura

#### `gallery` — Výstavní síň · 1 × 1, 1 patro

*Nejmenší kulturní stavba — jedna dlaždice. Drobná, ne monumentální.*

| | prompt |
|---|---|
| **a** | A tiny standard-design exhibition pavilion: a low rendered box with one large steel-framed display window, a flat roof with a raised roof light, a blank poster board beside the door, a concrete step. |
| **b** | A small brick gallery with ochre render: a shallow pitched tile roof, one tall arched window, a modest stone surround to the door, a freestanding cylindrical poster column on the plot. |
| **c** | A small individually designed gallery in exposed concrete: an angular volume with one fully glazed wall, a small abstract ceramic mosaic beside the entrance, a flat roof with a north-facing roof light. |

#### `cinema` — Kino · 2 × 2, 1 patro

*Levná kultura pro každý den. Musí být poznat na první pohled.*

| | prompt |
|---|---|
| **a** | A standard-design district cinema: a windowless rendered box with a wide flat canopy over the entrance, three empty glass poster cases beside the doors, a flat roof, an unlit neon frame with no lettering above the canopy. |
| **b** | A brick cinema with ochre render and a stone plinth: a tall blank front wall, a projecting canopy on slim steel columns, tall narrow foyer windows either side, a paved forecourt with a cylindrical poster column. |
| **c** | An individually designed cinema in exposed concrete: a sculpted angular entrance canopy, a fully glazed foyer wrapping one corner, a large abstract relief across the blank auditorium wall, terrazzo paving. |

#### `theatre` — Divadlo · 2 × 2, 1 patro

*Večerní program pro čtvrť. Slavnostnější než kino.*

| | prompt |
|---|---|
| **a** | A standard-design theatre: a low foyer block in pale panels with a full-height glazed front, a projecting flat canopy, a taller windowless fly tower behind clad in grey panels, a paved forecourt with concrete planters. |
| **b** | A brick theatre with rendered walls: an arcaded ground floor, a balcony over the entrance, a moulded cornice, tall foyer windows, a plain fly tower behind, wide steps to the doors. |
| **c** | An individually designed theatre in exposed concrete: a faceted foyer volume fully glazed with dark mullions, a copper-clad fly tower, a large abstract metal relief on the blank side wall, a raised terrazzo terrace. |

#### `museum` — Muzeum · 3 × 3, 2 patra

*Sbírka, kvůli které se do města jezdí. Nejdražší kultura.*

| | prompt |
|---|---|
| **a** | A standard-design museum: a two-storey slab in pale stone-faced panels with a regular grid of deep window openings, a flat roof, a recessed glazed entrance under a projecting slab, a broad paved forecourt with flagpoles without flags. |
| **b** | A brick museum with rendered ochre walls: a symmetrical range with a stone plinth, tall arched windows, a shallow cornice, a wide flight of steps to a columned entrance, mature trees at the plot edge. |
| **c** | An individually designed museum in exposed concrete: an overhanging upper volume on a recessed glazed base, board-marked concrete, a full-height glass-block stair tower, a large abstract mosaic on the blank end wall, a shallow reflecting pool. |

---

### Sociální služby

#### `community_centre` — Kulturní dům · 2 × 2, 1 patro

*Místo, kde se čtvrť potká. Neformální, přívětivé.*

| | prompt |
|---|---|
| **a** | A standard-design house of culture: a low prefab hall with a flat roof, a full-width glazed foyer, a concrete canopy on thin columns, a blank sign board above the doors, a paved terrace with concrete planters. |
| **b** | A brick community hall with ochre render: a large gabled hall with round-arched windows, a timber porch, a small bell gable, a gravel forecourt with a flagpole and two benches. |
| **c** | An individually designed community centre in exposed concrete: a hexagonal hall volume with a folded roof, glass-block panels between concrete ribs, a large abstract sgraffito on the blank wall, a sunken terrace. |

#### `retirement_home` — Domov důchodců · 3 × 3, 2 patra

*Péče o ty, kteří město postavili. Klidné, zelené, ne nemocniční.*

| | prompt |
|---|---|
| **a** | A standard-design retirement home: two low prefab wings with continuous loggias and painted balcony rails, flat roofs, joined by a glazed link, a paved courtyard with benches and concrete planters. |
| **b** | A brick retirement home with warm ochre render: a two-storey range with a mansard tile roof, regular windows with shutters, a central entrance canopy, mature trees and a gravel path around the plot. |
| **c** | An individually designed retirement home in exposed concrete: three staggered low wings around a planted inner garden, timber balcony fronts, a glazed day room projecting toward the garden, raised planting beds. |

---

### Parky

Parky nejsou architektura, takže se varianty liší **náplní**, ne rukopisem —
ale i tak z osmdesátých let: betonové obruby, kovové prolézačky, mlatové cesty.

#### `park_small` — Park · 1 × 1, 1 patro

*Jedna dlaždice. Levné a jediné, co dělá, je že zvedá cenu půdy.*

| | prompt |
|---|---|
| **a** | A small square of lawn with one mature broadleaf tree, a slatted wooden bench on cast-iron legs beneath it, a short gravel path, a low hooped metal railing along one edge. |
| **b** | A small paved pocket square: concrete slab paving in a simple pattern, a low circular concrete fountain basin in the middle, two benches, four clipped trees, a cylindrical poster column. |
| **c** | A small playground: a painted steel climbing frame and a metal slide, a rectangular concrete sandpit, a spring rocker, a bench, compacted sand surfacing, a low fence. |

#### `park_large` — Velký park · 2 × 2, 1 patro

*Zvedá cenu půdy v širokém okolí a nestojí skoro nic.*

| | prompt |
|---|---|
| **a** | A city park: curving compacted-gravel paths through lawn, several mature trees, an open hexagonal bandstand pavilion with a shallow roof, benches, a flower bed edged with concrete kerbs. |
| **b** | A sports park: a fenced hard court with steel goals, a compacted running loop around lawn, a painted steel exercise frame, a small changing hut, benches and two trees. |
| **c** | A landscaped park: an irregular pond with a concrete edge and reeds, a small steel footbridge, birch groups and meadow planting, a winding path, a sculpture plinth with an abstract concrete form. |

---

### Odpady

#### `landfill` — Skládka · 3 × 3, 1 patro

*Levné zpracování odpadu za cenu silného znečištění okolí. Má být ošklivá.*

| | prompt |
|---|---|
| **a** | A raw tipping site: mounds of covered earth and refuse, tyre tracks in mud, a period bulldozer pushing a heap, a sagging wire fence, a muddy access apron. |
| **b** | A fenced landfill with a gatehouse: sorted heaps of waste, a weighbridge with a small rendered hut, wind-blown litter caught in tall netting screens, gulls over the mounds, a rusting skip. |
| **c** | A managed landfill cell: a graded and partly grassed slope, steel gas vent pipes rising from the surface, a leachate tank, a compactor vehicle, a gated chain-link fence. |

#### `incinerator` — Spalovna · 3 × 3, 2 patra

*Zpracuje třikrát víc odpadu a znečišťuje méně. Komín je poznávací znamení.*

| | prompt |
|---|---|
| **a** | A standard-design incinerator: a grey steel-clad boiler hall with external ducting, two cylindrical steel silos, a square steel chimney with guy wires and a red aircraft-warning band, a covered tipping bay. |
| **b** | A brick incinerator with a tall round brick chimney: a pitched-roof boiler hall with tall industrial windows, a tipping ramp on one side, soot-darkened brickwork, a coal-black apron. |
| **c** | An individually designed waste plant in exposed concrete: a monolithic hall with a saw-tooth roof, a slender concrete chimney with a red-and-white band, a glazed control wing, a covered lorry entrance. |

---

### Doprava

#### `transit_stop` — Zastávka MHD · 1 × 1, 1 patro

*Jedna dlaždice. Lidé v okolí přesednou z aut.*

| | prompt |
|---|---|
| **a** | A standard bus shelter: a painted steel frame with wired-glass back panel, a shallow curved metal roof, a slatted bench inside, a stop pole with a blank round sign, a short concrete platform. |
| **b** | A precast concrete bus shelter: a heavy canopy on two square legs, an empty timetable case on the back wall, a plain concrete bench, a rusted stop pole, cracked slab paving. |
| **c** | An individually designed stop: a glazed shelter with a folded-plate roof, a leaning rail instead of a bench, a slim pole with a blank sign, a small abstract mosaic panel on the back wall. |

#### `tram_stop` — Tramvajová zastávka · 1 × 1, 1 patro

*Koleje sdílí vozovku. Musí být poznat kolej a trolej, ne jen přístřešek.*

| | prompt |
|---|---|
| **a** | A tram boarding island: a raised concrete kerb platform with a hooped steel railing along the back, a pair of rails set in cobbles along one edge, an overhead wire on a slender lattice mast, a stop pole with a blank sign. |
| **b** | A concrete tram platform with a small precast shelter: rails set in asphalt along the edge, a catenary mast with a bracket arm, an empty timetable case, worn slab paving. |
| **c** | A longer tram stop: a low platform with a painted edge strip, a glazed shelter with a flat roof, rails in a grassed track bed, a slim catenary pole, a period tram approaching at the edge of the plot. |

#### `metro_station` — Stanice metra · 2 × 2, 1 patro

*Vestibul nad zemí. Silnice nezatěžuje vůbec, ale stojí nejvíc.*

| | prompt |
|---|---|
| **a** | A standard metro vestibule: a low rectangular pavilion clad in anodised aluminium panels, a broad stair descending into shadow, steel handrails, a flat roof with a shallow overhang, a blank sign panel above the opening. |
| **b** | A granite-clad metro entrance: a squat stone pavilion with a wide opening, terrazzo steps down, a moulded stone surround, two globe lamps, a paved forecourt. |
| **c** | An individually designed vestibule in exposed concrete: a faceted glazed hall with dark mullions, escalators visible descending inside, a large abstract anodised-metal relief on the blank wall. |

#### `transit_depot` — Vozovna MHD · 3 × 3, 2 patra

*Sama nic neobsluhuje, ale bez ní se nedá postavit zastávka.*

| | prompt |
|---|---|
| **a** | A standard bus depot: a wide steel-clad hall with three roller doors, a large open parking apron with painted bays and period buses, a fuel point under a small canopy, a chain-link fence. |
| **b** | A brick tram depot: a long hall with four tall arched gate openings, a shallow pitched roof with ventilation lanterns, rails fanning out onto the cobbled apron, brick pilasters between the gates. |
| **c** | An individually designed depot in exposed concrete: a saw-tooth roof with north-facing glazing, a glazed workshop end, an inspection pit visible in the open bay, a clean marked apron. |

---

### Energie a voda

#### `coal_power_plant` — Uhelná elektrárna · 4 × 4, 2 patra

*Největší stavba ve hře. Zabírá šestnáct dlaždic.*

| | prompt |
|---|---|
| **a** | A standard coal power station: a steel-clad turbine hall, two tall banded chimneys in red and white, a coal yard with a conveyor bridge and a bucket-wheel loader, a lattice switchyard with pylons. |
| **b** | An older brick coal plant: a tall brick boiler hall with rows of tall industrial windows, one massive round brick chimney, a coal yard with a rail siding and hoppers, soot-stained masonry. |
| **c** | A coal plant with two hyperbolic concrete cooling towers, a monolithic concrete turbine hall between them, a covered coal store, a single tall banded chimney, a fenced switchyard. |

#### `water_works` — Vodárna · 3 × 3, 2 patra

*Zakládá vodní síť. Musí stát u vody.*

| | prompt |
|---|---|
| **a** | A standard waterworks: a rectangular rendered technical building with narrow windows, two large circular concrete storage tanks beside it, exposed pipework and valves, a service ladder, a fenced compound. |
| **b** | A brick water tower works: a round brick tower with a corbelled tank and a conical roof, a low brick pump house beside it with arched windows, an iron door, a gravel yard. |
| **c** | An individually designed waterworks in exposed concrete: two low halls with a glazed control room between them, one slender cylindrical tower with a ribbed concrete shaft, stainless pipework, a fenced compound. |

#### `water_treatment` — Čistírna odpadních vod · 3 × 3, 1 patro

*Kapacita kanalizace. Nízká, technická, nádrže dominují.*

| | prompt |
|---|---|
| **a** | A sewage works with circular clarifiers: two large open round concrete tanks with rotating bridge arms, a small rendered control house, pipework and steel walkways between the tanks. |
| **b** | A rectangular sewage works: long open concrete basins in a row with steel handrails, a low brick technical building, aeration pipes and a small blower house, a gravel access track. |
| **c** | An individually designed treatment plant: enclosed tanks under low concrete domes, a compact operations building with a glazed corner and a mosaic panel, stainless pipework, a fenced perimeter. |

#### `pump_station` — Čerpací stanice · 1 × 1, 1 patro

*Jedna dlaždice. Prodlužuje dosah vodovodu, sama vodu nezaloží.*

| | prompt |
|---|---|
| **a** | A small precast pump kiosk: a plain flat-roofed concrete box, a steel door, a ventilation grille, thick pipes running out of the wall into the ground, a concrete bollard. |
| **b** | A small brick pump house: a single-room hut with a pitched tile roof, one barred window, an iron door, exposed valves and a pipe emerging from the ground beside it. |
| **c** | A small individually designed pump kiosk: an angular concrete box with a folded roof, a louvred steel panel, colour-coded pipework and valves outside on a concrete pad. |

---

## 7. Ruiny

**Rozhodnutí autora:** ne jedna univerzální ruina, ale **tři varianty na každý
rozměr půdorysu**. Při vzniku suti se jedna vylosuje a zůstane.

Čtyři rozměry × tři varianty = **dvanáct obrázků**. Kdyby měla ruinu každá
budova zvlášť, bylo by jich dvacet osm jen pro služby a se zónami přes sedmdesát
— a nic by to nepřineslo. **Ruina má být čitelná, ne detailní.** Při zoomu, ve
kterém se hraje, potřebuješ vidět „tady je zkáza", a identitu nese něco jiného:
simulace si v `rubbleOf` pamatuje, co kde stálo, a symbol služby se kreslí
navrch procedurálně. Ten zůstane.

### Čím se varianty liší

**Ne mírou zkázy.** Simulace stupně poškození nezná — budova buď stojí, nebo je
z ní suť. Kdyby jedna varianta vypadala „jen ohořele" a druhá „srovnaná se
zemí", rozhraní by lhalo o stavu, který v datech není.

Liší se tím, **jak to spadlo**: kam padly panely, kde zůstal kus stěny, kudy se
sesypal strop. Stejná míra, jiné trosky.

### Co platí pro všechny

- **Suť vyplní celý pozemek** — stejnou podstavu jako budova, kterou nahradila.
  Menší ruina by vypadala, že se pozemek scvrkl.
- **Nízká.** Zbytek stěny může vyčnívat, ale silueta má být plochá; hráč musí
  přes ruinu vidět, co je za ní.
- **Odbarvená.** Šeď, saze, rez, prach. Proti barevnému okolí se to pozná dřív
  než z tvaru.
- **Bez ohně a bez vody.** Požár i povodeň kreslí hra sama do dlaždic a
  přikreslený plamen by s ní blikal proti sobě.
- **Bez těl, bez krve, bez záchranářů.** Je to hospodářská hra.
- Uprostřed zůstane **volné místo pro symbol služby**, který hra dokreslí.

### Prompty

Stejná hlavička jako u budov (sekce 4). Období je pořád osmdesátá léta —
panely, cihla, ocelová okna, jen na zemi.

#### `ruin_1x1` — jedna dlaždice

| | prompt |
|---|---|
| **a** | Ruins of a small collapsed building filling the plot: a low heap of broken grey concrete slabs and ochre render fragments, one short stub of standing wall with an empty steel window frame, dust-grey and soot-stained, weeds at the edge. |
| **b** | Ruins of a small burnt-out building: blackened brick rubble spread evenly across the plot, charred timber beams lying across it, a scorched stub of chimney, everything desaturated grey and soot. |
| **c** | Ruins of a small building pushed flat: an even bed of crushed masonry and twisted steel reinforcement across the whole plot, a single tilted concrete slab leaning on the heap, broken paving at the edge. |

#### `ruin_2x2` — dva krát dva

| | prompt |
|---|---|
| **a** | Ruins of a collapsed two-storey building filling the plot: prefab panels fallen outward in a fan, one corner of the facade still standing with empty window openings, heaps of grey rubble between, dust and soot, a bent steel railing. |
| **b** | Ruins of a burnt-out building: a rectangle of blackened rubble with the floor slab still readable underneath, charred roof beams collapsed inward, two stubs of brick wall standing at opposite corners, ash and soot. |
| **c** | Ruins pushed flat: an even field of crushed concrete and broken render across the whole plot, exposed reinforcement bars curling upward, one toppled slab lying diagonally, a shattered concrete step at the entrance side. |

#### `ruin_3x3` — tři krát tři

| | prompt |
|---|---|
| **a** | Ruins of a large collapsed building filling the plot: several prefab wall panels fallen outward like cards, an inner core of broken slabs and rubble, one tall fragment of wall still standing with empty window bands, dust-grey and soot-stained. |
| **b** | Ruins of a large burnt-out complex: blackened rubble covering the plot with the outline of the former wings still readable, charred beams and collapsed roof sheets, two brick chimney stubs standing, ash drifts against the debris. |
| **c** | Ruins of a large building pushed flat: an even spread of crushed masonry and twisted reinforcement, one long concrete slab tilted against the heap, a broken staircase leading up into nothing, cracked paving around the edge. |

#### `ruin_4x4` — čtyři krát čtyři

*Jediná budova téhle velikosti je uhelná elektrárna, takže ruina má nést
industriální trosky, ne bytové panely.*

| | prompt |
|---|---|
| **a** | Ruins of a collapsed industrial hall filling the plot: buckled steel roof trusses fallen across the floor, torn corrugated cladding, a broken chimney stub, heaps of grey rubble, rusted pipework sticking out of the debris. |
| **b** | Ruins of a burnt-out power plant: a blackened steel frame still partly standing with no cladding left, collapsed boiler drums, charred conveyor structure lying across the plot, soot and ash everywhere. |
| **c** | Ruins pushed flat: a wide field of crushed concrete, twisted reinforcement and shattered steel sections, a toppled chimney lying broken across the plot, rusted tanks split open, cracked concrete apron at the edge. |

### Co k tomu bude potřeba v kódu

Ruiny nemají definici budovy, takže si skript **nemá kde vzít půdorys** —
dostane vlastní tabulku rozměrů `1x1` až `4x4`. Losování varianty pak podléhá
témuž, co u budov: z `world.rng` (P2), jako jméno (P6), do savu (P7).


---

## 8. Co po nahrání zbývá dodělat

Tenhle dokument a skript řeší **obrázky**. Aby se objevily ve hře, bude ještě
potřeba:

1. **Načtení spritů přes `ContentSource`** — stejně jako ikony (P5), aby je
   mod směl přidat i přepsat.
2. **Losování varianty při vzniku budovy** z `world.rng` (P2).
3. **Save v9 a migrace** — varianta je nový údaj entity (P7).
4. **Renderer** — kreslit sprite místo kvádru, když existuje; kotva je střed
   spodní hrany, řazení zůstává podle `x + y`.
5. **Záloha na chybějící obrázek** — procedurální kvádr jako dosud. Mod, který
   sprity nedodá, nesmí hru zastavit.
