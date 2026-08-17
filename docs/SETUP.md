# Setup prostředí

## Verze Node

Projekt vyžaduje Node `^20.19.0 || >=22.12.0` (kvůli Vite 8). Vynuceno přes
`engines` v `package.json`.

Aktuální stav: **Node 24.19.0 LTS ze scoopu**, `C:\Users\Intel\scoop\apps\nodejs-lts\current`.

```powershell
node -v    # v24.19.0
npm -v     # 11.17.0
```

Aktualizace:

```powershell
scoop update nodejs-lts
```

## Historie: konflikt dvou instalací Node (vyřešeno 2026-08-14)

Na stroji byl vedle scoop instalace ještě starý **Node 20.11.1** v
`C:\Program Files\nodejs\`, zapsaný v **systémovém** PATH. Windows skládá PATH
jako *systémový + uživatelský*, takže stará verze stínila novou a `node -v`
hlásil `v20.11.1` — Vite 8 by na kontrole `engines` spadl.

Vyřešeno odstraněním jediného záznamu ze systémového PATH (elevovaný shell):

```powershell
$p = [Environment]::GetEnvironmentVariable('Path','Machine')
$new = ($p -split ';' | Where-Object { $_ -and $_ -notmatch '^C:\\Program Files\\nodejs\\?$' }) -join ';'
[Environment]::SetEnvironmentVariable('Path', $new, 'Machine')
```

Samotná instalace Node 20 zůstala na disku a jde kdykoli odinstalovat přes
Nastavení → Aplikace → Node.js. Pokud by se v budoucnu znovu objevila v PATH
(např. po reinstalaci Node.js z MSI), projeví se to stejně: `node -v` začne
hlásit v20 a `npm run dev` selže na `engines`.

**Pozor:** změna PATH v registru se projeví až v **nově spuštěných** procesech.
Běžící terminály — a Claude Code, pokud běžel v době změny — mají PATH zděděný
ze svého startu a je nutné je restartovat.
