# Revize hry, 12. 9. 2026

Pět paralelních průzkumů projelo herní smyčku, ovládání, rozhraní, první hodinu
hráče a křehká místa v kódu. Devětatřicet nálezů, všechny opravené; tenhle
dokument říká **proč zrovna takhle** a kde jsem se od návrhu z revize odchýlil.

Zpráva s důkazy v kódu:
<https://claude.ai/code/artifact/7db0f80a-960e-4749-b5f1-dc0608b25a05>

## Balanc

**Spokojenost se přestala zasekávat na stropu.** Základ 120 plus pokrytí s
váhami o součtu 2,6 dávalo v zavedeném městě surovou hodnotu kolem 490 proti
ořezu 255, takže daň 20 % ani ztrojnásobená kriminalita nebyly poznat — a s
nimi zmizel kanál spokojenost → poptávka → růst. Součet vah je teď 0,55,
poměry mezi třídami zůstaly. K tomu má rozpis **vlastní řádek „Ořezáno na
strop"**: sloupec plus vycházel o stovky procent výš než souhrn a jediné
vysvětlení pod tabulkou mluvilo o vyhlazování, které za rozdíl nemohlo.

**Kolony se zvětšují s městem.** Jeden běh dopravy projde nejvýš 96 domů a
vrstva se před ním nulovala, takže město s tisícem domů vyrobilo stejnou zátěž
jako město se stovkou. Zátěž se teď **neruší, jen zeslábne**: zůstává
`1 − vzorek/domy`, takže jeden oběh kurzoru estimát právě jednou vymění a
ustálená hodnota odpovídá celému městu. Ve městě, které se do jednoho vzorku
vejde, vyjde útlum na nulu — tedy přesně na to, co se dělo do teď. Vyřešilo to
zároveň blikání overlaye, na které navrhovaná varianta „vynásob podílem"
nestačila: vzorek jde po id, takže by se jen zesílily fleky kolem právě
vzorkované čtvrti.

**Věznice už nebourá čtvrti na druhém konci mapy.** Obtěžování se zapisuje do
téže mapy pokrytí jako služby, a průměr přes všechny vrstvy tím spadl pod práh
zanedbanosti. Průměruje se teď jen přes třídy s **kladnou** váhou ve
spokojenosti nebo v ceně půdy — data rozhodují, kód ne (P5).

**Plynová elektrárna dostala důvod k existenci.** Údržba 420 → 150, tedy na
1000 výkonu 11,5 proti uhelným 10 a jaderným 12,5. Uhlí zašpiní víc (10 → 14).
K tomu se **znečištění rozprostře po půdorysu**, ne do jedné buňky pod předním
rohem: velikost stavby konečně rozhoduje o rozsahu škody. Celkové množství se
nemění, dělí se podle počtu dlaždic.

**Strop půjčky zná splatnost.** Byl `příjem × 24` bez ohledu na dobu splácení,
takže maximální dvanáctiměsíční půjčka měla splátku přes dvojnásobek měsíčního
příjmu — nešla zaplatit, dluh se nezmenšoval, a protože se od stropu odečítá,
zůstal úvěr navždy zavřený. Nově:

```
strop = příjem × podíl × měsíců / (1 + úrok × roky)
```

`loanPaymentShare` je nový parametr balancu (0,25). Původní násobek příjmu
zůstal jako tvrdý strop na celkový dluh. Hláška o překročení říká i splatnost,
protože bez ní vidí hráč dvě různá čísla pro tutéž půjčku.

Čísla balancu se mají po tomhle **proměřit v simulátoru**. Přeladění vah a
kapacit je kalibrace, ne oprava, a tohle byla revize kódu, ne playtest.

## Co hráč nevěděl

**Granty, rating a dluhopisy jsou vidět.** `awardGrants`, `payLoans` a
`serviceBonds` vracely počty právě k ohlášení a systém je zahazoval, takže za
tisíc obyvatel přiteklo 8 000 bez jediného slova. Vznikla runtime fronta
`world.financeNotices` — jednosměrný kanál ven ze simulace, stejný princip jako
`dirty.tiles`: sim přidává, rozhraní vybírá. Má strop 32 zpráv, aby běh bez
rozhraní nerostl donekonečna. Panel financí k tomu dostal řádek s ratingem,
měsíční bilanci vedle splátky a seznam milníků s postupem.

**Poradce v první hodině mlčel a tvrdil, že je vše v pořádku.** Pod dvacet
obyvatel vracel prázdno a panel to vykládal jako pochvalu. `CityAdvice` má teď
`tooSmall` a odkazuje na téma nápovědy o začátku. Přibyly tři rady: „zóny
nerostou" (postavená na téže překážce, jakou počítá růst), „voda nedoteče"
odděleně od „nestačí kapacita", a odpad s kanalizací zvlášť od znečištění —
naměřený smog a nepokrytý odpad jsou jiné opravy.

**Nápověda posílala na čerpací stanici, která vodu nevyrábí.** Tentýž text si
to o čtyři odstavce dál sám vyvracel. Vodárna je v obou odstavcích a hláška
`ui.notice.zonesWithoutWater`, která ležela v překladu nepoužitá, se zapojila
místo obecného „nic neroste", když je nejčastější překážkou chybějící voda.

**Dosahy služeb z nápovědy zmizely.** Text vznikl den předtím, než se čísla v
datech zdvojnásobila. Odkazuje se na přehled staveb, který se skládá z dat —
a test zakazuje, aby se číslovka následovaná slovem „dlaždic" vrátila do prózy.

## Ovládání

- **Most jde postavit i doleva a nahoru.** Tažení vracelo dlaždice vždy od
  nejmenší souřadnice k největší, takže se při tahu zpět začínalo uprostřed
  vody a hra hlásila „Most musí začínat na břehu" — tedy přesně to, co hráč
  udělal. Pořadí je teď od kotvy k ukazateli.
- **Jedno klepnutí položí jednu dlaždici.** Dlaždice pod ukazatelem se plnila
  až pohybem, takže tah nulové délky nedal žádný příkaz. Myší to fungovalo jen
  proto, že kurzor po mapě jezdí i bez stisku.
- **Tažení je atomické a nelže o ceně.** Napřed se sečte, pak staví: do teď se
  stavělo po dlaždicích do vyčerpání kasy a zbyla půl silnice a nula. Odhad
  vrací nulu za dlaždice, které příkaz odmítne (obsazená, trosky, už je tam
  silnice, most bez břehu). A tah nad 2 000 dostal nabídku „Zpět", kterou
  jediná budova za tutéž cenu měla, a nejdražší gesto ve hře ne.
- **Míří se nad prst u všeho, co koná jedním klepnutím**, ne jen u budov.
  Buldozer, zvedání rohu, srovnání i les zabíraly v okamžiku doteku na
  dlaždici, kterou prst kryje. Dlouhý stisk se u nich nezakládá — akce se
  provedla a pak se ještě otevřela karta té už zbourané parcely.
- **Tažení přežije přejezd lišty.** Panely mají zapnutý příjem kliknutí, takže
  plátno dostalo „ukazatel odešel" a tah se zahodil bez hlášky i bez výsledku.
  Zachycení ukazatele se zapíná i u kreslení a `pointerleave` ruší tah, jen
  když zachycení neplatí.
- **Kamera má meze a vede z nich cesta zpátky.** Posun neměl žádné omezení,
  takže šlo odjet do prázdna a hra neměla jediný prvek, kterým se vrátit.
  Přibylo tlačítko „Na město" (míří na těžiště obydlených budov) a
  `clampCamera` se volá jednou za snímek — kamerou hýbe tažení, gesto dvěma
  prsty, šipky i zoom k bodu a jedno místo se nedá obejít zapomenutím.
- **Prodloužení už vyznačené zóny není chyba.** „Nic nového, ale nic nebrání"
  je teď tichý úspěch, ne hláška „Zóna se sem vyznačit nedá".
- **Klávesnice.** Šipky a mezerník se zpracovaly dřív, než se zjistilo, kde je
  fokus, takže se výše půjčky nedala naťukat. Fokus se odebírá jen při
  **skutečném** kliknutí (`event.detail > 0`), takže Enter už neposílá kurzor
  na začátek dokumentu. Rozhraní dostalo viditelný obrys fokusu; Escape zavírá
  nejdřív modální okno a roční uzávěrka zaostří „Zavřít".

## Rozhraní

- **Ekonomický přehled ukazuje město, ne katalog.** Ze 72 řádků bylo 69 nul.
  Vypisují se jen postavené druhy, 39 zónových variant se slévá do tří součtů
  (hráč je nestaví ani nevybírá) a pod tabulkou je řádek „nepostaveno: N".
  Záhlaví panelu i hlavička tabulky se lepí nahoře — na telefonu tím hráč
  přicházel o jedinou cestu ven.
- **Zbytek dluhu má vlastní řádek**, ne buňku pod hlavičkou „Pod proudem".
- **`--muted` neexistovala**, takže sedm tlumených textů svítilo naplno.
  Nahrazeno `--text-dim` a hlídá to test proti definovaným proměnným.
- **Křížky panelů mají jméno.** Záhlaví se vytáhlo do `sheetHeader()`, sedm
  volajících se zkrátilo na řádek a rozejít se to už nemůže.
- **Čísla jdou za jazykem.** `formatNumber` mělo `cs-CZ` natvrdo, takže
  anglicky hrající hráč viděl 1 234 567 v každém čísle. Značka je v překladu
  (`ui.locale.tag`), `I18n` ji předává při každé změně jazyka. Jazyky se
  jmenují ve svém vlastním jazyce a přepínají se i na rozcestníku.
- **„Proud" a „Pod proudem"** se přejmenovaly na „Napojené budovy" a
  „Elektřina (MW)"; anglicky se sjednotilo osm map dosahu na *reach*.
- **Sloupečky O/K/P se dají rozkliknout** a bublina začíná plným jménem zóny.
- **Trojtečka převezme ikonu a stav** nástroje vybraného ze schované řady.
  Hráč vybral elektrárnu, řada se zavřela, v liště nesvítilo nic — a klepl do
  mapy v domnění, že drží pacičku.
- **Dialog nové hry říká, co která volba udělá**, a nevypisuje milisekundy
  generátoru.

## Uložené město

- **Ukládá se i během hry**, ne jen při zavření karty. Komentář to tvrdil,
  větev v kódu nebyla. Interval dvě minuty; ověření savu se u periodického
  ukládání většinou přeskakuje (je to druhý round-trip přes celé město), ale
  každé páté se ověří celé — rozpor mezí uměl hráč vyrobit posuvníkem
  financování a přesně kvůli tomu ověřování vzniklo. V panelu uložení je řádek
  „uloženo samo před X min".
- **Načtené město si nese svoje jméno**, datum vzniku i odehraný čas. Načtený
  Zlín se od té chvíle ukládal jako „Brno" a původní jméno bylo nevratně pryč.
- **Katastrofy se po načtení zase ohlašují.** Množina ohlášených id žila po
  celou dobu běhu, kdežto čítač se bral ze savu, takže se id vrátila do
  minulosti a nové pohromy vypadaly jako už ohlášené — město hořelo potichu.
  Řeší to `resetRuntimeNotices()`, jedno místo pro všechen běhový stav hlášení:
  volá ho načtení i start, takže se to u příštího počítadla nestane znovu.
- **Nové město už mlčky nepřepíše to rozehrané.** Tlačítko „Pokračovat" píše
  jméno a dobu hraní, pod „Nové město" stojí varování a odkaz, kterým si hráč
  rozehrané město stáhne.
- **Stahování souboru se umí povést.** Adresa objektu se uvolňovala synchronně
  hned za kliknutím na odkaz, který navíc nebyl v dokumentu; prohlížeč, který
  si blob nevyzvedl ve stejném kroku, stahování tiše zrušil. Odkaz se vkládá do
  dokumentu a adresa se uvolní po minutě.

## Křehká místa

- **Snímek pro „Zpět" se nekomprimuje.** Byl to plný save s deflate na devítce
  při každém kliknutí buldozerem — na mapě 512 × 512 pět megabajtů synchronně
  v obsluze stisku. `serializeSave` bere stupeň komprese; snímek nikdy nejde
  na disk, takže mačkat nemá proč. (Byla to moje vlastní včerejší chyba.)
- **Uvolnění zachycení ukazatele je ošetřené**, takže mapa nezůstane přilepená
  ke kurzoru s hláškou „chyba v běhu hry".
- **Opakovač lupy visí na instanci**, ne v uzávěru tlačítka. Řada s lupou se
  při přestavbě lišty vysype — a ta přijde i při otočení displeje, takže se
  mapa přibližovala dál, dokud nenarazila na strop.
- **Rozcestník po sobě uklidí.** Galerie si zakládala vlastní časovač a úklid
  zhasínal jen ten v hlavičce, takže prohlížeč držel celý rozcestník včetně
  velkých obrázků po celou hru. Všechno mimo vlastní strom visí na jednom
  `AbortController`.

## Kde jsem se od návrhu odchýlil

- **Kolony.** Revize navrhovala vynásobit váhu podílem `domy / vzorek` a pak
  přeladit kapacity. Vzorek jde po id, tedy po pořadí stavby, takže by se jen
  zesílily blikající fleky kolem právě vzorkované čtvrti. Útlum místo nulování
  dá ustálenou hodnotu za celé město, u malého města nemění vůbec nic a
  kapacity přeladit nepotřebuje.
- **Zónové varianty v rozpočtu** se slévají do tří řádků. Jednotlivé stupně
  hráč nestaví ani nevybírá — vyrostou samy podle ceny půdy — takže mu
  neříkají nic, co by mohl použít.

## Testy

`tests/revize.test.ts` drží to, co se umí vrátit potichu: nedefinovaná barva,
tlačítko bez přístupného jména, vypsaný dosah v nápovědě, číslo mimo svůj
jazyk, strop půjčky, tiché prodloužení zóny, nekomprimovaný snímek, zátěž
rostoucí s městem, věznice mimo průměr pokrytí a fronta zpráv z financí.
U věznice je vedle testu i **kontrolní případ**: bez pokrytí dům spadne o
stupeň, jinak by dvě stejné nuly nedokazovaly nic.

Golden snímek města po 1000 tikách se změnil — je to ta záměrná změna chování
z balancu a z chátrání. Počet budov, obyvatel i míst zůstal, liší se kasa a
hashe vrstev.
