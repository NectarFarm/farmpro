// ── Enterprise scoping rules ───────────────────────────────────────────────
// The rule under test: what a farmer selected when they applied is what their
// account offers, and widening it goes through an admin. The two behaviours
// worth pinning down are the refusal itself and the EMPTY-SET escape hatch —
// get the latter backwards and the migration bricks every pre-existing tenant.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Minimal chainable stand-in for the one query lib/enterprises.ts runs.
let rows: { enterprise: string; source: string; createdAt: Date }[] = []
vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve(rows) }),
      }),
    }),
  },
}))

import {
  enterpriseRefusalReason, isValidEnterpriseKey, MAX_ENTERPRISE_KEY_CHARS,
  normalizeEnterprise, tenantEnterpriseSet,
} from '@/lib/enterprises'

const scoped = (...keys: string[]) => keys.map((enterprise) => ({ enterprise, source: 'onboarding', createdAt: new Date(0) }))

beforeEach(() => { rows = [] })

describe('normalizeEnterprise()', () => {
  it('lower-cases and trims so a grant cannot create a near-duplicate row', () => {
    // The unique index treats these as distinct; normalising is what stops
    // "Dairy_Cow" and "dairy_cow" both existing for one tenant.
    expect(normalizeEnterprise('  Dairy_Cow ')).toBe('dairy_cow')
    expect(normalizeEnterprise('BROILER')).toBe('broiler')
  })

  it('returns empty string for anything that is not a string', () => {
    for (const bad of [null, undefined, 7, {}, []]) expect(normalizeEnterprise(bad)).toBe('')
  })
})

describe('isValidEnterpriseKey()', () => {
  it('matches the bound POST /api/onboard-requests validates against', () => {
    expect(isValidEnterpriseKey('layer')).toBe(true)
    expect(isValidEnterpriseKey('')).toBe(false)
    expect(isValidEnterpriseKey('x'.repeat(MAX_ENTERPRISE_KEY_CHARS))).toBe(true)
    expect(isValidEnterpriseKey('x'.repeat(MAX_ENTERPRISE_KEY_CHARS + 1))).toBe(false)
  })
})

describe('tenantEnterpriseSet()', () => {
  it('collapses the rows to the set the guard checks against', async () => {
    rows = scoped('broiler', 'layer')
    expect([...(await tenantEnterpriseSet('t1'))].sort()).toEqual(['broiler', 'layer'])
  })
})

describe('enterpriseRefusalReason()', () => {
  it('allows an enterprise the tenant was approved for', async () => {
    rows = scoped('broiler', 'layer')
    expect(await enterpriseRefusalReason('t1', 'broiler')).toBeNull()
  })

  it('refuses one the tenant was not approved for, and names the way forward', async () => {
    rows = scoped('broiler')
    const reason = await enterpriseRefusalReason('t1', 'dairy_cow')
    expect(reason).toBeTruthy()
    // A dead end would be worse than the old permissive behaviour — the
    // refusal has to tell the farmer that an admin can add it.
    expect(reason).toMatch(/dairy_cow/)
    expect(reason).toMatch(/administrator/i)
  })

  it('normalises before comparing, so casing is not a refusal', async () => {
    rows = scoped('dairy_cow')
    expect(await enterpriseRefusalReason('t1', ' Dairy_Cow ')).toBeNull()
  })

  it('EMPTY SET MEANS UNRESTRICTED — a tenant with no rows is not locked out', async () => {
    // This is the rule that keeps every pre-0035 tenant working. Inverting it
    // would refuse a tenant its own first batch, for a reason the farmer can
    // neither see nor fix.
    rows = []
    expect(await enterpriseRefusalReason('t1', 'anything')).toBeNull()
  })

  it('defers an empty enterprise to the route\'s own required-field check', async () => {
    rows = scoped('broiler')
    // Not this module's job to say "enterprise is required" — POST
    // /api/batches already does, with a 400 rather than a 403.
    expect(await enterpriseRefusalReason('t1', '')).toBeNull()
  })
})
