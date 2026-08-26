---
agent: claude
project: project-85
document_type: standard
created_at: 2026-08-22
updated_at: 2026-08-22
tags:
  - citybuilder
  - faze-4
  - katastrofy
status: draft
related:
  - docs/01-ARCHITEKTURA.md
  - docs/03-FAZE-2.md
  - docs/04-FAZE-3.md
  - docs/FAZE-4-KATASTROFY.md
---

# Fáze 4 — zadání

**Verze dokumentu:** 2.0
**Vstupní podmínka:** `docs/01-ARCHITEKTURA.md` (P1–P7), `docs/03-FAZE-2.md` (R1–R5), `docs/04-FAZE-3.md` (R6–R12), `docs/PROGRESS.md`
**Doplňující dokument:** `docs/FAZE-4-KATASTROFY.md` — parametry všech patnácti katastrof

Fáze 3 dala prostoru tvar a odpor. Fáze 4 přidává **riziko, provoz a dluh** — tedy tři důvody, proč hotové město nezůstane hotové.

Distribuce, platformy, mody, sprity, zvuk, tutoriál, scénáře a nastavení jsou fáze 5 a dál.

### Změny proti verzi 1.0

| Co | Změna |
|---|---|
| R21 | **schváleno v plném rozsahu** — blackout, epidemie, sesuv půdy a chemická havárie jsou součástí fáze; celkem 15 katastrof |
| Požár | přidána kriminalita jako faktor, váhy přeškálovány, hájení 60 → **10**, souběžně až 4 ohniska |
| Stávka | `minPopulation` 800 → **1800**, souběžně **2** |
| Průmyslová havárie | bez řetězení výbuchů |
| Tornádo | bez předpovědi dráhy |
| Datový model | přibývají `terraformTick`, `infection`, příznak lesního požáru a tři stavové seznamy — viz §9 |
| Úkoly | 4b rozděleno na T47–T54 kvůli počtu katastrof |

---

## 0. Rozsah a pořadí

| Část | Obsah | Úkoly |
|---|---|---|
| **4a** | Velikosti map, běhová `MAP_SIZE`, výkon na 512×512 | T42–T46 |
| **4b** | Katastrofy — riziko, oheň, záplava, trosky, patnáct pohrom | T47–T54 |
| **4c** | Linky MHD, jízdné, půjčky, granty, dluhopisy | T55–T58 |
| **4d** | Save v6, vyhodnocení | T59–T60 |

**4a musí být první.** `MAP_SIZE` je dnes zadrátovaná konstanta v `index()`, `inBounds()` a v alokaci každé vrstvy. Čím víc kódu vznikne předtím, než se z ní stane běhový údaj, tím dražší ten refaktor je — a katastrofy i linky se všechny opírají o souřadnice.

---

## 1. Rozhodnutí ke schválení

### R13 — Katastrofy jsou vlastní systémy, ale sdílejí pomocnou vrstvu

Rozhodnutí autora: každá katastrofa má vlastní mechaniku, ne konfiguraci nad společným tvarem. Je to obhajitelné — na rozdíl od budov nejsou katastrofy stejnorodé. Tornádo je pohyb v čase, nepokoje jsou stav, oheň je šíření.

Podmínka je, že společné operace žijí v `src/sim/disasters/effects.ts` a nekopírují se:

```
destroyArea(world, shape, filter)
ignite(world, shape, intensity)
floodArea(world, shape, depth)
suppressService(world, class, shape, factor, duration)
spikeTraffic(world, shape, factor, duration)
spikeCrime(world, shape, amount, duration)
crimeFloor(world, shape, minValue, duration)
happinessPenalty(world, shape, amount, duration)
landValuePenalty(world, shape, amount, duration)
pollutionBurst(world, shape, amount)
contaminateWater(world, shape, intensity, duration)
populationLoss(world, shape, ratio)
blockTile(world, tile, duration)
```

Tvary: `point`, `radius`, `band(od, do, šířka)`, `global(vzorkování)`, s volitelným filtrem na zónu nebo terén.

Každá katastrofa implementuje `Disaster` s `start()`, `tick()`, `isFinished()` a `serialize()`.

### R14 — Vlastní vrstvu mají jen oheň a záplava

Obojí je proces trvající desítky tiků a musí se ukládat. Epidemie používá řídkou `Map`, ne vrstvu — většina města je vždy nenakažená. Ostatní katastrofy jsou jednorázový zásah nebo dočasný stav s odpočtem.

### R15 — Trosky jsou vrstva, ne stav budovy

`rubble: Uint8Array` na plném rozlišení. Trosky vznikají i tam, kde žádná budova nestála — po zničené silnici nebo potrubí.

Blokují stavbu, dokud je hráč nezbourá. Chovají se jako opuštěné budovy z fáze 2: sráží cenu půdy a zvyšují kriminalitu.

### R16 — Riziko nepřírodních katastrof má strop

Podfinancování → katastrofy → škody → nižší daně → větší podfinancování je kladná zpětná vazba. S měkkým bankrotem by se z ní město nedostalo.

Riziko roste z podfinancování jen do `MAX_RISK_MULTIPLIER = 3` a při záporném rozpočtu se dál nezvyšuje.

Stejný princip jako R2, R3 a R6 — projekt v každé fázi jednu utrženou smyčku rozpojuje.

### R17 — Období hájení pro každý typ

`lastOccurrence[typ]` ve stavu světa. Katastrofa nesmí nastat dřív než `cooldown[typ]` tiků po předchozí téhož typu. Hodnoty v katalogu, rozsah od 10 tiků (požár) po 2160 (zemětřesení).

Několik katastrof má souběžný limit vyšší než 1 — hájení pak brání jen opakování v tomtéž okně, ne existenci více ohnisek naráz.

### R18 — Katastrofy jdou při nové hře vypnout

Přepínač v dialogu z T23, uloží se do savu. Nezávisle na tom existuje **menu katastrof** pro ruční spuštění — je to zároveň jediný rozumný způsob, jak je ladit. Menu nepodléhá období hájení.

### R19 — Neprodaná část emise propadá

Hráč platí poplatek za vydání z **celé** nabízené částky, dostane ale jen skutečně upsanou část. Bez toho by bylo optimální vypisovat nesmyslně velké emise s minimálním úrokem.

### R20 — 512×512 není konstanta, ale jiný renderer a jiné průchody

262 144 dlaždic, šestnáctkrát víc než dnes. Dva samostatné úkoly:

- **Chunky se musí uvolňovat.** Dnes se pekou všechny; při 512×512 by to byly stovky textur naráz. Nově se drží jen viditelné plus okraj.
- **Celoplošné průchody musí zmizet.** Systémy, které projdou celou mapu (sběr kandidátů na růst, hustota populace), přejdou na udržované seznamy. Difuze na hrubé mřížce je v pořádku.

### R22 — Sesuv půdy vyžaduje 3b

Bez převýšení terénu nemá kde vzniknout a `requiresElevation` ho vypne. Pokud se fáze 4 udělá dřív než 3b, sesuv se prostě nespustí.

---

## 2. Velikosti map (4a)

### Běhová MAP_SIZE

Přestává být konstantou a stává se vlastností `WorldState`. Dotčené je `index()`, `inBounds()`, `createLayers()`, hrubá mřížka, generátor, serializace a všechny systémy, které konstantu importují.

`COARSE_FACTOR` zůstává 4, takže hrubá mřížka roste s mapou (512 → 128×128 buněk).

### Nabízené velikosti

| Velikost | Dlaždic | Poznámka |
|---|---|---|
| 128×128 | 16 384 | výchozí |
| 192×192 | 36 864 | |
| 256×256 | 65 536 | |
| 512×512 | 262 144 | v dialogu s upozorněním na výkon |

### Výkonový cíl

60 FPS při plném oddálení na všech čtyřech velikostech. Pokud 512×512 cíl nesplní ani po T44 a T45, je dalším krokem přesun simulace do Web Workeru — `SimHost` je na to navržený od T1, takže je to přesun, ne přepis.

**T46 se dělá jen tehdy, když měření ukáže, že je potřeba.** Ne preventivně.

---

## 3. Model rizika (4b)

Plánovač běží každých 30 tiků, offset 7. Tedy **jednou za herní měsíc**, což je důvod, proč jsou všechny základní pravděpodobnosti v katalogu měsíční — žádný přepočet na tik se nedělá.

```
pro každý typ katastrofy:
    pokud katastrofy vypnuté → přeskoč                              (R18)
    pokud tick - lastOccurrence[typ] < cooldown[typ] → přeskoč       (R17)
    pokud aktivních[typ] >= souběžné[typ] → přeskoč
    pokud nesplněny podmínky typu → přeskoč    // minPopulation, requiresWater, …

    riziko = min(základ[typ] * měřítkoFaktor[typ] * sezónníFaktor[typ] * faktorTypu,
                 maxMonthlyChance[typ])

    pokud rng.next() < riziko → spusť
```

Skládání je tedy **prostý součin** čtyř činitelů, oříznutý stropem daného typu:

1. `baseMonthlyChance` — základ z katalogu
2. `měřítkoFaktor` — velikost města nebo jiná veličina, viz níže
3. `seasonFactor` — 1, pokud typ sezónnost nemá
4. `faktorTypu` — 1 u přírodních, vážený součet u nepřírodních

**Přírodní katastrofy** (povodeň, tornádo, zemětřesení, lesní požár, sesuv) mají `faktorTypu = 1`. Nezávisí na tom, jak hráč město spravuje — jen na tom, co má na mapě.

**Nepřírodní** používají vážený součet ukazatelů podle vzorce v katalogu, vždy ve tvaru `clamp(1 + Σ váha × ukazatel, 1, 3)`. Strop 3 je `MAX_RISK_MULTIPLIER` z R16 a je společný všem.

**Měřítkový faktor** není u všech počet budov:

| Katastrofa | Škáluje se podle |
|---|---|
| požár, výbuch, stávka, nepokoje | počet budov |
| hromadná nehoda | délka silniční sítě |
| povodeň | délka pobřeží |
| tornádo | podíl roviny |
| lesní požár | plocha lesa |
| průmyslová havárie | počet průmyslových budov |
| válka gangů | počet obytných budov |
| epidemie | populace |
| chemická havárie | počet těžkých provozů |
| zemětřesení, blackout | neškáluje se |

Všechny ukazatele ve vzorcích `faktorTypu` jsou normalizované na rozsah 0–1. Vrstvy 0–255 se dělí 255, podíly se počítají přímo.

`lastOccurrence[typ]` se zapisuje při **vzniku**, s výjimkou povodně a lesního požáru, kde se zapisuje při skončení (v katalogu poznamenáno u obou).

---

## 4. Oheň (4b)

Jediná katastrofa s plnohodnotným šířením.

**Vrstva:** `fire: Uint8Array` na plném rozlišení — intenzita 0–255. Vedle ní `fuel: Uint8Array` se zbývajícím palivem a `fireFlags: Uint8Array` s příznakem lesního požáru (odlišné parametry šíření).

**Ohňový tik běží každé 2 tiky simulace**, tedy nezávisle na plánovači katastrof. Systém je zaregistrovaný s `interval: 2, offset: 1`.

```
palivo    -= 1
intenzita += PŘÍRŮSTEK
intenzita -= HAŠENÍ_ZÁKLAD + coverage[fire][buňka] * HAŠENÍ_POKRYTÍ

pokud intenzita <= 0 → uhašeno, budova přežila
pokud palivo   <= 0 → zničena, trosky
```

Je to **závod**: hašení proti palivu. Buď intenzita klesne na nulu dřív, než dojde palivo, nebo budova shoří.

**Silnice, voda, prázdná dlaždice a potrubí nehoří vůbec.** Z toho vzniká hlavní aktivní mechanika — hráč může buldozerem prorazit průsek a oheň zastavit.

Tabulky hořlavosti, paliva a parametrů lesní varianty jsou v katalogu, §1 a §11.

Zásah hasičů se neprojevuje příjezdem vozu, ale hodnotou `coverage[fire]` v buňce. Podfinancované stanice mají menší dosah (fáze 2 §6), takže hoří déle.

Hořící dlaždice se procházejí vzestupně podle indexu, `world.rng` — jinak padá determinismus. Pauza pauzuje i požár.

---

## 5. Záplava (4b)

**Vrstva:** `flood: Uint8Array` na plném rozlišení — zbývající doba zaplavení. Vedle ní `floodDamage: Uint8Array` jako akumulátor poškození (0–255, práh zničení při 255).

Systém běží s `interval: 1`.

Vzniká z vodní dlaždice, šíří se do vnitrozemí na 2–5 dlaždic. **Po 3b respektuje výšku** — voda teče do nižších rohů, vyvýšený břeh zůstane suchý. To je přímá odměna za investici do převýšení a zároveň důvod, proč je terraformovaná hráz platnou trvalou obranou.

Škoda nastává **postupně**, ne okamžitě — rychlé opadnutí opravdu zachraňuje. Opadání zrychluje `coverage[fire]`.

Zaplavená dlaždice nevede proud ani vodu a je neprůjezdná pro dopravní model.

---

## 6. Katastrofy (4b)

Patnáct pohrom, všechny odsouhlasené jednotlivě. Parametry v `docs/FAZE-4-KATASTROFY.md`.

| # | Katastrofa | Charakter |
|---|---|---|
| 1 | Požár | šíření, hlavní obranou je průsek |
| 2 | Povodeň | postup vlny, obranou je výška a nezastavěný břeh |
| 3 | Tornádo | pohyb v čase, neodvratitelné, škodí hlavně následnými požáry |
| 4 | Zemětřesení | globální, spouští požáry i záplavy, dotřesy |
| 5 | Hromadná nehoda | nic neničí — blokuje dopravu a potlačuje služby |
| 6 | Stávka | trvající stav, hráč ji zkrátí reakcí |
| 7 | Občanské nepokoje | globální eskalace stávky, zakládá ohniska požárů |
| 8 | Průmyslová havárie | okruh s filtrem na vznik, kontaminace |
| 9 | Válka gangů | nejdelší, ničí zřídka, škodí degradací čtvrti |
| 10 | Výbuch | častý, malý dosah, hodně ohnisek požáru |
| 11 | Lesní požár | vzniká mimo město, hráč má čas zareagovat |
| 12 | Blackout | kaskáda ze stávajícího flood fillu, vyřazuje služby |
| 13 | Epidemie | šíří se populací a dopravou, jde aktivně potlačit |
| 14 | Sesuv půdy | mění terén trvale, vyžaduje 3b (R22) |
| 15 | Chemická havárie | nejsilnější zdroj znečištění ve hře, kontaminuje vodu |

Tři z nich nezničí ani jednu budovu (hromadná nehoda, stávka, blackout) a jedna jen výjimečně (válka gangů). Jejich váha je v tom, co udělají s provozem, službami a spokojeností — a v tom, že otevírají dveře ostatním.

### Menu katastrof

Panel v UI, který kteroukoli z nich spustí na vybrané pozici. Slouží k ladění i hráči. Nepodléhá období hájení ani přepínači z R18.

### Hlášení

Každá katastrofa se hlásí při vzniku se skokem kamerou. Výjimky:

- **Hromadná nehoda** se hlásí jen při blokaci dlaždice s vysokou zátěží — jinak by při třech souběžných měsíčně otravovala
- **Stávka a nepokoje** hlásí i **hlavní příčinu**, tedy které složky `faktorTypu` byly nejvyšší. Bez toho je to náhodný trest a hráč neví, co napravit
- **Lesní požár** se hlásí znovu, když dorazí k zástavbě
- **Blackout** hlásí každý stupeň kaskády

---

## 7. Linky MHD (4c)

Rozšiřuje třídu `transit` z fáze 3, kde zastávky fungovaly jen jako pokrytí.

| Mód | Zatížení silnic | Kapacita/vozidlo | Cena zastávky |
|---|---|---|---|
| autobus | žádné navíc | nízká | nízká |
| tramvaj | **sdílí dlaždici se silnicí a ubírá jí kapacitu** | střední | střední |
| metro | žádné | vysoká | vysoká |

Tramvaj je jediná, která do dopravního modelu zasahuje záporně — jinak by neexistoval důvod volit autobus. Tramvajové linky navíc **nejezdí během blackoutu**.

```ts
interface TransitLine {
  id: number;
  mode: 'bus' | 'tram' | 'metro';
  stops: number[];
  vehicles: number;
  fare: number;
}
```

Trasa se **nekreslí** — je to abstrakce (rozhodnutí autora).

```
kapacita   = vozidla * KAPACITA[mód]
poptávka   = Σ populace a pracovní místa v dosahu zastávek linky
přepraveno = min(kapacita, poptávka * citlivostNaJízdné(fare))
```

Budovy v dosahu zastávek generují méně dopravy úměrně `přepraveno / poptávka`. Linka s jedním autobusem a deseti tisíci obyvateli v dosahu prakticky nepomůže — a to je smysl.

**Jízdné** je příjem `přepraveno * fare` měsíčně. Vysoké jízdné snižuje využití, takže existuje optimum. Vozidla mají pořizovací cenu a měsíční údržbu.

---

## 8. Finance (4c)

### Půjčky

Částka do stropu odvozeného od měsíčního příjmu. Pevný úrok, měsíční splátky, pevná doba, omezený počet souběžně.

Nesplácení nevede k tvrdému konci (bankrot zůstává měkký), ale zhoršuje **rating**, který ovlivňuje úrok příštích půjček i úpis dluhopisů.

### Granty

Jednorázové, automaticky přiznané při dosažení milníku — hranice populace, první vysoká škola, spokojenost nad prahem po určitou dobu. Každý jen jednou, seznam přiznaných v savu.

Definované jako **obsah** v `content/vanilla/grants/`, ne v kódu (P5).

### Dluhopisy

Hráč zadá **částku** (v mantinelu), **úrok** a **splatnost**.

```
úspěšnost = clamp(
      ZÁKLAD
    + (nabízenýÚrok - referenčníÚrok) * K_ÚROK
    + spokojenost                     * K_SPOKOJENOST
    + růstPopulace                    * K_RŮST
    - kriminalita                     * K_KRIMINALITA
    - zadluženost                     * K_DLUH,
    0, 1)

upsáno = částka * úspěšnost
```

Poplatek za vydání se platí z celé nabízené částky (R19). Úrok se vyplácí ročně (360 tiků), jistina jednorázově ve splatnosti. Nesplacení jistiny sráží rating výrazně a na několik let znemožní další emisi.

Jediný nástroj ve hře, kde hráč **licituje**. Nízký úrok při špatné spokojenosti znamená, že se neupíše skoro nic a poplatek propadne.

Dluhopisy jsou zároveň hlavní odpověď na zemětřesení, po kterém je oprava tak drahá, že město bez rezervy spadne do spirály.

---

## 9. Save v6 (4d)

Přibývá:

| Položka | Zdroj |
|---|---|
| vrstvy `fire`, `fuel`, `fireFlags`, `flood`, `floodDamage`, `rubble` | 4b |
| `terraformTick: Uint16Array` | sesuv půdy |
| `infection: Map<buňka, number>` | epidemie |
| `mapSize` v `meta.grid` | 4a |
| `disastersEnabled`, `lastOccurrence[typ]` | 4b |
| stav probíhajících katastrof (`serialize()` každého modulu) | 4b |
| seznam odpojených elektráren | blackout |
| seznam vyřazených vodáren + tik obnovení | chemická havárie |
| `transitLines` | 4c |
| půjčky, dluhopisy, přiznané granty, rating | 4c |

**Ukládá se i probíhající pohroma** (rozhodnutí autora) — jinak by si hráč uložil, nechal město shořet a načetl zpět.

Migrace v5 → v6: prázdné vrstvy, katastrofy zapnuté, `terraformTick` nula, žádné linky ani závazky, rating výchozí.

---

## 10. Úkoly

### 4a

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T42** | `MAP_SIZE` jako běhový údaj napříč simulací, serializací a generátorem | — |
| **T43** | Čtyři velikosti v dialogu nové hry, upozornění u 512×512 | T42 |
| **T44** | Uvolňování chunků — držet viditelné plus okraj | T43 |
| **T45** | Náhrada celoplošných průchodů udržovanými seznamy | T42 |
| **T46** | *Podmíněně:* přesun simulace do Web Workeru, jen podle měření | T45 |

### 4b

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T47** | Model rizika, plánovač, hájení, přepínač, menu katastrof, `effects.ts` | T42 |
| **T48** | Oheň — vrstvy, šíření, hořlavost, hašení, průseky, lesní varianta | T47 |
| **T49** | Záplava — vrstvy, šíření podle výšky, postupné poškození, opadání | T47 |
| **T50** | Trosky — vrstva, efekty, bourání | T47 |
| **T51** | Ničivé: tornádo, zemětřesení, výbuch, průmyslová havárie, lesní požár | T48–T50 |
| **T52** | Sociální: stávka, nepokoje, válka gangů, hromadná nehoda | T47 |
| **T53** | Síťové a zdravotní: blackout, epidemie, chemická havárie | T47, T49 |
| **T54** | *Podmíněně 3b:* sesuv půdy, vrstva `terraformTick` | T50, 3b |

### 4c

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T55** | Linky — datový model, výběr zastávek, tři módy, tramvaj v dopravě | T42 |
| **T56** | Jízdné, kapacita, poptávka, účinek na dopravu, provozní náklady | T55 |
| **T57** | Půjčky a granty, rating | — |
| **T58** | Dluhopisy — emise, úpis, výplata úroků, splatnost | T57 |

### 4d

| Úkol | Obsah |
|---|---|
| **T59** | Save v6, migrace, fixtura |
| **T60** | Vyhodnocení fáze — rozhodovací bod, ne technický úkol |

---

## 11. Akceptační kritéria

### Mapa a výkon

1. Všechny čtyři velikosti se vygenerují, uloží i načtou
2. 512×512 drží 60 FPS při plném oddálení; pokud ne, T46 je odůvodněný a proveden

### Katastrofy

3. Zemětřesení nenastane dvakrát během období hájení
4. Vypnuté katastrofy zůstanou vypnuté i po načtení savu
5. Oheň se zastaví na silnici a hráč jej dokáže zastavit průsekem
6. Podfinancované hasičárny prodlouží dobu hoření měřitelně
7. Riziko nepřírodních katastrof se při hlubokém záporném rozpočtu přestane zvyšovat (R16)
8. Záplava obejde vyvýšený břeh a zaplaví nížinu
9. Trosky blokují stavbu, sráží cenu půdy a jdou zbourat
10. Válka gangů se neprojeví zničením, ale trvalým zhoršením čtvrti
11. Blackout vyřadí pokrytí služeb a tím zvýší riziko ostatních katastrof
12. Epidemie vyhasne v buňkách s `coverage[health]` nad prahem a roste pod ním
13. Neřešená stávka občas přeroste v nepokoje
14. Lesní požár dá hráči čas zareagovat, než dorazí k zástavbě
15. Chemická havárie vyřadí vodárnu a budovy začnou chátrat i po skončení úniku

### MHD a finance

16. Linka s podkapacitou dopravě prakticky nepomůže; přidání vozidel účinek zvedne
17. Tramvajová linka měřitelně sníží kapacitu silnic, po kterých vede, a nejezdí při blackoutu
18. Zvýšení jízdného zvedne příjem jen do určité meze, pak jej sníží
19. Emise s nízkým úrokem v nespokojeném městě se upíše jen zčásti a poplatek propadne
20. Nesplacená jistina sníží rating a zablokuje další emisi

### Průřezově

21. Save v6 uloží probíhající požár a po načtení hoří dál
22. Determinismus po 5000 tikách včetně katastrof a linek
23. Golden testy prochází
24. Žádná konstanta balancu v kódu — včetně všech parametrů z katalogu
25. Žádný uživatelsky viditelný text mimo locale soubory

---

## 12. Co do fáze 4 nepatří

- Distribuce, platformy, Electron, Steam, GOG → fáze 5
- Mody, content registry pro externí zdroje, perzistence savů, lokalizace → fáze 5
- Sprity a grafika ve světě — zůstáváme u procedurálních kvádrů (rozhodnutí
  autora). ~~Platí i pro rozhraní~~ — po T60 už ne: tlačítka nesou kreslené
  ikony z obsahu, mapa dál kvádry.
- Zvuk a hudba — nebudou (rozhodnutí autora)
- Tutoriál a scénáře — až po odladění hry (rozhodnutí autora)
- Obrazovka nastavení — zatím ne (rozhodnutí autora)
- Skutečná vozidla MHD jezdící po mapě — zůstává abstrakce
- Tvrdý bankrot — zůstává měkký
- Meteorit, monstrum, osamělý střelec, terorismus (rozhodnutí autora)
- Řetězení výbuchů u průmyslové havárie (rozhodnutí autora)
