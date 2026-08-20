/* ============================================================
   Kao — servidor estático para desenvolvimento
   Uso:  node server.js  [porta]
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) {           // nada de subir de diretório
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — não encontrado');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    }).end(data);
  });
});

function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('');
  console.log('  Kao rodando');
  console.log('  ────────────────────────────────────────────');
  console.log('  Desktop:  http://localhost:' + PORT);
  if (ip) console.log('  Celular:  http://' + ip + ':' + PORT + '   (mesma rede Wi-Fi)');
  console.log('');
  console.log('  Atenção: no celular, por HTTP puro o navegador bloqueia a');
  console.log('  WebCrypto. Para uso real no celular, publique em HTTPS');
  console.log('  (Netlify, Cloudflare Pages, GitHub Pages...). Veja o README.');
  console.log('');
});
