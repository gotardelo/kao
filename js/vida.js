/* ============================================================
   Kao — página "Minha vida"
   Mostra e edita o que a memória e as finanças guardaram. Tudo aqui
   também é gravável pela conversa; esta tela é para conferir,
   corrigir e ver o todo.
   ============================================================ */
(function (global) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return MD.escape(s == null ? '' : s); };

  var V = { aba: 'hoje', uid: null, user: null, aoMudar: null };

  function moeda(v) { return Financas.moeda(v); }

  /* ============================================================
     ABA: HOJE
     ============================================================ */
  function telaHoje() {
    var abertas = Memoria.abertas(V.uid);
    var atrasadas = Memoria.atrasadas(V.uid);
    var venc = Financas.aPagar(V.uid).filter(function (c) { return c.emDias <= 7; });
    var r = Financas.resumo(V.uid);
    var feitasHoje = Memoria.tudo(V.uid).pendencias.filter(function (p) {
      return p.feito && p.concluidoEm && new Date(p.concluidoEm).toDateString() === new Date().toDateString();
    });

    var H = [];

    H.push('<div class="stats">' +
      '<div class="stat"><span class="stat-ico v">' + Icons.svg('check', 18) + '</span>' +
        '<div><b>' + abertas.length + '</b><small>Pendências abertas</small></div></div>' +
      '<div class="stat"><span class="stat-ico o">' + Icons.svg('bolt', 18) + '</span>' +
        '<div><b>' + atrasadas.length + '</b><small>Atrasadas</small></div></div>' +
      '<div class="stat"><span class="stat-ico c">' + Icons.svg('coin', 18) + '</span>' +
        '<div><b>' + moeda(r.gastos) + '</b><small>Gasto no mês</small></div></div>' +
      '<div class="stat"><span class="stat-ico g">' + Icons.svg('check', 18) + '</span>' +
        '<div><b>' + feitasHoje.length + '</b><small>Concluído hoje</small></div></div>' +
    '</div>');

    /* o que precisa de atenção agora */
    var urgente = [];
    atrasadas.forEach(function (p) {
      var d = Memoria.diasAte(p.prazo);
      urgente.push({ tipo: 'pendencia', txt: p.texto, sub: d === 0 ? 'vence hoje' : 'atrasada ' + Math.abs(d) + ' dias', ruim: d < 0 });
    });
    venc.forEach(function (c) {
      urgente.push({
        tipo: 'conta', txt: c.nome + ' · ' + moeda(c.valor),
        sub: c.emDias < 0 ? 'atrasada ' + Math.abs(c.emDias) + ' dias' : c.emDias === 0 ? 'vence hoje' : 'vence em ' + c.emDias + ' dias',
        ruim: c.emDias <= 0
      });
    });

    H.push('<div class="card"><div class="card-head"><h4>Precisa de atenção</h4></div>');
    if (!urgente.length) {
      H.push('<p class="muted small">Nada atrasado nem vencendo. Respira.</p>');
    } else {
      H.push('<div class="lista">' + urgente.map(function (u) {
        return '<div class="linha' + (u.ruim ? ' ruim' : '') + '">' +
          '<span class="linha-ico">' + Icons.svg(u.tipo === 'conta' ? 'coin' : 'check', 15) + '</span>' +
          '<div class="linha-txt"><b>' + esc(u.txt) + '</b><small>' + esc(u.sub) + '</small></div></div>';
      }).join('') + '</div>');
    }
    H.push('</div>');

    /* rituais */
    H.push('<div class="card"><div class="card-head"><h4>Rituais</h4></div>' +
      '<p class="muted small">Atalhos para as horas que mais pegam.</p>' +
      '<div class="shortcuts">' +
        '<button class="shortcut" data-ritual="manha">' + Icons.svg('bolt', 18) +
          '<span>Bom dia</span><em>o que importa hoje</em></button>' +
        '<button class="shortcut" data-ritual="travei">' + Icons.svg('bulb', 18) +
          '<span>Travei</span><em>me tira daqui agora</em></button>' +
        '<button class="shortcut" data-ritual="noite">' + Icons.svg('check', 18) +
          '<span>Fechamento</span><em>como foi o dia</em></button>' +
        '<button class="shortcut" data-ritual="dinheiro">' + Icons.svg('coin', 18) +
          '<span>Grana</span><em>como estou este mês</em></button>' +
      '</div></div>');

    /* diário recente */
    var diario = Memoria.tudo(V.uid).diario.slice(0, 5);
    H.push('<div class="card"><div class="card-head"><h4>Diário</h4></div>');
    if (!diario.length) {
      H.push('<p class="muted small">Nada anotado ainda. Ele escreve aqui sozinho quando vocês conversam sobre o dia.</p>');
    } else {
      H.push('<div class="lista">' + diario.map(function (d) {
        return '<div class="linha"><span class="linha-data">' + esc(d.data.slice(8) + '/' + d.data.slice(5, 7)) + '</span>' +
          '<div class="linha-txt"><p>' + esc(d.resumo) + '</p></div></div>';
      }).join('') + '</div>');
    }
    H.push('</div>');

    return H.join('');
  }

  /* ============================================================
     ABA: PENDÊNCIAS
     ============================================================ */
  function telaPendencias() {
    var m = Memoria.tudo(V.uid);
    var abertas = m.pendencias.filter(function (p) { return !p.feito; });
    var feitas = m.pendencias.filter(function (p) { return p.feito; })
      .sort(function (a, b) { return b.concluidoEm - a.concluidoEm; }).slice(0, 15);

    abertas.sort(function (a, b) {
      var da = Memoria.diasAte(a.prazo), db = Memoria.diasAte(b.prazo);
      if (da === null && db === null) return b.criadoEm - a.criadoEm;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });

    var H = [];
    H.push('<div class="card"><div class="card-head"><h4>Adicionar</h4></div>' +
      '<div class="add-linha">' +
        '<input type="text" id="nova-pendencia" placeholder="O que precisa ser feito?" maxlength="160">' +
        '<input type="date" id="nova-pendencia-prazo">' +
        '<button class="btn btn-primary" id="add-pendencia">' + Icons.svg('plus', 16) + '</button>' +
      '</div></div>');

    H.push('<div class="card"><div class="card-head"><h4>Em aberto</h4><span class="badge">' + abertas.length + '</span></div>');
    if (!abertas.length) {
      H.push('<p class="muted small">Nada pendente. Aproveita.</p>');
    } else {
      H.push('<div class="lista">' + abertas.map(function (p) {
        var d = Memoria.diasAte(p.prazo);
        var quando = d === null ? '' : d < 0 ? 'atrasada ' + Math.abs(d) + 'd' : d === 0 ? 'hoje' : d === 1 ? 'amanhã' : 'em ' + d + 'd';
        return '<div class="linha' + (d !== null && d <= 0 ? ' ruim' : '') + '">' +
          '<button class="caixa" data-concluir="' + p.id + '" aria-label="Concluir"></button>' +
          '<div class="linha-txt"><b>' + esc(p.texto) + '</b>' +
            (quando ? '<small>' + esc(quando) + '</small>' : '') + '</div>' +
          (p.prioridade === 'alta' ? '<span class="tag forte">alta</span>' : '') +
          '<button class="linha-del" data-del-pendencia="' + p.id + '">' + Icons.svg('trash', 14) + '</button>' +
        '</div>';
      }).join('') + '</div>');
    }
    H.push('</div>');

    if (feitas.length) {
      H.push('<div class="card"><div class="card-head"><h4>Concluídas</h4></div><div class="lista">' +
        feitas.map(function (p) {
          return '<div class="linha feita"><span class="caixa marcada">' + Icons.svg('check', 12) + '</span>' +
            '<div class="linha-txt"><b>' + esc(p.texto) + '</b></div>' +
            '<button class="linha-del" data-del-pendencia="' + p.id + '">' + Icons.svg('trash', 14) + '</button></div>';
        }).join('') + '</div></div>');
    }
    return H.join('');
  }

  /* ============================================================
     ABA: DINHEIRO
     ============================================================ */
  function telaDinheiro() {
    var f = Financas.tudo(V.uid);
    var r = Financas.resumo(V.uid);
    var H = [];

    /* orçamento */
    var pct = Math.min(100, r.percentualDoLimite);
    H.push('<div class="card"><div class="card-head"><h4>Este mês</h4><span class="badge' +
      (r.estourou ? ' bad' : '') + '">' + (r.limite ? r.percentualDoLimite + '% do teto' : 'sem teto') + '</span></div>' +
      (r.limite ? '<div class="barra grossa"><span style="width:' + pct + '%;background:' +
        (r.estourou ? 'var(--danger)' : pct > 80 ? 'var(--warn)' : 'linear-gradient(90deg,var(--accent),var(--accent-2))') +
        '"></span></div>' : '') +
      '<div class="ctx-lista" style="margin-top:14px">' +
        '<div class="ctx-item"><small>Gastou</small><p>' + moeda(r.gastos) + (r.limite ? ' de ' + moeda(r.limite) : '') + '</p></div>' +
        '<div class="ctx-item"><small>Contas em aberto</small><p>' + moeda(r.aPagar) + ' em ' + r.contasAbertas + ' contas</p></div>' +
        '<div class="ctx-item"><small>Sobra estimada</small><p' + (r.sobra < 0 ? ' class="negativo"' : '') + '>' + moeda(r.sobra) + '</p></div>' +
      '</div>' +
      // avisar antes vale mais que constatar depois
      (r.estourou
        ? '<div class="aviso perigo" style="margin-top:12px">Você já passou do teto: ' + moeda(r.gastos) +
          ' de ' + moeda(r.limite) + '. Sem drama — dá para ajustar o resto do mês.</div>'
        : r.vaiEstourar
          ? '<div class="aviso" style="margin-top:12px">Ainda dentro do teto, <b>mas</b> com as contas em aberto o mês fecha em ' +
            moeda(r.projecao) + ' — ' + moeda(r.projecao - r.limite) + ' acima do limite.</div>'
          : '') +
      '<div class="add-linha" style="margin-top:14px">' +
        '<input type="number" id="cfg-renda" placeholder="Renda mensal" value="' + (f.rendaMensal || '') + '">' +
        '<input type="number" id="cfg-limite" placeholder="Teto de gastos" value="' + (f.limiteMensal || '') + '">' +
        '<button class="btn btn-ghost" id="salvar-orcamento">Salvar</button>' +
      '</div></div>');

    /* contas */
    var venc = Financas.aPagar(V.uid);
    H.push('<div class="card"><div class="card-head"><h4>Contas a pagar</h4></div>');
    if (!venc.length) {
      H.push('<p class="muted small">Nenhuma conta em aberto neste mês.</p>');
    } else {
      H.push('<div class="lista">' + venc.map(function (c) {
        var quando = c.emDias < 0 ? 'atrasada ' + Math.abs(c.emDias) + 'd' : c.emDias === 0 ? 'vence hoje' : 'dia ' + c.diaVencimento;
        return '<div class="linha' + (c.emDias <= 0 ? ' ruim' : '') + '">' +
          '<button class="caixa" data-pagar="' + c.id + '" aria-label="Marcar como paga"></button>' +
          '<div class="linha-txt"><b>' + esc(c.nome) + '</b><small>' + esc(quando) + '</small></div>' +
          '<span class="valor">' + moeda(c.valor) + '</span>' +
          '<button class="linha-del" data-del-conta="' + c.id + '">' + Icons.svg('trash', 14) + '</button></div>';
      }).join('') + '</div>');
    }
    H.push('<div class="add-linha" style="margin-top:12px">' +
      '<input type="text" id="conta-nome" placeholder="Nome da conta" maxlength="40">' +
      '<input type="number" id="conta-valor" placeholder="Valor">' +
      '<input type="number" id="conta-dia" placeholder="Dia" min="1" max="31">' +
      '<button class="btn btn-primary" id="add-conta">' + Icons.svg('plus', 16) + '</button></div></div>');

    /* gastos */
    H.push('<div class="card"><div class="card-head"><h4>Onde foi o dinheiro</h4></div>');
    if (!r.porCategoria.length) {
      H.push('<p class="muted small">Nenhum gasto registrado este mês. Conte para ele no chat — "gastei 40 no mercado" — que ele anota.</p>');
    } else {
      var maior = r.porCategoria[0].valor || 1;
      H.push('<div class="lista">' + r.porCategoria.map(function (c) {
        var cat = Financas.catOf(c.categoria);
        return '<div class="cat-linha"><span class="cat-nome">' + cat.emoji + ' ' + esc(cat.nome) + '</span>' +
          '<div class="barra"><span style="width:' + Math.round((c.valor / maior) * 100) + '%"></span></div>' +
          '<span class="valor">' + moeda(c.valor) + '</span></div>';
      }).join('') + '</div>');
    }
    H.push('<div class="add-linha" style="margin-top:12px">' +
      '<input type="text" id="gasto-desc" placeholder="No que gastou?" maxlength="60">' +
      '<input type="number" id="gasto-valor" placeholder="Quanto">' +
      '<select id="gasto-cat">' + Financas.CATEGORIAS.map(function (c) {
        return '<option value="' + c.id + '">' + c.emoji + ' ' + c.nome + '</option>';
      }).join('') + '</select>' +
      '<button class="btn btn-primary" id="add-gasto">' + Icons.svg('plus', 16) + '</button></div></div>');

    /* metas */
    H.push('<div class="card"><div class="card-head"><h4>Metas</h4></div>');
    if (!f.metas.length) {
      H.push('<p class="muted small">Sem metas ainda.</p>');
    } else {
      H.push('<div class="lista">' + f.metas.map(function (m) {
        var p = m.alvo ? Math.min(100, Math.round((m.guardado / m.alvo) * 100)) : 0;
        return '<div class="cat-linha"><span class="cat-nome">' + esc(m.nome) + '</span>' +
          '<div class="barra"><span style="width:' + p + '%"></span></div>' +
          '<span class="valor">' + moeda(m.guardado) + ' / ' + moeda(m.alvo) + '</span>' +
          '<button class="linha-del" data-del-meta="' + m.id + '">' + Icons.svg('trash', 14) + '</button></div>';
      }).join('') + '</div>');
    }
    H.push('<div class="add-linha" style="margin-top:12px">' +
      '<input type="text" id="meta-nome" placeholder="Nome da meta" maxlength="40">' +
      '<input type="number" id="meta-alvo" placeholder="Quanto juntar">' +
      '<button class="btn btn-primary" id="add-meta">' + Icons.svg('plus', 16) + '</button></div></div>');

    return H.join('');
  }

  /* ============================================================
     ABA: MEMÓRIA
     ============================================================ */
  function telaMemoria() {
    var m = Memoria.tudo(V.uid);
    var H = [];

    H.push('<div class="card"><div class="card-head"><h4>O que ele sabe sobre você</h4>' +
      '<span class="badge">' + m.fatos.length + ' fatos</span></div>' +
      '<p class="muted small">Ele guarda isso sozinho enquanto vocês conversam. Você pode apagar o que não quiser que fique.</p>' +
      '<div class="add-linha" style="margin-top:12px">' +
        '<input type="text" id="novo-fato" placeholder="Ex.: Trabalho de casa às terças" maxlength="200">' +
        '<select id="novo-fato-cat">' + Memoria.CATEGORIAS.map(function (c) {
          return '<option value="' + c.id + '">' + c.emoji + ' ' + c.nome + '</option>';
        }).join('') + '</select>' +
        '<button class="btn btn-primary" id="add-fato">' + Icons.svg('plus', 16) + '</button>' +
      '</div></div>');

    Memoria.CATEGORIAS.forEach(function (cat) {
      var doGrupo = m.fatos.filter(function (f) { return f.categoria === cat.id; });
      if (!doGrupo.length) return;
      H.push('<div class="card"><div class="card-head"><h4>' + cat.emoji + ' ' + cat.nome + '</h4></div><div class="lista">' +
        doGrupo.map(function (f) {
          return '<div class="linha"><div class="linha-txt"><b>' + esc(f.texto) + '</b>' +
            (f.fonte === 'auto' ? '<small>anotado na conversa</small>' : '') + '</div>' +
            '<button class="linha-del" data-del-fato="' + f.id + '">' + Icons.svg('trash', 14) + '</button></div>';
        }).join('') + '</div></div>');
    });

    if (!m.fatos.length) {
      H.push('<div class="card"><p class="muted small">Nada guardado ainda. Conte coisas sobre você no chat que ele vai anotando.</p></div>');
    }

    H.push('<div class="card"><div class="card-head"><h4>Apagar memória</h4></div>' +
      '<p class="muted small">Remove fatos, pendências e diário. O personagem e o perfil continuam.</p>' +
      '<div class="row-btns"><button class="btn btn-ghost danger" id="limpar-memoria">Apagar tudo</button></div></div>');

    return H.join('');
  }

  /* ============================================================
     RENDER + EVENTOS
     ============================================================ */
  var TELAS = { hoje: telaHoje, pendencias: telaPendencias, dinheiro: telaDinheiro, memoria: telaMemoria };

  function render() {
    if (!V.uid) return;
    var box = $('#vida-conteudo');
    if (!box) return;
    box.innerHTML = (TELAS[V.aba] || telaHoje)();
    Icons.render(box);
    $$('.sub-tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.vida === V.aba); });
    ligar(box);
  }

  function mudou() { render(); if (V.aoMudar) V.aoMudar(); }

  function ligar(box) {
    /* pendências */
    var add = $('#add-pendencia', box);
    if (add) {
      var campo = $('#nova-pendencia', box);
      var criar = function () {
        if (!campo.value.trim()) return;
        Memoria.anotarPendencia(V.uid, campo.value, $('#nova-pendencia-prazo', box).value, 'normal');
        mudou();
      };
      add.addEventListener('click', criar);
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') criar(); });
    }
    $$('[data-concluir]', box).forEach(function (b) {
      b.addEventListener('click', function () { Memoria.concluirPendencia(V.uid, b.dataset.concluir); mudou(); });
    });
    $$('[data-del-pendencia]', box).forEach(function (b) {
      b.addEventListener('click', function () { Memoria.removerPendencia(V.uid, b.dataset.delPendencia); mudou(); });
    });

    /* dinheiro */
    var salvarOrc = $('#salvar-orcamento', box);
    if (salvarOrc) {
      salvarOrc.addEventListener('click', function () {
        Financas.ajustar(V.uid, {
          rendaMensal: Financas.num($('#cfg-renda', box).value),
          limiteMensal: Financas.num($('#cfg-limite', box).value)
        });
        mudou();
      });
    }
    var addConta = $('#add-conta', box);
    if (addConta) {
      addConta.addEventListener('click', function () {
        var nome = $('#conta-nome', box).value.trim();
        if (!nome) return;
        Financas.novaConta(V.uid, {
          nome: nome, valor: $('#conta-valor', box).value,
          diaVencimento: $('#conta-dia', box).value, recorrente: true
        });
        mudou();
      });
    }
    $$('[data-pagar]', box).forEach(function (b) {
      b.addEventListener('click', function () { Financas.pagarConta(V.uid, b.dataset.pagar); mudou(); });
    });
    $$('[data-del-conta]', box).forEach(function (b) {
      b.addEventListener('click', function () { Financas.removerConta(V.uid, b.dataset.delConta); mudou(); });
    });
    var addGasto = $('#add-gasto', box);
    if (addGasto) {
      addGasto.addEventListener('click', function () {
        var v = Financas.num($('#gasto-valor', box).value);
        if (!v) return;
        Financas.registrar(V.uid, {
          tipo: 'gasto', valor: v,
          descricao: $('#gasto-desc', box).value,
          categoria: $('#gasto-cat', box).value
        });
        mudou();
      });
    }
    var addMeta = $('#add-meta', box);
    if (addMeta) {
      addMeta.addEventListener('click', function () {
        var nome = $('#meta-nome', box).value.trim();
        if (!nome) return;
        Financas.novaMeta(V.uid, { nome: nome, alvo: $('#meta-alvo', box).value });
        mudou();
      });
    }
    $$('[data-del-meta]', box).forEach(function (b) {
      b.addEventListener('click', function () { Financas.removerMeta(V.uid, b.dataset.delMeta); mudou(); });
    });

    /* memória */
    var addFato = $('#add-fato', box);
    if (addFato) {
      var cf = $('#novo-fato', box);
      var criarFato = function () {
        if (!cf.value.trim()) return;
        Memoria.lembrar(V.uid, cf.value, $('#novo-fato-cat', box).value, 'manual');
        mudou();
      };
      addFato.addEventListener('click', criarFato);
      cf.addEventListener('keydown', function (e) { if (e.key === 'Enter') criarFato(); });
    }
    $$('[data-del-fato]', box).forEach(function (b) {
      b.addEventListener('click', function () { Memoria.esquecer(V.uid, b.dataset.delFato); mudou(); });
    });
    var limpar = $('#limpar-memoria', box);
    if (limpar) {
      limpar.addEventListener('click', function () {
        if (!confirm('Apagar tudo que ele sabe sobre você? Isso não tem volta.')) return;
        Memoria.limpar(V.uid);
        mudou();
      });
    }
  }

  global.Vida = {
    iniciar: function (opts) {
      V.uid = opts.uid;
      V.user = opts.user;
      V.aoMudar = opts.aoMudar;
      $$('.sub-tab').forEach(function (t) {
        t.addEventListener('click', function () {
          V.aba = t.dataset.vida;
          render();
          // volta ao topo, senão a aba nova abre no meio do scroll da anterior
          var pagina = document.querySelector('#page-vida .page-inner');
          if (pagina) pagina.scrollTop = 0;
        });
      });
    },
    render: render,
    irPara: function (aba) { V.aba = aba; render(); }
  };
})(window);
