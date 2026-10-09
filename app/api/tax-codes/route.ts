import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { taxCodes, taxRates } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'

// GET /api/tax-codes — the catalogue a record sheet previews with. Any
// signed-in tenant user can read it; the server still recomputes tax on save.
// Rates are included so the preview can pick the one in force on the
// document date. No rate is invented when the table is empty. Read-only: the
// four codes are seeded by migration 0054, and the admin POST re-seeds.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({ explicitTenantId: url.searchParams.get('tenantId') })
  if ('error' in auth) return auth.error

  const codes = await db.select().from(taxCodes).where(eq(taxCodes.active, true)).orderBy(asc(taxCodes.name))
  const rates = await db.select().from(taxRates).orderBy(asc(taxRates.effectiveFrom))
  return ok({
    codes: codes.map((row) => ({ code: row.code, name: row.name })),
    rates: rates.map((row) => ({
      taxCode: row.taxCode,
      rateBps: row.rateBps,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    })),
  })
}
