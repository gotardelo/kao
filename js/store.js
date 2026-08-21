/* ============================================================
   TDAHZEI — camada de dados + criptografia
   Tudo vive no navegador: localStorage (dados) + IndexedDB (chave AES).
   Trocar por um backend depois = reimplementar só este arquivo.
   ============================================================ */
(function (global) {
  'use strict';

  // Prefixo histórico: mudar isso apagaria a conta de quem já usa o app.
  var NS = 'kao:';
  var K = {
    users:    NS + 'users',
    session:  NS + 'session',
    convs:    function (uid) { return NS + 'convs:' + uid; },
    config:   function (uid) { return NS + 'config:' + uid; },
    apikey:   function (uid, provider) { return NS + 'apikey:' + (provider || 'openai') + ':' + uid; },
    apikeyLegacy: function (uid) { return NS + 'apikey:' + uid; },
    usage:    function (uid) { return NS + 'usage:' + uid; },
    progress: function (uid) { return NS + 'progress:' + uid; },
    avatar:   function (uid) { return NS + 'avatar:' + uid; },
    profile:  function (uid) { return NS + 'profile:' + uid; },
    persona:  function (uid) { return NS + 'persona:' + uid; },
    memoria:  function (uid) { return NS + 'memoria:' + uid; },
    vault:    function (uid) { return NS + 'vault:' + uid; },
    financas: function (uid) { return NS + 'financas:' + uid; },
    apiAlert: function (uid) { return NS + 'api-alert:' + uid; },
    openFinance: function (uid) { return NS + 'open-finance:' + uid; }
  };
  var SYNC_META_KEY = NS + 'sync:meta';
  var SYNC_QUEUE_KEY = NS + 'sync:queue';
  var SYNC_PREFIXES = [
    'convs', 'config', 'usage', 'progress', 'avatar', 'profile',
    'persona', 'memoria', 'vault', 'financas', 'api-alert', 'open-finance'
  ];
  var syncTimer = null;
  var syncInFlight = null;
  var applyingRemote = false;

  /* ---------- helpers de JSON ---------- */
  function rawRead(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function rawWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[TDAHZEI] falha ao gravar', key, e);
      return false;
    }
  }
  function read(key, fallback) { return rawRead(key, fallback); }
  function write(key, value) {
    var ok = rawWrite(key, value);
    if (ok) markLocalChange(key, localStorage.getItem(key));
    return ok;
  }
  function remove(key) {
    try {
      localStorage.removeItem(key);
      markLocalChange(key, null);
      return true;
    } catch (e) {
      console.error('[TDAHZEI] falha ao apagar', key, e);
      return false;
    }
  }
  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ============================================================
     SINCRONIZACAO COM O BANCO DO SITE
     ============================================================ */
  function api(action, data) {
    return fetch('/api/sync', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, data || {}))
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error((body.error && body.error.message) || 'Nao foi possivel sincronizar.');
          err.status = res.status;
          err.code = body.error && body.error.code;
          throw err;
        }
        return body;
      });
    });
  }

  function sessionUid() {
    var s = rawRead(K.session, null);
    return s && s.userId ? String(s.userId) : '';
  }

  function syncableKey(key, uid_) {
    if (!uid_ || typeof key !== 'string') return false;
    if (key === K.users || key === K.session) return false;
    if (key === SYNC_META_KEY || key === SYNC_QUEUE_KEY) return false;
    if (key.indexOf(NS + 'sync:') === 0 || key.indexOf(NS + 'apikey:') === 0) return false;
    if (key.slice(-uid_.length - 1) !== ':' + uid_) return false;
    var prefix = key.slice(NS.length, key.length - uid_.length - 1);
    return SYNC_PREFIXES.indexOf(prefix) > -1;
  }

  function markLocalChange(key, rawValue) {
    if (applyingRemote) return;
    var uid_ = sessionUid();
    if (!syncableKey(key, uid_)) return;
    var now = Date.now();
    var meta = rawRead(SYNC_META_KEY, {});
    var queue = rawRead(SYNC_QUEUE_KEY, {});
    meta[key] = now;
    queue[key] = { key: key, value: rawValue, updatedAt: now };
    rawWrite(SYNC_META_KEY, meta);
    rawWrite(SYNC_QUEUE_KEY, queue);
    schedulePush();
  }

  function schedulePush() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { Sync.flush().catch(function () {}); }, 700);
  }

  function applyRemoteRecords(records) {
    var meta = rawRead(SYNC_META_KEY, {});
    applyingRemote = true;
    try {
      (records || []).forEach(function (record) {
        var key = String(record.key || '');
        var updatedAt = Number(record.updatedAt || 0);
        if (!key) return;
        if ((meta[key] || 0) > updatedAt) return;
        if (record.value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, String(record.value));
        meta[key] = updatedAt;
      });
    } finally {
      applyingRemote = false;
      rawWrite(SYNC_META_KEY, meta);
    }
  }

  function parseRaw(raw) {
    try { return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  function stableString(value) {
    try { return JSON.stringify(value); }
    catch (e) { return String(value); }
  }

  function emptyValue(value) {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  }

  function mergeArrays(target, source) {
    var out = Array.isArray(target) ? target.slice() : [];
    var byId = {};
    out.forEach(function (item, index) {
      if (item && typeof item === 'object' && item.id) byId[item.id] = index;
    });
    (Array.isArray(source) ? source : []).forEach(function (item) {
      if (item && typeof item === 'object' && item.id && byId[item.id] !== undefined) {
        out[byId[item.id]] = mergeData(out[byId[item.id]], item);
        return;
      }
      var sig = stableString(item);
      for (var i = 0; i < out.length; i++) if (stableString(out[i]) === sig) return;
      out.push(item);
    });
    return out;
  }

  function mergeData(target, source) {
    if (emptyValue(target)) return source;
    if (emptyValue(source)) return target;
    if (Array.isArray(target) || Array.isArray(source)) return mergeArrays(target, source);
    if (typeof target === 'object' && typeof source === 'object') {
      var out = Object.assign({}, target);
      Object.keys(source).forEach(function (key) {
        out[key] = Object.prototype.hasOwnProperty.call(out, key)
          ? mergeData(out[key], source[key])
          : source[key];
      });
      return out;
    }
    return target;
  }

  function mergeRaw(targetRaw, sourceRaw) {
    if (!targetRaw) return sourceRaw;
    if (!sourceRaw) return targetRaw;
    var target = parseRaw(targetRaw);
    var source = parseRaw(sourceRaw);
    if (target === null || source === null) return targetRaw;
    return JSON.stringify(mergeData(target, source));
  }

  /* ============================================================
     CRIPTOGRAFIA
     - Senhas: PBKDF2-SHA256, 210k iterações, sal aleatório por usuário.
     - Chave da API: AES-GCM com uma CryptoKey NÃO-EXPORTÁVEL guardada
       no IndexedDB. Nem via console dá para ler a chave crua de volta.
     ============================================================ */
  var SUBTLE = global.crypto && global.crypto.subtle ? global.crypto.subtle : null;
  var ITER = 210000;

  function bytesToB64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64ToBytes(str) {
    var s = atob(str), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

  var Crypto = {
    available: !!SUBTLE,

    /** Deriva o hash da senha. Retorna {salt, hash, iter}. */
    hashPassword: function (password, saltB64) {
      var salt = saltB64 ? b64ToBytes(saltB64) : randomBytes(16);
      return SUBTLE.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
        .then(function (baseKey) {
          return SUBTLE.deriveBits(
            { name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' },
            baseKey, 256
          );
        })
        .then(function (bits) {
          return { salt: bytesToB64(salt), hash: bytesToB64(bits), iter: ITER };
        });
    },

    /** Comparação em tempo constante (evita vazar por timing). */
    verifyPassword: function (password, record) {
      return Crypto.hashPassword(password, record.salt).then(function (out) {
        var a = out.hash, b = record.hash;
        if (a.length !== b.length) return false;
        var diff = 0;
        for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
      });
    },

    /* ---------- chave AES do dispositivo (IndexedDB) ---------- */
    _openDB: function () {
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open('kao-vault', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('keys'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    },
    _idb: function (mode, fn) {
      return Crypto._openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('keys', mode);
          var req = fn(tx.objectStore('keys'));
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    deviceKey: function () {
      return Crypto._idb('readonly', function (s) { return s.get('device'); })
        .then(function (existing) {
          if (existing) return existing;
          return SUBTLE.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
            .then(function (key) {
              return Crypto._idb('readwrite', function (s) { return s.put(key, 'device'); })
                .then(function () { return key; });
            });
        });
    },
    encrypt: function (plain) {
      return Crypto.deviceKey().then(function (key) {
        var iv = randomBytes(12);
        return SUBTLE.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plain))
          .then(function (buf) { return { iv: bytesToB64(iv), data: bytesToB64(buf) }; });
      });
    },
    decrypt: function (payload) {
      if (!payload || !payload.iv) return Promise.resolve('');
      return Crypto.deviceKey().then(function (key) {
        return SUBTLE.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, key, b64ToBytes(payload.data));
      }).then(function (buf) {
        return new TextDecoder().decode(buf);
      }).catch(function () { return ''; });
    }
  };

  /* ============================================================
     USUÁRIOS
     ============================================================ */
  var Users = {
    all:   function () { return read(K.users, []); },
    save:  function (list) { return write(K.users, list); },
    byEmail: function (email) {
      var e = String(email || '').trim().toLowerCase();
      return Users.all().filter(function (u) { return u.email === e; })[0] || null;
    },
    byId: function (id) {
      return Users.all().filter(function (u) { return u.id === id; })[0] || null;
    },
    upsert: function (user) {
      if (!user || !user.id) return null;
      var list = Users.all(), found = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === user.id || list[i].email === user.email) {
          list[i] = Object.assign({}, list[i], user);
          found = true;
        }
      }
      if (!found) list.push(user);
      Users.save(list);
      return user;
    },
    update: function (id, patch) {
      var list = Users.all(), found = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { list[i] = Object.assign(list[i], patch); found = list[i]; }
      }
      Users.save(list);
      return found;
    }
  };

  /* ============================================================
     CONFIGURAÇÕES POR USUÁRIO
     ============================================================ */
  var Sync = {
    request: api,

    saveUser: function (user, patch) {
      return Users.upsert(Object.assign({}, user || {}, patch || {}));
    },

    pull: function () {
      return api('pull').then(function (out) {
        if (out.user) Users.upsert(out.user);
        applyRemoteRecords(out.records || []);
        return out;
      });
    },

    flush: function () {
      if (syncInFlight) return syncInFlight;
      var queue = rawRead(SYNC_QUEUE_KEY, {});
      var records = Object.keys(queue).map(function (key) { return queue[key]; });
      if (!records.length || !sessionUid()) return Promise.resolve({ ok: true, saved: 0 });
      syncInFlight = api('push', { records: records }).then(function (out) {
        var fresh = rawRead(SYNC_QUEUE_KEY, {});
        records.forEach(function (record) {
          if (fresh[record.key] && fresh[record.key].updatedAt === record.updatedAt) delete fresh[record.key];
        });
        rawWrite(SYNC_QUEUE_KEY, fresh);
        return out;
      }).finally(function () {
        syncInFlight = null;
      });
      return syncInFlight;
    },

    pushAll: function (uid_, touch) {
      var queue = rawRead(SYNC_QUEUE_KEY, {});
      var meta = rawRead(SYNC_META_KEY, {});
      var now = Date.now();
      Object.keys(localStorage).forEach(function (key) {
        if (!syncableKey(key, uid_)) return;
        var updatedAt = touch ? now : (meta[key] || now);
        meta[key] = updatedAt;
        queue[key] = { key: key, value: localStorage.getItem(key), updatedAt: updatedAt };
      });
      rawWrite(SYNC_META_KEY, meta);
      rawWrite(SYNC_QUEUE_KEY, queue);
      return Sync.flush();
    },

    adoptLocalUsers: function (email, targetUid) {
      var e = String(email || '').trim().toLowerCase();
      var users = Users.all();
      var oldIds = users
        .filter(function (u) { return u.email === e && u.id !== targetUid; })
        .map(function (u) { return u.id; });
      if (!oldIds.length) return false;

      var meta = rawRead(SYNC_META_KEY, {});
      oldIds.forEach(function (oldId) {
        Object.keys(localStorage).forEach(function (key) {
          if (key.slice(-oldId.length - 1) !== ':' + oldId) return;
          var nextKey = key.slice(0, key.length - oldId.length) + targetUid;
          var oldRaw = localStorage.getItem(key);
          var nextRaw = mergeRaw(localStorage.getItem(nextKey), oldRaw);
          if (nextRaw !== null) localStorage.setItem(nextKey, nextRaw);
          localStorage.removeItem(key);
          if (syncableKey(nextKey, targetUid)) {
            var now = Date.now();
            meta[nextKey] = now;
            var queue = rawRead(SYNC_QUEUE_KEY, {});
            queue[nextKey] = { key: nextKey, value: localStorage.getItem(nextKey), updatedAt: now };
            rawWrite(SYNC_QUEUE_KEY, queue);
          }
        });
      });
      rawWrite(SYNC_META_KEY, meta);
      Users.save(users.filter(function (u) { return u.email !== e || u.id === targetUid; }));
      return true;
    },

    vaultSave: function (provider, plain) {
      return api('vaultSave', { provider: provider || 'openai', value: plain || '' });
    },

    vaultLoad: function (provider) {
      return api('vaultLoad', { provider: provider || 'openai' }).then(function (out) {
        return String(out.value || '');
      });
    },

    vaultClear: function (provider) {
      return api('vaultClear', { provider: provider || 'openai' });
    },

    logout: function () {
      rawWrite(SYNC_QUEUE_KEY, {});
      return api('logout').catch(function () {});
    }
  };

  var DEFAULT_CONFIG = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    effort: 'high',
    vozRealtime: 'marin',
    elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
    elevenLabsModel: 'eleven_multilingual_v2',
    elevenLabsStability: 48,
    elevenLabsSimilarity: 75,
    elevenLabsStyle: 12,
    elevenLabsSpeed: 100,
    elevenLabsSpeakerBoost: true,
    ambienteAtivo: false,
    ambienteVolume: 22,
    agenteAtivo: false,       // o microfone só abre quando VOCÊ mandar
    vozOciosoMin: 0,          // 0 = nunca descansa sozinho
    vozModelo: 'gpt-realtime-2.1',
    vozSensibilidade: 92,
    vozInterromper: true,
    maxTokens: 8000,
    showThinking: true,
    systemMode: 'auto',              // auto = gerado pelo TDAHzeiro | custom = texto livre
    system: '',                      // só usado quando systemMode === 'custom'
    tetoMensalUSD: 0,                // 0 = sem teto; acima disso, bloqueia o envio
    ferramentas: true                // deixar ele gravar coisas sozinho
  };

  var Config = {
    defaults: function () { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); },
    get: function (uid_) {
      var cfg = Object.assign(Config.defaults(), read(K.config(uid_), {}));
      if (!cfg.provider) cfg.provider = /^claude-/i.test(cfg.model || '') ? 'anthropic' : 'openai';
      if (cfg.effort === 'max' && cfg.model === 'gpt-5-mini') cfg.effort = 'high';
      return cfg;
    },
    set: function (uid_, patch) {
      var next = Object.assign(Config.get(uid_), patch);
      write(K.config(uid_), next);
      return next;
    }
  };

  /* ============================================================
     PERFIL DO USUÁRIO e PERSONAGEM (o TDAHzeiro)
     Guardados separados da conta: a conta é identidade, estes são
     conteúdo que o usuário edita o tempo todo.
     ============================================================ */
  function comDefaults(padrao, salvo) {
    var out = Object.assign({}, padrao, salvo || {});
    // objetos aninhados precisam de merge próprio
    if (padrao.traits) out.traits = Object.assign({}, padrao.traits, (salvo && salvo.traits) || {});
    if (padrao.voz) out.voz = Object.assign({}, padrao.voz, (salvo && salvo.voz) || {});
    return out;
  }

  var Profile = {
    get: function (uid_) {
      return comDefaults(global.Persona ? Persona.DEFAULT_PROFILE : {}, read(K.profile(uid_), {}));
    },
    set: function (uid_, patch) {
      var next = Object.assign(Profile.get(uid_), patch);
      write(K.profile(uid_), next);
      return next;
    }
  };

  var PersonaStore = {
    get: function (uid_) {
      return comDefaults(global.Persona ? Persona.DEFAULT_PERSONA : {}, read(K.persona(uid_), {}));
    },
    set: function (uid_, patch) {
      var next = Object.assign(PersonaStore.get(uid_), patch);
      write(K.persona(uid_), next);
      return next;
    },
    existe: function (uid_) { return !!read(K.persona(uid_), null); }
  };

  /* ============================================================
     CHAVE DA API (criptografada)
     ============================================================ */
  var ApiKey = {
    _saveLocal: function (uid_, provider, plain) {
      return Crypto.encrypt(plain).then(function (payload) {
        payload.hint = plain.slice(0, 12) + '...' + plain.slice(-4);
        payload.savedAt = Date.now();
        write(K.apikey(uid_, provider), payload);
      });
    },
    save: function (uid_, provider, plain) {
      if (arguments.length === 2) { plain = provider; provider = 'openai'; }
      if (!plain) {
        localStorage.removeItem(K.apikey(uid_, provider));
        return Sync.vaultClear(provider).catch(function () {});
      }
      return ApiKey._saveLocal(uid_, provider, plain).then(function () {
        Sync.vaultSave(provider, plain).catch(function () {});
      });
      return Crypto.encrypt(plain).then(function (payload) {
        payload.hint = plain.slice(0, 12) + '…' + plain.slice(-4);
        payload.savedAt = Date.now();
        write(K.apikey(uid_, provider), payload);
      });
    },
    load: function (uid_, provider) {
      provider = provider || 'openai';
      var payload = read(K.apikey(uid_, provider), null);
      if (!payload && provider === 'openai') payload = read(K.apikeyLegacy(uid_), null);
      if (!payload) {
        return Sync.vaultLoad(provider).then(function (plain) {
          if (!plain) return '';
          return ApiKey._saveLocal(uid_, provider, plain).then(function () { return plain; });
        }).catch(function () { return ''; });
      }
      return Crypto.decrypt(payload).then(function (plain) {
        if (plain) Sync.vaultSave(provider, plain).catch(function () {});
        return plain;
      });
    },
    meta: function (uid_, provider) {
      provider = provider || 'openai';
      return read(K.apikey(uid_, provider), null) ||
        (provider === 'openai' ? read(K.apikeyLegacy(uid_), null) : null);
    },
    clear: function (uid_, provider) {
      provider = provider || 'openai';
      localStorage.removeItem(K.apikey(uid_, provider));
      if (provider === 'openai') localStorage.removeItem(K.apikeyLegacy(uid_));
      Sync.vaultClear(provider).catch(function () {});
    },
    syncVault: function (uid_) {
      var providers = {};
      Object.keys(localStorage).forEach(function (key) {
        if (key === K.apikeyLegacy(uid_)) providers.openai = true;
        var marker = NS + 'apikey:';
        if (key.indexOf(marker) === 0 && key.slice(-uid_.length - 1) === ':' + uid_) {
          providers[key.slice(marker.length, key.length - uid_.length - 1)] = true;
        }
      });
      return Promise.all(Object.keys(providers).map(function (provider) {
        return ApiKey.load(uid_, provider).then(function () {});
      }));
    }
  };

  /* ============================================================
     CONVERSAS
     conversa = { id, title, createdAt, updatedAt, messages:[
        { id, role:'user'|'assistant', content, thinking?, error?, model?, at }
     ]}
     ============================================================ */
  var Convs = {
    all: function (uid_) {
      var list = read(K.convs(uid_), []);
      list.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return list;
    },
    get: function (uid_, id) {
      return Convs.all(uid_).filter(function (c) { return c.id === id; })[0] || null;
    },
    create: function (uid_) {
      var conv = { id: uid(), title: 'Nova conversa', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      var list = Convs.all(uid_);
      list.unshift(conv);
      write(K.convs(uid_), list);
      return conv;
    },
    save: function (uid_, conv) {
      conv.updatedAt = Date.now();
      var list = Convs.all(uid_), hit = false;
      for (var i = 0; i < list.length; i++) if (list[i].id === conv.id) { list[i] = conv; hit = true; }
      if (!hit) list.unshift(conv);
      write(K.convs(uid_), list);
      return conv;
    },
    remove: function (uid_, id) {
      write(K.convs(uid_), Convs.all(uid_).filter(function (c) { return c.id !== id; }));
    },
    wipe: function (uid_) { remove(K.convs(uid_)); }
  };

  /* ============================================================
     JARVISOS VAULT
     Memoria em markdown sincronizada: 00-Inbox, Diario, contexto.md
     e pendencias.md. E o Obsidian do PDF, adaptado para o app online.
     ============================================================ */
  function dataISO(offset) {
    var d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function dataBR(iso) {
    var p = String(iso || dataISO()).split('-');
    return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : String(iso || '');
  }

  function tituloDia(iso) {
    try {
      return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
        weekday: 'long', day: '2-digit', month: 'long'
      });
    } catch (_) { return dataBR(iso); }
  }

  function linhasPendentes(markdown) {
    return String(markdown || '').split(/\r?\n/).map(function (linha) {
      var m = linha.match(/^\s*-\s*\[\s\]\s*(.+?)\s*$/);
      return m ? m[1].trim() : '';
    }).filter(Boolean);
  }

  function atualizarSecao(markdown, titulo, conteudo) {
    var src = String(markdown || '').trim();
    var bloco = '## ' + titulo + '\n' + String(conteudo || '').trim();
    var re = new RegExp('(^|\\n)## ' + titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n[\\s\\S]*?(?=\\n## |$)');
    if (re.test(src)) return src.replace(re, function (match, prefix) { return (prefix || '') + bloco; }).trim();
    return (src ? src + '\n\n' : '') + bloco;
  }

  function vaultVazio() {
    return {
      inbox: [],
      diario: [],
      contexto: '',
      pendencias: '',
      ignore: 'financeiro/\npessoal/\n*.key\n.env\n.env.*\n',
      lastBriefing: '',
      updatedAt: 0
    };
  }

  function normalizarVault(v) {
    var base = vaultVazio();
    v = Object.assign(base, v || {});
    v.inbox = Array.isArray(v.inbox) ? v.inbox : [];
    v.diario = Array.isArray(v.diario) ? v.diario : [];
    v.contexto = String(v.contexto || '');
    v.pendencias = String(v.pendencias || '');
    v.ignore = String(v.ignore || base.ignore);
    return v;
  }

  function contextoInicial(user, profile, persona) {
    var L = [];
    if (user && user.name) L.push('# Quem eu sou\n' + user.name);
    if (profile && profile.apelido) L.push('## Como me chamar\n' + profile.apelido);
    if (profile && profile.bio) L.push('## Contexto\n' + profile.bio);
    if (profile && profile.objetivos) L.push('## Objetivos\n' + profile.objetivos);
    if (profile && profile.rotina) L.push('## Rotina\n' + profile.rotina);
    if (profile && profile.travas && profile.travas.length) L.push('## O que me trava\n- ' + profile.travas.join('\n- '));
    if (persona && persona.nome) L.push('## Assistente\n' + persona.nome + ' conversa comigo em passos pequenos.');
    return L.join('\n\n').trim();
  }

  function pendenciasDeMemoria(uid_) {
    if (!global.Memoria || !Memoria.abertas) return '';
    var abertas = Memoria.abertas(uid_);
    if (!abertas.length) return '';
    return abertas.map(function (p) {
      return '- [ ] ' + p.texto + (p.prazo ? ' @' + p.prazo : '') +
        (p.prioridade === 'alta' ? ' !alta' : '');
    }).join('\n');
  }

  function escolherPrioridades(uid_, v) {
    var pend = [];
    if (global.Memoria && Memoria.abertas) {
      pend = Memoria.abertas(uid_).slice().sort(function (a, b) {
        var pa = a.prioridade === 'alta' ? 0 : 1;
        var pb = b.prioridade === 'alta' ? 0 : 1;
        var da = a.prazo ? new Date(a.prazo + 'T12:00:00').getTime() : Infinity;
        var db = b.prazo ? new Date(b.prazo + 'T12:00:00').getTime() : Infinity;
        return pa - pb || da - db || a.criadoEm - b.criadoEm;
      }).map(function (p) { return p.texto; });
    }
    var recentes = (v.inbox || []).slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    }).map(function (n) { return n.texto; });
    var pool = pend.concat(recentes);
    var out = [];
    pool.forEach(function (item) {
      var t = String(item || '').trim();
      if (!t) return;
      if (out.some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) return;
      out.push(t);
    });
    if (!out.length) out.push('Escolher a menor acao util de hoje');
    return out.slice(0, 3).map(function (p) {
      var limpo = p.replace(/^[\s\-]+/, '').trim();
      return /^[A-Za-zÀ-ÿ]/.test(limpo) ? limpo.charAt(0).toUpperCase() + limpo.slice(1) : limpo;
    });
  }

  var Vault = {
    hoje: function () { return dataISO(0); },
    ontem: function () { return dataISO(-1); },
    dataBR: dataBR,

    get: function (uid_) { return normalizarVault(read(K.vault(uid_), null)); },
    salvar: function (uid_, vault) {
      var next = normalizarVault(vault);
      next.updatedAt = Date.now();
      write(K.vault(uid_), next);
      return next;
    },
    ensure: function (uid_, user, profile, persona) {
      var v = Vault.get(uid_);
      var mudou = false;
      if (!v.contexto.trim()) {
        v.contexto = contextoInicial(user, profile, persona);
        mudou = true;
      }
      if (!v.pendencias.trim()) {
        v.pendencias = pendenciasDeMemoria(uid_);
        mudou = true;
      }
      return mudou ? Vault.salvar(uid_, v) : v;
    },
    salvarArquivos: function (uid_, patch) {
      var v = Vault.get(uid_);
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'contexto')) v.contexto = String(patch.contexto || '');
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'pendencias')) v.pendencias = String(patch.pendencias || '');
      if (Object.prototype.hasOwnProperty.call(patch || {}, 'ignore')) v.ignore = String(patch.ignore || '');
      return Vault.salvar(uid_, v);
    },
    addInbox: function (uid_, texto, fonte) {
      texto = String(texto || '').trim();
      if (!texto) return null;
      var v = Vault.get(uid_);
      var item = { id: uid(), texto: texto, fonte: fonte || 'manual', createdAt: Date.now() };
      v.inbox.unshift(item);
      if (v.inbox.length > 120) v.inbox = v.inbox.slice(0, 120);
      Vault.salvar(uid_, v);
      return item;
    },
    diarioDe: function (uid_, iso) {
      return Vault.get(uid_).diario.filter(function (d) { return d.data === iso; })[0] || null;
    },
    upsertDiario: function (uid_, iso, markdown) {
      var v = Vault.get(uid_);
      var achou = null;
      v.diario.forEach(function (d) { if (d.data === iso) achou = d; });
      if (achou) {
        achou.markdown = String(markdown || '');
        achou.updatedAt = Date.now();
      } else {
        v.diario.push({ id: uid(), data: iso, markdown: String(markdown || ''), createdAt: Date.now(), updatedAt: Date.now() });
      }
      v.diario.sort(function (a, b) { return b.data.localeCompare(a.data); });
      if (v.diario.length > 180) v.diario = v.diario.slice(0, 180);
      return Vault.salvar(uid_, v);
    },
    caixa: function (uid_) {
      var v = Vault.get(uid_);
      var agora = Date.now();
      var recentes = v.inbox.filter(function (n) { return agora - (n.createdAt || 0) <= 24 * 60 * 60 * 1000; }).slice(0, 5);
      var ontem = Vault.diarioDe(uid_, dataISO(-1));
      var pendOntem = linhasPendentes(ontem && ontem.markdown).slice(0, 5);
      var prioridades = escolherPrioridades(uid_, v);
      var hoje = dataISO(0);
      var nota = (Vault.diarioDe(uid_, hoje) || {}).markdown || '# Diario ' + dataBR(hoje) + '\n' + tituloDia(hoje);
      nota = atualizarSecao(nota, 'O que caiu',
        recentes.length ? recentes.map(function (n) { return '- ' + n.texto; }).join('\n') : 'inbox limpa');
      nota = atualizarSecao(nota, 'Onde eu parei',
        pendOntem.length ? pendOntem.map(function (p) { return '- [ ] ' + p; }).join('\n') : 'sem pendencia registrada ontem');
      nota = atualizarSecao(nota, 'Missao do dia',
        prioridades.map(function (p) { return '- [ ] ' + p; }).join('\n'));
      Vault.upsertDiario(uid_, hoje, nota);
      v = Vault.get(uid_);
      v.lastBriefing = hoje;
      Vault.salvar(uid_, v);
      return { markdown: nota, inbox: recentes, pendentes: pendOntem, prioridades: prioridades };
    },
    fechamento: function (uid_, resumo) {
      var hoje = dataISO(0);
      var nota = (Vault.diarioDe(uid_, hoje) || {}).markdown || '# Diario ' + dataBR(hoje) + '\n' + tituloDia(hoje);
      var texto = String(resumo || '').trim();
      var concluidas = [];
      if (global.Memoria && Memoria.tudo) {
        concluidas = Memoria.tudo(uid_).pendencias.filter(function (p) {
          return p.feito && p.concluidoEm && new Date(p.concluidoEm).toDateString() === new Date().toDateString();
        }).map(function (p) { return p.texto; });
      }
      var bloco = [
        texto || 'Fechamento rapido: registrar o que aconteceu e preparar a proxima manha.',
        '',
        '### Vitorias',
        concluidas.length ? concluidas.map(function (p) { return '- [x] ' + p; }).join('\n') : '- nada marcado ainda',
        '',
        '### Pendencias abertas',
        pendenciasDeMemoria(uid_) || '- nenhuma pendencia aberta'
      ].join('\n');
      nota = atualizarSecao(nota, 'Fechamento', bloco);
      Vault.upsertDiario(uid_, hoje, nota);
      var v = Vault.get(uid_);
      v.pendencias = pendenciasDeMemoria(uid_) || v.pendencias;
      Vault.salvar(uid_, v);
      if (global.Memoria && texto) Memoria.anotarDia(uid_, texto, hoje);
      return { markdown: nota };
    },
    resumoParaPrompt: function (uid_) {
      var v = Vault.get(uid_);
      var L = [];
      if (v.contexto.trim()) L.push('## contexto.md\n' + v.contexto.trim().slice(0, 1800));
      if (v.pendencias.trim()) L.push('## pendencias.md\n' + v.pendencias.trim().slice(0, 1200));
      var hoje = Vault.diarioDe(uid_, dataISO(0));
      if (hoje && hoje.markdown) L.push('## Diario/' + dataBR(hoje.data) + '.md\n' + hoje.markdown.slice(0, 1600));
      if (v.inbox.length) {
        L.push('## 00-Inbox recente\n' + v.inbox.slice(0, 8).map(function (n) {
          return '- ' + n.texto;
        }).join('\n'));
      }
      return L.join('\n\n');
    },
    exportar: function (uid_) {
      var v = Vault.get(uid_);
      var L = [
        '# JarvisOS Vault',
        '',
        '## .claudeignore',
        '```',
        v.ignore.trim(),
        '```',
        '',
        '## contexto.md',
        v.contexto || '_vazio_',
        '',
        '## pendencias.md',
        v.pendencias || '_vazio_',
        '',
        '## 00-Inbox'
      ];
      (v.inbox || []).forEach(function (n) {
        L.push('- ' + new Date(n.createdAt || Date.now()).toLocaleString('pt-BR') + ': ' + n.texto);
      });
      L.push('', '## Diario');
      (v.diario || []).forEach(function (d) {
        L.push('', '### Diario/' + dataBR(d.data) + '.md', d.markdown || '');
      });
      return L.join('\n');
    },
    limpar: function (uid_) { remove(K.vault(uid_)); }
  };

  /* ============================================================
     USO / CUSTO  (preços por milhão de tokens — US$)
     ============================================================ */
  function mesAtual() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function zerado() { return { input: 0, output: 0, cost: 0, calls: 0, economia: 0, cacheLido: 0 }; }

  var Usage = {
    mesAtual: mesAtual,

    /** Estrutura: { total:{...}, meses:{ '2026-08':{...} } }. Migra o formato antigo. */
    tudo: function (uid_) {
      var u = read(K.usage(uid_), null);
      if (!u) return { total: zerado(), meses: {} };
      if (!u.meses) {
        // formato antigo (só acumulado): preserva como total
        return { total: Object.assign(zerado(), u), meses: {} };
      }
      return { total: Object.assign(zerado(), u.total), meses: u.meses };
    },

    /** Acumulado de todos os tempos (mantido para o painel). */
    get: function (uid_) { return Usage.tudo(uid_).total; },

    /** O que foi gasto neste mês — é o que o teto controla. */
    doMes: function (uid_, mes) {
      var u = Usage.tudo(uid_);
      return Object.assign(zerado(), u.meses[mes || mesAtual()]);
    },

    /**
     * @param cache {{lidos:number, escritos:number}} tokens vindos do cache.
     *   Leitura custa 10% do preço de entrada; gravação custa 125%.
     *   `inTok` já vem sem os tokens de cache (a API os reporta separado).
     * @param preco  tabela {in,out} explícita — usada pela voz, que cobra
     *   por token de áudio e não pelo preço do modelo de texto.
     */
    add: function (uid_, inTok, outTok, model, cache, preco) {
      var u = Usage.tudo(uid_);
      var p = preco || (global.Claude && Claude.priceOf(model)) || { in: 0, out: 0 };
      cache = cache || { lidos: 0, escritos: 0 };

      var custo = (
        (inTok || 0) * p.in +
        (outTok || 0) * p.out +
        (cache.lidos || 0) * p.in * 0.1 +
        (cache.escritos || 0) * p.in * 1.25
      ) / 1e6;

      // quanto teria custado sem cache, para mostrar a economia
      var semCache = (
        ((inTok || 0) + (cache.lidos || 0) + (cache.escritos || 0)) * p.in +
        (outTok || 0) * p.out
      ) / 1e6;

      var mes = mesAtual();
      if (!u.meses[mes]) u.meses[mes] = zerado();

      [u.total, u.meses[mes]].forEach(function (alvo) {
        alvo.input += (inTok || 0) + (cache.lidos || 0) + (cache.escritos || 0);
        alvo.output += outTok || 0;
        alvo.cost += custo;
        alvo.economia = (alvo.economia || 0) + Math.max(0, semCache - custo);
        alvo.cacheLido = (alvo.cacheLido || 0) + (cache.lidos || 0);
        alvo.calls += 1;
      });

      // não guarda histórico infinito de meses
      var chaves = Object.keys(u.meses).sort();
      while (chaves.length > 24) { delete u.meses[chaves.shift()]; }

      write(K.usage(uid_), u);
      return u.meses[mes];
    },

    /**
     * Situação do teto mensal.
     * @returns {{teto:number, gasto:number, restante:number, pct:number,
     *            estourou:boolean, perto:boolean}}
     */
    teto: function (uid_, tetoUSD) {
      var gasto = Usage.doMes(uid_).cost;
      var teto = tetoUSD || 0;
      return {
        teto: teto,
        gasto: gasto,
        restante: teto > 0 ? Math.max(0, teto - gasto) : Infinity,
        pct: teto > 0 ? Math.round((gasto / teto) * 100) : 0,
        estourou: teto > 0 && gasto >= teto,
        perto: teto > 0 && gasto >= teto * 0.8 && gasto < teto
      };
    },

    reset: function (uid_) { remove(K.usage(uid_)); }
  };

  /* Erros de cota sobrevivem a um reload, mas nunca guardam chaves ou resposta crua da API. */
  var ApiAlert = {
    get: function (uid_) {
      return Object.assign({ provider: '', kind: '', at: 0 }, read(K.apiAlert(uid_), {}));
    },
    set: function (uid_, value) {
      var next = Object.assign({ provider: '', kind: '', at: Date.now() }, value || {});
      write(K.apiAlert(uid_), next);
      return next;
    },
    clear: function (uid_) { remove(K.apiAlert(uid_)); }
  };

  /* ============================================================
     PROGRESSO / GAMIFICACAO
     ============================================================ */
  function diaAtual() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function diffDias(a, b) {
    if (!a || !b) return 0;
    var da = new Date(a + 'T00:00:00');
    var db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }
  function levelOf(xp) { return Math.max(1, Math.floor(Math.sqrt((xp || 0) / 90)) + 1); }
  function nextLevelXp(level) { return Math.pow(Math.max(1, level), 2) * 90; }

  var Progress = {
    get: function (uid_) {
      var p = Object.assign({
        xp: 0,
        level: 1,
        streak: 0,
        lastActive: '',
        checkins: 0,
        voiceMinutes: 0,
        wins: 0
      }, read(K.progress(uid_), {}));
      p.level = levelOf(p.xp);
      p.nextXp = nextLevelXp(p.level);
      p.prevXp = p.level <= 1 ? 0 : nextLevelXp(p.level - 1);
      return p;
    },

    reward: function (uid_, points, reason, patch) {
      var before = Progress.get(uid_);
      var today = diaAtual();
      var next = Object.assign({}, before, patch || {});
      next.xp += Math.max(0, points || 0);
      if (next.lastActive !== today) {
        next.streak = diffDias(next.lastActive, today) === 1 ? next.streak + 1 : 1;
        next.lastActive = today;
        next.checkins += 1;
      }
      next.level = levelOf(next.xp);
      write(K.progress(uid_), next);
      next.delta = points || 0;
      next.reason = reason || '';
      next.leveled = next.level > before.level;
      next.nextXp = nextLevelXp(next.level);
      next.prevXp = next.level <= 1 ? 0 : nextLevelXp(next.level - 1);
      return next;
    },

    addVoiceMinutes: function (uid_, minutes) {
      var p = Progress.get(uid_);
      p.voiceMinutes += Math.max(0, minutes || 0);
      write(K.progress(uid_), p);
      return Progress.get(uid_);
    },

    win: function (uid_) {
      var p = Progress.get(uid_);
      p.wins += 1;
      write(K.progress(uid_), p);
      return Progress.reward(uid_, 25, 'vitoria');
    },

    reset: function (uid_) { remove(K.progress(uid_)); }
  };

  /* Account credentials stay separate so a person can restart their setup
     without creating a new login. */
  var Account = {
    reset: function (uid_) {
      var marker = ':' + uid_;
      var providers = {};
      Object.keys(localStorage).forEach(function (key) {
        if (key === K.apikeyLegacy(uid_)) providers.openai = true;
        if (key.indexOf(NS + 'apikey:') === 0 && key.slice(-uid_.length - 1) === ':' + uid_) {
          providers[key.slice((NS + 'apikey:').length, key.length - uid_.length - 1)] = true;
        }
        if (key.indexOf(NS) === 0 && key.indexOf(marker) > -1) remove(key);
      });
      Object.keys(providers).forEach(function (provider) {
        Sync.vaultClear(provider).catch(function () {});
      });
    }
  };

  global.Store = {
    keys: K, read: read, write: write, remove: remove, uid: uid,
    Crypto: Crypto, Users: Users, Sync: Sync, Config: Config,
    ApiKey: ApiKey, Convs: Convs, Vault: Vault, Usage: Usage, ApiAlert: ApiAlert,
    Profile: Profile, Persona: PersonaStore, Progress: Progress, Account: Account,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };
})(window);
