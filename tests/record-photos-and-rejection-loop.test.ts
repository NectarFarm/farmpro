// ── Several photos per record, and a rejection worth acting on ─────────────
// Covers, in order: the photo cap + data-URL validation on POST
// /api/records, the migration 0044 backfill (photo_url -> photo_urls), a
// rejection with no reason being refused, that reason reaching the
// requester's own decision notification, and a worker being unable to
// resubmit — or file under — someone else's record.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, inArray, and, isNotNull, ne, sql } from 'drizzle-orm'

vi.mock('server-only', () => ({}))

let mockCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => (mockCookie ? { value: mockCookie } : undefined) })),
}))

import { POST as recordsPOST } from '@/app/api/records/route'
import { POST as rejectPOST } from '@/app/api/approvals/[id]/reject/route'
import { PATCH as recordPATCH } from '@/app/api/records/[id]/route'
import { db } from '@/db'
import {
  tenants, users, sessions, farms, productionUnits, batches, employees, records,
  approvalRequests, auditLog, rolePermissions, notifications,
} from '@/db/schemas'
import { createSession, hashSecret } from '@/lib/auth'
import { MAX_RECORD_PHOTOS, MAX_PHOTO_BYTES } from '@/lib/record-photos'

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

// A minimal, valid image data URL of a chosen decoded byte size — shape and
// charset are all POST /api/records actually checks (lib/record-photos.ts),
// never a real decodable image.
function fakePhoto(bytes = 100): string {
  const base64Len = Math.ceil(bytes / 3) * 4
  return `data:image/jpeg;base64,${'A'.repeat(base64Len)}`
}

run('several photos per record, and a rejection worth acting on', () => {
  const tenantId = `t-photos-${randomUUID()}`
  const farmId = `f-${randomUUID()}`
  const unitId = `u-${randomUUID()}`
  const batchId = `b-${randomUUID()}`
  const ownerId = `usr-owner-${randomUUID()}`
  const workerAUserId = `usr-worker-a-${randomUUID()}`
  const workerBUserId = `usr-worker-b-${randomUUID()}`
  const employeeAId = `emp-a-${randomUUID()}`
  const employeeBId = `emp-b-${randomUUID()}`
  const ownerEmail = `photos-owner-${randomUUID()}@test.ifms`
  const workerAEmail = `photos-worker-a-${randomUUID()}@test.ifms`

  let ownerSession: string
  let workerASession: string
  let workerBSession: string

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, name: 'Photos & Rejection Co.', active: true })
    await db.insert(farms).values({ id: farmId, tenantId, name: 'Farm', location: 'Nakuru', code: 'FRM-PR' })
    await db.insert(productionUnits).values({ id: unitId, tenantId, farmId, type: 'house', name: 'House', code: 'HSE-PR' })
    await db.insert(batches).values({
      id: batchId, tenantId, unitId, code: 'BRO-PR', name: 'Broilers', enterprise: 'broiler',
      initialQty: 500, currentQty: 500,
    })
    const salt = randomUUID()
    await db.insert(users).values([
      { id: ownerId, tenantId, name: 'Owner', email: ownerEmail, role: 'owner', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerAUserId, tenantId, name: 'Worker A', email: workerAEmail, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
      { id: workerBUserId, tenantId, name: 'Worker B', email: `photos-worker-b-${randomUUID()}@test.ifms`, role: 'worker', passwordHash: hashSecret('pw', salt), passwordSalt: salt, status: 'ACTIVE' },
    ])
    await db.insert(employees).values([
      { id: employeeAId, tenantId, userId: workerAUserId, name: 'Worker A', phone: '', role: 'worker' },
      { id: employeeBId, tenantId, userId: workerBUserId, name: 'Worker B', phone: '', role: 'worker' },
    ])
    // A worker's mortality/count needs sign-off — same shape as
    // tests/batch-ledger.test.ts, needed so a submission raises a real
    // approval this suite can reject.
    await db.insert(rolePermissions).values([
      { id: randomUUID(), tenantId, role: 'worker', module: 'mortality', access: 'edit', approvalRequired: true },
      { id: randomUUID(), tenantId, role: 'worker', module: 'physical-count', access: 'edit', approvalRequired: true },
    ])
    ownerSession = await createSession(ownerId)
    workerASession = await createSession(workerAUserId)
    workerBSession = await createSession(workerBUserId)
  })

  afterAll(async () => {
    mockCookie = undefined
    await db.delete(notifications).where(eq(notifications.tenantId, tenantId))
    await db.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId))
    await db.delete(records).where(eq(records.tenantId, tenantId))
    await db.delete(rolePermissions).where(eq(rolePermissions.tenantId, tenantId))
    await db.delete(employees).where(eq(employees.tenantId, tenantId))
    await db.delete(batches).where(eq(batches.id, batchId))
    await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId))
    await db.delete(farms).where(eq(farms.tenantId, tenantId))
    await db.delete(sessions).where(inArray(sessions.userId, [ownerId, workerAUserId, workerBUserId]))
    await db.delete(users).where(inArray(users.id, [ownerId, workerAUserId, workerBUserId]))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  async function postRecord(body: Record<string, unknown>, cookie: string) {
    mockCookie = cookie
    const res = await recordsPOST(jsonRequest('http://localhost/api/records', 'POST', { tenantId, batchId, ...body }))
    mockCookie = undefined
    return readJson(res)
  }

  describe('photo cap and data-URL validation', () => {
    it('accepts up to the max photos and writes the first one to photoUrl too', async () => {
      const photos = [fakePhoto(), fakePhoto(), fakePhoto()]
      const res = await postRecord({ employeeId: employeeAId, type: 'feeding', data: {}, photoUrls: photos }, ownerSession)
      expect(res.status).toBe(201)
      expect(res.payload.data.photoUrls).toEqual(photos)
      expect(res.payload.data.photoUrl).toBe(photos[0])
    })

    it('normalises a lone legacy photoUrl into a one-element photoUrls array', async () => {
      const photo = fakePhoto()
      const res = await postRecord({ employeeId: employeeAId, type: 'feeding', data: {}, photoUrl: photo }, ownerSession)
      expect(res.status).toBe(201)
      expect(res.payload.data.photoUrls).toEqual([photo])
      expect(res.payload.data.photoUrl).toBe(photo)
    })

    it(`refuses more than ${MAX_RECORD_PHOTOS} photos`, async () => {
      const photos = Array.from({ length: MAX_RECORD_PHOTOS + 1 }, () => fakePhoto())
      const res = await postRecord({ employeeId: employeeAId, type: 'feeding', data: {}, photoUrls: photos }, ownerSession)
      expect(res.status).toBe(400)
      expect(String(res.payload.error)).toContain(`${MAX_RECORD_PHOTOS} photos`)
    })

    it('refuses a photo that is not an image data URL', async () => {
      const res = await postRecord({ employeeId: employeeAId, type: 'feeding', data: {}, photoUrls: ['https://example.com/photo.jpg'] }, ownerSession)
      expect(res.status).toBe(400)
      expect(res.payload.success).toBe(false)
    })

    it('refuses a photo over the per-photo byte cap', async () => {
      const res = await postRecord({ employeeId: employeeAId, type: 'feeding', data: {}, photoUrls: [fakePhoto(MAX_PHOTO_BYTES + 1024)] }, ownerSession)
      expect(res.status).toBe(400)
      expect(String(res.payload.error)).toContain('too large')
    })

    it('accepts a photo comfortably under the cap', async () => {
      const res = await postRecord({ employeeId: employeeAId, type: 'feeding', data: {}, photoUrls: [fakePhoto(MAX_PHOTO_BYTES - 3000)] }, ownerSession)
      expect(res.status).toBe(201)
    })
  })

  describe('migration 0044 backfill', () => {
    it('fills photo_urls from an existing photo_url, and leaves photo_urls alone when there is none', async () => {
      const withPhotoId = `rec-legacy-${randomUUID()}`
      const withoutPhotoId = `rec-legacy-none-${randomUUID()}`
      const photo = fakePhoto()
      // Inserted the way a pre-0044 row looked: a real photo_url, and
      // photo_urls left at the column's own default ([]) — exactly what the
      // migration's UPDATE is meant to fix for rows already in the table.
      await db.insert(records).values([
        { id: withPhotoId, tenantId, batchId, employeeId: employeeAId, type: 'mortality', data: {}, photoUrl: photo },
        { id: withoutPhotoId, tenantId, batchId, employeeId: employeeAId, type: 'mortality', data: {} },
      ])

      // Same update the migration's backfill runs (drizzle/0044_record_
      // photos_and_rejection_reason.sql), scoped to these two rows so it can
      // be exercised here without touching every other row in the table.
      await db.update(records)
        .set({ photoUrls: sql`jsonb_build_array(${records.photoUrl})` })
        .where(and(isNotNull(records.photoUrl), ne(records.photoUrl, ''), inArray(records.id, [withPhotoId, withoutPhotoId])))

      const rows = await db.select().from(records).where(inArray(records.id, [withPhotoId, withoutPhotoId]))
      const withPhotoRow = rows.find((r) => r.id === withPhotoId)!
      const withoutPhotoRow = rows.find((r) => r.id === withoutPhotoId)!
      expect(withPhotoRow.photoUrls).toEqual([photo])
      expect(withoutPhotoRow.photoUrls).toEqual([])

      await db.delete(records).where(inArray(records.id, [withPhotoId, withoutPhotoId]))
    })
  })

  describe('a rejection without a reason is refused', () => {
    it('400s an empty body', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 5, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId

      mockCookie = ownerSession
      const res = await readJson(await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', {}), { params: Promise.resolve({ id: approvalId }) }))
      mockCookie = undefined
      expect(res.status).toBe(400)
      expect(String(res.payload.error)).toMatch(/reason/i)

      // And the approval is still there to actually decide, with a reason,
      // afterwards — refusing the empty one must not have consumed it.
      const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId))
      expect(approval.status).toBe('pending')
    })

    it('400s a whitespace-only reason', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 5, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId

      mockCookie = ownerSession
      const res = await readJson(await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', { reason: '   ' }), { params: Promise.resolve({ id: approvalId }) }))
      mockCookie = undefined
      expect(res.status).toBe(400)
    })
  })

  describe('the reason reaches the worker\'s notification', () => {
    it('lands in the decided notification, targeted at the person who submitted it', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 7, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId
      const recordId = created.payload.data.id

      mockCookie = ownerSession
      const decided = await readJson(await rejectPOST(
        jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', { reason: 'Photo does not show the birds clearly' }),
        { params: Promise.resolve({ id: approvalId }) },
      ))
      mockCookie = undefined
      expect(decided.status).toBe(200)

      // Persisted on the approval row itself...
      const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId))
      expect(approval.decisionNote).toBe('Photo does not show the birds clearly')

      // ...and on the record's own data, next to approvalDecision — what the
      // worker's and approver's screens actually read.
      const [record] = await db.select().from(records).where(eq(records.id, recordId))
      expect((record.data as Record<string, unknown>).approvalDecision).toBe('rejected')
      expect((record.data as Record<string, unknown>).decisionNote).toBe('Photo does not show the birds clearly')

      // The notification: targeted at Worker A (who raised it, not the
      // owner who decided it), carrying the reason.
      const [notif] = await db.select().from(notifications).where(eq(notifications.sourceId, `${approvalId}:decided`))
      expect(notif.userId).toBe(workerAUserId)
      expect(notif.title).toContain('rejected')
      expect(notif.message).toContain('Photo does not show the birds clearly')
    })
  })

  describe('a worker cannot resubmit — or file under — someone else\'s record', () => {
    it('refuses a worker filing any record under another employee\'s id', async () => {
      const res = await postRecord({ employeeId: employeeBId, type: 'feeding', data: {} }, workerASession)
      expect(res.status).toBe(403)
    })

    it('refuses worker B impersonating employee A to resubmit A\'s rejected record', async () => {
      // Worker A's record gets rejected.
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 3, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId
      const recordId = created.payload.data.id
      mockCookie = ownerSession
      await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', { reason: 'Recount please' }), { params: Promise.resolve({ id: approvalId }) })
      mockCookie = undefined

      // Worker B, logged in as themself, claims employeeId A — blocked by
      // the plain worker-may-only-file-under-their-own-employeeId rule,
      // before the resubmission-ownership check even runs.
      const asB = await postRecord(
        { employeeId: employeeAId, type: 'mortality', data: { count: 2, cause: 'Disease' }, resubmitsRecordId: recordId },
        workerBSession,
      )
      expect(asB.status).toBe(403)
    })

    it('refuses resubmitting under the RIGHT employeeId when the record belongs to someone else', async () => {
      // A record filed under employee A...
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 3, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId
      const recordId = created.payload.data.id
      mockCookie = ownerSession
      await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', { reason: 'Recount please' }), { params: Promise.resolve({ id: approvalId }) })
      mockCookie = undefined

      // ...cannot be "resubmitted" by employee B, even filed honestly under
      // B's own id — the ORIGINAL record's owner doesn't match.
      const asB = await postRecord(
        { employeeId: employeeBId, type: 'mortality', data: { count: 2, cause: 'Disease' }, resubmitsRecordId: recordId },
        workerBSession,
      )
      expect(asB.status).toBe(403)
      expect(String(asB.payload.error)).toMatch(/own record/i)
    })

    it('refuses resubmitting a record that was never rejected', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 3, cause: 'Disease' } }, workerASession)
      const recordId = created.payload.data.id // still pending — never decided

      const res = await postRecord(
        { employeeId: employeeAId, type: 'mortality', data: { count: 3, cause: 'Disease' }, resubmitsRecordId: recordId },
        workerASession,
      )
      expect(res.status).toBe(400)
    })

    it('lets a worker resubmit their OWN rejected record, linking the two', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 9, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId
      const recordId = created.payload.data.id
      mockCookie = ownerSession
      await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', { reason: 'Recount please' }), { params: Promise.resolve({ id: approvalId }) })
      mockCookie = undefined

      const resubmitted = await postRecord(
        { employeeId: employeeAId, type: 'mortality', data: { count: 4, cause: 'Disease' }, resubmitsRecordId: recordId },
        workerASession,
      )
      expect(resubmitted.status).toBe(201)
      expect(resubmitted.payload.data.data.resubmitsRecordId).toBe(recordId)
      expect(resubmitted.payload.data.pendingApproval).toBe(true)
    })
  })

  describe('PATCH /api/records/[id]: reply with a note', () => {
    it('lets the worker reply on their own rejected record', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 6, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId
      const recordId = created.payload.data.id
      mockCookie = ownerSession
      await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', { reason: 'Recount please' }), { params: Promise.resolve({ id: approvalId }) })
      mockCookie = undefined

      mockCookie = workerASession
      const res = await readJson(await recordPATCH(jsonRequest(`http://localhost/api/records/${recordId}`, 'PATCH', { note: 'Will recount tomorrow morning' }), { params: Promise.resolve({ id: recordId }) }))
      mockCookie = undefined
      expect(res.status).toBe(200)
      expect(res.payload.data.data.workerNote).toBe('Will recount tomorrow morning')
    })

    it('refuses a reply on someone else\'s record', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 6, cause: 'Disease' } }, workerASession)
      const approvalId = created.payload.data.approvalRequestId
      const recordId = created.payload.data.id
      mockCookie = ownerSession
      await rejectPOST(jsonRequest(`http://localhost/api/approvals/${approvalId}/reject`, 'POST', { reason: 'Recount please' }), { params: Promise.resolve({ id: approvalId }) })
      mockCookie = undefined

      mockCookie = workerBSession
      const res = await readJson(await recordPATCH(jsonRequest(`http://localhost/api/records/${recordId}`, 'PATCH', { note: 'Not mine to reply on' }), { params: Promise.resolve({ id: recordId }) }))
      mockCookie = undefined
      expect(res.status).toBe(403)
    })

    it('refuses a reply on a record that is not rejected', async () => {
      const created = await postRecord({ employeeId: employeeAId, type: 'mortality', data: { count: 6, cause: 'Disease' } }, workerASession)
      const recordId = created.payload.data.id // still pending

      mockCookie = workerASession
      const res = await readJson(await recordPATCH(jsonRequest(`http://localhost/api/records/${recordId}`, 'PATCH', { note: 'too soon' }), { params: Promise.resolve({ id: recordId }) }))
      mockCookie = undefined
      expect(res.status).toBe(400)
    })
  })
})
