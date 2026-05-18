// Service Worker — Agent HQ PWA (Sprint 1 #3 of 2026-05-17 council audit)
//
// Strategy:
//   - Pre-cache the app shell (root + icons + manifest) on install.
//   - Navigations: network-first, fall back to cached shell when offline.
//   - Static assets (.js, .css, .svg, .png, .webmanifest): cache-first,
//     update in background.
//   - Selected read-only APIs (active listings, sphere overdue, hot leads):
//     stale-while-revalidate so the offline screens Jonathan picked work
//     even with no signal.
//   - Everything else: pass through to network (POST never gets cached).
//
// Bump CACHE_VERSION on any change to invalidate old caches.

const CACHE_VERSION = 'aghq-v1';
const APP_SHELL = [
  '/',
  '/favicon.svg',
  '/agent-hq-logo.png',
  '/manifest.webmanifest',
];

const OFFLINE_API_PATTERNS = [
  '/api/listings/active',
  '/api/sphere/overdue',
  '/api/lead-heat',
  '/api/listings',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Skip /admin/* and /voice — these are server-rendered HTML routes that
  // should always be fresh from the server.
  if (url.pathname.startsWith('/admin/') || url.pathname === '/voice') return;

  // SPA navigations: network-first with shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache successful HTML for offline shell fallback
          if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || new Response(
          '<h1>Offline</h1><p>Agent HQ is unreachable. Reconnect to sync.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        )))
    );
    return;
  }

  // Static assets: cache-first.
  if (/\.(svg|png|js|css|webmanifest|woff2?|ttf)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Offline-allowed APIs: stale-while-revalidate.
  if (OFFLINE_API_PATTERNS.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached || new Response(
          JSON.stringify({ offline: true, error: 'no network and no cached response' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ));
        return cached || network;
      })
    );
    return;
  }

  // Default: pass through.
});
