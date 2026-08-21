/* ============================================================
   TDAHZEI — gestão financeira
   Pensado para TDAH: o atrito de registrar é o que mata qualquer
   app de finanças. Aqui o registro acontece conversando —
   "gastei 40 no ifood" — e as ferramentas gravam sozinhas.
   ============================================================ */
(function (global) {
  'use strict';

  var CATEGORIAS_GASTO = [
    { id: 'mercado',    nome: 'Mercado',      emoji: '🛒' },
    { id: 'comida',     nome: 'Comida fora',  emoji: '🍔' },
    { id: 'transporte', nome: 'Transporte',   emoji: '🚗' },
    { id: 'moradia',    nome: 'Moradia',      emoji: '🏠' },
    { id: 'saude',      nome: 'Saúde',        emoji: '💊' },
    { id: 'lazer',      nome: 'Lazer',        emoji: '🎮' },
    { id: 'assinatura', nome: 'Assinaturas',  emoji: '🔁' },
    { id: 'impulso',    nome: 'Compra por impulso', emoji: '⚡' },
    { id: 'educacao',   nome: 'Educação',     emoji: '📚' },
    { id: 'outro',      nome: 'Outro',        emoji: '📦' }
  ];

  var VAZIO = {
    rendaMensal: 0,
    limiteMensal: 0,
    contas: [],        // recorrentes ou avulsas a pagar
    lancamentos: [],   // gastos e receitas já realizados
    metas: []
  };

  function mesAtual(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function hojeISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function moeda(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  }
  function num(v) {
    if (typeof v === 'number') return v;
    var s = String(v || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function catOf(id) {
    for (var i = 0; i < CATEGORIAS_GASTO.length; i++) if (CATEGORIAS_GASTO[i].id === id) return CATEGORIAS_GASTO[i];
    return CATEGORIAS_GASTO[CATEGORIAS_GASTO.length - 1];
  }

  var Financas = {
    CATEGORIAS: CATEGORIAS_GASTO,
    moeda: moeda, num: num, mesAtual: mesAtual, catOf: catOf, hojeISO: hojeISO,

    tudo: function (uid) {
      var f = Store.read(Store.keys.financas(uid), null);
      if (!f) return JSON.parse(JSON.stringify(VAZIO));
      return Object.assign(JSON.parse(JSON.stringify(VAZIO)), f);
    },
    salvar: function (uid, f) { Store.write(Store.keys.financas(uid), f); return f; },
    ajustar: function (uid, patch) {
      var f = Object.assign(Financas.tudo(uid), patch);
      return Financas.salvar(uid, f);
    },

    /* ---------- contas a pagar ---------- */
    novaConta: function (uid, dados) {
      var f = Financas.tudo(uid);
      var c = {
        id: Store.uid(),
        nome: String(dados.nome || 'Conta').trim(),
        valor: num(dados.valor),
        diaVencimento: Math.max(1, Math.min(31, parseInt(dados.diaVencimento, 10) || 1)),
        recorrente: dados.recorrente !== false,
        categoria: dados.categoria || 'moradia',
        pago: {}                       // { '2026-08': true }
      };
      f.contas.push(c);
      Financas.salvar(uid, f);
      return c;
    },
    pagarConta: function (uid, idOuNome, mes) {
      var f = Financas.tudo(uid);
      var busca = String(idOuNome || '').toLowerCase();
      var alvo = null;
      for (var i = 0; i < f.contas.length; i++) {
        if (f.contas[i].id === idOuNome || f.contas[i].nome.toLowerCase().indexOf(busca) > -1) { alvo = f.contas[i]; break; }
      }
      if (!alvo) return null;
      alvo.pago[mes || mesAtual()] = true;
      // pagar uma conta também registra o gasto
      f.lancamentos.push({
        id: Store.uid(), tipo: 'gasto', valor: alvo.valor,
        categoria: alvo.categoria, descricao: alvo.nome + ' (conta)',
        data: hojeISO(), criadoEm: Date.now()
      });
      Financas.salvar(uid, f);
      return alvo;
    },
    removerConta: function (uid, id) {
      var f = Financas.tudo(uid);
      f.contas = f.contas.filter(function (c) { return c.id !== id; });
      Financas.salvar(uid, f);
    },
    /** Contas ainda não pagas neste mês, com dias até o vencimento. */
    aPagar: function (uid, mes) {
      mes = mes || mesAtual();
      var hoje = new Date().getDate();
      return Financas.tudo(uid).contas
        .filter(function (c) { return !c.pago[mes]; })
        .map(function (c) {
          return Object.assign({}, c, { emDias: c.diaVencimento - hoje });
        })
        .sort(function (a, b) { return a.emDias - b.emDias; });
    },

    /* ---------- lançamentos ---------- */
    registrar: function (uid, dados) {
      var f = Financas.tudo(uid);
      var l = {
        id: Store.uid(),
        tipo: dados.tipo === 'receita' ? 'receita' : 'gasto',
        valor: Math.abs(num(dados.valor)),
        categoria: dados.categoria || 'outro',
        descricao: String(dados.descricao || '').trim(),
        data: dados.data || hojeISO(),
        criadoEm: Date.now()
      };
      f.lancamentos.push(l);
      if (f.lancamentos.length > 2000) f.lancamentos = f.lancamentos.slice(-2000);
      Financas.salvar(uid, f);
      return l;
    },
    removerLancamento: function (uid, id) {
      var f = Financas.tudo(uid);
      f.lancamentos = f.lancamentos.filter(function (l) { return l.id !== id; });
      Financas.salvar(uid, f);
    },

    /* ---------- metas ---------- */
    novaMeta: function (uid, dados) {
      var f = Financas.tudo(uid);
      var m = {
        id: Store.uid(),
        nome: String(dados.nome || 'Meta').trim(),
        alvo: num(dados.alvo),
        guardado: num(dados.guardado),
        prazo: dados.prazo || ''
      };
      f.metas.push(m);
      Financas.salvar(uid, f);
      return m;
    },
    guardar: function (uid, idOuNome, valor) {
      var f = Financas.tudo(uid);
      var busca = String(idOuNome || '').toLowerCase();
      var alvo = null;
      for (var i = 0; i < f.metas.length; i++) {
        if (f.metas[i].id === idOuNome || f.metas[i].nome.toLowerCase().indexOf(busca) > -1) { alvo = f.metas[i]; break; }
      }
      if (!alvo) return null;
      alvo.guardado += num(valor);
      Financas.salvar(uid, f);
      return alvo;
    },
    removerMeta: function (uid, id) {
      var f = Financas.tudo(uid);
      f.metas = f.metas.filter(function (m) { return m.id !== id; });
      Financas.salvar(uid, f);
    },

    /* ============================================================
       NÚMEROS DO MÊS
       ============================================================ */
    resumo: function (uid, mes) {
      mes = mes || mesAtual();
      var f = Financas.tudo(uid);
      var doMes = f.lancamentos.filter(function (l) { return String(l.data).indexOf(mes) === 0; });

      var gastos = 0, receitas = 0, porCategoria = {};
      doMes.forEach(function (l) {
        if (l.tipo === 'receita') { receitas += l.valor; return; }
        gastos += l.valor;
        porCategoria[l.categoria] = (porCategoria[l.categoria] || 0) + l.valor;
      });

      var contasAbertas = f.contas.filter(function (c) { return !c.pago[mes]; });
      var aPagarTotal = contasAbertas.reduce(function (s, c) { return s + c.valor; }, 0);

      var top = Object.keys(porCategoria).map(function (k) {
        return { categoria: k, valor: porCategoria[k] };
      }).sort(function (a, b) { return b.valor - a.valor; });

      return {
        mes: mes,
        renda: f.rendaMensal,
        limite: f.limiteMensal,
        gastos: gastos,
        receitas: receitas,
        aPagar: aPagarTotal,
        contasAbertas: contasAbertas.length,
        sobra: (f.rendaMensal || receitas) - gastos - aPagarTotal,
        porCategoria: top,
        estourou: f.limiteMensal > 0 && gastos > f.limiteMensal,
        percentualDoLimite: f.limiteMensal > 0 ? Math.round((gastos / f.limiteMensal) * 100) : 0,
        // Projeção: o que vai ter saído quando as contas em aberto forem pagas.
        // Avisar antes vale mais que constatar depois.
        projecao: gastos + aPagarTotal,
        vaiEstourar: f.limiteMensal > 0 && (gastos + aPagarTotal) > f.limiteMensal,
        metas: f.metas
      };
    },

    limpar: function (uid) { Store.remove(Store.keys.financas(uid)); },

    /* ============================================================
       RESUMO PARA O PROMPT
       ============================================================ */
    resumoParaPrompt: function (uid) {
      var f = Financas.tudo(uid);
      if (!f.contas.length && !f.lancamentos.length && !f.metas.length && !f.rendaMensal) return '';

      var r = Financas.resumo(uid);
      var L = ['## Dinheiro (mês ' + r.mes + ')'];
      var banco = global.OpenFinance ? global.OpenFinance.dados(uid) : null;

      if (banco && banco.itemId) {
        L.push('- Saldo disponivel nas contas conectadas: ' + moeda(banco.saldoDisponivel) + '.');
        if (banco.faturaCartao) L.push('- Fatura atual dos cartoes conectados: ' + moeda(banco.faturaCartao) + '.');
        if (banco.atualizadoEm) L.push('- Saldo sincronizado em: ' + new Date(banco.atualizadoEm).toLocaleString('pt-BR') + '.');
      }

      if (r.renda) L.push('- Renda mensal: ' + moeda(r.renda));
      L.push('- Já gastou este mês: ' + moeda(r.gastos) +
             (r.limite ? ' de um limite de ' + moeda(r.limite) + ' (' + r.percentualDoLimite + '%)' : ''));
      if (r.estourou) {
        L.push('  ATENÇÃO: o limite do mês já estourou. Trate isso com cuidado e sem sermão.');
      } else if (r.vaiEstourar) {
        L.push('  AVISO: com as contas ainda em aberto, vai fechar o mês em ' + moeda(r.projecao) +
               ' e estourar o teto. Avise antes que aconteça.');
      }
      if (r.receitas) L.push('- Recebeu este mês: ' + moeda(r.receitas));

      var venc = Financas.aPagar(uid);
      if (venc.length) {
        L.push('- Contas em aberto (' + moeda(r.aPagar) + '):');
        venc.slice(0, 12).forEach(function (c) {
          var quando = c.emDias < 0 ? 'ATRASADA há ' + Math.abs(c.emDias) + 'd'
                     : c.emDias === 0 ? 'VENCE HOJE'
                     : 'vence em ' + c.emDias + 'd';
          L.push('  · ' + c.nome + ' ' + moeda(c.valor) + ' — ' + quando);
        });
      }

      if (r.porCategoria.length) {
        L.push('- Onde foi o dinheiro: ' + r.porCategoria.slice(0, 5).map(function (c) {
          return catOf(c.categoria).nome + ' ' + moeda(c.valor);
        }).join(', '));
      }

      if (r.metas.length) {
        L.push('- Metas: ' + r.metas.map(function (m) {
          var pct = m.alvo ? Math.round((m.guardado / m.alvo) * 100) : 0;
          return m.nome + ' ' + moeda(m.guardado) + '/' + moeda(m.alvo) + ' (' + pct + '%)';
        }).join('; '));
      }

      L.push('Use esses números quando fizer sentido. Não vire consultor financeiro sem ser chamado, ' +
             'mas avise de conta vencendo e de gasto fora do padrão. Nunca use vergonha — culpa financeira paralisa.');
      return L.join('\n');
    }
  };

  global.Financas = Financas;
})(window);
