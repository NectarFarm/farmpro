import { NextResponse } from 'next/server'
import { db } from '@/db'
import { notifications } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { and, eq } from 'drizzle-orm'

// ── PATCH /api/notifications/[id] (issue #227 task 3) ──────────────────────
// Mark-read. Tenant-scoped: a notification only updates when its tenantId
// matches the caller's (session tenant, or the `tenantId` query param in
// standalone mock mode) — otherwise 404, same as "not found", so this can't
// be used to probe another tenant's notification ids.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Notification not found' }, { status: 404 })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSessionUser()
  const tenantId = session?.tenantId ?? new URL(req.url).searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  let read = true
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object' && 'read' in raw) {
      const b = raw as Record<string, unknown>
      if (typeof b.read === 'boolean') read = b.read
    }
  } catch {
    // No/empty body — default to marking read, the only action this route
    // supports today.
  }

  const rows = await db
    .update(notifications)
    .set({ read })
    .where(and(eq(notifications.id, id), eq(notifications.tenantId, tenantId)))
    .returning()

  if (rows.length === 0) return notFound()
  return ok(rows[0])
}
