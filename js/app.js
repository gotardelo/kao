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
    keyStatus: 'none',   // none | ok | bad | unknown
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

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    Icons.render();
    bindAuthScreen();
    bindAppShell();
    bindChat();
    bindCopiloto();
    bindSettings();
    bindProfile();
    Wizard.montar();
    Wizard.definirErro(function (msg) { toast(msg, 'bad'); });

    var user = Auth.current();
    if (user) { enterApp(user); } else { showAuth(); }

    setTimeout(function () {
      var sp = $('#splash');
      if (sp) sp.classList.add('gone');
    }, 380);

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline é opcional */ });
    }
  }

  function showAuth() {
    $('#view-app').classList.add('hidden');
    $('#view-auth').classList.remove('hidden');
  }

  function enterApp(user, recemCriado) {
    State.user = user;
    State.config = Store.Config.get(user.id);
    if (State.config.provider !== 'anthropic') {
      State.config = Store.Config.set(user.id, { provider: 'anthropic', model: 'claude-sonnet-4-5' });
    }
    State.perfil = Store.Profile.get(user.id);
    State.persona = Store.Persona.get(user.id);
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
    renderProfile();
    renderPersona();
    renderVida();
    renderConvList();
    renderDashboard();

    // Primeiro acesso: criar o personagem antes de qualquer outra coisa.
    if (!State.perfil.onboarded) {
      abrirCriador({ modo: 'onboarding' });
    }

    // Carrega a chave e valida em segundo plano.
    Store.ApiKey.load(user.id, State.config.provider).then(function (key) {
      State.apiKey = key || '';
      renderKeyUI();
      if (State.apiKey) checkKey(true);
      else {
        setKeyStatus('none');
        if (!Store.Convs.all(user.id).length) {
          toast('Adicione sua chave da API em "Chave & Modelo" para começar.');
        }
      }
      // O agente entra junto com você: é o ponto do app.
      talvezLigarAgenteSozinho();
    });
    Store.ApiKey.load(user.id, 'elevenlabs').then(function (key) {
      State.elevenLabsKey = key || '';
      renderElevenLabsKeyUI();
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
        renderProfile();
        renderPersona();
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
    Auth.logout();
    State.user = null; State.apiKey = ''; State.conv = null;
    $('#messages').innerHTML = '';
    showAuth();
    switchTab('login');
    toast('Sessão encerrada.');
  }

  var TITLES = { dashboard: 'Painel', chat: 'Conversar', vida: 'Minha vida', persona: 'Meu TDAHzeiro', settings: 'Chave & Modelo', profile: 'Meu perfil' };

  function setNav(page) {
    State.page = page;
    $$('.page').forEach(function (p) { p.classList.toggle('is-active', p.id === 'page-' + page); });
    $$('[data-nav]').forEach(function (b) {
      if (b.classList.contains('nav-item') || b.classList.contains('tab-item')) {
        b.classList.toggle('is-active', b.dataset.nav === page);
      }
    });
    $('#page-title').textContent = page === 'persona' ? nomeP() : (TITLES[page] || 'TDAHZEI');
    $('#view-app').classList.remove('drawer-open');
    if (page === 'dashboard') renderDashboard();
    if (page === 'vida') renderVida();
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
      if (Voz.ativo()) {
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

    // 2. como usar as ferramentas
    if (State.config.ferramentas !== false) {
      partes.push(
        '# Suas ferramentas\n' +
        'Você grava e consulta coisas de verdade, sem pedir licença. Regras:\n' +
        '- Registre no momento em que a informação aparece na conversa, mesmo de passagem. ' +
        '"Ontem gastei 60 no mercado" é um registrar_gasto, não um comentário.\n' +
        '- Nunca peça para a pessoa preencher formulário nem repetir o que já disse. O atrito de registrar é o que faz sistema de TDAH morrer.\n' +
        '- Pode chamar várias ferramentas de uma vez.\n' +
        '- Depois de registrar, siga a conversa normalmente. Uma menção curta basta ("anotei"), sem relatório do que você fez.\n' +
        '- Antes de opinar sobre dinheiro, chame consultar_financas e fale com número na mão.'
      );
    }

    var estavel = partes.join('\n\n');

    // --- daqui para baixo é volátil: fica FORA do cache ---
    var vol = [];

    var mem = Memoria.resumoParaPrompt(State.user.id);
    if (mem) vol.push('# Memória\n' + mem);

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
        effort: cfg.effort,
        maxTokens: cfg.maxTokens,
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
        onText: function (_, all) { text = textoAnterior + all; paint(); },
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
          if (agenteNavegadorAtivo()) {
            State.agente.navegador.ocupado = false;
            setTimeout(iniciarEscutaDoNavegador, 400);
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

      // fala sozinho, se o personagem estiver configurado assim
      var voz = State.persona.voz;
      if (!info.aborted && voz.ativa && voz.auto && Persona.Voice.disponivel() && !agenteNavegadorAtivo()) {
        var btnOuvir = $$('.msg-tool', fresh).filter(function (b) {
          return b.textContent.indexOf('Ouvir') > -1;
        })[0];
        if (btnOuvir) btnOuvir.click();
        else Persona.Voice.falar(finalText, voz);
      }

      if (!info.aborted && agenteNavegadorAtivo()) falarDoNavegador(finalText);

      if (info.stopReason === 'max_tokens' || info.stopReason === 'length') {
        toast('A resposta atingiu o limite de tokens. Aumente em Chave & Modelo.', 'bad');
      }
    }

    rodar();
  }

  /** Depois de uma ferramenta gravar algo, as telas precisam refletir. */
  function atualizarTudoDepoisDeFerramenta() {
    renderVida();
    renderDashboard();
    pintarAvatarTopo();
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
        $('#agente-sub').textContent = 'precisa de HTTPS';
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

  function pintarBarras() {
    if (!eqBarras) {
      var caixa = $('#agente-eq');
      eqBarras = caixa ? $$('i', caixa) : [];
    }
    if (!eqBarras.length) return;

    var s = Voz.espectro(eqBarras.length);
    var btn = $('#btn-agente');

    for (var i = 0; i < eqBarras.length; i++) {
      var alvo = s.valores ? s.valores[i] : s.nivel * (0.5 + 0.5 * Math.sin(Date.now() / 260 + i));
      // sobe rápido, desce devagar: fica parecido com um VU de verdade
      eqSuave[i] = alvo > eqSuave[i] ? alvo : eqSuave[i] * 0.82 + alvo * 0.18;
      eqBarras[i].style.transform = 'scaleY(' + (0.16 + Math.min(1, eqSuave[i]) * 0.84).toFixed(3) + ')';
    }

    if (btn && Voz.ligado()) {
      var dele = s.quem === 'ele' && s.nivel > 0.06;
      btn.classList.toggle('falando', dele);
      btn.classList.toggle('on', !dele);
    }
  }

  function ligarBarras() {
    if (eqLoop) return;
    var passo = function () {
      if (!Voz.ativo()) { eqLoop = null; zerarBarras(); return; }
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
    return !!String(State.elevenLabsKey || '').trim();
  }

  function suporteAgenteNavegador() {
    if (!usarVozNatural() && !Persona.Ditado.disponivel()) {
      return { ok: false, motivo: 'Nao encontrei uma forma de ouvir neste navegador. Use Chrome ou Edge atualizado em HTTPS.' };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, motivo: 'Este navegador nao permite acesso seguro ao microfone.' };
    }
    if (!usarVozNatural() && !Persona.Voice.disponivel()) {
      return { ok: false, motivo: 'Este navegador nao tem leitura de voz.' };
    }
    return { ok: true, motivo: '' };
  }

  function falarDoNavegador(texto) {
    var session = State.agente.navegador;
    if (!session || !session.ativo) return;
    session.ouvindo = false;
    session.ultimaFalaEm = Date.now();
    atualizarAgenteUI('ligado', 'preparando resposta em voz');
    function continuar(saiuAudio) {
      if (!session.ativo) return;
      if (saiuAudio === false && !session.avisoVoz) {
        session.avisoVoz = true;
        toast('A voz do navegador nao iniciou. Verifique se a aba nao esta muda e tente ligar o agente de novo.', 'bad');
      }
      session.ocupado = false;
      session.ultimaFalaEm = Date.now();
      iniciarEscutaDoNavegador();
    }
    if (usarVozNatural()) {
      falarComElevenLabs(texto, session, continuar);
      return;
    }
    var falou = Persona.Voice.falar(texto, State.persona.voz, continuar, function (estado) {
      if (!session.ativo) return;
      if (estado === 'started') atualizarAgenteUI('ligado', 'falando');
    });
    if (!falou) continuar();
  }

  function falarComElevenLabs(texto, session, aoTerminar) {
    var controller = new AbortController();
    session.falaAbort = controller;
    fetch('/api/speech/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: State.elevenLabsKey,
        text: Persona.Voice.limpar(texto),
        voiceId: State.config.elevenLabsVoiceId
      }),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error((body.error && body.error.message) || 'A voz natural nao respondeu.');
      });
      return res.blob();
    }).then(function (audioBlob) {
      if (!session.ativo || session.falaAbort !== controller) return;
      var url = URL.createObjectURL(audioBlob);
      var audio = new Audio(url);
      session.audio = audio;
      session.audioUrl = url;
      var terminou = false;
      function finalizar(saiuAudio) {
        if (terminou) return;
        terminou = true;
        if (session.audio === audio) session.audio = null;
        if (session.audioUrl === url) session.audioUrl = null;
        URL.revokeObjectURL(url);
        if (session.falaAbort === controller) session.falaAbort = null;
        aoTerminar(saiuAudio);
      }
      audio.onplay = function () { atualizarAgenteUI('ligado', 'falando'); };
      audio.onended = function () { finalizar(true); };
      audio.onerror = function () { finalizar(false); };
      audio.play().catch(function () { finalizar(false); });
    }).catch(function (erro) {
      if (!session.ativo || (erro && erro.name === 'AbortError')) return;
      toast((erro && erro.message) || 'A voz natural nao respondeu.', 'bad');
      if (session.falaAbort === controller) session.falaAbort = null;
      aoTerminar(false);
    });
  }

  function enviarFalaDoNavegador(texto) {
    var session = State.agente.navegador;
    if (!session || !session.ativo || !texto) return;
    session.ocupado = true;
    session.ultimaFalaEm = Date.now();
    vozMensagem('user', texto);
    streamReply();
  }

  function liberarCaptura(captura) {
    if (!captura) return;
    if (captura.quadro) cancelAnimationFrame(captura.quadro);
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
    liberarCaptura(captura);
    if (session.captura === captura) session.captura = null;
  }

  function transcreverAudio(blob) {
    var dados = new FormData();
    dados.append('file', blob, 'fala.webm');
    dados.append('apiKey', State.elevenLabsKey);
    return fetch('/api/speech/transcribe', { method: 'POST', body: dados }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error((body.error && body.error.message) || 'Nao foi possivel transcrever o audio.');
        return String(body.text || '').trim();
      });
    });
  }

  function iniciarEscutaNeural() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo || session.ocupado || session.captura || Persona.Voice.falando()) return;
    session.ouvindo = false;
    atualizarAgenteUI('conectando', 'abrindo microfone natural');
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function (stream) {
      if (!session.ativo || session.mudo || session.ocupado) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      session.ouvindo = true;
      atualizarAgenteUI('ligado', 'ouvindo');
      var tipos = ['audio/webm;codecs=opus', 'audio/webm'];
      var tipo = tipos.filter(function (item) { return MediaRecorder.isTypeSupported(item); })[0];
      var recorder = tipo ? new MediaRecorder(stream, { mimeType: tipo }) : new MediaRecorder(stream);
      var contexto = new (window.AudioContext || window.webkitAudioContext)();
      var fonte = contexto.createMediaStreamSource(stream);
      var analisador = contexto.createAnalyser();
      analisador.fftSize = 1024;
      fonte.connect(analisador);
      var captura = {
        stream: stream, recorder: recorder, contexto: contexto, analisador: analisador,
        partes: [], detectouFala: false, ultimoSom: Date.now(), inicio: Date.now(),
        parando: false, enviar: false, quadro: 0
      };
      session.captura = captura;
      recorder.ondataavailable = function (evento) {
        if (evento.data && evento.data.size) captura.partes.push(evento.data);
      };
      recorder.onstop = function () {
        liberarCaptura(captura);
        if (session.captura === captura) session.captura = null;
        session.ouvindo = false;
        if (!session.ativo || session.mudo || !captura.enviar || !captura.detectouFala) {
          if (session.ativo && !session.mudo && !session.ocupado) setTimeout(iniciarEscutaDoNavegador, 250);
          return;
        }
        var audio = new Blob(captura.partes, { type: recorder.mimeType || 'audio/webm' });
        if (audio.size < 1200) {
          setTimeout(iniciarEscutaDoNavegador, 250);
          return;
        }
        session.ocupado = true;
        atualizarAgenteUI('ligado', 'entendendo voce');
        transcreverAudio(audio).then(function (texto) {
          if (!session.ativo) return;
          if (!texto) {
            session.ocupado = false;
            setTimeout(iniciarEscutaDoNavegador, 250);
            return;
          }
          enviarFalaDoNavegador(texto);
        }).catch(function (erro) {
          if (!session.ativo) return;
          session.ocupado = false;
          session.neuralIndisponivel = true;
          toast((erro && erro.message) || 'A transcricao nao respondeu. Vou usar o ditado do navegador.', 'bad');
          setTimeout(iniciarEscutaDoNavegador, 250);
        });
      };
      recorder.start(200);
      contexto.resume().catch(function () {});
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
        if (volume > 0.018) {
          captura.detectouFala = true;
          captura.ultimoSom = agora;
        }
        if ((!captura.detectouFala && agora - captura.inicio > 10000) ||
            (captura.detectouFala && agora - captura.ultimoSom > 1100) ||
            agora - captura.inicio > 30000) {
          pararCapturaNeural(session, captura.detectouFala);
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
      toast(bloqueado ? 'O microfone esta bloqueado. Libere no cadeado da barra de endereco.' : 'Nao consegui abrir o microfone. Vou tentar o ditado do navegador.', 'bad');
      setTimeout(iniciarEscutaDoNavegador, 250);
    });
  }

  function iniciarEscutaPorDitado() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo || session.ocupado || Persona.Voice.falando()) return;
    session.ouvindo = false;
    atualizarAgenteUI('conectando', 'abrindo microfone');
    var finalRecebido = false;
    var abriu = Persona.Ditado.iniciar(function (texto, jaFinalizado) {
      if (session.ativo && texto) vozParcial(texto, 'user');
      if (session.ativo && jaFinalizado && !finalRecebido) {
        finalRecebido = true;
        session.ouvindo = false;
        atualizarAgenteUI('ligado', 'entendi, pensando');
        Persona.Ditado.parar();
      }
    }, function (texto, erroMsg) {
      session.ouvindo = false;
      if (!session.ativo || session.mudo) return;
      var fala = String(texto || '').trim();
      if (fala) {
        enviarFalaDoNavegador(fala);
        return;
      }
      if (erroMsg && !/ouvi nada/i.test(erroMsg)) toast(erroMsg, 'bad');
      setTimeout(iniciarEscutaDoNavegador, 250);
    }, function (estado) {
      if (!session.ativo) return;
      if (estado === 'started') {
        session.ouvindo = true;
        atualizarAgenteUI('ligado', 'ouvindo');
      } else if (estado === 'speechstart') {
        atualizarAgenteUI('ligado', 'te ouvindo');
      }
    });
    if (!abriu) {
      session.ativo = false;
      State.agente.ligado = false;
      atualizarAgenteUI('off', 'nao consegui abrir o microfone');
      toast('Nao consegui abrir o microfone do navegador.', 'bad');
    }
  }

  function iniciarEscutaDoNavegador() {
    var session = State.agente.navegador;
    if (!session || !session.ativo || session.mudo || session.ocupado || Persona.Voice.falando()) return;
    if (usarVozNatural()) {
      iniciarEscutaNeural();
      return;
    }
    iniciarEscutaPorDitado();
  }

  function confirmarMicrofoneDoNavegador(session) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function (stream) {
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
      avisoVoz: false
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
    Persona.Ditado.parar();
    Persona.Voice.calar();
    if (session.falaAbort) session.falaAbort.abort();
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
    conectarVoz(true);
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
    else ligarAgente();
  }

  /* ---------------- vigia: ociosidade, teto e relógio ---------------- */

  function iniciarVigia() {
    pararVigia();
    State.agente.vigia = setInterval(function () {
      if (!State.agente.ligado) return;

      // teto de gasto: a voz consome rápido, então checa sempre
      var t = Store.Usage.teto(State.user.id, State.config.tetoMensalUSD);
      if (t.estourou) {
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

    if (agente) agente.addEventListener('click', alternarAgente);
    if (btn) btn.addEventListener('click', alternarAgente);
    if (mini) mini.addEventListener('click', alternarAgente);
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

  function dispararRitual(qual) {
    var texto = RITUAIS[qual];
    if (!texto) return;
    if (!State.apiKey) { toast('Configure sua chave da API primeiro.', 'bad'); setNav('settings'); return; }

    // Se ele já está na linha, o ritual vira fala em vez de abrir outra conversa.
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
    if ($('#cfg-voz-realtime')) $('#cfg-voz-realtime').value = c.vozRealtime || 'marin';
    if ($('#cfg-voz-modelo')) $('#cfg-voz-modelo').value = c.vozModelo || 'gpt-realtime-2.1';
    if ($('#cfg-elevenlabs-voice')) $('#cfg-elevenlabs-voice').value = c.elevenLabsVoiceId || 'JBFqnCBsd6RMkjVDRZzb';
    if ($('#cfg-voz-ocioso')) $('#cfg-voz-ocioso').value = String(c.vozOciosoMin || 0);
    if ($('#cfg-agente-auto')) $('#cfg-agente-auto').checked = c.agenteAtivo !== false;
    $('#cfg-system-custom').checked = c.systemMode === 'custom';
    $('#field-system').classList.toggle('hidden', c.systemMode !== 'custom');
    updateModelHint();
    renderCtxInfo();
    atualizarMic();
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
    result.className = State.elevenLabsKey ? 'test-result show ok' : 'test-result';
    result.textContent = State.elevenLabsKey ? 'Voz natural pronta para o proximo agente.' : '';
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
      if (!quiet) { out.className = 'test-result show ok'; out.textContent = '✓ Chave válida e conectada.'; }
      return true;
    }).catch(function (err) {
      setKeyStatus(err.kind === 'auth' || err.kind === 'permission' ? 'bad' : 'unknown');
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
      if (key.length < 12) {
        out.className = 'test-result show bad';
        out.textContent = 'Cole uma chave valida da ElevenLabs.';
        return;
      }
      Store.ApiKey.save(State.user.id, 'elevenlabs', key).then(function () {
        State.elevenLabsKey = key;
        State.config = Store.Config.set(State.user.id, {
          elevenLabsVoiceId: $('#cfg-elevenlabs-voice').value.trim() || 'JBFqnCBsd6RMkjVDRZzb'
        });
        renderElevenLabsKeyUI();
        toast('Voz natural salva. Ligue o agente para testar.', 'ok');
      });
    });

    $('#btn-clear-elevenlabs-key').addEventListener('click', function () {
      Store.ApiKey.clear(State.user.id, 'elevenlabs');
      State.elevenLabsKey = '';
      renderElevenLabsKeyUI();
      toast('Chave de voz removida.');
    });

    $('#cfg-system-custom').addEventListener('change', function (e) {
      $('#field-system').classList.toggle('hidden', !e.target.checked);
    });

    $('#btn-save-cfg').addEventListener('click', function () {
      var custom = $('#cfg-system-custom').checked;
      State.config = Store.Config.set(State.user.id, {
        provider: $('#cfg-provider').value,
        model: $('#cfg-model').value,
        effort: $('#cfg-effort').value,
        maxTokens: parseInt($('#cfg-maxtokens').value, 10),
        showThinking: $('#cfg-thinking').checked,
        ferramentas: $('#cfg-ferramentas').checked,
        tetoMensalUSD: Math.max(0, parseFloat($('#cfg-teto').value) || 0),
        vozRealtime: $('#cfg-voz-realtime').value || 'marin',
        vozModelo: $('#cfg-voz-modelo').value || 'gpt-realtime-2.1',
        elevenLabsVoiceId: $('#cfg-elevenlabs-voice').value.trim() || 'JBFqnCBsd6RMkjVDRZzb',
        vozOciosoMin: parseInt($('#cfg-voz-ocioso').value, 10) || 0,
        agenteAtivo: $('#cfg-agente-auto').checked,
        systemMode: custom ? 'custom' : 'auto',
        system: $('#cfg-system').value.trim()
      });
      applyConfigToForm();
      renderStatus();
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
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
