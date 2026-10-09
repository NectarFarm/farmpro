import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { expenseCategories } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'

// ── PATCH /api/admin/expense-categories/[id] ────────────────────────────────
// Name and active flag only. The account a category posts to is not editable:
// changing it would make the next expense hit a different account while old
// journal lines stay where they were posted, with nothing on the row saying
// the mapping moved. Retire it and add a new category instead.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })
const notFound = () => NextResponse.json({ success: false, error: 'Expense category not found' }, { status: 404 })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requirePlatformCapability('catalogue.manage')
  if ('error' in auth) return auth.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }
  const b = (raw ?? {}) as Record<string, unknown>

  const patch: { name?: string; active?: boolean } = {}
  if (typeof b.name === 'string') {
    const name = b.name.trim()
    if (!name) return badRequest('name cannot be blank')
    patch.name = name
  }
  if (typeof b.active === 'boolean') patch.active = b.active
  if (Object.keys(patch).length === 0) return badRequest('Nothing to update')

  const [row] = await db.update(expenseCategories).set(patch).where(eq(expenseCategories.id, id)).returning()
  if (!row) return notFound()
  return ok(row)
}
