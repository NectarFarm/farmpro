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
import { tenants, users, sessions, tasks, approvalRequests, auditLog, rolePermissions, employees } from '@/db/schemas'
import { GET as approversGET } from '@/app/api/approvers/route'
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

  let ownerSessionToken: string
  let managerSessionToken: string
  let workerSessionToken: string

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
    ])
    // Create an employee linked to the worker user (needed for assignee FK tests)
    await db.insert(employees).values({
      id: `emp-gov-${workerId}`,
      tenantId: tenantAId,
      name: 'Gov Worker Employee',
      phone: '+254700000999',
      role: 'worker',
      userId: workerId,
      assignedBatchIds: [],
      mortalityPhotoThreshold: 3,
    })

    ownerSessionToken = await createSession(ownerId)
    managerSessionToken = await createSession(managerId)
    workerSessionToken = await createSession(workerId)
  })

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.tenantId, [tenantAId, tenantBId]))
    await db.delete(approvalRequests).where(inArray(approvalRequests.tenantId, [tenantAId, tenantBId]))
    await db.delete(rolePermissions).where(inArray(rolePermissions.tenantId, [tenantAId, tenantBId]))
    await db.delete(tasks).where(inArray(tasks.tenantId, [tenantAId, tenantBId]))
    await db.delete(employees).where(inArray(employees.tenantId, [tenantAId, tenantBId]))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, managerId, workerId]))
    await db.delete(users).where(inArray(users.id, [ownerId, managerId, workerId]))
    await db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))
  })

  describe('task CRUD', () => {
    it('creates a task with priority/requiresApproval/notes and reads it back', async () => {
      mockCookie = undefined
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
      const { status } = await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId })))
      expect(status).toBe(400)
    })

    it('lists only the requesting tenant\'s tasks', async () => {
      await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantBId, title: 'Other tenant task' }))
      const { status, payload } = await readJson(await tasksGET(jsonRequest(`http://localhost/api/tasks?tenantId=${tenantAId}`, 'GET')))
      expect(status).toBe(200)
      expect(payload.data.length).toBeGreaterThanOrEqual(1)
      expect(payload.data.every((t: { tenantId: string }) => t.tenantId === tenantAId)).toBe(true)
    })

    it('updates fields via PATCH (partial update)', async () => {
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Morning Feeding' })))
      ).payload.data
      const { status, payload } = await readJson(
        await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'PATCH', { priority: 'low', notes: 'Adjusted' }), {
          params: Promise.resolve({ id: created.id }),
        })
      )
      expect(status).toBe(200)
      expect(payload.data.priority).toBe('low')
      expect(payload.data.notes).toBe('Adjusted')
      expect(payload.data.title).toBe('Morning Feeding')
    })

    it('deletes a task', async () => {
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Disposable task' })))
      ).payload.data
      const del = await readJson(
        await taskDELETE(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'DELETE'), {
          params: Promise.resolve({ id: created.id }),
        })
      )
      expect(del.status).toBe(200)

      const readRes = await taskGET(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'GET'), {
        params: Promise.resolve({ id: created.id }),
      })
      expect(readRes.status).toBe(404)
    })

    it('404s for a task id belonging to a different tenant', async () => {
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantBId, title: 'Tenant B private task' })))
      ).payload.data
      const res = await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'PATCH', { priority: 'high' }), {
        params: Promise.resolve({ id: created.id }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('task approval governance: approver selection, statuses, blockers, audit trail', () => {
    it('POST /api/tasks accepts a designated owner approver and stores approverId', async () => {
      mockCookie = undefined
      const { status, payload } = await readJson(
        await tasksPOST(
          jsonRequest('http://localhost/api/tasks', 'POST', {
            tenantId: tenantAId,
            title: 'Approver-designated task',
            requiresApproval: true,
            approverId: managerId,
          })
        )
      )
      expect(status).toBe(201)
      expect(payload.data.approverId).toBe(managerId)
    })

    it('rejects a worker as approver (400)', async () => {
      const { status } = await readJson(
        await tasksPOST(
          jsonRequest('http://localhost/api/tasks', 'POST', {
            tenantId: tenantAId,
            title: 'Bad approver',
            approverId: workerId,
          })
        )
      )
      expect(status).toBe(400)
    })

    it('rejects an approver id from another tenant (400)', async () => {
      // workerId belongs to tenantA; there is no tenantB user in this suite,
      // so use a random uuid — must fail the "active user of this tenant" check.
      const { status } = await readJson(
        await tasksPOST(
          jsonRequest('http://localhost/api/tasks', 'POST', {
            tenantId: tenantAId,
            title: 'Foreign approver',
            approverId: randomUUID(),
          })
        )
      )
      expect(status).toBe(400)
    })

    it('PATCH status STARTED records a task.started audit entry', async () => {
      const created = (
        await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Start me' })))
      ).payload.data
      const { status, payload } = await readJson(
        await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'PATCH', { status: 'STARTED' }), {
          params: Promise.resolve({ id: created.id }),
        })
      )
      expect(status).toBe(200)
      expect(payload.data.status).toBe('STARTED')
      const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id))
      expect(audit.some((a) => a.action === 'task.started')).toBe(true)
    })

    it('PATCH status BLOCKED requires a real blocker task (400 without, works with)', async () => {
      const a = (await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Blocked task' })))).payload.data
      const blocker = (await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Blocker task' })))).payload.data

      const missing = await readJson(
        await taskPATCH(jsonRequest(`http://localhost/api/tasks/${a.id}?tenantId=${tenantAId}`, 'PATCH', { status: 'BLOCKED' }), {
          params: Promise.resolve({ id: a.id }),
        })
      )
      expect(missing.status).toBe(400)

      const ok = await readJson(
        await taskPATCH(
          jsonRequest(`http://localhost/api/tasks/${a.id}?tenantId=${tenantAId}`, 'PATCH', { status: 'BLOCKED', blockedByTaskId: blocker.id }),
          { params: Promise.resolve({ id: a.id }) }
        )
      )
      expect(ok.status).toBe(200)
      expect(ok.payload.data.status).toBe('BLOCKED')
      expect(ok.payload.data.blockedByTaskId).toBe(blocker.id)
    })

    it('rejects a self-block (400)', async () => {
      const a = (await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Self block' })))).payload.data
      const res = await readJson(
        await taskPATCH(
          jsonRequest(`http://localhost/api/tasks/${a.id}?tenantId=${tenantAId}`, 'PATCH', { status: 'BLOCKED', blockedByTaskId: a.id }),
          { params: Promise.resolve({ id: a.id }) }
        )
      )
      expect(res.status).toBe(400)
    })

    it('PATCH clarification writes a task.clarification_requested audit entry', async () => {
      const created = (await readJson(await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Clarify me' })))).payload.data
      const { status } = await readJson(
        await taskPATCH(
          jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'PATCH', { clarification: 'Which feed should I use?' }),
          { params: Promise.resolve({ id: created.id }) }
        )
      )
      expect(status).toBe(200)
      const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, created.id))
      const entry = audit.find((a) => a.action === 'task.clarification_requested')
      expect(entry).toBeTruthy()
      expect(entry?.meta).toMatchObject({ note: 'Which feed should I use?' })
    })
  })

  describe('approvals: completion -> approve/reject writes audit_log', () => {
    it('marking a requiresApproval task DONE creates a pending approval_request instead of completing it', async () => {
      const created = (
        await readJson(
          await tasksPOST(
            jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Milking – Morning Round', requiresApproval: true })
          )
        )
      ).payload.data

      const { status, payload } = await readJson(
        await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'PATCH', { status: 'DONE', actorId: workerId }), {
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
      const created = (
        await readJson(
          await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Egg Collection – Pen A02', requiresApproval: true }))
        )
      ).payload.data
      const patched = (
        await readJson(
          await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'PATCH', { status: 'DONE', actorId: workerId }), {
            params: Promise.resolve({ id: created.id }),
          })
        )
      ).payload.data
      const approvalId = patched.approvalRequestId

      // Listed in GET /api/approvals for the tenant.
      const listed = await readJson(await approvalsGET(jsonRequest(`http://localhost/api/approvals?tenantId=${tenantAId}&status=pending`, 'GET')))
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
      const created = (
        await readJson(
          await tasksPOST(jsonRequest('http://localhost/api/tasks', 'POST', { tenantId: tenantAId, title: 'Harvest – Kale Plot', requiresApproval: true }))
        )
      ).payload.data
      const patched = (
        await readJson(
          await taskPATCH(jsonRequest(`http://localhost/api/tasks/${created.id}?tenantId=${tenantAId}`, 'PATCH', { status: 'DONE', actorId: workerId }), {
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

      // Subsequent GET (even without a session, via tenantId fallback) sees the same matrix.
      const getRes = await readJson(await rolePermsGET(jsonRequest(`http://localhost/api/role-permissions?tenantId=${tenantAId}`, 'GET')))
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
      mockCookie = undefined

      const getRes = await readJson(await rolePermsGET(jsonRequest(`http://localhost/api/role-permissions?tenantId=${tenantAId}`, 'GET')))
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
      mockCookie = undefined

      const getRes = await readJson(await rolePermsGET(jsonRequest(`http://localhost/api/role-permissions?tenantId=${tenantAId}`, 'GET')))
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
  // ── Task reopen (owner/manager only) ────────────────────────────────────────
  describe('task reopen', () => {
    let reopenTaskId: string

    it('creates a task and completes it', async () => {
      mockCookie = ownerSessionToken
      const created = await tasksPOST(
        jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Reopen test', priority: 'medium', tenantId: tenantAId })
      )
      const body = await created.json()
      expect(body.success).toBe(true)
      reopenTaskId = body.data.id

      const res = await taskPATCH(
        jsonRequest(`http://localhost/api/tasks/${reopenTaskId}?tenantId=${tenantAId}`, 'PATCH', { status: 'DONE' }),
        { params: Promise.resolve({ id: reopenTaskId }) }
      )
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('DONE')
      mockCookie = undefined
    })

    it('reopens the completed task', async () => {
      mockCookie = ownerSessionToken
      const res = await taskPATCH(
        jsonRequest(`http://localhost/api/tasks/${reopenTaskId}?tenantId=${tenantAId}`, 'PATCH', { reopen: true }),
        { params: Promise.resolve({ id: reopenTaskId }) }
      )
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.data.status).toBe('PENDING')
      expect(data.data.reopenedAt).toBeTruthy()
      mockCookie = undefined
    })

    it('rejects reopen for non-DONE/REJECTED tasks', async () => {
      mockCookie = ownerSessionToken
      const res = await taskPATCH(
        jsonRequest(`http://localhost/api/tasks/${reopenTaskId}?tenantId=${tenantAId}`, 'PATCH', { reopen: true }),
        { params: Promise.resolve({ id: reopenTaskId }) }
      )
      const data = await res.json()
      expect(data.success).toBe(false)
      mockCookie = undefined
    })
  })

  // ── Task assignee FK ────────────────────────────────────────────────────────
  describe('task assignee FK', () => {
    it('creates a task with assigneeId (employee) and reads it back', async () => {
      mockCookie = ownerSessionToken
      const empId = `emp-gov-${workerId}`
      const res = await tasksPOST(
        jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Assigned task', priority: 'medium', tenantId: tenantAId, assigneeId: empId })
      )
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.assigneeId).toBe(empId)

      const getRes = await taskGET(
        new Request(`http://localhost/api/tasks/${body.data.id}?tenantId=${tenantAId}`),
        { params: Promise.resolve({ id: body.data.id }) }
      )
      const getData = await getRes.json()
      expect(getData.data.assigneeId).toBe(empId)
      mockCookie = undefined
    })

    it('rejects assigneeId to a non-existent employee', async () => {
      mockCookie = ownerSessionToken
      const res = await tasksPOST(
        jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Bad assignee', priority: 'medium', tenantId: tenantAId, assigneeId: 'nonexistent-emp-id' })
      )
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toMatch(/assignee/i)
      mockCookie = undefined
    })
  })

  // ── Audit log entity/entityId filter ─────────────────────────────────────────
  describe('audit log entity filter', () => {
    it('filters by entity and entityId', async () => {
      mockCookie = ownerSessionToken
      const created = await tasksPOST(
        jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Audit filter test', priority: 'high', tenantId: tenantAId })
      )
      const body = await created.json()
      const tId = body.data.id

      const { GET: auditGET } = await import('@/app/api/audit-log/route')
      const res = await auditGET(
        new Request(`http://localhost/api/audit-log?tenantId=${tenantAId}&entity=task&entityId=${tId}`)
      )
      const data = await res.json()
      expect(data.success).toBe(true)
      for (const entry of data.data) {
        expect(entry.entity).toBe('task')
        expect(entry.entityId).toBe(tId)
      }
      mockCookie = undefined
    })
  })

  // ── Approvers route ─────────────────────────────────────────────────────────
  describe('approvers route', () => {
    it('returns owner and manager users for the tenant', async () => {
      mockCookie = ownerSessionToken
      const res = await approversGET(
        new Request(`http://localhost/api/approvers?tenantId=${tenantAId}`)
      )
      const body = await res.json()
      expect(body.success).toBe(true)
      const roles = body.data.map((a: any) => a.role)
      expect(roles).toContain('owner')
      expect(roles).toContain('manager')
      mockCookie = undefined
    })

    it('works without session when tenantId is provided (standalone mode)', async () => {
      mockCookie = undefined
      const res = await approversGET(
        new Request(`http://localhost/api/approvers?tenantId=${tenantAId}`)
      )
      const body = await res.json()
      expect(body.success).toBe(true)
    })
  })
})
