// ── Auditor / Investor read-only link (issue #313) ──────────────────────────
// Integration tests against the real POST/GET/DELETE /api/auditor-link route
// and the token-gated GET /api/auditor/[token]/reports/[type] route, using a
// real postgres when DATABASE_URL is set (local/dev) — same convention as
// tests/auth.test.ts. CI has no database, so the suite skips there.
//
// Proves the issue's acceptance criteria directly:
//   - generating a link produces a real, working, token-gated read route
//   - it only reads its own tenant's data (cross-tenant check via a real
//     tenant-scoped sales figure in the P&L report's meta)
//   - revoking invalidates it immediately
//   - an expired link is refused
//   - the token-gated route can never write (module-shape check: no
//     POST/PUT/PATCH/DELETE export exists on that route file at all)
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import {
  DELETE as auditorLinkDELETE,
  GET as auditorLinkGET,
  POST as auditorLinkPOST,
} from '@/app/api/auditor-link/route'
import * as auditorReportRouteModule from '@/app/api/auditor/[token]/reports/[type]/route'
import { GET as auditorReportGET } from '@/app/api/auditor/[token]/reports/[type]/route'
import { db } from '@/db'
import { auditorLinks, sales, sessions, tenants, users } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import type { ReportPayload } from '@/lib/report-types'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

async function callReportRoute(token: string, type = 'pl') {
  const req = new Request(`http://localhost/api/auditor/${token}/reports/${type}`)
  const res = await auditorReportGET(req, { params: Promise.resolve({ token, type }) })
  const payload = await res.json()
  return { status: res.status, payload: payload as { success: boolean; data?: ReportPayload; error?: string } }
}

run('auditor-link (issue #313)', () => {
  const tenantAId = `t-aud-a-${randomUUID()}`
  const tenantBId = `t-aud-b-${randomUUID()}`
  const ownerAId = randomUUID()
  const ownerBId = randomUUID()
  const workerAId = randomUUID()
  const ownerAEmail = `owner-a-${randomUUID()}@test.ifms`
  const ownerBEmail = `owner-b-${randomUUID()}@test.ifms`
  const workerAEmail = `worker-a-${randomUUID()}@test.ifms`
  let ownerASessionToken = ''
  let ownerBSessionToken = ''
  let workerASessionToken = ''
  const saleAId = randomUUID()
  const saleBId = randomUUID()

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Auditor Test Farm A', active: true },
      { id: tenantBId, name: 'Auditor Test Farm B', active: true },
    ])

    const salt = (n: number) => `salt-aud-${n}-${randomUUID()}`
    const sA = salt(1)
    const sB = salt(2)
    const sW = salt(3)

    await db.insert(users).values([
      { id: ownerAId, tenantId: tenantAId, name: 'Owner A', email: ownerAEmail, role: 'owner', passwordHash: hashSecret('pw', sA), passwordSalt: sA, status: 'ACTIVE' },
      { id: ownerBId, tenantId: tenantBId, name: 'Owner B', email: ownerBEmail, role: 'owner', passwordHash: hashSecret('pw', sB), passwordSalt: sB, status: 'ACTIVE' },
      { id: workerAId, tenantId: tenantAId, name: 'Worker A', email: workerAEmail, role: 'worker', passwordHash: hashSecret('pw', sW), passwordSalt: sW, status: 'ACTIVE' },
    ])

    // A distinctive, tenant-scoped revenue figure per tenant so the report's
    // meta.periodRevenue proves which tenant's data actually came back.
    await db.insert(sales).values([
      { id: saleAId, tenantId: tenantAId, item: 'Tenant A eggs', amount: 111, status: 'paid' },
      { id: saleBId, tenantId: tenantBId, item: 'Tenant B eggs', amount: 999, status: 'paid' },
    ])

    ownerASessionToken = await createSession(ownerAId)
    ownerBSessionToken = await createSession(ownerBId)
    workerASessionToken = await createSession(workerAId)
  })

  afterAll(async () => {
    await db.delete(auditorLinks).where(inArray(auditorLinks.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.token, [ownerASessionToken, ownerBSessionToken, workerASessionToken].filter(Boolean)))
    await db.delete(sales).where(inArray(sales.id, [saleAId, saleBId]))
    await db.delete(users).where(inArray(users.id, [ownerAId, ownerBId, workerAId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
    mockCookie = undefined
  })

  it('rejects generating a link without a session', async () => {
    mockCookie = undefined
    const res = await auditorLinkPOST()
    expect(res.status).toBe(401)
  })

  it('rejects generating a link for a non-owner role', async () => {
    mockCookie = workerASessionToken
    const res = await auditorLinkPOST()
    expect(res.status).toBe(403)
    mockCookie = undefined
  })

  it('an owner can generate a real, working, tenant-scoped read-only link', async () => {
    mockCookie = ownerASessionToken
    const genRes = await auditorLinkPOST()
    const genPayload = await genRes.json()
    mockCookie = undefined

    expect(genRes.status).toBe(200)
    expect(genPayload.success).toBe(true)
    const token: string = genPayload.data.token
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(20)

    // The link reads real data — tenant A's own report, not a placeholder.
    const { status, payload } = await callReportRoute(token, 'pl')
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data?.meta.periodRevenue).toBe(111)

    // GET /api/auditor-link (owner A) reflects this as the tenant's live link.
    mockCookie = ownerASessionToken
    const getRes = await auditorLinkGET()
    const getPayload = await getRes.json()
    mockCookie = undefined
    expect(getPayload.data.link.token).toBe(token)
  })

  it('never allows a write: the token-gated route module exports no POST/PUT/PATCH/DELETE handler', () => {
    const mod = auditorReportRouteModule as Record<string, unknown>
    expect(mod.POST).toBeUndefined()
    expect(mod.PUT).toBeUndefined()
    expect(mod.PATCH).toBeUndefined()
    expect(mod.DELETE).toBeUndefined()
    expect(typeof mod.GET).toBe('function')
  })

  it("only reads its own tenant's data — never another tenant's, even by naming its own live token", async () => {
    mockCookie = ownerASessionToken
    const genA = await auditorLinkPOST()
    const { data: linkA } = await genA.json()
    mockCookie = ownerBSessionToken
    const genB = await auditorLinkPOST()
    const { data: linkB } = await genB.json()
    mockCookie = undefined

    const readA = await callReportRoute(linkA.token, 'pl')
    const readB = await callReportRoute(linkB.token, 'pl')
    expect(readA.payload.data?.meta.periodRevenue).toBe(111)
    expect(readB.payload.data?.meta.periodRevenue).toBe(999)
    expect(readA.payload.data?.meta.periodRevenue).not.toBe(readB.payload.data?.meta.periodRevenue)
  })

  it('revoking a link immediately invalidates it', async () => {
    mockCookie = ownerASessionToken
    const genRes = await auditorLinkPOST()
    const { data } = await genRes.json()
    const token: string = data.token

    // Sanity: works before revoke.
    const before = await callReportRoute(token, 'pl')
    expect(before.status).toBe(200)

    const delRes = await auditorLinkDELETE()
    mockCookie = undefined
    expect(delRes.status).toBe(200)

    const after = await callReportRoute(token, 'pl')
    expect(after.status).toBe(401)
    expect(after.payload.success).toBe(false)
  })

  it('an expired link is refused even though it was never revoked', async () => {
    const token = `expired-token-${randomUUID()}`
    await db.insert(auditorLinks).values({
      id: randomUUID(),
      tenantId: tenantAId,
      token,
      // Already expired — created 9h ago, expired 1h ago.
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 9 * 60 * 60 * 1000),
      revokedAt: null,
    })

    const { status, payload } = await callReportRoute(token, 'pl')
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })

  it('an unknown token is refused', async () => {
    const { status, payload } = await callReportRoute(`no-such-token-${randomUUID()}`, 'pl')
    expect(status).toBe(401)
    expect(payload.success).toBe(false)
  })
})
