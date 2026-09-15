// ── Cached weather/farm recommendations ────────────────────────────────────
// Each regeneration is a paid AI call WITH web search, so these cards cannot
// be produced per page view — a farmer opening the weather screen five times
// in a morning must not cost five searches. One row per farm (and one for the
// tenant-wide "all farms" view), replaced when it goes stale.
//
// A table rather than Redis on purpose: Redis is optional in this deployment
// (lib/redis.ts returns null with no Upstash env vars), and a cache that
// silently stops caching turns a 6-hourly cost into a per-view one. This is
// the one thing here that must not quietly degrade.
import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const weatherAdvice = pgTable('weather_advice', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  // Null means the tenant-wide view ('ALL' in the UI's farm switcher) — a
  // real farm id scopes the cards to that farm's batches and its own forecast.
  farmId: text('farm_id'),
  // The parsed Recommendation[] (lib/farm-advice.ts). Stored parsed, not as
  // the raw completion: the parse is defensive and a card that failed it must
  // never reach a farmer later just because it sat in a cache.
  payload: jsonb('payload').$type<unknown[]>().notNull().default([]),
  model: text('model').notNull().default(''),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
}, (t) => [
  index('idx_weather_advice_tenant').on(t.tenantId),
  // One cached set per farm. `coalesce` is not available in an index
  // expression here, so the tenant-wide row (farmId null) is handled by the
  // route's own upsert-by-lookup rather than this constraint.
  uniqueIndex('idx_weather_advice_tenant_farm').on(t.tenantId, t.farmId),
])
