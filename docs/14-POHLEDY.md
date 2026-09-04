# Diagnostické pohledy

Autor po odehrání napsal: „z těch pohledů znečištění, spokojenosti atd není
v podstatě co poznat… musí tam být dva pohledy: tepelná mapa se stavem od
zelené — skvělé až po rudou — strašné a pak dosahový pohled, kde budou bílé
hranice, kam třeba dosáhne policie… ať člověk ví, co má dělat."

Tenhle dokument popisuje, co z toho vzniklo a proč přesně takhle.

## Co bylo špatně

Do T90 kreslil `CoarseOverlay` **jednu barvu, jejíž sílu nesla průhlednost**.
Znečištění fialově, kriminalita červeně, spokojenost oranžově. Mělo to tři vady
naráz:

1. **Slabá hodnota vypadala jako žádná.** Čtvrť se znečištěním 60 z 255 byla
   sotva vidět a od čisté louky se nedala rozeznat.
2. **Nebylo poznat, který konec je dobrý.** Fialový závoj nad městem říká „něco
   tu je", ne „tady je zle a tam ne".
3. **Barva se mísila s terénem pod sebou**, takže tatáž hodnota vypadala jinak
   na trávě a jinak na písku.

## Tepelná mapa

Pět stupňů od rudé po zelenou (`HEAT_STOPS` v paletě), mezi nimi se interpoluje.
Neprůhlednost 0,78 — musí přebít terén, jinak se vrací vada číslo tři.

**Směr si určuje každý pohled sám.** Do overlaye se nedává hodnota, ale
`goodness`, tedy „jak dobře na tom čtvrť je" v rozsahu 0–1:

| pohled | goodness | proč |
|---|---|---|
| znečištění | `1 − v/255` | vysoká hodnota je zlá |
| kriminalita | `1 − v/255` | totéž |
| spokojenost | `v / HAPPINESS_CLEAN_AT` | 200 je čtvrť, se kterou není co řešit |
| cena půdy | `v / LAND_VALUE_GOOD` | 160 uživí zástavbu na nejvyšší úrovni |
| riziko | `1 − v/255` | vysoké riziko je zlé |

Cena půdy i spokojenost mají **vlastní strop, ne 255**. Na plnou stupnici by
byla mapa ceny půdy celá rudá i ve zdravém městě — reálné hodnoty se drží
hluboko pod maximem.

Kreslí se **jen tam, kde město je** (buňka s budovou nebo silnicí). Nula je
u většiny veličin ten nejlepší možný stav, takže by se jinak natřely zeleně
i lesy a hory a hráč by v tom čtvrť nenašel.

## Mapa dosahu

Pro pokrytí službami. Odpovídá na jinou otázku než tepelná mapa — ne „jak je na
tom čtvrť", ale „kam ta stanice dosáhne" — a ta otázka je o **hranici**, ne
o odstínu.

- **plocha**: modrý závoj, sytost roste s pokrytím. Začíná na `COVERAGE_MIN_ALPHA`,
  ne na nule: reálné pokrytí se drží kolem třetiny stupnice a čistě poměrný
  závoj byl sotva vidět.
- **vnější bílá čára**: konec dosahu. Kreslí se po hranách buněk mezi pokrytou
  a nepokrytou, ne obtahem každé buňky — obtah by udělal mřížku přes celou
  oblast.
- **vnitřní tenčí čára**: hranice dostatečného pokrytí (`COVERAGE_GOOD = 140`).
  Podle ní se pozná, kde stanice sotva dosahuje a kde doopravdy funguje.

## Legenda

Bez ní je barevná mapa hádanka, takže se kreslí vlevo nad lištou nástrojů, a to
**jen když je pohled zapnutý**. Konce stupnice se pojmenovávají podle veličiny
(„čisto"/„zamořeno", „bezcenná"/„drahá"), ne obecným „dobře"/„zle" — obecný
popisek hráči neřekne, na co se dívá.

## Riziko katastrof

Nový pohled. Autor: „co se týká nepřírodních katastrof, tak tam, kde hrozí
s vysokou mírou pravděpodobnosti, může být nějaké to varování."

Počítá `computeRiskMap` v `sim/disasters/riskMap.ts`. **Přírodní katastrofy se
do něj nepočítají** — zemětřesení ani tornádo nezávisí na tom, co hráč postavil,
takže varování před nimi by nenesla radu.

Skládá se **maximem přes druhy, ne součtem**: odpověď na „co mi tady hrozí" je
jedna konkrétní věc, kterou má hráč řešit. Součet by ve čtvrti se třemi drobnými
riziky ukázal poplach a ve čtvrti s jedním vážným klid.

Váhy jsou tytéž, podle kterých si vybírá místo plánovač — kdyby se rozešly, hráč
by hlídal jinou čtvrť, než na kterou katastrofa doopravdy padne:

| druh | co ho přitahuje |
|---|---|
| požár | hořlavost nejhořlavější dlaždice × (1 − hasiči) × (1 + kriminalita × 0,8) |
| nepokoje, válka gangů | kriminalita × (1 − policie) |
| stávka | nespokojenost **pod neutrálem**, umocněná |
| hromadná nehoda | zatížení nejvytíženější silnice × (1 − zdravotnictví) |
| průmyslová a chemická havárie | těžký provoz v buňce × (1 − hasiči) |
| epidemie | hustota obyvatel × (1 − zdravotnictví) |

**Dvě věci se cestou naměřily a opravily:**

- Hořlavost se nejdřív brala jako **průměr přes buňku** a bylo to špatně. Požár
  začíná na jedné dlaždici a plánovač si ji váží její vlastní hořlavostí; průměr
  ho zředil loukou okolo, takže zastavěná čtvrť bez hasičů vyšla níž než holá
  louka na riziko stávky. Bere se maximum.
- Nespokojenost se počítá **od neutrálu dolů**, ne z plné stupnice. Průměrná
  čtvrť není důvod ke stávce; jinak hlásila mapa 63 z 255 nad každým městem hned
  po založení.

Práh `RISK_WARNING = 150` je změřený na městě autora (7 446 obyvatel, 140
obydlených buněk): medián 89, horní kvartil 200, devátý decil 213, maximum 227.
Odděluje tedy zhruba nejhorší třetinu. Nejčastější hrozbou tam byl požár
(87 buněk), pak hromadná nehoda (40).

Nad prahem se v **kartě parcely** objeví věta „Pozor: v téhle čtvrti hrozí …".
Číslo se neukazuje: hráč nepotřebuje vědět, že riziko je 187, potřebuje vědět,
že tam chybí hasiči.

## Ikony běžících pohrom

Vedle hodin, jedna na každou právě běžící katastrofu. Souběh je normální stav —
hoří a zároveň se stávkuje — takže je to řada, ne jedna ikona.

Klik otevře **tutéž kartu, která přišla při vzniku**, a hru zastaví. Do T90
nebyla cesta zpátky: kdo hlášení zavřel, neměl jak zjistit, co se vlastně děje
ani kde.

Řada se přestavuje jen tehdy, když se změnila. Kdyby se překreslovala každý
snímek, tlačítko pod kurzorem by se každých šestnáct milisekund vyhodilo
a nešlo by na ně kliknout.

## Délka herního dne

Při rychlosti 1× trvá **sekundu**, ne čtvrt (`TICK_MS`). Autor: „letí to strašně
rychle, člověk nestíhá nic udělat." Herní rok tak zabere šest minut při 1×
a tři čtvrtě při 8×.

Mění to **jen tempo v reálném čase**, ne simulaci: systémy počítají na tiky,
takže město za tisíc dní vyjde stejně jako dřív a zlaté testy se nehnuly.
