[CmdletBinding()]
param(
    [switch]$SkipSite,
    [switch]$SkipScraper
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$SiteDir = Join-Path $Root 'site'
$ScraperDir = Join-Path $Root 'scraper'

function Get-Executable([string]$Name) {
    $Command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Command -or $Command.Source -match '\\WindowsApps\\') {
        throw "Required executable '$Name' is not installed or resolves to a Windows Store stub."
    }
    return $Command.Source
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path (Join-Path $SiteDir 'package-lock.json'))) {
    throw "Expected site\package-lock.json under $Root."
}
if (-not (Test-Path (Join-Path $ScraperDir 'requirements.txt'))) {
    throw "Expected scraper\requirements.txt under $Root."
}

if (-not $SkipSite) {
    $Node = Get-Executable 'node'
    $Npm = Get-Executable 'npm'
    $NodeText = (& $Node --version).Trim().TrimStart('v')
    if ($LASTEXITCODE -ne 0) { throw 'node --version failed.' }
    try { $NodeVersion = [Version]$NodeText } catch { throw "Unrecognized Node.js version: $NodeText" }
    if ($NodeVersion -lt [Version]'22.12.0') { throw "Node.js >=22.12.0 is required; found $NodeText." }

    Push-Location $SiteDir
    try { Invoke-Checked $Npm ci } finally { Pop-Location }
}

if (-not $SkipScraper) {
    $Python = Get-Executable 'python'
    Push-Location $ScraperDir
    try {
        if (-not (Test-Path '.venv')) { Invoke-Checked $Python -m venv .venv }
        $VenvPython = Join-Path $ScraperDir '.venv\Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
            throw "Virtual-environment Python not found: $VenvPython"
        }
        Invoke-Checked $VenvPython -m pip install -r requirements.txt
    } finally { Pop-Location }
}

Write-Host 'PharmaSimple environment initialized successfully.' -ForegroundColor Green
