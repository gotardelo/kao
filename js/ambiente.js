/* Original high-altitude soundscape. Audio only starts after an explicit action. */
(function (global) {
  'use strict';

  var S = {
    ctx: null,
    master: null,
    wind: null,
    air: null,
    pads: [],
    timers: [],
    active: false,
    volume: 0.22,
    ducked: false,
    altitude: 0.5
  };

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function now() { return S.ctx ? S.ctx.currentTime : 0; }

  function noiseBuffer(ctx, seconds) {
    var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < data.length; i++) {
      last = last * 0.985 + (Math.random() * 2 - 1) * 0.15;
      data[i] = last;
    }
    return buffer;
  }

  function gain(value) {
    var node = S.ctx.createGain();
    node.gain.value = value;
    return node;
  }

  function connectWind() {
    var ctx = S.ctx;
    var source = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var amp = gain(0.16);
    var sway = ctx.createOscillator();
    var swayGain = gain(0.055);

    source.buffer = noiseBuffer(ctx, 4);
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.35;
    sway.type = 'sine';
    sway.frequency.value = 0.045;
    swayGain.gain.value = 0.055;
    sway.connect(swayGain);
    swayGain.connect(amp.gain);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(S.master);
    source.start();
    sway.start();
    S.wind = { source: source, filter: filter, amp: amp, sway: sway };
  }

  function connectAir() {
    var ctx = S.ctx;
    var source = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var amp = gain(0.028);

    source.buffer = noiseBuffer(ctx, 5);
    source.loop = true;
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    filter.Q.value = 0.45;
    source.connect(filter);
    filter.connect(amp);
    amp.connect(S.master);
    source.start();
    S.air = { source: source, filter: filter, amp: amp };
  }

  function connectPads() {
    var ctx = S.ctx;
    [73.42, 110, 146.83].forEach(function (frequency, index) {
      var oscillator = ctx.createOscillator();
      var filter = ctx.createBiquadFilter();
      var amp = gain(index === 0 ? 0.020 : 0.011);
      oscillator.type = index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      oscillator.connect(filter);
      filter.connect(amp);
      amp.connect(S.master);
      oscillator.start();
      S.pads.push({ oscillator: oscillator, filter: filter, amp: amp, base: frequency });
    });
  }

  function gust() {
    if (!S.active || !S.ctx) return;
    var ctx = S.ctx;
    var source = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var amp = gain(0.0001);
    var duration = 3.5 + Math.random() * 4;
    var at = now();

    source.buffer = noiseBuffer(ctx, duration + 0.5);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420 + Math.random() * 260, at);
    filter.Q.value = 0.65;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(0.050 + Math.random() * 0.025, at + duration * 0.38);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(S.master);
    source.start(at);
    source.stop(at + duration + 0.1);
  }

  function resonance() {
    if (!S.active || !S.ctx) return;
    var ctx = S.ctx;
    var at = now();
    var oscillator = ctx.createOscillator();
    var overtone = ctx.createOscillator();
    var amp = gain(0.0001);
    var root = [196, 220, 246.94, 293.66][Math.floor(Math.random() * 4)];
    var duration = 2.7 + Math.random() * 2.8;

    oscillator.type = 'sine';
    overtone.type = 'sine';
    oscillator.frequency.value = root;
    overtone.frequency.value = root * 2.01;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(0.018, at + 0.06);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(amp);
    overtone.connect(amp);
    amp.connect(S.master);
    oscillator.start(at);
    overtone.start(at);
    oscillator.stop(at + duration + 0.1);
    overtone.stop(at + duration + 0.1);
  }

  function schedule() {
    S.timers.push(setInterval(gust, 14000));
    S.timers.push(setInterval(resonance, 23000));
    setTimeout(gust, 900);
    setTimeout(resonance, 4800);
  }

  function setMasterGain(ramp) {
    if (!S.master || !S.ctx) return;
    var target = (S.ducked ? 0.22 : 1) * S.volume;
    S.master.gain.cancelScheduledValues(now());
    S.master.gain.setTargetAtTime(target, now(), ramp || 0.16);
  }

  function create() {
    var AudioContext = global.AudioContext || global.webkitAudioContext;
    if (!AudioContext) return false;
    S.ctx = new AudioContext();
    S.master = gain(0.0001);
    S.master.connect(S.ctx.destination);
    connectWind();
    connectAir();
    connectPads();
    schedule();
    return true;
  }

  function stopNodes() {
    S.timers.forEach(function (timer) { clearInterval(timer); });
    S.timers = [];
    [S.wind, S.air].forEach(function (layer) {
      if (!layer) return;
      try { layer.source.stop(); } catch (_) {}
      try { layer.sway.stop(); } catch (_) {}
    });
    S.pads.forEach(function (pad) { try { pad.oscillator.stop(); } catch (_) {} });
    S.pads = [];
    S.wind = null;
    S.air = null;
  }

  var Ambiente = {
    disponivel: function () { return !!(global.AudioContext || global.webkitAudioContext); },
    ativo: function () { return S.active; },
    volume: function () { return Math.round(S.volume * 100); },

    iniciar: function () {
      if (!Ambiente.disponivel()) return Promise.reject(new Error('Este navegador nao suporta paisagem sonora.'));
      if (!S.ctx && !create()) return Promise.reject(new Error('Nao consegui preparar o audio ambiente.'));
      return S.ctx.resume().then(function () {
        S.active = true;
        setMasterGain(0.55);
        return true;
      });
    },

    pausar: function () {
      if (!S.ctx || !S.active) return Promise.resolve();
      S.active = false;
      setMasterGain(0.12);
      return S.ctx.suspend().catch(function () {});
    },

    encerrar: function () {
      S.active = false;
      S.ducked = false;
      stopNodes();
      if (!S.ctx) return Promise.resolve();
      var ctx = S.ctx;
      S.ctx = null;
      S.master = null;
      return ctx.close().catch(function () {});
    },

    definirVolume: function (value) {
      S.volume = clamp(Number(value) || 0, 0, 0.45);
      setMasterGain();
    },

    reduzir: function (ativo) {
      S.ducked = !!ativo;
      setMasterGain(ativo ? 0.08 : 0.28);
    },

    definirAltitude: function (value) {
      if (!S.ctx || !S.wind || !S.air) return;
      S.altitude = clamp(Number(value) || 0.5, 0, 1);
      S.wind.filter.frequency.setTargetAtTime(430 + S.altitude * 440, now(), 0.35);
      S.air.filter.frequency.setTargetAtTime(1050 + S.altitude * 1100, now(), 0.35);
      S.pads.forEach(function (pad, index) {
        pad.oscillator.detune.setTargetAtTime((S.altitude - 0.5) * (index + 1) * 4, now(), 0.4);
      });
    }
  };

  document.addEventListener('visibilitychange', function () {
    if (!S.ctx || !S.active) return;
    if (document.hidden) S.ctx.suspend().catch(function () {});
    else S.ctx.resume().catch(function () {});
  });

  global.Ambiente = Ambiente;
})(window);
