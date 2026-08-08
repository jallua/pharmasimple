[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\PortableGit-2.51.0')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Version = '2.51.0.windows.1'
$Asset = 'PortableGit-2.51.0-64-bit.7z.exe'
$Uri = "https://github.com/git-for-windows/git/releases/download/v$Version/$Asset"
$ExpectedSha256 = 'a09b275d51ed3e829128e04cf4168fb54896cf6234bb30fecb8dc96a2bd321fa'
$GitExe = Join-Path $InstallRoot 'cmd\git.exe'

function Assert-InstalledVersion {
    if (-not (Test-Path -LiteralPath $GitExe -PathType Leaf)) { return $false }
    $actual = (& $GitExe --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $actual -ne "git version $Version") {
        throw "Existing PortableGit has unexpected version: $actual"
    }
    return $true
}

if (Assert-InstalledVersion) {
    Write-Host "Verified $(& $GitExe --version) at $GitExe" -ForegroundColor Green
    exit 0
}
if (Test-Path -LiteralPath $InstallRoot) {
    throw "Install directory already exists but is not a verified $Version installation: $InstallRoot"
}

$Download = Join-Path $env:TEMP ("$Asset." + [Guid]::NewGuid().ToString('N'))
try {
    Invoke-WebRequest -Uri $Uri -OutFile $Download -UseBasicParsing

    $ActualSha256 = (Get-FileHash -LiteralPath $Download -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualSha256 -ne $ExpectedSha256) {
        throw "PortableGit SHA-256 mismatch. Expected $ExpectedSha256, got $ActualSha256."
    }

    $Signature = Get-AuthenticodeSignature -LiteralPath $Download
    if ($Signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or -not $Signature.SignerCertificate) {
        throw "PortableGit Authenticode verification failed: $($Signature.Status) $($Signature.StatusMessage)"
    }

    New-Item -ItemType Directory -Path $InstallRoot | Out-Null
    $Arguments = @('-y', '-gm2', "-InstallPath=`"$InstallRoot`"")
    $Process = Start-Process -FilePath $Download -ArgumentList $Arguments -Wait -PassThru
    if ($Process.ExitCode -ne 0) { throw "PortableGit installer exited with $($Process.ExitCode)." }
    if (-not (Assert-InstalledVersion)) { throw "PortableGit did not install $GitExe." }

    Write-Host "Installed and verified $(& $GitExe --version) at $GitExe" -ForegroundColor Green
    Write-Host "Signer: $($Signature.SignerCertificate.Subject)" -ForegroundColor Gray
} catch {
    if ((Test-Path -LiteralPath $InstallRoot) -and -not (Test-Path -LiteralPath $GitExe)) {
        Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
} finally {
    Remove-Item -LiteralPath $Download -Force -ErrorAction SilentlyContinue
}
