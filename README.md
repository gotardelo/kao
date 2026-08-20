# Kao — seu TDAHzeiro

Copiloto pessoal para quem tem TDAH, em HTML/CSS/JS puro (sem build, sem framework,
sem dependências). Funciona no desktop e no celular, e instala como app (PWA).

A ideia central: em vez de um chat genérico, você **cria um personagem** — classe,
atributos, nome, avatar e voz — e ele carrega o seu contexto em toda conversa.

---

## Como rodar

```bash
node server.js
```

Abra <http://localhost:5173>. Alternativas sem Node: `python -m http.server 5173` ou `npx serve`.

> **Não abra o `index.html` com duplo clique.** Em `file://` o navegador bloqueia a
> WebCrypto e o `fetch` para a API. Precisa ser servido por HTTP.

### Primeiros passos

1. Crie sua conta (nome, e-mail, senha).
2. O **criador de personagem** abre sozinho: quem você é, o que te trava, e aí a classe,
   os atributos, o nome e a voz do seu TDAHzeiro. Leva uns 3 minutos.
3. Cole sua chave da Anthropic (`sk-ant-…`) em **Chave & Modelo** e clique em **Salvar e testar**.
   A chave sai de <https://console.anthropic.com/settings/keys>.
4. Vá em **Conversar**.

### O personagem

| Classe | Faz o quê |
|---|---|
| 🔥 Treinador | Te tira da inércia e cobra o combinado |
| 🤝 Parceiro de foco | Body doubling: fica do seu lado enquanto você faz |
| 🫂 Cuidador | Cuida de você antes da tarefa (comeu? dormiu? remédio?) |
| 🧠 Estrategista | Transforma o despejo caótico em plano e prioridade |
| 🎲 Agente do caos | Gamifica e usa humor para vencer o tédio |
| 🎯 Sargento gentil | Corta a enrolação, firme com a tarefa e nunca com você |

A classe define um preset dos 6 atributos (energia, firmeza, humor, detalhe,
proatividade, formalidade), que você ajusta nos sliders. Cada faixa vira uma instrução
concreta no system prompt — dá para ver o texto gerado em **Meu TDAHzeiro**.

Além da personalidade, o prompt sempre carrega 10 regras de trabalho com TDAH
(um passo por vez, o difícil é começar, zero vergonha, ser memória externa, checar o
corpo antes de culpar a vontade…) que valem acima do estilo escolhido.

### Memória e ferramentas

Ele não é um chat que esquece. Tem três camadas de memória, todas visíveis e editáveis
em **Minha vida**:

- **Fatos** — o que é estável sobre você (onde mora, medicação, horários, pessoas)
- **Pendências** — a lista viva, com prazo e atraso
- **Diário** — um resumo por dia

E grava sozinho, conversando, através de 12 ferramentas. Você diz *"gastei 40 no ifood"*
e ele chama `registrar_gasto` na hora; diz *"terminei a intro do TCC"* e ele fecha a
pendência. **Zero formulário** — porque o atrito de registrar é o que faz sistema de TDAH morrer.

| Ferramenta | Dispara quando |
|---|---|
| `lembrar_fato` | você conta algo estável sobre si |
| `criar_pendencia` / `concluir_pendencia` | aparece ou termina uma tarefa |
| `registrar_gasto` / `registrar_receita` | dinheiro entra ou sai |
| `cadastrar_conta` / `marcar_conta_paga` | conta recorrente e baixa |
| `definir_orcamento` / `criar_meta` / `guardar_na_meta` | orçamento e metas |
| `consultar_financas` | antes de opinar sobre dinheiro |
| `anotar_diario` | fim de conversa relevante |

Ao abrir o app, o **briefing** mostra o que venceu, o que atrasou e o que estourou —
sem você precisar perguntar. Os **rituais** (*Bom dia*, *Travei*, *Fechamento*, *Grana*)
são atalhos para as horas que mais pegam.

### Dinheiro

Contas a pagar com vencimento, gastos por categoria, metas e teto mensal. O diferencial
é a **projeção**: ele avisa que o mês *vai* estourar quando as contas em aberto forem
pagas, em vez de constatar o estouro depois.

### Voz

Usa a Web Speech API do navegador — nativa, sem custo de API e sem instalar nada:

- **Ouvir**: botão em cada resposta; dá para deixar falando sozinho a cada resposta.
- **Falar**: botão de microfone no campo de mensagem transcreve sua fala (Chrome/Edge).

Voz, velocidade e tom são configurados no passo **Voz** do criador.

---

## Usar no celular

O `server.js` mostra um endereço `http://192.168.x.x:5173` para a mesma rede Wi-Fi — funciona
para dar uma olhada, **mas em HTTP puro o navegador desliga a WebCrypto**, então login e
cadastro não funcionam fora de `localhost`.

Para uso real no celular, publique em qualquer host estático com HTTPS. É só subir a pasta:

| Host | Como |
|---|---|
| **Netlify Drop** | arraste a pasta em <https://app.netlify.com/drop> |
| **Cloudflare Pages** | `npx wrangler pages deploy .` |
| **GitHub Pages** | suba num repositório e ative Pages na branch |
| **Vercel** | `npx vercel --prod` |

Com HTTPS no ar, abra no celular e use "Adicionar à tela de início" — ele abre em tela cheia,
sem barra de navegador, com ícone próprio.

O service worker guarda a casca do app (HTML/CSS/JS) para abrir sem rede. As conversas em si
sempre precisam de internet, porque falam com a API da Anthropic.

---

## Como está organizado

```
index.html          todas as telas (login, painel, chat, chave, perfil)
css/style.css       estilo base, mobile-first
css/persona.css     criador de personagem, ficha e perfil social
css/vida.css        briefing, listas, dinheiro e memória
js/icons.js         ícones SVG inline
js/persona.js       personagem, atributos, prompt gerado, voz e ditado
js/wizard.js        criador de personagem em passos
js/memoria.js       fatos, pendências e diário
js/financas.js      contas, gastos, metas e projeção do mês
js/ferramentas.js   as 12 ferramentas que ele chama sozinho
js/vida.js          página "Minha vida"
js/store.js         localStorage + criptografia (AES-GCM / PBKDF2)
js/auth.js          cadastro, login, sessão, troca de senha
js/claude.js        cliente da API Anthropic (streaming SSE)
js/markdown.js      markdown → HTML com escape
js/app.js           navegação, chat, painel, configurações
sw.js               service worker (cache da casca do app)
manifest.json       instalação como app
server.js           servidor estático de desenvolvimento
__test.html         45 testes de lógica (abra no navegador)
__tooltest.html     83 testes de memória, finanças, teto de gasto e ferramentas
__uitest.html       67 testes de interface ponta-a-ponta
```

---

## Segurança — o que está e o que não está protegido

**Protegido:**

- Senhas nunca ficam salvas. Guardamos só o hash PBKDF2-SHA256 (210.000 iterações, sal aleatório
  por usuário), e a comparação é em tempo constante.
- A chave da API é criptografada com AES-GCM. A chave de criptografia é gerada como
  **não-exportável** e vive no IndexedDB: nem pelo console dá para extrair o valor bruto dela.
- O que o modelo responde é escapado antes de virar HTML — não há como uma resposta injetar script.
- Nada é enviado para nenhum servidor além da própria `api.anthropic.com`.

**Não protegido (e é bom você saber):**

- **Tudo mora neste navegador.** Limpar os dados do site apaga contas e conversas. Use
  *Exportar conversas* para fazer backup.
- **O login é local.** Não existe servidor validando nada: quem tiver acesso ao seu navegador
  desbloqueado tem acesso ao app. É uma tranca de porta, não um cofre de banco.
- **A chave da API fica no dispositivo** e é usada direto do navegador (header
  `anthropic-dangerous-direct-browser-access`). Perfeito para a *sua* chave no *seu* aparelho —
  inadequado para uma chave compartilhada entre várias pessoas.

Se um dia isso virar multiusuário de verdade, o caminho é um backend fino que guarde a chave no
servidor e faça proxy das chamadas. O `js/store.js` e o `js/auth.js` foram escritos isolados
justamente para essa troca ser localizada.

---

## Modelos disponíveis

| Modelo | Quando usar | US$ / 1M entrada | US$ / 1M saída |
|---|---|---|---|
| **Claude Opus 5** (padrão) | melhor equilíbrio geral | 5 | 25 |
| **Claude Sonnet 5** | dia a dia, mais barato | 3 | 15 |
| **Claude Haiku 4.5** | tarefas simples, alto volume | 1 | 5 |
| **Claude Fable 5** | trabalho difícil e longo | 10 | 50 |

### Teto de gasto

A API é o **único** custo deste projeto — hospedagem, voz e armazenamento são todos de graça.
Por isso ela tem freio: em **Chave & Modelo** você define um teto em US$ por mês. Ao atingir,
o app para de enviar mensagens e explica isso no chat, até você aumentar o teto ou virar o mês.
O painel mostra o quanto já foi, com aviso aos 80%.

O contador é uma **estimativa** feita a partir dos tokens de cada resposta; a cobrança real é
a do console da Anthropic. Use como freio, não como extrato.

O painel soma os tokens gastos e mostra uma **estimativa** de custo. A conta real é a do
console da Anthropic.

Em **Chave & Modelo** dá para ajustar o esforço de raciocínio, o tamanho máximo da resposta,
se o raciocínio aparece na tela, e a personalidade do copiloto (o system prompt — `{{nome}}`
é trocado pelo seu primeiro nome).

---

## Testes

Com o servidor rodando, abra:

- <http://localhost:5173/__test.html> — criptografia, login, storage, markdown, parser SSE e o
  formato exato das requisições de cada modelo.
- <http://localhost:5173/__uitest.html> — fluxo completo pela interface: cadastro → criação do
  personagem → chave → conversa → painel → recarregar → sair. Inclui um assert de que
  nenhum erro de JavaScript ocorreu no caminho.

O resultado aparece na própria página.

---

## Próximos passos possíveis

Em ordem de valor para o uso com TDAH:

1. **Memória entre conversas** — hoje cada conversa começa do zero. Um arquivo vivo de
   pendências e um diário automático fariam ele lembrar do que ficou pendente ontem.
2. **Rituais** — /manhã (o que importa hoje), /noite (fechamento), /socorro (travei agora).
3. **Rodar sem você** — resumo pronto quando você acorda, sem precisar abrir nada.
4. Sincronizar entre celular e desktop.
5. Anexar arquivos e imagens; busca dentro das conversas.
