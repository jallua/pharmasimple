[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Paths,

    [string]$CommitMessage = 'chore: publish reviewed changes',
    [string]$BaseBranch = 'main'
)

$ErrorActionPreference = 'Stop'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$Repo = if (Test-Path (Join-Path $Root '.git')) { $Root } else { Join-Path $Root 'site' }

$Git = (Get-Command git -CommandType Application -ErrorAction Stop).Source
$Gh = (Get-Command gh -CommandType Application -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $Repo '.git'))) {
    throw "Git repository not found at $Repo."
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & $Git -C $Repo @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE." }
}

foreach ($Path in $Paths) {
    if ([IO.Path]::IsPathRooted($Path) -or $Path -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "Only repository-relative paths are allowed: $Path"
    }
}

$current = (& $Git -C $Repo branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or -not $current) { throw 'Unable to determine the current branch.' }
if ($current -in @('main', 'mainline', 'master', $BaseBranch)) {
    $current = 'feature/publish-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Invoke-Git switch -c $current
} elseif ($current -notmatch '^(feat|feature|fix|docs|chore)/') {
    throw "Refusing to publish from non-feature branch '$current'."
}

Invoke-Git add -- @Paths
$staged = & $Git -C $Repo diff --cached --name-only
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect staged changes.' }
if ($staged) {
    Invoke-Git commit -m $CommitMessage
}

Invoke-Git remote get-url origin | Out-Null
Invoke-Git push -u origin $current

Push-Location $Repo
try {
    $existing = (& $Gh pr list --head $current --base $BaseBranch --state open --json url --jq '.[0].url').Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Unable to query existing pull requests.' }
    if ($existing) {
        Write-Host "Pull request updated: $existing" -ForegroundColor Green
        exit 0
    }

    $url = (& $Gh pr create --base $BaseBranch --head $current --title $CommitMessage --body 'Created by publish.ps1. Merge only after required checks and review pass.').Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Pull request creation failed.' }
    Write-Host "Pull request created: $url" -ForegroundColor Green
} finally {
    Pop-Location
}
