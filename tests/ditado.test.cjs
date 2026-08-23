/* Testa o Persona.Ditado com um SpeechRecognition falso.
   Foco: o onend do reconhecedor antigo nao pode roubar o lugar do novo. */
const fs = require('fs');
const vm = require('vm');

const falhas = [];
function ok(nome, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + nome + (cond ? '' : '  << ' + (extra || '')));
  if (!cond) falhas.push(nome);
}

const criados = [];
function FakeSR() {
  this.lang = ''; this.continuous = false; this.interimResults = false;
  this.started = false; this.stopped = false;
  criados.push(this);
}
FakeSR.prototype.start = function () {
  if (this.started) throw new Error('InvalidStateError');
  this.started = true;
};
FakeSR.prototype.stop = function () {
  this.stopped = true;
};
FakeSR.prototype.emitirResultado = function (texto, final) {
  this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: texto }], { isFinal: final })] });
};
FakeSR.prototype.emitirFim = function () { if (this.onend) this.onend(); };

const win = { SpeechRecognition: FakeSR, isSecureContext: true, setTimeout, clearTimeout, console };
win.window = win;
vm.createContext(win);
vm.runInContext(fs.readFileSync('js/persona.js', 'utf8'), win, { filename: 'persona.js' });

const Ditado = win.Persona.Ditado;

ok('ditado disponivel com SpeechRecognition e contexto seguro', Ditado.disponivel() === true);

// --- primeira escuta
let fim1 = null;
const abriu1 = Ditado.iniciar(function () {}, function (texto) { fim1 = texto; });
ok('primeira escuta abriu', abriu1 === true);
ok('marcado como ativo', Ditado.ativo() === true);

const rec1 = criados[0];
rec1.emitirResultado('quero organizar a semana', true);

// Paramos e comecamos a proxima ANTES do onend do anterior chegar,
// que e exatamente o que acontece no navegador de verdade.
Ditado.parar();
ok('parar solta o lugar na hora', Ditado.ativo() === false);

let fim2 = null;
const abriu2 = Ditado.iniciar(function () {}, function (texto) { fim2 = texto; });
ok('segunda escuta abriu', abriu2 === true);
const rec2 = criados[1];
ok('segunda escuta usa outro reconhecedor', rec1 !== rec2);
ok('segunda escuta esta ativa', Ditado.ativo() === true);

// Agora o onend atrasado do PRIMEIRO chega.
rec1.emitirFim();
ok('o fim do antigo entrega o texto dele', fim1 === 'quero organizar a semana ', JSON.stringify(fim1));
ok('o fim do antigo NAO derruba o novo', Ditado.ativo() === true);

// E o novo segue funcionando.
rec2.emitirResultado('e comecar pelo email', true);
rec2.emitirFim();
ok('o novo entrega o texto dele', fim2 === 'e comecar pelo email ', JSON.stringify(fim2));
ok('depois do fim do novo, ninguem esta ativo', Ditado.ativo() === false);

// start() recusado nao pode deixar lixo para tras.
const travado = new FakeSR();
travado.started = true;
console.log('');
console.log(falhas.length ? falhas.length + ' FALHA(S)' : 'todos os testes passaram');
process.exit(falhas.length ? 1 : 0);
