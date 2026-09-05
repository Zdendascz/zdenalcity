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
| rychlost | pauza, normální běh | 2×, 4×, 8× |
| nástroje | pacička, silnice, terén, zóny, buldozer | služby, energie, voda, odpad, kultura, doprava |
| ovládání | povrch/podzemí, průhlednost, stromy, uložení | vrstvy, katastrofy, daně, financování, rozpočet, půjčky, MHD, nápověda, jazyk |

Schované se nezruší, jen se přesune. Statistiky a rychlost jdou pod roletku
(otevře se **dolů**, nad horní lištou už je jen okraj displeje), nástroje
a ovládání do **vysunuté řady** nad tou stálou.

Vysunutá řada je prostý přepínač, ne roletka: uvnitř jsou další roletky
a nabídka v nabídce by se zavírala navzájem. Jediná výjimka — **výběr nástroje
řadu zavře**. Kdo si vybral elektrárnu, chce vidět mapu a postavit ji.

Pořadí statistik zůstalo původní, i když kasa a bilance v něm nesousedí. Na
počítači lišta vypadá dobře tak, jak je, a přeskládat ji kvůli telefonu by
znamenalo spravit něco, co není rozbité.

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

Autor si ji vyžádal **„na mobilu i na pc"**, takže stojí ve stálé řadě vedle
průhlednosti a stromů — v úsporné liště se neschovává. Popis je
v `docs/14-POHLEDY.md`.
