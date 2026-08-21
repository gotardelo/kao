param(
  [string]$Vault = "$HOME\Vault",
  [string]$Model = "$HOME\models\ggml-base.bin",
  [string]$Whisper = "$HOME\tools\whisper.cpp\Release\whisper-cli.exe",
  [string]$Ffmpeg = "ffmpeg",
  [string]$Mic = "",
  [int]$Seconds = 8
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Vault)) {
  & "$PSScriptRoot\setup-vault.ps1" -Vault $Vault
}
if (-not (Test-Path $Model)) {
  throw "Modelo Whisper nao encontrado: $Model"
}
if (-not (Test-Path $Whisper)) {
  throw "whisper-cli nao encontrado: $Whisper"
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw 'Claude Code CLI nao encontrado no PATH. Instale/autentique o Claude Code antes de rodar o JarvisOS.'
}
if (-not $Mic) {
  Write-Host 'Informe o microfone com -Mic. Para listar: ffmpeg -list_devices true -f dshow -i dummy'
  exit 1
}

Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate = 1
$speaker.Volume = 100

$inputWav = Join-Path $env:TEMP 'jarvis-in.wav'

Write-Host "jarvis pronto. Enter grava $Seconds s, Ctrl+C sai."
while ($true) {
  [void](Read-Host)

  & $Ffmpeg -hide_banner -loglevel error -f dshow -i "audio=$Mic" -t $Seconds `
    -ar 16000 -ac 1 -c:a pcm_s16le $inputWav -y

  $question = (& $Whisper -m $Model -l pt -nt -np -f $inputWav 2>$null) -join ' '
  $question = ($question -replace '\s+', ' ').Trim()
  if (-not $question) {
    Write-Host 'nao ouvi nada'
    continue
  }

  Write-Host "voce: $question"
  $answer = (claude -p $question `
    --add-dir $Vault `
    --permission-mode acceptEdits `
    --allowedTools Read,Write,Edit,Glob,Grep,LS) -join "`n"
  Write-Host "jarvis: $answer"
  $speaker.Speak($answer)
}
