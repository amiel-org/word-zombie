param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,
    [int]$Port = 41739
)

$ErrorActionPreference = "Stop"
$executable = (Resolve-Path -LiteralPath $ExecutablePath).Path

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already listening before verification"
}

$oldNoBrowser = $env:WORD_ZOMBIE_NO_BROWSER
$oldVerifyOnce = $env:WORD_ZOMBIE_VERIFY_ONCE
$env:WORD_ZOMBIE_NO_BROWSER = "1"
$env:WORD_ZOMBIE_VERIFY_ONCE = "1"

try {
    $process = Start-Process `
        -FilePath $executable `
        -PassThru `
        -WindowStyle Hidden

    $baseUrl = "http://127.0.0.1:$Port/"
    $manifest = $null
    for ($attempt = 0; $attempt -lt 200; $attempt += 1) {
        try {
            $manifest = Invoke-RestMethod `
                -Uri "${baseUrl}manifest.webmanifest" `
                -TimeoutSec 1
            if ($manifest.icons[0].src -eq "assets/battle/app-icon-192.png") { break }
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (
        $null -eq $manifest `
        -or $manifest.icons[0].src -ne "assets/battle/app-icon-192.png"
    ) {
        throw "Expected Word Zombie manifest was not served"
    }

    $page = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 3
    $map = Invoke-WebRequest `
        -Uri "${baseUrl}assets/battle/maps/winter-plaza.jpg" `
        -UseBasicParsing `
        -TimeoutSec 3

    [pscustomobject]@{
        Executable = $executable
        ProcessId = $process.Id
        Url = $baseUrl
        PageStatus = $page.StatusCode
        AppShellMatch = $page.Content -match 'id="app"'
        ManifestName = $manifest.name
        ManifestShortName = $manifest.short_name
        MapStatus = $map.StatusCode
        MapBytes = $map.RawContentLength
    }

    Wait-Process -Id $process.Id -Timeout 12
} finally {
    $env:WORD_ZOMBIE_NO_BROWSER = $oldNoBrowser
    $env:WORD_ZOMBIE_VERIFY_ONCE = $oldVerifyOnce
}
