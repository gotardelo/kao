/* ============================================================
   TDAHZEI - cadastro, login e sessao sincronizados
   ============================================================ */
(function (global) {
  'use strict';

  var Users = Store.Users, Crypto = Store.Crypto, Sync = Store.Sync;
  var SESSION_KEY = Store.keys.session;
  var DAY = 86400000;

  function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }

  /** Forca da senha: 0..4 + rotulo. */
  function strength(pw) {
    pw = pw || '';
    var score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^\w\s]/.test(pw)) score++;
    score = Math.min(4, score);
    var labels = ['Muito fraca', 'Fraca', 'Razoavel', 'Boa', 'Forte'];
    return { score: score, label: labels[score] };
  }

  function saveRemoteUser(user, password) {
    if (!password) {
      Sync.saveUser(user);
      return Promise.resolve(user);
    }
    return Crypto.hashPassword(password).then(function (pw) {
      return Sync.saveUser(user, { pw: pw });
    });
  }

  function finishRemoteAuth(out, opts) {
    opts = opts || {};
    var user = out.user;
    return saveRemoteUser(user, opts.password).then(function (saved) {
      Auth._startSession(saved.id, opts.remember !== false);
      if (opts.pullFirst) return Sync.pull().then(function () { return saved; });
      return saved;
    }).then(function (saved) {
      if (opts.adoptEmail) Sync.adoptLocalUsers(opts.adoptEmail, saved.id);
      var push = opts.pushAll ? Sync.pushAll(saved.id, true) : Sync.flush();
      return push.then(function () {
        if (Store.ApiKey && Store.ApiKey.syncVault) return Store.ApiKey.syncVault(saved.id);
      }).then(function () {
        return Sync.pull().catch(function () {});
      }).then(function () {
        return Users.byId(saved.id) || saved;
      });
    });
  }

  var Auth = {
    strength: strength,
    emailOk: emailOk,
    syncNotice: '',

    signup: function (data) {
      var name = String(data.name || '').trim();
      var email = String(data.email || '').trim().toLowerCase();
      var password = data.password || '';

      if (name.length < 2) return Promise.reject(new Error('Digite seu nome.'));
      if (!emailOk(email)) return Promise.reject(new Error('E-mail invalido.'));
      if (password.length < 8) return Promise.reject(new Error('A senha precisa ter ao menos 8 caracteres.'));
      if (password !== data.password2) return Promise.reject(new Error('As senhas nao conferem.'));
      if (Users.byEmail(email)) return Promise.reject(new Error('Ja existe uma conta com esse e-mail.'));
      if (!Crypto.available) return Promise.reject(new Error('Este navegador nao suporta a criptografia necessaria. Use HTTPS ou localhost.'));

      return Sync.request('signup', {
        name: name,
        email: email,
        password: password
      }).then(function (out) {
        return finishRemoteAuth(out, { password: password, remember: true, pushAll: true });
      });
    },

    login: function (data) {
      var email = String(data.email || '').trim().toLowerCase();
      var password = data.password || '';
      return Sync.request('login', {
        email: email,
        password: password,
        remember: data.remember !== false
      }).then(function (out) {
        return finishRemoteAuth(out, {
          password: password,
          remember: data.remember !== false,
          adoptEmail: email,
          pullFirst: true,
          pushAll: true
        });
      }).catch(function (err) {
        var local = Users.byEmail(email);
        if (!local || !local.pw) throw err;
        return Crypto.verifyPassword(password, local.pw).then(function (ok) {
          if (!ok) throw err;
          return Sync.request('migrate', { user: local });
        }).then(function (out) {
          return finishRemoteAuth(out, {
            password: password,
            remember: data.remember !== false,
            adoptEmail: email,
            pushAll: true
          });
        });
      });
    },

    changePassword: function (userId, current, next, next2) {
      var user = Users.byId(userId);
      if (!user) return Promise.reject(new Error('Sessao invalida.'));
      if (next.length < 8) return Promise.reject(new Error('A nova senha precisa ter ao menos 8 caracteres.'));
      if (next !== next2) return Promise.reject(new Error('As senhas nao conferem.'));
      return Sync.request('changePassword', {
        current: current,
        next: next,
        next2: next2
      }).then(function () {
        return Crypto.hashPassword(next);
      }).then(function (pw) {
        Users.update(userId, { pw: pw });
        return true;
      });
    },

    updateProfile: function (userId, patch) {
      var name = String(patch.name || '').trim();
      var email = String(patch.email || '').trim().toLowerCase();
      if (name.length < 2) return Promise.reject(new Error('Digite seu nome.'));
      if (!emailOk(email)) return Promise.reject(new Error('E-mail invalido.'));
      return Sync.request('updateProfile', { name: name, email: email }).then(function (out) {
        return Sync.saveUser(out.user);
      });
    },

    _startSession: function (userId, remember) {
      Store.write(SESSION_KEY, {
        userId: userId,
        token: Store.uid(),
        createdAt: Date.now(),
        expiresAt: Date.now() + (remember ? 30 * DAY : DAY)
      });
    },

    ready: function () {
      Auth.syncNotice = '';
      var local = Auth.current();
      if (!local) {
        return Sync.request('me').then(function (out) {
          Sync.saveUser(out.user);
          Auth._startSession(out.user.id, true);
          return Sync.pull().then(function () { return out.user; });
        }).catch(function () { return null; });
      }
      if (!local.pw) {
        return Sync.request('me').then(function (out) {
          Sync.saveUser(out.user);
          Auth._startSession(out.user.id, true);
          return Sync.pull().then(function () { return out.user; });
        }).catch(function () {
          Auth.logout();
          return null;
        });
      }
      return Sync.request('migrate', { user: local }).then(function (out) {
        return finishRemoteAuth(out, {
          remember: true,
          adoptEmail: local.email,
          pushAll: !!out.created
        });
      }).catch(function (err) {
        if (err && err.code === 'LOGIN_REQUIRED') {
          Auth.syncNotice = err.message;
          Auth.logout();
          return null;
        }
        console.warn('[TDAHZEI] sync indisponivel, usando cache local.', err);
        return local;
      });
    },

    /** Usuario logado com sessao local valida, ou null. */
    current: function () {
      var s = Store.read(SESSION_KEY, null);
      if (!s || !s.userId) return null;
      if (s.expiresAt && s.expiresAt < Date.now()) { Auth.logout(); return null; }
      var user = Users.byId(s.userId);
      if (!user) { Auth.logout(); return null; }
      return user;
    },

    /** Renova a validade a cada uso para nao cair no meio do dia. */
    touch: function () {
      var s = Store.read(SESSION_KEY, null);
      if (!s) return;
      var span = s.expiresAt - s.createdAt;
      if (span > 2 * DAY) {
        s.expiresAt = Date.now() + span;
        Store.write(SESSION_KEY, s);
      }
    },

    logout: function () {
      if (Sync && Sync.flush) {
        Sync.flush().catch(function () {}).then(function () {
          if (Sync.logout) Sync.logout();
        });
      }
      Store.remove(SESSION_KEY);
    }
  };

  global.Auth = Auth;
})(window);
