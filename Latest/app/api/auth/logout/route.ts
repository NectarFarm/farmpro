import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { clearSessionCookie, destroySession, SESSION_COOKIE } from '@/lib/auth'

// ── POST /api/auth/logout (issue #220/#221) ────────────────────────────────
// Deletes the session row and clears the httpOnly cookie. The shell fires this
// on sign-out (visible in the network tab — check #4 of #221) and always
// returns to the login screen regardless. Same-origin SPA only, so no CORS
// headers (issue #221 review).

export async function POST() {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  await destroySession(token)
  const res = NextResponse.json({ success: true, data: { loggedOut: true } })
  return clearSessionCookie(res)
}
