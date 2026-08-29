# Sprity budov služeb

**Status:** zadání pro tvorbu obrázků. Rozhodl autor.

Tenhle dokument popisuje **28 budov mimo zóny** — služby a inženýrské stavby —
každou ve **třech variantách**. Zástavba v zónách (obytná, obchodní,
průmyslová) přijde samostatně, tady není.

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

Chybějící obrázek **nesmí hru zastavit** — vykreslí se procedurální kvádr jako
dosud, stejně jako to dělá `iconSvg` u ikon.

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

## 3. Společná hlavička promptu

Tuhle část **připoj ke každé variantě**. K tomu vždycky přilož svůj referenční
design — ten nese styl, text nese obsah.

```
Isometric city-builder building asset, true 2:1 isometric projection seen from
the south-east, matching the attached reference in style, palette and line
weight.

The building stands on its own square plot. The plot is a perfect isometric
diamond and its four corners touch the edges of the image — nothing except the
roof may stick out past it, and nothing may be cut off.

Lighting is fixed: sunlight from the left. The left-facing wall is clearly
brighter than the right-facing wall; the roof is the brightest surface. Shadows
fall to the right and stay inside the plot.

Transparent background, no terrain, no grass or road outside the plot, no
people, no vehicles unless named, no text of any kind, no signage lettering, no
logos, no watermark. Clean hard edges, no blur, no depth of field, no vignette.

Square canvas, 1024 × 1024.
```

**Průhledné pozadí je lepší než klíčované** a ChatGPT ho umí. Ověřeno na tvých
prvních třech obrázcích: rohy na nule, půlka plátna průhledná, skript to pozná
sám. Sklo a měkké hrany tím zůstanou celé.

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
Generátor ale kreslí podstavu často mírně zkosenou — u tvé školy je vrchol
**36 px vedle středu**. Skript ho proto změří a zapíše do `index.json`; kdyby
se počítal ze středu, seděla by budova na dlaždici vedle.

### Na co si dát pozor

**Nápisy.** Prompt zakazuje text, ale generátor ho stejně občas dodá — tvoje
škola má na štítě anglické „SCHOOL". Hra je česká a lokalizovaná, takže
natvrdo vypsaný anglický nápis v ní je cizí těleso. Buď přegenerovat, nebo
vzít jako součást stylu; jen ať je to rozhodnutí.

**Výška.** Skript hlásí, o kolik je stavba vyšší, než čeká `heightLevels`
z definice. Škola vyšla o 22 % vyšší než jedno patro. Není to chyba obrázku —
je to informace, že sedmnáct pixelů, které si o ní myslí simulace, neodpovídá
tomu, jak vypadá. Buď se upraví `heightLevels` v definici, nebo se to nechá
být; kvádrová záloha pak bude nižší než sprite.

---

## 4. Kam obrázky nahrávat

```
art/sprites/raw/<id>__<varianta>.png
```

Varianta je `a`, `b` nebo `c`. Dvojité podtržítko schválně — v `id` jsou
podtržítka jednoduchá.

```
art/sprites/raw/hospital__a.png
art/sprites/raw/hospital__b.png
art/sprites/raw/coal_power_plant__c.png
```

Naladění:

```bash
python tools/fit-sprites.py
```

Skript vezme, co v `raw/` najde, odklíčuje pozadí, ořízne, zmenší na správnou
šířku a uloží do `content/vanilla/sprites/`. Rozměry si bere **z definic
budov**, ne z tabulky v sobě — když se půdorys změní, sprity se přepočítají
samy. Vypíše, co udělal, a upozorní, kde se výška rozchází s očekáváním.

Kontrola bez zápisu:

```bash
python tools/fit-sprites.py --check
```

---

## 5. Budovy

Sloupec **rozměr** je půdorys a počet pater z definice. Kurzívou je role
budovy ve hře — to, co má být na obrázku poznat na první pohled.

---

### Zdravotnictví

#### `clinic` — Klinika · 2 × 2, 1 patro

*Malá péče pro čtvrť. Nízká, přívětivá, ne nemocniční.*

| | prompt |
|---|---|
| **a** | A small interwar villa converted into a neighbourhood clinic: cream stucco walls, a bay window, a low hipped tile roof, a modest canopy over the entrance, a short paved path and two benches on the plot. |
| **b** | A single-storey socialist-era polyclinic: pale prefabricated panels, a horizontal band of glass-block windows, a flat gravel roof with a small vent, a concrete ramp to the double door. |
| **c** | A contemporary low clinic pavilion: warm timber cladding, floor-to-ceiling glazing on the entrance side, a flat green roof with sedum, a bicycle rack beside the door. |

#### `hospital` — Nemocnice · 3 × 3, 3 patra

*Největší zdravotnická stavba ve městě, pokryje celé město.*

| | prompt |
|---|---|
| **a** | A 1930s brick pavilion hospital: three connected wings, tall multi-pane windows, a small clock turret over the main entrance, a covered walkway between wings, mature shrubs along the plot edge. |
| **b** | A 1970s hospital monoblock: a wide slab with continuous ribbon windows, pale concrete panels, a helipad marked H on the flat roof, a covered ambulance bay at the base. |
| **c** | A contemporary hospital: white aluminium cladding with deep window reveals, a fully glazed atrium at the corner, a rooftop plant enclosure, a marked ambulance bay under a projecting canopy. |

---

### Bezpečnost

#### `police_small` — Policejní stanice · 2 × 2, 1 patro

*Základní stanice. Srozumitelná, ne reprezentativní.*

| | prompt |
|---|---|
| **a** | A corner police post in an old brick building: two storeys of the corner cut away for the entrance, a blue lamp over the door, arched ground-floor windows, a small paved forecourt. |
| **b** | A socialist-era police station: grey concrete panels, barred ground-floor windows, a heavy concrete canopy over the entrance, a flagpole, a fenced parking bay on the plot. |
| **c** | A contemporary low police station: dark glazing in a pale rendered frame, a projecting entrance box, two marked parking bays, a slim mast with an antenna. |

#### `police_large` — Policejní ředitelství · 2 × 2, 2 patra

*Nadřazený úřad. Musí být poznat, že je to víc než stanice.*

| | prompt |
|---|---|
| **a** | A historicist administrative headquarters: rusticated stone base, four engaged columns framing a tall portal, a cornice and a low balustrade, wide stone steps to the door. |
| **b** | A 1970s administrative block: a repeating grid of square windows in pale stone facing, a projecting entrance slab, three flagpoles, a paved forecourt. |
| **c** | A contemporary police headquarters: dark stone base with glazed upper floors, a cantilevered entrance canopy, a rooftop communications mast with dishes, bollards along the plot edge. |

#### `prison` — Věznice · 3 × 3, 2 patra

*Srazí kriminalitu v celém městě a cenu půdy všude, kam je na ni vidět.*

| | prompt |
|---|---|
| **a** | An Austro-Hungarian fortress prison: heavy stone walls with small barred openings, two corner watchtowers with conical roofs, a massive gate with iron doors, a bare gravel yard inside the wall. |
| **b** | A concrete prison block: long slab with narrow slit windows, a double perimeter fence with razor wire, floodlight masts at the corners, an empty exercise yard. |
| **c** | A contemporary prison: low pale pavilions around a courtyard, a smooth continuous perimeter wall with no handholds, camera poles at intervals, a single vehicle sally port. |

---

### Hasiči

#### `fire_station` — Hasičská zbrojnice · 2 × 2, 1 patro

*Základní zbrojnice. Vrata a věž jsou poznávací znamení.*

| | prompt |
|---|---|
| **a** | A brick village fire station: two red-painted timber engine doors, a tall narrow hose-drying tower with a pointed cap, a small gable with a bell, a paved apron in front of the doors. |
| **b** | A 1970s sheet-metal fire garage: corrugated cladding, two large red roller doors, a flat roof, a concrete apron with painted lines, a short hose tower at the back. |
| **c** | A modern fire station: three glazed roller doors in a pale rendered frame, a slim training tower with an antenna, a red band along the parapet, a clean concrete apron. |

#### `fire_station_large` — Velká hasičská zbrojnice · 2 × 2, 2 patra

*Dosáhne tam, kam malá ne. Větší a členitější než `fire_station`.*

| | prompt |
|---|---|
| **a** | A large brick fire station with a courtyard: four arched engine doors, a tall square hose-drying tower with a clock, a two-storey crew wing with tall windows, a paved courtyard behind. |
| **b** | A concrete fire station: four red roller doors under a continuous canopy, a two-storey crew block with ribbon windows, a separate square training tower with open window openings. |
| **c** | A contemporary fire station: a fully glazed apparatus bay showing the trucks inside, a two-storey crew wing in dark cladding, a ladder and a training tower on the roof, solar panels. |

---

### Vzdělání

#### `school` — Základní škola · 3 × 3, 1 patro

*Nízká a rozlehlá — zabírá celý pozemek, ale netyčí se.*

| | prompt |
|---|---|
| **a** | An interwar single-storey brick school: a symmetrical facade with a central entrance and stone surround, tall multi-pane classroom windows, a low hipped roof, a fenced playground on the plot. |
| **b** | A socialist-era pavilion school: two low linked pavilions with flat roofs, pale panels with orange window frames, a covered walkway between them, an asphalt yard with painted court lines. |
| **c** | A contemporary low school: timber and glass classroom wings around a small courtyard, a flat roof with skylights, colourful shading fins, a soft-surface play area. |

#### `high_school` — Střední škola · 2 × 2, 2 patra

*Vyšší vzdělání. Reprezentativnější než základní škola.*

| | prompt |
|---|---|
| **a** | A neo-renaissance grammar school: a two-storey facade with a pediment over the central bays, pilasters between tall windows, a stone plinth, wide steps to a double door. |
| **b** | A 1960s technical secondary school: two storeys of ribbon windows, a large abstract mosaic panel on the blank end wall, a projecting flat entrance canopy, a bicycle shelter. |
| **c** | A contemporary secondary school: two storeys with coloured panel infill between windows, a double-height glazed entrance hall, an outdoor stair to a roof terrace. |

#### `university` — Vysoká škola · 3 × 3, 3 patra

*Nejvyšší vzdělání ve městě. Nejvýraznější vzdělávací stavba.*

| | prompt |
|---|---|
| **a** | A baroque university college: a three-storey range around a courtyard, a domed corner tower, arched ground-floor arcade, ornamented window surrounds, a stone portal with a coat-of-arms shape (no lettering). |
| **b** | A brutalist university faculty: board-marked concrete, two cantilevered lecture-hall volumes projecting from the main slab, deep-set windows, an open concrete stair. |
| **c** | A contemporary university campus building: a glazed library volume with visible floor slabs, a taller teaching block in pale panels, a planted terrace linking them. |

---

### Kultura

#### `gallery` — Výstavní síň · 1 × 1, 1 patro

*Nejmenší kulturní stavba — jedna dlaždice. Drobná, ne monumentální.*

| | prompt |
|---|---|
| **a** | A small classicist garden pavilion used as a gallery: four slender columns carrying a shallow pediment, a glazed door between them, a stone step, two clipped shrubs. |
| **b** | A small white cube gallery: one fully glazed wall, a flat roof with a raised skylight lantern, a plain concrete step, a blank poster board beside the door. |
| **c** | A small timber-clad gallery cube: vertical dark timber boards, one large window, a flat roof, a freestanding poster column on the plot. |

#### `cinema` — Kino · 2 × 2, 1 patro

*Levná kultura pro každý den. Musí být poznat na první pohled.*

| | prompt |
|---|---|
| **a** | An art-deco cinema: a stepped facade with vertical fluting, a projecting marquee canopy with bare bulbs underneath, a neon frame around the entrance (no lettering), glazed doors. |
| **b** | A 1970s cinema: a windowless concrete box with a textured relief panel on the front, a wide flat canopy, three glass display cases for posters beside the doors. |
| **c** | A contemporary multiplex: a glazed foyer wrapping the corner, a blank dark LED panel above the entrance (no lettering), a cantilevered canopy, a paved forecourt. |

#### `theatre` — Divadlo · 2 × 2, 1 patro

*Večerní program pro čtvrť. Slavnostnější než kino.*

| | prompt |
|---|---|
| **a** | A neo-renaissance theatre: an arcaded ground floor, a balcony over the entrance, statues on the roofline parapet, a shallow dome over the auditorium, ornate window surrounds. |
| **b** | A 1960s theatre house: a marble-faced front with a full-height glazed foyer, a projecting flat canopy, a windowless fly tower rising behind, a paved forecourt. |
| **c** | A contemporary theatre: a matt black auditorium box with a glazed foyer wrapped around one corner, exposed steel columns, a taller fly tower with vertical cladding. |

#### `museum` — Muzeum · 3 × 3, 2 patra

*Sbírka, kvůli které se do města jezdí. Nejdražší kultura.*

| | prompt |
|---|---|
| **a** | A neoclassical museum: a wide flight of steps to a six-column portico with a pediment, a rusticated base, a long facade with tall arched windows, a low dome behind the portico. |
| **b** | A modernist museum pavilion: a raised stone-clad box on a recessed glazed base, a deep roof overhang, a sculpture plinth on the forecourt, a shallow reflecting pool. |
| **c** | A contemporary museum: a folded metal facade with irregular angled panels, a glazed slot entrance cutting into the mass, a small planted forecourt. |

---

### Sociální služby

#### `community_centre` — Společenské centrum · 2 × 2, 1 patro

*Místo, kde se čtvrť potká. Neformální, přívětivé.*

| | prompt |
|---|---|
| **a** | A Sokol-style community hall: red brick with rendered bands, a large gabled hall with round-arched windows, a timber porch, a small paved forecourt with a flagpole. |
| **b** | A socialist-era house of culture: a low flat-roofed hall, a mosaic panel across the entrance wall, a concrete canopy on thin columns, wide glazed doors, a paved terrace. |
| **c** | A contemporary community centre: a timber-framed hall with large windows, a covered outdoor terrace with benches, a sloping green roof, planters along the edge. |

#### `retirement_home` — Domov pro seniory · 3 × 3, 2 patra

*Péče o ty, kteří město postavili. Klidné, zelené, ne nemocniční.*

| | prompt |
|---|---|
| **a** | A small converted manor house used as a retirement home: a rendered two-storey block with a mansard roof, a central entrance with a canopy, mature trees and a gravel path on the plot. |
| **b** | A 1970s pavilion retirement home: two low wings with continuous loggias and balcony rails, pale panels, a flat roof, a paved courtyard with benches between the wings. |
| **c** | A contemporary retirement home: three low wings around a planted inner garden, warm render and timber balconies, a sheltered entrance, raised planting beds. |

---

### Parky

#### `park_small` — Park · 1 × 1, 1 patro

*Jedna dlaždice. Levné a jediné, co dělá, je že zvedá cenu půdy.*

| | prompt |
|---|---|
| **a** | A small square of lawn with one mature broadleaf tree, a wooden bench beneath it, a short gravel path, low hedge along one edge. |
| **b** | A small paved pocket square: stone paving in a simple pattern, a low circular fountain in the middle, two benches, four clipped trees in a row. |
| **c** | A small playground: a climbing frame with a slide, a sandpit, a bench, soft rubber surfacing in a bright colour, a low fence. |

#### `park_large` — Velký park · 2 × 2, 1 patro

*Zvedá cenu půdy v širokém okolí a nestojí skoro nic.*

| | prompt |
|---|---|
| **a** | A city park: curving gravel paths through lawn, several mature trees, an ornamental bandstand pavilion, benches and a lamp post, a flower bed. |
| **b** | A sports park: a fenced multi-use hard court with goals, a running track loop around lawn, an outdoor exercise frame, benches and two trees. |
| **c** | A naturalistic park: an irregular pond with reeds, a small timber footbridge, meadow planting and a few birches, a winding path. |

---

### Odpady

#### `landfill` — Skládka · 3 × 3, 1 patro

*Levné zpracování odpadu za cenu silného znečištění okolí. Má být ošklivá.*

| | prompt |
|---|---|
| **a** | A raw landfill: mounds of covered earth and rubbish, tyre tracks in mud, a yellow bulldozer pushing a heap, a simple wire fence, a muddy access apron. |
| **b** | A fenced tipping site: sorted heaps of waste, a weighbridge hut at the entrance, wind-blown litter caught in tall netting screens, gulls circling above the mounds. |
| **c** | A managed landfill: a graded and partly grassed cell, gas vent pipes rising from the surface, a leachate tank, a compactor vehicle, a gated fence. |

#### `incinerator` — Spalovna · 3 × 3, 2 patra

*Zpracuje třikrát víc odpadu a znečišťuje méně. Komín je poznávací znamení.*

| | prompt |
|---|---|
| **a** | An old brick incinerator: a tall round brick chimney, a pitched-roof boiler hall with tall industrial windows, a tipping ramp on one side, soot-darkened brickwork. |
| **b** | A technical incinerator block: a grey steel-clad hall with external ducting, two cylindrical steel silos, a square steel chimney with guy wires, a covered tipping bay. |
| **c** | A modern waste-to-energy plant: a clean white and glass hall with a curved roof, one slender white chimney, a glazed control wing, a covered lorry entrance. |

---

### Doprava

#### `transit_stop` — Zastávka MHD · 1 × 1, 1 patro

*Jedna dlaždice. Lidé v okolí přesednou z aut.*

| | prompt |
|---|---|
| **a** | A simple bus shelter: a painted steel frame with a glass back panel, a curved metal roof, a bench inside, a stop pole with a blank round sign, a short paved platform. |
| **b** | A concrete bus shelter: a heavy precast canopy on two square legs, a timetable case on the back wall, a plain bench, a rusted stop pole, cracked paving. |
| **c** | A modern bus stop: a fully glazed shelter with a flat roof, a leaning bench, a slim pole with a blank digital display panel, tactile paving strip along the kerb. |

#### `tram_stop` — Tramvajová zastávka · 1 × 1, 1 patro

*Koleje sdílí vozovku. Musí být poznat kolej a trolej, ne jen přístřešek.*

| | prompt |
|---|---|
| **a** | A tram boarding island: a raised stone kerb platform with iron railings along the back, a pair of rails set in cobbles along one edge, an overhead wire on a slender mast, a stop pole. |
| **b** | A concrete tram platform: a plain raised platform with a small metal shelter, rails in asphalt along the edge, a catenary mast with a bracket arm, a timetable case. |
| **c** | A modern low-floor tram stop: a long low platform with a tactile edge strip, a glazed shelter with a flat roof, rails in a grassed track bed, a slim catenary pole. |

#### `metro_station` — Stanice metra · 2 × 2, 1 patro

*Vestibul nad zemí. Silnice nezatěžuje vůbec, ale stojí nejvíc.*

| | prompt |
|---|---|
| **a** | A stone metro entrance vestibule: a low granite-clad pavilion with a wide opening, a broad stair descending into shadow, brass handrails, a lamp on each side. |
| **b** | A concrete metro vestibule: a square hall with a glazed clerestory, a coloured ceramic mosaic band around the entrance, a shallow canopy, wide steps down. |
| **c** | A contemporary metro vestibule: a glass box with a thin flat roof, escalators visible descending inside, brushed steel frame, a tactile paving strip at the doors. |

#### `transit_depot` — Vozovna MHD · 3 × 3, 2 patra

*Sama nic neobsluhuje, ale bez ní se nedá postavit zastávka.*

| | prompt |
|---|---|
| **a** | A brick tram depot: a long hall with four tall arched gate openings, a shallow pitched roof with ventilation lanterns, rails fanning out onto the paved apron, brick pilasters between gates. |
| **b** | A sheet-metal bus depot: a wide corrugated hall with three roller doors, a large open parking apron with painted bays, a fuel point with a small canopy, a chain-link fence. |
| **c** | A modern depot: a saw-tooth roof with north-facing glazing, solar panels on the south slopes, a glazed workshop end, a clean marked apron with charging posts. |

---

### Energie a voda

#### `coal_power_plant` — Uhelná elektrárna · 4 × 4, 2 patra

*Největší stavba ve hře. Zabírá šestnáct dlaždic.*

| | prompt |
|---|---|
| **a** | An old coal power station: a tall brick boiler hall with a row of tall industrial windows, two slender round brick chimneys, a coal yard with a conveyor bridge, soot staining. |
| **b** | A coal plant with two hyperbolic cooling towers, a steel-clad turbine hall between them, a coal stockpile with a bucket-wheel loader, a lattice switchyard with pylons. |
| **c** | A modernised coal plant: one tall banded chimney with red and white stripes, a boxy flue-gas desulphurisation unit with round absorbers, a clean steel turbine hall, a covered coal store. |

#### `water_works` — Vodárna · 3 × 3, 2 patra

*Zakládá vodní síť. Musí stát u vody.*

| | prompt |
|---|---|
| **a** | A brick water tower works: a round brick tower with a corbelled tank at the top and a conical roof, a low brick pump house beside it, arched windows, an iron door. |
| **b** | A concrete waterworks: a rectangular technical building with narrow windows, two large circular concrete storage tanks beside it, exposed pipework and valves, a service ladder. |
| **c** | A modern water treatment works: two low pale halls with a glazed control room, one slim cylindrical tower, stainless pipework running between them, a fenced compound. |

#### `water_treatment` — Čistírna odpadních vod · 3 × 3, 1 patro

*Kapacita kanalizace. Nízká, technická, nádrže dominují.*

| | prompt |
|---|---|
| **a** | A sewage works with circular clarifiers: two large open round concrete tanks with rotating bridge arms, a small brick control house, pipework and walkways between tanks. |
| **b** | A rectangular sewage works: long open concrete basins in a row with steel handrails, a low technical building, aeration pipes and a small blower house. |
| **c** | A modern covered treatment plant: enclosed tanks under low domed covers, a compact operations building with a glazed corner, stainless pipework, a fenced perimeter. |

#### `pump_station` — Čerpací stanice · 1 × 1, 1 patro

*Jedna dlaždice. Prodlužuje dosah vodovodu, sama vodu nezaloží.*

| | prompt |
|---|---|
| **a** | A small brick pump house: a single-room brick hut with a pitched tile roof, one small barred window, an iron door, exposed valves and a pipe emerging from the ground beside it. |
| **b** | A concrete pump kiosk: a plain flat-roofed concrete box, a steel door, a ventilation grille, thick pipes running out of the wall and into the ground, a small bollard. |
| **c** | A modern pump kiosk: a compact stainless-steel clad box with a slightly sloped roof, a louvred panel, colour-coded pipework and valves outside on a concrete pad. |

---

## 6. Co po nahrání zbývá dodělat

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
