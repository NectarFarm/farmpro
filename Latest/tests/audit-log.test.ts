// ── Audit log read route tests (issue #244) ─────────────────────────────────
// Integration tests that call the real route handler against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/tasks-governance.test.ts.
//
// Covers: tenant scoping, newest-first ordering, limit/offset pagination, and
// that the actor id an approve/reject decision wrote (lib/governance.ts) is
// resolved to a real name via the users join.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as auditLogGET } from '@/app/api/audit-log/route'
import { db } from '@/db'
import { tenants, users, sessions, auditLog } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('GET /api/audit-log (issue #244)', () => {
  const tenantAId = `t-audit-${randomUUID()}`
  const tenantBId = `t-audit-${randomUUID()}`

  const ownerEmail = `owner-audit-${randomUUID()}@test.ifms`
  const ownerId = randomUUID()
  // issue #302: a second, differently-roled actor so the route's `actorRole`
  // join (and the Activity Log role-filter chips it powers) has a real,
  // non-trivial subset to narrow down to.
  const workerEmail = `worker-audit-${randomUUID()}@test.ifms`
  const workerId = randomUUID()

  let ownerSessionToken: string
  const rowIds: string[] = []

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Audit Test Co. A', active: true },
      { id: tenantBId, name: 'Audit Test Co. B', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values([
      {
        id: ownerId, tenantId: tenantAId, name: 'Audit Owner', email: ownerEmail,
        role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
      {
        id: workerId, tenantId: tenantAId, name: 'Audit Worker', email: workerEmail,
        role: 'worker', passwordHash: hashSecret('wrkpw', salt), passwordSalt: salt, status: 'ACTIVE',
      },
    ])
    ownerSessionToken = await createSession(ownerId)

    // Three rows for tenant A (real actor = ownerId, resolvable via the users
    // join), spaced out so `at desc` ordering is unambiguous, plus one row for
    // tenant B to prove tenant scoping excludes it.
    for (let i = 0; i < 3; i++) {
      const id = randomUUID()
      rowIds.push(id)
      await db.insert(auditLog).values({
        id,
        tenantId: tenantAId,
        actor: ownerId,
        action: `test.action.${i}`,
        entity: 'test_entity',
        entityId: `entity-${i}`,
        meta: { i },
        at: new Date(Date.now() + i * 1000),
      })
    }
    // One more row for tenant A, actor = the worker, so the response contains
    // a real mix of actor roles to filter over.
    const workerRowId = randomUUID()
    rowIds.push(workerRowId)
    await db.insert(auditLog).values({
      id: workerRowId,
      tenantId: tenantAId,
      actor: workerId,
      action: 'test.action.worker',
      entity: 'test_entity',
      entityId: 'entity-worker',
      meta: {},
      at: new Date(Date.now() + 4000),
    })
    const otherTenantRowId = randomUUID()
    rowIds.push(otherTenantRowId)
    await db.insert(auditLog).values({
      id: otherTenantRowId,
      tenantId: tenantBId,
      actor: randomUUID(),
      action: 'test.action.other-tenant',
      entity: 'test_entity',
      entityId: 'entity-other',
      meta: {},
    })
  })

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.id, rowIds))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, workerId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  it('requires a tenantId when there is no session', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(
      await auditLogGET(new Request('http://localhost/api/audit-log'))
    )
    expect(status).toBe(400)
    expect(payload.success).toBe(false)
  })

  it('lists only the caller tenant\'s rows, newest first, with the actor name resolved', async () => {
    mockCookie = ownerSessionToken
    const { status, payload } = await readJson(
      await auditLogGET(new Request('http://localhost/api/audit-log'))
    )
    expect(status).toBe(200)
    expect(payload.success).toBe(true)
    const rows = payload.data as { tenantId: string; action: string; actorName: string | null; at: string }[]

    expect(rows.every((r) => r.tenantId === tenantAId)).toBe(true)
    expect(rows.some((r) => r.action === 'test.action.other-tenant')).toBe(false)

    const ours = rows.filter((r) => /^test\.action\.\d+$/.test(r.action))
    expect(ours.map((r) => r.action)).toEqual(['test.action.2', 'test.action.1', 'test.action.0'])
    expect(ours[0].actorName).toBe('Audit Owner')
  })

  // ── issue #302: Activity Log's role-filter chips ──────────────────────────
  // GovernanceScreen filters the already-fetched rows by `entry.actorRole ===
  // activityRoleFilter`. This proves the route resolves a real `actorRole`
  // per row (via the same `users` join as actorName/actorEmail) and that
  // applying that exact filter predicate narrows the set to a real subset —
  // not all rows, not zero rows.
  it('resolves a real actorRole per row, and filtering by it narrows to a real subset', async () => {
    mockCookie = ownerSessionToken
    const { status, payload } = await readJson(
      await auditLogGET(new Request('http://localhost/api/audit-log'))
    )
    expect(status).toBe(200)
    const rows = payload.data as { action: string; actorRole: string | null }[]
    const ours = rows.filter((r) => r.action.startsWith('test.action.') && r.action !== 'test.action.other-tenant')

    expect(ours.find((r) => r.action === 'test.action.0')?.actorRole).toBe('owner')
    expect(ours.find((r) => r.action === 'test.action.worker')?.actorRole).toBe('worker')

    const ownerOnly = ours.filter((r) => r.actorRole === 'owner')
    const workerOnly = ours.filter((r) => r.actorRole === 'worker')
    expect(ownerOnly.length).toBeGreaterThan(0)
    expect(ownerOnly.length).toBeLessThan(ours.length)
    expect(workerOnly.length).toBe(1)
    expect(ownerOnly.every((r) => r.actorRole === 'owner')).toBe(true)
  })

  it('respects limit and offset', async () => {
    mockCookie = ownerSessionToken
    const { payload: page1 } = await readJson(
      await auditLogGET(new Request('http://localhost/api/audit-log?limit=1&offset=0'))
    )
    const { payload: page2 } = await readJson(
      await auditLogGET(new Request('http://localhost/api/audit-log?limit=1&offset=1'))
    )
    expect(page1.data.length).toBe(1)
    expect(page2.data.length).toBe(1)
    expect(page1.data[0].id).not.toBe(page2.data[0].id)
  })

  it('falls back to the tenantId query param in standalone mode', async () => {
    mockCookie = undefined
    const { status, payload } = await readJson(
      await auditLogGET(new Request(`http://localhost/api/audit-log?tenantId=${tenantBId}`))
    )
    expect(status).toBe(200)
    expect(payload.data.some((r: { action: string }) => r.action === 'test.action.other-tenant')).toBe(true)
  })
})
