import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { getSessionUser, hashSecret, pinPrefilter } from '@/lib/auth'

const json = (body: object, status = 200) => NextResponse.json(body, { status })

function canManagePins(role: string) {
  return role === 'owner' || role === 'manager'
}

// GET /api/security/worker-pins — returns worker accounts only. PIN values and
// hashes never leave the server; `hasPin` is enough for an owner to see which
// workers still need credentials provisioned.
export async function GET() {
  const session = await getSessionUser()
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401)
  if (!session.tenantId || !canManagePins(session.role)) return json({ success: false, error: 'Forbidden' }, 403)

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, status: users.status, hasPin: users.pinHash })
    .from(users)
    .where(and(eq(users.tenantId, session.tenantId), eq(users.role, 'worker')))
    .orderBy(asc(users.name))

  return json({ success: true, data: rows.map(({ hasPin, ...worker }) => ({ ...worker, hasPin: Boolean(hasPin) })) })
}

// POST /api/security/worker-pins — owner/manager credential rotation for a
// worker. The existing password salt is deliberately retained because workers
// can also have password credentials; rotating it would invalidate that hash.
export async function POST(req: Request) {
  const session = await getSessionUser()
  if (!session) return json({ success: false, error: 'Unauthorized' }, 401)
  if (!session.tenantId || !canManagePins(session.role)) return json({ success: false, error: 'Forbidden' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ success: false, error: 'Invalid JSON body' }, 400) }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
  if (!userId) return json({ success: false, error: 'Worker is required' }, 400)
  if (!/^\d{4}$/.test(pin)) return json({ success: false, error: 'PIN must contain exactly 4 digits' }, 400)

  const worker = await db
    .select({ id: users.id, passwordSalt: users.passwordSalt })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, session.tenantId), eq(users.role, 'worker')))
    .limit(1)
  if (!worker[0]) return json({ success: false, error: 'Worker account not found' }, 404)

  await db.update(users).set({
    pinHash: hashSecret(pin, worker[0].passwordSalt),
    pinPrefilter: pinPrefilter(pin),
  }).where(eq(users.id, worker[0].id))

  return json({ success: true, data: { id: worker[0].id } })
}
