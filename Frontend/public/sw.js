// IFMS service worker — conservative, deploy-safe app-shell caching.
// Writes are NEVER cached (offline writes are handled by Dexie + the sync engine).
//
// Bump CACHE on every meaningful release: a new value changes this file's bytes,
// so browsers fetch the new SW, `activate` deletes the old cache (clearing any
// stale build assets), and clients reload (see PWARegister) onto the fresh build.
const CACHE = 'ifms-shell-v3';
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

// Background Sync (Phase 2.3) — progressive enhancement so the outbox can
// flush even if the app is closed/backgrounded (unsupported on iOS/Firefox;
// the in-app interval in useSync() remains the primary delivery path there).
// Plain script, deliberately NOT using Dexie: a service worker is a separate
// execution context, so this talks to the same IndexedDB database with raw
// IDB calls instead.
self.addEventListener('sync', (event) => {
  if (event.tag === 'ifms-flush') event.waitUntil(flushOutbox());
});

function openOutboxDB() {
  return new Promise((resolve, reject) => {
    // No version arg — opening with an explicit version can trigger an
    // upgrade race against the page's own Dexie connection to the same
    // database. Omitting it just opens whatever version already exists.
    const req = indexedDB.open('ifms_worker_db');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function flushOutbox() {
  let db;
  try { db = await openOutboxDB(); } catch { return; }
  if (!db.objectStoreNames.contains('pending')) { db.close(); return; }
  try {
    const pending = await idbReq(db.transaction('pending', 'readonly').objectStore('pending').index('status').getAll('pending'));
    if (!pending.length) return;
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: pending.map((r) => ({ clientUuid: r.clientUuid, type: r.type, payload: JSON.parse(r.payload), capturedAt: r.capturedAt })) }),
    });
    // 5xx/network → throw so the browser reschedules this sync event; 4xx
    // (including 401 session-expiry) → leave records as 'pending' for the
    // in-app flow to classify and handle on next login/attempt.
    if (!res.ok) { if (res.status >= 500) throw new Error('retryable'); return; }
    const body = await res.json();
    const conflict = new Set((body.conflicts || []).map((c) => c.clientUuid));
    const rejected = new Map((body.rejected || []).map((r) => [r.clientUuid, r.error]));
    const store = db.transaction('pending', 'readwrite').objectStore('pending');
    for (const r of pending) {
      r.status = rejected.has(r.clientUuid) ? 'rejected' : conflict.has(r.clientUuid) ? 'conflict' : 'synced';
      if (rejected.has(r.clientUuid)) r.error = rejected.get(r.clientUuid);
      store.put(r);
    }
    (await self.clients.matchAll({ type: 'window' })).forEach((c) => c.postMessage({ type: 'ifms-synced' }));
  } finally {
    db.close();
  }
}
