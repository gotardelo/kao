/* Testa Store.ApiKey com localStorage, IndexedDB e cofre do servidor falsos.
   Foco: a chave da API nao pode sumir. Ela vive cifrada aqui e em claro no
   cofre do servidor; se a cifra local deixar de abrir — aparelho que perdeu a
   chave AES, navegador que limpou parte do armazenamento — o cofre tem que
   assumir, em vez de o app se comportar como quem nunca teve chave. */
const fs = require('fs');
const vm = require('vm');
const { webcrypto } = require('node:crypto');

const falhas = [];
function ok(nome, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + nome + (cond ? '' : '  << ' + (extra || '')));
  if (!cond) falhas.push(nome);
}

/* ---------- fakes ---------- */
function fakeLocalStorage() {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: (k) => { dados.delete(k); },
    get length() { return dados.size; },
    key: (i) => Array.from(dados.keys())[i] ?? null,
    _dados: dados
  };
}

/** IndexedDB o bastante para guardar a CryptoKey do aparelho. */
function fakeIndexedDB(cofre) {
  function pedido(exec) {
    const req = {};
    setTimeout(() => {
      try { req.result = exec(); if (req.onsuccess) req.onsuccess(); }
      catch (e) { req.error = e; if (req.onerror) req.onerror(); }
    }, 0);
    return req;
  }
  return {
    open() {
      const req = {};
      setTimeout(() => {
        req.result = {
          transaction: () => ({
            objectStore: () => ({
              get: (k) => pedido(() => cofre.get(k)),
              put: (v, k) => pedido(() => { cofre.set(k, v); return k; })
            })
          })
        };
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    }
  };
}

function montarMundo(opcoes) {
  opcoes = opcoes || {};
  const cofreServidor = opcoes.cofreServidor || new Map();
  const idb = opcoes.idb || new Map();
  const chamadas = [];

  const win = {
    localStorage: opcoes.localStorage || fakeLocalStorage(),
    indexedDB: fakeIndexedDB(idb),
    crypto: webcrypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TextEncoder, TextDecoder, Promise, JSON, Date, Math, Object, Array, String, Number,
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch(url, init) {
      const body = JSON.parse(init.body);
      chamadas.push(body.action);
      let out = { ok: true };
      if (body.action === 'vaultSave') cofreServidor.set(body.provider, body.value);
      if (body.action === 'vaultLoad') out = { ok: true, value: cofreServidor.get(body.provider) || '' };
      if (body.action === 'vaultClear') cofreServidor.delete(body.provider);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(out) });
    }
  };
  win.window = win;
  win.global = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync('js/store.js', 'utf8'), win, { filename: 'store.js' });
  return { Store: win.Store, cofreServidor, idb, localStorage: win.localStorage, chamadas };
}

const UID = 'u1';
const CHAVE = 'sk-ant-api03-exemplo-de-chave-bem-comprida-1234';

(async function () {
  /* ---------- 1. salvar guarda cifrado aqui E em claro no cofre ---------- */
  {
    const m = montarMundo();
    await m.Store.ApiKey.save(UID, 'anthropic', CHAVE);

    const cru = m.localStorage.getItem('kao:apikey:anthropic:' + UID);
    ok('salvar: gravou no aparelho', !!cru, String(cru));
    ok('salvar: nao gravou a chave em texto puro', !!cru && !cru.includes(CHAVE), String(cru));
    ok('salvar: mandou para o cofre do servidor', m.cofreServidor.get('anthropic') === CHAVE,
       String(m.cofreServidor.get('anthropic')));

    const lida = await m.Store.ApiKey.load(UID, 'anthropic');
    ok('salvar: le de volta igualzinha', lida === CHAVE, JSON.stringify(lida));
  }

  /* ---------- 2. aparelho perdeu a chave AES: o cofre assume ---------- */
  {
    const m = montarMundo();
    await m.Store.ApiKey.save(UID, 'anthropic', CHAVE);
    const cifraVelha = m.localStorage.getItem('kao:apikey:anthropic:' + UID);

    // O IndexedDB some, mas o localStorage fica: e o caso que fazia a pessoa
    // digitar a chave de novo a cada reload.
    m.idb.clear();
    const m2 = montarMundo({
      localStorage: m.localStorage,
      cofreServidor: m.cofreServidor,
      idb: new Map()
    });

    const lida = await m2.Store.ApiKey.load(UID, 'anthropic');
    ok('cifra morta: recuperou a chave do cofre', lida === CHAVE, JSON.stringify(lida));

    const cifraNova = m2.localStorage.getItem('kao:apikey:anthropic:' + UID);
    ok('cifra morta: recifrou com a chave nova do aparelho',
       !!cifraNova && cifraNova !== cifraVelha, String(cifraNova));

    const derepente = await m2.Store.ApiKey.load(UID, 'anthropic');
    ok('cifra morta: o proximo load ja abre local', derepente === CHAVE, JSON.stringify(derepente));
  }

  /* ---------- 3. cofre vazio e cifra ilegivel: nao inventa chave ---------- */
  {
    const m = montarMundo();
    m.localStorage.setItem('kao:apikey:anthropic:' + UID,
      JSON.stringify({ iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAAAAAAAAAA' }));
    const lida = await m.Store.ApiKey.load(UID, 'anthropic');
    ok('sem cofre: devolve vazio', lida === '', JSON.stringify(lida));
  }

  /* ---------- 4. boot carrega duas chaves em paralelo sem se atropelar ---------- */
  {
    const m = montarMundo();
    await Promise.all([
      m.Store.ApiKey.save(UID, 'anthropic', CHAVE),
      m.Store.ApiKey.save(UID, 'elevenlabs', 'sk_voz_exemplo_bem_comprida_9876')
    ]);
    // Zera o estado de execucao, mantendo o que foi gravado: e o reload.
    const m2 = montarMundo({
      localStorage: m.localStorage,
      cofreServidor: m.cofreServidor,
      idb: m.idb
    });
    const [modelo, voz] = await Promise.all([
      m2.Store.ApiKey.load(UID, 'anthropic'),
      m2.Store.ApiKey.load(UID, 'elevenlabs')
    ]);
    ok('duas chaves: a do modelo sobreviveu', modelo === CHAVE, JSON.stringify(modelo));
    ok('duas chaves: a da voz sobreviveu', voz === 'sk_voz_exemplo_bem_comprida_9876', JSON.stringify(voz));
    ok('duas chaves: uma chave AES so no aparelho', m2.idb.size === 1, 'chaves=' + m2.idb.size);
  }

  /* ---------- 5. remover limpa aqui e no cofre ---------- */
  {
    const m = montarMundo();
    await m.Store.ApiKey.save(UID, 'anthropic', CHAVE);
    m.Store.ApiKey.clear(UID, 'anthropic');
    await new Promise((r) => setTimeout(r, 20));
    ok('remover: saiu do aparelho',
       m.localStorage.getItem('kao:apikey:anthropic:' + UID) === null);
    ok('remover: saiu do cofre', !m.cofreServidor.has('anthropic'));
  }

  console.log('');
  console.log(falhas.length ? falhas.length + ' FALHA(S)' : 'todos os testes passaram');
  process.exit(falhas.length ? 1 : 0);
})();
