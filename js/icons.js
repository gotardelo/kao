/* TDAHZEI — ícones SVG inline (sem dependências externas).
   Uso no HTML: <i data-ico="chat"></i> → Icons.render() substitui pelo SVG. */
(function (global) {
  'use strict';

  var P = {
    chat:  '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-5A8.4 8.4 0 0 1 4 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 8.4z"/>',
    msg:   '<path d="M4 4h16v12H7l-3 3z"/>',
    grid:  '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    key:   '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2M17 6l2.5 2.5M14.5 8.5 17 11"/>',
    user:  '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    lock:  '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    bolt:  '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18.5h2"/>',
    eye:   '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:'<path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.5 7.6A17 17 0 0 0 2 12s3.6 6 10 6c1.6 0 3-.3 4.2-.9M3 3l18 18"/>',
    plus:  '<path d="M12 5v14M5 12h14"/>',
    x:     '<path d="M6 6l12 12M18 6 6 18"/>',
    menu:  '<path d="M4 7h16M4 12h16M4 17h16"/>',
    exit:  '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    send:  '<path d="M4.5 12 21 3.5 12.5 20l-2-6.5z"/>',
    stop:  '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/>',
    copy:  '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    redo:  '<path d="M3 12a9 9 0 1 1 3 6.7M3 20v-6h6"/>',
    down:  '<path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16"/>',
    chip:  '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    coin:  '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.8c0-1 1.1-1.8 2.5-1.8s2.5.8 2.5 1.8-1.1 1.7-2.5 1.9-2.5.9-2.5 1.9 1.1 1.8 2.5 1.8 2.5-.8 2.5-1.8"/>',
    bulb:  '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"/>',
    pen:   '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
    code:  '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M13.5 4l-3 16"/>',
    brain: '<path d="M12 5a3 3 0 0 0-6 0 3 3 0 0 0-1.5 5.6A3 3 0 0 0 6 16a3 3 0 0 0 6 1zM12 5a3 3 0 0 1 6 0 3 3 0 0 1 1.5 5.6A3 3 0 0 1 18 16a3 3 0 0 1-6 1z"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
    mic:   '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4zM15.5 9.5a3.5 3.5 0 0 1 0 5M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    pencil:'<path d="M4 20h4L20 8l-4-4L4 16z"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8c0 4.8-7 9.2-7 9.2z"/>'
  };

  var Icons = {
    svg: function (name, size) {
      var d = P[name];
      if (!d) return '';
      return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
        '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        d + '</svg>';
    },
    /** Substitui todo <i data-ico="..."> dentro de root pelo SVG correspondente. */
    render: function (root) {
      var nodes = (root || document).querySelectorAll('i[data-ico]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        el.innerHTML = Icons.svg(el.getAttribute('data-ico'), el.getAttribute('data-size'));
        el.removeAttribute('data-ico');
      }
    }
  };

  global.Icons = Icons;
})(window);
