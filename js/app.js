/* ============================================================
   TDAHZEI — aplicação
   ============================================================ */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var State = {
    user: null,
    config: null,
    perfil: null,        // perfil social do usuário
    persona: null,       // o TDAHzeiro
    apiKey: '',
    elevenLabsKey: '',
    elevenLabsKeyInvalida: '',
    elevenLabsServidor: false,   // deploy ja tem chave salva; ninguem precisa colar a sua

    keyStatus: 'none',   // none | ok | bad | unknown
    apiAlerta: null,     // limite confirmado por um provedor externo nesta sessao
    conv: null,
    running: null,       // { abort() } enquanto o modelo responde
    vozAcoes: [],        // ferramentas usadas na rodada de voz atual
    agente: {            // o copiloto de voz que fica de pé sozinho
      ligado: false,     // o que VOCÊ escolheu (não o estado da conexão)
      tentativas: 0,
      timer: null,
      vigia: null,
      navegador: null,   // agente por ditado + fala do navegador (Claude ou fallback)
      descansando: false,
      parandoDeProposito: false,
      custoSessao: 0
    },
    page: 'dashboard'
  };

  var DEFAULT_ELEVENLABS_VOICE = 'JBFqnCBsd6RMkjVDRZzb';
  var APP_VERSION = '2026.08.21.28';
  var ElevenLabsVoices = [];

  /** Nome do personagem, com fallback enquanto ele não existe. */
  function nomeP() { return (State.persona && State.persona.nome) || 'TDAHZEI'; }
  function apelido() {
    return (State.perfil && State.perfil.apelido) ||
           (State.user ? String(State.user.name).split(' ')[0] : 'você');
  }

  /* ============================================================
     UTILITÁRIOS
     ============================================================ */
  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = (kind === 'ok' ? Icons.svg('check', 16) : kind === 'bad' ? Icons.svg('x', 16) : '') +
                   '<span>' + MD.escape(msg) + '</span>';
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 260);
    }, 3200);
  }

  function nomeDaApi(provider) {
    if (provider === 'elevenlabs') return 'ElevenLabs';
    if (provider === 'anthropic') return 'Claude';
    return 'OpenAI';
  }

  function alertaApiAtual() {
    if (!State.user || !State.config) return null;
    var teto = Store.Usage.teto(State.user.id, State.config.tetoMensalUSD);
    if (teto.estourou) return { kind: 'teto', teto: teto };

    var alerta = State.apiAlerta || (Store.ApiAlert && Store.ApiAlert.get(State.user.id));
    if (!alerta || !alerta.kind) return null;
    // Rate limit nao e cota: expira sozinho para nao prender um aviso temporario.
    if (alerta.kind === 'rate' && Date.now() - (alerta.at || 0) > 10 * 60 * 1000) {
      Store.ApiAlert.clear(State.user.id);
      State.apiAlerta = null;
      return null;
    }
    return alerta;
  }

  function atualizarAvisoDeLimiteApi() {
    var banner = $('#api-limit-banner');
    if (!banner) return;
    var alerta = alertaApiAtual();
    if (!alerta) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }

    var titulo, detalhe, acao = 'Chave & Modelo';
    if (alerta.kind === 'teto') {
      titulo = 'Teto de API atingido';
      detalhe = money(alerta.teto.gasto) + ' de ' + money(alerta.teto.teto) + ' usados neste mes. Os novos envios estao bloqueados.';
      acao = 'Ajustar teto';
    } else if (alerta.kind === 'quota') {
      titulo = 'Limite da ' + nomeDaApi(alerta.provider) + ' atingido';
      detalhe = 'A API informou que a cota ou os creditos acabaram. Atualize o plano ou aguarde a renovacao.';
    } else {
      titulo = nomeDaApi(alerta.provider) + ' temporariamente no limite';
      detalhe = 'A API pediu uma pausa curta. Tente de novo daqui a pouco.';
      acao = 'Ver conexao';
    }

    banner.className = 'api-limit-banner' + (alerta.kind === 'rate' ? ' rate' : '');
    banner.innerHTML = Icons.svg('bolt', 17) +
      '<div class="api-limit-copy"><b>' + MD.escape(titulo) + '</b><span>' + MD.escape(detalhe) + '</span></div>' +
      '<button class="btn btn-ghost" type="button" data-nav="settings">' + MD.escape(acao) + '</button>';
    banner.hidden = false;
  }

  function registrarLimiteDaApi(provider, erro, tipo) {
    if (!State.user || !Store.ApiAlert) return;
    var texto = String((erro && erro.message) || erro || '').toLowerCase();
    var semCota = tipo === 'quota_exhausted' || /quota|credit|billing|balance|payment|insufficient/.test(texto);
    State.apiAlerta = Store.ApiAlert.set(State.user.id, {
      provider: provider || (State.config && State.config.provider) || 'anthropic',
      kind: semCota ? 'quota' : 'rate',
      at: Date.now()
    });
    atualizarAvisoDeLimiteApi();
  }

  function limparAvisoDeLimiteApi(provider) {
    if (!State.user || !Store.ApiAlert) return;
    var alerta = State.apiAlerta || Store.ApiAlert.get(State.user.id);
    if (alerta && alerta.kind && (!provider || alerta.provider === provider)) {
      Store.ApiAlert.clear(State.user.id);
      State.apiAlerta = null;
    }
    atualizarAvisoDeLimiteApi();
  }

  /** O boneco no canto: é você olhando para você o tempo todo. */
  function pintarAvatarTopo() {
    var el = $('#topbar-avatar');
    if (!el || !State.user) return;
    if (State.perfil && State.perfil.foto) {
      el.textContent = '';
      el.style.backgroundImage = 'url(' + State.perfil.foto + ')';
      el.style.backgroundSize = 'cover';
      return;
    }
    el.style.backgroundImage = '';
    el.classList.add('av-mini');
    el.innerHTML = Avatar.svg(Avatar.ficha(State.user.id, State.perfil), 32, { fundo: false });
  }

  function initials(name) {
    var p = String(name || 'K').trim().split(/\s+/);
    return ((p[0] || 'K')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  function nf(n) { return new Intl.NumberFormat('pt-BR').format(Math.round(n || 0)); }
  function money(n) {
    return 'US$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 }).format(n || 0);
  }
  function when(ts) {
    var d = Date.now() - ts;
    if (d < 60000) return 'agora';
    if (d < 3600000) return 'há ' + Math.floor(d / 60000) + ' min';
    if (d < 86400000) return 'há ' + Math.floor(d / 3600000) + 'h';
    if (d < 172800000) return 'ontem';
    if (d < 604800000) return 'há ' + Math.floor(d / 86400000) + ' dias';
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
  function showError(form, msg) {
    var el = $('[data-error]', form);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  function bindNeuroMotion() {
    var reduzMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzMovimento) return;

    var root = document.documentElement;
    var body = document.body;
    var ultimoPonteiro = 0;

    document.addEventListener('pointermove', function (evento) {
      var agora = Date.now();
      if (agora - ultimoPonteiro < 48) return;
      ultimoPonteiro = agora;
      root.style.setProperty('--mx', evento.clientX + 'px');
      root.style.setProperty('--my', evento.clientY + 'px');
      body.style.setProperty('--mx', evento.clientX + 'px');
      body.style.setProperty('--my', evento.clientY + 'px');
    }, { passive: true });

    document.addEventListener('click', function (evento) {
      var alvo = evento.target.closest('button,a,.card,.experience-card,.shortcut,.linha,.chip,.nav-item,.tab-item');
      if (!alvo || alvo.disabled) return;

      var pop = document.createElement('span');
      pop.className = 'neuro-pop';
      pop.style.left = evento.clientX + 'px';
      pop.style.top = evento.clientY + 'px';
      document.body.appendChild(pop);
      setTimeout(function () { pop.remove(); }, 760);
    }, { passive: true });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    Icons.render();
    bindAuthScreen();
    bindAppShell();
    bindChat();
    bindCopiloto();
    bindAmbiente();
    bindNeuroMotion();
    bindSettings();
    bindProfile();
    Wizard.montar();
    Wizard.definirErro(function (msg) { toast(msg, 'bad'); });

    Auth.ready().then(function (user) {
      if (user) enterApp(user);
      else {
        showAuth();
        if (Auth.syncNotice) toast(Auth.syncNotice, 'warn');
      }
    });

    setTimeout(function () {
      var sp = $('#splash');
      if (sp) sp.classList.add('gone');
    }, 380);

    registrarServiceWorker();
  }

  function registrarServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol.indexOf('http') !== 0) return;
    var tinhaControle = !!navigator.serviceWorker.controller;
    var recarregando = false;

    function ativarAgora(worker) {
      if (!worker) return;
      try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
    }

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!tinhaControle || recarregando) return;
      recarregando = true;
      location.reload();
    });

    navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(APP_VERSION)).then(function (reg) {
      if (reg.waiting) ativarAgora(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) ativarAgora(worker);
        });
      });
      reg.update().catch(function () {});
    }).catch(function () { /* offline e cache sao opcionais */ });
  }

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () { carregarMicrofones(false); });
  }

  function showAuth() {
    $('#view-app').classList.add('hidden');
    $('#view-auth').classList.remove('hidden');
  }

  function enterApp(user, recemCriado) {
    State.user = user;
    State.config = Store.Config.get(user.id);
    State.apiAlerta = Store.ApiAlert ? Store.ApiAlert.get(user.id) : null;
    if (State.config.provider !== 'anthropic') {
      State.config = Store.Config.set(user.id, { provider: 'anthropic', model: 'claude-sonnet-4-5' });
    }
    State.perfil = Store.Profile.get(user.id);
    State.persona = Store.Persona.get(user.id);
    if (Store.Vault) Store.Vault.ensure(user.id, user, State.perfil, State.persona);
    Auth.touch();

    $('#view-auth').classList.add('hidden');
    $('#view-app').classList.remove('hidden');

    pintarAvatarTopo();

    Vida.iniciar({
      uid: user.id,
      user: user,
      aoMudar: function () { renderDashboard(); }
    });

    fillModelSelects();
    applyConfigToForm();
    renderAmbienteUI();
    renderProfile();
    renderPersona();
    renderVida();
    renderJarvisOS();
    renderConvList();
    renderDashboard();
    atualizarAvisoDeLimiteApi();
    carregarMicrofones(false);

    // Primeiro acesso: criar o personagem antes de qualquer outra coisa.
    if (!State.perfil.onboarded) {
      abrirCriador({ modo: 'onboarding' });
    }

    // Carrega as chaves antes de decidir se o agente entra com voz natural.
    Promise.all([
      Store.ApiKey.load(user.id, State.config.provider).catch(function () { return ''; }),
      Store.ApiKey.load(user.id, 'elevenlabs').catch(function () { return ''; }),
      checarChaveElevenLabsDoServidor()
    ]).then(function (keys) {
      State.apiKey = keys[0] || '';
      State.elevenLabsKey = keys[1] || '';
      State.elevenLabsKeyInvalida = State.elevenLabsKey && !chaveElevenLabsPareceValida(State.elevenLabsKey)
        ? State.elevenLabsKey
        : '';
      renderKeyUI();
      renderElevenLabsKeyUI();
      if (State.apiKey) checkKey(true);
      else {
        setKeyStatus('none');
        if (!Store.Convs.all(user.id).length) {
          toast('Adicione sua chave da API em "Chave & Modelo" para começar.');
        }
      }
      var carregarVozes = chaveElevenLabsPareceValida(State.elevenLabsKey) || State.elevenLabsServidor
        ? carregarVozesElevenLabs(State.elevenLabsKey, true).catch(function () { return []; })
        : Promise.resolve([]);
      carregarVozes.then(function () {
        // O agente entra junto com você: é o ponto do app.
        talvezLigarAgenteSozinho();
      });
    });
    var last = Store.Convs.all(user.id)[0];
    if (last) openConv(last.id, true); else newConv(true);
  }

  /** Abre o criador de personagem e recarrega a interface ao terminar. */
  function abrirCriador(opts) {
    // Ninguém quer alguém falando no ouvido enquanto preenche formulário.
    if (Voz.ativo()) { State.agente.parandoDeProposito = true; Voz.encerrar(); }
    opts = opts || {};
    Wizard.abrir({
      modo: opts.modo || 'editar',
      passo: opts.passo,
      user: State.user,
      aoConcluir: function (perfil, persona) {
        State.perfil = Store.Profile.get(State.user.id);
        State.persona = Store.Persona.get(State.user.id);
        if (Store.Vault) Store.Vault.ensure(State.user.id, State.user, State.perfil, State.persona);
        renderProfile();
        renderPersona();
        renderJarvisOS();
        renderDashboard();
        renderMessages();
        atualizarMic();
        if (opts.modo === 'onboarding') {
          setNav(State.apiKey ? 'chat' : 'settings');
          toast(nomeP() + ' está pront' + (State.persona.pronome === 'ela' ? 'a' : 'o') + '!', 'ok');
          if (!State.apiKey) toast('Falta só a chave da API para vocês conversarem.');
        } else {
          toast('Personagem atualizado.', 'ok');
        }
        // Terminou de configurar: ele volta para a linha (e com a persona nova).
        State.agente.tentativas = 0;
        if (State.agente.ligado) conectarVoz(true);
        else talvezLigarAgenteSozinho();
      }
    });
  }

  /* ============================================================
     TELA DE AUTENTICAÇÃO
     ============================================================ */
  function bindAuthScreen() {
    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
    });
    $$('[data-goto-tab]').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.gotoTab); });
    });

    // olho de "mostrar senha" (funciona em qualquer input-wrap da app)
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-toggle-pass]');
      if (!btn) return;
      var input = $('input', btn.parentNode);
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = Icons.svg(show ? 'eyeoff' : 'eye');
    });

    var signup = $('#form-signup');
    var pw = $('input[name="password"]', signup);
    pw.addEventListener('input', function () {
      var s = Auth.strength(pw.value);
      var bar = $('[data-strength-bar]', signup);
      var colors = ['#f87171', '#f87171', '#fbbf24', '#34d399', '#34d399'];
      bar.style.width = (pw.value ? (s.score + 1) * 20 : 0) + '%';
      bar.style.background = colors[s.score];
      $('[data-strength-label]', signup).textContent = pw.value ? s.label : 'Use letras, números e símbolos.';
    });

    $('#form-login').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = $('button[type="submit"]', f);
      showError(f, '');
      btn.disabled = true; btn.textContent = 'Entrando…';
      Auth.login({
        email: f.email.value,
        password: f.password.value,
        remember: f.remember.checked
      }).then(function (user) {
        f.reset();
        enterApp(user);
        toast('Bem-vindo de volta, ' + user.name.split(' ')[0] + '!', 'ok');
      }).catch(function (err) {
        showError(f, err.message);
      }).then(function () {
        btn.disabled = false; btn.textContent = 'Entrar';
      });
    });

    signup.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = $('button[type="submit"]', f);
      showError(f, '');
      btn.disabled = true; btn.textContent = 'Criando…';
      Auth.signup({
        name: f.name.value,
        email: f.email.value,
        password: f.password.value,
        password2: f.password2.value
      }).then(function (user) {
        f.reset();
        $('[data-strength-bar]', signup).style.width = '0';
        enterApp(user, true);
      }).catch(function (err) {
        showError(f, err.message);
      }).then(function () {
        btn.disabled = false; btn.textContent = 'Criar minha conta';
      });
    });
  }

  function switchTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.tab === name); });
    $('#form-login').classList.toggle('hidden', name !== 'login');
    $('#form-signup').classList.toggle('hidden', name !== 'signup');
  }

  /* ============================================================
     SHELL: navegação, drawer, logout
     ============================================================ */
  function bindAppShell() {
    document.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (nav) { setNav(nav.dataset.nav); return; }

      if (e.target.closest('[data-open-drawer]')) { $('#view-app').classList.add('drawer-open'); return; }
      if (e.target.closest('[data-close-drawer]')) { $('#view-app').classList.remove('drawer-open'); return; }

      var pr = e.target.closest('[data-prompt]');
      if (pr) {
        setNav('chat');
        var input = $('#input');
        input.value = pr.dataset.prompt;
        autosize(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }

      var ed = e.target.closest('[data-edit-persona]');
      if (ed) { abrirCriador({ modo: 'editar', passo: ed.dataset.editPersona }); return; }

      var rit = e.target.closest('[data-ritual]');
      if (rit) { dispararRitual(rit.dataset.ritual); return; }

      var jarvis = e.target.closest('[data-jarvis-skill]');
      if (jarvis) { executarSkillJarvis(jarvis.dataset.jarvisSkill); return; }

      if (e.target.closest('#btn-vault-inbox')) { adicionarInboxJarvis(); return; }
      if (e.target.closest('#btn-vault-save')) { salvarVaultJarvis(); return; }
      if (e.target.closest('#btn-vault-export')) { exportarVaultJarvis(); return; }

      var sk = e.target.closest('[data-skin]');
      if (sk) {
        if (Avatar.usarSkin(State.user.id, sk.dataset.skin)) {
          renderAvatarCard(); renderProgress(); pintarAvatarTopo();
        } else {
          toast('Essa skin abre em um nível mais alto.', 'bad');
        }
        return;
      }

      if (e.target.closest('#btn-avatar-humor')) {
        var atual = Avatar.ficha(State.user.id, State.perfil).expressao;
        var ordem = ['neutro', 'sorriso', 'foco', 'cansado'];
        var prox = ordem[(ordem.indexOf(atual) + 1) % ordem.length];
        Avatar.ajustar(State.user.id, { expressao: prox });
        renderAvatarCard(); renderProgress(); pintarAvatarTopo(); renderMessages();
        return;
      }

      if (e.target.closest('#btn-avatar-zerar')) {
        if (!confirm('Apagar tudo o que ele já desenhou de você?')) return;
        Avatar.esquecer(State.user.id);
        renderAvatarCard(); renderProgress(); pintarAvatarTopo(); renderMessages();
        toast('Avatar zerado. Ele volta a te desenhar conversando.');
        return;
      }

      var vi = e.target.closest('[data-ir-vida]');
      if (vi) { setNav('vida'); Vida.irPara(vi.dataset.irVida); return; }

      var copy = e.target.closest('[data-copy]');
      if (copy) {
        var code = $('code', copy.closest('.code-block'));
        navigator.clipboard.writeText(code.innerText).then(function () {
          copy.textContent = 'copiado!';
          setTimeout(function () { copy.textContent = 'copiar'; }, 1600);
        });
      }
    });

    $('#btn-logout').addEventListener('click', doLogout);
    $('#btn-logout-2').addEventListener('click', doLogout);
    $('#btn-new-chat').addEventListener('click', function () { newConv(); setNav('chat'); });
    $('#btn-recheck').addEventListener('click', function () { checkKey(); });

    window.addEventListener('online', function () { renderStatus(); });
    window.addEventListener('offline', function () { renderStatus(); });
  }

  function doLogout() {
    if (State.running) State.running.abort();
    desligarAgente(true);
    if (window.Ambiente) Ambiente.pausar();
    Auth.logout();
    State.user = null; State.apiKey = ''; State.conv = null; State.apiAlerta = null;
    atualizarAvisoDeLimiteApi();
    $('#messages').innerHTML = '';
    showAuth();
    switchTab('login');
    toast('Sessão encerrada.');
  }

  /* ---------- paisagem sonora ---------- */
  function volumeAmbiente() {
    var value = State.config ? Number(State.config.ambienteVolume) : 22;
    return Math.max(0, Math.min(45, isFinite(value) ? value : 22));
  }

  function renderAmbienteUI() {
    var btn = $('#btn-ambiente');
    var range = $('#cfg-ambiente-volume');
    var label = $('#cfg-ambiente-volume-label');
    var ativo = !!(window.Ambiente && Ambiente.ativo());
    var volume = volumeAmbiente();
    if (btn) {
      btn.classList.toggle('is-active', ativo);
      btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      var texto = ativo ? 'Pausar paisagem sonora (nao mexe no microfone)' : 'Ativar paisagem sonora (nao abre microfone)';
      btn.setAttribute('aria-label', texto);
      btn.title = texto;
    }
    if (range) range.value = String(volume);
    if (label) label.textContent = volume + '%';
  }

  function salvarAmbiente(patch) {
    if (!State.user || !State.config) return;
    State.config = Store.Config.set(State.user.id, patch);
    if (window.Ambiente) Ambiente.definirVolume(volumeAmbiente() / 100);
    renderAmbienteUI();
  }

  function bindAmbiente() {
    var btn = $('#btn-ambiente');
    var range = $('#cfg-ambiente-volume');
    function retomarDepoisDaInteracao(evento) {
      if (!State.user || !State.config || !State.config.ambienteAtivo || !window.Ambiente || Ambiente.ativo()) return;
      if (evento && evento.target && evento.target.closest && evento.target.closest('#btn-ambiente')) return;
      Ambiente.definirVolume(volumeAmbiente() / 100);
      Ambiente.iniciar().then(renderAmbienteUI).catch(function () {});
    }
    if (btn) btn.addEventListener('click', function () {
      if (!window.Ambiente || !Ambiente.disponivel()) {
        toast('Este navegador nao suporta paisagem sonora.', 'bad');
        return;
      }
      if (Ambiente.ativo()) {
        Ambiente.pausar().then(function () { salvarAmbiente({ ambienteAtivo: false }); });
        return;
      }
      Ambiente.definirVolume(volumeAmbiente() / 100);
      Ambiente.iniciar().then(function () {
        salvarAmbiente({ ambienteAtivo: true });
        toast('Paisagem sonora ativada. Para falar, use "Ativar agente" no topo.');
      }).catch(function (erro) {
        toast((erro && erro.message) || 'Nao consegui iniciar a paisagem sonora.', 'bad');
      });
    });
    if (range) {
      range.addEventListener('input', function () {
        var volume = Math.max(0, Math.min(45, Number(range.value) || 0));
        $('#cfg-ambiente-volume-label').textContent = volume + '%';
        if (window.Ambiente) Ambiente.definirVolume(volume / 100);
      });
      range.addEventListener('change', function () { salvarAmbiente({ ambienteVolume: Number(range.value) || 0 }); });
    }

    document.addEventListener('pointerdown', retomarDepoisDaInteracao, { passive: true });
    document.addEventListener('keydown', retomarDepoisDaInteracao);

    var ultimoMovimento = 0;
    document.addEventListener('pointermove', function (evento) {
      if (!window.Ambiente || !Ambiente.ativo() || Date.now() - ultimoMovimento < 140) return;
      ultimoMovimento = Date.now();
      Ambiente.definirAltitude(1 - evento.clientY / Math.max(1, window.innerHeight));
    }, { passive: true });
  }

  var TITLES = { dashboard: 'Painel', chat: 'Conversar', jarvis: 'JarvisOS', vida: 'Minha vida', persona: 'Meu TDAHzeiro', settings: 'Chave & Modelo', profile: 'Meu perfil' };

  function setNav(page) {
    State.page = page;
    document.body.dataset.page = page;
    $$('.page').forEach(function (p) { p.classList.toggle('is-active', p.id === 'page-' + page); });
    $$('[data-nav]').forEach(function (b) {
      if (b.classList.contains('nav-item') || b.classList.contains('tab-item')) {
        b.classList.toggle('is-active', b.dataset.nav === page);
      }
    });
    $('#page-title').textContent = page === 'persona' ? nomeP() : (TITLES[page] || 'TDAHZEI');
    var app = $('#view-app');
    app.classList.remove('drawer-open', 'page-shift');
    void app.offsetWidth;
    app.classList.add('page-shift');
    if (page === 'dashboard') renderDashboard();
    if (page === 'vida') renderVida();
    if (page === 'jarvis') renderJarvisOS();
    if (page === 'persona') renderPersona();
    if (page === 'profile') renderProfile();
    if (page === 'chat') { scrollToEnd(true); setTimeout(function () { $('#input').focus(); }, 60); }
  }

  /* ============================================================
     PAINEL
     ============================================================ */
  function renderDashboard() {
    if (!State.user) return;
    var u = State.user;
    var convs = Store.Convs.all(u.id);
    var usage = Store.Usage.get(u.id);
    var msgs = convs.reduce(function (n, c) { return n + c.messages.length; }, 0);

    var h = new Date().getHours();
    var greet = h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    $('#hello-name').textContent = greet + ', ' + u.name.split(' ')[0] + '.';
    $('#hello-sub').textContent = convs.length
      ? 'Base carregada. Escolha uma missão curta e a gente resolve em uma rodada.'
      : 'Escolha uma missão. Eu faço uma pergunta por vez e devolvo só o próximo passo.';

    var doMes = Store.Usage.doMes(u.id);
    $('#stat-convs').textContent = nf(convs.length);
    $('#stat-msgs').textContent = nf(msgs);
    $('#stat-tokens').textContent = nf(usage.input + usage.output);
    $('#stat-cost').textContent = money(doMes.cost);

    renderTeto();
    atualizarAvisoDeLimiteApi();
    renderProgress();
    renderAvatarCard();
    renderBriefing();
    renderStatus();

    var recent = $('#recent-list');
    recent.innerHTML = '';
    var list = convs.slice(0, 5);
    if (!list.length) {
      recent.innerHTML = '<p class="empty-note">Nenhuma conversa ainda. Toque em “Conversar agora”.</p>';
    } else {
      list.forEach(function (c) {
        var last = c.messages[c.messages.length - 1];
        var btn = document.createElement('button');
        btn.className = 'recent-item';
        btn.innerHTML =
          '<span class="stat-ico v">' + Icons.svg('chat', 16) + '</span>' +
          '<span class="t"><b></b><small></small></span>' +
          '<span class="when">' + when(c.updatedAt) + '</span>';
        $('b', btn).textContent = c.title;
        $('small', btn).textContent = last ? (last.role === 'user' ? 'Você: ' : '') + (last.content || '').slice(0, 90) : 'Sem mensagens';
        btn.addEventListener('click', function () { openConv(c.id); setNav('chat'); });
        recent.appendChild(btn);
      });
    }
  }

  function renderProgress() {
    var box = $('#progress-panel');
    if (!box || !State.user) return;
    var p = Store.Progress.get(State.user.id);
    var span = Math.max(1, p.nextXp - p.prevXp);
    var pct = Math.max(0, Math.min(100, Math.round(((p.xp - p.prevXp) / span) * 100)));
    var ficha = Avatar.ficha(State.user.id, State.perfil);
    var tracos = Avatar.tracos(State.user.id, State.perfil);

    box.innerHTML =
      '<div class="voce-linha">' +
        '<button class="voce-av" data-nav="profile" type="button" title="Ver e ajustar seu avatar">' +
          Avatar.svg(ficha, 96) +
        '</button>' +
        '<div class="voce-txt">' +
          '<div class="xp-head"><div><b>Nível ' + p.level + '</b>' +
          '<small>' + nf(p.xp) + ' XP · ' + tracos + ' traços seus</small></div>' +
          '<span class="badge ok">' + pct + '%</span></div>' +
          '<div class="xp-bar"><span style="width:' + pct + '%"></span></div>' +
          '<p class="voce-desc">' + (tracos > 1
            ? MD.escape(Avatar.descrever(ficha))
            : 'Conte coisas suas e este boneco vai virando você.') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="xp-grid">' +
        '<div class="xp-tile"><b>' + nf(p.streak) + '</b><small>dias seguidos</small></div>' +
        '<div class="xp-tile"><b>' + nf(p.wins) + '</b><small>vitórias pequenas</small></div>' +
        '<div class="xp-tile"><b>' + nf(Math.round(p.voiceMinutes)) + '</b><small>min de voz</small></div>' +
      '</div>';
  }

  /* ------------------------------------------------------------
     O CARTÃO DO AVATAR (página do perfil)

     Mostra o boneco grande, o que ele já sabe, o que ainda falta e
     as skins — as travadas aparecem, porque saber o que vem depois é
     metade da graça.
     ------------------------------------------------------------ */
  var LISTA_TRACOS = [
    { campo: 'pele',       nome: 'Pele' },
    { campo: 'cabelo',     nome: 'Cabelo' },
    { campo: 'cabeloCor',  nome: 'Cor do cabelo' },
    { campo: 'olhos',      nome: 'Olhos' },
    { campo: 'barba',      nome: 'Barba' },
    { campo: 'oculos',     nome: 'Óculos' },
    { campo: 'roupa',      nome: 'Roupa' },
    { campo: 'companhia',  nome: 'Companhia' },
    { campo: 'objeto',     nome: 'Sempre por perto' }
  ];

  function rotuloTraco(campo, valor) {
    var r = Avatar.CURTOS[campo] && Avatar.CURTOS[campo][valor];
    if (r) return r;
    return valor === 'nenhum' || valor === 'nenhuma' ? '—' : (valor || '—');
  }

  function renderAvatarCard() {
    var box = $('#card-avatar');
    if (!box || !State.user) return;

    var uid = State.user.id;
    var ficha = Avatar.ficha(uid, State.perfil);
    var p = Store.Progress.get(uid);

    var linhas = LISTA_TRACOS.map(function (t) {
      var v = ficha[t.campo];
      var vazio = !v || v === 'nenhum' || v === 'nenhuma';
      return '<div class="traco' + (vazio ? ' vazio' : '') + '">' +
             '<small>' + t.nome + '</small><b>' + MD.escape(rotuloTraco(t.campo, v)) + '</b></div>';
    }).join('');

    var acess = (ficha.acessorios || []).map(function (a) {
      return '<span class="tag">' + MD.escape(Avatar.ROTULOS.acessorio[a] || a) + '</span>';
    }).join('');

    var skins = Avatar.skinsDe(uid).map(function (s) {
      return '<button class="skin' + (s.id === ficha.skin ? ' is-on' : '') + (s.liberada ? '' : ' travada') +
             '" type="button" data-skin="' + s.id + '"' + (s.liberada ? '' : ' disabled') + '>' +
             Avatar.svg({ skin: s.id, pele: ficha.pele, cabelo: ficha.cabelo, cabeloCor: ficha.cabeloCor }, 56) +
             '<small>' + MD.escape(s.nome) + (s.liberada ? '' : ' · nível ' + s.nivel) + '</small></button>';
    }).join('');

    box.innerHTML =
      '<div class="card-head"><h4>Seu avatar</h4>' +
        '<span class="badge">nível ' + p.level + '</span></div>' +
      '<div class="av-topo">' +
        '<div class="av-grande">' + Avatar.svg(ficha, 190) + '</div>' +
        '<div class="av-lado">' +
          '<p class="muted small">Ele se desenha sozinho com o que você conta. Cada coisa nova ' +
          'que ' + MD.escape(nomeP()) + ' aprende sobre você vira um traço aqui.</p>' +
          '<div class="tracos">' + linhas + '</div>' +
          (acess ? '<div class="hero-tags">' + acess + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="card-head" style="margin-top:26px"><h4>Skins</h4>' +
        '<span class="badge">' + Avatar.skinsDe(uid).filter(function (s) { return s.liberada; }).length +
        ' de ' + Avatar.SKINS.length + '</span></div>' +
      '<div class="skins">' + skins + '</div>' +
      '<div class="row-btns">' +
        '<button class="btn btn-ghost btn-sm" id="btn-avatar-humor">Como estou hoje</button>' +
        '<button class="btn btn-ghost btn-sm danger" id="btn-avatar-zerar">Recomeçar o avatar</button>' +
      '</div>';

    Icons.render(box);
  }

  function reward(points, reason, patch) {
    if (!State.user || !Store.Progress) return null;
    var p = Store.Progress.reward(State.user.id, points, reason, patch);
    renderProgress();
    if (p.leveled) toast('Nivel ' + p.level + ' desbloqueado.', 'ok');
    return p;
  }

  function rewardEl(points, reason) {
    return '<div class="reward-pop">' + Icons.svg('spark', 13) + '+' + points + ' XP' +
      (reason ? ' · ' + MD.escape(reason) : '') + '</div>';
  }

  /**
   * Converte o que ele registrou nesta rodada em XP.
   * Fechar pendência vale mais: é a vitória pequena que sustenta a próxima.
   */
  function premiarPorAcoes(acoes) {
    if (!State.user || !acoes || !acoes.length || !Store.Progress) return 0;
    var pontos = 0;
    var vitorias = 0;
    acoes.forEach(function (a) {
      if (a.erro) return;
      if (a.nome === 'concluir_pendencia') { vitorias++; return; }
      if (a.nome === 'consultar_financas') return;   // consultar não é conquista
      pontos += 8;
    });
    for (var i = 0; i < vitorias; i++) Store.Progress.win(State.user.id);
    if (pontos) reward(pontos, 'registros'); else if (vitorias) renderProgress();
    return pontos + vitorias * 25;
  }

  /** Quanto da API já foi neste mês, contra o teto que você definiu. */
  function renderTeto() {
    var box = $('#teto-api');
    if (!box || !State.user) return;

    var t = Store.Usage.teto(State.user.id, State.config.tetoMensalUSD);
    var mes = Store.Usage.doMes(State.user.id);

    var economia = mes.economia > 0.005
      ? '<p class="muted small" style="margin-top:10px">O cache de prompt já economizou <b>' +
        money(mes.economia) + '</b> este mês (' + nf(mes.cacheLido) + ' tokens reaproveitados).</p>'
      : '';

    if (!t.teto) {
      box.innerHTML = '<div class="card"><div class="card-head"><h4>Gasto com a API</h4>' +
        '<button class="btn btn-ghost btn-sm" data-nav="settings">Definir teto</button></div>' +
        '<p class="muted small">Você gastou <b>' + money(mes.cost) + '</b> este mês em ' +
        nf(mes.calls) + ' chamadas. Sem teto definido — dá para colocar um limite em Chave &amp; Modelo.</p>' +
        economia + '</div>';
      return;
    }

    var cor = t.estourou ? 'var(--danger)' : t.perto ? 'var(--warn)' : 'linear-gradient(90deg,var(--accent),var(--accent-2))';
    box.innerHTML = '<div class="card"><div class="card-head"><h4>Gasto com a API</h4>' +
      '<span class="badge' + (t.estourou ? ' bad' : '') + '">' + t.pct + '% do teto</span></div>' +
      '<div class="barra grossa"><span style="width:' + Math.min(100, t.pct) + '%;background:' + cor + '"></span></div>' +
      '<div class="ctx-lista" style="margin-top:13px">' +
        '<div class="ctx-item"><small>Este mês</small><p>' + money(mes.cost) + ' de ' + money(t.teto) + '</p></div>' +
        '<div class="ctx-item"><small>Ainda dá para gastar</small><p' + (t.estourou ? ' class="negativo"' : '') + '>' +
          (t.estourou ? 'nada — teto atingido' : money(t.restante)) + '</p></div>' +
      '</div>' +
      economia +
      (t.estourou
        ? '<div class="aviso perigo" style="margin-top:12px">Envios bloqueados até você aumentar o teto ou virar o mês.</div>'
        : t.perto
          ? '<div class="aviso" style="margin-top:12px">Passou de 80% do teto. Trocar para GPT-5.6 Luna rende bem mais conversa pelo que sobra.</div>'
          : '') +
      '</div>';
  }

  /**
   * O "ele te esperando": ao abrir, mostra o que venceu, o que atrasou e o
   * que você concluiu — sem precisar perguntar nada.
   */
  function renderBriefing() {
    var box = $('#briefing');
    if (!box || !State.user) return;

    var atrasadas = Memoria.atrasadas(State.user.id);
    var abertas = Memoria.abertas(State.user.id);
    var contas = Financas.aPagar(State.user.id).filter(function (c) { return c.emDias <= 5; });
    var r = Financas.resumo(State.user.id);

    var itens = [];
    contas.forEach(function (c) {
      itens.push({
        grave: c.emDias <= 0,
        ico: 'coin',
        txt: c.nome + ' · ' + Financas.moeda(c.valor),
        sub: c.emDias < 0 ? 'atrasada há ' + Math.abs(c.emDias) + ' dias'
           : c.emDias === 0 ? 'vence hoje' : 'vence em ' + c.emDias + ' dias',
        ir: 'dinheiro'
      });
    });
    atrasadas.forEach(function (p) {
      var d = Memoria.diasAte(p.prazo);
      itens.push({
        grave: d < 0, ico: 'check', txt: p.texto,
        sub: d === 0 ? 'vence hoje' : 'atrasada há ' + Math.abs(d) + ' dias',
        ir: 'pendencias'
      });
    });
    if (r.estourou) {
      itens.push({
        grave: true, ico: 'bolt',
        txt: 'Você passou do teto de gastos',
        sub: Financas.moeda(r.gastos) + ' de ' + Financas.moeda(r.limite),
        ir: 'dinheiro'
      });
    }

    if (!itens.length) {
      var msg = abertas.length
        ? abertas.length + (abertas.length === 1 ? ' pendência em aberto, nada atrasado.' : ' pendências em aberto, nada atrasado.')
        : 'Nada atrasado, nada vencendo. Está tudo em dia.';
      box.innerHTML = '<div class="briefing ok">' + Icons.svg('check', 18) +
        '<div><b>Tudo sob controle</b><small>' + MD.escape(msg) + '</small></div></div>';
      return;
    }

    box.innerHTML = '<div class="briefing">' +
      '<div class="briefing-head">' + Icons.svg('bolt', 17) +
        '<b>' + nomeP() + ' separou ' + (itens.length === 1 ? 'uma coisa' : itens.length + ' coisas') + ' para você</b></div>' +
      '<div class="lista">' + itens.slice(0, 6).map(function (i) {
        return '<button class="linha' + (i.grave ? ' ruim' : '') + '" data-ir-vida="' + i.ir + '">' +
          '<span class="linha-ico">' + Icons.svg(i.ico, 15) + '</span>' +
          '<div class="linha-txt"><b>' + MD.escape(i.txt) + '</b><small>' + MD.escape(i.sub) + '</small></div></button>';
      }).join('') + '</div>' +
      '<div class="row-btns"><button class="btn btn-primary btn-sm" data-ritual="manha">' +
        Icons.svg('bolt', 15) + ' Me explica o dia</button></div>' +
    '</div>';
  }

  function renderStatus() {
    var m = Claude.modelOf(State.config ? State.config.model : '');
    var keyRow = $('#status-key'), netRow = $('#status-net'), modelRow = $('#status-model');

    var keyMap = {
      ok:      ['ok',  'Conectada e validada'],
      bad:     ['bad', 'Inválida ou sem permissão'],
      none:    ['warn','Nenhuma chave configurada'],
      unknown: ['warn','Salva, ainda não testada']
    };
    var k = keyMap[State.keyStatus] || keyMap.unknown;
    $('.dot', keyRow).className = 'dot ' + k[0];
    $('[data-txt]', keyRow).textContent = k[1];

    var online = navigator.onLine;
    $('.dot', netRow).className = 'dot ' + (online ? 'ok' : 'bad');
    $('[data-txt]', netRow).textContent = online ? 'Online' : 'Sem conexão';

    $('.dot', modelRow).className = 'dot ok';
    $('[data-txt]', modelRow).textContent = m.name + ' · esforço ' + (State.config ? State.config.effort : 'high');

    var pill = $('#api-pill');
    $('.dot', pill).className = 'dot ' + k[0];
    $('[data-txt]', pill).textContent = State.keyStatus === 'ok' ? 'API conectada'
      : State.keyStatus === 'bad' ? 'Chave com problema'
      : State.keyStatus === 'none' ? 'Sem chave da API' : 'Chave não testada';
  }

  /* ============================================================
     CONVERSAS
     ============================================================ */
  function renderConvList() {
    var wrap = $('#conv-list');
    wrap.innerHTML = '';
    var convs = Store.Convs.all(State.user.id);
    if (!convs.length) {
      wrap.innerHTML = '<p class="empty-note">Nenhuma conversa ainda.</p>';
      return;
    }
    convs.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'conv' + (State.conv && State.conv.id === c.id ? ' is-active' : '');
      el.innerHTML = '<button class="conv-title" type="button"></button>' +
                     '<button class="conv-del" type="button" aria-label="Apagar conversa">' + Icons.svg('trash', 14) + '</button>';
      $('.conv-title', el).textContent = c.title;
      $('.conv-title', el).addEventListener('click', function () { openConv(c.id); setNav('chat'); });
      $('.conv-del', el).addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!confirm('Apagar “' + c.title + '”?')) return;
        Store.Convs.remove(State.user.id, c.id);
        if (State.conv && State.conv.id === c.id) {
          var next = Store.Convs.all(State.user.id)[0];
          if (next) openConv(next.id); else newConv();
        }
        renderConvList(); renderDashboard();
      });
      wrap.appendChild(el);
    });
  }

  function newConv(silent) {
    if (State.conv && !State.conv.messages.length) { if (!silent) setNav('chat'); return State.conv; }
    State.conv = Store.Convs.create(State.user.id);
    renderMessages();
    renderConvList();
    if (!silent) $('#input').focus();
    return State.conv;
  }

  function openConv(id, silent) {
    var c = Store.Convs.get(State.user.id, id);
    if (!c) return;
    if (State.running) { State.running.abort(); State.running = null; }
    State.conv = c;
    renderMessages();
    renderConvList();
    if (!silent) scrollToEnd(true);
  }

  /* ============================================================
     CHAT
     ============================================================ */
  function bindChat() {
    var input = $('#input'), form = $('#composer');

    input.addEventListener('input', function () { autosize(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || State.running) return;
      input.value = '';
      autosize(input);
      sendMessage(text);
    });

    $('#btn-stop').addEventListener('click', function () {
      if (State.running) { State.running.abort(); }
      Persona.Voice.calar();
    });

    // Ditado: falar em vez de digitar
    $('#btn-mic').addEventListener('click', function () {
      var btn = $('#btn-mic');
      if (Persona.Ditado.ativo()) { Persona.Ditado.parar(); return; }

      // Com a voz ao vivo ligada o microfone já está em uso pela sessão.
      if (Voz.ativo() || agenteNavegadorAtivo()) {
        toast('A voz ao vivo já está usando o microfone. Desligue ela para ditar.', 'bad');
        return;
      }

      var antes = input.value ? input.value.trim() + ' ' : '';
      var ok = Persona.Ditado.iniciar(function (texto) {
        input.value = antes + texto;
        autosize(input);
      }, function (_texto, erroMsg) {
        btn.classList.remove('gravando');
        if (erroMsg) toast(erroMsg, 'bad');
        input.focus();
      });

      if (ok) { btn.classList.add('gravando'); toast('Pode falar…'); return; }

      var sup = Persona.Ditado.disponivel();
      toast(sup
        ? 'Não consegui abrir o ditado agora. Tente de novo em um segundo.'
        : 'O ditado precisa de Chrome ou Edge em HTTPS/localhost.', 'bad');
    });

    $('#model-quick').addEventListener('change', function (e) {
      State.config = Store.Config.set(State.user.id, { model: e.target.value });
      $('#cfg-model').value = e.target.value;
      updateModelHint();
      renderStatus();
      renderCtxInfo();
    });
  }

  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 190) + 'px';
  }

  /** O microfone só aparece quando o navegador suporta ditado. */
  function atualizarMic() {
    $('#btn-mic').hidden = !Persona.Ditado.disponivel();
    $('#input').placeholder = 'Fala com ' + nomeP() + '…';
    atualizarAgenteUI(Voz.estado(), '');
  }

  function micDeviceKey() {
    return 'kao:mic-device:' + (State.user ? State.user.id : 'local');
  }

  function micDeviceId() {
    try { return localStorage.getItem(micDeviceKey()) || ''; }
    catch (_) { return ''; }
  }

  function salvarMicDeviceId(id) {
    try {
      if (id) localStorage.setItem(micDeviceKey(), id);
      else localStorage.removeItem(micDeviceKey());
    } catch (_) {}
  }

  function vozSensibilidade() {
    return Math.max(40, Math.min(100, Number(State.config && State.config.vozSensibilidade) || 92));
  }

  function audioDoAgente(extra) {
    var audio = Object.assign({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }, extra || {});
    var deviceId = micDeviceId();
    if (deviceId) audio.deviceId = { exact: deviceId };
    return { audio: audio };
  }

  function getUserMediaAgente(extra) {
    return navigator.mediaDevices.getUserMedia(audioDoAgente(extra)).catch(function (erro) {
      var nome = erro && erro.name;
      if (micDeviceId() && (nome === 'OverconstrainedError' || nome === 'NotFoundError')) {
        throw new Error('O microfone escolhido nao foi encontrado neste aparelho. Atualize a lista em Meu perfil.');
      }
      throw erro;
    });
  }

  function parametrosDeVoz() {
    var s = vozSensibilidade();
    var t = (s - 40) / 60;
    return {
      vadThreshold: Math.max(0.14, Math.min(0.36, 0.36 - t * 0.22)),
      vadSilence: Math.max(0.82, Math.min(1.45, 1.45 - t * 0.42)),
      minSpeechMs: Math.round(Math.max(90, 220 - t * 100)),
      minSilenceMs: Math.round(Math.max(210, 420 - t * 160)),
      loteSilencioMs: Math.round(1250 + (1 - t) * 560),
      limiarMin: 0.00075 + (1 - t) * 0.0022,
      limiarMultiplicador: 1.25 + (1 - t) * 1.35
    };
  }

  function preencherMicrofones(devices) {
    var select = $('#cfg-mic-device');
    if (!select) return;
    var atual = micDeviceId();
    var entradas = (devices || []).filter(function (d) { return d.kind === 'audioinput'; });
    select.innerHTML = '<option value="">Microfone padrao do sistema</option>';
    entradas.forEach(function (d, i) {
      var opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || ('Microfone ' + (i + 1));
      select.appendChild(opt);
    });
    if (atual && !entradas.some(function (d) { return d.deviceId === atual; })) {
      var salvo = document.createElement('option');
      salvo.value = atual;
      salvo.textContent = 'Microfone salvo neste aparelho';
      select.appendChild(salvo);
    }
    select.value = atual;
    var hint = $('#mic-device-hint');
    if (hint) {
      hint.textContent = entradas.length
        ? 'Escolha o microfone certo e use Testar sinal para confirmar.'
        : 'Clique em Atualizar e libere o microfone para ver os nomes dos dispositivos.';
    }
  }

  function carregarMicrofones(pedirPermissao) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      preencherMicrofones([]);
      return Promise.resolve([]);
    }
    var liberar = pedirPermissao
      ? navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          stream.getTracks().forEach(function (track) { track.stop(); });
        })
      : Promise.resolve();
    return liberar.catch(function () {}).then(function () {
      return navigator.mediaDevices.enumerateDevices();
    }).then(function (devices) {
      preencherMicrofones(devices);
      return devices;
    });
  }

  function renderVoiceProfileControls() {
    var select = $('#cfg-mic-device');
    var range = $('#cfg-voz-sensibilidade');
    var label = $('#cfg-voz-sensibilidade-label');
    var interrupt = $('#cfg-voz-interrupt');
    if (select) select.value = micDeviceId();
    if (range) range.value = String(vozSensibilidade());
    if (label) label.textContent = vozSensibilidade() + '%';
    if (interrupt) interrupt.checked = State.config.vozInterromper !== false;
  }

  function salvarVoiceProfileControls() {
    var select = $('#cfg-mic-device');
    var range = $('#cfg-voz-sensibilidade');
    var interrupt = $('#cfg-voz-interrupt');
    if (select) salvarMicDeviceId(select.value || '');
    State.config = Store.Config.set(State.user.id, {
      vozSensibilidade: range ? Math.max(40, Math.min(100, Number(range.value) || 92)) : vozSensibilidade(),
      vozInterromper: interrupt ? interrupt.checked : true
    });
    renderVoiceProfileControls();
    if (State.agente.ligado) {
      if (agenteNavegadorAtivo()) {
        var session = State.agente.navegador;
        pararTranscricaoRealtime(session);
        pararCapturaNeural(session, false);
        pararDetectorDeInterrupcao(session);
        reagendarEscutaDoNavegador(120);
      } else if (Voz.ativo()) {
        State.agente.parandoDeProposito = true;
        Voz.encerrar();
        setTimeout(function () { if (State.agente.ligado) conectarVoz(false); }, 400);
      }
    }
  }

  function testarMicrofonePerfil() {
    var out = $('#mic-test-result');
    if (!out || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    out.className = 'test-result show';
    out.textContent = 'Abrindo o microfone escolhido...';
    getUserMediaAgente().then(function (stream) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        throw new Error('Este navegador nao permite medir o sinal do microfone.');
      }
      var ctx = new AC();
      var fonte = ctx.createMediaStreamSource(stream);
      var analisador = ctx.createAnalyser();
      analisador.fftSize = 1024;
      fonte.connect(analisador);
      var dados = new Uint8Array(analisador.fftSize);
      var pico = 0;
      var inicio = Date.now();
      function medir(resolve) {
        analisador.getByteTimeDomainData(dados);
        var soma = 0;
        for (var i = 0; i < dados.length; i++) {
          var valor = (dados[i] - 128) / 128;
          soma += valor * valor;
        }
        pico = Math.max(pico, Math.sqrt(soma / dados.length));
        if (Date.now() - inicio < 1800) requestAnimationFrame(function () { medir(resolve); });
        else resolve();
      }
      return new Promise(medir).then(function () {
        stream.getTracks().forEach(function (track) { track.stop(); });
        ctx.close().catch(function () {});
        var pct = Math.round(Math.min(1, pico * 14) * 100);
        out.className = 'test-result show ' + (pct > 8 ? 'ok' : 'bad');
        out.textContent = pct > 8
          ? 'Sinal captado: ' + pct + '%. Esse microfone esta chegando.'
          : 'Sinal muito baixo. Aumente a sensibilidade, aproxime o microfone ou escolha outro dispositivo.';
        carregarMicrofones(false);
      });
    }).catch(function (erro) {
      out.className = 'test-result show bad';
      out.textContent = (erro && erro.message) || 'Nao consegui testar esse microfone.';
    });
  }

  function nearBottom() {
    var s = $('#chat-scroll');
    return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
  }
  function scrollToEnd(force) {
    var s = $('#chat-scroll');
    if (force || nearBottom()) s.scrollTop = s.scrollHeight;
  }

  function renderCtxInfo() {
    var n = State.conv ? State.conv.messages.length : 0;
    var m = Claude.modelOf(State.config.model);
    $('#ctx-info').textContent = n
      ? n + (n === 1 ? ' mensagem' : ' mensagens') + ' no contexto · ' + m.name
      : m.name + ' · ' + (m.ctx >= 1e6 ? '1M' : Math.round(m.ctx / 1000) + 'K') + ' de contexto';
  }

  function renderMessages() {
    var box = $('#messages');
    box.innerHTML = '';
    var msgs = State.conv ? State.conv.messages : [];
    var vazio = $('#chat-empty');
    vazio.classList.toggle('hidden', msgs.length > 0);
    if (!msgs.length && State.persona) {
      // container fixo: sobrevive a várias renderizações
      $('#chat-empty-ava').innerHTML =
        '<div class="av-big" style="background:' + Persona.gradienteOf(State.persona.gradiente) + '">' +
        MD.escape(State.persona.emoji) + '</div>';
      $('h3', vazio).textContent = 'E aí, ' + apelido() + '. Por onde a gente começa?';
    }
    msgs.forEach(function (m) { box.appendChild(messageEl(m)); });
    Icons.render(box);
    renderCtxInfo();
    scrollToEnd(true);
  }

  function messageEl(msg) {
    var el = document.createElement('div');
    el.className = 'msg ' + (msg.role === 'user' ? 'user' : 'bot');
    el.dataset.id = msg.id;

    var name = msg.role === 'user'
      ? 'Você' + (msg.viaVoz ? ' · falando' : '')
      : nomeP() + (msg.viaVoz ? ' · voz ao vivo'
                  : msg.model ? ' · ' + Claude.modelOf(msg.model).name : '');

    var ava = msg.role === 'user'
      ? (State.perfil.foto
          ? '<div class="msg-ava" style="background-image:url(' + State.perfil.foto + ');background-size:cover"></div>'
          : '<div class="msg-ava av-mini">' + Avatar.svg(Avatar.ficha(State.user.id, State.perfil), 32, { fundo: false }) + '</div>')
      : '<div class="msg-ava" style="background:' + Persona.gradienteOf(State.persona.gradiente) + '">' +
        MD.escape(State.persona.emoji) + '</div>';

    el.innerHTML = ava +
      '<div class="msg-body">' +
        '<div class="msg-name">' + MD.escape(name) + '</div>' +
        '<div class="think-slot"></div>' +
        '<div class="msg-content"></div>' +
        '<div class="msg-tools"></div>' +
      '</div>';

    var content = $('.msg-content', el);
    if (msg.error) {
      content.innerHTML = '<div class="msg-err"><b>Não deu para responder</b><span></span></div>';
      $('.msg-err span', content).textContent = msg.error;
    } else {
      var acoes = (msg.acoes && msg.acoes.length)
        ? '<div class="acoes">' + msg.acoes.map(function (a) {
            return '<span class="acao' + (a.erro ? ' erro' : '') + '">' +
                   Icons.svg(a.erro ? 'x' : 'check', 12) + MD.escape(a.rotulo) + '</span>';
          }).join('') + '</div>'
        : '';
      content.innerHTML = acoes + MD.render(msg.content || '');
    }

    if (msg.thinking) setThinking(el, msg.thinking, false);

    if (!msg.error) {
      var tools = $('.msg-tools', el);
      var copy = document.createElement('button');
      copy.className = 'msg-tool';
      copy.innerHTML = Icons.svg('copy', 13) + '<span>Copiar</span>';
      copy.addEventListener('click', function () {
        navigator.clipboard.writeText(msg.content || '').then(function () { toast('Copiado.', 'ok'); });
      });
      tools.appendChild(copy);

      if (msg.role === 'assistant') {
        var again = document.createElement('button');
        again.className = 'msg-tool';
        again.innerHTML = Icons.svg('redo', 13) + '<span>Refazer</span>';
        again.addEventListener('click', function () { regenerate(msg.id); });
        tools.appendChild(again);

        if (Persona.Voice.disponivel() && State.persona.voz.ativa) {
          var ouvir = document.createElement('button');
          ouvir.className = 'msg-tool';
          ouvir.innerHTML = Icons.svg('sound', 13) + '<span>Ouvir</span>';
          ouvir.addEventListener('click', function () {
            if (ouvir.classList.contains('falando')) { Persona.Voice.calar(); marcarFala(ouvir, false); return; }
            marcarFala(ouvir, true);
            Persona.Voice.falar(msg.content, State.persona.voz, function () { marcarFala(ouvir, false); });
          });
          tools.appendChild(ouvir);
        }
      }
    }
    return el;
  }

  /** Explica o bloqueio no próprio chat, em vez de só um toast que some. */
  function mostrarBloqueioDeTeto(t) {
    if (!State.conv) return;
    var el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML =
      '<div class="msg-ava" style="background:' + Persona.gradienteOf(State.persona.gradiente) + '">' +
        MD.escape(State.persona.emoji) + '</div>' +
      '<div class="msg-body"><div class="msg-name">' + MD.escape(nomeP()) + '</div>' +
      '<div class="msg-content"><div class="msg-err"><b>Teto do mês atingido</b>' +
        '<span>Você definiu um limite de ' + money(t.teto) + ' por mês para a API e já usou ' +
        money(t.gasto) + '. Não vou gastar mais sem você mandar.<br><br>' +
        'Para continuar: aumente o teto em <b>Chave &amp; Modelo</b>, ou espere virar o mês. ' +
        'Trocar para GPT-5.6 Luna também rende muito mais conversa pelo mesmo dinheiro.</span>' +
      '</div></div></div>';
    $('#messages').appendChild(el);
    scrollToEnd(true);
  }

  function marcarFala(btn, ativo) {
    btn.classList.toggle('falando', ativo);
    $('span', btn).textContent = ativo ? 'Parar' : 'Ouvir';
  }

  function setThinking(el, text, open) {
    var slot = $('.think-slot', el);
    var det = $('details', slot);
    if (!det) {
      slot.innerHTML = '<details class="think"' + (open ? ' open' : '') + '>' +
        '<summary>' + Icons.svg('brain', 14) + ' Raciocínio</summary>' +
        '<div class="think-body"></div></details>';
      det = $('details', slot);
    }
    $('.think-body', det).textContent = text;
  }

  function sendMessage(text) {
    if (!State.apiKey) {
      toast('Configure sua chave da API primeiro.', 'bad');
      setNav('settings');
      return;
    }

    // Teto de gasto: a API é o único custo do app, então ela tem freio.
    var t = Store.Usage.teto(State.user.id, State.config.tetoMensalUSD);
    if (t.estourou) {
      atualizarAvisoDeLimiteApi();
      toast('Teto de ' + money(t.teto) + ' atingido neste mês. Ajuste em Chave & Modelo.', 'bad');
      mostrarBloqueioDeTeto(t);
      setNav('settings');
      return;
    }
    if (!State.conv) newConv(true);

    var userMsg = { id: Store.uid(), role: 'user', content: text, at: Date.now() };
    State.conv.messages.push(userMsg);

    if (State.conv.messages.length === 1) {
      State.conv.title = text.replace(/\s+/g, ' ').slice(0, 42) + (text.length > 42 ? '…' : '');
    }
    Store.Convs.save(State.user.id, State.conv);

    $('#chat-empty').classList.add('hidden');
    $('#messages').appendChild(messageEl(userMsg));
    renderConvList();
    scrollToEnd(true);

    streamReply();
  }

  function regenerate(assistantId) {
    if (State.running) return;
    var msgs = State.conv.messages;
    var idx = msgs.findIndex(function (m) { return m.id === assistantId; });
    if (idx < 0) return;
    msgs.splice(idx, msgs.length - idx);        // remove a resposta (e o que veio depois)
    Store.Convs.save(State.user.id, State.conv);
    renderMessages();
    streamReply();
  }

  /**
   * Monta o system prompt em camadas, da mais estável para a mais volátil —
   * assim o começo do prompt fica igual entre requisições e o cache da API pega.
   */
  /**
   * Devolve { estavel, volatil }.
   *
   * A separação existe por causa do cache da API: o pedaço estável é
   * idêntico entre mensagens e sai por 10% do preço a partir da segunda.
   * Qualquer byte que mude ali invalida o cache inteiro — por isso
   * memória, finanças e hora atual ficam do lado volátil.
   */
  function buildSystem() {
    var partes = [];

    // 1. personalidade (praticamente nunca muda)
    partes.push(State.config.systemMode === 'custom' && State.config.system
      ? State.config.system.replace(/\{\{nome\}\}/gi, apelido())
      : Persona.buildPrompt(State.user, State.perfil, State.persona));

    if (agenteNavegadorAtivo()) {
      partes.push(
        '# Conversa por voz\n' +
        'Converse como uma pessoa presente, nao como uma central de ajuda. Comece respondendo ou validando o que a pessoa disse em uma frase curta. ' +
        'Fale em blocos de no maximo tres frases e termine com uma pergunta real, uma por vez, para abrir espaco para ela responder. ' +
        'Traga conteudo seu antes de perguntar: uma leitura do que ela disse, uma hipotese ou um proximo passo concreto. ' +
        'Pergunta atras de pergunta vira interrogatorio; o que ela precisa e alguem pensando junto. ' +
        'Puxe o proximo assunto apenas quando ele fizer sentido pelo contexto; seja curioso sem virar interrogatorio. ' +
        'Nao anuncie que vai ajudar nem descreva seu processo. Use linguagem oral, direta e calorosa. ' +
        'Uma pausa curta pode ser pensamento: espere a pessoa concluir antes de responder e nunca trate uma frase incompleta como a vez dela terminada. ' +
        'Falar pouco nao e gravar pouco: siga chamando as ferramentas de registro no meio da conversa, ' +
        'sem anunciar e sem sair do assunto. O que voce nao gravar enquanto ela fala, some.'
      );
      partes.push(
        '# JarvisOS\n' +
        '- Use registrar_no_vault para ideias soltas, decisoes, referencias e contexto que ainda nao viraram tarefa.\n' +
        '- Quando a pessoa pedir caixa da manha, fechamento, JarvisOS ou resumo do dia, use executar_caixa ou fechar_dia.'
      );
    }

    // 2. como usar as ferramentas
    if (State.config.ferramentas !== false) {
      partes.push(
        '# Suas ferramentas\n' +
        'Você grava e consulta coisas de verdade, sem pedir licença. Regras:\n' +
        '- Registre no momento em que a informação aparece na conversa, mesmo de passagem. ' +
        '"Ontem gastei 60 no mercado" é um registrar_gasto, não um comentário.\n' +
        '- Antes de responder, releia a última fala dela atrás do que precisa virar registro. ' +
        'Achou, chama a ferramenta nesta mesma resposta: não guarda para depois, não espera ela pedir, não pergunta se pode.\n' +
        '- Gatilhos, sem exceção:\n' +
        '  - fato estável sobre ela, a vida, o trabalho, a saúde, a rotina, gostos ou alguém próximo: lembrar_fato\n' +
        '  - qualquer coisa que ela precise, queira ou tenha combinado fazer, inclusive "preciso", "tenho que", "amanhã eu": criar_pendencia\n' +
        '  - algo que ela disse que terminou: concluir_pendencia\n' +
        '  - dinheiro que saiu ou entrou: registrar_gasto ou registrar_receita\n' +
        '  - ideia, decisão, referência ou contexto solto que ainda não virou tarefa: registrar_no_vault\n' +
        '- Uma conversa boa rende vários registros. Grave tudo o que apareceu, não só o item mais óbvio, ' +
        'e volte a gravar nos turnos seguintes.\n' +
        '- Nunca peça para a pessoa preencher formulário nem repetir o que já disse. O atrito de registrar é o que faz sistema de TDAH morrer.\n' +
        '- Pode chamar várias ferramentas de uma vez.\n' +
        '- Depois de registrar, siga a conversa normalmente. Uma menção curta basta ("anotei"), sem relatório do que você fez.\n' +
        '- Antes de opinar sobre dinheiro, chame consultar_financas e fale com número na mão.'
      );
    }

    if (State.config.ferramentas !== false && !agenteNavegadorAtivo()) {
      partes.push(
        '# JarvisOS\n' +
        '- Use registrar_no_vault para ideias soltas, decisoes, referencias e contexto que ainda nao viraram tarefa.\n' +
        '- Quando a pessoa pedir caixa da manha, fechamento, JarvisOS ou resumo do dia, use executar_caixa ou fechar_dia.'
      );
    }

    var estavel = partes.join('\n\n');

    // --- daqui para baixo é volátil: fica FORA do cache ---
    var vol = [];

    var mem = Memoria.resumoParaPrompt(State.user.id);
    if (mem) vol.push('# Memória\n' + mem);

    var vault = Store.Vault && Store.Vault.resumoParaPrompt(State.user.id);
    if (vault) vol.push('# JarvisOS Vault\n' + vault);

    var retrato = Avatar.descrever(Avatar.ficha(State.user.id, State.perfil));
    vol.push('# O avatar dela\n' +
      (retrato ? 'O que você já desenhou: ' + retrato + '.' : 'Você ainda não desenhou nada dela.') +
      ' Use atualizar_avatar assim que souber de um traço novo, sem perguntar do nada — ' +
      'só quando aparecer na conversa. Nunca invente aparência.');

    var fin = Financas.resumoParaPrompt(State.user.id);
    if (fin) vol.push('# Finanças\n' + fin);

    var agora = new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
    vol.push('# Agora\nData e hora locais: ' + agora +
      '. Use isso para saber se é começo de dia, fim de tarde ou madrugada, e ajuste o que você propõe.');

    return { estavel: estavel, volatil: vol.join('\n\n') };
  }

  /* ------------------------------------------------------------
     Quanto ele pode escrever numa resposta falada

     Falar curto e instrucao de prompt, nao teto de tokens. Com o teto
     em 360 a frase era cortada no meio; e em modelo com raciocinio o
     raciocinio consumia o teto inteiro e a resposta voltava VAZIA — que
     e o "ele nao conversa" e o "ele nao desenvolve ideias". Entao aqui
     o teto e folgado e o esforco de raciocinio cai, porque conversa
     falada precisa de resposta rapida, nao de reflexao longa.
     ------------------------------------------------------------ */
  var TOKENS_VOZ_MIN = 1600;
  var TOKENS_VOZ_MAX = 4000;

  function tokensDaResposta(cfg) {
    if (!agenteNavegadorAtivo()) return cfg.maxTokens;
    var teto = Number(cfg.maxTokens) || TOKENS_VOZ_MIN;
    return Math.max(TOKENS_VOZ_MIN, Math.min(teto, TOKENS_VOZ_MAX));
  }

  function esforcoDaResposta(cfg) {
    return agenteNavegadorAtivo() ? 'low' : cfg.effort;
  }

  function streamReply() {
    var conv = State.conv;
    var cfg = State.config;
    var placeholder = { id: Store.uid(), role: 'assistant', content: '', model: cfg.model, at: Date.now() };

    var el = messageEl(placeholder);
    var content = $('.msg-content', el);
    content.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    $('#messages').appendChild(el);
    scrollToEnd(true);

    $('#btn-stop').hidden = false;
    $('.send').disabled = true;

    var text = '', textoAnterior = '', thinking = '', pending = false;
    var filaDeFala = agenteNavegadorAtivo() && usarVozNatural()
      ? criarFilaFalaDoAgente(State.agente.navegador)
      : null;
    var acoes = [];                       // ferramentas executadas neste turno
    var uso = { input: 0, output: 0, cacheLido: 0, cacheEscrito: 0 };
    var apiMessages = Claude.toApiMessages(conv.messages);
    var rodada = 0;
    var MAX_RODADAS = 6;                  // trava de segurança contra laço infinito

    function paint() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        var stick = nearBottom();
        content.innerHTML = htmlAcoes() + MD.render(text, true) + '<span class="cursor-dot"></span>';
        Icons.render(content);
        if (stick) scrollToEnd(true);
      });
    }

    function htmlAcoes() {
      if (!acoes.length) return '';
      return '<div class="acoes">' + acoes.map(function (a) {
        return '<span class="acao' + (a.erro ? ' erro' : '') + '">' +
               Icons.svg(a.erro ? 'x' : 'check', 12) + MD.escape(a.rotulo) + '</span>';
      }).join('') + '</div>';
    }

    function rodar() {
      rodada++;
      var sys = buildSystem();
      var run = Claude.stream({
        apiKey: State.apiKey,
        provider: cfg.provider,
        model: cfg.model,
        effort: esforcoDaResposta(cfg),
        maxTokens: tokensDaResposta(cfg),
        showThinking: cfg.showThinking,
        systemEstavel: sys.estavel,
        systemVolatil: sys.volatil,
        messages: apiMessages,
        tools: State.config.ferramentas === false ? null : Ferramentas.DEFINICOES
      }, {
        onThinking: function (_, all) {
          thinking = all;
          setThinking(el, all, true);
          scrollToEnd();
        },
        onText: function (_, all) {
          text = textoAnterior + all;
          if (filaDeFala) filaDeFala.receber(text);
          paint();
        },
        onTool: function (nome) {
          content.innerHTML = htmlAcoes() +
            (text ? MD.render(text, true) : '') +
            '<div class="acao pendente">' + Icons.svg('spark', 12) + Ferramentas.rotulo(nome, {}) + '…</div>';
          Icons.render(content);
          scrollToEnd();
        },

        onDone: function (info) {
          var us = info.usage || {};
          uso.input += us.input_tokens || 0;
          uso.output += us.output_tokens || 0;
          uso.cacheLido += us.cache_read_input_tokens || 0;
          uso.cacheEscrito += us.cache_creation_input_tokens || 0;

          // Precisa usar ferramenta: executa e devolve o resultado numa nova rodada.
          if (!info.aborted && info.stopReason === 'tool_use' && info.ferramentas.length && rodada < MAX_RODADAS) {
            var resultados = info.ferramentas.map(function (t) {
              var r = Ferramentas.executar(State.user.id, t.name, t.input);
              acoes.push({ nome: t.name, rotulo: Ferramentas.rotulo(t.name, t.input), erro: r.erro });
              return {
                tool_use_id: t.id,
                content: r.conteudo,
                is_error: !!r.erro
              };
            });
            apiMessages = Claude.appendToolResults(apiMessages, info, resultados);

            textoAnterior = text;
            paint();
            atualizarTudoDepoisDeFerramenta();
            rodar();
            return;
          }

          finalizar(info);
        },

        onError: function (err) {
          State.running = null;
          $('#btn-stop').hidden = true;
          $('.send').disabled = false;

          var errMsg = { id: Store.uid(), role: 'assistant', error: err.message, at: Date.now() };
          conv.messages.push(errMsg);
          Store.Convs.save(State.user.id, conv);
          el.replaceWith(messageEl(errMsg));
          scrollToEnd();

          if (err.kind === 'auth') { setKeyStatus('bad'); }
          if (err.kind === 'rate_limit' || err.kind === 'quota_exhausted') {
            registrarLimiteDaApi(cfg.provider, err, err.kind);
          }
          if (agenteNavegadorAtivo()) {
            if (filaDeFala) filaDeFala.cancelar();
            State.agente.navegador.ocupado = false;
            reagendarEscutaDoNavegador(400);
          }
        }
      });

      State.running = run;
      run.promise.catch(function () { /* já tratado em onError */ });
    }

    function finalizar(info) {
      State.running = null;
      $('#btn-stop').hidden = true;
      $('.send').disabled = false;

      var finalText = text || info.text || '';
      if (info.aborted && !finalText && !acoes.length) { el.remove(); return; }
      if (info.aborted) finalText += '\n\n_(interrompido)_';

      placeholder.content = finalText;
      placeholder.thinking = info.thinking || thinking || '';
      placeholder.acoes = acoes.slice();
      conv.messages.push(placeholder);
      Store.Convs.save(State.user.id, conv);

      Store.Usage.add(State.user.id, uso.input, uso.output, cfg.model,
                      { lidos: uso.cacheLido, escritos: uso.cacheEscrito });
      if (!info.aborted) limparAvisoDeLimiteApi(cfg.provider);
      else atualizarAvisoDeLimiteApi();

      var ganho = premiarPorAcoes(acoes);
      if (!info.aborted) reward(3, 'conversa');

      var fresh = messageEl(placeholder);
      if (ganho) {
        var alvo = $('.msg-content', fresh);
        if (alvo) alvo.insertAdjacentHTML('beforeend', rewardEl(ganho, 'você mexeu no seu sistema'));
      }
      el.replaceWith(fresh);
      Icons.render(fresh);
      renderConvList();
      renderCtxInfo();
      scrollToEnd();

      // Nada gravado neste turno: releia a conversa antes que ela esfrie.
      if (!info.aborted && !acoes.length) catalogarConversa(conv, placeholder);

      // fala sozinho, se o personagem estiver configurado assim
      var voz = State.persona.voz;
      if (!info.aborted && voz.ativa && voz.auto && Persona.Voice.disponivel() && !agenteNavegadorAtivo()) {
        var btnOuvir = $$('.msg-tool', fresh).filter(function (b) {
          return b.textContent.indexOf('Ouvir') > -1;
        })[0];
        if (btnOuvir) btnOuvir.click();
        else Persona.Voice.falar(finalText, voz);
      }

      if (!info.aborted && agenteNavegadorAtivo()) {
        if (filaDeFala) filaDeFala.finalizar(finalText);
        else falarDoNavegador(finalText);
      } else if (agenteNavegadorAtivo()) {
        // Interrompido no meio: ele nao fala esta resposta, mas o microfone
        // TEM que voltar. Sem isso a sessao ficava ligada e surda para sempre.
        if (filaDeFala) filaDeFala.cancelar();
        State.agente.navegador.ocupado = false;
        reagendarEscutaDoNavegador(250);
      } else if (filaDeFala) {
        filaDeFala.cancelar();
      }

      if (info.stopReason === 'max_tokens' || info.stopReason === 'length') {
        toast('A resposta atingiu o limite de tokens. Aumente em Chave & Modelo.', 'bad');
      }
    }

    rodar();
  }

  /* ============================================================
     CATALOGACAO EM TEMPO REAL

     O modelo esquece de gravar quando a conversa esquenta - ainda mais em
     modelo economico, e ainda mais no modo voz, onde o proprio prompt pede
     resposta curta. So que no TDAH o que nao entra na hora nao entra nunca,
     e a "Minha vida" fica vazia justo nos dias em que mais se conversou.
     Entao toda resposta que nao gravou nada leva uma segunda passada, curta
     e invisivel, so para varrer o que ficou de fora.
     ============================================================ */
  var FERRAMENTAS_DE_REGISTRO = [
    'lembrar_fato', 'criar_pendencia', 'concluir_pendencia',
    'registrar_gasto', 'registrar_receita', 'cadastrar_conta',
    'marcar_conta_paga', 'registrar_no_vault'
  ];

  function ferramentasDeRegistro() {
    return Ferramentas.DEFINICOES.filter(function (t) {
      return FERRAMENTAS_DE_REGISTRO.indexOf(t.name) > -1;
    });
  }

  /** A varredura roda a cada turno, entao vai no modelo mais barato do provedor. */
  function modeloDaCatalogacao() {
    var atual = Claude.modelOf(State.config.model);
    var candidatos = Claude.MODELS.filter(function (m) { return m.provider === atual.provider; });
    var barato = candidatos.sort(function (a, b) { return a.price.in - b.price.in; })[0];
    return (barato && barato.price.in <= atual.price.in ? barato : atual).id;
  }

  /** Costura as etiquetas do que foi gravado na mensagem que ja esta na tela. */
  function mostrarAcoesNaMensagem(msg, novas) {
    var el = $('#messages [data-id="' + msg.id + '"]');
    var content = el && $('.msg-content', el);
    if (!content) return;
    var caixa = $('.acoes', content);
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.className = 'acoes';
      content.insertBefore(caixa, content.firstChild);
    }
    caixa.insertAdjacentHTML('beforeend', novas.map(function (a) {
      return '<span class="acao' + (a.erro ? ' erro' : '') + '">' +
             Icons.svg(a.erro ? 'x' : 'check', 12) + MD.escape(a.rotulo) + '</span>';
    }).join(''));
  }

  function promptDoCatalogador() {
    return '# Catalogador\n' +
      'Voce le um pedaco de conversa entre uma pessoa com TDAH e o copiloto dela e grava o que apareceu ' +
      'ali e ainda nao esta registrado. Voce nao conversa, nao comenta e nao responde: so chama ferramenta.\n' +
      '- Fato estavel sobre ela, a vida, o trabalho, a saude, a rotina, gostos ou pessoas proximas: lembrar_fato.\n' +
      '- Qualquer coisa que ela precise, queira ou tenha combinado fazer: criar_pendencia.\n' +
      '- Algo que ela disse que terminou: concluir_pendencia.\n' +
      '- Dinheiro que saiu ou entrou: registrar_gasto ou registrar_receita.\n' +
      '- Conta recorrente que ela mencionou: cadastrar_conta. Conta que ela pagou: marcar_conta_paga.\n' +
      '- Ideia, decisao, referencia ou contexto solto que ainda nao virou tarefa: registrar_no_vault.\n' +
      '- Grave so o que a PESSOA disse ou confirmou. Sugestao do copiloto que ela nao aceitou nao vira registro.\n' +
      '- Nao repita nada que ja esteja na lista abaixo, nem com outras palavras. Nao invente o que nao foi dito.\n' +
      '- Se nao ha nada novo, nao chame ferramenta nenhuma e responda apenas: nada.\n\n' +
      '# Ja registrado\n' + (Memoria.resumoParaPrompt(State.user.id) || '(nada ainda)');
  }

  /**
   * Rele o ultimo par de falas e grava o que passou batido.
   * Roda solto, sem travar a conversa: se falhar, falha em silencio.
   */
  function catalogarConversa(conv, resposta) {
    if (!State.user || !State.apiKey) return;
    if (State.config.ferramentas === false || State.config.catalogoAuto === false) return;
    if (Store.Usage.teto(State.user.id, State.config.tetoMensalUSD).estourou) return;

    var msgs = (conv && conv.messages) || [];
    var fala = null;
    for (var i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user' && msgs[i].content) { fala = msgs[i]; break; }
    }
    var dito = fala ? String(fala.content).trim() : '';
    if (dito.length < 12) return;              // "oi", "ok", "pode ser": nao ha o que catalogar

    var modelo = modeloDaCatalogacao();
    var trecho = 'PESSOA: ' + dito.slice(0, 4000) + '\n\n' +
                 'COPILOTO: ' + String(resposta.content || '').trim().slice(0, 4000);

    Claude.stream({
      apiKey: State.apiKey,
      model: modelo,
      effort: 'low',
      maxTokens: 1200,
      system: promptDoCatalogador(),
      messages: [{ role: 'user', content: trecho }],
      tools: ferramentasDeRegistro()
    }, {
      onDone: function (info) {
        var us = info.usage || {};
        Store.Usage.add(State.user.id, us.input_tokens || 0, us.output_tokens || 0, modelo,
                        { lidos: us.cache_read_input_tokens || 0, escritos: 0 });

        var chamadas = (info.ferramentas || []).filter(function (t) {
          return FERRAMENTAS_DE_REGISTRO.indexOf(t.name) > -1;
        });
        if (!chamadas.length) return;

        var novas = chamadas.map(function (t) {
          var r = Ferramentas.executar(State.user.id, t.name, t.input);
          return { nome: t.name, rotulo: Ferramentas.rotulo(t.name, t.input), erro: r.erro };
        });
        resposta.acoes = (resposta.acoes || []).concat(novas);
        Store.Convs.save(State.user.id, conv);
        mostrarAcoesNaMensagem(resposta, novas);
        atualizarTudoDepoisDeFerramenta();
        premiarPorAcoes(novas);
      },
      onError: function () { /* catalogar e bonus: falhar aqui nao pode atrapalhar a conversa */ }
    }).promise.catch(function () { /* idem */ });
  }

  /** Depois de uma ferramenta gravar algo, as telas precisam refletir. */
  function atualizarTudoDepoisDeFerramenta() {
    renderVida();
    renderJarvisOS();
    renderDashboard();
    pintarAvatarTopo();
  }

  /* ============================================================
     JARVISOS
     ============================================================ */
  function vaultJarvis() {
    if (!State.user || !Store.Vault) return null;
    return Store.Vault.ensure(State.user.id, State.user, State.perfil, State.persona);
  }

  function resumoCaixaJarvis(resultado) {
    if (!resultado) return '';
    return [
      'Caixa da manha pronta em Diario/' + Store.Vault.dataBR(Store.Vault.hoje()) + '.md',
      '',
      'O que caiu:',
      resultado.inbox.length ? resultado.inbox.map(function (n) { return '- ' + n.texto; }).join('\n') : '- inbox limpa',
      '',
      'Onde parei:',
      resultado.pendentes.length ? resultado.pendentes.map(function (p) { return '- [ ] ' + p; }).join('\n') : '- sem pendencia registrada ontem',
      '',
      'Missao do dia:',
      resultado.prioridades.map(function (p) { return '- [ ] ' + p; }).join('\n')
    ].join('\n');
  }

  function setValorSeNaoEditando(id, valor) {
    var el = $(id);
    if (!el || document.activeElement === el) return;
    el.value = valor || '';
  }

  function renderJarvisOS() {
    if (!State.user || !Store.Vault) return;
    var v = vaultJarvis();
    var hoje = Store.Vault.diarioDe(State.user.id, Store.Vault.hoje());
    var status = $('#jarvis-status');
    if (!status) return;

    status.innerHTML =
      '<div class="jarvis-stat"><span>00-Inbox</span><b>' + nf(v.inbox.length) + '</b></div>' +
      '<div class="jarvis-stat"><span>Diario</span><b>' + nf(v.diario.length) + '</b></div>' +
      '<div class="jarvis-stat"><span>Caixa</span><b>' + (v.lastBriefing === Store.Vault.hoje() ? 'hoje' : 'pendente') + '</b></div>';

    var out = $('#jarvis-output');
    if (out && !out.dataset.manual) {
      out.textContent = hoje && hoje.markdown
        ? hoje.markdown
        : 'Rode a Caixa da manha para criar Diario/' + Store.Vault.dataBR(Store.Vault.hoje()) + '.md';
    }

    setValorSeNaoEditando('#vault-contexto', v.contexto);
    setValorSeNaoEditando('#vault-pendencias', v.pendencias);
    setValorSeNaoEditando('#vault-ignore', v.ignore);

    var inbox = $('#jarvis-inbox-list');
    if (inbox) {
      inbox.innerHTML = v.inbox.length ? v.inbox.slice(0, 10).map(function (n) {
        return '<div class="vault-line"><small>' + MD.escape(when(n.createdAt || Date.now())) + '</small><p>' +
          MD.escape(n.texto) + '</p></div>';
      }).join('') : '<p class="empty-note">Inbox limpa.</p>';
    }

    var diario = $('#jarvis-diario-list');
    if (diario) {
      diario.innerHTML = v.diario.length ? v.diario.slice(0, 6).map(function (d) {
        var linhas = String(d.markdown || '').split(/\r?\n/).filter(Boolean).slice(0, 4).join(' / ');
        return '<div class="vault-line"><small>Diario/' + MD.escape(Store.Vault.dataBR(d.data)) + '.md</small><p>' +
          MD.escape(linhas || 'sem texto') + '</p></div>';
      }).join('') : '<p class="empty-note">Nenhum diario ainda.</p>';
    }

    Icons.render($('#page-jarvis'));
  }

  function salvarVaultJarvis() {
    if (!State.user || !Store.Vault) return;
    Store.Vault.salvarArquivos(State.user.id, {
      contexto: ($('#vault-contexto') && $('#vault-contexto').value) || '',
      pendencias: ($('#vault-pendencias') && $('#vault-pendencias').value) || '',
      ignore: ($('#vault-ignore') && $('#vault-ignore').value) || ''
    });
    renderJarvisOS();
    toast('Vault salvo e sincronizado.', 'ok');
  }

  function adicionarInboxJarvis() {
    if (!State.user || !Store.Vault) return;
    var input = $('#vault-inbox-text');
    var texto = input ? input.value.trim() : '';
    if (!texto) { toast('Escreva uma nota para o 00-Inbox.', 'bad'); return; }
    Store.Vault.addInbox(State.user.id, texto, 'manual');
    input.value = '';
    renderJarvisOS();
    reward(6, 'nota no JarvisOS');
    toast('Entrou no 00-Inbox.', 'ok');
  }

  function exportarVaultJarvis() {
    if (!State.user || !Store.Vault) return;
    var blob = new Blob([Store.Vault.exportar(State.user.id)], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'jarvisos-vault-' + Store.Vault.hoje() + '.md';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Vault exportado em markdown.', 'ok');
  }

  function mandarPromptJarvis(texto) {
    if (!texto) return;
    newConv(true);
    setNav('chat');
    sendMessage(texto);
  }

  function executarSkillJarvis(skill) {
    if (!State.user || !Store.Vault) return;
    if (skill === 'caixa') {
      var r = Store.Vault.caixa(State.user.id);
      var out = $('#jarvis-output');
      if (out) out.textContent = resumoCaixaJarvis(r);
      renderJarvisOS();
      reward(15, 'caixa da manha');
      toast('Caixa da manha gravada no Diario.', 'ok');
      return;
    }
    if (skill === 'fechamento') {
      var resumo = prompt('Fechamento rapido de hoje:');
      var f = Store.Vault.fechamento(State.user.id, resumo || '');
      var output = $('#jarvis-output');
      if (output) output.textContent = f.markdown;
      renderJarvisOS();
      reward(15, 'fechamento');
      toast('Fechamento gravado no Diario.', 'ok');
      return;
    }
    if (skill === 'metricas') {
      mandarPromptJarvis('Use meu JarvisOS Vault, memoria e historico para analisar minhas metricas pessoais. Traga padroes de energia, travas, voz, dinheiro e pendencias em no maximo 12 linhas, com 3 ajustes praticos.');
      return;
    }
    if (skill === 'tendencias') {
      mandarPromptJarvis('Use meu JarvisOS Vault como base e encontre tendencias nos meus ultimos registros: temas recorrentes, sinais de sobrecarga e oportunidades. Seja artistico, direto e util.');
      return;
    }
    if (skill === 'plano') {
      mandarPromptJarvis('Use meu JarvisOS Vault para montar um plano de uma pagina para hoje. Se a Caixa da manha ainda nao rodou, chame executar_caixa antes. Entregue so o mapa do dia e o primeiro passo.');
    }
  }

  function renderVida() {
    if (State.user && global_Vida()) Vida.render();
  }
  function global_Vida() { return typeof Vida !== 'undefined'; }

  /* ============================================================
     O AGENTE — voz ao vivo que fica de pé sozinha

     A ideia: não é um botão de "ligar chamada", é alguém do seu lado.
     Você entra, ele já está lá, já ouve e já fala. Se a conexão cair ou
     a sessão expirar, ele volta sozinho sem te avisar. Só para quando
     VOCÊ manda parar — ou quando o erro não tem conserto automático
     (chave errada, microfone bloqueado), e aí ele diz o motivo.
     ============================================================ */

  var ESPERAS = [2000, 4000, 8000, 15000, 30000, 60000];

  /** Instruções extras que só valem quando a conversa é falada. */
  function instrucoesDeVoz() {
    var quem = apelido();
    return [
      'Seja um coach de execucao: acolha sem enrolar, escolha a proxima acao menor possivel e acompanhe ate ela acontecer.',
      '# Esta conversa é FALADA',
      'Você está ao lado de ' + quem + ' o dia inteiro, com o microfone aberto. Tudo o que você escrever vira áudio.',
      '- Fale curto: no máximo duas ou três frases por vez, e então pare para ouvir.',
      '- Nada de markdown, títulos, listas numeradas, asteriscos ou emoji. Ninguém ouve asterisco.',
      '- Uma ideia por fala. Se for um plano, diga só o primeiro passo e pergunte se pode seguir.',
      '- Fale como gente fala: contrações, frases simples, sem preâmbulo do tipo "claro, posso ajudar".',
      '- O microfone fica ligado o tempo todo. Se ' + quem + ' estiver falando com outra pessoa, ' +
        'ou se o que você ouviu claramente não é para você, fique quieto e não responda.',
      '- Silêncio é normal no TDAH. Não encha o vazio com enrolação e não fique puxando assunto.',
      '- Se ' + quem + ' te interromper, pare na hora e ouça.',
      '- Registre com as ferramentas enquanto conversa, sem anunciar. Um "anotei" basta.',
      '- Se pedirem algo longo (um texto, uma lista grande), diga que vai mandar por escrito e resuma falando.'
    ].join('\n');
  }

  /** Recapitula a conversa aberta para a voz não começar do zero. */
  function recapParaVoz() {
    var msgs = (State.conv && State.conv.messages) || [];
    var ultimas = msgs.filter(function (m) { return !m.error && m.content; }).slice(-8);
    if (!ultimas.length) return '';
    return '# Onde a conversa parou\n' + ultimas.map(function (m) {
      return (m.role === 'user' ? apelido() : nomeP()) + ': ' +
             String(m.content).replace(/\s+/g, ' ').slice(0, 400);
    }).join('\n');
  }

  function agenteInstrucoes() {
    var sys = buildSystem();
    return [sys.estavel, sys.volatil, recapParaVoz(), instrucoesDeVoz()]
      .filter(Boolean).join('\n\n');
  }

  /** A primeira fala dele já vem com o que importa hoje, não com "olá". */
  function saudacaoDoAgente() {
    var partes = ['Cumprimente ' + apelido() + ' em UMA frase curta, do seu jeito.'];
    try {
      var vencidas = Memoria.atrasadas ? Memoria.atrasadas(State.user.id) : [];
      var abertas = Memoria.abertas(State.user.id) || [];
      if (vencidas && vencidas.length) {
        partes.push('Tem ' + vencidas.length + ' pendência(s) atrasada(s); cite só a mais importante.');
      } else if (abertas.length) {
        partes.push('Cite a pendência aberta mais urgente, uma só.');
      }
    } catch (_) { /* sem memória ainda, tudo bem */ }
    partes.push('Depois pergunte qual é a única coisa que importa agora. Não liste nada.');
    return partes.join(' ');
  }

  /* ---------------- interface ---------------- */

  function agenteEstadoTexto(estado, detalhe) {
    if (estado === 'conectando') return detalhe || 'conectando';
    if (estado === 'ligado') return detalhe || 'pode falar';
    if (State.agente.timer) return 'reconectando…';
    if (State.agente.descansando) return 'descansando';
    return 'voz desligada';
  }

  function atualizarAgenteUI(estado, detalhe) {
    estado = estado || (agenteNavegadorAtivo() ? 'ligado' : Voz.estado());
    var btn = $('#btn-agente');

    if (btn) {
      var sup = usaAgenteDoNavegador() ? suporteAgenteNavegador() : Voz.suporte();
      btn.classList.remove('on', 'conectando', 'falando', 'erro');
      if (!sup.ok) {
        btn.classList.add('erro');
        $('#agente-label').textContent = 'Voz indisponível';
        $('#agente-sub').textContent = sup.motivo || 'voz indisponivel';
        btn.setAttribute('aria-pressed', 'false');
      } else if (estado === 'conectando') {
        btn.classList.add('conectando');
        $('#agente-label').textContent = 'Ligando…';
        $('#agente-sub').textContent = detalhe || 'abrindo o microfone';
        btn.setAttribute('aria-pressed', 'true');
      } else if (estado === 'ligado') {
        btn.classList.add('on');
        ligarBarras();
        $('#agente-label').textContent = nomeP() + ' está ativo';
        $('#agente-sub').textContent = agenteSubtitulo(detalhe);
        btn.setAttribute('aria-pressed', 'true');
      } else if (State.agente.ligado) {
        btn.classList.add('conectando');
        pararBarras();
        $('#agente-label').textContent = 'Religando…';
        $('#agente-sub').textContent = agenteEstadoTexto(estado, detalhe);
        btn.setAttribute('aria-pressed', 'true');
      } else {
        pararBarras();
        $('#agente-label').textContent = 'Ativar agente';
        $('#agente-sub').textContent = agenteEstadoTexto(estado, detalhe);
        btn.setAttribute('aria-pressed', 'false');
      }
    }

    atualizarCopilotoUI(estado, detalhe);
  }

  /* ------------------------------------------------------------
     As barrinhas do botão

     Não é enfeite: é o volume real do microfone. Bateu a barra, ele te
     ouviu — que é a dúvida número um de quem usa voz ("será que pegou
     o meu microfone?"). Verde quando é você, ciano quando é ele.
     ------------------------------------------------------------ */
  var eqLoop = null;
  var eqBarras = null;
  var eqSuave = [0, 0, 0, 0, 0];
  var eqDados = null;

  /**
   * Nivel das barrinhas quando quem esta no ar e o agente do navegador.
   * Antes elas liam so o medidor da voz da OpenAI e ficavam paradas — e
   * barra parada e a coisa que mais faz parecer que ele nao esta te ouvindo.
   */
  function espectroDoNavegador() {
    var session = State.agente.navegador;
    var parado = { quem: 'voce', nivel: 0, valores: null };
    if (!session || !session.ativo) return parado;

    var analisador = (session.captura && session.captura.analisador) ||
                     (session.interruptor && session.interruptor.analisador);
    if (analisador) {
      if (!eqDados || eqDados.length !== analisador.fftSize) eqDados = new Uint8Array(analisador.fftSize);
      analisador.getByteTimeDomainData(eqDados);
      var soma = 0;
      for (var i = 0; i < eqDados.length; i++) {
        var v = (eqDados[i] - 128) / 128;
        soma += v * v;
      }
      var rms = Math.min(1, Math.sqrt(soma / eqDados.length) * 6);
      return { quem: session.ouvindo ? 'voce' : 'ele', nivel: rms, valores: null };
    }

    // Ditado do navegador nao entrega o audio: pulso vivo enquanto ele age.
    if (agenteFalandoAgora(session)) return { quem: 'ele', nivel: 0.6, valores: null };
    if (session.ouvindo) return { quem: 'voce', nivel: 0.34, valores: null };
    return parado;
  }

  function pintarBarras() {
    if (!eqBarras) {
      var caixa = $('#agente-eq');
      eqBarras = caixa ? $$('i', caixa) : [];
    }
    if (!eqBarras.length) return;

    var s = agenteNavegadorAtivo() ? espectroDoNavegador() : Voz.espectro(eqBarras.length);
    var btn = $('#btn-agente');

    for (var i = 0; i < eqBarras.length; i++) {
      var alvo = s.valores ? s.valores[i] : s.nivel * (0.5 + 0.5 * Math.sin(Date.now() / 260 + i));
      // sobe rápido, desce devagar: fica parecido com um VU de verdade
      eqSuave[i] = alvo > eqSuave[i] ? alvo : eqSuave[i] * 0.82 + alvo * 0.18;
      eqBarras[i].style.transform = 'scaleY(' + (0.16 + Math.min(1, eqSuave[i]) * 0.84).toFixed(3) + ')';
    }

    if (btn && (Voz.ligado() || agenteNavegadorAtivo())) {
      var dele = s.quem === 'ele' && s.nivel > 0.06;
      btn.classList.toggle('falando', dele);
      btn.classList.toggle('on', !dele);
    }
  }

  function ligarBarras() {
    if (eqLoop) return;
    var passo = function () {
      if (!Voz.ativo() && !agenteNavegadorAtivo()) { eqLoop = null; zerarBarras(); return; }
      pintarBarras();
      eqLoop = requestAnimationFrame(passo);
    };
    eqLoop = requestAnimationFrame(passo);
  }

  function pararBarras() {
    if (eqLoop) { cancelAnimationFrame(eqLoop); eqLoop = null; }
    zerarBarras();
  }

  function zerarBarras() {
    if (!eqBarras) return;
    for (var i = 0; i < eqBarras.length; i++) {
      eqSuave[i] = 0;
      eqBarras[i].style.transform = '';
    }
  }

  /** Minutos no ar + quanto já custou esta sessão. */
  function agenteSubtitulo(detalhe) {
    if (detalhe && detalhe !== 'pode falar') return detalhe;
    var min = Math.floor(agenteNavegadorAtivo()
      ? (Date.now() - State.agente.navegador.inicioEm) / 60000
      : Voz.minutosNoAr());
    var custo = State.agente.custoSessao;
    var partes = [];
    partes.push(min < 1 ? 'no ar' : min + ' min');
    if (custo >= 0.01) partes.push(money(custo));
    return partes.join(' · ');
  }

  function atualizarCopilotoUI(estado, detalhe) {
    var panel = $('#copilot-panel');
    var btn = $('#btn-copilot');
    var mini = $('#btn-copilot-mini');
    var mudo = $('#btn-copilot-mudo');
    if (!panel || !btn) return;

    var sup = usaAgenteDoNavegador() ? suporteAgenteNavegador() : Voz.suporte();
    if (!sup.ok) {
      panel.classList.remove('live', 'connecting');
      $('#copilot-title').textContent = 'Voz ao vivo indisponível';
      $('#copilot-status').textContent = sup.motivo;
      btn.disabled = true;
      btn.innerHTML = Icons.svg('mic', 15) + ' Indisponível';
      if (mini) mini.hidden = true;
      if (mudo) mudo.hidden = true;
      return;
    }

    btn.disabled = false;
    if (mini) mini.hidden = false;

    if (estado === 'conectando') {
      panel.classList.add('connecting');
      panel.classList.remove('live');
      $('#copilot-title').textContent = 'Conectando…';
      $('#copilot-status').textContent = detalhe || 'abrindo o microfone';
      btn.innerHTML = Icons.svg('x', 15) + ' Cancelar';
      if (mini) mini.innerHTML = Icons.svg('x', 14) + ' Cancelar';
      if (mudo) mudo.hidden = true;
      return;
    }

    if (estado === 'ligado') {
      panel.classList.add('live');
      panel.classList.remove('connecting');
      $('#copilot-title').textContent = nomeP() + ' está na linha';
      $('#copilot-status').textContent = agenteSubtitulo(detalhe);
      btn.innerHTML = Icons.svg('stop', 15) + ' Desligar';
      if (mini) mini.innerHTML = Icons.svg('stop', 14) + ' Desligar';
      if (mudo) {
        mudo.hidden = false;
        var mudoAgora = agenteNavegadorAtivo() ? State.agente.navegador.mudo : Voz.mudo();
        mudo.innerHTML = Icons.svg('mic', 14) + (mudoAgora ? ' Ligar mic' : ' Mudo');
        mudo.classList.toggle('is-on', mudoAgora);
      }
      return;
    }

    panel.classList.remove('live', 'connecting');
    $('#copilot-title').textContent = State.agente.ligado ? 'Religando o agente…' : 'Agente desligado';
    $('#copilot-status').textContent = State.agente.ligado
      ? agenteEstadoTexto(estado, detalhe)
      : 'Ative para falar e ouvir sem digitar nada.';
    btn.innerHTML = Icons.svg('mic', 15) + ' Ligar voz';
    if (mini) mini.innerHTML = Icons.svg('mic', 14) + ' Voz';
    if (mudo) { mudo.hidden = true; mudo.classList.remove('is-on'); }
  }

  /** Mostra por onde a conexão passou — para o erro não ser um mistério. */
  function mostrarDiagnostico(msg) {
    var box = $('#copilot-diag');
    if (!box) return;
    var passos = Voz.diario().slice(-6).map(function (d) {
      return '<li>' + MD.escape(d.etapa) + (d.detalhe ? ': ' + MD.escape(d.detalhe) : '') + '</li>';
    }).join('');
    box.innerHTML = '<b>' + MD.escape(msg) + '</b>' +
      (passos ? '<span>Onde parou:</span><ol>' + passos + '</ol>' : '');
    box.hidden = false;
  }
  function limparDiagnostico() {
    var box = $('#copilot-diag');
    if (box) { box.hidden = true; box.innerHTML = ''; }
  }

  /* ---------------- transcrição vira conversa ---------------- */

  function vozParcial(texto, quem) {
    var antigo = $('#voz-parcial');
    if (antigo) antigo.remove();
    if (!texto) return;

    var el = messageEl({ id: 'voz-parcial', role: quem, content: texto, at: Date.now(), viaVoz: true });
    el.id = 'voz-parcial';
    el.classList.add('parcial');
    var tools = $('.msg-tools', el);
    if (tools) tools.remove();
    $('#chat-empty').classList.add('hidden');
    $('#messages').appendChild(el);
    Icons.render(el);
    scrollToEnd();
  }

  function vozMensagem(role, texto) {
    var antigo = $('#voz-parcial');
    if (antigo) antigo.remove();
    if (!texto) return;
    if (!State.conv) newConv(true);

    var m = { id: Store.uid(), role: role, content: texto, at: Date.now(), viaVoz: true };
    if (role === 'assistant' && State.vozAcoes.length) {
      m.acoes = State.vozAcoes.slice();
      State.vozAcoes = [];
    }

    State.conv.messages.push(m);
    if (State.conv.messages.length === 1) {
      State.conv.title = texto.replace(/\s+/g, ' ').slice(0, 42) + (texto.length > 42 ? '…' : '');
    }
    Store.Convs.save(State.user.id, State.conv);

    $('#chat-empty').classList.add('hidden');
    var el = messageEl(m);
    if (m.acoes) {
      var ganho = premiarPorAcoes(m.acoes);
      var alvo = $('.msg-content', el);
      if (ganho && alvo) alvo.insertAdjacentHTML('beforeend', rewardEl(ganho, 'anotado enquanto você falava'));
    }
    $('#messages').appendChild(el);
    Icons.render(el);
    renderConvList();
    renderCtxInfo();
    scrollToEnd(true);
  }

  /* ---------------- ligar / desligar ---------------- */

  function usaAgenteDoNavegador() {
    return !!State.config;
  }

  function agenteNavegadorAtivo() {
    return !!(State.agente.navegador && State.agente.navegador.ativo);
  }

  function usarVozNatural() {
    var key = chaveElevenLabsAtual();
    if (key) return chaveElevenLabsPareceValida(key) && State.elevenLabsKeyInvalida !== key;
    return !!State.elevenLabsServidor;
  }

  /** Se o deploy ja tem chave, a voz natural funciona sem ninguem colar nada. */
  function checarChaveElevenLabsDoServidor() {
    return fetch('/api/speech/status', { headers: { accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (body) {
        State.elevenLabsServidor = !!(body && body.serverKey);
        return State.elevenLabsServidor;
      })
      .catch(function () { State.elevenLabsServidor = false; return false; });
  }

  function chaveElevenLabsAtual() {
    var input = $('#elevenlabs-key');
    return String((input && input.value && input.value.trim()) || State.elevenLabsKey || '').trim();
  }

  function chaveElevenLabsPareceValida(key) {
    key = String(key || '').trim();
    return key.length >= 12 && /^sk_[A-Za-z0-9_-]+$/.test(key);
  }

  function mensagemChaveElevenLabsInvalida() {
    return 'A chave da ElevenLabs precisa comecar com sk_. Voce colou o ID da chave, nao a chave real.';
  }

  function erroElevenLabsDeChave(erro) {
    var texto = String((erro && erro.message) || erro || '').toLowerCase();
    return /api key id used as api key|only valid api keys|api keys start|invalid api key|unauthori[sz]ed|xi-api-key/.test(texto);
  }

  function marcarChaveElevenLabsInvalida(erro, silencioso) {
    var key = chaveElevenLabsAtual();
    if (key) State.elevenLabsKeyInvalida = key;
    // Sem chave local, quem falhou foi a do servidor: para de tentar por ela.
    else State.elevenLabsServidor = false;
    var msg = erroElevenLabsDeChave(erro) || (key && !chaveElevenLabsPareceValida(key))
      ? mensagemChaveElevenLabsInvalida()
      : ((erro && erro.message) || 'A chave de voz da ElevenLabs nao foi aceita.');
    renderElevenLabsKeyUI();
    mostrarDiagnostico(msg);
    if (!silencioso) toast(msg, 'bad');
    return msg;
  }

  /** Uma falha e corte ou ruido; tres seguidas indicam navegador sem voz de verdade. */
  var MAX_FALHAS_VOZ_NAVEGADOR = 3;

  function vozNavegadorIndisponivel(session) {
    return !!session && (session.falhasVozNavegador || 0) >= MAX_FALHAS_VOZ_NAVEGADOR;
  }

  function registrarFalhaVozNavegador(session) {
    if (!session) return false;
    session.falhasVozNavegador = (session.falhasVozNavegador || 0) + 1;
    return vozNavegadorIndisponivel(session);
  }

  function limparFalhasVozNavegador(session) {
    if (session) session.falhasVozNavegador = 0;
  }

  /** Avisa uma vez por resposta, e explica no painel quando desiste de vez. */
  function avisarFalhaDeVoz(session) {
    if (!session) return;
    if (usarVozNatural()) {
      if (session.avisoVoz) return;
      session.avisoVoz = true;
      toast('A voz natural nao tocou agora. Continuei te ouvindo; teste a chave e a voz em Chave & Modelo.', 'bad');
      return;
    }
    var jaDesistira = vozNavegadorIndisponivel(session);
    var desistiuAgora = registrarFalhaVozNavegador(session) && !jaDesistira;
    if (desistiuAgora) {
      var msg = 'A fala do navegador falhou ' + MAX_FALHAS_VOZ_NAVEGADOR +
        ' vezes seguidas, entao parei de tentar. Salve a chave da ElevenLabs para usar voz natural.';
      toast(msg, 'bad');
      mostrarDiagnostico(msg);
      return;
    }
    if (jaDesistira || session.avisoVoz) return;
    session.avisoVoz = true;
    toast('A fala do navegador falhou agora, mas eu continuei te ouvindo.', 'bad');
  }

  /* O Chrome deixa speechSynthesis.speaking preso em true depois de um
     cancel(). Confiar so nessa flag era o jeito mais facil de o agente ficar
     ligado e surdo para sempre — por isso a marca propria session.falandoNativo,
     que so vive entre o inicio e o fim de uma fala que NOS pedimos. */
  function falaNativaBloqueiaEscuta(session) {
    return !usarVozNatural() &&
      !vozNavegadorIndisponivel(session) &&
      !!(session && session.falandoNativo) &&
      Persona.Voice.falando();
  }

  /** True so quando ele esta mesmo produzindo som agora. */
  function agenteFalandoAgora(session) {
    if (!session) return false;
    if (session.audio && !session.audio.paused && !session.audio.ended) return true;
    if (session.falaAbort || session.filaFala) return true;
    return !!session.falandoNativo && Persona.Voice.falando();
  }

  /**
   * Fala pelo navegador marcando quando a boca esta aberta, e garantindo que
   * o fim seja avisado uma vez so — mesmo quando o speak() nem chega a sair.
   */
  function falarNativoDoNavegador(texto, session, aoTerminar) {
    var pronto = false;
    session.falandoNativo = true;
    function terminar(saiuAudio) {
      if (pronto) return;
      pronto = true;
      session.falandoNativo = false;
      aoTerminar(!!saiuAudio);
    }
    var falou = Persona.Voice.falar(texto, State.persona.voz, terminar, function (estado) {
      if (!session.ativo) return;
      if (estado === 'started') {
        armarDetectorDeInterrupcao(session);
        atualizarAgenteUI('ligado', 'falando');
      }
    });
    if (!falou) terminar(false);
  }

  function suporteAgenteNavegador() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, motivo: 'Este navegador nao permite acesso seguro ao microfone.' };
    }
    if (usarVozNatural()) {
      if (!(window.AudioContext || window.webkitAudioContext)) {
        return { ok: false, motivo: 'Este navegador nao permite processar audio ao vivo. Atualize o navegador e tente de novo.' };
      }
      return { ok: true, motivo: '' };
    }
    if (!Persona.Ditado.disponivel()) {
      return { ok: false, motivo: 'Este navegador nao tem ditado nativo. Salve a chave VoiceLab / ElevenLabs para usar voz natural aqui.' };
    }
    if (!Persona.Voice.disponivel()) {
      return { ok: false, motivo: 'Este navegador nao tem leitura de voz.' };
    }
    return { ok: true, motivo: '' };
  }

  function desbloquearAudioDoAgente() {
    if (State.audioDesbloqueado) return;
    State.audioDesbloqueado = true;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        var contexto = new AudioCtx();
        contexto.resume().then(function () {
          setTimeout(function () { contexto.close().catch(function () {}); }, 500);
        }).catch(function () {});
      }
    } catch (_) {}
    try {
      var audio = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==');
      audio.volume = 0;
      audio.play().then(function () {
        audio.pause();
        audio.src = '';
      }).catch(function () {});
    } catch (_) {}
  }

  /**
   * Marca uma nova tentativa de escuta. Existe para que NENHUM caminho possa
   * simplesmente desistir: agente ligado que para de ouvir e o pior defeito
   * possivel, porque por fora parece que ele so te ignorou.
   */
  function reagendarEscutaDoNavegador(espera) {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo) return;
    if (session.retomadaTimer) clearTimeout(session.retomadaTimer);
    session.retomadaTimer = setTimeout(function () {
      session.retomadaTimer = null;
      iniciarEscutaDoNavegador();
    }, Math.max(80, espera || 250));
  }

  /**
   * Rede de seguranca do vigia: ligado, calado, sem pensar e sem ouvir e um
   * estado do qual ele nao saia sozinho. Aqui ele sai.
   */
  function garantirEscutaDoNavegador() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo) return;
    if (session.ouvindo || session.captura || session.realtime) return;
    if (session.realtimeAbrindo) {
      // Abertura que passa de 20s nao vai abrir mais: cai para o modo compativel.
      if (Date.now() - (session.realtimeAbrindoEm || 0) < 20000) return;
      usarTranscricaoEmLote(session, new Error('A transcricao em tempo real nao abriu.'));
      return;
    }
    if (Persona.Ditado.ativo() || session.retomadaTimer) return;
    if (State.running || agenteFalandoAgora(session)) return;
    session.ocupado = false;
    session.escutaLiberadaEm = 0;
    iniciarEscutaDoNavegador();
  }

  /** Pequena guarda contra o fim do audio do agente voltar pelo microfone. */
  function retomarEscutaComCalma(session) {
    if (!session || !session.ativo || session.mudo || session.ocupado) return;
    var espera = State.config.vozInterromper === false ? 220 : 80;
    session.escutaLiberadaEm = Date.now() + espera;
    if (session.retomadaTimer) clearTimeout(session.retomadaTimer);
    session.retomadaTimer = setTimeout(function () {
      session.retomadaTimer = null;
      iniciarEscutaDoNavegador();
    }, espera);
  }

  function pararDetectorDeInterrupcao(session) {
    var detector = session && session.interruptor;
    if (!detector) return;
    detector.parando = true;
    if (detector.quadro) cancelAnimationFrame(detector.quadro);
    if (detector.contexto) detector.contexto.close().catch(function () {});
    if (detector.stream) detector.stream.getTracks().forEach(function (track) { track.stop(); });
    if (session.interruptor === detector) session.interruptor = null;
  }

  function interromperFalaDoNavegador(session) {
    if (!session || !session.ativo) return;
    session.vezesInterrompido = (session.vezesInterrompido || 0) + 1;
    session.falandoNativo = false;
    pararDetectorDeInterrupcao(session);
    if (session.filaFala) session.filaFala.cancelar();
    if (session.falaAbort) {
      try { session.falaAbort.abort(); } catch (_) {}
      session.falaAbort = null;
    }
    if (session.audio) {
      try { session.audio.pause(); session.audio.src = ''; } catch (_) {}
      session.audio = null;
    }
    if (session.audioUrl) {
      URL.revokeObjectURL(session.audioUrl);
      session.audioUrl = null;
    }
    Persona.Voice.calar();
    if (State.running) State.running.abort();
    session.ocupado = false;
    session.ouvindo = false;
    session.ultimaFalaEm = Date.now();
    atualizarAgenteUI('ligado', 'te ouvindo');
    reagendarEscutaDoNavegador(80);
  }

  /* Tempo de fala dele usado para medir o vazamento do alto-falante no
     microfone. Precisa ser fala mesmo, nao silencio anterior. */
  var CALIBRAGEM_INTERRUPCAO_MS = 900;

  function iniciarDetectorDeInterrupcao(session) {
    if (!session || !session.ativo || session.mudo || usarVozNatural() || State.config.vozInterromper === false || session.interruptor) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) return;

    getUserMediaAgente().then(function (stream) {
      if (!session.ativo || session.mudo || State.config.vozInterromper === false) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      var contexto = new (window.AudioContext || window.webkitAudioContext)();
      var fonte = contexto.createMediaStreamSource(stream);
      var analisador = contexto.createAnalyser();
      analisador.fftSize = 1024;
      fonte.connect(analisador);
      var dados = new Uint8Array(analisador.fftSize);
      var voz = parametrosDeVoz();
      var detector = {
        stream: stream,
        contexto: contexto,
        analisador: analisador,
        quadro: 0,
        armadoEm: 0,              // so conta a partir do primeiro som DELE
        acimaDesde: 0,
        parando: false,
        base: Math.max(0.006, voz.limiarMin * 4.4),
        limiar: 0,
        piso: 0,
        amostrasPiso: 0
      };
      session.interruptor = detector;
      contexto.resume().catch(function () {});

      function loop() {
        if (!session.ativo || session.mudo || session.interruptor !== detector || detector.parando) return;
        detector.quadro = requestAnimationFrame(loop);

        /* Enquanto ele ainda nao comecou a falar de verdade, o microfone so
           ouve silencio. Calibrar aqui era o defeito: o piso saia perto de
           zero, a primeira palavra dele passava do limiar e ele se cortava
           sozinho depois de uma silaba. Agora o relogio so comeca quando o
           audio dele comeca — quem avisa e armarDetectorDeInterrupcao. */
        if (!detector.armadoEm) return;

        analisador.getByteTimeDomainData(dados);
        var soma = 0;
        for (var i = 0; i < dados.length; i++) {
          var valor = (dados[i] - 128) / 128;
          soma += valor * valor;
        }
        var volume = Math.sqrt(soma / dados.length);
        var agora = Date.now();

        // Os primeiros 900ms de fala medem quanto da voz dele volta pelo microfone.
        if (agora - detector.armadoEm < CALIBRAGEM_INTERRUPCAO_MS) {
          detector.piso += volume;
          detector.amostrasPiso++;
          return;
        }
        if (detector.amostrasPiso) {
          var medio = detector.piso / detector.amostrasPiso;
          detector.limiar = Math.max(detector.base, medio * 3 + 0.012);
          detector.amostrasPiso = 0;
        }
        if (!detector.limiar) return;

        if (volume > detector.limiar) {
          if (!detector.acimaDesde) detector.acimaDesde = agora;
          // Meio segundo bem acima do vazamento: e voce falando, nao o eco dele.
          if (agora - detector.acimaDesde > 500) {
            interromperFalaDoNavegador(session);
            return;
          }
        } else if (volume <= detector.limiar * 0.7) {
          detector.acimaDesde = 0;
        }
      }
      loop();
    }).catch(function () {});
  }

  /**
   * Liga o cronometro do detector no instante em que a voz dele comeca a sair.
   * Sem esse aviso o detector nunca julga nada — que e o comportamento certo
   * quando a fala nem chegou a acontecer.
   */
  function armarDetectorDeInterrupcao(session) {
    var detector = session && session.interruptor;
    if (!detector || detector.parando || detector.armadoEm) return;
    detector.armadoEm = Date.now();
    detector.piso = 0;
    detector.amostrasPiso = 0;
    detector.limiar = 0;
    detector.acimaDesde = 0;
  }

  function falarDoNavegador(texto) {
    var session = State.agente.navegador;
    if (!session || !session.ativo) return;
    // Resposta vazia (modelo cortado, so ferramenta) nao e defeito da voz.
    // Contar isso como falha era o que fazia ele "desistir de falar" do nada.
    if (!Persona.Voice.limpar(texto)) {
      session.ocupado = false;
      session.ultimaFalaEm = Date.now();
      reagendarEscutaDoNavegador(200);
      return;
    }
    session.avisoVoz = false;              // cada resposta pode avisar de novo se falhar
    session.ouvindo = false;
    session.ultimaFalaEm = Date.now();
    iniciarDetectorDeInterrupcao(session);
    if (window.Ambiente) Ambiente.reduzir(true);
    atualizarAgenteUI('ligado', 'preparando resposta em voz');
    function continuar(saiuAudio) {
      if (!session.ativo) return;
      pararDetectorDeInterrupcao(session);
      if (window.Ambiente) Ambiente.reduzir(true);
      if (saiuAudio === false) avisarFalhaDeVoz(session);
      else limparFalhasVozNavegador(session);
      session.ocupado = false;
      session.ultimaFalaEm = Date.now();
      retomarEscutaComCalma(session);
    }
    if (usarVozNatural()) {
      falarComElevenLabs(texto, session, continuar);
      return;
    }
    if (vozNavegadorIndisponivel(session)) {
      continuar(false);
      return;
    }
    falarNativoDoNavegador(texto, session, continuar);
  }

  function tocarBlobDeAudio(blob, session, controller) {
    return new Promise(function (resolve) {
      if (!session.ativo || session.falaAbort !== controller) { resolve(false); return; }
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      audio.autoplay = true;
      audio.muted = false;
      audio.preload = 'auto';
      audio.volume = 1;
      audio.setAttribute('playsinline', '');
      audio.style.display = 'none';
      if (document.body) document.body.appendChild(audio);
      session.audio = audio;
      session.audioUrl = url;
      var terminou = false;
      var limite = setTimeout(function () { finalizar(true); }, 5 * 60 * 1000);
      function finalizar(saiuAudio) {
        if (terminou) return;
        terminou = true;
        if (limite) clearTimeout(limite);
        if (session.audio === audio) session.audio = null;
        if (session.audioUrl === url) session.audioUrl = null;
        if (audio.parentNode) audio.parentNode.removeChild(audio);
        URL.revokeObjectURL(url);
        resolve(saiuAudio);
      }
      audio.onplay = function () {
        armarDetectorDeInterrupcao(session);
        atualizarAgenteUI('ligado', 'falando');
      };
      audio.onended = function () { finalizar(true); };
      audio.onerror = function () { finalizar(false); };
      audio.play().catch(function () { finalizar(false); });
    });
  }

  function tocarAudioCompativel(resposta, session, controller) {
    return resposta.blob().then(function (blob) {
      if (!blob || !blob.size) return false;
      return tocarBlobDeAudio(blob, session, controller);
    });
  }

  function fallbackFalaNativa(texto, session, aoTerminar) {
    if (!Persona.Voice.disponivel() || vozNavegadorIndisponivel(session)) {
      aoTerminar(false);
      return;
    }
    falarNativoDoNavegador(texto, session, function (ok) {
      if (ok) limparFalhasVozNavegador(session);
      else registrarFalhaVozNavegador(session);
      aoTerminar(ok);
    });
  }

  /** Toca os bytes assim que chegam; o caminho antigo so inicia depois do MP3 inteiro. */
  function tocarFluxoDeAudio(resposta, session, controller) {
    if (!resposta.body || !window.MediaSource || !MediaSource.isTypeSupported('audio/mpeg')) {
      return resposta.blob().then(function (blob) { return tocarBlobDeAudio(blob, session, controller); });
    }

    return new Promise(function (resolve, reject) {
      if (!session.ativo || session.falaAbort !== controller) { resolve(false); return; }
      var media = new MediaSource();
      var url = URL.createObjectURL(media);
      var audio = new Audio(url);
      audio.autoplay = true;
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      audio.style.display = 'none';
      if (document.body) document.body.appendChild(audio);
      var reader = resposta.body.getReader();
      var sourceBuffer = null;
      var fila = [];
      var fimDoFluxo = false;
      var terminou = false;
      var tocando = false;

      session.audio = audio;
      session.audioUrl = url;

      function finalizar(saiuAudio, erro) {
        if (terminou) return;
        terminou = true;
        try { reader.cancel(); } catch (_) {}
        if (session.audio === audio) session.audio = null;
        if (session.audioUrl === url) session.audioUrl = null;
        if (audio.parentNode) audio.parentNode.removeChild(audio);
        URL.revokeObjectURL(url);
        if (erro) reject(erro);
        else resolve(saiuAudio);
      }

      function reproduzir() {
        if (tocando) return;
        tocando = true;
        audio.play().catch(function () { finalizar(false); });
      }

      function bombear() {
        if (terminou) return;
        if (!session.ativo || session.falaAbort !== controller || controller.signal.aborted) {
          finalizar(false);
          return;
        }
        if (sourceBuffer && fila.length && !sourceBuffer.updating) {
          var trecho = fila.shift();
          try {
            sourceBuffer.appendBuffer(trecho);
            reproduzir();
          } catch (erro) {
            finalizar(false, erro);
          }
          return;
        }
        if (fimDoFluxo) {
          if (sourceBuffer && !sourceBuffer.updating && media.readyState === 'open') {
            try { media.endOfStream(); } catch (_) {}
          }
          return;
        }
        reader.read().then(function (leitura) {
          if (terminou) return;
          if (leitura.done) {
            fimDoFluxo = true;
            bombear();
            return;
          }
          var bytes = leitura.value;
          fila.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
          bombear();
        }).catch(function (erro) { finalizar(false, erro); });
      }

      media.addEventListener('sourceopen', function () {
        if (terminou) return;
        try {
          sourceBuffer = media.addSourceBuffer('audio/mpeg');
          sourceBuffer.addEventListener('updateend', bombear);
          audio.onplay = function () { atualizarAgenteUI('ligado', 'falando'); };
          audio.onended = function () { finalizar(true); };
          audio.onerror = function () { finalizar(false); };
          bombear();
        } catch (erro) {
          finalizar(false, erro);
        }
      }, { once: true });
    });
  }

  function falarComElevenLabs(texto, session, aoTerminar) {
    var controller = new AbortController();
    var textoLimpo = Persona.Voice.limpar(texto);
    var timeout = setTimeout(function () {
      if (session.ativo && session.falaAbort === controller) controller.abort();
    }, Math.max(45000, Math.min(90000, textoLimpo.length * 180)));
    function limparTimeout() {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }
    if (!textoLimpo) {
      aoTerminar(false);
      return;
    }
    session.falaAbort = controller;
    fetch('/api/speech/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: chaveElevenLabsAtual(),
        text: textoLimpo,
        voiceId: State.config.elevenLabsVoiceId,
        modelId: State.config.elevenLabsModel || 'eleven_multilingual_v2',
        voiceSettings: parametrosElevenLabs()
      }),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (body) {
        var erro = new Error((body.error && body.error.message) || 'A voz natural nao respondeu.');
        if (res.status === 429 || /quota|credit|billing|balance|insufficient/i.test(erro.message)) {
          registrarLimiteDaApi('elevenlabs', erro, /quota|credit|billing|balance|insufficient/i.test(erro.message) ? 'quota_exhausted' : 'rate_limit');
        }
        throw erro;
      });
      return tocarAudioCompativel(res, session, controller);
    }).then(function (saiuAudio) {
      limparTimeout();
      if (!session.ativo || session.falaAbort !== controller) return;
      session.falaAbort = null;
      limparAvisoDeLimiteApi('elevenlabs');
      if (saiuAudio) {
        aoTerminar(true);
        return;
      }
      fallbackFalaNativa(textoLimpo, session, aoTerminar);
    }).catch(function (erro) {
      limparTimeout();
      if (!session.ativo) return;
      if (erro && erro.name === 'AbortError' && session.falaAbort !== controller) return;
      if (erroElevenLabsDeChave(erro)) {
        marcarChaveElevenLabsInvalida(erro);
        session.avisoVoz = true;
      } else if (!session.avisoVoz) {
        session.avisoVoz = true;
        toast(erro && erro.name === 'AbortError'
          ? 'A voz natural demorou demais. Voltei para a escuta.'
          : ((erro && erro.message) || 'A voz natural nao respondeu.') + ' Vou tentar a voz do navegador.', 'bad');
      }
      if (session.falaAbort === controller) session.falaAbort = null;
      fallbackFalaNativa(textoLimpo, session, aoTerminar);
    });
  }

  /** Trecho curto demais pica a fala; longo demais atrasa o primeiro audio. */
  var FALA_TRECHO_MIN = 160;
  var FALA_TRECHO_ALVO = 320;
  var FALA_TRECHO_MAX = 360;

  function criarFilaFalaDoAgente(session) {
    session.avisoVoz = false;              // cada resposta pode avisar de novo se falhar
    var fila = [];
    var pendente = '';
    var lidoAte = 0;
    var falando = false;
    var respostaTerminou = false;
    var cancelada = false;
    var api = {
      receber: receber,
      finalizar: finalizarResposta,
      cancelar: cancelar
    };
    session.filaFala = api;

    /** Gruda pedacos curtos no trecho anterior para a voz sair em frases inteiras. */
    function enfileirarTrecho(texto) {
      var trecho = String(texto || '').trim();
      if (!trecho) return;
      var ultimo = fila.length ? fila[fila.length - 1] : '';
      var algumCurto = ultimo.length < FALA_TRECHO_MIN || trecho.length < FALA_TRECHO_MIN;
      if (ultimo && algumCurto && ultimo.length + trecho.length + 1 <= FALA_TRECHO_MAX) {
        fila[fila.length - 1] = ultimo + ' ' + trecho;
        return;
      }
      fila.push(trecho);
    }

    function extrair(final) {
      var partida;
      while ((partida = pendente.match(/^([\s\S]*?[.!?…](?:\s|$))/))) {
        var frase = partida[1].trim();
        pendente = pendente.slice(partida[1].length);
        enfileirarTrecho(frase);
      }
      if (pendente.length > FALA_TRECHO_MAX) {
        var corte = pendente.lastIndexOf(' ', FALA_TRECHO_ALVO);
        if (corte < FALA_TRECHO_MIN) corte = FALA_TRECHO_ALVO;
        enfileirarTrecho(pendente.slice(0, corte));
        pendente = pendente.slice(corte).trim();
      }
      if (final && pendente.trim()) {
        enfileirarTrecho(pendente);
        pendente = '';
      }
    }

    function prepararConversa() {
      if (!session.ativo || cancelada) return;
      session.ouvindo = false;
      session.ultimaFalaEm = Date.now();
      iniciarDetectorDeInterrupcao(session);
      if (window.Ambiente) Ambiente.reduzir(true);
      atualizarAgenteUI('ligado', 'respondendo');
    }

    function proxima() {
      if (cancelada || !session.ativo || falando) return;
      if (!fila.length) {
        if (!respostaTerminou) return;
        if (session.filaFala === api) session.filaFala = null;
        pararDetectorDeInterrupcao(session);
        session.ocupado = false;
        session.ultimaFalaEm = Date.now();
        if (window.Ambiente) Ambiente.reduzir(true);
        retomarEscutaComCalma(session);
        return;
      }
      var trecho = fila.shift();
      if (!trecho) { proxima(); return; }
      falando = true;
      prepararConversa();
      falarComElevenLabs(trecho, session, function (saiuAudio) {
        falando = false;
        proxima();
      });
    }

    function receber(textoCompleto) {
      if (cancelada || !textoCompleto) return;
      var texto = String(textoCompleto);
      if (texto.length < lidoAte) lidoAte = 0;
      pendente += texto.slice(lidoAte);
      lidoAte = texto.length;
      extrair(false);
      proxima();
    }

    function finalizarResposta(textoCompleto) {
      if (cancelada) return;
      receber(textoCompleto || '');
      respostaTerminou = true;
      extrair(true);
      proxima();
    }

    function cancelar() {
      cancelada = true;
      fila = [];
      pendente = '';
      if (session.filaFala === api) session.filaFala = null;
      if (session.falaAbort) session.falaAbort.abort();
      pararDetectorDeInterrupcao(session);
    }

    return api;
  }

  function enviarFalaDoNavegador(texto) {
    var session = State.agente.navegador;
    if (!session || !session.ativo || !texto) return;
    if (State.running) {
      State.running.abort();
      setTimeout(function () { enviarFalaDoNavegador(texto); }, 160);
      return;
    }
    pararDetectorDeInterrupcao(session);
    session.ocupado = true;
    session.ultimaFalaEm = Date.now();
    vozMensagem('user', texto);
    streamReply();
  }

  function liberarCaptura(captura) {
    if (!captura) return;
    if (captura.quadro) cancelAnimationFrame(captura.quadro);
    try { if (captura.processador) captura.processador.onaudioprocess = null; } catch (_) {}
    try { if (captura.processador) captura.processador.disconnect(); } catch (_) {}
    try { if (captura.silencio) captura.silencio.disconnect(); } catch (_) {}
    try { if (captura.fonte) captura.fonte.disconnect(); } catch (_) {}
    if (captura.contexto) captura.contexto.close().catch(function () {});
    if (captura.stream) captura.stream.getTracks().forEach(function (track) { track.stop(); });
  }

  function pararCapturaNeural(session, enviar) {
    var captura = session && session.captura;
    if (!captura || captura.parando) return;
    captura.parando = true;
    captura.enviar = !!enviar;
    if (captura.quadro) cancelAnimationFrame(captura.quadro);
    if (captura.recorder && captura.recorder.state !== 'inactive') {
      try { captura.recorder.stop(); return; } catch (_) {}
    }
    if (captura.finalizar) {
      captura.finalizar();
      return;
    }
    liberarCaptura(captura);
    if (session.captura === captura) session.captura = null;
  }

  function nomeArquivoAudio(blob) {
    var tipo = String((blob && blob.type) || '').toLowerCase();
    if (tipo.indexOf('wav') > -1) return 'fala.wav';
    if (tipo.indexOf('mp4') > -1 || tipo.indexOf('m4a') > -1) return 'fala.m4a';
    if (tipo.indexOf('ogg') > -1) return 'fala.ogg';
    if (tipo.indexOf('mpeg') > -1 || tipo.indexOf('mp3') > -1) return 'fala.mp3';
    return 'fala.webm';
  }

  function transcreverAudio(blob) {
    var dados = new FormData();
    dados.append('file', blob, nomeArquivoAudio(blob));
    dados.append('apiKey', chaveElevenLabsAtual());
    return fetch('/api/speech/transcribe', { method: 'POST', body: dados }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var erro = new Error((body.error && body.error.message) || 'Nao foi possivel transcrever o audio.');
          if (res.status === 429 || /quota|credit|billing|balance|insufficient/i.test(erro.message)) {
            registrarLimiteDaApi('elevenlabs', erro, /quota|credit|billing|balance|insufficient/i.test(erro.message) ? 'quota_exhausted' : 'rate_limit');
          }
          throw erro;
        }
        limparAvisoDeLimiteApi('elevenlabs');
        return String(body.text || '').trim();
      });
    });
  }

  function pedirTokenDeTranscricao() {
    return fetch('/api/speech/realtime-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: chaveElevenLabsAtual() })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var erro = new Error((body.error && body.error.message) || 'Nao foi possivel abrir a transcricao em tempo real.');
          if (res.status === 429 || /quota|credit|billing|balance|insufficient/i.test(erro.message)) {
            registrarLimiteDaApi('elevenlabs', erro, /quota|credit|billing|balance|insufficient/i.test(erro.message) ? 'quota_exhausted' : 'rate_limit');
          }
          throw erro;
        }
        if (!body.token) throw new Error('A ElevenLabs nao devolveu o token da transcricao em tempo real.');
        return String(body.token);
      });
    });
  }

  function pcm16EmBase64(amostras, sampleRate) {
    var taxaAlvo = 16000;
    var razao = sampleRate / taxaAlvo;
    var tamanho = Math.max(1, Math.round(amostras.length / razao));
    var pcm = new Int16Array(tamanho);
    for (var i = 0; i < tamanho; i++) {
      var inicio = Math.floor(i * razao);
      var fim = Math.min(amostras.length, Math.floor((i + 1) * razao));
      var soma = 0;
      for (var j = inicio; j < fim; j++) soma += amostras[j];
      var valor = soma / Math.max(1, fim - inicio);
      valor = Math.max(-1, Math.min(1, valor));
      pcm[i] = valor < 0 ? valor * 0x8000 : valor * 0x7fff;
    }
    var bytes = new Uint8Array(pcm.buffer);
    var texto = '';
    for (var n = 0; n < bytes.length; n += 0x8000) {
      texto += String.fromCharCode.apply(null, bytes.subarray(n, n + 0x8000));
    }
    return btoa(texto);
  }

  function pcm16DeAmostras(amostras, sampleRate) {
    var taxaAlvo = 16000;
    var razao = sampleRate / taxaAlvo;
    var tamanho = Math.max(1, Math.round(amostras.length / razao));
    var pcm = new Int16Array(tamanho);
    for (var i = 0; i < tamanho; i++) {
      var inicio = Math.floor(i * razao);
      var fim = Math.min(amostras.length, Math.floor((i + 1) * razao));
      var soma = 0;
      for (var j = inicio; j < fim; j++) soma += amostras[j];
      var valor = soma / Math.max(1, fim - inicio);
      valor = Math.max(-1, Math.min(1, valor));
      pcm[i] = valor < 0 ? valor * 0x8000 : valor * 0x7fff;
    }
    return pcm;
  }

  function escreverAscii(view, offset, texto) {
    for (var i = 0; i < texto.length; i++) view.setUint8(offset + i, texto.charCodeAt(i));
  }

  function wavDeAmostras(partes, sampleRate) {
    var total = (partes || []).reduce(function (n, parte) { return n + parte.length; }, 0);
    var amostras = new Float32Array(total);
    var pos = 0;
    (partes || []).forEach(function (parte) {
      amostras.set(parte, pos);
      pos += parte.length;
    });
    var taxa = 16000;
    var pcm = pcm16DeAmostras(amostras, sampleRate || taxa);
    var buffer = new ArrayBuffer(44 + pcm.length * 2);
    var view = new DataView(buffer);
    escreverAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcm.length * 2, true);
    escreverAscii(view, 8, 'WAVE');
    escreverAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, taxa, true);
    view.setUint32(28, taxa * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    escreverAscii(view, 36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    var offset = 44;
    for (var i = 0; i < pcm.length; i++, offset += 2) view.setInt16(offset, pcm[i], true);
    return new Blob([view], { type: 'audio/wav' });
  }

  function liberarTranscricaoRealtime(realtime) {
    if (!realtime) return;
    realtime.parando = true;
    if (realtime.abrirTimer) clearTimeout(realtime.abrirTimer);
    if (realtime.finalTimer) clearTimeout(realtime.finalTimer);
    if (realtime.processador) {
      try { realtime.processador.disconnect(); } catch (_) {}
      realtime.processador.onaudioprocess = null;
    }
    if (realtime.fonte) { try { realtime.fonte.disconnect(); } catch (_) {} }
    if (realtime.silencio) { try { realtime.silencio.disconnect(); } catch (_) {} }
    if (realtime.socket && realtime.socket.readyState < WebSocket.CLOSING) {
      try { realtime.socket.close(); } catch (_) {}
    }
    if (realtime.contexto) realtime.contexto.close().catch(function () {});
    if (realtime.stream) realtime.stream.getTracks().forEach(function (track) { track.stop(); });
  }

  function pararTranscricaoRealtime(session) {
    var realtime = session && session.realtime;
    if (!realtime) return;
    liberarTranscricaoRealtime(realtime);
    if (session.realtime === realtime) session.realtime = null;
    session.realtimeAbrindo = false;
    session.ouvindo = false;
  }

  function textoConfirmadoRealtime(realtime) {
    return (realtime.trechosConfirmados || []).join(' ').replace(/\s+/g, ' ').trim();
  }

  function adicionarTrechoConfirmadoRealtime(realtime, texto) {
    var trecho = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!trecho) return;
    var trechos = realtime.trechosConfirmados || (realtime.trechosConfirmados = []);
    if (trechos[trechos.length - 1] !== trecho) trechos.push(trecho);
  }

  function textoParcialRealtime(realtime, parcial) {
    var confirmado = textoConfirmadoRealtime(realtime);
    var texto = String(parcial || '').replace(/\s+/g, ' ').trim();
    if (!confirmado) return texto;
    if (!texto || texto.toLowerCase().indexOf(confirmado.toLowerCase()) === 0) return texto || confirmado;
    return confirmado + ' ' + texto;
  }

  function agendarFimDaVez(session, realtime, espera) {
    if (realtime.finalTimer) clearTimeout(realtime.finalTimer);
    realtime.finalTimer = setTimeout(function () {
      realtime.finalTimer = null;
      concluirFalaRealtime(session, realtime, textoConfirmadoRealtime(realtime));
    }, espera);
  }

  function esperaNaturalDeResposta(realtime) {
    var texto = textoConfirmadoRealtime(realtime);
    if (/[?!]$/.test(texto)) return 520;
    if (/[.…]$/.test(texto)) return 700;
    // Sem pontuacao de fim, a pessoa provavelmente esta organizando o proximo pensamento.
    return 1050;
  }

  function concluirFalaRealtime(session, realtime, texto) {
    if (!session || !session.ativo || session.realtime !== realtime || realtime.concluido) return;
    var fala = String(texto || '').trim();
    if (!fala) return;
    realtime.concluido = true;
    pararTranscricaoRealtime(session);
    if (State.running) {
      State.running.abort();
      setTimeout(function () { enviarFalaDoNavegador(fala); }, 160);
      return;
    }
    vozMensagem('user', fala);
    session.ocupado = true;
    session.ultimaFalaEm = Date.now();
    streamReply();
  }

  function usarTranscricaoEmLote(session, erro) {
    if (!session || !session.ativo) return;
    /* Solta a trava ANTES de qualquer saida. Quando isso ficava pendurado —
       e ficava, sempre que a falha caia com ele ocupado — iniciarEscutaNeural
       voltava sem fazer nada para sempre: agente ligado e surdo. */
    session.realtimeAbrindo = false;
    session.realtimeAbrindoEm = 0;
    if (session.realtimeIndisponivel) return;
    session.realtimeIndisponivel = true;
    if (erro && !session.avisoTranscricao) {
      session.avisoTranscricao = true;
      mostrarDiagnostico(((erro && erro.message) || 'A transcricao em tempo real falhou.') + ' Usando modo compativel.');
    }
    pararTranscricaoRealtime(session);
    if (session.mudo || session.ocupado) {
      reagendarEscutaDoNavegador(400);
      return;
    }
    iniciarEscutaNeuralEmLote();
  }

  /** Scribe recebe PCM continuo e confirma a frase por VAD, sem esperar um arquivo WebM inteiro. */
  function iniciarEscutaNeuralEmTempoReal() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo || session.ocupado || session.realtime || session.realtimeAbrindo || falaNativaBloqueiaEscuta(session)) return;
    if (!window.WebSocket || !(window.AudioContext || window.webkitAudioContext)) {
      usarTranscricaoEmLote(session, new Error('Este navegador nao suporta a transcricao em tempo real.'));
      return;
    }
    session.realtimeAbrindo = true;
    session.realtimeAbrindoEm = Date.now();
    session.ouvindo = false;
    atualizarAgenteUI('conectando', 'abrindo transcricao em tempo real');

    pedirTokenDeTranscricao().then(function (token) {
      if (!session.ativo || session.mudo || session.ocupado) { session.realtimeAbrindo = false; return; }
      return getUserMediaAgente({ channelCount: 1 }).then(function (stream) {
        if (!session.ativo || session.mudo || session.ocupado) {
          session.realtimeAbrindo = false;
          stream.getTracks().forEach(function (track) { track.stop(); });
          return;
        }
        var endpoint = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
        endpoint.searchParams.set('model_id', 'scribe_v2_realtime');
        endpoint.searchParams.set('token', token);
        endpoint.searchParams.set('audio_format', 'pcm_16000');
        endpoint.searchParams.set('language_code', 'pt');
        endpoint.searchParams.set('commit_strategy', 'vad');
        var voz = parametrosDeVoz();
        endpoint.searchParams.set('vad_silence_threshold_secs', String(voz.vadSilence.toFixed(2)));
        endpoint.searchParams.set('vad_threshold', String(voz.vadThreshold.toFixed(2)));
        endpoint.searchParams.set('min_speech_duration_ms', String(voz.minSpeechMs));
        endpoint.searchParams.set('min_silence_duration_ms', String(voz.minSilenceMs));
        endpoint.searchParams.set('filter_background_audio', 'true');

        var contexto = new (window.AudioContext || window.webkitAudioContext)();
        var realtime = {
          stream: stream, contexto: contexto, socket: null, fonte: null, processador: null,
          silencio: null, parando: false, concluido: false, aberto: false, abrirTimer: null, finalTimer: null,
          trechosConfirmados: [], parcial: '', finalPendente: ''
        };
        session.realtime = realtime;
        session.realtimeAbrindo = false;
        session.realtimeAbrindoEm = 0;
        var socket = new WebSocket(endpoint.toString());
        realtime.socket = socket;
        realtime.abrirTimer = setTimeout(function () {
          if (!realtime.aberto && !realtime.parando && session.realtime === realtime) {
            usarTranscricaoEmLote(session, new Error('A transcricao em tempo real demorou para abrir.'));
          }
        }, 8500);

        socket.onopen = function () {
          if (!session.ativo || session.mudo || session.ocupado || session.realtime !== realtime) {
            liberarTranscricaoRealtime(realtime);
            return;
          }
          if (realtime.abrirTimer) { clearTimeout(realtime.abrirTimer); realtime.abrirTimer = null; }
          realtime.aberto = true;
          realtime.fonte = contexto.createMediaStreamSource(stream);
          realtime.processador = contexto.createScriptProcessor(4096, 1, 1);
          realtime.silencio = contexto.createGain();
          realtime.silencio.gain.value = 0;
          realtime.fonte.connect(realtime.processador);
          realtime.processador.connect(realtime.silencio);
          realtime.silencio.connect(contexto.destination);
          realtime.processador.onaudioprocess = function (evento) {
            if (realtime.parando || socket.readyState !== WebSocket.OPEN) return;
            var pcm = pcm16EmBase64(evento.inputBuffer.getChannelData(0), contexto.sampleRate);
            socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm }));
          };
          contexto.resume().catch(function () {});
          session.ouvindo = true;
          atualizarAgenteUI('ligado', 'ouvindo em tempo real');
        };

        socket.onmessage = function (evento) {
          if (!session.ativo || session.realtime !== realtime || realtime.parando) return;
          var dado;
          try { dado = JSON.parse(evento.data); } catch (_) { return; }
          var texto = String(dado.text || '').trim();
          if (dado.message_type === 'partial_transcript') {
            if (realtime.finalTimer) clearTimeout(realtime.finalTimer);
            realtime.finalTimer = null;
            realtime.finalPendente = '';
            if (texto) {
              realtime.parcial = texto;
              vozParcial(textoParcialRealtime(realtime, texto), 'user');
              atualizarAgenteUI('ligado', 'te ouvindo');
            }
            return;
          }
          if (dado.message_type === 'committed_transcript') {
            realtime.finalPendente = '';
            realtime.parcial = '';
            adicionarTrechoConfirmadoRealtime(realtime, texto);
            vozParcial(textoConfirmadoRealtime(realtime), 'user');
            atualizarAgenteUI('ligado', 'esperando voce concluir');
            // Uma pausa natural entre pensamentos nao deve virar uma resposta cortando voce.
            agendarFimDaVez(session, realtime, esperaNaturalDeResposta(realtime));
            return;
          }
          if (dado.message_type === 'final_transcript' && texto) {
            realtime.parcial = texto;
            vozParcial(textoParcialRealtime(realtime, texto), 'user');
            // Normalmente o committed chega logo depois. Este fallback cobre conexoes que so mandam final.
            if (realtime.finalTimer) clearTimeout(realtime.finalTimer);
            realtime.finalPendente = texto;
            realtime.finalTimer = setTimeout(function () {
              if (!realtime.finalPendente) return;
              adicionarTrechoConfirmadoRealtime(realtime, realtime.finalPendente);
              realtime.finalPendente = '';
              concluirFalaRealtime(session, realtime, textoConfirmadoRealtime(realtime));
            }, 1000);
            return;
          }
          if (dado.message_type && /error|rate_limited|quota|throttled/i.test(dado.message_type)) {
            registrarLimiteDaApi('elevenlabs', dado.error || dado.message_type,
              /quota/i.test(dado.message_type + ' ' + (dado.error || '')) ? 'quota_exhausted' : 'rate_limit');
            usarTranscricaoEmLote(session, new Error(String(dado.error || 'A transcricao em tempo real falhou.')));
          }
        };

        socket.onerror = function () {
          if (!realtime.parando && !realtime.concluido) usarTranscricaoEmLote(session, new Error('A conexao da transcricao em tempo real caiu.'));
        };
        socket.onclose = function () {
          if (!realtime.parando && !realtime.concluido && session.ativo) {
            usarTranscricaoEmLote(session, new Error('A conexao da transcricao em tempo real fechou.'));
          }
        };
      });
    }).catch(function (erro) {
      usarTranscricaoEmLote(session, erro);
    });
  }

  function iniciarEscutaNeural() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo || session.ocupado || session.captura || session.realtime || session.realtimeAbrindo || falaNativaBloqueiaEscuta(session)) return;
    if (session.realtimeIndisponivel) iniciarEscutaNeuralEmLote();
    else iniciarEscutaNeuralEmTempoReal();
  }

  function iniciarEscutaNeuralEmLote() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo || session.ocupado || session.captura || falaNativaBloqueiaEscuta(session)) return;
    if (!(window.AudioContext || window.webkitAudioContext)) {
      var semAudio = 'Este navegador nao permite processar audio do microfone.';
      mostrarDiagnostico(semAudio);
      atualizarAgenteUI('off', semAudio);
      toast(semAudio, 'bad');
      session.ativo = false;
      State.agente.ligado = false;
      return;
    }
    session.ouvindo = false;
    atualizarAgenteUI('conectando', 'abrindo microfone natural');
    getUserMediaAgente({ channelCount: 1 }).then(function (stream) {
      if (!session.ativo || session.mudo || session.ocupado) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      var contexto, fonte, analisador, processador, silencio;
      try {
        contexto = new (window.AudioContext || window.webkitAudioContext)();
        if (!contexto.createScriptProcessor) throw new Error('Este navegador nao permite gravar audio em lote.');
        fonte = contexto.createMediaStreamSource(stream);
        analisador = contexto.createAnalyser();
        analisador.fftSize = 1024;
        processador = contexto.createScriptProcessor(4096, 1, 1);
        silencio = contexto.createGain();
        silencio.gain.value = 0;
        fonte.connect(analisador);
        fonte.connect(processador);
        processador.connect(silencio);
        silencio.connect(contexto.destination);
      } catch (erroSetup) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        if (contexto) contexto.close().catch(function () {});
        throw erroSetup;
      }

      var voz = parametrosDeVoz();
      var captura = {
        stream: stream, contexto: contexto, fonte: fonte, processador: processador,
        silencio: silencio, analisador: analisador, partes: [], detectouFala: false,
        ultimoSom: Date.now(), inicio: Date.now(), parando: false, enviar: false,
        finalizado: false, quadro: 0, ruido: 0, amostrasRuido: 0,
        limiar: voz.limiarMin, pico: 0, avisouSemSinal: false, voz: voz,
        sampleRate: contexto.sampleRate
      };
      captura.finalizar = function () {
        if (captura.finalizado) return;
        captura.finalizado = true;
        liberarCaptura(captura);
        if (session.captura === captura) session.captura = null;
        session.ouvindo = false;
        if (!session.ativo || session.mudo || !captura.enviar) {
          if (session.ativo && !session.mudo && !session.ocupado) reagendarEscutaDoNavegador(250);
          return;
        }
        var audio = wavDeAmostras(captura.partes, captura.sampleRate);
        if (audio.size < 1200 || captura.partes.length < 2) {
          reagendarEscutaDoNavegador(250);
          return;
        }
        session.ocupado = true;
        atualizarAgenteUI('ligado', 'entendendo voce');
        transcreverAudio(audio).then(function (texto) {
          if (!session.ativo) return;
          if (!texto) {
            session.ocupado = false;
            reagendarEscutaDoNavegador(250);
            return;
          }
          enviarFalaDoNavegador(texto);
        }).catch(function (erro) {
          if (!session.ativo) return;
          session.ocupado = false;
          var mensagem = (erro && erro.message) || 'A transcricao da voz natural nao respondeu.';

          /* Perder a transcricao paga (cota, rede, chave) nao pode custar a
             conversa inteira. Se o navegador tem ditado proprio, ele assume a
             escuta e a voz natural continua sendo usada para FALAR. */
          if (Persona.Ditado.disponivel()) {
            session.escutaPorDitado = true;
            if (!session.avisoTranscricao) {
              session.avisoTranscricao = true;
              mostrarDiagnostico(mensagem + ' Voltei a te ouvir pelo ditado do navegador.');
            }
            reagendarEscutaDoNavegador(300);
            return;
          }

          session.neuralIndisponivel = true;
          session.ativo = false;
          State.agente.ligado = false;
          mostrarDiagnostico(mensagem);
          atualizarAgenteUI('off', mensagem);
          toast(mensagem, 'bad');
        });
      };

      session.captura = captura;
      processador.onaudioprocess = function (evento) {
        if (captura.finalizado || captura.parando) return;
        captura.partes.push(new Float32Array(evento.inputBuffer.getChannelData(0)));
      };
      contexto.resume().catch(function () {});
      session.ouvindo = true;
      atualizarAgenteUI('ligado', 'ouvindo');
      var dados = new Uint8Array(analisador.fftSize);
      function monitorar() {
        if (!session.ativo || session.mudo || session.captura !== captura || captura.parando) return;
        analisador.getByteTimeDomainData(dados);
        var soma = 0;
        for (var i = 0; i < dados.length; i++) {
          var valor = (dados[i] - 128) / 128;
          soma += valor * valor;
        }
        var volume = Math.sqrt(soma / dados.length);
        var agora = Date.now();
        if (volume > captura.pico) captura.pico = volume;
        if (agora - captura.inicio < 900) {
          captura.ruido += volume;
          captura.amostrasRuido++;
          if (captura.amostrasRuido > 8) {
            captura.limiar = Math.max(captura.voz.limiarMin, Math.min(0.012, (captura.ruido / captura.amostrasRuido) * captura.voz.limiarMultiplicador));
          }
        }
        if (volume > captura.limiar) {
          captura.detectouFala = true;
          captura.ultimoSom = agora;
        }
        if (!captura.detectouFala && agora - captura.inicio > 3500 && !captura.avisouSemSinal) {
          captura.avisouSemSinal = true;
          atualizarAgenteUI('ligado', 'checando sinal do microfone');
        }
        if ((!captura.detectouFala && agora - captura.inicio > 10000) ||
            (captura.detectouFala && agora - captura.ultimoSom > captura.voz.loteSilencioMs) ||
            agora - captura.inicio > 45000) {
          // A transcricao e a fonte de verdade. Nunca descarte uma fala so por volume baixo.
          pararCapturaNeural(session, true);
          return;
        }
        captura.quadro = requestAnimationFrame(monitorar);
      }
      monitorar();
    }).catch(function (erro) {
      if (!session.ativo || session.mudo) return;
      session.ouvindo = false;
      session.neuralIndisponivel = true;
      var bloqueado = erro && (erro.name === 'NotAllowedError' || erro.name === 'SecurityError');
      var mensagem = bloqueado
        ? 'O microfone esta bloqueado. Libere no cadeado da barra de endereco.'
        : ((erro && erro.message) || 'Nao consegui abrir o microfone para a transcricao natural.');
      session.ativo = false;
      State.agente.ligado = false;
      mostrarDiagnostico(mensagem);
      atualizarAgenteUI('off', mensagem);
      toast(mensagem, 'bad');
    });
  }

  /**
   * Quanto silencio fecha a sua vez de falar. O ditado do Chrome marca um
   * trecho como "final" a cada pausinha, no meio da frase — fechar ali era
   * o que fazia ele te cortar no meio do raciocinio e responder a um pedaco.
   * Pausa de TDAH e pensamento, nao fim de frase.
   */
  function silencioDeFimDeVez() {
    var t = (vozSensibilidade() - 40) / 60;      // 0 = paciente, 1 = rapido
    return Math.round(1550 - t * 450);           // 1550ms .. 1100ms
  }

  function iniciarEscutaPorDitado() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo || session.ocupado || falaNativaBloqueiaEscuta(session)) return;
    session.ouvindo = false;
    atualizarAgenteUI('conectando', 'abrindo microfone');

    var fechando = null;
    var encerrado = false;
    var ultimoTexto = '';

    function cancelarFechamento() {
      if (fechando) { clearTimeout(fechando); fechando = null; }
    }

    /** Cada palavra nova adia o fechamento; so o silencio de verdade encerra. */
    function agendarFechamento(temFinal) {
      cancelarFechamento();
      if (encerrado) return;
      fechando = setTimeout(function () {
        fechando = null;
        if (encerrado || !session.ativo || session.mudo) return;
        encerrado = true;
        session.ouvindo = false;
        atualizarAgenteUI('ligado', 'entendi, pensando');
        Persona.Ditado.parar();
      }, temFinal ? silencioDeFimDeVez() : silencioDeFimDeVez() + 700);
    }

    var abriu = Persona.Ditado.iniciar(function (texto, jaFinalizado) {
      if (!session.ativo || encerrado) return;
      if (!texto) return;
      ultimoTexto = texto;
      vozParcial(texto, 'user');
      agendarFechamento(!!String(jaFinalizado || '').trim());
    }, function (texto, erroMsg) {
      cancelarFechamento();
      encerrado = true;
      session.ouvindo = false;
      if (!session.ativo || session.mudo) return;
      // Alguns navegadores fecham sem marcar o ultimo trecho como final.
      // Perder o que voce acabou de dizer e pior do que arriscar um parcial.
      var fala = String(texto || '').trim() || String(ultimoTexto || '').trim();
      if (fala) {
        enviarFalaDoNavegador(fala);
        return;
      }
      // Um aviso por motivo, nao um por respiro: o ditado do navegador
      // tropeca sozinho de vez em quando e a tela virava um mural de erro.
      if (erroMsg && !/ouvi nada/i.test(erroMsg) && session.ultimoErroDitado !== erroMsg) {
        session.ultimoErroDitado = erroMsg;
        toast(erroMsg, 'bad');
      }
      reagendarEscutaDoNavegador(300);
    }, function (estado) {
      if (!session.ativo) return;
      if (estado === 'started') {
        session.ouvindo = true;
        atualizarAgenteUI('ligado', 'ouvindo');
      } else if (estado === 'speechstart') {
        cancelarFechamento();
        atualizarAgenteUI('ligado', 'te ouvindo');
      } else if (estado === 'speechend') {
        agendarFechamento(true);
      }
    });
    if (abriu) {
      session.falhasDitado = 0;
      return;
    }

    /* start() recusado costuma ser o reconhecedor anterior ainda fechando.
       Desligar o agente por causa disso era o defeito mais cruel: ele sumia
       no meio da conversa. Tenta de novo algumas vezes antes de desistir. */
    session.falhasDitado = (session.falhasDitado || 0) + 1;
    if (session.falhasDitado <= 4) {
      atualizarAgenteUI('ligado', 'reabrindo o microfone');
      reagendarEscutaDoNavegador(400 * session.falhasDitado);
      return;
    }
    session.ativo = false;
    State.agente.ligado = false;
    var semMic = 'Nao consegui reabrir o microfone do navegador. Recarregue a pagina e ligue o agente de novo.';
    mostrarDiagnostico(semMic);
    atualizarAgenteUI('off', 'nao consegui abrir o microfone');
    toast(semMic, 'bad');
  }

  function iniciarEscutaDoNavegador() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo) return;
    // Ocupado ou falando nao e motivo para desistir: e motivo para voltar depois.
    if (session.ocupado || falaNativaBloqueiaEscuta(session)) {
      reagendarEscutaDoNavegador(350);
      return;
    }
    var espera = (session.escutaLiberadaEm || 0) - Date.now();
    if (espera > 0) {
      if (!session.retomadaTimer) {
        session.retomadaTimer = setTimeout(function () {
          session.retomadaTimer = null;
          iniciarEscutaDoNavegador();
        }, espera);
      }
      return;
    }
    if (window.Ambiente) Ambiente.reduzir(true);
    if (usarVozNatural() && !session.escutaPorDitado) {
      iniciarEscutaNeural();
      return;
    }
    iniciarEscutaPorDitado();
  }

  function confirmarMicrofoneDoNavegador(session) {
    return getUserMediaAgente().then(function (stream) {
      var temAudio = stream.getAudioTracks().some(function (track) { return track.readyState === 'live'; });
      stream.getTracks().forEach(function (track) { track.stop(); });
      if (!temAudio) throw new Error('Nenhum microfone ativo foi encontrado.');
      if (!session.ativo) throw new Error('A ativacao do agente foi cancelada.');
      session.microfoneConfirmado = true;
    });
  }

  function tratarFalhaMicrofoneDoNavegador(session, erro) {
    if (!session || !session.ativo) return;
    session.ativo = false;
    State.agente.ligado = false;
    var bloqueado = erro && (erro.name === 'NotAllowedError' || erro.name === 'SecurityError');
    var mensagem = bloqueado
      ? 'O microfone esta bloqueado. Libere no cadeado da barra de endereco e ligue o agente de novo.'
      : ((erro && erro.message) || 'Nao consegui confirmar um microfone ativo neste aparelho.');
    mostrarDiagnostico(mensagem);
    atualizarAgenteUI('off', mensagem);
    toast(mensagem, 'bad');
  }

  function conectarVozDoNavegador(comSaudacao) {
    if (agenteNavegadorAtivo()) return;
    var sup = suporteAgenteNavegador();
    if (!sup.ok) {
      mostrarDiagnostico(sup.motivo);
      atualizarAgenteUI('off', sup.motivo);
      return;
    }
    State.agente.navegador = {
      ativo: true,
      ouvindo: false,
      ocupado: false,
      mudo: false,
      inicioEm: Date.now(),
      ultimaFalaEm: Date.now(),
      microfoneConfirmado: false,
      avisoVoz: false,
      falhasVozNavegador: 0,
      falhasDitado: 0,
      falandoNativo: false,
      escutaPorDitado: false,
      realtimeAbrindoEm: 0,
      ultimoErroDitado: '',
      escutaLiberadaEm: 0,
      retomadaTimer: null
    };
    var session = State.agente.navegador;
    State.agente.descansando = false;
    limparDiagnostico();
    atualizarAgenteUI('conectando', 'pedindo acesso ao microfone');
    confirmarMicrofoneDoNavegador(session).then(function () {
      if (!session.ativo || State.agente.navegador !== session) return;
      if (comSaudacao !== false) {
        session.ocupado = true;
        falarDoNavegador('Oi, ' + apelido() + '. Estou aqui com voce. Qual e a unica coisa que importa agora?');
      } else {
        iniciarEscutaDoNavegador();
      }
    }).catch(function (erro) {
      tratarFalhaMicrofoneDoNavegador(session, erro);
    });
  }

  function encerrarVozDoNavegador() {
    var session = State.agente.navegador;
    if (!session) return;
    session.ativo = false;
    session.falandoNativo = false;
    Persona.Ditado.parar();
    Persona.Voice.calar();
    if (window.Ambiente) Ambiente.reduzir(false);
    if (session.retomadaTimer) clearTimeout(session.retomadaTimer);
    if (session.filaFala) session.filaFala.cancelar();
    if (session.falaAbort) session.falaAbort.abort();
    pararDetectorDeInterrupcao(session);
    pararTranscricaoRealtime(session);
    pararCapturaNeural(session, false);
    if (session.audio) { try { session.audio.pause(); } catch (_) {} }
    if (session.audioUrl) URL.revokeObjectURL(session.audioUrl);
    var parcial = $('#voz-parcial');
    if (parcial) parcial.remove();
    State.agente.navegador = null;
  }

  function alternarMudoDoNavegador() {
    var session = State.agente.navegador;
    if (!session) return false;
    session.mudo = !session.mudo;
    if (session.mudo) {
      Persona.Ditado.parar();
      if (session.retomadaTimer) clearTimeout(session.retomadaTimer);
      pararTranscricaoRealtime(session);
      pararCapturaNeural(session, false);
    }
    else iniciarEscutaDoNavegador();
    atualizarAgenteUI('ligado', session.mudo ? 'microfone mudo' : 'pode falar');
    return session.mudo;
  }

  /** Pode conectar agora? Devolve o motivo quando não pode. */
  function impedimentoDoAgente() {
    if (!State.user) return 'entre na sua conta primeiro';
    if (!State.apiKey) return 'falta a chave da API em Chave & Modelo';
    var t = Store.Usage.teto(State.user.id, State.config.tetoMensalUSD);
    if (t.estourou) return 'o teto de ' + money(t.teto) + ' deste mes estourou';
    if (usaAgenteDoNavegador()) {
      var browserSupport = suporteAgenteNavegador();
      if (!browserSupport.ok) return browserSupport.motivo;
      return '';
    }
    var sup = Voz.suporte();
    if (!sup.ok) return sup.motivo;
    var t = Store.Usage.teto(State.user.id, State.config.tetoMensalUSD);
    if (t.estourou) return 'o teto de ' + money(t.teto) + ' deste mês estourou';
    return '';
  }

  function conectarVoz(comSaudacao) {
    var bloqueio = impedimentoDoAgente();
    if (bloqueio) {
      pararReconexao();
      mostrarDiagnostico('Nao consigo ligar o agente: ' + bloqueio + '.');
      atualizarAgenteUI('off', '');
      return;
    }
    if (usaAgenteDoNavegador()) {
      conectarVozDoNavegador(comSaudacao);
      return;
    }
    if (Voz.ativo()) return;

    var impede = impedimentoDoAgente();
    if (impede) {
      pararReconexao();
      mostrarDiagnostico('Não consigo ligar o agente: ' + impede + '.');
      atualizarAgenteUI('off', '');
      return;
    }

    State.agente.descansando = false;
    State.vozAcoes = [];
    limparDiagnostico();

    Voz.iniciar({
      apiKey: State.apiKey,
      model: State.config.vozModelo || 'gpt-realtime-2.1',
      voz: State.config.vozRealtime || 'marin',
      instrucoes: agenteInstrucoes(),
      tools: State.config.ferramentas === false ? [] : Ferramentas.paraRealtime(),
      saudacao: comSaudacao !== false,
      saudacaoTexto: saudacaoDoAgente(),
      micDeviceId: micDeviceId(),
      sensibilidade: vozSensibilidade(),
      safetyId: 'kao-' + State.user.id
    }, {
      onEstado: function (estado, detalhe) {
        if (estado === 'ligado') {
          State.agente.tentativas = 0;         // conectou: zera o castigo
          limparDiagnostico();
          avisarCustoUmaVez();
        }
        atualizarAgenteUI(estado, detalhe);
      },

      onParcial: vozParcial,
      onUsuario: function (texto) { vozMensagem('user', texto); },
      onAssistente: function (texto) { vozMensagem('assistant', texto); },

      onFerramenta: function (nome, args) {
        var r = Ferramentas.executar(State.user.id, nome, args);
        State.vozAcoes.push({ nome: nome, rotulo: Ferramentas.rotulo(nome, args), erro: r.erro });
        atualizarTudoDepoisDeFerramenta();
        agendarAtualizacaoDeContexto();
        return r.conteudo;
      },

      /* Áudio é caro: sem contar isso, o teto mensal não protegeria nada. */
      onUso: function (u) {
        var det = u.input_token_details || {};
        var cache = det.cached_tokens || 0;
        var entrada = Math.max(0, (u.input_tokens || 0) - cache);
        var saida = u.output_tokens || 0;
        var modelo = State.config.vozModelo || 'gpt-realtime-2.1';
        var antes = Store.Usage.doMes(State.user.id).cost;
        Store.Usage.add(State.user.id, entrada, saida, modelo,
                        { lidos: cache, escritos: 0 }, Claude.priceOf(modelo));
        State.agente.custoSessao += Math.max(0, Store.Usage.doMes(State.user.id).cost - antes);
        renderDashboard();
      },

      onAviso: function (msg) { toast(msg); },

      onErro: function (msg, fatal) {
        if (fatal) { mostrarDiagnostico(msg); toast(msg, 'bad'); }
        else if (State.agente.tentativas === 0) { toast(msg, 'bad'); }
      },

      onFim: function (minutos, info) {
        var antigo = $('#voz-parcial');
        if (antigo) antigo.remove();
        State.vozAcoes = [];

        if (minutos > 0.1 && Store.Progress) {
          Store.Progress.addVoiceMinutes(State.user.id, minutos);
          reward(Math.round(minutos * 10), 'conversa por voz');
        }

        // Erro sem conserto: desliga de vez e explica, em vez de ficar batendo na porta.
        if (info && info.fatal) {
          State.agente.ligado = false;
          Store.Config.set(State.user.id, { agenteAtivo: false });
          State.config = Store.Config.get(State.user.id);
          pararReconexao();
          mostrarDiagnostico(info.erro || 'A voz parou.');
          atualizarAgenteUI('off', '');
          return;
        }

        if (State.agente.ligado && !State.agente.parandoDeProposito) {
          agendarReconexao();
        }
        State.agente.parandoDeProposito = false;
        atualizarAgenteUI('off', '');
      }
    });
  }

  /**
   * Microfone aberto é cobrado por minuto, fale-se ou não. Sem teto definido,
   * deixar o agente ligado o dia todo vira uma conta feia no fim do mês —
   * então a primeira conexão de cada sessão avisa, uma vez só.
   */
  function avisarCustoUmaVez() {
    if (State.agente.avisouCusto) return;
    State.agente.avisouCusto = true;
    if ((State.config.tetoMensalUSD || 0) > 0) return;
    toast('O agente ouvindo custa por minuto (~US$ 1,50/h). Defina um teto em Chave & Modelo.', 'bad');
  }

  function agendarReconexao() {
    pararReconexao();
    var i = Math.min(State.agente.tentativas, ESPERAS.length - 1);
    var espera = ESPERAS[i];
    State.agente.tentativas++;
    State.agente.timer = setTimeout(function () {
      State.agente.timer = null;
      if (State.agente.ligado) conectarVoz(false);   // religou: não cumprimenta de novo
    }, espera);
    atualizarAgenteUI('off', '');
  }

  function pararReconexao() {
    if (State.agente.timer) { clearTimeout(State.agente.timer); State.agente.timer = null; }
  }

  /** A memória mudou no meio da conversa: ele precisa saber. */
  var timerContexto = null;
  function agendarAtualizacaoDeContexto() {
    if (timerContexto) clearTimeout(timerContexto);
    timerContexto = setTimeout(function () {
      timerContexto = null;
      if (Voz.ligado()) Voz.atualizarInstrucoes(agenteInstrucoes());
    }, 4000);
  }

  function ligarAgente(silencioso) {
    State.agente.ligado = true;
    State.agente.tentativas = 0;
    State.agente.parandoDeProposito = false;
    State.agente.descansando = false;
    State.agente.custoSessao = 0;
    if (State.user) {
      Store.Config.set(State.user.id, { agenteAtivo: true });
      State.config = Store.Config.get(State.user.id);
      if ($('#cfg-agente-auto')) $('#cfg-agente-auto').checked = true;
    }
    iniciarVigia();
    conectarVoz(silencioso ? false : true);
    if (!silencioso) toast(nomeP() + ' está entrando na linha…');
  }

  function desligarAgente(silencioso) {
    State.agente.ligado = false;
    State.agente.parandoDeProposito = true;
    pararReconexao();
    pararVigia();
    if (State.user) {
      Store.Config.set(State.user.id, { agenteAtivo: false });
      State.config = Store.Config.get(State.user.id);
      if ($('#cfg-agente-auto')) $('#cfg-agente-auto').checked = false;
    }
    if (agenteNavegadorAtivo()) encerrarVozDoNavegador();
    else Voz.encerrar();
    limparDiagnostico();
    atualizarAgenteUI('off', '');
    if (!silencioso) toast('Agente desligado. O microfone foi solto.');
  }

  function alternarAgente() {
    if (State.agente.ligado || Voz.ativo() || agenteNavegadorAtivo()) desligarAgente();
    else {
      desbloquearAudioDoAgente();
      ligarAgente();
    }
  }

  /* ---------------- vigia: ociosidade, teto e relógio ---------------- */

  function iniciarVigia() {
    pararVigia();
    State.agente.vigia = setInterval(function () {
      if (!State.agente.ligado) return;

      // teto de gasto: a voz consome rápido, então checa sempre
      var t = Store.Usage.teto(State.user.id, State.config.tetoMensalUSD);
      if (t.estourou) {
        atualizarAvisoDeLimiteApi();
        toast('Teto de ' + money(t.teto) + ' atingido. Desliguei o agente.', 'bad');
        desligarAgente(true);
        mostrarDiagnostico('O teto de ' + money(t.teto) + ' deste mês estourou.');
        return;
      }

      // descanso por silêncio, se você pediu
      var limite = parseInt(State.config.vozOciosoMin, 10) || 0;
      var ocioso = agenteNavegadorAtivo()
        ? (Date.now() - State.agente.navegador.ultimaFalaEm) / 1000
        : Voz.ocioso();
      if (limite > 0 && (Voz.ligado() || agenteNavegadorAtivo()) && ocioso > limite * 60) {
        State.agente.parandoDeProposito = true;
        State.agente.descansando = true;
        if (agenteNavegadorAtivo()) encerrarVozDoNavegador(); else Voz.encerrar();
        toast(nomeP() + ' foi descansar depois de ' + limite + ' min em silêncio. Clique para acordar.');
        return;
      }

      // Rede de seguranca: ligado e surdo nunca pode durar mais que um ciclo.
      garantirEscutaDoNavegador();

      if (Voz.ligado() || agenteNavegadorAtivo()) atualizarAgenteUI('ligado', '');
    }, 10000);
  }

  function pararVigia() {
    if (State.agente.vigia) { clearInterval(State.agente.vigia); State.agente.vigia = null; }
  }

  /** Chamado depois do login e depois do criador de personagem. */
  function talvezLigarAgenteSozinho() {
    if (!State.user || !State.config) return;
    if (State.config.agenteAtivo === false) { atualizarAgenteUI('off', ''); return; }
    if (!State.apiKey) { atualizarAgenteUI('off', ''); return; }
    if (Voz.ativo() || agenteNavegadorAtivo() || State.agente.ligado) return;
    if (!State.perfil.onboarded) return;          // primeiro cria o personagem
    ligarAgente(true);
  }

  function bindCopiloto() {
    var agente = $('#btn-agente');
    var btn = $('#btn-copilot');
    var mini = $('#btn-copilot-mini');
    var mudo = $('#btn-copilot-mudo');
    var reelVoice = $('#btn-voice-reel');

    if (agente) agente.addEventListener('click', alternarAgente);
    if (btn) btn.addEventListener('click', alternarAgente);
    if (mini) mini.addEventListener('click', alternarAgente);
    if (reelVoice) reelVoice.addEventListener('click', function () { setNav('chat'); alternarAgente(); });
    if (mudo) {
      mudo.addEventListener('click', function () {
        if (agenteNavegadorAtivo()) alternarMudoDoNavegador(); else Voz.alternarMudo();
        atualizarAgenteUI(agenteNavegadorAtivo() ? 'ligado' : Voz.estado(), '');
      });
    }

    // Fechar a aba não pode deixar o microfone ligado.
    window.addEventListener('beforeunload', function () {
      State.agente.parandoDeProposito = true;
      if (agenteNavegadorAtivo()) encerrarVozDoNavegador();
      else if (Voz.ativo()) Voz.encerrar();
    });

    // Voltar de um sono do sistema / queda de rede: religa na hora.
    window.addEventListener('online', function () {
      if (State.agente.ligado && !Voz.ativo() && !agenteNavegadorAtivo()) { State.agente.tentativas = 0; conectarVoz(false); }
    });

    atualizarAgenteUI('off', '');
  }

  /* ============================================================
     RITUAIS — atalhos para as horas que mais pegam
     ============================================================ */
  var RITUAIS = {
    manha: 'Bom dia. Me dá o resumo do que importa hoje: o que ficou pendente, o que vence, ' +
           'e qual é a UMA coisa que eu deveria fazer primeiro. Seja curto.',
    travei: 'Travei agora. Não estou conseguindo começar. Me dá um passo só, o menor possível, ' +
            'para eu sair do lugar nos próximos 5 minutos.',
    noite: 'Vamos fechar o dia. Me pergunte como foi, o que eu consegui fazer e o que ficou para amanhã. ' +
           'Depois anote no diário e atualize minhas pendências.',
    dinheiro: 'Como estou de dinheiro este mês? Consulte minhas finanças e me diga a real: ' +
              'o que está fora do lugar, o que vence e o que eu deveria fazer.'
  };

  RITUAIS.manha = 'Execute a skill executar_caixa do JarvisOS. Depois me entregue o resumo em no maximo 10 linhas e escolha a primeira acao de 5 minutos.';
  RITUAIS.noite = 'Vamos fechar o dia. Pergunte uma coisa por vez se faltar contexto. Depois use fechar_dia para gravar no Diario e atualize minhas pendencias.';

  function dispararRitual(qual) {
    var texto = RITUAIS[qual];
    if (!texto) return;
    if (!State.apiKey) { toast('Configure sua chave da API primeiro.', 'bad'); setNav('settings'); return; }

    // Se ele já está na linha, o ritual vira fala em vez de abrir outra conversa.
    if (agenteNavegadorAtivo()) { setNav('chat'); enviarFalaDoNavegador(texto); return; }
    if (Voz.estado() === 'ligado') { setNav('chat'); Voz.dizer(texto); return; }

    newConv(true);
    setNav('chat');
    sendMessage(texto);
  }

  /* ============================================================
     CHAVE & MODELO
     ============================================================ */
  function fillVozSelect() {
    var sel = $('#cfg-voz-realtime');
    if (!sel || sel.options.length) return;
    Voz.VOZES.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.id; o.textContent = v.nome;
      sel.appendChild(o);
    });
  }

  function fillModelSelects() {
    fillVozSelect();
    var a = $('#cfg-model'), b = $('#model-quick');
    a.innerHTML = ''; b.innerHTML = '';
    Claude.modelsFor(State.config.provider).forEach(function (m) {
      var o1 = document.createElement('option');
      o1.value = m.id; o1.textContent = m.name + ' — ' + m.tag;
      a.appendChild(o1);
      var o2 = document.createElement('option');
      o2.value = m.id; o2.textContent = m.name.replace('GPT-', 'GPT ');
      b.appendChild(o2);
    });
  }

  function providerLabel(provider) {
    return provider === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI (GPT)';
  }

  function applyProviderUI() {
    var provider = State.config.provider || 'openai';
    var isClaude = provider === 'anthropic';
    var title = $('#api-key-title');
    var help = title && title.parentElement && title.parentElement.nextElementSibling;
    if (title) title.textContent = 'Chave da API ' + (isClaude ? 'Claude' : 'OpenAI');
    if (help) {
      help.innerHTML = isClaude
        ? 'Cole sua chave da <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic</a> (<code>sk-ant-...</code>). Ela fica criptografada neste dispositivo e segue apenas para o proxy seguro do app.'
        : 'Cole sua chave da <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI</a> (<code>sk-...</code>). Ela fica criptografada neste dispositivo e segue apenas para o proxy seguro do app.';
    }
    $('#api-key').placeholder = isClaude ? 'sk-ant-api03-...' : 'sk-proj-...';
    $('#cfg-provider').value = provider;
    var openaiOption = $('#cfg-provider option[value="openai"]');
    if (openaiOption) openaiOption.hidden = true;
    ['#cfg-voz-realtime', '#cfg-voz-modelo'].forEach(function (sel) {
      var input = $(sel);
      if (input && input.closest('.field')) input.closest('.field').classList.add('hidden');
    });
  }

  function loadProviderKey() {
    State.apiKey = '';
    renderKeyUI();
    return Store.ApiKey.load(State.user.id, State.config.provider).then(function (key) {
      State.apiKey = key || '';
      renderKeyUI();
      if (State.apiKey) return checkKey(true);
      setKeyStatus('none');
      return false;
    });
  }

  function updateModelHint() {
    var m = Claude.modelOf(State.config.model);
    $('#model-hint').textContent = m.desc + ' Entrada US$ ' + m.price.in + ' / saída US$ ' + m.price.out + ' por 1M de tokens.';
  }

  function applyConfigToForm() {
    var c = State.config;
    applyProviderUI();
    $('#cfg-model').value = c.model;
    $('#model-quick').value = c.model;
    $('#cfg-effort').value = c.effort;
    $('#cfg-maxtokens').value = c.maxTokens;
    $('#cfg-maxtokens-label').textContent = nf(c.maxTokens);
    $('#cfg-thinking').checked = !!c.showThinking;
    $('#cfg-system').value = c.system || '';
    $('#cfg-teto').value = c.tetoMensalUSD || '';
    $('#cfg-ferramentas').checked = c.ferramentas !== false;
    if ($('#cfg-catalogo')) $('#cfg-catalogo').checked = c.catalogoAuto !== false;
    if ($('#cfg-voz-realtime')) $('#cfg-voz-realtime').value = c.vozRealtime || 'marin';
    if ($('#cfg-voz-modelo')) $('#cfg-voz-modelo').value = c.vozModelo || 'gpt-realtime-2.1';
    aplicarVozElevenLabs(c.elevenLabsVoiceId || DEFAULT_ELEVENLABS_VOICE);
    if ($('#cfg-elevenlabs-model')) $('#cfg-elevenlabs-model').value = c.elevenLabsModel || 'eleven_multilingual_v2';
    renderModelagemElevenLabs();
    if ($('#cfg-ambiente-volume')) $('#cfg-ambiente-volume').value = String(volumeAmbiente());
    if ($('#cfg-ambiente-volume-label')) $('#cfg-ambiente-volume-label').textContent = volumeAmbiente() + '%';
    if ($('#cfg-voz-ocioso')) $('#cfg-voz-ocioso').value = String(c.vozOciosoMin || 0);
    if ($('#cfg-agente-auto')) $('#cfg-agente-auto').checked = c.agenteAtivo !== false;
    $('#cfg-system-custom').checked = c.systemMode === 'custom';
    $('#field-system').classList.toggle('hidden', c.systemMode !== 'custom');
    updateModelHint();
    renderCtxInfo();
    atualizarMic();
    renderVoiceProfileControls();
  }

  function setKeyStatus(status) {
    State.keyStatus = status;
    var badge = $('#key-badge');
    var map = {
      ok:      ['Conectada', 'ok'],
      bad:     ['Com problema', 'bad'],
      none:    ['Não configurada', ''],
      unknown: ['Salva', '']
    };
    var v = map[status] || map.unknown;
    badge.textContent = v[0];
    badge.className = 'badge ' + v[1];
    renderStatus();
  }

  function renderKeyUI() {
    var meta = Store.ApiKey.meta(State.user.id, State.config.provider);
    $('#api-key').value = State.apiKey || '';
    if (!meta) setKeyStatus('none');
  }

  function renderElevenLabsKeyUI() {
    var input = $('#elevenlabs-key');
    var result = $('#elevenlabs-result');
    if (!input || !State.user) return;
    input.value = State.elevenLabsKey || '';
    if (!result) return;
    if (State.elevenLabsKey && !chaveElevenLabsPareceValida(State.elevenLabsKey)) {
      State.elevenLabsKeyInvalida = State.elevenLabsKey;
      result.className = 'test-result show bad';
      result.textContent = mensagemChaveElevenLabsInvalida();
      return;
    }
    var vozNome = nomeDaVozElevenLabs(State.config && State.config.elevenLabsVoiceId);
    if (!State.elevenLabsKey && State.elevenLabsServidor) {
      input.placeholder = 'Ja tem chave salva no servidor - so cole aqui se quiser usar a sua.';
      result.className = 'test-result show ok';
      result.textContent = vozNome
        ? 'Voz natural ligada pela chave do servidor: ' + vozNome + '.'
        : 'Voz natural ligada pela chave do servidor.';
      return;
    }
    result.className = State.elevenLabsKey ? 'test-result show ok' : 'test-result';
    result.textContent = State.elevenLabsKey
      ? (vozNome ? 'Voz natural pronta: ' + vozNome + '.' : 'Voz natural pronta para o proximo agente.')
      : '';
  }

  function labelsDaVozElevenLabs(voice) {
    if (!voice || !voice.labels || typeof voice.labels !== 'object') return '';
    return Object.keys(voice.labels).map(function (key) {
      return voice.labels[key];
    }).filter(Boolean).join(', ');
  }

  function textoDaVozElevenLabs(voice) {
    if (!voice) return '';
    return [voice.name || voice.id, labelsDaVozElevenLabs(voice)].filter(Boolean).join(' - ');
  }

  function nomeDaVozElevenLabs(id) {
    id = String(id || '').trim();
    if (!id) return '';
    var encontrada = ElevenLabsVoices.filter(function (voice) { return voice && voice.id === id; })[0];
    return encontrada ? textoDaVozElevenLabs(encontrada) : '';
  }

  function vozElevenLabsAtual() {
    var manual = $('#cfg-elevenlabs-voice');
    var select = $('#cfg-elevenlabs-voice-select');
    return String(
      (manual && manual.value.trim()) ||
      (select && select.value) ||
      (State.config && State.config.elevenLabsVoiceId) ||
      DEFAULT_ELEVENLABS_VOICE
    ).trim();
  }

  function aplicarVozElevenLabs(id) {
    id = String(id || '').trim();
    var manual = $('#cfg-elevenlabs-voice');
    var select = $('#cfg-elevenlabs-voice-select');
    if (manual) manual.value = id;
    if (!select) return;
    if (id && !Array.prototype.some.call(select.options, function (opt) { return opt.value === id; })) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = 'ID manual salvo - ' + id;
      select.appendChild(opt);
    }
    select.value = id;
  }

  function numeroLimitado(valor, fallback, min, max) {
    var n = Number(valor);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function valorModelagemElevenLabs(id, fallback, min, max) {
    var el = $('#' + id);
    if (el) return numeroLimitado(el.value, fallback, min, max);
    return numeroLimitado(fallback, fallback, min, max);
  }

  function atualizarLabelModelagemElevenLabs(id, valor) {
    var label = $('#' + id + '-label');
    if (label) label.textContent = Math.round(valor) + '%';
  }

  function renderModelagemElevenLabs() {
    var c = State.config || {};
    var valores = {
      stability: numeroLimitado(c.elevenLabsStability, 48, 0, 100),
      similarity: numeroLimitado(c.elevenLabsSimilarity, 75, 0, 100),
      style: numeroLimitado(c.elevenLabsStyle, 12, 0, 100),
      speed: numeroLimitado(c.elevenLabsSpeed, 100, 70, 120)
    };
    Object.keys(valores).forEach(function (nome) {
      var input = $('#cfg-elevenlabs-' + nome);
      if (input) input.value = String(valores[nome]);
      atualizarLabelModelagemElevenLabs('cfg-elevenlabs-' + nome, valores[nome]);
    });
    var boost = $('#cfg-elevenlabs-boost');
    if (boost) boost.checked = c.elevenLabsSpeakerBoost !== false;
  }

  function modelagemElevenLabsAtual() {
    var c = State.config || {};
    return {
      stability: valorModelagemElevenLabs('cfg-elevenlabs-stability', numeroLimitado(c.elevenLabsStability, 48, 0, 100), 0, 100),
      similarity: valorModelagemElevenLabs('cfg-elevenlabs-similarity', numeroLimitado(c.elevenLabsSimilarity, 75, 0, 100), 0, 100),
      style: valorModelagemElevenLabs('cfg-elevenlabs-style', numeroLimitado(c.elevenLabsStyle, 12, 0, 100), 0, 100),
      speed: valorModelagemElevenLabs('cfg-elevenlabs-speed', numeroLimitado(c.elevenLabsSpeed, 100, 70, 120), 70, 120),
      speakerBoost: $('#cfg-elevenlabs-boost') ? $('#cfg-elevenlabs-boost').checked : !(c.elevenLabsSpeakerBoost === false)
    };
  }

  function parametrosElevenLabs() {
    var m = modelagemElevenLabsAtual();
    return {
      stability: m.stability / 100,
      similarityBoost: m.similarity / 100,
      style: m.style / 100,
      speed: m.speed / 100,
      speakerBoost: m.speakerBoost
    };
  }

  function scoreVozElevenLabs(voice) {
    if (!voice || !voice.id) return -999;
    var labels = voice.labels && typeof voice.labels === 'object'
      ? Object.keys(voice.labels).map(function (key) { return key + ' ' + voice.labels[key]; }).join(' ')
      : '';
    var texto = ((voice.name || '') + ' ' + labels).toLowerCase();
    var score = 0;
    if (/portugu|portuguese|brasil|brazil|pt[-_ ]?br|pt[-_ ]?pt/.test(texto)) score += 20;
    if (/convers|natural|warm|calm|clear|casual|expressive|friendly/.test(texto)) score += 4;
    if (/clone|robot|synthetic|advertis|narrator/.test(texto)) score -= 3;
    return score;
  }

  function escolherVozPadraoElevenLabs(voices) {
    voices = Array.isArray(voices) ? voices.filter(function (voice) { return voice && voice.id; }) : [];
    if (!voices.length) return vozElevenLabsAtual() || DEFAULT_ELEVENLABS_VOICE;
    var atual = vozElevenLabsAtual();
    if (atual && atual !== DEFAULT_ELEVENLABS_VOICE && voices.some(function (voice) { return voice.id === atual; })) return atual;
    var ordenadas = voices.slice().sort(function (a, b) {
      return scoreVozElevenLabs(b) - scoreVozElevenLabs(a);
    });
    return (ordenadas[0] && ordenadas[0].id) || atual || DEFAULT_ELEVENLABS_VOICE;
  }

  function preencherVozesElevenLabs(voices) {
    var list = $('#elevenlabs-voices');
    var select = $('#cfg-elevenlabs-voice-select');
    ElevenLabsVoices = Array.isArray(voices)
      ? voices.filter(function (voice) { return voice && voice.id; })
      : [];
    if (list) list.innerHTML = '';
    if (select) {
      select.innerHTML = '';
      var auto = document.createElement('option');
      auto.value = '';
      auto.textContent = ElevenLabsVoices.length ? 'Escolher automaticamente em portugues' : 'Nenhuma voz carregada ainda';
      select.appendChild(auto);
    }
    ElevenLabsVoices.forEach(function (voice) {
      if (!voice || !voice.id) return;
      var label = textoDaVozElevenLabs(voice);
      if (list) {
        var item = document.createElement('option');
        item.value = voice.id;
        item.label = label;
        list.appendChild(item);
      }
      if (select) {
        var opt = document.createElement('option');
        opt.value = voice.id;
        opt.textContent = label || voice.id;
        select.appendChild(opt);
      }
    });
    var atual = vozElevenLabsAtual();
    if (!atual || atual === DEFAULT_ELEVENLABS_VOICE) atual = escolherVozPadraoElevenLabs(ElevenLabsVoices);
    aplicarVozElevenLabs(atual);
    return atual;
  }

  function carregarVozesElevenLabs(key, quiet) {
    key = String(key || '').trim();
    var out = $('#elevenlabs-result');
    // Sem chave local, o servidor completa com a dele; so desiste se nem ele tiver.
    if (!key && State.elevenLabsServidor) return listarVozesElevenLabs('', quiet, out);
    if (key.length < 12) {
      preencherVozesElevenLabs([]);
      return Promise.resolve([]);
    }
    if (!chaveElevenLabsPareceValida(key)) {
      State.elevenLabsKeyInvalida = key;
      preencherVozesElevenLabs([]);
      return Promise.reject(new Error(mensagemChaveElevenLabsInvalida()));
    }
    if (State.elevenLabsKeyInvalida === key) State.elevenLabsKeyInvalida = '';
    return listarVozesElevenLabs(key, quiet, out);
  }

  function listarVozesElevenLabs(key, quiet, out) {
    if (!quiet && out) {
      out.className = 'test-result show';
      out.textContent = 'Carregando vozes naturais...';
    }
    return fetch('/api/speech/voices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var erro = new Error((body.error && body.error.message) || 'Nao consegui carregar suas vozes.');
          if (erroElevenLabsDeChave(erro)) {
            erro.message = mensagemChaveElevenLabsInvalida();
            State.elevenLabsKeyInvalida = key;
          }
          if (res.status === 429 || /quota|credit|billing|balance|insufficient/i.test(erro.message)) {
            registrarLimiteDaApi('elevenlabs', erro, /quota|credit|billing|balance|insufficient/i.test(erro.message) ? 'quota_exhausted' : 'rate_limit');
          }
          throw erro;
        }
        var voz = preencherVozesElevenLabs(body.voices);
        if (State.user && State.config && voz && (!State.config.elevenLabsVoiceId || State.config.elevenLabsVoiceId === DEFAULT_ELEVENLABS_VOICE)) {
          State.config = Store.Config.set(State.user.id, { elevenLabsVoiceId: voz });
          aplicarVozElevenLabs(voz);
        }
        if (!quiet && out) {
          out.className = 'test-result show ok';
          out.textContent = 'Vozes carregadas. Voz selecionada: ' + (nomeDaVozElevenLabs(voz) || voz) + '.';
        }
        limparAvisoDeLimiteApi('elevenlabs');
        return body.voices || [];
      });
    });
  }

  function reconectarAgenteParaVozNatural() {
    if (!State.agente.ligado) return;
    if (agenteNavegadorAtivo()) {
      encerrarVozDoNavegador();
      atualizarAgenteUI('conectando', 'trocando para voz natural');
      setTimeout(function () { if (State.agente.ligado) conectarVoz(false); }, 320);
      return;
    }
    if (Voz.ligado()) {
      State.agente.parandoDeProposito = true;
      Voz.encerrar();
      atualizarAgenteUI('conectando', 'trocando para voz natural');
      setTimeout(function () { if (State.agente.ligado) conectarVoz(false); }, 420);
    }
  }

  function testarVozNaturalElevenLabs() {
    var key = chaveElevenLabsAtual();
    var out = $('#elevenlabs-result');
    var btn = $('#btn-test-elevenlabs-voice');
    var voiceId = vozElevenLabsAtual();
    if (!voiceId || voiceId === DEFAULT_ELEVENLABS_VOICE) {
      voiceId = escolherVozPadraoElevenLabs(ElevenLabsVoices);
      aplicarVozElevenLabs(voiceId);
    }
    if (key.length < 12) {
      if (out) {
        out.className = 'test-result show bad';
        out.textContent = 'Cole e salve uma chave da ElevenLabs antes de testar.';
      }
      return;
    }
    if (!chaveElevenLabsPareceValida(key)) {
      State.elevenLabsKeyInvalida = key;
      if (out) {
        out.className = 'test-result show bad';
        out.textContent = mensagemChaveElevenLabsInvalida();
      }
      return;
    }
    if (!voiceId) {
      if (out) {
        out.className = 'test-result show bad';
        out.textContent = 'Escolha uma voz natural antes de testar.';
      }
      return;
    }
    if (State.testeVozAudio) {
      try { State.testeVozAudio.pause(); } catch (_) {}
      State.testeVozAudio = null;
    }
    if (btn) btn.disabled = true;
    if (out) {
      out.className = 'test-result show';
      out.textContent = 'Gerando teste com voz natural...';
    }
    fetch('/api/speech/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: key,
        text: 'Oi. Agora estou usando uma voz natural para conversar com voce em tempo real.',
        voiceId: voiceId,
        modelId: ($('#cfg-elevenlabs-model') && $('#cfg-elevenlabs-model').value) || 'eleven_multilingual_v2',
        voiceSettings: parametrosElevenLabs()
      })
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (body) {
        var erro = new Error((body.error && body.error.message) || 'Nao consegui gerar o teste de voz.');
        if (erroElevenLabsDeChave(erro)) {
          erro.message = mensagemChaveElevenLabsInvalida();
          State.elevenLabsKeyInvalida = key;
        }
        if (res.status === 429 || /quota|credit|billing|balance|insufficient/i.test(erro.message)) {
          registrarLimiteDaApi('elevenlabs', erro, /quota|credit|billing|balance|insufficient/i.test(erro.message) ? 'quota_exhausted' : 'rate_limit');
        }
        throw erro;
      });
      return res.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      State.testeVozAudio = audio;
      audio.onended = function () {
        URL.revokeObjectURL(url);
        if (State.testeVozAudio === audio) State.testeVozAudio = null;
      };
      audio.onerror = function () {
        URL.revokeObjectURL(url);
        if (State.testeVozAudio === audio) State.testeVozAudio = null;
      };
      return audio.play().then(function () {
        limparAvisoDeLimiteApi('elevenlabs');
        if (out) {
          out.className = 'test-result show ok';
          out.textContent = 'Teste tocando com voz natural: ' + (nomeDaVozElevenLabs(voiceId) || voiceId) + '.';
        }
      });
    }).catch(function (erro) {
      if (out) {
        out.className = 'test-result show bad';
        out.textContent = (erro && erro.message) || 'Nao consegui tocar a voz natural.';
      }
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function checkKey(quiet) {
    if (!State.apiKey) { setKeyStatus('none'); return Promise.resolve(false); }
    var out = $('#key-result');
    if (!quiet) {
      out.className = 'test-result show';
      out.textContent = 'Testando conexão…';
    }
    return Claude.test(State.apiKey, State.config.provider).then(function () {
      setKeyStatus('ok');
      limparAvisoDeLimiteApi(State.config.provider);
      if (!quiet) { out.className = 'test-result show ok'; out.textContent = '✓ Chave válida e conectada.'; }
      return true;
    }).catch(function (err) {
      setKeyStatus(err.kind === 'auth' || err.kind === 'permission' ? 'bad' : 'unknown');
      if (err.kind === 'rate_limit' || err.kind === 'quota_exhausted') {
        registrarLimiteDaApi(State.config.provider, err, err.kind);
      }
      if (!quiet) { out.className = 'test-result show bad'; out.textContent = '✕ ' + err.message; }
      else if (err.kind === 'auth') toast('Sua chave da API parece inválida.', 'bad');
      return false;
    });
  }

  function bindSettings() {
    $('#cfg-provider').addEventListener('change', function (e) {
      var provider = e.target.value;
      var models = Claude.modelsFor(provider);
      State.config = Store.Config.set(State.user.id, {
        provider: provider,
        model: models[0].id,
        agenteAtivo: State.config.agenteAtivo
      });
      if (Voz.ativo() || State.agente.ligado) desligarAgente(true);
      fillModelSelects();
      applyConfigToForm();
      loadProviderKey();
      toast('Provedor alterado para ' + providerLabel(provider) + '.');
    });

    $('#cfg-maxtokens').addEventListener('input', function (e) {
      $('#cfg-maxtokens-label').textContent = nf(e.target.value);
    });
    $('#cfg-model').addEventListener('change', function (e) {
      State.config.model = e.target.value;
      $('#model-quick').value = e.target.value;
      updateModelHint();
    });

    $('#btn-save-key').addEventListener('click', function () {
      var key = $('#api-key').value.trim();
      var out = $('#key-result');
      if (!key) {
        out.className = 'test-result show bad';
        out.textContent = 'Cole uma chave antes de salvar.';
        return;
      }
      var detectedProvider = /^sk-ant-/.test(key) ? 'anthropic' : 'openai';
      if (detectedProvider !== State.config.provider) {
        var detectedModels = Claude.modelsFor(detectedProvider);
        State.config = Store.Config.set(State.user.id, { provider: detectedProvider, model: detectedModels[0].id });
        fillModelSelects();
        applyConfigToForm();
      }
      var expected = State.config.provider === 'anthropic' ? 'sk-ant-' : 'sk-';
      if (key.indexOf(expected) !== 0) {
        out.className = 'test-result show bad';
        out.textContent = 'A chave da ' + providerLabel(State.config.provider) + ' deve começar com "' + expected + '".';
        return;
      }
      var btn = $('#btn-save-key');
      btn.disabled = true;
      Store.ApiKey.save(State.user.id, State.config.provider, key).then(function () {
        State.apiKey = key;
        return checkKey();
      }).then(function (ok) {
        if (ok) {
          toast('Chave salva e validada.', 'ok');
          talvezLigarAgenteSozinho();   // com chave na mão, ele já entra
        }
        btn.disabled = false;
      }).catch(function (err) {
        // Sem isto, uma falha ao gravar deixava o botão desligado para sempre
        // e nenhuma explicação na tela.
        out.className = 'test-result show bad';
        out.textContent = 'Não deu para guardar a chave: ' + ((err && err.message) || 'erro desconhecido');
        btn.disabled = false;
      });
    });

    $('#btn-clear-key').addEventListener('click', function () {
      if (!confirm('Remover a chave salva deste dispositivo?')) return;
      Store.ApiKey.clear(State.user.id, State.config.provider);
      State.apiKey = '';
      $('#api-key').value = '';
      $('#key-result').className = 'test-result';
      setKeyStatus('none');
      toast('Chave removida.');
    });

    $('#btn-save-elevenlabs-key').addEventListener('click', function () {
      var key = $('#elevenlabs-key').value.trim();
      var out = $('#elevenlabs-result');
      var btn = $('#btn-save-elevenlabs-key');
      if (key.length < 12) {
        out.className = 'test-result show bad';
        out.textContent = 'Cole uma chave valida da ElevenLabs.';
        return;
      }
      if (!chaveElevenLabsPareceValida(key)) {
        State.elevenLabsKeyInvalida = key;
        out.className = 'test-result show bad';
        out.textContent = mensagemChaveElevenLabsInvalida();
        return;
      }
      if (State.elevenLabsKeyInvalida === key) State.elevenLabsKeyInvalida = '';
      btn.disabled = true;
      out.className = 'test-result show';
      out.textContent = 'Validando a chave de voz...';
      carregarVozesElevenLabs(key, false).then(function (voices) {
        var voiceId = vozElevenLabsAtual();
        if (!voiceId || voiceId === DEFAULT_ELEVENLABS_VOICE) {
          voiceId = escolherVozPadraoElevenLabs(voices);
          aplicarVozElevenLabs(voiceId);
        }
        return Store.ApiKey.save(State.user.id, 'elevenlabs', key).then(function () {
          return voiceId;
        });
      }).then(function (voiceId) {
        State.elevenLabsKey = key;
        limparAvisoDeLimiteApi('elevenlabs');
        var modelagem = modelagemElevenLabsAtual();
        State.config = Store.Config.set(State.user.id, {
          elevenLabsVoiceId: voiceId || DEFAULT_ELEVENLABS_VOICE,
          elevenLabsModel: $('#cfg-elevenlabs-model').value || 'eleven_multilingual_v2',
          elevenLabsStability: modelagem.stability,
          elevenLabsSimilarity: modelagem.similarity,
          elevenLabsStyle: modelagem.style,
          elevenLabsSpeed: modelagem.speed,
          elevenLabsSpeakerBoost: modelagem.speakerBoost
        });
        aplicarVozElevenLabs(State.config.elevenLabsVoiceId);
        renderElevenLabsKeyUI();
        out.className = 'test-result show ok';
        out.textContent = 'Chave validada. Voz ativa: ' + (nomeDaVozElevenLabs(State.config.elevenLabsVoiceId) || State.config.elevenLabsVoiceId) + '.';
        reconectarAgenteParaVozNatural();
        talvezLigarAgenteSozinho();
        toast('Voz natural validada e aplicada.', 'ok');
      }).catch(function (erro) {
        out.className = 'test-result show bad';
        out.textContent = (erro && erro.message) || 'Nao consegui validar a chave de voz.';
      }).then(function () {
        btn.disabled = false;
      });
    });

    $('#btn-clear-elevenlabs-key').addEventListener('click', function () {
      Store.ApiKey.clear(State.user.id, 'elevenlabs');
      State.elevenLabsKey = '';
      ElevenLabsVoices = [];
      State.config = Store.Config.set(State.user.id, { elevenLabsVoiceId: '' });
      preencherVozesElevenLabs([]);
      aplicarVozElevenLabs('');
      renderElevenLabsKeyUI();
      toast('Chave de voz removida.');
    });

    var elevenSelect = $('#cfg-elevenlabs-voice-select');
    var elevenManual = $('#cfg-elevenlabs-voice');
    var elevenTest = $('#btn-test-elevenlabs-voice');
    var elevenRefresh = $('#btn-refresh-elevenlabs-voices');
    if (elevenSelect) {
      elevenSelect.addEventListener('change', function () {
        aplicarVozElevenLabs(elevenSelect.value || '');
      });
    }
    if (elevenManual) {
      elevenManual.addEventListener('change', function () {
        aplicarVozElevenLabs(elevenManual.value.trim());
      });
    }
    ['stability', 'similarity', 'style', 'speed'].forEach(function (nome) {
      var input = $('#cfg-elevenlabs-' + nome);
      if (!input) return;
      input.addEventListener('input', function () {
        atualizarLabelModelagemElevenLabs('cfg-elevenlabs-' + nome, input.value);
      });
    });
    if (elevenRefresh) {
      elevenRefresh.addEventListener('click', function () {
        var key = String(($('#elevenlabs-key') && $('#elevenlabs-key').value) || State.elevenLabsKey || '').trim();
        var out = $('#elevenlabs-result');
        if (key.length < 12) {
          if (out) {
            out.className = 'test-result show bad';
            out.textContent = 'Cole a chave da VoiceLab / ElevenLabs antes de atualizar as vozes.';
          }
          return;
        }
        elevenRefresh.disabled = true;
        carregarVozesElevenLabs(key, false).then(function () {
          toast('Biblioteca de vozes atualizada.', 'ok');
        }).catch(function (erro) {
          if (out) {
            out.className = 'test-result show bad';
            out.textContent = (erro && erro.message) || 'Nao consegui atualizar as vozes.';
          }
        }).then(function () {
          elevenRefresh.disabled = false;
        });
      });
    }
    if (elevenTest) elevenTest.addEventListener('click', testarVozNaturalElevenLabs);

    $('#cfg-system-custom').addEventListener('change', function (e) {
      $('#field-system').classList.toggle('hidden', !e.target.checked);
    });

    $('#btn-save-cfg').addEventListener('click', function () {
      var custom = $('#cfg-system-custom').checked;
      var modelagem = modelagemElevenLabsAtual();
      State.config = Store.Config.set(State.user.id, {
        provider: $('#cfg-provider').value,
        model: $('#cfg-model').value,
        effort: $('#cfg-effort').value,
        maxTokens: parseInt($('#cfg-maxtokens').value, 10),
        showThinking: $('#cfg-thinking').checked,
        ferramentas: $('#cfg-ferramentas').checked,
        catalogoAuto: $('#cfg-catalogo') ? $('#cfg-catalogo').checked : true,
        tetoMensalUSD: Math.max(0, parseFloat($('#cfg-teto').value) || 0),
        vozRealtime: $('#cfg-voz-realtime').value || 'marin',
        vozModelo: $('#cfg-voz-modelo').value || 'gpt-realtime-2.1',
        elevenLabsVoiceId: vozElevenLabsAtual() || DEFAULT_ELEVENLABS_VOICE,
        elevenLabsModel: $('#cfg-elevenlabs-model').value || 'eleven_multilingual_v2',
        elevenLabsStability: modelagem.stability,
        elevenLabsSimilarity: modelagem.similarity,
        elevenLabsStyle: modelagem.style,
        elevenLabsSpeed: modelagem.speed,
        elevenLabsSpeakerBoost: modelagem.speakerBoost,
        ambienteVolume: Math.max(0, Math.min(45, Number($('#cfg-ambiente-volume').value) || 0)),
        vozOciosoMin: parseInt($('#cfg-voz-ocioso').value, 10) || 0,
        agenteAtivo: $('#cfg-agente-auto').checked,
        systemMode: custom ? 'custom' : 'auto',
        system: $('#cfg-system').value.trim()
      });
      applyConfigToForm();
      if (window.Ambiente) Ambiente.definirVolume(volumeAmbiente() / 100);
      renderStatus();
      atualizarAvisoDeLimiteApi();
      toast('Preferências salvas.', 'ok');

      // Voz e modelo só mudam na próxima sessão: reconecta se já estava no ar.
      if (State.config.agenteAtivo === false) {
        if (State.agente.ligado) desligarAgente(true);
      } else if (Voz.ligado()) {
        State.agente.parandoDeProposito = true;
        Voz.encerrar();
        setTimeout(function () { if (State.agente.ligado) conectarVoz(false); }, 400);
      } else if (!State.agente.ligado) {
        ligarAgente(true);
      }
    });

    $('#btn-reset-cfg').addEventListener('click', function () {
      State.config = Store.Config.set(State.user.id, Store.DEFAULT_CONFIG);
      applyConfigToForm();
      renderStatus();
      toast('Padrões restaurados.');
    });

    $('#btn-export').addEventListener('click', function () {
      var data = {
        exportadoEm: new Date().toISOString(),
        usuario: { nome: State.user.name, email: State.user.email },
        configuracoes: State.config,
        conversas: Store.Convs.all(State.user.id)
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'kao-conversas-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('Arquivo gerado.', 'ok');
    });

    $('#btn-wipe').addEventListener('click', function () {
      if (!confirm('Apagar TODAS as conversas? Isso não tem volta.')) return;
      Store.Convs.wipe(State.user.id);
      Store.Usage.reset(State.user.id);
      State.conv = null;
      newConv(true);
      renderConvList(); renderDashboard();
      toast('Conversas apagadas.');
    });
  }

  /* ============================================================
     PÁGINA DO TDAHZEIRO
     ============================================================ */
  function avatarHTML(emoji, grad, foto, classe) {
    if (foto) {
      return '<div class="av-big ' + (classe || '') + '" style="background-image:url(' + foto +
             ');background-size:cover;background-position:center"></div>';
    }
    return '<div class="av-big ' + (classe || '') + '" style="background:' + Persona.gradienteOf(grad) + '">' +
           MD.escape(emoji) + '</div>';
  }

  function renderPersona() {
    if (!State.user) return;
    var c = State.persona, p = State.perfil;
    var a = Persona.archetypeOf(c.arquetipo);

    $('#persona-hero').innerHTML =
      '<div class="capa" style="background:' + Persona.gradienteOf(c.gradiente) + '"></div>' +
      '<div class="hero-corpo">' +
        '<div class="hero-topo">' + avatarHTML(c.emoji, c.gradiente, '') +
          '<button class="btn btn-ghost btn-sm" data-edit-persona="identidade">Editar</button>' +
        '</div>' +
        '<div><div class="hero-nome">' + MD.escape(c.nome || 'Sem nome') + '</div>' +
        '<div class="hero-sub">' + a.emoji + ' ' + MD.escape(Persona.nomeArquetipo(a, c.pronome)) +
        ' · fala com ' + MD.escape(apelido()) + '</div></div>' +
        '<div class="hero-tags">' +
          '<span class="tag forte">' + MD.escape(a.resumo) + '</span>' +
          (c.bordao ? '<span class="tag">“' + MD.escape(c.bordao) + '”</span>' : '') +
        '</div>' +
      '</div>';

    $('#persona-ficha').innerHTML = Persona.TRAITS.map(function (t) {
      return '<div class="ficha-linha"><small>' + t.emoji + ' ' + MD.escape(t.nome) + '</small>' +
             '<div class="barra"><span style="width:' + c.traits[t.id] + '%"></span></div></div>';
    }).join('');

    var voz = $('#persona-voz');
    if (!Persona.Voice.disponivel()) {
      voz.innerHTML = '<p class="muted small">Este navegador não tem síntese de voz. No Chrome ou Edge ela aparece.</p>';
    } else if (!c.voz.ativa) {
      voz.innerHTML = '<p class="muted small">Voz desligada.</p>';
    } else {
      var nomeVoz = '—';
      var achou = Persona.Voice.listar().filter(function (v) { return v.voiceURI === c.voz.uri; })[0];
      if (achou) nomeVoz = achou.name + ' (' + achou.lang + ')';
      voz.innerHTML =
        '<div class="ctx-lista">' +
          '<div class="ctx-item"><small>Voz</small><p>' + MD.escape(nomeVoz) + '</p></div>' +
          '<div class="ctx-item"><small>Velocidade e tom</small><p>' + c.voz.rate.toFixed(1) + '× · tom ' + c.voz.pitch.toFixed(1) +
            (c.voz.auto ? ' · fala sozinho a cada resposta' : '') + '</p></div>' +
        '</div>' +
        '<div class="row-btns"><button class="btn btn-ghost btn-sm" id="btn-ouvir-persona">Ouvir</button></div>';
      $('#btn-ouvir-persona').addEventListener('click', function () {
        Persona.Voice.falar('Oi ' + apelido() + ', eu sou ' + nomeP() + '. Qual é o primeiro passo?', c.voz);
      });
    }

    function bloco(rot, txt) {
      return '<div class="ctx-item"><small>' + rot + '</small><p' + (txt ? '' : ' class="ctx-vazio"') + '>' +
             MD.escape(txt || 'nada preenchido ainda') + '</p></div>';
    }
    $('#persona-contexto').innerHTML = '<div class="ctx-lista">' +
      bloco('Como te chama', apelido()) +
      bloco('Sobre você', p.bio) +
      bloco('O que te trava', p.travas.join(' · ')) +
      bloco('Seu ritmo', p.rotina) +
      bloco('Seus objetivos', p.objetivos) +
      '</div>';

    var prompt = Persona.buildPrompt(State.user, p, c);
    $('#prompt-preview').textContent = prompt;
    $('#prompt-size').textContent = nf(prompt.length) + ' caracteres';
    Icons.render($('#page-persona'));
  }

  /* ============================================================
     PERFIL
     ============================================================ */
  function renderProfile() {
    var u = State.user, p = State.perfil;
    var convs = Store.Convs.all(u.id);
    var msgs = convs.reduce(function (n, c) { return n + c.messages.length; }, 0);

    $('#perfil-social').innerHTML =
      '<div class="capa" style="background:' + Persona.gradienteOf(p.gradiente) + '"></div>' +
      '<div class="hero-corpo">' +
        '<div class="hero-topo">' + avatarHTML(p.emoji, p.gradiente, p.foto) +
          '<button class="btn btn-ghost btn-sm" data-edit-persona="voce">Editar perfil</button>' +
        '</div>' +
        '<div><div class="hero-nome">' + MD.escape(u.name) + '</div>' +
        '<div class="hero-sub">' + MD.escape(u.email) + '</div></div>' +
        (p.bio ? '<p class="hero-bio">' + MD.escape(p.bio) + '</p>' : '') +
        '<div class="hero-tags">' +
          '<span class="tag forte">' + MD.escape(apelido()) + '</span>' +
          '<span class="tag">' + nf(convs.length) + ' conversas</span>' +
          '<span class="tag">' + nf(msgs) + ' mensagens</span>' +
          '<span class="tag">desde ' + new Date(u.createdAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) + '</span>' +
        '</div>' +
        (p.travas.length ? '<div class="hero-tags">' + p.travas.map(function (t) {
          return '<span class="tag">' + MD.escape(t) + '</span>';
        }).join('') + '</div>' : '') +
      '</div>';

    var f = $('#form-profile');
    f.name.value = u.name;
    f.email.value = u.email;
    renderVoiceProfileControls();
  }

  function resetarConta() {
    if (!State.user) return;
    if (!confirm('Resetar sua conta neste navegador? Suas chaves, conversas, memoria, financas, avatar e progresso serao apagados. Seu login e senha vao continuar os mesmos.')) return;

    var uid = State.user.id;
    var btn = $('#btn-reset-account');
    if (btn) btn.disabled = true;
    if (State.running) { State.running.abort(); State.running = null; }
    desligarAgente(true);
    Persona.Voice.calar();
    if (window.Ambiente) Ambiente.pausar();

    var desconectarBanco = window.OpenFinance
      ? OpenFinance.desconectar(uid)
      : Promise.resolve();

    desconectarBanco.then(function () {
      Store.Account.reset(uid);
      State.config = Store.Config.get(uid);
      State.perfil = Store.Profile.get(uid);
      State.persona = Store.Persona.get(uid);
      State.apiKey = '';
      State.elevenLabsKey = '';
      State.keyStatus = 'none';
      State.apiAlerta = null;
      State.conv = null;

      fillModelSelects();
      applyConfigToForm();
      renderElevenLabsKeyUI();
      renderAmbienteUI();
      renderProfile();
      renderPersona();
      renderVida();
      newConv(true);
      renderConvList();
      renderDashboard();
      atualizarAvisoDeLimiteApi();
      setNav('dashboard');
      abrirCriador({ modo: 'onboarding' });
      toast('Conta reiniciada. Vamos configurar do zero.', 'ok');
    }).catch(function (erro) {
      var mensagem = (erro && erro.message) || 'Nao consegui desconectar o banco agora.';
      alert('Nada foi apagado. Primeiro preciso desconectar seu banco com seguranca. ' + mensagem);
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function bindProfile() {
    $('#form-profile').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      showError(f, '');
      Auth.updateProfile(State.user.id, { name: f.name.value, email: f.email.value })
        .then(function (user) {
          State.user = user;
          renderProfile(); renderDashboard();
          pintarAvatarTopo();
          toast('Perfil atualizado.', 'ok');
        })
        .catch(function (err) { showError(f, err.message); });
    });

    $('#form-password').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = $('button[type="submit"]', f);
      showError(f, '');
      btn.disabled = true;
      Auth.changePassword(State.user.id, f.current.value, f.next.value, f.next2.value)
        .then(function () { f.reset(); toast('Senha atualizada.', 'ok'); })
        .catch(function (err) { showError(f, err.message); })
        .then(function () { btn.disabled = false; });
    });

    $('#btn-reset-account').addEventListener('click', resetarConta);

    var micSelect = $('#cfg-mic-device');
    var micRange = $('#cfg-voz-sensibilidade');
    var micLabel = $('#cfg-voz-sensibilidade-label');
    var refresh = $('#btn-refresh-mics');
    var saveVoice = $('#btn-save-voice-profile');
    var testMic = $('#btn-test-mic');

    if (micRange && micLabel) {
      micRange.addEventListener('input', function () { micLabel.textContent = micRange.value + '%'; });
    }
    if (micSelect) {
      micSelect.addEventListener('change', function () {
        salvarMicDeviceId(micSelect.value || '');
      });
    }
    if (refresh) {
      refresh.addEventListener('click', function () {
        refresh.disabled = true;
        carregarMicrofones(true).then(function () {
          toast('Lista de microfones atualizada.', 'ok');
        }).then(function () { refresh.disabled = false; });
      });
    }
    if (saveVoice) {
      saveVoice.addEventListener('click', function () {
        salvarVoiceProfileControls();
        toast('Preferencias de voz salvas.', 'ok');
      });
    }
    if (testMic) testMic.addEventListener('click', testarMicrofonePerfil);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
