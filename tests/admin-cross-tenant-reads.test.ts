// ── A platform admin can LIST a tenant's data, not just write it ────────────
// The bug: GET /api/farms, /api/units and /api/batches each called
// requireTenantSession() with no explicitTenantId. A super_admin session
// carries tenantId: null, so that call could never resolve a tenant for them —
// it returned 400 "tenantId is required" while the sibling POST/PATCH on the
// same resource happily accepted the field. The admin screens were passing
// `?tenantId=` all along and it was being ignored, so a platform admin could
// create and edit a tenant's farms but never view them.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('server-only', () => ({}))

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const ROUTES = ['app/api/farms/route.ts', 'app/api/units/route.ts', 'app/api/batches/route.ts']

describe('super_admin can resolve a tenant on these list endpoints', () => {
  it.each(ROUTES)('%s passes the query tenantId through to the guard', (path) => {
    const src = read(path)
    // The bare call is the bug. Every requireTenantSession in these files must
    // name a tenant source.
    expect(src).not.toMatch(/requireTenantSession\(\)/)
    expect(src).toMatch(/requireTenantSession\(\{ explicitTenantId: new URL\(req\.url\)\.searchParams\.get\('tenantId'\)/)
  })
})

describe('lib/api-auth.ts — the opt-in cannot become a cross-tenant hole', () => {
  const src = read('lib/api-auth.ts')

  it('a tenant-scoped session ignores any tenantId the caller names', () => {
    // This is what stops a worker reading another tenant by adding a query
    // param: the session's own tenantId is returned before explicitTenantId is
    // even looked at.
    const sessionWins = src.indexOf('if (session.tenantId) return { session, tenantId: session.tenantId }')
    const explicitRead = src.indexOf('opts.explicitTenantId')
    expect(sessionWins).toBeGreaterThan(-1)
    expect(sessionWins).toBeLessThan(explicitRead)
  })

  it('still refuses a super_admin who names no tenant', () => {
    expect(src).toMatch(/return \{ error: tenantRequired\(\) \}/)
  })

  it('never reads the tenantId out of the request itself', () => {
    // The call site must pass it, so cross-tenant access stays a deliberate,
    // greppable decision per route rather than a blanket fallback.
    // Asserted against CODE, not prose: this module's header quotes the old
    // `searchParams.get('tenantId')` anti-pattern it exists to replace, so a
    // bare /searchParams/ match would fail on its own documentation.
    expect(src).not.toMatch(/req\.url/)
    expect(src).not.toMatch(/new URL\(/)
  })
})
