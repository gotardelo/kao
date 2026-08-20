/* Open Finance via Pluggy. Credenciais ficam apenas no servidor. */
(function (global) {
  'use strict';

  var API = '/api/open-finance';
  var CDN = 'https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js';
  var padrao = { itemId: '', contas: [], saldoDisponivel: 0, faturaCartao: 0, atualizadoEm: 0, configurado: null };

  function dados(uid) { return Object.assign({}, padrao, Store.read(Store.keys.openFinance(uid), {})); }
  function salvar(uid, patch) {
    var proximo = Object.assign({}, dados(uid), patch || {});
    Store.write(Store.keys.openFinance(uid), proximo);
    return proximo;
  }
  function requisitar(caminho, body) {
    return fetch(API + caminho, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error((json.error && json.error.message) || 'Nao foi possivel falar com o Open Finance.');
        return json;
      });
    });
  }
  function carregarWidget() {
    if (global.PluggyConnect) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var existente = document.querySelector('script[data-pluggy-connect]');
      if (existente) {
        existente.addEventListener('load', resolve, { once: true });
        existente.addEventListener('error', function () { reject(new Error('Nao consegui carregar a conexao bancaria.')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = CDN; script.async = true; script.dataset.pluggyConnect = 'true';
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Nao consegui carregar a conexao bancaria.')); };
      document.head.appendChild(script);
    });
  }
  function normalizar(contas) {
    var lista = Array.isArray(contas) ? contas : [];
    var saldo = 0, fatura = 0;
    var limpas = lista.map(function (conta) {
      var tipo = String(conta.type || '');
      var valor = Number(conta.balance || 0);
      if (tipo === 'BANK' || tipo === 'PAYMENT') saldo += valor;
      if (tipo === 'CREDIT') fatura += valor;
      return {
        id: String(conta.id || ''), nome: String(conta.marketingName || conta.name || 'Conta'),
        instituicao: String(conta.institution || conta.connectorName || ''), tipo: tipo,
        subtipo: String(conta.subtype || ''), saldo: valor, moeda: String(conta.currencyCode || 'BRL'),
        final: String(conta.number || '').slice(-4)
      };
    });
    return { contas: limpas, saldoDisponivel: saldo, faturaCartao: fatura, atualizadoEm: Date.now() };
  }
  function cliente(uid) { return 'kao-' + uid; }

  var OpenFinance = {
    dados: dados,
    status: function (uid) {
      return requisitar('/status').then(function (out) { return salvar(uid, { configurado: !!out.configurado }); });
    },
    sincronizar: function (uid) {
      var atual = dados(uid);
      if (!atual.itemId) return Promise.reject(new Error('Conecte um banco antes de atualizar o saldo.'));
      return requisitar('/accounts', { itemId: atual.itemId, clientUserId: cliente(uid) }).then(function (out) {
        return salvar(uid, normalizar(out.contas));
      });
    },
    conectar: function (uid) {
      return requisitar('/connect-token', { clientUserId: cliente(uid) }).then(function (out) {
        if (!out.accessToken) throw new Error('O Open Finance ainda nao foi configurado neste app.');
        return carregarWidget().then(function () {
          return new Promise(function (resolve, reject) {
            var widget = new global.PluggyConnect({
              connectToken: out.accessToken,
              countries: ['BR'], products: ['ACCOUNTS', 'TRANSACTIONS'], language: 'pt', allowFullscreen: true,
              onSuccess: function (resultado) {
                var item = resultado && (resultado.item || resultado);
                if (!item || !item.id) { reject(new Error('O banco foi conectado, mas nao retornou uma referencia.')); return; }
                salvar(uid, { itemId: item.id, configurado: true });
                OpenFinance.sincronizar(uid).then(resolve).catch(function () { resolve(dados(uid)); });
              },
              onError: function (erro) { reject(new Error((erro && erro.message) || 'A conexao com o banco nao foi concluida.')); }
            });
            widget.init();
          });
        });
      });
    },
    desconectar: function (uid) {
      var atual = dados(uid);
      if (!atual.itemId) return Promise.resolve(salvar(uid, padrao));
      return requisitar('/disconnect', { itemId: atual.itemId, clientUserId: cliente(uid) })
        .then(function () { return salvar(uid, padrao); });
    }
  };
  global.OpenFinance = OpenFinance;
})(window);
