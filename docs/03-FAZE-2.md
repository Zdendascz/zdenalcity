# Fáze 2 — zadání

**Verze dokumentu:** 1.0
**Vstupní podmínka:** `docs/01-ARCHITEKTURA.md` (pravidla P1–P7) a `docs/PROGRESS.md`.

Fáze 1 skončila hratelnou smyčkou, ve které je ale **každá parcela zaměnitelná**. Fáze 2 to mění: zavádí prostorovou kvalitu místa, služby, úrovně budov a úpadek.

Rozsah je **2a**. Doprava a převýšení terénu jsou fáze 3 (rozhodnuto autorem), MHD s nimi.

---

## 1. Rozhodnutí ke schválení

Pět věcí, které vyplývají ze zadání, ale nebyly v něm přímo. Než se začne psát T11, autor je má potvrdit nebo změnit.

### R1 — O sloučení rozhoduje úroveň souseda, ne cena půdy jeho dlaždice

Zadání říká „vedlejší pole je levnější (nižší budova)". Cena půdy je ale na hrubé mřížce 32×32, takže sousední dlaždice mají skoro vždy stejnou hodnotu a pravidlo by nerozhodovalo. Rozhoduje proto **úroveň sousední budovy**: soused s nižší úrovní (nebo prázdná zónovaná dlaždice) je pohltitelný.

### R2 — Cenu půdy nezvyšuje zástavba, jen služby, parky a čistota

Bez toho vzniká utržená smyčka: vyšší úroveň → hustší zástavba → vyšší cena půdy → vyšší úroveň. Odsouhlaseno autorem u otázky 1, zapsáno sem, protože je to nejdůležitější stabilizační pravidlo celé fáze.

### R3 — Kriminalita se neodvozuje od ceny půdy

Podobný důvod. Kdyby nízká cena půdy plodila kriminalitu a kriminalita srážela cenu půdy, každá čtvrť, která jednou klesne, už se nikdy nezvedne. Zdrojem kriminality je hustota populace, nezaměstnanost a opuštěné budovy; tlumí ji policie.

### R4 — `disasterRisk` se v 2a nepočítá

Zadání říká, že služby snižují pravděpodobnost katastrofy. Katastrofy ale v 2a nejsou, takže by šlo o kód do zásoby, který pravidla projektu zakazují. Služby proto mají v 2a dva efektové kanály (cena půdy, poptávka) plus efekty specifické pro třídu. Třetí kanál se dopíše s katastrofami.

### R5 — Definice se hledá podle trojice (kategorie, půdorys, úroveň)

Katalog nemusí obsahovat všechny kombinace. Chybějící kombinace prostě znamená, že daná cesta růstu není dostupná — ne chybu. Vanilla obsah 2a nese sedm definic na kategorii, zbytek je pozdější obsah bez zásahu do kódu.

---

## 2. Nová datová vrstva

### Hrubá mřížka

Difuzní vrstvy jsou na **32×32**, tedy jedna buňka na 4×4 dlaždice. Odchylka od architektury §4, schválená autorem.

```ts
export const COARSE_FACTOR = 4;
export const COARSE_SIZE = MAP_SIZE / COARSE_FACTOR;   // 32

export function coarseIndex(x: number, y: number): number {
  return ((y / COARSE_FACTOR) | 0) * COARSE_SIZE + ((x / COARSE_FACTOR) | 0);
}
```

| Vrstva | Typ | Velikost | Ukládá se |
|---|---|---|---|
| `pollution` | Uint8Array | 32×32 | ano |
| `landValue` | Uint8Array | 32×32 | ano |
| `crime` | Uint8Array | 32×32 | ano |
| `coverage[class]` | Uint8Array | 32×32 | **ne** — odvozené, po loadu se přepočítá |

Pokrytí službami se neukládá, protože se dá spočítat z rozmístění budov a financování. Save tím zůstane malý a nemůže se rozejít se skutečností.

### Entita Building — nová pole

```ts
interface Building {
  // ...stávající
  abandoned: boolean;
  levelChangedAtTick: number;   // cooldown proti blikání úrovní
}
```

---

## 3. Difuze — algoritmus

„Difuze" není algoritmus, tak přesně:

```ts
function diffuse(
  current: Uint8Array,
  sources: Float32Array,
  spread: number,     // 0.40
  decay: number,      // 0.94
  passes: number,     // 2
): void
```

Jeden běh systému:

1. **Vynuluj zdrojový buffer** a nasyp do něj zdroje — každá znečišťující budova přičte svou hodnotu do buňky, ve které leží její přední roh.
2. **Proveď `passes` průchodů.** Pro každou buňku:

```
sousedé = součet 8 sousedů z předchozího průchodu
nová = zdroj + předchozí * (1 - spread) + sousedé * spread / 8
nová *= decay
```

3. **Ořízni na 0–255** a zapiš zpět.

**Okraj mapy pohlcuje** — buňka mimo mřížku se počítá jako 0. Znečištění tedy u kraje mizí, nehromadí se.

Konstanty `spread`, `decay` a `passes` jsou v `balance.json`, ne v kódu.

**Proč to konverguje:** `decay < 1` znamená, že bez zdroje hodnota exponenciálně klesá; se stálým zdrojem se ustálí na `zdroj / (1 - decay)`. Při `decay = 0.94` je to zhruba 16,7násobek zdroje — podle toho se volí hodnoty `pollution` v definicích, aby se vešly pod 255.

---

## 4. Cena půdy — vzorec

Běží každých 16 tiků (offset 5), na hrubé mřížce.

```
surová = ZÁKLAD
       + Σ_třída  coverage[třída][c] * váha[třída]
       + bonusVody[c]
       - pollution[c] * VÁHA_ZNEČIŠTĚNÍ
       - crime[c]     * VÁHA_KRIMINALITY

landValue[c] = clamp(lerp(landValue[c], surová, VYHLAZENÍ), 0, 255)
```

`VYHLAZENÍ` kolem 0,25 — cena půdy se mění postupně, ne skokem. Bez toho by hráč postavil park a celá čtvrť by okamžitě přeskočila o dvě úrovně.

`bonusVody` je předpočítaný při vzniku mapy: buňky sousedící s vodou dostanou bonus. Je to jediný vstup, který nezávisí na hráči, a existuje proto, aby mapa nebyla homogenní ještě než hráč cokoli postaví.

**Zástavba do vzorce nevstupuje** (R2).

---

## 5. Kriminalita — vzorec

Běží každých 16 tiků (offset 11), aby nespadla do stejného snímku jako cena půdy.

```
surová = hustotaPopulace[c]  * VÁHA_POPULACE
       + nezaměstnanost      * VÁHA_NEZAMĚSTNANOSTI   // celoměstský podíl
       + opuštěné[c]         * VÁHA_OPUŠTĚNÝCH
       - coverage[police][c] * VÁHA_POLICIE

crime[c] = clamp(lerp(crime[c], surová, VYHLAZENÍ), 0, 255)
```

`hustotaPopulace` se počítá při stejném průchodu z budov v buňce — nová vrstva pro ni nevzniká.

`nezaměstnanost = clamp((pracující − místa) / pracující, 0, 1)`, celoměstsky. Je to jediný neprostorový vstup a je tam schválně: město s masovou nezaměstnaností má problém všude, ne jen v jedné čtvrti.

---

## 6. Služby

### Model

Třída služby = **radius × financování × efekt**. Mechanismus je obecný, konkrétní třídy jsou obsah.

```json
{
  "id": "vanilla:police_small",
  "category": "service",
  "service": {
    "class": "police",
    "radius": 12,
    "strength": 60
  },
  "construction": { "cost": 500, "requiresRoad": true },
  "economy": { "upkeep": 100 }
}
```

### Pokrytí

Přepočítává se **jen při změně** (postavena/zbourána služba, změněné financování), ne každý tik. Vlajka `coverageDirty` po vzoru `powerNetworkDirty`.

```
r = radius * financování
síla = strength * financování

pro každou buňku c ve vzdálenosti d ≤ r od budovy:
    coverage[třída][c] += síla * (1 - d / r)
```

Vzdálenost je euklidovská v souřadnicích hrubé mřížky. Příspěvky se sčítají a ořezávají na 255 — dvě stanice vedle sebe jsou lepší než jedna, ale se snižujícím se přínosem.

### Financování

Posuvník **na třídu**, 0–100 %. Ovlivňuje současně radius, sílu i údržbu:

```
skutečnáÚdržba = upkeep * financování
```

Podfinancovaná služba tedy **zmenšuje dosah**, což je na overlayi okamžitě vidět. To je celý smysl — hráč musí vidět, na čem šetří.

### Třídy v 2a

| Třída | Budovy | Efekt |
|---|---|---|
| `police` | stanice malá/velká, věznice | −kriminalita; **věznice sráží cenu půdy ve svém okolí** |
| `fire` | zbrojnice malá/velká | +cena půdy (kanál rizika až s katastrofami, R4) |
| `health` | klinika, nemocnice | +cena půdy; bez pokrytí populace v budovách pomalu klesá |
| `education` | základní, střední, vysoká | +cena půdy; **prerekvizita vyšších úrovní C a I** |
| `parks` | park malý/velký | +cena půdy, nic jiného; levné |
| `waste` | skládka, spalovna | viz níže |

**Odpady** nemají vlastní pokrytí. Populace generuje odpad, skládky a spalovny mají kapacitu; nepokrytý zbytek přičítá znečištění **celoměstsky** do každého zdrojového bufferu. Skládka je levná a sama silně znečišťuje své okolí, spalovna je drahá a znečišťuje méně — čistý prostorový kompromis bez nové vrstvy.

**Vzdělání jako brána** je nejzajímavější vazba fáze 2: investice, která se vrátí až za desítky měsíců. Prerekvizita se zapisuje do definice (viz §7), ne do kódu.

### Třídy odložené do fáze 3

Kultura, sociální sounáležitost, voda a kanalizace, MHD. Voda je klon elektřiny (druhá síťová vrstva), zbytek je čistý obsah nad hotovým mechanismem.

---

## 7. Prerekvizity

Koncept vzniká v 2a, hodnoty se nenastavují (rozhodnutí autora).

```json
{
  "requirements": {
    "services": { "education": 40 },
    "buildings": ["vanilla:police_small"]
  }
}
```

`services` = minimální pokrytí dané třídy v buňce budovy. `buildings` = definice, která musí ve městě existovat.

Vanilla definice 2a mají `requirements` **prázdné**. Validátor tvar kontroluje, růst i ruční stavba podmínku vyhodnocují — takže až se hodnoty doplní, je to změna JSONu.

---

## 8. Úrovně budov a slučování

### Model

Úroveň 1–5. Půdorys 1×1 až 5×5, obdélníkový. Obojí je vlastnost **definice**, ne entity — entita nese jen `level` a `definitionId`.

Vyhledávání definice: `(kategorie, šířka × hloubka, úroveň)`. Chybějící kombinace = cesta nedostupná (R5).

### Povýšení

Podmínky, všechny současně:

```
landValue[buňka] >= PRÁH_ÚROVNĚ[L + 1]
poptávka[kategorie] > 0
tick - levelChangedAtTick >= COOLDOWN_ÚROVNĚ
prerekvizity kandidátní definice splněny
```

Výběr cesty — **šířka má přednost před výškou** (zadání autora):

1. **Rozšíření.** Prohledej směry v pevném pořadí `+x, +y, −x, −y`. Směr je použitelný, pokud jsou všechny nově zabírané dlaždice: ve stejné zóně, na povoleném terénu, a buď prázdné, nebo obsazené budovou **stejné kategorie s nižší úrovní** (R1). Existuje-li definice pro nový půdorys a **stávající** úroveň, rozšiř.
2. **Vyrostení.** Jinak, existuje-li definice pro stávající půdorys a úroveň `L + 1`, zvyš úroveň.
3. Jinak se neděje nic.

Pohlcené budovy se odstraní. Populace a pracovní místa se nesčítají — určuje je nová definice.

Pořadí směrů je pevné kvůli P2. Kde je potřeba rozhodnout mezi rovnocennými možnostmi, rozhoduje `world.rng`, nikdy pořadí iterace nad `Map`.

### Snížení

```
landValue[buňka] < PRÁH_ÚROVNĚ[L] - HYSTEREZE
```

po `SNÍŽENÍ_POTVRZENÍ` po sobě jdoucích vyhodnoceních. Hystereze i potvrzení existují proto, aby budovy nekmitaly na hranici prahu.

Snížení hledá definici pro `L - 1` se **stejným půdorysem**; když neexistuje, zmenší půdorys a uvolněné dlaždice vrátí jako prázdné zónované.

Pod úrovní 1 nastává opuštění.

### Chátrání

Chátrá se **okolím** (znečištění, kriminalita, chybějící zdravotnictví, výpadek proudu) — to je obsaženo v ceně půdy a tedy ve snížení úrovně.

Navíc **věkem, ale jen při podfinancování** (zadání autora): budova starší než `VĚK_CHÁTRÁNÍ` tiků, která leží v buňce s pokrytím pod prahem, dostává penalizaci k efektivní ceně půdy. Plně obsloužená budova nechátrá nikdy.

### Opuštěná budova

Stojí. Nedaní, nestojí údržbu, nemá populaci ani pracovní místa. Přispívá do kriminality a sráží cenu půdy v okolí. **Hráč ji musí zbourat** — sama nezmizí.

Vizuálně: šedý kvádr snížený na jednu úroveň.

---

## 9. Přepis růstu

Dnešní stav podle `PROGRESS.md`: rovnoměrný los z volných zónovaných dlaždic, poptávka jako vypínač, silnice jako přímé sousedství. Všechny tři se mění.

### Skóre parcely

```
skóre = landValue[buňka] ^ EXPONENT
      * faktorSilnice
      * faktorDaně
```

`faktorSilnice` podle dosahu, ne sousedství:

| Vzdálenost k silnici | Faktor |
|---|---|
| sousedí | 1,0 |
| 2 dlaždice | 0,6 |
| 3 dlaždice | 0,3 |
| dál | **0** |

Nula znamená, že parcela z losu **vypadne úplně**. Tím se řeší slabina z `PROGRESS.md`, kde nedosažitelné dlaždice ředily los a zpomalovaly růst i tam, kde stavět šlo.

`faktorDaně = clamp(1 - (sazba - NEUTRÁLNÍ_SAZBA) / ROZSAH, 0.2, 1.5)` — první skutečná vazba daní na růst.

Výběr parcely je **vážený los** podle skóre.

### Poptávka jako rychlost

```
pokusů = clamp(round(poptávka / POPTÁVKA_NA_POKUS), 0, MAX_POKUSŮ)
```

Místo dnešního „poptávka > 0 → 4 pokusy po 40 %". Poptávka 5 a 50 se teď liší.

---

## 10. Balanc jako obsah

Všechny konstanty této fáze žijí v `content/vanilla/balance.json`, ne v kódu:

```json
{
  "diffusion": { "spread": 0.40, "decay": 0.94, "passes": 2 },
  "landValue": {
    "base": 40, "smoothing": 0.25,
    "waterBonus": 25,
    "weights": { "pollution": 0.8, "crime": 0.7,
                 "police": 0.2, "fire": 0.2, "health": 0.3,
                 "education": 0.4, "parks": 0.5 }
  },
  "crime": { "smoothing": 0.25, "population": 0.6, "unemployment": 40,
             "abandoned": 30, "police": 0.9 },
  "levels": {
    "thresholds": [0, 0, 90, 130, 170, 210],
    "hysteresis": 15, "cooldown": 60, "downgradeConfirm": 3,
    "decayAge": 3600, "decayCoverageThreshold": 20
  },
  "growth": { "exponent": 1.5, "demandPerAttempt": 8, "maxAttempts": 12,
              "neutralTaxRate": 7, "taxRange": 20 }
}
```

Načítá se stejnou cestou jako definice budov (P5), takže mod smí balanc přepsat. Schéma ho validuje; chybějící sekce je chyba, ne tichý default.

---

## 11. Save verze 2

Poslední úkol fáze, po němž se formát zamkne.

**Změny:** tři nové vrstvy na hrubé mřížce, dvě nová pole entity, financování tříd ve stavu.

**Kontejner** musí u vrstvy nést i rozměr — `layers.bin` má dnes implicitní `MAP_SIZE * MAP_SIZE`, což s hrubou mřížkou přestává platit. Do `meta.json` přibude:

```json
"grid": { "size": 128, "coarseSize": 32 }
```

**Migrace v1 → v2:** nové vrstvy se vynulují, `abandoned = false`, `levelChangedAtTick = 0`, financování všech tříd 100 % (rozhodnutí autora — žádné ostré savy neexistují). Po načtení se jednou vynutí přepočet pokrytí a difuze, aby město nezačínalo s nulovou cenou půdy.

**Fixtura** `v2.city.base64` vzniká vedle stávající `v1.city.base64`. Test prochází obě.

Během T11–T18 bude rychlý save nové stavy zahazovat. Je to přijaté — persistence je stejně jen v paměti a ostrá data neexistují.

---

## 12. Úkoly

| Úkol | Obsah | Závisí na |
|---|---|---|
| **T11** | Hrubá mřížka, difuzní jádro, znečištění, zdroje z budov a odpadů, overlay | — |
| **T12** | Cena půdy, bonus vody, vyhlazení, overlay | T11 |
| **T13** | Obecný mechanismus služeb + třída `police`, kriminalita, pokrytí, `coverageDirty`, overlay | T12 |
| **T14** | Zbývající třídy (fire, health, education, parks, waste), financování, zapojení do rozpočtu | T13 |
| **T15** | `balance.json` — přesun všech konstant fáze 2 do obsahu, schéma, validace | T14 |
| **T16** | Úrovně 1–5, rozšiřování a slučování, vyhledávání definic, vanilla sada | T12, T15 |
| **T17** | Snížení, chátrání, opuštěné budovy, jejich efekty | T16 |
| **T18** | Přepis růstu — skóre parcely, dosah silnice, faktor daně, poptávka jako rychlost | T16 |
| **T19** | Prerekvizity — vyhodnocení v růstu i ruční stavbě, prázdné hodnoty ve vanilla | T14, T16 |
| **T20** | Save v2, migrace, fixtury, `grid` v meta | vše výše |
| **T21** | UI — přepínač overlayů, panel financování, diagnostika parcely | vše výše |

**T21 je stejně důležitý jako simulace.** Fáze 2 přidává pět neviditelných veličin; bez diagnostiky hráč uvidí jen to, že mu město chátrá, a nedozví se proč. Diagnostika parcely (pravé tlačítko → „cena půdy 62, z toho −18 znečištění, −22 kriminalita, +12 park") je jediná věc, která z fáze 2 udělá hru místo tabulky.

---

## 13. Akceptační kritéria fáze 2

Simulační:

1. Továrna vytvoří kolem sebe znečištění, které se vzdáleností klesá a u kraje mapy mizí
2. Obytná zóna u továrny má měřitelně nižší cenu půdy než zóna od ní vzdálená
3. Postavení parku zvedne cenu půdy v dosahu do několika měsíců
4. Snížení financování policie na 30 % zmenší viditelně dosah na overlayi a zvedne kriminalitu
5. Dům ve čtvrti s vysokou cenou půdy vyroste na úroveň 3 a **pohltí sousední domek nižší úrovně**
6. Zhoršení okolí vrátí budovu o úroveň níž a při dalším zhoršení ji opustí
7. Opuštěná budova zůstane stát, nedaní, zvedá kriminalitu a jde zbourat
8. Zóna daleko od silnice se **nezastaví** — parcely mimo dosah z losu vypadnou
9. Zvýšení daně na 18 % měřitelně zpomalí růst
10. Save v2 přežije round-trip, fixtura v1 se načte a dopočítá

Technické:

- 128×128 při rychlosti 8× drží 60 FPS **včetně difuze**
- Determinismus prochází — dva běhy stejného seedu dají identické město i po 5000 tikách
- Golden testy prochází
- Žádný uživatelsky viditelný text mimo locale soubory
- Žádná konstanta balancu v kódu

---

## 14. Co do fáze 2 nepatří

- Doprava a dopravní model (fáze 3, §15 architektury)
- Převýšení terénu (fáze 3, §15)
- MHD, depa, zastávky (fáze 3, součást dopravy)
- Katastrofy a požáry (samostatný úkol; hasiči v 2a mají jen kanál ceny půdy — R4)
- Voda a kanalizace (fáze 3, druhá síťová vrstva)
- Kultura a sociální sounáležitost (fáze 3, čistý obsah nad mechanismem z T13–T14)
- Steam, Electron, mody, sprity
