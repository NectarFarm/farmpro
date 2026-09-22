import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { records, employees } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit'

// ── PATCH /api/records/[id] (rejection-loop task) ────────────────────────────
// One narrow purpose today: "Reply with a note" — a worker's short written
// reply to a rejection, attached to the SAME record the owner already sees
// in Approvals. Not a general record-edit endpoint: "Fix and resubmit" goes
// through POST /api/records instead (a fresh record, so the rejected one and
// its reason stay exactly as decided — see that route's `resubmitsRecordId`
// comment), and nothing here lets a worker touch anyone else's record.
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

const MAX_NOTE_LENGTH = 500

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  // Only a worker replies — an owner/manager writes the rejection REASON
  // (POST /api/approvals/[id]/reject), not a reply to their own decision.
  const auth = await requireTenantSession({ roles: ['worker'] })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (!note) return badRequest('A note is required')
  if (note.length > MAX_NOTE_LENGTH) return badRequest(`Keep the note under ${MAX_NOTE_LENGTH} characters`)

  const [record] = await db
    .select()
    .from(records)
    .where(and(eq(records.id, id), eq(records.tenantId, tenantId)))
    .limit(1)
  if (!record) return notFound('Record not found')

  // A worker may only touch their own records — same rule POST /api/records
  // enforces on the way in, checked here on the way back.
  const [ownEmployee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, session.id)))
    .limit(1)
  if (!ownEmployee || ownEmployee.id !== record.employeeId) {
    return forbidden('You can only reply on your own records')
  }

  const data = (record.data ?? {}) as Record<string, unknown>
  if (data.approvalDecision !== 'rejected') {
    return badRequest('Only a rejected record can get a reply')
  }

  const [updated] = await db
    .update(records)
    .set({ data: { ...data, workerNote: note, workerNoteAt: new Date().toISOString() } })
    .where(eq(records.id, id))
    .returning()

  await writeAuditLog({
    tenantId,
    actor: session.id,
    action: 'record.worker_note_added',
    entity: 'record',
    entityId: id,
    meta: { note },
  })

  return ok(updated)
}
