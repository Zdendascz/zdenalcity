<#
  Velky beh simulace. Spousti se naplanovanou ulohou (schtasks) ve 23:55.

  Kompletni zadani: 2592 variant strategie po deseti behach, kazda partie
  sto let, tedy 25 920 partii. Pri sedmnacti vterinach na partii a dvanacti
  soubeznych procesech to je zhruba deset hodin.

  Plan partii je michany ze seminka, takze **beh jde kdykoli zastavit** a co
  je hotove, je platny vzorek celeho prostoru strategii, ne jeho roh.
  Zastaveni:  Get-Process node | Stop-Process
#>

$ErrorActionPreference = 'Stop'
Set-Location 'D:\Projekty\citybuilder'

$out = 'data\sim-full'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$started = Get-Date
"start $($started.ToString('yyyy-MM-dd HH:mm:ss'))" | Out-File -Encoding utf8 "$out\prubeh.txt"

# Prekladat se musi tady: `vite build` maze cely tools\.build, takze tam
# simulate.js nemusi byt, kdyz se mezitim prelozil jiny nastroj.
$node = (Get-Command node).Source
& $node 'node_modules\vite\bin\vite.js' build --ssr tools/simulate.ts --outDir tools/.build --logLevel error

$workers = 12
$jobs = @()
for ($i = 0; $i -lt $workers; $i++) {
  $jobs += Start-Process -FilePath $node -PassThru -WindowStyle Hidden `
    -ArgumentList "tools\.build\simulate.js --games 25920 --years 100 --runs 10 --stride $workers --offset $i --out $out" `
    -RedirectStandardOutput "$out\log-$i.txt" -RedirectStandardError "$out\err-$i.txt"
}
$jobs | Wait-Process

$done = Get-Date
$minutes = [int]($done - $started).TotalMinutes
$rows = (Get-ChildItem "$out\games-*.jsonl" | Get-Content | Measure-Object -Line).Lines
"konec $($done.ToString('yyyy-MM-dd HH:mm:ss')), $minutes minut, partii $rows" |
  Out-File -Encoding utf8 -Append "$out\prubeh.txt"
