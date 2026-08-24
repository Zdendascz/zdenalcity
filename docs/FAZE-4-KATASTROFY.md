# Fáze 4 — katalog katastrof

**Verze dokumentu:** 1.0
**Nadřazený dokument:** `docs/05-FAZE-4.md` (§3 model rizika, §4 oheň, §5 záplava, R13–R18)

Patnáct katastrof, všechny odsouhlasené autorem po jedné. Tento dokument nese **parametry**; mechanismus, pomocné funkce a rozhodnutí jsou v zadání fáze 4.

Všechny číselné hodnoty patří do `content/vanilla/balance.json`, sekce `disasters.<id>`. Žádná z nich nesmí být v kódu (P5).

---

## Přehled

| # | Katastrofa | Typ | Základ/měsíc | Hájení | Souběžně | Ničí | Zapaluje |
|---|---|---|---|---|---|---|---|
| 1 | Požár | nepřírodní | 0,020 | 10 | 1–4 | ano | — |
| 2 | Povodeň | přírodní | 0,008 | 720 | 1 | ano | ne |
| 3 | Tornádo | přírodní | 0,006 | 540 | 1 | ano | ano |
| 4 | Zemětřesení | přírodní | 0,0025 | 2160 | 1 | ano | ano |
| 5 | Hromadná nehoda | nepřírodní | 0,050 | 15 | 1–3 | ne | ne |
| 6 | Stávka | nepřírodní | 0,025 | 90 | 2 | ne | ne |
| 7 | Občanské nepokoje | nepřírodní | 0,008 | 360 | 1 | ne | ano |
| 8 | Průmyslová havárie | nepřírodní | 0,018 | 120 | 1 | ano | ano |
| 9 | Válka gangů | nepřírodní | 0,020 | 150 | 1–3 | zřídka | ne |
| 10 | Výbuch | nepřírodní | 0,030 | 45 | 1 | ano | ano |
| 11 | Lesní požár | přírodní | 0,015 | 90 | 1 | ano | — |
| 12 | Blackout | nepřírodní | 0,040 | 60 | 1 | ne | ne |
| 13 | Epidemie | nepřírodní | 0,012 | 540 | 1 | ne | ne |
| 14 | Sesuv půdy | přírodní | 0,020 | 180 | 1 | ano | ne |
| 15 | Chemická havárie | nepřírodní | 0,014 | 300 | 1 | zřídka | ne |

Hájení v tikách. Přírodní katastrofy mají `faktorTypu = 1` a správa města na ně nemá vliv.

---

## 1 — Požár

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,020 |
| `cooldownTicks` | 10 — počítáno od **vzniku** |
| `souběžné` | `clamp(floor(budovy / 400), 1, 4)` |
| `sizeFactor` | `clamp(sqrt(budovy / 200), 0.5, 3)` |
| `maxMonthlyChance` | 0,20 |
| `ignitionTiles` | 1–3, v průmyslu váženo k horní hranici |

```
faktorTypu = clamp(1
    + nekrytáČást     * 0,9
    + kriminalita     * 0,6
    + zanedbanost     * 0,7
    + podfinancování  * 0,5
    + podílPrůmyslu   * 0,35,
  1, 3)
```

- `nekrytáČást` — podíl budov v buňkách s `coverage[fire] < 60`
- `kriminalita` — průměr `crime` vážený počtem budov v buňce, 0–1
- `zanedbanost` — (opuštěné budovy + dlaždice trosek) / všechny budovy
- `podfinancování` — `1 - funding[fire]`
- `podílPrůmyslu` — průmyslové budovy / všechny

**Volba ohniska:** `váha = hořlavost × (1 - coverage[fire]/255) × (1 + crime[buňka]/255 × 0,8)`

### Šíření a hašení

Ohňový tik každé 2 tiky. Každá hořící dlaždice nese **intenzitu** (0–255) a **palivo** (počet ohňových tiků do zničení).

```
palivo    -= 1
intenzita += 6
intenzita -= 4 + coverage[fire][buňka] * 0,10

pokud intenzita <= 0 → uhašeno, budova přežila
pokud palivo   <= 0 → zničena, trosky, oheň končí

pro každého ze 4 sousedů:
    pokud rng < (intenzita/255) * hořlavost[soused] * 0,5 → zapal intenzitou 100
```

| Obsah dlaždice | Hořlavost | Palivo |
|---|---|---|
| les | 0,55 | 6 |
| opuštěná budova | 0,45 | 6 |
| průmysl | 0,40 | 12 |
| obytná | 0,30 | 8 |
| komerční | 0,22 | 10 |
| služby, inženýrské stavby | 0,18 | 14 |
| trosky | 0,10 | 4 |
| park | 0,05 | 4 |
| silnice, voda, potrubí, prázdná, zaplavená | 0 | — |

Práh záchrany obytné budovy je zhruba `coverage[fire] = 160`.

### Následky

| Následek | Parametr |
|---|---|
| Zničená budova | trosky na celém půdorysu |
| Ztráta obyvatel | celá populace zničené budovy |
| Znečištění | `firePollutionPerTick = 8` z každé hořící dlaždice |
| Spokojenost | `−2` celoměstsky za zničenou budovu |

### Zmírnění

Hustota a financování hasičských stanic; průsek buldozerem (silnice a prázdná dlaždice nehoří); parky jako bariéra; bourání opuštěných budov a trosek; oddělení průmyslu od obytné zástavby.

---

## 2 — Povodeň

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,008 |
| `cooldownTicks` | 720 — od opadnutí |
| `sizeFactor` | **žádný** |
| `coastFactor` | `clamp(pobřežníDlaždice / 400, 0.4, 2.5)` |
| `seasonFactor` | 2,0 v tikách 60–150, jinak 0,7 |
| `maxMonthlyChance` | 0,03 |
| `requiresWater` | ano |

`faktorTypu = 1`. Pobřežní dlaždice = souš sousedící s vodou, počítá se jednou při vzniku mapy.

**Volba ohniska:** vážený los přes pobřežní dlaždice podle délky souvislého pobřeží v okolí — zálivy a ústí jsou zranitelnější.

### Průběh

Tři fáze, 12–40 tiků.

```
// postup, 3–6 tiků
dosah = 2..5 dlaždic
pro každou dlaždici v čele vlny:
    pokud výškaRohu > výškaVody → zastav se        // po 3b
    zaplav, hloubka = výškaVody - výškaTerénu
    postup na 4 sousedy

// opadání
zbývajícíDoba -= 1 + coverage[fire][buňka] * 0,04
floodDuration = 10..25 tiků
```

Škoda nastává **postupně**, ne okamžitě:

```
poškození[dlaždice] += hloubka * 0,08
pokud poškození > 1,0 → znič, trosky
```

Hloubka 1 = 13 tiků do zničení, hloubka 3 = 4 tiky.

### Následky

| Následek | Parametr |
|---|---|
| Zničené budovy a infrastruktura | trosky |
| Přerušené sítě | zaplavená dlaždice nevede proud ani vodu |
| Kontaminace | `floodPollutionPerTick = 5` |
| Cena půdy | `−15` v zaplavené oblasti |
| Spokojenost | `−3` celoměstsky za zničenou budovu |
| Doprava | zaplavená silnice je neprůjezdná |

### Zmírnění

Nestavět v nížině u vody; **terraforming jako trvalá hráz** (pás o jednu úroveň zastaví vlnu úplně — schváleno jako trvalé řešení); hasiči zrychlují opadání; nezastavěný pás u vody; náhradní silniční spojení.

---

## 3 — Tornádo

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,006 |
| `cooldownTicks` | 540 |
| `sizeFactor` | **žádný** |
| `terrainFactor` | `clamp(0,5 + podílRoviny × 1,0, 0,5, 1,5)` |
| `seasonFactor` | 2,2 v tikách 120–210, jinak 0,6 |
| `maxMonthlyChance` | 0,02 |

`faktorTypu = 1`. `podílRoviny` = podíl dlaždic bez převýšení; do 3b je to 1,0, tedy faktor 1,5.

### Průběh

Vzniká na **okraji mapy**, míří do vnitrozemí.

```
speed    = 1,5 dlaždice/tik
lifetime = 20..45 tiků
width    = 2..5 dlaždic
směr     += rng(-12°, +12°) každý tik
síla     = křivka životnosti (0,4 → 1,0 → 0,3)

pro každou dlaždici v pásu:
    šance na zničení = síla * (1 - útlumOdOsy) * (1 - odolnost[obsah])
    pokud rng < 0,25 → zapal sousední dlaždici
```

| Obsah | Šance přežít přímý zásah |
|---|---|
| les | 5 % |
| obytná, úroveň 1–2 | 15 % |
| obytná, úroveň 3–5 | 35 % |
| komerční | 40 % |
| průmysl | 45 % |
| služby, inženýrské stavby | 55 % |
| silnice | 70 % |
| potrubí | 90 % |

### Následky

Trosky po celé dráze; 25 % šance na zapálení u každé zasažené dlaždice; `−3` spokojenosti celoměstsky za zničenou budovu; přerušené silnice typicky napříč městem.

**Následné požáry způsobí víc škody než tornádo samo.**

### Zmírnění

Hasičské pokrytí (tlumí druhou vlnu); hustší a vyšší zástavba; okružní silnice a druhá elektrárna; nekumulovat kritickou infrastrukturu.

Proti samotnému zásahu obrana neexistuje — záměrně. **Bez předpovědi dráhy** (rozhodnutí autora).

---

## 4 — Zemětřesení

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,0025 |
| `cooldownTicks` | 2160 |
| `sizeFactor`, `seasonFactor` | **žádné** |
| `maxMonthlyChance` | 0,004 |

`magnitude = 0,3 + 0,7 × rng()³` — silný sklon k nízkým hodnotám.

| Síla | Četnost | Dopad |
|---|---|---|
| 0,3–0,5 | ~65 % | pár procent budov |
| 0,5–0,8 | ~30 % | citelná škoda napříč městem |
| 0,8–1,0 | ~5 % | město se vzpamatovává roky |

### Průběh

```
// hlavní otřes, 1 tik
epicentrum = náhodná dlaždice
pro každou budovu:
    útlum = clamp(1 - vzdálenost / (mapSize * 0,7), 0,25, 1)
    zásah = magnitude * útlum * zranitelnost[budova]
    pokud rng < zásah          → znič, trosky
    jinak pokud rng < zásah*0,6 → sniž o úroveň

// dotřesy: 2–5 po 15–40 tikách, magnitude × 0,45^n
```

| Obsah | Zranitelnost |
|---|---|
| opuštěná budova | 1,3 |
| obytná, úroveň 1–2 | 1,0 |
| elektrárna, vodárna, čistírna | 0,9 |
| průmysl | 0,85 |
| komerční | 0,8 |
| obytná, úroveň 3–5 | 0,75 |
| služby | 0,7 |
| potrubí | 0,7 |
| silnice | 0,45 |

Potrubí trpí víc než silnice.

### Druhotné jevy

- **Požáry:** `0,30 × magnitude` na zničenou budovu
- **Záplavy:** pobřežní pás do 3 dlaždic, `0,40 × magnitude`, bez postupu vlny
- **Výpadky:** zničené elektrárny a vodárny odpojí sítě

### Následky

`−4` spokojenosti za zničenou budovu, `−1` za sníženou; přerušené sítě; roztroušeně přerušené silnice.

### Zmírnění

Vysoká zástavba (0,75 proti 1,0); hasičské pokrytí **napříč celým městem**; rozptýlená kritická infrastruktura; uklizené opuštěné budovy; **finanční rezerva** — hlavní důvod, proč ve fázi 4 existují dluhopisy.

---

## 5 — Hromadná nehoda

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,050 |
| `cooldownTicks` | 15 |
| `souběžné` | `clamp(floor(silničníDlaždice / 600), 1, 3)` |
| `sizeFactor` | `clamp(sqrt(silničníDlaždice / 300), 0.5, 2.5)` |
| `maxMonthlyChance` | 0,30 |

Škáluje se **délkou silniční sítě**, ne počtem budov.

```
faktorTypu = clamp(1
    + průměrnéKolony      * 1,1
    + podílDálnicATříd    * 0,5
    + nekrytáČástZdravot  * 0,3
    + podfinancováníZdrav * 0,3,
  1, 3)
```

**Volba místa:** `váha = trafficLoad[dlaždice] × kapacitníFaktor[typ]`

### Průběh

```
duration = 4 + round(6 * (1 - coverage[health][buňka] / 255))    // 4–10 tiků

spikeTraffic(radius 1, factor ∞)
blokace(dlaždice nehody)                      // dopravní model neprojde
suppressService('health', radius 8, 0,45, duration)
suppressService('fire',   radius 8, 0,60, duration)
```

**Blokace je důležitější než skok v kolonách** — nehoda na jediné spojnici odřízne dostupnost práce.

### Následky

| Následek | Parametr |
|---|---|
| Zničené budovy | **žádné** |
| Ztráta obyvatel | 2–8 z okolních obytných budov |
| Zdravotnictví | `−55 %` v okruhu 8 |
| Hasiči | `−40 %` v okruhu 8 |
| Spokojenost | `−1` v okruhu 8 |

Během nehody **hoří déle** — je to násobič ostatních katastrof.

### Zmírnění

Plynulá doprava; zdravotnické pokrytí (zkracuje trvání víc než dvojnásobně); okružní a redundantní síť; MHD linky; nepřehánět dálnice.

**Hlásí se jen při blokaci dlaždice s vysokou zátěží** — práh do `balance.json`.

---

## 6 — Stávka

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,025 |
| `cooldownTicks` | 90 |
| `souběžné` | **2** |
| `sizeFactor` | `clamp(sqrt(budovy / 300), 0.5, 2.0)` |
| `maxMonthlyChance` | 0,18 |
| `minPopulation` | **1800** |

```
faktorTypu = clamp(1
    + nezaměstnanost       * 1,3
    + (1 - spokojenost)    * 1,0
    + daňováZátěž          * 0,7
    + podfinancováníSlužeb * 0,6,
  1, 3)
```

`daňováZátěž = clamp((průměrnáSazba − 7) / 13, 0, 1)`

**Volba místa:** `váha = hustotaPopulace × (1 + kriminalita/255) × (1 + nezaměstnanostVOkolí)`

### Průběh

```
duration = 20..60 tiků, radius = 6..10 buněk

každý tik:
    pokud spokojenost v oblasti roste → zbývá -= 2
    jinak                             → zbývá -= 1

spikeCrime(radius, 45, duration)
spikeTraffic(radius, 1,6, duration)
suppressService('health', radius, 0,50, duration)
happinessPenalty(radius, -30, duration)
```

**Budovy v oblasti nedaní.**

### Následky

| Následek | Parametr |
|---|---|
| Kriminalita | `+45` v okruhu |
| Doprava | `×1,6` |
| Zdravotnictví | `−50 %` |
| Spokojenost | `−30` v oblasti, `−5` celoměstsky |
| Daňový příjem | nula v oblasti |

Doznívání trvá 2–3 měsíce po skončení; dlouhá stávka spustí snížení úrovní.

### Zmírnění

Nízká nezaměstnanost; daň pod 13 %; služby na 100 %; **reakce během stávky ji zkrátí na polovinu**; zdravotnické pokrytí navíc.

**Hlásí se s výpisem hlavního důvodu** — které složky `faktorTypu` byly nejvyšší. Bez toho by to byl náhodný trest.

---

## 7 — Občanské nepokoje

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,008 |
| `cooldownTicks` | 360 |
| `souběžné` | 1 |
| `sizeFactor` | `clamp(sqrt(budovy / 400), 0.5, 2.0)` |
| `maxMonthlyChance` | 0,10 |
| `minPopulation` | 4000 |

```
faktorTypu = clamp(1
    + (1 - spokojenost)   * 1,4
    + nezaměstnanost      * 1,0
    + kriminalita         * 0,8
    + nekrytáČástPolicie  * 0,5
    + daňováZátěž         * 0,4,
  1, 3)
```

### Eskalace ze stávky

```
při skončení stávky:
    pokud spokojenost v oblasti klesla během stávky
      a kriminalita > 150
      a rng < 0,25 * (1 - spokojenost):
        → spusť nepokoje, doba hájení se ignoruje
```

Hlavní cesta vzniku. Neřešená stávka může přerůst v nepokoje.

### Průběh

```
duration = 30..70 tiků

každý tik:
    pokud spokojenost roste a coverage[police] > 120 → zbývá -= 2
    pokud spokojenost roste                          → zbývá -= 1,5
    jinak                                            → zbývá -= 1

lokálníSíla[c] = 0,3 + 0,7 * (crime[c] / 255)

spikeCrime(global, 60 * lokálníSíla, duration)
spikeTraffic(global, 1 + 0,5 * lokálníSíla, duration)
suppressService('health',    global, 0,55, duration)
suppressService('education', global, 0,40, duration)
happinessPenalty(global, -40 * lokálníSíla, duration)

každých 5 tiků:
    ohnisek = 1 + floor(3 * lokálníSílaMax)
    vážený los podle crime × hořlavost × (1 - coverage[fire]/255)
    zapal intenzitou 100
```

Za celé trvání 6–50 zapálených dlaždic. Daně na `40 %`.

**Mapa lokální síly se během trvání nepřepočítává** — jinak by nepokoje samy sebe posilovaly přes vlastní nárůst kriminality. Pojistka proti utržené smyčce.

### Zmírnění

Reagovat na stávku (nejlevnější obrana); policejní pokrytí; **hasičské pokrytí rozhoduje**, jestli zbyde vzpomínka nebo vypálená čtvrť; dlouhodobá spokojenost; rezerva na `−60 %` příjmu.

Potlačení vzdělání na 40 % může srazit budovy C a I o úroveň — prerekvizita z fáze 3.

---

## 8 — Průmyslová havárie

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,018 |
| `cooldownTicks` | 120 |
| `sizeFactor` | `clamp(sqrt(průmyslovéBudovy / 60), 0.4, 2.5)` |
| `maxMonthlyChance` | 0,15 |
| `minIndustrial` | 8 |

```
faktorTypu = clamp(1
    + nekrytáČástHasiči   * 1,2
    + podílVysokýchÚrovní * 0,8
    + podfinancováníHasič * 0,6
    + zanedbanostPrůmyslu * 0,5
    + bezVody             * 0,4,
  1, 3)
```

**Jediná katastrofa, kde se hustota nevyplácí** — průmysl úrovně 4–5 je rizikovější.

**Volba místa:** `váha = úroveň × (1 - coverage[fire]/255) × (1 + jeOpuštěná × 0,8) × (1 + bezVody × 0,5)`

### Průběh

```
poloměr = 2 + round(2 * (úroveň / 5))        // 2–4

pro každou dlaždici v okruhu:
    šance = (1 - útlum) * 0,85 * (1 - odolnost[obsah])
    pokud rng → znič, trosky

pro každou dlaždici v okruhu * 1,5:
    pokud rng < 0,45 * (1 - útlum) → zapal intenzitou 120

pollutionBurst(okruh * 2, 60 * úroveň / 5)
```

| Obsah | Odolnost |
|---|---|
| průmysl | 0,15 |
| obytná, komerční | 0,25 |
| služby | 0,35 |
| silnice | 0,60 |
| potrubí | 0,80 |

**Zničení se nefiltruje na industriální zónu, jen vznik** — výbuch na hranici poškodí i domy vedle. Jinak by hráč mohl beztrestně mísit zóny.

**Bez řetězení** (rozhodnutí autora) — zasažená továrna nevybuchuje, jen hoří.

### Následky

Trosky; požáry; kontaminace; **ztráta desítek pracovních míst naráz** → skok nezaměstnanosti → zvýšené riziko stávky; `−3` spokojenosti za zničenou budovu.

### Zmírnění

Oddělit průmysl pásem parků nebo služeb; hasičské pokrytí průmyslových zón; vodovod; bourat opuštěné továrny; nekumulovat těžký průmysl; rozvážit úrovně.

---

## 9 — Válka gangů

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,020 |
| `cooldownTicks` | 150 |
| `souběžné` | `clamp(floor(budovy / 900), 1, 3)` |
| `sizeFactor` | `clamp(sqrt(obytnéBudovy / 250), 0.5, 2.2)` |
| `maxMonthlyChance` | 0,16 |
| `minPopulation` | 2500 |

```
faktorTypu = clamp(1
    + nejvyššíKriminalita   * 1,5
    + nekrytáČástPolicie    * 0,9
    + nezaměstnanost        * 0,7
    + zanedbanost           * 0,5
    + podfinancováníPolicie * 0,4,
  1, 3)
```

`nejvyššíKriminalita` je **maximum** vrstvy `crime` napříč obydlenými buňkami, ne průměr. Rozhoduje nejhorší čtvrť.

**Volba místa:** `váha = (crime/255)³ × hustotaPopulace × (1 - coverage[police]/255)`

Třetí mocnina soustředí výběr téměř výhradně do nejhorší čtvrti.

### Průběh

Nejdelší katastrofa v seznamu.

```
duration = 60..180 tiků, radius = 4..7 buněk

// rozšiřování
každých 20 tiků:
    pokud coverage[police] < 100 a spokojenost klesá:
        radius += 1                       // max 10

// ukončení je podmínkové, ne časové
tlak = coverage[police]/255 * 0,6
     + max(0, změnaSpokojenosti) * 0,3
     + zaměstnanostVOkolí * 0,1
zbývajícíDoba -= 0,3 + tlak * 2,2

crimeFloor(oblast, 200)
happinessPenalty(oblast, -50, duration)
suppressService('education', oblast, 0,50, duration)
suppressService('health',    oblast, 0,75, duration)
landValuePenalty(oblast, -25, duration)

// ojedinělé ničení
každých 15 tiků: jedna náhodná budova, 30 % šance na zničení
```

Bez zásahu ubývá 0,3/tik = přes 13 měsíců. S plným pokrytím a rostoucí spokojeností až 2,5/tik = necelé 2 měsíce. **Hráč, který nic neudělá, se toho prakticky nezbaví.**

`crimeFloor` drží kriminalitu **nad** hodnotou — policie ji nesrazí, dokud válka trvá, jen zkracuje trvání.

Daně na `50 %`.

### Následky

2–4 zničené budovy za celé trvání; kriminalita nad 200 neodstranitelně; `−50` spokojenosti v oblasti, `−6` celoměstsky; cena půdy `−25` přímo; růst zastaven.

**Hlavní trvalá škoda je degradace** — šest měsíců znamená pokles o 1–2 úrovně a část budov opuštěná. Skutečná cena se ukáže až rok poté.

### Zmírnění

Nedopustit vznik (kubická váha — stačí nemít jednu extrémní čtvrť); policejní stanice do oblasti; věznice; zaměstnanost; pokrytí nad 100 zastaví rozšiřování; po skončení uklidit trosky.

---

## 10 — Výbuch

Příčina záměrně nespecifikovaná (rozhodnutí autora).

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,030 |
| `cooldownTicks` | 45 |
| `sizeFactor` | `clamp(sqrt(budovy / 400), 0.4, 2.2)` |
| `maxMonthlyChance` | 0,20 |
| `minBuildings` | 60 |

```
faktorTypu = clamp(1
    + nekrytáČástHasiči   * 1,0
    + hustotaZástavby     * 0,7
    + zanedbanost         * 0,6
    + podfinancováníHasič * 0,5
    + bezVody             * 0,3,
  1, 3)
```

`hustotaZástavby` = podíl budov úrovně 3–5.

**Volba místa:** vážený los přes **všechny** zastavěné dlaždice, bez filtru na zónu: `váha = úroveň × (1 - coverage[fire]/255) × (1 + jeOpuštěná × 0,6)`

### Průběh

```
poloměr = 1 + round(1,5 * (úroveň / 5))     // 1–3

zničení: šance = (1 - útlum) * 0,75 * (1 - odolnost[obsah])
zapálení: okruh * 1,5, šance = 0,50 * (1 - útlum), intenzita 110
```

Odolnosti stejné jako u průmyslové havárie. **Žádná kontaminace** — jediný podstatný rozdíl vedle velikosti.

Zboří míň než havárie (0,75 proti 0,85, poloměr 1–3 proti 2–4), ale zapálí víc (50 % proti 45 %).

### Následky

1–4 zničené budovy, ale **5–10 zapálených dlaždic naráz** — pro hasiče těžší situace než běžný požár. Když bouchne elektrárna nebo vodárna, odpojí se celá síť.

`−2` spokojenosti za zničenou budovu. Žádné znečištění.

### Zmírnění

Hasičské pokrytí (působí dvakrát); bourat opuštěné budovy; **rozptýlit kritickou infrastrukturu**; průseky v hustých čtvrtích; vodovod; rezerva na pravidelný úklid.

---

## 11 — Lesní požár

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,015 |
| `cooldownTicks` | 90 — od uhašení |
| `sizeFactor` | **žádný** |
| `forestFactor` | `clamp(lesníDlaždice / 500, 0.2, 2.5)` |
| `seasonFactor` | 2,5 v tikách 150–240, jinak 0,5 |
| `maxMonthlyChance` | 0,08 |
| `minForest` | 40 |

`faktorTypu = 1`. Nejvýraznější sezónnost ze všech katastrof.

**Volba ohniska:** `váha = 1 + souvislostLesa × 0,8`, kde `souvislostLesa` je podíl lesních dlaždic v okruhu 3. **Bez ohledu na `coverage[fire]`** — vzniká, kde je les.

### Průběh

Používá vrstvu `fire` a mechaniku z §4 zadání, s vlastními parametry:

| Parametr | Běžný požár | Lesní požár |
|---|---|---|
| počáteční intenzita | 100 | 130 |
| ohnisek | 1–3 | 1 |
| přírůstek intenzity | +6 | +9 |
| šíření — základní šance | ×0,5 | ×0,7 |

Postupuje zhruba o dlaždici za ohňový tik. **Vyhořelá lesní dlaždice se mění na trávu**, ne na trosky. Les se sám neobnovuje.

Vyžaduje příznak ve vrstvě `fire`, že jde o lesní požár (odlišné parametry šíření).

### Hlavní mechanika: čas na reakci

Vzniká mimo město, hráč má typicky **10–30 tiků**, než dorazí k první budově.

Obrana: vykácet pás lesa buldozerem (tráva nehoří vůbec); silnice jako trvalá protipožární linie; nechat dohořet, míří-li pryč; hasičárna na okraji lesa.

### Následky

| Následek | Parametr |
|---|---|
| Vyhořelý les | trvale na trávu |
| Ztráta bonusu ceny půdy | propad v okolí |
| Ztráta pohlcování znečištění | trvalá |
| Znečištění | `firePollutionPerTick = 8` — **největší jednorázový zdroj ve hře** |
| Spokojenost | `−2` za zničenou budovu, `−3` jednorázově za požár nad 100 dlaždic |

Sto hořících dlaždic po deset tiků nasype do difuze víc než průmyslová zóna za rok. Mrak měsíce sráží cenu půdy i tam, kde oheň nebyl.

### Zmírnění

Průsek buldozerem; silnice po obvodu lesa; nestavět těsně k lesu; **preventivní probírka** (pásy trávy ve velkých lesích); vykácet úplně (ztratíš bonus i pohlcování); zvýšit financování hasičů na sezónu.

**Hlásí se znovu**, když se oheň dostane na dlaždici sousedící se zástavbou.

---

## 12 — Blackout

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,040 |
| `cooldownTicks` | 60 |
| `sizeFactor` | **žádný** |
| `maxMonthlyChance` | 0,45 — nejvyšší strop v seznamu |
| `minPlants` | 1 |

```
rezerva = (kapacita - spotřeba) / kapacita

faktorTypu = clamp(1
    + max(0, 0,25 - rezerva) * 8
    + podílJednéElektrárny   * 0,8
    + zanedbanost            * 0,3,
  1, 3)
```

Koeficient 8 je zvolený tak, aby člen rezervy sám dosáhl stropu **přesně při
nulové rezervě**: 25 % → faktor 1; 20 % → 1,4; 15 % → 1,8; 10 % → 2,2; 5 % → 2,6;
nula → 3. Ostatní dva členy ho tam dostanou dřív — s jednou elektrárnou nesoucí
většinu zátěže a mírnou zanedbaností je město na stropu už kolem 6 % rezervy.

Dřív tu stálo 24 a vedle toho prozaická řada „15 % → 1,24; 5 % → 2,4". Ani jedno
nesedělo: z prvního čísla plyne koeficient 2,4, z druhého 7,0, a s koeficientem
24 je faktor na stropu už pod 19 % rezervy. Blackout by pak byl útes, ne svah —
hráč buď drží nad 25 %, nebo je na maximu, a mezi tím není co odměnit. Přitom
tahle katastrofa má být „nejčastější v seznamu, ale jen pro hráče, který si o ni
říká", což je věta o svahu.

**Nejčastější katastrofa v seznamu — ale jen pro hráče, který si o ni říká.**

### Průběh

```
// spouštěč
odpoj náhodnou elektrárnu (vážený los podle kapacity)

// kaskáda, každý 2. tik
přepočítej flood fill sítě
zatížení = spotřeba / zbyláKapacita

pokud zatížení > 1,15 → odpoj další (nejvíc zatíženou)
pokud zatížení < 0,95 po 3 tiky → připojuj zpět, jednu za 3 tiky
```

Kaskáda se **zastaví sama**, jakmile odpojená spotřeba klesne pod kapacitu zbytku. Zotavení 3 tiky na elektrárnu.

### Následky

| Následek | Parametr |
|---|---|
| Zničené budovy | žádné |
| Daňový příjem | budovy bez proudu nedaní |
| Chátrání | podle pravidel fáze 2 |
| **Služby** | budovy služeb bez proudu **neposkytují pokrytí** |
| Doprava | tramvajové linky nejezdí |
| Spokojenost | `−1` za tik nad 5 tiků, kumulativně až `−15` |

**Nejzajímavější následek je výpadek služeb** — během blackoutu skokově roste riziko požáru, války gangů i hromadné nehody. Blackout sám nic nezničí, ale otevírá dveře všemu ostatnímu.

### Zmírnění

Rezerva nad 25 %; víc menších elektráren; sledovat spotřebu při růstu; předimenzovat před nárůstem; redundantní rozvod.

---

## 13 — Epidemie

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,012 |
| `cooldownTicks` | 540 |
| `sizeFactor` | `clamp(sqrt(populace / 3000), 0.4, 2.5)` |
| `seasonFactor` | 1,8 v tikách 270–360, jinak 0,7 |
| `maxMonthlyChance` | 0,10 |
| `minPopulation` | 3000 |

```
faktorTypu = clamp(1
    + nekrytáČástZdravot  * 1,3
    + hustotaPopulace     * 0,9
    + bezVody             * 0,8
    + znečištění          * 0,5
    + podfinancováníZdrav * 0,5,
  1, 3)
```

`bezVody` je nejsilnější vazba na 3c v celém katalogu.

**Volba ohniska:** `váha = hustota × (1 - coverage[health]/255) × (1 + bezVody × 0,6) × (1 + pollution/255 × 0,4)`

### Průběh

Nakaženost se drží jako **`infection: Map<buňka, number>`** v rozsahu 0–1, řídce zaplněná. Plná vrstva by byla plýtvání — většina města je vždy nenakažená.

```
duration = 40..120 tiků, tři vlny intenzity

každé 4 tiky:
    // šíření po sousedství
    pro každou nakaženou buňku c:
        pro každého ze 4 sousedů s populací:
            přenos = infection[c] * 0,25
                   * (hustota[soused]/255)
                   * (1 - coverage[health][soused]/255 * 0,7)
            infection[soused] += přenos

    // skok po dopravě
    pokud rng < 0,3:
        cíl = vážený los podle trafficLoad v okolí
        infection[cíl] += infection[c] * 0,4

    // růst a ústup
    infection[c] += 0,08 * vlnaFaktor
    infection[c] -= 0,05 + coverage[health][c]/255 * 0,12
    clamp(0, 1)
```

**Skok po dopravě dělá epidemii epidemií** — přeskočí přes celé město po hlavních tazích.

Práh vyhasnutí je zhruba `coverage[health] = 65`. Nad ním nákaza ustupuje, pod ním roste.

### Následky

| Následek | Parametr |
|---|---|
| Zničené budovy | žádné |
| Úbytek obyvatel | `populace × infection × 0,015` za cyklus, **trvalý** |
| Zdravotnictví | pokrytí v nakažených buňkách účinkuje na `70 %` — přetížení |
| Spokojenost | `−35 × infection` v oblasti, `−8` celoměstsky na vrcholu |
| Daňový příjem | úměrně úbytku obyvatel |

Dlouhá epidemie v husté čtvrti může vzít desetinu obyvatel města.

Přetížení nemocnic je záměrná past — hráč potřebuje **rezervu** v pokrytí, ne přesně dostačující síť.

### Zmírnění

Pokrytí nad 65 **všude**; vodovod do všech obytných čtvrtí; rezerva v nemocnicích; nižší znečištění; nemíchat hustotu bez služeb; **postavit nemocnici do ohniska hned po vypuknutí**.

Jediná katastrofa, kterou jde aktivně potlačit i po vzniku — nejodměňovanější rychlá reakce ve hře.

---

## 14 — Sesuv půdy

**Vyžaduje fázi 3b.** Bez převýšení `requiresElevation` katastrofu vypne.

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,020 |
| `cooldownTicks` | 180 |
| `sizeFactor` | **žádný** |
| `slopeFactor` | `clamp(rizikovéSvahy / 150, 0, 3)` |
| `seasonFactor` | 2,0 v tikách 60–150, jinak 0,6 — stejné okno jako povodeň |
| `maxMonthlyChance` | 0,06 |

`faktorTypu = 1`.

`rizikovéSvahy` = dlaždice s maximálním rozdílem rohů **a zároveň** se zástavbou nebo infrastrukturou na nich či pod nimi. Prázdný svah v divočině se nepočítá.

**Volba místa:** `váha = 1 + zástavbaNaSvahu × 1,5 + terraformovánoNedávno × 1,0`

`terraformovánoNedávno` = dlaždice upravená v posledních 360 tikách. **Vyžaduje novou vrstvu `terraformTick: Uint16Array`** s tikem poslední úpravy.

### Průběh

```
směr  = po spádnici dolů
délka = 2..5 dlaždic
šířka = 1..3 dlaždice

pro každou dlaždici v dráze:
    znič budovu i infrastrukturu, zanech trosky
    sniž horní rohy o 1
    zvyš dolní rohy o 1                  // materiál se přesune

vynuť invariant sousedních rohů kaskádovitě
```

**Terén se trvale změní.** Jediná katastrofa, která mění mapu — ostatní ničí, co na ní stojí.

Kaskádové vynucení invariantu může spustit další úpravy okolních rohů, a co stojí na hraně, spadne také.

### Následky

Trosky v celé dráze; trvalá změna terénu; přerušené sítě; `−3` spokojenosti za zničenou budovu. **Žádné požáry, žádné znečištění.**

Spolehlivě přeruší sítě vedené po svahu — u kopcovitého města často odříznutá čtvrť.

### Zmírnění

Nestavět na maximálním svahu; srovnat terén **před** stavbou; počkat rok po terraformingu; nevést kritické sítě po spádnici; zohlednit jarní sezónu; **terasovat** (několik mírných stupňů riziko odstraní úplně).

Vyžaduje překreslení dotčených chunků včetně sousedních — změna rohu ovlivňuje tvar sousedních dlaždic.

---

## 15 — Chemická havárie

### Vznik

| Parametr | Hodnota |
|---|---|
| `baseMonthlyChance` | 0,014 |
| `cooldownTicks` | 300 |
| `sizeFactor` | `clamp(sqrt(těžkýPrůmysl / 25), 0.3, 2.2)` |
| `maxMonthlyChance` | 0,09 |
| `minHeavyIndustry` | 5 |

`těžkýPrůmysl` = kategorie I, úroveň 3–5. Vzniká i u čistíren, spaloven a skládek.

```
faktorTypu = clamp(1
    + zanedbanostPrůmyslu * 1,1
    + nekrytáČástHasiči   * 0,9
    + podfinancováníHasič * 0,6
    + bezVody             * 0,5
    + stáříZařízení       * 0,4,
  1, 3)
```

`stáříZařízení` = podíl budov kategorie I a odpadové infrastruktury starších než 3600 tiků. Jediné místo ve hře, kde na stáří budovy záleží samo o sobě — používá stávající `builtAtTick`.

**Volba místa:** `váha = úroveň × (1 + stáří/3600 × 0,8) × (1 - coverage[fire]/255) × (1 + jeOpuštěná × 0,7)`. Skládky a spalovny mají vlastní základní váhu, aby nebyly proti velkým továrnám neviditelné.

### Průběh

Únik je **postupný**, 15–40 tiků.

```
každý tik:
    intenzita = křivka (rychlý nárůst, pomalý pokles)

    pollutionBurst(okruh 3, 45 * intenzita)

    pokud je vodní dlaždice v okruhu 6:
        kontaminujVodu(okruh 6, intenzita)

    populace v okruhu 5 -= populace * 0,004 * intenzita
```

Zdroj je zhruba pětinásobek uhelné elektrárny po dvacet tiků — okolní buňky vyjedou skoro na maximum.

**Kontaminace vody:** vodárny v okruhu 6 nedodávají vodu po dobu úniku **plus dalších 60 tiků**. Budovy začnou chátrat podle 3c dva měsíce po havárii.

Zničení minimální: budova zdroje 50 %, sousední dlaždice 15 %. Trosky, **žádné požáry**.

### Následky

| Následek | Parametr |
|---|---|
| Znečištění | `45 × intenzita` do okruhu 3 — nejsilnější zdroj ve hře |
| Kontaminace vody | vodárny v okruhu 6 nefunkční, únik + 60 tiků |
| Úbytek obyvatel | `0,4 % × intenzita` za tik v okruhu 5 |
| Spokojenost | `−10` celoměstsky, `−45` v okruhu 6 |
| Cena půdy | propad v širokém okolí, doznívá **roky** |

Skutečná cena se ukáže za rok — mrak srazí cenu půdy v celé části města a spustí snižování úrovní i tam, kde se nic nestalo.

Jediná katastrofa, kde je nejlepší reakce **počkat a pak uklidit**.

### Zmírnění

Oddělit těžký průmysl (potřebná vzdálenost je větší než u průmyslové havárie); nestavět těžký průmysl u vody, ze které bere vodárna; hasičské pokrytí; **obnovovat staré provozy** (zbourat a postavit znovu resetuje stáří); rezerva ve vodárnách; **pás lesa mezi továrnou a městem** mrak částečně zachytí.

---

## Datové položky, které katalog přidává

Nad rámec toho, co je v zadání fáze 4 §9:

| Položka | Katastrofa | Ukládá se |
|---|---|---|
| `terraformTick: Uint16Array` | sesuv | ano |
| `infection: Map<buňka, number>` | epidemie | ano |
| příznak lesního požáru ve `fire` | lesní požár | ano |
| `poškození` akumulátor na zaplavené dlaždici | povodeň | ano |
| seznam odpojených elektráren | blackout | ano |
| seznam vyřazených vodáren + tik obnovení | chemická havárie | ano |

## Pomocné funkce, které katalog vyžaduje

Rozšíření seznamu z R13:

```
destroyArea(world, shape, filter)
ignite(world, shape, intensity)
floodArea(world, shape, depth)
suppressService(world, class, shape, factor, duration)
spikeTraffic(world, shape, factor, duration)
spikeCrime(world, shape, amount, duration)
crimeFloor(world, shape, minValue, duration)          // válka gangů
happinessPenalty(world, shape, amount, duration)
landValuePenalty(world, shape, amount, duration)
pollutionBurst(world, shape, amount)                  // výbuch, havárie
contaminateWater(world, shape, intensity, duration)   // chemická havárie
populationLoss(world, shape, ratio)                   // epidemie, havárie
blockTile(world, tile, duration)                      // hromadná nehoda
```
