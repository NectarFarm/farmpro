// A UUID that also works in INSECURE browser contexts — e.g. a worker's phone on
// http://<lan-ip>:13000. There, `crypto.randomUUID()` is unavailable (it's gated to
// secure contexts: HTTPS or localhost), so calling it throws and every offline
// record save would fail. `crypto.getRandomValues()` IS available in insecure
// contexts, so we fall back to building an RFC-4122 v4 id from it (and to Math.random
// only if even that is missing). On the server (Node) randomUUID is always present.
export function uuid(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* some browsers expose it only in secure contexts → fall through */ }
  }
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
