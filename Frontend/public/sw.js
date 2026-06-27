// IFMS service worker — conservative, deploy-safe app-shell caching.
// Writes are NEVER cached (offline writes are handled by Dexie + the sync engine).
//
// Bump CACHE on every meaningful release: a new value changes this file's bytes,
// so browsers fetch the new SW, `activate` deletes the old cache (clearing any
// stale build assets), and clients reload (see PWARegister) onto the fresh build.
const CACHE = 'ifms-shell-v2';
const SHELL = ['/'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;             // never intercept writes
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // only same-origin
  if (url.pathname.startsWith('/api/')) return;      // APIs always hit the network

  // Navigations (HTML): network-first so a logged-in/out state is never stale;
  // fall back to the cached shell only when truly offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((r) => r || caches.match('/'))));
    return;
  }

  // Only content-hashed, immutable build assets are cache-first (safe — a given
  // URL never changes content). Everything else goes to the network.
  const immutable = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')
    || /\.(?:png|jpg|jpeg|svg|webp|woff2?)$/.test(url.pathname);
  if (!immutable) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {}); }
      return res;
    }))
  );
});
