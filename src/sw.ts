declare const self: ServiceWorkerGlobalScope;
declare const __SHELL__: readonly string[];
declare const __FONTS__: readonly string[];
declare const __VERSION__: string;

const VERSION = __VERSION__;
const SHELL = __SHELL__;
const FONTS = __FONTS__;

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

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const key = request.mode === 'navigate' ? '/' : url.pathname;

  if (!SHELL.includes(key) && !FONTS.includes(key)) return;
  event.respondWith(fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(VERSION).then((cache) => cache.put(key, copy)));
      }

      return response;
    })
    .catch(async () => (await caches.match(key)) || Response.error()));
});

export {};
