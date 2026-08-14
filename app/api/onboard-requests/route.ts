import { NextResponse } from 'next/server'
import { desc } from 'drizzle-orm'
import { db } from '@/db'
import { onboardRequests } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'

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

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
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

  const farmerName = str(b.farmerName)
  const email = str(b.email).toLowerCase()
  const phone = str(b.phone)
  const farmName = str(b.farmName)
  const location = str(b.location)
  const enterprises = Array.isArray(b.enterprises)
    ? b.enterprises.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    : []

  if (!farmerName) return bad('farmerName is required')
  if (!email || !EMAIL_RE.test(email)) return bad('A valid email is required')
  if (!phone) return bad('phone is required')
  if (!farmName) return bad('farmName is required')
  if (!location) return bad('location is required')
  if (enterprises.length === 0) return bad('At least one enterprise is required')

  const id = crypto.randomUUID()
  await db.insert(onboardRequests).values({
    id,
    farmerName,
    email,
    phone,
    farmName,
    location,
    enterprises,
    status: 'pending',
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
