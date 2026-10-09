import { NextResponse } from 'next/server'
import { db } from '@/db'
import { expenseCategories } from '@/db/schemas'
import { ensureExpenseCategories } from '@/lib/expenses'
import { asc, eq } from 'drizzle-orm'
import { requireTenantSession, forbidden } from '@/lib/api-auth'
import { canView, MODULES } from '@/lib/permissions'

// ── GET /api/expense-categories ─────────────────────────────────────────────
// The active catalogue an owner picks from. Inactive rows are omitted — a
// retired category is not a choice. An empty list is a real empty state
// (every category deactivated), not a prompt to invent one.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error
  const { session, tenantId } = auth

  if (!(await canView(tenantId, session.role, MODULES.finance))) {
    return forbidden('Your role does not have access to finance')
  }

  await ensureExpenseCategories()
  const rows = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.active, true))
    .orderBy(asc(expenseCategories.name), asc(expenseCategories.code))

  return ok(rows)
}
