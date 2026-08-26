// ── Optional Redis client (Upstash) ──────────────────────────────────────────
// Used for rate-limiting when the env vars are configured. Falls back to the
// existing DB-backed implementation when Redis is absent, so production can
// opt in without a code deploy.
import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

export function getRedis(): Redis | null {
  if (_redis) return _redis

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  _redis = new Redis({ url, token })
  return _redis
}

export const isRedisConfigured = () => getRedis() !== null

// ── Report cache helpers (scalability audit item A) ──────────────────────────
// Reports are expensive to compute — lib/reports.ts's compute* functions load
// every matching row for the period and aggregate in JS — and are often
// re-requested within seconds by the same tenant (a screen re-render, a user
// tabbing between report types and back). When Redis is configured, cache the
// computed payload for REPORT_CACHE_TTL_SECONDS; when Redis is absent (no
// Upstash env vars), getCachedReport/setCachedReport are no-ops and every
// route behaves exactly as it did before this cache existed.
//
// TTL is 60 seconds, not the 5 minutes a generic HTTP cache might reach for.
// These are money figures (P&L, batch margins): a farmer who just recorded a
// sale or approved an expense should see it reflected within about a minute,
// not be looking at a stale P&L for five. 60s still meaningfully absorbs the
// "re-render / tab back and forth" burst this cache exists for.
const REPORT_CACHE_TTL_SECONDS = 60

// Non-negotiable: this app is multi-tenant, and a cache key collision here
// means one tenant's browser could be served another tenant's cached
// financial report — far worse than the slow report this cache exists to
// avoid. The key therefore binds tenantId, report type, farmId and the exact
// resolved date range, in that order, each segment separated by `:`. Every
// segment is either a UUID-shaped id (no `:` possible) or an ISO date /
// literal 'all' (also no `:` possible), so no segment can smuggle a `:` that
// would make two logically-different keys collide on the same string — see
// tests/report-cache.test.ts's "cannot collide across tenants" case.
export function reportCacheKey(type: string, tenantId: string, from: string, to: string, farmId: string | undefined): string {
  return `report:${type}:${tenantId}:${from}:${to}:${farmId ?? 'all'}`
}

export async function getCachedReport<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  if (!redis) return null
  const raw = await redis.get<T>(key)
  return raw ?? null
}

export async function setCachedReport(key: string, value: unknown): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.setex(key, REPORT_CACHE_TTL_SECONDS, value as any)
}
