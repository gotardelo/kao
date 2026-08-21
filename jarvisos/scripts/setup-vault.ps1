param(
  [string]$Vault = "$HOME\Vault"
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $Vault | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault '00-Inbox') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Vault 'Diario') | Out-Null

$ignore = Join-Path $Vault '.claudeignore'
if (-not (Test-Path $ignore)) {
  @'
financeiro/
pessoal/
*.key
.env
.env.*
'@ | Set-Content -LiteralPath $ignore -Encoding UTF8
}

$contexto = Join-Path $Vault 'contexto.md'
if (-not (Test-Path $contexto)) {
  @'
# Quem eu sou

## Como me chamar

## O que eu faco

## Pessoas e projetos importantes

## O que conta como prioridade

## O que me trava
'@ | Set-Content -LiteralPath $contexto -Encoding UTF8
}

$pendencias = Join-Path $Vault 'pendencias.md'
if (-not (Test-Path $pendencias)) {
  @'
# Pendencias

- [ ] Escrever a primeira pendencia real aqui
'@ | Set-Content -LiteralPath $pendencias -Encoding UTF8
}

Write-Host "Vault pronto em $Vault"
