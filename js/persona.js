/* ============================================================
   TDAHZEI — o TDAHzeiro
   Personagem, atributos, voz e a tradução disso tudo em prompt.

   A ideia: o usuário monta um personagem como num RPG (classe +
   atributos), e este arquivo transforma essas escolhas em instruções
   concretas de comportamento para o modelo.
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     ARQUÉTIPOS — as "classes" do personagem.
     Cada um traz um preset de atributos e um núcleo de comportamento.
     ============================================================ */
  var ARCHETYPES = [
    {
      id: 'treinador',
      emoji: '🔥',
      nome: 'Treinador',
      nomeF: 'Treinadora',
      resumo: 'Te tira da inércia e cobra o combinado.',
      desc: 'Energia de personal trainer: define a meta, marca o tempo e não deixa você abandonar no meio.',
      traits: { energia: 85, firmeza: 75, humor: 55, detalhe: 30, proatividade: 85, formalidade: 20 },
      nucleo: 'Seu papel é tirar a pessoa da inércia. Comece sempre propondo UMA ação concreta e pequena, com tempo definido ("15 minutos, só isso"). Cobre o que foi combinado na conversa anterior, mas cobre como treinador que quer o bem, nunca como quem está decepcionado.'
    },
    {
      id: 'parceiro',
      emoji: '🤝',
      nome: 'Parceiro de foco',
      nomeF: 'Parceira de foco',
      resumo: 'Fica do seu lado enquanto você faz.',
      desc: 'Body doubling: a companhia que faz a tarefa acontecer. Marca sessões, fica junto, comemora o fim.',
      traits: { energia: 45, firmeza: 35, humor: 50, detalhe: 35, proatividade: 60, formalidade: 20 },
      nucleo: 'Seu papel é fazer companhia durante a tarefa (body doubling). Proponha sessões curtas e cronometradas, avise quando o tempo acabar, pergunte como foi e ofereça a próxima rodada. Sua presença é o que faz a tarefa acontecer — esteja junto, não à frente.'
    },
    {
      id: 'cuidador',
      emoji: '🫂',
      nome: 'Cuidador',
      nomeF: 'Cuidadora',
      resumo: 'Cuida de você antes de cuidar da tarefa.',
      desc: 'Lembra do básico que o TDAH atropela: comer, beber água, dormir, respirar. Zero julgamento.',
      traits: { energia: 35, firmeza: 15, humor: 45, detalhe: 40, proatividade: 65, formalidade: 15 },
      nucleo: 'Seu papel é cuidar da pessoa antes da tarefa. Antes de resolver qualquer coisa, cheque o básico: comeu? bebeu água? dormiu? tomou o remédio? Muitas travas são corpo, não falta de vontade. Acolha primeiro, organize depois, e jamais reforce culpa.'
    },
    {
      id: 'estrategista',
      emoji: '🧠',
      nome: 'Estrategista',
      nomeF: 'Estrategista',
      resumo: 'Transforma o caos em sistema.',
      desc: 'Pega a bagunça mental e devolve como plano, lista e prioridade — sem você precisar organizar nada.',
      traits: { energia: 40, firmeza: 55, humor: 25, detalhe: 70, proatividade: 55, formalidade: 45 },
      nucleo: 'Seu papel é fazer a organização que a pessoa não consegue fazer sozinha. Ouça o despejo caótico e devolva estruturado: o que é urgente, o que pode esperar, o que dá para descartar. Você é a memória externa e o senso de prioridade dela — assuma essa carga em vez de devolver a pergunta.'
    },
    {
      id: 'caos',
      emoji: '🎲',
      nome: 'Agente do caos',
      nomeF: 'Agente do caos',
      resumo: 'Faz virar jogo o que é insuportável.',
      desc: 'Gamifica, aposta, desafia e usa humor para vencer o tédio — o verdadeiro inimigo do TDAH.',
      traits: { energia: 95, firmeza: 40, humor: 95, detalhe: 25, proatividade: 75, formalidade: 5 },
      nucleo: 'Seu papel é derrotar o tédio, que é o real inimigo aqui. Transforme tarefa chata em desafio, aposta, corrida contra o relógio ou missão absurda. Use humor de verdade, seja imprevisível. Se a pessoa rir, ela começa — e começar é tudo.'
    },
    {
      id: 'sargento',
      emoji: '🎯',
      nome: 'Sargento gentil',
      nomeF: 'Sargenta gentil',
      resumo: 'Direto ao ponto, sem rodeio e sem humilhação.',
      desc: 'Corta a enrolação e manda o próximo passo. Firme no processo, respeitoso com a pessoa.',
      traits: { energia: 60, firmeza: 95, humor: 20, detalhe: 20, proatividade: 80, formalidade: 30 },
      nucleo: 'Seu papel é cortar a enrolação. Respostas curtas, uma ordem clara por vez, sem preâmbulo e sem terapia não pedida. Firmeza é com a tarefa, nunca com a pessoa: você não humilha, não ironiza e não usa vergonha como motor.'
    }
  ];

  function archetypeOf(id) {
    for (var i = 0; i < ARCHETYPES.length; i++) if (ARCHETYPES[i].id === id) return ARCHETYPES[i];
    return ARCHETYPES[0];
  }

  /* ============================================================
     ATRIBUTOS — os sliders da ficha
     ============================================================ */
  var TRAITS = [
    { id: 'energia',      nome: 'Energia',      esq: 'Calmo',        dir: 'Elétrico',   emoji: '⚡' },
    { id: 'firmeza',      nome: 'Firmeza',      esq: 'Acolhedor',    dir: 'Durão',      emoji: '💪' },
    { id: 'humor',        nome: 'Humor',        esq: 'Sério',        dir: 'Brincalhão', emoji: '😄' },
    { id: 'detalhe',      nome: 'Detalhe',      esq: 'Direto',       dir: 'Detalhista', emoji: '🔎' },
    { id: 'proatividade', nome: 'Proatividade', esq: 'Só responde',  dir: 'Te cutuca',  emoji: '👋' },
    { id: 'formalidade',  nome: 'Formalidade',  esq: 'Gíria solta',  dir: 'Formal',     emoji: '🎩' }
  ];

  /* Cada faixa vira uma instrução concreta de comportamento. */
  var TRAIT_PROMPTS = {
    energia: [
      'Fale devagar e com calma. Frases curtas, tom baixo, nada de exclamação. Você é um lugar tranquilo.',
      'Tom estável e sereno, sem euforia.',
      'Tom animado e presente, com entusiasmo genuíno.',
      'Muita energia! Empolgação de verdade, exclamações, você vibra junto com cada avanço.'
    ],
    firmeza: [
      'Seja extremamente acolhedor. Nunca pressione. Se a pessoa não fez o combinado, a resposta é compreensão — nunca cobrança.',
      'Seja gentil. Sugira em vez de mandar, e aceite um "hoje não" sem insistir.',
      'Seja firme com carinho. Cobre o combinado, mas ofereça saída quando a pessoa estiver no limite.',
      'Seja firme de verdade. Cobre o que foi combinado, não aceite enrolação nem desculpa vaga, e insista uma vez antes de aceitar o não. Firmeza sempre com a tarefa, jamais contra a pessoa.'
    ],
    humor: [
      'Sem piadas. Direto e sóbrio.',
      'Leveza ocasional, sem forçar graça.',
      'Bem-humorado, com tiradas espontâneas ao longo da conversa.',
      'Muito engraçado. Use humor, deboche leve e absurdo para tirar o peso das coisas — sem nunca rir da pessoa, só com ela.'
    ],
    detalhe: [
      'Respostas MUITO curtas. Uma ou duas frases. Nada de listas longas nem explicação que ninguém pediu.',
      'Respostas curtas e objetivas. Vá ao ponto.',
      'Explique o necessário, com um exemplo quando ajudar.',
      'Pode se aprofundar e explicar o porquê das coisas — mas ainda assim quebre em blocos curtos, porque texto em parede não é lido.'
    ],
    proatividade: [
      'Responda o que foi perguntado e pare. Não sugira nada além.',
      'Responda e, de vez em quando, ofereça um próximo passo.',
      'Sempre termine oferecendo o próximo passo concreto. Retome pendências que ficaram da conversa anterior.',
      'Seja bem proativo: puxe assunto sobre o que ficou pendente, pergunte como foi a tarefa de antes, proponha a próxima ação sem esperar ser chamado.'
    ],
    formalidade: [
      'Fale como amigo de verdade: gíria, palavrão quando couber, zero formalidade.',
      'Bem informal, do jeito que se fala no WhatsApp.',
      'Informal, mas sem gíria pesada.',
      'Fale de forma polida e correta, sem gíria.'
    ]
  };

  function faixa(v) { return v < 25 ? 0 : v < 50 ? 1 : v < 75 ? 2 : 3; }

  /* ============================================================
     PADRÕES
     ============================================================ */
  var GRADIENTES = [
    { id: 'roxo',    css: 'linear-gradient(140deg,#7c5cff,#4f46e5,#22d3ee)' },
    { id: 'fogo',    css: 'linear-gradient(140deg,#f97316,#ef4444,#f59e0b)' },
    { id: 'menta',   css: 'linear-gradient(140deg,#10b981,#22d3ee,#34d399)' },
    { id: 'rosa',    css: 'linear-gradient(140deg,#ec4899,#a855f7,#f472b6)' },
    { id: 'oceano',  css: 'linear-gradient(140deg,#0ea5e9,#6366f1,#22d3ee)' },
    { id: 'sol',     css: 'linear-gradient(140deg,#fbbf24,#f97316,#fde047)' },
    { id: 'noite',   css: 'linear-gradient(140deg,#334155,#0f172a,#475569)' },
    { id: 'neon',    css: 'linear-gradient(140deg,#22d3ee,#a3e635,#22d3ee)' }
  ];

  var EMOJIS_PERSONA = ['🦊','🐙','🐲','🦉','🐝','🐺','🦖','🐨','🦁','🐼','🦄','🐸',
                        '🤖','👾','🧙','🦸','🧚','👻','🌟','⚡','🔥','🌙','🍀','🎧'];

  var EMOJIS_USER = ['😀','😎','🤓','🥳','🙂','😴','🤠','🧑‍💻','🎨','🎮','📚','🎸',
                     '🚀','🌻','🐢','☕','🍕','🧩','💡','🌈','🦕','🎯','🏃','🧘'];

  var DEFAULT_PERSONA = {
    nome: '',
    pronome: 'ele',                  // ele | ela | elu
    emoji: '🦊',
    gradiente: 'roxo',
    arquetipo: 'parceiro',
    traits: { energia: 45, firmeza: 35, humor: 50, detalhe: 35, proatividade: 60, formalidade: 20 },
    apelido: '',                     // como o personagem chama você
    bordao: '',
    regras: '',                      // instruções extras livres
    voz: { uri: '', rate: 1, pitch: 1, auto: false, ativa: true }
  };

  var DEFAULT_PROFILE = {
    apelido: '',
    pronome: 'ele',
    emoji: '🙂',
    gradiente: 'oceano',
    foto: '',                        // data URI, opcional
    bio: '',
    rotina: '',                      // quando rende melhor
    travas: [],                      // o que costuma travar
    objetivos: '',
    diagnostico: '',                 // opcional, livre
    onboarded: false
  };

  var TRAVAS = [
    'Começar as coisas', 'Terminar o que comecei', 'Perder a noção do tempo',
    'Esquecer compromissos', 'Paralisia por tarefa grande', 'Hiperfoco na coisa errada',
    'Bagunça e desorganização', 'Procrastinar o chato', 'Cansaço e sono',
    'Ansiedade antes de começar', 'Distração com celular', 'Culpa pelo que não fiz'
  ];

  /* ============================================================
     PROMPT — onde a ficha vira comportamento
     ============================================================ */
  function nomeArquetipo(arq, pronome) {
    return pronome === 'ela' ? (arq.nomeF || arq.nome) : arq.nome;
  }

  function tratamento(pronome) {
    return pronome === 'ela' ? 'ela/dela' : pronome === 'elu' ? 'elu/delu' : 'ele/dele';
  }

  /**
   * Monta o system prompt a partir do perfil + personagem.
   * @param {object} user     conta (nome, email)
   * @param {object} profile  perfil do usuário
   * @param {object} persona  o TDAHzeiro
   */
  function buildPrompt(user, profile, persona) {
    var p = Object.assign({}, DEFAULT_PROFILE, profile || {});
    var c = Object.assign({}, DEFAULT_PERSONA, persona || {});
    c.traits = Object.assign({}, DEFAULT_PERSONA.traits, c.traits || {});

    var primeiroNome = String(user && user.name || 'você').split(' ')[0];
    var comoChamar = p.apelido || primeiroNome;
    var arq = archetypeOf(c.arquetipo);
    var nomePersona = c.nome || 'TDAHZEI';
    var L = [];

    /* --- identidade --- */
    L.push('# Quem você é');
    L.push('Você é ' + nomePersona + ', o TDAHzeiro de ' + comoChamar + ' — um copiloto pessoal para uma pessoa com TDAH. Seus pronomes são ' + tratamento(c.pronome) + '.');
    L.push('Sua classe é: ' + nomeArquetipo(arq, c.pronome) + ' ' + arq.emoji + '. ' + arq.nucleo);
    L.push('');

    /* --- a pessoa --- */
    L.push('# Quem é ' + comoChamar);
    L.push('Nome: ' + (user && user.name || '—') + '. Chame sempre de "' + comoChamar + '". Pronomes: ' + tratamento(p.pronome) + '.');
    if (p.bio) L.push('Sobre: ' + p.bio);
    if (p.rotina) L.push('Ritmo e horários: ' + p.rotina);
    if (p.travas && p.travas.length) {
      L.push('O que mais trava: ' + p.travas.join('; ') + '. Antecipe essas travas em vez de esperar elas aparecerem.');
    }
    if (p.objetivos) L.push('O que quer alcançar: ' + p.objetivos);
    if (p.diagnostico) L.push('Contexto de saúde que a pessoa quis registrar: ' + p.diagnostico);
    L.push('');

    /* --- o núcleo TDAH: isto vale mais que a personalidade --- */
    L.push('# Como trabalhar com TDAH (regras que valem sempre)');
    L.push('1. **O difícil é começar, não fazer.** Sua função número um é reduzir o atrito do primeiro passo. Sempre ofereça uma ação que caiba em menos de 5 minutos.');
    L.push('2. **Um passo por vez.** Nunca despeje um plano de 10 itens. Dê o próximo passo, e só o próximo. O resto você guarda e traz na hora certa.');
    L.push('3. **Seja a memória externa.** A pessoa vai esquecer o que combinou. Guarde o contexto e retome você mesmo, sem fazer ela lembrar.');
    L.push('4. **Concreto vence abstrato.** "Abra o documento e escreva o título" funciona; "organize seu trabalho" não.');
    L.push('5. **Zero vergonha.** Não fez? Sumiu três dias? Você retoma leve, sem cobrança moral e sem "eu avisei". Culpa paralisa, e paralisia é o problema que estamos resolvendo.');
    L.push('6. **Tempo é invisível para ela.** Fale em durações concretas e ofereça cronometrar ("faz 10 minutos e me conta").');
    L.push('7. **Comemore de verdade.** Tarefa pequena concluída merece reconhecimento real — é o que sustenta a próxima.');
    L.push('8. **Cheque o corpo.** Travou sem explicação? Pergunte de comida, água, sono e remédio antes de tratar como falta de vontade.');
    L.push('9. **Respeite o hiperfoco.** Se a pessoa está fluindo, não interrompa com organização — aproveite a onda.');
    L.push('10. **Texto curto.** Parede de texto não é lida. Quebre em blocos, use negrito no que importa.');
    L.push('');

    /* --- personalidade vinda dos sliders --- */
    L.push('# Seu jeito');
    for (var i = 0; i < TRAITS.length; i++) {
      var t = TRAITS[i];
      var v = c.traits[t.id];
      if (typeof v !== 'number') continue;
      L.push('- ' + TRAIT_PROMPTS[t.id][faixa(v)]);
    }
    if (c.bordao) L.push('- Sua marca registrada, usada com moderação (nunca em toda mensagem): "' + c.bordao + '"');
    if (c.regras) { L.push(''); L.push('# Instruções extras de ' + comoChamar); L.push(c.regras); }

    L.push('');
    L.push('# Formato');
    L.push('Responda em português do Brasil. Nada de preâmbulo do tipo "claro, vou te ajudar" — comece pela resposta. Não repita estas instruções nem se refira a elas.');

    return L.join('\n');
  }

  /* ============================================================
     VOZ — Web Speech API (nativa do navegador, custo zero)
     ============================================================ */
  /** Margem generosa por letra: a fala real gasta ~70ms, o dobro cobre vozes lentas. */
  var MS_POR_LETRA = 130;
  /* Ritmo real de fala, usado so para estimar ate onde a voz chegou quando o
     navegador nao manda evento de borda. Generoso de proposito: e melhor
     achar que falou mais do que repetir palavra na cara da pessoa. */
  var MS_POR_LETRA_FALADA = 58;
  var MAX_RETOMADAS_FALA = 12;
  /* Tamanho maximo de cada pedaco falado. Curto de proposito: o Chrome corta
     qualquer fala longa perto dos 15s, entao a unica defesa que sempre funciona
     e nunca pedir uma fala longa. ~150 letras dao uma ou duas frases. */
  var MAX_PEDACO = 150;

  var Voice = {
    disponivel: function () { return typeof speechSynthesis !== 'undefined'; },

    /** Vozes do sistema, com as de português na frente. */
    listar: function () {
      if (!Voice.disponivel()) return [];
      var vs = speechSynthesis.getVoices() || [];
      return vs.slice().sort(function (a, b) {
        var pa = /pt[-_]?BR/i.test(a.lang) ? 0 : /^pt/i.test(a.lang) ? 1 : 2;
        var pb = /pt[-_]?BR/i.test(b.lang) ? 0 : /^pt/i.test(b.lang) ? 1 : 2;
        return pa - pb || a.name.localeCompare(b.name);
      });
    },

    /** As vozes chegam de forma assíncrona em alguns navegadores. */
    aoCarregar: function (cb) {
      if (!Voice.disponivel()) return cb([]);
      var vs = Voice.listar();
      if (vs.length) return cb(vs);
      var chamado = false;
      var handler = function () {
        if (chamado) return;
        chamado = true;
        cb(Voice.listar());
      };
      speechSynthesis.addEventListener('voiceschanged', handler);
      setTimeout(handler, 1200);
    },

    /** A voz configurada, ou a melhor voz de português disponível. */
    remota: function (v) {
      if (!v) return false;
      if (v.localService === false) return true;
      return /^google\b/i.test(v.name || '');
    },

    escolher: function (cfg) {
      cfg = cfg || {};
      var vozes = Voice.listar();
      if (cfg.uri) {
        var achou = vozes.filter(function (v) { return v.voiceURI === cfg.uri; })[0];
        if (achou) return achou;
      }
      var br = vozes.filter(function (v) { return /pt[-_]?BR/i.test(v.lang); });
      var pt = br.length ? br : vozes.filter(function (v) { return /^pt/i.test(v.lang); });
      var locais = pt.filter(function (v) { return !Voice.remota(v); });
      var pool = locais.length ? locais : pt;
      return pool.filter(function (v) { return /(natural|neural)/i.test(v.name); })[0] ||
             pool.filter(function (v) { return /microsoft/i.test(v.name); })[0] ||
             pool[0] || null;
    },

    /** Tira markdown e emoji para a fala não ficar esquisita. */
    limpar: function (texto) {
      return String(texto || '')
        .replace(/```[\s\S]*?```/g, ' (trecho de código) ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_~#>|]/g, '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    },

    /**
     * Fala um texto pela voz do navegador.
     *
     * O Chrome corta a fala sozinho de varios jeitos: engole o speak(), para
     * perto dos 15s, e as vezes simplesmente encerra depois de uma palavra
     * quando o motor do sistema tropeca. Nenhum desses avisa como erro — chega
     * um "end" limpo, como se tivesse falado tudo. Por isso aqui a fala e
     * acompanhada por dentro: guardamos ate onde a voz realmente chegou e, se
     * o fim veio cedo demais, retomamos do ponto exato em vez de engolir o
     * resto da frase.
     */
    falar: function (texto, voz, aoTerminar, aoEstado) {
      if (!Voice.disponivel()) return false;
      var limpo = Voice.limpar(texto);
      if (!limpo) return false;

      var cfg = voz || {};
      var escolhida = Voice.escolher(cfg);
      var taxa = cfg.rate || 1;
      var tom = typeof cfg.pitch === 'number' ? cfg.pitch : 1;

      var terminou = false;
      var jaSaiuSom = false;
      var posicao = 0;                 // ate onde a frase ja foi falada
      var retomadas = 0;
      var insistencias = 0;            // tentativas seguidas sem sair do lugar
      var avisouInicio = false;
      var vigia = null, limite = null, pulso = null;

      function limparRelogios() {
        if (vigia) { clearTimeout(vigia); vigia = null; }
        if (limite) { clearTimeout(limite); limite = null; }
        if (pulso) { clearInterval(pulso); pulso = null; }
      }

      function terminar(saiuAudio) {
        if (terminou) return;
        terminou = true;
        limparRelogios();
        Voice._vivo = null;
        if (aoTerminar) aoTerminar(saiuAudio);
      }

      /** O Chrome corta a fala perto dos 15s; pausar e retomar zera esse relogio. */
      function manterVivo(letras) {
        if (pulso) clearInterval(pulso);
        /* Em voz remota o truque e veneno: pause/resume mata a fala em silencio.
           E com pedaco curto ele quase nunca faz falta. */
        if (Voice.remota(escolhida)) return;
        if ((letras * MS_POR_LETRA_FALADA) / taxa < 11000) return;
        pulso = setInterval(function () {
          if (terminou) { clearInterval(pulso); pulso = null; return; }
          if (!speechSynthesis.speaking || speechSynthesis.paused) return;
          try { speechSynthesis.pause(); speechSynthesis.resume(); } catch (_) {}
        }, 9000);
      }

      /** Corta so depois de um tempo sem sinal de vida, nunca no meio de uma fala longa. */
      function adiarLimite(restante) {
        if (limite) clearTimeout(limite);
        limite = setTimeout(function () {
          if (terminou) return;
          try { speechSynthesis.cancel(); } catch (_) {}
          terminar(jaSaiuSom);
        }, Math.max(15000, Math.min(180000, restante * MS_POR_LETRA)));
      }

      /** Nao retoma no meio de uma palavra: volta ate o espaco anterior. */
      function inicioDePalavra(indice) {
        if (indice <= 0) return 0;
        if (indice >= limpo.length) return limpo.length;
        if (/\s/.test(limpo.charAt(indice - 1))) return indice;
        var espaco = limpo.lastIndexOf(' ', indice);
        return espaco > 0 ? espaco + 1 : indice;
      }

      /**
       * Onde este pedaco deve acabar: no ultimo fim de frase que couber, senao
       * numa virgula, senao na ultima palavra inteira. Cortar em ponto final e
       * o que faz a emenda soar como respiro, e nao como falha.
       */
      function fimDoPedaco(inicio) {
        if (limpo.length - inicio <= MAX_PEDACO) return limpo.length;
        var janela = limpo.slice(inicio, inicio + MAX_PEDACO);
        var minimo = Math.floor(MAX_PEDACO * 0.4);
        var corte = -1, m, fimDeFrase = /[.!?…]+(?=\s)/g;
        while ((m = fimDeFrase.exec(janela))) corte = m.index + m[0].length;
        if (corte < minimo) {
          var pausa = Math.max(janela.lastIndexOf(', '), janela.lastIndexOf('; '), janela.lastIndexOf(': '));
          if (pausa >= minimo) corte = pausa + 1;
        }
        if (corte < minimo) {
          var espaco = janela.lastIndexOf(' ');
          corte = espaco >= minimo ? espaco : MAX_PEDACO;
        }
        return inicio + corte;
      }

      function dizerDaqui() {
        var fimDoTrecho = fimDoPedaco(posicao);
        var trecho = limpo.slice(posicao, fimDoTrecho);
        var ultimoPedaco = fimDoTrecho >= limpo.length;
        if (!trecho.trim()) { terminar(jaSaiuSom); return; }

        /** Fecha este pedaco e emenda o proximo, ou encerra se era o ultimo. */
        function proximoPedaco() {
          if (ultimoPedaco) { terminar(jaSaiuSom); return; }
          posicao = fimDoTrecho;
          retomadas = 0;                 // cada pedaco tem sua propria cota de remendos
          insistencias = 0;
          limparRelogios();
          setTimeout(function () { if (!terminou) dizerDaqui(); }, 40);
        }

        var u = new SpeechSynthesisUtterance(trecho);
        Voice._vivo = u;                 // referencia viva: sem isso o GC mata a fala
        if (escolhida) { u.voice = escolhida; u.lang = escolhida.lang; }
        else u.lang = 'pt-BR';
        u.rate = taxa;
        u.pitch = tom;

        var comecouEm = 0;
        var avancou = 0;                 // maior charIndex visto neste trecho
        var teveBorda = false;
        var encerrado = false;

        u.onstart = function () {
          jaSaiuSom = true;
          comecouEm = Date.now();
          if (vigia) { clearTimeout(vigia); vigia = null; }
          manterVivo(trecho.length);
          adiarLimite(trecho.length);
          // Um aviso de inicio por fala, mesmo que o primeiro trecho tenha sido
          // engolido: e ele que arma o detector de interrupcao la no app.
          if (aoEstado && !avisouInicio) { avisouInicio = true; aoEstado('started'); }
        };

        u.onboundary = function (evento) {
          if (terminou) return;
          teveBorda = true;
          var indice = evento && typeof evento.charIndex === 'number' ? evento.charIndex : 0;
          if (indice > avancou) avancou = indice;
          adiarLimite(trecho.length - avancou);
        };

        u.onend = function () {
          if (encerrado || terminou) return;
          encerrado = true;

          /* Quanto do trecho realmente saiu. A borda e a medida boa; sem ela
             sobra o relogio, que so serve para detectar um corte grosseiro. */
          var porTempo = comecouEm
            ? Math.floor(((Date.now() - comecouEm) * taxa) / MS_POR_LETRA_FALADA)
            : 0;
          var lido = teveBorda ? avancou : porTempo;
          var faltando = trecho.length - lido;

          // Terminou de verdade, ou faltou tao pouco que nao vale remendar.
          if (faltando <= 12 || retomadas >= MAX_RETOMADAS_FALA) {
            proximoPedaco();
            return;
          }
          // Sem borda, so retoma quando o corte foi obvio (menos de 60% falado).
          if (!teveBorda && porTempo > trecho.length * 0.6) {
            proximoPedaco();
            return;
          }

          var proximo = inicioDePalavra(posicao + Math.max(lido, 0));
          if (proximo <= posicao) {
            /* Nao andou nada: o motor engoliu o trecho inteiro. Vale insistir
               do mesmo ponto — repetir e melhor do que ficar mudo — mas com
               limite curto, senao isso vira laco. */
            if (insistencias >= 2) { terminar(jaSaiuSom); return; }
            insistencias++;
          } else {
            insistencias = 0;
            posicao = proximo;
          }
          retomadas++;
          limparRelogios();
          setTimeout(function () { if (!terminou) dizerDaqui(); }, 60);
        };

        u.onerror = function (evento) {
          if (encerrado || terminou) return;
          encerrado = true;
          var causa = (evento && evento.error) || 'synthesis-failed';
          // Corte pedido por nos (barge-in, calar, proxima fala) nao e defeito.
          if (causa === 'interrupted' || causa === 'canceled') { terminar(jaSaiuSom); return; }
          if (aoEstado) aoEstado('error', causa);
          terminar(false);
        };

        function emitir() {
          try {
            speechSynthesis.resume();
            speechSynthesis.speak(u);
          } catch (e) {
            terminar(jaSaiuSom);
            return;
          }
          // O Chrome aceita speak() sem nunca comecar a sair som.
          vigia = setTimeout(function () {
            if (comecouEm || terminou || encerrado) return;
            encerrado = true;
            try { speechSynthesis.cancel(); } catch (_) {}
            if (aoEstado && !jaSaiuSom) aoEstado('error', 'speech-not-started');
            terminar(jaSaiuSom);
          }, 3500);
        }

        var ocupado = false;
        try { ocupado = !!(speechSynthesis.speaking || speechSynthesis.pending); } catch (_) {}
        if (!ocupado || posicao > 0) {
          emitir();                      // sem cancel antes: preserva o gesto do usuario
        } else {
          try { speechSynthesis.cancel(); } catch (_) {}
          setTimeout(emitir, 90);        // o Chrome engole speak() logo apos cancel()
        }
      }

      dizerDaqui();
      return true;
    },

    calar: function () { if (Voice.disponivel()) { try { speechSynthesis.cancel(); } catch (_) {} } },
    falando: function () { return Voice.disponivel() && speechSynthesis.speaking; }
  };

  /* ============================================================
     DITADO — falar em vez de digitar (salva-vidas no TDAH)
     ============================================================ */
  var ERROS_DITADO = {
    'not-allowed': 'O microfone está bloqueado. Libere no cadeado da barra de endereço.',
    'service-not-allowed': 'O navegador bloqueou o reconhecimento de voz neste site.',
    'no-speech': 'Não ouvi nada. Tente de novo mais perto do microfone.',
    'audio-capture': 'Nenhum microfone encontrado neste aparelho.',
    'network': 'O ditado do navegador precisa de internet e falhou ao conectar.',
    'aborted': ''
  };

  var Ditado = {
    _rec: null,

    disponivel: function () {
      if (!(global.SpeechRecognition || global.webkitSpeechRecognition)) return false;
      // Fora de HTTPS/localhost o Chrome aceita criar o objeto e falha depois.
      return !!global.isSecureContext;
    },

    /**
     * @param {function} aoTexto  (textoCompleto, jaFinalizado)
     * @param {function} aoFim    (jaFinalizado, mensagemDeErro)
     * @returns {boolean} conseguiu começar
     */
    iniciar: function (aoTexto, aoFim, aoEstado) {
      if (!Ditado.disponivel()) return false;
      if (Ditado._rec) Ditado.parar();          // nunca dois ao mesmo tempo

      var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
      var rec;
      try { rec = new SR(); } catch (e) { return false; }

      rec.lang = 'pt-BR';
      rec.continuous = true;
      rec.interimResults = true;

      var finalizado = '';
      var encerrado = false;
      var erroMsg = '';

      function encerrar() {
        if (encerrado) return;
        encerrado = true;
        // So solta o lugar se ainda for ESTE reconhecedor: o onend do anterior
        // chega depois do proximo comecar, e limpar as cegas fazia o app achar
        // que ninguem estava ouvindo enquanto um microfone seguia aberto.
        if (Ditado._rec === rec) Ditado._rec = null;
        try {
          rec.onresult = rec.onend = rec.onerror = null;
          rec.onstart = rec.onspeechstart = rec.onspeechend = null;
        } catch (_) {}
        if (aoFim) aoFim(finalizado, erroMsg);
      }

      rec.onstart = function () { if (aoEstado) aoEstado('started'); };
      rec.onspeechstart = function () { if (aoEstado) aoEstado('speechstart'); };
      rec.onspeechend = function () { if (aoEstado) aoEstado('speechend'); };
      rec.onresult = function (e) {
        var parcial = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) finalizado += r[0].transcript + ' '; else parcial += r[0].transcript;
        }
        aoTexto(finalizado + parcial, finalizado);
      };
      rec.onend = encerrar;
      rec.onerror = function (e) {
        var codigo = (e && e.error) || '';
        erroMsg = ERROS_DITADO.hasOwnProperty(codigo)
          ? ERROS_DITADO[codigo]
          : 'O ditado parou: ' + (codigo || 'erro desconhecido') + '.';
        encerrar();
      };

      // start() lança de verdade em alguns estados; sem isso o botão trava.
      try { rec.start(); }
      catch (e) { return false; }

      Ditado._rec = rec;
      return true;
    },

    parar: function () {
      var rec = Ditado._rec;
      if (!rec) return;
      Ditado._rec = null;                        // solta o estado antes de tudo
      try { rec.stop(); } catch (e) { try { rec.abort(); } catch (_) {} }
    },

    ativo: function () { return !!Ditado._rec; }
  };

  global.Persona = {
    ARCHETYPES: ARCHETYPES, TRAITS: TRAITS, GRADIENTES: GRADIENTES,
    EMOJIS_PERSONA: EMOJIS_PERSONA, EMOJIS_USER: EMOJIS_USER, TRAVAS: TRAVAS,
    DEFAULT_PERSONA: DEFAULT_PERSONA, DEFAULT_PROFILE: DEFAULT_PROFILE,
    archetypeOf: archetypeOf,
    nomeArquetipo: nomeArquetipo,
    gradienteOf: function (id) {
      for (var i = 0; i < GRADIENTES.length; i++) if (GRADIENTES[i].id === id) return GRADIENTES[i].css;
      return GRADIENTES[0].css;
    },
    buildPrompt: buildPrompt,
    Voice: Voice,
    Ditado: Ditado
  };
})(window);
