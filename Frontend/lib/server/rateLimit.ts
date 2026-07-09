// In-memory token-bucket rate limiter for API routes.
// Kept simple — no Redis dependency for the MVP. Resets on server restart.
// Use Redis-backed throttling (DRF) on the Celery/Python tier per ARCHITECTURE §8.
//
// Each key (IP or user-id) gets a bucket of `max` tokens, refilling at `windowMs / max` per request.
// When empty, requests are rejected. Buckets are cleaned up after `windowMs` of inactivity.

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const CLEAN_INTERVAL = 60_000; // sweep stale buckets every 60s
let lastClean = Date.now();

function refill(b: Bucket, max: number, windowMs: number): Bucket {
  const elapsed = Date.now() - b.lastRefill;
  const add = (elapsed / windowMs) * max;
  return { tokens: Math.min(max, b.tokens + add), lastRefill: Date.now() };
}

function cleanStale(windowMs: number) {
  if (Date.now() - lastClean < CLEAN_INTERVAL) return;
  lastClean = Date.now();
  const cutoff = Date.now() - windowMs * 2;
  for (const [key, b] of buckets) {
    if (b.lastRefill < cutoff) buckets.delete(key);
  }
}

/**
 * Check if a request is within rate limits.
 *
 * @param key - unique identifier (IP address, user ID, or session ID)
 * @param max - maximum requests in the window
 * @param windowMs - time window in milliseconds (default: 60000 = 1 minute)
 * @returns `{ allowed: true }` or `{ allowed: false, retryAfter: number }` (seconds until retry)
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number = 60_000,
): { allowed: true } | { allowed: false; retryAfter: number } {
  cleanStale(windowMs);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: max, lastRefill: Date.now() };
    buckets.set(key, bucket);
  }

  bucket = refill(bucket, max, windowMs);
  buckets.set(key, bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }

  const retryAfter = Math.ceil((windowMs - (Date.now() - bucket.lastRefill) + windowMs) / 1000);
  return { allowed: false, retryAfter: Math.max(1, retryAfter) };
}

/**
 * Extract a client identifier from a Request object.
 * Prefers X-Forwarded-For header, falls back to a hash of available headers.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  // Fallback: hash the user-agent + accept headers for a rough identifier
  const ua = req.headers.get('user-agent') ?? 'unknown';
  const accept = req.headers.get('accept') ?? '';
  let hash = 0;
  const s = `${ua}:${accept}`;
  for (let i = 0; i < s.length; i++) { hash = ((hash << 5) - hash) + s.charCodeAt(i); hash |= 0; }
  return `ip:${Math.abs(hash).toString(16)}`;
}

// Convenience wrappers for common rate-limit profiles.

/** Strict: 5 attempts per minute (configurable via RATE_LIMIT_LOGIN_MAX) — for login endpoints (brute-force protection). */
export function checkLoginRateLimit(req: Request): { allowed: true } | { allowed: false; retryAfter: number } {
  const max = Number(process.env.RATE_LIMIT_LOGIN_MAX) || 5;
  return checkRateLimit(`login:${clientIp(req)}`, max, 60_000);
}

/** Moderate: 30 writes per minute — for data submission endpoints. */
export function checkWriteRateLimit(req: Request): { allowed: true } | { allowed: false; retryAfter: number } {
  return checkRateLimit(`write:${clientIp(req)}`, 30, 60_000);
}

/** Generous: 100 reads per minute — for read endpoints. */
export function checkReadRateLimit(req: Request): { allowed: true } | { allowed: false; retryAfter: number } {
  return checkRateLimit(`read:${clientIp(req)}`, 100, 60_000);
}
