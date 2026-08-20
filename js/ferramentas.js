/* ============================================================
   Kao — ferramentas que o modelo pode chamar
   O ponto: no TDAH, o atrito de registrar é o que mata qualquer
   sistema. Aqui você só fala ("gastei 40 no ifood", "paguei a luz")
   e ele grava sozinho, na hora, sem formulário.
   ============================================================ */
(function (global) {
  'use strict';

  /** Schema JSON estrito: garante que o input venha exatamente como esperado. */
  function tool(name, description, props, required) {
    return {
      name: name,
      description: description,
      strict: true,
      input_schema: {
        type: 'object',
        properties: props,
        required: required || Object.keys(props),
        additionalProperties: false
      }
    };
  }

  var S = function (desc) { return { type: 'string', description: desc }; };
  var N = function (desc) { return { type: 'number', description: desc }; };

  var CATEGORIAS_GASTO = ['mercado', 'comida', 'transporte', 'moradia', 'saude',
                          'lazer', 'assinatura', 'impulso', 'educacao', 'outro'];
  var CATEGORIAS_FATO = ['vida', 'trabalho', 'saude', 'rotina', 'pessoas', 'gosto', 'projeto'];

  var DEFINICOES = [
    tool('lembrar_fato',
      'Guarda de forma permanente um fato sobre a pessoa. Use sempre que ela contar algo estável e útil de lembrar depois: onde mora, com quem, o que faz, o que odeia, medicação, horários, nomes de pessoas próximas. Não use para coisas passageiras nem para tarefas.',
      { texto: S('O fato, escrito em terceira pessoa e curto. Ex.: "Trabalha como dev backend na Nubank"'),
        categoria: { type: 'string', enum: CATEGORIAS_FATO, description: 'Em que gaveta guardar' } }),

    tool('criar_pendencia',
      'Anota algo que a pessoa precisa fazer. Use quando ela mencionar uma tarefa, um compromisso ou combinar algo com você. Quebre tarefas grandes em pendências pequenas e concretas.',
      { texto: S('A tarefa, concreta e pequena. Ex.: "Escrever a introdução do TCC"'),
        prazo: S('Data limite em AAAA-MM-DD, ou string vazia se não houver'),
        prioridade: { type: 'string', enum: ['baixa', 'normal', 'alta'], description: 'Urgência' } }),

    tool('concluir_pendencia',
      'Marca uma pendência como feita. Use assim que a pessoa disser que terminou algo. Sempre reconheça a conclusão na resposta — isso sustenta o próximo passo.',
      { descricao: S('Trecho do texto da pendência, para localizar qual é') }),

    tool('registrar_gasto',
      'Registra um gasto que já aconteceu. Use sempre que a pessoa mencionar ter gastado dinheiro, mesmo de passagem. Se ela demonstrar arrependimento ou disser que foi por impulso, use a categoria "impulso".',
      { valor: N('Valor em reais, só o número'),
        descricao: S('O que foi. Ex.: "iFood sushi"'),
        categoria: { type: 'string', enum: CATEGORIAS_GASTO, description: 'Categoria do gasto' } }),

    tool('registrar_receita',
      'Registra dinheiro que entrou: salário, freela, venda, presente.',
      { valor: N('Valor em reais'), descricao: S('De onde veio') }),

    tool('cadastrar_conta',
      'Cadastra uma conta a pagar, normalmente recorrente (aluguel, luz, internet, assinatura). Depois disso você passa a avisar do vencimento sozinho.',
      { nome: S('Nome da conta. Ex.: "Aluguel"'),
        valor: N('Valor em reais'),
        dia_vencimento: N('Dia do mês em que vence, de 1 a 31'),
        categoria: { type: 'string', enum: CATEGORIAS_GASTO, description: 'Categoria' },
        recorrente: { type: 'boolean', description: 'true se repete todo mês' } }),

    tool('marcar_conta_paga',
      'Marca uma conta do mês como paga. Também registra o gasto automaticamente — não chame registrar_gasto junto.',
      { nome: S('Nome (ou parte) da conta paga') }),

    tool('definir_orcamento',
      'Define a renda mensal e/ou o teto de gasto do mês. Use zero no campo que não deve mudar.',
      { renda_mensal: N('Renda mensal em reais, ou 0 para não alterar'),
        limite_mensal: N('Teto de gastos do mês em reais, ou 0 para não alterar') }),

    tool('criar_meta',
      'Cria uma meta de guardar dinheiro.',
      { nome: S('Nome da meta. Ex.: "Reserva de emergência"'),
        alvo: N('Quanto quer juntar, em reais'),
        prazo: S('Data alvo AAAA-MM-DD, ou string vazia') }),

    tool('guardar_na_meta',
      'Registra que a pessoa guardou dinheiro em uma meta.',
      { nome: S('Nome (ou parte) da meta'), valor: N('Quanto guardou, em reais') }),

    tool('consultar_financas',
      'Consulta a situação financeira completa do mês: gastos por categoria, contas em aberto, metas e saldo. Use antes de dar qualquer conselho sobre dinheiro, para falar com número na mão em vez de achismo.',
      {}, []),

    tool('anotar_diario',
      'Grava um resumo do que aconteceu hoje. Use no fim de uma conversa relevante, ou quando a pessoa contar como foi o dia. É isso que te faz lembrar amanhã do que rolou hoje.',
      { resumo: S('Resumo curto do dia, em primeira pessoa a partir da perspectiva da pessoa') })
  ];

  /* ============================================================
     EXECUÇÃO
     Cada função devolve um texto curto que volta para o modelo.
     ============================================================ */
  var EXECUTORES = {
    lembrar_fato: function (uid, i) {
      var f = Memoria.lembrar(uid, i.texto, i.categoria, 'auto');
      return f ? 'Guardado: "' + f.texto + '"' : 'Não consegui guardar (texto vazio).';
    },

    criar_pendencia: function (uid, i) {
      var p = Memoria.anotarPendencia(uid, i.texto, i.prazo, i.prioridade);
      if (!p) return 'Não consegui anotar (texto vazio).';
      var d = Memoria.diasAte(p.prazo);
      return 'Anotado: "' + p.texto + '"' + (p.prazo ? ' (prazo ' + p.prazo + (d !== null ? ', em ' + d + ' dias' : '') + ')' : '');
    },

    concluir_pendencia: function (uid, i) {
      var p = Memoria.concluirPendencia(uid, i.descricao);
      if (!p) {
        var abertas = Memoria.abertas(uid).map(function (x) { return x.texto; });
        return 'Não achei essa pendência. Abertas agora: ' + (abertas.join(' | ') || 'nenhuma');
      }
      return 'Concluída: "' + p.texto + '". Restam ' + Memoria.abertas(uid).length + ' pendências.';
    },

    registrar_gasto: function (uid, i) {
      var l = Financas.registrar(uid, { tipo: 'gasto', valor: i.valor, descricao: i.descricao, categoria: i.categoria });
      var r = Financas.resumo(uid);
      var extra = '';
      if (r.limite) {
        extra = ' Total do mês: ' + Financas.moeda(r.gastos) + ' de ' + Financas.moeda(r.limite) +
                ' (' + r.percentualDoLimite + '%).' + (r.estourou ? ' O limite estourou.' : '');
      } else {
        extra = ' Total do mês: ' + Financas.moeda(r.gastos) + '.';
      }
      return 'Gasto registrado: ' + Financas.moeda(l.valor) + ' em ' + Financas.catOf(l.categoria).nome + '.' + extra;
    },

    registrar_receita: function (uid, i) {
      var l = Financas.registrar(uid, { tipo: 'receita', valor: i.valor, descricao: i.descricao });
      return 'Entrada registrada: ' + Financas.moeda(l.valor) + ' (' + l.descricao + ').';
    },

    cadastrar_conta: function (uid, i) {
      var c = Financas.novaConta(uid, {
        nome: i.nome, valor: i.valor, diaVencimento: i.dia_vencimento,
        categoria: i.categoria, recorrente: i.recorrente
      });
      return 'Conta cadastrada: ' + c.nome + ' ' + Financas.moeda(c.valor) + ', vence dia ' + c.diaVencimento +
             (c.recorrente ? ' todo mês.' : '.');
    },

    marcar_conta_paga: function (uid, i) {
      var c = Financas.pagarConta(uid, i.nome);
      if (!c) {
        var abertas = Financas.aPagar(uid).map(function (x) { return x.nome; });
        return 'Não achei essa conta. Em aberto: ' + (abertas.join(', ') || 'nenhuma');
      }
      var r = Financas.resumo(uid);
      return c.nome + ' marcada como paga e o gasto foi registrado. Ainda faltam ' +
             r.contasAbertas + ' contas (' + Financas.moeda(r.aPagar) + ').';
    },

    definir_orcamento: function (uid, i) {
      var patch = {};
      if (i.renda_mensal > 0) patch.rendaMensal = i.renda_mensal;
      if (i.limite_mensal > 0) patch.limiteMensal = i.limite_mensal;
      if (!Object.keys(patch).length) return 'Nada mudou (os dois valores vieram zerados).';
      var f = Financas.ajustar(uid, patch);
      return 'Orçamento atualizado. Renda ' + Financas.moeda(f.rendaMensal) +
             ', teto de gastos ' + Financas.moeda(f.limiteMensal) + '.';
    },

    criar_meta: function (uid, i) {
      var m = Financas.novaMeta(uid, { nome: i.nome, alvo: i.alvo, prazo: i.prazo });
      return 'Meta criada: ' + m.nome + ', alvo ' + Financas.moeda(m.alvo) + (m.prazo ? ' até ' + m.prazo : '') + '.';
    },

    guardar_na_meta: function (uid, i) {
      var m = Financas.guardar(uid, i.nome, i.valor);
      if (!m) return 'Não achei essa meta.';
      var pct = m.alvo ? Math.round((m.guardado / m.alvo) * 100) : 0;
      return 'Guardado. ' + m.nome + ': ' + Financas.moeda(m.guardado) + ' de ' +
             Financas.moeda(m.alvo) + ' (' + pct + '%).';
    },

    consultar_financas: function (uid) {
      var r = Financas.resumo(uid);
      var venc = Financas.aPagar(uid);
      var L = [
        'Mês ' + r.mes,
        'Renda: ' + Financas.moeda(r.renda),
        'Gastos até agora: ' + Financas.moeda(r.gastos) + (r.limite ? ' (teto ' + Financas.moeda(r.limite) + ', ' + r.percentualDoLimite + '%)' : ''),
        'Outras entradas: ' + Financas.moeda(r.receitas),
        'Contas em aberto: ' + Financas.moeda(r.aPagar) + ' em ' + r.contasAbertas + ' contas',
        'Sobra estimada: ' + Financas.moeda(r.sobra)
      ];
      if (venc.length) {
        L.push('Vencimentos: ' + venc.map(function (c) {
          return c.nome + ' ' + Financas.moeda(c.valor) + ' (' +
                 (c.emDias < 0 ? 'atrasada ' + Math.abs(c.emDias) + 'd' : 'em ' + c.emDias + 'd') + ')';
        }).join('; '));
      }
      if (r.porCategoria.length) {
        L.push('Por categoria: ' + r.porCategoria.map(function (c) {
          return Financas.catOf(c.categoria).nome + ' ' + Financas.moeda(c.valor);
        }).join(', '));
      }
      if (r.metas.length) {
        L.push('Metas: ' + r.metas.map(function (m) {
          return m.nome + ' ' + Financas.moeda(m.guardado) + '/' + Financas.moeda(m.alvo);
        }).join('; '));
      }
      return L.join('\n');
    },

    anotar_diario: function (uid, i) {
      Memoria.anotarDia(uid, i.resumo);
      return 'Anotado no diário de ' + Memoria.hoje() + '.';
    }
  };

  var Ferramentas = {
    DEFINICOES: DEFINICOES,

    /** Executa uma chamada e devolve { conteudo, erro }. */
    executar: function (uid, nome, input) {
      var fn = EXECUTORES[nome];
      if (!fn) return { conteudo: 'Ferramenta desconhecida: ' + nome, erro: true };
      try {
        return { conteudo: fn(uid, input || {}), erro: false };
      } catch (e) {
        return { conteudo: 'Falhou ao executar ' + nome + ': ' + e.message, erro: true };
      }
    },

    /** Texto amigável para mostrar na interface enquanto ele usa a ferramenta. */
    rotulo: function (nome, input) {
      input = input || {};
      switch (nome) {
        case 'lembrar_fato':       return 'guardando na memória';
        case 'criar_pendencia':    return 'anotando pendência';
        case 'concluir_pendencia': return 'marcando como feito';
        case 'registrar_gasto':    return 'registrando gasto' + (input.valor ? ' de ' + Financas.moeda(input.valor) : '');
        case 'registrar_receita':  return 'registrando entrada';
        case 'cadastrar_conta':    return 'cadastrando conta';
        case 'marcar_conta_paga':  return 'baixando conta';
        case 'definir_orcamento':  return 'ajustando orçamento';
        case 'criar_meta':         return 'criando meta';
        case 'guardar_na_meta':    return 'guardando dinheiro';
        case 'consultar_financas': return 'consultando suas finanças';
        case 'anotar_diario':      return 'escrevendo no diário';
        default:                   return 'usando ' + nome;
      }
    }
  };

  global.Ferramentas = Ferramentas;
})(window);
