---
name: caixa
description: Resumo da manha a partir do vault. Use quando pedirem "minha caixa", "resumo do dia", "o que caiu" ou "por onde eu comeco".
---

# Caixa da manha

Monta o resumo do dia em 3 blocos, nessa ordem, e nao escreve mais nada.

## 1. O que caiu

Le as notas criadas nas ultimas 24h em `~/Vault/00-Inbox/`.
Lista no maximo 5, uma linha cada, mais recente primeiro.
Se nao tiver nota nova, escreve `inbox limpa` e segue.

## 2. Onde eu parei

Abre `~/Vault/Diario/{ontem:DD-MM-YYYY}.md` e traz o que ficou como `- [ ]` no maximo 5.
Se o arquivo nao existir, diz isso e segue: nao inventa pendencia.

## 3. As 3 de hoje

Escolhe 3 prioridades cruzando o que caiu com o que ficou pendente.
Uma por linha, verbo primeiro, sem justificativa.
Grava em `~/Vault/Diario/{hoje:DD-MM-YYYY}.md` sob `## Missao do dia`.

## Regras

- Nunca inventa item que nao esta no vault.
- Arquivo faltando: diz qual faltou, nao improvisa.
- Resposta inteira em no maximo 15 linhas. Isso e pra ser lido em pe, tomando cafe.
