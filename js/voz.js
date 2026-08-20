/* ============================================================
   TDAHZEI — voz ao vivo (OpenAI Realtime API sobre WebRTC)

   Este arquivo é o transporte: abre o microfone, mantém a chamada de pé
   e traduz os eventos da OpenAI em callbacks. Quem decide QUANDO ligar,
   religar ou desistir é o js/app.js — aqui a gente só reporta o que
   aconteceu, e principalmente se o erro tem conserto ou não.

   Fluxo:
     1. o servidor local troca sua chave sk- por uma chave efêmera ek-
     2. o navegador abre um RTCPeerConnection com o microfone
     3. a oferta SDP vai pelo servidor (sem CORS) e volta a resposta
     4. os eventos trafegam no canal de dados "oai-events"

   Regra de ouro: NUNCA ficar preso. Todo caminho de erro passa por
   encerrar(), que devolve o estado para 'off' e solta o microfone.
   Por isso existe o timeout de conexão.
   ============================================================ */
(function (global) {
  'use strict';

  var TOKEN_URL = '/api/openai/realtime-token';
  var SDP_URL   = '/api/openai/realtime-sdp';
  var TIMEOUT_CONEXAO = 25000;

  /** Vozes da Realtime API. O rótulo é só para o seletor. */
  var VOZES = [
    { id: 'marin',   nome: 'Marin — clara e calma' },
    { id: 'cedar',   nome: 'Cedar — grave e firme' },
    { id: 'alloy',   nome: 'Alloy — neutra' },
    { id: 'ash',     nome: 'Ash — seca e direta' },
    { id: 'ballad',  nome: 'Ballad — suave' },
    { id: 'coral',   nome: 'Coral — quente' },
    { id: 'echo',    nome: 'Echo — objetiva' },
    { id: 'sage',    nome: 'Sage — tranquila' },
    { id: 'shimmer', nome: 'Shimmer — leve e animada' },
    { id: 'verse',   nome: 'Verse — expressiva' }
  ];

  /* ---------- estado da sessão (uma de cada vez) ---------- */
  var S = {
    estado: 'off',        // off | conectando | ligado | encerrando
    pc: null,
    dc: null,
    mic: null,
    audioEl: null,
    timer: null,
    inicioEm: 0,
    ultimaFalaEm: 0,      // para o descanso por ociosidade
    mudo: false,
    h: {},                // handlers
    pendentes: 0,         // function_call_output aguardando response.create
    respostaAgendada: null,
    parcialAssistente: '',
    parcialUsuario: '',
    erroMsg: '',
    erroFatal: false,
    desbloqueio: null,    // listener de gesto para liberar o áudio
    ctx: null,            // AudioContext dos medidores
    medidores: {}         // { voce, ele } -> AnalyserNode
  };

  /** Log curto do que aconteceu, para o painel de diagnóstico. */
  var DIARIO = [];
  function anotar(etapa, detalhe) {
    DIARIO.push({ em: Date.now(), etapa: etapa, detalhe: String(detalhe || '') });
    if (DIARIO.length > 60) DIARIO.shift();
    h('onDiario')(etapa, detalhe || '');
  }

  function h(nome) {
    var fn = S.h && S.h[nome];
    return typeof fn === 'function' ? fn : function () {};
  }

  function setEstado(estado, detalhe) {
    S.estado = estado;
    h('onEstado')(estado, detalhe || '');
  }

  /**
   * @param {string}  msg    o que dizer para a pessoa
   * @param {boolean} fatal  true = não adianta tentar de novo sozinho
   */
  function erro(msg, fatal) {
    S.erroMsg = msg;
    S.erroFatal = !!fatal;
    anotar(fatal ? 'erro-fatal' : 'erro', msg);
    h('onErro')(msg, !!fatal);
  }

  /* ============================================================
     DISPONIBILIDADE
     ============================================================ */
  function suporte() {
    if (typeof RTCPeerConnection === 'undefined') {
      return { ok: false, motivo: 'Este navegador não tem WebRTC. Use Chrome, Edge ou Safari atualizado.' };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, motivo: 'Este navegador não deixa o site usar o microfone.' };
    }
    if (!global.isSecureContext) {
      return {
        ok: false,
        motivo: 'O microfone só funciona em HTTPS ou em localhost. ' +
                'Abra por http://localhost:5173 em vez do IP da rede.'
      };
    }
    return { ok: true, motivo: '' };
  }

  /** Já temos permissão do microfone? (nem todo navegador responde) */
  function permissao() {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve('desconhecido');
    return navigator.permissions.query({ name: 'microphone' })
      .then(function (p) { return p.state; })
      .catch(function () { return 'desconhecido'; });
  }

  /* ============================================================
     ENVIO DE EVENTOS PELO CANAL DE DADOS
     ============================================================ */
  function enviar(obj) {
    if (!S.dc || S.dc.readyState !== 'open') return false;
    try { S.dc.send(JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  /** Junta várias respostas de ferramenta num único response.create. */
  function agendarResposta() {
    if (S.respostaAgendada) clearTimeout(S.respostaAgendada);
    S.respostaAgendada = setTimeout(function () {
      S.respostaAgendada = null;
      if (S.pendentes > 0) { S.pendentes = 0; enviar({ type: 'response.create' }); }
    }, 80);
  }

  /* ============================================================
     MEDIDOR DE VOLUME

     O botão do agente mostra barras que sobem com a voz. Isso não é
     enfeite: é como você sabe, de relance, que ele está mesmo ouvindo
     e que o microfone certo foi pego. Um AnalyserNode em cada ponta —
     o seu microfone e a voz que chega dele.
     ============================================================ */
  function medirStream(stream, qual) {
    try {
      if (!S.ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        S.ctx = new AC();
      }
      if (S.ctx.state === 'suspended') S.ctx.resume().catch(function () {});

      var src = S.ctx.createMediaStreamSource(stream);
      var an = S.ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.72;
      src.connect(an);
      S.medidores[qual] = { src: src, an: an, dados: new Uint8Array(an.frequencyBinCount) };
    } catch (_) { /* sem medidor: o botão cai na animação genérica */ }
  }

  function nivelDe(qual) {
    var m = S.medidores[qual];
    if (!m) return 0;
    try {
      m.an.getByteFrequencyData(m.dados);
      var soma = 0;
      for (var i = 0; i < m.dados.length; i++) soma += m.dados[i] * m.dados[i];
      var rms = Math.sqrt(soma / m.dados.length) / 255;
      return Math.max(0, Math.min(1, rms * 2.6));
    } catch (_) { return 0; }
  }

  /**
   * Espectro para as barrinhas do botão: pega o lado mais alto e devolve
   * n faixas de grave para agudo. Só as primeiras bandas interessam —
   * voz humana vive embaixo, e o resto do espectro fica sempre vazio.
   */
  function espectro(n) {
    var v = nivelDe('voce');
    var e = nivelDe('ele');
    var quem = e > v ? 'ele' : 'voce';
    var m = S.medidores[quem];
    if (!m) return { quem: quem, nivel: Math.max(v, e), valores: null };

    var primeira = 2, ultima = Math.min(46, m.dados.length);
    var largura = Math.max(1, Math.floor((ultima - primeira) / n));
    var valores = [];
    for (var i = 0; i < n; i++) {
      var soma = 0, ini = primeira + i * largura;
      for (var j = ini; j < ini + largura; j++) soma += m.dados[j] || 0;
      valores.push(Math.min(1, (soma / largura / 255) * 1.9));
    }
    return { quem: quem, nivel: Math.max(v, e), valores: valores };
  }

  function soltarMedidores() {
    Object.keys(S.medidores).forEach(function (k) {
      try { S.medidores[k].src.disconnect(); } catch (_) {}
      delete S.medidores[k];
    });
    if (S.ctx) { try { S.ctx.close(); } catch (_) {} S.ctx = null; }
  }

  /* ============================================================
     ÁUDIO: o navegador só deixa tocar depois de um gesto

     Quando o app religa sozinho (aba recarregada, sessão expirada) não
     existe clique nenhum, e o play() é recusado. Em vez de ficar mudo
     em silêncio, a gente pendura um listener de um toque só.
     ============================================================ */
  function tocar(el) {
    var p = el.play();
    if (!p || !p.catch) return;
    p.catch(function () {
      h('onAviso')('Toque em qualquer lugar da tela para liberar o som.');
      soltarDesbloqueio();
      var solto = function () {
        soltarDesbloqueio();
        if (S.audioEl) { try { S.audioEl.play(); } catch (_) {} }
      };
      S.desbloqueio = solto;
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
        document.addEventListener(ev, solto, { once: true, capture: true });
      });
    });
  }

  function soltarDesbloqueio() {
    if (!S.desbloqueio) return;
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      document.removeEventListener(ev, S.desbloqueio, { capture: true });
    });
    S.desbloqueio = null;
  }

  /* ============================================================
     EVENTOS DA REALTIME API
     ============================================================ */
  function aoEvento(raw) {
    var ev;
    try { ev = JSON.parse(raw); } catch (_) { return; }
    var t = ev.type || '';

    /* --- erro vindo da OpenAI --- */
    if (t === 'error') {
      var m = (ev.error && (ev.error.message || ev.error.code)) || 'Erro na sessão de voz.';
      // Falha de transcrição não derruba a conversa: só perde a legenda.
      if (/transcri/i.test(m)) { h('onAviso')('Sem legenda do que você fala: ' + m); return; }
      erro(m, false);
      return;
    }

    /* --- turnos: de quem é a palavra --- */
    if (t === 'input_audio_buffer.speech_started') {
      S.ultimaFalaEm = Date.now();
      setEstado('ligado', 'ouvindo você');
      return;
    }
    if (t === 'input_audio_buffer.speech_stopped') {
      S.ultimaFalaEm = Date.now();
      setEstado('ligado', 'pensando');
      return;
    }

    /* --- o que VOCÊ falou --- */
    if (t === 'conversation.item.input_audio_transcription.delta') {
      S.parcialUsuario += (ev.delta || '');
      h('onParcial')(S.parcialUsuario, 'user');
      return;
    }
    if (t === 'conversation.item.input_audio_transcription.completed') {
      var seu = String(ev.transcript || S.parcialUsuario || '').trim();
      S.parcialUsuario = '';
      S.ultimaFalaEm = Date.now();
      if (seu) h('onUsuario')(seu);
      return;
    }
    if (t === 'conversation.item.input_audio_transcription.failed') {
      S.parcialUsuario = '';
      return;
    }

    /* --- o que ELE falou (nome novo e nome antigo do evento) --- */
    if (t === 'response.output_audio_transcript.delta' || t === 'response.audio_transcript.delta') {
      S.parcialAssistente += (ev.delta || '');
      S.ultimaFalaEm = Date.now();
      h('onParcial')(S.parcialAssistente, 'assistant');
      setEstado('ligado', 'falando');
      return;
    }
    if (t === 'response.output_audio_transcript.done' || t === 'response.audio_transcript.done') {
      var dele = String(ev.transcript || S.parcialAssistente || '').trim();
      S.parcialAssistente = '';
      if (dele) h('onAssistente')(dele);
      return;
    }

    /* --- ferramentas: ele grava as coisas enquanto conversa --- */
    if (t === 'response.function_call_arguments.done') {
      var args = {};
      try { args = JSON.parse(ev.arguments || '{}'); } catch (_) { args = {}; }
      var saida = '';
      try { saida = String(h('onFerramenta')(ev.name, args) || ''); }
      catch (e) { saida = 'Erro ao executar: ' + ((e && e.message) || 'falha interna'); }

      enviar({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: ev.call_id, output: saida || 'ok' }
      });
      S.pendentes++;
      agendarResposta();
      return;
    }

    if (t === 'response.done') {
      S.parcialAssistente = '';
      var uso = ev.response && ev.response.usage;
      if (uso) h('onUso')(uso);
      if (S.estado === 'ligado') setEstado('ligado', 'ouvindo você');
      return;
    }

    if (t === 'session.created') { anotar('sessao-criada', (ev.session && ev.session.model) || ''); h('onSessao')(ev.session || {}); return; }
    if (t === 'session.updated') { h('onSessao')(ev.session || {}); return; }
  }

  /* ============================================================
     CONEXÃO
     ============================================================ */
  function lerOuExplodir(res) {
    if (res.ok) return res.json();
    return res.json().catch(function () { return null; }).then(function (b) {
      var msg = (b && b.error && b.error.message) || ('Erro HTTP ' + res.status + '.');
      var fatal = false;
      if (res.status === 401) { msg = 'Sua chave da OpenAI foi recusada. Confira em Chave & Modelo.'; fatal = true; }
      if (res.status === 403) { msg = 'Sua chave não tem acesso à API de voz em tempo real (Realtime).'; fatal = true; }
      if (res.status === 404) { msg = 'O modelo de voz não existe para esta conta: ' + msg; fatal = true; }
      if (res.status === 429) { msg = 'Limite de uso atingido na OpenAI. Vou esperar um pouco.'; }
      var e = new Error(msg);
      e.fatal = fatal;
      throw e;
    });
  }

  function pedirToken(opts) {
    anotar('token', 'pedindo chave efêmera');
    return fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: opts.apiKey,
        model: opts.model || undefined,
        voice: opts.voz || 'marin',
        instructions: opts.instrucoes || '',
        tools: opts.tools || [],
        safetyId: opts.safetyId || 'kao-local-user'
      })
    }).catch(function () {
      var e = new Error('O servidor local do TDAHZEI não respondeu. Rode "node server.js" e recarregue a página.');
      e.fatal = true;
      throw e;
    }).then(lerOuExplodir);
  }

  function trocarSdp(ek, sdp) {
    anotar('sdp', 'trocando oferta com a OpenAI');
    return fetch(SDP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ephemeralKey: ek, sdp: sdp })
    }).then(function (res) {
      if (res.ok) return res.text();
      return res.json().catch(function () { return null; }).then(function (b) {
        throw new Error((b && b.error && b.error.message) || 'A OpenAI recusou a sessão de voz.');
      });
    }).then(function (txt) {
      if (!txt || txt.indexOf('v=') !== 0) {
        throw new Error('A OpenAI devolveu uma resposta de sessão inválida.');
      }
      return txt;
    });
  }

  function pararStream(stream) {
    if (!stream) return;
    try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
  }

  function abrirMicrofone() {
    anotar('microfone', 'pedindo acesso');
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).catch(function (e) {
      var nome = e && e.name;
      var msg, fatal = true;
      if (nome === 'NotAllowedError' || nome === 'SecurityError') {
        msg = 'O microfone está bloqueado. Clique no cadeado da barra de endereço, ' +
              'libere o microfone para este site e ative o agente de novo.';
      } else if (nome === 'NotFoundError' || nome === 'OverconstrainedError') {
        msg = 'Nenhum microfone encontrado neste aparelho.';
      } else if (nome === 'NotReadableError') {
        msg = 'Outro programa está usando o microfone. Feche ele e ative de novo.';
        fatal = false;
      } else {
        msg = 'Não consegui abrir o microfone: ' + ((e && e.message) || 'erro desconhecido');
      }
      var err = new Error(msg);
      err.fatal = fatal;
      throw err;
    });
  }

  /**
   * Liga o microfone e abre a conversa por voz.
   * @param {object} opts     { apiKey, instrucoes, voz, tools, model, saudacao, saudacaoTexto }
   * @param {object} handlers { onEstado, onUsuario, onAssistente, onParcial, onFerramenta,
   *                            onErro, onAviso, onSessao, onUso, onDiario, onFim }
   */
  function iniciar(opts, handlers) {
    if (S.estado !== 'off') return Promise.resolve(false);
    opts = opts || {};

    S.h = handlers || {};
    S.erroMsg = '';
    S.erroFatal = false;

    var sup = suporte();
    if (!sup.ok) {
      erro(sup.motivo, true);
      var fimSemSuporte = h('onFim');
      S.h = {};
      fimSemSuporte(0, { erro: sup.motivo, fatal: true });
      return Promise.resolve(false);
    }

    S.mudo = false;
    S.pendentes = 0;
    S.parcialAssistente = '';
    S.parcialUsuario = '';
    DIARIO.length = 0;
    setEstado('conectando', 'pedindo o microfone');

    var expirou = false;
    S.timer = setTimeout(function () {
      expirou = true;
      erro('A conexão de voz demorou demais. Vou tentar de novo.', false);
      encerrar();
    }, TIMEOUT_CONEXAO);

    return abrirMicrofone().then(function (stream) {
      if (expirou) { pararStream(stream); return false; }
      S.mic = stream;
      medirStream(stream, 'voce');
      anotar('microfone', 'liberado');
      setEstado('conectando', 'abrindo a sessão');

      return pedirToken(opts).then(function (tok) {
        if (expirou) return false;
        anotar('token', 'recebido');

        // O servidor pode ter aberto a sessão sem algum extra que a conta não tem.
        if (tok.semLegenda) h('onAviso')('Sua conta não tem o modelo de transcrição: a voz funciona, mas sem legenda do que você fala.');
        if (tok.semVoz) h('onAviso')('A voz escolhida não está disponível nesta conta; usando a padrão.');

        var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        S.pc = pc;

        /* o áudio que ELE fala */
        var el = document.createElement('audio');
        el.autoplay = true;
        el.setAttribute('playsinline', '');
        S.audioEl = el;
        pc.ontrack = function (e) {
          anotar('audio', 'recebendo a voz dele');
          el.srcObject = e.streams[0];
          medirStream(e.streams[0], 'ele');
          tocar(el);
        };

        pc.addTrack(stream.getAudioTracks()[0], stream);

        var dc = pc.createDataChannel('oai-events');
        S.dc = dc;
        dc.onmessage = function (e) { aoEvento(e.data); };
        dc.onopen = function () {
          if (S.timer) { clearTimeout(S.timer); S.timer = null; }
          S.inicioEm = Date.now();
          S.ultimaFalaEm = Date.now();
          anotar('canal', 'aberto — sessão no ar');
          setEstado('ligado', 'pode falar');
          // Ele quebra o gelo, em vez de esperar você começar.
          if (opts.saudacao !== false) {
            enviar({
              type: 'response.create',
              response: {
                instructions: opts.saudacaoTexto ||
                  'Cumprimente em uma frase curta e pergunte qual é o próximo passo.'
              }
            });
          }
        };
        dc.onclose = function () {
          anotar('canal', 'fechado pelo outro lado');
          if (S.estado === 'ligado' || S.estado === 'conectando') encerrar();
        };

        pc.onconnectionstatechange = function () {
          anotar('webrtc', pc.connectionState);
          if (pc.connectionState === 'failed') {
            erro('A conexão de voz caiu.', false);
            encerrar();
          }
          if (pc.connectionState === 'disconnected') {
            // pode voltar sozinho; se não voltar, o onclose/timeout resolve
            setEstado(S.estado, 'reconectando a rede');
          }
        };

        return pc.createOffer()
          .then(function (offer) {
            return pc.setLocalDescription(offer).then(function () { return offer; });
          })
          .then(function (offer) { return trocarSdp(tok.value, offer.sdp); })
          .then(function (answerSdp) {
            if (expirou) return false;
            anotar('sdp', 'resposta aceita');
            return pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
              .then(function () { return true; });
          });
      });
    }).catch(function (e) {
      if (!expirou) erro((e && e.message) || 'Não consegui iniciar a voz.', !!(e && e.fatal));
      encerrar();
      return false;
    });
  }

  /** Desliga tudo. Pode ser chamado a qualquer momento, quantas vezes quiser. */
  function encerrar() {
    if (S.estado === 'off') { limpar(true); return; }
    if (S.estado !== 'encerrando') S.estado = 'encerrando';
    limpar(false);
  }

  function limpar(silencioso) {
    var minutos = S.inicioEm ? (Date.now() - S.inicioEm) / 60000 : 0;
    var fim = h('onFim');
    var info = { erro: S.erroMsg, fatal: S.erroFatal };

    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    if (S.respostaAgendada) { clearTimeout(S.respostaAgendada); S.respostaAgendada = null; }
    soltarDesbloqueio();
    soltarMedidores();

    if (S.dc) {
      try { S.dc.onmessage = S.dc.onopen = S.dc.onclose = null; S.dc.close(); } catch (_) {}
    }
    if (S.pc) {
      try {
        S.pc.ontrack = null;
        S.pc.onconnectionstatechange = null;
        S.pc.getSenders().forEach(function (s) { if (s.track) s.track.stop(); });
        S.pc.close();
      } catch (_) {}
    }
    pararStream(S.mic);
    if (S.audioEl) {
      try { S.audioEl.pause(); S.audioEl.srcObject = null; } catch (_) {}
    }

    S.dc = null; S.pc = null; S.mic = null; S.audioEl = null;
    S.inicioEm = 0; S.pendentes = 0; S.mudo = false;
    S.parcialAssistente = ''; S.parcialUsuario = '';
    S.estado = 'off';

    if (!silencioso) {
      h('onEstado')('off', '');
      fim(minutos, info);
    }
    S.h = {};
    S.erroMsg = ''; S.erroFatal = false;
  }

  /* ============================================================
     CONTROLES DURANTE A CONVERSA
     ============================================================ */

  /** Corta o microfone sem derrubar a sessão. */
  function alternarMudo() {
    if (!S.mic) return false;
    S.mudo = !S.mudo;
    S.mic.getAudioTracks().forEach(function (t) { t.enabled = !S.mudo; });
    setEstado(S.estado, S.mudo ? 'microfone mudo' : 'pode falar');
    return S.mudo;
  }

  /** Faz ele parar de falar agora (útil quando se estende demais). */
  function interromper() {
    enviar({ type: 'response.cancel' });
    if (S.audioEl) { try { S.audioEl.pause(); S.audioEl.currentTime = 0; } catch (_) {} }
    setEstado(S.estado, 'pode falar');
  }

  /** Injeta um texto na conversa por voz (ele responde falando). */
  function dizer(texto, sozinho) {
    var t = String(texto || '').trim();
    if (!t) return false;
    var ok = enviar({
      type: 'conversation.item.create',
      item: { type: 'message', role: sozinho ? 'system' : 'user', content: [{ type: sozinho ? 'input_text' : 'input_text', text: t }] }
    });
    if (ok) enviar({ type: 'response.create' });
    return ok;
  }

  /** Faz ele falar algo por conta própria, sem fingir que você pediu. */
  function avisar(instrucao) {
    return enviar({ type: 'response.create', response: { instructions: String(instrucao || '') } });
  }

  /** Atualiza as instruções no meio da sessão (ex.: a memória mudou). */
  function atualizarInstrucoes(texto) {
    return enviar({
      type: 'session.update',
      session: { type: 'realtime', instructions: String(texto || '') }
    });
  }

  global.Voz = {
    VOZES: VOZES,
    suporte: suporte,
    permissao: permissao,
    disponivel: function () { return suporte().ok; },
    estado: function () { return S.estado; },
    ativo: function () { return S.estado === 'conectando' || S.estado === 'ligado'; },
    ligado: function () { return S.estado === 'ligado'; },
    mudo: function () { return S.mudo; },
    /** Segundos desde a última fala de qualquer um dos dois. */
    ocioso: function () { return S.ultimaFalaEm ? (Date.now() - S.ultimaFalaEm) / 1000 : 0; },
    /** Volume de cada lado agora, 0..1 — o botão desenha isso. */
    nivel: function () { return { voce: nivelDe('voce'), ele: nivelDe('ele') }; },
    espectro: espectro,
    minutosNoAr: function () { return S.inicioEm ? (Date.now() - S.inicioEm) / 60000 : 0; },
    diario: function () { return DIARIO.slice(); },
    iniciar: iniciar,
    encerrar: encerrar,
    alternarMudo: alternarMudo,
    interromper: interromper,
    dizer: dizer,
    avisar: avisar,
    atualizarInstrucoes: atualizarInstrucoes
  };
})(window);
