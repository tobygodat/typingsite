// Offline shell for Stilltype. Precaches exactly the files server.mjs serves (tests/sw.test.js checks
// the list) and never touches Supabase or any other cross-origin request. Page navigations and shell
// files are both fetched network-first, refreshing the cache, with the cache as the offline fallback:
// serving scripts and the stylesheet cache-first while the page came from the network ran a new deploy's
// index.html against the previous deploy's app.js, which crashed before drawing the passage. The shell is
// cached as '/' only: Cloudflare answers /index.html with a redirect to /, and a cached redirect can't
// answer a navigation. scripts/build-static.mjs stamps VERSION with a hash of the built files, so each
// deploy installs a fresh cache and drops the old.
const VERSION = 'stilltype-shell-v1';

const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/src/styles.css',
  '/src/account.js',
  '/src/app.js',
  '/src/book-texts.js',
  '/src/books.js',
  '/src/challenge-people-view.js',
  '/src/challenge-people.js',
  '/src/code-snippets.js',
  '/src/compose-caret.js',
  '/src/compose-view.js',
  '/src/compose.js',
  '/src/corpus.js',
  '/src/custom-themes.js',
  '/src/egg.js',
  '/src/fonts.js',
  '/src/ghost-race.js',
  '/src/friends-board.js',
  '/src/graph.js',
  '/src/inbox.js',
  '/src/insights.js',
  '/src/keybindings.js',
  '/src/layouts.js',
  '/src/learner.js',
  '/src/lengths.js',
  '/src/lessons.js',
  '/src/monkeytype.js',
  '/src/motion.js',
  '/src/multiplayer.js',
  '/src/online-race.js',
  '/src/palette.js',
  '/src/profile.js',
  '/src/quote-filters.js',
  '/src/progress-view.js',
  '/src/run-counts.js',
  '/src/quick-match.js',
  '/src/quick-match-view.js',
  '/src/race-options.js',
  '/src/race-result.js',
  '/src/race-review.js',
  '/src/rank-card.js',
  '/src/replay-view.js',
  '/src/settings.js',
  '/src/sound.js',
  '/src/tape.js',
  '/src/theme-editor.js',
  '/src/train-path.js',
  '/src/typing.js',
  '/src/units.js',
  '/src/wallpaper.js',
  '/src/week-change.js',
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
  const key = request.mode === 'navigate' ? '/' : url.pathname;

  // Font choices other than the default are left out of the precache and kept once a page has used them.
  if (!SHELL.includes(key) && !key.startsWith('/src/fonts/')) return;
  event.respondWith(fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(VERSION).then((cache) => cache.put(key, copy)));
      }

      return response;
    })
    .catch(() => caches.match(key)));
});
