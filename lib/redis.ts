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
