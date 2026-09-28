# Animace

Zadání pro **pohyb na mapě**. Autor ho schválil 2026-09-28 v sedmi bodech:
čtyři vrstvy z mého návrhu a tři vlastní přání (služby, les, pohromy).

## Tři pravidla, která platí pro všechno

1. **Animace jsou jen kosmetika.** Bydlí v `src/render/`, simulace o nich neví
   a nic se jich neptá. Kreslí to, co se ve světě už stalo, nebo co se v něm
   *mohlo* stát: auto, které vyjede z policejní stanice, simulace nezná.
2. **Nikdy `world.rng`.** Jediné vytažené číslo by posunulo celý další
   průběh hry a save by po načtení běžel jinak. Render má vlastní generátor
   (`motionRandom` v `effects.ts`), a kde má výsledek vyjít pokaždé stejně
   (houpání konkrétního stromu), bere se ze souřadnic jako u `decorPick`.
3. **Chybějící animace hru nezastaví** (P5). Efekt bez obrázku se nekreslí,
   budova bez emitoru stojí jako dřív.

Společné pro všechny vrstvy:

- Přepínač **„Zastavit animace“** v liště, na telefonu ve vysunuté řadě.
  Výchozí stav ctí `prefers-reduced-motion`.
- Všechno se hýbe **jen ve výřezu obrazovky** a má strop počtu. Pod určitým
  zoomem se drobnosti (auta, lidé, houpání) vypínají úplně, protože by
  z nich byl jen šum o velikosti pixelu.
- Na pauze stojí to, co patří k městu (auta, lidé, tornádo). Houpání stromů,
  voda a plameny se hýbou dál: pauza zastavuje čas města, ne vítr.
- Rychlost 3× zrychlí dopravu, ne houpání stromů.
- Žádné nové závislosti. Pixi má ticker i `ParticleContainer` sám.

## Vrstva 1 — odezva na akce (T114, hotovo)

Procedurální, bez obrázků. Kód je v `src/render/effects.ts`.

- **Budova vyrůstá.** Nová nebo povýšená budova vyroste od paty za 420 ms
  s malým překmitem (`popScale`). Týká se i domů ze zón: město je vidět růst.
  Po načtení savu nevyrůstá nic. Zchátrání se nepočítá, protože ruina
  nevyrůstá.
- **Prach při bourání.** Zbouraná, vyhořelá nebo nahrazená budova zvedne
  obláček nad svým půdorysem. Silnice a les pod buldozerem dají menší
  obláček. Strop je 240 obláčků naráz, jedna textura, jedna kreslicí dávka.
- **Duch umísťování dýchá** mezi 0,45 a 0,75 průhlednosti.
- Bublina s cenou už animovaná byla (`ui/costPopup.ts`), zůstala.

Kde je to napojené: `BuildingRenderer` si drží `definice#úroveň` každé
budovy, a když se změní, spustí vyrůstání. Překreslení uprostřed animace,
třeba když nová budova v dalším tiku dostane proud, ji do plné velikosti
nevrátí (`resumeGrowth`).

## Vrstva 2 — emitory na budovách (T116)

Budova zůstává statický obrázek. Obsah k ní přidá **body, ze kterých něco
vychází**:

```json
"effects": [
  { "type": "vanilla:smoke", "at": [0.62, 0.18], "when": "working" },
  { "type": "vanilla:blink", "at": [0.50, 0.05], "color": "#ff3030" },
  { "type": "vanilla:spin",  "at": [0.40, 0.10], "sprite": "turbine_blades" }
]
```

- `at` je poloha v obrázku (0–1 od levého horního rohu), takže sedí na komín
  u všech tří variant jen tehdy, když ji má každá varianta vlastní. Pole proto
  patří **k variantě v `sprites/index.json`**, ne k definici budovy.
- `when`: `always`, `powered`, `working` (má proud i zaměstnance). Stav se
  bere z entity, ne ze simulace navíc.
- Druhy: kouř (částice), blikání, rotace samostatného spritu, pára z chladicí
  věže. Mod přidá body i přepíše celý seznam přes `ContentSource`.
- Neznámý `type` se přeskočí s varováním v konzoli, hra běží.

Body na komíny se musí **naklikat**, z obrázku se odhadnout nedají. Nástroj:
v ladicím režimu klik na budovu vypíše `at` pod kurzorem.

## Vrstva 3 — auta na silnicích (T115)

Simulace auta nezná, zná **zátěž dlaždice** (`traffic`). Render si z ní
vyrobí falešná auta:

- Na viditelných silnicích se udržuje počet aut úměrný zátěži. Ucpaná ulice
  je pak vidět bez overlaye a overlay a auta si neodporují.
- Auto jede po síti silnic, na křižovatce zatočí podle vlastního generátoru,
  na dálnici jede rychleji. Když vyjede z výřezu, vrátí se do zásoby.
- Jeden `ParticleContainer`, 4–6 malých spritů aut (obrázky podle
  `docs/06-SPRITY-SLUZEB.md`, bez nich barevný kvádr) ve čtyřech směrech.
- Hloubka stejně jako `DisasterScenes`: vrstva nad vozovkou a pod domy. Dům
  vepředu auto zakryje, dům vzadu do silnice nezasahuje.
- Strop: 400 aut ve výřezu, pod zoomem 0,5 žádná.

**Měří se** FPS na mapě 512 × 512 (akceptační kritérium 2 fáze 4) se
zapnutými a vypnutými auty. Vrstva projde, když pokles nepřekročí 3 FPS.

## Vrstva 4 — voda (T117)

Voda je upečená v chunku a pečení se kvůli ní rozbíjet nebude. Nad vodními
dlaždicemi ve výřezu se kreslí **odlesky**: pár světlých čárek na dlaždici,
které pomalu mizí a objevují se jinde. Stejný `ParticleContainer` jako prach.

Posun textury vody (vytáhnout vodu z pečení a hýbat maticí) je druhá možnost.
Zkusí se jen tehdy, když odlesky nebudou stačit.

## 5 — život u budov služeb (T118)

Přání autora: *u policejní stanice odjede auto, u metra prochází lidé, na
zastávkách chvíli sedí, chvíli ne.*

Nejde o částice, jsou to **malí herci se skriptem**. Popisuje je obsah
u definice služby:

```json
"life": [
  { "actor": "vanilla:police_car", "script": "patrol", "every": [20, 60] },
  { "actor": "vanilla:pedestrian", "script": "commute", "busy": "riders" }
]
```

- `patrol`: auto vyjede z budovy na přilehlou silnici, projede pár dlaždic
  po síti a zmizí za rohem, nebo se vrátí. Hasiči mají totéž se sirénou
  (blikání modré), **a když ve městě hoří, jedou k požáru** — to je jediný
  herec, který čte polohu pohromy, a je to pořád jen čtení.
- `commute`: chodci přicházejí k vchodu a mizí v něm. Počet se řídí
  vytížením (`busy`): u metra podle počtu cestujících linky, jinak podle
  toho, jestli služba pracuje.
- `wait`: na zastávce sedí 0–N lidí. Počet se **pomalu blíží** k hodnotě
  z vytížení linky a sem tam někdo odejde nebo přijde. Kdy spoj přijede,
  simulace **neví**: zná jen počet vozů a cestujících linky (`LineStats`),
  ne jejich polohu. Příjezd je proto taky kosmetika. Interval se odvodí
  z počtu vozů a délky linky, po příjezdu se zastávka vyprázdní a začne se
  plnit znovu. Autobus, který projede ulicí, je pak jen jeden herec navíc.
- Chodci a auta služeb jsou součástí stropu z vrstvy 3.

Herci potřebují obrázky: policejní auto, hasičský vůz, sanitka, 2–3 chodci
a sedící člověk. Zadání přibude do `docs/06-SPRITY-SLUZEB.md`. Bez obrázků
se nekreslí nic, kvádr by tady lhal víc, než pomohl.

## 6 — les ve větru (T119)

Stromy jsou samostatné sprity (`BuildingRenderer`, záporná id), takže se
dají houpat **bez nových obrázků**:

- Houpání je zkosení (`skew.x`) kolem paty stromu, pár stupňů.
- Hýbe se jen **tu a tam**: přes mapu jde pomalá vlna větru (fáze podle
  polohy ve směru větru) a amplitudu tlumí nízkofrekvenční šum. Vždycky se
  hýbe jen pár skupin stromů, zbytek stojí. Právě to autor chtěl, celý les
  vlnící se v rytmu by působil jako porucha.
- Fáze každého stromu jde ze souřadnic (`decorPick`), ne z generátoru, takže
  po posunu kamery nezačne strom „odjinud“.
- Aktualizuje se jen výřez, pod zoomem 0,6 se nehýbe nic. Les na velké mapě
  má tisíce stromů a houpat ty mimo obrazovku je čistá ztráta.
- Balvany se nehoupou. Druh předmětu to pozná z manifestu (`sway: true`).

**Měří se** čas snímku s lesem přes celou obrazovku, s houpáním a bez něj.

## 7 — pohromy vizuálněji (T120)

Dnes má požár oranžový nádech dlaždice upečený v chunku a **jeden statický
obrázek** plamenů na místě pohromy. Tornádo je jeden obrázek, který jednou
za tik (sekundu při 1×) skočí o kus dál.

**Požár**

- Plamen na **každé hořící dlaždici**, ne jeden na pohromu. Vrstva `fire`
  už intenzitu na dlaždici nese. Velikost a hustota plamenů rostou
  s intenzitou, stejně jako dnešní barva.
- Plameny kmitají (měřítko a průhlednost, fáze ze souřadnic) a nad nimi
  stoupá **sloup kouře** z částic. Kouř je vidět zdálky, takže hráč požár
  najde, i když je zrovna jinde.
- Jiskry přeskakující na sousední dlaždici by lhaly: kam se oheň šíří,
  rozhoduje simulace. Kreslí se jen to, co hoří.
- Dohořelá dlaždice krátce doutná (slabý kouř) a pak je z ní suť, jak je.

**Tornádo**

- Poloha se mezi tiky **plynule dopočítává** z minulé a současné polohy
  v `active.state`. Tornádo pak jede, neskáče.
- Nálevka se točí a kolébá (zkosení a malý posun), u země víří **trosky**
  (částice obíhající kolem paty) a za ní zůstává pruh prachu.
- Síla (`strengthAt`) řídí velikost víru: tornádo se rozjíždí a slábne
  i na obrazovce, nejen v číslech.

Ostatní pohromy (výbuch, chemický únik, sesuv) dostanou totéž levněji:
kouř nebo prach z částic nad místem. Dav u nepokojů se může mírně vlnit.

## Pořadí

| Úkol | Co | Obrázky navíc |
|---|---|---|
| T114 | odezva na akce | žádné — **hotovo** |
| T115 | auta na silnicích | 4–6 aut |
| T116 | emitory na budovách | lopatky větrníku; body `at` naklikat |
| T117 | odlesky na vodě | žádné |
| T118 | život u služeb | auta služeb, chodci |
| T119 | les ve větru | žádné |
| T120 | požár a tornádo | plamen, případně oblak kouře |

T119 a T120 jdou bez obrázků, takže se dají vzít hned po T115. Obrázky pro
T115 a T118 se generují jednou dávkou.
