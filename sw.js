// Offline support. Bump VERSION on every deploy so phones fetch the new files.
const VERSION = '1.7.0';
const CACHE = 'vokabeltrainer-' + VERSION;
const FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/core.js',
  './js/game.js',
  './js/ui.js',
  './js/store.js',
  './js/i18n.js',
  './js/builtin-lists.js',
  './js/streak.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './fonts/source-serif-4-latin-opsz-normal.woff2',
  './fonts/source-serif-4-cyrillic-opsz-normal.woff2',
  './fonts/manrope-latin-wght-normal.woff2',
  './fonts/manrope-cyrillic-wght-normal.woff2',
  './fonts/jetbrains-mono-latin-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vokabeltrainer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
