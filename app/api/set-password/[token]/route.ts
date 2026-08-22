import { NextResponse } from 'next/server'
import { consumeSetPasswordToken, MIN_SET_PASSWORD_LENGTH, resolveSetPasswordToken } from '@/lib/set-password'

// ── GET/POST /api/set-password/[token] (feat/email-notifications) ──────────
// Authenticated by a share token in the URL instead of a session cookie —
// same shape as GET /api/auditor/[token]/reports/[type]
// (lib/auditor.ts/resolveAuditorTenantId). This is what an approved
// onboarding applicant's email link actually points at (PATCH
// /api/onboard-requests/[id] mints the token via lib/set-password.ts instead
// of emailing the temp password itself).
//
// GET resolves (without consuming) so the page can show who it's setting a
// password for before the applicant types anything. POST is the one-time
// consume: an invalid, expired, or already-used token is refused with the
// same 401 either way — this endpoint never distinguishes "used" from
// "expired" from "never existed" in its response, so a stale link can't be
// used to fingerprint why it stopped working.

const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

const INVALID_MSG = 'This link is invalid, expired, or has already been used.'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const info = await resolveSetPasswordToken(token)
  if (!info) return bad(INVALID_MSG, 401)
  return ok({ email: info.email, name: info.name })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const password = typeof b.password === 'string' ? b.password : ''
  if (!password || password.length < MIN_SET_PASSWORD_LENGTH) {
    return bad(`password must be at least ${MIN_SET_PASSWORD_LENGTH} characters`)
  }

  const result = await consumeSetPasswordToken(token, password)
  if (!result.ok) return bad(INVALID_MSG, 401)

  return ok({ done: true })
}
