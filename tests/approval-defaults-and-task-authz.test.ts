// ── Approval defaults, and who may reshape a task ───────────────────────────
// Two holes in the same shape: a permission whose CODE DEFAULT was missing, so
// an unconfigured tenant got the permissive answer.
//
// 1. `needsApproval` (lib/permissions.ts) ended `?? false` while its sibling
//    `getRoleAccess` ended `?? DEFAULT_MATRIX[...]`. `role_permissions` rows
//    are only ever written when an owner explicitly saves the Governance grid
//    (PUT /api/role-permissions is the sole writer — lib/tenant-provisioning.ts
//    does not seed the table), so every freshly provisioned farm has an EMPTY
//    matrix. A worker therefore picked up `mortality: 'edit'` from
//    DEFAULT_MATRIX and their death report went straight onto the owner's
//    headcount, unreviewed, on day one. The approval machinery in POST
//    /api/records was already built and correct; nothing ever switched it on.
//
// 2. PATCH /api/tasks/[id] gated on `canEdit(..., MODULES.tasks)` and nothing
//    else. A worker holds `tasks: 'edit'` so they can mark their own work
//    DONE — load-bearing, asserted in tests/worker-tasks-today.test.ts and
//    tests/tasks-governance.test.ts — but the same grant let them PATCH
//    `assigneeId`, `approverId` and `requiresApproval` on ANY task in the
//    tenant.
//
// The first two describe blocks are pure and always run: what happens with an
// EMPTY table is exactly the case a DB-gated test cannot cover, since setting
// up a row is the thing that makes it not-empty. The integration block needs
// real Postgres and skips without DATABASE_URL, same as the rest of the suite.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { defaultApprovalFor, MODULES } from '@/lib/permissions'
import {
  TASK_SHAPE_FIELDS, TASK_REPORT_FIELDS, taskShapeFieldsPresent,
} from '@/lib/task-fields'
import { POST as recordsPOST } from '@/app/api/records/route'
import { POST as tasksPOST } from '@/app/api/tasks/route'
import { PATCH as taskPATCH, DELETE as taskDELETE } from '@/app/api/tasks/[id]/route'
import { POST as approvePOST } from '@/app/api/approvals/[id]/approve/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, employees, records,
  batchMovements, approvalRequests, auditLog, rolePermissions, tasks,
} from '@/db/schemas'
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

// ───────────────────────────────────────────────────────────────────────────
describe('lib/permissions.ts — approval defaults for an unconfigured tenant', () => {
  it('makes a worker’s mortality and physical count wait for sign-off by default', () => {
    // The bug, stated as a test: with no role_permissions row at all, these
    // two used to come back false and the headcount moved unreviewed.
    expect(defaultApprovalFor('worker', MODULES.mortality)).toBe(true)
    expect(defaultApprovalFor('worker', MODULES.physicalCount)).toBe(true)
  })

  it('makes a vet’s mortality wait too — it moves the owner’s headcount identically', () => {
    expect(defaultApprovalFor('vet', MODULES.mortality)).toBe(true)
    expect(defaultApprovalFor('vet', MODULES.physicalCount)).toBe(true)
  })

  it('does NOT add friction for a manager — they are the ones deciding these', () => {
    // Deliberate: a manager already passes the governance module and so
    // decides these approvals. Making them queue behind themselves would be
    // a regression dressed up as hardening.
    expect(defaultApprovalFor('manager', MODULES.mortality)).toBe(false)
    expect(defaultApprovalFor('manager', MODULES.physicalCount)).toBe(false)
  })

  it('never makes an owner or super_admin wait on themselves', () => {
    for (const role of ['owner', 'super_admin']) {
      expect(defaultApprovalFor(role, MODULES.mortality)).toBe(false)
      expect(defaultApprovalFor(role, MODULES.physicalCount)).toBe(false)
    }
  })

  it('leaves the modules the enforcement path cannot defer at false', () => {
    // `needsApproval` has exactly one call site — POST /api/records, reading
    // it as `movesHeadcount && needsApproval(...)`, where movesHeadcount is
    // true only for mortality or a physical_count carrying a number. A `true`
    // on anything else would be enforced by nothing, which is the decorative
    // config that made `approvalRequired` meaningless in the first place.
    for (const module of [
      MODULES.feeding, MODULES.health, MODULES.harvest, MODULES.eggCollection,
      MODULES.milking, MODULES.inventory, MODULES.batches, MODULES.tasks,
      MODULES.finance, MODULES.payroll, MODULES.governance,
    ]) {
      expect(defaultApprovalFor('worker', module)).toBe(false)
    }
  })

  it('returns false for a role nobody configured, rather than throwing', () => {
    expect(defaultApprovalFor('auditor', MODULES.mortality)).toBe(false)
    expect(defaultApprovalFor('some-future-role', MODULES.mortality)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('lib/task-fields.ts — which fields are a shape change', () => {
  it('treats reporting status as no shape change at all', () => {
    expect(taskShapeFieldsPresent({ status: 'DONE' })).toEqual([])
  })

  it('ignores body keys that are not task fields', () => {
    // `actorId` is sent by components/farm/worker.tsx and is not a task
    // column — it must not be mistaken for an attempted shape change.
    expect(taskShapeFieldsPresent({ status: 'DONE', actorId: 'usr-1', tenantId: 't-1' })).toEqual([])
  })

  it('catches every reassignment and governance field', () => {
    expect(taskShapeFieldsPresent({ assigneeId: 'emp-1' })).toEqual(['assigneeId'])
    expect(taskShapeFieldsPresent({ approverId: 'usr-1' })).toEqual(['approverId'])
    expect(taskShapeFieldsPresent({ requiresApproval: false })).toEqual(['requiresApproval'])
  })

  it('counts an explicit null assignee as a reassignment, not an absent field', () => {
    // Un-assigning is a real accountability change; presence, not truthiness.
    expect(taskShapeFieldsPresent({ assigneeId: null })).toEqual(['assigneeId'])
  })

  it('counts notes as a shape change, because the assignee hides in it', () => {
    // The legacy assignment path stores "Assigned: <name>" as a notes prefix
    // (lib/tasks.ts#splitNotes), so a writable notes field is a writable
    // assignee field.
    expect(taskShapeFieldsPresent({ notes: 'Assigned: Someone Else' })).toEqual(['notes'])
  })

  it('reports several attempted fields at once, so the refusal can name them', () => {
    expect(taskShapeFieldsPresent({ assigneeId: 'emp-1', priority: 'high', status: 'DONE' }))
      .toEqual(['priority', 'assigneeId'])
  })

  it('keeps the shape and report field sets disjoint', () => {
    const shape = new Set<string>(TASK_SHAPE_FIELDS)
    for (const f of TASK_REPORT_FIELDS) expect(shape.has(f)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Source assertions: this repo has no component render harness (see
// tests/crops-batch-detail-ui.test.ts's header for why UI wiring is checked
// against source text). Anchored to rendered JSX and to the chip constant
// rather than to prose, so the explanatory comments above these lines cannot
// satisfy the assertion by accident.
describe('components/farm/worker.tsx — a deferred record does not claim to be saved', () => {
  const source = readFileSync(join(process.cwd(), 'components/farm/worker.tsx'), 'utf8')

  it('no longer renders an unconditional SAVED chip', () => {
    expect(source).not.toMatch(/>SAVED<\/span>/)
  })

  it('derives the chip from the record’s own approval state', () => {
    expect(source).toMatch(/RECORD_STATE_CHIP\[recordApprovalState\(r\.data\)\]/)
    expect(source).toMatch(/pending: \{ label: 'WAITING'/)
    expect(source).toMatch(/rejected: \{ label: 'REJECTED'/)
  })

  it('reads the flags POST /api/records and lib/governance.ts actually write', () => {
    expect(source).toMatch(/data\.pendingApproval === true/)
    expect(source).toMatch(/data\.approvalDecision === 'rejected'/)
  })

  it('tells the worker their submission is waiting, instead of "saved"', () => {
    expect(source).toMatch(/Sent for approval — the count changes once it is approved\./)
    expect(source).toMatch(/showToast\(\.\.\.submissionToast\(res\.data, 'Mortality record saved\.'\)\)/)
    expect(source).toMatch(/showToast\(\.\.\.submissionToast\(res\.data, 'Physical count saved\.'\)\)/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
run('approval defaults and task authorisation, end to end', () => {
  const tenantId = `t-appr-${randomUUID()}`
  const farmId = `f-${randomUUID()}`
  const unitId = `u-${randomUUID()}`
  const batchId = `b-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const workerUserId = `usr-worker-${randomUUID()}`
  const otherWorkerUserId = `usr-worker2-${randomUUID()}`
  const employeeId = `emp-${randomUUID()}`
  const otherEmployeeId = `emp2-${randomUUID()}`

  let ownerSession: string
  let workerSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Approval Co.', active: true })
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Nyeri', code: 'FRM-A' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House', code: 'HSE-A' })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: `owner-${randomUUID()}@test.ifms`, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerUserId, tenantId, name: 'Worker', email: `worker-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: otherWorkerUserId, tenantId, name: 'Other Worker', email: `worker2-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values([
      { id: employeeId, tenantId, userId: workerUserId, name: 'Worker', phone: '', role: 'worker' },
      { id: otherEmployeeId, tenantId, userId: otherWorkerUserId, name: 'Other Worker', phone: '', role: 'worker' },
    ])
    // NOTE: no rolePermissions rows are inserted anywhere in this suite. That
    // is the entire point — this is a tenant nobody has configured, which is
    // what every tenant looks like the day it is provisioned.
    ownerSession = await createSession(ownerId)
    workerSession = await createSession(workerUserId)
  })

  beforeEach(async () => {
    await db.delete(batchMovements).where(eq(batchMovements.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(tasks).where(eq(tasks.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'BRO-A', name: 'Broilers', enterprise: 'broiler',
      initialQty: 400, currentQty: 400,
    })
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(batchMovements).where(eq(batchMovements.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(tasks).where(eq(tasks.tenantId, tenantId))
    await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, workerUserId, otherWorkerUserId]))
    await db.delete(users).where(inArray(users.id, [ownerId, workerUserId, otherWorkerUserId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function currentQty() {
    const [b] = await db.select().from(batches).where(eq(batches.id, batchId))
    return b.currentQty
  }

  async function postRecord(body: Record<string, unknown>, cookie: string) {
    mockCookie = cookie
    const res = await readJson(await recordsPOST(
      jsonRequest('http://localhost/api/records', 'POST', { tenantId, batchId, employeeId, ...body })
    ))
    mockCookie = undefined
    return res
  }

  describe('an unconfigured tenant holds a worker’s mortality', () => {
    it('files the record, raises an approval, and does NOT move the count', async () => {
      const res = await postRecord({ type: 'mortality', data: { count: 25, cause: 'Disease' } }, workerSession)
      expect(res.status).toBe(201)
      expect(res.payload.data.pendingApproval).toBe(true)
      expect(await currentQty()).toBe(400)

      const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
      expect(approval.type).toBe('mortality')
      expect(approval.status).toBe('pending')

      // And the record says so, which is what the worker's own history reads.
      const [record] = await db.select().from(records).where(eq(records.tenantId, tenantId))
      expect((record.data as Record<string, unknown>).pendingApproval).toBe(true)
    })

    it('moves the count only when the owner approves', async () => {
      const res = await postRecord({ type: 'mortality', data: { count: 25, cause: 'Disease' } }, workerSession)
      const approvalId = res.payload.data.approvalRequestId
      expect(await currentQty()).toBe(400)

      mockCookie = ownerSession
      const decided = await readJson(await approvePOST(
        new Request('http://localhost', { method: 'POST' }),
        { params: Promise.resolve({ id: approvalId }) }
      ))
      mockCookie = undefined
      expect(decided.status).toBe(200)
      expect(await currentQty()).toBe(375)
    })

    it('holds a worker’s physical count the same way', async () => {
      const res = await postRecord({ type: 'physical_count', data: { physicalCount: 380 } }, workerSession)
      expect(res.payload.data.pendingApproval).toBe(true)
      expect(await currentQty()).toBe(400)
    })

    it('still applies the owner’s own mortality immediately', async () => {
      const res = await postRecord({ type: 'mortality', data: { count: 4 } }, ownerSession)
      expect(res.payload.data.pendingApproval).toBeUndefined()
      expect(await currentQty()).toBe(396)
    })

    it('audits the immediate, unreviewed correction — the one that had no trail', async () => {
      await postRecord({ type: 'mortality', data: { count: 4 } }, ownerSession)
      const rows = await db.select().from(auditLog).where(eq(auditLog.tenantId, tenantId))
      const applied = rows.filter((r) => r.action === 'batch.mortality_applied')
      expect(applied.length).toBe(1)
      expect(applied[0].actor).toBe(ownerId)
      expect((applied[0].meta as Record<string, unknown>).approved).toBe(false)
    })

    it('a DB row still wins — an owner who unticks the box gets the old behaviour', async () => {
      await db.insert(rolePermissions).values({
        id: randomUUID(), tenantId, role: 'worker', module: 'mortality',
        access: 'edit', approvalRequired: false,
      })
      const res = await postRecord({ type: 'mortality', data: { count: 10 } }, workerSession)
      expect(res.payload.data.pendingApproval).toBeUndefined()
      expect(await currentQty()).toBe(390)
      await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    })
  })

  describe('a worker cannot reassign anyone’s task', () => {
    async function createTask(body: Record<string, unknown>) {
      mockCookie = ownerSession
      const res = await readJson(await tasksPOST(
        jsonRequest('http://localhost/api/tasks', 'POST', { title: 'Feed House A', ...body })
      ))
      mockCookie = undefined
      return res.payload.data
    }

    async function patchAsWorker(id: string, body: Record<string, unknown>) {
      mockCookie = workerSession
      const res = await readJson(await taskPATCH(
        jsonRequest(`http://localhost/api/tasks/${id}`, 'PATCH', body),
        { params: Promise.resolve({ id }) }
      ))
      mockCookie = undefined
      return res
    }

    it('refuses a reassignment with a message naming the way forward', async () => {
      const task = await createTask({ assigneeId: employeeId })
      const res = await patchAsWorker(task.id, { assigneeId: otherEmployeeId })
      expect(res.status).toBe(403)
      expect(res.payload.error).toMatch(/owner or manager/i)
      expect(res.payload.error).toMatch(/ask them to reassign/i)

      const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id))
      expect(after.assigneeId).toBe(employeeId)
    })

    it('refuses approverId, requiresApproval, title, dueAt and priority too', async () => {
      const task = await createTask({ assigneeId: employeeId })
      for (const body of [
        { approverId: ownerId },
        { requiresApproval: true },
        { title: 'Something else' },
        { dueAt: new Date().toISOString() },
        { priority: 'high' },
        { notes: 'Assigned: Other Worker' },
      ]) {
        const res = await patchAsWorker(task.id, body)
        expect(res.status).toBe(403)
      }
      const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id))
      expect(after.title).toBe('Feed House A')
      expect(after.requiresApproval).toBe(false)
    })

    it('still lets a worker mark their OWN task done — the load-bearing case', async () => {
      const task = await createTask({ assigneeId: employeeId })
      const res = await patchAsWorker(task.id, { status: 'DONE' })
      expect(res.status).toBe(200)
      expect(res.payload.data.status).toBe('DONE')
    })

    it('still lets a worker complete an UNASSIGNED task', async () => {
      // Tasks are routinely created with no assigneeId and the assignee's
      // name carried only in the notes prefix; refusing these would stop
      // workers completing most of the tenant's real work.
      const task = await createTask({})
      const res = await patchAsWorker(task.id, { status: 'DONE' })
      expect(res.status).toBe(200)
    })

    it('refuses a status change on a task assigned to somebody else', async () => {
      const task = await createTask({ assigneeId: otherEmployeeId })
      const res = await patchAsWorker(task.id, { status: 'DONE' })
      expect(res.status).toBe(403)
      expect(res.payload.error).toMatch(/assigned to someone else/i)
    })

    it('refuses a worker deleting a task, and audits an owner who does', async () => {
      const task = await createTask({ assigneeId: employeeId })
      mockCookie = workerSession
      const denied = await readJson(await taskDELETE(
        jsonRequest(`http://localhost/api/tasks/${task.id}`, 'DELETE'),
        { params: Promise.resolve({ id: task.id }) }
      ))
      expect(denied.status).toBe(403)

      mockCookie = ownerSession
      const ok = await readJson(await taskDELETE(
        jsonRequest(`http://localhost/api/tasks/${task.id}`, 'DELETE'),
        { params: Promise.resolve({ id: task.id }) }
      ))
      mockCookie = undefined
      expect(ok.status).toBe(200)

      const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, task.id))
      const deleted = rows.filter((r) => r.action === 'task.deleted')
      expect(deleted.length).toBe(1)
      expect((deleted[0].meta as Record<string, unknown>).title).toBe('Feed House A')
    })

    it('lets an owner reassign, and writes exactly one audit row for it', async () => {
      const task = await createTask({ assigneeId: employeeId })
      mockCookie = ownerSession
      const res = await readJson(await taskPATCH(
        jsonRequest(`http://localhost/api/tasks/${task.id}`, 'PATCH', { assigneeId: otherEmployeeId }),
        { params: Promise.resolve({ id: task.id }) }
      ))
      mockCookie = undefined
      expect(res.status).toBe(200)

      const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, task.id))
      const reassigned = rows.filter((r) => r.action === 'task.reassigned')
      // One action, one row — not one per update branch.
      expect(reassigned.length).toBe(1)
      expect((reassigned[0].meta as Record<string, unknown>).assigneeFrom).toBe(employeeId)
      expect((reassigned[0].meta as Record<string, unknown>).assigneeTo).toBe(otherEmployeeId)
    })

    it('writes no audit row for a patch that changes no accountability', async () => {
      const task = await createTask({ assigneeId: employeeId })
      mockCookie = ownerSession
      await taskPATCH(
        jsonRequest(`http://localhost/api/tasks/${task.id}`, 'PATCH', { title: 'Retitled only' }),
        { params: Promise.resolve({ id: task.id }) }
      )
      mockCookie = undefined
      const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, task.id))
      expect(rows.filter((r) => r.action === 'task.reassigned').length).toBe(0)
    })
  })
})
