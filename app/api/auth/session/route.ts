import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

// ── GET /api/auth/session (issue #220/#221) ────────────────────────────────
// The shell's bootstrap calls this on load. 200 + the session user
// ({ id, name, email, role, tenantId }) when the cookie is valid, otherwise the
// standard 401 envelope — the shell treats any non-200 as logged-out.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'No active session' }, { status: 401, headers: corsHeaders })
  }
  return NextResponse.json({ success: true, data: user }, { status: 200, headers: corsHeaders })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
