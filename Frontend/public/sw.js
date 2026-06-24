// IFMS service worker — conservative app-shell caching.
// Writes are NEVER cached (offline writes are handled by Dexie + the sync engine).
const CACHE = 'ifms-shell-v1';
const SHELL = ['/'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept writes
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // only same-origin
  if (url.pathname.startsWith('/api/')) return; // API hits network; offline is handled by Dexie

  // Navigations: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Static assets: cache-first, then populate.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        const cacheable =
          res.ok &&
          (url.pathname.startsWith('/_next/') ||
            /\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?)$/.test(url.pathname));
        if (cacheable) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
