import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { onboardRequests } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { provisionTenant } from '@/lib/tenant-provisioning'
import { validateLocation } from '@/lib/validation'

// ── PATCH /api/onboard-requests/[id] (issue #251) ───────────────────────────
// super_admin only. Body: { status: 'approved' | 'rejected' | 'info-needed', notes? }.
// Approving calls lib/tenant-provisioning.ts's shared transaction — see that
// file's header for why the logic lives there instead of a currently
// nonexistent POST /api/admin/tenants — and stamps the request with the new
// tenantId so a second approve can't provision twice.
//
// issue #252 extends the body with optional address/latitude/longitude so the
// admin review screen's LocationEditor (previously browser-state-only) can
// actually persist a correction/addition to the applicant's GPS pin. This is
// independent of a status change — an admin can set coordinates on a still-
// pending request — and reuses lib/validation.ts's validateLocation so the
// same rules (range, all-or-nothing pair) apply as on the public POST.
//
// consentAt/consentVersion are NEVER writable here — consent is something
// only the applicant can give, recorded once at submission time (see POST).
// An admin editing this row cannot grant or backdate it on their behalf.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'info-needed'])

// Postgres unique-violation (23505) — e.g. the applicant's email already
// belongs to a user. Surfaced as a clean envelope, not a bare 500.
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === '23505'
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const { id } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  // consentAt/consentVersion are applicant-only, set once at POST time.
  // Reject outright rather than silently dropping, so a caller that tries to
  // grant/backdate consent gets a clear, provable failure instead of a
  // request that looks like it succeeded.
  const fields: Record<string, string> = {}
  if ('consentAt' in b) fields.consentAt = 'consentAt cannot be modified after submission'
  if ('consentVersion' in b) fields.consentVersion = 'consentVersion cannot be modified after submission'
  if (Object.keys(fields).length > 0) {
    const firstKey = Object.keys(fields)[0]
    return NextResponse.json({ success: false, error: fields[firstKey], fields }, { status: 400 })
  }

  const status = typeof b.status === 'string' ? b.status : ''
  const notes = typeof b.notes === 'string' ? b.notes.trim() : undefined

  // Location fields are optional and independent of status — an admin can
  // set/correct coordinates on a still-pending request without deciding it.
  const hasLocationInput = b.address !== undefined || b.latitude !== undefined || b.longitude !== undefined
  const loc = hasLocationInput ? validateLocation({ address: b.address, latitude: b.latitude, longitude: b.longitude }) : null
  if (loc && Object.keys(loc.fields).length > 0) {
    const firstKey = Object.keys(loc.fields)[0]
    return NextResponse.json({ success: false, error: loc.fields[firstKey], fields: loc.fields }, { status: 400 })
  }

  const hasStatusChange = status.length > 0
  if (hasStatusChange && !VALID_STATUSES.has(status)) {
    return bad('status must be one of: pending, approved, rejected, info-needed')
  }
  if (!hasStatusChange && !loc) {
    return bad('status must be one of: pending, approved, rejected, info-needed')
  }

  const rows = await db.select().from(onboardRequests).where(eq(onboardRequests.id, id)).limit(1)
  const existing = rows[0]
  if (!existing) return bad('Onboarding request not found', 404)

  const locationSet = loc
    ? { address: loc.address, latitude: loc.latitude, longitude: loc.longitude }
    : {}

  if (hasStatusChange && status === 'approved') {
    if (existing.tenantId) {
      // Already provisioned — return the existing result instead of
      // provisioning (and billing) a second tenant for the same request.
      return NextResponse.json({ success: true, data: existing }, { status: 200 })
    }
    try {
      const { tenantId, ownerTempPassword } = await provisionTenant({
        farmerName: existing.farmerName,
        email: existing.email,
        farmName: existing.farmName,
        location: existing.location,
      })
      const [updated] = await db
        .update(onboardRequests)
        .set({ status, tenantId, ...(notes !== undefined ? { notes } : {}), ...locationSet })
        .where(eq(onboardRequests.id, id))
        .returning()
      // ownerTempPassword is hashed into the DB and never stored in plaintext —
      // this is the ONE response where it's readable. It is only included on
      // the branch that actually provisions (never on the "already
      // provisioned" early-return above), since it can't be retrieved again.
      return NextResponse.json({ success: true, data: { ...updated, ownerTempPassword } }, { status: 200 })
    } catch (err) {
      if (isUniqueViolation(err)) {
        return NextResponse.json(
          { success: false, error: 'A tenant or user for this email already exists' },
          { status: 409 }
        )
      }
      return NextResponse.json({ success: false, error: 'Failed to provision tenant' }, { status: 500 })
    }
  }

  const [updated] = await db
    .update(onboardRequests)
    .set({
      ...(hasStatusChange ? { status } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...locationSet,
    })
    .where(eq(onboardRequests.id, id))
    .returning()
  return NextResponse.json({ success: true, data: updated }, { status: 200 })
}
