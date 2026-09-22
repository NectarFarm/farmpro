import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { payments, tenants } from '@/db/schemas'
import { requirePlatformCapability } from '@/lib/api-auth'

// ── GET /api/admin/payments?status=pending (billing.manage) ────────────────
// Defaults to `pending` (the actionable queue) — pass `?status=all` for the
// full history, or any other single PaymentStatus to filter on it.
export async function GET(req: Request) {
  const auth = await requirePlatformCapability('billing.manage')
  if ('error' in auth) return auth.error

  const status = new URL(req.url).searchParams.get('status')?.trim() || 'pending'

  const rows = await db
    .select({ payment: payments, tenantName: tenants.name })
    .from(payments)
    .innerJoin(tenants, eq(tenants.id, payments.tenantId))
    .where(status === 'all' ? undefined : eq(payments.status, status))
    .orderBy(desc(payments.createdAt))

  const data = rows.map(({ payment, tenantName }) => ({ ...payment, tenantName }))
  return NextResponse.json({ success: true, data }, { status: 200 })
}
