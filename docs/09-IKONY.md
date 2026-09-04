# Ikony rozhraní

Zadání pro **ikony v paletě a v panelech**, ne pro sprity na mapě. Sprity mají
`06-SPRITY-SLUZEB.md` a `07-SPRITY-ZONY.md`, dlaždice `08-DLAZDICE.md`.

Generuje `tools/generate-icons.py`, který prompty čte **odsud**. Ladí
`tools/fit-icons.py`: ořízne, vystředí a zmenší na 128 px s průhledným pozadím.

## Proč se sada předělává

Ikony služeb byly **obrázky budov** — izometrický domeček v kartičce. Autor to
shrnul takhle: „teď to jsou budovy z nichž nikdo nic nepozná, měly by to být
symboly… třeba modrý štít s šerifskou hvězdou pro policejní stanici".

Má pravdu a je to měřitelné: tlačítko v paletě je **32 px**. Do toho se vejde
tvar a barva, ne fasáda. Dvě policejní stanice se od sebe jako domečky nedají
odlišit vůbec; jako štít s jednou a se dvěma hvězdami ano.

Druhá věc je nesourodost. Budovy, kterým obrázek chyběl, spadly na plochý
polygon ze střechy (`graphics.icon`), takže vedle malovaných domečků svítilo
deset placatých značek. Symboly to srovnají: jedna sada, jeden jazyk.

## Styl

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

## Barvy podle oboru

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

## Ikony

Velikost se liší **počtem prvků, ne velikostí obrázku**: malá stanice má jednu
hvězdu, velká dvě. Zmenšit tentýž tvar by nešlo poznat.

### Pořádek

| id | prompt |
|---|---|
| `police_small` | A white sheriff star with five points, centred on a blue rounded-square badge. |
| `police_large` | Two white sheriff stars side by side, centred on a blue rounded-square badge. |
| `prison` | Three thick white vertical prison bars, centred on a dark blue rounded-square badge. |
| `coverage-police` | A plain white shield, centred on a blue rounded-square badge. |

### Hasiči

| id | prompt |
|---|---|
| `fire_station` | A single white flame, centred on a red rounded-square badge. |
| `fire_station_large` | A white flame with a white water drop beside it, centred on a red rounded-square badge. |
| `coverage-fire` | A white fire helmet seen from the front, centred on a red rounded-square badge. |

### Zdraví

| id | prompt |
|---|---|
| `clinic` | A thick red medical cross, centred on a white rounded-square badge. |
| `hospital` | A thick red medical cross with a red heart in front of it, centred on a white rounded-square badge. |
| `retirement_home` | A red heart with a walking stick across it, centred on a white rounded-square badge. |
| `coverage-health` | A red heart with a heartbeat line across it, centred on a white rounded-square badge. |

### Vzdělání

| id | prompt |
|---|---|
| `school` | A dark brown open book, centred on an amber rounded-square badge. |
| `high_school` | A dark brown open book with a pencil across it, centred on an amber rounded-square badge. |
| `university` | A dark brown graduation cap, centred on an amber rounded-square badge. |
| `coverage-education` | A dark brown stack of three books, centred on an amber rounded-square badge. |

### Kultura

| id | prompt |
|---|---|
| `museum` | A white classical temple front with three columns and a triangular roof, centred on a purple rounded-square badge. |
| `gallery` | A white picture frame with a simple mountain shape inside it, centred on a purple rounded-square badge. |
| `theatre` | Two white theatre masks side by side, centred on a purple rounded-square badge. |
| `cinema` | A white film strip with square holes down both sides, centred on a purple rounded-square badge. |
| `coverage-culture` | A white five-pointed star, centred on a purple rounded-square badge. |

### Sounáležitost

| id | prompt |
|---|---|
| `community_centre` | Three white human figures standing side by side, centred on a pink rounded-square badge. |
| `coverage-social` | Two white hands joined together, centred on a pink rounded-square badge. |

### Voda

| id | prompt |
|---|---|
| `water_works` | A white water drop, centred on a cyan rounded-square badge. |
| `water_treatment` | A white water drop inside a white circle of two arrows, centred on a cyan rounded-square badge. |
| `pump_station` | A white water drop with an arrow pointing up through it, centred on a cyan rounded-square badge. |

### Energie

| id | prompt |
|---|---|
| `coal_power_plant` | A black lightning bolt with a black smokestack behind it, centred on a yellow rounded-square badge. |
| `gas_power_plant` | A black lightning bolt with a black flame behind it, centred on a yellow rounded-square badge. |
| `nuclear_power_plant` | A black atom symbol with a nucleus and two orbits, centred on a yellow rounded-square badge. |
| `wind_turbine` | A black three-blade wind turbine on a mast, centred on a yellow rounded-square badge. |

### Odpad

| id | prompt |
|---|---|
| `landfill` | A white waste bin with a lid, centred on an olive green rounded-square badge. |
| `incinerator` | A white smokestack with a flame inside it, centred on an olive green rounded-square badge. |
| `coverage-waste` | A white circle of three arrows, centred on an olive green rounded-square badge. |

### Doprava

| id | prompt |
|---|---|
| `transit_stop` | A white bus stop sign on a post, centred on an orange rounded-square badge. |
| `tram_stop` | A white tram seen from the front, centred on an orange rounded-square badge. |
| `metro_station` | A white metro roundel: a thick ring with a horizontal bar across it, centred on an orange rounded-square badge. |
| `transit_depot` | A white bus seen from the front inside a simple garage arch, centred on an orange rounded-square badge. |
| `coverage-transit` | A white bus seen from the front, centred on an orange rounded-square badge. |

### Parky

| id | prompt |
|---|---|
| `park_small` | A single white broadleaf tree, centred on a green rounded-square badge. |
| `park_large` | Three white broadleaf trees side by side, centred on a green rounded-square badge. |
| `city_park` | A white broadleaf tree with a white bench beside it, centred on a green rounded-square badge. |
| `plaza` | A white fountain with a bowl and a jet of water, centred on a green rounded-square badge. |
| `coverage-parks` | A white broadleaf tree, centred on a green rounded-square badge. |

### Nástroje a pohledy

| id | prompt |
|---|---|
| `hand` | A white open hand with the fingers together, centred on a grey rounded-square badge. |
| `view-decor` | A white broadleaf tree with a thick diagonal line struck through it, centred on a grey rounded-square badge. |
| `screenshot` | A white photo camera seen from the front with a round lens, centred on a grey rounded-square badge. |

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
