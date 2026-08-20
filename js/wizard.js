/* ============================================================
   TDAHZEI — criação de personagem
   Um assistente em passos, usado tanto no primeiro acesso quanto
   para editar o TDAHzeiro depois. Estilo ficha de RPG.
   ============================================================ */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return MD.escape(s == null ? '' : s); };

  var W = {
    aberto: false,
    modo: 'onboarding',
    passo: 0,
    user: null,
    perfil: null,
    persona: null,
    aoConcluir: null
  };

  /* ============================================================
     PASSOS
     ============================================================ */
  var PASSOS = [
    { id: 'boas-vindas', titulo: 'Boas-vindas',  onboardingApenas: true },
    { id: 'voce',        titulo: 'Você' },
    { id: 'tdah',        titulo: 'Seu TDAH' },
    { id: 'classe',      titulo: 'Classe' },
    { id: 'identidade',  titulo: 'Identidade' },
    { id: 'atributos',   titulo: 'Atributos' },
    { id: 'voz',         titulo: 'Voz' },
    { id: 'pronto',      titulo: 'Pronto' }
  ];

  function passosVisiveis() {
    return PASSOS.filter(function (p) { return W.modo === 'onboarding' || !p.onboardingApenas; });
  }

  /* ============================================================
     ABRIR / FECHAR
     ============================================================ */
  function abrir(opts) {
    opts = opts || {};
    W.modo = opts.modo || 'onboarding';
    W.user = opts.user;
    W.perfil = JSON.parse(JSON.stringify(Store.Profile.get(W.user.id)));
    W.persona = JSON.parse(JSON.stringify(Store.Persona.get(W.user.id)));
    W.aoConcluir = opts.aoConcluir || null;
    W.passo = 0;
    if (opts.passo) {
      var idx = passosVisiveis().map(function (p) { return p.id; }).indexOf(opts.passo);
      if (idx > -1) W.passo = idx;
    }
    if (!W.persona.nome && W.modo === 'onboarding') W.persona.nome = '';

    W.aberto = true;
    $('#view-wizard').classList.remove('hidden');
    document.body.classList.add('travado');
    render();
  }

  function fechar(salvando) {
    if (!salvando && W.modo === 'onboarding') return;    // no primeiro acesso não dá para escapar
    W.aberto = false;
    $('#view-wizard').classList.add('hidden');
    document.body.classList.remove('travado');
    Persona.Voice.calar();
  }

  function salvar() {
    Store.Profile.set(W.user.id, W.perfil);
    Store.Persona.set(W.user.id, W.persona);
  }

  function concluir() {
    W.perfil.onboarded = true;
    salvar();
    fechar(true);
    if (W.aoConcluir) W.aoConcluir(W.perfil, W.persona);
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    var passos = passosVisiveis();
    var atual = passos[W.passo];

    // trilha de progresso
    $('#wz-steps').innerHTML = passos.map(function (p, i) {
      return '<button class="wz-dot' + (i === W.passo ? ' is-active' : '') + (i < W.passo ? ' is-done' : '') +
             '" data-ir="' + i + '" title="' + esc(p.titulo) + '"><span></span><small>' + esc(p.titulo) + '</small></button>';
    }).join('');

    $('#wz-close').classList.toggle('hidden', W.modo === 'onboarding');

    var corpo = $('#wz-body');
    corpo.innerHTML = TELAS[atual.id]();
    corpo.scrollTop = 0;
    Icons.render(corpo);
    if (LIGAR[atual.id]) LIGAR[atual.id](corpo);

    // rodapé
    var ultimo = W.passo === passos.length - 1;
    $('#wz-prev').classList.toggle('hidden', W.passo === 0);
    $('#wz-next').innerHTML = ultimo
      ? Icons.svg('check', 16) + ' ' + (W.modo === 'onboarding' ? 'Começar a usar' : 'Salvar personagem')
      : 'Continuar ' + Icons.svg('send', 15);
    $('#wz-save').classList.toggle('hidden', W.modo === 'onboarding' || ultimo);
  }

  function irPara(i) {
    var passos = passosVisiveis();
    W.passo = Math.max(0, Math.min(passos.length - 1, i));
    render();
  }

  /* ---------- componentes reutilizáveis ---------- */
  function avatarPreview(emoji, gradId, foto, classe) {
    if (foto) {
      return '<div class="av-big ' + (classe || '') + '" style="background-image:url(' + foto + ');background-size:cover;background-position:center"></div>';
    }
    return '<div class="av-big ' + (classe || '') + '" style="background:' + Persona.gradienteOf(gradId) + '">' + emoji + '</div>';
  }

  function gridEmojis(lista, atual, attr) {
    return '<div class="emoji-grid">' + lista.map(function (e) {
      return '<button type="button" class="emoji-op' + (e === atual ? ' is-active' : '') +
             '" data-' + attr + '="' + e + '">' + e + '</button>';
    }).join('') + '</div>';
  }

  function gridGradientes(atual, attr) {
    return '<div class="grad-grid">' + Persona.GRADIENTES.map(function (g) {
      return '<button type="button" class="grad-op' + (g.id === atual ? ' is-active' : '') +
             '" data-' + attr + '="' + g.id + '" style="background:' + g.css + '" aria-label="' + g.id + '"></button>';
    }).join('') + '</div>';
  }

  function seletorPronome(valor, attr) {
    var ops = [{ v: 'ele', t: 'ele/dele' }, { v: 'ela', t: 'ela/dela' }, { v: 'elu', t: 'elu/delu' }];
    return '<div class="seg">' + ops.map(function (o) {
      return '<button type="button" class="seg-op' + (o.v === valor ? ' is-active' : '') +
             '" data-' + attr + '="' + o.v + '">' + o.t + '</button>';
    }).join('') + '</div>';
  }

  /* ============================================================
     TELAS
     ============================================================ */
  var TELAS = {};
  var LIGAR = {};

  /* ---------- boas-vindas ---------- */
  TELAS['boas-vindas'] = function () {
    return '' +
      '<div class="wz-hero">' +
        '<div class="logo-mark xl">T</div>' +
        '<h2>Vamos criar seu TDAHzeiro</h2>' +
        '<p class="muted">Um copiloto genérico não ajuda muito com TDAH. Um personagem <em>seu</em>, com nome, jeito e voz próprios, ajuda — porque você volta a falar com ele.</p>' +
        '<div class="wz-cards">' +
          '<div class="wz-mini"><span>1</span><b>Quem é você</b><small>para ele te conhecer de verdade</small></div>' +
          '<div class="wz-mini"><span>2</span><b>O que te trava</b><small>para antecipar em vez de reagir</small></div>' +
          '<div class="wz-mini"><span>3</span><b>Quem é ele</b><small>classe, atributos, nome e voz</small></div>' +
        '</div>' +
        '<p class="muted small">Leva uns 3 minutos. Dá para mudar tudo depois, quando quiser.</p>' +
      '</div>';
  };

  /* ---------- você ---------- */
  TELAS['voce'] = function () {
    var p = W.perfil;
    return '' +
      '<h2 class="wz-t">Quem é você</h2>' +
      '<p class="wz-s">Isso vira o contexto que ele carrega em toda conversa.</p>' +
      '<div class="wz-avatar-row">' +
        avatarPreview(p.emoji, p.gradiente, p.foto) +
        '<div class="wz-avatar-acts">' +
          '<label class="btn btn-ghost btn-sm"><input type="file" id="wz-foto" accept="image/*" hidden> Enviar foto</label>' +
          (p.foto ? '<button type="button" class="btn btn-ghost btn-sm danger" id="wz-tirar-foto">Remover foto</button>' : '') +
        '</div>' +
      '</div>' +
      (p.foto ? '' :
        '<label class="field"><span>Escolha um avatar</span></label>' +
        gridEmojis(Persona.EMOJIS_USER, p.emoji, 'uemoji') +
        '<label class="field"><span>Cor</span></label>' +
        gridGradientes(p.gradiente, 'ugrad')) +
      '<label class="field"><span>Como ele deve te chamar?</span>' +
        '<input type="text" id="wz-apelido" value="' + esc(p.apelido) + '" placeholder="' + esc(String(W.user.name).split(' ')[0]) + '" maxlength="24">' +
        '<small class="hint">Apelido, primeiro nome, o que você preferir ouvir.</small>' +
      '</label>' +
      '<label class="field"><span>Seus pronomes</span></label>' +
      seletorPronome(p.pronome, 'upron') +
      '<label class="field"><span>Bio — quem você é em duas linhas</span>' +
        '<textarea id="wz-bio" rows="3" maxlength="400" placeholder="Ex.: 28 anos, dev, moro sozinho, diagnóstico há 2 anos, tomo medicação de manhã.">' + esc(p.bio) + '</textarea>' +
      '</label>';
  };

  LIGAR['voce'] = function (root) {
    $('#wz-apelido', root).addEventListener('input', function (e) { W.perfil.apelido = e.target.value; });
    $('#wz-bio', root).addEventListener('input', function (e) { W.perfil.bio = e.target.value; });
    $$('[data-uemoji]', root).forEach(function (b) {
      b.addEventListener('click', function () { W.perfil.emoji = b.dataset.uemoji; render(); });
    });
    $$('[data-ugrad]', root).forEach(function (b) {
      b.addEventListener('click', function () { W.perfil.gradiente = b.dataset.ugrad; render(); });
    });
    $$('[data-upron]', root).forEach(function (b) {
      b.addEventListener('click', function () { W.perfil.pronome = b.dataset.upron; render(); });
    });
    var tirar = $('#wz-tirar-foto', root);
    if (tirar) tirar.addEventListener('click', function () { W.perfil.foto = ''; render(); });

    $('#wz-foto', root).addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      redimensionar(file, 220, function (dataUri) {
        if (!dataUri) return;
        W.perfil.foto = dataUri;
        render();
      });
    });
  };

  /** Reduz a imagem antes de guardar — localStorage é pequeno. */
  function redimensionar(file, lado, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = c.height = lado;
        var ctx = c.getContext('2d');
        var menor = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - menor) / 2, (img.height - menor) / 2, menor, menor, 0, 0, lado, lado);
        try { cb(c.toDataURL('image/jpeg', 0.82)); } catch (err) { cb(''); }
      };
      img.onerror = function () { cb(''); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(''); };
    reader.readAsDataURL(file);
  }

  /* ---------- TDAH ---------- */
  TELAS['tdah'] = function () {
    var p = W.perfil;
    return '' +
      '<h2 class="wz-t">O que te trava</h2>' +
      '<p class="wz-s">Marque o que mais pega. Ele vai antecipar essas coisas em vez de esperar você travar.</p>' +
      '<div class="chips-pick">' + Persona.TRAVAS.map(function (t) {
        var on = p.travas.indexOf(t) > -1;
        return '<button type="button" class="chip-pick' + (on ? ' is-active' : '') + '" data-trava="' + esc(t) + '">' +
               (on ? '✓ ' : '') + esc(t) + '</button>';
      }).join('') + '</div>' +
      '<label class="field"><span>Quando você rende melhor?</span>' +
        '<textarea id="wz-rotina" rows="2" maxlength="300" placeholder="Ex.: rendo de manhã cedo, depois do almoço sou zumbi, à noite volto a funcionar.">' + esc(p.rotina) + '</textarea>' +
      '</label>' +
      '<label class="field"><span>O que você quer alcançar?</span>' +
        '<textarea id="wz-objetivos" rows="3" maxlength="400" placeholder="Ex.: entregar o TCC, manter a casa em ordem, parar de perder prazo no trabalho, dormir antes das 2h.">' + esc(p.objetivos) + '</textarea>' +
      '</label>' +
      '<label class="field"><span>Algo de saúde que ele deva saber? <em class="opt">(opcional)</em></span>' +
        '<textarea id="wz-diag" rows="2" maxlength="300" placeholder="Ex.: TDAH combinado, uso Venvanse 50mg de manhã, também tenho ansiedade.">' + esc(p.diagnostico) + '</textarea>' +
        '<small class="hint">Fica só no seu navegador. Ele usa para não sugerir coisa que não combina com você.</small>' +
      '</label>';
  };

  LIGAR['tdah'] = function (root) {
    $$('[data-trava]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.dataset.trava;
        var i = W.perfil.travas.indexOf(t);
        if (i > -1) W.perfil.travas.splice(i, 1); else W.perfil.travas.push(t);
        render();
      });
    });
    $('#wz-rotina', root).addEventListener('input', function (e) { W.perfil.rotina = e.target.value; });
    $('#wz-objetivos', root).addEventListener('input', function (e) { W.perfil.objetivos = e.target.value; });
    $('#wz-diag', root).addEventListener('input', function (e) { W.perfil.diagnostico = e.target.value; });
  };

  /* ---------- classe ---------- */
  TELAS['classe'] = function () {
    return '' +
      '<h2 class="wz-t">Escolha a classe</h2>' +
      '<p class="wz-s">Define o comportamento base. Os atributos você ajusta no próximo passo.</p>' +
      '<div class="classes">' + Persona.ARCHETYPES.map(function (a) {
        var on = a.id === W.persona.arquetipo;
        return '<button type="button" class="classe' + (on ? ' is-active' : '') + '" data-classe="' + a.id + '">' +
          '<span class="classe-ico">' + a.emoji + '</span>' +
          '<span class="classe-txt"><b>' + esc(W.persona.pronome === 'ela' ? (a.nomeF || a.nome) : a.nome) + '</b>' +
          '<small>' + esc(a.resumo) + '</small>' +
          '<em>' + esc(a.desc) + '</em></span>' +
        '</button>';
      }).join('') + '</div>';
  };

  LIGAR['classe'] = function (root) {
    $$('[data-classe]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = Persona.archetypeOf(b.dataset.classe);
        W.persona.arquetipo = a.id;
        W.persona.traits = Object.assign({}, a.traits);   // a classe define o preset
        render();
      });
    });
  };

  /* ---------- identidade ---------- */
  TELAS['identidade'] = function () {
    var c = W.persona;
    var a = Persona.archetypeOf(c.arquetipo);
    return '' +
      '<h2 class="wz-t">Quem é ' + (c.nome ? esc(c.nome) : 'ele') + '?</h2>' +
      '<p class="wz-s">Nome, cara e pronomes do seu TDAHzeiro.</p>' +
      '<div class="wz-avatar-row">' +
        avatarPreview(c.emoji, c.gradiente, '') +
        '<div class="wz-ident">' +
          '<b>' + esc(c.nome || 'Sem nome ainda') + '</b>' +
          '<small>' + a.emoji + ' ' + esc(Persona.nomeArquetipo(a, c.pronome)) + '</small>' +
        '</div>' +
      '</div>' +
      '<label class="field"><span>Nome dele</span>' +
        '<input type="text" id="wz-nome" value="' + esc(c.nome) + '" placeholder="Nina, Rex, Bardo, Dona Marta…" maxlength="24">' +
        '<small class="hint">Um nome que você goste de chamar. Sugestões: ' +
          '<button type="button" class="link sug" data-sug="Nina">Nina</button>, ' +
          '<button type="button" class="link sug" data-sug="Rex">Rex</button>, ' +
          '<button type="button" class="link sug" data-sug="Bardo">Bardo</button>, ' +
          '<button type="button" class="link sug" data-sug="Vega">Vega</button>, ' +
          '<button type="button" class="link sug" data-sug="Zé">Zé</button>' +
        '</small>' +
      '</label>' +
      '<label class="field"><span>Pronomes dele</span></label>' +
      seletorPronome(c.pronome, 'ppron') +
      '<label class="field"><span>Avatar</span></label>' +
      gridEmojis(Persona.EMOJIS_PERSONA, c.emoji, 'pemoji') +
      '<label class="field"><span>Cor</span></label>' +
      gridGradientes(c.gradiente, 'pgrad');
  };

  LIGAR['identidade'] = function (root) {
    var nome = $('#wz-nome', root);
    nome.addEventListener('input', function (e) { W.persona.nome = e.target.value; });
    $$('.sug', root).forEach(function (b) {
      b.addEventListener('click', function () { W.persona.nome = b.dataset.sug; render(); });
    });
    $$('[data-pemoji]', root).forEach(function (b) {
      b.addEventListener('click', function () { W.persona.emoji = b.dataset.pemoji; render(); });
    });
    $$('[data-pgrad]', root).forEach(function (b) {
      b.addEventListener('click', function () { W.persona.gradiente = b.dataset.pgrad; render(); });
    });
    $$('[data-ppron]', root).forEach(function (b) {
      b.addEventListener('click', function () { W.persona.pronome = b.dataset.ppron; render(); });
    });
  };

  /* ---------- atributos ---------- */
  TELAS['atributos'] = function () {
    var c = W.persona;
    return '' +
      '<h2 class="wz-t">Atributos</h2>' +
      '<p class="wz-s">Arraste para ajustar o jeito de ' + esc(c.nome || 'ele') + '. Cada ponto muda o comportamento de verdade.</p>' +
      '<div class="traits">' + Persona.TRAITS.map(function (t) {
        var v = c.traits[t.id];
        return '<div class="trait">' +
          '<div class="trait-head"><b>' + t.emoji + ' ' + esc(t.nome) + '</b><span data-tval="' + t.id + '">' + rotuloTrait(t, v) + '</span></div>' +
          '<input type="range" min="0" max="100" step="5" value="' + v + '" data-trait="' + t.id + '">' +
          '<div class="trait-ends"><small>' + esc(t.esq) + '</small><small>' + esc(t.dir) + '</small></div>' +
        '</div>';
      }).join('') + '</div>' +
      '<label class="field"><span>Bordão <em class="opt">(opcional)</em></span>' +
        '<input type="text" id="wz-bordao" value="' + esc(c.bordao) + '" placeholder="Ex.: bora que bora! / respira, a gente resolve" maxlength="60">' +
      '</label>' +
      '<label class="field"><span>Regras extras <em class="opt">(opcional)</em></span>' +
        '<textarea id="wz-regras" rows="3" maxlength="600" placeholder="Ex.: nunca me mande meditar. Se eu disser que travei, pergunte se comi. Me chame de você, nunca de senhor.">' + esc(c.regras) + '</textarea>' +
      '</label>';
  };

  function rotuloTrait(t, v) {
    return v < 25 ? t.esq : v < 50 ? 'Mais ' + t.esq.toLowerCase() : v < 75 ? 'Mais ' + t.dir.toLowerCase() : t.dir;
  }

  /** Pinta a parte preenchida do slider (o webkit não faz sozinho). */
  function pintarSlider(sl) {
    var min = parseFloat(sl.min || 0), max = parseFloat(sl.max || 100);
    var pct = ((parseFloat(sl.value) - min) / (max - min)) * 100;
    sl.style.setProperty('--preenchido', pct + '%');
  }

  LIGAR['atributos'] = function (root) {
    $$('[data-trait]', root).forEach(function (sl) {
      pintarSlider(sl);
      sl.addEventListener('input', function () {
        var id = sl.dataset.trait;
        var v = parseInt(sl.value, 10);
        W.persona.traits[id] = v;
        pintarSlider(sl);
        var t = Persona.TRAITS.filter(function (x) { return x.id === id; })[0];
        $('[data-tval="' + id + '"]', root).textContent = rotuloTrait(t, v);
      });
    });
    $('#wz-bordao', root).addEventListener('input', function (e) { W.persona.bordao = e.target.value; });
    $('#wz-regras', root).addEventListener('input', function (e) { W.persona.regras = e.target.value; });
  };

  /* ---------- voz ---------- */
  TELAS['voz'] = function () {
    var c = W.persona;
    if (!Persona.Voice.disponivel()) {
      return '<h2 class="wz-t">Voz</h2>' +
        '<div class="aviso">Este navegador não tem síntese de voz. O resto funciona normalmente — e no Chrome ou Edge a voz aparece.</div>';
    }
    return '' +
      '<h2 class="wz-t">A voz de ' + esc(c.nome || 'seu TDAHzeiro') + '</h2>' +
      '<p class="wz-s">Vozes do seu sistema, sem custo de API. Teste até achar a que combina.</p>' +
      '<label class="check big"><input type="checkbox" id="wz-voz-ativa"' + (c.voz.ativa ? ' checked' : '') + '>' +
        '<span>Ativar voz — aparece um botão de ouvir em cada resposta</span></label>' +
      '<div id="wz-voz-cfg" class="' + (c.voz.ativa ? '' : 'desabilitado') + '">' +
        '<label class="field"><span>Voz</span><select id="wz-voz"><option>carregando…</option></select></label>' +
        '<label class="field"><span>Velocidade: <b id="wz-rate-l">' + c.voz.rate.toFixed(1) + '×</b></span>' +
          '<input type="range" id="wz-rate" min="0.6" max="1.8" step="0.1" value="' + c.voz.rate + '"></label>' +
        '<label class="field"><span>Tom: <b id="wz-pitch-l">' + c.voz.pitch.toFixed(1) + '</b></span>' +
          '<input type="range" id="wz-pitch" min="0.4" max="1.8" step="0.1" value="' + c.voz.pitch + '"></label>' +
        '<div class="row-btns">' +
          '<button type="button" class="btn btn-primary" id="wz-testar">' + Icons.svg('bolt', 16) + ' Ouvir uma frase</button>' +
          '<button type="button" class="btn btn-ghost" id="wz-calar">Parar</button>' +
        '</div>' +
        '<label class="check"><input type="checkbox" id="wz-voz-auto"' + (c.voz.auto ? ' checked' : '') + '>' +
          '<span>Falar toda resposta automaticamente</span></label>' +
      '</div>' +
      (Persona.Ditado.disponivel()
        ? '<div class="aviso ok">' + Icons.svg('bolt', 15) + ' Seu navegador também aceita ditado: no chat vai ter um botão de microfone para você falar em vez de digitar.</div>'
        : '');
  };

  LIGAR['voz'] = function (root) {
    if (!Persona.Voice.disponivel()) return;
    var c = W.persona;
    var sel = $('#wz-voz', root);

    Persona.Voice.aoCarregar(function (vozes) {
      if (!sel.isConnected) return;
      if (!vozes.length) { sel.innerHTML = '<option value="">nenhuma voz encontrada</option>'; return; }
      sel.innerHTML = vozes.map(function (v) {
        return '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === c.voz.uri ? ' selected' : '') + '>' +
               esc(v.name) + ' (' + esc(v.lang) + ')</option>';
      }).join('');
      if (!c.voz.uri && vozes[0]) c.voz.uri = vozes[0].voiceURI;   // a lista já vem com pt-BR na frente
      sel.value = c.voz.uri;
    });

    sel.addEventListener('change', function () { c.voz.uri = sel.value; frase(); });
    $$('input[type=range]', root).forEach(pintarSlider);
    $('#wz-rate', root).addEventListener('input', function (e) {
      c.voz.rate = parseFloat(e.target.value);
      $('#wz-rate-l', root).textContent = c.voz.rate.toFixed(1) + '×';
      pintarSlider(e.target);
    });
    $('#wz-pitch', root).addEventListener('input', function (e) {
      c.voz.pitch = parseFloat(e.target.value);
      $('#wz-pitch-l', root).textContent = c.voz.pitch.toFixed(1);
      pintarSlider(e.target);
    });
    $('#wz-voz-ativa', root).addEventListener('change', function (e) {
      c.voz.ativa = e.target.checked;
      $('#wz-voz-cfg', root).classList.toggle('desabilitado', !c.voz.ativa);
    });
    $('#wz-voz-auto', root).addEventListener('change', function (e) { c.voz.auto = e.target.checked; });
    $('#wz-testar', root).addEventListener('click', frase);
    $('#wz-calar', root).addEventListener('click', function () { Persona.Voice.calar(); });

    function frase() {
      var nome = c.nome || 'seu TDAHzeiro';
      var quem = W.perfil.apelido || String(W.user.name).split(' ')[0];
      Persona.Voice.falar('Oi ' + quem + ', eu sou ' + nome + '. Vamos começar pelo passo mais fácil?', c.voz);
    }
  };

  /* ---------- pronto ---------- */
  TELAS['pronto'] = function () {
    var c = W.persona, p = W.perfil;
    var a = Persona.archetypeOf(c.arquetipo);
    var prompt = Persona.buildPrompt(W.user, p, c);
    return '' +
      '<div class="wz-final">' +
        avatarPreview(c.emoji, c.gradiente, '', 'xl') +
        '<h2>' + esc(c.nome || 'Seu TDAHzeiro') + ' está pronto' + (c.pronome === 'ela' ? 'a' : '') + '</h2>' +
        '<p class="muted">' + a.emoji + ' ' + esc(Persona.nomeArquetipo(a, c.pronome)) + ' · fala com ' +
          esc(W.perfil.apelido || String(W.user.name).split(' ')[0]) + '</p>' +
        '<div class="ficha">' + Persona.TRAITS.map(function (t) {
          return '<div class="ficha-linha"><small>' + t.emoji + ' ' + esc(t.nome) + '</small>' +
                 '<div class="barra"><span style="width:' + c.traits[t.id] + '%"></span></div></div>';
        }).join('') + '</div>' +
        '<details class="think"><summary>' + Icons.svg('brain', 14) + ' Ver as instruções que ele vai receber</summary>' +
          '<div class="think-body">' + esc(prompt) + '</div></details>' +
      '</div>';
  };

  /* ============================================================
     VALIDAÇÃO POR PASSO
     ============================================================ */
  function validar() {
    var id = passosVisiveis()[W.passo].id;
    if (id === 'identidade' && !String(W.persona.nome).trim()) {
      return 'Dê um nome para ele — é o que faz virar personagem.';
    }
    return null;
  }

  /* ============================================================
     LIGAÇÃO GERAL
     ============================================================ */
  function montar() {
    $('#wz-next').addEventListener('click', function () {
      var erro = validar();
      if (erro) { W.erro(erro); return; }
      var passos = passosVisiveis();
      if (W.passo === passos.length - 1) concluir();
      else irPara(W.passo + 1);
    });
    $('#wz-prev').addEventListener('click', function () { irPara(W.passo - 1); });
    $('#wz-close').addEventListener('click', function () { fechar(); });
    $('#wz-save').addEventListener('click', function () {
      var erro = validar();
      if (erro) { W.erro(erro); return; }
      salvar();
      fechar(true);
      if (W.aoConcluir) W.aoConcluir(W.perfil, W.persona);
    });
    $('#wz-steps').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ir]');
      if (!b) return;
      var alvo = parseInt(b.dataset.ir, 10);
      if (alvo > W.passo) { var erro = validar(); if (erro) { W.erro(erro); return; } }
      irPara(alvo);
    });
  }

  W.erro = function (msg) { alert(msg); };   // trocado por toast pelo app.js

  global.Wizard = {
    abrir: abrir,
    montar: montar,
    estaAberto: function () { return W.aberto; },
    definirErro: function (fn) { W.erro = fn; }
  };
})(window);
