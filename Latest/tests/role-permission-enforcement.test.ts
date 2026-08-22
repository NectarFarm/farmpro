// ── Role-permission matrix enforcement (role-permission-enforcement task) ──
// Integration tests that call the real route handlers against real Postgres
// (no HTTP server needed), same pattern as tests/farm-scoping.test.ts /
// tests/tasks-governance.test.ts. Skips when DATABASE_URL is unset (CI has
// no database).
//
// Before this task, `lib/permissions.ts`'s `getRoleAccess` ended `?? 'edit'`
// — with `role_permissions` empty (true in production), every role resolved
// to `edit` on every module, and exactly one route (PATCH
// /api/inventory/lots/[id]) even imported the helper, without ever calling
// it. This suite proves the replacement: a code-defined default grid that a
// DB row can override in either direction, actually enforced on write paths.
//
// Covers:
//   - with the table EMPTY, the code defaults apply: manager refused on a
//     payroll/finance write, worker refused on a finance write, auditor
//     refused on every write, owner allowed.
//   - a DB row overrides the default in BOTH directions (grant + revoke).
//   - refusal is a real 403 with the standard envelope, and the underlying
//     row is genuinely unchanged afterwards.
//   - an owner cannot be locked out even by an explicit DB row.
//   - unauthenticated is 401, not 403 — auth is checked before permission.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as tasksPOST } from '@/app/api/tasks/route'
import { PATCH as taskPATCH } from '@/app/api/tasks/[id]/route'
import { POST as salesPOST } from '@/app/api/data/sales/route'
import { db } from '@/db'
import { tenants, users, sessions, tasks, sales, rolePermissions, journalEntries, journalLines } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { getRoleAccess, canEdit, MODULES } from '@/lib/permissions'

const hasDb = !!process.env.DATABASE_URL
const run = hasDb ? describe : describe.skip

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function readJson(res: Response) {
  return { status: res.status, payload: await res.json() }
}

run('role-permission matrix enforcement (role-permission-enforcement task)', () => {
  const tenantId = `t-perm-${randomUUID()}`

  const ownerId = randomUUID()
  const managerId = randomUUID()
  const workerId = randomUUID()
  const auditorId = randomUUID()

  let ownerSession: string
  let managerSession: string
  let workerSession: string
  let auditorSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Permission Test Co.', active: true })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Perm Owner', email: `perm-owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerId, tenantId, name: 'Perm Manager', email: `perm-manager-${randomUUID()}@test.ifms`, role: 'manager', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerId, tenantId, name: 'Perm Worker', email: `perm-worker-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: auditorId, tenantId, name: 'Perm Auditor', email: `perm-auditor-${randomUUID()}@test.ifms`, role: 'auditor', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerSession = await createSession(ownerId)
    managerSession = await createSession(managerId)
    workerSession = await createSession(workerId)
    auditorSession = await createSession(auditorId)
  })

  afterAll(async () => {
    mockCookie = undefined
    const entryRows = await db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    const entryIds = entryRows.map((r) => r.id)
    if (entryIds.length > 0) await db.delete(journalLines).where(inArray(journalLines.entryId, entryIds))
    await db.delete(journalEntries).where(eq(journalEntries.tenantId, tenantId))
    await db.delete(sales).where(eq(sales.tenantId, tenantId))
    await db.delete(tasks).where(eq(tasks.tenantId, tenantId))
    await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerId, workerId, auditorId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerId, workerId, auditorId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  describe('empty table: code defaults apply', () => {
    it('an owner is allowed a finance write and a tasks write', async () => {
      mockCookie = ownerSession
      const saleRes = await readJson(
        await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, item: 'Eggs', amountCents: 5000, status: 'paid' }))
      )
      expect(saleRes.status).toBe(201)

      const taskRes = await readJson(
        await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, title: 'Owner default task' }))
      )
      expect(taskRes.status).toBe(201)
    })

    it('a manager is refused a payroll/finance write', async () => {
      // finance: the enforced instance (POST /api/data/sales) — refused,
      // and the sale is genuinely never created (assert the data, not just
      // the status code).
      mockCookie = managerSession
      const before = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
      const res = await salesPOST(
        jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, item: 'Manager attempt', amountCents: 9999, status: 'paid' })
      )
      const { status, payload } = await readJson(res)
      expect(status).toBe(403)
      expect(payload.success).toBe(false)
      const after = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
      expect(after.length).toBe(before.length)
      expect(after.some((s) => s.item === 'Manager attempt')).toBe(false)

      // payroll: no write route exists anywhere in this app for it (grepped
      // db/schemas and app/api — confirmed no payroll table/route), so the
      // "manager lacks payroll by default" half of this line is asserted
      // directly against `getRoleAccess`, the exact function every
      // enforcing route above calls, rather than inventing an endpoint.
      expect(await getRoleAccess(tenantId, 'manager', MODULES.payroll)).not.toBe('edit')
    })

    it('a worker is refused a finance write', async () => {
      mockCookie = workerSession
      const before = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
      const { status, payload } = await readJson(
        await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, item: 'Worker attempt', amountCents: 500, status: 'paid' }))
      )
      expect(status).toBe(403)
      expect(payload.success).toBe(false)
      const after = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
      expect(after.length).toBe(before.length)
    })

    it('an auditor is refused every write — tasks and finance alike', async () => {
      mockCookie = auditorSession
      const before = await db.select().from(tasks).where(eq(tasks.tenantId, tenantId))
      const taskRes = await readJson(
        await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, title: 'Auditor attempt' }))
      )
      expect(taskRes.status).toBe(403)
      expect(taskRes.payload.success).toBe(false)
      const after = await db.select().from(tasks).where(eq(tasks.tenantId, tenantId))
      expect(after.length).toBe(before.length)

      const saleRes = await salesPOST(
        jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, item: 'Auditor attempt', amountCents: 500, status: 'paid' })
      )
      expect(saleRes.status).toBe(403)
    })
  })

  describe('a DB row overrides the default, in both directions', () => {
    // Each test below inserts its own row and deletes it at the end, so
    // every test starts from the empty-table baseline the block above
    // already proved.

    it('grants a manager edit on finance — a module they lack by default', async () => {
      mockCookie = managerSession
      // Baseline: refused, per the empty-table test above.
      expect(await canEdit(tenantId, 'manager', MODULES.finance)).toBe(false)

      await db.insert(rolePermissions).values({
        id: randomUUID(), tenantId, role: 'manager', module: 'finance', access: 'edit', approvalRequired: false,
      })

      expect(await canEdit(tenantId, 'manager', MODULES.finance)).toBe(true)

      const { status, payload } = await readJson(
        await salesPOST(jsonRequest('http://localhost/api/data/sales', 'POST', { tenantId, item: 'Manager granted sale', amountCents: 7500, status: 'paid' }))
      )
      expect(status).toBe(201)
      expect(payload.data.item).toBe('Manager granted sale')

      const rows = await db.select().from(sales).where(eq(sales.tenantId, tenantId))
      expect(rows.some((s) => s.item === 'Manager granted sale')).toBe(true)

      await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    })

    it('revokes a manager\'s edit on tasks — a module they have by default', async () => {
      mockCookie = managerSession
      expect(await canEdit(tenantId, 'manager', MODULES.tasks)).toBe(true)

      await db.insert(rolePermissions).values({
        id: randomUUID(), tenantId, role: 'manager', module: 'tasks', access: 'view', approvalRequired: false,
      })
      expect(await canEdit(tenantId, 'manager', MODULES.tasks)).toBe(false)

      const before = await db.select().from(tasks).where(eq(tasks.tenantId, tenantId))
      const { status, payload } = await readJson(
        await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, title: 'Manager revoked task' }))
      )
      expect(status).toBe(403)
      expect(payload.success).toBe(false)
      const after = await db.select().from(tasks).where(eq(tasks.tenantId, tenantId))
      expect(after.length).toBe(before.length)
      expect(after.some((t) => t.title === 'Manager revoked task')).toBe(false)

      await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    })
  })

  describe('refusal leaves the underlying row genuinely unchanged', () => {
    it('an auditor cannot PATCH an existing task — the row is untouched after the 403', async () => {
      mockCookie = ownerSession
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, title: 'Original title', priority: 'low' })))
      ).payload.data

      mockCookie = auditorSession
      const res = await taskPATCH(
        jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantId}`, 'PATCH', { title: 'Hijacked title', priority: 'high' }),
        { params: Promise.resolve({ id: created.id }) }
      )
      const { status, payload } = await readJson(res)
      expect(status).toBe(403)
      expect(payload.success).toBe(false)

      const rows = await db.select().from(tasks).where(eq(tasks.id, created.id))
      expect(rows[0].title).toBe('Original title')
      expect(rows[0].priority).toBe('low')
    })
  })

  describe('an owner cannot be locked out, even by an explicit DB row', () => {
    it('an owner still succeeds on tasks after a row sets it to hidden', async () => {
      await db.insert(rolePermissions).values({
        id: randomUUID(), tenantId, role: 'owner', module: 'tasks', access: 'hidden', approvalRequired: false,
      })

      mockCookie = ownerSession
      const { status, payload } = await readJson(
        await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, title: 'Owner cannot be locked out' }))
      )
      expect(status).toBe(201)
      expect(payload.data.title).toBe('Owner cannot be locked out')

      await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    })
  })

  describe('authentication before permission', () => {
    it('an unauthenticated caller gets 401, not 403', async () => {
      mockCookie = undefined
      const res = await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId, title: 'No session' }))
      expect(res.status).toBe(401)
    })
  })
})
