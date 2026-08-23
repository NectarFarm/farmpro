import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { onboardRequests } from '@/db/schemas'
import { validateBody } from '@/app/api/onboard-requests/route'
import { gpsRequirementError, hasCoordinateInput } from '@/lib/validation'
import { closeOnboardUpdateToken, loadOnboardRequestForUpdate, resolveOnboardUpdateToken } from '@/lib/onboard-update'

// ── GET/POST /api/onboard-requests/update/[token] (feat/email-notifications) ─
// Authenticated by a share token in the URL instead of a session cookie —
// same shape as GET /api/auditor/[token]/reports/[type]
// (lib/auditor.ts/resolveAuditorTenantId): an applicant marked 'info-needed'
// (PATCH /api/onboard-requests/[id]) has no account, so this is the only way
// they can correct and resubmit their own request. An invalid/expired/
// closed-out token 401s, exactly like the auditor route.
//
// POST reuses validateBody from POST /api/onboard-requests verbatim — the
// task's own instruction is "do not write a second set of rules" — so the
// same field shape/limits apply to a correction as to the original
// submission. consentAt/consentVersion are never touched here: they were
// recorded once, server-side, at original submission (POST
// /api/onboard-requests) and PATCH /api/onboard-requests/[id] already
// forbids an ADMIN from granting/backdating them; this route — driven by the
// applicant themselves — still leaves them exactly as they were. The
// `consentGiven` field validateBody requires is read only to gate
// validation (an applicant reaffirms the corrected info is accurate); its
// value is never persisted.
//
// A resubmission only succeeds while the request is still 'info-needed' —
// if an admin has already acted on it a different way in the meantime
// (approved/rejected it, or already moved it back to pending), the token is
// refused with a clear reason rather than silently overwriting whatever the
// admin decided.

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resolved = await resolveOnboardUpdateToken(token)
  if (!resolved) return bad('This link is invalid, expired, or has already been used to resubmit.', 401)

  const request = await loadOnboardRequestForUpdate(resolved.onboardRequestId)
  if (!request) return bad('This link is invalid, expired, or has already been used to resubmit.', 401)

  return ok({
    farmerName: request.farmerName,
    email: request.email,
    phone: request.phone,
    farmName: request.farmName,
    location: request.location,
    enterprises: request.enterprises,
    address: request.address,
    latitude: request.latitude,
    longitude: request.longitude,
    status: request.status,
    notes: request.notes,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resolved = await resolveOnboardUpdateToken(token)
  if (!resolved) return bad('This link is invalid, expired, or has already been used to resubmit.', 401)

  const existing = await loadOnboardRequestForUpdate(resolved.onboardRequestId)
  if (!existing) return bad('This link is invalid, expired, or has already been used to resubmit.', 401)
  if (existing.status !== 'info-needed') {
    return bad('This request has already been reviewed and can no longer be edited from this link.', 409)
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const result = validateBody(b)

  // Same "pin your farm, or say you can't" rule the public POST applies —
  // but measured against what the row will actually hold AFTER this
  // resubmission, not against what this body happens to restate. A form
  // that never touches location keeps the pin already on file and so
  // satisfies the rule without resending anything; a body that sends
  // `address` alone would blank the pin (see locationSet below) and
  // therefore has to carry the acknowledgement like any other pinless
  // submission.
  //
  // This matters most for exactly the case that produces these links: an
  // admin asking for info BECAUSE the location is missing. That applicant
  // now cannot resubmit without either adding the pin or stating they
  // can't.
  const hasLocationInput = b.address !== undefined || b.latitude !== undefined || b.longitude !== undefined
  const willHaveCoords = hasCoordinateInput(b)
    || (!hasLocationInput && existing.latitude !== null && existing.longitude !== null)
  const gpsError = gpsRequirementError(willHaveCoords, b.locationSkipped)
  const fields: Record<string, string> = { ...result.fields }
  if (gpsError && !fields.latitude) fields.latitude = gpsError

  if (!result.ok || gpsError) {
    const fieldNames = Object.keys(fields)
    return NextResponse.json(
      { success: false, error: fields[fieldNames[0]], fields },
      { status: 400 }
    )
  }

  // GPS is optional and all-or-nothing (lib/validation.ts#validateLocation),
  // so validateBody resolves address/latitude/longitude to null whenever
  // the body simply didn't include them — same as an applicant who never
  // had a pin to begin with. But this applicant DID have one, set by the
  // original POST (or an admin's LocationEditor correction), so a
  // resubmission that only fixes e.g. a typo'd phone number and never
  // touches location must not silently erase it. Mirrors PATCH
  // /api/onboard-requests/[id]'s own hasLocationInput/locationSet — only
  // apply validateBody's location result when the caller actually sent one.
  const locationSet = hasLocationInput
    ? { address: result.address, latitude: result.latitude, longitude: result.longitude }
    : { address: existing.address, latitude: existing.latitude, longitude: existing.longitude }

  const [updated] = await db
    .update(onboardRequests)
    .set({
      farmerName: result.farmerName,
      email: result.email,
      phone: result.phone,
      farmName: result.farmName,
      location: result.location,
      enterprises: result.enterprises,
      ...locationSet,
      // Back to pending for re-review — consentAt/consentVersion are
      // deliberately absent from this update, left exactly as originally
      // recorded.
      status: 'pending',
    })
    .where(eq(onboardRequests.id, existing.id))
    .returning()

  await closeOnboardUpdateToken(token)

  return ok({ id: updated.id, status: updated.status })
}
