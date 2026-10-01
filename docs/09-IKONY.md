# Ikony rozhraní

Zadání pro **ikony v paletě a v panelech**, ne pro sprity na mapě. Sprity mají
`06-SPRITY-SLUZEB.md` a `07-SPRITY-ZONY.md`, dlaždice `08-DLAZDICE.md`.

**Platí oddíl „Jednotný styl (T138)".** Ploché štítky níž jsou historie
(T60–T137): vysvětlují, proč se která ikona kreslila jak, a sada z nich
zatím v `content/vanilla/icons/` pořád leží, dokud ji T138 nepřegeneruje.

## Jednotný styl (T138)

Autor: „Máme tu nejméně 5 typů ikonek, to je strašný maglajs. Chci, abys
všechny přegeneroval ve stylu silnice nebo toho kusu země s šipkou. Všechny
budou mít černé pozadí, stejnou velikost … Musí být jasně identifikovatelné,
o jaký typ ikonky jde."

Do T137 se v sadě potkaly ploché štítky (služby), izometrické kostky (silnice,
terén), fotky z hry (katastrofy), samostatné předměty (diskety, mince) a
svgčkové tvary tam, kde obrázek chyběl. **Od T138 platí jen tohle**: lesklá
izometrická miniatura na **černém neprůhledném** pozadí (#000), světlo zleva
shora, střed, objekt zabírá zhruba tři čtvrtiny čtverce. Vzor je stávající
`road-street.png` a `terrain-raise.png`.

Generuje `tools/generate-icons.py`, prompty čte **z tohoto oddílu**: společná
hlavička + věta kategorie (oplocený blok pod `###`) + řádek tabulky. Surové
obrázky 1024² jdou do `art/icons/t138/`, zmenšené 128² rovnou do
`content/vanilla/icons/<id>.png`. Pozadí zůstává černé, ikony **nejsou
průhledné**.

### Gramatika kategorií

Kategorie se pozná dřív než předmět — **podle podložky**, ne podle barvy.
Pět podložek, každá jiného tvaru, aby šly rozlišit i ve 32 px:

| kategorie | podložka | co nese |
|---|---|---|
| stavba (silnice, terén, zóny, potrubí, vedení, demolice) | **čtvercová dlaždice** země: tráva nahoře, hnědá hlína po stranách | nástroj stojí na dlaždici nebo tvoří její povrch |
| budovy a služby | **kulatý kamenný podstavec** s barevným lemem oboru | zjednodušená budova, symbol oboru velký na fasádě |
| vrstvy mapy a pohledy (`layer-*`, `coverage-*`, `view-*`) | **tři tenké skleněné desky** nad sebou | vrchní deska tónovaná barvou tématu, symbol stojí na ní; u dosahu navíc soustředné kruhy |
| akce a rozhraní | **nic** — volně plovoucí předmět | jeden předmět: disketa, otazník, bublina, mince, šipky |
| katastrofy a události | **rozlámaný úlomek ohořelé skály** s červenooranžovou září zespodu | nebezpečí jako 3D předmět, převládá červená, oranžová, uhlová |

Barva lemu u budov drží obor, stejně jako dřív barva štítku:

| obor | lem |
|---|---|
| pořádek | modrá |
| hasiči | červená |
| zdraví | bílá s červeným pruhem |
| vzdělání | jantarová |
| kultura | fialová |
| sounáležitost | růžová |
| voda | azurová |
| energie a vedení | žlutá |
| odpad | olivová |
| doprava | oranžová |
| parky | zelená |

**Proč podložka a ne barva.** Barvy už nesou obor uvnitř budov a téma uvnitř
vrstev; kdyby nesly i kategorii, srazily by se (červená = hasiči, nebo
katastrofa?). Tvar podložky je volný a čte se i periferním viděním.

**Proč černé pozadí a ne průhledné.** Průhledné pozadí `gpt-image-2` od
2026-10-01 odmítá, a hlavně: černá je totéž, co HUD kolem tlačítka, takže
ikona nemá lem a všechny mají stejný čtverec.

### Inventura

Jména se berou z kódu (`src/render/app.ts` nástroje, `src/ui/hud.ts`,
`home.ts`, `newGameDialog.ts`, `transitPanel.ts`, `financePanel.ts`),
z budov v nabídce (`buildingIcon` bere holé id), z tříd služeb
(`coverage-<třída>`) a z druhů katastrof v `balance.json`.

**Nová jména — kód je musí teprve začít používat** (rozhraní edituje jiné
sezení, tady se jen kreslí):

| id | místo starého | proč |
|---|---|---|
| `wire-low`, `wire-high` | `bolt` | vedení mělo jen svg blesk |
| `wire-remove` | odstranit vedení | A short, chunky grey steel lattice pylon on the grass tile with one very thick black cable, and a HUGE pair of red-handled bolt cutters, almost as big as the pylon, snipping the cable in front of it; bright yellow sparks at the cut and the two severed cable ends dangling. The bolt cutters are the main subject. No bulldozer, no vehicle, no machine. |
| `ruins-clear` | `explosion` | nástroj „odklidit trosky" sdílel ikonu s katastrofou výbuch |
| `disasters-on`, `disasters-off` | `disasters-toggle` | přepínač musí ukázat stav; kód vybere podle stavu |
| `substation`, `transformer` | `bolt` | budovy vedení neměly obrázek |
| `chart`, `more`, `focus-city`, `zoom-in`, `zoom-out`, `reload`, `view-grid`, `view-motion` | svg tvar | kód je volá, ale PNG nebylo, padalo se na svg |

**Nepoužité:** `coverage-waste` (třída služby `waste` v obsahu není) a po
přechodu i `disasters-toggle`. V T138 se nepřekreslují.

**Ikony domovské stránky** (`home-*`) leží na fotce v hlavičce, ne v HUD.
Černý čtverec tam bude vidět; zařazené jsou, ať je sada úplná, ale před
nasazením je potřeba rozhodnout, jestli tam černý podklad chceme.

### Společná hlavička

Doslova takhle, přidává se ke každému promptu:

```
A single small glossy 3D miniature rendered as a game icon for an isometric
city-builder game. Clean stylised materials like painted plastic and clay,
smooth soft shading with gentle ambient occlusion, soft studio light from the
upper left so left-facing surfaces are clearly brighter than right-facing
ones, and a small soft contact shadow directly under the subject.
Isometric three-quarter view from above, one corner pointing towards the
viewer. The subject is centred and fills about three quarters of the frame,
with an even empty margin on every side.

Background: pure flat black (#000000) from edge to edge. No floor, no horizon,
no reflection, no glow on the background, no vignette, no frame, no border,
no badge, no rounded app-icon square behind the subject.

One bold, simple silhouette with strong saturated colours that still reads
when the icon is 32 pixels wide: no thin parts, no tiny details, no clutter.

NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO SIGNATURE, NO WATERMARK.
```

### Stavba

```
CATEGORY - BUILD TOOL. The subject is shown on a single square isometric ground
tile: a chunky block with a flat green grass top and brown soil sides, like a
slice cut out of the terrain, seen from its near corner. The tile fills the
width of the frame. Whatever the tool builds sits on the tile or forms its top
surface. Nothing else on the tile: no vehicles, no machines, no people, no
bushes, unless the description below names them.
```

| id | význam | prompt |
|---|---|---|
| `road-street` | silnice: ulice | The top of the tile is a two-lane street of dark grey asphalt with a dashed white centre line and light grey kerbs along both long edges, running across the tile from the lower left to the upper right. |
| `road-avenue` | silnice: třída | The top of the tile is a wide four-lane avenue of dark grey asphalt, two lanes each way separated by a green grass median strip, running across the tile from the lower left to the upper right. |
| `road-highway` | silnice: dálnice | The top of the tile is a six-lane highway of dark asphalt with solid yellow edge lines and a concrete crash barrier down the middle, running across the tile from the lower left to the upper right. |
| `terrain-raise` | terén: zvednout | The grass tile is lifted noticeably higher than normal, showing tall soil sides, with a big white arrow pointing straight up standing on top of it. |
| `terrain-lower` | terén: snížit | The grass top is sunk into a shallow square pit inside the tile, with a big white arrow pointing straight down hovering above the pit. |
| `terrain-level` | terén: srovnat | A perfectly flat grass tile with a chunky yellow spirit level lying across its top, the bubble centred. |
| `terrain-fill` | terén: zasypat | A grass tile with a square hollow in the middle being filled with a heap of fresh brown soil, a big white arrow pointing down into the hollow. |
| `plant-trees` | vysadit stromy | Two round green broadleaf trees growing on the grass tile, with a small orange garden spade stuck in the ground beside them. |
| `zone-residential` | zóna: bydlení | A small cosy family house with a red roof and a white picket fence on the grass tile; the top of the tile is outlined by a thick bright green zoning border. |
| `zone-commercial` | zóna: obchod | A small corner shop with a striped red-and-white awning and big glass windows on the grass tile; the top of the tile is outlined by a thick bright blue zoning border. |
| `zone-industrial` | zóna: průmysl | A small factory hall with a sawtooth roof and one short chimney on a concrete-topped tile; the top of the tile is outlined by a thick bright yellow zoning border. |
| `zone-clear` | zrušit zónu | An empty grass tile outlined by a thick dashed white zoning border, with a big red X lying flat on the grass in the middle. |
| `bulldoze` | demolice | A chunky yellow bulldozer with a big front blade on a bare dirt tile, pushing a small heap of grey rubble. |
| `ruins-clear` | odklidit trosky | A heap of grey broken concrete and bricks on a bare dirt tile, an orange excavator bucket scooping it up from above. No bulldozer. |
| `pipe` | vodovodní potrubí | A thick blue water pipe with a flanged joint lying in an open trench cut across the grass tile, the brown soil showing on both sides of the trench. |
| `wire-low` | vedení nízkého napětí | A short, chunky wooden utility pole, thick like a tree trunk, with one wide cross-arm and two very thick black cables sagging away to both sides, standing on the grass tile, a big yellow lightning bolt plate on the pole. Everything is thick and bold. |
| `wire-high` | vedení vysokého napětí | A squat, chunky grey steel lattice pylon with very thick beams and wide arms, three very thick black cables hanging from the arms, standing on the grass tile, a big yellow-and-black lightning bolt plate on its leg. Everything is thick and bold. |
| `wire-remove` | odstranit vedení | A grey steel lattice transmission pylon on the grass tile whose thick cable is being cut by a large pair of red-handled bolt cutters, bright sparks at the cut and the severed cable ends dangling. No bulldozer, no vehicle, no machine. |

### Budovy

```
CATEGORY - BUILDING. A chunky, simplified miniature of the building standing on
a ROUND flat grey stone plinth (a disc, not a square tile). The disc has a
thick coloured rim band in the colour named below. The building shows its
symbol large and clearly on the front facade or the roof, so the building
type is recognisable at a glance.
```

| id | význam | prompt |
|---|---|---|
| `police_small` | policejní stanice | A small two-storey police station with blue trim and a big gold sheriff star badge on its front, one blue-and-white police car parked beside it. Rim colour: blue. |
| `police_large` | policejní ředitelství | A wide three-storey blue-and-white police headquarters with two big gold sheriff stars on its front and a blue warning light on the roof. Rim colour: blue. |
| `prison` | věznice | A compact grey prison block with heavy black bars over the windows and a high wall with a small watchtower at one corner. Rim colour: dark blue. |
| `fire_station` | hasičská zbrojnice | A small red-brick fire station with one big open garage door showing a red fire engine, and a large white flame emblem above the door. Rim colour: red. |
| `fire_station_large` | velká hasičská stanice | A large fire station with three red garage doors and a tall hose-drying tower carrying a large white flame emblem. Rim colour: red. |
| `clinic` | ordinace | A small white clinic building with a big red cross sign on its front. Rim colour: white with a red stripe. |
| `hospital` | nemocnice | A large white hospital block with a big red cross on its front and a plain round helipad on the roof, the helipad marked only by a white circle with no letter on it. Rim colour: white with a red stripe. |
| `retirement_home` | domov seniorů | A cosy two-storey retirement home with a pitched roof, a covered porch with a bench and a large red heart emblem on the gable. Rim colour: pink. |
| `community_centre` | komunitní centrum | A friendly low community centre with a big round window and a large emblem of three people holding hands on its front. Rim colour: pink. |
| `school` | základní škola | A small school building with a little bell tower and a big amber open-book emblem over the door. Rim colour: amber. |
| `high_school` | gymnázium | A larger brick high school with a strip of running track beside it and a big amber emblem of an open book with a pencil over the entrance. Rim colour: amber. |
| `university` | univerzita | A grand university hall with columns, a central dome and a large dark graduation cap emblem over the entrance. Rim colour: amber. |
| `museum` | muzeum | A classical museum: a white temple front with thick columns, a triangular pediment and wide steps. Rim colour: purple. |
| `gallery` | galerie | A modern white cube gallery with one huge picture frame holding a colourful painting on its front. Rim colour: purple. |
| `theatre` | divadlo | A theatre with a red curtain-shaped canopy over the entrance and two big comedy and tragedy masks above it. Rim colour: purple. |
| `cinema` | kino | A cinema with a large film reel and film strip emblem on its front and a glowing marquee canopy with blank lit panels. Rim colour: purple. |
| `water_works` | vodárna | A big cyan water tower on thick legs next to a small pump house, a large white water drop emblem on the tank. Rim colour: cyan. |
| `water_treatment` | čistírna vody | Two round open tanks full of clear blue water next to a small control building with a white water drop emblem. Rim colour: cyan. |
| `pump_station` | čerpací stanice | A small brick pump house with a thick blue pipe rising out of the ground beside it and a big water drop emblem with an upward arrow on its front. Rim colour: cyan. |
| `coal_power_plant` | uhelná elektrárna | A boiler house with a tall red-and-white striped chimney puffing dark smoke and a heap of black coal beside it, a yellow lightning bolt emblem on the wall. Rim colour: yellow. |
| `gas_power_plant` | plynová elektrárna | A clean modern turbine hall with two round silver gas tanks and a short chimney with a blue flame, a yellow lightning bolt emblem on the wall. Rim colour: yellow. |
| `nuclear_power_plant` | jaderná elektrárna | One large curved cooling tower releasing white steam next to a domed reactor building with a big yellow atom emblem. Rim colour: yellow. |
| `wind_turbine` | větrná elektrárna | A single tall white wind turbine with three broad blades on a small grassy mound. Rim colour: yellow. |
| `substation` | rozvodna | A fenced electrical yard with three chunky grey transformers, white ceramic insulators and a short steel gantry, a yellow lightning bolt warning plate on the fence. Rim colour: yellow. |
| `transformer` | trafostanice | One small brick transformer kiosk with a pitched roof, a grey metal door and a big yellow lightning bolt warning plate on the door, thick cables entering at the top. Rim colour: yellow. |
| `landfill` | skládka | A fenced mound of colourful rubbish bags with a big green waste bin in front of it. Rim colour: olive green. |
| `incinerator` | spalovna | An industrial hall with a tall chimney and a bright orange fire glowing through an open furnace door, a green bin emblem on the wall. Rim colour: olive green. |
| `transit_stop` | zastávka autobusu | A glass bus shelter with a bench and an orange bus stop sign on a pole, an orange city bus pulled up beside it. Rim colour: orange. |
| `tram_stop` | zastávka tramvaje | A short platform with a shelter and a red-and-cream tram standing on rails beside it. Rim colour: orange. |
| `metro_station` | stanice metra | A metro entrance: stairs going down under a glass canopy, with a big orange ring-and-bar metro roundel on a pole. Rim colour: orange. |
| `transit_depot` | vozovna | A wide garage hall with three arched doors and orange buses parked inside. Rim colour: orange. |
| `park_small` | malý park | One big round broadleaf tree and a wooden bench on a lawn. Rim colour: green. |
| `park_large` | velký park | Three round broadleaf trees, a curved gravel path and a small blue pond on a lawn. Rim colour: green. |
| `city_park` | městský park | A lawn with one tree, a bench, a lamp post and a small flower bed. Rim colour: green. |
| `plaza` | náměstí | A paved square with a round stone fountain spraying water in the middle and two small trees in planters. Rim colour: green. |

### Vrstvy a pohledy

```
CATEGORY - MAP LAYER. A stack of three thin square translucent glass slabs
floating one above another, seen isometrically from above, slightly separated.
The two lower slabs are clear neutral glass. The TOP slab is tinted in the
theme colour named below and carries the theme symbol standing on it as a solid
3D object.
```

| id | význam | prompt |
|---|---|---|
| `layers` | nabídka vrstev | All three slabs are clear glass with a faint blue tint, fanned out slightly as if being flipped through; no symbol. |
| `layer-none` | bez vrstvy | All three slabs are empty clear glass and a thick red diagonal bar is struck across the top slab. |
| `layer-power` | vrstva: elektřina | Top slab tinted electric blue, with a big yellow lightning bolt standing on it. |
| `layer-pollution` | vrstva: znečištění | Top slab tinted murky brown-grey, with a dark grey smoke cloud billowing up from it. |
| `layer-landvalue` | vrstva: cena pozemků | Top slab tinted green fading to gold, with a big gold coin standing on its edge on it. |
| `layer-crime` | vrstva: kriminalita | Top slab tinted dark red, with a pair of silver handcuffs lying on it. |
| `layer-happiness` | vrstva: spokojenost | Top slab tinted sunny yellow, with a big round yellow smiling face standing on it. |
| `layer-traffic` | vrstva: doprava | Top slab tinted in red, amber and green stripes, with a traffic light standing on it. |
| `layer-risk` | vrstva: riziko katastrof | Top slab tinted orange, with a big red-and-white warning triangle with an exclamation mark standing on it. |
| `coverage-police` | dosah: policie | Top slab tinted blue with soft concentric range rings glowing on it, and a blue shield with a gold star standing in the centre. |
| `coverage-fire` | dosah: hasiči | Top slab tinted red with soft concentric range rings glowing on it, and a white firefighter helmet standing in the centre. |
| `coverage-health` | dosah: zdraví | Top slab tinted white with soft red concentric range rings on it, and a big red cross standing in the centre. |
| `coverage-education` | dosah: vzdělání | Top slab tinted amber with soft concentric range rings glowing on it, and a dark graduation cap standing in the centre. |
| `coverage-culture` | dosah: kultura | Top slab tinted purple with soft concentric range rings glowing on it, and a pair of white theatre masks standing in the centre. |
| `coverage-social` | dosah: sounáležitost | Top slab tinted pink with soft concentric range rings glowing on it, and two white hands clasped together standing in the centre. |
| `coverage-transit` | dosah: doprava | Top slab tinted orange with soft concentric range rings glowing on it, and a small orange bus seen from the front standing in the centre. |
| `coverage-parks` | dosah: parky | Top slab tinted green with soft concentric range rings glowing on it, and a round broadleaf tree standing in the centre. |
| `view-surface` | pohled: povrch | Top slab is opaque, covered in green grass with a tiny house on it. |
| `view-underground` | pohled: podzemí | Top slab is cut open to show thick blue water pipes and a yellow cable running underneath it. |
| `view-ghost` | průhledné budovy | Top slab carries a small house made of translucent ghostly white glass. |
| `view-decor` | skrýt stromy | Top slab carries a small round tree with a thick red diagonal bar struck across it. |
| `view-grid` | mřížka | Top slab is a plain flat surface divided into a checkerboard of squares by thick bright white grid lines. Nothing stands on it: no arrow, no object. |
| `view-motion` | animace | Top slab carries a tiny red car with white speed streaks trailing behind it. |

### Akce a rozhraní

```
CATEGORY - ACTION. One single free-floating 3D object: no tile, no plinth, no
slab, no ground under it. Friendly materials in white, light grey and silver
with one or two accent colours.
```

| id | význam | prompt |
|---|---|---|
| `hand` | posun mapy | A white cartoon glove hand, open with the fingers together, palm facing the viewer. |
| `save` | uložit | A chunky navy-blue floppy disk with a silver metal shutter and a blank white label. |
| `quicksave` | rychlé uložení | A chunky navy-blue floppy disk with a big yellow lightning bolt in front of its lower right corner. |
| `quickload` | rychlé načtení | A chunky navy-blue floppy disk with a big green curved arrow sweeping out of it to the left. |
| `download` | stáhnout uložení | A big green arrow pointing down into an open light grey tray. |
| `open-file` | otevřít soubor | An open manila folder with a white sheet of paper sticking out of it. |
| `screenshot` | snímek obrazovky | A compact silver photo camera with a big round glass lens. |
| `reload` | aktualizovat hru | Two thick green curved arrows chasing each other in a circle. |
| `help` | nápověda | A big glossy question mark in warm amber-orange with its separate round dot below. |
| `chat` | poradce | A rounded white speech bubble with three teal dots inside, thick and solid like moulded plastic. |
| `close` | zavřít | A big thick red X made of two rounded bars crossing. |
| `language` | jazyk | A small blue-and-green globe on a stand with a white speech bubble beside it. |
| `budget` | rozpočet | An open green ledger book with a short stack of gold coins standing on its pages. |
| `loan-take` | půjčka | A fat bundle of green banknotes tied with a paper band, with a gold coin leaning against it. |
| `bond-issue` | dluhopis | A rolled parchment certificate tied with a red ribbon and a gold wax seal. |
| `funding` | financování služeb | Three vertical silver slider tracks with chunky round knobs at different heights and a gold coin on top of the tallest. |
| `taxes` | daně | A stack of gold coins with a big red percent sign standing in front of it. |
| `tax-increase` | zvýšit daň | A stack of gold coins with a big green arrow pointing up above it. |
| `tax-decrease` | snížit daň | A stack of gold coins with a big red arrow pointing down above it. |
| `chart` | další statistiky | A small bar chart of three rising bars in blue, green and yellow with a white arrow climbing above them. |
| `more` | další | Three big glossy white spheres in a horizontal row. |
| `focus-city` | zpět na město | A white target crosshair ring with four ticks around a tiny red-roofed house. |
| `zoom-in` | přiblížit | A magnifying glass with a silver rim and a thick green plus sign inside the lens. |
| `zoom-out` | oddálit | A magnifying glass with a silver rim and a thick red minus sign inside the lens. |
| `speed-pause` | pauza | Two thick rounded vertical bars in soft blue, side by side. |
| `speed-1` | rychlost 1 | One big rounded green play triangle pointing right. |
| `speed-2` | rychlost 2 | Two big rounded green play triangles pointing right, overlapping in a row. |
| `speed-4` | rychlost 4 | Three rounded green play triangles pointing right, overlapping in a row. |
| `speed-8` | rychlost 8 | Four rounded green play triangles pointing right, overlapping in a row, the last one glowing. |
| `resume` | pokračovat | A big rounded green play triangle in front of a small navy-blue floppy disk. |
| `start-city` | nové město | A small cluster of three toy-like city buildings with a big green plus sign floating beside them. |
| `reroll` | jiná mapa | A pair of white dice with dark round pips, tumbling. |
| `map-size` | velikost mapy | Four thick white arrows pointing outward from the centre towards the four corners. |
| `line-create` | nová linka | Two round orange stop markers joined by a thick orange line, with a green plus badge. |
| `line-delete` | zrušit linku | Two round orange stop markers joined by a thick orange line, with a red X badge. |
| `stop-add` | přidat zastávku | An orange bus stop sign on a short pole with a green plus badge. |
| `stop-remove` | odebrat zastávku | An orange bus stop sign on a short pole with a red minus badge. |
| `vehicles` | počet vozidel | A chunky orange city bus. |
| `fare` | jízdné | A paper transit ticket with a punched hole and a gold coin beside it. |
| `home-share` | poslat hru | A folded paper plane of thick matte white paper, tilted as if just thrown up and to the right. |
| `home-help` | nápověda (úvod) | A big glossy question mark in warm amber-orange with its separate round dot below. |
| `home-author` | autoři | A white builder helmet resting on a tightly rolled pale blue-grey drawing. |
| `home-chat` | Discord | Two overlapping rounded speech bubbles, the front one white and the one behind it soft teal blue. |

### Katastrofy

```
CATEGORY - DISASTER. The hazard as a dramatic 3D object above a small jagged
chunk of dark scorched rock (an irregular broken shard, not a neat square
tile), lit from below by a red-orange glow. Red, orange and charcoal dominate.
```

| id | význam | prompt |
|---|---|---|
| `disasters` | nabídka katastrof | A dark storm cloud with a big yellow lightning bolt striking down out of it. |
| `disasters-on` | katastrofy zapnuté | A dark storm cloud with a big bright yellow lightning bolt and a twisting grey tornado below it, everything vivid and saturated, with a strong red-orange glow. |
| `disasters-off` | katastrofy vypnuté | A storm cloud with a lightning bolt and a tornado, completely desaturated to dull grey and unlit, and a thick bright red diagonal bar struck across the whole icon from the upper left to the lower right. Override the category: here the rock shard is cold, grey and unlit, with NO glow and no red or orange anywhere except the red bar. |
| `fire` | požár | A small city building engulfed in big orange flames. |
| `flood` | povodeň | A small house half submerged in rising blue flood water with waves. |
| `tornado` | tornádo | A tall grey twisting tornado funnel touching the rock, with debris swirling around it. |
| `earthquake` | zemětřesení | The rock split by a deep glowing crack, a cracked building tilting on one side. |
| `pileup` | hromadná nehoda | Three small cars crashed into each other in a heap with a puff of smoke. |
| `strike` | stávka | A raised fist holding a blank protest placard. |
| `riot` | nepokoje | An overturned car on fire with a broken shop window behind it. |
| `industrialAccident` | průmyslová havárie | A small factory with a burst pipe venting a jet of fire and a yellow-and-black hazard stripe. |
| `gangWar` | válka gangů | Two crossed baseball bats in front of a graffiti-sprayed wall fragment. |
| `explosion` | výbuch | A big round fireball explosion with chunks of debris flying out. |
| `wildfire` | lesní požár | A few pine trees burning with tall flames. |
| `blackout` | výpadek proudu | A huge dark, dead glass light bulb with cracked glass and a broken filament, filling most of the frame, and a thick yellow lightning bolt snapped in two lying beside it. |
| `epidemic` | epidemie | A big green spiky virus particle floating above the rock. |
| `landslide` | sesuv půdy | One side of the rock collapsing in a cascade of brown earth and boulders. |
| `chemicalSpill` | únik chemikálií | A tipped-over yellow barrel leaking glowing toxic green liquid. |

## Plochý styl (T60–T137, překonáno T138)

Generovalo se to dřívější verzí `tools/generate-icons.py` a ladilo
`tools/fit-icons.py` (ořez, 128 px, zaoblený štítek, průhledno kolem), který
T138 smazal — zmenšuje teď sám `generate-icons.py`.

### Proč se sada předělává

Ikony služeb byly **obrázky budov** — izometrický domeček v kartičce. Autor to
shrnul takhle: „teď to jsou budovy z nichž nikdo nic nepozná, měly by to být
symboly… třeba modrý štít s šerifskou hvězdou pro policejní stanici".

Má pravdu a je to měřitelné: tlačítko v paletě je **32 px**. Do toho se vejde
tvar a barva, ne fasáda. Dvě policejní stanice se od sebe jako domečky nedají
odlišit vůbec; jako štít s jednou a se dvěma hvězdami ano.

Druhá věc je nesourodost. Budovy, kterým obrázek chyběl, spadly na plochý
polygon ze střechy (`graphics.icon`), takže vedle malovaných domečků svítilo
deset placatých značek. Symboly to srovnají: jedna sada, jeden jazyk.

### Styl

Doslova takhle, přidává se ke každému promptu:

```
A single flat vector app icon, centred on a rounded-square badge that fills the
frame. ONE symbol only, drawn as bold solid shapes with no outline, no gradient,
no shadow, no highlight, no texture, no perspective and no 3D. Straight on,
seen from the front. The symbol is large and simple: it must stay readable when
the icon is 32 pixels wide, so no thin lines, no small parts and no fine detail.
The badge is a single flat colour, the symbol a single contrasting flat colour.
Everything outside the rounded square is fully transparent.

NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO SIGNATURE, NO WATERMARK.
```

**Proč „no outline" a „no gradient".** Obrys i přechod se při zmenšení na 32 px
slijí a z ikony je šedá kaše. Plocha drží tvar i na čtvrtině velikosti.

**Proč barevný podklad.** HUD je tmavý. Symbol bez podkladu na něm splývá,
kdežto barevný štítek nese půlku významu sám: modrá je pořádek, červená
hasiči, azurová voda. Hráč pak čte barvu dřív než tvar.

### Barvy podle oboru

Stejný obor = stejná barva podkladu. Je to druhá polovina čitelnosti: než
hráč rozezná tvar, pozná obor.

| obor | podklad | symbol |
|---|---|---|
| pořádek | modrá | bílý |
| hasiči | červená | bílý |
| zdraví | bílá | červený |
| vzdělání | jantarová | tmavě hnědý |
| kultura | fialová | bílý |
| sounáležitost | růžová | bílý |
| voda | azurová | bílý |
| energie | žlutá | černý |
| odpad | olivová | bílý |
| doprava | oranžová | bílý |
| parky | zelená | bílý |
| nástroje a pohledy | šedá | bílý |

### Ikony

Velikost se liší **počtem prvků, ne velikostí obrázku**: malá stanice má jednu
hvězdu, velká dvě. Zmenšit tentýž tvar by nešlo poznat.

#### Pořádek

| id | prompt |
|---|---|
| `police_small` | A white sheriff star with five points, centred on a blue rounded-square badge. |
| `police_large` | Two white sheriff stars side by side, centred on a blue rounded-square badge. |
| `prison` | Three thick white vertical prison bars, centred on a dark blue rounded-square badge. |
| `coverage-police` | A plain white shield, centred on a blue rounded-square badge. |

#### Hasiči

| id | prompt |
|---|---|
| `fire_station` | A single white flame, centred on a red rounded-square badge. |
| `fire_station_large` | A white flame with a white water drop beside it, centred on a red rounded-square badge. |
| `coverage-fire` | A white fire helmet seen from the front, centred on a red rounded-square badge. |

#### Zdraví

| id | prompt |
|---|---|
| `clinic` | A thick red medical cross, centred on a white rounded-square badge. |
| `hospital` | nemocnice | A large white hospital block with a big red cross on its front and a plain round helipad on the roof, the helipad marked only by a white circle with no letter on it. Rim colour: white with a red stripe. |
| `retirement_home` | A red heart with a walking stick across it, centred on a white rounded-square badge. |
| `coverage-health` | A red heart with a heartbeat line across it, centred on a white rounded-square badge. |

#### Vzdělání

| id | prompt |
|---|---|
| `school` | A dark brown open book, centred on an amber rounded-square badge. |
| `high_school` | A dark brown open book with a pencil across it, centred on an amber rounded-square badge. |
| `university` | A dark brown graduation cap, centred on an amber rounded-square badge. |
| `coverage-education` | A dark brown stack of three books, centred on an amber rounded-square badge. |

#### Kultura

| id | prompt |
|---|---|
| `museum` | A white classical temple front with three columns and a triangular roof, centred on a purple rounded-square badge. |
| `gallery` | A white picture frame with a simple mountain shape inside it, centred on a purple rounded-square badge. |
| `theatre` | Two white theatre masks side by side, centred on a purple rounded-square badge. |
| `cinema` | A white film strip with square holes down both sides, centred on a purple rounded-square badge. |
| `coverage-culture` | A white five-pointed star, centred on a purple rounded-square badge. |

#### Sounáležitost

| id | prompt |
|---|---|
| `community_centre` | Three white human figures standing side by side, centred on a pink rounded-square badge. |
| `coverage-social` | Two white hands joined together, centred on a pink rounded-square badge. |

#### Voda

| id | prompt |
|---|---|
| `water_works` | A white water drop, centred on a cyan rounded-square badge. |
| `water_treatment` | A white water drop inside a white circle of two arrows, centred on a cyan rounded-square badge. |
| `pump_station` | A white water drop with an arrow pointing up through it, centred on a cyan rounded-square badge. |

#### Energie

| id | prompt |
|---|---|
| `coal_power_plant` | A black lightning bolt with a black smokestack behind it, centred on a yellow rounded-square badge. |
| `gas_power_plant` | A black lightning bolt with a black flame behind it, centred on a yellow rounded-square badge. |
| `nuclear_power_plant` | A black atom symbol with a nucleus and two orbits, centred on a yellow rounded-square badge. |
| `wind_turbine` | A black three-blade wind turbine on a mast, centred on a yellow rounded-square badge. |

#### Odpad

| id | prompt |
|---|---|
| `landfill` | A white waste bin with a lid, centred on an olive green rounded-square badge. |
| `incinerator` | A white smokestack with a flame inside it, centred on an olive green rounded-square badge. |
| `coverage-waste` | A white circle of three arrows, centred on an olive green rounded-square badge. |

#### Doprava

| id | prompt |
|---|---|
| `transit_stop` | A white bus stop sign on a post, centred on an orange rounded-square badge. |
| `tram_stop` | A white tram seen from the front, centred on an orange rounded-square badge. |
| `metro_station` | A white metro roundel: a thick ring with a horizontal bar across it, centred on an orange rounded-square badge. |
| `transit_depot` | A white bus seen from the front inside a simple garage arch, centred on an orange rounded-square badge. |
| `coverage-transit` | A white bus seen from the front, centred on an orange rounded-square badge. |

#### Parky

| id | prompt |
|---|---|
| `park_small` | A single white broadleaf tree, centred on a green rounded-square badge. |
| `park_large` | Three white broadleaf trees side by side, centred on a green rounded-square badge. |
| `city_park` | A white broadleaf tree with a white bench beside it, centred on a green rounded-square badge. |
| `plaza` | A white fountain with a bowl and a jet of water, centred on a green rounded-square badge. |
| `coverage-parks` | A white broadleaf tree, centred on a green rounded-square badge. |

#### Nástroje a pohledy

| id | prompt |
|---|---|
| `hand` | A white open hand with the fingers together, centred on a grey rounded-square badge. |
| `view-decor` | A white broadleaf tree with a thick diagonal line struck through it, centred on a grey rounded-square badge. |
| `screenshot` | A white photo camera seen from the front with a round lens, centred on a grey rounded-square badge. |
| `layer-risk` | A white warning triangle with an exclamation mark inside it, centred on a grey rounded-square badge. |
| `help` | A white question mark, centred on a grey rounded-square badge. |
| `close` | A thick white X, two straight bars crossing at the centre, on a flat grey rounded-square badge. The badge is one even shade of grey with no texture, shading or smudges. |
| `plant-trees` | A white broadleaf tree with a small white garden spade stuck in the ground beside it, centred on a green rounded-square badge. |
| `chat` | A white rounded speech bubble with three dots inside it, centred on a grey rounded-square badge. |

## Značka

Logo hry. **Není to ikona rozhraní**, takže má vlastní hlavičku bez štítku —
značka se používá i na světlém pozadí a rámeček by tam překážel.

```
A single flat vector logo mark centred on a plain background of one solid dark
teal colour, the same colour edge to edge. Bold solid shapes, no outline, no
gradient, no shadow, no glow, no halo, no light around the shapes, no texture,
no vignette. The background is completely even and empty. The mark must stay
readable at 32 pixels.

NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO SIGNATURE, NO WATERMARK.
```

**Proč bez písma.** Název se sází v CSS, ne v obrázku: generátor písmena
komolí a „Zdenalcity" by z něj vyšlo jako „Zdenalclty". Obrázek nese jen
značku, slovo obstará stránka.

**Proč plné pozadí a ne průhledné.** První pokus žádal průhlednost a dostal
černou plochu se žlutou září kolem domů. Vyříznout ji nešlo: prahem na jas se
buď nechala jako mlha, nebo ukrojil kus tmavé strany budovy, a přes hrany
zůstal roztřepený lem — a když se před hledáním hran rozostřilo, splynula
tmavá stěna věže s pozadím a věž zmizela. Jedna plochá barva se odečte
triviálně a je z ní i podklad ikony.

| id | prompt |
|---|---|
| `logo` | Three simple isometric city blocks of different heights standing together, seen from the front-above at the isometric angle, in warm amber and deep teal. |

## Ikony domovské stránky

Od T138 spadají i tyhle čtyři pod jednotný styl (kategorie akce);
níž je jejich původní zadání.

Čtyři odkazy v rohu hlavičky (poslat hru, nápověda, autor, Discord) měly u sebe
popisek a autor si vyžádal opak: „místo tlačítek s popisem vymysli špičkové
ikonky, které naprosto jasně každý pochopí, ale budou dělány grafikou hry."

Proto **nejsou ploché**. Zbytek sady jsou štítky do HUD, kde se čte barva dřív
než tvar; tyhle čtyři leží na fotce v hlavičce a mají vypadat jako kus hry —
tedy měkce stínovaný izometrický render, stejná řeč jako u budov na mapě
(`06-SPRITY-SLUZEB.md`).

Význam nese **tvar, ne text**: papírová vlaštovka je „pošli", otazník „nápověda",
přilba s výkresem „kdo to postavil" a bubliny „povídej si". Popisek zůstává
v `title` a v `aria-label`, takže odečítačka i najetí myší ho pořád najdou.

### Styl

Doslova takhle, přidává se ke každému promptu:

```
A single object rendered as a small isometric 3D icon, seen from the
south-east, in the visual language of an isometric city-builder game.

Rendering style: a soft-shaded 3D render, not a drawing. Believable materials
with smooth gradients across the surfaces and gentle ambient occlusion where
forms meet. Bright, warm, even daylight from the left: left-facing surfaces are
clearly brighter than right-facing ones.

NOT cartoon, NOT cel-shaded, NOT toon-shaded. No dark outline or contour line
around the object, no flat single-colour fills, no posterisation. Equally no
photorealism, no film grain, no vignette, no lens effects, no bloom.

The object floats alone, centred, and fills most of the frame with a small
even margin on every side. Fully transparent background: no plinth, no ground,
no scenery, no people, no cast shadow outside the object itself.

One bold silhouette that still reads when the icon is 48 pixels wide: no thin
parts, no small pieces, no fine detail.

NO WORDS, NO LETTERING, NO NUMBERS, NO SIGNATURE, NO WATERMARK, NO LOGO.
```

### Ikony

| id | prompt |
|---|---|
| `home-share` | A folded paper plane made of thick matte white paper, tilted as if it has just been thrown up and to the right, with crisp folds and a warm highlight along the top edge. |
| `home-help` | A bold question mark modelled as a solid extruded object with softly rounded edges, in warm amber-orange plastic, standing upright with its own separate round dot below it. |
| `home-author` | A white builder helmet resting on a tightly rolled paper drawing that lies flat under it, the roll in pale blue-grey paper. |
| `home-chat` | Two overlapping rounded speech bubbles standing upright, the front one white and the one behind it soft teal blue, both thick and solid like moulded plastic. |
