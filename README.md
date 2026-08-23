# TDAHZEI

Copiloto pessoal para quem tem TDAH, em HTML/CSS/JS puro (sem build, sem framework,
sem dependências). Funciona no desktop e no celular, e instala como app (PWA).
Conversa por texto **ou por voz ao vivo**, e anota tudo sozinho enquanto vocês falam.

A ideia central: em vez de um chat genérico, você **cria um personagem** — classe,
atributos, nome, avatar e voz — e ele carrega o seu contexto em toda conversa.

---

## JarvisOS do PDF

O guia `jarvisos-assistente-pessoal.pdf` foi aplicado em duas camadas:

- **No app online:** a aba **JarvisOS** traz `00-Inbox`, `Diario`, `contexto.md`,
  `pendencias.md`, `.claudeignore` e as skills Caixa, Plano, Fechamento,
  Tendencias e Metricas, tudo sincronizado entre celular e desktop.
- **No ambiente local:** este repo agora tem `.claude/skills/` com as cinco skills
  do JarvisOS, `jarvisos/templates/Vault/` com a estrutura Obsidian/markdown e
  `jarvisos/scripts/` com o loop PowerShell `jarvis.ps1`.

Nesta maquina tambem foram instalados:

- Poppler / `pdftotext` via Winget.
- `whisper-cli.exe` em `~/tools/whisper.cpp/Release/`.
- `ggml-base.bin` em `~/models/`, modelo sem `.en` para portugues.
- Vault local em `~/Vault`.
- Skills globais em `~/.claude/skills/{caixa,fechamento,plano,metricas,tendencias}`.

Rodar o loop local:

```powershell
ffmpeg -list_devices true -f dshow -i dummy
powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\jarvis.ps1 -Mic "NOME DO MICROFONE"
```

Rodar a caixa sem voz:

```powershell
powershell -ExecutionPolicy Bypass -File .\jarvisos\scripts\caixa.ps1
```

O PDF era Mac-first (`brew`, `say`, `launchd`). No Windows, o equivalente aplicado foi
`ffmpeg` com `dshow`, voz SAPI e scripts PowerShell.

---

## Como rodar

```bash
node server.cjs
```

Abra <http://localhost:5173>.

> **O `server.cjs` é obrigatório**, não é só um servidor de arquivos. Ele faz o proxy
> das chamadas para a OpenAI (`/api/openai/…`) — sem ele a conversa e a voz não funcionam.
> Um `python -m http.server` serve as telas, mas nada responde.

> **Não abra o `index.html` com duplo clique.** Em `file://` o navegador bloqueia a
> WebCrypto, o microfone e o `fetch`.

### Primeiros passos

1. Crie sua conta (nome, e-mail, senha).
2. O **criador de personagem** abre sozinho: quem você é, o que te trava, e aí a classe,
   os atributos, o nome e a voz do seu TDAHzeiro. Leva uns 3 minutos.
3. Cole sua chave da OpenAI (`sk-…`) em **Chave & Modelo** e clique em **Salvar e testar**.
   A chave sai de <https://platform.openai.com/api-keys>.
4. Pronto: o agente liga sozinho e começa a falar com você. O botão na barra do topo
   desliga quando você quiser.

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

E grava sozinho, conversando, através de 13 ferramentas. Você diz *"gastei 40 no ifood"*
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
| `atualizar_avatar` | você conta algo sobre sua aparência ou o que te cerca |

Ao abrir o app, o **briefing** mostra o que venceu, o que atrasou e o que estourou —
sem você precisar perguntar. Os **rituais** (*Bom dia*, *Travei*, *Fechamento*, *Grana*)
são atalhos para as horas que mais pegam.

### O seu boneco

A memória não é só uma lista. Conforme ele aprende quem você é, isso vira **gente**:
um avatar ilustrado que se monta sozinho, no painel e na página do perfil.

Três camadas alimentam a ficha, nesta ordem:

1. **o que você ajustou à mão** — nunca é sobrescrito
2. **o que ele definiu conversando** — a ferramenta `atualizar_avatar`
3. **o que dá para deduzir dos fatos** — varredura por palavra-chave na sua memória

Ou seja: se você já contou que tem um gato e usa óculos, o boneco nasce de óculos e com
o gato do lado, sem você configurar nada. E quando você diz *"cortei o cabelo bem curto"*
no meio de uma conversa, ele muda ali.

São nove traços (pele, cabelo, cor, olhos, barba, óculos, roupa, companhia, o que vive
por perto) mais os acessórios. Tudo desenhado em SVG por camadas — nítido em qualquer
tamanho, custo zero, muda na hora. Nenhuma imagem é gerada por API.

O boneco aparece na barra do topo, nas suas mensagens do chat e no painel, ao lado do nível.

**Nível e skins.** Fechar pendência, registrar coisas e conversar por voz dão XP. O nível
libera fundos para o avatar:

| Skin | Abre no nível |
|---|---|
| Grafite | 1 |
| Noite | 3 |
| Aurora | 5 |
| Oceano | 8 |
| Brasa | 12 |
| Ouro puro | 18 |

Em **Meu perfil** dá para ver a ficha inteira, trocar de skin, mudar a expressão do dia
e recomeçar o avatar do zero.

### Dinheiro

Contas a pagar com vencimento, gastos por categoria, metas e teto mensal. O diferencial
é a **projeção**: ele avisa que o mês *vai* estourar quando as contas em aberto forem
pagas, em vez de constatar o estouro depois.

### O agente — ele já vem ligado

A proposta não é um botão de "iniciar chamada". É alguém do seu lado. Você entra na conta e
**ele já está lá**: pede o microfone, cumprimenta você falando e diz o que está atrasado hoje.
Daí em diante é conversa aberta — você fala, ele responde, você corta ele no meio.

O botão fica na **barra do topo**, visível de qualquer página:

- **"Ativar agente"** — desligado. O microfone está solto.
- **"<nome> está ativo"** — no ar. Mostra os minutos e quanto já custou a sessão.

Clicar alterna. A escolha fica salva: se você desligar, ele continua desligado no próximo
login; se ligar, ele volta a entrar sozinho.

**Ele se levanta sozinho.** Queda de rede, sessão expirada, Wi-Fi que oscilou — ele espera
2s, 4s, 8s… e volta, sem cumprimentar de novo. Só desiste quando o erro não tem conserto
automático (chave recusada, microfone bloqueado no navegador) — e aí desliga o modo agente
e escreve na tela por onde a conexão passou, em vez de ficar tentando calado.

Enquanto conversam, ele continua chamando as 12 ferramentas: dizer *"gastei 40 no ifood"*
em voz alta registra o gasto na hora. O que é falado vira mensagem na **mesma conversa** do
chat escrito — a voz não é um modo à parte, alimenta o mesmo histórico e a mesma memória.

Por baixo: o `server.cjs` troca sua chave `sk-` por uma chave efêmera `ek-` (válida por
10 minutos), o navegador abre um WebRTC com o microfone, e os eventos trafegam num canal de
dados. A chave permanente nunca sai do seu computador.

Exige microfone liberado e **HTTPS ou localhost** — no IP da rede o navegador bloqueia.

#### Quanto custa deixar ligado

Isso importa: **o microfone aberto é cobrado por minuto mesmo quando ninguém fala.** No
`gpt-realtime-2.1` dá cerca de **US$ 1,50 por hora só ouvindo**, mais o que ele falar.

Três freios, em **Chave & Modelo**:

| Freio | O que faz |
|---|---|
| **Teto de gasto** | agora conta o áudio também. Ao estourar, o agente desliga sozinho |
| **Realtime 2.1 mini** | mesma conversa por cerca de um terço do preço |
| **Descansar sozinho** | desliga depois de X minutos sem conversa; um clique acorda |

De fábrica o descanso vem em **nunca** — ele fica de pé enquanto o app estiver aberto,
que é o comportamento pedido. Se ninguém definiu teto, ele avisa uma vez ao conectar.

### As outras duas vozes

**Ouvir uma resposta escrita.** Botão em cada mensagem, usando a voz do próprio navegador
(Web Speech API, custo zero). Dá para deixar falando sozinho a cada resposta. Voz,
velocidade e tom ficam no passo **Voz** do criador.

**Ditar em vez de digitar.** O microfone no campo de mensagem transcreve sua fala para o
campo de texto (Chrome/Edge, em HTTPS ou localhost). Você revisa antes de enviar. Não
funciona com o agente ligado — o microfone já está em uso.

---

## Usar no celular

O `server.cjs` mostra um endereço `http://192.168.x.x:5173` para a mesma rede Wi-Fi — funciona
para dar uma olhada, **mas em HTTP puro o navegador desliga a WebCrypto e o microfone**, então
login, cadastro e voz não funcionam fora de `localhost`.

Como o app agora depende do proxy em `/api/openai/…`, **host estático puro não serve mais**.
Para uso real no celular você precisa de um lugar que rode o `server.cjs` com HTTPS:

| Onde | Como |
|---|---|
| **Túnel para a sua máquina** | `npx localtunnel --port 5173` ou `cloudflared tunnel --url http://localhost:5173` |
| **Fly.io / Render / Railway** | suba a pasta; o comando é `node server.cjs` e a porta vem de `PORT` |
| **Um VPS qualquer** | `node server.cjs 5173` atrás de um nginx com TLS |

Com HTTPS no ar, abra no celular e use "Adicionar à tela de início" — ele abre em tela cheia,
sem barra de navegador, com ícone próprio.

O service worker guarda a casca do app (HTML/CSS/JS) para abrir sem rede, e nunca cacheia
`/api/`. As conversas em si sempre precisam de internet.

---

## O visual

Preto de verdade (`#000`), tipografia grande e apertada, botões em pílula e o azul
`#0071e3` como única cor de ação — a linguagem das páginas de produto da Apple, aplicada
a um app que se usa o dia todo.

As escolhas que sustentam isso, se você for mexer no CSS:

- **Nada de borda para separar** — quem separa é a cor da superfície e o espaço.
  `--panel` (`#1d1d1f`) sobre `--bg` (`#000`) já é a divisão.
- **Peso de fonte entre 400 e 600.** O que dá hierarquia é tamanho e `letter-spacing`
  negativo, não negrito.
- **Corpo em 17px**, títulos em `clamp()` — o herói do painel chega a 68px.
- **Barra lateral e topo com `backdrop-filter`**, translúcidos sobre o preto.
- **Largura máxima de 980px** no conteúdo, como a grade do site.

Os tokens estão todos no `:root` do `css/style.css`.

## Como está organizado

```
index.html          todas as telas (login, painel, chat, chave, perfil)
css/style.css       estilo base, mobile-first
css/persona.css     criador de personagem, ficha e perfil social
css/vida.css        briefing, listas, dinheiro e memória
js/icons.js         ícones SVG inline
js/persona.js       personagem, atributos, prompt gerado, voz e ditado
js/avatar.js        o seu boneco: ficha, dedução, desenho SVG e skins
js/wizard.js        criador de personagem em passos
js/memoria.js       fatos, pendências e diário
js/financas.js      contas, gastos, metas e projeção do mês
js/ferramentas.js   as 12 ferramentas que ele chama sozinho
js/vida.js          página "Minha vida"
js/store.js         localStorage + criptografia (AES-GCM / PBKDF2)
js/auth.js          cadastro, login, sessão, troca de senha
js/claude.js        cliente da API OpenAI (streaming SSE, ferramentas)
js/voz.js           o agente: Realtime API sobre WebRTC, com reconexão
js/markdown.js      markdown → HTML com escape
js/app.js           navegação, chat, painel, configurações
sw.js               service worker (cache da casca do app)
manifest.json       instalação como app
server.cjs           servidor local + proxy da OpenAI (obrigatório)
__test.html         46 testes de lógica, criptografia e formato da requisição
__tooltest.html     123 testes de memória, finanças, teto, ferramentas e avatar
__uitest.html       67 testes de interface ponta-a-ponta
__agentetest.html   31 testes do agente: liga sozinho, reconecta, desliga
__avatar_preview.html  galeria do boneco em todas as variações (só para olhar)
```

---

## Segurança — o que está e o que não está protegido

**Protegido:**

- Senhas nunca ficam salvas. Guardamos só o hash PBKDF2-SHA256 (210.000 iterações, sal aleatório
  por usuário), e a comparação é em tempo constante.
- A chave da API é criptografada com AES-GCM. A chave de criptografia é gerada como
  **não-exportável** e vive no IndexedDB: nem pelo console dá para extrair o valor bruto dela.
- O que o modelo responde é escapado antes de virar HTML — não há como uma resposta injetar script.
- Nada é enviado para nenhum servidor além do `server.cjs` que roda na sua máquina, e de lá
  para a `api.openai.com`.

**Não protegido (e é bom você saber):**

- **Tudo mora neste navegador.** Limpar os dados do site apaga contas e conversas. Use
  *Exportar conversas* para fazer backup.
- **O login é local.** Não existe servidor validando nada: quem tiver acesso ao seu navegador
  desbloqueado tem acesso ao app. É uma tranca de porta, não um cofre de banco.
- **A chave da API fica no dispositivo** e passa pelo `server.cjs` local a cada mensagem —
  ele não guarda nada, só repassa. Perfeito para a *sua* chave no *seu* aparelho; inadequado
  para uma chave compartilhada entre várias pessoas.
- **Se você expor o `server.cjs` na internet, o proxy fica aberto.** Ele aceita a chave que
  vier no corpo da requisição e não tem autenticação própria. Use túnel privado, não um IP público.

Se um dia isso virar multiusuário de verdade, o caminho é o `server.cjs` guardar a chave e
exigir login antes de repassar. O `js/store.js` e o `js/auth.js` foram escritos isolados
justamente para essa troca ser localizada.

---

## Modelos disponíveis

| Modelo | Quando usar | US$ / 1M entrada | US$ / 1M saída |
|---|---|---|---|
| **GPT-5.6 Terra** (padrão) | melhor equilíbrio geral | 2 | 12 |
| **GPT-5.6 Luna** | dia a dia, alto volume, check-ins | 0,20 | 1,20 |
| **GPT-5.6 Sol** | raciocínio pesado e planejamento | 5 | 30 |
| **GPT-5 mini** | caso sua conta ainda não tenha GPT-5.6 | 0,25 | 2 |

A voz ao vivo usa o `gpt-realtime-2.1` e é cobrada por áudio, à parte — mais cara que
texto por minuto de conversa. Dá para trocar pelo `gpt-realtime-2.1-mini` com a variável
de ambiente `KAO_REALTIME_MODEL`.

### Teto de gasto

A API é o **único** custo deste projeto — hospedagem, voz e armazenamento são todos de graça.
Por isso ela tem freio: em **Chave & Modelo** você define um teto em US$ por mês. Ao atingir,
o app para de enviar mensagens e de abrir a voz, até você aumentar o teto ou virar o mês.
O painel mostra o quanto já foi, com aviso aos 80%.

O contador é uma **estimativa** feita a partir dos tokens de cada resposta; a cobrança real é
a da plataforma da OpenAI. Use como freio, não como extrato.

O painel soma os tokens gastos e mostra uma **estimativa** de custo. A conta real é a da
plataforma da OpenAI. O contador cobre o texto; o áudio da voz ao vivo não entra nele.

Em **Chave & Modelo** dá para ajustar o esforço de raciocínio, o tamanho máximo da resposta,
se o raciocínio aparece na tela, e a personalidade do copiloto (o system prompt — `{{nome}}`
é trocado pelo seu primeiro nome).

---

## Testes

Com o servidor rodando, abra:

- <http://localhost:5173/__test.html> — criptografia, login, storage, markdown, parser SSE e o
  formato exato das requisições.
- <http://localhost:5173/__tooltest.html> — memória, finanças, teto de gasto, as 13 ferramentas,
  o laço de tool calling ida e volta e as três camadas do avatar.
- <http://localhost:5173/__uitest.html> — fluxo completo pela interface: cadastro → criação do
  personagem → chave → conversa → painel → recarregar → sair. Inclui um assert de que
  nenhum erro de JavaScript ocorreu no caminho.
- <http://localhost:5173/__agentetest.html> — o agente do começo ao fim: liga sozinho quando a
  chave aparece, monta a sessão certa, faz a oferta WebRTC, se recupera de resposta inválida,
  reconecta e obedece o botão de desligar.

O resultado aparece na própria página.

---

## Próximos passos possíveis

Em ordem de valor para o uso com TDAH:

1. **Rodar sem você** — resumo pronto quando você acorda, sem precisar abrir nada.
2. Sincronizar entre celular e desktop.
3. Anexar arquivos e imagens; busca dentro das conversas.
4. Interromper a voz por palavra-chave em vez de botão.
5. Ele começar a falar sozinho na hora certa (lembrete de remédio, conta vencendo)
   em vez de só responder.
