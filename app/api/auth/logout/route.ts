import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { clearSessionCookie, destroySession, SESSION_COOKIE } from '@/lib/auth'

// ── POST /api/auth/logout (issue #220/#221) ────────────────────────────────
// Deletes the session row and clears the httpOnly cookie. The shell fires this
// on sign-out (visible in the network tab — check #4 of #221) and always
// returns to the login screen regardless.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function POST() {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  await destroySession(token)
  const res = NextResponse.json({ success: true, data: { loggedOut: true } }, { headers: corsHeaders })
  return clearSessionCookie(res)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
