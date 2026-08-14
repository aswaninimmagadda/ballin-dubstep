/**
 * GymFlow admin service worker.
 * Conservative by design: static assets are cached (cache-first), all data
 * and pages stay network-only so staff never act on silently-stale business
 * data. When navigation fails offline, a friendly offline page is shown.
 */
const CACHE = 'gymflow-static-v1';
const OFFLINE_URL = '/offline.html';
const STATIC = [OFFLINE_URL, '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Immutable build assets: cache-first.
  if (url.pathname.startsWith('/_next/static/') || STATIC.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Page navigations: network-only with an offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
  // Everything else (API/data): untouched — never serve stale business data.
});
