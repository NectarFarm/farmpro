import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { suppliers } from '@/db/schemas'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'

// ── PATCH /api/suppliers/[id] (item 20) ─────────────────────────────────────
// Edits the master's own fields, including `active` — a supplier who closed
// shop stops showing up in the type-to-search picker without losing the
// purchase history already linked to them.
const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Supplier not found' }, { status: 404 })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>
  const auth = await requireTenantSession({ explicitTenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canEdit(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have edit access to finance')
  }

  const patch: Partial<typeof suppliers.$inferInsert> = {}
  if (typeof b.name === 'string') {
    if (!b.name.trim()) return badRequest('name cannot be empty')
    patch.name = b.name.trim()
  }
  if (typeof b.phone === 'string') patch.phone = b.phone.trim()
  if (typeof b.contact === 'string') patch.contact = b.contact.trim()
  if (typeof b.tin === 'string') patch.tin = b.tin.trim() || null
  if (typeof b.creditTerms === 'string') patch.creditTerms = b.creditTerms.trim() || null
  if (typeof b.active === 'boolean') patch.active = b.active
  if (Object.keys(patch).length === 0) return badRequest('Nothing to update')

  const [updated] = await db
    .update(suppliers)
    .set(patch)
    .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)))
    .returning()
  if (!updated) return notFound()

  return ok(updated)
}
