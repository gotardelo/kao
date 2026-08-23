/* Testa Persona.Voice.falar com um speechSynthesis falso.
   Foco: o navegador corta a fala no meio sem avisar como erro — chega um
   "end" limpo. A fala tem que retomar de onde parou, e nunca virar laco.
   Foco 2: texto longo sai em pedacos curtos, porque fala longa o Chrome
   corta perto dos 15s por conta propria. */
const fs = require('fs');
const vm = require('vm');

const falhas = [];
function ok(nome, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + nome + (cond ? '' : '  << ' + (extra || '')));
  if (!cond) falhas.push(nome);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function montarMundo() {
  const ditas = [];
  function FakeUtterance(texto) { this.text = texto; }
  const synth = {
    speaking: false, pending: false, paused: false,
    speak(u) { synth.speaking = true; ditas.push(u); },
    cancel() { synth.speaking = false; },
    pause() {}, resume() {},
    getVoices() { return [{ voiceURI: 'v1', name: 'Microsoft Maria', lang: 'pt-BR' }]; },
    addEventListener() {}
  };
  const win = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    isSecureContext: true,
    setTimeout, clearTimeout, setInterval, clearInterval, console
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync('js/persona.js', 'utf8'), win, { filename: 'persona.js' });
  return { Voice: win.Persona.Voice, ditas, synth };
}

/** Simula o motor falando `ate` caracteres e entao encerrando. */
function motorFala(u, ate, comBordas) {
  u.onstart();
  if (comBordas) {
    for (let i = 0; i < ate; i += 5) u.onboundary({ charIndex: i });
    u.onboundary({ charIndex: ate });
  }
  u.onend();
}

(async function () {
  const FRASE = 'Vamos comecar pelo email mais curto e depois eu te lembro do resto.';

  /* ---------- 1. fala inteira: nada de retomada ---------- */
  {
    const { Voice, ditas } = montarMundo();
    let fim = null;
    Voice.falar(FRASE, {}, (ok_) => { fim = ok_; });
    ok('fala inteira: uma emissao', ditas.length === 1, 'emissoes=' + ditas.length);
    motorFala(ditas[0], FRASE.length, true);
    await espera(140);
    ok('fala inteira: nao repetiu', ditas.length === 1, 'emissoes=' + ditas.length);
    ok('fala inteira: terminou com sucesso', fim === true, String(fim));
  }

  /* ---------- 2. cortada no meio, com bordas: retoma de onde parou ---------- */
  {
    const { Voice, ditas } = montarMundo();
    let fim = null;
    Voice.falar(FRASE, {}, (ok_) => { fim = ok_; });
    motorFala(ditas[0], 20, true);            // parou depois de "Vamos comecar pelo e"
    await espera(140);
    ok('corte no meio: emitiu de novo', ditas.length === 2, 'emissoes=' + ditas.length);
    const resto = ditas[1] ? ditas[1].text : '';
    ok('corte no meio: retoma no comeco de uma palavra',
       FRASE.indexOf(resto) > 0 && !/^\S/.test(FRASE.charAt(FRASE.indexOf(resto) - 1)),
       JSON.stringify(resto));
    ok('corte no meio: nao repete o que ja foi dito',
       resto.length > 0 && resto.length < FRASE.length, JSON.stringify(resto));
    ok('corte no meio: ainda nao terminou', fim === null, String(fim));

    motorFala(ditas[1], resto.length, true);  // agora fala o resto inteiro
    await espera(140);
    ok('corte no meio: terminou depois de completar', fim === true, String(fim));
    ok('corte no meio: parou em duas emissoes', ditas.length === 2, 'emissoes=' + ditas.length);
  }

  /* ---------- 3. motor engole a fala: insiste, mas nao vira laco ---------- */
  {
    const { Voice, ditas } = montarMundo();
    let fim = null;
    Voice.falar(FRASE, {}, (ok_) => { fim = ok_; });
    for (let i = 0; i < 8; i++) {
      const u = ditas[ditas.length - 1];
      if (!u || fim !== null) break;
      u.onstart();
      u.onend();                              // sem borda e sem tempo: nada saiu
      await espera(120);
    }
    ok('motor engole: insistiu algumas vezes', ditas.length >= 2, 'emissoes=' + ditas.length);
    ok('motor engole: nao virou laco', ditas.length <= 4, 'emissoes=' + ditas.length);
    ok('motor engole: desistiu e avisou', fim !== null, String(fim));
  }

  /* ---------- 4. interrompido de proposito: nao retoma ---------- */
  {
    const { Voice, ditas } = montarMundo();
    let fim = null;
    Voice.falar(FRASE, {}, (ok_) => { fim = ok_; });
    ditas[0].onstart();
    ditas[0].onerror({ error: 'canceled' });
    await espera(140);
    ok('interrompido: nao retomou', ditas.length === 1, 'emissoes=' + ditas.length);
    ok('interrompido: terminou na hora', fim === true, String(fim));
  }

  /* ---------- 5. frase longa cortada varias vezes chega ao fim ---------- */
  {
    const { Voice, ditas } = montarMundo();
    const LONGA = Array(6).fill(FRASE).join(' ');
    let fim = null;
    Voice.falar(LONGA, {}, (ok_) => { fim = ok_; });
    let voltas = 0;
    while (fim === null && voltas < 40) {
      const u = ditas[ditas.length - 1];
      motorFala(u, Math.min(30, u.text.length), true);   // sempre corta em 30 chars
      await espera(120);
      voltas++;
    }
    ok('frase longa: chegou ao fim', fim === true, 'voltas=' + voltas);
    const dito = ditas.map((u) => u.text.slice(0, 30)).join('');
    const emLaco = ditas.some((u, i) => i > 0 && ditas[i - 1].text === u.text);
    ok('frase longa: nao ficou repetindo o mesmo trecho', !emLaco, 'emissoes=' + ditas.length);
    ok('frase longa: cobriu o texto todo', dito.replace(/\s+/g, '').length >= LONGA.replace(/\s+/g, '').length * 0.9,
       dito.length + ' de ' + LONGA.length);
  }

  /* ---------- 6. texto longo sai picado, e nao numa fala so ---------- */
  {
    const { Voice, ditas } = montarMundo();
    const LONGA = Array(10).fill(FRASE).join(' ');
    let fim = null;
    Voice.falar(LONGA, {}, (ok_) => { fim = ok_; });

    ok('pedacos: a primeira emissao nao leva o texto inteiro',
       ditas[0].text.length < LONGA.length / 2, ditas[0].text.length + ' de ' + LONGA.length);

    let voltas = 0;
    while (fim === null && voltas < 40) {
      const u = ditas[ditas.length - 1];
      motorFala(u, u.text.length, true);            // motor bem comportado: fala tudo
      await espera(80);
      voltas++;
    }
    ok('pedacos: chegou ao fim', fim === true, 'voltas=' + voltas);
    ok('pedacos: cada emissao cabe no limite',
       ditas.every((u) => u.text.length <= 150), 'maior=' + Math.max(...ditas.map((u) => u.text.length)));
    ok('pedacos: emendou o texto inteiro, na ordem',
       ditas.map((u) => u.text).join('').replace(/\s+/g, ' ').trim() === LONGA,
       JSON.stringify(ditas.map((u) => u.text).join('').slice(0, 160)));
  }

  console.log('');
  console.log(falhas.length ? falhas.length + ' FALHA(S)' : 'todos os testes passaram');
  process.exit(falhas.length ? 1 : 0);
})();
