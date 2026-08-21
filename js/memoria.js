/* ============================================================
   TDAHZEI — memória de longo prazo
   O que faz ele parar de te tratar como estranho a cada aba nova.

   Três camadas:
   - fatos:      o que é verdade sobre você (não muda toda hora)
   - pendencias: a lista viva do que ficou por fazer
   - diario:     o que aconteceu em cada dia
   ============================================================ */
(function (global) {
  'use strict';

  var CATEGORIAS = [
    { id: 'vida',       nome: 'Vida',        emoji: '🏠' },
    { id: 'trabalho',   nome: 'Trabalho',    emoji: '💼' },
    { id: 'saude',      nome: 'Saúde',       emoji: '💊' },
    { id: 'rotina',     nome: 'Rotina',      emoji: '🕐' },
    { id: 'pessoas',    nome: 'Pessoas',     emoji: '👥' },
    { id: 'gosto',      nome: 'Preferência', emoji: '⭐' },
    { id: 'projeto',    nome: 'Projeto',     emoji: '🎯' }
  ];

  var VAZIO = { fatos: [], pendencias: [], diario: [] };

  function hoje() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function diasAte(dataISO) {
    if (!dataISO) return null;
    var alvo = new Date(dataISO + 'T12:00:00');
    var agora = new Date();
    agora.setHours(12, 0, 0, 0);
    return Math.round((alvo - agora) / 86400000);
  }

  var Memoria = {
    CATEGORIAS: CATEGORIAS,
    hoje: hoje,
    diasAte: diasAte,

    tudo: function (uid) {
      var m = Store.read(Store.keys.memoria(uid), null);
      if (!m) return JSON.parse(JSON.stringify(VAZIO));
      return {
        fatos: m.fatos || [],
        pendencias: m.pendencias || [],
        diario: m.diario || []
      };
    },
    salvar: function (uid, m) { Store.write(Store.keys.memoria(uid), m); return m; },

    /* ---------- fatos ---------- */
    lembrar: function (uid, texto, categoria, fonte) {
      texto = String(texto || '').trim();
      if (!texto) return null;
      var m = Memoria.tudo(uid);
      // não duplica o que já está lá
      var norm = texto.toLowerCase();
      for (var i = 0; i < m.fatos.length; i++) {
        if (m.fatos[i].texto.toLowerCase() === norm) return m.fatos[i];
      }
      var f = {
        id: Store.uid(), texto: texto,
        categoria: categoria || 'vida',
        fonte: fonte || 'manual',
        criadoEm: Date.now()
      };
      m.fatos.push(f);
      Memoria.salvar(uid, m);
      return f;
    },
    esquecer: function (uid, id) {
      var m = Memoria.tudo(uid);
      m.fatos = m.fatos.filter(function (f) { return f.id !== id; });
      Memoria.salvar(uid, m);
    },

    /* ---------- pendências ---------- */
    anotarPendencia: function (uid, texto, prazo, prioridade) {
      texto = String(texto || '').trim();
      if (!texto) return null;
      var m = Memoria.tudo(uid);
      var norm = texto.toLowerCase();
      for (var i = 0; i < m.pendencias.length; i++) {
        if (!m.pendencias[i].feito && m.pendencias[i].texto.toLowerCase() === norm) return m.pendencias[i];
      }
      var p = {
        id: Store.uid(), texto: texto,
        prazo: prazo || '',
        prioridade: prioridade || 'normal',    // baixa | normal | alta
        feito: false,
        criadoEm: Date.now(), concluidoEm: 0
      };
      m.pendencias.push(p);
      Memoria.salvar(uid, m);
      return p;
    },
    concluirPendencia: function (uid, idOuTexto) {
      var m = Memoria.tudo(uid);
      var alvo = null;
      var busca = String(idOuTexto || '').toLowerCase();
      for (var i = 0; i < m.pendencias.length; i++) {
        var p = m.pendencias[i];
        if (p.feito) continue;
        if (p.id === idOuTexto || p.texto.toLowerCase().indexOf(busca) > -1) { alvo = p; break; }
      }
      if (!alvo) return null;
      alvo.feito = true;
      alvo.concluidoEm = Date.now();
      Memoria.salvar(uid, m);
      return alvo;
    },
    removerPendencia: function (uid, id) {
      var m = Memoria.tudo(uid);
      m.pendencias = m.pendencias.filter(function (p) { return p.id !== id; });
      Memoria.salvar(uid, m);
    },
    abertas: function (uid) {
      return Memoria.tudo(uid).pendencias.filter(function (p) { return !p.feito; });
    },
    /** Vencidas ou vencendo hoje. */
    atrasadas: function (uid) {
      return Memoria.abertas(uid).filter(function (p) {
        var d = diasAte(p.prazo);
        return d !== null && d <= 0;
      });
    },

    /* ---------- diário ---------- */
    anotarDia: function (uid, resumo, data) {
      var m = Memoria.tudo(uid);
      var dia = data || hoje();
      var achou = null;
      for (var i = 0; i < m.diario.length; i++) if (m.diario[i].data === dia) achou = m.diario[i];
      if (achou) {
        achou.resumo = achou.resumo ? achou.resumo + '\n' + resumo : resumo;
        achou.atualizadoEm = Date.now();
      } else {
        m.diario.push({ id: Store.uid(), data: dia, resumo: resumo, criadoEm: Date.now() });
      }
      m.diario.sort(function (a, b) { return b.data.localeCompare(a.data); });
      if (m.diario.length > 120) m.diario = m.diario.slice(0, 120);   // não cresce sem fim
      Memoria.salvar(uid, m);
      return true;
    },
    diaDe: function (uid, data) {
      return Memoria.tudo(uid).diario.filter(function (d) { return d.data === data; })[0] || null;
    },

    limpar: function (uid) { Store.remove(Store.keys.memoria(uid)); },

    /* ============================================================
       RESUMO PARA O PROMPT
       Vai em toda requisição, então precisa ser enxuto.
       ============================================================ */
    resumoParaPrompt: function (uid) {
      var m = Memoria.tudo(uid);
      var L = [];

      if (m.fatos.length) {
        L.push('## O que eu já sei sobre você');
        var porCat = {};
        m.fatos.forEach(function (f) {
          (porCat[f.categoria] = porCat[f.categoria] || []).push(f.texto);
        });
        CATEGORIAS.forEach(function (c) {
          if (porCat[c.id]) L.push('- ' + c.nome + ': ' + porCat[c.id].join('; '));
        });
      }

      var abertas = m.pendencias.filter(function (p) { return !p.feito; });
      if (abertas.length) {
        L.push('');
        L.push('## Pendências em aberto');
        abertas.slice(0, 25).forEach(function (p) {
          var d = diasAte(p.prazo);
          var quando = '';
          if (d !== null) {
            quando = d < 0 ? ' [ATRASADA ' + Math.abs(d) + 'd]' : d === 0 ? ' [VENCE HOJE]' :
                     d === 1 ? ' [amanhã]' : ' [em ' + d + 'd]';
          }
          L.push('- ' + p.texto + quando + (p.prioridade === 'alta' ? ' (prioridade alta)' : ''));
        });
        L.push('Traga essas pendências de volta você mesmo, na hora certa. Não espere ser perguntado.');
      }

      var concluidasHoje = m.pendencias.filter(function (p) {
        return p.feito && p.concluidoEm && new Date(p.concluidoEm).toDateString() === new Date().toDateString();
      });
      if (concluidasHoje.length) {
        L.push('');
        L.push('## Concluído hoje (reconheça isso)');
        concluidasHoje.forEach(function (p) { L.push('- ' + p.texto); });
      }

      if (m.diario.length) {
        L.push('');
        L.push('## Dias anteriores');
        m.diario.slice(0, 4).forEach(function (d) {
          L.push('- ' + d.data + ': ' + String(d.resumo).slice(0, 240));
        });
      }

      return L.join('\n');
    }
  };

  global.Memoria = Memoria;
})(window);
