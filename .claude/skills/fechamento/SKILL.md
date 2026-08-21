---
name: fechamento
description: Espelho da caixa no fim do dia. Use quando pedirem fechamento, revisao do dia, preparar amanha ou "como foi o dia".
---

# Fechamento do dia

Fecha o dia em markdown, sem discurso motivacional.

## 1. O que estava combinado

Abre `~/Vault/Diario/{hoje:DD-MM-YYYY}.md`.
Procura `## Missao do dia`, `- [ ]` e `- [x]`.
Se o arquivo nao existir, diga qual faltou e siga com `~/Vault/pendencias.md`.

## 2. O que aconteceu

Use a conversa atual e as notas de hoje em `~/Vault/00-Inbox/`.
Nao invente resultado. Se faltou informacao, faca uma pergunta objetiva antes de gravar.

## 3. Gravar

Atualize `~/Vault/Diario/{hoje:DD-MM-YYYY}.md` sob `## Fechamento` com:

- 3 vitorias ou movimentos reais
- pendencias que continuam abertas
- 1 ajuste para amanha

Se alguma tarefa ficou aberta e ainda importa, deixe como `- [ ]` no fechamento.

## Regras

- Maximo 15 linhas na resposta.
- Nao transforme tudo em plano novo.
- Diferencie tarefa nao feita de tarefa que deixou de importar.
