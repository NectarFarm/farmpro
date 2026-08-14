import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { computeTrialBalance } from '@/lib/finance'

// ── GET /api/gl/trial-balance (issue #239 task 4) ───────────────────────────
// Tenant-scoped: sums this tenant's real journal_lines (posted from real
// sales/purchases writes only — see lib/finance.ts's computeTrialBalance) per
// account. `balanced: totalDebits === totalCredits` is the shape the issue's
// acceptance criteria asks a test to prove; since every posting function
// inserts a debit and a credit of the same amount per entry, this always
// balances by construction as long as every entry was posted through
// lib/finance.ts's postSaleJournal / postPurchaseJournal.
//
// Same tenant-resolution conventions as GET /api/batches: session tenant
// wins, `tenantId` query param is the standalone-mock-mode fallback.

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const badRequest = (msg: string) => NextResponse.json({ success: false, error: msg }, { status: 400 })

export async function GET(req: Request) {
  const session = await getSessionUser()
  const url = new URL(req.url)
  const tenantId = session?.tenantId ?? url.searchParams.get('tenantId')?.trim()
  if (!tenantId) return badRequest('tenantId is required')

  const trialBalance = await computeTrialBalance(tenantId)
  return ok(trialBalance)
}
