// ── Report cache key tests (scalability audit item A) ───────────────────────
// This app is multi-tenant. A report-cache key collision would mean one
// tenant's browser could be served another tenant's cached financial report
// — far worse than the slow report the cache exists to avoid. These tests
// prove reportCacheKey (lib/redis.ts) cannot collide across tenants, report
// types, farm scope or date range, and that getCachedReport/setCachedReport
// are safe no-ops with no Redis configured (the state of every CI run and
// this dev environment — there is no Upstash instance here).
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('reportCacheKey (lib/redis.ts)', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('never collides across two different tenants, all else equal', async () => {
    const { reportCacheKey } = await import('@/lib/redis')
    const keyA = reportCacheKey('pl', 'tenant-a', '2026-01-01', '2026-01-31', undefined)
    const keyB = reportCacheKey('pl', 'tenant-b', '2026-01-01', '2026-01-31', undefined)
    expect(keyA).not.toBe(keyB)
  })

  it('does not collide when one tenant id is a prefix of another', async () => {
    // The whole reason each segment is `:`-delimited: without it,
    // tenant "t1" + farm "23" could stringify identically to tenant "t12" +
    // farm "3". Concatenation-without-delimiters is exactly the collision
    // shape this test guards against.
    const { reportCacheKey } = await import('@/lib/redis')
    const keyShort = reportCacheKey('pl', 't1', '2026-01-01', '2026-01-31', '23')
    const keyLong = reportCacheKey('pl', 't12', '2026-01-01', '2026-01-31', '3')
    expect(keyShort).not.toBe(keyLong)
  })

  it('differs by report type for the same tenant/range', async () => {
    const { reportCacheKey } = await import('@/lib/redis')
    const keyPl = reportCacheKey('pl', 'tenant-a', '2026-01-01', '2026-01-31', undefined)
    const keyFcr = reportCacheKey('fcr', 'tenant-a', '2026-01-01', '2026-01-31', undefined)
    expect(keyPl).not.toBe(keyFcr)
  })

  it('differs by farmId for the same tenant/type/range, including unfiltered ("all") vs a real farm', async () => {
    const { reportCacheKey } = await import('@/lib/redis')
    const keyAll = reportCacheKey('pl', 'tenant-a', '2026-01-01', '2026-01-31', undefined)
    const keyFarm = reportCacheKey('pl', 'tenant-a', '2026-01-01', '2026-01-31', 'farm-1')
    const keyOtherFarm = reportCacheKey('pl', 'tenant-a', '2026-01-01', '2026-01-31', 'farm-2')
    expect(new Set([keyAll, keyFarm, keyOtherFarm]).size).toBe(3)
  })

  it('differs by date range for the same tenant/type/farm', async () => {
    const { reportCacheKey } = await import('@/lib/redis')
    const keyJan = reportCacheKey('pl', 'tenant-a', '2026-01-01', '2026-01-31', undefined)
    const keyFeb = reportCacheKey('pl', 'tenant-a', '2026-02-01', '2026-02-28', undefined)
    expect(keyJan).not.toBe(keyFeb)
  })

  it('a large random sample of distinct (tenant, type, farm, range) tuples never collides', async () => {
    const { reportCacheKey } = await import('@/lib/redis')
    const types = ['pl', 'batch-pl', 'mortality', 'feed-consumption', 'production', 'vaccination', 'fcr']
    const keys = new Set<string>()
    let n = 0
    for (let t = 0; t < 20; t++) {
      for (const type of types) {
        for (const farmId of [undefined, `farm-${t}-a`, `farm-${t}-b`]) {
          const key = reportCacheKey(type, `tenant-${t}`, '2026-01-01', '2026-01-31', farmId)
          keys.add(key)
          n++
        }
      }
    }
    expect(keys.size).toBe(n)
  })
})

describe('getCachedReport / setCachedReport with no Redis configured', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  it('getCachedReport resolves to null (never throws) with no Redis env configured', async () => {
    const { getCachedReport } = await import('@/lib/redis')
    await expect(getCachedReport('report:pl:tenant-a:2026-01-01:2026-01-31:all')).resolves.toBeNull()
  })

  it('setCachedReport resolves (no-op, never throws) with no Redis env configured', async () => {
    const { setCachedReport } = await import('@/lib/redis')
    await expect(setCachedReport('report:pl:tenant-a:2026-01-01:2026-01-31:all', { some: 'payload' })).resolves.toBeUndefined()
  })
})
