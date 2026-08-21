param(
  [string]$Vault = "$HOME\Vault"
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw 'Claude Code CLI nao encontrado no PATH. Instale/autentique o Claude Code antes de rodar a caixa.'
}

if (-not (Test-Path $Vault)) {
  & "$PSScriptRoot\setup-vault.ps1" -Vault $Vault
}

claude -p "Rode a skill caixa agora." --add-dir $Vault
