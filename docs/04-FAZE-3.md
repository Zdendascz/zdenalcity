# Fáze 3 — zadání

**Verze dokumentu:** 1.0
**Vstupní podmínka:** `docs/01-ARCHITEKTURA.md` (P1–P7), `docs/03-FAZE-2.md` (R1–R5), `docs/PROGRESS.md`.

Fáze 2 dala městu prostorovou kvalitu. Fáze 3 dává **prostoru samotnému tvar a odpor**: mapa přestane být homogenní deska, silnice přestanou být jen podmínkou dosažitelnosti a terén začne stát peníze.

Mody, sprity, Steam a lokalizace se přesouvají do fáze 4 (rozhodnutí autora — architektura §14 se tím opravuje).

---

## 0. Rozsah a pořadí

Fáze 3 je podstatně větší než fáze 2 a dělí se na tři samostatné části. Každá končí vlastní verzí savu a je použitelná i bez těch následujících.

| Část | Obsah | Úkoly |
|---|---|---|
| **3a** | Generátor mapy, dialog nové hry, tři typy silnic, dopravní model, MHD | T22–T28 |
| **3b** | Převýšení terénu, terraforming, přepis pickingu a rendereru | T29–T34 |
| **3c** | Voda a kanalizace, kultura, sounáležitost, spokojenost | T35–T40 |

**Pořadí je záměrné.** 3a přináší nejvíc hratelnosti za nejmíň práce a nesahá na renderer. 3b je nejdražší část celé hry a je čistě rendererová — díky P1 na ní simulace nezávisí, takže ji lze odložit, aniž by cokoli z 3a nebo 3c blokovala.

**3b se nesmí začít dřív než 3a.** Kdyby se převýšení dělalo první, overlaye dopravy by se pak kreslily do právě přepsaného rendereru dvakrát.

---

## 1. Rozhodnutí ke schválení

### R6 — Dosažitelnost práce růst **moduluje**, nevetuje

Zadání říká „brána růstu". Tvrdá brána ale vytváří uzamčení: na začátku hry neexistují žádná pracovní místa, dosažitelnost je tedy všude nulová, nic nevyroste, a proto nikdy nevzniknou pracovní místa.

Řešení: dosažitelnost vstupuje do skóre parcely jako násobič v rozsahu `MIN_ACCESS_FACTOR`–1 (návrh 0,15–1,0). Špatně obsloužená čtvrť roste pomalu, ne vůbec. Deadlock je tím konstrukčně vyloučený, ne ošetřený výjimkou.

### R7 — Generátor v 3a nedělá řeky

Řeka rozdělí souvislou pevninu na dvě části a bez mostů je půlka mapy nedostupná. Mosty ale patří k převýšení, tedy do 3b.

Generátor 3a proto tvoří **jezera a pobřeží** a garantuje, že veškerá souš je souvislá. Řeky přibývají v 3b spolu s mosty.

### R8 — Výška se ukládá na **rozích**, ne na dlaždicích

`cornerHeight: Uint8Array((SIZE + 1)²)`. Tvar dlaždice se odvozuje ze čtyř rohů; těch 16 svahových variant je důsledek, ne uložený údaj.

Kdyby se výška držela na dlaždicích, sousední dlaždice by měly nejednoznačný šev a svahy by se musely dopočítávat heuristikou. SC2000 to řešilo stejně.

Stávající vrstva `elevation` (na dlaždicích, všude 0) se v 3b **ruší** a nahrazuje.

### R9 — Kanalizace není druhá síť

Voda dostane skutečné potrubí a podzemní pohled (rozhodnutí autora). Kanalizace se ale řeší jako **celoměstská kapacita** po vzoru odpadů z fáze 2: populace produkuje odpadní vodu, čistírny mají kapacitu, nepokrytý zbytek přičítá znečištění.

Druhá kreslená síť by znamenala zdvojení stavebních nástrojů, druhý podzemní pohled a druhou flood-fill vrstvu za velmi malou hloubku navíc.

### R10 — Doprava, dosažitelnost a spokojenost se **neukládají**

Všechny tři jsou odvozené a po načtení savu se přepočítají — stejně jako pokrytí službami ve fázi 2. Save tím zůstává malý a nemůže se rozejít se skutečností.

### R11 — Silnice se stávají typovanou vrstvou

Vrstva `road` dnes nese 0/1. Nově: `0` žádná, `1` ulice, `2` třída, `3` dálnice. Migrace v1→v3 mapuje každou existující jedničku na ulici.

### R12 — Kultura je třída služby, spokojenost je veličina nad nimi

Výklad odpovědi „kultura a spokojenost jsou dvě odlišné veličiny":

- **Kultura** a **sounáležitost** jsou dvě samostatné třídy služeb se stejným mechanismem jako policie nebo parky (radius, financování, pokrytí).
- **Spokojenost** je odvozená veličina na hrubé mřížce, počítaná ze **všech** tříd pokrytí plus ceny půdy, znečištění, kriminality, kolon, daní a nezaměstnanosti.

Spokojenost tedy není služba a nestaví se — je to výsledek. Škáluje obytnou poptávku a je hlavní číslo v HUD.

Pokud jsi tím myslel něco jiného, tohle je místo, kde to zastavit.

---

## 2. Generátor mapy (3a)

Žije v `src/sim/mapgen/`, tedy pod P1 — žádný renderer, žádný DOM. Používá výhradně `Rng` (P2), takže stejný seed dá vždy stejnou mapu.

### Typy terénu

Rozšíření ze čtyř na šest. Terén je hratelný údaj, ne dekorace:

| Hodnota | Terén | Stavba | Efekt |
|---|---|---|---|
| 0 | tráva | ano | — |
| 1 | voda | ne | bonus ceny půdy v okolí |
| 2 | písek | ano | mírně nižší cena půdy |
| 3 | skála | ne bez srovnání (3b) | — |
| 4 | les | až po vykácení (stojí peníze) | dokud stojí: bonus ceny půdy, pohlcuje znečištění |
| 5 | mokřad | až po zavezení (drahé) | — |

**Les je tam kvůli rozhodnutí, ne kvůli vzhledu.** Vykácet a získat místo, nebo nechat stát a mít čistší a dražší čtvrť — to je přesně ten typ volby, který má fáze 3 přidávat.

### Algoritmus

1. **Výškové pole** — fBm z hodnotového šumu, 4–5 oktáv, seed z `Rng`
2. **Voda** — vše pod `seaLevel`; poté ověření souvislosti souše (R7): největší souvislá komponenta se ponechá, ostrovy pod prahem se zvednou nad hladinu
3. **Písek** — pás okolo vody
4. **Skála** — vše nad `rockLevel`
5. **Les** — druhá šumová vrstva, prahovaná, jen na trávě
6. **Mokřad** — nízko položená místa poblíž vody, které nejsou vodou

Výškové pole se v 3a použije **jen k rozmístění terénu** a zahodí. V 3b se z něj stane `cornerHeight`.

### Parametry

Do `balance.json`, sekce `map`. Minimálně `seaLevel`, `rockLevel`, `beachWidth`, `forestDensity`, `marshThreshold`, `octaves`, `roughness`.

### Testy

- Stejný seed → identická mapa (hash vrstvy terénu)
- Různé seedy → různé mapy
- **Souš je vždy souvislá** — flood fill z libovolné nevodní dlaždice pokryje všechny nevodní dlaždice
- Zastoupení terénů je v rozumných mezích pro 200 náhodných seedů (žádná mapa není 90 % voda)

---

## 3. Dialog nové hry (3a)

Vzniká proto, že generátor bez náhledu je nepoužitelný — a mimochodem tím padá dluh „město se dá pojmenovat jen v kódu".

Obsahuje: jméno města, pole se seedem (vyplněné náhodně, ručně přepsatelné), **náhled mapy** vykreslený z vygenerovaných vrstev, tlačítko „jiná mapa" a start.

Náhled je prostý bitmapový render vrstvy terénu v barvách palety, nikoli izometrický. Generování musí být dost rychlé na okamžité přegenerování — pokud není, je to chyba v generátoru, ne důvod k načítacímu proužku.

---

## 4. Typy silnic (3a)

| Typ | Kapacita | Cena | Údržba |
|---|---|---|---|
| ulice | 1× | 1× | 1× |
| třída | 3× | 4× | 3× |
| dálnice | 8× | 12× | 8× |

Konkrétní čísla do `balance.json`, sekce `traffic.roadTypes`.

**Vylepšení na místě:** stavba vyššího typu na existující silnici ji nahradí a účtuje se plná cena nového typu. Snížení typu není možné — jen zbourat a postavit.

**Auto-tiling napříč typy:** všechny typy se navzájem napojují. Bitmask sousedů se počítá z „je tam jakákoli silnice", vizuální šířka a barva podle typu vlastní dlaždice.

Dálnice ve 3a **nemá** mimoúrovňové křižovatky ani nájezdy — je to jen širší a dražší silnice s vyšší kapacitou. Nájezdy patří k převýšení, tedy nejdřív do 3b.

---

## 5. Dopravní model (3a)

Vzorkování náhodných cest podle Micropolisu (rozhodnutí autora). Běží každých 8 tiků, offset 4.

### Průběh jednoho běhu

```
vynuluj trafficLoad

pro každou obytnou budovu ve vzorku (podle id, vzestupně):
    start = silniční dlaždice sousedící s budovou
    pokud žádná není → jobAccess = 0, pokračuj

    úspěchy = 0
    pro pokus 1..POKUSŮ:
        pozice = start
        pro krok 1..MAX_KROKŮ:
            trafficLoad[pozice] += váhaBudovy
            sousedé = silniční dlaždice sousedící s pozicí, kromě té, ze které jsme přišli
            pokud prázdné → konec pokusu
            pozice = rng volba ze sousedů
            pokud pozice sousedí s budovou kategorie C nebo I s volnými místy:
                úspěchy++
                konec pokusu

    jobAccess[budova] = lerp(jobAccess[budova], úspěchy / POKUSŮ, VYHLAZENÍ)
```

**Vzorkování je nutné.** Při tisících budov se každý běh zpracuje jen `MAX_BUDOV_ZA_BĚH` budov, střídavě po kruhu — pořadí drží `world.trafficCursor`, který je součástí savu, aby zůstal determinismus. Budovy mimo vzorek si drží předchozí hodnotu.

Preference „nevracet se, odkud jsme přišli" je důležitá: bez ní se náhodná procházka zacyklí na místě a nic nikam nedojde.

### Kolony

```
congestion[dlaždice] = trafficLoad[dlaždice] / kapacita(typSilnice[dlaždice])
```

Průměr přes 4×4 dlaždice se agreguje na hrubou mřížku a vstupuje do ceny půdy jako **záporný** člen (nová váha v `balance.json`, sekce `landValue.weights.congestion`).

Tím vzniká **záporná zpětná vazba**: vysoká cena půdy → vyšší úrovně → hustší zástavba → víc dopravy → kolony → nižší cena půdy. Je to samo o sobě stabilizující a je to žádoucí — město se přestane zahušťovat, dokud hráč nezlepší dopravu.

### Vliv na růst

Skóre parcely z fáze 2 §9 se rozšiřuje:

```
skóre = landValue ^ EXPONENT
      * faktorSilnice
      * faktorDaně
      * faktorDostupnostiPráce        // ← nové
```

kde `faktorDostupnostiPráce = lerp(MIN_ACCESS_FACTOR, 1, jobAccess sousedící čtvrti)` (R6).

Pro nezastavěné parcely se `jobAccess` bere jako průměr z okolních obytných budov; když žádné nejsou, použije se 1 (nová čtvrť není trestána za to, že ještě neexistuje).

**Pojistka proti uzamčení:** dokud je `city.totalJobs === 0`, je faktor 1 pro všechny.

### Overlay

Nový overlay „doprava" — zátěž na silnicích od zelené po červenou. Kreslí se na plném rozlišení, ne na hrubé mřížce.

---

## 6. MHD (3a)

Ve 3a jako **třída služby** nad hotovým mechanismem z T13 (rozhodnutí autora — linky s vozidly jsou pozdější fáze).

- **Zastávka** — třída `transit`, malý radius. Budovy v pokrytí generují méně dopravy: `váhaBudovy *= (1 - coverage[transit] * TRANSIT_REDUCTION)`.
- **Depo** — nestaví pokrytí, ale je **prerekvizitou** zastávek: `requirements.buildings: ["vanilla:transit_depot"]`.

Depo je první ostré použití mechanismu prerekvizit z T19, který byl doteď implementovaný, ale nevyužitý.

---

## 7. Převýšení terénu (3b)

Nejdražší část celého projektu. Sahá na picking, chunk renderer, řazení, stavební pravidla i generátor.

### Model

`cornerHeight: Uint8Array((SIZE + 1)²)`, rozsah 0–15 (R8).

Tvar dlaždice `(x, y)` určují rohy `(x,y)`, `(x+1,y)`, `(x,y+1)`, `(x+1,y+1)`. Dlaždice je **rovná**, pokud jsou všechny čtyři shodné.

**Invariant:** sousední rohy se smí lišit nejvýš o 1. Terraforming ho vynucuje kaskádovitě — zvednutí rohu automaticky zvedne sousedy, kteří by jinak invariant porušili, a celá kaskáda se účtuje.

### Projekce

Vzorec z architektury §3 se rozšiřuje o výšku rohu místo výšky dlaždice. Dlaždice se kreslí jako čtyřúhelník ze čtyř promítnutých rohů, ne jako pravidelný diamant.

### Picking

`screenToGrid` z fáze 1 přestává platit a **musí se nahradit**, ne opravit. Nový postup: iteruj dlaždice od nejbližší ke kameře (sestupně podle `x + y`) a testuj, zda kurzor leží uvnitř promítnutého čtyřúhelníku. První zásah vyhrává.

Kvůli výkonu se testují jen dlaždice ve viditelném okně a v pásu, do kterého může kurzor spadnout.

### Řazení

Řazení podle `x + y` přestává být dostatečné u vysokých budov na svazích. Řadí se podle `x + y` a při shodě podle výšky základny sestupně.

### Terraforming

Nástroje: zvednout roh, snížit roh, srovnat oblast. Každá operace stojí peníze podle počtu dotčených rohů včetně kaskády.

Nelze zvedat pod vodou a nelze snižovat tam, kde stojí budova. Silnice snížení či zvednutí snese, pokud výsledný svah zůstane v mezích.

### Stavební pravidla

- Budovy vyžadují **rovný půdorys**. Pokus o stavbu na svahu nabídne automatické srovnání a připočte jeho cenu.
- Silnice smí ležet na svahu, který stoupá **rovnoměrně** ve směru silnice. Zkroucená dlaždice (rohy tvořící sedlo) silnici nepobere.
- Skála a mokřad z §2 se stávají řešitelnými: skálu lze odtěžit, mokřad zavézt — obojí za cenu terraformingu.

### Řeky a mosty

Teprve tady smí generátor tvořit řeky (R7). S nimi vzniká **most** jako typ silnice přes vodu s vlastní cenou a bez napojení na sousední terén.

### Co v 3b není

Tunely, mimoúrovňové křižovatky, nájezdy na dálnici, tekoucí voda ani zaplavování. To vše je pozdější obsah nad hotovým výškovým modelem.

---

## 8. Voda a kanalizace (3c)

### Vodovod

Skutečné potrubí s podzemním pohledem (rozhodnutí autora).

- Nová vrstva `pipe: Uint8Array` na plném rozlišení, 0/1.
- Zdroje: **vodárna** (musí sousedit s vodou) a **čerpací stanice** (zvyšuje dosah sítě).
- Rozvod: flood fill po potrubí, obdobně jako elektřina. Na rozdíl od elektřiny **budovy proud nevedou** — potrubí musí být pod nimi položené výslovně.
- Budova bez vody nevyroste a postupně chátrá.

### Podzemní pohled

Nový režim zobrazení: terén se ztlumí, vykreslí se potrubí a pokrytí vodou. Přepínač vedle overlayů. Stavební nástroje v tomto režimu kladou potrubí místo silnic.

### Kanalizace

Celoměstská kapacita (R9). Populace produkuje odpadní vodu, **čistírna** má kapacitu, nepokrytý zbytek se přičítá do zdrojového bufferu znečištění — přesně jako odpady ve fázi 2.

---

## 9. Kultura, sounáležitost, spokojenost (3c)

### Nové třídy služeb

Obě nad mechanismem z T13, žádný nový kód (R12):

- **`culture`** — muzeum, divadlo, kino, výstavní síň
- **`social`** — společenské centrum, domov pro seniory

Parky zůstávají vlastní třídou z fáze 2.

### Spokojenost

Odvozená vrstva na hrubé mřížce, neukládá se (R10). Běží každých 16 tiků, offset 13.

```
surová = Σ_třída coverage[třída][c] * váhaSpokojenosti[třída]
       + landValue[c]     * VÁHA_CENY
       - pollution[c]     * VÁHA_ZNEČIŠTĚNÍ
       - crime[c]         * VÁHA_KRIMINALITY
       - congestion[c]    * VÁHA_KOLON
       - danováSazba      * VÁHA_DANÍ
       - nezaměstnanost   * VÁHA_NEZAMĚSTNANOSTI

happiness[c] = clamp(lerp(happiness[c], surová, VYHLAZENÍ), 0, 255)
```

**Účinek:** obytná poptávka se násobí průměrnou spokojeností města. Spokojenost tedy **nebrání** růstu, ale zpomaluje ho — stejná logika jako R6.

**Zobrazení:** hlavní číslo v HUD plus vlastní overlay. Je to jediná veličina, kterou hráč sleduje průběžně; ostatní se otevírají, až když spokojenost klesá.

Kontrola smyček: spokojenost čerpá z ceny půdy, ale cena půdy ze spokojenosti nečerpá (R2 z fáze 2 platí dál). Poptávka → růst → hustota → doprava → kolony → spokojenost je záporná smyčka, tedy stabilní.

---

## 10. Save

Tři verze, po jedné na část:

| Verze | Přibývá | Migrace |
|---|---|---|
| **v3** (3a) | typ silnice, nové terény, `mapSeed` a parametry generátoru v `meta`, `trafficCursor` | `road: 1` → ulice; terény beze změny; seed se doplní nulou a mapa se považuje za ručně vzniklou |
| **v4** (3b) | `cornerHeight`, zrušená vrstva `elevation` | rovná mapa — všechny rohy 0 |
| **v5** (3c) | `pipe` | prázdná síť; existující budovy se považují za nezavodněné a začnou chátrat, dokud hráč nepoloží potrubí |

**Neukládá se:** `trafficLoad`, `jobAccess`, `happiness`, pokrytí všech tříd (R10).

Ke každé verzi vzniká fixtura vedle stávajících `v1` a `v2`. Test prochází všechny.

Migrace v5 má nepříjemný důsledek — načtené město začne chátrat, dokud hráč nepoloží potrubí. **Je to záměr**, protože alternativou by bylo tiše předstírat, že staré město vodovod má. Hráč o tom ale musí být zpraven hláškou při načtení, ne až úbytkem obyvatel.

---

## 11. Úkoly

### 3a — mapa a doprava

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T22** | Generátor mapy, šest typů terénu, garance souvislé souše, parametry v `balance.json` | — |
| **T23** | Dialog nové hry — jméno, seed, náhled, přegenerování | T22 |
| **T24** | Typy silnic, vylepšení na místě, auto-tiling napříč typy, kapacity a ceny | — |
| **T25** | Dopravní model, `trafficLoad`, `jobAccess`, vzorkování s kurzorem, overlay | T24 |
| **T26** | Kolony do ceny půdy, dostupnost práce do skóre parcely, pojistka proti uzamčení | T25 |
| **T27** | MHD — třída `transit`, zastávky, depo jako prerekvizita | T25 |
| **T28** | Save v3, migrace, fixtura | T22–T27 |

### 3b — převýšení

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T29** | `cornerHeight`, invariant sousedních rohů, výšky z generátoru, řeky | T22 |
| **T30** | Renderer svahů, chunk re-bake při změně výšky, řazení podle výšky základny | T29 |
| **T31** | Picking od předu dozadu, náhrada `screenToGrid` | T30 |
| **T32** | Terraforming — nástroje, kaskáda, ceny | T31 |
| **T33** | Stavební pravidla na svazích, srovnání pod budovou, mosty, těžba skály a zavážení mokřadu | T32 |
| **T34** | Save v4, migrace, fixtura | T29–T33 |

### 3c — sítě a spokojenost

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T35** | Potrubí, vodní síť, vodárna a čerpací stanice, chátrání bez vody | — |
| **T36** | Podzemní pohled, kladení potrubí | T35 |
| **T37** | Kanalizace jako kapacita, čistírna | T35 |
| **T38** | Třídy `culture` a `social` | — |
| **T39** | Spokojenost — vrstva, vzorec, škálování poptávky, HUD, overlay | T38, T26 |
| **T40** | Save v5, migrace, fixtura | T35–T39 |
| **T41** | Vyhodnocení fáze — rozhodovací bod, ne technický úkol | vše |

---

## 12. Akceptační kritéria

### 3a

1. Stejný seed dá vždy identickou mapu; souš je na 200 náhodných seedech vždy souvislá
2. Dialog nové hry ukáže náhled a „jiná mapa" ho okamžitě změní
3. Cena půdy u vody je měřitelně vyšší než uprostřed pevniny — bonus vody konečně platí
4. Vykácení lesa uvolní místo a zároveň sníží cenu půdy v okolí
5. Vylepšení ulice na třídu sníží kolony na daném úseku
6. Čtvrť bez silničního spojení s průmyslem roste **pomalu, ne vůbec** (R6)
7. Nová hra se rozjede i bez jediného pracovního místa — žádné uzamčení
8. Zastávka MHD v obytné čtvrti sníží zátěž na okolních silnicích
9. Depo nelze obejít — zastávka bez něj se nepostaví
10. Save v3 přežije round-trip, fixtury v1 a v2 se načtou

### 3b

11. Terén má viditelné svahy a budovy stojí na rovině
12. Kliknutí trefí správnou dlaždici i na strmém svahu a i tehdy, když ji částečně zakrývá budova před ní
13. Zvednutí rohu vedle strmého svahu spustí kaskádu a účtuje ji celou
14. Srovnání pod budovou se nabídne s cenou předem, ne až po zaplacení
15. Most překlene řeku a doprava po něm projde
16. 60 FPS při plném oddálení na členitém terénu

### 3c

17. Budova bez potrubí nevyroste a postupně chátrá
18. Podzemní pohled ukáže síť a pokrytí, stavební nástroj v něm klade potrubí
19. Nedostatečná kapacita čistírny zvedne znečištění celoměstsky
20. Postavení divadla zvedne spokojenost v dosahu
21. Pokles spokojenosti zpomalí obytnou poptávku, nezastaví ji
22. Save v5 přežije round-trip; načtení staršího savu ohlásí chybějící vodovod hláškou

### Průřezově

- Determinismus po 5000 tikách včetně dopravy a generátoru
- Golden testy prochází
- Žádná konstanta balancu v kódu
- Žádný uživatelsky viditelný text mimo locale soubory

---

## 13. Co do fáze 3 nepatří

- Mody, content registry pro externí zdroje, Steam Workshop → fáze 4
- Sprity a grafika → fáze 4 (rozhodnutí autora: zůstáváme u procedurálních kvádrů)
- Kompletní lokalizace → fáze 4
- Katastrofy včetně požárů → odloženo autorem do další fáze
- Linky MHD s vozidly → pozdější fáze (3c dodává jen zastávky)
- Tunely, nájezdy, mimoúrovňové křižovatky
- Tekoucí voda, povodně, sesuvy
- Elektřina jako podzemní síť — zůstává tak, jak je
