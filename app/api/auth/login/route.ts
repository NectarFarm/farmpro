import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { attachSessionCookie, createSession, verifySecret } from '@/lib/auth'

// ── POST /api/auth/login (issue #221) ──────────────────────────────────────
// Real credentials against the seeded `users` table (db/seed.mjs). Body:
//   { email, password }  — owner / manager / vet / auditor / super_admin
//   { pin }              — worker PIN login
// Success sets the httpOnly `ifms_session` cookie and returns the session user.
// Failure returns the standard 401 envelope — never a bare 500.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const json = (body: object, status: number) => NextResponse.json(body, { status, headers: corsHeaders })

// PIN login: hashes are salted, so match by scanning worker rows (a small,
// worker-only set) rather than storing PINs recoverably.
async function findByPin(pin: string) {
  const candidates = await db
    .select()
    .from(users)
    .where(eq(users.role, 'worker'))
  return candidates.find((u) => u.pinHash && verifySecret(pin, u.passwordSalt, u.pinHash)) ?? null
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400)
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const pin = typeof b.pin === 'string' ? b.pin.trim() : ''
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const password = typeof b.password === 'string' ? b.password : ''

  let user: typeof users.$inferSelect | null = null
  if (pin) {
    user = await findByPin(pin)
  } else if (email && password) {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    const candidate = rows[0] ?? null
    if (candidate && verifySecret(password, candidate.passwordSalt, candidate.passwordHash)) {
      user = candidate
    }
  }

  if (!user) {
    return json({ success: false, error: 'Invalid email or password' }, 401)
  }
  if (user.status !== 'ACTIVE') {
    return json({ success: false, error: 'This account is not active — contact support' }, 403)
  }

  const token = await createSession(user.id)
  const res = json(
    {
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId },
    },
    200,
  )
  return attachSessionCookie(res, token)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}
