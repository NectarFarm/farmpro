import { NextResponse } from 'next/server'
import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { SAFE_USER_COLUMNS } from '@/lib/admin-users'

// ── GET /api/admin/users (admin user-management feature) ───────────────────
// super_admin only. Lists every user across every tenant — the "full user
// management by admin for all users" the user asked for — with narrowing via
// query params so the admin can "narrow down" instead of scrolling one big
// list:
//   q        — case-insensitive substring match on name OR email
//   role     — exact match, one of lib/admin-users.ts's VALID_ROLES
//   status   — exact match, one of VALID_STATUSES
//   tenantId — exact match (pass 'null' literally to find platform users)
//   limit/offset — pagination, default 50 / 0, limit capped at 200
//
// Only the explicit safe column set is ever selected — passwordHash,
// passwordSalt, pinHash, pinPrefilter never leave this route (see
// lib/admin-users.ts's SAFE_USER_COLUMNS comment).

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function GET(req: Request) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  if (session.role !== 'super_admin') return bad('Forbidden', 403)

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const role = url.searchParams.get('role')?.trim() ?? ''
  const status = url.searchParams.get('status')?.trim() ?? ''
  const tenantIdParam = url.searchParams.get('tenantId')?.trim() ?? ''

  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), MAX_LIMIT) : DEFAULT_LIMIT
  const offsetParam = Number(url.searchParams.get('offset'))
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? Math.floor(offsetParam) : 0

  const conditions = []
  if (q) conditions.push(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)))
  if (role) conditions.push(eq(users.role, role))
  if (status) conditions.push(eq(users.status, status))
  if (tenantIdParam) {
    // 'null' is a literal query-string sentinel for "platform users" (whose
    // real tenantId column value is SQL NULL) — there's no way to pass an
    // actual null through a query string, so this is the one string this
    // param treats specially rather than matching a tenant literally named "null".
    conditions.push(tenantIdParam === 'null' ? isNull(users.tenantId) : eq(users.tenantId, tenantIdParam))
  }

  const where = conditions.length ? and(...conditions) : undefined

  const rows = await db
    .select(SAFE_USER_COLUMNS)
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ success: true, data: rows }, { status: 200 })
}
