/* ============================================================
   TDAHZEI — o seu boneco

   A ideia: a memória do app não é só uma lista de fatos. Conforme ele
   aprende quem você é, isso vira gente — um retrato que muda.

   Três fontes alimentam a ficha, nesta ordem de prioridade:
     1. o que VOCÊ ajustou à mão            (nunca é sobrescrito)
     2. o que o modelo definiu conversando  (ferramenta atualizar_avatar)
     3. o que dá para deduzir dos fatos     (varredura por palavra-chave)

   O desenho é SVG montado por camadas: nítido em qualquer tamanho,
   custo zero e muda na hora, sem esperar imagem de API nenhuma.
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     PALETAS
     ============================================================ */
  var PELES = {
    clara:  { base: '#f2d3bd', sombra: '#e0b89c', traco: '#c99672' },
    media:  { base: '#e0ac86', sombra: '#c98f68', traco: '#a9714d' },
    oliva:  { base: '#c9915f', sombra: '#ad7748', traco: '#8c5c33' },
    morena: { base: '#a06841', sombra: '#8a5432', traco: '#6d4022' },
    negra:  { base: '#6b4230', sombra: '#573322', traco: '#3f2317' }
  };

  var CABELOS = {
    preto:    '#1c1a1c',
    castanho: '#4a3226',
    loiro:    '#d6a75c',
    ruivo:    '#a8442a',
    grisalho: '#b9b9be',
    colorido: '#7b5cff'
  };

  var OLHOS = {
    castanho: '#5a3a22', preto: '#221c1a', azul: '#3d7ea6',
    verde: '#4a7d52', mel: '#a5762f'
  };

  /* Fundos que abrem por nível — é a recompensa de continuar aparecendo. */
  var SKINS = [
    { id: 'grafite', nome: 'Grafite',      nivel: 1,  de: '#2c2c2e', para: '#1d1d1f' },
    { id: 'noite',   nome: 'Noite',        nivel: 3,  de: '#1a2340', para: '#0b1020' },
    { id: 'aurora',  nome: 'Aurora',       nivel: 5,  de: '#123a3a', para: '#0a1f2e' },
    { id: 'oceano',  nome: 'Oceano',       nivel: 8,  de: '#0d3b5c', para: '#071d2e' },
    { id: 'brasa',   nome: 'Brasa',        nivel: 12, de: '#4a1f14', para: '#1d0c08' },
    { id: 'ouro',    nome: 'Ouro puro',    nivel: 18, de: '#5c4310', para: '#241a06' }
  ];

  var PADRAO = {
    pele: 'media',
    cabelo: 'curto',
    cabeloCor: 'castanho',
    olhos: 'castanho',
    barba: 'nenhuma',
    oculos: 'nenhum',
    roupa: 'camiseta',
    roupaCor: '#3a3a3c',
    acessorios: [],
    companhia: 'nenhuma',
    objeto: 'nenhum',
    expressao: 'neutro',
    skin: 'grafite'
  };

  /* ============================================================
     DEDUÇÃO A PARTIR DOS FATOS

     Regra de ouro: só mexe no que ainda não foi definido. O palpite
     nunca ganha do que você ou o modelo disseram com todas as letras.
     ============================================================ */
  var PISTAS = [
    // cabelo
    { campo: 'cabelo', valor: 'careca',   re: /\b(careca|raspei a cabe|cabe(ç|c)a raspada)\b/i },
    { campo: 'cabelo', valor: 'raspado',  re: /\b(cabelo raspado|m(á|a)quina zero|corte militar)\b/i },
    { campo: 'cabelo', valor: 'crespo',   re: /\bcrespo|black power|cabelo afro\b/i },
    { campo: 'cabelo', valor: 'cacheado', re: /\bcachead|cacho|ondulad/i },
    { campo: 'cabelo', valor: 'longo',    re: /\bcabelo (bem )?(comprido|longo)|cabelo(o)? at(é|e) o ombro\b/i },
    { campo: 'cabelo', valor: 'coque',    re: /\b(coque|rabo de cavalo|prende o cabelo)\b/i },
    { campo: 'cabelo', valor: 'curto',    re: /\bcabelo curto\b/i },
    // cor do cabelo
    { campo: 'cabeloCor', valor: 'loiro',    re: /\bloir(o|a)\b/i },
    { campo: 'cabeloCor', valor: 'ruivo',    re: /\bruiv(o|a)|cabelo vermelho\b/i },
    { campo: 'cabeloCor', valor: 'grisalho', re: /\bgrisalho|cabelo branco|cabelo cinza\b/i },
    { campo: 'cabeloCor', valor: 'preto',    re: /\bcabelo preto\b/i },
    { campo: 'cabeloCor', valor: 'colorido', re: /\bcabelo (azul|rosa|roxo|verde|colorido)\b/i },
    // barba
    { campo: 'barba', valor: 'cheia',      re: /\bbarba (cheia|grande|longa)\b/i },
    { campo: 'barba', valor: 'cavanhaque', re: /\bcavanhaque|bigode\b/i },
    { campo: 'barba', valor: 'curta',      re: /\bbarba\b/i },
    // óculos
    { campo: 'oculos', valor: 'redondo',  re: /\b(óculos|oculos) redond/i },
    { campo: 'oculos', valor: 'quadrado', re: /\b(uso|usa|tenho) (óculos|oculos)|\b(óculos|oculos) de grau|miopia|astigmatismo\b/i },
    // pele
    { campo: 'pele', valor: 'negra',  re: /\b(sou|é) (negr|pret)(o|a)\b/i },
    { campo: 'pele', valor: 'morena', re: /\b(sou|é) moren(o|a)|pele morena\b/i },
    { campo: 'pele', valor: 'clara',  re: /\bpele (clara|branca)|\b(sou|é) branc(o|a)\b/i },
    // roupa
    { campo: 'roupa', valor: 'jaleco',  re: /\b(enfermeir|m(é|e)dic|dentista|laborat(ó|o)rio|farmac)/i },
    { campo: 'roupa', valor: 'terno',   re: /\b(advogad|banc(á|a)rio|corporativ|escrit(ó|o)rio formal|vendedor)/i },
    { campo: 'roupa', valor: 'moletom', re: /\b(trabalho em casa|home ?office|programador|dev\b|freelanc|estudante)/i },
    { campo: 'roupa', valor: 'regata',  re: /\b(academia|muscula(ç|c)(ã|a)o|treino|crossfit)/i },
    // acessórios
    { campo: '+acessorios', valor: 'fone',    re: /\b(fone|headphone|escuto|m(ú|u)sica|lofi|podcast)/i },
    { campo: '+acessorios', valor: 'bone',    re: /\b(bon(é|e))\b/i },
    { campo: '+acessorios', valor: 'brinco',  re: /\bbrinco|piercing\b/i },
    { campo: '+acessorios', valor: 'relogio', re: /\b(rel(ó|o)gio|smartwatch|apple watch)\b/i },
    { campo: '+acessorios', valor: 'tatuagem',re: /\btatuage|tattoo\b/i },
    // companhia
    { campo: 'companhia', valor: 'gato',    re: /\b(gato|gata|felin|michi)\b/i },
    { campo: 'companhia', valor: 'cachorro',re: /\b(cachorr|cadela|dog\b|vira-?lata)\b/i },
    { campo: 'companhia', valor: 'planta',  re: /\b(planta|suculenta|jardim|horta)\b/i },
    // objeto na mão
    { campo: 'objeto', valor: 'cafe',      re: /\b(caf(é|e)|expresso|cafeína|cafeina)\b/i },
    { campo: 'objeto', valor: 'remedio',   re: /\b(ritalina|venvanse|concerta|medica(ç|c)(ã|a)o|rem(é|e)dio)\b/i },
    { campo: 'objeto', valor: 'violao',    re: /\b(viol(ã|a)o|guitarra|toco|banda)\b/i },
    { campo: 'objeto', valor: 'livro',     re: /\b(livro|leitura|TCC|faculdade|estudo)\b/i },
    { campo: 'objeto', valor: 'notebook',  re: /\b(notebook|computador|c(ó|o)digo|programa)\b/i }
  ];

  function textoDeContexto(uid, perfil) {
    var partes = [];
    var p = perfil || {};
    if (p.bio) partes.push(p.bio);
    if (p.rotina) partes.push(p.rotina);
    if (p.objetivos) partes.push(p.objetivos);
    if (p.diagnostico) partes.push(p.diagnostico);
    if (p.travas && p.travas.length) partes.push(p.travas.join(' '));

    try {
      var mem = global.Memoria && Memoria.tudo(uid);
      if (mem && mem.fatos) {
        mem.fatos.forEach(function (f) { partes.push(f.texto); });
      }
    } catch (_) {}

    return partes.join(' \n ');
  }

  /** Palpites a partir do texto livre. Devolve só o que conseguiu deduzir. */
  function deduzir(texto) {
    var achados = {};
    var acess = [];
    for (var i = 0; i < PISTAS.length; i++) {
      var p = PISTAS[i];
      if (!p.re.test(texto)) continue;
      if (p.campo.charAt(0) === '+') {
        if (acess.indexOf(p.valor) === -1) acess.push(p.valor);
      } else if (!(p.campo in achados)) {
        achados[p.campo] = p.valor;      // a primeira pista vence
      }
    }
    if (acess.length) achados.acessorios = acess;
    return achados;
  }

  /* ============================================================
     FICHA
     ============================================================ */
  function guardado(uid) {
    return Store.read(Store.keys.avatar(uid), { manual: {}, modelo: {}, skin: '' });
  }

  function salvar(uid, dados) {
    Store.write(Store.keys.avatar(uid), dados);
    return dados;
  }

  function nivelDe(uid) {
    try { return (Store.Progress.get(uid) || {}).level || 1; } catch (_) { return 1; }
  }

  /** A ficha final, já com as três camadas resolvidas. */
  function ficha(uid, perfil) {
    var g = guardado(uid);
    var deduzido = deduzir(textoDeContexto(uid, perfil));
    var f = Object.assign({}, PADRAO, deduzido, g.modelo || {}, g.manual || {});

    // acessórios somam em vez de substituir
    var todos = []
      .concat(deduzido.acessorios || [])
      .concat((g.modelo || {}).acessorios || [])
      .concat((g.manual || {}).acessorios || []);
    f.acessorios = todos.filter(function (a, i) { return todos.indexOf(a) === i; });

    // skin precisa estar liberada pelo nível
    var nivel = nivelDe(uid);
    var skin = skinDe(g.skin || f.skin);
    if (skin.nivel > nivel) skin = SKINS[0];
    f.skin = skin.id;
    f.nivel = nivel;

    return f;
  }

  function skinDe(id) {
    for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
    return SKINS[0];
  }

  /** Quantos traços já foram descobertos — o "quanto ele te conhece". */
  function tracos(uid, perfil) {
    var f = ficha(uid, perfil);
    var n = 0;
    ['pele', 'cabelo', 'cabeloCor', 'olhos', 'barba', 'oculos', 'roupa', 'companhia', 'objeto']
      .forEach(function (c) { if (f[c] && f[c] !== 'nenhuma' && f[c] !== 'nenhum') n++; });
    return n + f.acessorios.length;
  }

  /* ============================================================
     ESCRITA
     ============================================================ */
  var CAMPOS = ['pele', 'cabelo', 'cabeloCor', 'olhos', 'barba', 'oculos',
                'roupa', 'roupaCor', 'companhia', 'objeto', 'expressao'];

  function limpar(patch) {
    var out = {};
    CAMPOS.forEach(function (c) {
      if (patch[c] !== undefined && patch[c] !== null && patch[c] !== '') out[c] = String(patch[c]);
    });
    if (Array.isArray(patch.acessorios)) {
      out.acessorios = patch.acessorios.map(String).slice(0, 6);
    }
    return out;
  }

  /** Usado pela ferramenta: o modelo aprendeu algo e registra. */
  function aprender(uid, patch) {
    var g = guardado(uid);
    g.modelo = Object.assign({}, g.modelo, limpar(patch || {}));
    salvar(uid, g);
    return g.modelo;
  }

  /** Usado pela interface: você mexeu à mão, e isso manda em tudo. */
  function ajustar(uid, patch) {
    var g = guardado(uid);
    g.manual = Object.assign({}, g.manual, limpar(patch || {}));
    salvar(uid, g);
    return g.manual;
  }

  function usarSkin(uid, id) {
    var s = skinDe(id);
    if (s.nivel > nivelDe(uid)) return false;
    var g = guardado(uid);
    g.skin = s.id;
    salvar(uid, g);
    return true;
  }

  function esquecer(uid) {
    localStorage.removeItem(Store.keys.avatar(uid));
  }

  /* ============================================================
     DESENHO

     Tudo em um viewBox de 200x220, montado de trás para a frente:
     fundo, corpo, pescoço, cabeça, cabelo de trás, rosto, cabelo da
     frente, barba, óculos, acessórios, bicho e objeto.
     ============================================================ */
  function esc(s) { return String(s).replace(/[&<>"]/g, ''); }

  /* O tronco começa em y=160 e vai até a base: assim os ombros aparecem
     inteiros, e a gola tem onde pousar. */
  var TRONCO = 'M46 220 q6-54 54-62 q48 8 54 62 z';

  function corpo(f, pele) {
    var c = esc(f.roupaCor || '#3a3a3c');

    if (f.roupa === 'regata') {
      return '<path d="' + TRONCO + '" fill="' + pele.base + '"/>' +
             '<path d="M46 220 q6-54 54-62 q48 8 54 62 z" fill="' + pele.base + '"/>' +
             '<path d="M72 220 q2-40 28-46 q26 6 28 46 z" fill="' + c + '"/>' +
             '<path d="M86 158 q14 22 28 0 q-14 30 -28 0 z" fill="' + pele.base + '"/>';
    }

    var gola = '';
    if (f.roupa === 'camisa') {
      gola = '<path d="M86 162 L100 184 L114 162 L108 158 L100 172 L92 158 Z" fill="#f5f5f7"/>';
    }
    if (f.roupa === 'jaleco') {
      c = '#eef1f5';
      gola = '<path d="M90 162 L100 184 L110 162" stroke="#c8cdd6" stroke-width="2.5" fill="none"/>';
    }
    if (f.roupa === 'terno') {
      gola = '<path d="M86 160 L100 182 L114 160 L108 157 L100 170 L92 157 Z" fill="#f5f5f7"/>' +
             '<path d="M82 164 L100 190 L118 164 L118 220 L82 220 Z" fill="#1c1c1e"/>' +
             '<path d="M97 186 h6 v34 h-6 z" fill="#8e8e93"/>';
      c = '#2c2c2e';
    }
    if (f.roupa === 'moletom') {
      gola = '<path d="M78 166 q22 20 44 0 q-6 16 -22 16 q-16 0 -22 -16 z" fill="' + c + '" opacity=".55"/>';
    }

    return '<path d="' + TRONCO + '" fill="' + c + '"/>' + gola;
  }

  function cabeloTras(f, cor) {
    switch (f.cabelo) {
      case 'longo':
        return '<path d="M52 100 q0-58 48-58 q48 0 48 58 q0 44 -8 62 l-16 -4 q6-30 4-54 l-56 0 q-2 24 4 54 l-16 4 q-8-18 -8-62 z" fill="' + cor + '"/>';
      case 'crespo':
        return '<circle cx="100" cy="86" r="56" fill="' + cor + '"/>';
      case 'cacheado':
        return '<path d="M50 96 q0-54 50-54 q50 0 50 54 q0 22 -6 32 q-4-26 -14-34 q-12 10 -30 10 q-18 0 -30-10 q-10 8 -14 34 q-6-10 -6-32 z" fill="' + cor + '"/>';
      case 'coque':
        return '<circle cx="100" cy="40" r="15" fill="' + cor + '"/>';
      default:
        return '';
    }
  }

  function cabeloFrente(f, cor) {
    switch (f.cabelo) {
      case 'careca':
        return '';
      case 'raspado':
        return '<path d="M58 92 q0-44 42-44 q42 0 42 44 q-8-24 -42-24 q-34 0 -42 24 z" fill="' + cor + '" opacity=".55"/>';
      case 'curto':
        return '<path d="M56 96 q0-50 44-50 q44 0 44 50 q-10-30 -44-30 q-34 0 -44 30 z" fill="' + cor + '"/>';
      case 'medio':
        return '<path d="M54 100 q0-54 46-54 q46 0 46 54 q-6-34 -26-38 q-8 12 -34 10 q-20-2 -26 8 q-4 6 -6 20 z" fill="' + cor + '"/>';
      case 'cacheado':
        return '<path d="M54 98 q4-28 16-36 q10 12 30 12 q20 0 30-12 q12 8 16 36 q-8-22 -20-24 q-12 8 -26 8 q-14 0 -26-8 q-12 2 -20 24 z" fill="' + cor + '"/>';
      case 'crespo':
        return '';
      case 'coque':
        return '<path d="M56 96 q0-50 44-50 q44 0 44 50 q-10-30 -44-30 q-34 0 -44 30 z" fill="' + cor + '"/>';
      case 'longo':
        return '<path d="M54 96 q0-52 46-52 q46 0 46 52 q-10-32 -32-34 q-10 10 -32 8 q-16-2 -22 10 q-4 6 -6 16 z" fill="' + cor + '"/>';
      default:
        return '<path d="M56 96 q0-50 44-50 q44 0 44 50 q-10-30 -44-30 q-34 0 -44 30 z" fill="' + cor + '"/>';
    }
  }

  function boca(f, pele) {
    switch (f.expressao) {
      case 'sorriso': return '<path d="M88 124 q12 12 24 0" stroke="' + pele.traco + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
      case 'cansado': return '<path d="M89 128 q11 -5 22 0" stroke="' + pele.traco + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
      case 'foco':    return '<path d="M90 127 h20" stroke="' + pele.traco + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
      default:        return '<path d="M90 126 q10 6 20 0" stroke="' + pele.traco + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
    }
  }

  function olhos(f) {
    var cor = OLHOS[f.olhos] || OLHOS.castanho;
    var fechados = f.expressao === 'cansado';
    if (fechados) {
      return '<path d="M76 104 q8 5 16 0" stroke="#3a2a20" stroke-width="3" fill="none" stroke-linecap="round"/>' +
             '<path d="M108 104 q8 5 16 0" stroke="#3a2a20" stroke-width="3" fill="none" stroke-linecap="round"/>';
    }
    return '<ellipse cx="84" cy="104" rx="7" ry="8" fill="#fff"/>' +
           '<ellipse cx="116" cy="104" rx="7" ry="8" fill="#fff"/>' +
           '<circle cx="85" cy="105" r="4" fill="' + cor + '"/>' +
           '<circle cx="117" cy="105" r="4" fill="' + cor + '"/>' +
           '<circle cx="86.5" cy="103" r="1.4" fill="#fff"/>' +
           '<circle cx="118.5" cy="103" r="1.4" fill="#fff"/>';
  }

  function sobrancelhas(f) {
    var y = f.expressao === 'foco' ? 92 : 90;
    var inc = f.expressao === 'foco' ? 3 : 0;
    return '<path d="M75 ' + y + ' q9 -5 18 ' + (-1 + inc) + '" stroke="#3a2a20" stroke-width="3" fill="none" stroke-linecap="round"/>' +
           '<path d="M107 ' + (y - 1 + inc) + ' q9 -4 18 ' + (1 - inc) + '" stroke="#3a2a20" stroke-width="3" fill="none" stroke-linecap="round"/>';
  }

  function barba(f, cor) {
    switch (f.barba) {
      case 'cheia':
        return '<path d="M58 108 q2 46 42 50 q40-4 42-50 q-6 30 -42 32 q-36-2 -42-32 z" fill="' + cor + '"/>';
      case 'curta':
        return '<path d="M60 110 q4 36 40 40 q36-4 40-40 q-8 24 -40 26 q-32-2 -40-26 z" fill="' + cor + '" opacity=".55"/>';
      case 'cavanhaque':
        return '<path d="M90 132 q10 10 20 0 q-2 16 -10 18 q-8-2 -10-18 z" fill="' + cor + '"/>' +
               '<path d="M88 120 q12 -6 24 0" stroke="' + cor + '" stroke-width="4" fill="none" stroke-linecap="round"/>';
      default:
        return '';
    }
  }

  function oculos(f) {
    if (f.oculos === 'redondo') {
      return '<g fill="none" stroke="#e8e8ed" stroke-width="3">' +
             '<circle cx="84" cy="104" r="14"/><circle cx="116" cy="104" r="14"/>' +
             '<path d="M98 104 h4"/><path d="M70 100 l-10 -4"/><path d="M130 100 l10 -4"/></g>';
    }
    if (f.oculos === 'quadrado') {
      return '<g fill="none" stroke="#e8e8ed" stroke-width="3">' +
             '<rect x="70" y="93" width="28" height="22" rx="5"/>' +
             '<rect x="102" y="93" width="28" height="22" rx="5"/>' +
             '<path d="M98 104 h4"/><path d="M70 99 l-10 -3"/><path d="M130 99 l10 -3"/></g>';
    }
    return '';
  }

  /** O que gruda na cabeça — anda junto com ela. */
  function acessoriosCabeca(f) {
    var out = '';
    if (f.acessorios.indexOf('fone') > -1) {
      out += '<g><path d="M52 100 q0-52 48-52 q48 0 48 52" stroke="#e8e8ed" stroke-width="6" fill="none" stroke-linecap="round"/>' +
             '<rect x="42" y="94" width="18" height="30" rx="8" fill="#2c2c2e" stroke="#e8e8ed" stroke-width="2"/>' +
             '<rect x="140" y="94" width="18" height="30" rx="8" fill="#2c2c2e" stroke="#e8e8ed" stroke-width="2"/></g>';
    }
    if (f.acessorios.indexOf('bone') > -1) {
      out += '<g><path d="M54 88 q0-46 46-46 q46 0 46 46 z" fill="#0071e3"/>' +
             '<path d="M44 88 q12-10 56-10 q44 0 56 10 q-14 8 -56 8 q-42 0 -56 -8 z" fill="#005bb8"/></g>';
    }
    if (f.acessorios.indexOf('brinco') > -1) {
      out += '<circle cx="57" cy="120" r="4" fill="#ffd60a"/>';
    }
    return out;
  }

  /** O que fica no tronco — não pode subir com a cabeça. */
  function acessoriosCorpo(f) {
    if (f.acessorios.indexOf('tatuagem') === -1) return '';
    return '<path d="M112 150 q9 10 4 22 q-9 -8 -4 -22 z" fill="#1c1c1e" opacity=".45"/>';
  }

  function companhia(f) {
    if (f.companhia === 'gato') {
      return '<g transform="translate(12,152)">' +
             '<ellipse cx="14" cy="34" rx="15" ry="12" fill="#5a5a5f"/>' +
             '<circle cx="14" cy="18" r="11" fill="#5a5a5f"/>' +
             '<path d="M5 10 l1 -9 l7 5 z M23 10 l-1 -9 l-7 5 z" fill="#5a5a5f"/>' +
             '<circle cx="10" cy="18" r="2" fill="#ffd60a"/><circle cx="18" cy="18" r="2" fill="#ffd60a"/>' +
             '<path d="M28 32 q12 -4 8 -18" stroke="#5a5a5f" stroke-width="5" fill="none" stroke-linecap="round"/></g>';
    }
    if (f.companhia === 'cachorro') {
      return '<g transform="translate(10,152)">' +
             '<ellipse cx="16" cy="34" rx="17" ry="13" fill="#8a6a4a"/>' +
             '<circle cx="16" cy="17" r="12" fill="#8a6a4a"/>' +
             '<ellipse cx="5" cy="15" rx="4" ry="8" fill="#6d5238"/>' +
             '<ellipse cx="27" cy="15" rx="4" ry="8" fill="#6d5238"/>' +
             '<circle cx="12" cy="16" r="2" fill="#1c1c1e"/><circle cx="20" cy="16" r="2" fill="#1c1c1e"/>' +
             '<ellipse cx="16" cy="22" rx="3" ry="2.2" fill="#1c1c1e"/></g>';
    }
    if (f.companhia === 'planta') {
      return '<g transform="translate(14,158)">' +
             '<path d="M8 40 h20 l-3 -16 h-14 z" fill="#a8643c"/>' +
             '<path d="M18 24 q-14 -6 -12 -20 q12 2 12 20 z" fill="#30d158"/>' +
             '<path d="M18 24 q14 -8 12 -22 q-12 4 -12 22 z" fill="#28b84c"/>' +
             '<path d="M18 24 q0 -16 0 -22" stroke="#28b84c" stroke-width="3" fill="none"/></g>';
    }
    return '';
  }

  function objeto(f) {
    if (f.objeto === 'cafe') {
      return '<g transform="translate(146,166)">' +
             '<path d="M0 6 h26 v18 a8 8 0 0 1 -8 8 h-10 a8 8 0 0 1 -8 -8 z" fill="#f5f5f7"/>' +
             '<path d="M26 12 q10 0 10 8 q0 8 -10 8" stroke="#f5f5f7" stroke-width="3" fill="none"/>' +
             '<path d="M6 0 q3 -5 0 -8 M14 0 q3 -5 0 -8" stroke="#8e8e93" stroke-width="2" fill="none" stroke-linecap="round"/></g>';
    }
    if (f.objeto === 'livro') {
      return '<g transform="translate(146,172)">' +
             '<path d="M0 4 h32 v26 h-32 z" fill="#0071e3"/>' +
             '<path d="M0 4 h32 v4 h-32 z" fill="#2997ff"/>' +
             '<path d="M6 12 h20 M6 18 h20 M6 24 h13" stroke="#fff" stroke-width="2" opacity=".7"/></g>';
    }
    if (f.objeto === 'remedio') {
      return '<g transform="translate(148,174)">' +
             '<rect x="0" y="0" width="24" height="26" rx="5" fill="#f5f5f7"/>' +
             '<rect x="0" y="0" width="24" height="7" rx="3" fill="#ff453a"/>' +
             '<path d="M12 12 v10 M7 17 h10" stroke="#ff453a" stroke-width="3" stroke-linecap="round"/></g>';
    }
    if (f.objeto === 'violao') {
      return '<g transform="translate(142,158)">' +
             '<ellipse cx="16" cy="30" rx="15" ry="13" fill="#c1873f"/>' +
             '<ellipse cx="16" cy="20" rx="11" ry="10" fill="#c1873f"/>' +
             '<circle cx="16" cy="28" r="5" fill="#5c3a16"/>' +
             '<path d="M16 10 v-14 h4 v14" fill="#5c3a16"/></g>';
    }
    if (f.objeto === 'notebook') {
      return '<g transform="translate(140,176)">' +
             '<path d="M2 2 h34 v20 h-34 z" fill="#2c2c2e" stroke="#8e8e93" stroke-width="1.5"/>' +
             '<path d="M0 22 h38 v4 h-38 z" fill="#8e8e93"/></g>';
    }
    return '';
  }

  /**
   * Devolve o SVG completo do boneco.
   * @param {object} f       ficha (de Avatar.ficha)
   * @param {number} tamanho lado em px
   * @param {object} opts    { fundo:false } para desenhar sem o cartão
   */
  function svg(f, tamanho, opts) {
    f = Object.assign({}, PADRAO, f || {});
    f.acessorios = f.acessorios || [];
    opts = opts || {};

    var pele = PELES[f.pele] || PELES.media;
    var cabeloCor = CABELOS[f.cabeloCor] || CABELOS.castanho;
    var skin = skinDe(f.skin);
    var id = 'av' + Math.random().toString(36).slice(2, 8);
    var lado = tamanho || 120;

    var fundo = opts.fundo === false ? '' :
      '<defs><linearGradient id="g' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + skin.de + '"/><stop offset="1" stop-color="' + skin.para + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="200" height="220" rx="26" fill="url(#g' + id + ')"/>';

    return '<svg class="av-svg" viewBox="0 0 200 220" width="' + lado + '" height="' + Math.round(lado * 1.1) +
           '" role="img" aria-label="Seu avatar">' +
      fundo +
      '<clipPath id="c' + id + '"><rect width="200" height="220" rx="26"/></clipPath>' +
      '<g clip-path="url(#c' + id + ')">' +
        /* pescoço primeiro: o tronco passa por cima e a emenda some */
        '<rect x="90" y="120" width="20" height="50" fill="' + pele.sombra + '"/>' +
        corpo(f, pele) +
        acessoriosCorpo(f) +
        /* a cabeça e tudo que gruda nela sobem juntos */
        '<g transform="translate(0,-16)">' +
          cabeloTras(f, cabeloCor) +
          '<ellipse cx="100" cy="100" rx="44" ry="50" fill="' + pele.base + '"/>' +
          '<ellipse cx="57" cy="108" rx="7" ry="9" fill="' + pele.base + '"/>' +
          '<ellipse cx="143" cy="108" rx="7" ry="9" fill="' + pele.base + '"/>' +
          barba(f, cabeloCor) +
          sobrancelhas(f) +
          olhos(f) +
          '<path d="M100 106 q-4 12 2 13" stroke="' + pele.traco + '" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
          boca(f, pele) +
          cabeloFrente(f, cabeloCor) +
          oculos(f) +
          acessoriosCabeca(f) +
        '</g>' +
        companhia(f) +
        objeto(f) +
      '</g></svg>';
  }

  /* ============================================================
     DESCRIÇÃO EM PALAVRAS (vai no prompt, para ele saber o que sabe)
     ============================================================ */
  var ROTULOS = {
    pele:      { clara: 'pele clara', media: 'pele média', oliva: 'pele oliva', morena: 'pele morena', negra: 'pele negra' },
    cabelo:    { curto: 'cabelo curto', medio: 'cabelo médio', longo: 'cabelo longo', cacheado: 'cabelo cacheado',
                 crespo: 'cabelo crespo', raspado: 'cabelo raspado', coque: 'cabelo preso em coque', careca: 'careca' },
    cabeloCor: { preto: 'preto', castanho: 'castanho', loiro: 'loiro', ruivo: 'ruivo', grisalho: 'grisalho', colorido: 'colorido' },
    barba:     { nenhuma: '', curta: 'barba curta', cheia: 'barba cheia', cavanhaque: 'cavanhaque' },
    oculos:    { nenhum: '', redondo: 'óculos redondos', quadrado: 'óculos' },
    roupa:     { camiseta: 'camiseta', moletom: 'moletom', camisa: 'camisa', jaleco: 'jaleco', terno: 'terno', regata: 'regata' },
    companhia: { nenhuma: '', gato: 'tem um gato', cachorro: 'tem um cachorro', planta: 'cuida de plantas' },
    objeto:    { nenhum: '', cafe: 'café por perto', livro: 'livro por perto', remedio: 'medicação por perto',
                 violao: 'violão por perto', notebook: 'notebook por perto' },
    acessorio: { fone: 'usa fone', bone: 'usa boné', brinco: 'usa brinco', relogio: 'usa relógio', tatuagem: 'tem tatuagem' }
  };

  function descrever(f) {
    var L = [];
    if (ROTULOS.pele[f.pele]) L.push(ROTULOS.pele[f.pele]);
    if (ROTULOS.cabelo[f.cabelo]) {
      L.push(ROTULOS.cabelo[f.cabelo] + (f.cabelo === 'careca' ? '' : ' ' + (ROTULOS.cabeloCor[f.cabeloCor] || '')));
    }
    ['barba', 'oculos', 'companhia', 'objeto'].forEach(function (c) {
      var r = ROTULOS[c] && ROTULOS[c][f[c]];
      if (r) L.push(r);
    });
    if (ROTULOS.roupa[f.roupa]) L.push('costuma usar ' + ROTULOS.roupa[f.roupa]);
    (f.acessorios || []).forEach(function (a) {
      if (ROTULOS.acessorio[a]) L.push(ROTULOS.acessorio[a]);
    });
    return L.filter(Boolean).join(', ');
  }

  /** Só o valor, sem repetir o nome do campo — para a grade do perfil. */
  var CURTOS = {
    pele:      { clara: 'clara', media: 'média', oliva: 'oliva', morena: 'morena', negra: 'negra' },
    cabelo:    { curto: 'curto', medio: 'médio', longo: 'longo', cacheado: 'cacheado',
                 crespo: 'crespo', raspado: 'raspado', coque: 'coque', careca: 'careca' },
    cabeloCor: { preto: 'preto', castanho: 'castanho', loiro: 'loiro', ruivo: 'ruivo',
                 grisalho: 'grisalho', colorido: 'colorido' },
    olhos:     { castanho: 'castanhos', preto: 'pretos', azul: 'azuis', verde: 'verdes', mel: 'cor de mel' },
    barba:     { nenhuma: '—', curta: 'curta', cheia: 'cheia', cavanhaque: 'cavanhaque' },
    oculos:    { nenhum: '—', redondo: 'redondos', quadrado: 'sim' },
    roupa:     { camiseta: 'camiseta', moletom: 'moletom', camisa: 'camisa',
                 jaleco: 'jaleco', terno: 'terno', regata: 'regata' },
    companhia: { nenhuma: '—', gato: 'um gato', cachorro: 'um cachorro', planta: 'plantas' },
    objeto:    { nenhum: '—', cafe: 'café', livro: 'livro', remedio: 'medicação',
                 violao: 'violão', notebook: 'notebook' }
  };

  global.Avatar = {
    CURTOS: CURTOS,
    PADRAO: PADRAO,
    SKINS: SKINS,
    PELES: PELES,
    CABELOS: CABELOS,
    OLHOS: OLHOS,
    ROTULOS: ROTULOS,
    ficha: ficha,
    tracos: tracos,
    svg: svg,
    descrever: descrever,
    aprender: aprender,
    ajustar: ajustar,
    usarSkin: usarSkin,
    skinDe: skinDe,
    esquecer: esquecer,
    /** Skins com a marca de quem já liberou. */
    skinsDe: function (uid) {
      var n = nivelDe(uid);
      return SKINS.map(function (s) {
        return { id: s.id, nome: s.nome, nivel: s.nivel, liberada: s.nivel <= n };
      });
    }
  };
})(window);
