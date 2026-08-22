// ── Tasks & Governance backend tests (issue #243) ───────────────────────────
// Integration tests that call the real route handlers against the real
// postgres when DATABASE_URL is set (local/dev); CI has no database, so the
// suite skips there — same pattern as tests/batches.test.ts / auth.test.ts.
//
// Covers the issue's Definition of Done:
//   - full task CRUD, including priority/requiresApproval/notes
//   - an approval request can be approved or rejected via the API, both
//     writing a real audit_log row with the real actor
//   - role_permissions CRUD: one call's write is readable by a subsequent
//     call
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { GET as tasksGET, POST as tasksPOST } from '@/app/api/tasks/route'
import { GET as taskGET, PATCH as taskPATCH, DELETE as taskDELETE } from '@/app/api/tasks/[id]/route'
import { GET as approvalsGET } from '@/app/api/approvals/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { POST as rejectPOST } from '@/app/api/approvals/[id]/reject/route'
import { GET as rolePermsGET, PUT as rolePermsPUT } from '@/app/api/role-permissions/route'
import { db } from '@/db'
import { tenants, users, sessions, tasks, approvalRequests, auditLog, rolePermissions } from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'

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

run('tasks & governance: task CRUD, approvals, role permissions (issue #243)', () => {
  const tenantAId = `t-gov-${randomUUID()}`
  const tenantBId = `t-gov-${randomUUID()}`

  const ownerEmail = `owner-gov-${randomUUID()}@test.ifms`
  const ownerId = randomUUID()
  const managerEmail = `manager-gov-${randomUUID()}@test.ifms`
  const managerId = randomUUID()
  const workerEmail = `worker-gov-${randomUUID()}@test.ifms`
  const workerId = randomUUID()

  // A second tenant's owner — needed now that tenant is session-derived only
  // (auth fix: fix/authenticate-all-apis): a cross-tenant-isolation test can
  // no longer create a "different tenant's" row by simply naming that
  // tenantId in the body/query as tenant A's owner; it needs a REAL session
  // on tenant B.
  const tenantBOwnerEmail = `owner-gov-b-${randomUUID()}@test.ifms`
  const tenantBOwnerId = randomUUID()

  let ownerSessionToken: string
  let managerSessionToken: string
  let workerSessionToken: string
  let tenantBOwnerSessionToken: string

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantAId, name: 'Governance Test Co. A', active: true },
      { id: tenantBId, name: 'Governance Test Co. B', active: true },
    ])
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId: tenantAId, name: 'Gov Owner', email: ownerEmail, role: 'owner', passwordHash: hashSecret('ownerpw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: managerId, tenantId: tenantAId, name: 'Gov Manager', email: managerEmail, role: 'manager', passwordHash: hashSecret('mgrpw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerId, tenantId: tenantAId, name: 'Gov Worker', email: workerEmail, role: 'worker', passwordHash: hashSecret('wrkpw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: tenantBOwnerId, tenantId: tenantBId, name: 'Gov Owner B', email: tenantBOwnerEmail, role: 'owner', passwordHash: hashSecret('ownerbpw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    ownerSessionToken = await createSession(ownerId)
    managerSessionToken = await createSession(managerId)
    workerSessionToken = await createSession(workerId)
    tenantBOwnerSessionToken = await createSession(tenantBOwnerId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(auditLog).where(inArray(auditLog.tenantId, [tenantAId, tenantBId]))
    await db.delete(approvalRequests).where(inArray(approvalRequests.tenantId, [tenantAId, tenantBId]))
    await db.delete(rolePermissions).where(inArray(rolePermissions.tenantId, [tenantAId, tenantBId]))
    await db.delete(tasks).where(inArray(tasks.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerId, workerId, tenantBOwnerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerId, workerId, tenantBOwnerId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('task CRUD', () => {
    it('creates a task with priority/requiresApproval/notes and reads it back', async () => {
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await tasksPOST(
          jsonRequest('http://localhost/api/tasks', 'POST', {
            tenantId: tenantAId,
            title: 'Egg Collection – Pen B01',
            priority: 'high',
            requiresApproval: true,
            notes: 'Check for cracked eggs',
          })
        )
      )
      expect(status).toBe(201)
      expect(payload.success).toBe(true)
      expect(payload.data.priority).toBe('high')
      expect(payload.data.requiresApproval).toBe(true)
      expect(payload.data.notes).toBe('Check for cracked eggs')
      expect(payload.data.status).toBe('PENDING')
      const taskId = payload.data.id

      const readRes = await taskGET(jsonRequest(`http://localhost/api/tasks/${taskId}?tenantId=${tenantAId}`, 'GET'), {
        params: Promise.resolve({ id: taskId }),
      })
      const read = await readJson(readRes)
      expect(read.status).toBe(200)
      expect(read.payload.data.title).toBe('Egg Collection – Pen B01')
    })

    it('rejects a task with no title (400)', async () => {
      mockCookie = ownerSessionToken
      const { status } = await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', {})))
      expect(status).toBe(400)
    })

    it('lists only the requesting tenant\'s tasks', async () => {
      // A real tenant-B session creates the "other tenant" task — tenant is
      // session-derived only now, so a tenantB owner is required to actually
      // land a row under tenantB (a body/query tenantId can no longer do it).
      mockCookie = tenantBOwnerSessionToken
      await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Other tenant task' }))

      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(await tasksGET(jsonRequest('http://localhost/api/tasks', 'GET')))
      expect(status).toBe(200)
      expect(payload.data.length).toBeGreaterThanOrEqual(1)
      expect(payload.data.every((t: { tenantId: string }) => t.tenantId === tenantAId)).toBe(true)
    })

    it('updates fields via PATCH (partial update)', async () => {
      mockCookie = ownerSessionToken
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Morning Feeding' })))
      ).payload.data
      const { status, payload } = await readJson(
        await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}`, 'PATCH', { priority: 'low', notes: 'Adjusted' }), {
          params: Promise.resolve({ id: created.id }),
        })
      )
      expect(status).toBe(200)
      expect(payload.data.priority).toBe('low')
      expect(payload.data.notes).toBe('Adjusted')
      expect(payload.data.title).toBe('Morning Feeding')
    })

    it('deletes a task', async () => {
      mockCookie = ownerSessionToken
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Disposable task' })))
      ).payload.data
      const del = await readJson(
        await taskDELETE(jsonRequest(`http://localhost/api/tasks/${created.id}`, 'DELETE'), {
          params: Promise.resolve({ id: created.id }),
        })
      )
      expect(del.status).toBe(200)

      const readRes = await taskGET(jsonRequest(`http://localhost/api/tasks/${created.id}`, 'GET'), {
        params: Promise.resolve({ id: created.id }),
      })
      expect(readRes.status).toBe(404)
    })

    it('404s for a task id belonging to a different tenant', async () => {
      mockCookie = tenantBOwnerSessionToken
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Tenant B private task' })))
      ).payload.data

      mockCookie = ownerSessionToken
      const res = await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}`, 'PATCH', { priority: 'high' }), {
        params: Promise.resolve({ id: created.id }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('approvals: completion -> approve/reject writes audit_log', () => {
    it('marking a requiresApproval task DONE creates a pending approval_request instead of completing it', async () => {
      mockCookie = ownerSessionToken
      const created = (
        await readJson(
          await tasksPOST(
            jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Milking – Morning Round', requiresApproval: true })
          )
        )
      ).payload.data

      // The actor recorded on the approval request is always the SESSION
      // user now (auth fix: fix/authenticate-all-apis) — there is no more
      // `actorId`-in-body fallback — so this PATCH runs as the worker
      // session to land `requestedBy: workerId` below.
      mockCookie = workerSessionToken
      const { status, payload } = await readJson(
        await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}`, 'PATCH', { status: 'DONE' }), {
          params: Promise.resolve({ id: created.id }),
        })
      )
      expect(status).toBe(200)
      expect(payload.data.status).toBe('PENDING_APPROVAL')
      expect(payload.data.approvalRequestId).toBeTruthy()

      const approvalRows = await db.select().from(approvalRequests).where(eq(approvalRequests.id, payload.data.approvalRequestId))
      expect(approvalRows[0]?.type).toBe('task_completion')
      expect(approvalRows[0]?.status).toBe('pending')
      expect(approvalRows[0]?.requestedBy).toBe(workerId)
      expect(approvalRows[0]?.entityId).toBe(created.id)
    })

    it('approving the request resolves the task to DONE and writes a real audit_log row', async () => {
      mockCookie = ownerSessionToken
      const created = (
        await readJson(
          await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Egg Collection – Pen A02', requiresApproval: true }))
        )
      ).payload.data

      mockCookie = workerSessionToken
      const patched = (
        await readJson(
          await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}`, 'PATCH', { status: 'DONE' }), {
            params: Promise.resolve({ id: created.id }),
          })
        )
      ).payload.data
      const approvalId = patched.approvalRequestId

      // Listed in GET /api/approvals for the tenant.
      mockCookie = ownerSessionToken
      const listed = await readJson(await approvalsGET(jsonRequest('http://localhost/api/approvals?status=pending', 'GET')))
      expect(listed.payload.data.some((a: { id: string }) => a.id === approvalId)).toBe(true)

      // Worker cannot approve (role gate).
      mockCookie = workerSessionToken
      const deniedRes = await approvePOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/approve`, 'POST'), { params: Promise.resolve({ id: approvalId }) })
      expect(deniedRes.status).toBe(403)

      // Owner approves.
      mockCookie = ownerSessionToken
      const { status, payload } = await readJson(
        await approvePOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/approve`, 'POST'), { params: Promise.resolve({ id: approvalId }) })
      )
      expect(status).toBe(200)
      expect(payload.data.approval.status).toBe('approved')
      expect(payload.data.task.status).toBe('DONE')

      const taskRows = await db.select().from(tasks).where(eq(tasks.id, created.id))
      expect(taskRows[0]?.status).toBe('DONE')

      const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, approvalId))
      expect(auditRows.length).toBe(1)
      expect(auditRows[0].actor).toBe(ownerId)
      expect(auditRows[0].action).toBe('approval.approved')
      expect(auditRows[0].tenantId).toBe(tenantAId)

      // Re-approving an already-decided request is rejected.
      const secondTry = await approvePOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/approve`, 'POST'), { params: Promise.resolve({ id: approvalId }) })
      expect(secondTry.status).toBe(409)

      mockCookie = undefined
    })

    it('rejecting the request resolves the task to REJECTED and writes a real audit_log row', async () => {
      mockCookie = ownerSessionToken
      const created = (
        await readJson(
          await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Harvest – Kale Plot', requiresApproval: true }))
        )
      ).payload.data

      mockCookie = workerSessionToken
      const patched = (
        await readJson(
          await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}`, 'PATCH', { status: 'DONE' }), {
            params: Promise.resolve({ id: created.id }),
          })
        )
      ).payload.data
      const approvalId = patched.approvalRequestId

      mockCookie = managerSessionToken
      const { status, payload } = await readJson(
        await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST'), { params: Promise.resolve({ id: approvalId }) })
      )
      expect(status).toBe(200)
      expect(payload.data.approval.status).toBe('rejected')
      expect(payload.data.task.status).toBe('REJECTED')

      const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, approvalId))
      expect(auditRows[0].actor).toBe(managerId)
      expect(auditRows[0].action).toBe('approval.rejected')

      mockCookie = undefined
    })

    it('rejects approve/reject with no session (401)', async () => {
      mockCookie = undefined
      const res = await approvePOST(jsonRequest('http://localhost/api/approvals/nonexistent/approve', 'POST'), { params: Promise.resolve({ id: 'nonexistent' }) })
      expect(res.status).toBe(401)
    })
  })

  describe('role_permissions: owner-only write, readable by a subsequent call', () => {
    it('rejects a PUT with no session (401) and a non-owner session (403)', async () => {
      mockCookie = undefined
      const anon = await rolePermsPUT(jsonRequest('http://localhost/api/role-permissions', 'PUT', { roles: [] }))
      expect(anon.status).toBe(401)

      mockCookie = managerSessionToken
      const nonOwner = await rolePermsPUT(jsonRequest('http://localhost/api/role-permissions', 'PUT', { roles: [] }))
      expect(nonOwner.status).toBe(403)
      mockCookie = undefined
    })

    it('an owner sets a custom permission matrix and a subsequent GET reads it back', async () => {
      mockCookie = ownerSessionToken
      const putRes = await readJson(
        await rolePermsPUT(
          jsonRequest('http://localhost/api/role-permissions', 'PUT', {
            roles: [
              {
                role: 'manager',
                permissions: { feeding: 'edit', finance: 'view', payroll: 'hidden' },
                approvalRequired: ['finance'],
              },
              {
                role: 'worker',
                permissions: { feeding: 'edit', finance: 'hidden' },
                approvalRequired: [],
              },
            ],
          })
        )
      )
      expect(putRes.status).toBe(200)
      mockCookie = undefined

      // Subsequent GET, as any authenticated session on the tenant (manager
      // here — GET is readable by any session on the tenant, only PUT is
      // owner-only), sees the same matrix. Tenant is session-derived only
      // now (auth fix: fix/authenticate-all-apis) — no more `tenantId`
      // query-param fallback for a session-less caller.
      mockCookie = managerSessionToken
      const getRes = await readJson(await rolePermsGET())
      expect(getRes.status).toBe(200)
      const byRole = Object.fromEntries(getRes.payload.data.map((r: { role: string }) => [r.role, r]))
      expect(byRole.manager.permissions.feeding).toBe('edit')
      expect(byRole.manager.permissions.finance).toBe('view')
      expect(byRole.manager.approvalRequired).toEqual(['finance'])
      expect(byRole.worker.permissions.feeding).toBe('edit')
      expect(byRole.worker.approvalRequired).toEqual([])
    })

    // ── issue #302: Governance summary strip's "CRUD Rules" tile ──────────────
    // The tile counts the tenant's real role_permissions rows with
    // approval_required = true. GovernanceScreen computes that as
    // sum(role.approvalRequired.length) over the GET response — this proves
    // that sum equals the real row count in the DB, so the tile can never
    // drift from what GET actually returns (and what the CRUD Rules tab's own
    // per-module toggles render).
    it('sum of approvalRequired.length across GET matches the real DB row count with approval_required = true', async () => {
      mockCookie = ownerSessionToken
      await rolePermsPUT(
        jsonRequest('http://localhost/api/role-permissions', 'PUT', {
          roles: [
            {
              role: 'manager',
              permissions: { feeding: 'edit', finance: 'view', payroll: 'hidden' },
              approvalRequired: ['finance', 'payroll'],
            },
            {
              role: 'worker',
              permissions: { feeding: 'edit', finance: 'hidden' },
              approvalRequired: ['feeding'],
            },
          ],
        })
      )
      // Tenant is session-derived only now — keep the owner session for the
      // read-back GET (auth fix: fix/authenticate-all-apis).
      const getRes = await readJson(await rolePermsGET())
      expect(getRes.status).toBe(200)
      const entries = getRes.payload.data as { role: string; approvalRequired: string[] }[]
      const tileCount = entries.reduce((sum, r) => sum + r.approvalRequired.length, 0)
      expect(tileCount).toBe(3)

      const dbRows = await db
        .select()
        .from(rolePermissions)
        .where(and(eq(rolePermissions.tenantId, tenantAId), eq(rolePermissions.approvalRequired, true)))
      expect(dbRows.length).toBe(tileCount)
    })

    it('a second PUT fully replaces the previous matrix (old modules disappear)', async () => {
      mockCookie = ownerSessionToken
      await rolePermsPUT(
        jsonRequest('http://localhost/api/role-permissions', 'PUT', {
          roles: [{ role: 'manager', permissions: { feeding: 'view' }, approvalRequired: [] }],
        })
      )
      // Tenant is session-derived only now — keep the owner session for the
      // read-back GET (auth fix: fix/authenticate-all-apis).
      const getRes = await readJson(await rolePermsGET())
      const byRole = Object.fromEntries(getRes.payload.data.map((r: { role: string }) => [r.role, r]))
      expect(byRole.manager.permissions.feeding).toBe('view')
      expect(byRole.manager.permissions.finance).toBeUndefined()
      expect(byRole.worker).toBeUndefined()
    })

    it('rejects an invalid access value', async () => {
      mockCookie = ownerSessionToken
      const res = await rolePermsPUT(
        jsonRequest('http://localhost/api/role-permissions', 'PUT', { roles: [{ role: 'manager', permissions: { feeding: 'nonsense' } }] })
      )
      expect(res.status).toBe(400)
      mockCookie = undefined
    })
  })
})
