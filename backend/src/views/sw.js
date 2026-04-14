/**
 * Agent Dashboard service worker.
 * Strategy:
 *   - HTML / CSS / JS / icons: stale-while-revalidate (fast boot, fresh in bg)
 *   - /api/daily-brief: network-first, falls back to last cache when offline
 *   - Everything else: network-only
 *
 * Bump CACHE_VERSION whenever we ship a breaking change to the shell.
 */
const CACHE_VERSION = 'agent-v1';
const SHELL = [
  '/dashboard',
  '/dashboard/assets/dashboard.css',
  '/dashboard/assets/dashboard.js',
  '/dashboard/assets/dashboard.render.js',
  '/dashboard/assets/dashboard.actions.js',
  '/dashboard/assets/icon-192.svg',
  '/dashboard/assets/icon-512.svg',
  '/dashboard/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // Daily brief: network-first, fallback to cache
  if (url.pathname === '/api/daily-brief') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Shell assets: stale-while-revalidate
  if (url.pathname === '/dashboard' ||
      url.pathname.startsWith('/dashboard/assets/') ||
      url.pathname === '/dashboard/manifest.json') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else: let browser / network handle it
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', offline: true }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const fetchAndUpdate = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchAndUpdate;
}
