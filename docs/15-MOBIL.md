# Rozhraní na telefonu

Autor napsal: „Mě to normálně lidi začali hrát na mobilu!!!! tak musíme to
vyladit… klasická PC verze je v pohodě, takže je ta mobilní."

Následoval seznam sedmi věcí. Tenhle dokument říká, co z nich vzniklo, proč
zrovna takhle, a co se **záměrně nezměnilo**.

## Kdy se rozhraní přepne

`src/ui/layout.ts`:

```
(pointer: coarse), (width <= 900px)
```

Dvě podmínky, každá kvůli něčemu jinému:

- `pointer: coarse` je prst. Dotykové zařízení dostane úspornou lištu i na
  tabletu, kde by se ta plná sice vešla, ale tlačítka by byla na prst malá.
  Notebook s dotykovou obrazovkou sem **nespadá** — hlásí `fine`, protože se
  podmínka ptá na hlavní ukazatel, ne na to, co všechno zařízení umí.
- Úzké okno dostane totéž bez ohledu na ukazatel. Plná lišta se v něm stejně
  zalamuje do tří řad.

Podmínka se **hlídá za běhu** (`watchCompact`), ne jen při startu: otočení
telefonu na šířku mění šířku okna a lišta se musí přestavět.

### Proč to není media query

CSS by to nezvládlo. Úsporný režim **stěhuje tlačítka do jiného rodiče**, ne
jen mění jejich vzhled — a to je změna stromu. Kdyby o tom rozhodovala CSS
podmínka a nezávisle na ní kód, dřív nebo později by se rozešly.

Kód proto rozhoduje sám a CSS se veze: `Hud` nasazuje kořenu třídu
`hud--compact` a stylopis se řídí jí.

## Co zůstane v liště

Zadání autora, položku po položce:

| část | zůstává | schová se |
|---|---|---|
| statistiky | kasa, měsíční bilance | obyvatel, práce, spokojenost, pod proudem, proud, datum |
| rychlost | jedno tlačítko pauza/běh | 2×, 4×, 8× |
| nástroje | pacička, silnice, terén, zóny, buldozer | služby, energie, voda, odpad, kultura, doprava |
| ovládání | pohled, průhlednost, stromy, lupa, síť, uložení | vrstvy, katastrofy, daně, financování, rozpočet, půjčky, MHD, nápověda, jazyk |

Schované se nezruší, jen se přesune. Statistiky a rychlost jdou pod roletku
(otevře se **dolů**, nad horní lištou už je jen okraj displeje), nástroje
a ovládání do **vysunuté řady** nad tou stálou.

Pořadí statistik zůstalo původní, i když kasa a bilance v něm nesousedí. Na
počítači lišta vypadá dobře tak, jak je, a přeskládat ji kvůli telefonu by
znamenalo spravit něco, co není rozbité.

### Dvě řady, ne tři

Autor si po prvním kole vyžádal, aby **síť, uložení a trojtečka stály v jedné
řadě s pacičkou a silnicí**, ne v řadě nad nimi. Spodek lišty je proto:

```
[lupa −][lupa +] [pohled] [průhlednost] [stromy]
[pacička silnice terén zóny buldozer] [síť] [uložení] [⋯]
```

Řadu s paletou skládá HUD (`hud__tools-row`): vlevo si do ní paleta pověsí svou
lištu, vpravo HUD dopíše to, co k ní patří.

### Jedna trojtečka, ne dvě

Vysunutá řada je **společná**: jsou v ní schované nástroje i schované ovládání
a otevírá je jedno tlačítko. Dvě trojtečky vedle sebe, každá s jiným obsahem,
by hráč neměl jak rozeznat.

Vlastní ji HUD; paleta o ní ví jen tolik, kam si své nabídky pověsit a jak ji po
výběru zavřít (`ToolbarOverflow`). Je to prostý přepínač, ne roletka: uvnitř
jsou další roletky a nabídka v nabídce by se zavírala navzájem. **Výběr nástroje
řadu zavře** — kdo si vybral elektrárnu, chce vidět mapu a postavit ji.

### Co se sloučilo do jednoho tlačítka

- **Povrch a podzemí.** Jeden přepínač místo dvojice. Znamená vždycky „pohled
  pod zem" a rozsvícený je, když se hráč pod zemí zrovna dívá. Na počítači
  zůstávají dvě — autor řekl, že PC verze je v pohodě.
- **Pauza a běh.** Běží–neběží je jeden stav a patří mu jeden přepínač. Na
  tlačítku je **to, co se stane po stisku**, jako u každého přehrávače.
  Odpauzování se vrací na tu rychlost, na které čas běžel: kdo si pustil osmkrát
  a dal pauzu, chce po odpauzování zase osmkrát.
- **Statistiky.** Ikonka grafu zmizela úplně — tlačítkem je rovnou kasa
  s bilancí. Je to dost velký terč a ušetří to celé jedno tlačítko v liště, kde
  se počítá každé.

Zrychlení čeká pod **trojtečkou vedle** pauzy. Dokud běží pauza nebo normální
rychlost, je na tlačítku trojtečka; jakmile si hráč pustí něco rychlejšího,
vezme si tlačítko jeho ikonu a rozsvítí se — jinak by po zavření nebylo poznat,
že čas letí.

Ikony běžících pohrom u hodin jsou na telefonu velké jako ostatní tlačítka.
O menší terč vedle větších se prstem těžko trefuje a v řadě to skáče.

### Proč jsou tlačítka na telefonu užší

Čtyřicet pixelů místo šestačtyřiceti, mezery dva místo šesti. Osm tlačítek
v řadě s paletou by po šestačtyřiceti zabralo 378 pixelů — víc, než kolik má
nejužší běžný telefon (360) k dispozici — a řada by se zalomila, tedy přesně to,
čemu se mělo předejít. Se čtyřiceti to vyjde na 328. Na výšku zůstává 44, takže
je to pořád terč, na který se dá trefit prstem.

## Lupa

Na telefonu **není kolečko** a hra nemá gesto, takže se hráč neměl jak dostat
blíž ani dál. Přibyla dvě tlačítka, `ZOOM_STEP = 1,25` na klepnutí.

Přibližuje se **doprostřed obrazovky**, ne k tlačítku: kolečko se drží kurzoru,
jenže tlačítko žádný kurzor nemá a jeho vlastní poloha je pravý dolní roh.

Na počítači tlačítka nejsou — tam kolečko je a dvě ikony navíc by jen
překážely.

## Načtení nové verze

Autor: „musí tam být možnost načíst novou verzi systému, ale zachovat aktivní
město v cache — zase jen pro mobily."

Na telefonu drží starou verzi prohlížeč, ne hráč. `index.html` může být z HTTP
keše (viz `docs/DEPLOY.md`, sekce 5b) a service worker si nese svoji vlastní.
Jediná cesta, kterou hráč znal, bylo smazat data stránky — čímž by přišel
i o rozehrané město, protože to bydlí v `localStorage` hned vedle.

Tlačítko sedí v roletce **Uložení**, protože je to hlavně uložení. Pořadí je
celý vtip a je v `platform/browser.ts`:

1. **Město do `localStorage`.** Píše se synchronně, takže je uložené dřív, než
   se sáhne na cokoli dalšího.
2. **Keš service workeru pryč.** Drží v sobě `index.html` z minula; dokud
   zůstane, dostane hráč po obnovení zase tu starou verzi.
3. **Worker pryč.** Nový build si zaregistruje vlastní; ten starý by do té doby
   dál obsluhoval každý požadavek.
4. **Teprve pak obnovení stránky.** Prohlížeč u něj hlavní dokument ověřuje na
   serveru, takže i `max-age` na `index.html` dostane odpověď „změnilo se".

Nepovedený úklid se nehlásí jako chyba: obnovit stránku má cenu tak jako tak
a hráč nemá co dělat s tím, že mu prohlížeč nepustil ke `caches`.

Po obnovení se **přeskočí rozcestník**. Hráč si vyžádal novou verzi hry, ne
návrat do menu. Říká to příznak v `sessionStorage`, který se čte **a hned
maže** — platí pro jedno spuštění, ne pro kartu. V `localStorage` by přežil
i to, že hru zavřel a otevřel za týden, a rozcestník by mu zmizel bez důvodu.

Celé to jde přes platform vrstvu (§9): herní kód nesahá na `caches`,
`serviceWorker` ani `location` — řekne si o `platform.reloadNewVersion()`.

## Pacička nechá pohled být

Sedmá věc ze seznamu: „když jsem pod povrchem a přepnu na pacičku, přepne se mi
to na povrch… to je chyba, musí zůstat."

`selectTool` si pohled přepínal sám: potrubí pod zem, cokoli jiného než buldozer
na povrch. Logika je správná pro nástroje, které **něco dělají** — kdo sáhne po
silnici, chce vidět povrch. Pacička ale nedělá nic; posouvá mapu a otevírá
parcely. Hráč tak přišel o pohled, ve kterém pracoval, jen tím, že si chtěl
posunout mapu.

Pacička je teď druhá výjimka vedle buldozeru.

## Co se nezměnilo

- **Plná verze.** Autor řekl, že je v pohledě, tak se jí nesahalo: stejné
  pořadí statistik, stejná lišta, žádná lupa navíc.
- **Poptávka** (O/K/P vpravo nahoře). Je malá a autor ji nezmínil.
- **Ikony běžících pohrom** u hodin. Zůstávají vidět vždycky — je to jediná
  cesta zpátky ke zprávě o katastrofě (viz `docs/14-POHLEDY.md`).
- **Gesta.** Přiblížení dvěma prsty se nepřidávalo. Autor si vyžádal tlačítka
  a ta stačí; gesto by se navíc pralo s tažením, kterým se staví.

## Přibylo později: čtvercová síť

Autor si ji vyžádal **„na mobilu i na pc"**, takže se neschovává: na počítači
stojí vedle průhlednosti a stromů, na telefonu v řadě s paletou. Popis je
v `docs/14-POHLEDY.md`.
