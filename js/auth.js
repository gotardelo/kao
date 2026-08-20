/* ============================================================
   Kao — cadastro, login e sessão
   ============================================================ */
(function (global) {
  'use strict';

  var Users = Store.Users, Crypto = Store.Crypto;
  var SESSION_KEY = Store.keys.session;
  var DAY = 86400000;

  function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }

  /** Força da senha: 0..4 + rótulo. */
  function strength(pw) {
    pw = pw || '';
    var score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^\w\s]/.test(pw)) score++;
    score = Math.min(4, score);
    var labels = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'];
    return { score: score, label: labels[score] };
  }

  var Auth = {
    strength: strength,
    emailOk: emailOk,

    signup: function (data) {
      var name = String(data.name || '').trim();
      var email = String(data.email || '').trim().toLowerCase();
      var password = data.password || '';

      if (name.length < 2) return Promise.reject(new Error('Digite seu nome.'));
      if (!emailOk(email)) return Promise.reject(new Error('E-mail inválido.'));
      if (password.length < 8) return Promise.reject(new Error('A senha precisa ter ao menos 8 caracteres.'));
      if (password !== data.password2) return Promise.reject(new Error('As senhas não conferem.'));
      if (Users.byEmail(email)) return Promise.reject(new Error('Já existe uma conta com esse e-mail.'));
      if (!Crypto.available) return Promise.reject(new Error('Este navegador não suporta a criptografia necessária. Use HTTPS ou localhost.'));

      return Crypto.hashPassword(password).then(function (pw) {
        var user = {
          id: Store.uid(),
          name: name,
          email: email,
          pw: pw,
          createdAt: Date.now()
        };
        var list = Users.all();
        list.push(user);
        Users.save(list);
        Auth._startSession(user.id, true);
        return user;
      });
    },

    login: function (data) {
      var email = String(data.email || '').trim().toLowerCase();
      var password = data.password || '';
      var user = Users.byEmail(email);
      var fail = new Error('E-mail ou senha incorretos.');

      if (!user) {
        // Gasta o mesmo tempo de um login válido para não vazar quais e-mails existem.
        return Crypto.hashPassword(password).then(function () { throw fail; });
      }
      return Crypto.verifyPassword(password, user.pw).then(function (ok) {
        if (!ok) throw fail;
        Auth._startSession(user.id, data.remember !== false);
        Users.update(user.id, { lastLogin: Date.now() });
        return user;
      });
    },

    changePassword: function (userId, current, next, next2) {
      var user = Users.byId(userId);
      if (!user) return Promise.reject(new Error('Sessão inválida.'));
      if (next.length < 8) return Promise.reject(new Error('A nova senha precisa ter ao menos 8 caracteres.'));
      if (next !== next2) return Promise.reject(new Error('As senhas não conferem.'));
      return Crypto.verifyPassword(current, user.pw).then(function (ok) {
        if (!ok) throw new Error('Senha atual incorreta.');
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
      if (!emailOk(email)) return Promise.reject(new Error('E-mail inválido.'));
      var other = Users.byEmail(email);
      if (other && other.id !== userId) return Promise.reject(new Error('Esse e-mail já está em uso.'));
      return Promise.resolve(Users.update(userId, { name: name, email: email }));
    },

    _startSession: function (userId, remember) {
      Store.write(SESSION_KEY, {
        userId: userId,
        token: Store.uid(),
        createdAt: Date.now(),
        expiresAt: Date.now() + (remember ? 30 * DAY : DAY)
      });
    },

    /** Usuário logado com sessão válida, ou null. */
    current: function () {
      var s = Store.read(SESSION_KEY, null);
      if (!s || !s.userId) return null;
      if (s.expiresAt && s.expiresAt < Date.now()) { Auth.logout(); return null; }
      var user = Users.byId(s.userId);
      if (!user) { Auth.logout(); return null; }
      return user;
    },

    /** Renova a validade a cada uso, para não cair no meio do dia. */
    touch: function () {
      var s = Store.read(SESSION_KEY, null);
      if (!s) return;
      var span = s.expiresAt - s.createdAt;
      if (span > 2 * DAY) {
        s.expiresAt = Date.now() + span;
        Store.write(SESSION_KEY, s);
      }
    },

    logout: function () { localStorage.removeItem(SESSION_KEY); }
  };

  global.Auth = Auth;
})(window);
