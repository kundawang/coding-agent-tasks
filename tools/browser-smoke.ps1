# Headless Chrome smoke test for the game page.
param(
  [string]$Url = "http://localhost:8123/index.html?seed=12345"
)
$chromeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Output "NO_BROWSER"; exit 2 }

$tmpProfile = Join-Path $env:TEMP ("emberdeck-profile-" + [guid]::NewGuid())
$errFile = Join-Path $env:TEMP "emberdeck-chrome-err.txt"
$domFile = Join-Path $env:TEMP "emberdeck-dom.html"

& $chrome --headless=new --disable-gpu --no-first-run --user-data-dir=$tmpProfile `
  --enable-logging=stderr --virtual-time-budget=6000 --dump-dom $Url 2>$errFile |
  Out-File -Encoding UTF8 $domFile

Write-Output "== console/errors =="
Get-Content $errFile -Encoding UTF8 |
  Where-Object { $_ -match "Uncaught|TypeError|ReferenceError|SyntaxError|ERROR:CONSOLE" } |
  Select-Object -First 15
Write-Output "== dom markers =="
$dom = Get-Content $domFile -Encoding UTF8
$m = [regex]::Match(($dom -join "`n"), 'id="turnInfo"[^>]*>([^<]*)<')
Write-Output ("turnInfo: " + $m.Groups[1].Value)
Write-Output ("cards rendered: " + ([regex]::Matches(($dom -join "`n"), 'class=""?card').Count))
$m = [regex]::Match(($dom -join "`n"), 'id="energyText"[^>]*>([^<]*)<')
Write-Output ("energy: " + $m.Groups[1].Value)
$m = [regex]::Match(($dom -join "`n"), 'id="playerHpText"[^>]*>([^<]*)<')
Write-Output ("player hp: " + $m.Groups[1].Value)
$m = [regex]::Match(($dom -join "`n"), 'id="enemyHpText"[^>]*>([^<]*)<')
Write-Output ("enemy hp: " + $m.Groups[1].Value)

Remove-Item $tmpProfile -Recurse -Force -ErrorAction SilentlyContinue
