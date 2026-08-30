# Sprity zástavby v zónách

**Status:** zadání pro tvorbu obrázků. Rozhodl autor.

Třicet devět budov, které vyrostou v obytné, obchodní a průmyslové zóně —
každá ve **třech variantách**, tedy **117 obrázků**. Služby a inženýrské stavby
jsou v `06-SPRITY-SLUZEB.md`; platí odtud **všechno** — styl, hlavička promptu,
geometrie, postup i skripty. Tady jsou jen prompty.

---

## 1. Co je na zástavbě jiné

### Půdorys nemusí být čtvercový

Na rozdíl od služeb tu jsou i **2 × 1 a 3 × 2**. Dvě věci, které z toho plynou,
řeší skripty samy a **do promptu se nepíšou**:

- **Tvar pozemku** doplní `generate-sprites.py` z definice budovy. U čtverce
  napíše „square of 3 by 3 city tiles", u obdélníku „RECTANGLE of 2 by 1".
  Kdyby to prompt neřekl, generátor nakreslí čtverec a proporce budou špatně.
- **Kotva** se měří, ne dopočítává ze středu. U čtvercového půdorysu leží
  spodní vrchol podstavy uprostřed šířky, u obdélníkového **ne** — a kdyby se
  počítal, seděly by řadové domy na dlaždici vedle.

### Budovy mají úroveň

Zástavba roste. `residential_small` je úroveň 1, `residential_spire` úroveň 5 —
je to **táž parcela o dvacet let později**, ne jiný druh domu. Prompty to
respektují: čím vyšší úroveň, tím větší a hodnotnější stavba.

### Neopakovat siluetu

Tři varianty jedné budovy si mají být blízké velikostí, ale ne tvarem. V zóně
jich stojí vedle sebe deset a když mají všechny stejný obrys, je to vidět dřív
než u jedné školy.

---

## 2. Obytná zóna

### `residential_small` — Malý dům · 1 × 1, 1 patro, úroveň 1

| | prompt |
|---|---|
| **a** | A small single-storey family house: rendered ochre walls, a pitched tile roof, a wooden porch, a picket fence around a small garden with a vegetable patch. |
| **b** | A small brick cottage: red brick with a rendered gable, a steep tile roof with one dormer, a lean-to shed at the side, a gravel path to the door. |
| **c** | A small prefab bungalow: pale panels, a shallow flat roof with a parapet, a concrete step to the door, a metal fence and a clothes line in the yard. |

### `residential_medium` — Patrový dům · 1 × 1, 2 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A two-storey family house: rendered walls in cream and brown, a hipped tile roof, a balcony over the entrance, a garage door in the base, a low hedge. |
| **b** | A two-storey brick house with a rendered upper floor, a gable roof, steel-framed windows, an external stair to a first-floor door, a small paved yard. |
| **c** | A two-storey cube house: flat roof with a parapet, pale render with a dark base band, a projecting glazed stairwell, a concrete driveway. |

### `residential_large` — Nájemní dům · 1 × 1, 3 patra, úroveň 3

| | prompt |
|---|---|
| **a** | A three-storey tenement: rendered ochre facade with a moulded cornice, tall steel-framed windows in a regular grid, a recessed entrance, a small paved forecourt. |
| **b** | A three-storey brick apartment block: exposed brick with rendered bands between floors, balconies with painted metal rails, a flat roof, bins in a fenced corner. |
| **c** | A three-storey prefab block: grey concrete panels with visible joints, continuous window bands, loggias on one side, a concrete entrance canopy. |

### `residential_row` — Řadové domy · 2 × 1, 1 patro, úroveň 1

| | prompt |
|---|---|
| **a** | A terrace of four small single-storey houses in a row: alternating ochre and cream render, a continuous pitched tile roof, small front gardens with low fences. |
| **b** | A row of brick cottages sharing walls: red brick, individual gabled roofs of slightly different heights, a shared paved path along the front. |
| **c** | A row of prefab bungalows: identical pale panel units with flat roofs, a continuous concrete kerb, small paved yards with clothes lines. |

### `residential_terrace` — Činžovní řada · 2 × 1, 2 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A two-storey terrace of townhouses: continuous rendered facade in warm ochre, regular tall windows, a shared pitched tile roof, doors straight onto the pavement. |
| **b** | A two-storey brick terrace with rendered ground floor, small shopfront-like windows below and living windows above, a flat roof with a parapet. |
| **c** | A two-storey prefab terrace: repeating panel bays with recessed loggias, a flat roof, a continuous concrete canopy over the doors. |

### `residential_court` — Obytný dvůr · 2 × 2, 3 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A three-storey housing block around a small inner courtyard: rendered ochre facades, a passage through to the yard, pitched tile roofs, mature trees in the court. |
| **b** | A brick perimeter block with rendered upper floors, balconies facing inward, a flat roof, a paved courtyard with carpet beaters and benches. |
| **c** | Two prefab slabs set at right angles around a paved court: pale panels, continuous loggias, a low bicycle shelter and concrete planters between them. |

### `residential_tower` — Věžák · 2 × 2, 5 pater, úroveň 3

| | prompt |
|---|---|
| **a** | A five-storey residential slab: prefab panels in pale grey and ochre, continuous loggias along the long face, a flat roof with a lift overrun, concrete entrance canopy. |
| **b** | A five-storey brick apartment building: exposed brick with rendered spandrels, a strict window grid, projecting concrete balconies, a flat roof with a parapet. |
| **c** | A five-storey stepped block: two staggered volumes of different heights, panel cladding with a coloured band per floor, an external glazed stairwell. |

### `residential_terraces` — Řadové terasy · 3 × 2, 4 patra, úroveň 3

| | prompt |
|---|---|
| **a** | A long four-storey terraced housing block: a continuous panel facade with rhythmic loggias, a flat roof, a row of entrances with small canopies, a strip of lawn in front. |
| **b** | A four-storey brick terrace stepping down along its length, rendered upper floors, balconies on the sunny side, bins and bicycle stands at the ends. |
| **c** | A four-storey block with a stepped section: each upper floor set back to form roof terraces with planters, panel cladding, an external concrete stair. |

### `residential_quarter` — Obytná čtvrť · 3 × 3, 5 pater, úroveň 3

| | prompt |
|---|---|
| **a** | Two five-storey prefab slabs set parallel with a landscaped strip between them: pale panels, continuous loggias, flat roofs, a paved path and drying frames between the blocks. |
| **b** | An L-shaped five-storey brick housing block around a planted courtyard, rendered upper floors, balconies inward, a passage arch, a playground in the court. |
| **c** | Three staggered five-storey blocks of slightly different heights around a paved square with concrete planters, benches and a small kiosk. |

### `residential_highrise` — Výšková budova · 2 × 2, 6 pater, úroveň 4

| | prompt |
|---|---|
| **a** | A six-storey residential tower: prefab panels with a coloured band marking each floor, continuous loggias, a flat roof with lift overrun and antennas, a paved base with planters. |
| **b** | A six-storey point block in exposed concrete with brick infill, projecting balcony slabs, a recessed glazed ground floor, a low bicycle shelter. |
| **c** | A six-storey tower with a projecting stair core clad in glass blocks, panel facades, a roof plant enclosure, a small paved forecourt. |

### `residential_estate` — Sídliště · 3 × 3, 7 pater, úroveň 4

| | prompt |
|---|---|
| **a** | A seven-storey housing estate: one long prefab slab with a shorter one behind, continuous loggias, flat roofs with lift overruns, drying frames and beaten paths on the lawn between them. |
| **b** | Two seven-storey slabs forming an L around a paved court with a sandpit and carpet beaters, panel facades with coloured accent bays, a low boiler house at one end. |
| **c** | A seven-storey stepped estate block: three linked sections of different heights, panel cladding, external glazed stairwells, concrete planters along the base. |

### `residential_spire` — Rezidenční věž · 2 × 2, 8 pater, úroveň 5

| | prompt |
|---|---|
| **a** | An eight-storey residential tower: slender prefab point block, loggias on all sides, a flat roof crowded with lift overrun, antennas and a red aircraft light, a paved base. |
| **b** | An eight-storey tower in exposed concrete with a strongly expressed vertical stair core, deep balcony recesses, a glazed ground floor with a canopy. |
| **c** | An eight-storey tower with a cranked plan: two wings meeting at an angle, panel cladding with a coloured stripe, a roof plant enclosure, planters at the base. |

### `residential_skyline` — Panorama · 3 × 3, 10 pater, úroveň 5

| | prompt |
|---|---|
| **a** | A ten-storey housing landmark: one tall prefab slab with a lower wing at its foot, continuous loggias, a busy flat roof with lift overruns, antennas and vents, a paved plaza with planters. |
| **b** | A ten-storey tower and a linked five-storey block around a raised terrace, exposed concrete frame with panel infill, external glazed stairwells, a canopy over the entrance. |
| **c** | Three linked towers of ten, eight and six storeys stepping down, panel cladding with coloured bands, a shared paved base with benches and low walls. |

---

## 3. Obchodní zóna

### `commercial_small` — Obchod · 1 × 1, 1 patro, úroveň 1

| | prompt |
|---|---|
| **a** | A small single-storey corner shop: rendered walls, a wide glazed shopfront with a blank sign board above it, a canvas awning, crates and a bicycle stand outside. |
| **b** | A small brick shop with a rendered front, two display windows either side of a recessed door, a flat roof with a parapet, a delivery ramp at the side. |
| **c** | A small prefab kiosk-shop: pale panels and a fully glazed front, a flat roof with a wide overhang, a paved apron with two benches. |

### `commercial_medium` — Obchodní dům · 1 × 1, 2 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A two-storey shop building: glazed shopfront below, rendered offices above with regular windows, a projecting canopy, a blank sign panel over the entrance. |
| **b** | A two-storey brick commercial building with a rendered upper floor, a corner entrance cut at an angle, steel-framed display windows, a flat roof. |
| **c** | A two-storey retail block in panels with a fully glazed ground floor, an opaque coloured spandrel band, a cantilevered canopy, a small loading bay. |

### `commercial_large` — Kancelářský dům · 1 × 1, 3 patra, úroveň 3

| | prompt |
|---|---|
| **a** | A three-storey office building: rendered facade with a strict window grid, a stone-clad base, a recessed entrance with a canopy, a paved forecourt with planters. |
| **b** | A three-storey brick office block with rendered bands, tall steel-framed windows, a projecting stair bay, a flat roof with a parapet. |
| **c** | A three-storey office in an exposed concrete frame with opaque blue glazed infill panels, a glazed entrance hall, a roof plant box. |

### `commercial_row` — Obchodní řada · 2 × 1, 1 patro, úroveň 1

| | prompt |
|---|---|
| **a** | A row of four small single-storey shops: continuous glazed shopfronts with blank sign boards, individual awnings in different colours, a paved pavement with bollards. |
| **b** | A brick parade of shops with rendered fascia, recessed doorways, a continuous flat canopy on slim columns, crates and a bicycle rack outside. |
| **c** | A prefab shopping row: repeating glazed bays between concrete piers, a flat roof with a deep overhang, a paved apron with benches and a poster column. |

### `commercial_arcade` — Obchodní pasáž · 2 × 1, 2 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A two-storey shopping arcade: a colonnaded ground floor sheltering shopfronts, rendered upper floor with regular windows, a pitched roof, terrazzo paving under the arcade. |
| **b** | A brick arcade block: round-arched openings at street level, rendered upper storey, a flat roof with a parapet, lamps under the arches. |
| **c** | A modern arcade: a fully glazed passage between two panel-clad wings, a shallow barrel roof light over the passage, a paved forecourt. |

### `commercial_centre` — Obchodní centrum · 2 × 2, 3 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A three-storey department store: continuous glazed shopfront at street level, rendered upper floors with ribbon windows, a blank sign panel on the corner, a paved forecourt with planters. |
| **b** | A three-storey brick and render retail block with a corner rotunda, tall windows, a projecting canopy along the front, a delivery yard at the back. |
| **c** | A three-storey retail centre in an exposed concrete frame with opaque green glazed panels, a double-height glazed entrance, an external escalator bay. |

### `commercial_gallery` — Obchodní pasáž · 3 × 2, 4 patra, úroveň 3

| | prompt |
|---|---|
| **a** | A four-storey retail gallery: a long glazed shopping street under a shallow glass roof, rendered upper floors with ribbon windows, entrances at both ends. |
| **b** | A four-storey brick gallery block with a rendered arcade at street level, upper floors of offices, a flat roof with a parapet, a service yard at one end. |
| **c** | A four-storey gallery in panels and glass: two parallel wings joined by a glazed bridge, a covered passage between them, planters along the front. |

### `commercial_plaza` — Obchodní náměstí · 3 × 3, 5 pater, úroveň 3

| | prompt |
|---|---|
| **a** | A five-storey retail and office block around a paved plaza: glazed shopfronts at ground level, rendered upper floors, a fountain and planters on the plaza, a poster column. |
| **b** | A brick and render block with a raised terrace forming a small square, arcaded shopfronts below, five storeys of offices above, steps and low walls. |
| **c** | A five-storey complex of two panel-clad wings around a sunken paved court with steps, glazed ground floor, a canopy linking the wings. |

### `commercial_tower` — Kancelářská věž · 2 × 2, 5 pater, úroveň 3

| | prompt |
|---|---|
| **a** | A five-storey office tower: rendered facade with a strict grid of windows, a stone-clad base with a glazed lobby, a flat roof with a plant enclosure, flagpoles without flags. |
| **b** | A five-storey office block in exposed concrete with opaque blue glazed infill, a projecting stair core, a cantilevered entrance canopy, a paved forecourt. |
| **c** | A five-storey tower with a stepped top floor forming a roof terrace, panel cladding, a fully glazed ground floor, planters along the base. |

### `commercial_offices` — Kancelářská budova · 2 × 2, 6 pater, úroveň 4

| | prompt |
|---|---|
| **a** | A six-storey office building: continuous ribbon windows in a panel facade, a recessed glazed ground floor, a flat roof with plant and antennas, a paved forecourt with planters. |
| **b** | A six-storey administrative block in stone-faced panels with a regular deep-set window grid, a projecting entrance slab, three flagpoles without flags. |
| **c** | A six-storey office with an exposed concrete frame and opaque teal glazed infill, a full-height glazed stair tower on the corner, a small sunken plaza. |

### `commercial_mall` — Nákupní centrum · 3 × 3, 7 pater, úroveň 4

| | prompt |
|---|---|
| **a** | A large seven-storey retail centre: a broad glazed shopping base with a taller office slab above, a cantilevered canopy along the front, a loading yard at the back, a paved forecourt. |
| **b** | A seven-storey department store: stone-faced upper floors with narrow vertical windows over a fully glazed retail base, a corner tower, a delivery ramp. |
| **c** | A seven-storey complex of two linked blocks with a glazed atrium between them, panel cladding with coloured bands, an external escalator, planters at the base. |

### `commercial_highrise` — Kancelářská věž · 2 × 2, 8 pater, úroveň 5

| | prompt |
|---|---|
| **a** | An eight-storey office tower: a slender slab with continuous ribbon glazing and panel spandrels, a recessed glazed lobby, a roof plant enclosure with antennas. |
| **b** | An eight-storey tower in exposed concrete with deep-set windows and a strongly expressed stair core, a projecting canopy, a paved plaza with low walls. |
| **c** | An eight-storey tower with a cranked plan and a glazed corner, opaque blue infill panels, a stepped top floor, planters and benches at the base. |

### `commercial_downtown` — Obchodní centrum města · 3 × 3, 10 pater, úroveň 5

| | prompt |
|---|---|
| **a** | A ten-storey city-centre landmark: a tall office slab rising from a broad two-storey glazed retail podium, a cantilevered canopy, a paved plaza with a fountain and planters. |
| **b** | A ten-storey tower and a linked five-storey block around a raised terrace, stone-faced upper floors, a fully glazed base, an external escalator to the terrace. |
| **c** | Three linked towers of ten, seven and four storeys stepping down over a shared glazed podium, panel and glass cladding, a sunken paved court with steps. |

---

## 4. Průmyslová zóna

### `industrial_small` — Dílna · 1 × 1, 1 patro, úroveň 1

| | prompt |
|---|---|
| **a** | A small single-storey workshop: rendered walls with a wide steel roller door, a pitched corrugated roof, a stack of pallets and an oil drum outside, a gravel apron. |
| **b** | A small brick workshop with a shallow pitched roof, high strip windows, a timber double door, a workbench and scrap metal in the yard. |
| **c** | A small prefab unit: corrugated steel cladding, a roller shutter, a flat roof with a vent, a concrete apron with painted lines and a skip. |

### `industrial_medium` — Továrna · 1 × 1, 2 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A two-storey small factory: brick lower floor and rendered upper floor, tall industrial windows, a short square chimney, a loading platform with a canopy. |
| **b** | A two-storey works in concrete frame with brick infill, a saw-tooth roof section, external ducting, a fenced yard with drums. |
| **c** | A two-storey prefab plant: panel cladding with a horizontal window band, a flat roof with vents and a small stack, a roller door and a truck bay. |

### `industrial_large` — Slévárna · 1 × 1, 3 patra, úroveň 3

| | prompt |
|---|---|
| **a** | A three-storey foundry: soot-darkened brick with tall arched windows, a tall round brick chimney, an external steel stair, a slag heap in the yard. |
| **b** | A three-storey works hall in concrete frame with steel cladding, a raised roof lantern venting heat, external ducts and pipes, a crane rail along the side. |
| **c** | A three-storey plant with a stepped profile: a taller melting bay with a steel stack and a lower workshop, corrugated cladding, a fenced yard with drums. |

### `industrial_row` — Skladová hala · 2 × 1, 1 patro, úroveň 1

| | prompt |
|---|---|
| **a** | A long single-storey warehouse: corrugated steel cladding, three roller doors along the front, a shallow pitched roof, a concrete apron with pallets and a forklift. |
| **b** | A brick storage shed with a pitched roof and skylights, timber loading doors, a raised loading platform along the front, crates and drums. |
| **c** | A prefab depot: concrete panel walls with a continuous strip window, a flat roof, two roller shutters, a fenced yard with a small gatehouse. |

### `industrial_yard` — Výrobní hala · 2 × 1, 2 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A two-storey production hall with an open yard: steel-clad hall with high strip windows, an outdoor storage area with stacked pipes and a gantry, a fenced boundary. |
| **b** | A brick production hall with a saw-tooth roof, a two-storey office end with regular windows, a loading dock, a small transformer hut in the yard. |
| **c** | A prefab hall with a flat roof and external ducting, a two-storey office block attached, a paved yard with painted bays and a skip. |

### `industrial_works` — Velká továrna · 2 × 2, 3 patra, úroveň 2

| | prompt |
|---|---|
| **a** | A three-storey factory: long brick production block with tall windows, a saw-tooth roof over one wing, a square brick chimney, a gatehouse and a fenced yard. |
| **b** | A three-storey works in concrete frame with panel infill, a raised roof lantern, external pipe runs, a loading yard with a truck and stacked crates. |
| **c** | A three-storey plant with two linked halls at right angles, corrugated cladding, a steel stack with guy wires, an internal yard with a gantry crane. |

### `industrial_chemical` — Chemický závod · 2 × 2, 4 patra, úroveň 3

| | prompt |
|---|---|
| **a** | A chemical works: a four-storey process tower in exposed concrete, horizontal storage tanks on cradles, dense pipework and valve racks, a slender stack with a red band. |
| **b** | A brick chemical plant with a taller reaction building, two spherical tanks on steel frames, external stairs and pipe bridges, a fenced compound with warning bollards. |
| **c** | A modern chemical unit: steel-clad process block, a cluster of vertical columns and heat exchangers, a flare stack, a bunded tank farm on the plot. |

### `industrial_hall` — Výrobní hala · 3 × 2, 4 patra, úroveň 3

| | prompt |
|---|---|
| **a** | A large four-storey production hall: a long steel-clad building with a saw-tooth roof, a four-storey office end with ribbon windows, loading docks with canopies. |
| **b** | A brick manufacturing hall with tall arched windows and a raised roof lantern, an attached office wing, a rail siding with hoppers along one edge. |
| **c** | A concrete-frame hall with panel infill and a flat roof carrying ducting, an external gantry crane spanning the yard, a paved apron with painted bays. |

### `industrial_complex` — Průmyslový komplex · 3 × 3, 5 pater, úroveň 3

| | prompt |
|---|---|
| **a** | An industrial complex: two linked production halls with saw-tooth roofs, a five-storey office and services block, a square chimney, a yard with a gantry and stacked pipes. |
| **b** | A brick industrial complex around an internal yard: tall workshop halls, a five-storey administrative wing with a clock gable, a boiler house with a round chimney. |
| **c** | A concrete-frame complex with steel-clad halls of different heights, a five-storey stair and services tower, pipe bridges between blocks, a fenced compound. |

### `industrial_foundry` — Slévárna · 2 × 2, 6 pater, úroveň 4

| | prompt |
|---|---|
| **a** | A six-storey foundry: a tall melting hall with a raised vented lantern, soot-stained steel cladding, a massive round chimney, a slag yard with a tipping wagon. |
| **b** | A brick foundry with a six-storey charging tower, external steel stairs and conveyors, a tall banded chimney, glowing vents in the hall wall. |
| **c** | A concrete foundry block with a stepped profile: a tall casting bay with a steel stack, a lower finishing hall, a gantry crane over the yard. |

### `industrial_refinery` — Rafinerie · 3 × 3, 7 pater, úroveň 4

| | prompt |
|---|---|
| **a** | A refinery: a group of tall distillation columns on a steel frame, horizontal drums, dense pipework, a flare stack with a small flame, cylindrical storage tanks in a bund. |
| **b** | A refinery block with a seven-storey process tower in exposed concrete, heat exchangers and pumps at its base, a pipe bridge crossing the plot, a control building. |
| **c** | A compact refinery: two clusters of columns of different heights, a spherical pressure vessel, an elevated pipe rack running the length of the plot, a fenced compound. |

### `industrial_smelter` — Huť · 2 × 2, 8 pater, úroveň 5

| | prompt |
|---|---|
| **a** | An eight-storey smelter: a towering charging structure with inclined skip hoists, a massive banded chimney, soot-darkened steel cladding, slag ladles on rails in the yard. |
| **b** | A brick and steel smelting works: an eight-storey furnace tower with external stairs, a lower casting hall with a raised lantern, conveyors and a dust extraction duct. |
| **c** | A concrete smelter block: an eight-storey process tower with pipe runs on the outside, a wide casting bay with a gantry crane, two tall stacks with red bands. |

### `industrial_park` — Průmyslový park · 3 × 3, 10 pater, úroveň 5

| | prompt |
|---|---|
| **a** | A large industrial park: a ten-storey process tower dominating a group of steel-clad halls, pipe bridges between them, a tank farm in a bund, a gatehouse and a fenced perimeter. |
| **b** | An industrial park with a ten-storey administrative and services tower over a base of brick production halls, a rail siding with wagons, a chimney with a red band. |
| **c** | A dense industrial park: three blocks of ten, seven and four storeys linked by covered conveyors, steel and concrete cladding, a paved yard with gantries and stacked containers. |
