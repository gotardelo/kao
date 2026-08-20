/* ============================================================
   Kao — aplicação
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
    keyStatus: 'none',   // none | ok | bad | unknown
    conv: null,
    running: null,       // { abort() } enquanto o modelo responde
    page: 'dashboard'
  };

  /** Nome do personagem, com fallback enquanto ele não existe. */
  function nomeP() { return (State.persona && State.persona.nome) || 'Kao'; }
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
    bindSettings();
    bindProfile();
    Wizard.montar();
    Wizard.definirErro(function (msg) { toast(msg, 'bad'); });

    var user = Auth.current();
    if (user) { enterApp(user); } else { showAuth(); }

    setTimeout(function () { $('#splash').classList.add('gone'); }, 380);

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
    State.perfil = Store.Profile.get(user.id);
    State.persona = Store.Persona.get(user.id);
    Auth.touch();

    $('#view-auth').classList.add('hidden');
    $('#view-app').classList.remove('hidden');

    $('#topbar-avatar').textContent = initials(user.name);

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
    Store.ApiKey.load(user.id).then(function (key) {
      State.apiKey = key || '';
      renderKeyUI();
      if (State.apiKey) checkKey(true);
      else {
        setKeyStatus('none');
        if (!Store.Convs.all(user.id).length) {
          toast('Adicione sua chave da API em "Chave & Modelo" para começar.');
        }
      }
    });

    var last = Store.Convs.all(user.id)[0];
    if (last) openConv(last.id, true); else newConv(true);
  }

  /** Abre o criador de personagem e recarrega a interface ao terminar. */
  function abrirCriador(opts) {
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
    $('#page-title').textContent = page === 'persona' ? nomeP() : (TITLES[page] || 'Kao');
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
      ? 'Você tem ' + convs.length + (convs.length === 1 ? ' conversa salva' : ' conversas salvas') + ' neste dispositivo.'
      : 'Comece uma conversa — eu guardo tudo aqui no seu navegador.';

    var doMes = Store.Usage.doMes(u.id);
    $('#stat-convs').textContent = nf(convs.length);
    $('#stat-msgs').textContent = nf(msgs);
    $('#stat-tokens').textContent = nf(usage.input + usage.output);
    $('#stat-cost').textContent = money(doMes.cost);

    renderTeto();
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
          ? '<div class="aviso" style="margin-top:12px">Passou de 80% do teto. Trocar para Haiku 4.5 rende ~5× mais conversa pelo que sobra.</div>'
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

      var antes = input.value ? input.value.trim() + ' ' : '';
      var ok = Persona.Ditado.iniciar(function (texto) {
        input.value = antes + texto;
        autosize(input);
      }, function () {
        btn.classList.remove('gravando');
        input.focus();
      });
      if (ok) { btn.classList.add('gravando'); toast('Pode falar…'); }
      else toast('Seu navegador não tem ditado por voz.', 'bad');
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

    var name = msg.role === 'user' ? 'Você'
      : nomeP() + (msg.model ? ' · ' + Claude.modelOf(msg.model).name.replace('Claude ', '') : '');

    var ava = msg.role === 'user'
      ? (State.perfil.foto
          ? '<div class="msg-ava" style="background-image:url(' + State.perfil.foto + ');background-size:cover"></div>'
          : '<div class="msg-ava" style="background:' + Persona.gradienteOf(State.perfil.gradiente) + '">' +
            MD.escape(State.perfil.emoji) + '</div>')
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
        'Trocar para o Haiku 4.5 também rende cerca de 5× mais conversa pelo mesmo dinheiro.</span>' +
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
            apiMessages = apiMessages.concat([{ role: 'assistant', content: info.blocos }]);

            var resultados = info.ferramentas.map(function (t) {
              var r = Ferramentas.executar(State.user.id, t.name, t.input);
              acoes.push({ rotulo: Ferramentas.rotulo(t.name, t.input), erro: r.erro });
              return {
                type: 'tool_result',
                tool_use_id: t.id,
                content: r.conteudo,
                is_error: !!r.erro
              };
            });
            apiMessages = apiMessages.concat([{ role: 'user', content: resultados }]);

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

      var fresh = messageEl(placeholder);
      el.replaceWith(fresh);
      Icons.render(fresh);
      renderConvList();
      renderCtxInfo();
      scrollToEnd();

      // fala sozinho, se o personagem estiver configurado assim
      var voz = State.persona.voz;
      if (!info.aborted && voz.ativa && voz.auto && Persona.Voice.disponivel()) {
        var btnOuvir = $$('.msg-tool', fresh).filter(function (b) {
          return b.textContent.indexOf('Ouvir') > -1;
        })[0];
        if (btnOuvir) btnOuvir.click();
        else Persona.Voice.falar(finalText, voz);
      }

      if (info.stopReason === 'max_tokens') {
        toast('A resposta atingiu o limite de tokens. Aumente em Chave & Modelo.', 'bad');
      }
    }

    rodar();
  }

  /** Depois de uma ferramenta gravar algo, as telas precisam refletir. */
  function atualizarTudoDepoisDeFerramenta() {
    renderVida();
    renderDashboard();
  }

  function renderVida() {
    if (State.user && global_Vida()) Vida.render();
  }
  function global_Vida() { return typeof Vida !== 'undefined'; }

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
    newConv(true);
    setNav('chat');
    sendMessage(texto);
  }

  /* ============================================================
     CHAVE & MODELO
     ============================================================ */
  function fillModelSelects() {
    var a = $('#cfg-model'), b = $('#model-quick');
    a.innerHTML = ''; b.innerHTML = '';
    Claude.MODELS.forEach(function (m) {
      var o1 = document.createElement('option');
      o1.value = m.id; o1.textContent = m.name + ' — ' + m.tag;
      a.appendChild(o1);
      var o2 = document.createElement('option');
      o2.value = m.id; o2.textContent = m.name.replace('Claude ', '');
      b.appendChild(o2);
    });
  }

  function updateModelHint() {
    var m = Claude.modelOf(State.config.model);
    $('#model-hint').textContent = m.desc + ' Entrada US$ ' + m.price.in + ' / saída US$ ' + m.price.out + ' por 1M de tokens.';
  }

  function applyConfigToForm() {
    var c = State.config;
    $('#cfg-model').value = c.model;
    $('#model-quick').value = c.model;
    $('#cfg-effort').value = c.effort;
    $('#cfg-maxtokens').value = c.maxTokens;
    $('#cfg-maxtokens-label').textContent = nf(c.maxTokens);
    $('#cfg-thinking').checked = !!c.showThinking;
    $('#cfg-system').value = c.system || '';
    $('#cfg-teto').value = c.tetoMensalUSD || '';
    $('#cfg-ferramentas').checked = c.ferramentas !== false;
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
    var meta = Store.ApiKey.meta(State.user.id);
    $('#api-key').value = State.apiKey || '';
    if (!meta) setKeyStatus('none');
  }

  function checkKey(quiet) {
    if (!State.apiKey) { setKeyStatus('none'); return Promise.resolve(false); }
    var out = $('#key-result');
    if (!quiet) {
      out.className = 'test-result show';
      out.textContent = 'Testando conexão…';
    }
    return Claude.test(State.apiKey, State.config.model).then(function () {
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
      if (key.indexOf('sk-ant-') !== 0) {
        out.className = 'test-result show bad';
        out.textContent = 'A chave da Anthropic começa com "sk-ant-". Confira o que foi colado.';
        return;
      }
      var btn = $('#btn-save-key');
      btn.disabled = true;
      Store.ApiKey.save(State.user.id, key).then(function () {
        State.apiKey = key;
        return checkKey();
      }).then(function (ok) {
        if (ok) toast('Chave salva e validada.', 'ok');
        btn.disabled = false;
      });
    });

    $('#btn-clear-key').addEventListener('click', function () {
      if (!confirm('Remover a chave salva deste dispositivo?')) return;
      Store.ApiKey.clear(State.user.id);
      State.apiKey = '';
      $('#api-key').value = '';
      $('#key-result').className = 'test-result';
      setKeyStatus('none');
      toast('Chave removida.');
    });

    $('#cfg-system-custom').addEventListener('change', function (e) {
      $('#field-system').classList.toggle('hidden', !e.target.checked);
    });

    $('#btn-save-cfg').addEventListener('click', function () {
      var custom = $('#cfg-system-custom').checked;
      State.config = Store.Config.set(State.user.id, {
        model: $('#cfg-model').value,
        effort: $('#cfg-effort').value,
        maxTokens: parseInt($('#cfg-maxtokens').value, 10),
        showThinking: $('#cfg-thinking').checked,
        ferramentas: $('#cfg-ferramentas').checked,
        tetoMensalUSD: Math.max(0, parseFloat($('#cfg-teto').value) || 0),
        systemMode: custom ? 'custom' : 'auto',
        system: $('#cfg-system').value.trim()
      });
      applyConfigToForm();
      renderStatus();
      toast('Preferências salvas.', 'ok');
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
          $('#topbar-avatar').textContent = initials(user.name);
          $('#profile-avatar').textContent = initials(user.name);
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
