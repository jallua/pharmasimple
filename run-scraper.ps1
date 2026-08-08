[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('incremental', 'full')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Refresh = Join-Path $Root 'scraper\refresh.py'
$Importer = Join-Path $Root 'scripts\import-verified-content.ts'

if (-not (Test-Path -LiteralPath $Refresh -PathType Leaf)) { throw "Missing scraper refresh entry point: $Refresh" }
if (-not (Test-Path -LiteralPath $Importer -PathType Leaf)) { throw "Missing trusted-content importer: $Importer" }

& python $Refresh --mode $Mode
if ($LASTEXITCODE -ne 0) { throw "Official-source refresh failed closed with exit code $LASTEXITCODE." }

& node $Importer --apply
if ($LASTEXITCODE -ne 0) { throw "Trusted-content import failed closed with exit code $LASTEXITCODE." }
