// In-memory TTL cache for expensive read routes.
// Same per-serverless-instance caveat as lib/server/rateLimit.ts: not shared
// across instances, resets on cold start. Fine here — this only smooths
// repeat hits within one warm instance (e.g. a dashboard auto-refresh);
// it is never the source of truth and every instance eventually recomputes.
interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/**
 * Return the cached value for `key` if still fresh, otherwise call `compute`,
 * cache the result for `ttlMs`, and return it.
 */
export async function withTtlCache<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const value = await compute();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
