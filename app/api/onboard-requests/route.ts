import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { db } from '@/db'
import { onboardRequests } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import {
  normalizeEmail,
  isValidEmail,
  normalizePhone,
  isValidPhone,
  toStoredPhone,
  validateLocation,
} from '@/lib/validation'

// ── Onboarding-request queue (issue #251) ───────────────────────────────────
// POST is public (no session) — an applicant with no account submits a
// signup request. GET is the super_admin review queue. Same-origin only, no
// CORS headers, matching app/api/auth/session/route.ts.
//
// Response envelope matches app/api/farms/route.ts / lib/api-response.ts
// ({ success, data | error }).
//
// Contract locked for issue #224 (parallel PR building the Register screen
// against it):
//   POST body  { farmerName, email, phone, farmName, location, enterprises }
//   POST reply 201 { success: true, data: { id } }
//
// issues #251/#252 extend the body with the applicant's optional GPS pin +
// reverse-geocoded address (RegisterScreen collects them but used to throw
// them away) and REQUIRED consent — see validateBody() below. Validation
// failures return 400 with BOTH a single human-readable `error` (so old
// callers that only read `error` keep working) and a `fields` map keyed by
// body field name, collecting every failure at once so the form can
// highlight all of them together, not just the first.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function inRange(s: string, min: number, max: number): boolean {
  return s.length >= min && s.length <= max
}

const MAX_CONSENT_VERSION_LEN = 32
const DEFAULT_CONSENT_VERSION = 'v1'

// Exported so POST /api/onboard-requests/update/[token] (the applicant's own
// info-needed correction flow) can reuse the exact same field rules instead
// of a second, drifting copy — see that route's header.
export interface ValidatedOnboardBody {
  farmerName: string
  email: string
  phone: string
  farmName: string
  location: string
  enterprises: string[]
  address: string | null
  latitude: number | null
  longitude: number | null
  consentVersion: string
}

export type ValidationOutcome =
  | { ok: false; fields: Record<string, string> }
  | ({ ok: true; fields: Record<string, never> } & ValidatedOnboardBody)

// Validates + normalizes the whole POST body in one pass, collecting every
// failure instead of bailing on the first (the form highlights all bad
// fields at once). Exported: this is the ONE set of onboarding field rules —
// the applicant's own resubmission route (POST
// /api/onboard-requests/update/[token]) calls this exact function rather
// than re-implementing any of it.
export function validateBody(b: Record<string, unknown>): ValidationOutcome {
  const fields: Record<string, string> = {}

  const farmerName = str(b.farmerName)
  if (!farmerName) fields.farmerName = 'farmerName is required'
  else if (!inRange(farmerName, 2, 120)) fields.farmerName = 'farmerName must be 2-120 characters'

  const email = normalizeEmail(b.email)
  if (!email) fields.email = 'email is required'
  else if (!isValidEmail(email)) fields.email = 'A valid email is required'

  const phoneNormalized = normalizePhone(b.phone)
  let phone = ''
  if (!phoneNormalized) fields.phone = 'phone is required'
  else if (!isValidPhone(phoneNormalized)) {
    fields.phone = 'A valid phone number is required (e.g. +2547XXXXXXXX or 07XXXXXXXX)'
  } else {
    phone = toStoredPhone(phoneNormalized)
  }

  const farmName = str(b.farmName)
  if (!farmName) fields.farmName = 'farmName is required'
  else if (!inRange(farmName, 2, 120)) fields.farmName = 'farmName must be 2-120 characters'

  const location = str(b.location)
  if (!location) fields.location = 'location is required'
  else if (!inRange(location, 2, 120)) fields.location = 'location must be 2-120 characters'

  let enterprises: string[] = []
  if (!Array.isArray(b.enterprises) || b.enterprises.length === 0) {
    fields.enterprises = 'At least one enterprise is required'
  } else if (b.enterprises.length > 20) {
    fields.enterprises = 'At most 20 enterprises are allowed'
  } else {
    const cleaned = b.enterprises.map((e) => (typeof e === 'string' ? e.trim() : ''))
    if (cleaned.some((e) => e.length === 0 || e.length > 64)) {
      fields.enterprises = 'Each enterprise must be a non-empty string of at most 64 characters'
    } else {
      enterprises = cleaned
    }
  }

  const loc = validateLocation({ address: b.address, latitude: b.latitude, longitude: b.longitude })
  Object.assign(fields, loc.fields)

  // Consent (contract addition, server-recorded so it's provable, not just
  // checked in the browser). Must be a literal boolean true — not "true",
  // not 1, not merely truthy — anything else means consent wasn't actually
  // given and is rejected outright.
  if (b.consentGiven !== true) {
    fields.consentGiven = 'consentGiven must be true'
  }

  let consentVersion = DEFAULT_CONSENT_VERSION
  if (b.consentVersion !== undefined) {
    const v = str(b.consentVersion)
    if (!v) {
      fields.consentVersion = 'consentVersion must be a non-empty string'
    } else if (v.length > MAX_CONSENT_VERSION_LEN) {
      fields.consentVersion = `consentVersion must be at most ${MAX_CONSENT_VERSION_LEN} characters`
    } else {
      consentVersion = v
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields }
  }

  return {
    ok: true,
    fields: {},
    farmerName,
    email,
    phone,
    farmName,
    location,
    enterprises,
    address: loc.address,
    latitude: loc.latitude,
    longitude: loc.longitude,
    consentVersion,
  }
}

// POST /api/onboard-requests — public signup request.
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const result = validateBody(b)
  if (!result.ok) {
    const fieldNames = Object.keys(result.fields)
    return NextResponse.json(
      { success: false, error: result.fields[fieldNames[0]], fields: result.fields },
      { status: 400 }
    )
  }

  const id = crypto.randomUUID()
  await db.insert(onboardRequests).values({
    id,
    farmerName: result.farmerName,
    email: result.email,
    phone: result.phone,
    farmName: result.farmName,
    location: result.location,
    enterprises: result.enterprises,
    address: result.address,
    latitude: result.latitude,
    longitude: result.longitude,
    status: 'pending',
    // consentAt is always the SERVER clock — a consentAt field in the body
    // (if the client sends one) is never read, let alone trusted.
    consentAt: new Date(),
    consentVersion: result.consentVersion,
  })

  return NextResponse.json({ success: true, data: { id } }, { status: 201 })
}

// GET /api/onboard-requests — super_admin review queue, newest first.
export async function GET() {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const rows = await db.select().from(onboardRequests).orderBy(desc(onboardRequests.requestedAt))
  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}
