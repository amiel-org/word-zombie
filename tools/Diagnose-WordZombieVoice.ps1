$ErrorActionPreference = "Continue"

$report = New-Object System.Collections.Generic.List[string]
function Add-Report([string]$line) {
  $report.Add($line)
  Write-Host $line
}

Add-Report "Word Zombie voice diagnostics"
Add-Report "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Report "Computer: $env:COMPUTERNAME"
Add-Report "User: $env:USERNAME"

$os = Get-CimInstance Win32_OperatingSystem
Add-Report "Windows: $($os.Caption) build $($os.BuildNumber)"
if ($os.Caption -match 'Windows.*\bN\b') {
  Add-Report "Windows N edition detected: also install the Media Feature Pack from Optional features."
}

$defaultHttpProgId = $null
try {
  $defaultHttpProgId = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
} catch { }
$defaultHttpHandler = if ([string]::IsNullOrWhiteSpace($defaultHttpProgId)) {
  'not detected'
} else {
  $defaultHttpProgId
}
Add-Report "Default HTTP handler: $defaultHttpHandler"

$edgePaths = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ }
Add-Report "Microsoft Edge installed: $([bool]$edgePaths)"

$englishVoices = @()
try {
  Add-Type -AssemblyName System.Speech -ErrorAction Stop
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voices = $synth.GetInstalledVoices()
  foreach ($voice in $voices) {
    Add-Report "Installed voice: $($voice.VoiceInfo.Name) | $($voice.VoiceInfo.Culture.Name) | enabled=$($voice.Enabled)"
  }
  $englishVoices = @($voices | Where-Object {
    $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*'
  })
  $synth.Dispose()
} catch {
  Add-Report "Speech API query failed: $($_.Exception.Message)"
}

Add-Report "Enabled English voice count: $($englishVoices.Count)"

$ttsCapabilities = @()
try {
  $ttsCapabilities = @(Get-WindowsCapability -Online -ErrorAction Stop | Where-Object {
    $_.Name -like 'Language.TextToSpeech*' -or $_.Name -like 'Language.Speech*'
  })
  foreach ($capability in $ttsCapabilities) {
    Add-Report "Windows capability: $($capability.Name) | state=$($capability.State)"
  }
} catch {
  Add-Report "Windows capability query unavailable: $($_.Exception.Message)"
}

if ($englishVoices.Count -eq 0) {
  Add-Report ""
  Add-Report "CONCLUSION: No usable English Windows text-to-speech voice was found."
  Add-Report "INSTALL: Settings > Time & Language > Language > Add a language > English (United States) > Language options > Text-to-speech > Download."
  Add-Report "After installation, close and reopen the browser, then rerun this script."
} else {
  Add-Report ""
  Add-Report "CONCLUSION: An English Windows voice is installed."
  Add-Report "NEXT CHECK: Use the latest game build, which waits for Chrome's asynchronous voice list. If it is still silent, open the same game address in Microsoft Edge to isolate a browser-specific issue."
}

$desktop = [Environment]::GetFolderPath('Desktop')
$outputPath = Join-Path $desktop 'Word-Zombie-Voice-Diagnosis.txt'
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($outputPath, $report, $utf8WithoutBom)
Add-Report ""
Add-Report "Report saved to: $outputPath"
