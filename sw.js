// Offline shell for Stilltype. Precaches exactly the files server.mjs serves (tests/sw.test.js checks
// the list), answers them cache-first, fetches page navigations network-first with the cached shell as
// the fallback, and never touches Supabase or any other cross-origin request. scripts/build-static.mjs
// stamps VERSION with a hash of the built files, so each deploy installs a fresh cache and drops the old.
const VERSION = 'stilltype-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/src/styles.css',
  '/src/account.js',
  '/src/app.js',
  '/src/corpus.js',
  '/src/egg.js',
  '/src/graph.js',
  '/src/inbox.js',
  '/src/insights.js',
  '/src/motion.js',
  '/src/multiplayer.js',
  '/src/online-race.js',
  '/src/palette.js',
  '/src/progress-view.js',
  '/src/typing.js',
  '/src/word-highlight.js',
  '/src/words.js',
  '/src/fonts/literata-roman.woff2',
  '/src/fonts/literata-italic.woff2',
  '/src/fonts/geist-mono-400.ttf',
  '/src/fonts/geist-mono-500.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Supabase and every other origin go straight to the network, uncached.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(VERSION).then((cache) => cache.put('/index.html', copy)));
        }
        return response;
      })
      .catch(() => caches.match('/index.html')));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(request)));
});
