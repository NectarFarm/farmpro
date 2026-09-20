import { NextResponse } from 'next/server'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canEdit, MODULES } from '@/lib/permissions'
import { updateDimensionValue, archiveDimensionValue, SystemDimensionEditError, DimensionNotFoundError } from '@/lib/dimensions'
import { db } from '@/db'

// ── PATCH /api/dimensions/[id]/values/[valueId] (dimensions-operable task) ──
// Editing (rename) and archiving a value on a USER-DEFINED dimension. A
// value projected from a real farm/unit/batch (sourceType set) — or any
// value under a system dimension — refuses both; see this repo's convention
// (db/schemas/dimensions.ts's header, and this route's sibling
// app/api/dimensions/[id]/values/route.ts's POST) for why a second place to
// rename/retire a projected value is not allowed.
//
// Body: { tenantId?, name?, archived? }. `code` is deliberately not
// editable here — an accountant may already have typed/memorised it on a
// posting; renaming a code out from under postings that reference it by
// value id would not break anything technically (postings hold the id, not
// the code), but it WOULD make old postings unreadable against the current
// register, which is the exact "ledger and register stop agreeing" failure
// this task's rules exist to prevent.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 404 })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; valueId: string }> }) {
  const { id, valueId } = await params
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
    return forbidden('Your role does not have edit access to finance configuration')
  }

  try {
    let row
    if (typeof b.name === 'string' && b.name.trim()) {
      row = await updateDimensionValue(db, tenantId, id, valueId, { name: b.name.trim() })
    }
    if (typeof b.archived === 'boolean') {
      row = await archiveDimensionValue(db, tenantId, id, valueId, b.archived)
    }
    if (!row) return badRequest('Nothing to update — pass name and/or archived')
    return ok(row)
  } catch (err) {
    if (err instanceof DimensionNotFoundError) return notFound(err.message)
    if (err instanceof SystemDimensionEditError) return badRequest(err.message)
    throw err
  }
}
