/* ============================================================
   TDAHZEI — service worker
   Estratégia: network-first para a casca do app (pega atualizações
   assim que existem) com cache como rede de segurança offline.
   Nada de API é cacheado — /api/ e a OpenAI sempre vão à rede.

   Princípio: o cache é um bônus, nunca um requisito. Se o
   CacheStorage estiver indisponível (modo anônimo, cota estourada,
   navegador com restrição), o worker instala do mesmo jeito e o app
   segue funcionando online.
   ============================================================ */
const CACHE = 'tdahzei-v25';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/persona.css',
  './css/vida.css',
  './css/neuro.css',
  './js/icons.js',
  './js/persona.js',
  './js/avatar.js',
  './js/wizard.js',
  './js/vida.js',
  './js/memoria.js',
  './js/financas.js',
  './js/ferramentas.js',
  './js/store.js',
  './js/auth.js',
  './js/claude.js',
  './js/voz.js',
  './js/ambiente.js',
  './js/markdown.js',
  './js/app.js',
  './icons/icon.svg'
];

/** Guarda o que der. Um arquivo que falhe não derruba os outros. */
async function preencherCache() {
  try {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* esse arquivo fica de fora, sem drama */ }
    }));
  } catch (e) {
    /* CacheStorage indisponível: segue sem cache offline */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(preencherCache().then(() => self.skipWaiting()));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    } catch (e) { /* idem */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fora do app: sempre rede
  if (url.pathname.startsWith('/api/')) return;      // proxy da OpenAI: nunca cacheia

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (erroDeRede) {
      try {
        const hit = await caches.match(req);
        if (hit) return hit;
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      } catch (e) { /* sem cache para oferecer */ }
      throw erroDeRede;                              // deixa o navegador mostrar o erro real
    }
  })());
});
