# Nasazení na games.zdendas.cz/zdenalcity/

Pokyny pro session, která má na cílový server funkční SSH. Hra je **statická** —
na serveru neběží žádný Node, žádný proces, jen soubory.

## Cíl

| | |
|---|---|
| URL | `https://games.zdendas.cz/zdenalcity/` |
| Server | 88.222.220.200, Debian 12, OpenSSH 9.2p1 |
| Uživatel | `zdendas` |
| Web server | **Apache** (404 stránka je jeho, kořen domény odpovídá 200) |
| Před tím | Cloudflare proxy (DNS ukazuje na 104.21.26.10 / 172.67.135.30) |

## 1. Build

Vyžaduje Node `^20.19.0 || >=22.12.0`.

```bash
cd D:/Projekty/citybuilder && npm run build
```

Vznikne `dist/`. Počet souborů roste s obsahem — dnes je jich přes pět set,
protože přibyly sprity budov, dlaždice a obrázky událostí. Definice
(`content/vanilla/**.json`) jsou přibalené v bundlu, obrázky jsou samostatné
soubory a stahují se, až si o ně hra řekne.

**Kontrola, bez které to nemá cenu nahrávat:**

```bash
grep -o 'src="[^"]*"' D:/Projekty/citybuilder/dist/index.html
```

Musí vyjít `./assets/...` s tečkou. Kdyby tam bylo `/assets/...`, chybí
`base: './'` ve `vite.config.ts` a v podadresáři by prohlížeč hledal assety
v kořeni domény a nenašel nic.

## 2. Zabalení a nahrání

```bash
cd D:/Projekty/citybuilder && tar -czf /c/Users/Intel/Downloads/zdenalcity-build.tar.gz -C dist .
```

```bash
scp /c/Users/Intel/Downloads/zdenalcity-build.tar.gz zdendas@88.222.220.200:/tmp/
```

## 3. Najít webroot

Vhost pro `games.zdendas.cz` je na serveru; jeho `DocumentRoot` je to, co
hledáme. Na Debianu s Apachem:

```bash
ssh zdendas@88.222.220.200 'grep -rn "games.zdendas.cz" /etc/apache2/sites-enabled/ 2>/dev/null; apache2ctl -S 2>/dev/null | grep -i games'
```

Když je za Apachem ještě panel (ISPConfig, Plesk, cPanel), bývá webroot
`/var/www/clients/...` nebo `~/web/`. V dalších krocích je to `WEBROOT`.

## 4. Rozbalit

**Nejdřív záloha, pokud tam už něco je** — přepis bez zálohy je jediný krok
tohohle postupu, který nejde vrátit:

```bash
ssh zdendas@88.222.220.200 'test -d WEBROOT/zdenalcity && mv WEBROOT/zdenalcity WEBROOT/zdenalcity.bak-$(date +%Y%m%d-%H%M) || echo "nic tam neni, zaloha netreba"'
```

```bash
ssh zdendas@88.222.220.200 'mkdir -p WEBROOT/zdenalcity && tar -xzf /tmp/zdenalcity-build.tar.gz -C WEBROOT/zdenalcity && chmod -R a+rX WEBROOT/zdenalcity && find WEBROOT/zdenalcity -type f | wc -l'
```

Poslední příkaz musí vypsat **tolik souborů, kolik jich má `dist/`** — porovnej
s `find dist -type f | wc -l` na svém stroji. Apache nepotřebuje restart ani žádnou
konfiguraci navíc: `DirectoryIndex index.html` je výchozí, hra nemá routing,
takže žádné rewrite pravidlo není potřeba.

## 5. Ověření

Nejdřív **na serveru**, mimo Cloudflare cache:

```bash
ssh zdendas@88.222.220.200 'curl -sI -H "Host: games.zdendas.cz" http://127.0.0.1/zdenalcity/ | head -3; curl -s -H "Host: games.zdendas.cz" http://127.0.0.1/zdenalcity/ | grep -o "src=\"[^\"]*\""'
```

Čekáme `200 OK` a `src="./assets/index-*.js"`.

Pak **zvenčí** (může viset na cache Cloudflare, proto purge nebo `?v=1`):

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}B %{content_type}\n" "https://games.zdendas.cz/zdenalcity/?v=1"
```

Nakonec v prohlížeči (`preview_start` s `url`), protože HTTP 200 ještě
neznamená, že hra běží:

1. Otevřít `https://games.zdendas.cz/zdenalcity/` — **s lomítkem na konci**.
   Bez něj Apache sice přesměruje, ale relativní cesty se počítají od
   nadřazeného adresáře, takže případný proxy, který redirect sežere, rozbije
   načtení assetů.
2. Musí naskočit dialog „Nové město" s náhledem mapy a hláškou „Souše NN %".
3. Kliknout „Založit město" — objeví se HUD (kasa 20 000, datum Rok 1) a
   izometrická mapa na canvasu.
4. `read_console_messages` musí být bez chyb.
5. `globalThis.__city` musí být **`undefined`** — ladicí handle je jen pro
   vývojový build a v produkci se vytřepe. Kdyby existoval, nahrál se dev build.

## 5b. Hlavičky keše

Produkce nahlásila dvě věci a obě se týkají toho, jakou verzi hráč doopravdy
dostane:

1. **`CACHE` v service workeru zůstávalo na `v1`** přes dvě nasazení, takže se
   stará keš neuklízela a nabalovala sprity ze všech verzí. Opraveno v kódu:
   jméno keše se **razítkuje při buildu** hashem commitu a datem
   (`stampServiceWorker` ve `vite.config.ts`). Ověřit jde na hotovém buildu:

   ```bash
   grep -n "const CACHE" D:/Projekty/citybuilder/dist/service-worker.js
   ```

   Musí tam být `zdenalcity-<hash>-<datum>`, ne `zdenalcity-__BUILD_VERSION__`.

2. **`service-worker.js` chodí s `max-age=14400`.** To je u workeru nejhorší
   možná hodnota: prohlížeč si nový vezme až za čtyři hodiny, takže po nasazení
   běží starý ještě půl dne. V buildu je od té doby `public/.htaccess`, které
   workeru, `index.html` a manifestu nastaví `no-cache` a assetům s hashem
   naopak rok.

   `.htaccess` zabere, **jen když má vhost `AllowOverride FileInfo` nebo `All`**.
   Ověřit zvenčí:

   ```bash
   curl -sI "https://games.zdendas.cz/zdenalcity/service-worker.js" | grep -i "cache-control\|cf-cache-status"
   ```

   Čekáme `no-cache`. Když tam pořád je `max-age=14400`, hlavičku nastavuje
   něco výš — buď vhost (pak patří do jeho konfigurace), nebo **Cloudflare**,
   který si TTL řídí sám a `.htaccess` ho nezajímá. Tam je potřeba Cache Rule
   na `games.zdendas.cz/zdenalcity/service-worker.js` s „Bypass cache".

## 6. Cloudflare

Po každém dalším nasazení protočit cache pro `games.zdendas.cz/zdenalcity/*`,
jinak testeři uvidí starou verzi. Jména souborů v `assets/` mají hash, takže
zastarat může prakticky jen `index.html`.

## Rollback

```bash
ssh zdendas@88.222.220.200 'rm -rf WEBROOT/zdenalcity && mv WEBROOT/zdenalcity.bak-* WEBROOT/zdenalcity'
```

## Co říct testerům

- Hra běží celá v prohlížeči, nic se neinstaluje. Doporučit Chrome nebo Edge
  (Pixi jede na WebGL, ve starších Safari může zlobit WebGPU cesta).
- **Zpětná vazba přes savy**: „Uložit do souboru" vyrobí `.city`, který se dá
  poslat zpátky a rozebrat. Rychlé uložení sedí v localStorage prohlížeče,
  takže ho smaže vyčištění dat webu.
- Save je formátu **verze 3**. Starší savy hra zmigruje sama; save z novější
  verze hry odmítne a řekne to nahlas.
- Hra je česky i anglicky, jazyk se bere z prohlížeče.

## Známé meze téhle verze (ať to tester nehlásí jako chybu)

- Načíst uložené město jde jen zevnitř rozehrané hry — dialog nové hry tlačítko
  „načíst" zatím nemá.
- Není převýšení terénu, kanalizace ani katastrofy; to je fáze 3b a dál.
- Vanilla obsah nemá vyplněné prerekvizity kromě zastávky MHD, která potřebuje
  vozovnu.
