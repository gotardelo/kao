/* ============================================================
   TDAHZEI — markdown mínimo e seguro
   Regra de ouro: escapa o HTML PRIMEIRO, formata depois.
   Nada do que o modelo devolve vira HTML executável.
   ============================================================ */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Formatação inline: código, negrito, itálico, riscado, link. */
  function inline(t) {
    return t
      .replace(/`([^`\n]+)`/g, function (_, c) { return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function tableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
  }

  /**
   * Converte markdown em HTML.
   * @param {string} src
   * @param {boolean} streaming  se true, um bloco de código ainda aberto é renderizado mesmo assim.
   */
  function render(src, streaming) {
    var lines = esc(src || '').split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      /* ---- bloco de código ---- */
      var fence = line.match(/^\s*```(\w+)?\s*$/);
      if (fence) {
        var lang = fence[1] || '';
        var buf = [];
        i++;
        var closed = false;
        while (i < lines.length) {
          if (/^\s*```\s*$/.test(lines[i])) { closed = true; i++; break; }
          buf.push(lines[i]); i++;
        }
        if (!closed && !streaming) { /* bloco não fechado: mostra assim mesmo */ }
        out.push(
          '<div class="code-block"><div class="code-head">' +
          '<span class="code-lang">' + (lang || 'texto') + '</span>' +
          '<button class="code-copy" data-copy type="button">copiar</button></div>' +
          '<pre><code>' + buf.join('\n') + '</code></pre></div>'
        );
        continue;
      }

      /* ---- tabela ---- */
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        var head = tableRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(tableRow(lines[i])); i++; }
        out.push(
          '<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table>'
        );
        continue;
      }

      /* ---- títulos ---- */
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        var lvl = Math.min(3, h[1].length);
        out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>');
        i++; continue;
      }

      /* ---- separador ---- */
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push('<hr>'); i++; continue; }

      /* ---- citação ---- */
      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>');
        continue;
      }

      /* ---- listas ---- */
      if (/^\s*[-*+]\s+/.test(line)) {
        var ul = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          ul.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>'); i++;
        }
        out.push('<ul>' + ul.join('') + '</ul>');
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        var ol = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          ol.push('<li>' + inline(lines[i].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'); i++;
        }
        out.push('<ol>' + ol.join('') + '</ol>');
        continue;
      }

      /* ---- parágrafo ---- */
      if (!line.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^\s*```/.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) &&
             !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) &&
             !/^\s*>\s?/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push('<p>' + inline(para.join('<br>')) + '</p>');
    }

    return out.join('');
  }

  global.MD = { render: render, escape: esc };
})(window);
